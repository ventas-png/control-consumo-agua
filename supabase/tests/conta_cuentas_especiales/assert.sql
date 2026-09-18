-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de las cuentas especiales del sistema
-- (migración 20260918121413_conta_cuentas_especiales_semanticas).
--
--    1-5   el backfill sembró el mapeo en LOS DOS ledgers, sin tocar el catálogo
--    6-11  resolución acotada al ledger: empresa y proyecto, disjuntos
--   12-16  una cuenta de OTRO ledger no se mapea ni resuelve
--   17-21  inactiva y agrupadora: ni se mapean ni resuelven
--   22-25  mapeo ausente: NULL en la resolución, CONTA_CONFIG_INCOMPLETA al exigir
--   26-30  estado para Configuración: ok / sin_mapeo / inactiva / agrupadora
--   31-36  SIN CÓDIGOS FIJOS: cierre anual y revaluación FX con el catálogo
--          renombrado a códigos que no son los del seed
--   37-39  no bloqueante: la recepción se registra aunque falte el mapeo
--   40-46  ACL: anon, authenticated y los helpers internos
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set CO '11111111-1111-1111-1111-111111111111'
\set PR '22222222-2222-2222-2222-222222222222'

-- El tenant de quien pregunta (los stubs lo dejan en NULL a propósito).
CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT '11111111-1111-1111-1111-111111111111'::uuid $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-5 · El backfill: mapeos nuevos, catálogo intacto
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas
    WHERE company_id = :'CO' AND project_id IS NULL
      AND evento IN ('resultados_acumulados','resultado_ejercicio','diferencial_cambiario')), 3,
  '1 el ledger de EMPRESA tiene las tres cuentas especiales mapeadas');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas
    WHERE company_id = :'CO' AND project_id = :'PR'
      AND evento IN ('resultados_acumulados','resultado_ejercicio','diferencial_cambiario')), 3,
  '2 el ledger del PROYECTO tiene las suyas, por separado');

-- El catálogo no se tocó: mismas cuentas que antes de la migración.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO' AND codigo IN ('3101','3201','3301')), 6,
  '3 las cuentas 3101/3201/3301 siguen existiendo en los dos ledgers (3×2)');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas WHERE es_sistema AND NOT activa), 0,
  '4 ninguna cuenta del catálogo quedó desactivada por la migración');

-- Cada mapeo apunta a una cuenta de SU MISMO ledger. Es la invariante que
-- convierte "resolver por evento" en "resolver por evento sin cruzar tenants".
SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas m
     JOIN public.conta_cuentas c ON c.id = m.cuenta_id
    WHERE c.company_id <> m.company_id OR c.project_id IS DISTINCT FROM m.project_id), 0,
  '5 ningún mapeo apunta a una cuenta de otra contabilidad');

-- ─────────────────────────────────────────────────────────────────────────────
-- 6-11 · Resolución acotada al ledger
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk_txt(
  (SELECT c.codigo FROM public.conta_cuentas c
    WHERE c.id = public.conta_cuenta_especial(:'CO', NULL, 'resultado_ejercicio')), '3201',
  '6 empresa: resultado_ejercicio resuelve a su propia cuenta');

SELECT public.chk(
  (SELECT (c.project_id IS NULL)::int FROM public.conta_cuentas c
    WHERE c.id = public.conta_cuenta_especial(:'CO', NULL, 'resultado_ejercicio')), 1,
  '7 y esa cuenta es del ledger de EMPRESA (project_id NULL)');

SELECT public.chk(
  (SELECT (c.project_id = :'PR')::int FROM public.conta_cuentas c
    WHERE c.id = public.conta_cuenta_especial(:'CO', :'PR', 'resultado_ejercicio')), 1,
  '8 proyecto: resuelve a la cuenta de SU ledger, no a la de la empresa');

SELECT public.chk(
  (SELECT (public.conta_cuenta_especial(:'CO', NULL, 'resultado_ejercicio')
        <> public.conta_cuenta_especial(:'CO', :'PR', 'resultado_ejercicio'))::int), 1,
  '9 las dos contabilidades resuelven a cuentas DISTINTAS');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(:'CO', NULL, 'diferencial_cambiario') x
    WHERE x IS NOT NULL), 1,
  '10 diferencial_cambiario resuelve en el ledger de empresa');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(:'CO', NULL, 'resultados_acumulados') x
    WHERE x IS NOT NULL), 1,
  '11 resultados_acumulados resuelve en el ledger de empresa');

-- ─────────────────────────────────────────────────────────────────────────────
-- 12-16 · Una cuenta de OTRO ledger no entra
-- ─────────────────────────────────────────────────────────────────────────────
-- Intento explícito de cruzar contabilidades: mapear, en el ledger del
-- PROYECTO, la cuenta 3201 de la EMPRESA.
SELECT public.chk_falla(
  format($$INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
           VALUES ('%s', '%s', 'prueba_cross_ledger', '%s')$$,
         :'CO', :'PR',
         (SELECT id FROM public.conta_cuentas
           WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3201')),
  'MAPEO_LEDGER',
  '12 mapear en el proyecto una cuenta de la empresa se rechaza');

SELECT public.chk_falla(
  format($$UPDATE public.conta_mapeo_cuentas SET cuenta_id = '%s'
            WHERE company_id = '%s' AND project_id = '%s' AND evento = 'resultado_ejercicio'$$,
         (SELECT id FROM public.conta_cuentas
           WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3201'),
         :'CO', :'PR'),
  'MAPEO_LEDGER',
  '13 y re-apuntar un mapeo existente a la otra contabilidad, también');

-- Otra empresa entera: su ledger nace sembrado y NO comparte nada con ACME.
INSERT INTO public.companies (id, nombre, default_currency)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Otra Administradora', 'gtq');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas
    WHERE company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND evento IN ('resultados_acumulados','resultado_ejercicio','diferencial_cambiario')), 3,
  '14 una empresa NUEVA nace con sus tres cuentas especiales mapeadas');

SELECT public.chk(
  (SELECT (public.conta_cuenta_especial('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'resultado_ejercicio')
        <> public.conta_cuenta_especial(:'CO', NULL, 'resultado_ejercicio'))::int), 1,
  '15 y resuelve a SU cuenta, nunca a la de ACME');

-- Un project_id que no es de esta empresa no resuelve nada.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', :'PR', 'resultado_ejercicio') x WHERE x IS NOT NULL), 0,
  '16 empresa A + proyecto de B no resuelve: no hay ledger que combine los dos');

-- ─────────────────────────────────────────────────────────────────────────────
-- 17-21 · Inactiva y agrupadora
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk_falla(
  format($$INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
           VALUES ('%s', NULL, 'prueba_agrupadora', '%s')$$,
         :'CO',
         (SELECT id FROM public.conta_cuentas
           WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '31')),
  'agrupadora',
  '17 mapear una cuenta AGRUPADORA se rechaza');

-- Una cuenta de detalle, desactivada a mano (ni se crea ni se borra nada).
UPDATE public.conta_cuentas SET activa = false
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '1103';

SELECT public.chk_falla(
  format($$INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
           VALUES ('%s', NULL, 'prueba_inactiva', '%s')$$,
         :'CO',
         (SELECT id FROM public.conta_cuentas
           WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '1103')),
  'inactiva',
  '18 mapear una cuenta INACTIVA se rechaza');

-- Y si la cuenta se desactiva DESPUÉS de mapeada, la resolución deja de darla:
-- el mapeo sobrevive (no se borra nada), pero no se asienta contra ella.
UPDATE public.conta_cuentas SET activa = false
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3301';

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(:'CO', NULL, 'diferencial_cambiario') x
    WHERE x IS NOT NULL), 0,
  '19 una cuenta desactivada DESPUÉS de mapearla deja de resolver');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_mapeo_cuentas
    WHERE company_id = :'CO' AND project_id IS NULL AND evento = 'diferencial_cambiario'), 1,
  '20 pero el mapeo NO se borró: desactivar una cuenta no destruye configuración');

UPDATE public.conta_cuentas SET activa = true
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo IN ('1103','3301');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(:'CO', NULL, 'diferencial_cambiario') x
    WHERE x IS NOT NULL), 1,
  '21 reactivarla la vuelve a resolver, sin volver a configurar nada');

-- ─────────────────────────────────────────────────────────────────────────────
-- 22-25 · Mapeo ausente
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(:'CO', NULL, 'evento_que_no_existe') x
    WHERE x IS NOT NULL), 0,
  '22 un evento sin mapeo resuelve a NULL — nunca a una cuenta "parecida"');

SELECT public.chk_falla(
  format($$SELECT public.conta_exigir_cuenta_especial('%s', NULL, 'evento_que_no_existe')$$, :'CO'),
  'CONTA_CONFIG_INCOMPLETA',
  '23 y exigirlo levanta CONTA_CONFIG_INCOMPLETA');

SELECT public.chk_falla(
  format($$SELECT public.conta_exigir_cuenta_especial('%s', NULL, 'evento_que_no_existe')$$, :'CO'),
  'Configuración contable incompleta',
  '24 con el mensaje que la UI muestra tal cual');

-- Borrar el mapeo de una cuenta especial la deja sin resolver: es el escenario
-- "catálogo del cliente que todavía no configuró esta cuenta".
DELETE FROM public.conta_mapeo_cuentas
 WHERE company_id = :'CO' AND project_id IS NULL AND evento = 'resultados_acumulados';

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuenta_especial(:'CO', NULL, 'resultados_acumulados') x
    WHERE x IS NOT NULL), 0,
  '25 sin mapeo NO hay fallback por código: 3101 sigue en el catálogo y no se usa');

-- ─────────────────────────────────────────────────────────────────────────────
-- 26-30 · El estado que lee Configuración
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk_txt(
  (SELECT estado FROM public.conta_cuentas_especiales_estado(NULL)
    WHERE evento = 'resultados_acumulados'), 'sin_mapeo',
  '26 Configuración reporta "sin_mapeo" para la que acabamos de borrar');

SELECT public.chk_txt(
  (SELECT estado FROM public.conta_cuentas_especiales_estado(NULL)
    WHERE evento = 'resultado_ejercicio'), 'ok',
  '27 y "ok" para la que sí está resuelta');

UPDATE public.conta_cuentas SET activa = false
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3301';

SELECT public.chk_txt(
  (SELECT estado FROM public.conta_cuentas_especiales_estado(NULL)
    WHERE evento = 'diferencial_cambiario'), 'inactiva',
  '28 distingue "inactiva" de "sin_mapeo": se arregla en el catálogo, no aquí');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas_especiales_estado(NULL)
    WHERE evento = 'diferencial_cambiario' AND cuenta_id IS NOT NULL), 0,
  '29 y no devuelve cuenta_id para una que no es usable');

UPDATE public.conta_cuentas SET activa = true
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3301';

-- El estado del PROYECTO es el suyo, no el de la empresa.
SELECT public.chk_txt(
  (SELECT estado FROM public.conta_cuentas_especiales_estado(:'PR')
    WHERE evento = 'resultados_acumulados'), 'ok',
  '30 el proyecto sigue "ok" aunque a la empresa le falte: son ledgers distintos');

-- Se restaura para las pruebas que siguen.
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
SELECT :'CO', NULL, 'resultados_acumulados', id FROM public.conta_cuentas
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3101';

-- ─────────────────────────────────────────────────────────────────────────────
-- 31-36 · SIN CÓDIGOS FIJOS (la prueba que da nombre al PR)
-- ─────────────────────────────────────────────────────────────────────────────
-- Se RENOMBRAN los códigos del catálogo de empresa a una numeración que no se
-- parece en nada a la sembrada. Si algún proceso siguiera buscando '3201' o
-- '3301', a partir de aquí falla. No se borra ni se crea ninguna cuenta: sólo
-- cambia el código, que es justo lo que un cliente con su propio plan hace.
UPDATE public.conta_cuentas SET codigo = '900001'
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3101';
UPDATE public.conta_cuentas SET codigo = '900002'
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3201';
UPDATE public.conta_cuentas SET codigo = '900003'
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '3301';

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuentas
    WHERE company_id = :'CO' AND project_id IS NULL AND codigo IN ('3101','3201','3301')), 0,
  '31 el catálogo de empresa ya no tiene NINGUNO de los códigos del seed');

SELECT public.chk_txt(
  (SELECT c.codigo FROM public.conta_cuentas c
    WHERE c.id = public.conta_cuenta_especial(:'CO', NULL, 'resultado_ejercicio')), '900002',
  '32 y aun así resultado_ejercicio resuelve: el mapeo no mira el código');

-- Movimientos de resultados del año pasado, para que haya algo que cerrar.
SELECT public.conta_generar_asiento(
  :'CO', NULL, 'pruebas', gen_random_uuid(), 'ingreso_de_prueba',
  make_date(extract(year FROM CURRENT_DATE)::int - 1, 6, 15),
  'Ingreso de prueba', 'diario', 'GTQ',
  jsonb_build_array(
    jsonb_build_object('cuenta_id',
      (SELECT id FROM public.conta_cuentas WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '1101'),
      'debe', 1000),
    jsonb_build_object('cuenta_id',
      (SELECT id FROM public.conta_cuentas WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '4101'),
      'haber', 1000)));

SELECT public.chk(
  (SELECT total_haber FROM public.conta_asientos
    WHERE company_id = :'CO' AND origen_evento = 'ingreso_de_prueba'), 1000.00,
  '33 el asiento de prueba quedó publicado con 1000 al haber');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_cierre_anual(
     (extract(year FROM CURRENT_DATE)::int - 1), NULL)), 1,
  '34 el CIERRE ANUAL corre con el catálogo renombrado');

-- Y descarga el resultado contra la cuenta que el MAPEO señala, no contra 3201.
SELECT public.chk(
  (SELECT l.haber FROM public.conta_asiento_lineas l
     JOIN public.conta_cuentas c ON c.id = l.cuenta_id
     JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.tipo = 'cierre' AND a.company_id = :'CO' AND a.project_id IS NULL
      AND c.codigo = '900002'), 1000.00,
  '35 el resultado se descargó contra la cuenta MAPEADA (900002), no contra "3201"');

-- Revaluación FX: una cuenta en USD con saldo y una tasa vigente.
UPDATE public.conta_cuentas SET moneda = 'USD'
 WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '1104';
INSERT INTO public.conta_tipos_cambio (company_id, moneda, fecha, tasa)
VALUES (:'CO', 'USD', CURRENT_DATE - 30, 7.500000);

SELECT public.conta_generar_asiento(
  :'CO', NULL, 'pruebas', gen_random_uuid(), 'saldo_usd',
  CURRENT_DATE - 20, 'Saldo en USD', 'diario', 'GTQ',
  jsonb_build_array(
    jsonb_build_object('cuenta_id',
      (SELECT id FROM public.conta_cuentas WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '1104'),
      'debe', 750, 'moneda_origen', 'USD', 'monto_origen', 100, 'tipo_cambio', 7.5),
    jsonb_build_object('cuenta_id',
      (SELECT id FROM public.conta_cuentas WHERE company_id = :'CO' AND project_id IS NULL AND codigo = '4199'),
      'haber', 750)));

INSERT INTO public.conta_tipos_cambio (company_id, moneda, fecha, tasa)
VALUES (:'CO', 'USD', CURRENT_DATE, 8.000000);

SELECT public.chk(
  (SELECT count(*) FROM public.conta_revaluar_fx(CURRENT_DATE, true, NULL) r
    WHERE r.resultado = 'ajustado'), 1,
  '36 la REVALUACIÓN FX aplica con el catálogo renombrado y ajusta la cuenta USD');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l
     JOIN public.conta_cuentas c ON c.id = l.cuenta_id
    WHERE c.codigo = '900003' AND c.company_id = :'CO' AND c.project_id IS NULL), 1,
  '37 y el diferencial fue a la cuenta MAPEADA (900003), no a "3301"');

-- Sin mapeo, aplicar se detiene con el mensaje de configuración — y NO deja el
-- asiento a medias. Previsualizar, en cambio, sigue funcionando.
DELETE FROM public.conta_mapeo_cuentas
 WHERE company_id = :'CO' AND project_id IS NULL AND evento = 'diferencial_cambiario';

SELECT public.chk_falla(
  $$SELECT * FROM public.conta_revaluar_fx(CURRENT_DATE, true, NULL)$$,
  'CONTA_CONFIG_INCOMPLETA',
  '38 sin mapeo, APLICAR la revaluación se detiene con configuración incompleta');

SELECT public.chk(
  ((SELECT count(*) FROM public.conta_revaluar_fx(CURRENT_DATE - 1, false, NULL)) > 0)::int, 1,
  '39 pero PREVISUALIZAR sigue funcionando sin el mapeo (no escribe nada)');

SELECT public.chk_falla(
  format($$SELECT public.conta_cierre_anual(%s, NULL)$$, extract(year FROM CURRENT_DATE)::int - 2),
  'no tiene movimientos',
  '40 el cierre de un año sin movimientos sigue diciendo lo suyo, no un código');

-- ─────────────────────────────────────────────────────────────────────────────
-- 41-43 · No bloqueante: la operación de negocio no se cae
-- ─────────────────────────────────────────────────────────────────────────────
-- Se quita el mapeo del activo fijo en el ledger del PROYECTO y se recibe
-- mercadería con destino activo fijo: la recepción debe registrarse igual.
DELETE FROM public.conta_mapeo_cuentas
 WHERE company_id = :'CO' AND project_id = :'PR'
   AND evento IN ('activo_fijo','depreciacion_acumulada','gasto_depreciacion');

INSERT INTO public.proveedores (id, company_id, nombre, estado)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', :'CO', 'Muebles del Norte', 'autorizado');

INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', :'CO', :'PR',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Muebles del Norte', 'Escritorios', 'borrador');

INSERT INTO public.orden_compra_lineas
  (company_id, orden_compra_id, linea, descripcion, destino_tipo, cantidad, unidad, precio_unitario)
VALUES (:'CO', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 1, 'Escritorio ejecutivo', 'activo_fijo', 2, 'unidad', 1200);

UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, fecha, estado)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', :'CO', :'PR',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', CURRENT_DATE, 'borrador');

INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario)
SELECT :'CO', 'dddddddd-dddd-dddd-dddd-dddddddddddd', id, 2, 1200
  FROM public.orden_compra_lineas WHERE orden_compra_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

SELECT public.chk_txt(
  (SELECT estado FROM public.recepciones WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'registrada',
  '41 la recepción se REGISTRA aunque falte el mapeo de las cuentas del activo');

SELECT public.chk(
  (SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN
     (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')), 2,
  '42 y los dos activos se dan de alta igual');

SELECT public.chk(
  (SELECT count(*) FROM public.activos_fijos
    WHERE recepcion_linea_id IN
      (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd')
      AND cuenta_dep_acum_id IS NULL), 2,
  '43 con la cuenta contable en NULL: el hueco se ve, pero no tumba la recepción');

-- ─────────────────────────────────────────────────────────────────────────────
-- 44-49 · ACL: quién puede ejecutar qué
-- ─────────────────────────────────────────────────────────────────────────────
-- Los helpers internos no los ejecuta NADIE del lado del cliente: aceptan un
-- company_id por parámetro, así que exponerlos sería responder sin mirar quién
-- pregunta (hallazgo (b) de scripts/migrations-guard.mjs).
SELECT public.chk(
  has_function_privilege('anon', 'public.conta_cuenta_especial(uuid,uuid,text)', 'EXECUTE')::int, 0,
  '44 anon NO puede ejecutar conta_cuenta_especial');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.conta_cuenta_especial(uuid,uuid,text)', 'EXECUTE')::int, 0,
  '45 authenticated tampoco: es un helper interno de los procesos');

SELECT public.chk(
  has_function_privilege('anon', 'public.conta_exigir_cuenta_especial(uuid,uuid,text)', 'EXECUTE')::int, 0,
  '46 ni anon ni nadie ejecuta conta_exigir_cuenta_especial desde el cliente');

SELECT public.chk(
  has_function_privilege('anon', 'public.conta_cuentas_especiales_estado(uuid)', 'EXECUTE')::int, 0,
  '47 anon NO puede leer el estado de las cuentas especiales');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.conta_cuentas_especiales_estado(uuid)', 'EXECUTE')::int, 1,
  '48 authenticated SÍ: es lo que pinta la sección de Configuración');

SELECT public.chk(
  has_function_privilege('anon', 'public.conta_cierre_anual(integer,uuid)', 'EXECUTE')::int, 0,
  '49 el cierre anual sigue cerrado a anon tras el reemplazo');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.conta_cierre_anual(integer,uuid)', 'EXECUTE')::int, 1,
  '50 y sigue abierto a authenticated (el guard de rol vive dentro)');

SELECT public.chk(
  has_function_privilege('anon', 'public.conta_revaluar_fx(date,boolean,uuid)', 'EXECUTE')::int, 0,
  '51 la revaluación FX sigue cerrada a anon');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.conta_revaluar_fx(date,boolean,uuid)', 'EXECUTE')::int, 1,
  '52 y abierta a authenticated');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.compras_tg_recepcion_registrar()', 'EXECUTE')::int, 0,
  '53 el trigger de recepción no es ejecutable por nadie del cliente');

SELECT public.chk(
  has_function_privilege('authenticated', 'public.conta_seed_mapeos_especiales(uuid,uuid)', 'EXECUTE')::int, 0,
  '54 sembrar mapeos tampoco: lo hace el trigger de alta, no el cliente');

-- El search_path explícito es lo que impide que un esquema en el camino de
-- búsqueda secuestre una función SECURITY DEFINER.
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('conta_cuenta_especial','conta_exigir_cuenta_especial',
                        'conta_cuentas_especiales_estado','conta_seed_mapeos_especiales',
                        'conta_eventos_especiales','conta_tg_mapeo_mismo_ledger')
      AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
                       WHERE c LIKE 'search\_path=%')), 0,
  '55 todas las funciones nuevas fijan search_path explícito');

-- service_role bypassea la RLS, pero NO el GRANT de una función: un REVOKE ...
-- FROM PUBLIC se lo quita igual que a los demás. Se comprueba para que nadie
-- "arregle" un helper interno dándoselo al backend y lo deje abierto de más.
SELECT public.chk(
  has_function_privilege('service_role', 'public.conta_cuenta_especial(uuid,uuid,text)', 'EXECUTE')::int, 0,
  '56 service_role tampoco ejecuta el helper interno (el REVOKE FROM PUBLIC alcanza)');

SELECT public.chk(
  has_function_privilege('service_role', 'public.conta_seed_mapeos_especiales(uuid,uuid)', 'EXECUTE')::int, 0,
  '57 ni la siembra de mapeos');

-- La RLS de conta_mapeo_cuentas es la que protege la CONFIGURACIÓN: sin ella,
-- resolver por mapeo en vez de por código sólo mueve el problema de sitio.
SELECT public.chk(
  (SELECT relrowsecurity::int FROM pg_class WHERE oid = 'public.conta_mapeo_cuentas'::regclass), 1,
  '58 conta_mapeo_cuentas conserva la RLS habilitada tras la migración');

SELECT public.chk(
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conta_mapeo_cuentas'
      AND 'anon' = ANY(roles)), 0,
  '59 y ninguna de sus policies alcanza a anon');

SELECT public.chk(
  ((SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'conta_mapeo_cuentas'
      AND 'authenticated' = ANY(roles)) > 0)::int, 1,
  '60 mientras que authenticated sí tiene policy (la RLS filtra por empresa)');
