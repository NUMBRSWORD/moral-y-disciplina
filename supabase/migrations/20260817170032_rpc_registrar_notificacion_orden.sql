-- Mismo patrón de autorización que las otras 3 RPCs de escritura: admin o
-- el oficial dueño del caso (por oficial_constato_cip).
create or replace function public.registrar_notificacion_orden(
  p_nota_id uuid, p_fecha date, p_archivo_path text, p_archivo_nombre text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (
    es_admin()
    or exists (
      select 1 from public.notas_informativas
      where id = p_nota_id and oficial_constato_cip = public.cip_actual()
    )
  ) then
    raise exception 'No autorizado para modificar esta nota.';
  end if;

  update public.notas_informativas
  set orden_notificada_at = (p_fecha::text || 'T12:00:00.000Z')::timestamptz,
      archivo_orden_notificacion_path = p_archivo_path,
      archivo_orden_notificacion_nombre = p_archivo_nombre
  where id = p_nota_id;
end;
$$;
