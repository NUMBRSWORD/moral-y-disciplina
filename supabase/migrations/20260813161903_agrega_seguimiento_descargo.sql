alter table public.notas_informativas
  add column imputacion_generada_at timestamptz,
  add column fecha_descargo date,
  add column numero_descargo text,
  add column archivo_descargo_path text,
  add column archivo_descargo_nombre text;

comment on column public.notas_informativas.imputacion_generada_at is 'Momento en que se generó/descargó por primera vez el documento de Imputación (se usa como fecha de notificación para calcular el plazo de descargo).';
comment on column public.notas_informativas.fecha_descargo is 'Fecha en que el investigado presentó su descargo. Si está vacío y venció el plazo, corresponde generar el Acta de No Recepción de Descargos.';
