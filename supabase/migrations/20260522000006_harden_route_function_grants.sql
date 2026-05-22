-- ============================================================
-- Endurecer permisos de las funciones de rutas/recordatorios
-- ============================================================
-- Postgres otorga EXECUTE a PUBLIC por defecto, lo que exponía estas funciones
-- SECURITY DEFINER vía /rest/v1/rpc a usuarios anónimos. No deben ser invocables
-- por anon ni por usuarios finales.

-- Job de recordatorios: solo el cron (postgres, dueño) lo ejecuta.
REVOKE ALL ON FUNCTION public.run_route_reminders() FROM PUBLIC, anon, authenticated;

-- Generador: lo invoca el edge function (service_role) y el job (definer).
REVOKE ALL ON FUNCTION public.generar_ocurrencias_rutas(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generar_ocurrencias_rutas(int) TO service_role;

-- Función de trigger: no debe exponerse como RPC (el trigger no requiere EXECUTE).
REVOKE ALL ON FUNCTION public.set_ruta_ocurrencia_scope() FROM PUBLIC, anon, authenticated;
