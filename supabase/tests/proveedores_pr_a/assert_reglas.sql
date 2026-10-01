\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CUENTAS SUGERIDAS DE COMPRA (categoría/producto, vigencia)
-- Cuentas del ledger A1: a101 gasto (mapeo gasto_otros) · a102 limpieza ·
-- a103 mantenimiento · a104 inventario (mapeo) · a105 inv. herramientas ·
-- a106 activo fijo · a107 desactivada · a108 agrupadora · a109 INGRESO ·
-- a110 CxP (mapeo) · a111 gasto nuevo.  Ledger A2: a201, a202 (sin mapeos).
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B     '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UP1   '''a0a0a0a0-0000-0000-0000-00000000000f'''
\set UP2   '''a0a0a0a0-0000-0000-0000-000000000012'''
\set UC    '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set UO    '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set P1    '''d1000000-0000-0000-0000-0000000000a1'''
\set S1    '''50000000-0000-0000-0000-0000000000a1'''
\set S2    '''50000000-0000-0000-0000-0000000000a2'''
\set G101  '''c1000000-0000-0000-0000-00000000a101'''
\set G102  '''c1000000-0000-0000-0000-00000000a102'''
\set G103  '''c1000000-0000-0000-0000-00000000a103'''
\set I104  '''c1000000-0000-0000-0000-00000000a104'''
\set I105  '''c1000000-0000-0000-0000-00000000a105'''
\set F106  '''c1000000-0000-0000-0000-00000000a106'''
\set X107  '''c1000000-0000-0000-0000-00000000a107'''
\set R108  '''c1000000-0000-0000-0000-00000000a108'''
\set N109  '''c1000000-0000-0000-0000-00000000a109'''
\set G111  '''c1000000-0000-0000-0000-00000000a111'''
\set G201  '''c1000000-0000-0000-0000-00000000a201'''
\set GB01  '''c1000000-0000-0000-0000-00000000b001'''

SELECT public.como(:UA::uuid);

-- ── 1. Nace vacía y SIN cambiar el comportamiento de hoy ────────────────────
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_compra), 0,
  '1 · conta_reglas_compra nace vacía (sin backfill)');

SET ROLE authenticated;
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza')),
  'mapeo_evento', '1 · sin reglas, el gasto cae al mapeo del evento (comportamiento de hoy)');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza')),
  :G101::uuid, '1 · y la cuenta es la mapeada, sin códigos fijos');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'inventario', 'limpieza', :S1::uuid)),
  'mapeo_evento', '1 · el inventario cae al mapeo del evento inventario');

-- Sin regla ni mapeo: NO se inventa una cuenta genérica.
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'activo_fijo', 'otros')),
  'sin_resolver', '1 · activo fijo sin regla ni mapeo: sin_resolver');
SELECT public.chk_bool((SELECT cuenta_id IS NULL AND motivo IS NOT NULL
                          FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'activo_fijo', 'otros')),
  true, '1 · sin cuenta y CON motivo: no se contabiliza en una cuenta genérica');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A2::uuid, 'gasto', 'limpieza')),
  'sin_resolver', '1 · el ledger A2 (sin ningún mapeo) tampoco resuelve nada');
SELECT public.chk_falla($$ SELECT * FROM public.compras_resolver_cuenta_linea('a1a1a1a1-0000-0000-0000-000000000001', 'gasto_mal') $$,
  'DESTINO_INVALIDO', '1 · un destino fuera del catálogo se rechaza');
RESET ROLE;

-- ── 2. Reglas por categoría y precedencia ───────────────────────────────────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.conta_reglas_compra (id, company_id, project_id, destino, categoria, cuenta_id)
VALUES ('a0000000-0000-0000-0000-0000000000a1', :A::uuid, :A1::uuid, 'gasto', 'limpieza', :G102::uuid);
RESET ROLE;
SELECT public.como(:UA::uuid);

SET ROLE authenticated;
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza')),
  'regla_compra', '2 · una regla por categoría gana al mapeo del evento');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza')),
  :G102::uuid, '2 · …y manda a SU cuenta');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'mantenimiento')),
  'mapeo_evento', '2 · otra categoría sin regla sigue cayendo al mapeo del evento');
RESET ROLE;

-- Regla EXISTENTE del proveedor (todo lo del proveedor a una cuenta por destino).
INSERT INTO public.conta_reglas_proveedor (company_id, project_id, proveedor_id, destino, cuenta_id)
VALUES (:A::uuid, :A1::uuid, :P1::uuid, 'gasto', :G103::uuid);

SET ROLE authenticated;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid)),
  :G102::uuid, '2 · el MISMO proveedor: la categoría limpieza va a su cuenta (regla de compra)…');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'mantenimiento', NULL, :P1::uuid)),
  :G103::uuid, '2 · …y mantenimiento a la de la regla del proveedor: NO todo un proveedor a una sola cuenta');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'mantenimiento', NULL, :P1::uuid)),
  'regla_proveedor', '2 · la regla del proveedor sigue funcionando como escalón siguiente (motor existente)');
RESET ROLE;

-- Regla específica por proveedor + categoría gana a la general de la categoría.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, proveedor_id, cuenta_id)
VALUES (:A::uuid, :A1::uuid, 'gasto', 'limpieza', :P1::uuid, :G111::uuid);
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid)),
  :G111::uuid, '2 · categoría + proveedor es más específica que solo categoría');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, NULL)),
  :G102::uuid, '2 · y para otro proveedor sigue valiendo la regla general de la categoría');
RESET ROLE;

-- ── 3. Reglas por PRODUCTO ──────────────────────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, suministro_id, cuenta_id)
VALUES (:A::uuid, :A1::uuid, 'inventario', :S1::uuid, :I105::uuid);
INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, suministro_id, proveedor_id, cuenta_id)
VALUES (:A::uuid, :A1::uuid, 'inventario', :S1::uuid, :P1::uuid, :I104::uuid);
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'inventario', NULL, :S1::uuid, NULL)),
  :I105::uuid, '3 · la regla por PRODUCTO manda ese producto a su cuenta de inventario');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'inventario', NULL, :S1::uuid, :P1::uuid)),
  :I104::uuid, '3 · producto + proveedor es la más específica');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'inventario', NULL, NULL, NULL)),
  'mapeo_evento', '3 · otro producto (sin regla) sigue al mapeo del evento');
RESET ROLE;

-- ── 4. La cuenta ELEGIDA en la línea prevalece, pero se valida ──────────────
SET ROLE authenticated;
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :G101::uuid)),
  'linea_explicita', '4 · la cuenta elegida en la línea prevalece sobre TODAS las reglas');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :G101::uuid)),
  :G101::uuid, '4 · …y es exactamente la elegida');
-- Una elegida que no sirve NO cae silenciosamente a otra cuenta.
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :X107::uuid)),
  'sin_resolver', '4 · elegida DESACTIVADA: sin_resolver (no se usa la regla en su lugar)');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :R108::uuid)),
  'sin_resolver', '4 · elegida AGRUPADORA: sin_resolver');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :N109::uuid)),
  'sin_resolver', '4 · elegida de un TIPO no apto (ingreso para un gasto): sin_resolver');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :I104::uuid)),
  'sin_resolver', '4 · elegida de inventario para un destino gasto: sin_resolver');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :G201::uuid)),
  'sin_resolver', '4 · elegida del ledger de OTRO proyecto: sin_resolver');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, :P1::uuid, :GB01::uuid)),
  'sin_resolver', '4 · elegida de OTRA empresa: sin_resolver');
RESET ROLE;

-- ── 5. Validación al crear una regla (ámbito, tipo, forma) ──────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000a104') $$,
  'REGLA_CUENTA_NO_APTA', '5 · un destino gasto no admite una cuenta de activo');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'inventario', 'obras', 'c1000000-0000-0000-0000-00000000a101') $$,
  'REGLA_CUENTA_NO_APTA', '5 · un destino inventario no admite una cuenta de gasto');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000a109') $$,
  'REGLA_CUENTA_NO_APTA', '5 · …ni una de ingreso');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000a108') $$,
  'REGLA_CUENTA_AGRUPADORA', '5 · una cuenta agrupadora se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000a107') $$,
  'REGLA_CUENTA_INACTIVA', '5 · una cuenta desactivada se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000a201') $$,
  'REGLA_LEDGER', '5 · una cuenta del ledger de OTRO proyecto se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000b001') $$,
  'REGLA_LEDGER', '5 · una cuenta de OTRA EMPRESA se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'c1000000-0000-0000-0000-00000000a101') $$,
  'conta_reglas_compra_clasifica', '5 · una regla sin categoría ni producto (todo a una cuenta) se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, suministro_id, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'inventario', 'limpieza',
          '50000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-00000000a104') $$,
  'conta_reglas_compra_no_ambas', '5 · categoría Y producto a la vez se rechaza (sería ambiguo)');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'inventada', 'c1000000-0000-0000-0000-00000000a101') $$,
  'REGLA_CATEGORIA', '5 · una categoría fuera del vocabulario declarado se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, suministro_id, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'inventario',
          '50000000-0000-0000-0000-0000000000a2', 'c1000000-0000-0000-0000-00000000a104') $$,
  'REGLA_PRODUCTO_AJENO', '5 · un producto de OTRO proyecto no entra en la regla de este ledger');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, proveedor_id, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras',
          'd1000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-00000000a101') $$,
  'REGLA_PROVEEDOR_AJENO', '5 · un proveedor de OTRA empresa se rechaza');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'compras_por_facturar', 'obras', 'c1000000-0000-0000-0000-00000000a101') $$,
  'REGLA_DESTINO', '5 · el puente GR/IR no es destino de una línea de compra');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id, vigente_desde, vigente_hasta)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras',
          'c1000000-0000-0000-0000-00000000a101', '2026-06-01', '2026-01-01') $$,
  'conta_reglas_compra_vigencia', '5 · la vigencia no puede terminar antes de empezar');
RESET ROLE;

-- ── 6. Vigencia: cambiar un predeterminado NO reescribe el pasado ───────────
-- Documento histórico: una factura aprobada ANTES de tocar ninguna regla.
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, concepto, categoria, monto_total, moneda, estado)
VALUES ('fa000000-0000-0000-0000-0000000000a1', :A::uuid, :A1::uuid, :P1::uuid, 'Factura histórica', 'otros', 250, 'USD', 'registrada');
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa000000-0000-0000-0000-0000000000a1';
CREATE TEMP TABLE f_antes AS
SELECT l.cuenta_id, l.debe, l.haber FROM public.conta_asiento_lineas l
  JOIN public.conta_asientos a ON a.id = l.asiento_id
 WHERE a.origen_id = 'fa000000-0000-0000-0000-0000000000a1' AND a.origen_evento = 'factura_prov_aprobada';
SELECT public.chk_bool((SELECT count(*) > 0 FROM f_antes), true, '6 · la factura histórica generó su asiento');

SET ROLE authenticated;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza')),
  :G102::uuid, '6 · hoy la categoría limpieza resuelve a a102');
SELECT public.compras_reemplazar_regla_cuenta('a0000000-0000-0000-0000-0000000000a1', :G111::uuid, CURRENT_DATE + 5) AS regla_nueva \gset
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, NULL, NULL, CURRENT_DATE)),
  :G102::uuid, '6 · cambiar el predeterminado: HOY sigue resolviendo a la cuenta anterior');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, NULL, NULL, CURRENT_DATE + 4)),
  :G102::uuid, '6 · …y hasta el último día de la regla vieja');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, NULL, NULL, CURRENT_DATE + 5)),
  :G111::uuid, '6 · …y desde la fecha nueva resuelve a la cuenta nueva');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A1::uuid, 'gasto', 'limpieza', NULL, NULL, NULL, CURRENT_DATE - 30)),
  'mapeo_evento', '6 · un documento ANTERIOR a la regla no se ve afectado por ella');

SELECT public.chk_falla($$ UPDATE public.conta_reglas_compra SET cuenta_id = 'c1000000-0000-0000-0000-00000000a111'
                           WHERE id = 'a0000000-0000-0000-0000-0000000000a1' $$,
  'REGLA_VIGENTE_INMUTABLE', '6 · una regla que ya rige no cambia de cuenta (se reemplaza con vigencia)');
SELECT public.chk_falla($$ DELETE FROM public.conta_reglas_compra WHERE id = 'a0000000-0000-0000-0000-0000000000a1' $$,
  'REGLA_VIGENTE_INMUTABLE', '6 · ni se borra');
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id, vigente_desde)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'limpieza',
          'c1000000-0000-0000-0000-00000000a103', CURRENT_DATE + 2) $$,
  'REGLA_TRASLAPE', '6 · dos reglas activas con vigencia traslapada para lo mismo se rechazan');
SELECT public.chk_falla($$ SELECT public.compras_reemplazar_regla_cuenta('a0000000-0000-0000-0000-0000000000a1',
                           'c1000000-0000-0000-0000-00000000a103', CURRENT_DATE) $$,
  'REGLA_FECHA', '6 · el reemplazo debe regir desde una fecha FUTURA');
-- Se puede cerrar o desactivar la vigente.
UPDATE public.conta_reglas_compra SET notas = 'Revisada por contabilidad' WHERE id = 'a0000000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_compra
                    WHERE destino = 'gasto' AND categoria = 'limpieza' AND proveedor_id IS NULL AND project_id = :A1::uuid), 2,
  '6 · la regla vieja quedó cerrada y la nueva abierta: dos filas, historia intacta');

-- El asiento histórico NO se movió.
SELECT public.chk((SELECT count(*) FROM public.conta_asiento_lineas l
                    JOIN public.conta_asientos a ON a.id = l.asiento_id
                    WHERE a.origen_id = 'fa000000-0000-0000-0000-0000000000a1' AND a.origen_evento = 'factura_prov_aprobada'
                      AND (l.cuenta_id, l.debe, l.haber) IN (SELECT cuenta_id, debe, haber FROM f_antes)),
  (SELECT count(*) FROM f_antes), '6 · modificar predeterminados NO cambia el asiento de un documento ya contabilizado');

-- ── 7. Este PR sugiere; NO cablea el devengo (eso es del PR B) ──────────────
-- Existe una regla de categoría para «otros»; una factura nueva sigue
-- contabilizando por el mapeo del evento, exactamente como antes.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
VALUES (:A::uuid, :A1::uuid, 'gasto', 'otros', :G111::uuid);
RESET ROLE;
SELECT public.como(:UA::uuid);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, concepto, categoria, monto_total, moneda, estado)
VALUES ('fa000000-0000-0000-0000-0000000000a2', :A::uuid, :A1::uuid, :P1::uuid, 'Factura nueva', 'otros', 100, 'USD', 'registrada');
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa000000-0000-0000-0000-0000000000a2';
SELECT public.chk((SELECT COALESCE(sum(l.debe), 0)::bigint FROM public.conta_asiento_lineas l
                    JOIN public.conta_asientos a ON a.id = l.asiento_id
                    WHERE a.origen_id = 'fa000000-0000-0000-0000-0000000000a2' AND a.origen_evento = 'factura_prov_aprobada'
                      AND l.cuenta_id IN (SELECT cuenta_id FROM public.conta_reglas_proveedor WHERE proveedor_id = :P1::uuid
                                          UNION SELECT 'c1000000-0000-0000-0000-00000000a103'::uuid)), 100,
  '7 · la factura sigue contabilizando por el motor de hoy (regla del PROVEEDOR / mapeo), no por la regla de compra nueva');
SELECT public.chk((SELECT count(*) FROM public.conta_asiento_lineas l
                    JOIN public.conta_asientos a ON a.id = l.asiento_id
                    WHERE a.origen_id = 'fa000000-0000-0000-0000-0000000000a2' AND l.cuenta_id = :G111::uuid), 0,
  '7 · …y NADA se imputó a la cuenta de la regla de compra: el cableado al devengo es del PR B');

-- ── 8. Sugerencia con código y nombre; configuración incompleta visible ─────
SET ROLE authenticated;
SELECT public.chk_txt((SELECT cuenta_codigo FROM public.compras_sugerir_cuenta(:A1::uuid, 'inventario', NULL, :S1::uuid, :P1::uuid)),
  '1106', '8 · la sugerencia trae el código de la cuenta (para precargar la línea)');
SELECT public.chk_txt((SELECT cuenta_nombre FROM public.compras_sugerir_cuenta(:A1::uuid, 'inventario', NULL, :S1::uuid, :P1::uuid)),
  'Inventario A1', '8 · …y su nombre');

SELECT public.chk_bool((SELECT completa FROM public.compras_config_estado(:A1::uuid) WHERE concepto = 'cuenta_por_pagar'),
  true, '8 · A1 tiene su cuenta POR PAGAR mapeada (concepto distinto del destino)');
SELECT public.chk_bool((SELECT completa FROM public.compras_config_estado(:A2::uuid) WHERE concepto = 'cuenta_por_pagar'),
  false, '8 · A2 NO la tiene: la configuración incompleta es visible');
SELECT public.chk_bool((SELECT motivo IS NOT NULL FROM public.compras_config_estado(:A2::uuid) WHERE concepto = 'cuenta_por_pagar'),
  true, '8 · …y dice qué falta');
SELECT public.chk((SELECT count(*) FROM public.compras_config_estado(:A2::uuid) WHERE concepto = 'destino' AND completa), 0,
  '8 · en A2 NINGÚN destino resuelve: no se inventa una cuenta genérica');
SELECT public.chk((SELECT count(*) FROM public.compras_config_estado(:A2::uuid) WHERE concepto = 'destino' AND cuenta_id IS NOT NULL), 0,
  '8 · …todas las filas de A2 quedan sin cuenta');
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.compras_config_estado(:A1::uuid) WHERE concepto = 'destino' AND NOT completa),
  true, '8 · en A1 hay destinos sin resolver (costo, activo fijo…) y se listan como incompletos');
SELECT public.chk_bool((SELECT completa FROM public.compras_config_estado(:A1::uuid)
                         WHERE concepto = 'destino' AND destino = 'gasto' AND categoria = 'limpieza'),
  true, '8 · y los que sí resuelven aparecen completos');
RESET ROLE;

-- ── 9. Alcance: empresa y proyecto ──────────────────────────────────────────
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.compras_resolver_cuenta_linea('a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'limpieza') $$,
  '42501|no pertenece', '9 · UB no resuelve contra un proyecto de A');
SELECT public.chk_falla($$ SELECT * FROM public.compras_config_estado('a1a1a1a1-0000-0000-0000-000000000001') $$,
  '42501|no pertenece', '9 · …ni consulta su configuración');
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_compra), 0, '9 · UB no ve las reglas de A');
RESET ROLE;
SELECT public.como(:UP1::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.compras_resolver_cuenta_linea('a2a2a2a2-0000-0000-0000-000000000001', 'gasto', 'limpieza') $$,
  '42501|no pertenece', '9 · UP1 (solo A1) no resuelve contra A2');
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.conta_reglas_compra), true, '9 · UP1 ve las reglas de A1');
RESET ROLE;
SELECT public.como(:UP2::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_reglas_compra), 0, '9 · UP2 (solo A2) no ve las reglas de A1');
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'gasto', 'obras', 'c1000000-0000-0000-0000-00000000a101') $$,
  'row-level security', '9 · UO (sin permiso contable) no crea reglas');
SELECT public.chk_falla($$ SELECT public.compras_reemplazar_regla_cuenta('a0000000-0000-0000-0000-0000000000a1',
                           'c1000000-0000-0000-0000-00000000a103', CURRENT_DATE + 30) $$,
  '42501|No autorizado', '9 · …ni reemplaza');
RESET ROLE;
SELECT public.como(:UA::uuid);
SELECT public.chk_txt('ok', 'ok', 'REGLAS DE COMPRA · bloque completo');
