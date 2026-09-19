-- Índices de cobertura para las claves foráneas del esquema public
-- (elimina el advisor "unindexed_foreign_keys" y mejora joins/borrados).
create index if not exists ix_notas_informativas_created_by on public.notas_informativas (created_by);
create index if not exists ix_efectivos_created_by on public.efectivos (created_by);
create index if not exists ix_documentos_generados_generado_por on public.documentos_generados (generado_por);
create index if not exists ix_directivas_created_by on public.directivas (created_by);
create index if not exists ix_expedientes_created_by on public.expedientes (created_by);
create index if not exists ix_expedientes_nota_id on public.expedientes (nota_id);
create index if not exists ix_expedientes_remitidos_recibido_por on public.expedientes_remitidos (recibido_por);
create index if not exists ix_expedientes_remitidos_remitido_por on public.expedientes_remitidos (remitido_por);
create index if not exists ix_google_drive_conexion_conectado_por on public.google_drive_conexion (conectado_por);
create index if not exists ix_google_drive_oauth_estados_user_id on public.google_drive_oauth_estados (user_id);
create index if not exists ix_suscripciones_movil_user_id on public.suscripciones_movil (user_id);
create index if not exists ix_audit_log_changed_by on public.audit_log (changed_by);
