alter table public.documentos_generados drop constraint documentos_generados_tipo_check;
alter table public.documentos_generados add constraint documentos_generados_tipo_check
  check (tipo = any (array['imputacion'::text, 'acta_no_descargo'::text, 'orden_sancion'::text, 'archivo_leve'::text]));
