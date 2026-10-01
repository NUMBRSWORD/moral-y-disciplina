// PostgreSQL real en memoria (PGlite); sin red, cuentas ni datos de producción.
// npm ci --ignore-scripts
// node tests/recepcion-db.test.mjs
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const admin='00000000-0000-0000-0000-000000000001';
const owner='00000000-0000-0000-0000-000000000002';
const other='00000000-0000-0000-0000-000000000003';
const blocked='00000000-0000-0000-0000-000000000004';
const note='10000000-0000-0000-0000-000000000001';
const pending='10000000-0000-0000-0000-000000000002';
const archived='10000000-0000-0000-0000-000000000003';
let count=0;
async function check(name,fn){await fn();count++;console.log('OK '+name);}
async function login(id,aal='aal2',role='authenticated'){
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.aal',$2,false)",[id,aal]);
  await db.exec('set role '+role);
}
const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0];
const rejected=async(sql,args=[],code='42501')=>assert.rejects(db.query(sql,args),e=>e.code===code);
try {
  await db.exec(`
    create role anon;create role authenticated;
    create schema auth;create schema storage;
    grant usage on schema public,auth,storage to authenticated,anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,role text,estado text,cip text);
    create function public.tiene_mfa_verificada() returns boolean language sql stable as $$select current_setting('request.jwt.claim.aal',true)='aal2'$$;
    create function public.esta_aprobado() returns boolean language sql stable security definer set search_path=public as $$select public.tiene_mfa_verificada() and exists(select 1 from public.profiles where id=auth.uid() and estado='aprobado')$$;
    create function public.es_admin() returns boolean language sql stable security definer set search_path=public as $$select public.esta_aprobado() and exists(select 1 from public.profiles where id=auth.uid() and role='admin')$$;
    create function public.cip_actual() returns text language sql stable security definer set search_path=public as $$select cip from public.profiles where id=auth.uid() and public.esta_aprobado()$$;
    create table public.notas_informativas(id uuid primary key,oficial_constato_cip text,codigo_infraccion text,orden_sancion_generada_at timestamptz,orden_notificada_at timestamptz,archivo_orden_notificacion_path text,archivo_leve_generada_at timestamptz);
    alter table public.notas_informativas enable row level security;
    grant select on public.notas_informativas to authenticated;
    create policy propias on public.notas_informativas for select to authenticated using(public.es_admin() or oficial_constato_cip=public.cip_actual());
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text references storage.buckets(id),name text,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    -- Simular incluso una política heredada demasiado amplia: el bucket nuevo
    -- debe seguir protegido por las políticas restrictivas de la migración.
    create policy heredada on storage.objects for all to authenticated using(true) with check(true);
    create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
    insert into auth.users values('${admin}'),('${owner}'),('${other}'),('${blocked}');
    insert into public.profiles values('${admin}','admin','aprobado','111'),('${owner}','viewer','aprobado','222'),('${other}','viewer','aprobado','333'),('${blocked}','admin','pendiente','444');
    insert into public.notas_informativas values
      ('${note}','222','L21','2020-01-01T12:00:00Z','2020-01-02T12:00:00Z','legajo.pdf',null),
      ('${pending}','222','L21','2020-01-01T12:00:00Z',null,null,null),
      ('${archived}','222','L21',null,null,null,'2020-01-01T12:00:00Z');
  `);
  const migration=await readFile(new URL('../supabase/recepcion-fisica-y-apelacion.sql',import.meta.url),'utf8');
  await check('migración aditiva e idempotente',async()=>{
    await db.exec(migration);await db.exec(migration);
    assert.equal((await one('select count(*)::int c from public.recepciones_fisicas')).c,0);
    assert.equal((await one('select count(*)::int c from public.notas_informativas')).c,3);
  });
  await check('no administrador no puede confirmar ni fabricar cargo',async()=>{
    await login(owner);
    await rejected('select public.confirmar_recepcion_fisica($1,true)',[note]);
    await rejected('insert into public.recepciones_fisicas values($1,now(),$2,true)',[note,owner]);
  });
  await check('admin requiere físico conforme y expediente subido',async()=>{
    await login(admin);
    await rejected('select public.confirmar_recepcion_fisica($1,false)',[note],'22023');
    await rejected('select public.confirmar_recepcion_fisica($1,true)',[pending],'22023');
    assert.equal((await one('select count(*)::int c from public.recepciones_fisicas')).c,0);
  });
  let receipt;
  await check('confirmación única con fecha del servidor, sin exigir apelación',async()=>{
    receipt=(await one('select public.confirmar_recepcion_fisica($1,true) r',[note])).r;
    assert.equal(receipt.recibido_por,admin);assert.equal(receipt.conformidad_verificada,true);
    assert.ok(Math.abs(Date.now()-new Date(receipt.recibido_at).getTime())<10000);
    assert.deepEqual((await one('select public.confirmar_recepcion_fisica($1,true) r',[note])).r,receipt);
    assert.equal((await one('select count(*)::int c from public.apelaciones_expediente')).c,0);
    await rejected('update public.recepciones_fisicas set recibido_at=now()');
  });
  await check('lectura de cargo únicamente para nota autorizada',async()=>{
    await login(owner);assert.equal((await one('select count(*)::int c from public.recepciones_fisicas')).c,1);
    await login(other);assert.equal((await one('select count(*)::int c from public.recepciones_fisicas')).c,0);
    await rejected('select public.presentar_apelacion_expediente($1,current_date,$2,$3)',[note,'ajeno.pdf','ajeno.pdf']);
  });
  await check('sin aprobación o sin MFA no hay lectura ni confirmación',async()=>{
    await login(blocked);await rejected('select public.confirmar_recepcion_fisica($1,true)',[note]);
    await login(admin,'aal1');assert.equal((await one('select count(*)::int c from public.recepciones_fisicas')).c,0);
    await rejected('select public.confirmar_recepcion_fisica($1,true)',[note]);
    await login('','aal1','anon');await rejected('select * from public.recepciones_fisicas');
    await rejected('select public.confirmar_recepcion_fisica($1,true)',[note]);
  });
  const path=`${owner}/${note}/recurso.pdf`;
  await check('storage impide adjuntar a expediente ajeno o sin sanción',async()=>{
    await login(other);
    await rejected("insert into storage.objects values('apelaciones-expediente',$1)",[`${other}/${note}/ajeno.pdf`]);
    await login(owner);
    await rejected("insert into storage.objects values('apelaciones-expediente',$1)",[`${owner}/${archived}/archivo.pdf`]);
    await db.query("insert into storage.objects values('apelaciones-expediente',$1)",[path]);
    assert.equal((await one('select count(*)::int c from storage.objects')).c,0);
  });
  let appeal;
  await check('apelación firmada usa fecha de notificación y no modifica recepción',async()=>{
    appeal=(await one('select public.presentar_apelacion_expediente($1,current_date,$2,$3) r',[note,path,'recurso.pdf'])).r;
    assert.equal(appeal.fecha_notificacion,'2020-01-02');assert.equal(appeal.presentada_por,owner);
    assert.equal((await one('select count(*)::int c from storage.objects')).c,1);
    assert.deepEqual((await one('select to_jsonb(r) r from public.recepciones_fisicas r')).r,receipt);
    const duplicate=(await one('select public.presentar_apelacion_expediente($1,current_date,$2,$3) r',[note,path,'duplicado.pdf'])).r;
    assert.deepEqual(duplicate,appeal);
    await rejected("delete from public.apelaciones_expediente");
  });
  await check('apelación admite registro antes de subir expediente y exige PDF guardado',async()=>{
    await rejected('select public.presentar_apelacion_expediente($1,current_date,$2,$3)',[pending,`${owner}/${pending}/inexistente.pdf`,'inexistente.pdf'],'22023');
    const pendingPath=`${owner}/${pending}/recurso.pdf`;
    await db.query("insert into storage.objects values('apelaciones-expediente',$1)",[pendingPath]);
    await rejected("select public.presentar_apelacion_expediente($1,current_date+1,$2,$3)",[pending,pendingPath,'recurso.pdf'],'22023');
    await db.query('select public.presentar_apelacion_expediente($1,current_date,$2,$3)',[pending,pendingPath,'recurso.pdf']);
    assert.equal((await one('select count(*)::int c from public.apelaciones_expediente')).c,2);
    assert.equal((await one('select count(*)::int c from public.recepciones_fisicas')).c,1);
  });
  await check('apelación y archivo privado no son visibles a usuarios ajenos',async()=>{
    await login(other);
    assert.equal((await one('select count(*)::int c from public.apelaciones_expediente')).c,0);
    assert.equal((await one('select count(*)::int c from storage.objects')).c,0);
    await login(admin);
    assert.equal((await one('select count(*)::int c from public.apelaciones_expediente')).c,2);
  });
  console.log(`${count} pruebas de base de datos aprobadas. Producción no fue consultada ni modificada.`);
} finally {await db.close();}
