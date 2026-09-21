-- Storage por expediente y límites de archivo (auditoría 21-sep-2026, hallazgo A1).
--
-- Antes, la lectura de los buckets `notas` y `expedientes` solo exigía "estar
-- aprobado": cualquier oficial podía leer los archivos de TODOS los expedientes,
-- aunque la RLS de las tablas le mostrara solo los suyos. Probado con un oficial
-- real (transacción revertida): veía 364 de 364 archivos; con esta política ve 40,
-- exactamente los que suben él o pertenecen a sus expedientes; el administrador
-- sigue viendo los 364.

drop policy if exists "autenticados ven archivos de notas" on storage.objects;
create policy "ve archivos de sus notas o es admin" on storage.objects for select to authenticated
using (bucket_id = 'notas' and (
  public.es_admin()
  or owner_id = (select auth.uid())::text
  or exists (
    select 1 from public.notas_informativas n
    where n.oficial_constato_cip = public.cip_actual()
      and (name in (n.archivo_nota_path, n.archivo_reincorporacion_path, n.archivo_descargo_path, n.archivo_orden_notificacion_path)
           or n.seguimiento_faltas @> jsonb_build_array(jsonb_build_object('archivo_path', name)))
  )
  or exists (
    select 1 from public.documentos_generados d
    join public.notas_informativas n on n.id = d.nota_id
    where d.archivo_path = name and n.oficial_constato_cip = public.cip_actual()
  )
));

drop policy if exists "autenticados ven archivos de expedientes" on storage.objects;
create policy "ve archivos de sus expedientes o es admin" on storage.objects for select to authenticated
using (bucket_id = 'expedientes' and (
  public.es_admin()
  or owner_id = (select auth.uid())::text
  or exists (
    select 1 from public.expedientes e
    join public.notas_informativas n on n.id = e.nota_id
    where e.archivo_expediente_path = name and n.oficial_constato_cip = public.cip_actual()
  )
));

-- Bucket de la app hermana (notificaciones-pnp): cualquier aprobado podía BORRAR el
-- sustento de otros. Ahora solo quien lo subió o un administrador de cualquiera de
-- las dos apps. La lectura y la subida no cambian.
drop policy if exists "imputacion_pnp autenticados eliminan sustento" on storage.objects;
create policy "imputacion_pnp elimina su sustento o es admin" on storage.objects for delete to authenticated
using (bucket_id = 'casos-imputacion-pnp' and (
  owner_id = (select auth.uid())::text
  or public.es_admin()
  or imputacion_pnp.es_admin()
));

-- Límites por bucket (antes: sin tope de tamaño ni lista de tipos). Lo subido hasta
-- hoy son PDF, Word (.doc/.docx) de hasta 4,3 MB.
update storage.buckets set
  file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id in ('notas', 'expedientes');

update storage.buckets set
  file_size_limit = 20971520,
  allowed_mime_types = array['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'directivas';

update storage.buckets set
  file_size_limit = 52428800,
  allowed_mime_types = array['application/pdf', 'application/zip', 'application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'expedientes-terminados-pnp';
