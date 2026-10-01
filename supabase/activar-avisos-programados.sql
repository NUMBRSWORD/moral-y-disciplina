-- Ejecutar administrativamente DESPUÉS de verificar avisos-android y sus secretos.
-- No contiene claves. No se incluye como migración automática porque requiere Vault.
-- Referencia: https://supabase.com/docs/guides/functions/schedule-functions
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name='faltos_avisos_cron_secret' and length(decrypted_secret)>0) then
    raise exception 'Falta configurar en Vault faltos_avisos_cron_secret con el mismo valor de AVISOS_CRON_SECRET. No pegue la clave en Git.';
  end if;
  if to_regclass('public.dispositivos_android') is null or to_regclass('public.entregas_android') is null
    or to_regclass('public.recepciones_fisicas') is null then
    raise exception 'Faltan las tablas de avisos o recepción. Verifique el despliegue primero.';
  end if;
end $$;
-- Mismo nombre: actualizar es idempotente. No toca alertas-md-0800 de Web Push.
select cron.schedule('faltos-avisos-android', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://tndjulaitywtoocqeeiy.supabase.co/functions/v1/avisos-android',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-avisos-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='faltos_avisos_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
commit;
