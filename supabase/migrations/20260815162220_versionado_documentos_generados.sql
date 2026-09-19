-- Cada vez que se genera Imputación / Acta de No Descargo / Orden de
-- Sanción, además de descargarse queda archivada en Storage y registrada
-- aquí -- antes, regenerar un documento simplemente perdía la versión
-- anterior (solo quedaba una fecha "generado el...", nunca el archivo).
create table public.documentos_generados (
  id uuid primary key default gen_random_uuid(),
  nota_id uuid not null references public.notas_informativas(id) on delete cascade,
  tipo text not null check (tipo in ('imputacion', 'acta_no_descargo', 'orden_sancion')),
  archivo_path text not null,
  archivo_nombre text not null,
  generado_por uuid references auth.users(id),
  generado_por_email text,
  generado_at timestamptz not null default now()
);

create index documentos_generados_nota_idx on public.documentos_generados (nota_id, generado_at desc);

alter table public.documentos_generados enable row level security;

create policy "ve versiones de sus notas o es admin"
  on public.documentos_generados for select
  to authenticated
  using (
    es_admin()
    or exists (
      select 1 from public.notas_informativas n
      where n.id = documentos_generados.nota_id
        and n.oficial_constato_cip = public.cip_actual()
    )
  );

-- Solo inserta (nunca edita ni borra) quien puede ver la nota -- así queda
-- una traza de versiones que nadie puede alterar después desde la API.
create policy "registra versiones de sus notas o es admin"
  on public.documentos_generados for insert
  to authenticated
  with check (
    es_admin()
    or exists (
      select 1 from public.notas_informativas n
      where n.id = documentos_generados.nota_id
        and n.oficial_constato_cip = public.cip_actual()
    )
  );
