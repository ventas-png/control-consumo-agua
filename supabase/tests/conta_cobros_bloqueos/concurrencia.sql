-- Invariantes tras los escenarios con compuerta de run.sh (paso 6).
--
-- Para TODO pago rechazado o eliminado: ningún asiento de cobro vivo y ninguna
-- aplicación viva que descuente saldo. Y la cuota vuelve a deber lo suyo.

-- Asientos de cobro vivos de un pago (exista o no la fila del pago).
CREATE OR REPLACE FUNCTION pg_temp.vivos(p uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.conta_asientos a
   WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_id = p
     AND a.origen_evento = 'pago_contabilizado' AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
$$;
CREATE OR REPLACE FUNCTION pg_temp.todos(p uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.conta_asientos a
   WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_id = p
     AND a.origen_evento = 'pago_contabilizado'
$$;
CREATE OR REPLACE FUNCTION pg_temp.aplic_vivas(p uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.conta_cobro_aplicaciones ap JOIN public.conta_asientos a ON a.id = ap.asiento_id
   WHERE ap.pago_id = p AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
$$;
-- Saldo en la CxC de una cuota y de un pago (por origen, sin depender de que
-- la fila del pago exista).
CREATE OR REPLACE FUNCTION pg_temp.saldo(c uuid, p uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'
     AND a.origen_id IN (c, p)
$$;

-- ── Reproceso PRIMERO: contabilizó, y el rechazo/borrado que esperaba lo reversó
SELECT public.chk(pg_temp.todos('9c000000-0000-0000-0000-0000000000c1'), 1, 'k1 · reproceso → rechazo: el cobro llegó a contabilizarse');
SELECT public.chk(pg_temp.vivos('9c000000-0000-0000-0000-0000000000c1'), 0, 'k1 · …y el rechazo lo reversó: sin asiento vivo');
SELECT public.chk(pg_temp.aplic_vivas('9c000000-0000-0000-0000-0000000000c1'), 0, 'k1 · …ni aplicación viva');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c1', '9c000000-0000-0000-0000-0000000000c1'), 50, 'k1 · la cuota vuelve a deber 50');

SELECT public.chk(pg_temp.todos('9c000000-0000-0000-0000-0000000000c2'), 1, 'k2 · reproceso → borrado suave: el cobro llegó a contabilizarse');
SELECT public.chk(pg_temp.vivos('9c000000-0000-0000-0000-0000000000c2'), 0, 'k2 · …y el borrado lo reversó');
SELECT public.chk(pg_temp.aplic_vivas('9c000000-0000-0000-0000-0000000000c2'), 0, 'k2 · …ni aplicación viva');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c2', '9c000000-0000-0000-0000-0000000000c2'), 50, 'k2 · la cuota vuelve a deber 50');

SELECT public.chk(pg_temp.todos('9c000000-0000-0000-0000-0000000000c3'), 1, 'k3 · reproceso → borrado duro: el cobro llegó a contabilizarse');
SELECT public.chk(pg_temp.vivos('9c000000-0000-0000-0000-0000000000c3'), 0, 'k3 · …y el borrado duro lo reversó');
SELECT public.chk((SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id = '9c000000-0000-0000-0000-0000000000c3'), 0,
  'k3 · sus aplicaciones se fueron con el pago');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c3', '9c000000-0000-0000-0000-0000000000c3'), 50, 'k3 · la cuota vuelve a deber 50');

-- ── Rechazo/borrado PRIMERO: el reproceso esperó y ya no lo contabilizó
SELECT public.chk(pg_temp.todos('9c000000-0000-0000-0000-0000000000c4'), 0, 'k4 · rechazo → reproceso: el cobro rechazado nunca se contabiliza');
SELECT public.chk(pg_temp.aplic_vivas('9c000000-0000-0000-0000-0000000000c4'), 0, 'k4 · …ni deja aplicación');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c4', '9c000000-0000-0000-0000-0000000000c4'), 50, 'k4 · la cuota se devengó y debe 50');

-- ── Evidencia del rechazo (20261005000000) en los dos órdenes ───────────────
-- Una sola fila por rechazo, desde el estado en que estaba el cobro, aunque
-- el rechazo haya esperado al reproceso o el reproceso al rechazo.
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || estado_anterior, ',') FROM public.pagos_rechazo_eventos
    WHERE pago_id = '9c000000-0000-0000-0000-0000000000c1'),
  'rechazo:verificado', 'k1 · reproceso → rechazo: una sola evidencia del rechazo');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || estado_anterior, ',') FROM public.pagos_rechazo_eventos
    WHERE pago_id = '9c000000-0000-0000-0000-0000000000c4'),
  'rechazo:verificado', 'k4 · rechazo → reproceso: una sola evidencia, y el reproceso no la duplica');

SELECT public.chk(pg_temp.todos('9c000000-0000-0000-0000-0000000000c5'), 0, 'k5 · borrado suave → reproceso: nunca se contabiliza');
SELECT public.chk(pg_temp.aplic_vivas('9c000000-0000-0000-0000-0000000000c5'), 0, 'k5 · …ni deja aplicación');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c5', '9c000000-0000-0000-0000-0000000000c5'), 50, 'k5 · la cuota se devengó y debe 50');

SELECT public.chk(pg_temp.todos('9c000000-0000-0000-0000-0000000000c6'), 0, 'k6 · borrado duro → reproceso: nunca se contabiliza');
SELECT public.chk((SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id = '9c000000-0000-0000-0000-0000000000c6'), 0,
  'k6 · …ni deja aplicación');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c6', '9c000000-0000-0000-0000-0000000000c6'), 50, 'k6 · la cuota se devengó y debe 50');

-- ── Invariante global: ningún pago rechazado o eliminado con cobro vivo ────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_evento = 'pago_contabilizado'
      AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.pagos p
                       WHERE p.id = a.origen_id AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado'))), 0,
  'global · ningún pago rechazado, borrado o eliminado conserva un asiento de cobro vivo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones ap JOIN public.conta_asientos a ON a.id = ap.asiento_id
    WHERE a.estado <> 'anulado' AND a.anulado_por_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.pagos p
                       WHERE p.id = ap.pago_id AND p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado'))), 0,
  'global · ni una aplicación viva que reduzca saldo');

-- ── Orden de bloqueos: sin deadlock, y los dos cobros de K7 una sola vez ─────
SELECT public.chk(pg_temp.vivos('9c000000-0000-0000-0000-0000000000c7'), 1, 'k7 · el primer cobro de K7: un asiento');
SELECT public.chk(pg_temp.vivos('9c000000-0000-0000-0000-0000000000d7'), 1, 'k7 · el segundo: un asiento');
SELECT public.chk(pg_temp.saldo('c3000000-0000-0000-0000-0000000000c7', '9c000000-0000-0000-0000-0000000000c7')
                + (SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l
                     JOIN public.conta_asientos a ON a.id = l.asiento_id
                    WHERE a.estado = 'publicado' AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'
                      AND a.origen_id = '9c000000-0000-0000-0000-0000000000d7'), 0,
  'k7 · la cuota K7 queda saldada (20 + 30)');
