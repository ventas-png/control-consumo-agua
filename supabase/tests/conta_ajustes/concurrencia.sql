-- ============================================================================
-- BLOQUE 3 · lo que tiene que quedar después de las sesiones simultáneas
-- ============================================================================
\set ON_ERROR_STOP 1
\set C1   '''ad000000-0000-0000-0000-000000000031'''
\set C2   '''ad000000-0000-0000-0000-000000000032'''
\set C4   '''ad000000-0000-0000-0000-000000000034'''
\set SC1  '''5e000000-0000-0000-0000-0000000000c1'''
\set SC4  '''5e000000-0000-0000-0000-0000000000c4'''
\set PRC3 '''ad900000-0000-0000-0000-000000000013'''

SELECT public.chk_txt(public.aj_sol(:SC1), 'ejecutada/1/false', 'A · dos aprobaciones a la vez: UNA ejecución');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a WHERE a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = :C1
      AND a.origen_evento = 'cargo_adicional_emitido_revertido'), 1,
  'A · un solo reverso del devengo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_ajustes_eventos e WHERE e.solicitud_id = :SC1 AND e.accion = 'ejecutada'), 1,
  'A · una sola «ejecutada» en la bitácora');
SELECT public.chk_txt(public.aj_cargo(:C2), 'anulado/0/1', 'B · C2 anulado, sin el cobro que llegó durante la aprobación');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = :C2), 0,
  'B · el cobro no quedó registrado');
SELECT public.chk_txt(public.aj_cargo(:C4), 'pendiente/1/0', 'C · C4 sigue vivo: el cobro llegó primero y la aprobación falló sin escribir');
SELECT public.chk_txt(public.aj_sol(:SC4), 'fallida/1/false', 'C · la solicitud queda fallida, reintentable');
SELECT public.chk_txt(public.aj_pr(:PRC3), 'succeeded/1/aplicado', 'D · dos avisos a la vez: UN pago');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_ajustes_solicitudes s
    WHERE s.documento_id = 'c5f00000-0000-0000-0000-000000000004' AND s.canal = 'portal' AND s.estado = 'pendiente'), 1,
  'E · una sola solicitud abierta del portal por el documento');
SELECT public.chk_txt(public.aj_cuota('c9a00000-0000-0000-0000-000000000021'), 'anulada/0/1/hoy',
  'F · QX anulada, con su devengo reversado');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cuota_id = 'c9a00000-0000-0000-0000-000000000021'), 0,
  'F · el cobro que llegó durante la aprobación no quedó registrado');
SELECT public.chk_txt(public.aj_cuota('c9a00000-0000-0000-0000-000000000022'), 'emitida/1/0/-',
  'F'' · QY sigue viva: el cobro llegó primero y la aprobación falló sin escribir');
SELECT public.chk_txt(public.aj_sol('5e0b0000-0000-0000-0000-000000000022'), 'fallida/1/false', 'F'' · la solicitud queda fallida');
SELECT public.chk_txt(public.aj_reembolsos('ad900000-0000-0000-0000-000000000043'), '1/30.00/30.00/1',
  'G · dos reembolsos parciales a la vez: se cuenta el acumulado mayor una vez');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e
    WHERE e.payment_request_id = 'ad900000-0000-0000-0000-000000000043' AND e.estado_informado = 'reembolso_parcial'), 2,
  'G · los dos avisos quedan como evidencia');

-- Confirmación tardía de un cobro sobre una cuota anulada (20261015000000).
SELECT public.chk_txt(public.aj_cuota('c9a00000-0000-0000-0000-000000000018'), 'anulada/0/1/hoy',
  'I · QM anulada');
SELECT public.chk_txt(public.aj_pr('ad900000-0000-0000-0000-0000000000a3') || '|' || public.aj_incidencias('ad900000-0000-0000-0000-0000000000a3'),
  'pending_verification/0/-|cobro_sobre_documento_anulado:abierta',
  'I · la confirmación que esperó a la anulación: sin pago, con su incidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e WHERE e.payment_request_id = 'ad900000-0000-0000-0000-0000000000a3'), 1,
  'I · el aviso quedó registrado');
SELECT public.chk_txt(public.aj_cuota('c9a00000-0000-0000-0000-000000000019'), 'pagada/1/0/-',
  'J · QN sigue viva (pagada por el cobro que llegó primero); la anulación falló sin escribir');
SELECT public.chk_txt(public.aj_pr('ad900000-0000-0000-0000-0000000000a4') || '|' || public.aj_incidencias('ad900000-0000-0000-0000-0000000000a4'),
  'succeeded/1/aplicado|', 'J · …con su cobro acreditado una vez y sin incidencia');
SELECT public.chk_txt(public.aj_sol('5e0b0000-0000-0000-0000-000000000019'), 'fallida/1/false', 'J · la solicitud queda fallida');
SELECT public.chk_txt(public.aj_pr('ad900000-0000-0000-0000-0000000000a2') || '|' || public.aj_incidencias('ad900000-0000-0000-0000-0000000000a2'),
  'pending_verification/0/-|cobro_sobre_documento_anulado:abierta',
  'K · dos confirmaciones a la vez: ningún pago y UNA incidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e WHERE e.payment_request_id = 'ad900000-0000-0000-0000-0000000000a2'), 2,
  'K · los dos avisos quedan como evidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cuota_id IN ('c9a00000-0000-0000-0000-000000000017', 'c9a00000-0000-0000-0000-000000000018')), 0,
  'I/K · ninguna cuota anulada recibió un pago');
