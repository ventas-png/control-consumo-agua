-- ============================================================================
-- SALDOS A FAVOR · invariantes después de las sesiones simultáneas de run.sh
-- ============================================================================
\set ON_ERROR_STOP 1

-- H · el mismo saldo a dos cargos: UNA aplicación, nunca dos.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_saldo_favor_aplicaciones
    WHERE id IN ('5a000000-0000-0000-0000-0000000000b1','5a000000-0000-0000-0000-0000000000b2')), 1,
  'H · una sola de las dos aplicaciones simultáneas del mismo saldo');
SELECT public.chk_txt(public.sf_origen('9f5f0000-0000-0000-0000-0000000000a1'), 'anticipo:60.00:10.00',
  'H · el anticipo queda en 10: 60 − 25 (antes) − 25 (una de las dos)');

-- I · doble envío: una aplicación y un asiento.
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_aplicaciones WHERE id = '5a000000-0000-0000-0000-0000000000c1'), 1,
  'I · el doble envío dejó UNA aplicación');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'conta_saldo_favor_aplicaciones'
                    AND origen_id = '5a000000-0000-0000-0000-0000000000c1'), 1,
  'I · …y UN asiento');

-- J · aplicación primero, anulación después: la anulación no pasa.
SELECT public.chk((SELECT count(*) FROM public.pagos WHERE id = '9f5f0000-0000-0000-0000-0000000000a3' AND estado = 'verificado'), 1,
  'J · el anticipo con saldo aplicado sigue verificado');
SELECT public.chk_txt(public.sf_origen('9f5f0000-0000-0000-0000-0000000000a3'), 'anticipo:40.00:30.00',
  'J · y su aplicación tiene respaldo (30 disponibles)');

-- J' · anulación primero, aplicación después: la aplicación no pasa.
SELECT public.chk((SELECT count(*) FROM public.pagos WHERE id = '9f5f0000-0000-0000-0000-0000000000a4' AND estado = 'rechazado'), 1,
  'K · el anticipo quedó anulado');
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_aplicaciones x
                    JOIN public.conta_saldo_favor_origenes o ON o.id = x.origen_id
                   WHERE o.pago_id = '9f5f0000-0000-0000-0000-0000000000a4'), 0,
  'K · ninguna aplicación de un saldo anulado');

-- L · dos saldos contra el mismo cargo: nunca más que su deuda.
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_aplicaciones
                    WHERE cargo_adicional_id = 'ca5f0000-0000-0000-0000-000000000008'), 1,
  'L · una sola aplicación al cargo SH');
SELECT public.chk_txt(public.sf_cxc_doc('cargos_adicionales_unidad', 'ca5f0000-0000-0000-0000-000000000008')::text, '5.00',
  'L · SH debe 5: 20 − 15');

-- Globales: nada negativo, y el libro concuerda con orígenes y aplicaciones.
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_origenes o WHERE public.conta_sf_disponible(o.id) < 0), 0,
  'G · ningún saldo a favor disponible en negativo');
SELECT public.chk(
  (SELECT count(*) FROM public.cargos_adicionales_unidad ca
    CROSS JOIN LATERAL public.conta_cargo_saldo_cobro(ca.id) s
   WHERE s.devengo_monto IS NOT NULL AND s.aplicado > s.devengo_monto), 0,
  'G · ningún cargo con más aplicado que su devengo');
SELECT public.chk_txt(public.sf_libro('11000000-0000-0000-0000-00000000a1a1', 'e0000000-0000-0000-0000-00000000a001',
                                      'f0000000-0000-0000-0000-00000000a001')::text,
  (SELECT sum(public.conta_sf_disponible(o.id))::numeric(14,2)::text FROM public.conta_saldo_favor_origenes o
    WHERE o.cliente_id = 'e0000000-0000-0000-0000-00000000a001' AND o.unidad_id = 'f0000000-0000-0000-0000-00000000a001'),
  'G · el libro de anticipos de Uno en U1 = suma de sus disponibles');
