-- Aprobación de cuentas + cierre de accesos abiertos a "cualquier cuenta con sesión".
--
-- APLICADA el 19/09/2026 en el proyecto tndjulaitywtoocqeeiy (MORAL Y DISCIPLINA),
-- como migración `aprobacion_de_cuentas_parte1`. Este archivo queda como referencia.
--
-- También se aplicaron:
--   - `aprobacion_de_cuentas_parte2_storage`: las 7 reglas de los depósitos de archivos
--     (ver aprobacion-de-cuentas-PARTE2-storage.md).
--   - `esta_aprobado_revoke_anon`: quita EXECUTE a `anon` sobre esta_aprobado(). Los
--     permisos por defecto del esquema public se lo habían otorgado, a diferencia de
--     es_admin() y cip_actual(). Sin esto aparecía el advisor 0028.
--
-- Qué corrige (hallado el 19/09/2026 revisando el proyecto tndjulaitywtoocqeeiy):
--   1. El registro está abierto (auth disable_signup = false): cualquier persona con
--      un correo real puede crearse una cuenta.
--   2. public.cip_actual() toma el CIP de lo que va antes de la @ SIN mirar el
--      dominio. Quien se registre como 400003@otrodominio.com se vería como el CIP
--      400003 y leería las notas, expedientes y ficha de ese oficial.
--   3. Estas reglas dejan leer a cualquier cuenta con sesión, sin más condición:
--      tablas directivas, documentos_institucionales y firmas_documentos; y los
--      depósitos de archivos notas, expedientes, directivas y casos-imputacion-pnp
--      (este último también permite subir y borrar).
--
-- Resultado: una cuenta nueva (por ejemplo, creada con Google) nace "pendiente" y no
-- ve nada hasta que un administrador la apruebe (profiles.estado = 'aprobado') y, si
-- corresponde, le asigne su CIP (profiles.cip). Las cuentas que ya existen quedan
-- aprobadas, así que nadie pierde el acceso.
--
-- Cómo aprobar una cuenta después (SQL Editor o Table Editor -> profiles):
--   update public.profiles set estado = 'aprobado', cip = '12345678'
--   where email = 'persona@gmail.com';
-- Para rechazar: estado = 'rechazado'.
--
-- Pendiente aparte (no lo cubre este archivo): las funciones de servidor de IA
-- (asistente-md, extraer-nota-informativa, extraer-texto-vision, generar-resumen-casos,
-- redactar-analisis, revisar-documento-ia) solo comprueban que exista una sesión; una
-- cuenta pendiente todavía podría invocarlas y consumir la cuota de IA. Deben validar
-- public.esta_aprobado() dentro de la función.

begin;

-- 1) Estado de aprobación y CIP asignado. Las filas que ya existen quedan 'aprobado'.
alter table public.profiles
  add column if not exists estado text not null default 'aprobado'
    check (estado in ('pendiente', 'aprobado', 'rechazado')),
  add column if not exists cip text;

-- A partir de ahora, toda cuenta nueva nace pendiente (salvo las internas de abajo).
alter table public.profiles alter column estado set default 'pendiente';

create unique index if not exists profiles_cip_unico
  on public.profiles (cip) where cip is not null;

-- 2) Cuentas nuevas. Solo entran aprobadas las que crea un administrador con el
--    dominio interno y con el correo ya confirmado ("Auto Confirm User").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email, role, estado)
  values (
    new.id,
    new.email,
    'viewer',
    case
      when new.email_confirmed_at is not null
       and lower(split_part(new.email, '@', 2)) = 'moralydisciplina.local'
      then 'aprobado'
      else 'pendiente'
    end
  );
  return new;
end;
$$;

-- 3) ¿La cuenta actual está aprobada?
create or replace function public.esta_aprobado()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and estado = 'aprobado'
  );
$$;

revoke execute on function public.esta_aprobado() from public;
grant execute on function public.esta_aprobado() to authenticated;

-- 4) es_admin(): además de rol admin, la cuenta debe estar aprobada.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and estado = 'aprobado'
  );
$$;

-- 5) cip_actual(): solo cuentas aprobadas. Si el administrador asignó un CIP, se usa ese;
--    si es una cuenta interna confirmada, el prefijo del correo (como hasta hoy);
--    cualquier otra cuenta no tiene CIP.
create or replace function public.cip_actual()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p.estado <> 'aprobado' then null
    when p.cip is not null then p.cip
    when u.email_confirmed_at is not null
     and lower(split_part(u.email, '@', 2)) = 'moralydisciplina.local'
      then split_part(u.email, '@', 1)
    else null
  end
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = auth.uid();
$$;

-- 6) Lecturas y escrituras que hoy están abiertas a cualquier sesión: exigir aprobación.
alter policy "directivas_select_authenticated"
  on public.directivas
  using (public.esta_aprobado());

alter policy "documentos_institucionales_select_authenticated"
  on public.documentos_institucionales
  using (public.esta_aprobado());

alter policy "firmas_documentos_select_authenticated"
  on public.firmas_documentos
  using (public.esta_aprobado());

alter policy "cada quien firma solo por si mismo"
  on public.firmas_documentos
  with check (firmante_id = (select auth.uid()) and public.esta_aprobado());

-- Las reglas de storage.objects (depósitos notas, expedientes, directivas y
-- casos-imputacion-pnp) se aplicaron aparte, en la migración
-- `aprobacion_de_cuentas_parte2_storage`. Se separaron porque esa tabla pertenece a
-- supabase_storage_admin y no siempre se deja modificar desde el editor de SQL; si van
-- en esta misma transacción y fallan, cancelarían todo lo demás.
-- Ver aprobacion-de-cuentas-PARTE2-storage.md.

-- 7) Constancia de que la persona aceptó los términos y el tratamiento de sus datos.
create table if not exists public.aceptaciones_terminos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  version text not null,
  aceptado_at timestamptz not null default now(),
  unique (user_id, version)
);

alter table public.aceptaciones_terminos enable row level security;

create policy "usuario registra su propia aceptacion"
  on public.aceptaciones_terminos for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "usuario ve su aceptacion o el admin ve todas"
  on public.aceptaciones_terminos for select to authenticated
  using (user_id = (select auth.uid()) or public.es_admin());

grant select, insert on public.aceptaciones_terminos to authenticated;

commit;
