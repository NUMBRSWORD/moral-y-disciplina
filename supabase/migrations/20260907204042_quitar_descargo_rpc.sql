-- Permite deshacer un descargo registrado por error (p. ej. se subio el
-- archivo de otro efectivo). Misma regla de acceso que registrar_descargo:
-- el oficial que constato la falta, o un admin.
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
      sancion_descargo_resumen = null
  where id = p_nota_id;
end;
$function$;

grant execute on function public.quitar_descargo(uuid) to authenticated;
