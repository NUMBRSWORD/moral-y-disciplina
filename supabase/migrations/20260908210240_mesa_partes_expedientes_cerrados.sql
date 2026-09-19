-- Mesa de partes digital: recepcion de expedientes disciplinarios cerrados
-- (Orden de Sancion generada + notificada). El PDF firmado se guarda en un
-- bucket privado con una ruta logica automatica.
create table if not exists public.expedientes_remitidos (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null unique references public.notas_informativas(id) on delete cascade,
  investigado_nombre text not null,
  investigado_cip text,
  fecha_falta date not null,
  codigo_infraccion text,
  remitido_por uuid not null references auth.users(id),
  remitido_por_email text,
  remitido_por_cip text,
  remitido_at timestamptz not null default now(),
  archivo_path text not null,
  archivo_nombre text not null,
  carpeta_archivo text not null,
  estado text not null default 'remitido'
    check (estado in ('remitido', 'recibido', 'observado', 'archivado')),
  observacion text,
  recibido_por uuid references auth.users(id),
  recibido_at timestamptz,
  archivo_ht_path text,
  archivo_ht_nombre text,
  archivo_oficio_path text,
  archivo_oficio_nombre text,
  updated_at timestamptz not null default now()
);

alter table public.expedientes_remitidos enable row level security;

drop policy if exists "admin ve la recepcion" on public.expedientes_remitidos;
create policy "admin ve la recepcion"
  on public.expedientes_remitidos for select to authenticated
  using (public.es_admin());

drop policy if exists "admin registra expedientes cerrados" on public.expedientes_remitidos;
create policy "admin registra expedientes cerrados"
  on public.expedientes_remitidos for insert to authenticated
  with check (public.es_admin());

drop policy if exists "admin actualiza expedientes cerrados" on public.expedientes_remitidos;
create policy "admin actualiza expedientes cerrados"
  on public.expedientes_remitidos for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Bucket privado para los expedientes firmados, HT y oficios.
insert into storage.buckets (id, name, public)
values ('expedientes-terminados-pnp', 'expedientes-terminados-pnp', false)
on conflict (id) do nothing;

drop policy if exists "admin sube expedientes cerrados" on storage.objects;
create policy "admin sube expedientes cerrados"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'expedientes-terminados-pnp' and public.es_admin());

drop policy if exists "admin lee expedientes cerrados" on storage.objects;
create policy "admin lee expedientes cerrados"
  on storage.objects for select to authenticated
  using (bucket_id = 'expedientes-terminados-pnp' and public.es_admin());

drop policy if exists "admin borra expedientes cerrados" on storage.objects;
create policy "admin borra expedientes cerrados"
  on storage.objects for delete to authenticated
  using (bucket_id = 'expedientes-terminados-pnp' and public.es_admin());
