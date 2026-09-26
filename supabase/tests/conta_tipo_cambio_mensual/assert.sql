-- ============================================================================
-- TIPO DE CAMBIO MENSUAL · invariantes (20261008000000)
-- ============================================================================
\set ON_ERROR_STOP 1
\set CO   '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set CONT '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set OPER '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set VIS  '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set ADB  '''b0b0b0b0-0000-0000-0000-00000000000b'''

-- ── 0 · permisos de la configuración ────────────────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', '2026-08', 7.7)$$,
  'row-level security', '0 · el visor contable no configura tasas');
SELECT set_config('request.jwt.claim.sub', :OPER, false);
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', '2026-08', 7.7)$$,
  'row-level security', '0 · un operador sin permiso contable tampoco');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa, moneda_base)
  VALUES (:CO, 'usd', '2026-08', 7.7, 'EUR');
SELECT public.chk_txt(
  (SELECT moneda || '→' || moneda_base || ' ' || periodo || ' ' || tasa || ' ' || (created_by = :CONT)
     FROM public.conta_tipos_cambio_mensual WHERE company_id = :CO AND periodo = '2026-08'),
  'USD→GTQ 2026-08 7.700000 true',
  '0 · el contador (crear) la registra; moneda y BASE las fija el servidor (1 USD = 7.7 GTQ), con su autor');
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'GTQ', '2026-08', 1)$$,
  'conta_tc_mensual_monedas_distintas', '0 · la moneda base no lleva tasa');
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', '2026-13', 7)$$,
  'conta_tc_mensual_periodo_valido', '0 · el mes tiene que existir');
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', '2026-09', 0)$$,
  'conta_tc_mensual_tasa_positiva', '0 · la tasa es positiva');
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', '2026-08', 7.9)$$,
  'conta_tc_mensual_unica', '0 · una sola tasa por moneda y mes');
SELECT public.chk_falla($$UPDATE public.conta_tipos_cambio_mensual SET periodo = '2026-10' WHERE periodo = '2026-08'$$,
  'TC_MENSUAL_INMUTABLE', '0 · el mes de una tasa no se cambia');
SELECT public.chk_falla($$INSERT INTO public.conta_tipos_cambio_mensual_historial (company_id, tipo_cambio_id, accion, moneda, moneda_base, periodo)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', gen_random_uuid(), 'alta', 'USD', 'GTQ', '2026-08')$$,
  'permission denied', '0 · la bitácora no se escribe desde la aplicación');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa) VALUES
  (:CO, 'USD', '2026-09', 7.8), (:CO, 'USD', '2026-06', 7.6), (:CO, 'EUR', '2026-09', 8.5);
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk((SELECT count(*) FROM public.conta_tipos_cambio_mensual), 0,
  '0 · otra empresa no ve estas tasas');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
RESET ROLE;

-- ── 1 · cambio de mes: cada documento usa la tasa de SU mes ────────────────
\set A_AGO '(SELECT public.tc_asiento(''2026-08-31'', ''USD'', 100))'
SELECT public.tc_asiento('2026-08-31', 'USD', 100) AS a_ago \gset
SELECT public.tc_asiento('2026-09-01', 'USD', 100) AS a_sep \gset
SELECT public.chk_txt(public.tc_resumen(:'a_ago'), 'publicado|770.00|2026-08|7.700000|false',
  '1 · 31 de agosto: tasa de agosto (7.70), guardada en el asiento con su mes');
SELECT public.chk_txt(public.tc_resumen(:'a_sep'), 'publicado|780.00|2026-09|7.800000|false',
  '1 · 1 de septiembre: tasa de septiembre (7.80)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas WHERE asiento_id = :'a_sep'
      AND moneda_origen = 'USD' AND monto_origen = 100 AND tipo_cambio = 7.8), 2,
  '1 · cada línea guarda su importe de origen y la tasa');

-- ── 2 · moneda base: sin conversión ─────────────────────────────────────────
SELECT public.tc_asiento('2026-09-10', 'GTQ', 100) AS a_base \gset
SELECT public.chk_txt(public.tc_resumen(:'a_base'), 'publicado|100.00|-|-|false', '2 · documento en la moneda base: sin tasa');

-- ── 3 · retroactivo SIN tasa de su mes: no se usa la del mes anterior ───────
-- Julio no tiene tasa mensual (junio sí; y hay una DIARIA de julio heredada).
SELECT public.tc_asiento('2026-07-15', 'USD', 100) AS a_jul \gset
SELECT public.chk_txt(public.tc_resumen(:'a_jul'), 'borrador|100.00|2026-07|-|true',
  '3 · julio sin tasa mensual: borrador PENDIENTE, ni la de junio ni la diaria heredada');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos WHERE id = :'a_jul' AND numero IS NULL
      AND concepto LIKE '%[SIN TIPO DE CAMBIO USD→GTQ 2026-07]%'), 1,
  '3 · sin folio, y el concepto dice qué falta');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'a_jul'),
  'SIN_TIPO_CAMBIO: falta el tipo de cambio mensual USD→GTQ de 2026-07\. Configúralo',
  '3 · publicarlo se rechaza con la instrucción de qué tasa y qué mes');
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa) VALUES (:CO, 'USD', '2026-07', 7.65);
SELECT public.chk(
  (SELECT count(*) FROM public.conta_publicar_asiento(:'a_jul') p WHERE p.estado = 'publicado'), 1,
  '3 · configurada la tasa de julio, se publica');
RESET ROLE;
SELECT public.chk_txt(public.tc_resumen(:'a_jul'), 'publicado|765.00|2026-07|7.650000|false',
  '3 · convertido con la tasa de SU mes (julio), no la del mes en que se publica');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos WHERE id = :'a_jul' AND concepto NOT LIKE '%SIN TIPO DE CAMBIO%'
      AND total_debe = total_haber AND numero IS NOT NULL), 1,
  '3 · cuadrado, con folio y sin la marca');

-- ── 4 · cambiar la configuración no recalcula lo publicado ──────────────────
SET ROLE authenticated;
UPDATE public.conta_tipos_cambio_mensual SET tasa = 9 WHERE company_id = :CO AND moneda = 'USD' AND periodo = '2026-08';
RESET ROLE;
SELECT public.chk_txt(public.tc_resumen(:'a_ago'), 'publicado|770.00|2026-08|7.700000|false',
  '4 · el asiento de agosto conserva 770 y su tasa 7.70');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas WHERE asiento_id = :'a_ago' AND tipo_cambio = 7.7 AND (debe = 770 OR haber = 770)), 2,
  '4 · …y sus líneas');
SELECT public.chk_txt(
  (SELECT string_agg(h.accion || ':' || COALESCE(h.tasa_anterior::text, '-') || '→' || COALESCE(h.tasa_nueva::text, '-')
                     || ':' || (h.actor IS NOT NULL), ',' ORDER BY h.ocurrido_at)
     FROM public.conta_tipos_cambio_mensual_historial h WHERE h.periodo = '2026-08' AND h.moneda = 'USD'),
  'alta:-→7.700000:true,cambio:7.700000→9.000000:true', '4 · auditoría: alta y cambio, con valores y actor');
SELECT public.tc_asiento('2026-08-20', 'USD', 100) AS a_ago2 \gset
SELECT public.chk_txt(public.tc_resumen(:'a_ago2'), 'publicado|900.00|2026-08|9.000000|false',
  '4 · un documento NUEVO de agosto usa la tasa vigente de agosto');

-- ── 5 · precisión y redondeo uniforme ───────────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa) VALUES (:CO, 'USD', '2026-05', 7.123457);
RESET ROLE;
SELECT public.conta_generar_asiento(:CO, 'a1a1a1a1-0000-0000-0000-000000000001', 'pruebas_tc', gen_random_uuid(), 'redondeo',
  '2026-05-10', 'SINT-AUX redondeo', 'diario', 'USD',
  jsonb_build_array(
    jsonb_build_object('cuenta_id', '11000000-0000-0000-0000-00000000a101', 'debe', 1.00),
    jsonb_build_object('cuenta_id', '11000000-0000-0000-0000-00000000a102', 'haber', 0.33),
    jsonb_build_object('cuenta_id', '11000000-0000-0000-0000-00000000a102', 'haber', 0.33),
    jsonb_build_object('cuenta_id', '11000000-0000-0000-0000-00000000a102', 'haber', 0.34))) AS a_red \gset
SELECT public.chk_txt(
  (SELECT string_agg(CASE WHEN debe > 0 THEN 'D' || debe ELSE 'H' || haber END, ',' ORDER BY orden)
     FROM public.conta_asiento_lineas WHERE asiento_id = :'a_red'),
  'D7.12,H2.35,H2.35,H2.42', '5 · cada línea a 2 decimales y el residuo en la última del lado corto');
SELECT public.chk_txt(public.tc_resumen(:'a_red'), 'publicado|7.12|2026-05|7.123457|false', '5 · cuadrado, tasa con 6 decimales');

-- ── 6 · EUR con su tasa del mes; sin ella, el mensaje nombra la que falta ───
SELECT public.tc_asiento('2026-09-15', 'EUR', 10) AS a_eur \gset
SELECT public.chk_txt(public.tc_resumen(:'a_eur'), 'publicado|85.00|2026-09|8.500000|false', '6 · EUR de septiembre: 8.50');
SELECT public.tc_asiento('2026-04-15', 'EUR', 10) AS a_eur_abr \gset
SELECT public.chk_txt(public.conta_tc_faltantes(:CO, 'EUR', 'GTQ', '2026-04'), 'EUR→GTQ de 2026-04',
  '6 · lo que falta se nombra: moneda, base y mes');

-- ── 7 · la misma fuente para todos: conta_tasa_entre (revaluación, consolidado,
--       saldos a favor, generador) ───────────────────────────────────────────
SELECT public.chk_txt(public.conta_tasa_entre(:CO, 'USD', 'GTQ', '2026-07-31')::text, '7.650000',
  '7 · la tasa de un día es la de su mes');
SELECT public.chk_txt(COALESCE(public.conta_tasa_entre(:CO, 'USD', 'GTQ', '2026-10-05')::text, 'NULL'), 'NULL',
  '7 · un mes sin tasa no toma la del mes anterior');
SELECT public.chk_txt(public.conta_tasa_entre(:CO, 'EUR', 'USD', '2026-09-30')::text, round(8.5 / 7.8, 6)::text,
  '7 · entre dos extranjeras: cruzada por la base con las tasas del MISMO mes');

-- ── 8 · borradores con importes SIN CONVERTIR (20261009000000) ─────────────
-- Un borrador como los que dejaba el generador ANTERIOR: tasa 1, importes en
-- USD tal cual, marca sin mes y SIN tipo_cambio_pendiente.
CREATE OR REPLACE FUNCTION public.tc_borrador(p_origen text, p_concepto text, p_moneda text, p_tasa numeric, p_fecha date)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid;
BEGIN
  PERFORM set_config('conta.allow_system_write', 'on', true);
  INSERT INTO public.conta_asientos (company_id, project_id, fecha, tipo, concepto, estado, origen,
      origen_tabla, origen_id, origen_evento, moneda_base, total_debe, total_haber)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', p_fecha, 'diario',
      p_concepto, 'borrador', p_origen,
      CASE WHEN p_origen = 'automatico' THEN 'pruebas_tc' END,
      CASE WHEN p_origen = 'automatico' THEN gen_random_uuid() END,
      CASE WHEN p_origen = 'automatico' THEN 'documento' END,
      'GTQ', 100, 100)
  RETURNING id INTO v;
  INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber, moneda_origen, monto_origen, tipo_cambio)
  VALUES (v, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11000000-0000-0000-0000-00000000a101', 1, round(100 * COALESCE(p_tasa, 1), 2), 0, p_moneda, 100, p_tasa),
         (v, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11000000-0000-0000-0000-00000000a102', 2, 0, round(100 * COALESCE(p_tasa, 1), 2), p_moneda, 100, p_tasa);
  UPDATE public.conta_asientos SET total_debe = round(100 * COALESCE(p_tasa, 1), 2), total_haber = round(100 * COALESCE(p_tasa, 1), 2) WHERE id = v;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v;
END;
$$;
SELECT public.tc_borrador('automatico', 'SINT-AUX documento viejo [SIN TIPO DE CAMBIO USD→GTQ]', 'USD', 1, '2026-10-05') AS b_viejo \gset
SELECT public.tc_borrador('manual', 'SINT-AUX manual tasa 1', 'USD', 1, '2026-09-05') AS b_man_uno \gset
SELECT public.tc_borrador('manual', 'SINT-AUX manual tasa escrita', 'USD', 7.8, '2026-09-05') AS b_man_ok \gset
SELECT public.tc_borrador('manual', 'SINT-AUX paridad 1:1', 'PAB', 1, '2026-09-05') AS b_pab \gset
SELECT public.chk_txt(
  public.conta_asiento_lineas_sin_convertir(:'b_viejo') || ','
  || public.conta_asiento_lineas_sin_convertir(:'b_man_uno') || ',' || public.conta_asiento_lineas_sin_convertir(:'b_man_ok'),
  '2,2,0', '8 · detección: el viejo (tasa 1 con la marca) y el manual con tasa 1 sin paridad; no la tasa escrita');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa) VALUES (:CO, 'PAB', '2026-09', 1);
RESET ROLE;
SELECT public.chk(public.conta_asiento_lineas_sin_convertir(:'b_pab'), 0,
  '8 · una paridad 1:1 configurada para ese mes (PAB) no se toma por falta de conversión');
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(b.concepto || ':' || b.lineas || ':' || b.marca_antigua, ' | ' ORDER BY b.concepto)
     FROM public.conta_borradores_sin_conversion() b WHERE b.concepto LIKE 'SINT-AUX%' AND NOT b.pendiente_nuevo),
  'SINT-AUX documento viejo [SIN TIPO DE CAMBIO USD→GTQ]:2:true | SINT-AUX manual tasa 1:2:false',
  '8 · la lista para revisar: los dos, con la marca antigua señalada');
-- Validación al publicar: ninguno de los dos sale; los correctos sí.
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'b_viejo'), 'CONVERSION_PENDIENTE',
  '8 · el borrador viejo (importes USD tal cual) NO se publica');
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'b_man_uno'), 'CONVERSION_PENDIENTE',
  '8 · ni el manual con tasa 1 sin paridad');
SELECT public.chk((SELECT count(*) FROM public.conta_publicar_asiento(:'b_man_ok') p WHERE p.estado = 'publicado'), 1,
  '8 · el manual con su tasa escrita se publica');
SELECT public.chk((SELECT count(*) FROM public.conta_publicar_asiento(:'b_pab') p WHERE p.estado = 'publicado'), 1,
  '8 · y el de paridad 1:1 también');
RESET ROLE;
SELECT public.chk_txt(public.tc_resumen(:'b_viejo'), 'borrador|100.00|-|-|false', '8 · el viejo sigue borrador e intacto');

-- Resolución explícita: una persona elige el MES y deja el motivo.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla(format($$SELECT * FROM public.conta_borrador_tc_asignar_periodo(%L, '2026-10', 'SINT fecha del documento')$$, :'b_viejo'),
  'No autorizado', '8 · el visor no resuelve borradores');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla(format($$SELECT * FROM public.conta_borrador_tc_asignar_periodo(%L, '2026-13', 'SINT')$$, :'b_viejo'),
  'YYYY-MM', '8 · el mes tiene que existir');
SELECT public.chk_falla(format($$SELECT * FROM public.conta_borrador_tc_asignar_periodo(%L, '2026-10', '')$$, :'b_viejo'),
  'Indica por qué', '8 · exige motivo');
SELECT public.chk_falla(format($$SELECT * FROM public.conta_borrador_tc_asignar_periodo(%L, '2026-09', 'SINT manual')$$, :'b_man_uno'),
  'BORRADOR_TC_NO_ANTIGUO', '8 · un manual no se resuelve así: se escribe su tasa');
SELECT public.chk_txt(
  (SELECT r.moneda || '/' || r.periodo || '/' || r.tasa_configurada
     FROM public.conta_borrador_tc_asignar_periodo(:'b_viejo', '2026-10', 'SINT-AUX factura del 5 de octubre') r),
  'USD/2026-10/false', '8 · asignado octubre (todavía sin tasa)');
SELECT public.chk_falla(format($$SELECT * FROM public.conta_borrador_tc_asignar_periodo(%L, '2026-09', 'SINT otra vez')$$, :'b_viejo'),
  'BORRADOR_TC_YA_ASIGNADO', '8 · no se reasigna');
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'b_viejo'),
  'SIN_TIPO_CAMBIO: falta el tipo de cambio mensual USD→GTQ de 2026-10', '8 · sin la tasa de octubre sigue sin publicarse');
INSERT INTO public.conta_tipos_cambio_mensual (company_id, moneda, periodo, tasa) VALUES (:CO, 'USD', '2026-10', 7.9);
SELECT public.chk((SELECT count(*) FROM public.conta_publicar_asiento(:'b_viejo') p WHERE p.estado = 'publicado'), 1,
  '8 · con la tasa de octubre, se publica');
RESET ROLE;
SELECT public.chk_txt(public.tc_resumen(:'b_viejo'), 'publicado|790.00|2026-10|7.900000|false',
  '8 · convertido con la tasa del mes elegido: 100 USD = 790 GTQ');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_borradores_tc_resoluciones r
    WHERE r.asiento_id = :'b_viejo' AND r.periodo = '2026-10' AND r.actor = :ADM
      AND r.motivo = 'SINT-AUX factura del 5 de octubre' AND r.fecha_asiento = '2026-10-05'), 1,
  '8 · evidencia: mes, motivo, actor, hora del servidor y la fecha que tenía el asiento');
SET ROLE authenticated;
SELECT public.chk_falla(format($$SELECT * FROM public.conta_borrador_tc_asignar_periodo(%L, '2026-10', 'SINT')$$, :'b_viejo'),
  'BORRADOR_TC_NO_BORRADOR', '8 · un asiento publicado no se toca');
RESET ROLE;
SELECT public.chk_falla($$UPDATE public.conta_borradores_tc_resoluciones SET motivo = 'x'$$,
  'BITACORA_INMUTABLE: conta_borradores_tc_resoluciones', '8 · la evidencia no se reescribe');
-- Lo publicado antes no cambia: los asientos de las secciones 1 a 5 conservan sus importes.
SELECT public.chk_txt(public.tc_resumen(:'a_ago'), 'publicado|770.00|2026-08|7.700000|false', '8 · lo publicado sigue igual');

-- ── 9 · B1: tasa manual distinta de la mensual exige motivo (20261010000000) ─
-- Septiembre USD = 7.80. Manual a 7.90 sin motivo: no se publica.
SELECT public.tc_borrador('manual', 'SINT-AUX manual 7.90', 'USD', 7.9, '2026-09-20') AS b_790 \gset
SELECT public.tc_borrador('manual', 'SINT-AUX manual sin mensual', 'USD', 7.95, '2026-11-05') AS b_nov \gset
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'b_790'),
  'TASA_MANUAL_SIN_MOTIVO: la línea en USD usa la tasa 7.900000 y la mensual de 2026-09 es 7.800000',
  '9 · tasa manual ≠ mensual sin motivo: no se publica, y dice cuál es la mensual');
UPDATE public.conta_asientos SET tipo_cambio_motivo = 'ok' WHERE id = :'b_790';
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'b_790'),
  'TASA_MANUAL_SIN_MOTIVO', '9 · un motivo de menos de 5 caracteres no cuenta');
UPDATE public.conta_asientos SET tipo_cambio_motivo = 'SINT-AUX tasa pactada con el banco' WHERE id = :'b_790';
SELECT public.chk((SELECT count(*) FROM public.conta_publicar_asiento(:'b_790') p WHERE p.estado = 'publicado'), 1,
  '9 · con motivo, se publica');
SELECT public.chk_falla(format('SELECT public.conta_publicar_asiento(%L)', :'b_nov'),
  'la mensual de 2026-11 es inexistente', '9 · sin tasa mensual del mes también exige motivo');
UPDATE public.conta_asientos SET tipo_cambio_motivo = 'SINT-AUX operación fuera de calendario' WHERE id = :'b_nov';
SELECT public.chk((SELECT count(*) FROM public.conta_publicar_asiento(:'b_nov') p WHERE p.estado = 'publicado'), 1,
  '9 · …y con motivo, se publica');
RESET ROLE;
SELECT public.chk_txt(
  (SELECT string_agg(t.periodo || ':' || t.tasa_usada || ':' || COALESCE(t.tasa_mensual::text, '-') || ':' || (t.actor = :ADM), ',' ORDER BY t.periodo)
     FROM public.conta_tasas_manuales t WHERE t.asiento_id IN (:'b_790', :'b_nov')),
  '2026-09:7.900000:7.800000:true,2026-09:7.900000:7.800000:true,2026-11:7.950000:-:true,2026-11:7.950000:-:true',
  '9 · bitácora por línea: mes, tasa usada, mensual (o ninguna) y actor');
SELECT public.chk((SELECT count(*) FROM public.conta_tasas_manuales t WHERE t.asiento_id = :'b_man_ok'), 0,
  '9 · la línea con la tasa mensual (§8) no deja registro de tasa manual');
SELECT public.chk_falla($$UPDATE public.conta_tasas_manuales SET motivo = 'x'$$,
  'BITACORA_INMUTABLE: conta_tasas_manuales', '9 · la bitácora de tasas manuales no se reescribe');

-- ── 10 · A1: diferencial cambiario REALIZADO al pagar a un proveedor ────────
-- Factura de 100 USD de agosto (tasa 9.00 tras §4) pagada en septiembre (7.80).
INSERT INTO public.conta_cuentas (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('11000000-0000-0000-0000-0000000d1001', :CO, 'a1a1a1a1-0000-0000-0000-000000000001', '2199', 'SINT-AUX CxP proveedores', 'pasivo', 'acreedora', 3, true, true),
  ('11000000-0000-0000-0000-0000000d1002', :CO, 'a1a1a1a1-0000-0000-0000-000000000001', '5199', 'SINT-AUX Gasto', 'gasto', 'deudora', 3, true, true),
  ('11000000-0000-0000-0000-0000000d1003', :CO, 'a1a1a1a1-0000-0000-0000-000000000001', '1199', 'SINT-AUX Banco', 'activo', 'deudora', 3, true, true),
  ('11000000-0000-0000-0000-0000000d1004', :CO, 'a1a1a1a1-0000-0000-0000-000000000001', '7199', 'SINT-AUX Diferencial cambiario', 'gasto', 'deudora', 3, true, true);
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id) VALUES
  (:CO, 'a1a1a1a1-0000-0000-0000-000000000001', 'cxp_proveedores', '11000000-0000-0000-0000-0000000d1001'),
  (:CO, 'a1a1a1a1-0000-0000-0000-000000000001', 'metodo_transferencia', '11000000-0000-0000-0000-0000000d1003')
ON CONFLICT DO NOTHING;
INSERT INTO public.proveedores (id, company_id, nombre, estado)
  VALUES ('d0000000-0000-0000-0000-0000000d1001', :CO, 'SINT-AUX Proveedor USD', 'autorizado');

CREATE OR REPLACE FUNCTION public.tc_factura(p_id uuid, p_fecha date, p_monto numeric) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, concepto, categoria,
      monto_total, iva_monto, moneda, estado, fecha_emision, numero_factura)
  VALUES (p_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
      'd0000000-0000-0000-0000-0000000d1001', 'SINT-AUX compra USD', 'otros', p_monto, 0, 'USD', 'registrada',
      p_fecha, 'F-' || right(p_id::text, 8));
  INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, linea, descripcion, cuenta_id, cantidad,
      precio_unitario, iva_monto, total)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_id, 1, 'Servicio', '11000000-0000-0000-0000-0000000d1002',
      1, p_monto, 0, p_monto);
  UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = p_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.tc_pagar(p_orden uuid, p_factura uuid, p_monto numeric, p_fecha date) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, fecha_pago, metodo_pago, estado)
  VALUES (p_orden, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
      'd0000000-0000-0000-0000-0000000d1001', p_factura, p_monto, p_fecha, 'transferencia', 'aprobada');
  UPDATE public.ordenes_pago SET estado = 'pagada' WHERE id = p_orden;
END;
$$;
-- Líneas vivas de un asiento automático: «CÓDIGO:D/H monto».
CREATE OR REPLACE FUNCTION public.tc_lineas(p_tabla text, p_id uuid, p_evento text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT string_agg(c.codigo || ':' || CASE WHEN l.debe > 0 THEN 'D' || l.debe ELSE 'H' || l.haber END, ',' ORDER BY l.orden)
    FROM public.conta_asientos a JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
    JOIN public.conta_cuentas c ON c.id = l.cuenta_id
   WHERE a.origen_tabla = p_tabla AND a.origen_id = p_id AND a.origen_evento = p_evento
     AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
$$;
CREATE OR REPLACE FUNCTION public.tc_cxp(p_factura uuid, p_orden uuid) RETURNS numeric
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(sum(l.haber - l.debe), 0) FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE a.estado = 'publicado' AND l.cuenta_id = '11000000-0000-0000-0000-0000000d1001'
     AND ((a.origen_tabla = 'facturas_proveedor' AND a.origen_id = p_factura)
          OR (a.origen_tabla = 'ordenes_pago' AND a.origen_id = p_orden))
$$;

\set F1 '''fa000000-0000-0000-0000-000000000001'''
\set F2 '''fa000000-0000-0000-0000-000000000002'''
\set OP1 '''0b000000-0000-0000-0000-000000000001'''
\set OP2 '''0b000000-0000-0000-0000-000000000002'''
SELECT public.tc_factura(:F1, '2026-08-20', 100);
SELECT public.chk_txt(public.tc_lineas('facturas_proveedor', :F1, 'factura_prov_aprobada'), '5199:D900.00,2199:H900.00',
  '10 · la factura de agosto: 100 USD × 9.00 = 900 en la CxP');
-- Sin la cuenta especial: el pago se contabiliza igual y el diferencial queda pendiente y visible.
SELECT public.tc_pagar(:OP1, :F1, 100, '2026-09-15');
SELECT public.chk_txt(public.tc_lineas('ordenes_pago', :OP1, 'orden_pago_pagada'), '2199:D780.00,1199:H780.00',
  '10 · el pago de septiembre: 100 USD × 7.80 = 780');
SELECT public.chk_txt(
  (SELECT d.estado || '|' || d.monto_neto || '|' || (d.motivo LIKE '%Diferencial cambiario%') FROM public.conta_diferenciales_cambiarios d WHERE d.orden_pago_id = :OP1),
  'sin_cuenta|120.00|true', '10 · sin la cuenta especial: el pago NO se bloquea; el diferencial (ganancia 120) queda pendiente con su motivo');
SELECT public.chk_txt(public.tc_cxp(:F1, :OP1)::text, '120.00', '10 · …y la CxP queda con 120 de residuo (lo que A1 corrige)');
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
  VALUES (:CO, 'a1a1a1a1-0000-0000-0000-000000000001', 'diferencial_cambiario', '11000000-0000-0000-0000-0000000d1004');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_reprocesar_diferenciales_cambiarios()$$,
  'No autorizado', '10 · el visor no reprocesa');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt((SELECT string_agg(r.resultado, ',') FROM public.conta_reprocesar_diferenciales_cambiarios() r),
  'contabilizado', '10 · configurada la cuenta, el reproceso lo contabiliza');
RESET ROLE;
SELECT public.chk_txt(public.tc_lineas('ordenes_pago', :OP1, 'diferencial_cambiario'), '7199:H120.00,2199:D120.00',
  '10 · ganancia cambiaria: abono a diferencial y cargo a la CxP');
SELECT public.chk_txt(public.tc_cxp(:F1, :OP1)::text, '0.00', '10 · la CxP de la factura pagada queda en 0 en la base');
SELECT public.chk_txt(
  (SELECT d.detalle->0->>'tasa_factura' || '|' || (d.detalle->0->>'tasa_pago') || '|' || d.tasa_pago FROM public.conta_diferenciales_cambiarios d WHERE d.orden_pago_id = :OP1),
  '9.000000|7.800000|7.800000', '10 · trazabilidad: la tasa de la factura y la del pago');
SELECT public.chk_txt((SELECT string_agg(r.resultado, ',') FROM public.conta_reprocesar_diferenciales_cambiarios() r), NULL,
  '10 · reprocesar otra vez: nada pendiente (idempotente)');

-- Pérdida: factura de julio (7.65) pagada en septiembre (7.80), ya con la cuenta.
SELECT public.tc_factura(:F2, '2026-07-20', 200);
SELECT public.tc_pagar(:OP2, :F2, 200, '2026-09-16');
SELECT public.chk_txt(public.tc_lineas('ordenes_pago', :OP2, 'diferencial_cambiario'), '7199:D30.00,2199:H30.00',
  '10 · pérdida cambiaria: 200 × (7.80 − 7.65) = 30, cargo a diferencial y abono a la CxP');
SELECT public.chk_txt(public.tc_cxp(:F2, :OP2)::text, '0.00', '10 · CxP en 0');
SELECT public.chk_txt((SELECT d.estado || '|' || d.monto_neto FROM public.conta_diferenciales_cambiarios d WHERE d.orden_pago_id = :OP2),
  'contabilizado|-30.00', '10 · registrado como pérdida');
-- Anular el pago reversa también su diferencial.
UPDATE public.ordenes_pago SET estado = 'anulada' WHERE id = :OP2;
SELECT public.chk_txt(COALESCE(public.tc_lineas('ordenes_pago', :OP2, 'diferencial_cambiario'), '-'), '-',
  '10 · anulado el pago, su diferencial queda reversado');
SELECT public.chk_txt((SELECT d.estado FROM public.conta_diferenciales_cambiarios d WHERE d.orden_pago_id = :OP2),
  'reversado', '10 · …y así consta');
SELECT public.chk_txt(public.tc_cxp(:F2, :OP2)::text, '1530.00', '10 · la CxP vuelve a deber la factura completa (200 × 7.65)');
-- Un pago en la moneda base no tiene diferencial.
SELECT public.chk((SELECT count(*) FROM public.conta_diferenciales_cambiarios d WHERE d.orden_pago_id NOT IN (:OP1, :OP2)), 0,
  '10 · sólo los pagos en otra moneda generan diferencial');
