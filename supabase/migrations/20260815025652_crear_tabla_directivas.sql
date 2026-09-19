-- Base de conocimiento de directivas internas de la PNP, para que la IA de
-- redacción/análisis (Orden de Sanción, asistente flotante) se base en texto
-- real proporcionado por el admin, en vez de inventar requisitos
-- institucionales (p. ej. requisitos para que un descanso médico particular
-- sea "exonerante").
create table public.directivas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  numero_documento text,
  contenido text not null,
  archivo_path text,
  archivo_nombre text,
  activa boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.directivas enable row level security;

-- Mismo patrón de RLS que el resto del esquema public: lectura abierta a
-- cualquier usuario autenticado, escritura solo para admin (es_admin()).
create policy "directivas_select_authenticated"
  on public.directivas for select
  to authenticated
  using (true);

create policy "directivas_insert_admin"
  on public.directivas for insert
  to authenticated
  with check (es_admin());

create policy "directivas_update_admin"
  on public.directivas for update
  to authenticated
  using (es_admin())
  with check (es_admin());

create policy "directivas_delete_admin"
  on public.directivas for delete
  to authenticated
  using (es_admin());

-- Bucket de almacenamiento para el archivo opcional (PDF/imagen) de cada
-- directiva, igual de privado que "notas" y "expedientes" (solo accesible
-- mediante URLs firmadas generadas desde el cliente autenticado).
insert into storage.buckets (id, name, public)
values ('directivas', 'directivas', false)
on conflict (id) do nothing;

create policy "directivas_storage_select_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'directivas');

create policy "directivas_storage_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'directivas' and es_admin());

create policy "directivas_storage_update_admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'directivas' and es_admin())
  with check (bucket_id = 'directivas' and es_admin());

create policy "directivas_storage_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'directivas' and es_admin());
