-- APLICADA el 19/09/2026 en el proyecto tndjulaitywtoocqeeiy (MORAL Y DISCIPLINA),
-- como migraciones `solicitudes_de_acceso` y `permisos_minimos_tablas_nuevas`.
-- Este archivo queda como referencia de lo que quedó en la base.
--
-- Qué resuelve: hasta ahora una cuenta nueva de Google solo aportaba un correo, así que
-- el administrador no tenía con qué verificar a quién estaba aprobando. Con esto, la
-- persona enlaza su cuenta de Google y declara grado, apellidos, nombres, CIP, DNI y
-- teléfono. Eso es su solicitud.
--
-- Por qué en tabla aparte y no en `profiles`: si el solicitante pudiera escribir en
-- `profiles`, podría intentar cambiar su propio `role` o `estado` y autoaprobarse.
-- Aquí solo escribe en `solicitudes_acceso`; `profiles` lo cambia únicamente la función
-- `aprobar_solicitud()`, que exige ser administrador.

create table if not exists public.solicitudes_acceso (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  grado text not null,
  apellidos text not null,
  nombres text not null,
  cip text not null check (cip ~ '^\d{4,12}$'),
  dni text not null check (dni ~ '^\d{8}$'),
  telefono text not null check (telefono ~ '^\d{9}$'),
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

alter table public.solicitudes_acceso enable row level security;

create policy "solicitante registra su solicitud"
  on public.solicitudes_acceso for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "ve su solicitud o el admin ve todas"
  on public.solicitudes_acceso for select to authenticated
  using (user_id = (select auth.uid()) or public.es_admin());

create policy "corrige su solicitud mientras este pendiente"
  on public.solicitudes_acceso for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.estado = 'pendiente'
    )
  )
  with check (user_id = (select auth.uid()));

-- Permisos mínimos: los valores por defecto del esquema public otorgaban TODO
-- (incluido DELETE y TRUNCATE) a anon y a authenticated.
revoke all on public.solicitudes_acceso from anon;
revoke all on public.aceptaciones_terminos from anon;
revoke all on public.solicitudes_acceso from authenticated;
revoke all on public.aceptaciones_terminos from authenticated;
grant select, insert, update on public.solicitudes_acceso to authenticated;
grant select, insert on public.aceptaciones_terminos to authenticated;

create or replace function public.aprobar_solicitud(p_user_id uuid, p_rol text default 'viewer')
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cip text;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede aprobar solicitudes';
  end if;
  if p_rol not in ('admin', 'viewer') then
    raise exception 'Rol no valido: %', p_rol;
  end if;
  select cip into v_cip from public.solicitudes_acceso where user_id = p_user_id;
  if v_cip is null then
    raise exception 'No existe solicitud para esa cuenta';
  end if;
  update public.profiles
     set estado = 'aprobado', role = p_rol, cip = v_cip
   where id = p_user_id;
end;
$$;

create or replace function public.rechazar_solicitud(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede rechazar solicitudes';
  end if;
  update public.profiles set estado = 'rechazado' where id = p_user_id;
end;
$$;

revoke execute on function public.aprobar_solicitud(uuid, text) from public, anon;
revoke execute on function public.rechazar_solicitud(uuid) from public, anon;
grant execute on function public.aprobar_solicitud(uuid, text) to authenticated;
grant execute on function public.rechazar_solicitud(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- USO DIARIO
--
-- Ver las solicitudes pendientes:
--
--   select s.creado_at, s.grado, s.apellidos, s.nombres, s.cip, s.dni, s.telefono, s.email
--     from public.solicitudes_acceso s
--     join public.profiles p on p.id = s.user_id
--    where p.estado = 'pendiente'
--    order by s.creado_at;
--
-- Aprobar (desde una sesión de administrador):
--
--   select public.aprobar_solicitud('<user_id>', 'viewer');   -- o 'admin'
--
-- Rechazar:
--
--   select public.rechazar_solicitud('<user_id>');
--
-- PENDIENTE: no hay pantalla de administrador para esto todavía. Hoy se hace por SQL.
-- Lo natural es añadir esa lista a la pestaña Efectivos de la aplicación web.
