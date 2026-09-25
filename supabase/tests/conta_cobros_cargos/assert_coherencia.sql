-- ============================================================================
-- COBROS DE CARGOS · 20261004000200 · coherencia cargo ↔ devengo e
-- idempotencia del contenido completo. Invariantes de UNA sesión, después de
-- assert.sql (junio ya está cerrado: estos cargos y cobros son de julio).
-- ============================================================================
\set ON_ERROR_STOP 1
\set A    '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1   '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2   '''a2a2a2a2-0000-0000-0000-000000000001'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set CXC  '''11000000-0000-0000-0000-00000000a101'''
\set CA15 '''ca000000-0000-0000-0000-000000000015'''
\set CA16 '''ca000000-0000-0000-0000-000000000016'''
\set CA17 '''ca000000-0000-0000-0000-000000000017'''
\set CA18 '''ca000000-0000-0000-0000-000000000018'''
\set Q1   '''cd000000-0000-0000-0000-000000000001'''
\set Q2   '''cd000000-0000-0000-0000-000000000002'''
\set Q3   '''cd000000-0000-0000-0000-000000000003'''
\set Q4   '''cd000000-0000-0000-0000-000000000004'''
\set Q5   '''cd000000-0000-0000-0000-000000000005'''
\set Q6   '''cd000000-0000-0000-0000-000000000006'''

SELECT public.chk(
  (SELECT count(*) FROM (VALUES ('public.conta_cargo_coherencia_devengo(uuid,numeric)')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
       OR has_function_privilege('anon', f.s, 'EXECUTE')), 0,
  '14 · la función de coherencia es interna');

SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;

-- ── 14 · coherencia cargo ↔ devengo ─────────────────────────────────────────
-- a) AUMENTO: devengado 100, el cargo pasa a 150 antes de cobrar nada.
SELECT public.chk_txt(public.cc_coherencia(:A1, :CA15), '-|100.00 GTQ|100.00 GTQ',
  '14a · recién emitido: el cargo concuerda con su devengo');
UPDATE public.cargos_adicionales_unidad SET monto = 150 WHERE id = :CA15;
SELECT public.chk_txt(public.cc_coherencia(:A1, :CA15), 'devengo_desalineado|150.00 GTQ|100.00 GTQ',
  '14a · 100 → 150: el resumen lo señala, en la misma moneda');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_cobro_resumen(:A1) r
    WHERE r.cargo_id = :CA15
      AND r.coherencia_motivo LIKE 'El importe del cargo (150.00 GTQ) no coincide con su devengo vigente (100.00 GTQ)%'
      AND r.coherencia_motivo LIKE '%Restablece el importe del cargo a 100.00 GTQ, o anula el cargo y emite uno nuevo%'), 1,
  '14a · …con un motivo claro y accionable');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000015', 100, 'efectivo', '2026-07-05', 'cd000000-0000-0000-0000-0000000000f1')$$,
  'COBRO_CARGO_DESALINEADO: El importe del cargo \(150.00 GTQ\)', '14a · cobrar 100 se rechaza con el motivo');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000015', 150, 'efectivo', '2026-07-05', 'cd000000-0000-0000-0000-0000000000f2')$$,
  'COBRO_CARGO_DESALINEADO', '14a · cobrar 150 también: la CxC sólo tiene 100');
SELECT public.chk((SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = :CA15), 0,
  '14a · los rechazos no dejaron cobros (ni el importe queda bloqueado por uno)');
SELECT public.chk_txt(public.cc_estado(:CA15), 'pendiente', '14a · el cargo no se marca pagado');
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET estado = 'pagado' WHERE id = 'ca000000-0000-0000-0000-000000000015'$$,
  'CARGO_ESTADO_DERIVADO', '14a · ni a mano');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = :CA15), 1,
  '14a · no hay redevengo: sigue un solo asiento de devengo');
SELECT public.chk_txt(
  (SELECT string_agg(l.debe::text || '/' || l.haber::text, ',' ORDER BY l.orden)
     FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = :CA15),
  '100.00/0.00,0.00/100.00', '14a · …y el asiento publicado no se alteró');
-- Restablecido el importe, se cobra con normalidad.
UPDATE public.cargos_adicionales_unidad SET monto = 100 WHERE id = :CA15;
SELECT public.chk_txt(public.cc_coherencia(:A1, :CA15), '-|100.00 GTQ|100.00 GTQ',
  '14a · restablecido a 100: concuerda otra vez');

-- b) DISMINUCIÓN: devengado 100, el cargo pasa a 80.
UPDATE public.cargos_adicionales_unidad SET monto = 80 WHERE id = :CA16;
SELECT public.chk_txt(public.cc_coherencia(:A1, :CA16), 'devengo_desalineado|80.00 GTQ|100.00 GTQ',
  '14b · 100 → 80: señalado');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000016', 80, 'efectivo', '2026-07-05', 'cd000000-0000-0000-0000-0000000000f3')$$,
  'COBRO_CARGO_DESALINEADO: El importe del cargo \(80.00 GTQ\)', '14b · cobrar 80 (el nuevo importe) se rechaza');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000016', 100, 'efectivo', '2026-07-05', 'cd000000-0000-0000-0000-0000000000f4')$$,
  'COBRO_CARGO_DESALINEADO', '14b · cobrar 100 (el devengo) también');
SELECT public.chk_txt(public.cc_estado(:CA16), 'pendiente', '14b · el cargo sigue pendiente');
SELECT public.chk_txt(public.cc_saldo(:CA16, :CXC)::text, '100.00', '14b · la CxC no se tocó');

-- c) MODIFICADO DESPUÉS DE ANULAR TODOS LOS COBROS.
SELECT public.chk_txt(public.cc_cobrar(:CA17, 100, 'efectivo', '2026-07-05', :Q1),
  'contabilizada/-/pagado', '14c · cobro por el total: pagado');
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET monto = 120 WHERE id = 'ca000000-0000-0000-0000-000000000017'$$,
  'CARGO_CON_COBROS', '14c · con el cobro vivo el importe no cambia');
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || (r.reverso_id IS NOT NULL) || '/' || r.estado_cargo
     FROM public.conta_anular_cobro_cargo(:Q1, 'SINT-AUX se cobró de más') r),
  'anulado/true/pendiente', '14c · anulado el único cobro: reverso y pendiente');
UPDATE public.cargos_adicionales_unidad SET monto = 120 WHERE id = :CA17;
SELECT public.chk_txt(public.cc_coherencia(:A1, :CA17), 'devengo_desalineado|120.00 GTQ|100.00 GTQ',
  '14c · sin cobros vivos el importe cambia, y el resumen lo señala');
SELECT public.chk_falla($$SELECT public.cc_cobrar('ca000000-0000-0000-0000-000000000017', 100, 'efectivo', '2026-07-06', 'cd000000-0000-0000-0000-0000000000f5')$$,
  'COBRO_CARGO_DESALINEADO', '14c · un cobro nuevo se rechaza');
SELECT public.chk_txt(public.cc_estado(:CA17), 'pendiente', '14c · el cargo no vuelve a pagado');
SELECT public.chk_txt(public.cc_aplicado(:CA17)::text, '0.00', '14c · nada aplicado vivo');
SELECT public.chk(public.cc_n_aplicaciones(:CA17), 1, '14c · la aplicación anulada sigue como evidencia');
UPDATE public.cargos_adicionales_unidad SET monto = 100 WHERE id = :CA17;
SELECT public.chk_txt(public.cc_cobrar(:CA17, 100, 'efectivo', '2026-07-06', :Q2),
  'contabilizada/-/pagado', '14c · restablecido: se cobra y queda pagado');

-- d) MONEDA: un cobro ya registrado (pendiente por la cuenta del método) y la
--    moneda del proyecto cambia antes de contabilizarlo. Se compara en la
--    MISMA moneda: no se aplica.
SELECT public.chk_txt(split_part(public.cc_cobrar_completo(:CA18, 60, 'transferencia', '2026-07-05', NULL, NULL, :Q3), '|', 1),
  'pendiente/sin_cuenta/pendiente', '14d · cobro de CA18 (A2) pendiente: falta la cuenta de transferencia');
RESET ROLE;
UPDATE public.projects SET moneda_condominios = 'USD' WHERE id = :A2;
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (:A, :A2, 'metodo_transferencia', '11000000-0000-0000-0000-00000000a209');
SET ROLE authenticated;
SELECT public.chk_txt(public.cc_coherencia(:A2, :CA18), 'devengo_desalineado|60.00 USD|60.00 GTQ',
  '14d · mismo número, otra moneda: no concuerda');
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.codigo FROM public.conta_reprocesar_cargo('pagos', :Q3) r),
  'pendiente/devengo_desalineado', '14d · reprocesar el cobro no lo aplica: pendiente con su código');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion i
    WHERE i.origen_tabla = 'pagos' AND i.origen_id = :Q3 AND i.codigo = 'devengo_desalineado'
      AND i.motivo LIKE 'El cargo está en USD y su devengo vigente en GTQ%'), 1,
  '14d · el motivo explica las dos monedas');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes(:A2) b
    WHERE b.origen_tabla = 'pagos' AND b.origen_id = :Q3 AND b.codigo = 'devengo_desalineado'), 1,
  '14d · visible en la bandeja de pendientes');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes(:A2, 'otro') b
    WHERE b.origen_tabla = 'pagos' AND b.origen_id = :Q3), 1,
  '14d · …bajo «Otros bloqueos»');
SELECT public.chk(public.cc_asientos(:CA18, false), 0, '14d · ningún asiento de cobro');
SELECT public.chk_txt(public.cc_estado(:CA18), 'pendiente', '14d · el cargo sigue pendiente');
RESET ROLE;
UPDATE public.projects SET moneda_condominios = NULL WHERE id = :A2;
SET ROLE authenticated;

-- ── 15 · idempotencia del contenido completo ────────────────────────────────
-- Alta de CA15 (restablecido) con referencia y notas. Luego la «respuesta
-- perdida»: la pantalla reintenta con la misma clave.
SELECT public.chk_txt(public.cc_cobrar_completo(:CA15, 40, 'efectivo', '2026-07-08', 'REC-15', 'caja de julio', :Q4),
  'contabilizada/-/pendiente|cd000000-0000-0000-0000-000000000004', '15 · alta de 40 con referencia y notas');
SELECT public.chk_txt(public.cc_cobrar_completo(:CA15, 40.00, 'efectivo', '2026-07-08', '  REC-15 ', 'caja de julio  ', :Q4),
  'contabilizada/-/pendiente/repetido|cd000000-0000-0000-0000-000000000004',
  '15 · reintento con los mismos datos (espacios sobrantes, 40.00): el MISMO cobro');
SELECT public.chk((SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id = :CA15), 1, '15 · …sin duplicarlo');
SELECT public.chk(public.cc_asientos(:CA15, false), 1, '15 · …ni su asiento');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 40, 'efectivo', '2026-07-09', 'REC-15', 'caja de julio', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: fecha\)', '15 · misma clave, otra FECHA: rechazada, y dice qué difiere');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 40, 'efectivo', '2026-07-08', 'REC-16', 'caja de julio', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: referencia\)', '15 · otra REFERENCIA: rechazada');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 40, 'efectivo', '2026-07-08', NULL, 'caja de julio', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: referencia\)', '15 · SIN referencia: también es otro dato');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 40, 'efectivo', '2026-07-08', 'REC-15', 'otra nota', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: notas\)', '15 · otras NOTAS: rechazada');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 40, 'transferencia', '2026-07-08', 'REC-15', 'caja de julio', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: método\)', '15 · otro MÉTODO: rechazada');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 40.001, 'efectivo', '2026-07-08', 'REC-15', 'caja de julio', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: importe\)', '15 · 40.001 no es 40: el importe se compara exacto');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 45, 'deposito', '2026-07-10', 'X', NULL, 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: importe, método, fecha, referencia, notas\)', '15 · varios campos: los nombra todos');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000017', 40, 'efectivo', '2026-07-08', 'REC-15', 'caja de julio', 'cd000000-0000-0000-0000-000000000004')$$,
  'COBRO_CARGO_CLAVE_REUSADA: esa clave ya identifica otro cobro\. No se registró nada', '15 · la clave en OTRO cargo: rechazada sin describir el ajeno');
SELECT public.chk_txt(
  (SELECT p.monto || '/' || p.metodo || '/' || COALESCE(p.verified_at, p.created_at)::date || '/' || p.referencia || '/' || p.notas || '/' || p.estado
     FROM public.pagos p WHERE p.id = :Q4),
  '40.00/efectivo/2026-07-08/REC-15/caja de julio/verificado', '15 · el cobro original no cambió con ningún rechazo');
SELECT public.chk((SELECT count(*) FROM public.pagos p WHERE p.cargo_adicional_id IN (:CA15, :CA17)), 3,
  '15 · y ningún rechazo creó cobros (CA15: 1; CA17: el anulado y el vigente)');
SELECT public.chk_txt(public.cc_aplicado(:CA15)::text, '40.00', '15 · aplicado una sola vez');

-- Sin referencia ni notas: NULL, '' y '   ' son el mismo dato.
SELECT public.chk_txt(public.cc_cobrar_completo(:CA15, 10, 'efectivo', '2026-07-10', NULL, '', :Q5),
  'contabilizada/-/pendiente|cd000000-0000-0000-0000-000000000005', '15 · alta sin referencia ni notas');
SELECT public.chk_txt(public.cc_cobrar_completo(:CA15, 10, 'efectivo', '2026-07-10', '   ', NULL, :Q5),
  'contabilizada/-/pendiente/repetido|cd000000-0000-0000-0000-000000000005', '15 · reintento con vacíos equivalentes: el mismo');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 10, 'efectivo', '2026-07-10', 'TARDÍA', NULL, 'cd000000-0000-0000-0000-000000000005')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: referencia\)', '15 · agregar la referencia en el reintento: rechazado');

-- Un reintento de un cobro que quedó PENDIENTE devuelve su pendiente, no un éxito.
SELECT public.chk_txt(public.cc_cobrar_completo(:CA15, 70, 'efectivo', '2026-07-11', NULL, NULL, :Q6),
  'pendiente/excede_saldo/pendiente|cd000000-0000-0000-0000-000000000006', '15 · 70 sobre un saldo de 50: pendiente');
SELECT public.chk_txt(public.cc_cobrar_completo(:CA15, 70, 'efectivo', '2026-07-11', NULL, NULL, :Q6),
  'pendiente/excede_saldo/pendiente/repetido|cd000000-0000-0000-0000-000000000006', '15 · su reintento: el mismo pendiente, repetido');
SELECT public.chk_falla($$SELECT public.cc_cobrar_completo('ca000000-0000-0000-0000-000000000015', 50, 'efectivo', '2026-07-11', NULL, NULL, 'cd000000-0000-0000-0000-000000000006')$$,
  'COBRO_CARGO_CLAVE_REUSADA: .*\(difiere: importe\)', '15 · «corregirlo» a 50 con la misma clave: rechazado (se anula y se registra otro)');
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.conta_anular_cobro_cargo(:Q6, 'SINT-AUX excedente') r),
  'anulado', '15 · se anula el excedente');

RESET ROLE;
