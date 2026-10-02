\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CARGA MASIVA DE RENGLONES DE UNA ORDEN EN BORRADOR
-- (migración 20261022000100: compras_lineas_importar_*)
--
-- Insumos de C1: «Cloro importado» (litro), «Guante» ×2 (nombre repetido: ambiguo),
-- «Insumo de C2» (en el otro proyecto). Orden OM (C1, P1) en borrador.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set OM  '''0c600000-0000-0000-0000-000000000001'''

INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES
  ('0c6a0000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, 'Cloro importado', 'litro'),
  ('0c6a0000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, 'Guante', 'caja'),
  ('0c6a0000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, 'guante ', 'caja'),
  ('0c6a0000-0000-0000-0000-000000000004', :C::uuid, :C2::uuid, 'Insumo de C2', 'litro');

SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:OM::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Orden para importar renglones');
RESET ROLE;

CREATE TEMP TABLE res_imp (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_imp TO authenticated;
CREATE TEMP TABLE antes_imp AS SELECT
  (SELECT count(*) FROM public.proveedores WHERE company_id = :C::uuid) AS prov,
  (SELECT count(*) FROM public.conta_cuentas WHERE company_id = :C::uuid) AS cuentas,
  (SELECT count(*) FROM public.suministros_condominio WHERE company_id = :C::uuid) AS insumos;
GRANT ALL ON antes_imp TO authenticated;

-- ── 1. Vista previa con errores por fila: no escribe renglones ──────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO res_imp SELECT 'p1', public.compras_lineas_importar_previsualizar(:OM::uuid, $f$[
  {"descripcion":"Cloro industrial","destino":"inventario","insumo":"Cloro importado","categoria":"limpieza","cantidad":"10","unidad":"","precio_unitario":"12.50","iva":"15"},
  {"descripcion":"Mantenimiento mensual","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"},
  {"descripcion":"Papelería","destino":"gasto","categoria":"administrativo","cantidad":"2","precio_unitario":"50","cuenta":"5199"},
  {"descripcion":"Insumo que no existe","destino":"inventario","insumo":"Fantasma","cantidad":"1","precio_unitario":"1"},
  {"descripcion":"Con columna prohibida","destino":"gasto","cantidad":"1","precio_unitario":"1","proveedor":"Otro","estado":"aprobada"},
  {"descripcion":"Unidad que no es","destino":"inventario","insumo":"Cloro importado","cantidad":"1","unidad":"galón","precio_unitario":"1"},
  {"descripcion":"Nombre ambiguo","destino":"inventario","insumo":"guante","cantidad":"1","precio_unitario":"1"},
  {"descripcion":"=cmd|' /C calc'!A0","destino":"gasto","cantidad":"1","precio_unitario":"1"},
  {"descripcion":"Cantidad cero","destino":"gasto","cantidad":"0","precio_unitario":"1"},
  {"descripcion":"Destino raro","destino":"otro","cantidad":"1","precio_unitario":"1"},
  {"descripcion":"Cuenta que no existe","destino":"gasto","cantidad":"1","precio_unitario":"1","cuenta":"NOEXISTE"},
  {"descripcion":"Cuenta no apta","destino":"gasto","cantidad":"1","precio_unitario":"1","cuenta":"2104"},
  {"descripcion":"Insumo de otro proyecto","destino":"inventario","insumo":"Insumo de C2","cantidad":"1","precio_unitario":"1"},
  {"descripcion":"Insumo en un gasto","destino":"gasto","insumo":"Cloro importado","cantidad":"1","precio_unitario":"1"},
  {"descripcion":"Cantidad con coma","destino":"gasto","cantidad":"1,5","precio_unitario":"1"}
]$f$::jsonb, 'prueba.csv');
RESET ROLE;
SELECT public.chk((SELECT (j->'resumen'->>'total')::int FROM res_imp WHERE k = 'p1'), 15, '1 · la vista previa cuenta las 15 filas');
SELECT public.chk((SELECT (j->'resumen'->>'validas')::int FROM res_imp WHERE k = 'p1'), 3, '1 · 3 filas válidas (inventario con insumo, servicio, gasto con cuenta existente)');
SELECT public.chk((SELECT (j->'resumen'->>'con_error')::int FROM res_imp WHERE k = 'p1'), 12, '1 · 12 con error');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 0, '1 · la vista previa NO escribe renglones');
SELECT public.chk_txt((SELECT string_agg(DISTINCT e->>'campo', ',' ORDER BY e->>'campo')
                         FROM res_imp, jsonb_array_elements(j->'filas') f, jsonb_array_elements(f->'errores') e
                        WHERE k = 'p1' AND (f->>'fila')::int = 5), 'estado,proveedor', '1 · columnas prohibidas (proveedor, estado) señaladas en su fila');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 4), 'insumo', '1 · insumo inexistente: error en «insumo»');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 6), 'unidad', '1 · unidad distinta a la del insumo: error en «unidad»');
SELECT public.chk_bool((SELECT f->'errores'->0->>'mensaje' LIKE '%ambiguo%' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 7), true, '1 · nombre de insumo repetido: ambiguo, no se elige uno al azar');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 8), 'descripcion', '1 · valor que empieza con = se rechaza');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 9), 'cantidad', '1 · cantidad 0');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 10), 'destino', '1 · destino inválido');
SELECT public.chk_bool((SELECT f->'errores'->0->>'mensaje' LIKE '%no existe%crea%' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 11), true, '1 · cuenta inexistente: no se crea');
SELECT public.chk_bool((SELECT f->'errores'->0->>'mensaje' LIKE '%no es apta%' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 12), true, '1 · cuenta existente pero no apta para un gasto');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 13), 'insumo', '1 · insumo de OTRO proyecto: no existe para esta orden');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 14), 'insumo', '1 · insumo en un renglón que no es de inventario');
SELECT public.chk_txt((SELECT f->'errores'->0->>'campo' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 15), 'cantidad', '1 · cantidad con coma decimal');
SELECT public.chk_txt((SELECT f->'datos'->>'unidad' FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 1), 'litro', '1 · la unidad en blanco toma la del insumo');
SELECT public.chk_bool((SELECT (f->'datos'->>'suministro_id') IS NOT NULL FROM res_imp, jsonb_array_elements(j->'filas') f WHERE k = 'p1' AND (f->>'fila')::int = 1), true, '1 · el insumo se resolvió por nombre');

-- Con errores no se aplica NADA (todo o nada)
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p1')) $$,
  'COMPRAS_IMPORT_CON_ERRORES', '2 · un lote con errores no se aplica');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 0, '2 · y no quedó ningún renglón (ni los válidos)');

-- ── 3. Archivo limpio: previsualizar → aplicar ──────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO res_imp SELECT 'p2', public.compras_lineas_importar_previsualizar(:OM::uuid, $f$[
  {"descripcion":"Cloro industrial","destino":"inventario","insumo":"Cloro importado","categoria":"limpieza","cantidad":"10","precio_unitario":"12.50","iva":"15"},
  {"descripcion":"Mantenimiento mensual","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"},
  {"descripcion":"Papelería","destino":"gasto","categoria":"administrativo","cantidad":"2","precio_unitario":"50","cuenta":"5199"},
  {"descripcion":"Bomba","destino":"activo fijo","categoria":"mantenimiento","cantidad":"2","precio_unitario":"500","iva":"120"}
]$f$::jsonb, 'limpio.csv');
RESET ROLE;
SELECT public.chk((SELECT (j->'resumen'->>'con_error')::int FROM res_imp WHERE k = 'p2'), 0, '3 · el archivo limpio no tiene errores');
SELECT public.chk_txt((SELECT estado FROM public.compras_linea_importaciones WHERE id = (SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p2')), 'previsualizado', '3 · el lote queda «previsualizado» hasta confirmar');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 0, '3 · confirmar es un paso aparte: aún no hay renglones');

SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO res_imp SELECT 'a2', public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p2'));
RESET ROLE;
SELECT public.chk((SELECT (j->>'renglones_creados')::int FROM res_imp WHERE k = 'a2'), 4, '3 · se crearon 4 renglones');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 4, '3 · hay 4 renglones en la orden');
SELECT public.chk_txt((SELECT string_agg(linea::text || destino_tipo, ',' ORDER BY linea) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid),
  '1inventario,2servicio,3gasto,4activo_fijo', '3 · numerados 1..4 con su destino (inventario, servicio, gasto y activo se distinguen)');
SELECT public.chk_bool((SELECT suministro_id IS NOT NULL FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid AND linea = 1), true, '3 · el renglón de inventario quedó con su insumo');
SELECT public.chk_txt((SELECT cuenta_origen FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid AND linea = 3), 'linea_explicita', '3 · la cuenta por código quedó como explícita');
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = :OM::uuid), 1696, '3 · el total de la orden sale de los renglones: 140 + 336 + 100 + 1120 = 1696');

-- ── 4. La importación NO aprueba, emite, recibe ni contabiliza ──────────────
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OM::uuid), 'borrador', '4 · la orden sigue en borrador');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE orden_compra_id = :OM::uuid), 0, '4 · no hay recepciones');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE company_id = :C::uuid AND origen_id = :OM::uuid), 0, '4 · no hay asientos');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = '0c6a0000-0000-0000-0000-000000000001'), 0, '4 · no hay movimientos de inventario');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = '0c6a0000-0000-0000-0000-000000000001'), 0, '4 · el stock no se movió');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE company_id = :C::uuid), (SELECT prov FROM antes_imp)::int, '4 · no se crearon proveedores');
SELECT public.chk((SELECT count(*) FROM public.conta_cuentas WHERE company_id = :C::uuid), (SELECT cuentas FROM antes_imp)::int, '4 · no se crearon cuentas');
SELECT public.chk((SELECT count(*) FROM public.suministros_condominio WHERE company_id = :C::uuid), (SELECT insumos FROM antes_imp)::int, '4 · no se crearon insumos');
SELECT public.chk_txt((SELECT estado FROM public.compras_linea_importaciones WHERE id = (SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p2')), 'aplicado', '4 · el lote queda «aplicado» con quién y cuándo');
SELECT public.chk_uuid((SELECT aplicado_por FROM public.compras_linea_importaciones WHERE id = (SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p2')), :UO::uuid, '4 · aplicado_por es quien confirmó');

-- ── 5. Reintento y duplicados ───────────────────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO res_imp SELECT 'a2b', public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p2'));
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_imp WHERE k = 'a2b'), true, '5 · reaplicar el MISMO lote (doble clic) devuelve el resultado, sin escribir');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 4, '5 · siguen siendo 4 renglones');

SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO res_imp SELECT 'p3', public.compras_lineas_importar_previsualizar(:OM::uuid, $f$[
  {"descripcion":"Cloro industrial","destino":"inventario","insumo":"Cloro importado","categoria":"limpieza","cantidad":"10","precio_unitario":"12.50","iva":"15"},
  {"descripcion":"Mantenimiento mensual","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"},
  {"descripcion":"Papelería","destino":"gasto","categoria":"administrativo","cantidad":"2","precio_unitario":"50","cuenta":"5199"},
  {"descripcion":"Bomba","destino":"activo fijo","categoria":"mantenimiento","cantidad":"2","precio_unitario":"500","iva":"120"}
]$f$::jsonb, 'limpio-otra-vez.csv');
RESET ROLE;
SELECT public.chk_bool((SELECT (j->'resumen'->>'duplicado_de_lote_aplicado')::boolean FROM res_imp WHERE k = 'p3'), true, '5 · la vista previa avisa que este contenido ya se importó a la orden');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p3')) $$,
  'COMPRAS_IMPORT_DUPLICADO', '5 · cargar otra vez el mismo contenido se rechaza (importación duplicada)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 4, '5 · y no hay renglones duplicados');

-- ── 6. Candado de escritura del lote ────────────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.compras_linea_importaciones (company_id, orden_compra_id, contenido_sha256, estado)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c600000-0000-0000-0000-000000000001', 'x', 'aplicado') $$,
  'COMPRAS_IMPORT_SOLO_RPC', '6 · un lote no se fabrica con un INSERT directo');
SELECT public.chk_falla($$ UPDATE public.compras_linea_importaciones SET estado = 'aplicado', resultado = '{}'::jsonb
  WHERE id = (SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p3') $$,
  'COMPRAS_IMPORT_SOLO_RPC', '6 · un lote no se marca «aplicado» a mano');
RESET ROLE;

-- ── 7. Aislamiento: otra empresa ────────────────────────────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_previsualizar('0c600000-0000-0000-0000-000000000001', '[{"descripcion":"Intruso","destino":"gasto","cantidad":"1","precio_unitario":"1"}]'::jsonb) $$,
  'COMPRAS_IMPORT_ORDEN', '7 · otra empresa no previsualiza sobre la orden');
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p3')) $$,
  'COMPRAS_IMPORT_LOTE', '7 · otra empresa no aplica el lote');
SELECT public.chk((SELECT count(*) FROM public.compras_linea_importaciones), 0, '7 · y no ve los lotes de la empresa C');
RESET ROLE;

-- ── 8. Deshacer y volver a importar; el estado cambia entre vista previa y aplicar ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
DELETE FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid;
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 0, '8 · el administrador quitó los renglones importados');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((public.compras_lineas_importar_previsualizar(:OM::uuid, $f$[
  {"descripcion":"Cloro industrial","destino":"inventario","insumo":"Cloro importado","categoria":"limpieza","cantidad":"10","precio_unitario":"12.50","iva":"15"}
]$f$::jsonb, 'otro.csv'))->'resumen'->>'duplicado_de_lote_aplicado' = 'false', true, '8 · sin los renglones ya no se considera duplicado');
INSERT INTO res_imp SELECT 'p4', public.compras_lineas_importar_previsualizar(:OM::uuid, $f$[
  {"descripcion":"Cloro industrial","destino":"inventario","insumo":"Cloro importado","categoria":"limpieza","cantidad":"10","precio_unitario":"12.50","iva":"15"}
]$f$::jsonb, 'cambia.csv');
RESET ROLE;
-- el insumo se renombra entre la vista previa y la confirmación
UPDATE public.suministros_condominio SET nombre = 'Cloro renombrado' WHERE id = '0c6a0000-0000-0000-0000-000000000001';
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p4')) $$,
  'COMPRAS_IMPORT_CON_ERRORES', '8 · si el insumo cambió desde la vista previa, la fila se re-evalúa y no se aplica a ciegas');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OM::uuid), 0, '8 · no se escribió nada');
UPDATE public.suministros_condominio SET nombre = 'Cloro importado' WHERE id = '0c6a0000-0000-0000-0000-000000000001';

-- ── 9. Descartar y límites ──────────────────────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.compras_lineas_importar_descartar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p4'));
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.compras_linea_importaciones WHERE id = (SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p4')), 'descartado', '9 · el lote se descarta');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_imp WHERE k = 'p4')) $$,
  'COMPRAS_IMPORT_LOTE', '9 · un lote descartado no se aplica');
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_previsualizar('0c600000-0000-0000-0000-000000000001',
  (SELECT jsonb_agg(jsonb_build_object('descripcion', 'Fila ' || g, 'destino', 'gasto', 'cantidad', '1', 'precio_unitario', '1')) FROM generate_series(1, 501) g)) $$,
  'COMPRAS_IMPORT_LIMITE', '9 · más de 500 filas se rechazan');
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_previsualizar('0c600000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  'COMPRAS_IMPORT_VACIA', '9 · un archivo sin filas');
RESET ROLE;

-- ── 10. Solo órdenes en borrador ────────────────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, :OM::uuid, 1, 'Renglón manual', 'gasto', 'otros', 1, 'unidad', 10);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :OM::uuid;
SELECT public.chk_falla($$ SELECT public.compras_lineas_importar_previsualizar('0c600000-0000-0000-0000-000000000001', '[{"descripcion":"Tarde","destino":"gasto","cantidad":"1","precio_unitario":"1"}]'::jsonb) $$,
  'COMPRAS_IMPORT_ORDEN_NO_BORRADOR', '10 · a una orden aprobada no se le importan renglones');
RESET ROLE;
