-- Biblioteca de roles de servicio por día. El admin sube el PDF de cada día;
-- al registrar una falta, la app toma el rol de esa fecha para determinar el
-- puesto del investigado (sin volver a subir el archivo cada vez).
create table if not exists public.roles_servicio (
  id uuid primary key default gen_random_uuid(),
  fecha date not null unique,
  fecha_fin date,
  archivo_path text not null,
  archivo_nombre text,
  texto_extraido text,
  subido_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_roles_servicio_fecha on public.roles_servicio (fecha);
create index if not exists ix_roles_servicio_subido_por on public.roles_servicio (subido_por);

alter table public.roles_servicio enable row level security;

create policy "solo admin ve los roles de servicio" on public.roles_servicio
  for select to authenticated using ( public.es_admin() );
create policy "solo admin sube roles de servicio" on public.roles_servicio
  for insert to authenticated with check ( public.es_admin() );
create policy "solo admin edita roles de servicio" on public.roles_servicio
  for update to authenticated using ( public.es_admin() ) with check ( public.es_admin() );
create policy "solo admin borra roles de servicio" on public.roles_servicio
  for delete to authenticated using ( public.es_admin() );
