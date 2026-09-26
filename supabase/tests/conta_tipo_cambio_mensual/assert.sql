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
