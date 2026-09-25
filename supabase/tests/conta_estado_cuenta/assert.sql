-- ============================================================================
-- ESTADO DE CUENTA · invariantes (20261003000000)
--
-- Documentos, cobros y configuración los crean usuarios de la aplicación
-- (SET ROLE authenticated + request.jwt.claim.sub); el estado de cuenta se
-- consulta con esos mismos usuarios. Sólo el cierre de un período, el devengo
-- simulado en borrador, el borrado duro de un cobro y la póliza manual con
-- dimensiones se preparan como superusuario.
--
-- Línea de tiempo del auxiliar Uno (C1) en la contabilidad A1:
--   01-10  K1  cuota 100 (U1)                    02-05  mora de K1: 10 (CxC propia)
--   02-10  P1  cobro 60 → mora 10 + principal 50 03-01  K2  cuota 100 (U1)
--   03-15  P2  cobro 30 a K1                     04-20  P3  cobro 100 a K2
--   05-05  K3  cuota 40, anulada el mismo día     05-10  K4  cuota 200 (U2)
--   06-01  mora de K4: 20 (CxC compartida)       06-10  P4  cobro 150 → 20 + 130
--   06-15  CA1 cargo adicional 25.35 (U2)        06-20  P5  cobro 100: excede → pendiente, rechazado
--   06-25  P6  cobro 70 a K4                      07-01  K5  cuota extraordinaria 50, sin configuración
--   07-05  P7  cobro 50 a K5 (espera devengo)    07-10  K6  cuota 60 con devengo en BORRADOR
--   08-01  P9  cobro 5, borrado suave            08-02  P10 cobro 5, borrado duro
--   08-10  K7  cuota 100 (U1) ya con Dos de pagador    08-12  K8  cuota SIN clasificar (U1)
--   hoy    reverso de P3 (su mes, abril, ya estaba cerrado al rechazarlo)
-- ============================================================================

\set A   '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1  '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2  '''a2a2a2a2-0000-0000-0000-000000000001'''
\set B1  '''b1b1b1b1-0000-0000-0000-000000000001'''
\set C1  '''e0000000-0000-0000-0000-00000000a001'''
\set C2  '''e0000000-0000-0000-0000-00000000a002'''
\set U1  '''f0000000-0000-0000-0000-00000000a001'''
\set U2  '''f0000000-0000-0000-0000-00000000a002'''
\set L1  '''f0000000-0000-0000-0000-00000000a201'''
\set ADM '''a0a0a0a0-0000-0000-0000-00000000000a'''

-- ── 0 · superficie ──────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY[
     'public.conta_ec_autorizar(uuid, uuid, uuid)',
     'public.conta_ec_cuentas_cxc(uuid, uuid)',
     'public.conta_ec_lineas(uuid, uuid, uuid, uuid)',
     'public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date)']) f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')), 0,
  '0 · las funciones auxiliares (reciben la empresa por parámetro) no son invocables por la aplicación');
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY[
     'public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer)',
     'public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer)',
     'public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date)']) f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE')), 3,
  '0 · las tres consultas: authenticated sí, anon no');

SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL)), '0.00|0.00|0.00|0.00|0',
  '0 · sin movimientos: todo en cero, con dos decimales');

-- ── 1 · configuración: mora con CxC PROPIA ───────────────────────────────────
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :A1, 'mantenimiento',        '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102'),
  (:A, :A1, 'recargo_mora',         '11000000-0000-0000-0000-00000000a111', '11000000-0000-0000-0000-00000000a110'),
  (:A, :A1, 'adicional_reparacion', '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103'),
  (:A, :A2, 'mantenimiento',        '11000000-0000-0000-0000-00000000a201', '11000000-0000-0000-0000-00000000a202');

-- ── 2 · cuotas, mora y cobros de enero a abril ──────────────────────────────
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000001', :A, :A1, :U1, 'SINT-AUX K1', 100, '2026-01', 'pendiente', 'mantenimiento', '2026-01-10 12:00+00');
UPDATE public.cuotas_condominio SET mora_monto = 10, total_a_pagar = 110, mora_aplicada_at = '2026-02-05 12:00+00'
 WHERE id = 'ec100000-0000-0000-0000-000000000001';
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000001', :C1, :A1, 'ec100000-0000-0000-0000-000000000001', 60, 'efectivo', 'verificado', '2026-02-10 12:00+00');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000002', :A, :A1, :U1, 'SINT-AUX K2', 100, '2026-03', 'pendiente', 'mantenimiento', '2026-03-01 12:00+00');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000002', :C1, :A1, 'ec100000-0000-0000-0000-000000000001', 30, 'efectivo', 'verificado', '2026-03-15 12:00+00'),
  ('ec200000-0000-0000-0000-000000000003', :C1, :A1, 'ec100000-0000-0000-0000-000000000002', 100, 'efectivo', 'verificado', '2026-04-20 12:00+00');

SELECT public.chk_txt(public.ec_movs(public.ec(:A1, :C1, NULL)),
  'principal:100.00:0.00,mora:10.00:0.00,mora:0.00:10.00,principal:0.00:50.00,principal:100.00:0.00,principal:0.00:30.00,principal:0.00:100.00',
  '2 · cargos y abonos en orden; el cobro de 60 se ve como mora 10 + principal 50');
SELECT public.chk(
  (SELECT count(DISTINCT m->>'asiento_id') FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000001'), 1,
  '2 · …las dos porciones son UN asiento de cobro');
SELECT public.chk_txt(
  (SELECT string_agg((m->>'cuenta_codigo') || ':' || (m->>'abono'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000001'),
  'CXC-MORA:10.00,1-CXC-RES:50.00', '2 · mora y principal con CxC DISTINTAS, cada una con su cuenta');
SELECT public.chk_txt(
  (SELECT sum((m->>'abono')::numeric)::text FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000001'),
  (SELECT sum(monto)::text FROM public.conta_cobro_aplicaciones WHERE pago_id = 'ec200000-0000-0000-0000-000000000001'),
  '2 · lo abonado por el cobro es exactamente lo que registran sus aplicaciones');
SELECT public.chk_txt(
  (SELECT string_agg(DISTINCT m->>'cuota_id', ',') FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000001'),
  'ec100000-0000-0000-0000-000000000001', '2 · el cobro identifica la cuota a la que se aplicó');

-- ── 3 · anulación en período ABIERTO: reverso el mismo día ───────────────────
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000003', :A, :A1, :U1, 'SINT-AUX K3', 40, '2026-05', 'pendiente', 'mantenimiento', '2026-05-05 12:00+00');
UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'ec100000-0000-0000-0000-000000000003';
SELECT public.chk_txt(
  (SELECT string_agg((m->>'fecha') || ':' || (m->>'cargo') || ':' || (m->>'abono') || ':' || (m->>'es_reverso'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec100000-0000-0000-0000-000000000003'),
  '2026-05-05:40.00:0.00:false,2026-05-05:0.00:40.00:true',
  '3 · la cuota anulada se ve con su reverso: la historia no se oculta y el efecto neto es cero');

-- ── 4 · mora con CxC COMPARTIDA, excedente pendiente y rechazo ──────────────
UPDATE public.conta_config_tipo_cargo SET cuenta_cxc_id = '11000000-0000-0000-0000-00000000a101'
 WHERE project_id = :A1 AND tipo_cargo = 'recargo_mora';
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000004', :A, :A1, :U2, 'SINT-AUX K4', 200, '2026-05', 'pendiente', 'mantenimiento', '2026-05-10 12:00+00');
UPDATE public.cuotas_condominio SET mora_monto = 20, total_a_pagar = 220, mora_aplicada_at = '2026-06-01 12:00+00'
 WHERE id = 'ec100000-0000-0000-0000-000000000004';
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000004', :C1, :A1, 'ec100000-0000-0000-0000-000000000004', 150, 'efectivo', 'verificado', '2026-06-10 12:00+00');
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ec300000-0000-0000-0000-000000000001', :A, :A1, :U2, 'SINT-AUX CA1', 'reparacion', 25.35, '2026-06-15', 'pendiente');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000005', :C1, :A1, 'ec100000-0000-0000-0000-000000000004', 100, 'efectivo', 'verificado', '2026-06-20 12:00+00');

SELECT public.chk_txt(
  (SELECT string_agg((m->>'cuenta_codigo') || ':' || (m->>'tipo_cargo') || ':' || (m->>'componente') || ':' || (m->>'abono'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000004'),
  '1-CXC-RES:recargo_mora:mora:20.00,1-CXC-RES:mantenimiento:principal:130.00',
  '4 · mora y principal con la MISMA CxC siguen separados por tipo y componente');
SELECT public.chk_txt(public.ec_fuera(:A1, :C1, NULL), 'pendiente:pagos:100.00',
  '4 · el cobro que excede el saldo es un pendiente visible…');
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '115.35',
  '4 · …que NO reduce el saldo contable');
SELECT public.chk_txt(
  (SELECT codigo FROM public.conta_estado_cuenta_pendientes(:A1, :C1, NULL) WHERE origen_tabla = 'pagos'),
  'excede_saldo', '4 · con el motivo del servidor');

UPDATE public.pagos SET estado = 'rechazado' WHERE id = 'ec200000-0000-0000-0000-000000000005';
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000006', :C1, :A1, 'ec100000-0000-0000-0000-000000000004', 70, 'efectivo', 'verificado', '2026-06-25 12:00+00');
-- «pagado» marcado a mano ANTES de los cobros por cargo (20261004000000):
-- hoy el estado de un cargo por tipo se deriva de sus cobros y el guard
-- rechaza marcarlo a mano; el dato heredado se simula sin el guard.
RESET ROLE;
ALTER TABLE public.cargos_adicionales_unidad DISABLE TRIGGER trg_cargo_cobros_guard;
UPDATE public.cargos_adicionales_unidad SET estado = 'pagado' WHERE id = 'ec300000-0000-0000-0000-000000000001';
ALTER TABLE public.cargos_adicionales_unidad ENABLE TRIGGER trg_cargo_cobros_guard;
SET ROLE authenticated;
SELECT public.chk_txt(public.ec_fuera(:A1, :C1, NULL), 'cobro_sin_vinculo:cargos_adicionales_unidad:25.35',
  '4 · el excedente rechazado desaparece; el cargo adicional «pagado» se informa sin inventar su abono');

-- ── 5 · pendientes de devengo, borrador y reproceso sin duplicar ─────────────
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000005', :A, :A1, :U1, 'SINT-AUX K5', 50, '2026-07', 'pendiente', 'cuota_extraordinaria', '2026-07-01 12:00+00'),
  ('ec100000-0000-0000-0000-000000000006', :A, :A1, :U2, 'SINT-AUX K6', 60, '2026-07', 'pendiente', 'cuota_extraordinaria', '2026-07-10 12:00+00');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000007', :C1, :A1, 'ec100000-0000-0000-0000-000000000005', 50, 'efectivo', 'verificado', '2026-07-05 12:00+00');
RESET ROLE;
-- El devengo de K6 quedó en borrador (p. ej. sin tipo de cambio).
SELECT set_config('conta.allow_system_write', 'on', false);
INSERT INTO public.conta_asientos
  (id, company_id, project_id, fecha, tipo, concepto, estado, origen, origen_tabla, origen_id, origen_evento, moneda_base)
VALUES ('ec400000-0000-0000-0000-000000000002', :A, :A1, '2026-07-10', 'diario', 'SINT-AUX devengo K6 en borrador', 'borrador',
        'automatico', 'cuotas_condominio', 'ec100000-0000-0000-0000-000000000006', 'cuota_emitida',
        public.conta_moneda_base(:A, :A1));
INSERT INTO public.conta_asiento_lineas
  (asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber, auxiliar_cliente_id, unidad_id, tipo_cargo) VALUES
  ('ec400000-0000-0000-0000-000000000002', :A, '11000000-0000-0000-0000-00000000a101', 1, 'SINT-AUX', 60, 0, :C1, :U2, 'cuota_extraordinaria'),
  ('ec400000-0000-0000-0000-000000000002', :A, '11000000-0000-0000-0000-00000000a103', 2, 'SINT-AUX', 0, 60, :C1, :U2, 'cuota_extraordinaria');
SELECT set_config('conta.allow_system_write', 'off', false);
SET ROLE authenticated;

SELECT public.chk_txt(public.ec_fuera(:A1, :C1, NULL),
  'borrador:cuotas_condominio:60.00,cobro_sin_vinculo:cargos_adicionales_unidad:25.35,pendiente:cuotas_condominio:50.00,pendiente:pagos:50.00',
  '5 · cuota sin configuración, su cobro esperando devengo y un devengo en borrador: fuera del saldo');
SELECT public.chk_txt(
  (SELECT string_agg(codigo, ',' ORDER BY origen_tabla) FROM public.conta_estado_cuenta_pendientes(:A1, :C1, NULL) WHERE clase = 'pendiente'),
  'sin_configuracion,devengo_pendiente', '5 · …cada uno con su motivo');
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '45.35',
  '5 · pendientes y borradores no suman al saldo');
SELECT public.chk_txt(
  (SELECT string_agg((f->>'clase') || ':' || (f->>'naturaleza') || ':' || (f->>'documentos') || ':' || (f->>'monto'), ',')
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'fuera_de_saldo') f),
  'borrador:cargo:1:60.00,cobro_sin_vinculo:cargo:1:25.35,pendiente:abono:1:50.00,pendiente:cargo:1:50.00',
  '5 · el resumen los cuenta aparte, por clase y naturaleza');

INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :A1, 'cuota_extraordinaria', '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'ec100000-0000-0000-0000-000000000005')),
  'cuota_emitida:contabilizada,pago_contabilizado:contabilizada', '5 · reprocesar la cuota contabiliza devengo y cobro');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL)), '0.00|545.35|500.00|45.35|17',
  '5 · el devengo y el cobro entran al saldo en sus fechas');
SELECT public.conta_reprocesar_cargo('cuotas_condominio', 'ec100000-0000-0000-0000-000000000005');
SELECT public.conta_reprocesar_cargo('pagos', 'ec200000-0000-0000-0000-000000000007');
SELECT public.conta_reprocesar_cargo('cuotas_condominio', 'ec100000-0000-0000-0000-000000000005');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL)), '0.00|545.35|500.00|45.35|17',
  '5 · reprocesar otra vez no duplica nada en el estado de cuenta');
SELECT public.chk_txt(public.ec_fuera(:A1, :C1, NULL),
  'borrador:cuotas_condominio:60.00,cobro_sin_vinculo:cargos_adicionales_unidad:25.35',
  '5 · ya no quedan pendientes de K5');

-- Publicar el borrador lo mete al saldo (y lo saca de la lista); se deshace.
BEGIN;
SELECT public.conta_publicar_asiento('ec400000-0000-0000-0000-000000000002');
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '105.35',
  '5 · publicado el borrador, su devengo entra al saldo');
SELECT public.chk_txt(public.ec_fuera(:A1, :C1, NULL), 'cobro_sin_vinculo:cargos_adicionales_unidad:25.35',
  '5 · …y deja de listarse aparte');
ROLLBACK;
SET ROLE authenticated;

-- ── 6 · cobros borrados: suave y duro ────────────────────────────────────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec200000-0000-0000-0000-000000000009', :C1, :A1, 'ec100000-0000-0000-0000-000000000001', 5, 'efectivo', 'verificado', '2026-08-01 12:00+00'),
  ('ec200000-0000-0000-0000-00000000000a', :C1, :A1, 'ec100000-0000-0000-0000-000000000001', 5, 'efectivo', 'verificado', '2026-08-02 12:00+00');
UPDATE public.pagos SET deleted_at = now() WHERE id = 'ec200000-0000-0000-0000-000000000009';
RESET ROLE;
DELETE FROM public.pagos WHERE id = 'ec200000-0000-0000-0000-00000000000a';
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg((m->>'fecha') || ':' || (m->>'cargo') || ':' || (m->>'abono') || ':' || (m->>'es_reverso'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' IN ('ec200000-0000-0000-0000-000000000009', 'ec200000-0000-0000-0000-00000000000a')),
  '2026-08-01:0.00:5.00:false,2026-08-01:5.00:0.00:true,2026-08-02:0.00:5.00:false,2026-08-02:5.00:0.00:true',
  '6 · cobro con borrado suave y con borrado duro: abono y reverso visibles, efecto neto cero');
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '45.35',
  '6 · el saldo no cambia');

-- ── 7 · cambio de pagador: nada se traslada hacia atrás ──────────────────────
SELECT public.chk_uuid(
  public.unidad_designar_pagador(:U1, 'ec0e0000-0000-0000-0000-000000000001'),
  'ec0e0000-0000-0000-0000-000000000001', '7 · Dos pasa a ser el pagador de U1');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000007', :A, :A1, :U1, 'SINT-AUX K7', 100, '2026-08', 'pendiente', 'mantenimiento', '2026-08-10 12:00+00');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, created_at) VALUES
  ('ec100000-0000-0000-0000-000000000008', :A, :A1, :U1, 'SINT-AUX K8 sin clasificar', 30, '2026-08', 'pendiente', '2026-08-12 12:00+00');
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '45.35',
  '7 · el saldo de Uno no cambia al cambiar el pagador de U1');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C2, NULL)), '0.00|100.00|0.00|100.00|1',
  '7 · la cuota nueva es de Dos, y sólo ella');
SELECT public.chk_txt(public.ec_fuera(:A1, :C2, NULL), 'fuera_del_auxiliar:cuotas_condominio:30.00',
  '7 · la cuota sin clasificar de Dos va por el camino histórico: fuera del saldo por auxiliar');
SELECT public.chk_txt(
  (SELECT string_agg(DISTINCT m->>'auxiliar_nombre', ',') FROM jsonb_array_elements(public.ec(:A1, NULL, :U1)->'movimientos') m),
  'SINT-AUX Cliente Dos,SINT-AUX Cliente Uno',
  '7 · la unidad muestra los dos responsables, cada movimiento con el suyo');

-- ── 8 · rechazo con el mes CERRADO: reverso con fecha de hoy ─────────────────
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES (:A, :A1, '2026-04', 'cerrado');
SET ROLE authenticated;
UPDATE public.pagos SET estado = 'rechazado' WHERE id = 'ec200000-0000-0000-0000-000000000003';
SELECT public.chk_txt(
  (SELECT string_agg((m->>'fecha' = CURRENT_DATE::text)::text || ':' || (m->>'cargo') || ':' || (m->>'abono'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000003'),
  'false:0.00:100.00,true:100.00:0.00', '8 · el cobro de abril sigue en abril; su reverso va con la fecha de hoy');
SELECT public.chk_txt(
  (SELECT (m->>'reversado_por_fecha') || ':' || (m->>'reversado_por_numero' IS NOT NULL)::text
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'documento_id' = 'ec200000-0000-0000-0000-000000000003' AND NOT (m->>'es_reverso')::boolean),
  CURRENT_DATE::text || ':true', '8 · el abono original dice cuándo y con qué póliza se reversó');

-- ── 9 · saldos inicial y final con movimientos antes, dentro y después ──────
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL)), '0.00|655.35|510.00|145.35|22',
  '9 · sin rango: todo el historial, con el reverso de hoy');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL, '2026-02-01', '2026-03-31')), '100.00|110.00|90.00|120.00|5',
  '9 · febrero–marzo: saldo inicial de enero, movimientos del rango, nada de después');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL, '2026-05-01', '2026-06-30')), '20.00|285.35|260.00|45.35|8',
  '9 · mayo–junio: la anulación del mismo día entra y se compensa');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL, NULL, CURRENT_DATE - 1)), '0.00|555.35|510.00|45.35|21',
  '9 · corte ANTERIOR al reverso: el cobro de abril sigue aplicado');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL, NULL, CURRENT_DATE)), '0.00|655.35|510.00|145.35|22',
  '9 · corte POSTERIOR: el reverso devuelve la deuda, sin descontar dos veces');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, :C1, NULL, CURRENT_DATE + 1, NULL)), '145.35|0.00|0.00|145.35|0',
  '9 · rango futuro: el saldo inicial es el final de hoy');
SELECT public.chk_txt(
  (SELECT m->>'saldo' FROM jsonb_array_elements(public.ec(:A1, :C1, NULL, '2026-02-01', '2026-03-31')->'movimientos') m
    ORDER BY (m->>'n')::int DESC LIMIT 1),
  '120.00', '9 · el saldo acumulado de la última fila es el saldo final');
SELECT public.chk_txt(
  (SELECT string_agg((t->>'tipo_cargo') || ':' || (t->>'saldo_final'), ',')
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'por_tipo') t),
  'adicional_reparacion:25.35,cuota_extraordinaria:0.00,mantenimiento:120.00,recargo_mora:0.00',
  '9 · desglose por tipo: la mora cobrada no queda como deuda de principal');

-- ── 10 · paginación: los totales no dependen de la página ────────────────────
SELECT public.chk(
  (SELECT count(DISTINCT public.ec(:A1, :C1, NULL, NULL, NULL, 5, o)->'resumen') FROM generate_series(0, 20, 5) o), 1,
  '10 · el resumen es idéntico en todas las páginas');
SELECT public.chk_txt(
  (SELECT string_agg((m->>'n') || ':' || (m->>'linea_id') || ':' || (m->>'saldo'), ',' ORDER BY (m->>'n')::int)
     FROM generate_series(0, 20, 5) o, jsonb_array_elements(public.ec(:A1, :C1, NULL, NULL, NULL, 5, o)->'movimientos') m),
  (SELECT string_agg((m->>'n') || ':' || (m->>'linea_id') || ':' || (m->>'saldo'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m),
  '10 · páginas de 5 = una página de 500: mismas filas, mismo orden, mismo saldo acumulado');
SELECT public.chk_txt(
  (SELECT string_agg((m->>'n') || ':' || (m->>'linea_id'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m),
  (SELECT string_agg((m->>'n') || ':' || (m->>'linea_id'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m),
  '10 · el orden es estable entre llamadas');
SELECT public.chk(
  (SELECT count(DISTINCT total_filas) FROM generate_series(0, 3) o,
     public.conta_estado_cuenta_pendientes(:A1, :C1, NULL, NULL, 1, o)), 1,
  '10 · la lista de fuera del saldo también cuenta el total en el servidor');

-- ── 11 · unidades, otra contabilidad y aislamiento ──────────────────────────
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, NULL, :U1)), '0.00|510.00|290.00|220.00|17',
  '11 · U1: sus cargos de Uno y de Dos, y nada de U2');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, NULL, :U2)), '0.00|245.35|220.00|25.35|6',
  '11 · U2: K4, su mora, sus cobros y el cargo adicional');
SELECT public.chk_txt(public.ec_fuera(:A1, NULL, :U1), 'fuera_del_auxiliar:cuotas_condominio:30.00',
  '11 · por unidad también se ve la cuota del camino histórico');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec100000-0000-0000-0000-0000000000a2', :A, :A2, :L1, 'SINT-AUX KA2', 80, '2026-03', 'pendiente', 'mantenimiento', '2026-03-03 12:00+00');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A2, :C1, NULL)), '0.00|80.00|0.00|80.00|1',
  '11 · Uno en la contabilidad A2: sólo lo de A2');
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '145.35',
  '11 · …y A1 no ve lo de A2');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', NULL, 'f0000000-0000-0000-0000-00000000a201')$q$,
  'no pertenece a esta contabilidad', '11 · una unidad de otro proyecto se rechaza');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a001')$q$,
  'uno solo', '11 · cliente Y unidad a la vez se rechaza');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001')$q$,
  'uno solo', '11 · sin sujeto se rechaza');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000b001')$q$,
  'auxiliar no pertenece', '11 · un cliente de la empresa B se rechaza');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001', NULL, '2026-05-01', '2026-04-01')$q$,
  'posterior a la final', '11 · un rango invertido se rechaza');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001', NULL, NULL, NULL, 501)$q$,
  'entre 1 y 500', '11 · una página de más de 500 se rechaza');

-- ── 12 · permisos verificados en el servidor ─────────────────────────────────
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000c', false);
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '145.35',
  '12 · contador (permiso de contabilidad y proyecto asignado): ve el estado de cuenta');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a2a2a2a2-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001')$q$,
  'No autorizado para este proyecto', '12 · contador sin acceso al proyecto A2: rechazado');
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000e', false);
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '145.35',
  '12 · visor contable (sólo ver): ve el estado de cuenta');
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000d', false);
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001')$q$,
  'No autorizado para ver la contabilidad', '12 · operador sin permiso contable: estado de cuenta rechazado');
SELECT public.chk_falla($q$SELECT * FROM public.conta_estado_cuenta_pendientes('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001')$q$,
  'No autorizado para ver la contabilidad', '12 · …la lista de fuera del saldo también');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta_conciliacion('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001')$q$,
  'No autorizado para ver la contabilidad', '12 · …y la conciliación');
SELECT set_config('request.jwt.claim.sub', 'b0b0b0b0-0000-0000-0000-00000000000b', false);
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001')$q$,
  'no pertenece a la empresa activa', '12 · admin de B contra la contabilidad de A: rechazado');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('b1b1b1b1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001')$q$,
  'auxiliar no pertenece', '12 · admin de B con un cliente de A en su propia contabilidad: rechazado');
SELECT public.chk_falla($q$SELECT public.conta_estado_cuenta('b1b1b1b1-0000-0000-0000-000000000001', NULL, 'f0000000-0000-0000-0000-00000000a001')$q$,
  'no pertenece a esta contabilidad', '12 · …y con una unidad de A: rechazado');
SELECT public.chk_txt(public.ec_resumen(public.ec(:B1, 'e0000000-0000-0000-0000-00000000b001', NULL)), '0.00|0.00|0.00|0.00|0',
  '12 · admin de B ve a su cliente, y nada de A');
SELECT set_config('request.jwt.claim.sub', :ADM, false);

-- ── 13 · conciliación con la contabilidad ────────────────────────────────────
SELECT public.chk_txt(
  (SELECT concat_ws('|', j->>'saldo_contable', j->>'saldo_documentos', j->>'diferencia', j->>'cuadra', j->>'total_discrepancias')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :C1, NULL, CURRENT_DATE - 1) j),
  '45.35|45.35|0.00|true|0', '13 · corte anterior al reverso: cuadra con el cobro de abril aplicado');
SELECT public.chk_txt(
  (SELECT concat_ws('|', j->>'saldo_contable', j->>'saldo_documentos', j->>'diferencia', j->>'cuadra', j->>'total_discrepancias')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :C1, NULL) j),
  '145.35|145.35|0.00|true|0', '13 · sin corte: cuadra, con cobros borrados (suave y duro) y el reverso de hoy');
SELECT public.chk_txt(
  (SELECT concat_ws('|', j->>'saldo_contable', j->>'saldo_documentos', j->>'cuadra')
     FROM public.conta_estado_cuenta_conciliacion(:A1, NULL, :U1) j),
  '220.00|220.00|true', '13 · por unidad también cuadra (dos responsables)');
SELECT public.chk_txt(
  (SELECT string_agg((c->>'codigo') || ':' || (c->>'saldo'), ',')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :C1, NULL) j, jsonb_array_elements(j->'por_cuenta') c),
  '1-CXC-RES:145.35,CXC-MORA:0.00', '13 · saldo por cuenta de CxC: la de mora (ya no configurada) sigue contando');
SELECT public.chk_txt(
  (public.conta_estado_cuenta_conciliacion(:A1, :C1, NULL)->>'saldo_contable'),
  (public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final'),
  '13 · el saldo conciliado es el mismo del estado de cuenta');

-- Una aplicación alterada a mano se detecta (y se deshace).
RESET ROLE;
BEGIN;
UPDATE public.conta_cobro_aplicaciones SET monto = monto - 1
 WHERE pago_id = 'ec200000-0000-0000-0000-000000000004' AND evento = 'cuota_emitida';
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg((d->>'clase') || ':' || (d->>'diferencia'), ',' ORDER BY d->>'clase')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :C1, NULL) j, jsonb_array_elements(j->'discrepancias') d),
  'aplicacion:1.00,documento:-1.00', '13 · una aplicación que no cuadra con su asiento se señala, con su documento');
ROLLBACK;
SET ROLE authenticated;

-- Una póliza manual a la CxC con el auxiliar: está en el saldo contable, pero
-- no tiene documento. La conciliación lo dice.
RESET ROLE;
SELECT set_config('conta.allow_system_write', 'on', false);
INSERT INTO public.conta_asientos
  (id, company_id, project_id, numero, fecha, tipo, concepto, estado, origen, moneda_base, total_debe, total_haber, publicado_at)
VALUES ('ec400000-0000-0000-0000-000000000001', :A, :A1,
        public.conta_siguiente_folio(:A, :A1), '2026-08-20', 'diario', 'SINT-AUX ajuste manual',
        'publicado', 'manual', public.conta_moneda_base(:A, :A1), 15, 15, now());
INSERT INTO public.conta_asiento_lineas
  (asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber, auxiliar_cliente_id, unidad_id, tipo_cargo) VALUES
  ('ec400000-0000-0000-0000-000000000001', :A, '11000000-0000-0000-0000-00000000a101', 1, 'SINT-AUX', 15, 0, :C1, :U1, 'mantenimiento'),
  ('ec400000-0000-0000-0000-000000000001', :A, '11000000-0000-0000-0000-00000000a102', 2, 'SINT-AUX', 0, 15, :C1, :U1, 'mantenimiento');
SELECT set_config('conta.allow_system_write', 'off', false);
SET ROLE authenticated;
SELECT public.chk_txt(public.ec(:A1, :C1, NULL)->'resumen'->>'saldo_final', '160.35',
  '13 · la póliza manual publicada está en el estado de cuenta…');
SELECT public.chk_txt(
  (SELECT m->>'documento' FROM jsonb_array_elements(public.ec(:A1, :C1, NULL)->'movimientos') m
    WHERE m->>'asiento_id' = 'ec400000-0000-0000-0000-000000000001'),
  'Póliza manual', '13 · …identificada como tal');
SELECT public.chk_txt(
  (SELECT concat_ws('|', j->>'saldo_contable', j->>'saldo_documentos', j->>'diferencia', j->>'cuadra',
                    (SELECT string_agg((d->>'clase') || ':' || (d->>'asiento_id') || ':' || (d->>'diferencia'), ',')
                       FROM jsonb_array_elements(j->'discrepancias') d))
     FROM public.conta_estado_cuenta_conciliacion(:A1, :C1, NULL) j),
  '160.35|145.35|15.00|false|sin_documento:ec400000-0000-0000-0000-000000000001:15.00',
  '13 · …y la conciliación la señala como movimiento sin documento');
RESET ROLE;
