-- Invariantes tras las sesiones simultáneas de run.sh (paso 6).

-- A · emisión DURANTE un cambio de pagador: la cuota emitida mientras la
-- transacción del cambio seguía abierta ve el pagador ANTERIOR (Uno), nunca
-- el estado intermedio sin pagador.
SELECT public.chk_txt(
  (SELECT coalesce(responsable_cliente_id::text, 'NULL') || '/' || responsable_origen
     FROM public.cuotas_condominio WHERE concepto = 'SINT-AUX conc durante'),
  'e0000000-0000-0000-0000-00000000a001/designado',
  'A · la cuota emitida durante el cambio ve el pagador anterior, no «sin_candidato»');
SELECT public.chk_txt(
  (SELECT coalesce(responsable_cliente_id::text, 'NULL') || '/' || responsable_origen
     FROM public.cuotas_condominio WHERE concepto = 'SINT-AUX conc después'),
  'e0000000-0000-0000-0000-00000000a002/designado',
  'A · la cuota emitida después del COMMIT ve el pagador nuevo');
SELECT public.chk(
  (SELECT count(*) FROM public.cuotas_condominio
    WHERE concepto LIKE 'SINT-AUX conc%' AND responsable_origen = 'sin_candidato'), 0,
  'A · ninguna cuota de la ventana concurrente quedó sin candidato');

-- B · dos cambios simultáneos sobre la misma unidad: se serializan, los dos
-- terminan bien y queda exactamente un pagador, el del último en confirmar.
SELECT public.chk_txt(public.pagador_de('f0000000-0000-0000-0000-00000000a001'),
  'd0000000-0000-0000-0000-000000000002',
  'B · tras dos cambios simultáneos queda UN pagador: el del segundo en confirmar');
