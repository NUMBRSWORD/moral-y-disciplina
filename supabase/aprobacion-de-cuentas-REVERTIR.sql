-- Revierte supabase/aprobacion-de-cuentas.sql (solo si hace falta volver atrás).
-- Restaura las definiciones y reglas originales tal como estaban el 19/09/2026.
--
-- ADVERTENCIA: al borrar la tabla aceptaciones_terminos y las columnas profiles.estado /
-- profiles.cip se pierden las constancias de aceptación y las aprobaciones registradas.
-- Además, volver atrás DEJA ABIERTOS de nuevo los accesos que la migración cerró.

begin;

-- 1) Reglas: volver a las condiciones originales.
alter policy "directivas_select_authenticated" on public.directivas using (true);
alter policy "documentos_institucionales_select_authenticated" on public.documentos_institucionales using (true);
alter policy "firmas_documentos_select_authenticated" on public.firmas_documentos using (true);
alter policy "cada quien firma solo por si mismo" on public.firmas_documentos
  with check (firmante_id = (select auth.uid()));

-- Reglas de los depósitos de archivos. Si el editor de SQL las rechaza con
-- "must be owner of table objects", quitarlas de aquí y editarlas desde
-- Storage -> Policies (ver aprobacion-de-cuentas-PARTE2-storage.md). Deben revertirse
-- ANTES del paso 3, porque allí se borra la función esta_aprobado().
alter policy "autenticados ven archivos de notas" on storage.objects using (bucket_id = 'notas');
alter policy "autenticados suben archivos de notas" on storage.objects with check (bucket_id = 'notas');
alter policy "autenticados ven archivos de expedientes" on storage.objects using (bucket_id = 'expedientes');
alter policy "directivas_storage_select_authenticated" on storage.objects using (bucket_id = 'directivas');
alter policy "imputacion_pnp autenticados leen sustento" on storage.objects using (bucket_id = 'casos-imputacion-pnp');
alter policy "imputacion_pnp autenticados suben sustento" on storage.objects with check (bucket_id = 'casos-imputacion-pnp');
alter policy "imputacion_pnp autenticados eliminan sustento" on storage.objects using (bucket_id = 'casos-imputacion-pnp');

-- 2) Funciones originales.
create or replace function public.cip_actual()
returns text language sql stable security definer set search_path to 'public'
as $$
  select split_part(email, '@', 1) from auth.users where id = auth.uid();
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'viewer');
  return new;
end;
$$;

drop function if exists public.esta_aprobado();

-- 3) Tabla y columnas nuevas.
drop table if exists public.aceptaciones_terminos;
drop index if exists public.profiles_cip_unico;
alter table public.profiles drop column if exists estado, drop column if exists cip;

commit;
