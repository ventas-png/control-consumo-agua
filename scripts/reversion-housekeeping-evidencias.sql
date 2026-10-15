-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación tras desplegar #927 (20261028000000 + 20261028000100)
-- ════════════════════════════════════════════════════════════════════════════
-- NO se ejecuta sola ni en CI. Cada sección es independiente; leer antes de correr.
-- Regla general: ante un problema, preferir AVANZAR con una migración nueva. Estas
-- secciones son para contener un incidente sin perder datos.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A) Revertir EXACTAMENTE 20261028000100 (servicio acotado al proyecto) ───────
-- Restaura las cuatro policies previas de servicios_housekeeping (copiadas de la base
-- de preview, que no tiene la 0100, el 2026-10-12). Reabre el hueco que cerraba la 0100:
-- un operador de otro proyecto de la misma empresa vuelve a ver y editar textos del servicio.
BEGIN;
DROP POLICY IF EXISTS servicios_housekeeping_select ON public.servicios_housekeeping;
DROP POLICY IF EXISTS servicios_housekeeping_insert ON public.servicios_housekeeping;
DROP POLICY IF EXISTS servicios_housekeeping_update ON public.servicios_housekeeping;
DROP POLICY IF EXISTS servicios_housekeeping_delete ON public.servicios_housekeeping;
CREATE POLICY servicios_housekeeping_select ON public.servicios_housekeeping FOR SELECT TO authenticated USING (
  public.is_super_admin() OR ((company_id = public.get_my_company_id()) AND public.user_has_permission('condominios.tab.housekeeping'))
  OR (unidad_id IN (SELECT public.mis_unidades_ids())));
CREATE POLICY servicios_housekeeping_insert ON public.servicios_housekeeping FOR INSERT TO authenticated WITH CHECK (
  public.is_super_admin() OR ((company_id = public.get_my_company_id()) AND public.user_has_permission('condominios.tab.housekeeping')));
CREATE POLICY servicios_housekeeping_update ON public.servicios_housekeeping FOR UPDATE TO authenticated USING (
  public.is_super_admin() OR ((company_id = public.get_my_company_id()) AND public.user_has_permission('condominios.tab.housekeeping')))
  WITH CHECK (public.is_super_admin() OR ((company_id = public.get_my_company_id()) AND public.user_has_permission('condominios.tab.housekeeping')));
CREATE POLICY servicios_housekeeping_delete ON public.servicios_housekeeping FOR DELETE TO authenticated USING (
  public.is_super_admin() OR ((public.current_user_role() = ANY (ARRAY['company_owner','admin'])) AND (company_id = public.get_my_company_id())));
COMMIT;

-- ── B) Contener 20261028000000 SIN perder datos (modo seguro) ───────────────────
-- Para si las subidas o la limpieza se comportan mal. No borra filas, textos ni archivos.
-- B1. Parar la limpieza horaria (la cola conserva sus filas; nada se pierde):
--   SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hk_limpieza_storage_hourly';
-- B2. Parar las subidas nuevas al bucket (lectura intacta):
--   DROP POLICY IF EXISTS "hk_evidencias_insert" ON storage.objects;
--   REVOKE INSERT ON public.servicio_housekeeping_fotos FROM authenticated;
-- B3. Parar los borrados desde la pantalla (las RPC):
--   REVOKE EXECUTE ON FUNCTION public.hk_eliminar_foto(uuid), public.hk_eliminar_servicio(uuid) FROM authenticated;
-- Para reanudar: volver a aplicar el archivo 20261028000000_housekeeping_evidencias.sql (idempotente:
-- recrea policy, grants, RPC y cron) y, si se tocó, el 20261028000100.

-- ── C) Revertir 20261028000000 por completo ─────────────────────────────────────
-- NO se incluye como script: borraría la tabla de fotos, la cola y el bucket (datos de clientes).
-- Si hiciera falta, primero B, después exportar servicio_housekeeping_fotos y hk_limpieza_storage,
-- y decidir con el dueño del dato. Las columnas de texto y sellos de servicios_housekeeping no se
-- tocan en ningún caso.

-- ── Comprobaciones posteriores al despliegue (solo lectura) ─────────────────────
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20261028000000', '20261028000100') ORDER BY 1;  -- 2 filas
SELECT to_regclass('public.servicio_housekeeping_fotos') IS NOT NULL AS fotos, to_regclass('public.hk_limpieza_storage') IS NOT NULL AS cola,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'servicios_housekeeping'
         AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hk_acceso|can_access_project)') AS servicio_por_proyecto,   -- 4
       (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname LIKE 'hk\_evidencias\_%') AS bucket,                                                                  -- {insert,select}
       (SELECT NOT public FROM storage.buckets WHERE id = 'housekeeping-evidencias') AS bucket_privado,
       (SELECT active FROM cron.job WHERE jobname = 'hk_limpieza_storage_hourly') AS cron_horario,
       (SELECT count(*) FROM vault.decrypted_secrets WHERE name IN ('purga_fotos_url', 'purga_fotos_service_key')) AS secretos_vault; -- 2 (solo nombres)
SELECT count(*) AS en_cola, count(*) FILTER (WHERE intentos >= 10) AS atascadas, max(ultimo_error) AS ultimo_error FROM public.hk_limpieza_storage;
-- Edge Functions: en el panel (o list_edge_functions) deben figurar housekeeping-limpieza y purgar-fotos-registros con verify_jwt = false.
