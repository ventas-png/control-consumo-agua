\set ON_ERROR_STOP on
-- Invariantes de 20261231000300 (fondo de reserva con póliza y caja chica de fondo fijo).
-- Padrón: el de fail_open_sin_perfil. Empresa D, proyecto D1. OPE_D lleva el rol
-- «Finanzas / Contador» (asignado a D1); VIS_D no tiene rol.

CREATE OR REPLACE FUNCTION fos.como(p_actor text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM fos.poner_actor(p_actor);
  BEGIN
    EXECUTE p_sql INTO v;
  EXCEPTION WHEN OTHERS THEN
    v := '!' || SQLSTATE || ' ' || SQLERRM;
  END;
  PERFORM fos.poner_actor('SISTEMA');
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION fos.saldo(p_cuenta uuid) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE l.cuenta_id = p_cuenta AND a.estado = 'publicado'
$$;
CREATE OR REPLACE FUNCTION fos.fondo(p_actor text, p_tipo text, p_monto numeric, p_fecha date, p_fondo uuid, p_contra uuid)
RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    $q$SELECT saldo_fondo::text FROM public.conta_fondo_reserva_traslado(%L, %L, %L, %L, 'Prueba', %L, %L)$q$,
    fos.id('D1'), p_tipo, p_monto, p_fecha, p_fondo, p_contra))
$$;
CREATE OR REPLACE FUNCTION fos.reponer(p_actor text, p_caja uuid, p_fecha date, p_banco uuid, p_lineas jsonb, p_aplicar boolean)
RETURNS text LANGUAGE sql AS $$
  SELECT fos.como(p_actor, format(
    $q$SELECT string_agg(monto || ':' || resultado, ' ' ORDER BY monto)
         FROM public.conta_caja_chica_reponer(%L, %L, %L, %L::jsonb, %L)$q$,
    p_caja, p_fecha, p_banco, p_lineas, p_aplicar))
$$;

DO $$
DECLARE
  d uuid := fos.id('D'); d1 uuid := fos.id('D1');
  banco uuid; fondo uuid; cajac uuid; gasto1 uuid; gasto2 uuid; ingreso uuid; titulo uuid;
  caja uuid := gen_random_uuid(); v1 uuid := gen_random_uuid(); v2 uuid := gen_random_uuid(); v3 uuid := gen_random_uuid();
  r text; x public.conta_asientos; v_n int; v_repo uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = d AND project_id = d1) THEN
    r := fos.como('OWN_D', format($q$SELECT count(*)::text FROM public.conta_inicializar_catalogo('basico', %L)$q$, d1));
    IF r LIKE '!%' THEN RAISE EXCEPTION 'no se pudo sembrar el catálogo de D1: %', r; END IF;
  END IF;
  -- Cuentas propias de la prueba: banco operativo, banco del fondo, caja chica, dos gastos, un ingreso y un título.
  banco := gen_random_uuid(); fondo := gen_random_uuid(); cajac := gen_random_uuid();
  gasto1 := gen_random_uuid(); gasto2 := gen_random_uuid(); ingreso := gen_random_uuid(); titulo := gen_random_uuid();
  INSERT INTO public.conta_cuentas (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
    (titulo,  d, d1, 'Z9',     'Título de prueba',        'activo',  'deudora',   1, false, true),
    (banco,   d, d1, 'Z9-01',  'Banco operativo',         'activo',  'deudora',   2, true,  true),
    (fondo,   d, d1, 'Z9-02',  'Banco fondo de reserva',  'activo',  'deudora',   2, true,  true),
    (cajac,   d, d1, 'Z9-03',  'Caja chica',              'activo',  'deudora',   2, true,  true),
    (gasto1,  d, d1, 'Z9-51',  'Mantenimiento menor',     'gasto',   'deudora',   2, true,  true),
    (gasto2,  d, d1, 'Z9-52',  'Transporte y mensajería', 'gasto',   'deudora',   2, true,  true),
    (ingreso, d, d1, 'Z9-41',  'Intereses ganados',       'ingreso', 'acreedora', 2, true,  true);

  -- ══ FONDO DE RESERVA ═══════════════════════════════════════════════════════
  -- ── 1 · aportación y rendimiento entran; cada una con su movimiento y su póliza ──
  r := fos.fondo('OWN_D', 'aportacion', 5000, DATE '2026-03-31', fondo, banco);
  IF r <> '5000.00' THEN RAISE EXCEPTION 'aportación: %', r; END IF;
  SELECT * INTO x FROM public.conta_asientos WHERE origen_tabla = 'fondo_reserva' AND origen_evento = 'fondo_aportacion';
  IF x.estado <> 'publicado' OR x.fecha <> DATE '2026-03-31' OR x.total_debe <> 5000 OR x.project_id <> d1
     OR NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = fondo AND debe = 5000)
     OR NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = banco AND haber = 5000)
     OR NOT EXISTS (SELECT 1 FROM public.fondo_reserva WHERE id = x.origen_id AND tipo = 'aportacion' AND monto = 5000 AND fecha = DATE '2026-03-31') THEN
    RAISE EXCEPTION 'la aportación debía dejar su movimiento y Dr fondo / Cr banco por 5,000'; END IF;
  r := fos.fondo('OWN_D', 'rendimiento', 120.555, DATE '2026-04-30', fondo, ingreso);
  IF r <> '5120.56' THEN RAISE EXCEPTION 'rendimiento: %', r; END IF;
  RAISE NOTICE '✓ 1 · aportación (Dr fondo / Cr banco) y rendimiento (Dr fondo / Cr ingreso) dejan movimiento y póliza publicada; el saldo del fondo sube a 5,120.56';

  -- ── 2 · el retiro sale del fondo y no puede superarlo ─────────────────────
  r := fos.fondo('OWN_D', 'retiro', 6000, DATE '2026-05-10', fondo, gasto1);
  IF r NOT LIKE '!23514%supera el saldo%' THEN RAISE EXCEPTION 'retiro mayor que el fondo: %', r; END IF;
  r := fos.fondo('OWN_D', 'retiro', 1120.56, DATE '2026-05-10', fondo, gasto1);
  IF r <> '4000.00' OR fos.saldo(fondo) <> 4000 OR fos.saldo(gasto1) <> 1120.56 THEN
    RAISE EXCEPTION 'retiro: % (fondo %, gasto %)', r, fos.saldo(fondo), fos.saldo(gasto1); END IF;
  IF (SELECT count(*) FROM public.fondo_reserva WHERE project_id = d1) <> 3 THEN RAISE EXCEPTION 'el retiro rechazado no debía dejar movimiento'; END IF;
  RAISE NOTICE '✓ 2 · el retiro va Dr contrapartida / Cr fondo; uno mayor que el saldo en libros se rechaza sin dejar rastro';

  -- ── 3 · el resumen compara el registro con los libros ─────────────────────
  INSERT INTO public.fondo_reserva (company_id, project_id, tipo, concepto, monto, fecha)
    VALUES (d, d1, 'aportacion', 'Capturado directo en Condominios', 300, DATE '2026-05-15');
  r := fos.como('OPE_D', format($q$SELECT concat_ws('|', cuenta_fondo_id = %L, cuenta_contra_id = %L, saldo_registro, saldo_libros, movimientos, movimientos_sin_poliza)
                                     FROM public.conta_fondo_reserva_resumen(%L)$q$, fondo, gasto1, d1));
  IF r <> 't|t|4300.00|4000.00|4|1' THEN RAISE EXCEPTION 'resumen del fondo: %', r; END IF;
  RAISE NOTICE '✓ 3 · el resumen propone las cuentas usadas la última vez y delata la diferencia: registro 4,300 · libros 4,000 · 1 movimiento sin póliza';

  -- ── 4 · validaciones del fondo ────────────────────────────────────────────
  IF fos.fondo('OWN_D', 'ajuste', 10, DATE '2026-05-10', fondo, banco) NOT LIKE '!22023%'
     OR fos.fondo('OWN_D', 'aportacion', 0, DATE '2026-05-10', fondo, banco) NOT LIKE '!23514%'
     OR fos.fondo('OWN_D', 'aportacion', 10, CURRENT_DATE + 1, fondo, banco) NOT LIKE '!23514%futura%'
     OR fos.fondo('OWN_D', 'aportacion', 10, DATE '2026-05-10', fondo, fondo) NOT LIKE '!23514%'
     OR fos.fondo('OWN_D', 'aportacion', 10, DATE '2026-05-10', fondo, titulo) NOT LIKE '!23514%'
     OR fos.fondo('OWN_D', 'aportacion', 10, DATE '2026-05-10', gasto1, banco) NOT LIKE '!23514%activo%'
     OR fos.fondo('OWN_D', 'aportacion', 10, DATE '2026-05-10', fondo, gen_random_uuid()) NOT LIKE '!23514%' THEN
    RAISE EXCEPTION 'validaciones del fondo: alguna no se rechazó'; END IF;
  IF fos.fondo('VIS_D', 'aportacion', 10, DATE '2026-05-10', fondo, banco) NOT LIKE '!42501%'
     OR fos.fondo('OWN_C', 'aportacion', 10, DATE '2026-05-10', fondo, banco) NOT LIKE '!42501%'
     OR fos.como('VIS_D', format('SELECT count(*)::text FROM public.conta_fondo_reserva_resumen(%L)', d1)) NOT LIKE '!42501%'
     OR fos.como('OWN_C', format('SELECT count(*)::text FROM public.conta_fondo_reserva_resumen(%L)', d1)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'permisos del fondo: sin permiso u otra empresa debía dar 42501'; END IF;
  RAISE NOTICE '✓ 4 · rechaza tipo inválido, monto cero, fecha futura, cuentas iguales, de título, ajenas o fondo que no es activo; sin permiso u otra empresa: 42501';

  -- ══ CAJA CHICA ═════════════════════════════════════════════════════════════
  INSERT INTO public.caja_chica (id, company_id, project_id, fecha_apertura, monto_inicial, responsable)
    VALUES (caja, d, d1, DATE '2026-06-01', 1000, 'Conserje');
  INSERT INTO public.movimientos_caja (id, company_id, caja_id, project_id, tipo, concepto, monto, comprobante, fecha) VALUES
    (v1, d, caja, d1, 'egreso', 'Bombillas', 150.25, 'F-101', DATE '2026-06-05'),
    (v2, d, caja, d1, 'egreso', 'Taxi mensajería', 80, NULL, DATE '2026-06-12'),
    (v3, d, caja, d1, 'egreso', 'Sin clasificar', 40, NULL, DATE '2026-06-20');

  -- ── 5 · constituir el fondo, una sola vez ─────────────────────────────────
  r := fos.reponer('OWN_D', caja, DATE '2026-06-30', banco, '[]', true);
  IF r NOT LIKE '!23514%constituye el fondo%' THEN RAISE EXCEPTION 'reponer sin fondo constituido: %', r; END IF;
  r := fos.como('OWN_D', format('SELECT public.conta_caja_chica_constituir(%L, %L, %L, %L)::text', caja, DATE '2026-06-01', cajac, banco));
  IF r LIKE '!%' THEN RAISE EXCEPTION 'constituir: %', r; END IF;
  IF fos.saldo(cajac) <> 1000 OR (SELECT cuenta_caja_id FROM public.caja_chica WHERE id = caja) <> cajac THEN
    RAISE EXCEPTION 'el fondo debía quedar en 1,000 en la cuenta de caja chica'; END IF;
  r := fos.como('OWN_D', format('SELECT public.conta_caja_chica_constituir(%L, %L, %L, %L)::text', caja, DATE '2026-06-01', cajac, banco));
  IF r NOT LIKE '!23514%ya está constituido%' THEN RAISE EXCEPTION 'constituir dos veces: %', r; END IF;
  RAISE NOTICE '✓ 5 · el fondo fijo se constituye una vez (Dr caja chica 1,000 / Cr banco) y sin él no se repone';

  -- ── 6 · la reposición previsualiza sin escribir ───────────────────────────
  r := fos.reponer('OPE_D', caja, DATE '2026-06-30', banco,
         jsonb_build_array(jsonb_build_object('movimiento_id', v1, 'cuenta_gasto_id', gasto1),
                           jsonb_build_object('movimiento_id', v2, 'cuenta_gasto_id', gasto2)), false);
  IF r <> '40.00:sin_cuenta 80.00:previsualizacion 150.25:previsualizacion' THEN RAISE EXCEPTION 'vista previa de la reposición: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.conta_caja_reposiciones) OR EXISTS (SELECT 1 FROM public.movimientos_caja WHERE caja_id = caja AND (reposicion_id IS NOT NULL OR cuenta_gasto_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'previsualizar la reposición no debía escribir'; END IF;
  RAISE NOTICE '✓ 6 · la vista previa lista los vales pendientes con su cuenta, marca el que no la tiene y no escribe nada';

  -- el contador ve la caja desde Contabilidad aunque no tenga la pestaña de Condominios
  r := fos.como('OPE_D', format($q$SELECT concat_ws('|', responsable, monto_fondo, estado, cuenta_caja_id = %L, vales_pendientes, total_pendiente)
                                     FROM public.conta_cajas_chicas(%L)$q$, cajac, d1));
  IF r <> 'Conserje|1000.00|abierta|t|3|270.25' THEN RAISE EXCEPTION 'lista de cajas: %', r; END IF;
  IF fos.como('VIS_D', format('SELECT count(*)::text FROM public.conta_cajas_chicas(%L)', d1)) NOT LIKE '!42501%'
     OR fos.como('OWN_C', format('SELECT count(*)::text FROM public.conta_cajas_chicas(%L)', d1)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'lista de cajas: sin permiso u otra empresa debía dar 42501'; END IF;

  -- ── 7 · reponer: UNA póliza gastos / banco; la cuenta de caja chica no se mueve ──
  r := fos.reponer('OWN_D', caja, DATE '2026-06-30', banco,
         jsonb_build_array(jsonb_build_object('movimiento_id', v1, 'cuenta_gasto_id', gasto1),
                           jsonb_build_object('movimiento_id', v2, 'cuenta_gasto_id', gasto2)), true);
  IF r <> '40.00:sin_cuenta 80.00:repuesto 150.25:repuesto' THEN RAISE EXCEPTION 'reposición: %', r; END IF;
  SELECT id INTO v_repo FROM public.conta_caja_reposiciones WHERE caja_id = caja;
  SELECT * INTO x FROM public.conta_asientos WHERE origen_tabla = 'conta_caja_reposiciones' AND origen_id = v_repo;
  IF x.estado <> 'publicado' OR x.total_debe <> 230.25 OR x.fecha <> DATE '2026-06-30'
     OR (SELECT total FROM public.conta_caja_reposiciones WHERE id = v_repo) <> 230.25
     OR NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = gasto1 AND debe = 150.25 AND descripcion = 'Bombillas · F-101')
     OR NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = gasto2 AND debe = 80)
     OR NOT EXISTS (SELECT 1 FROM public.conta_asiento_lineas WHERE asiento_id = x.id AND cuenta_id = banco AND haber = 230.25) THEN
    RAISE EXCEPTION 'la póliza de la reposición no es la esperada (% / %)', x.estado, x.total_debe; END IF;
  IF fos.saldo(cajac) <> 1000 THEN RAISE EXCEPTION 'la cuenta de caja chica no debía moverse: %', fos.saldo(cajac); END IF;
  IF (SELECT count(*) FROM public.movimientos_caja WHERE caja_id = caja AND reposicion_id = v_repo AND tipo = 'egreso') <> 2
     OR NOT EXISTS (SELECT 1 FROM public.movimientos_caja WHERE caja_id = caja AND reposicion_id = v_repo AND tipo = 'ingreso' AND monto = 230.25)
     OR (SELECT reposicion_id FROM public.movimientos_caja WHERE id = v3) IS NOT NULL THEN
    RAISE EXCEPTION 'los dos vales quedan sellados, la caja recibe el ingreso y el vale sin cuenta sigue pendiente'; END IF;
  -- repetir: sólo queda el vale sin cuenta; no hay segunda reposición
  r := fos.reponer('OWN_D', caja, DATE '2026-06-30', banco, '[]', true);
  IF r <> '40.00:sin_cuenta' OR (SELECT count(*) FROM public.conta_caja_reposiciones WHERE caja_id = caja) <> 1 THEN
    RAISE EXCEPTION 'repetir la reposición no debía duplicar: %', r; END IF;
  RAISE NOTICE '✓ 7 · la reposición lleva los vales al gasto en UNA póliza contra el banco (230.25), la caja recibe su ingreso, la cuenta «Caja chica» sigue en 1,000 y repetir no duplica';

  -- ── 8 · un vale repuesto no se borra ni se cambia; el pendiente sí ────────
  BEGIN
    DELETE FROM public.movimientos_caja WHERE id = v1;
    RAISE EXCEPTION 'un vale repuesto no debía poder borrarse';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.movimientos_caja SET monto = 1 WHERE id = v1;
    RAISE EXCEPTION 'un vale repuesto no debía poder cambiar de importe';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.movimientos_caja SET concepto = 'Bombillas LED' WHERE id = v1;   -- el texto sí
  UPDATE public.movimientos_caja SET monto = 45 WHERE id = v3;                   -- el pendiente sí
  RAISE NOTICE '✓ 8 · un vale ya repuesto no se elimina ni cambia de importe; uno pendiente se corrige con libertad';

  -- ── 9 · permisos, alcance, RLS y ACL ──────────────────────────────────────
  IF fos.reponer('VIS_D', caja, DATE '2026-06-30', banco, '[]', false) NOT LIKE '!42501%'
     OR fos.reponer('OWN_C', caja, DATE '2026-06-30', banco, '[]', false) NOT LIKE '!42501%'
     OR fos.reponer('OWN_D', gen_random_uuid(), DATE '2026-06-30', banco, '[]', false) NOT LIKE '!42501%'
     OR fos.como('OWN_C', format('SELECT public.conta_caja_chica_constituir(%L, %L, %L, %L)::text', caja, DATE '2026-06-01', cajac, banco)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'caja chica: sin permiso, otra empresa o caja inexistente debía dar 42501'; END IF;
  INSERT INTO public.role_permissions (role_id, permission_key, effect)
    VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.change_status', 'deny');
  IF fos.reponer('OPE_D', caja, DATE '2026-06-30', banco, '[]', true) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'sin «cambiar estado» no se repone'; END IF;
  DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
  IF fos.como('OWN_D', 'SELECT count(*)::text FROM public.conta_caja_reposiciones') <> '1'
     OR fos.como('OWN_C', 'SELECT count(*)::text FROM public.conta_caja_reposiciones') <> '0'
     OR fos.como('VIS_D', 'SELECT count(*)::text FROM public.conta_caja_reposiciones') <> '0'
     OR fos.como('OWN_D', format('INSERT INTO public.conta_caja_reposiciones (company_id, project_id, caja_id, fecha, total, cuenta_banco_id) VALUES (%L, %L, %L, CURRENT_DATE, 1, %L) RETURNING id::text', d, d1, caja, banco)) NOT LIKE '!42501%' THEN
    RAISE EXCEPTION 'RLS de reposiciones: la empresa dueña con permiso lee; nadie escribe directo'; END IF;
  SELECT count(*) INTO v_n FROM (VALUES
    ('public.conta_fondo_reserva_traslado(uuid, text, numeric, date, text, uuid, uuid, text)'),
    ('public.conta_fondo_reserva_resumen(uuid)'),
    ('public.conta_cajas_chicas(uuid)'),
    ('public.conta_caja_chica_constituir(uuid, date, uuid, uuid)'),
    ('public.conta_caja_chica_reponer(uuid, date, uuid, jsonb, boolean)')) f(s)
   WHERE has_function_privilege('anon', f.s, 'EXECUTE') OR NOT has_function_privilege('authenticated', f.s, 'EXECUTE');
  IF v_n <> 0 OR has_function_privilege('authenticated', 'public.conta_autorizar_proyecto(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL: anon no ejecuta ninguna; authenticated las cinco públicas y no el auxiliar'; END IF;
  RAISE NOTICE '✓ 9 · sin permiso, otra empresa o caja inexistente: 42501; sin «cambiar estado» no se repone; las reposiciones se leen por RLS y sólo se escriben por la función; anon no ejecuta';
END $$;
