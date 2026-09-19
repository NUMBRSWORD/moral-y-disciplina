create extension if not exists pg_cron;
create extension if not exists pg_net;

-- !! ANTES DE APLICAR ESTA MIGRACIÓN en una base nueva, sustituir los dos
-- marcadores <...> por sus valores reales. En el original figuraban en texto
-- claro y se quitaron porque este repositorio es público:
--   <ALERTAS_CRON_SECRET>  el mismo valor del secreto ALERTAS_CRON_SECRET de la
--                          función alertas-automaticas.
--   <SUPABASE_ANON_KEY>    la anon key del proyecto (la de config.js).
-- Idealmente el secreto debería vivir en Supabase Vault y no dentro del job.

-- Reprograma (borra la anterior si existe) el repaso diario de alertas a
-- las 13:00 UTC = 08:00 hora de Peru. Llama a la Edge Function con el
-- secreto de cron; la funcion decide que expedientes avisar y a que CIP.
select cron.unschedule(jobid) from cron.job where jobname = 'alertas-md-0800';

select cron.schedule(
  'alertas-md-0800',
  '0 13 * * *',
  $cron$
  select net.http_post(
    url := 'https://tndjulaitywtoocqeeiy.supabase.co/functions/v1/alertas-automaticas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alertas-cron-secret', '<ALERTAS_CRON_SECRET>',
      'Authorization', 'Bearer <SUPABASE_ANON_KEY>'
    ),
    body := '{"modo":"automatico"}'::jsonb
  ) as request_id;
  $cron$
);
