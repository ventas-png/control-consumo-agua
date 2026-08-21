\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de la solicitud de renta con datos de contrato y adjuntos
-- (20260828000000 · 20260828000200).
--
--    1-5   las columnas: existen, `documentos` nace como array vacío, el tope
--          de 8 adjuntos, el rango de día de pago y el orden de las fechas
--    6-7   el portal no puede auto-enlazarse un contrato
--    8-11  aprobar: crea el contrato con los datos enviados, lo enlaza, deja
--          la solicitud aprobada y respeta `p_crear_contrato = false`
--   12-14  aprobar NO crea contrato con STR, ni con datos incompletos, ni dos
--          veces sobre la misma solicitud
--   15-17  la ACL: sin el permiso del tab no resuelve, otra empresa tampoco,
--          y anon no puede ejecutar el RPC
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  CO_A   uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1     uuid := '11111111-0000-0000-0000-000000000001';
  U1     uuid := '11d10000-0000-0000-0000-000000000001';
  U2     uuid := '11d10000-0000-0000-0000-000000000002';
  U3     uuid := '11d10000-0000-0000-0000-000000000003';
  CLI    uuid := 'c11e0000-0000-0000-0000-000000000001';
  ADMIN  uuid := 'e0000000-0000-0000-0000-00000000000a';
  AJENO  uuid := 'e0000000-0000-0000-0000-00000000000b';
  DUENO  uuid := 'e0000000-0000-0000-0000-00000000000c';
  v_sol  uuid;
  v_res  jsonb;
  v_con  public.contratos_arrendamiento%ROWTYPE;
  v_txt  text;
  v_n    int;
BEGIN
  -- ── 1: las columnas nuevas existen con el tipo esperado ───────────────────
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'solicitud_renta_unidad'
     AND column_name IN ('arrendatario_nombre','arrendatario_identificacion',
                         'arrendatario_telefono','arrendatario_email','monto_renta',
                         'deposito','dia_pago','fecha_inicio','fecha_fin',
                         'notas_contrato','documentos','contrato_id');
  IF v_n <> 12 THEN RAISE EXCEPTION '1: faltan columnas (encontradas %)', v_n; END IF;
  RAISE NOTICE '1  OK    las 12 columnas de contrato + adjuntos existen';

  -- ── 2: `documentos` nace como array vacío, no NULL ────────────────────────
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id)
  VALUES (CO_A, P1, U1, CLI) RETURNING id INTO v_sol;
  PERFORM 1 FROM public.solicitud_renta_unidad WHERE id = v_sol AND documentos = '[]'::jsonb;
  IF NOT FOUND THEN RAISE EXCEPTION '2: documentos no arrancó en []'; END IF;
  RAISE NOTICE '2  OK    documentos arranca en [] (las filas viejas quedan legibles)';

  -- ── 3: tope de 8 adjuntos ─────────────────────────────────────────────────
  BEGIN
    UPDATE public.solicitud_renta_unidad
       SET documentos = (SELECT jsonb_agg(jsonb_build_object('path', i::text, 'nombre', i::text))
                           FROM generate_series(1, 9) i)
     WHERE id = v_sol;
    RAISE EXCEPTION '3: aceptó 9 adjuntos';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '3  OK    el jsonb de adjuntos corta en 8';

  -- ── 4: día de pago dentro de rango ────────────────────────────────────────
  BEGIN
    UPDATE public.solicitud_renta_unidad SET dia_pago = 31 WHERE id = v_sol;
    RAISE EXCEPTION '4: aceptó día de pago 31';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '4  OK    día de pago acotado a 1-28 (como el contrato)';

  -- ── 5: la fecha fin no puede anteceder al inicio ──────────────────────────
  BEGIN
    UPDATE public.solicitud_renta_unidad
       SET fecha_inicio = '2026-09-01', fecha_fin = '2026-08-01' WHERE id = v_sol;
    RAISE EXCEPTION '5: aceptó un período invertido';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE '5  OK    fecha_fin >= fecha_inicio';

  DELETE FROM public.solicitud_renta_unidad WHERE id = v_sol;

  -- ── 6-7: el portal no se auto-enlaza un contrato ──────────────────────────
  SELECT pg_get_expr(pol.polwithcheck, pol.polrelid) INTO v_txt
    FROM pg_policy pol
    JOIN pg_class rel ON rel.oid = pol.polrelid
   WHERE rel.relname = 'solicitud_renta_unidad'
     AND pol.polname = 'solicitud_renta_cliente_insert';
  IF v_txt IS NULL OR v_txt NOT LIKE '%contrato_id IS NULL%' THEN
    RAISE EXCEPTION '6: la policy del cliente no exige contrato_id IS NULL (%)', v_txt;
  END IF;
  RAISE NOTICE '6  OK    la policy de insert del portal exige contrato_id IS NULL';

  IF v_txt NOT LIKE '%pendiente%' THEN
    RAISE EXCEPTION '7: la policy perdió el gate de estado pendiente';
  END IF;
  RAISE NOTICE '7  OK    y conserva el gate de estado pendiente (20260518000012)';

  -- ── 8-10: aprobar crea el contrato con los datos enviados ─────────────────
  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta,
    arrendatario_nombre, arrendatario_identificacion, arrendatario_telefono,
    monto_renta, deposito, dia_pago, fecha_inicio, fecha_fin, notas_contrato,
    documentos
  ) VALUES (
    CO_A, P1, U1, CLI, 'ambas',
    '  Luis de la Roca  ', '4545656565', '+502 5555-5555',
    5000, 5000, 5, '2026-09-01', '2027-09-01', 'Sin mascotas',
    '[{"path":"u1/x-contrato.pdf","nombre":"contrato.pdf","etiqueta":"Contrato firmado"}]'::jsonb
  ) RETURNING id INTO v_sol;

  PERFORM set_config('app.uid', ADMIN::text, true);
  v_res := public.aprobar_solicitud_renta(v_sol, 'ambas', 'Todo en orden', 'Admin Uno', true);

  IF NOT (v_res->>'contrato_creado')::boolean THEN
    RAISE EXCEPTION '8: no creó el contrato';
  END IF;
  RAISE NOTICE '8  OK    aprobar creó el contrato de arrendamiento';

  SELECT * INTO v_con FROM public.contratos_arrendamiento WHERE id = (v_res->>'contrato_id')::uuid;
  IF v_con.arrendatario_nombre <> 'Luis de la Roca'
     OR v_con.monto_renta <> 5000 OR v_con.dia_pago <> 5
     OR v_con.fecha_inicio <> DATE '2026-09-01' OR v_con.fecha_fin <> DATE '2027-09-01'
     OR v_con.deposito <> 5000 OR v_con.notas <> 'Sin mascotas'
     OR v_con.unidad_id <> U1 OR v_con.company_id <> CO_A OR v_con.project_id <> P1
     OR v_con.estado <> 'activo' THEN
    RAISE EXCEPTION '9: el contrato no copió los datos de la solicitud (%)', to_jsonb(v_con);
  END IF;
  RAISE NOTICE '9  OK    copió los datos 1:1 (y recortó el nombre) en estado activo';

  PERFORM 1 FROM public.solicitud_renta_unidad
   WHERE id = v_sol AND estado = 'aprobada' AND tipo_aprobado = 'ambas'
     AND contrato_id = v_con.id AND aprobado_por = 'Admin Uno'
     AND comentario_admin = 'Todo en orden' AND fecha_resolucion IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '10: la solicitud no quedó resuelta y enlazada'; END IF;
  RAISE NOTICE '10 OK    la solicitud queda aprobada y enlazada al contrato';

  -- ── 11: se puede aprobar SIN crear contrato ───────────────────────────────
  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta,
    arrendatario_nombre, monto_renta, fecha_inicio
  ) VALUES (CO_A, P1, U2, CLI, 'arrendamiento', 'Ana Pérez', 3000, '2026-10-01')
  RETURNING id INTO v_sol;

  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, 'Admin Uno', false);
  IF (v_res->>'contrato_creado')::boolean THEN RAISE EXCEPTION '11: creó el contrato pese al false'; END IF;
  PERFORM 1 FROM public.solicitud_renta_unidad WHERE id = v_sol AND estado = 'aprobada' AND contrato_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '11: no aprobó sin contrato'; END IF;
  RAISE NOTICE '11 OK    p_crear_contrato=false autoriza sin crear contrato';

  -- ── 12: con STR el contrato de arrendamiento no aplica ────────────────────
  UPDATE public.solicitud_renta_unidad SET estado = 'baja' WHERE unidad_id = U2;
  INSERT INTO public.solicitud_renta_unidad (
    company_id, project_id, unidad_id, cliente_id, tipo_renta,
    arrendatario_nombre, monto_renta, fecha_inicio
  ) VALUES (CO_A, P1, U2, CLI, 'str', 'Ana Pérez', 3000, '2026-10-01')
  RETURNING id INTO v_sol;

  v_res := public.aprobar_solicitud_renta(v_sol, 'str', NULL, 'Admin Uno', true);
  IF (v_res->>'contrato_creado')::boolean THEN RAISE EXCEPTION '12: creó contrato para STR'; END IF;
  RAISE NOTICE '12 OK    con STR no se crea contrato de arrendamiento';

  -- ── 13: sin los datos NOT NULL del contrato, aprueba pero no crea ─────────
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, tipo_renta)
  VALUES (CO_A, P1, U3, CLI, 'arrendamiento') RETURNING id INTO v_sol;

  v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, 'Admin Uno', true);
  IF (v_res->>'contrato_creado')::boolean THEN RAISE EXCEPTION '13: creó contrato sin datos'; END IF;
  PERFORM 1 FROM public.solicitud_renta_unidad WHERE id = v_sol AND estado = 'aprobada';
  IF NOT FOUND THEN RAISE EXCEPTION '13: la aprobación debía valer igual'; END IF;
  RAISE NOTICE '13 OK    sin datos completos autoriza igual, sin crear contrato';

  -- ── 14: no se resuelve dos veces la misma solicitud ───────────────────────
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, 'Admin Uno', true);
    RAISE EXCEPTION '14: aprobó una solicitud ya resuelta';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '14:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '14 OK    una solicitud ya resuelta no se re-aprueba';

  -- ── 15-16: la ACL del RPC ─────────────────────────────────────────────────
  UPDATE public.solicitud_renta_unidad SET estado = 'baja' WHERE unidad_id = U3;
  INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, tipo_renta)
  VALUES (CO_A, P1, U3, CLI, 'arrendamiento') RETURNING id INTO v_sol;

  PERFORM set_config('app.uid', DUENO::text, true);
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, NULL, true);
    RAISE EXCEPTION '15: el propietario aprobó su propia solicitud';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '15:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '15 OK    el propietario no puede auto-aprobarse';

  PERFORM set_config('app.uid', AJENO::text, true);
  BEGIN
    v_res := public.aprobar_solicitud_renta(v_sol, 'arrendamiento', NULL, NULL, true);
    RAISE EXCEPTION '16: un admin de otra empresa resolvió la solicitud';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '16:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE '16 OK    la resolución no cruza empresas';

  PERFORM set_config('app.uid', '', true);
END $$;

-- ── 17: anon no puede ejecutar el RPC ───────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.aprobar_solicitud_renta(uuid,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '17: anon puede ejecutar el RPC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.aprobar_solicitud_renta(uuid,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '17: authenticated no puede ejecutar el RPC';
  END IF;
  RAISE NOTICE '17 OK    anon revocado, authenticated con EXECUTE';
END $$;
