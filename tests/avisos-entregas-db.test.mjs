import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
const uid = '00000000-0000-0000-0000-000000000001';
const clave = 'a'.repeat(64);
const reservar = async()=> (await db.query('select public.reservar_entrega_android($1,$2) r',[clave,uid])).rows[0].r;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${uid}');`);
  const sql = await readFile(new URL('../supabase/avisos-android-entregas.sql',import.meta.url),'utf8');
  await db.exec(sql); await db.exec(sql);
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    await assert.rejects(reservar(),e=>e.code==='42501');
    await assert.rejects(db.query('select * from public.entregas_android'),e=>e.code==='42501');
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const primera = await reservar();
  assert.equal(primera.reservada,true);
  assert.equal((await reservar()).reservada,false);
  await db.exec("update public.entregas_android set reservado_hasta=now()-interval '1 minute'");
  const segunda = await reservar();
  assert.equal(segunda.reservada,true);
  assert.notEqual(primera.intento_id,segunda.intento_id);
  assert.equal((await db.query('update public.entregas_android set enviado_at=now() where clave=$1 and intento_id=$2 returning clave',[clave,primera.intento_id])).rows.length,0);
  await db.query('update public.entregas_android set enviado_at=now() where clave=$1 and intento_id=$2',[clave,segunda.intento_id]);
  await db.exec("update public.entregas_android set reservado_hasta=now()-interval '1 minute'");
  assert.equal((await reservar()).reservada,false);
  console.log('OK: migración idempotente, permisos, reserva exclusiva, reintento tras fallo, propietario del intento y deduplicación final (6 comprobaciones).');
} finally {await db.close();}
