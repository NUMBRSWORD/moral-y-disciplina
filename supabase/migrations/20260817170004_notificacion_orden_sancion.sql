-- Igual que en notificacion-imputacion-pnp: registrar cuándo y con qué
-- cargo firmado se notificó la Orden de Sanción al investigado, verificado
-- con IA (revisar-documento-ia, ya desplegada en este proyecto).
alter table public.notas_informativas
  add column if not exists orden_notificada_at timestamptz,
  add column if not exists archivo_orden_notificacion_path text,
  add column if not exists archivo_orden_notificacion_nombre text;
