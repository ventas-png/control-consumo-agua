-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación tras desplegar 20261030000100 (responsable de housekeeping como usuario)
-- ════════════════════════════════════════════════════════════════════════════
-- NO se ejecuta sola ni en CI. Leer antes de correr. Regla general: ante un problema,
-- preferir AVANZAR con una migración nueva; estas secciones contienen un incidente sin
-- perder datos. Ninguna toca `responsable` (texto heredado) ni los sellos de autoría
-- (creado_por, iniciado_*, completado_*, fotos.creado_por).
-- ════════════════════════════════════════════════════════════════════════════

-- ── A) Contener: dejar de validar y de sellar, conservando las asignaciones ────
-- Quita el trigger y las funciones. Las columnas y sus valores quedan: la pantalla
-- sigue mostrando al responsable; el selector deja de funcionar (la RPC no existe) y
-- la base deja de validar la elegibilidad (una petición directa podría poner cualquier
-- id). Reversible: volver a aplicar 20261030000100 (idempotente) lo restaura todo.
BEGIN;
DROP TRIGGER IF EXISTS trg_hk_responsable ON public.servicios_housekeeping;
DROP FUNCTION IF EXISTS public.hk_responsables_elegibles(uuid);
DROP FUNCTION IF EXISTS public.hk_responsable_validar();
DROP FUNCTION IF EXISTS public.hk_responsable_elegible(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.usuario_tiene_permiso(uuid, text);
COMMIT;

-- ── B) Solo cerrar el catálogo (p. ej. si se sospecha que lista de más) ───────────
-- La base sigue validando y sellando; la pantalla no puede asignar hasta restaurar.
--   REVOKE EXECUTE ON FUNCTION public.hk_responsables_elegibles(uuid) FROM authenticated;
-- Para reanudar: GRANT EXECUTE ON FUNCTION public.hk_responsables_elegibles(uuid) TO authenticated;

-- ── C) Revertir EXACTAMENTE (pierde las asignaciones por usuario) ─────────────────
-- Solo si hay que volver al esquema anterior. Borra responsable_user_id y los sellos de
-- asignación de TODOS los servicios; el texto heredado `responsable` no se toca. Antes,
-- guardar una copia:
--   CREATE TABLE public.zz_respaldo_hk_responsable AS
--     SELECT id, responsable_user_id, responsable_asignado_por, responsable_asignado_en
--       FROM public.servicios_housekeeping WHERE responsable_user_id IS NOT NULL OR responsable_asignado_por IS NOT NULL;
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_hk_responsable ON public.servicios_housekeeping;
-- DROP FUNCTION IF EXISTS public.hk_responsables_elegibles(uuid);
-- DROP FUNCTION IF EXISTS public.hk_responsable_validar();
-- DROP FUNCTION IF EXISTS public.hk_responsable_elegible(uuid, uuid, uuid);
-- DROP FUNCTION IF EXISTS public.usuario_tiene_permiso(uuid, text);
-- DROP INDEX IF EXISTS public.idx_hk_responsable_user;
-- ALTER TABLE public.servicios_housekeeping
--   DROP COLUMN IF EXISTS responsable_user_id,
--   DROP COLUMN IF EXISTS responsable_asignado_por,
--   DROP COLUMN IF EXISTS responsable_asignado_en;
-- COMMENT ON COLUMN public.servicios_housekeeping.responsable IS NULL;
-- COMMIT;

-- ── D) Comprobaciones posteriores (solo lectura) ────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.servicios_housekeeping'::regclass AND NOT tgisinternal;
-- SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--   AND proname IN ('usuario_tiene_permiso','hk_responsable_elegible','hk_responsable_validar','hk_responsables_elegibles');
-- SELECT count(*) FILTER (WHERE responsable_user_id IS NOT NULL) AS vinculados,
--        count(*) FILTER (WHERE responsable_user_id IS NULL AND responsable IS NOT NULL) AS heredados_sin_vincular
--   FROM public.servicios_housekeeping;
