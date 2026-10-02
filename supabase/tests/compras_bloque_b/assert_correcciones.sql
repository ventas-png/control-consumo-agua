\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CORRECCIONES DE REVISIÓN DEL #911 (migración 20261021000600)
--   1. recepción de activos con cuentas SEMÁNTICAS (no por código)
--   2. condiciones aprobadas inmutables al emitir y después (peticiones directas)
--   3. recepción + líneas: creación transaccional e idempotente
-- Las peticiones van DIRECTO al servidor (SQL como `authenticated`), que es lo
-- que hace el cliente de la API: el formulario no es un control.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set C3  '''c3c3c3c3-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set S1  '''50000000-0000-0000-0000-0000000000c1'''

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · CUENTAS SEMÁNTICAS EN LA RECEPCIÓN DE ACTIVOS
-- Una contabilidad (proyecto C3) con catálogo PROPIO: códigos 91xx/97xx/92xx y
-- NINGUNA cuenta 1401, 1409 ni 5107. Los mapeos por evento son válidos.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.projects (id, company_id, nombre) VALUES (:C3::uuid, :C::uuid, 'Proyecto C3 (catálogo propio)');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT u, :C3::uuid, 'total' FROM unnest(ARRAY[:UA::uuid, :UO::uuid]) u;

-- Si algún disparador sembró el catálogo estándar, se vacía este ledger: la
-- prueba exige un catálogo SIN las cuentas de código fijo.
DELETE FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C3::uuid;
DELETE FROM public.conta_cuentas WHERE company_id = :C::uuid AND project_id = :C3::uuid;

SELECT public.conta_seed_cuenta(:C::uuid, :C3::uuid, '9101', 'Equipo propio de la empresa', 'activo', 'deudora',   NULL, 1, true);
SELECT public.conta_seed_cuenta(:C::uuid, :C3::uuid, '9109', 'Depreciación acumulada propia', 'activo', 'acreedora', NULL, 1, true);
SELECT public.conta_seed_cuenta(:C::uuid, :C3::uuid, '9701', 'Gasto de depreciación propio', 'gasto', 'deudora',   NULL, 1, true);
SELECT public.conta_seed_cuenta(:C::uuid, :C3::uuid, '9205', 'Compras por facturar propias', 'pasivo', 'acreedora', NULL, 1, true);
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
SELECT :C::uuid, :C3::uuid, m.evento, c.id
  FROM (VALUES ('activo_fijo', '9101'), ('depreciacion_acumulada', '9109'),
               ('gasto_depreciacion', '9701'), ('compras_por_facturar', '9205')) AS m(evento, codigo)
  JOIN public.conta_cuentas c ON c.company_id = :C::uuid AND c.project_id = :C3::uuid AND c.codigo = m.codigo;

SELECT public.chk((SELECT count(*) FROM public.conta_cuentas
                    WHERE company_id = :C::uuid AND project_id = :C3::uuid AND codigo IN ('1401', '1409', '5107')), 0,
  '1 · el ledger de prueba NO tiene cuentas 1401, 1409 ni 5107');
SELECT public.chk((SELECT count(*) FROM public.conta_mapeo_cuentas
                    WHERE company_id = :C::uuid AND project_id = :C3::uuid
                      AND evento IN ('activo_fijo', 'depreciacion_acumulada', 'gasto_depreciacion')), 3,
  '1 · pero tiene los tres mapeos por evento, válidos y de su ledger');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0d100000-0000-0000-0000-000000000001', :C::uuid, :C3::uuid, :P1::uuid, 'Ferretería Bloque B', 'Equipo en ledger propio');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('0d110000-0000-0000-0000-000000000001', :C::uuid, '0d100000-0000-0000-0000-000000000001', 1, 'Compresor', 'activo_fijo', 'mantenimiento', 2, 'unidad', 800);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0d100000-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0d100000-0000-0000-0000-000000000001';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, destino_fisico)
VALUES ('0d200000-0000-0000-0000-000000000001', :C::uuid, :C3::uuid, '0d100000-0000-0000-0000-000000000001', 'bienes', 'Cuarto de máquinas');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada, motivo_rechazo)
VALUES (:C::uuid, '0d200000-0000-0000-0000-000000000001', '0d110000-0000-0000-0000-000000000001', 2, 1, 'Un equipo llegó golpeado');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0d200000-0000-0000-0000-000000000001';
RESET ROLE;

SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = '0d200000-0000-0000-0000-000000000001'), 'registrada',
  '1 · la recepción de activos se registra con un catálogo de códigos propios');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos
                    WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0d200000-0000-0000-0000-000000000001')), 2,
  '1 · da de alta un activo por unidad ACEPTADA (2); lo rechazado (1) no genera activo (mejora del bloque B conservada)');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos a
                    WHERE a.recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0d200000-0000-0000-0000-000000000001')
                      AND a.cuenta_activo_id    = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C3::uuid AND evento = 'activo_fijo')
                      AND a.cuenta_dep_acum_id  = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C3::uuid AND evento = 'depreciacion_acumulada')
                      AND a.cuenta_gasto_dep_id = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C3::uuid AND evento = 'gasto_depreciacion')), 2,
  '1 · y los DOS activos quedan con las tres cuentas MAPEADAS del ledger (91xx/97xx), no sin cuenta ni con las de código fijo');
SELECT public.chk_bool((SELECT string_agg(DISTINCT c.codigo, ',' ORDER BY c.codigo) = '9101,9205'
                          FROM public.conta_asientos a
                          JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                          JOIN public.conta_cuentas c ON c.id = l.cuenta_id
                         WHERE a.origen_tabla = 'recepciones' AND a.origen_id = '0d200000-0000-0000-0000-000000000001'),
  true, '1 · el asiento GR/IR usa las cuentas mapeadas (9101 activo, 9205 por facturar)');

-- Quitar el mapeo NO tumba la recepción (no bloqueante): el activo nace sin cuenta.
DELETE FROM public.conta_mapeo_cuentas
 WHERE company_id = :C::uuid AND project_id = :C3::uuid
   AND evento IN ('depreciacion_acumulada', 'gasto_depreciacion');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0d100000-0000-0000-0000-000000000002', :C::uuid, :C3::uuid, :P1::uuid, 'Ferretería Bloque B', 'Equipo sin mapeo de depreciación');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('0d110000-0000-0000-0000-000000000002', :C::uuid, '0d100000-0000-0000-0000-000000000002', 1, 'Escritorio', 'activo_fijo', 'mantenimiento', 1, 'unidad', 300);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0d100000-0000-0000-0000-000000000002';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0d100000-0000-0000-0000-000000000002';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0d200000-0000-0000-0000-000000000002', :C::uuid, :C3::uuid, '0d100000-0000-0000-0000-000000000002', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0d200000-0000-0000-0000-000000000002', '0d110000-0000-0000-0000-000000000002', 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0d200000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = '0d200000-0000-0000-0000-000000000002'), 'registrada',
  '1 · sin mapeo de depreciación la recepción se registra igual (no bloqueante)');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos a
                    WHERE a.recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0d200000-0000-0000-0000-000000000002')
                      AND a.cuenta_dep_acum_id IS NULL AND a.cuenta_gasto_dep_id IS NULL
                      AND a.cuenta_activo_id = (SELECT cuenta_id FROM public.conta_mapeo_cuentas WHERE company_id = :C::uuid AND project_id = :C3::uuid AND evento = 'activo_fijo')), 1,
  '1 · el hueco de configuración se ve (cuentas en NULL) y la cuenta del activo sigue siendo la mapeada');

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · CONDICIONES APROBADAS: INMUTABLES AL EMITIR Y DESPUÉS
-- ════════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, moneda, condiciones_pago, dias_credito)
VALUES ('0d100000-0000-0000-0000-0000000000a1', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Condiciones congeladas', 'GTQ', 'Crédito 30 días', 30);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES (:C::uuid, '0d100000-0000-0000-0000-0000000000a1', 1, 'Material', 'gasto', 'mantenimiento', 10, 100);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0d100000-0000-0000-0000-0000000000a1';

-- 2a · en la MISMA operación que emite: cada condición, por separado.
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida', proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · emitir y cambiar el PROVEEDOR a la vez: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida', moneda = 'USD' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · emitir y cambiar la MONEDA a la vez: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida', condiciones_pago = 'Contado' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · emitir y cambiar las CONDICIONES DE PAGO a la vez: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida', dias_credito = 90 WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · emitir y cambiar los DÍAS DE CRÉDITO a la vez: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida', fecha_requerida = CURRENT_DATE + 5 WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · emitir y cambiar la FECHA REQUERIDA a la vez: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida', project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · emitir y cambiar el PROYECTO a la vez: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'x', moneda = 'USD' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2a · tampoco al cancelar: ninguna otra transición lleva condiciones cambiadas');
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'aprobada' AND proveedor_id = :P1::uuid AND moneda = 'GTQ' AND condiciones_pago = 'Crédito 30 días'
                           AND dias_credito = 30 AND project_id = :C1::uuid
                          FROM public.ordenes_compra WHERE id = '0d100000-0000-0000-0000-0000000000a1'),
  true, '2a · y la orden quedó EXACTAMENTE como se aprobó (ningún cambio se coló)');

-- 2b · la emisión legítima sigue funcionando.
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0d100000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0d100000-0000-0000-0000-0000000000a1'), 'emitida',
  '2b · emitir lo aprobado, sin cambios, sigue permitido');

-- 2c · una orden EMITIDA tampoco admite cambios de condiciones.
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cambiar el proveedor: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET moneda = 'USD' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cambiar la moneda: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET condiciones_pago = 'Contado' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cambiar las condiciones de pago: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET dias_credito = 0 WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cambiar el crédito: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET fecha_requerida = CURRENT_DATE + 9 WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cambiar la fecha requerida: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cambiar el proyecto: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'cerrada', proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0d100000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2c · emitida: cerrar y cambiar el proveedor a la vez: RECHAZADO');
UPDATE public.ordenes_compra SET notas = 'Aviso al proveedor enviado' WHERE id = '0d100000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_txt((SELECT notas FROM public.ordenes_compra WHERE id = '0d100000-0000-0000-0000-0000000000a1'), 'Aviso al proveedor enviado',
  '2c · lo que no es condición de la compra (notas) se sigue pudiendo anotar');

-- 2d · una orden con recepciones (recibida / parcial) tampoco cambia condiciones.
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0b100000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_EMITIDA_CAMBIO', '2d · una orden ya RECIBIDA no cambia de proveedor');
RESET ROLE;

-- 2e · la devolución legítima a borrador, con motivo, se conserva — como
-- operación PROPIA: sin condiciones cambiadas en la misma petición.
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0d100000-0000-0000-0000-0000000000a2', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Devolución legítima');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES (:C::uuid, '0d100000-0000-0000-0000-0000000000a2', 1, 'Material', 'gasto', 'mantenimiento', 1, 10);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0d100000-0000-0000-0000-0000000000a2';
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'Cambió el proveedor', proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0d100000-0000-0000-0000-0000000000a2' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '2e · devolver Y cambiar el proveedor en la misma petición: RECHAZADO (la devolución va sola)');
UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'Cambió el proveedor acordado' WHERE id = '0d100000-0000-0000-0000-0000000000a2';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'borrador' AND revision = 1 AND aprobada_por IS NULL AND aprobada_at IS NULL
                          FROM public.ordenes_compra WHERE id = '0d100000-0000-0000-0000-0000000000a2'),
  true, '2e · la devolución con motivo sigue funcionando: borrador, aprobación invalidada y revisión +1');
SET ROLE authenticated;
UPDATE public.ordenes_compra SET proveedor_id = :P2::uuid, proveedor_nombre = 'Servicios Bloque B' WHERE id = '0d100000-0000-0000-0000-0000000000a2';
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0d100000-0000-0000-0000-0000000000a2';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0d100000-0000-0000-0000-0000000000a2';
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'emitida' AND proveedor_id = :P2::uuid AND revision = 1
                          FROM public.ordenes_compra WHERE id = '0d100000-0000-0000-0000-0000000000a2'),
  true, '2e · devuelta, editada en borrador, reaprobada y emitida: la revisión vale para lo nuevo');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · RECEPCIÓN + LÍNEAS: UNA TRANSACCIÓN, IDEMPOTENTE POR CLAVE Y CONTENIDO
-- Orden R (C1, P1): una línea de inventario 50 × 10, emitida.
-- ════════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0d100000-0000-0000-0000-0000000000b1', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Orden para la creación transaccional');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario) VALUES
  ('0d110000-0000-0000-0000-0000000000b1', :C::uuid, '0d100000-0000-0000-0000-0000000000b1', 1, 'Cloro', 'inventario', :S1::uuid, 'limpieza', 50, 'litro', 10),
  ('0d110000-0000-0000-0000-0000000000b2', :C::uuid, '0d100000-0000-0000-0000-0000000000b1', 2, 'Guantes', 'gasto', NULL, 'limpieza', 20, 'par', 5);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0d100000-0000-0000-0000-0000000000b1';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0d100000-0000-0000-0000-0000000000b1';
RESET ROLE;

-- 3a · éxito: documento completo (cabecera + líneas) en una sola llamada.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE r1 AS
SELECT public.compras_recepcion_crear(
  :C::uuid, :C1::uuid,
  '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","documento_referencia":"REM-77","destino_fisico":"Bodega","clave_idempotencia":"rpc-001"}'::jsonb,
  '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":10,"cantidad_rechazada":2,"motivo_rechazo":"Envases dañados","costo_unitario":10},
    {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":20,"cantidad_rechazada":0,"costo_unitario":5}]'::jsonb) AS j;
GRANT ALL ON r1 TO PUBLIC;
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean = false AND j->'recepcion'->>'estado' = 'borrador'
                               AND jsonb_array_length(j->'lineas') = 2 FROM r1),
  true, '3a · crear devuelve el documento COMPLETO (borrador + 2 líneas) y marca que es nuevo');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-001'), 1, '3a · una recepción con esa clave');
SELECT public.chk((SELECT count(*) FROM public.recepcion_lineas WHERE recepcion_id = (SELECT (j->'recepcion'->>'id')::uuid FROM r1)), 2, '3a · y sus dos líneas, creadas juntas');
SELECT public.chk_bool((SELECT hash_contenido IS NOT NULL FROM public.recepciones WHERE clave_idempotencia = 'rpc-001'), true,
  '3a · y guarda la huella del contenido');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones'
                    AND origen_id = (SELECT (j->'recepcion'->>'id')::uuid FROM r1)), 0,
  '3a · crear (borrador) no contabiliza nada');

-- 3b · RESPUESTA PERDIDA: el cliente reintenta con la misma clave y el mismo
-- contenido → recupera EL MISMO documento completo; no se crea otro.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE r2 AS
SELECT public.compras_recepcion_crear(
  :C::uuid, :C1::uuid,
  '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","documento_referencia":"REM-77","destino_fisico":"Bodega","clave_idempotencia":"rpc-001"}'::jsonb,
  '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":10,"cantidad_rechazada":2,"motivo_rechazo":"Envases dañados","costo_unitario":10},
    {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":20,"cantidad_rechazada":0,"costo_unitario":5}]'::jsonb) AS j;
GRANT ALL ON r2 TO PUBLIC;
RESET ROLE;
SELECT public.chk_bool((SELECT (r2.j->>'reutilizada')::boolean = true
                               AND r2.j->'recepcion'->>'id' = r1.j->'recepcion'->>'id'
                               AND r2.j->'lineas' = r1.j->'lineas' FROM r1, r2),
  true, '3b · respuesta perdida: el reintento recupera el MISMO documento completo (misma recepción y mismas líneas)');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-001'), 1, '3b · sigue habiendo UNA recepción');
SELECT public.chk((SELECT count(*) FROM public.recepcion_lineas WHERE recepcion_id = (SELECT (j->'recepcion'->>'id')::uuid FROM r1)), 2, '3b · y dos líneas (no se duplicaron)');

-- 3c · el MISMO contenido escrito distinto (40 / 40.0, otro orden de líneas,
-- espacios) sigue siendo el mismo intento.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE r3 AS
SELECT public.compras_recepcion_crear(
  :C::uuid, :C1::uuid,
  '{"clave_idempotencia":" rpc-001 ","fecha":"2026-10-01","orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","destino_fisico":"Bodega ","documento_referencia":"REM-77","tipo":"bienes","notas":null}'::jsonb,
  '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":20.0,"costo_unitario":5.00},
    {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":10.0,"cantidad_rechazada":2,"motivo_rechazo":" Envases dañados","costo_unitario":10}]'::jsonb) AS j;
GRANT ALL ON r3 TO PUBLIC;
RESET ROLE;
SELECT public.chk_bool((SELECT (r3.j->>'reutilizada')::boolean AND r3.j->'recepcion'->>'id' = r1.j->'recepcion'->>'id' FROM r1, r3),
  true, '3c · el mismo contenido con otra forma (decimales, orden, espacios) también es el mismo intento');

-- 3d · MISMA clave con contenido DISTINTO: rechazo claro, nada cambia.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","documento_referencia":"REM-77","destino_fisico":"Bodega","clave_idempotencia":"rpc-001"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":11,"cantidad_rechazada":2,"motivo_rechazo":"Envases dañados","costo_unitario":10},
      {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":20,"cantidad_rechazada":0,"costo_unitario":5}]'::jsonb) $$,
  'COMPRAS_RECEPCION_CLAVE_CONFLICTO', '3d · misma clave con OTRA cantidad: rechazado con mensaje claro');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","documento_referencia":"REM-99","destino_fisico":"Bodega","clave_idempotencia":"rpc-001"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":10,"cantidad_rechazada":2,"motivo_rechazo":"Envases dañados","costo_unitario":10},
      {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":20,"cantidad_rechazada":0,"costo_unitario":5}]'::jsonb) $$,
  'COMPRAS_RECEPCION_CLAVE_CONFLICTO', '3d · misma clave con OTRA cabecera (referencia): rechazado');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","documento_referencia":"REM-77","destino_fisico":"Bodega","clave_idempotencia":"rpc-001"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":10,"cantidad_rechazada":2,"motivo_rechazo":"Envases dañados","costo_unitario":10}]'::jsonb) $$,
  'COMPRAS_RECEPCION_CLAVE_CONFLICTO', '3d · misma clave con UNA línea menos: rechazado');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-001'), 1, '3d · y no se creó ni se tocó nada');
SELECT public.chk_num((SELECT cantidad FROM public.recepcion_lineas
                        WHERE recepcion_id = (SELECT (j->'recepcion'->>'id')::uuid FROM r1)
                          AND orden_compra_linea_id = '0d110000-0000-0000-0000-0000000000b1'), 10, '3d · la cantidad original sigue siendo 10');

-- 3e · FALLO DE LÍNEAS: nada queda a medias (ni cabecera huérfana).
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
-- La segunda línea es de OTRA orden (la de assert_recepcion).
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","clave_idempotencia":"rpc-fallo"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":5},
      {"orden_compra_linea_id":"0b110000-0000-0000-0000-000000000001","cantidad":5}]'::jsonb) $$,
  'COMPRAS_RECEPCION_LINEA_AJENA', '3e · una línea que no es de la orden hace fallar TODA la creación');
-- Un rechazo sin motivo (restricción de la tabla) en la segunda línea.
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","clave_idempotencia":"rpc-fallo"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":5},
      {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":0,"cantidad_rechazada":3}]'::jsonb) $$,
  'recepcion_lineas_motivo_check', '3e · un rechazo sin motivo en la segunda línea hace fallar TODA la creación');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'rpc-fallo'), 0,
  '3e · NO queda cabecera huérfana: la recepción tampoco existe');
SELECT public.chk((SELECT count(*) FROM public.recepcion_lineas WHERE recepcion_id NOT IN (SELECT id FROM public.recepciones)), 0,
  '3e · ni líneas sueltas');
-- La clave NO se «quemó»: el reintento corregido con la misma clave funciona.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE r4 AS
SELECT public.compras_recepcion_crear(
  :C::uuid, :C1::uuid,
  '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","tipo":"bienes","fecha":"2026-10-01","clave_idempotencia":"rpc-fallo"}'::jsonb,
  '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":5},
    {"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b2","cantidad":0,"cantidad_rechazada":3,"motivo_rechazo":"Talla incorrecta"}]'::jsonb) AS j;
RESET ROLE;
SELECT public.chk_bool((SELECT NOT (j->>'reutilizada')::boolean AND jsonb_array_length(j->'lineas') = 2 FROM r4), true,
  '3e · tras el fallo, el reintento CORREGIDO con la misma clave crea el documento completo');

-- 3f · validaciones de entrada y permisos.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":1}]'::jsonb) $$,
  'COMPRAS_RECEPCION_CLAVE_REQUERIDA', '3f · sin clave de idempotencia: rechazado');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","clave_idempotencia":"rpc-vacia"}'::jsonb, '[]'::jsonb) $$,
  'COMPRAS_RECEPCION_VACIA', '3f · sin líneas: rechazado');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"orden_compra_id":"0d100000-0000-0000-0000-0000000000b1","clave_idempotencia":"rpc-otra-empresa"}'::jsonb,
    '[{"orden_compra_linea_id":"0d110000-0000-0000-0000-0000000000b1","cantidad":1}]'::jsonb) $$,
  'row-level security|violates|COMPRAS', '3f · otra empresa no crea una recepción contra una orden de C (rige la RLS de quien llama, igual que el INSERT directo)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE clave_idempotencia IN ('rpc-otra-empresa', 'rpc-vacia')), 0,
  '3f · y no se creó nada');
SELECT public.chk((SELECT (has_function_privilege('anon', 'public.compras_recepcion_crear(uuid,uuid,jsonb,jsonb)', 'EXECUTE'))::int), 0,
  '3f · anon no ejecuta la función');
SELECT public.chk((SELECT (has_function_privilege('authenticated', 'public.compras_recepcion_crear(uuid,uuid,jsonb,jsonb)', 'EXECUTE'))::int), 1,
  '3f · authenticated sí (la RLS decide)');

-- 3g · la recepción creada por la función se REGISTRA con las reglas de siempre.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = (SELECT (j->'recepcion'->>'id')::uuid FROM r1);
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = '0d110000-0000-0000-0000-0000000000b1'), 10,
  '3g · registrar la recepción creada por la función recibe lo ACEPTADO (10); lo rechazado (2) no cuenta');
