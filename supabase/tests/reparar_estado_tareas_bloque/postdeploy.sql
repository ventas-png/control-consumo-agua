-- ════════════════════════════════════════════════════════════════════════════
-- Verificación POSTDEPLOY de 20260907000700 — SOLO LECTURA
-- ════════════════════════════════════════════════════════════════════════════
--
-- Muestra el estado terminal del constraint (definición final y
-- convalidated = true) y FALLA si no es el esperado. No escribe nada: dos
-- lecturas de catálogo.
--
-- CONTRA PRODUCCIÓN, tras el apply (cualquiera de las dos vías):
--
--   psql "$DATABASE_URL" -f supabase/tests/reparar_estado_tareas_bloque/postdeploy.sql
--
--   curl -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "$(jq -Rs '{query: .}' < supabase/tests/reparar_estado_tareas_bloque/postdeploy.sql)"
--
-- La vigilancia CONTINUA de esta misma definición vive en
-- scripts/migraciones-vs-produccion.mjs (CONSTRAINTS_CRITICOS), que corre tras
-- cada apply y cada noche; esto es el eco inmediato para el operador.

SELECT
  con.conname                     AS constraint_name,
  con.convalidated,
  pg_get_constraintdef(con.oid)   AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.tareas_bloque'::regclass
  AND con.conname  = 'tareas_bloque_estado_check';

DO $$
DECLARE
  v_def          text;
  v_convalidated boolean;
BEGIN
  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_convalidated
    FROM pg_constraint
   WHERE conrelid = 'public.tareas_bloque'::regclass
     AND conname  = 'tareas_bloque_estado_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'postdeploy: tareas_bloque_estado_check NO existe'; END IF;
  IF v_convalidated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'postdeploy: convalidated=% (esperado true) — el histórico quedó sin validar', v_convalidated; END IF;
  -- Semántico y sin acoplarse al formato exacto del servidor: los cuatro
  -- cánones presentes, ningún vocablo legacy presente.
  IF v_def NOT LIKE '%''pendiente''%' OR v_def NOT LIKE '%''completada''%'
     OR v_def NOT LIKE '%''con_observacion''%' OR v_def NOT LIKE '%''omitida''%' THEN
    RAISE EXCEPTION 'postdeploy: a la definición le falta un valor canónico: %', v_def; END IF;
  IF v_def LIKE '%''completado''%' OR v_def LIKE '%''omitido''%' OR v_def LIKE '%''en_curso''%' THEN
    RAISE EXCEPTION 'postdeploy: la definición conserva vocabulario legacy: %', v_def; END IF;

  RAISE NOTICE 'postdeploy OK: convalidated=true · %', v_def;
END;
$$;
