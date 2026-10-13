-- ════════════════════════════════════════════════════════════════════════════
-- Reconciliación de la rama de PREVIEW EFÍMERA de la PR #927 — PREPARADA, NO EJECUTADA
-- ════════════════════════════════════════════════════════════════════════════
-- SOLO para la rama de preview `claude/cleaning-documentation-images-85lefu`
-- (proyecto `xycrwolnonmgcygfuebe`, branch id e13b7d2b-7cbc-4204-8d5c-2a1f936108ec).
-- Requiere autorización explícita: borra UNA fila del registro de migraciones.
--
-- Por qué: la rama registró `20261023000001_housekeeping_evidencias` (versión antigua de esta
-- PR) y el repo ya no la tiene → «Remote migration versions not found in local migrations
-- directory» en cada push (workflow_run_logs del 9, 10 y 12/10).
--
-- Uso (psql contra la base de la rama de preview, desde esta carpeta):
--   psql "$URL_PREVIEW_PR927" -v ON_ERROR_STOP=1 -f reconciliar_preview_pr927.sql
-- Con la herramienta SQL de Supabase: ejecutar los bloques 1, 2 (contenido de los dos
-- archivos de migración, en orden), 3 y 4 por separado.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- 1) Guarda: SOLO actúa sobre una base que tenga la versión antigua registrada y no la nueva.
--    Producción y el sandbox nunca tuvieron 20261023000001: aquí abortan sin tocar nada.
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261023000001' AND name = 'housekeeping_evidencias') THEN
    RAISE EXCEPTION 'ABORTA: esta base no tiene registrada 20261023000001_housekeeping_evidencias; no es la preview de #927.';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261028000000', '20261028000100')) THEN
    RAISE EXCEPTION 'ABORTA: ya hay una versión definitiva registrada; revisar a mano.';
  END IF;
END
$guarda$;

-- 2) Contenido definitivo (idempotente; converge desde el estado antiguo: run.sh §3).
\i ../../migrations/20261028000000_housekeeping_evidencias.sql
\i ../../migrations/20261028000100_housekeeping_servicios_por_proyecto.sql

-- 3) Registro: la versión antigua sale, las dos definitivas entran (solo versión y nombre,
--    como apply-migrations-sandbox.yml). Una transacción.
BEGIN;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261023000001' AND name = 'housekeeping_evidencias';
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261028000000', 'housekeeping_evidencias'),
  ('20261028000100', 'housekeeping_servicios_por_proyecto')
ON CONFLICT (version) DO NOTHING;
COMMIT;

-- 4) Verificación. Esperado: 2 | t | t | {hk_evidencias_insert,hk_evidencias_select} | 4
SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name LIKE 'housekeeping\_%') AS registro,
       to_regprocedure('public.hk_acceso(uuid,uuid)') IS NOT NULL AS hk_acceso,
       to_regclass('public.hk_limpieza_storage') IS NOT NULL AS cola,
       (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'hk\_evidencias\_%') AS bucket,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'servicios_housekeeping'
         AND (coalesce(qual, '') || coalesce(with_check, '')) ~ '(hk_acceso|can_access_project)') AS servicio_por_proyecto;

-- ALTERNATIVA (también requiere autorización): RECREAR la rama en vez de reconciliarla.
--   Panel de Supabase → proyecto padre → Branches → `claude/cleaning-documentation-images-85lefu`
--   → Delete branch (solo esa), y después un push a la PR (o cerrar y reabrir la PR).
--   El worker crea la rama desde cero, aplica todas las migraciones del repo (incluidas las dos
--   definitivas) y despliega las Edge Functions. Así se resolvió la preview de #926.
-- DESPUÉS (cualquiera de las dos): el check «Supabase Preview» del HEAD debe quedar verde, y en la
-- rama: la consulta del paso 4, y `list_edge_functions` debe mostrar `housekeeping-limpieza` y
-- `purgar-fotos-registros`.
