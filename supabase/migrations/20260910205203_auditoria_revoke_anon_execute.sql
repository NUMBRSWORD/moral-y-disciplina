-- Quita EXECUTE público (PUBLIC incluye anon) de las funciones SECURITY DEFINER
-- y lo re-otorga solo a authenticated donde el cliente o la RLS lo necesitan.
-- Deja fuera el advisor 0028 ("Public Can Execute"). El 0029 ("Signed-In can
-- Execute") es intencional: los RPC se autoprotegen con es_admin()/cip_actual().

revoke execute on function
  public.registrar_descargo(uuid, date, text, text, text),
  public.registrar_notificacion_imputacion(uuid, date),
  public.registrar_notificacion_orden(uuid, date, text, text),
  public.registrar_sancion(uuid, text, integer, text, text),
  public.quitar_descargo(uuid),
  public.estado_respaldo_drive(),
  public.es_admin(),
  public.cip_actual()
from public;

grant execute on function
  public.registrar_descargo(uuid, date, text, text, text),
  public.registrar_notificacion_imputacion(uuid, date),
  public.registrar_notificacion_orden(uuid, date, text, text),
  public.registrar_sancion(uuid, text, integer, text, text),
  public.quitar_descargo(uuid),
  public.estado_respaldo_drive(),
  public.es_admin(),
  public.cip_actual()
to authenticated;

-- Funciones de trigger: no requieren EXECUTE de ningún rol de la API.
revoke execute on function public.fn_audit_log(), public.handle_new_user() from public;
