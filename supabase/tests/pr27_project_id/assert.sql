\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Helper: cada bloque RAISE EXCEPTION si la invariante no se cumple.
DO $$
DECLARE n bigint; v uuid;
BEGIN
  -- ── 1. BACKFILL: cada hija hereda el project_id de su padre ──────────────
  SELECT project_id INTO v FROM public.movimientos_caja WHERE concepto = 'proyecto 1';
  IF v <> '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION '1a: backfill mal: % (esperado proyecto 1)', v; END IF;

  SELECT project_id INTO v FROM public.movimientos_caja WHERE concepto = 'proyecto 2';
  IF v <> '22222222-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION '1b: backfill mal: % (esperado proyecto 2)', v; END IF;

  SELECT project_id INTO v FROM public.movimientos_caja WHERE concepto = 'otro tenant';
  IF v <> '33333333-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION '1c: backfill mal en el otro tenant: %', v; END IF;
  RAISE NOTICE 'OK 1  backfill deriva el project_id correcto del padre';

  -- Ninguna fila quedó sin project_id en ninguna de las 5 tablas
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.movimientos_caja           WHERE project_id IS NULL
    UNION ALL SELECT 1 FROM public.cuotas_plan_pago           WHERE project_id IS NULL
    UNION ALL SELECT 1 FROM public.reservas_amenidades        WHERE project_id IS NULL
    UNION ALL SELECT 1 FROM public.movimientos_suministro     WHERE project_id IS NULL
    UNION ALL SELECT 1 FROM public.registro_asistentes_evento WHERE project_id IS NULL) x;
  IF n <> 0 THEN RAISE EXCEPTION '2: % filas con project_id NULL', n; END IF;
  RAISE NOTICE 'OK 2  cero filas con project_id NULL tras el backfill';

  -- ── 3. LA COLUMNA ES NOT NULL en las 5 ───────────────────────────────────
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND column_name='project_id' AND is_nullable='NO'
     AND table_name IN ('movimientos_caja','cuotas_plan_pago','reservas_amenidades',
                        'movimientos_suministro','registro_asistentes_evento');
  IF n <> 5 THEN RAISE EXCEPTION '3: solo % de 5 columnas son NOT NULL', n; END IF;
  RAISE NOTICE 'OK 3  las 5 columnas quedaron NOT NULL';

  -- ── 4. ÍNDICE creado en las 5 ────────────────────────────────────────────
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='public' AND indexname LIKE 'idx_%_project_company';
  IF n <> 5 THEN RAISE EXCEPTION '4: solo % de 5 índices', n; END IF;
  RAISE NOTICE 'OK 4  los 5 índices (project_id, company_id) existen';

  -- ── 5. TRIGGER: el INSERT sin project_id lo deriva del padre ─────────────
  INSERT INTO public.movimientos_caja (company_id, caja_id, tipo, concepto, monto)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ca222222-0000-0000-0000-000000000002','ingreso','nuevo sin pid',10.00);
  SELECT project_id INTO v FROM public.movimientos_caja WHERE concepto='nuevo sin pid';
  IF v <> '22222222-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION '5: el trigger no derivó el project_id: %', v; END IF;
  RAISE NOTICE 'OK 5  INSERT sin project_id: el trigger lo deriva del padre';

  -- ── 6. TRIGGER: IGNORA el project_id que manda el cliente ────────────────
  -- Es el punto del diseño: el padre es la verdad, no el payload.
  INSERT INTO public.movimientos_caja (company_id, caja_id, tipo, concepto, monto, project_id)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ca111111-0000-0000-0000-000000000001','ingreso','pid mentiroso',10.00,
          '22222222-0000-0000-0000-000000000002');
  SELECT project_id INTO v FROM public.movimientos_caja WHERE concepto='pid mentiroso';
  IF v <> '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION '6: el trigger RESPETÓ el project_id del cliente (%), debía imponer el del padre', v; END IF;
  RAISE NOTICE 'OK 6  INSERT con project_id falso: el trigger lo sobrescribe con el del padre';

  -- ── 7. TRIGGER: UPDATE directo de project_id se re-deriva ────────────────
  UPDATE public.movimientos_caja SET project_id='22222222-0000-0000-0000-000000000002'
   WHERE concepto='pid mentiroso';
  SELECT project_id INTO v FROM public.movimientos_caja WHERE concepto='pid mentiroso';
  IF v <> '11111111-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION '7: un UPDATE directo movió la fila de proyecto: %', v; END IF;
  RAISE NOTICE 'OK 7  UPDATE directo de project_id: se re-deriva del padre';

  -- ── 8. TRIGGER: rechaza colgar de un padre de OTRO tenant ────────────────
  BEGIN
    INSERT INTO public.movimientos_caja (company_id, caja_id, tipo, concepto, monto)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ca333333-0000-0000-0000-000000000003','ingreso','cross-tenant',1.00);
    RAISE EXCEPTION '8: se ACEPTÓ un INSERT contra una caja de otro tenant';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 8  INSERT con caja_id de otro tenant: rechazado';
  END;

  -- ── 9. Las otras 4 tablas también derivan ────────────────────────────────
  INSERT INTO public.cuotas_plan_pago (company_id, plan_id, numero, monto, fecha_vencimiento)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','d2222222-0000-0000-0000-000000000002',2,10,'2026-09-01');
  SELECT project_id INTO v FROM public.cuotas_plan_pago WHERE numero=2;
  IF v <> '22222222-0000-0000-0000-000000000002' THEN RAISE EXCEPTION '9a: cuotas_plan_pago: %', v; END IF;

  INSERT INTO public.reservas_amenidades (company_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','aa111111-0000-0000-0000-000000000001','dd111111-0000-0000-0000-000000000001','2026-09-09','08:00','09:00');
  SELECT project_id INTO v FROM public.reservas_amenidades WHERE fecha='2026-09-09';
  IF v <> '11111111-0000-0000-0000-000000000001' THEN RAISE EXCEPTION '9b: reservas_amenidades: %', v; END IF;

  INSERT INTO public.movimientos_suministro (company_id, suministro_id, cantidad)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','5b111111-0000-0000-0000-000000000001',9.00);
  SELECT project_id INTO v FROM public.movimientos_suministro WHERE cantidad=9.00;
  IF v <> '22222222-0000-0000-0000-000000000002' THEN RAISE EXCEPTION '9c: movimientos_suministro: %', v; END IF;

  INSERT INTO public.registro_asistentes_evento (company_id, evento_id, unidad_id, nombre)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001','ef111111-0000-0000-0000-000000000001','dd111111-0000-0000-0000-000000000001','Beto')
  ON CONFLICT (evento_id, unidad_id) DO NOTHING;
  SELECT project_id INTO v FROM public.registro_asistentes_evento LIMIT 1;
  IF v <> '11111111-0000-0000-0000-000000000001' THEN RAISE EXCEPTION '9d: registro_asistentes_evento: %', v; END IF;
  RAISE NOTICE 'OK 9  las 5 tablas derivan project_id en INSERT';

  -- ── 10. EL BUG ORIGINAL, reproducido: filtrar por proyecto ya SEPARA ─────
  SELECT count(*) INTO n FROM public.movimientos_caja
   WHERE company_id='aaaaaaaa-0000-0000-0000-000000000001'
     AND project_id='11111111-0000-0000-0000-000000000001';
  IF n <> 2 THEN RAISE EXCEPTION '10a: el proyecto 1 debía ver 2 movimientos, ve %', n; END IF;
  SELECT count(*) INTO n FROM public.movimientos_caja
   WHERE company_id='aaaaaaaa-0000-0000-0000-000000000001';
  IF n <> 4 THEN RAISE EXCEPTION '10b: filtrando SOLO por empresa debían salir 4 (el bug), salen %', n; END IF;
  RAISE NOTICE 'OK 10 el filtro por empresa ve 4 movimientos (el bug) y por proyecto ve 2 (el arreglo)';
END $$;
