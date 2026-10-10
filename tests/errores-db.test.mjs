// Prueba PostgreSQL aislada: registro de errores de la web/app.
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db=new PGlite();
const ADMIN='00000000-0000-0000-0000-00000000000a';
const USUARIO='00000000-0000-0000-0000-000000000001';
const OTRO='00000000-0000-0000-0000-000000000002';
const one=async(sql,params)=>(await db.query(sql,params)).rows[0];
let total=0;
async function check(name,fn){await fn();console.log('OK '+name);total++;}
async function como(uid){
  await db.exec('reset role');
  await db.query("select set_config('qa.uid',$1,false)",[uid||'']);
  await db.exec(uid?'set role authenticated':'set role anon');
}
const registrar=(tipo,mensaje,origen=null)=>db.query('select public.registrar_error_app($1,$2,$3,$4,$5,$6)',[tipo,mensaje,origen,'/index.html','web','Prueba']);

try{
  await db.exec(`
    create role anon;create role authenticated;create schema auth;
    grant usage on schema public,auth to anon,authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('qa.uid',true),'')::uuid$$;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${ADMIN}'),('${USUARIO}'),('${OTRO}');
    create function public.es_admin() returns boolean language sql stable as $$select auth.uid()='${ADMIN}'::uuid$$;
    grant execute on function public.es_admin() to authenticated;
  `);
  const sql=await readFile(new URL('../supabase/migrations/20261010120000_registro_de_errores.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec('reset role');await db.exec(sql);

  await check('sin sesión no se registra nada (y anon no puede llamar la función)',async()=>{
    await como(null);
    await assert.rejects(registrar('error','x'),/permission denied/);
    await db.exec('reset role');
    assert.equal(Number((await one('select count(*) n from public.errores_app')).n),0);
  });
  await check('el mismo error del mismo día suma veces en vez de repetir filas',async()=>{
    await como(USUARIO);
    await registrar('error','TypeError: x is undefined','app.js:10:5');
    await registrar('error','TypeError: x is undefined','app.js:10:5');
    await registrar('aviso','No se pudo guardar');
    await db.exec('reset role');
    const filas=(await db.query('select tipo,veces from public.errores_app order by tipo')).rows;
    assert.deepEqual(filas,[{tipo:'aviso',veces:1},{tipo:'error',veces:2}]);
  });
  await check('tipo desconocido pasa a "error" y los textos se recortan',async()=>{
    await como(USUARIO);
    await registrar('raro','a'.repeat(900),'b'.repeat(400));
    await db.exec('reset role');
    const f=await one("select tipo,length(mensaje) m,length(origen) o from public.errores_app where mensaje like 'aaa%'");
    assert.deepEqual(f,{tipo:'error',m:500,o:200});
  });
  await check('el usuario no puede leer ni escribir la tabla directamente',async()=>{
    await como(USUARIO);
    assert.equal((await db.query('select * from public.errores_app')).rows.length,0);
    await assert.rejects(db.query("insert into public.errores_app(dia,firma,tipo,mensaje) values(current_date,'f','error','m')"),/permission denied/);
    await assert.rejects(db.query('delete from public.errores_app'),/permission denied/);
  });
  await check('el administrador lee los errores de todos',async()=>{
    await como(OTRO);await registrar('csp','script-src https://malo.invalid');
    await como(ADMIN);
    assert.equal((await db.query('select * from public.errores_app')).rows.length,4);
  });
  await check('tope de 100 errores distintos por persona y día',async()=>{
    await como(OTRO);
    for(let i=0;i<120;i++)await registrar('error','distinto '+i);
    await db.exec('reset role');
    assert.equal(Number((await one(`select count(*) n from public.errores_app where user_id='${OTRO}'`)).n),100);
  });
  await check('se borran solos los de más de 30 días',async()=>{
    await db.exec(`reset role;insert into public.errores_app(user_id,dia,firma,tipo,mensaje) values('${USUARIO}',current_date-40,'vieja','error','viejo')`);
    await como(USUARIO);await registrar('error','nuevo');
    await db.exec('reset role');
    assert.equal(Number((await one("select count(*) n from public.errores_app where firma='vieja'")).n),0);
  });
  console.log(`${total} pruebas correctas; sin cambios en Supabase real.`);
}finally{await db.close();}
