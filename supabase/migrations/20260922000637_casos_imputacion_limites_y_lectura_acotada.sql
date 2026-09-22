-- Completa el hallazgo A1 de la auditoria del 21-sep-2026. Esa ronda acoto por
-- expediente y puso limites a los depositos notas, expedientes y directivas, pero dejo
-- fuera casos-imputacion-pnp: seguia legible por cualquier cuenta aprobada y sin
-- limite de tamano ni de tipo de archivo.
--
-- Es un deposito del modulo antiguo de imputacion (4 PDF, sin uso desde el 15-ago),
-- pero cualquier cuenta aprobada podia leer sus archivos o subir ahi archivos de
-- cualquier tamano. Los 4 archivos tienen dueno registrado, asi que acotar la lectura
-- al dueno y al administrador no deja a nadie sin acceso a lo suyo.

-- Mismos limites que los demas depositos de documentos (20 MB; PDF, Word e imagen).
update storage.buckets
   set file_size_limit = 20971520,
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'
       ]
 where id = 'casos-imputacion-pnp';

-- Lectura: solo el dueno del archivo o un administrador (igual que ya exige el borrado).
alter policy "imputacion_pnp autenticados leen sustento"
  on storage.objects
  using (
    bucket_id = 'casos-imputacion-pnp'
    and (
      owner_id = (select auth.uid())::text
      or public.es_admin()
      or imputacion_pnp.es_admin()
    )
  );
