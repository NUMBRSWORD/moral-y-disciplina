// Prueba PostgreSQL aislada de compatibilidad: MFA + cambio obligatorio de clave.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const id='00000000-0000-0000-0000-000000000001';
const one=async sql=>(await db.query(sql)).rows[0];
let total=0;
async function check(name,fn){await fn();console.log('OK '+name);total++;}
try{
  await db.exec(`
    create role anon;create role authenticated;create schema auth;
    grant usage on schema public,auth to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select '${id}'::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('qa.aal',true))$$;
    create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
    create table public.profiles(id uuid,role text,estado text,cip text);
    insert into auth.users values('${id}','google@example.invalid',now());
    insert into public.profiles values('${id}','admin','aprobado','123456');
    create table public.documentos_institucionales(id int);
    create table public.firmas_documentos(firmante_id uuid);
    alter table public.documentos_institucionales enable row level security;
    alter table public.firmas_documentos enable row level security;
    create policy "documentos_institucionales_select_authenticated" on public.documentos_institucionales for select using(true);
    create policy "firmas_documentos_select_authenticated" on public.firmas_documentos for select using(true);
    create policy "cada quien firma solo por si mismo" on public.firmas_documentos for insert with check(true);
  `);
  const sql=await readFile(new URL('../supabase/seguridad-mfa-aal2.sql',import.meta.url),'utf8');
  await check('migración compatible e idempotente en instalación previa',async()=>{
    await db.exec(sql);await db.exec(sql);
    assert.equal((await one('select public.clave_actualizada_para_operar() ok')).ok,true);
  });
  // Contrato de necesita_cambiar_clave(): no se simula ni toca auth de producción.
  await db.exec(`create function public.necesita_cambiar_clave() returns boolean language sql stable as $$select current_setting('qa.clave_pendiente',true)='true'$$;`);
  async function claims(aal,pending){
    await db.query("select set_config('qa.aal',$1,false),set_config('qa.clave_pendiente',$2,false)",[aal,String(pending)]);
    await db.exec('set role authenticated');
  }
  const estado=()=>one('select public.esta_aprobado() aprobado,public.es_admin() admin,public.cip_actual() cip');
  await check('AAL1 no habilita operaciones aunque la clave esté actualizada',async()=>{
    await claims('aal1',false);
    assert.deepEqual(await estado(),{aprobado:false,admin:false,cip:null});
    assert.equal((await one('select public.cuenta_aprobada_para_politicas() ok')).ok,true);
  });
  await check('AAL2 no evita el bloqueo por clave pendiente',async()=>{
    await claims('aal2',true);
    assert.deepEqual(await estado(),{aprobado:false,admin:false,cip:null});
  });
  await check('solo AAL2 y clave actualizada habilitan el CIP de Google registrado',async()=>{
    await claims('aal2',false);
    assert.deepEqual(await estado(),{aprobado:true,admin:true,cip:'123456'});
  });
  await check('cuenta no aprobada sigue bloqueada',async()=>{
    await db.exec("reset role;update public.profiles set estado='pendiente';set role authenticated;");
    assert.deepEqual(await estado(),{aprobado:false,admin:false,cip:null});
  });
  await check('una respuesta desconocida del bloqueo no concede acceso',async()=>{
    await db.exec("reset role;update public.profiles set estado='aprobado';create or replace function public.necesita_cambiar_clave() returns boolean language sql stable as $$select null::boolean$$;set role authenticated;");
    assert.deepEqual(await estado(),{aprobado:false,admin:false,cip:null});
  });
  console.log(`${total} pruebas correctas; sin cambios en Supabase real.`);
}finally{await db.close();}
