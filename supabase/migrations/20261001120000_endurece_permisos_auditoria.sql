-- Auditoría 01/10/2026. Segunda barrera además de RLS; no cambia lo que ve cada cuenta.
-- 1) Sin sesión (anon) no tiene ninguna política en public: se quitan también los permisos.
-- 2) Nadie de la API necesita TRUNCATE, REFERENCES ni TRIGGER (TRUNCATE no respeta RLS).
-- 3) Funciones del esquema imputacion_pnp expuestas sin necesidad.
-- 4) Índices de llaves foráneas que faltaban.
-- Reversión: supabase/endurece-permisos-REVERTIR.sql
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') loop
    execute format('revoke all on public.%I from anon', t.relname);
    execute format('revoke truncate, references, trigger on public.%I from authenticated', t.relname);
  end loop;
end $$;

revoke execute on function imputacion_pnp.es_admin() from public, anon;
grant execute on function imputacion_pnp.es_admin() to authenticated;
-- Función de trigger sobre auth.users: el trigger se ejecuta igual sin EXECUTE de la API.
revoke execute on function imputacion_pnp.handle_new_user() from public, anon, authenticated;
alter function imputacion_pnp.set_updated_at() set search_path = '';

create index if not exists ix_entregas_android_user_id on public.entregas_android (user_id);
create index if not exists ix_documentos_institucionales_updated_by on public.documentos_institucionales (updated_by);
create index if not exists ix_solicitudes_eliminacion_atendida_por on public.solicitudes_eliminacion (atendida_por);
