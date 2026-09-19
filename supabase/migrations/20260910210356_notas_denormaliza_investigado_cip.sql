-- Guarda el CIP/DNI del investigado en la propia nota, para que la Orden de
-- Sanción se pueda generar sin consultar el padrón completo de efectivos
-- (que ahora solo ve el admin). Backfill por coincidencia exacta de nombre.
alter table public.notas_informativas
  add column if not exists investigado_cip text,
  add column if not exists investigado_dni text;

update public.notas_informativas n
set investigado_cip = e.cip,
    investigado_dni = e.dni
from public.efectivos e
where n.investigado_cip is null
  and upper(regexp_replace(trim(coalesce(n.apellidos,'') || ' ' || coalesce(n.nombres,'')), '\s+', ' ', 'g'))
      = upper(regexp_replace(trim(coalesce(e.apellidos_nombres,'')), '\s+', ' ', 'g'));
