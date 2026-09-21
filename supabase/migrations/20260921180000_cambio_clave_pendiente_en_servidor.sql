-- Cambio de clave exigido EN EL SERVIDOR (auditoría 21-sep-2026, hallazgo C1).
--
-- Antes, "cambiar la clave inicial" era solo una ventana del navegador: quien
-- llamaba a la API directamente obtenía una sesión con datos sin pasar por ella.
-- Ahora una cuenta con un cambio pendiente NO tiene acceso a nada: es_admin(),
-- esta_aprobado() y cip_actual() (que usan todas las políticas RLS y las de
-- Storage) devuelven falso/nulo hasta que la clave cambie de verdad.
--
-- Una cuenta queda pendiente de dos maneras:
--   1. exigir_cambio_si_clave_inicial(): el navegador la llama tras cada ingreso
--      con clave; si la clave es igual al usuario (el CIP), se marca sola.
--   2. Manualmente (por ejemplo tras entregar una clave temporal): insertar la fila
--      en cambios_clave_pendientes con el hash vigente.
-- Se levanta con confirmar_cambio_clave(), que comprueba en el servidor que el hash
-- cambió y que la clave nueva ya no es el CIP.

create table if not exists public.cambios_clave_pendientes (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  hash_al_marcar text not null,
  marcado_at     timestamptz not null default now()
);
alter table public.cambios_clave_pendientes enable row level security;
revoke all on public.cambios_clave_pendientes from anon, authenticated;
comment on table public.cambios_clave_pendientes is
  'Cuentas que deben cambiar su clave antes de operar. Sin políticas RLS: solo la leen las funciones SECURITY DEFINER. hash_al_marcar permite comprobar que la clave realmente cambió.';

create or replace function public.necesita_cambiar_clave()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.cambios_clave_pendientes where user_id = auth.uid());
$$;

create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and estado = 'aprobado'
  ) and not public.necesita_cambiar_clave();
$$;

create or replace function public.esta_aprobado()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and estado = 'aprobado'
  ) and not public.necesita_cambiar_clave();
$$;

create or replace function public.cip_actual()
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select case
    when p.estado <> 'aprobado' then null
    when public.necesita_cambiar_clave() then null
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

create or replace function public.exigir_cambio_si_clave_inicial()
returns boolean
language plpgsql security definer
set search_path to 'public', 'auth', 'extensions'
as $$
declare
  v_email text;
  v_hash  text;
begin
  select email, encrypted_password into v_email, v_hash from auth.users where id = auth.uid();
  if v_email is null or v_hash is null then return false; end if;
  if extensions.crypt(split_part(v_email, '@', 1), v_hash) = v_hash then
    insert into public.cambios_clave_pendientes (user_id, hash_al_marcar)
    values (auth.uid(), v_hash)
    on conflict (user_id) do update set hash_al_marcar = excluded.hash_al_marcar, marcado_at = now();
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.confirmar_cambio_clave()
returns boolean
language plpgsql security definer
set search_path to 'public', 'auth', 'extensions'
as $$
declare
  v_marca text;
  v_email text;
  v_hash  text;
begin
  select hash_al_marcar into v_marca from public.cambios_clave_pendientes where user_id = auth.uid();
  if v_marca is null then return true; end if;  -- no había nada pendiente
  select email, encrypted_password into v_email, v_hash from auth.users where id = auth.uid();
  if v_hash is null or v_hash = v_marca then return false; end if;  -- la clave no cambió
  if extensions.crypt(split_part(v_email, '@', 1), v_hash) = v_hash then return false; end if;  -- sigue siendo el CIP
  delete from public.cambios_clave_pendientes where user_id = auth.uid();
  return true;
end;
$$;

revoke all on function public.necesita_cambiar_clave()          from public, anon;
revoke all on function public.exigir_cambio_si_clave_inicial()  from public, anon;
revoke all on function public.confirmar_cambio_clave()          from public, anon;
grant execute on function public.necesita_cambiar_clave()         to authenticated;
grant execute on function public.exigir_cambio_si_clave_inicial() to authenticated;
grant execute on function public.confirmar_cambio_clave()         to authenticated;
-- es_admin / esta_aprobado / cip_actual conservan sus permisos: CREATE OR REPLACE no los cambia.
