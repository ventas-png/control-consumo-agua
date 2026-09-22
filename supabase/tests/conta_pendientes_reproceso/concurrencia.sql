\set ON_ERROR_STOP on

-- ============================================================================
-- 4. CONCURRENCIA · lo que dejaron las sesiones simultáneas de run.sh
-- ============================================================================

-- Dos reprocesos simultáneos de la misma factura.
SELECT public.chk(public.n_asientos('cccc0000-0000-0000-0000-000000000001'), 1,
  '4 · dos reprocesos SIMULTÁNEOS generan exactamente UN asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = 'cccc0000-0000-0000-0000-000000000001' AND disparo = 'reproceso'
      AND resultado = 'contabilizada'), 1,
  '4 · uno contabiliza');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = 'cccc0000-0000-0000-0000-000000000001' AND disparo = 'reproceso'
      AND resultado = 'ya_contabilizada'), 1,
  '4 · y el otro, que esperó el bloqueo, responde «ya contabilizada»');
SELECT public.chk_num(
  (SELECT total_debe - total_haber FROM public.conta_asientos
    WHERE origen_id = 'cccc0000-0000-0000-0000-000000000001' AND origen_evento = 'factura_prov_aprobada'),
  0, '4 · y el asiento está balanceado');

-- Reproceso y anulación simultáneos.
SELECT public.chk_txt(
  (SELECT estado FROM public.facturas_proveedor WHERE id = 'cccc0000-0000-0000-0000-000000000002'),
  'anulada', '4 · la anulación concurrente se aplicó (esperó el bloqueo, no se perdió)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'cccc0000-0000-0000-0000-000000000002'
      AND origen_evento = 'factura_prov_aprobada' AND anulado_por_id IS NOT NULL), 1,
  '4 · y reversó el asiento que el reproceso acababa de crear');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_id = 'cccc0000-0000-0000-0000-000000000002'
      AND origen_evento = 'factura_prov_aprobada_revertido'), 1,
  '4 · con su reverso: nada queda devengado de una factura anulada');

-- La segunda red: aun SIN el bloqueo de la fila, el índice único impide el
-- duplicado. Se llama al contabilizador interno dos veces seguidas, como si
-- dos caminos distintos lo alcanzaran.
SELECT public.factura('cccc0000-0000-0000-0000-000000000003', 'Índice único', 230);
SELECT public.aprobar_id('cccc0000-0000-0000-0000-000000000003');
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.facturas_proveedor f,
     LATERAL public.conta_contabilizar_factura_prov_interno(f, 'reproceso') r
    WHERE f.id = 'cccc0000-0000-0000-0000-000000000003'),
  'ya_contabilizada', '4 · el contabilizador llamado de nuevo, sin el RPC ni su bloqueo: «ya contabilizada»');
SELECT public.chk(public.n_asientos('cccc0000-0000-0000-0000-000000000003'), 1,
  '4 · y el índice único dejó UN solo asiento');

SELECT 'CONCURRENCIA OK' AS resultado;
