-- Invariantes tras las sesiones simultáneas de run.sh (paso 6).

-- A · dos reprocesos simultáneos del MISMO documento: uno contabiliza, el otro
-- ve el asiento del primero. Un solo asiento.
SELECT public.chk(public.n_asientos('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000007', 'cargo_adicional_emitido'), 1,
  'A · dos reprocesos simultáneos dejan UN solo asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = 'ca100000-0000-0000-0000-000000000007' AND disparo = 'reproceso' AND resultado = 'contabilizada'), 1,
  'A · exactamente un reproceso contabilizó');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = 'ca100000-0000-0000-0000-000000000007' AND disparo = 'reproceso' AND resultado = 'ya_contabilizada'), 1,
  'A · y el otro respondió «ya contabilizada»');

-- B · reproceso y anulación simultáneos: la anulación espera el bloqueo y, al
-- aplicarse, su trigger reversa el asiento recién creado. Nada queda vivo.
SELECT public.chk(public.n_vivos('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000008', 'cargo_adicional_emitido'), 0,
  'B · tras reproceso y anulación simultáneos no queda asiento vivo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_id = 'ca100000-0000-0000-0000-000000000008'
      AND a.origen_evento = 'cargo_adicional_emitido_revertido'), 1,
  'B · el asiento del reproceso quedó reversado (un reverso)');
SELECT public.chk(
  (SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l
     JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.estado = 'publicado' AND a.origen_id = 'ca100000-0000-0000-0000-000000000008'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'), 0,
  'B · y el auxiliar queda en cero');
