-- Invariantes tras las sesiones simultáneas de run.sh (paso 6).

-- A · dos reprocesos simultáneos de la misma cuota con un cobro esperando:
-- un devengo, un asiento de cobro, una aplicación.
SELECT public.chk(public.n_asientos('cuotas_condominio', 'c2000000-0000-0000-0000-0000000000c1', 'cuota_emitida'), 1,
  'A · dos reprocesos simultáneos de la cuota: UN devengo');
SELECT public.chk(public.n_asientos('pagos', '9b000000-0000-0000-0000-000000000010', 'pago_contabilizado'), 1,
  'A · …y UN asiento de su cobro');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id = '9b000000-0000-0000-0000-000000000010'), 1,
  'A · …con UNA aplicación');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = '9b000000-0000-0000-0000-000000000010' AND resultado = 'contabilizada'), 1,
  'A · exactamente un reproceso contabilizó el cobro');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-0000000000c1', '11000000-0000-0000-0000-00000000a101'), 0,
  'A · la cuota queda saldada');

-- B · reproceso de la cuota contra reproceso de su cobro: un asiento.
SELECT public.chk(public.n_asientos('pagos', '9b000000-0000-0000-0000-000000000011', 'pago_contabilizado'), 1,
  'B · cuota y cobro reprocesados a la vez: UN asiento del cobro');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id = '9b000000-0000-0000-0000-000000000011'), 1,
  'B · …con UNA aplicación');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-0000000000c3', '11000000-0000-0000-0000-00000000a101'), 0,
  'B · la cuota queda saldada');

-- C · dos cobros simultáneos de la misma cuota: el candado por cuota impide
-- que los dos se apliquen a la misma mora.
SELECT public.chk(
  public.aplicado('9b000000-0000-0000-0000-000000000020', 'cuota_mora')
  + public.aplicado('9b000000-0000-0000-0000-000000000021', 'cuota_mora'), 10,
  'C · entre los dos cobros simultáneos, la mora (10) se aplica UNA vez');
SELECT public.chk(
  public.aplicado('9b000000-0000-0000-0000-000000000020', 'cuota_emitida')
  + public.aplicado('9b000000-0000-0000-0000-000000000021', 'cuota_emitida'), 10,
  'C · …y el resto (10) va al principal');
SELECT public.chk(public.saldo_cuota('c2000000-0000-0000-0000-0000000000c2', '11000000-0000-0000-0000-00000000a101'), 90,
  'C · la CxC de la cuota baja exactamente 20 (quedan 90)');
