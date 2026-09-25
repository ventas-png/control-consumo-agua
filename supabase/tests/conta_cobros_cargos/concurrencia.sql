-- Invariantes tras las sesiones simultáneas de run.sh (fase 6/6).
\set ON_ERROR_STOP 1
\set CA2  '''ca000000-0000-0000-0000-000000000002'''
\set CA10 '''ca000000-0000-0000-0000-000000000010'''
\set CA12 '''ca000000-0000-0000-0000-000000000012'''
\set CA13 '''ca000000-0000-0000-0000-000000000013'''
\set CA14 '''ca000000-0000-0000-0000-000000000014'''
\set CXC  '''11000000-0000-0000-0000-00000000a101'''

-- A · dos cobros de 30 sobre 50: uno se aplica, el otro NO se lleva el mismo saldo.
SELECT public.chk(public.cc_asientos(:CA2, true), 1, 'A · un solo asiento de cobro vivo');
SELECT public.chk_txt(public.cc_aplicado(:CA2)::text, '30.00', 'A · aplicado 30, nunca 60');
SELECT public.chk_txt(public.cc_saldo(:CA2, :CXC)::text, '20.00', 'A · la CxC del cargo queda en 20');
SELECT public.chk_txt(
  (SELECT string_agg(public.cc_intento(p.id), ',' ORDER BY public.cc_intento(p.id))
     FROM public.pagos p WHERE p.cargo_adicional_id = :CA2),
  'contabilizada/-,pendiente/excede_saldo', 'A · el segundo queda pendiente por excedente');
SELECT public.chk_txt(public.cc_estado(:CA2), 'pendiente', 'A · el cargo sigue pendiente');

-- B · dos reprocesos simultáneos: un devengo y un cobro, sin duplicados.
SELECT public.chk(public.n_asientos('cargos_adicionales_unidad', :CA10, 'cargo_adicional_emitido'), 1,
  'B · un solo devengo');
SELECT public.chk(public.cc_asientos(:CA10, false), 1, 'B · un solo asiento de cobro');
SELECT public.chk_txt(public.cc_aplicado(:CA10)::text, '30.00', 'B · aplicado una vez');
SELECT public.chk_txt(public.cc_estado(:CA10), 'pagado', 'B · el cargo queda pagado');

-- C · reproceso contra anulación del cobro: el cobro se contabilizó y se
-- reversó (o nunca se contabilizó); en ningún caso queda un asiento vivo de
-- un cobro anulado. La evidencia queda.
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = :CA12 AND p.estado = 'rechazado'), 1,
  'C · el cobro quedó anulado');
SELECT public.chk(public.cc_asientos(:CA12, true), 0, 'C · sin asiento vivo del cobro anulado');
SELECT public.chk_txt(public.cc_aplicado(:CA12)::text, '0.00', 'C · nada aplicado vivo');
SELECT public.chk(public.cc_asientos(:CA12, false) - public.cc_n_aplicaciones(:CA12), 0,
  'C · cada asiento de cobro (reversado) conserva su aplicación como evidencia');
SELECT public.chk(public.n_vivos('cargos_adicionales_unidad', :CA12, 'cargo_adicional_emitido'), 1,
  'C · el devengo del cargo sí quedó contabilizado');
SELECT public.chk_txt(public.cc_saldo(:CA12, :CXC)::text, '35.00', 'C · la CxC del cargo queda completa');
SELECT public.chk_txt(public.cc_estado(:CA12), 'pendiente', 'C · el cargo queda pendiente');

-- D · el cobro llegó primero: la anulación del cargo se rechazó.
SELECT public.chk_txt(public.cc_estado(:CA13), 'pagado', 'D · el cargo NO se anuló y quedó pagado');
SELECT public.chk_txt(public.cc_aplicado(:CA13)::text, '20.00', 'D · su cobro aplicado');

-- E · la anulación llegó primero: el cobro se rechazó y no hay pago huérfano.
SELECT public.chk_txt(public.cc_estado(:CA14), 'anulado', 'E · el cargo quedó anulado');
SELECT public.chk((SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = :CA14), 0,
  'E · ningún cobro sobre el cargo anulado');

-- F · la misma clave en dos cargos a la vez: un solo cobro, en el cargo que
--     llegó primero; el otro cargo, intacto.
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.id = 'cd000000-0000-0000-0000-0000000000a1'
      AND p.cargo_adicional_id = 'ca000000-0000-0000-0000-000000000019'), 1,
  'F · la clave quedó en CA19');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = 'ca000000-0000-0000-0000-000000000020'), 0,
  'F · CA20 sin cobros: el reintento contra otro cargo no creó nada');
-- G · misma clave y datos a la vez: un cobro, un asiento, aplicado una vez.
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = 'ca000000-0000-0000-0000-000000000019'), 2,
  'G · CA19: dos cobros (F y G), no tres');
SELECT public.chk(public.cc_asientos('ca000000-0000-0000-0000-000000000019', false), 2,
  'G · dos asientos de cobro');
SELECT public.chk_txt(public.cc_aplicado('ca000000-0000-0000-0000-000000000019')::text, '40.00',
  'G · aplicado 30 + 10, sin duplicar el doble envío');
