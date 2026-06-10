-- Cierra el WARN 0029 del advisor para deactivate_expired_tarifas():
-- era ejecutable por cualquier usuario autenticado vía /rest/v1/rpc/ y hace
-- un UPDATE global de tarifas (sin scoping por empresa), así que un usuario
-- de una empresa podía forzar la desactivación de tarifas vencidas de todas
-- las demás. El frontend no la llama: la ejecuta el job diario de pg_cron
-- (deactivate_expired_tarifas_daily, "0 3 * * *") como postgres, que no
-- depende de estos grants. Idempotente.
revoke execute on function public.deactivate_expired_tarifas() from public, anon, authenticated;

-- service_role la conserva por si hay que correrla a mano desde el backend.
grant execute on function public.deactivate_expired_tarifas() to service_role;
