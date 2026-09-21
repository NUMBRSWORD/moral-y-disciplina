-- Auditoría de cambios de rol, aprobaciones y firmas (auditoría 21-sep-2026, M5).
--
-- Había triggers de auditoría en notas, efectivos, expedientes, directivas y
-- documentos institucionales, pero NO en profiles: quién aprobó a quién o dio el rol
-- de administrador no dejaba rastro. Se reutiliza la misma función fn_audit_log().
-- Probado en una transacción revertida: un UPDATE de profiles deja su fila en audit_log.

create trigger audit_profiles           after insert or delete or update on public.profiles           for each row execute function public.fn_audit_log();
create trigger audit_roles_servicio     after insert or delete or update on public.roles_servicio     for each row execute function public.fn_audit_log();
create trigger audit_solicitudes_acceso after insert or delete or update on public.solicitudes_acceso for each row execute function public.fn_audit_log();
create trigger audit_firmas_documentos  after insert or delete or update on public.firmas_documentos  for each row execute function public.fn_audit_log();
