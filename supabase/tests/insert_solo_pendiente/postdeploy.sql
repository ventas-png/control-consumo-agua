-- ════════════════════════════════════════════════════════════════════════════
-- Verificación POSTDEPLOY de 20260907000900 — SOLO LECTURA
-- ════════════════════════════════════════════════════════════════════════════
--
-- Muestra la EXPRESIÓN real de la policy (pg_get_expr del WITH CHECK) y la
-- definición real del trigger del gate de cierre (pg_get_triggerdef) — no sus
-- nombres — y FALLA si el contrato no está. No escribe nada.
--
-- CONTRA PRODUCCIÓN, tras el apply:
--
--   psql "$DATABASE_URL" -f supabase/tests/insert_solo_pendiente/postdeploy.sql
--
--   curl -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_ID/database/query" \
--     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
--     -d "$(jq -Rs '{query: .}' < supabase/tests/insert_solo_pendiente/postdeploy.sql)"
--
-- La vigilancia CONTINUA de la misma expresión vive en
-- scripts/migraciones-vs-produccion.mjs (POLICIES_CRITICAS), post-apply y
-- nocturna; esto es el eco inmediato para el operador.

SELECT pol.polname                                   AS policy_name,
       pol.polcmd                                    AS cmd,
       pg_get_expr(pol.polwithcheck, pol.polrelid)   AS with_check
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
WHERE c.relname = 'tareas_bloque' AND pol.polname = 'tareas_bloque_insert';

SELECT pg_get_triggerdef(t.oid) AS trigger_def
FROM pg_trigger t
WHERE t.tgrelid = 'public.tareas_bloque'::regclass
  AND t.tgname = 'trg_exigir_evidencia';

DO $$
DECLARE
  v_wc  text;
  v_cmd "char";
  v_trg text;
  col   text;
BEGIN
  SELECT pol.polcmd, pg_get_expr(pol.polwithcheck, pol.polrelid)
    INTO v_cmd, v_wc
    FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'tareas_bloque' AND pol.polname = 'tareas_bloque_insert';

  IF v_wc IS NULL THEN
    RAISE EXCEPTION 'postdeploy: la policy tareas_bloque_insert NO existe (o no tiene WITH CHECK)'; END IF;
  IF v_cmd <> 'a' THEN
    RAISE EXCEPTION 'postdeploy: la policy cubre polcmd=% (esperado a = INSERT)', v_cmd; END IF;
  IF v_wc NOT LIKE '%estado = ''pendiente''%' THEN
    RAISE EXCEPTION 'postdeploy: el WITH CHECK ya no exige nacer pendiente: %', v_wc; END IF;
  FOREACH col IN ARRAY ARRAY['completada_en', 'completado_por', 'anulada_en',
                             'anulada_por', 'motivo_anulacion', 'motivo_sin_evidencia'] LOOP
    IF v_wc NOT LIKE '%(' || col || ' IS NULL)%' THEN
      RAISE EXCEPTION 'postdeploy: el WITH CHECK ya no exige % IS NULL: %', col, v_wc; END IF;
  END LOOP;

  SELECT pg_get_triggerdef(t.oid) INTO v_trg
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.tareas_bloque'::regclass
     AND t.tgname = 'trg_exigir_evidencia';
  IF v_trg IS NULL THEN
    RAISE EXCEPTION 'postdeploy: trg_exigir_evidencia NO existe — el gate de cierre desapareció'; END IF;
  IF v_trg NOT LIKE '%BEFORE UPDATE%'
     OR v_trg NOT LIKE '%exigir_evidencia_al_cerrar()%' THEN
    RAISE EXCEPTION 'postdeploy: el trigger del gate cambió de forma: %', v_trg; END IF;

  RAISE NOTICE 'postdeploy OK: el WITH CHECK exige nacer pendiente y sin sellos, y el gate de cierre sigue armado';
END;
$$;
