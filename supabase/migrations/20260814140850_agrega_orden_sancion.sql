alter table notas_informativas
  add column if not exists sancion_tipo text,
  add column if not exists sancion_dias integer,
  add column if not exists sancion_analisis text,
  add column if not exists sancion_descargo_resumen text,
  add column if not exists orden_sancion_generada_at timestamptz;

create or replace function registrar_sancion(
  p_nota_id uuid,
  p_tipo text,
  p_dias integer,
  p_analisis text,
  p_descargo_resumen text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update notas_informativas
  set sancion_tipo = p_tipo,
      sancion_dias = p_dias,
      sancion_analisis = p_analisis,
      sancion_descargo_resumen = p_descargo_resumen,
      orden_sancion_generada_at = now()
  where id = p_nota_id;
end;
$$;

grant execute on function registrar_sancion(uuid, text, integer, text, text) to authenticated;
