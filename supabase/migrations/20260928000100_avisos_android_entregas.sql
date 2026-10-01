-- Aditiva. Aplicar antes de desplegar la función avisos-android auditada.
begin;
create table if not exists public.entregas_android (
  clave text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  intento_id uuid not null,
  reservado_hasta timestamptz not null,
  enviado_at timestamptz,
  check (clave ~ '^[a-f0-9]{64}$')
);
alter table public.entregas_android enable row level security;
revoke all on public.entregas_android from public, anon, authenticated;
grant all on public.entregas_android to service_role;

create or replace function public.reservar_entrega_android(p_clave text, p_usuario uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare intento uuid := gen_random_uuid(); obtenido uuid;
begin
  insert into public.entregas_android(clave,user_id,intento_id,reservado_hasta)
    values(p_clave,p_usuario,intento,now()+interval '2 minutes')
  on conflict(clave) do update set intento_id=excluded.intento_id,
    reservado_hasta=excluded.reservado_hasta
    where entregas_android.enviado_at is null and entregas_android.reservado_hasta < now()
  returning intento_id into obtenido;
  if obtenido is null then return jsonb_build_object('reservada',false); end if;
  return jsonb_build_object('reservada',true,'intento_id',obtenido);
end $$;
revoke all on function public.reservar_entrega_android(text,uuid) from public, anon, authenticated;
grant execute on function public.reservar_entrega_android(text,uuid) to service_role;
commit;
