-- anon tenia un grant EXPLICITO (no solo via PUBLIC) en las 3 funciones
-- nuevas -- mismo patron ya visto con registrar_archivo_leve antes en esta
-- app: hay que revocar de anon ademas de public. siguiente_correlativo
-- ademas no la debe poder llamar nadie directo (solo la usa internamente
-- reservar_resolucion_archivo_leve, que corre con privilegios de su dueño
-- por ser SECURITY DEFINER).
revoke execute on function public.reservar_resolucion_archivo_leve(uuid) from anon;
revoke execute on function public.registrar_archivo_leve(uuid, text) from anon;
revoke execute on function public.siguiente_correlativo(text, integer) from anon, authenticated;
