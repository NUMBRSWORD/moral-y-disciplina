-- Archivo de expedientes: un folder manila por caso, rotulado con el N.º de su
-- oficio de remisión (o de su Resolución de archivo si se archivó sin sanción),
-- y un legajo PDF único en el sistema con el mismo código.
-- Aditiva e idempotente. Solo administradores; no se borra desde la API.
-- Reversión: supabase/archivo-expedientes-REVERTIR.sql

begin;

create table if not exists public.archivo_expedientes (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null unique references public.notas_informativas(id) on delete restrict,
  codigo text not null unique check (codigo ~ '^(OF|RES) [0-9]{3,4}-20[0-9]{2}$'),
  ubicacion text check (ubicacion is null or length(ubicacion) <= 200),
  folios integer not null check (folios > 0 and folios < 10000),
  legajo_path text not null check (legajo_path like 'archivo/%'),
  legajo_nombre text,
  legajo_sha256 text not null check (legajo_sha256 ~ '^[0-9a-f]{64}$'),
  observacion text check (observacion is null or length(observacion) <= 1000),
  archivado_por uuid not null default auth.uid() references auth.users(id),
  archivado_at timestamptz not null default now()
);
comment on table public.archivo_expedientes is
  'Un folder manila por caso. codigo = N.º de oficio (OF 045-2026) o de Resolución de archivo (RES 012-2026).';

create index if not exists ix_archivo_expedientes_archivado_por on public.archivo_expedientes (archivado_por);

alter table public.archivo_expedientes enable row level security;
revoke all on public.archivo_expedientes from public, anon, authenticated;
grant select, insert on public.archivo_expedientes to authenticated;
-- Solo se corrige dónde está el folder y cuántos folios tiene; el código y el
-- legajo no cambian una vez archivado.
grant update (ubicacion, folios, observacion) on public.archivo_expedientes to authenticated;

drop policy if exists "admin ve el archivo" on public.archivo_expedientes;
create policy "admin ve el archivo" on public.archivo_expedientes
  for select to authenticated using ((select public.es_admin()));

drop policy if exists "admin archiva" on public.archivo_expedientes;
create policy "admin archiva" on public.archivo_expedientes
  for insert to authenticated
  with check ((select public.es_admin()) and archivado_por = (select auth.uid()));

drop policy if exists "admin corrige ubicacion" on public.archivo_expedientes;
create policy "admin corrige ubicacion" on public.archivo_expedientes
  for update to authenticated
  using ((select public.es_admin())) with check ((select public.es_admin()));

-- Mismo historial de actividad que el resto de tablas, si existe.
do $$
begin
  if to_regprocedure('public.fn_audit_log()') is not null
     and not exists (select 1 from pg_trigger where tgname = 'audit_archivo_expedientes') then
    create trigger audit_archivo_expedientes
      after insert or update or delete on public.archivo_expedientes
      for each row execute function public.fn_audit_log();
  end if;
end $$;

commit;
