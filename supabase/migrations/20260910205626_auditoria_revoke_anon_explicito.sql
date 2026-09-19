-- Los roles anon/authenticated tenían GRANT EXECUTE explícito (no solo por
-- PUBLIC), así que hay que revocarlos por nombre.

-- anon: no necesita NINGUNA de estas funciones (no hay flujos anónimos).
revoke execute on function
  public.registrar_descargo(uuid, date, text, text, text),
  public.registrar_notificacion_imputacion(uuid, date),
  public.registrar_notificacion_orden(uuid, date, text, text),
  public.registrar_sancion(uuid, text, integer, text, text),
  public.quitar_descargo(uuid),
  public.estado_respaldo_drive(),
  public.es_admin(),
  public.cip_actual(),
  public.fn_audit_log(),
  public.handle_new_user()
from anon;

-- authenticated: solo lo quita de las funciones de trigger (nadie las llama por API).
revoke execute on function
  public.fn_audit_log(),
  public.handle_new_user()
from authenticated;
