// PostgreSQL real en memoria (PGlite); sin red, cuentas ni datos de producción.
// npm ci --ignore-scripts && node tests/archivo-db.test.mjs
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const admin = '00000000-0000-0000-0000-000000000001';
const oficial = '00000000-0000-0000-0000-000000000002';
const nota = '10000000-0000-0000-0000-000000000001';
const otra = '10000000-0000-0000-0000-000000000002';
const sha = 'a'.repeat(64);
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('OK ' + name); }
async function como(id, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id || '']);
  await db.exec('set role ' + role);
}
const rechaza = (sql, args = [], code = '42501') => assert.rejects(db.query(sql, args), (e) => e.code === code);
const archivar = (id, codigo, folios = 3) => db.query(
  `insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256)
   values($1,$2,$3,'archivo/x.pdf',$4) returning archivado_por`, [id, codigo, folios, sha]);

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    grant usage on schema public, auth to authenticated, anon;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${admin}'), ('${oficial}');
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key, role text);
    insert into public.profiles values ('${admin}','admin'), ('${oficial}','viewer');
    create function public.es_admin() returns boolean language sql stable security definer set search_path=public as
      $$select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin')$$;
    grant execute on function public.es_admin() to authenticated;
    create table public.notas_informativas(id uuid primary key);
    insert into public.notas_informativas values ('${nota}'), ('${otra}');
    create table public.audit_log(id bigserial primary key, table_name text, action text);
    create function public.fn_audit_log() returns trigger language plpgsql security definer set search_path=public as
      $$begin insert into public.audit_log(table_name, action) values (tg_table_name, tg_op); return coalesce(new, old); end$$;
  `);
  const sql = await readFile(new URL('../supabase/archivo-expedientes.sql', import.meta.url), 'utf8');

  await check('migración aditiva e idempotente', async () => {
    await db.exec(sql); await db.exec(sql);
    const t = await db.query("select count(*)::int n from pg_trigger where tgname='audit_archivo_expedientes'");
    assert.equal(t.rows[0].n, 1);
  });

  await check('sin sesión no se lee ni se archiva', async () => {
    await como(null, 'anon');
    await rechaza('select * from public.archivo_expedientes');
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 001-2026',1,'archivo/x.pdf',$2)`, [nota, sha]);
  });

  await check('un oficial no administrador no archiva ni ve el archivo', async () => {
    await como(oficial);
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 001-2026',1,'archivo/x.pdf',$2)`, [nota, sha]);
  });

  await check('el administrador archiva y queda como responsable', async () => {
    await como(admin);
    const r = await archivar(nota, 'OF 045-2026', 34);
    assert.equal(r.rows[0].archivado_por, admin);
    await como(oficial);
    assert.equal((await db.query('select * from public.archivo_expedientes')).rows.length, 0);
  });

  await check('no se repite un número ni se archiva dos veces el mismo caso', async () => {
    await como(admin);
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 045-2026',1,'archivo/y.pdf',$2)`, [otra, sha], '23505');
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 046-2026',1,'archivo/y.pdf',$2)`, [nota, sha], '23505');
  });

  await check('códigos, folios y huella mal formados se rechazan', async () => {
    await como(admin);
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'45-2026',1,'archivo/y.pdf',$2)`, [otra, sha], '23514');
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 046-2026',0,'archivo/y.pdf',$2)`, [otra, sha], '23514');
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 046-2026',1,'archivo/y.pdf','corta')`, [otra], '23514');
    await rechaza(`insert into public.archivo_expedientes(nota_id,codigo,folios,legajo_path,legajo_sha256) values($1,'OF 046-2026',1,'otra/y.pdf',$2)`, [otra, sha], '23514');
  });

  await check('se corrige la ubicación, pero no el código ni el legajo', async () => {
    await como(admin);
    await db.query("update public.archivo_expedientes set ubicacion='Archivador 2', folios=35 where nota_id=$1", [nota]);
    await rechaza("update public.archivo_expedientes set codigo='OF 999-2026' where nota_id=$1", [nota]);
    await rechaza("update public.archivo_expedientes set legajo_path='archivo/otro.pdf' where nota_id=$1", [nota]);
  });

  await check('nadie lo borra desde la aplicación', async () => {
    await como(admin);
    await rechaza('delete from public.archivo_expedientes where nota_id=$1', [nota]);
  });

  await check('cada movimiento queda en el historial', async () => {
    await db.exec('reset role');
    const r = await db.query("select action from public.audit_log where table_name='archivo_expedientes' order by id");
    assert.deepEqual(r.rows.map((x) => x.action), ['INSERT', 'UPDATE']);
  });

  console.log(`${count} pruebas correctas; sin cambios en Supabase real.`);
} finally {
  await db.close();
}
