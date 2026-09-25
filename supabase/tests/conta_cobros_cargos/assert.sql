-- ============================================================================
-- COBROS DE CARGOS ADICIONALES (20261004000000) · invariantes de UNA sesión
--
-- Todo como en la aplicación: SET ROLE authenticated + request.jwt.claim.sub.
-- RESET ROLE sólo para lo que la aplicación no puede hacer (y se prueba que el
-- guard lo rechaza incluso así) o para preparar configuración.
-- ============================================================================
\set ON_ERROR_STOP 1
\set A    '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1   '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2   '''a2a2a2a2-0000-0000-0000-000000000001'''
\set B1   '''b1b1b1b1-0000-0000-0000-000000000001'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set VIS  '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set ADB  '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set UNO  '''e0000000-0000-0000-0000-00000000a001'''
\set CXC  '''11000000-0000-0000-0000-00000000a101'''
\set ING  '''11000000-0000-0000-0000-00000000a103'''
\set CA1  '''ca000000-0000-0000-0000-000000000001'''
\set CA3  '''ca000000-0000-0000-0000-000000000003'''
\set CA4  '''ca000000-0000-0000-0000-000000000004'''
\set CA5  '''ca000000-0000-0000-0000-000000000005'''
\set CA6  '''ca000000-0000-0000-0000-000000000006'''
\set CA7  '''ca000000-0000-0000-0000-000000000007'''
\set CA8  '''ca000000-0000-0000-0000-000000000008'''
\set CA9  '''ca000000-0000-0000-0000-000000000009'''
\set CA11 '''ca000000-0000-0000-0000-000000000011'''
\set P1   '''cb000000-0000-0000-0000-000000000001'''
\set P2   '''cb000000-0000-0000-0000-000000000002'''
\set P3   '''cb000000-0000-0000-0000-000000000003'''
\set P4   '''cb000000-0000-0000-0000-000000000004'''
\set P5   '''cb000000-0000-0000-0000-000000000005'''
\set P6   '''cb000000-0000-0000-0000-000000000006'''
\set P7   '''cb000000-0000-0000-0000-000000000007'''
\set P8   '''cb000000-0000-0000-0000-000000000008'''
\set P9   '''cb000000-0000-0000-0000-000000000009'''
\set PB   '''cb000000-0000-0000-0000-0000000000b1'''

-- ── 0 · superficie ──────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     ('public.conta_registrar_cobro_cargo(uuid,numeric,text,date,text,text,uuid)'),
     ('public.conta_anular_cobro_cargo(uuid,text)'),
     ('public.conta_cargos_cobro_resumen(uuid)'),
     ('public.conta_cargo_cobros(uuid)')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
      AND NOT has_function_privilege('anon', f.s, 'EXECUTE')), 4,
  '0 · las cuatro RPC: authenticated sí, anon no');
SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     ('public.conta_contabilizar_cobro_cargo_interno(uuid,text)'),
     ('public.conta_contabilizar_cobro_cargo_seguro(uuid,text)'),
     ('public.conta_cargo_sincronizar_estado(uuid)'),
     ('public.conta_cargo_saldo_cobro(uuid,uuid)'),
     ('public.conta_cargo_estado_derivado(uuid,numeric)'),
     ('public.conta_cobro_cargo_autorizar(boolean)')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
       OR has_function_privilege('anon', f.s, 'EXECUTE')), 0,
  '0 · las funciones internas no son invocables por la aplicación');

-- ── 1 · permisos y validaciones del alta ────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SET ROLE authenticated;
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 10, 'efectivo', '2026-06-05', NULL)$$,
  'No autorizado', '1 · el visor contable no registra cobros');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargo_cobros(:CA1)), 0,
  '1 · …pero sí puede consultarlos (lectura)');

SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 0, 'efectivo', '2026-06-05', NULL)$$,
  'COBRO_CARGO_IMPORTE', '1 · importe cero');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 10.001, 'efectivo', '2026-06-05', NULL)$$,
  'COBRO_CARGO_IMPORTE', '1 · más de dos decimales');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 10, 'paypal', '2026-06-05', NULL)$$,
  'COBRO_CARGO_METODO', '1 · un método de pasarela no es de back-office');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 10, 'efectivo', CURRENT_DATE + 1, NULL)$$,
  'COBRO_CARGO_FECHA', '1 · fecha futura');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 10, 'efectivo', '2026-05-31', NULL)$$,
  'COBRO_CARGO_FECHA.*anticipo', '1 · antes del cargo: un anticipo no se registra aquí');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000004', 10, 'efectivo', '2026-06-05', NULL)$$,
  'COBRO_CARGO_SIN_RESPONSABLE', '1 · cargo sin responsable histórico: rechazado con motivo');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000005', 10, 'efectivo', '2026-06-05', NULL)$$,
  'COBRO_CARGO_PAGADO_SIN_COBRO', '1 · «pagado» histórico sin cobro: no se inventan aplicaciones');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000006', 10, 'efectivo', '2026-06-05', NULL)$$,
  'COBRO_CARGO_HISTORICO', '1 · cargo sin devengo por tipo (histórico): rechazado con motivo');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000011', 10, 'efectivo', '2026-06-05', NULL)$$,
  'COBRO_CARGO_ANULADO', '1 · cargo anulado');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000008', 10, 'efectivo', '2026-06-05', NULL)$$,
  'no existe o no está en tu ámbito', '1 · cargo de OTRA empresa: como inexistente');
SELECT public.chk(public.cc_n_aplicaciones(:CA5) + public.cc_n_aplicaciones(:CA6), 0,
  '1 · los rechazos no dejaron cobros ni aplicaciones');

-- Escrituras directas: ni siquiera sin RLS.
RESET ROLE;
SELECT public.chk_falla($$INSERT INTO public.pagos (cliente_id, project_id, cargo_adicional_id, monto, metodo, estado)
  VALUES ('e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
          'ca000000-0000-0000-0000-000000000001', 10, 'efectivo', 'verificado')$$,
  'COBRO_CARGO_SOLO_RPC', '1 · un INSERT directo de cobro de cargo se rechaza');
SELECT public.chk_falla($$INSERT INTO public.pagos (cliente_id, project_id, cargo_adicional_id, cuota_id, monto, metodo, estado)
  VALUES ('e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
          'ca000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 10, 'efectivo', 'pendiente')$$,
  'COBRO_CARGO_SOLO_RPC', '1 · un pago no es de un cargo y de otro documento a la vez (ni siquiera se admite el alta)');
-- Aun con la marca de la RPC (la que deja conta_registrar_cobro_cargo), la
-- validación de conta_tg_pagos hace lo que hacían la FK y el CHECK
-- (20261004000100): exclusividad y cargo existente del mismo proyecto.
SELECT public.chk_falla($$SELECT set_config('conta.cobro_cargo_pago', 'cb000000-0000-0000-0000-0000000000e1', true);
  INSERT INTO public.pagos (id, cliente_id, project_id, cargo_adicional_id, cuota_id, monto, metodo, estado)
  VALUES ('cb000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
          'ca000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001', 10, 'efectivo', 'pendiente')$$,
  'COBRO_CARGO_EXCLUSIVO', '1 · con la marca: un cobro de cargo no es también de una cuota');
SELECT public.chk_falla($$SELECT set_config('conta.cobro_cargo_pago', 'cb000000-0000-0000-0000-0000000000e2', true);
  INSERT INTO public.pagos (id, cliente_id, project_id, cargo_adicional_id, monto, metodo, estado)
  VALUES ('cb000000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
          'ca000000-0000-0000-0000-0000000000ff', 10, 'efectivo', 'pendiente')$$,
  'COBRO_CARGO_AJENO', '1 · con la marca: un cargo inexistente se rechaza (lo que daba la FK)');
SELECT public.chk_falla($$SELECT set_config('conta.cobro_cargo_pago', 'cb000000-0000-0000-0000-0000000000e3', true);
  INSERT INTO public.pagos (id, cliente_id, project_id, cargo_adicional_id, monto, metodo, estado)
  VALUES ('cb000000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-00000000a002', 'a1a1a1a1-0000-0000-0000-000000000001',
          'ca000000-0000-0000-0000-000000000001', 10, 'efectivo', 'pendiente')$$,
  'COBRO_CARGO_AJENO', '1 · con la marca: otro cliente que no es el responsable histórico se rechaza');
SET ROLE authenticated;

-- ── 2 · cobro parcial ───────────────────────────────────────────────────────
SELECT public.chk_txt(public.cc_cobrar(:CA1, 30, 'efectivo', '2026-06-05', :P1),
  'contabilizada/-/pendiente', '2 · cobro parcial de 30: contabilizado, el cargo sigue pendiente');
SELECT public.chk_txt(public.cc_lineas(:P1),
  'CAJA:D30.00:-:-:-,1-CXC-RES:H30.00:adicional_reparacion:u:x',
  '2 · cargo a la cuenta del método, abono a la CxC del DEVENGO con tipo, unidad y auxiliar');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_tabla = 'pagos' AND a.origen_id = :P1 AND l.cuenta_id = :ING), 0,
  '2 · el cobro NO toca el ingreso: no se reconoce otra vez');
SELECT public.chk_txt(public.cc_saldo(:CA1, :CXC)::text, '70.00', '2 · la CxC del cargo baja a 70');
SELECT public.chk_txt(
  (SELECT p.cliente_id::text || '/' || p.project_id::text || '/' || p.estado || '/' || p.tipo_aplicacion
     FROM public.pagos p WHERE p.id = :P1),
  'e0000000-0000-0000-0000-00000000a001/a1a1a1a1-0000-0000-0000-000000000001/verificado/abono',
  '2 · responsable histórico y proyecto salen del cargo; ya verificado; abono');

-- Repetición idempotente: misma clave, mismo resultado, nada nuevo.
SELECT public.chk_txt(public.cc_cobrar(:CA1, 30, 'efectivo', '2026-06-05', :P1),
  'contabilizada/-/pendiente/repetido', '2 · repetir la misma alta devuelve la ya registrada');
SELECT public.chk((SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = :CA1), 1,
  '2 · …sin crear otro cobro');
SELECT public.chk(public.cc_asientos(:CA1, false), 1, '2 · …ni otro asiento');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 31, 'efectivo', '2026-06-05', 'cb000000-0000-0000-0000-000000000001')$$,
  'COBRO_CARGO_CLAVE_REUSADA', '2 · la misma clave con otro importe no se confunde');

-- ── 3 · segundo cobro, cambios manuales bloqueados ──────────────────────────
SELECT public.chk_txt(public.cc_cobrar(:CA1, 50, 'efectivo', '2026-06-10', :P2),
  'contabilizada/-/pendiente', '3 · segundo cobro parcial de 50');
SELECT public.chk_txt(public.cc_saldo(:CA1, :CXC)::text, '20.00', '3 · la CxC del cargo queda en 20');
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET estado = 'pagado' WHERE id = 'ca000000-0000-0000-0000-000000000001'$$,
  'CARGO_ESTADO_DERIVADO', '3 · «pagado» a mano se rechaza: el estado sale de los cobros');
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ca000000-0000-0000-0000-000000000001'$$,
  'CARGO_CON_COBROS', '3 · el cargo no se anula con cobros vivos');
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET monto = 120 WHERE id = 'ca000000-0000-0000-0000-000000000001'$$,
  'CARGO_CON_COBROS', '3 · ni cambia de importe');

-- ── 4 · excedente y cobro anterior pendiente ────────────────────────────────
SELECT public.chk_txt(public.cc_cobrar(:CA1, 40, 'efectivo', '2026-06-12', :P3),
  'pendiente/excede_saldo/pendiente', '4 · 40 sobre un saldo de 20: pendiente, no se aplica a medias');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion i
    WHERE i.origen_tabla = 'pagos' AND i.origen_id = :P3
      AND i.motivo LIKE '%no se reparte a otros documentos ni se convierte en anticipo%'), 1,
  '4 · el motivo explica que no se reparte ni se vuelve anticipo');
SELECT public.chk_txt(public.cc_saldo(:CA1, :CXC)::text, '20.00', '4 · el excedente no reduce la CxC');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes(:A1) b
    WHERE b.origen_tabla = 'pagos' AND b.origen_id = :P3 AND b.codigo = 'excede_saldo'), 1,
  '4 · el excedente es un pendiente VISIBLE en la bandeja');
SELECT public.chk_txt(public.cc_cobrar(:CA1, 20, 'efectivo', '2026-06-15', :P4),
  'pendiente/cobro_anterior_pendiente/pendiente', '4 · un cobro posterior espera al anterior pendiente');

-- ── 5 · anular el excedente y reprocesar: saldo completo ────────────────────
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || COALESCE(r.reverso_id::text, 'sin-reverso') || '/' || r.cobros_pendientes
     FROM public.conta_anular_cobro_cargo(:P3, 'SINT-AUX excedente, se devolvió') r),
  'anulado/sin-reverso/1', '5 · anular el excedente: no tenía asiento y queda 1 cobro pendiente');
SELECT public.chk_txt(
  (SELECT string_agg(COALESCE(r.evento, '-') || ':' || r.resultado, ',' ORDER BY r.evento)
     FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', :CA1) r),
  'cargo_adicional_emitido:ya_contabilizada,pago_contabilizado:contabilizada',
  '5 · reprocesar el cargo contabiliza su cobro pendiente');
SELECT public.chk_txt(public.cc_estado(:CA1), 'pagado', '5 · saldo completo: el servidor marca el cargo pagado');
SELECT public.chk_txt(public.cc_saldo(:CA1, :CXC)::text, '0.00', '5 · la CxC del cargo queda en 0');
SELECT public.chk_txt(public.cc_aplicado(:CA1)::text, '100.00', '5 · aplicado 100 = devengo');
SELECT public.chk_txt(
  (SELECT string_agg(COALESCE(r.evento, '-') || ':' || r.resultado, ',' ORDER BY r.evento)
     FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', :CA1) r),
  'cargo_adicional_emitido:ya_contabilizada', '5 · reprocesar otra vez no duplica nada');
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.conta_reprocesar_cargo('pagos', :P2) r),
  'ya_contabilizada', '5 · reprocesar un cobro ya contabilizado: idempotente');
SELECT public.chk(public.cc_asientos(:CA1, false), 3, '5 · tres asientos de cobro en total (30, 50, 20)');

-- ── 6 · anular un cobro contabilizado: reverso, evidencia y estado ──────────
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || (r.reverso_id IS NOT NULL) || '/' || r.estado_cargo
     FROM public.conta_anular_cobro_cargo(:P1, 'SINT-AUX cheque devuelto') r),
  'anulado/true/pendiente', '6 · anular el cobro de 30: su asiento se reversa y el cargo vuelve a pendiente');
SELECT public.chk_txt(public.cc_saldo(:CA1, :CXC)::text, '30.00', '6 · la CxC del cargo vuelve a 30');
SELECT public.chk_txt(public.cc_aplicado(:CA1)::text, '70.00', '6 · lo aplicado vivo baja a 70');
SELECT public.chk(public.cc_n_aplicaciones(:CA1), 3, '6 · la aplicación del cobro anulado SIGUE como evidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.id = :P1 AND p.estado = 'rechazado'
      AND p.verification_notes = 'SINT-AUX cheque devuelto'), 1,
  '6 · el cobro no se borra: queda rechazado con su motivo');
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.conta_anular_cobro_cargo(:P1, 'SINT-AUX otra vez') r),
  'ya_anulado', '6 · anular dos veces es idempotente');
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.codigo FROM public.conta_reprocesar_cargo('pagos', :P1) r),
  'bloqueada/documento_anulado', '6 · un cobro anulado no se vuelve a contabilizar');

RESET ROLE;
SELECT public.chk_falla($$DELETE FROM public.pagos WHERE id = 'cb000000-0000-0000-0000-000000000002'$$,
  'COBRO_CARGO_INBORRABLE', '6 · un cobro de cargo no se borra (ni sin RLS)');
SELECT public.chk_falla($$UPDATE public.pagos SET estado = 'rechazado' WHERE id = 'cb000000-0000-0000-0000-000000000002'$$,
  'COBRO_CARGO_SOLO_RPC', '6 · rechazarlo por fuera de la RPC se rechaza');
SELECT public.chk_falla($$UPDATE public.pagos SET deleted_at = now() WHERE id = 'cb000000-0000-0000-0000-000000000002'$$,
  'COBRO_CARGO_SOLO_RPC', '6 · borrarlo lógicamente por fuera de la RPC se rechaza');
SELECT public.chk_falla($$UPDATE public.pagos SET monto = 49 WHERE id = 'cb000000-0000-0000-0000-000000000002'$$,
  'COBRO_CARGO_INMUTABLE', '6 · su importe no cambia');
SELECT public.chk_falla($$UPDATE public.pagos SET cargo_adicional_id = 'ca000000-0000-0000-0000-000000000009' WHERE id = 'cb000000-0000-0000-0000-000000000002'$$,
  'COBRO_CARGO_VINCULO_INMUTABLE', '6 · ni cambia de cargo');
SELECT public.chk_falla($$DELETE FROM public.cargos_adicionales_unidad WHERE id = 'ca000000-0000-0000-0000-000000000001'$$,
  'CARGO_CON_COBROS', '6 · un cargo con cobros no se borra (ni sin RLS)');
SET ROLE authenticated;
SELECT public.chk_falla($$DELETE FROM public.conta_cobro_aplicaciones WHERE cargo_adicional_id IS NOT NULL$$,
  'permission denied', '6 · authenticated no puede borrar aplicaciones');

-- Cobrar de nuevo el saldo reabierto.
SELECT public.chk_txt(public.cc_cobrar(:CA1, 30, 'efectivo', '2026-06-20', :P5),
  'contabilizada/-/pagado', '6 · un nuevo cobro por el saldo reabierto vuelve a dejarlo pagado');

-- ── 7 · devengo pendiente (sin configuración) y luego resuelto ──────────────
SELECT public.chk_txt(public.cc_cobrar(:CA3, 40, 'efectivo', '2026-06-05', :P6),
  'pendiente/devengo_pendiente/pendiente', '7 · cobro de un cargo sin devengo: pendiente visible');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion i
    WHERE i.origen_tabla = 'pagos' AND i.origen_id = :P6 AND i.motivo LIKE '%sin_configuracion%'), 1,
  '7 · el motivo trae la causa del cargo (sin configuración)');
SELECT public.chk_txt(public.cc_saldo(:CA3, :CXC)::text, '0.00', '7 · nada contabilizado todavía');
RESET ROLE;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :A1, 'adicional_multa', :CXC, :ING);
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(COALESCE(r.evento, '-') || ':' || r.resultado, ',' ORDER BY r.evento)
     FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', :CA3) r),
  'cargo_adicional_emitido:contabilizada,pago_contabilizado:contabilizada',
  '7 · configurado y reprocesado: devengo y cobro, en ese orden');
SELECT public.chk_txt(public.cc_estado(:CA3), 'pagado', '7 · y el cargo queda pagado');
SELECT public.chk_txt(public.cc_saldo(:CA3, :CXC)::text, '0.00', '7 · CxC 40 − 40');

-- ── 8 · cuenta del método sin configurar ────────────────────────────────────
SELECT public.chk_txt(public.cc_cobrar(:CA9, 10, 'transferencia', '2026-06-20', :P7),
  'pendiente/sin_cuenta/pendiente', '8 · transferencia sin cuenta mapeada: pendiente con motivo');
RESET ROLE;
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (:A, :A1, 'metodo_transferencia', '11000000-0000-0000-0000-00000000a119');
SET ROLE authenticated;
SELECT public.chk_txt((SELECT r.resultado FROM public.conta_reprocesar_cargo('pagos', :P7) r),
  'contabilizada', '8 · mapeada la cuenta, reprocesar el cobro lo contabiliza');
SELECT public.chk_txt(public.cc_lineas(:P7),
  'BANCO:D10.00:-:-:-,1-CXC-RES:H10.00:adicional_reparacion:u:x', '8 · contra la cuenta del método');

-- ── 9 · otro ledger, códigos raros ──────────────────────────────────────────
SELECT public.chk_txt(public.cc_cobrar(:CA7, 80, 'efectivo', '2026-06-05', :P8),
  'contabilizada/-/pagado', '9 · ledger A2: cobro por el total');
SELECT public.chk_txt(public.cc_lineas(:P8),
  'Z-CAJA:D80.00:-:-:-,Z-COBRAR:H80.00:adicional_reparacion:u:x',
  '9 · sin códigos fijos: la CxC es la del devengo de ESE ledger');

-- ── 10 · aislamiento entre empresas y proyectos ─────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_cobro_resumen(:A1) r WHERE r.cargo_id = :CA7), 0,
  '10 · el resumen de A1 no trae cargos de A2');
SELECT public.chk_falla($$SELECT * FROM public.conta_cargos_cobro_resumen('b1b1b1b1-0000-0000-0000-000000000001')$$,
  'no pertenece a la empresa activa', '10 · el resumen de otra empresa se rechaza');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_cargo_cobros('ca000000-0000-0000-0000-000000000001')$$,
  'no existe o no está en tu ámbito', '10 · la empresa B no ve los cobros de A');
SELECT public.chk_falla($$SELECT * FROM public.conta_anular_cobro_cargo('cb000000-0000-0000-0000-000000000002', 'SINT-AUX intruso')$$,
  'no existe', '10 · ni anula un cobro de A');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000009', 1, 'efectivo', '2026-06-20', 'cb000000-0000-0000-0000-000000000002')$$,
  'no existe o no está en tu ámbito', '10 · ni reutiliza la clave de un cobro de A contra un cargo de A');
SELECT public.chk_txt(public.cc_cobrar(:CA8, 70, 'efectivo', '2026-06-05', :PB),
  'contabilizada/-/pagado', '10 · la empresa B cobra su propio cargo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_cobro_resumen(:B1) r WHERE r.cargo_id = :CA8 AND r.saldo = 0), 1,
  '10 · y lo ve saldado');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000001', 1, 'efectivo', '2026-06-20', 'cb000000-0000-0000-0000-0000000000b1')$$,
  'COBRO_CARGO_CLAVE_REUSADA', '10 · la clave de un cobro de B no devuelve datos de B a A');

-- ── 11 · resumen y detalle para Condominios ─────────────────────────────────
SELECT public.chk_txt(
  (SELECT r.por_tipo || '/' || r.devengado || '/' || r.aplicado || '/' || r.en_proceso || '/' || r.saldo
          || '/' || r.cobros || '/' || r.pagado_sin_cobro
     FROM public.conta_cargos_cobro_resumen(:A1) r WHERE r.cargo_id = :CA1),
  'true/100.00/100.00/0.00/0.00/5/false', '11 · CA1: devengado 100, aplicado 100, cinco cobros (dos anulados)');
SELECT public.chk_txt(
  (SELECT r.por_tipo || '/' || r.pagado_sin_cobro FROM public.conta_cargos_cobro_resumen(:A1) r WHERE r.cargo_id = :CA5),
  'true/true', '11 · CA5 se informa como pagado sin cobro');
SELECT public.chk_txt(
  (SELECT r.por_tipo::text FROM public.conta_cargos_cobro_resumen(:A1) r WHERE r.cargo_id = :CA6),
  'false', '11 · CA6 es histórico (no por tipo)');
SELECT public.chk_txt(
  (SELECT string_agg(c.monto || ':' || c.estado || ':' || c.aplicado || ':' || (c.reverso_id IS NOT NULL)
                     || ':' || COALESCE(c.codigo, '-'), ',' ORDER BY c.fecha, c.pago_id)
     FROM public.conta_cargo_cobros(:CA1) c),
  '30.00:rechazado:30.00:true:-,50.00:verificado:50.00:false:-,40.00:rechazado:0.00:false:-,20.00:verificado:20.00:false:-,30.00:verificado:30.00:false:-',
  '11 · el detalle muestra cada cobro con su aplicación y reverso');

-- ── 12 · estado de cuenta y conciliación ────────────────────────────────────
SELECT public.chk_txt(
  (SELECT string_agg(m->>'componente' || ':' || (m->>'abono'), ',' ORDER BY (m->>'n')::int)
     FROM jsonb_array_elements(public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, NULL, 500, 0)->'movimientos') m
    WHERE m->>'documento_tabla' = 'pagos' AND m->>'documento' LIKE '%· cargo SINT-AUX CA1%'),
  'cargo:30.00,cargo:0.00,cargo:50.00,cargo:20.00,cargo:30.00',
  '12 · los cobros del cargo son abonos del auxiliar, componente «cargo» (el reverso del 30 incluido)');
SELECT public.chk(
  (SELECT count(*) FROM jsonb_array_elements(public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, NULL, 500, 0)->'movimientos') m
    WHERE m->>'cargo_adicional_id' = 'ca000000-0000-0000-0000-000000000001'), 5,
  '12 · cada línea de cobro identifica su cargo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL) f
    WHERE f.clase = 'cobro_sin_vinculo'), 1,
  '12 · «cobro_sin_vinculo» sólo para el pagado histórico sin cobro');
SELECT public.chk_txt(
  (SELECT f.origen_id::text FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL) f
    WHERE f.clase = 'cobro_sin_vinculo'),
  'ca000000-0000-0000-0000-000000000005', '12 · …y es CA5');
SELECT public.chk_txt(
  (public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL)->>'cuadra'),
  'true', '12 · conciliación de hoy: documentos = contabilidad, sin discrepancias');
SELECT public.chk_txt(
  (public.conta_estado_cuenta_conciliacion(:A1, NULL, 'f0000000-0000-0000-0000-00000000a002', NULL)->>'cuadra'),
  'true', '12 · conciliación por unidad (U2) también cuadra');

-- ── 13 · cortes antes y después de un reverso en período CERRADO ────────────
-- CA9: cobro de 10 del 2026-06-20. Se cierra junio y se anula: el reverso
-- lleva fecha de HOY (no se reabre ni se re-fecha el período).
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES (:A, :A1, '2026-06', 'cerrado');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || (r.reverso_id IS NOT NULL) FROM public.conta_anular_cobro_cargo(:P7, 'SINT-AUX transferencia revertida') r),
  'anulado/true', '13 · anular el cobro con junio cerrado');
SELECT public.chk_txt(
  (SELECT a.fecha::text FROM public.conta_asientos a
    WHERE a.id = (SELECT x.anulado_por_id FROM public.conta_asientos x
                   WHERE x.origen_tabla = 'pagos' AND x.origen_id = :P7
                     AND x.origen_evento = 'pago_contabilizado')),
  CURRENT_DATE::text, '13 · el reverso lleva fecha de hoy');
-- Corte a fin de junio: el cobro estaba vivo; su reverso es posterior.
SELECT public.chk_txt(
  (SELECT (public.conta_estado_cuenta(:A1, NULL, 'f0000000-0000-0000-0000-00000000a002', NULL, '2026-06-30', 500, 0)->'resumen'->>'saldo_final')),
  '130.00', '13 · corte 30-jun (U2): 50 de CA2 + 90 de CA9 − 10 cobrado = 130');
SELECT public.chk(
  (SELECT count(*) FROM jsonb_array_elements(public.conta_estado_cuenta(:A1, NULL, 'f0000000-0000-0000-0000-00000000a002', NULL, '2026-06-30', 500, 0)->'movimientos') m
    WHERE m->>'documento_tabla' = 'pagos' AND (m->>'reversado_despues_del_corte')::boolean), 1,
  '13 · …y el cobro se rotula «reversado después del corte»');
SELECT public.chk_txt(
  (public.conta_estado_cuenta_conciliacion(:A1, NULL, 'f0000000-0000-0000-0000-00000000a002', '2026-06-30')->>'cuadra'),
  'true', '13 · la conciliación al 30-jun cuadra (el cobro aplicaba entonces)');
-- Corte de hoy: el reverso ya existe.
SELECT public.chk_txt(
  (SELECT (public.conta_estado_cuenta(:A1, NULL, 'f0000000-0000-0000-0000-00000000a002', NULL, NULL, 500, 0)->'resumen'->>'saldo_final')),
  '140.00', '13 · corte de hoy (U2): el reverso reabre los 10');
SELECT public.chk_txt(
  (public.conta_estado_cuenta_conciliacion(:A1, NULL, 'f0000000-0000-0000-0000-00000000a002', NULL)->>'cuadra'),
  'true', '13 · la conciliación de hoy cuadra (el cobro reversado ya no aplica)');
-- Corte ANTES del primer cobro de CA1 (y de su reverso, fechado igual).
SELECT public.chk_txt(
  (SELECT string_agg(f.origen_id::text || ':' || f.clase, ',' ORDER BY f.origen_id)
     FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL, '2026-06-04') f
    WHERE f.origen_tabla = 'pagos'),
  NULL, '13 · corte 04-jun: ningún cobro de cargo existía todavía');
SELECT public.chk_txt(
  (public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, '2026-06-07')->>'cuadra'),
  'true', '13 · conciliación al 07-jun (tras el cobro de 30 y su reverso con la misma fecha) cuadra');

RESET ROLE;
