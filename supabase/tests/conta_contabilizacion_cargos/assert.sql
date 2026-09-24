-- ============================================================================
-- Contabilización de cargos · invariantes de una sesión
-- (la concurrencia real va en run.sh con sesiones simultáneas)
--
-- Documentos y configuración los crean usuarios de la aplicación (SET ROLE
-- authenticated + request.jwt.claim.sub). Las lecturas de verdad se hacen con
-- RESET ROLE. Sólo el cierre de períodos y el caso «documento anterior» se
-- preparan como superusuario, porque simulan estado previo a la migración.
-- ============================================================================

-- ── 0 · superficie: qué se puede llamar y qué no ────────────────────────────
SELECT public.chk(has_function_privilege('authenticated', 'public.conta_reprocesar_cargo(text, uuid)', 'EXECUTE')::int, 1,
  '0 · el reproceso es invocable por usuarios autenticados');
SELECT public.chk(has_function_privilege('anon', 'public.conta_reprocesar_cargo(text, uuid)', 'EXECUTE')::int, 0,
  '0 · anon no reprocesa');
SELECT public.chk(has_function_privilege('authenticated', 'public.conta_cargos_pendientes(uuid, text, text, integer, integer)', 'EXECUTE')::int, 1,
  '0 · la bandeja es invocable por usuarios autenticados');
SELECT public.chk(
  (SELECT count(*) FROM unnest(ARRAY[
     'public.conta_contabilizar_cargo_interno(text, uuid, text, text)',
     'public.conta_contabilizar_cargo_seguro(text, uuid, text, text)',
     'public.conta_registrar_intento_cargo(uuid, uuid, text, uuid, text, text, text, text, text, jsonb, uuid)',
     'public.conta_tipo_cargo_de_documento(text, uuid, text)']) f
    WHERE has_function_privilege('authenticated', f, 'EXECUTE')), 0,
  '0 · las funciones internas no son invocables por la aplicación');

SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;

-- ── 1 · camino HISTÓRICO intacto: cuota sin clasificar ──────────────────────
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado) VALUES
  ('c1000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX histórica', 70, '2026-10', 'pendiente');
RESET ROLE;
SELECT public.chk(public.n_vivos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000000', 'cuota_emitida'), 1,
  '1 · una cuota sin clasificar se contabiliza con el mapeo general, como antes');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c1000000-0000-0000-0000-000000000000' AND l.tipo_cargo IS NULL AND l.auxiliar_cliente_id IS NULL), 2,
  '1 · …sin dimensiones nuevas en sus líneas');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion WHERE origen_id = 'c1000000-0000-0000-0000-000000000000'), 0,
  '1 · …y sin intentos: no entra en la contabilización por tipo');

-- ── 2 · PENDIENTE VISIBLE por configuración faltante ────────────────────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX mantenimiento', 100, '2026-10', 'pendiente', 'mantenimiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001', NULL, 'SINT-AUX mantenimiento')
    WHERE origen_id = 'c1000000-0000-0000-0000-000000000001' AND codigo = 'sin_configuracion' AND puede_reprocesar), 1,
  '2 · la cuota sin configuración aparece en la bandeja con su motivo y se puede reprocesar');
RESET ROLE;
SELECT public.chk(public.n_asientos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001', 'cuota_emitida'), 0,
  '2 · sin configuración NO hay asiento, ni siquiera con el mapeo general disponible');
SELECT public.chk_txt(public.ultimo_intento('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001', 'cuota_emitida'),
  'pendiente/sin_configuracion', '2 · el intento de la emisión queda pendiente por configuración');

-- ── 3 · configurar y REPROCESAR ─────────────────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'mantenimiento',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001')),
  'cuota_emitida:contabilizada', '3 · con la configuración, el reproceso contabiliza');
RESET ROLE;
SELECT public.chk(public.n_vivos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001', 'cuota_emitida'), 1,
  '3 · exactamente un asiento vivo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_id = 'c1000000-0000-0000-0000-000000000001' AND a.total_debe = 100 AND a.total_haber = 100), 1,
  '3 · balanceado: 100 al debe y 100 al haber');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c1000000-0000-0000-0000-000000000001'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101' AND l.debe = 100
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'
      AND l.unidad_id = 'f0000000-0000-0000-0000-00000000a001' AND l.tipo_cargo = 'mantenimiento'), 1,
  '3 · la CxC del tipo se carga con auxiliar (responsable), unidad y tipo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c1000000-0000-0000-0000-000000000001'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a102' AND l.haber = 100 AND l.tipo_cargo = 'mantenimiento'), 1,
  '3 · el ingreso del tipo se abona con las mismas dimensiones');
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')
    WHERE origen_id = 'c1000000-0000-0000-0000-000000000001'), 0,
  '3 · contabilizada, sale de la bandeja');

-- ── 4 · IDEMPOTENCIA ────────────────────────────────────────────────────────
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001')),
  'cuota_emitida:ya_contabilizada', '4 · reprocesar de nuevo responde «ya contabilizada»');
UPDATE public.cuotas_condominio SET notas = 'SINT-AUX toque' WHERE id = 'c1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk(public.n_asientos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001', 'cuota_emitida'), 1,
  '4 · ni el segundo reproceso ni editar la cuota crean otro asiento');

-- ── 5 · emisión CON configuración: asiento inmediato ────────────────────────
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'cuota_extraordinaria',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c1000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX extraordinaria', 500, '2026-10', 'pendiente', 'cuota_extraordinaria');
RESET ROLE;
SELECT public.chk(public.n_vivos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000002', 'cuota_emitida'), 1,
  '5 · configurada, la cuota se contabiliza al emitirse');
SELECT public.chk_txt(public.ultimo_intento('cuotas_condominio', 'c1000000-0000-0000-0000-000000000002', 'cuota_emitida'),
  'contabilizada/-', '5 · y el intento de emisión lo registra');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c1000000-0000-0000-0000-000000000002'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a103' AND l.haber = 500), 1,
  '5 · el ingreso es el de SU tipo (extraordinario), no el de mantenimiento');

-- ── 6 · cargo adicional: pendiente, reproceso, anulación con reverso ────────
SET ROLE authenticated;
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX reparación', 'reparacion', 80, CURRENT_DATE, 'pendiente');
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000001', 'cargo_adicional_emitido'),
  'pendiente/sin_configuracion', '6 · cargo adicional sin configuración de su tipo: pendiente');
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_reparacion',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_otro',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000001')),
  'cargo_adicional_emitido:contabilizada', '6 · configurado su tipo, el reproceso lo contabiliza');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'ca100000-0000-0000-0000-000000000001' AND l.debe = 80
      AND l.tipo_cargo = 'adicional_reparacion' AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'
      AND l.unidad_id = 'f0000000-0000-0000-0000-00000000a002'), 1,
  '6 · tipo adicional_reparacion, auxiliar y unidad del cargo');
SET ROLE authenticated;
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a002', 'SINT-AUX rara', 'categoria_inventada', 15, CURRENT_DATE, 'pendiente');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'ca100000-0000-0000-0000-000000000002' AND l.tipo_cargo = 'adicional_otro'), 2,
  '6 · una categoría fuera del dominio se contabiliza como adicional_otro');

-- Anular reversa, y el reverso HEREDA las dimensiones: el auxiliar vuelve a 0.
SELECT public.chk(public.saldo_aux('11000000-0000-0000-0000-00000000a101', 'e0000000-0000-0000-0000-00000000a001'), 100 + 500 + 80 + 15,
  '6 · antes de anular, Uno debe 695 en la CxC compartida');
SET ROLE authenticated;
UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ca100000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk(public.n_vivos('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000001', 'cargo_adicional_emitido'), 0,
  '6 · anular el cargo reversa su asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'ca100000-0000-0000-0000-000000000001' AND a.origen_evento = 'cargo_adicional_emitido_revertido'
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001' AND l.tipo_cargo = 'adicional_reparacion'), 2,
  '6 · las líneas del reverso heredan auxiliar, unidad y tipo');
SELECT public.chk(public.saldo_aux('11000000-0000-0000-0000-00000000a101', 'e0000000-0000-0000-0000-00000000a001'), 100 + 500 + 15,
  '6 · y el saldo del auxiliar baja exactamente lo anulado');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado || '/' || COALESCE(codigo, '-'), ',') FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000001')),
  'cargo_adicional_emitido:bloqueada/documento_anulado', '6 · un cargo anulado no se reprocesa');

-- ── 7 · SIN RESPONSABLE: pendiente hasta asignarlo ──────────────────────────
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a004', 'SINT-AUX sin pagador', 'otro', 40, CURRENT_DATE, 'pendiente');
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000003', 'cargo_adicional_emitido'),
  'pendiente/sin_responsable', '7 · sin candidato único: pendiente «sin_responsable», no un asiento sin auxiliar');
SET ROLE authenticated;
UPDATE public.cargos_adicionales_unidad SET responsable_cliente_id = 'e0000000-0000-0000-0000-00000000a003'
 WHERE id = 'ca100000-0000-0000-0000-000000000003';
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000003')),
  'cargo_adicional_emitido:contabilizada', '7 · asignado el responsable, el reproceso contabiliza');
RESET ROLE;
SELECT public.chk(public.saldo_aux('11000000-0000-0000-0000-00000000a101', 'e0000000-0000-0000-0000-00000000a003'), 40,
  '7 · a nombre de Tres, el responsable asignado');

-- ── 8 · PERÍODOS CERRADOS ───────────────────────────────────────────────────
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2026-01', 'cerrado');
SET ROLE authenticated;
-- Emisión con fecha en período cerrado: como las facturas, se fecha hoy.
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX enero', 'reparacion', 25, DATE '2026-01-15', 'pendiente');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a WHERE a.origen_id = 'ca100000-0000-0000-0000-000000000004'
      AND a.estado = 'publicado' AND a.fecha = CURRENT_DATE), 1,
  '8 · emitido con fecha en período cerrado: el asiento se fecha en el período abierto');
-- Reproceso de un pendiente cuyo período se cerró: bloquea, no re-fecha.
SET ROLE authenticated;
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX multa febrero', 'multa', 30, DATE '2026-02-10', 'pendiente');
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', '2026-02', 'cerrado');
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'adicional_multa',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado || '/' || COALESCE(codigo, '-'), ',') FROM public.conta_reprocesar_cargo('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000005')),
  'cargo_adicional_emitido:bloqueada/periodo_cerrado', '8 · el reproceso en período cerrado bloquea');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001', 'periodo_cerrado')
    WHERE origen_id = 'ca100000-0000-0000-0000-000000000005'), 1,
  '8 · y la bandeja lo muestra con ese motivo');
RESET ROLE;
SELECT public.chk(public.n_asientos('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000005', 'cargo_adicional_emitido'), 0,
  '8 · sin asiento: ni re-fechado ni en el período cerrado');

-- ── 9 · MORA de una cuota clasificada ───────────────────────────────────────
SET ROLE authenticated;
UPDATE public.cuotas_condominio SET mora_monto = 5 WHERE id = 'c1000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001', 'cuota_mora'),
  'pendiente/sin_configuracion', '9 · mora sin configuración de recargo_mora: pendiente');
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'recargo_mora',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a110');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',' ORDER BY evento) FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000001')),
  'cuota_emitida:ya_contabilizada,cuota_mora:contabilizada', '9 · el reproceso contabiliza la mora y no duplica la emisión');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c1000000-0000-0000-0000-000000000001' AND a.origen_evento = 'cuota_mora'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a110' AND l.haber = 5 AND l.tipo_cargo = 'recargo_mora'), 1,
  '9 · la mora va al ingreso de su tipo (recargo_mora)');

-- ── 10 · COBROS: la misma CxC y el mismo auxiliar ───────────────────────────
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9a900000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c1000000-0000-0000-0000-000000000002', 500, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_tabla = 'pagos' AND a.origen_id = '9a900000-0000-0000-0000-000000000001'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101' AND l.haber = 500
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'
      AND l.unidad_id = 'f0000000-0000-0000-0000-00000000a002' AND l.tipo_cargo = 'cuota_extraordinaria'), 1,
  '10 · el cobro acredita la CxC del devengo con su auxiliar, unidad y tipo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
     JOIN public.conta_cuentas c ON c.id = l.cuenta_id
    WHERE a.origen_tabla = 'pagos' AND a.origen_id = '9a900000-0000-0000-0000-000000000001' AND c.tipo = 'ingreso'), 0,
  '10 · el cobro no reconoce ingreso otra vez');
SELECT public.chk(
  (SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.estado = 'publicado' AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001' AND l.tipo_cargo = 'cuota_extraordinaria'), 0,
  '10 · la cuota extraordinaria de Uno queda saldada en su auxiliar');
-- Cobro de la cuota HISTÓRICA: exactamente como antes (mapeo general).
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, monto, metodo, estado, verified_at) VALUES
  ('9a900000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   70, 'efectivo', 'pendiente', now());
UPDATE public.cuotas_condominio SET pago_id = '9a900000-0000-0000-0000-000000000002' WHERE id = 'c1000000-0000-0000-0000-000000000000';
UPDATE public.pagos SET estado = 'verificado' WHERE id = '9a900000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_tabla = 'pagos' AND a.origen_id = '9a900000-0000-0000-0000-000000000002'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101' AND l.haber = 70
      AND l.auxiliar_cliente_id IS NULL AND l.tipo_cargo IS NULL), 1,
  '10 · el cobro de una cuota histórica sigue por el mapeo general, sin dimensiones');

-- ── 11 · NADA RETROACTIVO ───────────────────────────────────────────────────
-- Una cuota clasificada «anterior a la migración»: se inserta con los
-- triggers apagados, como si hubiera existido antes. No tiene intentos.
SET session_replication_role = replica;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c1000000-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX anterior', 60, '2026-09', 'pendiente', 'mantenimiento');
SET session_replication_role = origin;
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(resultado || '/' || codigo, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000009')),
  'bloqueada/documento_anterior', '11 · un documento sin intento previo NO se contabiliza retroactivamente');
SELECT public.chk_txt(
  (SELECT string_agg(resultado || '/' || codigo, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000000')),
  'bloqueada/documento_anterior', '11 · ni una cuota sin clasificar');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')
    WHERE origen_id = 'c1000000-0000-0000-0000-000000000009'), 0,
  '11 · y no aparece en la bandeja');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion WHERE origen_id = 'c1000000-0000-0000-0000-000000000009'), 0,
  '11 · el intento rechazado no deja rastro que lo vuelva elegible');
SELECT public.chk(public.n_asientos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000009', 'cuota_emitida'), 0,
  '11 · y no tiene asiento');

-- ── 12 · PERMISOS y AISLAMIENTO ─────────────────────────────────────────────
-- Un pendiente vivo para las pruebas de acceso: extraordinaria en U4 sin
-- responsable.
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c1000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a004', 'SINT-AUX acceso', 45, '2026-10', 'pendiente', 'cuota_extraordinaria');
RESET ROLE;

-- Visor contable (sólo view): ve la bandeja, no puede reprocesar.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000e', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')
    WHERE origen_id = 'c1000000-0000-0000-0000-000000000003' AND NOT puede_reprocesar), 1,
  '12 · el visor contable ve el pendiente, marcado como no reprocesable para él');
SELECT public.chk_falla(
  $q$SELECT * FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000003')$q$,
  'No autorizado para contabilizar', '12 · …y el servidor le rechaza el reproceso');
RESET ROLE;

-- Contador con create/edit/delete pero SIN change_status: tampoco publica.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000c', false);
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT * FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000003')$q$,
  'No autorizado para contabilizar', '12 · sin change_status no se reprocesa (genera y publica)');
RESET ROLE;

-- Operador sin permiso contable: ni siquiera ve la bandeja.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000d', false);
SET ROLE authenticated;
SELECT public.chk_falla(
  $q$SELECT * FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')$q$,
  'No autorizado', '12 · el operador sin permiso contable no ve la bandeja');
RESET ROLE;

-- Admin de B: sus propios pendientes, nunca los de A.
SELECT set_config('request.jwt.claim.sub', 'b0b0b0b0-0000-0000-0000-00000000000b', false);
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c1000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000b001', 'SINT-AUX cuota B', 90, '2026-10', 'pendiente', 'mantenimiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('b1b1b1b1-0000-0000-0000-000000000001')
    WHERE origen_id = 'c1000000-0000-0000-0000-0000000000b1' AND codigo = 'sin_configuracion'), 1,
  '12 · B ve su propio pendiente');
SELECT public.chk_falla(
  $q$SELECT * FROM public.conta_cargos_pendientes('a1a1a1a1-0000-0000-0000-000000000001')$q$,
  'no pertenece a la empresa activa', '12 · B no consulta la bandeja de un ledger de A');
SELECT public.chk_txt(
  (SELECT string_agg(resultado || '/' || codigo, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000003')),
  'bloqueada/documento_inexistente', '12 · B no reprocesa un documento de A: le responde como a un inexistente');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion WHERE origen_id = 'c1000000-0000-0000-0000-000000000003'), 0,
  '12 · B no lee los intentos de A (RLS)');
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b1b1b1b1-0000-0000-0000-000000000001', 'mantenimiento',
   '11000000-0000-0000-0000-00000000b101', '11000000-0000-0000-0000-00000000b102');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-0000000000b1')),
  'cuota_emitida:contabilizada', '12 · B contabiliza lo suyo con SU configuración');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.origen_id = 'c1000000-0000-0000-0000-0000000000b1'
      AND l.company_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND l.cuenta_id IN ('11000000-0000-0000-0000-00000000b101', '11000000-0000-0000-0000-00000000b102')), 2,
  '12 · el asiento de B usa sólo cuentas del ledger de B');

-- Otro ledger de la MISMA empresa: la bandeja de A2 no muestra lo de A1.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargos_pendientes('a2a2a2a2-0000-0000-0000-000000000001')
    WHERE origen_id = 'c1000000-0000-0000-0000-000000000003'), 0,
  '12 · la bandeja del proyecto A2 no muestra pendientes del A1');
-- La configuración de A2 no sirve para un documento de A1.
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'adicional_servicio',
   '11000000-0000-0000-0000-00000000a201', '11000000-0000-0000-0000-00000000a202');
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX servicio', 'servicio', 12, CURRENT_DATE, 'pendiente');
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cargos_adicionales_unidad', 'ca100000-0000-0000-0000-000000000006', 'cargo_adicional_emitido'),
  'pendiente/sin_configuracion', '12 · la configuración de otro proyecto no se usa: pendiente en A1');

-- ── 13 · CUENTA QUE DEJÓ DE SERVIR ──────────────────────────────────────────
UPDATE public.conta_cuentas SET activa = false WHERE id = '11000000-0000-0000-0000-00000000a103';
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c1000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX cuenta inactiva', 20, '2026-10', 'pendiente', 'cuota_extraordinaria');
RESET ROLE;
SELECT public.chk_txt(public.ultimo_intento('cuotas_condominio', 'c1000000-0000-0000-0000-000000000004', 'cuota_emitida'),
  'pendiente/cuenta_invalida', '13 · cuenta de ingreso desactivada: pendiente «cuenta_invalida», nada parcial');
SELECT public.chk(public.n_asientos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000004', 'cuota_emitida'), 0,
  '13 · sin asiento');
UPDATE public.conta_cuentas SET activa = true WHERE id = '11000000-0000-0000-0000-00000000a103';
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c1000000-0000-0000-0000-000000000004')),
  'cuota_emitida:contabilizada', '13 · reactivada la cuenta, el reproceso contabiliza');
RESET ROLE;

-- ── 14 · borrar una cuota reversa, con dimensiones ──────────────────────────
SET ROLE authenticated;
UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c1000000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk(public.n_vivos('cuotas_condominio', 'c1000000-0000-0000-0000-000000000004', 'cuota_emitida'), 0,
  '14 · el borrado suave de una cuota clasificada reversa su asiento');
SELECT public.chk(
  (SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.estado = 'publicado' AND a.origen_id = 'c1000000-0000-0000-0000-000000000004'
      AND l.auxiliar_cliente_id = 'e0000000-0000-0000-0000-00000000a001'
      AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'), 0,
  '14 · y el auxiliar queda en cero para esa cuota');

-- ── 15 · auditoría del reproceso ────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id = 'c1000000-0000-0000-0000-000000000001' AND disparo = 'reproceso'
      AND actor = 'a0a0a0a0-0000-0000-0000-00000000000a'), 4,
  '15 · cada reproceso deja actor, disparo y resultado en la bitácora (uno por evento)');

-- ── Estado de partida de la concurrencia (run.sh, paso 6) ───────────────────
-- Dos cargos pendientes por configuración: run.sh configura sus tipos y los
-- reprocesa desde sesiones simultáneas.
SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);
SET ROLE authenticated;
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ca100000-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX daño concurrente', 'dano', 33, CURRENT_DATE, 'pendiente'),
  ('ca100000-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX exceso vs anulación', 'exceso_consumo', 44, CURRENT_DATE, 'pendiente');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id IN ('ca100000-0000-0000-0000-000000000007', 'ca100000-0000-0000-0000-000000000008')
      AND resultado = 'pendiente' AND codigo = 'sin_configuracion'), 2,
  '16 · dos cargos quedan pendientes para las pruebas de concurrencia');
