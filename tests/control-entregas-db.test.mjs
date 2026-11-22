import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

test("el oficial reporta solo su entrega, la oficina confirma por separado y el primer reporte se conserva", async () => {
  const db=new PGlite();
  const caso="00000000-0000-0000-0000-000000000010";
  const uid="00000000-0000-0000-0000-000000000001";
  try {
    await db.exec(`
      create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key); insert into auth.users values ('${uid}');
      grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select '${uid}'::uuid$$;
      create function public.esta_aprobado() returns boolean language sql as $$select true$$;
      create function public.tiene_mfa_verificada() returns boolean language sql as $$select current_setting('app.aal')='2'$$;
      create function public.es_admin() returns boolean language sql as $$select current_setting('app.rol')='admin'$$;
      create function public.cip_actual() returns text language sql as $$select current_setting('app.cip')$$;
      create table public.notas_informativas(id uuid primary key, oficial_constato_cip text,orden_sancion_generada_at timestamptz,
        archivo_leve_generada_at timestamptz, orden_notificada_at timestamptz, archivo_orden_notificacion_path text);
      grant select on public.notas_informativas to authenticated;
      create table public.recepciones_fisicas(nota_id uuid primary key);
      insert into public.notas_informativas values ('${caso}','111111',now(),null,now(),'firmado.pdf');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/20261122013303_panel_control_entregas.sql",import.meta.url),"utf8"));
    const programar = () => db.query("select programar_entrega_panel($1, date '2026-11-21')",[caso]);
    const reportar = () => db.query("select reportar_entrega_panel($1)",[caso]);
    await db.exec("set role authenticated; set app.aal='2'; set app.rol='admin'; set app.cip='000000'");
    await programar();
    await db.exec("set app.rol='viewer'; set app.cip='222222'");
    assert.equal((await db.query("select * from control_entregas")).rows.length,0);
    await assert.rejects(reportar); await assert.rejects(programar);
    await db.exec("set app.cip='111111';set app.aal='1'");
    await assert.rejects(reportar);
    await db.exec("set app.aal='2'");
    await reportar();
    const primera=(await db.query("select reportada_at from control_entregas")).rows[0];
    await reportar();
    assert.deepEqual((await db.query("select reportada_at from control_entregas")).rows[0],primera);
    await assert.rejects(db.exec("update control_entregas set reportada_at=null"));
    await db.exec("reset role");
    assert.equal((await db.query("select * from recepciones_fisicas")).rows.length,0);
  } finally {await db.close();}
});
