-- Control de uso de las funciones de IA (auditoría 21-sep-2026, hallazgo A3).
--
-- Antes las Edge Functions solo comprobaban que el token perteneciera a ALGÚN usuario
-- (auth.getUser): con el ingreso por Google, cualquier persona con una cuenta obtiene
-- sesión y podía gastar la cuenta de IA, sin tope alguno. Ahora cada llamada pasa por
-- autorizar_uso_ia(), que (1) exige un usuario APROBADO y sin cambio de clave pendiente
-- (esta_aprobado) y (2) cuenta las llamadas del día (hora de Lima) por persona y corta
-- al pasar el límite.

create table if not exists public.uso_ia (
  user_id   uuid    not null references auth.users(id) on delete cascade,
  dia       date    not null,
  llamadas  integer not null default 0,
  primary key (user_id, dia)
);
alter table public.uso_ia enable row level security;
revoke all on public.uso_ia from anon, authenticated;
comment on table public.uso_ia is 'Llamadas diarias a las funciones de IA por usuario (hora de Lima). Sin políticas RLS: solo la función SECURITY DEFINER autorizar_uso_ia() la usa.';

create or replace function public.autorizar_uso_ia(p_limite integer default 300)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_dia date := (now() at time zone 'America/Lima')::date;
  v_n   integer;
begin
  if auth.uid() is null or not public.esta_aprobado() then
    return 'no_aprobado';
  end if;
  delete from public.uso_ia where dia < v_dia - 30;
  insert into public.uso_ia (user_id, dia, llamadas) values (auth.uid(), v_dia, 1)
  on conflict (user_id, dia) do update set llamadas = public.uso_ia.llamadas + 1
  returning llamadas into v_n;
  if v_n > p_limite then return 'cuota'; end if;
  return 'ok';
end;
$$;

revoke all on function public.autorizar_uso_ia(integer) from public, anon;
grant execute on function public.autorizar_uso_ia(integer) to authenticated;
