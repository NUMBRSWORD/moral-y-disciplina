-- Al quitar un descargo registrado por error, el "Analisis y evaluacion"
-- que se hubiera redactado (a mano o con IA) estaba basado en ese descargo
-- equivocado, asi que tambien se limpia para que el oficial lo rehaga.
create or replace function public.quitar_descargo(p_nota_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  set fecha_descargo = null,
      numero_descargo = null,
      archivo_descargo_path = null,
      archivo_descargo_nombre = null,
      sancion_descargo_resumen = null,
      sancion_analisis = null
  where id = p_nota_id;
end;
$function$;
