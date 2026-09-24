-- ============================================================================
-- COBROS DE CUOTAS POR TIPO · invariantes de una sesión (20261002000100)
--
-- Documentos, cobros y configuración los crean usuarios de la aplicación (SET
-- ROLE authenticated + request.jwt.claim.sub). El estado se lee con RESET ROLE.
-- Sólo el cierre de períodos, el devengo simulado en borrador y la cuota
-- anterior a la contabilización por tipo se preparan como superusuario.
--
-- Los cobros de una misma cuota se ordenan por (verified_at, id): los ids van
-- en orden creciente para que el orden no dependa del reloj.
-- ============================================================================

-- ── 0 · superficie ──────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY[
     'public.conta_contabilizar_cobro_interno(uuid, text)',
     'public.conta_contabilizar_cobro_seguro(uuid, text)',
     'public.conta_reprocesar_un_cobro(uuid, uuid)',
     'public.conta_cobro_cuota_por_tipo(uuid)',
     'public.conta_fecha_evento_cargo(text, uuid, text)']) f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')), 0,
  '0 · las funciones internas de cobros no son invocables por la aplicación');
SELECT public.chk(has_table_privilege('authenticated', 'public.conta_cobro_aplicaciones', 'INSERT')::int, 0,
  '0 · las aplicaciones de cobros no se escriben desde la aplicación');
SELECT public.chk(has_table_privilege('authenticated', 'public.conta_cobro_aplicaciones', 'SELECT')::int, 1,
  '0 · …pero se leen (con RLS)');

SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);

-- ── 1 · cobro ANTES de que su cuota se contabilice ──────────────────────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX cobro antes', 100, '2026-10', 'pendiente', 'mantenimiento');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000001', 100, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cuotas_condominio', 'c2000000-0000-0000-0000-000000000001', 'cuota_emitida'),
  'pendiente/sin_configuracion', '1 · la cuota queda pendiente por configuración');
SELECT public.chk_txt(public.ultimo_intento('pagos', '9b000000-0000-0000-0000-000000000001', 'pago_contabilizado'),
  'pendiente/devengo_pendiente', '1 · su cobro queda PENDIENTE visible: falta el devengo');
SELECT public.chk(public.n_asientos('pagos', '9b000000-0000-0000-0000-000000000001', 'pago_contabilizado'), 0,
  '1 · …y NO cae al mapeo general (ningún asiento)');
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001', 'devengo_pendiente')
    WHERE origen_tabla = 'pagos' AND origen_id = '9b000000-0000-0000-0000-000000000001' AND evento = 'pago_contabilizado'
      AND monto = 100 AND responsable_id = 'e0000000-0000-0000-0000-00000000a001' AND puede_reprocesar), 1,
  '1 · la bandeja muestra el cobro con su motivo, su responsable y su importe');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado || '/' || COALESCE(codigo, '-'), ',') FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-000000000001')),
  'pago_contabilizado:pendiente/devengo_pendiente', '1 · reprocesar el cobro solo, sin devengo, sigue pendiente');
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'mantenimiento',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000001')),
  'cuota_emitida:contabilizada,pago_contabilizado:contabilizada',
  '1 · reprocesar la cuota contabiliza el devengo y DESPUÉS su cobro pendiente');
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000001'), '1-CXC-RES:mantenimiento:100',
  '1 · el cobro abona la CxC del devengo con su tipo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_tabla = 'pagos' AND a.origen_id = '9b000000-0000-0000-0000-000000000001' AND l.haber = 100
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'
      AND l.unidad_id = 'f0000000-0000-0000-0000-00000000a001'), 1,
  '1 · …con el auxiliar y la unidad del devengo');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-00000000a101'), 0,
  '1 · la cuota queda saldada en su CxC');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000001')),
  'cuota_emitida:ya_contabilizada', '1 · reprocesar otra vez la cuota: nada nuevo, y el cobro ya no está pendiente');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-000000000001')),
  'pago_contabilizado:ya_contabilizada', '1 · reprocesar otra vez el cobro: «ya contabilizado»');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')
    WHERE origen_id = '9b000000-0000-0000-0000-000000000001'), 0,
  '1 · y sale de la bandeja');
RESET ROLE;
SELECT public.chk(public.n_asientos('pagos', '9b000000-0000-0000-0000-000000000001', 'pago_contabilizado'), 1,
  '1 · exactamente UN asiento del cobro tras reprocesos repetidos');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id = '9b000000-0000-0000-0000-000000000001'), 1,
  '1 · y UNA aplicación');

-- ── 2 · devengo en BORRADOR ─────────────────────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX borrador', 60, '2026-10', 'pendiente', 'cuota_extraordinaria');
RESET ROLE;
-- Simula el devengo que quedó en borrador (p. ej. sin tipo de cambio): un
-- asiento automático de la cuota, sin publicar, con sus dimensiones.
SELECT set_config('conta.allow_system_write', 'on', false);
INSERT INTO public.conta_asientos
  (id, company_id, project_id, fecha, tipo, concepto, estado, origen, origen_tabla, origen_id, origen_evento, moneda_base)
VALUES ('5b000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
        CURRENT_DATE, 'diario', 'SINT-AUX devengo en borrador', 'borrador', 'automatico', 'cuotas_condominio',
        'c2000000-0000-0000-0000-000000000002', 'cuota_emitida',
        public.conta_moneda_base('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001'));
INSERT INTO public.conta_asiento_lineas
  (asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber, auxiliar_cliente_id, unidad_id, tipo_cargo) VALUES
  ('5b000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11000000-0000-0000-0000-00000000a101', 1, 'SINT-AUX', 60, 0,
   'e0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a001', 'cuota_extraordinaria'),
  ('5b000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11000000-0000-0000-0000-00000000a103', 2, 'SINT-AUX', 0, 60,
   'e0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a001', 'cuota_extraordinaria');
SELECT set_config('conta.allow_system_write', 'off', false);
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000002', 60, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('pagos', '9b000000-0000-0000-0000-000000000002', 'pago_contabilizado'),
  'pendiente/devengo_pendiente', '2 · con el devengo en borrador, el cobro queda pendiente');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = '9b000000-0000-0000-0000-000000000002' AND motivo LIKE '%borrador%'), 1,
  '2 · …y el motivo dice que el devengo está en borrador');
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_publicar_asiento('5b000000-0000-0000-0000-000000000001') WHERE estado = 'publicado'), 1,
  '2 · se publica el devengo desde Pólizas');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-000000000002')),
  'pago_contabilizado:contabilizada', '2 · publicado el devengo, el reproceso del cobro lo contabiliza');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-000000000002')),
  'pago_contabilizado:ya_contabilizada', '2 · y una segunda vez no duplica');
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000002'), '1-CXC-RES:cuota_extraordinaria:60',
  '2 · contra la CxC y el tipo del devengo publicado');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-00000000a101'), 0,
  '2 · la cuota queda saldada');

-- ── 3 · principal y mora con CxC DISTINTAS; abonos parciales; excedente ──────
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'recargo_mora',
   '11000000-0000-0000-0000-00000000a111', '11000000-0000-0000-0000-00000000a110');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX parciales', 100, '2026-10', 'pendiente', 'mantenimiento');
UPDATE public.cuotas_condominio SET mora_monto = 10, total_a_pagar = 110 WHERE id = 'c2000000-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.cuotas_condominio WHERE id = 'c2000000-0000-0000-0000-000000000003' AND mora_aplicada_at IS NOT NULL), 1,
  '3 · la mora puesta sin fecha recibe la suya (sello)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c2000000-0000-0000-0000-000000000003' AND a.origen_evento = 'cuota_mora' AND a.estado = 'publicado'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a111' AND l.debe = 10 AND l.tipo_cargo = 'recargo_mora'), 1,
  '3 · la mora se devenga en SU CxC');
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000003', 6, 'efectivo', 'verificado', now());
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000003', 50, 'efectivo', 'verificado', now());
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000003', 50, 'efectivo', 'verificado', now());
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000003', 10, 'efectivo', 'verificado', now());
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000007', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000003', 4, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000003'), 'CXC-MORA:recargo_mora:6',
  '3 · abono parcial de 6: todo a la mora (mora primero), en la CxC de la mora');
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000004'), 'CXC-MORA:recargo_mora:4,1-CXC-RES:mantenimiento:46',
  '3 · abono de 50: 4 terminan la mora y 46 van al principal, cada uno en su CxC');
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000005'), '1-CXC-RES:mantenimiento:50',
  '3 · abono de 50: todo al principal');
SELECT public.chk_txt(public.ultimo_intento('pagos', '9b000000-0000-0000-0000-000000000006', 'pago_contabilizado'),
  'pendiente/excede_saldo', '3 · un cobro de 10 con saldo 4: pendiente «excede el saldo», sin inventar cuenta');
SELECT public.chk(public.n_asientos('pagos', '9b000000-0000-0000-0000-000000000006', 'pago_contabilizado'), 0,
  '3 · …sin asiento');
SELECT public.chk_txt(public.ultimo_intento('pagos', '9b000000-0000-0000-0000-000000000007', 'pago_contabilizado'),
  'pendiente/cobro_anterior_pendiente', '3 · el cobro siguiente espera al anterior pendiente: el reparto depende del orden');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-00000000a111'), 0,
  '3 · la mora queda saldada en su CxC');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-00000000a101'), 4,
  '3 · y al principal le quedan 4');
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001', 'excede_saldo')
    WHERE origen_id = '9b000000-0000-0000-0000-000000000006'), 1,
  '3 · la bandeja filtra el excedente por su motivo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001', 'otro')
    WHERE origen_id = '9b000000-0000-0000-0000-000000000007' AND codigo = 'cobro_anterior_pendiente'), 1,
  '3 · y el que espera al anterior aparece en «otro»');
UPDATE public.pagos SET estado = 'rechazado' WHERE id = '9b000000-0000-0000-0000-000000000006';
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000003')),
  'cuota_emitida:ya_contabilizada,cuota_mora:ya_contabilizada,pago_contabilizado:contabilizada',
  '3 · rechazado el excedente, reprocesar la cuota contabiliza el cobro que esperaba');
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000007'), '1-CXC-RES:mantenimiento:4',
  '3 · …y termina el principal');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-00000000a101'), 0,
  '3 · cuota saldada: principal 100 y mora 10 cobrados en cuatro abonos');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE cuota_id = 'c2000000-0000-0000-0000-000000000003'), 5,
  '3 · cinco aplicaciones: 6 mora, 4 mora + 46 principal, 50 principal, 4 principal');

-- ── 4 · principal y mora en la MISMA CxC; pago total; el reverso libera ──────
SET ROLE authenticated;
UPDATE public.conta_config_tipo_cargo SET cuenta_cxc_id = '11000000-0000-0000-0000-00000000a101'
 WHERE project_id = 'a1a1a1a1-0000-0000-0000-000000000001' AND tipo_cargo = 'recargo_mora';
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX compartida', 200, '2026-10', 'pendiente', 'mantenimiento');
UPDATE public.cuotas_condominio SET mora_monto = 20, total_a_pagar = 220 WHERE id = 'c2000000-0000-0000-0000-000000000004';
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000008', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000004', 220, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000008'), '1-CXC-RES:recargo_mora:20,1-CXC-RES:mantenimiento:200',
  '4 · CxC compartida: el pago total se abre en dos líneas, una por evento con su tipo');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-00000000a101'), 0,
  '4 · cuota saldada');
SET ROLE authenticated;
UPDATE public.pagos SET estado = 'rechazado' WHERE id = '9b000000-0000-0000-0000-000000000008';
RESET ROLE;
SELECT public.chk(public.n_vivos('pagos', '9b000000-0000-0000-0000-000000000008', 'pago_contabilizado'), 0,
  '4 · rechazar el cobro reversa su asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = '9b000000-0000-0000-0000-000000000008' AND a.origen_evento = 'pago_contabilizado_revertido'
      AND l.debe > 0 AND l.tipo_cargo IS NOT NULL AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'), 2,
  '4 · el reverso hereda tipo y auxiliar de cada línea');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000004', '11000000-0000-0000-0000-00000000a101'), 220,
  '4 · y la deuda vuelve completa');
SELECT public.chk(public.aplicado('9b000000-0000-0000-0000-000000000008', 'cuota_mora'), 0,
  '4 · la aplicación del cobro rechazado ya no cuenta');
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000009', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000004', 220, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-000000000009'), '1-CXC-RES:recargo_mora:20,1-CXC-RES:mantenimiento:200',
  '4 · un nuevo pago total se contabiliza entero (no «excede»)');

-- ── 5 · una mora POSTERIOR al cobro no absorbe ese cobro ────────────────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX mora posterior', 80, '2026-10', 'pendiente', 'mantenimiento');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000005', 30, 'efectivo', 'verificado', now() - interval '2 hours');
UPDATE public.cuotas_condominio SET mora_monto = 8, total_a_pagar = 88, mora_aplicada_at = now() - interval '1 hour'
 WHERE id = 'c2000000-0000-0000-0000-000000000005';
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000005', 58, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-00000000000a'), '1-CXC-RES:mantenimiento:30',
  '5 · el cobro previo a la mora fue todo al principal');
SELECT public.chk_txt(public.abonos_cobro('9b000000-0000-0000-0000-00000000000b'), '1-CXC-RES:recargo_mora:8,1-CXC-RES:mantenimiento:50',
  '5 · el siguiente cubre primero la mora y luego el resto del principal');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-00000000a101'), 0,
  '5 · cuota saldada');

-- ── 6 · cuota de mes CERRADO con mora de mes ABIERTO (y al revés) ───────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('c2000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX cuota de marzo', 70, '2026-03', 'pendiente', 'mantenimiento', '2026-03-15 12:00+00');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX mora en marzo', 90, '2026-10', 'pendiente', 'mantenimiento');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_id = 'c2000000-0000-0000-0000-000000000006' AND a.origen_evento = 'cuota_emitida'
      AND a.fecha = DATE '2026-03-15'), 1,
  '6 · la cuota de marzo se devenga en su fecha, con marzo todavía abierto');
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2026-03', 'cerrado');
SET ROLE authenticated;
UPDATE public.conta_config_tipo_cargo SET activa = false
 WHERE project_id = 'a1a1a1a1-0000-0000-0000-000000000001' AND tipo_cargo = 'recargo_mora';
UPDATE public.cuotas_condominio SET mora_monto = 7, total_a_pagar = 77, mora_aplicada_at = now() - interval '1 hour'
 WHERE id = 'c2000000-0000-0000-0000-000000000006';
UPDATE public.cuotas_condominio SET mora_monto = 9, total_a_pagar = 99, mora_aplicada_at = '2026-03-20 10:00+00'
 WHERE id = 'c2000000-0000-0000-0000-000000000007';
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cuotas_condominio', 'c2000000-0000-0000-0000-000000000006', 'cuota_mora'),
  'pendiente/sin_configuracion', '6 · las dos moras quedan pendientes (recargo_mora desactivado)');
SET ROLE authenticated;
UPDATE public.conta_config_tipo_cargo SET activa = true
 WHERE project_id = 'a1a1a1a1-0000-0000-0000-000000000001' AND tipo_cargo = 'recargo_mora';
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado || '/' || COALESCE(codigo, '-'), ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000006')),
  'cuota_emitida:ya_contabilizada/-,cuota_mora:contabilizada/-',
  '6 · cuota de marzo (cerrado) con mora de este mes: el reproceso contabiliza la mora');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado || '/' || COALESCE(codigo, '-'), ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000007')),
  'cuota_emitida:ya_contabilizada/-,cuota_mora:bloqueada/periodo_cerrado',
  '6 · cuota de este mes con mora de marzo (cerrado): el reproceso de la mora bloquea');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a JOIN public.cuotas_condominio c ON c.id = a.origen_id
    WHERE a.origen_id = 'c2000000-0000-0000-0000-000000000006' AND a.origen_evento = 'cuota_mora'
      AND a.estado = 'publicado' AND a.fecha = c.mora_aplicada_at::date), 1,
  '6 · la mora se asienta con SU fecha, no con la de la cuota');
SELECT public.chk(public.n_asientos('cuotas_condominio', 'c2000000-0000-0000-0000-000000000007', 'cuota_mora'), 0,
  '6 · y la mora de marzo no se asienta ni se re-fecha');

-- ── 7 · reprocesos repetidos: nada se duplica ───────────────────────────────
SET ROLE authenticated;
SELECT public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000003');
SELECT public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-000000000004');
SELECT public.conta_reprocesar_cargo('cuotas_condominio', 'c2000000-0000-0000-0000-000000000003');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_tabla = 'pagos' AND a.origen_evento = 'pago_contabilizado'
      AND a.origen_id IN (SELECT p.id FROM public.pagos p WHERE p.cuota_id = 'c2000000-0000-0000-0000-000000000003')), 4,
  '7 · tras reprocesos repetidos, la cuota sigue con 4 asientos de cobro');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE cuota_id = 'c2000000-0000-0000-0000-000000000003'), 5,
  '7 · y las mismas 5 aplicaciones');

-- ── 8 · permisos y aislamiento ──────────────────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX acceso cobro', 15, '2026-10', 'pendiente', 'cuota_extraordinaria');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-000000000008', 15, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000e', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')
    WHERE origen_id = '9b000000-0000-0000-0000-00000000000c' AND NOT puede_reprocesar), 1,
  '8 · el visor ve el cobro pendiente, no reprocesable para él');
SELECT public.chk_falla(
  $q$SELECT * FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-00000000000c')$q$,
  'No autorizado para contabilizar', '8 · …y el servidor le rechaza el reproceso');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000c', false);
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT * FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-00000000000c')$q$,
  'No autorizado para contabilizar', '8 · sin change_status el contador no reprocesa cobros');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'b0b0b0b0-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(resultado || '/' || codigo, ',') FROM public.conta_reprocesar_cargo('pagos', '9b000000-0000-0000-0000-00000000000c')),
  'bloqueada/documento_inexistente', '8 · el admin de B no reprocesa un cobro de A: le responde como a un inexistente');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones), 0,
  '8 · B no lee las aplicaciones de A (RLS)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion WHERE origen_tabla = 'pagos'), 0,
  '8 · ni los intentos de cobros de A');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a2a2a2a2-0000-0000-0000-000000000001')
    WHERE origen_tabla = 'pagos'), 0,
  '8 · la bandeja del proyecto A2 no muestra cobros del A1');
RESET ROLE;

-- ── 9 · lo que NO entra: cuota clasificada anterior a la contabilización ────
-- (sin intentos) → su cobro sigue el camino histórico, sin aplicaciones.
SET session_replication_role = replica;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX anterior clasificada', 40, '2026-09', 'pendiente', 'mantenimiento');
SET session_replication_role = origin;
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   40, 'efectivo', 'pendiente', now());
UPDATE public.cuotas_condominio SET pago_id = '9b000000-0000-0000-0000-00000000000e' WHERE id = 'c2000000-0000-0000-0000-000000000009';
UPDATE public.pagos SET estado = 'verificado' WHERE id = '9b000000-0000-0000-0000-00000000000e';
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_tabla = 'pagos' AND a.origen_id = '9b000000-0000-0000-0000-00000000000e'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101' AND l.haber = 40 AND l.tipo_cargo IS NULL), 1,
  '9 · cuota clasificada anterior: su cobro sigue el mapeo general, como antes');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion WHERE origen_id = '9b000000-0000-0000-0000-00000000000e'), 0,
  '9 · …sin intentos ni aplicaciones: no entra retroactivamente');

-- ── 10 · preparación de la concurrencia (run.sh, paso 6) ────────────────────
-- K1 y K3: cuotas extraordinarias pendientes de configuración, cada una con
-- un cobro pendiente. K2: cuota con mora, contabilizada, sin cobros aún.
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c2000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX K1', 50, '2026-10', 'pendiente', 'cuota_extraordinaria'),
  ('c2000000-0000-0000-0000-0000000000c3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX K3', 30, '2026-10', 'pendiente', 'cuota_extraordinaria'),
  ('c2000000-0000-0000-0000-0000000000c2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX K2', 100, '2026-10', 'pendiente', 'mantenimiento');
UPDATE public.cuotas_condominio SET mora_monto = 10, total_a_pagar = 110 WHERE id = 'c2000000-0000-0000-0000-0000000000c2';
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9b000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-0000000000c1', 50, 'efectivo', 'verificado', now()),
  ('9b000000-0000-0000-0000-000000000011', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c2000000-0000-0000-0000-0000000000c3', 30, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id IN ('9b000000-0000-0000-0000-000000000010', '9b000000-0000-0000-0000-000000000011')
      AND codigo = 'devengo_pendiente'), 2,
  '10 · dos cobros pendientes de su devengo para la concurrencia');
SELECT public.chk(public.n_vivos('cuotas_condominio', 'c2000000-0000-0000-0000-0000000000c2', 'cuota_mora'), 1,
  '10 · K2 tiene principal y mora contabilizados');
