-- Las 3 funciones de escritura (SECURITY DEFINER, corren con permisos
-- elevados) no verificaban que quien llama sea el oficial dueño del caso o
-- un admin -- cualquier usuario autenticado podía pasar cualquier p_nota_id
-- y modificar el caso de otro oficial. Se agrega el mismo criterio que ya
-- usa RLS para decidir quién puede ver cada nota.
create or replace function public.registrar_notificacion_imputacion(p_nota_id uuid, p_fecha date)
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
  set imputacion_generada_at = (p_fecha::text || 'T12:00:00.000Z')::timestamptz
  where id = p_nota_id;
end;
$$;

create or replace function public.registrar_descargo(p_nota_id uuid, p_fecha date, p_numero text, p_archivo_path text default null::text, p_archivo_nombre text default null::text)
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
  set fecha_descargo = p_fecha,
      numero_descargo = nullif(p_numero, ''),
      archivo_descargo_path = coalesce(p_archivo_path, archivo_descargo_path),
      archivo_descargo_nombre = coalesce(p_archivo_nombre, archivo_descargo_nombre)
  where id = p_nota_id;
end;
$$;

create or replace function public.registrar_sancion(p_nota_id uuid, p_tipo text, p_dias integer, p_analisis text, p_descargo_resumen text)
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
  set sancion_tipo = p_tipo,
      sancion_dias = p_dias,
      sancion_analisis = p_analisis,
      sancion_descargo_resumen = p_descargo_resumen,
      orden_sancion_generada_at = now()
  where id = p_nota_id;
end;
$$;
