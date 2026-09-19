-- El REVOKE ... FROM anon de la migración anterior no bastó: Postgres otorga
-- EXECUTE a PUBLIC por defecto al crear una función, y anon hereda de PUBLIC.
-- Hay que revocar de PUBLIC explícitamente, igual que las demás RPC de esta
-- tabla (registrar_sancion, registrar_descargo, etc.).
revoke execute on function public.registrar_archivo_leve(uuid, text, text) from public;
grant execute on function public.registrar_archivo_leve(uuid, text, text) to authenticated;
