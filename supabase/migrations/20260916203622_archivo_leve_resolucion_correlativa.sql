-- Numeración correlativa y única para la Resolución del Archivo del
-- Procedimiento (Anexo IV), sin importar qué oficial la genere. Tabla
-- genérica por tipo+año para poder reusarla con el Oficio a futuro.
create table if not exists public.contadores_documentos (
  tipo text not null,
  anio integer not null,
  ultimo integer not null default 0,
  primary key (tipo, anio)
);
alter table public.contadores_documentos enable row level security;
-- Sin políticas: solo se toca desde funciones SECURITY DEFINER.

create or replace function public.siguiente_correlativo(p_tipo text, p_anio integer)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  insert into public.contadores_documentos (tipo, anio, ultimo)
  values (p_tipo, p_anio, 1)
  on conflict (tipo, anio) do update set ultimo = contadores_documentos.ultimo + 1
  returning ultimo;
$$;
revoke execute on function public.siguiente_correlativo(text, integer) from public;

-- Reserva (o devuelve la ya reservada) el N.º de Resolución del Archivo del
-- Procedimiento para una nota. Idempotente: si ya tiene número asignado
-- (por ejemplo, un intento anterior que no llegó a completarse), devuelve
-- el mismo -- nunca consume un correlativo nuevo para el mismo caso.
create or replace function public.reservar_resolucion_archivo_leve(p_nota_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existente text;
  v_anio integer := extract(year from now())::integer;
  v_correlativo integer;
  v_numero text;
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

  select archivo_leve_resolucion_numero into v_existente
  from public.notas_informativas where id = p_nota_id;

  if v_existente is not null and v_existente <> '' then
    return v_existente;
  end if;

  v_correlativo := public.siguiente_correlativo('archivo_leve', v_anio);
  v_numero := 'N° ' || lpad(v_correlativo::text, 3, '0') || '-' || v_anio || '-DIVOPUS VENTANILLA-COM.VENTANILLA';

  update public.notas_informativas
  set archivo_leve_resolucion_numero = v_numero
  where id = p_nota_id;

  return v_numero;
end;
$$;
revoke execute on function public.reservar_resolucion_archivo_leve(uuid) from public;
grant execute on function public.reservar_resolucion_archivo_leve(uuid) to authenticated;

-- registrar_archivo_leve ya no recibe el número: lo toma el que ya haya
-- quedado reservado (falla claro si por algún motivo no hay ninguno).
drop function if exists public.registrar_archivo_leve(uuid, text, text);
create or replace function public.registrar_archivo_leve(p_nota_id uuid, p_motivo text)
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

  if (select archivo_leve_resolucion_numero from public.notas_informativas where id = p_nota_id) is null then
    raise exception 'Debe reservarse el número de Resolución antes de registrar el Archivo.';
  end if;

  update public.notas_informativas
  set archivo_leve_motivo = p_motivo,
      archivo_leve_generada_at = now()
  where id = p_nota_id;
end;
$$;
revoke execute on function public.registrar_archivo_leve(uuid, text) from public;
grant execute on function public.registrar_archivo_leve(uuid, text) to authenticated;
