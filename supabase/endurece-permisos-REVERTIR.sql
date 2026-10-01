-- Deshace 20261001120000_endurece_permisos_auditoria.sql (vuelve a los permisos amplios anteriores).
do $$
declare t text;
begin
  foreach t in array array['alertas_movil_enviadas','audit_log','contadores_documentos','directivas',
    'documentos_generados','documentos_institucionales','efectivos','expedientes','expedientes_remitidos',
    'firmas_documentos','google_drive_conexion','google_drive_oauth_estados','notas_informativas',
    'profiles','roles_servicio','suscripciones_movil'] loop
    execute format('grant all on public.%I to anon', t);
    execute format('grant truncate, references, trigger on public.%I to authenticated', t);
  end loop;
end $$;
grant execute on function imputacion_pnp.es_admin() to anon;
grant execute on function imputacion_pnp.handle_new_user() to anon, authenticated;
alter function imputacion_pnp.set_updated_at() reset search_path;
