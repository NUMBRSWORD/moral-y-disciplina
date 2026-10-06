// Prueba PostgreSQL aislada: el administrador restablece la clave de un usuario.
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db=new PGlite({extensions:{pgcrypto}});
const ADMIN='00000000-0000-0000-0000-00000000000a';
const OTRO_ADMIN='00000000-0000-0000-0000-00000000000b';
const USUARIO='00000000-0000-0000-0000-000000000001';
const BAJA='00000000-0000-0000-0000-000000000002';
const GOOGLE='00000000-0000-0000-0000-000000000003';
const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
let total=0;
async function check(name,fn){await fn();console.log('OK '+name);total++;}

async function como(uid,aal){
  await db.exec('reset role');
  await db.query("select set_config('qa.uid',$1,false),set_config('qa.aal',$2,false)",[uid,aal]);
  await db.exec('set role authenticated');
}
async function falla(sql,patron){
  await assert.rejects(db.query(sql),(e)=>{assert.match(e.message,patron);return true;});
}
const restablecer=(cip)=>one('select public.restablecer_clave_usuario($1) clave',[cip]);

try{
  await db.exec(`
    create role anon;create role authenticated;
    create schema auth;create schema extensions;
    create extension pgcrypto schema extensions;
    grant usage on schema public,auth,extensions to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('qa.aal',true))$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,updated_at timestamptz);
    create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid);
    create table public.profiles(id uuid primary key,role text,estado text,cip text);
    create table public.audit_log(id uuid primary key default gen_random_uuid(),table_name text,record_id uuid,action text check(action in('INSERT','UPDATE','DELETE')),changed_by uuid,changed_by_email text,changed_at timestamptz default now(),old_data jsonb,new_data jsonb);
    insert into auth.users values
      ('${ADMIN}','111111@moralydisciplina.local',now(),extensions.crypt('clave-admin',extensions.gen_salt('bf')),now()),
      ('${OTRO_ADMIN}','222222@moralydisciplina.local',now(),extensions.crypt('clave-admin-2',extensions.gen_salt('bf')),now()),
      ('${USUARIO}','333333@moralydisciplina.local',now(),extensions.crypt('clave-olvidada',extensions.gen_salt('bf')),now()),
      ('${BAJA}','444444@moralydisciplina.local',now(),extensions.crypt('clave-baja',extensions.gen_salt('bf')),now()),
      ('${GOOGLE}','alguien@example.invalid',now(),null,now());
    insert into public.profiles values
      ('${ADMIN}','admin','aprobado','111111'),('${OTRO_ADMIN}','admin','aprobado','222222'),
      ('${USUARIO}','viewer','aprobado','333333'),('${BAJA}','viewer','rechazado','444444'),
      ('${GOOGLE}','viewer','aprobado','555555');
    insert into auth.sessions(user_id) values('${USUARIO}'),('${USUARIO}'),('${ADMIN}');
  `);
  for(const archivo of ['20260921180000_cambio_clave_pendiente_en_servidor.sql','20261006120000_restablecer_clave_por_admin.sql']){
    await db.exec(await readFile(new URL('../supabase/migrations/'+archivo,import.meta.url),'utf8'));
  }

  await check('un viewer no puede restablecer claves',async()=>{
    await como(USUARIO,'aal2');
    await falla("select public.restablecer_clave_usuario('444444')",/Solo un administrador/);
  });
  await check('anon no puede ejecutar la función',async()=>{
    await db.exec('reset role;set role anon');
    await falla("select public.restablecer_clave_usuario('333333')",/permission denied/);
  });
  await check('el administrador sin el código del token (aal1) no puede',async()=>{
    await como(ADMIN,'aal1');
    await falla("select public.restablecer_clave_usuario('333333')",/token/);
  });
  await check('rechaza CIP inválido, inexistente, propio, de administrador y de baja',async()=>{
    await como(ADMIN,'aal2');
    await falla("select public.restablecer_clave_usuario('33a333')",/CIP válido/);
    await falla("select public.restablecer_clave_usuario('999999')",/No hay una cuenta/);
    await falla("select public.restablecer_clave_usuario('555555')",/No hay una cuenta/);
    await falla("select public.restablecer_clave_usuario('111111')",/Cambiar clave/);
    await falla("select public.restablecer_clave_usuario('222222')",/desde Supabase/);
    await falla("select public.restablecer_clave_usuario('444444')",/no está aprobada/);
  });

  let clave;
  await check('restablece: clave temporal legible, vieja inválida, sesiones cerradas, cambio pendiente',async()=>{
    await como(ADMIN,'aal2');
    ({clave}=await restablecer(' 333333 '));
    assert.match(clave,/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
    await db.exec('reset role');
    const u=await one(`select encrypted_password h from auth.users where id='${USUARIO}'`);
    assert.equal((await one('select extensions.crypt($1,$2)=$2 ok',[clave,u.h])).ok,true);
    assert.equal((await one('select extensions.crypt($1,$2)=$2 ok',['clave-olvidada',u.h])).ok,false);
    assert.equal(Number((await one(`select count(*) n from auth.sessions where user_id='${USUARIO}'`)).n),0);
    assert.equal(Number((await one(`select count(*) n from auth.sessions where user_id='${ADMIN}'`)).n),1);
    const p=await one(`select hash_al_marcar h from public.cambios_clave_pendientes where user_id='${USUARIO}'`);
    assert.equal(p.h,u.h);
  });
  await check('la auditoría registra quién y a qué CIP, sin la clave',async()=>{
    const a=await one(`select changed_by,new_data from public.audit_log where record_id='${USUARIO}'`);
    assert.equal(a.changed_by,ADMIN);
    assert.deepEqual(a.new_data,{evento:'clave_restablecida',cip:'333333'});
    assert.ok(!JSON.stringify(a).includes(clave));
  });
  await check('con la clave temporal el usuario queda bloqueado hasta cambiarla',async()=>{
    await como(USUARIO,'aal1');
    assert.equal((await one('select public.necesita_cambiar_clave() p,public.esta_aprobado() a')).p,true);
    assert.equal((await one('select public.esta_aprobado() a')).a,false);
    assert.equal((await one('select public.confirmar_cambio_clave() ok')).ok,false);
    await db.exec(`reset role;update auth.users set encrypted_password=extensions.crypt('Nueva-Clave-2026',extensions.gen_salt('bf')) where id='${USUARIO}'`);
    await como(USUARIO,'aal1');
    assert.equal((await one('select public.confirmar_cambio_clave() ok')).ok,true);
    assert.equal((await one('select public.esta_aprobado() a')).a,true);
  });
  await check('dos restablecimientos seguidos dan claves distintas',async()=>{
    await como(ADMIN,'aal2');
    const a=(await restablecer('333333')).clave,b=(await restablecer('333333')).clave;
    assert.notEqual(a,b);
  });
  console.log(`${total} pruebas correctas; sin cambios en Supabase real.`);
}finally{await db.close();}
