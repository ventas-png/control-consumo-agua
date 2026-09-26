-- ============================================================================
-- SALDOS A FAVOR · invariantes de una sesión (20261007000000)
--
-- Cobros, anticipos, aplicaciones y reversiones los hacen usuarios de la
-- aplicación (SET ROLE authenticated + request.jwt.claim.sub). El estado se
-- lee con las ayudas SECURITY DEFINER del fixture o con RESET ROLE.
-- ============================================================================
\set ON_ERROR_STOP 1
\set A1   '''a1a1a1a1-0000-0000-0000-000000000001'''
\set B1   '''b1b1b1b1-0000-0000-0000-000000000001'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set CONT '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set VIS  '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set ADB  '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set UNO  '''e0000000-0000-0000-0000-00000000a001'''
\set DOS  '''e0000000-0000-0000-0000-00000000a002'''
\set TRES '''e0000000-0000-0000-0000-00000000a003'''
\set U1   '''f0000000-0000-0000-0000-00000000a001'''
\set U2   '''f0000000-0000-0000-0000-00000000a002'''
\set ANT  '''11000000-0000-0000-0000-00000000a1a1'''
\set CXC  '''11000000-0000-0000-0000-00000000a101'''
\set SA   '''ca5f0000-0000-0000-0000-000000000001'''
\set SB   '''ca5f0000-0000-0000-0000-000000000002'''
\set SC   '''ca5f0000-0000-0000-0000-000000000003'''
\set SD   '''ca5f0000-0000-0000-0000-000000000004'''
\set Q1   '''c5f00000-0000-0000-0000-000000000001'''
\set Q2   '''c5f00000-0000-0000-0000-000000000002'''
\set Q3   '''c5f00000-0000-0000-0000-000000000003'''
\set Q4   '''c5f00000-0000-0000-0000-000000000004'''
\set PA   '''9f5f0000-0000-0000-0000-00000000000a'''
\set PB   '''9f5f0000-0000-0000-0000-00000000000b'''
\set PC   '''9f5f0000-0000-0000-0000-00000000000c'''
\set PQ1  '''9f5f0000-0000-0000-0000-000000000011'''
\set PQ2  '''9f5f0000-0000-0000-0000-000000000012'''
\set PQ3  '''9f5f0000-0000-0000-0000-000000000013'''
\set PQ4  '''9f5f0000-0000-0000-0000-000000000014'''
\set AN1  '''9f5f0000-0000-0000-0000-0000000000a1'''
\set AN2  '''9f5f0000-0000-0000-0000-0000000000a2'''
\set K1   '''5a000000-0000-0000-0000-000000000001'''
\set K2   '''5a000000-0000-0000-0000-000000000002'''
\set K3   '''5a000000-0000-0000-0000-000000000003'''
\set K4   '''5a000000-0000-0000-0000-000000000004'''
\set K5   '''5a000000-0000-0000-0000-000000000005'''
\set K6   '''5a000000-0000-0000-0000-000000000006'''
\set K7   '''5a000000-0000-0000-0000-000000000007'''

-- ── 0 · superficie ──────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY[
     'public.conta_registrar_anticipo(uuid, uuid, uuid, numeric, text, date, text, text, uuid)',
     'public.conta_anular_anticipo(uuid, text)',
     'public.conta_aplicar_saldo_favor(uuid, text, uuid, numeric, text, uuid)',
     'public.conta_revertir_aplicacion_saldo_favor(uuid, text)',
     'public.conta_saldos_favor(uuid, uuid, uuid)',
     'public.conta_saldo_favor_documentos(uuid)']) f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE')), 6,
  '0 · las seis RPC: authenticated sí, anon no');
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY[
     'public.conta_cuenta_anticipos(uuid, uuid)',
     'public.conta_sf_asiento_vivo(uuid)',
     'public.conta_sf_disponible(uuid)',
     'public.conta_sf_registrar_origen(uuid, uuid, text, uuid, text, uuid)',
     'public.conta_contabilizar_anticipo_interno(uuid, text)',
     'public.conta_contabilizar_anticipo_seguro(uuid, text)',
     'public.conta_cuota_saldo_cobro(uuid)',
     'public.conta_sf_autorizar(text)',
     'public.conta_ec_saldo_favor(uuid, uuid, uuid, uuid, date, date)']) f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')), 0,
  '0 · las funciones internas no son invocables por la aplicación');
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY['public.conta_anticipos','public.conta_saldo_favor_origenes',
                                     'public.conta_saldo_favor_aplicaciones']) t
    WHERE has_table_privilege('authenticated', t, 'INSERT') OR has_table_privilege('authenticated', t, 'UPDATE')
       OR has_table_privilege('authenticated', t, 'DELETE')), 0,
  '0 · las tablas nuevas no se escriben desde la aplicación (sólo lectura con RLS)');

-- ── 1 · SIN cuenta de anticipos: el cobro se registra y queda pendiente ─────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || COALESCE(r.codigo, '-') || '/' || r.estado_cargo
     FROM public.conta_registrar_cobro_cargo(:SA, 130, 'efectivo', '2026-09-10', 'SINT-AUX', NULL, :PA) r),
  'pendiente/excede_saldo/pendiente', '1 · 130 sobre 100 sin cuenta de anticipos: registrado y pendiente');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.pagos WHERE id = :PA AND monto = 130 AND estado = 'verificado'), 1,
  '1 · el cobro NO se pierde: queda en pagos, verificado');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion i
    WHERE i.origen_tabla = 'pagos' AND i.origen_id = :PA
      AND i.motivo LIKE '%excedente de 30.00 queda como saldo a favor%anticipo_clientes%'), 1,
  '1 · el motivo dice el excedente y qué configurar');
SELECT public.chk_txt(public.sf_origen(:PA), NULL, '1 · sin cuenta no hay saldo a favor');

-- Anticipo SIN deuda, también sin cuenta: registrado, pendiente.
SET ROLE authenticated;
SELECT public.chk_txt(public.sf_anticipo(:U1, :UNO, 60, :AN1), 'pendiente/sin_cuenta/0',
  '1 · anticipo de 60 sin cuenta: registrado y pendiente (sin_cuenta)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes(:A1) b
    WHERE b.origen_tabla = 'pagos' AND b.origen_id = :AN1 AND b.codigo = 'sin_cuenta'
      AND b.responsable_id = :UNO AND b.unidad_id = :U1 AND b.monto = 60), 1,
  '1 · la bandeja lo muestra con su titular y su motivo');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos a WHERE a.origen_tabla = 'pagos' AND a.origen_id = :AN1), 0,
  '1 · un anticipo sin cuenta NO cae a ingreso_otros (ningún asiento)');

-- Cuenta de ACTIVO mapeada: inválida.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', :A1, 'anticipo_clientes', '11000000-0000-0000-0000-00000000a1a2');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(r.resultado || '/' || COALESCE(r.codigo, '-'), ',') FROM public.conta_reprocesar_cargo('pagos', :AN1) r),
  'pendiente/cuenta_invalida', '1 · con una cuenta de ACTIVO: sigue pendiente, cuenta inválida');
RESET ROLE;
UPDATE public.conta_mapeo_cuentas SET cuenta_id = :ANT
 WHERE company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND project_id = :A1 AND evento = 'anticipo_clientes';

-- ── 2 · configurada la cuenta: anticipo y excedente se contabilizan ─────────
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(r.resultado, ',') FROM public.conta_reprocesar_cargo('pagos', :AN1) r),
  'contabilizada', '2 · reprocesar el anticipo lo contabiliza');
SELECT public.chk_txt(
  (SELECT string_agg(COALESCE(r.evento, '-') || ':' || r.resultado, ',' ORDER BY r.evento)
     FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', :SA) r),
  'cargo_adicional_emitido:ya_contabilizada,pago_contabilizado:contabilizada',
  '2 · reprocesar el cargo contabiliza su cobro con excedente');
RESET ROLE;
SELECT public.chk_txt(public.sf_lineas('pagos', :AN1), 'CAJA:D60.00:-:-,ANT-CLI:H60.00:x:u',
  '2 · anticipo: caja contra ANTICIPOS con titular, nunca ingreso');
SELECT public.chk_txt(public.sf_origen(:AN1), 'anticipo:60.00:60.00', '2 · anticipo: 60 disponibles');
SELECT public.chk_txt(public.sf_lineas('pagos', :PA),
  'CAJA:D130.00:-:-,1-CXC-RES:H100.00:x:u,ANT-CLI:H30.00:x:u',
  '2 · excedente: RECIBIDO 130 al método, APLICADO 100 a la CxC, REMANENTE 30 a anticipos');
SELECT public.chk_txt(public.sf_origen(:PA), 'excedente:30.00:30.00', '2 · excedente: 30 disponibles');
SELECT public.chk_txt(public.sf_estado_cargo(:SA), 'pagado', '2 · el cargo queda pagado (aplicado = devengo)');
SELECT public.chk_txt(public.sf_cxc_doc('cargos_adicionales_unidad', :SA)::text, '0.00', '2 · su CxC en 0');
SELECT public.chk_txt(public.sf_libro(:ANT, :UNO, :U1)::text, '90.00', '2 · libro: 90 a favor de Uno en U1');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT c.aplicado || '/' || c.saldo_a_favor FROM public.conta_cargo_cobros(:SA) c WHERE c.pago_id = :PA),
  '100.00/30.00', '2 · Condominios ve lo aplicado y lo que quedó a favor');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes(:A1) b WHERE b.origen_id IN (:PA, :AN1)), 0,
  '2 · ya no están en la bandeja');

-- ── 3 · exacto, parcial, cuotas, pagador distinto, sin verificar ────────────
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.estado_cargo FROM public.conta_registrar_cobro_cargo(:SB, 50, 'efectivo', '2026-09-10', NULL, NULL, :PB) r),
  'contabilizada/pagado', '3 · cobro EXACTO: contabilizado y pagado');
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.estado_cargo FROM public.conta_registrar_cobro_cargo(:SC, 30, 'efectivo', '2026-09-10', NULL, NULL, :PC) r),
  'contabilizada/pendiente', '3 · cobro PARCIAL: contabilizado, sigue pendiente');
RESET ROLE;
SELECT public.chk_txt(COALESCE(public.sf_origen(:PB), '-') || '|' || COALESCE(public.sf_origen(:PC), '-'), '-|-',
  '3 · ni el exacto ni el parcial generan saldo a favor');

SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:PQ1, :UNO, :A1, :Q1, 150, 'efectivo', 'verificado', now());
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:PQ2, :DOS, :A1, :Q2, 120, 'efectivo', 'verificado', now());
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado) VALUES
  (:PQ3, :UNO, :A1, :Q3, 200, 'efectivo', 'pendiente');
RESET ROLE;
SELECT public.chk_txt(public.sf_lineas('pagos', :PQ1),
  'CAJA:D150.00:-:-,1-CXC-RES:H100.00:x:u,ANT-CLI:H50.00:x:u',
  '3 · cuota: 100 a principal y 50 a favor del responsable histórico');
SELECT public.chk_txt(public.sf_origen(:PQ1), 'excedente:50.00:50.00', '3 · cuota: 50 disponibles');
SELECT public.chk_txt(public.sf_intento(:PQ2), 'pendiente/excede_saldo',
  '3 · pagador que NO es el responsable: el excedente no se asigna a otro cliente');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion i
    WHERE i.origen_tabla = 'pagos' AND i.origen_id = :PQ2 AND i.motivo LIKE '%pagador no es el responsable histórico%'), 1,
  '3 · …con el motivo');
SELECT public.chk_txt(COALESCE(public.sf_origen(:PQ3), '-'), '-',
  '3 · un cobro PENDIENTE de verificación no genera saldo disponible');
SELECT public.chk_txt(public.sf_libro(:ANT, :UNO, :U1)::text, '140.00', '3 · libro: 60 + 30 + 50 = 140');

-- ── 4 · aplicar: permisos, idempotencia, límites y titular ──────────────────
\set O_ANT '(SELECT public.sf_origen_id(''9f5f0000-0000-0000-0000-0000000000a1''))'
\set O_SA  '(SELECT public.sf_origen_id(''9f5f0000-0000-0000-0000-00000000000a''))'
\set O_Q1  '(SELECT public.sf_origen_id(''9f5f0000-0000-0000-0000-000000000011''))'

SELECT set_config('request.jwt.claim.sub', :VIS, false);
SET ROLE authenticated;
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 10, %L)$$, :O_ANT, :SC, :K1),
  'No autorizado para aplicar', '4 · el visor contable no aplica saldos');
SELECT public.chk((SELECT jsonb_array_length(public.conta_saldos_favor(:A1)->'origenes'))::bigint, 3,
  '4 · …pero sí los consulta');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 10, %L)$$, :O_ANT, :SC, :K1),
  'No autorizado para aplicar', '4 · el contador SIN «cambiar estado» tampoco: no se inventan permisos');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 10, %L)$$, :O_ANT, :SC, :K1),
  'no existe o no está en tu ámbito', '4 · el admin de OTRA empresa: como inexistente');
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_origenes), 0,
  '4 · la RLS no le muestra orígenes de otra empresa');
SELECT set_config('request.jwt.claim.sub', :ADM, false);

SELECT public.chk_txt(public.sf_aplicar(:O_ANT, 'cargos_adicionales_unidad', :SC, 25, :K1),
  '25.00/0.00/25.00/35.00/25.00/pendiente', '4 · aplicación PARCIAL de 25 del anticipo al cargo SC (debía 50)');
SELECT public.chk_txt(public.sf_aplicar(:O_ANT, 'cargos_adicionales_unidad', :SC, 25, :K1),
  '25.00/0.00/25.00/35.00/-/pendiente/repetido', '4 · doble clic / reintento: la MISMA aplicación, repetida');
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 20, %L)$$, :O_ANT, :SC, :K1),
  'SALDO_FAVOR_CLAVE_REUSADA', '4 · la misma clave con otro importe se rechaza');
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 30, %L)$$, :O_ANT, :SC, :K2),
  'SALDO_FAVOR_EXCEDE_DOCUMENTO', '4 · no se aplica más que el saldo del documento');
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 20, %L)$$, :O_SA, :SD, :K2),
  'SALDO_FAVOR_TITULAR_DISTINTO', '4 · el saldo de U1 no se traslada a un cargo de U2, aunque sea del mismo cliente');
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cuotas_condominio', %L, 31, %L)$$, :O_SA, :Q4, :K2),
  'SALDO_FAVOR_INSUFICIENTE', '4 · no se aplica más que el disponible del origen (30)');
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cuotas_condominio', %L, 5, %L)$$, :O_SA, :Q2, :K2),
  'SALDO_FAVOR_COBROS_PENDIENTES', '4 · un documento con cobros pendientes de contabilizar no recibe aplicaciones (su saldo depende de ellos)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_aplicaciones), 1,
  '4 · los rechazos no dejaron aplicaciones');
SELECT public.chk_txt(public.sf_cxc_doc('cargos_adicionales_unidad', :SC)::text, '25.00',
  '4 · CxC de SC: 80 − 30 cobrado − 25 aplicado');
SELECT public.chk_txt(public.sf_lineas('conta_saldo_favor_aplicaciones', :K1),
  'ANT-CLI:D25.00:x:u,1-CXC-RES:H25.00:x:u', '4 · el asiento: anticipos contra la CxC del devengo, sin ingreso');

-- Moneda distinta (el origen en otra moneda: dato sintético)
UPDATE public.conta_saldo_favor_origenes SET moneda = 'USD' WHERE pago_id = :PA;
SET ROLE authenticated;
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 5, %L)$$, :O_SA, :SC, :K2),
  'SALDO_FAVOR_MONEDA_DISTINTA', '4 · no se aplica entre monedas');
RESET ROLE;
UPDATE public.conta_saldo_favor_origenes o SET moneda = a.moneda_base
  FROM public.conta_asientos a WHERE a.id = o.asiento_id AND o.pago_id = :PA;

-- Fallo intermedio: el asiento no se puede generar → no queda NADA.
UPDATE public.conta_cuentas SET es_detalle = false WHERE id = :ANT;
SET ROLE authenticated;
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 5, %L)$$, :O_SA, :SC, :K2),
  'SALDO_FAVOR_SIN_ASIENTO', '4 · fallo intermedio: sin asiento no hay aplicación');
RESET ROLE;
UPDATE public.conta_cuentas SET es_detalle = true WHERE id = :ANT;
SELECT public.chk((SELECT count(*) FROM public.conta_saldo_favor_aplicaciones WHERE id = :K2), 0,
  '4 · …ni fila de aplicación');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'conta_saldo_favor_aplicaciones' AND origen_id = :K2), 0,
  '4 · …ni asiento a medias');

-- ── 5 · cuota con mora: mora primero, y el cobro posterior la ve ────────────
SET ROLE authenticated;
SELECT public.chk_txt(public.sf_aplicar(:O_Q1, 'cuotas_condominio', :Q4, 30, :K3),
  '30.00/10.00/20.00/20.00/80.00/pendiente', '5 · 30 a la cuota Q4: 10 a la mora (primero) y 20 al principal');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:PQ4, :UNO, :A1, :Q4, 80, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(public.sf_lineas('pagos', :PQ4), 'CAJA:D80.00:-:-,1-CXC-RES:H80.00:x:u',
  '5 · el cobro posterior de 80 cubre el resto exacto: la aplicación ya contaba (sin excedente falso)');
SELECT public.chk_txt(COALESCE(public.sf_origen(:PQ4), '-'), '-', '5 · …y no genera saldo a favor');
SELECT public.chk_txt(public.sf_cxc_doc('cuotas_condominio', :Q4)::text, '0.00', '5 · CxC de Q4 en 0');

-- ── 6 · estado de cuenta: sin duplicar abonos, con el saldo a favor ─────────
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT (e->'saldo_a_favor'->>'saldo_final') || '|' || (e->'saldo_a_favor'->>'cuadra')
     FROM public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, NULL, 500, 0) e),
  '85.00|true', '6 · saldo a favor de Uno: 60 + 30 + 50 − 25 − 30 = 85, conciliado');
SELECT public.chk(
  (SELECT count(*) FROM jsonb_array_elements((SELECT e->'movimientos' FROM public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, NULL, 500, 0) e)) m
    WHERE m->>'documento' LIKE 'Aplicación de saldo a favor%'), 3,
  '6 · las aplicaciones figuran como abonos a su documento (SC, mora y principal de Q4)');
SELECT public.chk(
  (SELECT count(*) FROM jsonb_array_elements((SELECT e->'movimientos' FROM public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, NULL, 500, 0) e)) m
    WHERE m->>'cuenta_codigo' = 'ANT-CLI'), 0,
  '6 · el remanente NO aparece como abono de CxC (no se duplica ni se confunde con ingreso)');
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') || '|' || (c->'saldo_a_favor'->>'cuadra')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true|true', '6 · la conciliación cuadra: CxC contra documentos y saldo a favor contra orígenes');
SELECT public.chk_txt(
  (SELECT (e->'saldo_a_favor'->>'saldo_final') FROM public.conta_estado_cuenta(:A1, NULL, :U2, NULL, NULL, 500, 0) e),
  '0.00', '6 · por unidad: U2 no tiene saldo a favor');
SELECT public.chk_falla($$SELECT public.conta_estado_cuenta('a1a1a1a1-0000-0000-0000-000000000001', NULL, NULL)$$,
  'Indica un auxiliar', '6 · el estado de cuenta exige un sujeto');

-- ── 7 · rechazo de un cobro cuyo saldo ya se usó: bloqueado ─────────────────
-- (Ajuste: primero se usa parte del excedente de SA.)
SELECT public.chk_txt(public.sf_aplicar(:O_SA, 'cargos_adicionales_unidad', :SC, 10, :K4),
  '10.00/0.00/10.00/20.00/15.00/pendiente', '7 · 10 del excedente de SA a SC');
SELECT public.chk_falla($$SELECT * FROM public.conta_anular_cobro_cargo('9f5f0000-0000-0000-0000-00000000000a', 'SINT-AUX rechazo')$$,
  'COBRO_SALDO_FAVOR_APLICADO', '7 · anular el cobro con saldo aplicado: rechazado');
SELECT public.chk_falla($$UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT' WHERE id = '9f5f0000-0000-0000-0000-000000000011'$$,
  'COBRO_SALDO_FAVOR_APLICADO', '7 · rechazar desde Agua el cobro de la cuota con saldo aplicado: rechazado');
SELECT public.chk_falla(format($$SELECT public.conta_anular_asiento(%L, 'SINT manual')$$,
    (SELECT o.asiento_id FROM public.conta_saldo_favor_origenes o WHERE o.pago_id = :PA)),
  'COBRO_SALDO_FAVOR_APLICADO', '7 · reversar a mano (Pólizas) el asiento del cobro: rechazado');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.pagos WHERE id IN (:PA, :PQ1) AND estado = 'verificado'), 2,
  '7 · los cobros siguen verificados');
SELECT public.chk_txt(public.sf_origen(:PA), 'excedente:30.00:20.00', '7 · y su saldo intacto');

-- Revertir la aplicación (con motivo), después sí se anula el cobro.
SET ROLE authenticated;
SELECT public.chk_falla(format($$SELECT * FROM public.conta_revertir_aplicacion_saldo_favor(%L, '')$$, :K4),
  'motivo', '7 · revertir exige motivo');
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || (r.reverso_id IS NOT NULL) || '/' || r.disponible_restante || '/' || r.estado_documento
     FROM public.conta_revertir_aplicacion_saldo_favor(:K4, 'SINT-AUX se aplicó al cargo equivocado') r),
  'revertida/true/30.00/pendiente', '7 · revertir: reverso, disponible repuesto, el cargo vuelve a deber');
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.conta_revertir_aplicacion_saldo_favor(:K4, 'SINT-AUX otra vez') r),
  'ya_revertida', '7 · revertir otra vez: idempotente');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_saldo_favor_aplicaciones x
    WHERE x.id = :K4 AND x.revertida_por = :ADM AND x.motivo_reverso = 'SINT-AUX se aplicó al cargo equivocado'
      AND x.revertida_at IS NOT NULL AND x.asiento_reverso_id IS NOT NULL), 1,
  '7 · evidencia: actor de la sesión, motivo, hora del servidor y reverso');
SELECT public.chk_txt(public.sf_cxc_doc('cargos_adicionales_unidad', :SC)::text, '25.00',
  '7 · CxC de SC: el reverso deshace la aplicación, el original sigue a la vista');
SELECT public.chk_falla($$UPDATE public.conta_saldo_favor_aplicaciones SET monto = 1 WHERE id = '5a000000-0000-0000-0000-000000000001'$$,
  'SALDO_FAVOR_INMUTABLE', '7 · una aplicación no se reescribe');
SELECT public.chk_falla($$DELETE FROM public.conta_saldo_favor_aplicaciones WHERE id = '5a000000-0000-0000-0000-000000000004'$$,
  'SALDO_FAVOR_INBORRABLE', '7 · ni se borra');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || (r.reverso_id IS NOT NULL) FROM public.conta_anular_cobro_cargo(:PA, 'SINT-AUX se devolvió') r),
  'anulado/true', '7 · sin aplicaciones vivas, el cobro se anula y se reversa');
RESET ROLE;
SELECT public.chk_txt(public.sf_origen(:PA), 'excedente:30.00:0.00', '7 · su saldo a favor deja de estar disponible');
SET ROLE authenticated;
SELECT public.chk_falla(format($$SELECT public.sf_aplicar(%L, 'cargos_adicionales_unidad', %L, 5, %L)$$, :O_SA, :SC, :K5),
  'SALDO_FAVOR_NO_DISPONIBLE', '7 · no se aplica el saldo de un cobro anulado');

-- ── 8 · anticipos: idempotencia, titular, escrituras directas, anulación ────
SELECT public.chk_txt(public.sf_anticipo(:U1, :UNO, 60, :AN1), 'contabilizada/-/35.00/repetido',
  '8 · el mismo anticipo otra vez: repetido (su disponible actual)');
SELECT public.chk_falla(format($$SELECT public.sf_anticipo(%L, %L, 61, %L)$$, :U1, :UNO, :AN1),
  'ANTICIPO_CLAVE_REUSADA', '8 · la misma clave con otro importe se rechaza');
SELECT public.chk_falla(format($$SELECT public.sf_anticipo(%L, %L, 10, %L)$$, :U1, :TRES, :AN2),
  'ANTICIPO_TITULAR', '8 · un cliente no vinculado a la unidad no es titular');
SELECT public.chk_falla($$UPDATE public.pagos SET estado = 'rechazado' WHERE id = '9f5f0000-0000-0000-0000-0000000000a1'$$,
  'ANTICIPO_SOLO_RPC|COBRO_SALDO_FAVOR_APLICADO', '8 · un anticipo no se rechaza por UPDATE directo');
SELECT public.chk_falla($$UPDATE public.pagos SET monto = 1 WHERE id = '9f5f0000-0000-0000-0000-0000000000a1'$$,
  'ANTICIPO_INMUTABLE', '8 · ni cambia de importe');
SELECT public.chk_txt(public.sf_anticipo(:U2, :DOS, 15, :AN2), 'contabilizada/-/15.00',
  '8 · anticipo del ARRENDATARIO en U2: suyo, no del pagador');
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || (r.reverso_id IS NOT NULL) FROM public.conta_anular_anticipo(:AN2, 'SINT-AUX error de captura') r),
  'anulado/true', '8 · anular un anticipo sin aplicaciones: reverso');
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.conta_anular_anticipo(:AN2, 'SINT-AUX otra vez') r),
  'ya_anulado', '8 · anular otra vez: idempotente');
RESET ROLE;
SELECT public.chk_txt(public.sf_origen(:AN2), 'anticipo:15.00:0.00', '8 · su saldo deja de estar disponible');
SELECT public.chk_falla($$DELETE FROM public.pagos WHERE id = '9f5f0000-0000-0000-0000-0000000000a2'$$,
  'ANTICIPO_INBORRABLE', '8 · un anticipo no se borra');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos_rechazo_eventos r WHERE r.pago_id = :AN2 AND r.evento = 'rechazo' AND r.actor = :ADM), 1,
  '8 · la anulación deja su evidencia de rechazo (hora del servidor y actor)');

-- ── 9 · lecturas y aislamiento ──────────────────────────────────────────────
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(d.documento_tabla || ':' || d.saldo, ',' ORDER BY d.documento_tabla, d.saldo)
     FROM public.conta_saldo_favor_documentos(:O_ANT) d),
  'cargos_adicionales_unidad:20.00,cargos_adicionales_unidad:25.00,cargos_adicionales_unidad:30.00,cargos_adicionales_unidad:60.00,cargos_adicionales_unidad:60.00,cargos_adicionales_unidad:100.00,cuotas_condominio:100.00',
  '9 · candidatos del anticipo: sólo documentos de Uno en U1 con saldo (SH, SC, SG, SE, SF, SA reabierto y Q3)');
SELECT public.chk_txt(
  (SELECT string_agg(x->>'moneda' || ':' || (x->>'disponible'), ',') FROM jsonb_array_elements(public.conta_saldos_favor(:A1, :UNO, :U1)->'disponible_por_moneda') x),
  (SELECT a.moneda_base || ':55.00' FROM public.conta_asientos a WHERE a.origen_tabla = 'pagos' AND a.origen_id = :AN1 LIMIT 1),
  '9 · disponible de Uno en U1: 35 (anticipo) + 0 (anulado) + 20 (excedente de Q1) = 55');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT public.conta_saldos_favor('a1a1a1a1-0000-0000-0000-000000000001')$$,
  'no pertenece a la empresa', '9 · otra empresa no lee los saldos de A');
SELECT public.chk_falla($$SELECT public.sf_anticipo('f0000000-0000-0000-0000-00000000a001', 'e0000000-0000-0000-0000-00000000a001', 5, '9f5f0000-0000-0000-0000-0000000000b9')$$,
  'no pertenece a la empresa', '9 · ni registra anticipos en su contabilidad');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
RESET ROLE;

-- ── 10 · estado de la cuota cubierta por saldo a favor (20261009000000) ─────
\set AN6  '''9f5f0000-0000-0000-0000-0000000000a6'''
\set K8   '''5a000000-0000-0000-0000-000000000008'''
\set K9   '''5a000000-0000-0000-0000-000000000009'''
\set K10  '''5a000000-0000-0000-0000-000000000010'''
\set O_AN6 '(SELECT public.sf_origen_id(''9f5f0000-0000-0000-0000-0000000000a6''))'
-- Sección 5: 30 de saldo a favor + el cobro de 80 dejaron Q4 en 0.
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.estado || '/' || c.metodo_pago || '/' || (c.pagada_at IS NOT NULL) || '/' || (c.pago_id IS NULL)
     FROM public.cuotas_condominio c WHERE c.id = :Q4),
  'pagada/pagado/saldo_a_favor/true/true', '10 · Q4 (saldo a favor + cobro, en 0): pagada por la regla, sin inventar pago_id');
SELECT public.chk_txt(
  (SELECT string_agg(e.accion || ':' || e.disparo || ':' || (e.valores_antes->>'cuota_estado') || ':' || (e.actor IS NOT NULL), ',')
     FROM public.conta_sf_cuota_estado_eventos e WHERE e.cuota_id = :Q4),
  'marcada:cobro:pendiente:true', '10 · …con evento: la marcó el cobro que completó la cobertura, con su estado anterior y actor');
SELECT public.chk_txt((SELECT c.cuota_estado FROM public.cuotas_condominio c WHERE c.id = :Q1), 'pendiente',
  '10 · Q1 (sin saldo a favor aplicado) no la toca la regla');

-- Q3 emitida y vencida hace 30 días; un anticipo de 100 la cubre entera.
UPDATE public.cuotas_condominio SET cuota_estado = 'emitida', emitida_at = now() - interval '40 days',
       fecha_vencimiento = CURRENT_DATE - 30 WHERE id = :Q3;
INSERT INTO public.reglas_mora_config (company_id, project_id, nombre, dias_vencimiento, tipo, valor, aplicar_sobre)
  SELECT p.company_id, p.id, 'SINT-AUX mora 10%', 0, 'porcentaje', 10, 'monto_cuota' FROM public.projects p WHERE p.id = :A1;
SET ROLE authenticated;
SELECT public.chk_txt(public.sf_anticipo(:U1, :UNO, 100, :AN6), 'contabilizada/-/100.00', '10 · anticipo de 100 de Uno en U1');
SELECT public.chk_txt(public.sf_aplicar(:O_AN6, 'cuotas_condominio', :Q3, 100, :K8),
  '100.00/0.00/100.00/0.00/0.00/pagada', '10 · aplicar 100 a Q3: la cuota queda pagada (y la respuesta lo dice)');
RESET ROLE;
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.estado || '/' || c.fecha_pago || '/' || c.metodo_pago FROM public.cuotas_condominio c WHERE c.id = :Q3),
  'pagada/pagado/' || CURRENT_DATE || '/saldo_a_favor', '10 · Q3 pagada por saldo a favor');
-- Lo que antes pasaba con ella: recordatorio, mora y cobro en línea.
SELECT public.aplicar_mora_cuotas_vencidas();
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || COALESCE(c.mora_monto::text, 'sin_mora') FROM public.cuotas_condominio c WHERE c.id = :Q3),
  'pagada/sin_mora', '10 · el cron de mora no la vence ni le aplica recargo');
SELECT public.chk((SELECT count(*) FROM public.recargos_mora r WHERE r.cuota_id = :Q3), 0, '10 · …ni recargo en recargos_mora');
SELECT public.chk(
  (SELECT count(*) FROM public.cuotas_condominio c
    WHERE c.id = :Q3 AND c.deleted_at IS NULL AND c.estado <> 'pagado'
      AND (c.cuota_estado IS NULL OR c.cuota_estado NOT IN ('pagada','anulada'))), 0,
  '10 · no es candidata del cron de recordatorios (su mismo filtro)');
SELECT public.chk(
  (SELECT count(*) FROM public.cuotas_condominio c WHERE c.id = :Q3 AND c.cuota_estado IN ('emitida','vencida')), 0,
  '10 · create-charge la rechaza (sólo cobra emitida/vencida)');
SELECT public.chk_txt(public.conta_cuota_saldo_favor_aplicado(:Q3)::text, '100.00',
  '10 · lo aplicado por saldo a favor que resta create-charge');
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY['authenticated','anon']) r
    WHERE has_function_privilege(r, 'public.conta_cuota_saldo_favor_aplicado(uuid)', 'EXECUTE')), 0,
  '10 · …sólo service_role la ejecuta');

-- REVERSIÓN de la aplicación: vuelve EXACTAMENTE su estado anterior.
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.estado_documento
     FROM public.conta_revertir_aplicacion_saldo_favor(:K8, 'SINT-AUX era de otra cuota') r),
  'revertida/emitida', '10 · revertir: la cuota vuelve a emitida');
RESET ROLE;
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.estado || '/' || COALESCE(c.pagada_at::text, '-') || '/' || COALESCE(c.fecha_pago::text, '-')
          || '/' || COALESCE(c.metodo_pago, '-') FROM public.cuotas_condominio c WHERE c.id = :Q3),
  'emitida/pendiente/-/-/-', '10 · …con sus valores anteriores (estado legacy, fecha, método), sin inventar nada');
SELECT public.chk_txt(
  (SELECT string_agg(e.accion || ':' || e.disparo, ',' ORDER BY e.ocurrido_at, e.accion DESC) FROM public.conta_sf_cuota_estado_eventos e WHERE e.cuota_id = :Q3),
  'marcada:aplicacion,restaurada:asiento_aplicacion', '10 · eventos: marcada al aplicar, restaurada al reversar su asiento');
-- Y sigue su curso normal: el cron la vence y le aplica la mora.
SELECT public.aplicar_mora_cuotas_vencidas();
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.mora_monto FROM public.cuotas_condominio c WHERE c.id = :Q3),
  'vencida/10.00', '10 · revertida, el cron la vence y aplica la mora como a cualquier cuota impaga');

-- RECHAZO del cobro que completaba la cobertura de Q4: vuelve a pendiente.
SET ROLE authenticated;
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT-AUX sin fondos'
 WHERE id = :PQ4;
RESET ROLE;
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.estado || '/' || COALESCE(c.metodo_pago, '-') FROM public.cuotas_condominio c WHERE c.id = :Q4),
  'pendiente/pendiente/-', '10 · rechazado el cobro de 80, Q4 vuelve a deber y a su estado anterior');
SELECT public.chk_txt(
  (SELECT e.disparo FROM public.conta_sf_cuota_estado_eventos e WHERE e.cuota_id = :Q4 AND e.accion = 'restaurada'),
  'asiento_cobro', '10 · …por el reverso del asiento del cobro');

-- REVERSO MANUAL desde Pólizas del asiento de una aplicación.
SET ROLE authenticated;
SELECT public.chk_txt(public.sf_aplicar(:O_AN6, 'cuotas_condominio', :Q4, 80, :K9),
  '80.00/0.00/80.00/20.00/0.00/pagada', '10 · 80 del anticipo a Q4: pagada otra vez');
SELECT public.conta_anular_asiento(
  (SELECT x.asiento_id FROM public.conta_saldo_favor_aplicaciones x WHERE x.id = :K9), 'SINT-AUX reverso manual');
RESET ROLE;
SELECT public.chk_txt((SELECT c.cuota_estado FROM public.cuotas_condominio c WHERE c.id = :Q4), 'pendiente',
  '10 · reversado a mano el asiento de la aplicación, Q4 vuelve a deber');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.estado_documento FROM public.conta_revertir_aplicacion_saldo_favor(:K9, 'SINT-AUX sello del reverso manual') r),
  'revertida/pendiente', '10 · sellar su reversión después no la mueve');

-- Si alguien más cambió la cuota después de marcarla, la regla no la toca.
SELECT public.chk_txt(public.sf_aplicar(:O_AN6, 'cuotas_condominio', :Q4, 80, :K10),
  '80.00/0.00/80.00/20.00/0.00/pagada', '10 · 80 otra vez: pagada');
RESET ROLE;
UPDATE public.cuotas_condominio SET metodo_pago = 'transferencia', pagada_at = now() WHERE id = :Q4;
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.resultado || '/' || r.estado_documento FROM public.conta_revertir_aplicacion_saldo_favor(:K10, 'SINT-AUX prueba') r),
  'revertida/pagada', '10 · revertida la aplicación, la cuota que otro marcó pagada sigue pagada (no se pisa)');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_sf_cuota_estado_eventos e WHERE e.cuota_id = :Q4), 5,
  '10 · Q4: marcada, restaurada, marcada, restaurada, marcada; la última reversión no restaura lo que cambió otro');
SELECT public.chk_falla($$UPDATE public.conta_sf_cuota_estado_eventos SET disparo = 'x'$$,
  'BITACORA_INMUTABLE', '10 · la bitácora no se reescribe');
SELECT public.chk_falla($$DELETE FROM public.conta_sf_cuota_estado_eventos$$,
  'BITACORA_INMUTABLE', '10 · ni se borra');

-- ── 11 · D2: mora sobre el SALDO pendiente (20261010000000) ────────────────
\set Q5  '''c5f00000-0000-0000-0000-000000000005'''
\set Q6  '''c5f00000-0000-0000-0000-000000000006'''
\set PQ5 '''9f5f0000-0000-0000-0000-000000000015'''
\set PQ6 '''9f5f0000-0000-0000-0000-000000000016'''
\set K11 '''5a000000-0000-0000-0000-000000000011'''
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  (:Q5, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', :A1, :U1, 'SINT-AUX Q5', 100, '2026-08', 'pendiente', 'mantenimiento'),
  (:Q6, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', :A1, :U1, 'SINT-AUX Q6', 100, '2026-08', 'pendiente', 'mantenimiento');
UPDATE public.cuotas_condominio SET cuota_estado = 'emitida', emitida_at = now() - interval '40 days',
       fecha_vencimiento = CURRENT_DATE - 30 WHERE id IN (:Q5, :Q6);
UPDATE public.reglas_mora_config SET aplicar_sobre = 'saldo_vencido' WHERE nombre = 'SINT-AUX mora 10%';
-- Q5: 30 de saldo a favor + un cobro de 20 → saldo 50.
SET ROLE authenticated;
SELECT public.chk_txt(public.sf_aplicar(:O_AN6, 'cuotas_condominio', :Q5, 30, :K11),
  '30.00/0.00/30.00/70.00/70.00/emitida', '11 · 30 de saldo a favor a Q5');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:PQ5, :UNO, :A1, :Q5, 20, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.aplicar_mora_cuotas_vencidas();
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.mora_monto || '/' || c.total_a_pagar FROM public.cuotas_condominio c WHERE c.id = :Q5),
  'vencida/5.00/105.00', '11 · saldo_vencido: 10 % del SALDO (100 − 20 cobrado − 30 de saldo a favor = 50) = 5');
SELECT public.chk_txt((SELECT r.monto_calculado::text FROM public.recargos_mora r WHERE r.cuota_id = :Q5), '5.00',
  '11 · …el mismo recargo en recargos_mora');
-- Q6: con monto_cuota la base sigue siendo el monto completo aunque haya abonos.
UPDATE public.reglas_mora_config SET aplicar_sobre = 'monto_cuota' WHERE nombre = 'SINT-AUX mora 10%';
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:PQ6, :UNO, :A1, :Q6, 20, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.aplicar_mora_cuotas_vencidas();
SELECT public.chk_txt(
  (SELECT c.cuota_estado || '/' || c.mora_monto FROM public.cuotas_condominio c WHERE c.id = :Q6),
  'vencida/10.00', '11 · monto_cuota: 10 % del monto completo (sin cambios)');
SELECT public.chk_txt((SELECT c.mora_monto::text FROM public.cuotas_condominio c WHERE c.id = :Q5), '5.00',
  '11 · el cron es idempotente: Q5 no se recarga dos veces');
