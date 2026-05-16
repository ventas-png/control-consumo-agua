-- Programa la auto-desactivación de tarifas vencidas como job diario via pg_cron.
-- Antes la función deactivate_expired_tarifas() se invocaba desde el cliente en
-- cada login (src/hooks/useData.ts cargarDatos), lo cual generaba ruido en
-- DevTools cuando el request se cancelaba al navegar/refresh. Mover el cleanup
-- al servidor lo hace una sola vez al día y elimina la dependencia del cliente.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule diario a las 03:00 UTC (cuando hay tráfico bajo). Idempotente —
-- si el job ya existe con el mismo nombre, lo recrea.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'deactivate_expired_tarifas_daily';

SELECT cron.schedule(
  'deactivate_expired_tarifas_daily',
  '0 3 * * *',
  $$SELECT public.deactivate_expired_tarifas();$$
);
