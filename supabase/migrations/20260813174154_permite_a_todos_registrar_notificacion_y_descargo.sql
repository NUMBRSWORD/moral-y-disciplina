-- Funciones con privilegios elevados (SECURITY DEFINER) para que cualquier
-- usuario autenticado (no solo admin) pueda registrar la fecha de
-- notificación de la Imputación y el descargo recibido, sin abrir el resto
-- de la edición de la nota (código de infracción, reincorporación, etc.)
-- que sigue siendo solo para admin.

create or replace function public.registrar_notificacion_imputacion(p_nota_id uuid, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notas_informativas
  set imputacion_generada_at = (p_fecha::text || 'T12:00:00.000Z')::timestamptz
  where id = p_nota_id;
end;
$$;

grant execute on function public.registrar_notificacion_imputacion(uuid, date) to authenticated;

create or replace function public.registrar_descargo(
  p_nota_id uuid,
  p_fecha date,
  p_numero text,
  p_archivo_path text default null,
  p_archivo_nombre text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notas_informativas
  set fecha_descargo = p_fecha,
      numero_descargo = nullif(p_numero, ''),
      archivo_descargo_path = coalesce(p_archivo_path, archivo_descargo_path),
      archivo_descargo_nombre = coalesce(p_archivo_nombre, archivo_descargo_nombre)
  where id = p_nota_id;
end;
$$;

grant execute on function public.registrar_descargo(uuid, date, text, text, text) to authenticated;

-- Para que el archivo del descargo se pueda adjuntar aunque quien lo suba
-- no sea admin.
drop policy if exists "solo admin sube archivos de notas" on storage.objects;
create policy "autenticados suben archivos de notas"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'notas');
