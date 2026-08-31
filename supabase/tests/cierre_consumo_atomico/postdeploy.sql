-- ════════════════════════════════════════════════════════════════════════════
-- Verificación POSTDEPLOY de 20260907001000 — SOLO LECTURA.
--
-- Mira la DEFINICIÓN viva (pg_get_functiondef / pg_get_constraintdef /
-- pg_get_expr), no los nombres: una función homónima sin el lock o sin el gate
-- de estado pasaría un chequeo de existencia y dejaría los agujeros abiertos.
-- Puede correrse tal cual contra producción tras el apply.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_def text;
  v_pred text;
BEGIN
  -- 1 · la RPC de cierre: SECURITY DEFINER, lock de tarea, scope y familias.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'cerrar_tarea_y_consumir_insumos';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PD-1: cerrar_tarea_y_consumir_insumos no existe';
  END IF;
  IF v_def NOT LIKE '%SECURITY DEFINER%'
     OR v_def NOT LIKE '%FOR UPDATE OF t%'
     OR v_def NOT LIKE '%assert_company_scope%'
     OR v_def NOT LIKE '%condominios.tab.tareas_personal%'
     OR v_def NOT LIKE '%IS DISTINCT FROM ''completada''%' THEN
    RAISE EXCEPTION 'PD-1: la definición viva de cerrar_tarea_y_consumir_insumos perdió el lock, el scope o el gate de estado';
  END IF;

  -- 2 · el motor: reclamo con FOR UPDATE, re-chequeo del claim y tipo numérico.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'tarea_bloque_consumir_reclamado';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'PD-2: tarea_bloque_consumir_reclamado no existe';
  END IF;
  IF v_def NOT LIKE '%FOR UPDATE OF tbs%'
     OR v_def NOT LIKE '%movimiento_id IS NULL AND no_usado_en IS NULL%'
     OR v_def NOT LIKE '%jsonb_typeof(item -> ''cantidad'') <> ''number''%'
     OR v_def NOT LIKE '%GET DIAGNOSTICS%' THEN
    RAISE EXCEPTION 'PD-2: el motor perdió el reclamo con lock, el re-chequeo o la validación de tipo';
  END IF;
  -- 20260907001100: dos decimales exactos y duplicados por uuid NORMALIZADO.
  IF v_def NOT LIKE '%round(v_cant, 2)%'
     OR v_def NOT LIKE '%GROUP BY ((j.item ->> ''suministro_id'')::uuid)%' THEN
    RAISE EXCEPTION 'PD-2c: el motor perdió el corte de decimales o la normalización de duplicados';
  END IF;
  IF (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
      WHERE ns.nspname = 'public' AND p.proname = 'tarea_bloque_consumir_reclamado') THEN
    RAISE EXCEPTION 'PD-2b: el motor NO debe ser SECURITY DEFINER (hereda el contexto de las RPC)';
  END IF;

  -- 3 · la RPC vieja exige TRABAJO REALIZADO: completada o con_observacion.
  -- 20260907001100 sacó a 'omitida' de la lista: lo no hecho no gasta insumos.
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'consumir_insumos_tarea';
  IF v_def NOT LIKE '%NOT IN (''completada'', ''con_observacion'')%' THEN
    RAISE EXCEPTION 'PD-3: consumir_insumos_tarea ya no exige trabajo realizado (completada/con_observacion)';
  END IF;
  IF v_def LIKE '%NOT IN (''completada'', ''con_observacion'', ''omitida'')%' THEN
    RAISE EXCEPTION 'PD-3b: volvió la lista permisiva de 20260907001000 (omitida consumible)';
  END IF;

  -- 4 · ACLs: el cliente llama a las RPC y NUNCA al motor directamente.
  IF NOT has_function_privilege('authenticated',
      'public.cerrar_tarea_y_consumir_insumos(uuid, text, text, jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PD-4: authenticated perdió EXECUTE sobre la RPC de cierre';
  END IF;
  IF has_function_privilege('anon',
      'public.cerrar_tarea_y_consumir_insumos(uuid, text, text, jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PD-4b: anon puede ejecutar la RPC de cierre';
  END IF;
  IF has_function_privilege('authenticated',
      'public.tarea_bloque_consumir_reclamado(uuid, jsonb, uuid, uuid, text, date)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PD-4c: authenticated puede saltarse la autorización llamando al motor';
  END IF;

  -- 5 · el estado imposible y el conjunto reclamable.
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.tarea_bloque_suministros'::regclass
    AND c.conname = 'tbs_consumo_o_descarte_check';
  IF v_def IS NULL OR v_def NOT LIKE '%movimiento_id IS NULL%'
     OR v_def NOT LIKE '%no_usado_en IS NULL%' THEN
    RAISE EXCEPTION 'PD-5: tbs_consumo_o_descarte_check no está o cambió (%)', COALESCE(v_def, 'ausente');
  END IF;
  SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'idx_tbs_pendientes';
  IF v_pred IS NULL OR v_pred NOT LIKE '%no_usado_en IS NULL%' THEN
    RAISE EXCEPTION 'PD-5b: idx_tbs_pendientes no excluye lo descartado (%)', COALESCE(v_pred, 'ausente');
  END IF;

  RAISE NOTICE 'postdeploy OK: RPC con lock+scope+gate, motor sin DEFINER e inalcanzable, RPC vieja exige cierre, CHECK e índice en su lugar';
END $$;
