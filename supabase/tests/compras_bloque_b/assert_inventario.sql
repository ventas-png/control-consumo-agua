\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · INVENTARIO DESDE LA ORDEN DE COMPRA (migración 20261022000000)
--
-- Insumos (suministros) del padrón: SA Desinfectante (litro, C1), SB Guantes
-- (caja, C1), SI Inactivo (litro, C1, activo=false), SX Cloro C2 (litro, C2),
-- SD insumo de la OTRA empresa (litro, D1).
-- Orden OI (C1, P1): renglón I1 inventario SA 100 L × 10, renglón I2 gasto.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set SA  '''0c5a0000-0000-0000-0000-000000000001'''
\set SB  '''0c5a0000-0000-0000-0000-000000000002'''
\set SI  '''0c5a0000-0000-0000-0000-000000000003'''
\set SX  '''0c5a0000-0000-0000-0000-000000000004'''
\set SD  '''0c5a0000-0000-0000-0000-000000000005'''
\set OI  '''0c500000-0000-0000-0000-000000000001'''
\set I1  '''0c510000-0000-0000-0000-000000000001'''
\set I2  '''0c510000-0000-0000-0000-000000000002'''
\set OE  '''0c500000-0000-0000-0000-000000000002'''
\set E1  '''0c510000-0000-0000-0000-000000000003'''
\set R1  '''0c520000-0000-0000-0000-000000000001'''
\set R2  '''0c520000-0000-0000-0000-000000000002'''

INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida, activo) VALUES
  (:SA::uuid, :C::uuid, :C1::uuid, 'Desinfectante', 'litro', true),
  (:SB::uuid, :C::uuid, :C1::uuid, 'Guantes',       'caja',  true),
  (:SI::uuid, :C::uuid, :C1::uuid, 'Insumo inactivo', 'litro', false),
  (:SX::uuid, :C::uuid, :C2::uuid, 'Cloro de C2',   'litro', true),
  ('0c5a0000-0000-0000-0000-000000000005', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1d1d1d1-0000-0000-0000-000000000001', 'Insumo de D', 'litro', true);

-- ── 1. Validaciones del renglón con insumo (el operador captura la orden) ────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:OI::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Desinfectante y servicio');

SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Gasto con insumo', 'gasto', '0c5a0000-0000-0000-0000-000000000001', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_DESTINO', '1 · un insumo en un renglón de GASTO no se admite');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Activo con insumo', 'activo_fijo', '0c5a0000-0000-0000-0000-000000000001', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_DESTINO', '1 · ni en un renglón de ACTIVO FIJO');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Servicio con insumo', 'servicio', '0c5a0000-0000-0000-0000-000000000001', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_DESTINO', '1 · ni en un renglón de SERVICIO');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Insumo de otro proyecto', 'inventario', '0c5a0000-0000-0000-0000-000000000004', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_ALCANCE', '1 · el insumo es de OTRO proyecto de la misma empresa');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Insumo de otra empresa', 'inventario', '0c5a0000-0000-0000-0000-000000000005', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_ALCANCE', '1 · el insumo es de OTRA empresa');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Unidad distinta', 'inventario', '0c5a0000-0000-0000-0000-000000000001', 'limpieza', 1, 'galón', 1) $$,
  'COMPRAS_LINEA_INSUMO_UNIDAD', '1 · la unidad del renglón no es la del insumo (galón ≠ litro)');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Insumo inactivo', 'inventario', '0c5a0000-0000-0000-0000-000000000003', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_INACTIVO', '1 · el insumo está inactivo');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OI::uuid), 0, '1 · ningún renglón inválido quedó guardado');

-- Una orden de la contabilidad de la EMPRESA (sin proyecto) no tiene bodega
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:OE::uuid, :C::uuid, NULL, :P1::uuid, 'Ferretería Bloque B', 'Orden de la empresa');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000002', 1, 'Insumo en orden de empresa', 'inventario', '0c5a0000-0000-0000-0000-000000000001', 'limpieza', 1, 'litro', 1) $$,
  'COMPRAS_LINEA_INSUMO_ALCANCE', '1 · una orden de la contabilidad de la empresa no admite insumos de bodega');
RESET ROLE;

-- ── 2. Renglón válido (la unidad se compara sin mayúsculas ni espacios) ─────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  (:I1::uuid, :C::uuid, :OI::uuid, 1, 'Desinfectante', 'inventario', :SA::uuid, 'limpieza', 100, ' Litro ', 10, 120),
  (:I2::uuid, :C::uuid, :OI::uuid, 2, 'Servicio de fumigación', 'servicio', NULL, 'mantenimiento', 1, 'servicio', 300, 36);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :OI::uuid), 2, '2 · el renglón con insumo válido y el de servicio se guardan');

-- Inventario SIN insumo: válido como borrador, no se aprueba
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario)
VALUES (:E1::uuid, :C::uuid, :OI::uuid, 3, 'Inventario sin insumo', 'inventario', NULL, 'limpieza', 5, 'litro', 10);
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0c500000-0000-0000-0000-000000000001' $$,
  'COMPRAS_ORDEN_INVENTARIO_SIN_INSUMO', '2 · no se aprueba una orden con inventario sin insumo');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OI::uuid), 'borrador', '2 · la orden sigue en borrador');
-- Se corrige quitando ese renglón; ahora sí
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
DELETE FROM public.orden_compra_lineas WHERE id = :E1::uuid;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :OI::uuid;
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = :OI::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OI::uuid), 'emitida', '2 · aprobada y emitida con el insumo elegido');

-- ── 3. EMITIR no mueve existencias ni asientos de inventario ────────────────
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = :SA::uuid), 0, '3 · emitir la orden no registra movimientos de inventario');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :SA::uuid), 0, '3 · el stock sigue en 0 al emitir');

-- ── 4. Con la orden aprobada el insumo/destino/unidad y los renglones no se cambian ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET suministro_id = '0c5a0000-0000-0000-0000-000000000002', unidad = 'caja' WHERE id = '0c510000-0000-0000-0000-000000000001' $$,
  'COMPRAS_LINEA_ORDEN_CERRADA', '4 · cambiar el insumo de un renglón de una orden emitida');
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET destino_tipo = 'gasto', suministro_id = NULL WHERE id = '0c510000-0000-0000-0000-000000000001' $$,
  'COMPRAS_LINEA_ORDEN_CERRADA', '4 · cambiar el destino de un renglón de una orden emitida');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '0c500000-0000-0000-0000-000000000001', 9, 'Renglón tardío', 'gasto', 'otros', 1, 'unidad', 1) $$,
  'COMPRAS_LINEA_ORDEN_CERRADA', '4 · no se agregan renglones a una orden emitida');
RESET ROLE;

-- ── 5. Recepción PARCIAL con rechazo: solo lo ACEPTADO entra al inventario ───
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (:R1::uuid, :C::uuid, :C1::uuid, :OI::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada, motivo_rechazo, costo_unitario)
VALUES (:C::uuid, :R1::uuid, :I1::uuid, 40, 10, 'Envases dañados', 10);
SELECT public.como(:UA::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = :R1::uuid;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = :R1::uuid;     -- reintento: nada nuevo
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :SA::uuid), 40, '5 · el stock sube SOLO por lo aceptado (40), no por lo pedido (100) ni lo rechazado (10)');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = :SA::uuid AND tipo = 'entrada'), 1, '5 · una sola entrada al kardex tras registrar dos veces');
SELECT public.chk_num((SELECT cantidad FROM public.movimientos_suministro WHERE suministro_id = :SA::uuid AND tipo = 'entrada'), 40, '5 · la entrada es de 40');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OI::uuid), 'recibida_parcial', '5 · la orden queda recibida parcial');

-- La unicidad la sostiene la BASE, no solo el trigger: un segundo intento directo se rechaza
SELECT public.chk_falla($$ INSERT INTO public.movimientos_suministro (company_id, suministro_id, tipo, cantidad, motivo, origen_tabla, origen_id)
  SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', '0c5a0000-0000-0000-0000-000000000001', 'entrada', 40, 'duplicado a mano', 'recepcion_lineas', rl.id
    FROM public.recepcion_lineas rl WHERE rl.recepcion_id = '0c520000-0000-0000-0000-000000000001' $$,
  'uq_mov_suministro_origen_recepcion', '5 · una segunda entrada por el mismo renglón de recepción lo impide el índice único');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :SA::uuid), 40, '5 · y el stock no cambió');

-- ── 6. Conciliación inventario ↔ contabilidad (recepción parcial) ───────────
-- Lo aceptado × costo = lo que entra al kardex = lo que se debita a Inventario (1106) en el asiento de la recepción.
SELECT public.chk_num((SELECT sum(m.cantidad * m.costo_unitario) FROM public.movimientos_suministro m WHERE m.suministro_id = :SA::uuid AND m.tipo = 'entrada'), 400, '6 · kardex valorizado = 40 × 10 = 400');
SELECT public.chk_num((SELECT coalesce(sum(al.debe - al.haber), 0)
                         FROM public.conta_asientos a
                         JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
                         JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
                        WHERE a.origen_tabla = 'recepciones' AND a.origen_id = :R1::uuid AND cu.codigo = '1106'),
                      400, '6 · el asiento de la recepción debita Inventario (1106) por 400: coincide con el kardex');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = :R1::uuid), 1, '6 · un solo asiento por la recepción');

-- ── 7. Completar la recepción: el resto entra, nada se duplica ──────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (:R2::uuid, :C::uuid, :C1::uuid, :OI::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario)
VALUES (:C::uuid, :R2::uuid, :I1::uuid, 60, 10);
SELECT public.como(:UA::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = :R2::uuid;
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :SA::uuid), 100, '7 · el stock llega a 100 con la segunda recepción');
SELECT public.chk_num((SELECT sum(cantidad) FROM public.movimientos_suministro WHERE suministro_id = :SA::uuid AND tipo = 'entrada'), 100, '7 · entradas acumuladas = lo aceptado en total (100)');
SELECT public.chk_num((SELECT sum(rl.cantidad) FROM public.recepcion_lineas rl JOIN public.recepciones r ON r.id = rl.recepcion_id WHERE r.orden_compra_id = :OI::uuid AND r.estado = 'registrada' AND rl.orden_compra_linea_id = :I1::uuid),
                      (SELECT sum(cantidad) FROM public.movimientos_suministro WHERE suministro_id = :SA::uuid AND tipo = 'entrada'), '7 · lo aceptado en recepciones = lo entrado al kardex');

-- ── 8. Anular una recepción compensa con UNA salida (y no se repite) ────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'anulada' WHERE id = :R2::uuid;
UPDATE public.recepciones SET estado = 'anulada' WHERE id = :R2::uuid;
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :SA::uuid), 40, '8 · anular la segunda recepción devuelve el stock a 40');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE suministro_id = :SA::uuid AND tipo = 'salida' AND origen_tabla = 'recepcion_lineas_anulada'), 1, '8 · una sola salida compensatoria');
SELECT public.chk_num((SELECT coalesce(sum(al.debe - al.haber), 0)
                         FROM public.conta_asientos a
                         JOIN public.conta_asiento_lineas al ON al.asiento_id = a.id
                         JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
                        WHERE a.origen_tabla IN ('recepciones', 'recepciones_anulacion') AND a.company_id = :C::uuid AND cu.codigo = '1106'
                          AND a.project_id = :C1::uuid AND a.origen_id IN (:R1::uuid, :R2::uuid)),
                      400, '8 · la contabilidad de inventario (1106) también queda en 400: coincide con el stock valorizado');
