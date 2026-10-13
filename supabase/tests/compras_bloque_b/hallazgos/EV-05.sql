\set ON_ERROR_STOP on
-- ============================================================================
-- [EV-05] Los importes de una orden (subtotal, IVA, total), su revisión y sus motivos
-- no los escribe el cliente.
--
-- HALLAZGO  Total, subtotal, IVA y sellos de tiempo de una orden aprobada/emitida/cerrada se
--           reescriben con UPDATE directo, sin evento «modificacion». El total es el que usan
--           los compromisos, el límite del contrato y el seguimiento.
-- CAUSA     subtotal / iva_monto / total son derivados de los renglones, pero la tabla los
--           dejaba escribir: (1) UPDATE sobre una orden aprobada/emitida/cerrada; (2) UPDATE sobre
--           un BORRADOR y luego aprobar (el candado del contrato lee el total forjado: con un
--           tope de 1 000 y renglones por 5 000, la orden se aprobaba con total = 1); (3) INSERT
--           con total y sin renglones, o borrar el último renglón (el trigger de totales no
--           recalcula con cero renglones). `revision`, `motivo_anulacion` y `motivo_devolucion`
--           también se reescribían fuera del paso que los produce.
-- ESPERADO  Fuera de borrador los importes no cambian (error explícito); en borrador el cliente
--           no los escribe (se sustituyen por la suma de los renglones); al aprobar se derivan de
--           los renglones; la revisión y los motivos solo cambian en su paso. Los caminos
--           legítimos (crear con renglones, editar renglones del borrador, devolver y aprobar de
--           nuevo, recibir, facturar, cancelar con motivo, mantenimiento sin sesión) siguen.
-- DEPENDE   la migración 20261027000800 (pieza EV-05) y la migración 20261027000800 (pieza EV-06) (la parte de `emitida_at`).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- ── a · Orden emitida de 1 120 (1 000 + IVA 120) ────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa405001-0000-0000-0000-000000000001', 'fa405101-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 120);
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'fa405001-0000-0000-0000-000000000001'), 1120,
  '[EV-05a] preparación: la orden emitida vale 1 120');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'fa405001-0000-0000-0000-000000000001'), 3,
  '[EV-05a] preparación: tres eventos de estado (borrador, aprobada, emitida)');

-- UC solo tiene ver/crear/editar/eliminar: no aprueba ni cambia estado.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET total = 1 WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_IMPORTES_INMUTABLES', '[EV-05a] el total de una orden emitida no se reescribe');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET subtotal = 1 WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_IMPORTES_INMUTABLES', '[EV-05a] ni el subtotal');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET iva_monto = 0 WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_IMPORTES_INMUTABLES', '[EV-05a] ni el IVA');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET total = 1, subtotal = 1, iva_monto = 0 WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_IMPORTES_INMUTABLES', '[EV-05a] ni los tres a la vez (la reproducción del hallazgo)');
-- Reenviar el mismo valor (una pantalla que reenvía la fila) no es un cambio.
UPDATE public.ordenes_compra SET total = 1120, subtotal = 1000, iva_monto = 120, concepto = concepto WHERE id = 'fa405001-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT subtotal || '/' || iva_monto || '/' || total FROM public.ordenes_compra WHERE id = 'fa405001-0000-0000-0000-000000000001'),
  '1000.00/120.00/1120.00', '[EV-05a] los importes siguen siendo la suma de los renglones');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = 'fa405001-0000-0000-0000-000000000001'), 3,
  '[EV-05a] y no se coló ningún evento ni cambio sin rastro');

-- ── b · Sellos de tiempo, revisión y motivos de la misma orden (emitida) ────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET emitida_at = '2020-01-01' WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[EV-05b] la fecha de emisión no se reescribe');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET revision = 9 WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_REVISION_SISTEMA', '[EV-05b] la revisión solo la mueve la devolución a borrador: no se inventa una');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET motivo_anulacion = 'x' WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_MOTIVO_INMUTABLE', '[EV-05b] un motivo de anulación no se escribe sin cancelar');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET motivo_devolucion = 'x' WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_MOTIVO_INMUTABLE', '[EV-05b] ni un motivo de devolución sin devolver');
RESET ROLE;
SELECT public.chk_bool((SELECT revision = 0 AND motivo_anulacion IS NULL AND motivo_devolucion IS NULL AND emitida_at > now() - interval '1 hour'
                          FROM public.ordenes_compra WHERE id = 'fa405001-0000-0000-0000-000000000001'), true,
  '[EV-05b] revisión, motivos y fecha de emisión intactos');

-- ── c · Borrador: el cliente no escribe los importes (INSERT ni UPDATE) ─────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, subtotal, iva_monto, total, revision, motivo_anulacion, motivo_devolucion)
VALUES ('fa405002-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'borrador con importes forjados', 5000, 555, 5555, 3, 'm1', 'm2');
RESET ROLE;
SELECT public.chk_txt((SELECT subtotal || '/' || iva_monto || '/' || total || '/' || revision || '/' || COALESCE(motivo_anulacion, '-') || '/' || COALESCE(motivo_devolucion, '-')
                         FROM public.ordenes_compra WHERE id = 'fa405002-0000-0000-0000-000000000001'),
  '0.00/0.00/0.00/0/-/-', '[EV-05c] una orden nace con importes 0, revisión 0 y sin motivos (lo mandado en el INSERT no cuenta)');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
VALUES ('fa405102-0000-0000-0000-000000000001', :C::uuid, 'fa405002-0000-0000-0000-000000000001', 1, 'Renglón', 'servicio', 'servicios', 10, 'servicio', 100, 120);
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'fa405002-0000-0000-0000-000000000001'), 1120,
  '[EV-05c] camino legítimo: el renglón fija el total de la orden');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET total = 1, subtotal = 1, iva_monto = 0 WHERE id = 'fa405002-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'fa405002-0000-0000-0000-000000000001'), 1120,
  '[EV-05c] en borrador, un total escrito a mano se sustituye por la suma de los renglones');
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada', total = 1, subtotal = 1, iva_monto = 0 WHERE id = 'fa405002-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || total FROM public.ordenes_compra WHERE id = 'fa405002-0000-0000-0000-000000000001'),
  'aprobada/1120.00', '[EV-05c] aprobar con un total forjado en el mismo UPDATE deja el total de los renglones');

-- ── d · El límite del contrato se calcula con el total REAL ─────────────────
-- Contrato con tope 1 000; la orden tiene renglones por 5 000 (50 × 100).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda, importe_periodico, monto_maximo, responsable_id)
VALUES ('fa405501-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'FA4-05-K1', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 1000, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'fa405501-0000-0000-0000-000000000001';
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id, moneda)
VALUES ('fa405003-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'bajo contrato con tope 1 000', 'fa405501-0000-0000-0000-000000000001', 'GTQ');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('fa405103-0000-0000-0000-000000000001', :C::uuid, 'fa405003-0000-0000-0000-000000000001', 1, 'Renglón de 5 000', 'servicio', 'servicios', 50, 'servicio', 100);
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET total = 1, subtotal = 1 WHERE id = 'fa405003-0000-0000-0000-000000000001';     -- el contador «ajusta» el total del borrador
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa405003-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '[EV-05d] con un total forjado de 1 la orden de 5 000 NO se aprueba al amparo de un contrato de 1 000');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || total FROM public.ordenes_compra WHERE id = 'fa405003-0000-0000-0000-000000000001'),
  'borrador/5000.00', '[EV-05d] la orden sigue en borrador con el total real (5 000)');

-- ── e · Sin renglones no se compromete nada ─────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa405004-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'se quedó sin renglones');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('fa405104-0000-0000-0000-000000000001', :C::uuid, 'fa405004-0000-0000-0000-000000000001', 1, 'Renglón', 'servicio', 'servicios', 10, 'servicio', 100);
DELETE FROM public.orden_compra_lineas WHERE id = 'fa405104-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa405004-0000-0000-0000-000000000001';
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, total, subtotal)
VALUES ('fa405005-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'nace aprobada con total forjado', 'aprobada', 5555, 5555);
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'fa405004-0000-0000-0000-000000000001'), 0,
  '[EV-05e] una orden aprobada tras borrar su último renglón no arrastra el total viejo');
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'fa405005-0000-0000-0000-000000000001'), 0,
  '[EV-05e] una orden que nace aprobada (0700) compromete 0, no el total que mande el cliente');

-- ── f · Crear por el RPC y editar el borrador: los totales siguen a los renglones ──
CREATE TEMP TABLE ev05f (k text PRIMARY KEY, v text);
GRANT ALL ON ev05f TO authenticated;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO ev05f
SELECT 'oc', (public.compras_orden_crear(:C::uuid, :C1::uuid,
  jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001', 'concepto', 'Orden creada por el RPC', 'clave_idempotencia', 'fa4-05-clave-0001'),
  jsonb_build_array(
    jsonb_build_object('descripcion', 'Renglón uno', 'destino_tipo', 'servicio', 'categoria', 'servicios', 'cantidad', 2, 'unidad', 'servicio', 'precio_unitario', 50, 'iva_monto', 12),
    jsonb_build_object('descripcion', 'Renglón dos', 'destino_tipo', 'servicio', 'categoria', 'servicios', 'cantidad', 1, 'unidad', 'servicio', 'precio_unitario', 200, 'iva_monto', 24))
  ))->'orden'->>'id';
RESET ROLE;
SELECT public.chk_txt((SELECT subtotal || '/' || iva_monto || '/' || total FROM public.ordenes_compra WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc')),
  '300.00/36.00/336.00', '[EV-05f] el RPC de creación deja los totales de sus renglones');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET precio_unitario = 60 WHERE orden_compra_id = (SELECT v::uuid FROM ev05f WHERE k = 'oc') AND linea = 1;
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
VALUES (:C::uuid, (SELECT v::uuid FROM ev05f WHERE k = 'oc'), 3, 'Renglón tres', 'servicio', 'servicios', 1, 'servicio', 100, 0);
UPDATE public.ordenes_compra SET concepto = 'Orden creada por el RPC (editada)' WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc');
RESET ROLE;
SELECT public.chk_txt((SELECT subtotal || '/' || iva_monto || '/' || total FROM public.ordenes_compra WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc')),
  '420.00/36.00/456.00', '[EV-05f] editar un precio, añadir un renglón y editar la cabecera: el total sigue a los renglones');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
DELETE FROM public.orden_compra_lineas WHERE orden_compra_id = (SELECT v::uuid FROM ev05f WHERE k = 'oc') AND linea = 3;
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc')), 356,
  '[EV-05f] y borrar un renglón (con otros) lo recalcula');

-- ── g · Devolver a borrador y aprobar de nuevo: revisión + 1, con evento ────
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc');
UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'El precio del renglón uno se pactó en 70' WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET revision = 0 WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc') $$,
  'COMPRAS_OC_REVISION_SISTEMA', '[EV-05g] una orden devuelta no «limpia» su revisión a mano');
UPDATE public.orden_compra_lineas SET precio_unitario = 70 WHERE orden_compra_id = (SELECT v::uuid FROM ev05f WHERE k = 'oc') AND linea = 1;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || revision || '/' || total || '/' || motivo_devolucion FROM public.ordenes_compra WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc')),
  'aprobada/1/376.00/El precio del renglón uno se pactó en 70', '[EV-05g] devolver, corregir el renglón y re-aprobar: revisión 1 y total nuevo (376)');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = (SELECT v::uuid FROM ev05f WHERE k = 'oc') AND tipo = 'devolucion'), 1,
  '[EV-05g] la devolución dejó su evento');

-- ── h · Cancelar con motivo; el motivo no se reescribe después ─────────────
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'Se canceló el pedido' WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc');
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET motivo_anulacion = 'Otro motivo' WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc') $$,
  'COMPRAS_OC_MOTIVO_INMUTABLE', '[EV-05h] el motivo de una cancelación no se reescribe');
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || motivo_anulacion FROM public.ordenes_compra WHERE id = (SELECT v::uuid FROM ev05f WHERE k = 'oc')),
  'cancelada/Se canceló el pedido', '[EV-05h] cancelar con motivo funciona y el motivo se conserva');

-- ── i · El camino de los triggers de sistema (recibir, facturar, cerrar) no se rompe ──
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('fa405201-0000-0000-0000-000000000001', 'fa405001-0000-0000-0000-000000000001', 'fa405101-0000-0000-0000-000000000001', 10, 'servicio');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa405201-0000-0000-0000-000000000001';
SELECT public.ce_factura('fa405301-0000-0000-0000-000000000001', 'fa405001-0000-0000-0000-000000000001', 'fa405101-0000-0000-0000-000000000001', :P1::uuid, 'FA4-05-0001', 10, 100, 120);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa405301-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado || '/' || subtotal || '/' || iva_monto || '/' || total FROM public.ordenes_compra WHERE id = 'fa405001-0000-0000-0000-000000000001'),
  'cerrada/1000.00/120.00/1120.00', '[EV-05i] recibir y facturar cierran la orden sola (camino del sistema) y el total sigue en 1 120');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET total = 1 WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_IMPORTES_INMUTABLES', '[EV-05i] la orden cerrada tampoco admite reescribir el total (la reproducción original del hallazgo)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET emitida_at = '2020-01-01', revision = 0, motivo_anulacion = 'x' WHERE id = 'fa405001-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO|COMPRAS_OC_REVISION_SISTEMA|COMPRAS_OC_MOTIVO_INMUTABLE', '[EV-05i] ni su emitida_at, revisión y motivo (la reproducción original del hallazgo)');
RESET ROLE;

-- ── j · Mantenimiento sin sesión de usuario (service_role, DBA): no se bloquea ──
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.ordenes_compra SET total = 1121 WHERE id = 'fa405001-0000-0000-0000-000000000001';
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = 'fa405001-0000-0000-0000-000000000001'), 1121,
  '[EV-05j] sin sesión de usuario (mantenimiento) la corrección de un importe sigue siendo posible');
UPDATE public.ordenes_compra SET total = 1120 WHERE id = 'fa405001-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
