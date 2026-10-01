\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CICLO DE LA ORDEN VALIDADO EN SERVIDOR (migración 20261021000000)
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set P3  '''e3000000-0000-0000-0000-000000000003'''
\set O1  '''0b000000-0000-0000-0000-000000000001'''
\set O2  '''0b000000-0000-0000-0000-000000000002'''
\set O3  '''0b000000-0000-0000-0000-000000000003'''

-- ── 1. El OPERADOR solicita: el solicitante lo fija el servidor ─────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
-- Intenta capturarla a nombre de OTRA persona: el servidor lo ignora.
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, created_by)
VALUES (:O1::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Compra solicitada por operaciones', :UA::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES (:C::uuid, :O1::uuid, 1, 'Material', 'gasto', 'mantenimiento', 10, 100);
RESET ROLE;
SELECT public.chk_uuid((SELECT created_by FROM public.ordenes_compra WHERE id = :O1::uuid), :UO::uuid,
  '1 · el solicitante es quien captura (UO), aunque el cliente mande a otro');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :O1::uuid), 'borrador', '1 · nace en borrador');

-- ── 2. Sin permiso no se aprueba (RLS: el operador no actualiza) ────────────
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :O1::uuid), 'borrador',
  '2 · un usuario SIN permiso de edición no aprueba (la orden sigue en borrador)');

-- ── 3. Aprobador autorizado ─────────────────────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :O1::uuid), 'aprobada', '3 · el aprobador autorizado aprueba');
SELECT public.chk_bool((SELECT numero IS NOT NULL AND aprobada_por = :UA::uuid AND aprobada_at IS NOT NULL
                          FROM public.ordenes_compra WHERE id = :O1::uuid),
  true, '3 · queda numerada y sellada con aprobador y fecha');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = :O1::uuid AND estado_nuevo = 'aprobada' AND actor_id = :UA::uuid), 1,
  '3 · el historial registra quién aprobó');

-- ── 4. Transiciones inválidas, rechazadas en servidor ───────────────────────
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:O2::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Para saltarse la aprobación');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0b000000-0000-0000-0000-000000000002' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA', '4 · borrador → emitida (saltarse la aprobación): RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'recibida' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_RECIBIDA_MANUAL', '4 · aprobada → recibida a mano: RECHAZADO (la recepción es lo que recibe)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'cerrada' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA', '4 · aprobada → cerrada: RECHAZADO');
RESET ROLE;

-- ── 5. Aprobada es documento congelado ──────────────────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '5 · cambiar el proveedor de una orden aprobada: RECHAZADO (no hay cambios silenciosos)');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET moneda = 'USD' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '5 · cambiar la moneda: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET condiciones_pago = 'Contado' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_APROBADA_CAMBIO', '5 · cambiar las condiciones de pago: RECHAZADO');
UPDATE public.ordenes_compra SET notas = 'Nota operativa' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT notas FROM public.ordenes_compra WHERE id = :O1::uuid), 'Nota operativa',
  '5 · lo que no es condición de la compra (notas) sí se puede anotar');

-- ── 6. Devolver = invalidar la aprobación (revisión), con motivo ────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'borrador' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_DEVOLUCION_MOTIVO', '6 · devolver sin motivo: RECHAZADO');
UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'Cambió el proveedor acordado'
 WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'borrador' AND aprobada_por IS NULL AND aprobada_at IS NULL AND revision = 1
                          FROM public.ordenes_compra WHERE id = :O1::uuid),
  true, '6 · devuelta: vuelve a borrador, la aprobación queda INVALIDADA y sube la revisión');
SELECT public.chk_txt((SELECT motivo FROM public.orden_compra_eventos WHERE orden_compra_id = :O1::uuid AND tipo = 'devolucion'),
  'Cambió el proveedor acordado', '6 · el motivo y la devolución quedan en el historial');
-- Ahora sí se edita la cabecera (es una revisión) y se vuelve a aprobar.
SET ROLE authenticated;
UPDATE public.ordenes_compra SET proveedor_id = :P2::uuid, proveedor_nombre = 'Servicios Bloque B' WHERE id = :O1::uuid;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_bool((SELECT estado = 'aprobada' AND proveedor_id = :P2::uuid AND aprobada_at IS NOT NULL AND revision = 1
                          FROM public.ordenes_compra WHERE id = :O1::uuid),
  true, '6 · devuelta, editada y reaprobada: la nueva aprobación vale para lo nuevo');
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'Cambió el proveedor acordado' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_DEVOLUCION_MOTIVO', '6 · un motivo repetido no sirve: cada devolución trae el suyo');
RESET ROLE;

-- ── 7. Emitir y lo que ya no se puede hacer después ─────────────────────────
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = :O1::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'x' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA', '7 · una orden EMITIDA no se reabre a borrador');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'recibida' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_RECIBIDA_MANUAL', '7 · emitida → recibida a mano (lo que hacía «Marcar recibida»): RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA', '7 · emitida → aprobada: RECHAZADO');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET created_by = 'c0c0c0c0-0000-0000-0000-00000000000b' WHERE id = '0b000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_SOLICITANTE_INMUTABLE', '7 · el solicitante no se reasigna');
RESET ROLE;

-- ── 8. Proveedor suspendido ENTRE aprobación y emisión ──────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:O3::uuid, :C::uuid, :C1::uuid, :P3::uuid, 'Proveedor a suspender', 'Se suspende tras aprobar');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES (:C::uuid, :O3::uuid, 1, 'Material', 'gasto', 'mantenimiento', 1, 50);
SELECT public.como(:UB::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :O3::uuid;
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :P3::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0b000000-0000-0000-0000-000000000003' $$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO', '8 · aprobar → suspender al proveedor → emitir: BLOQUEADO');
-- …pero resolver lo anterior sí: cancelarla.
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'Proveedor suspendido' WHERE id = :O3::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :O3::uuid), 'cancelada',
  '8 · con el proveedor suspendido SÍ se puede cancelar la orden (historial conservado)');
SELECT public.chk_txt((SELECT motivo FROM public.orden_compra_eventos WHERE orden_compra_id = :O3::uuid AND estado_nuevo = 'cancelada'),
  'Proveedor suspendido', '8 · y el motivo de la cancelación queda en el historial');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0b000000-0000-0000-0000-000000000003' $$,
  'COMPRAS_OC_INMUTABLE|COMPRAS_OC_TRANSICION_INVALIDA', '8 · una cancelada no se reabre');

-- ── 9. Separación solicitante / aprobador (configurable, apagada por defecto) ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0b000000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Capturada y aprobada por la misma persona');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES (:C::uuid, '0b000000-0000-0000-0000-000000000004', 1, 'Material', 'gasto', 'mantenimiento', 1, 10);
-- Por defecto NO se exige separación (no hay decisión de negocio que la imponga).
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0b000000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0b000000-0000-0000-0000-000000000004'), 'aprobada',
  '9 · por defecto (sin decisión de negocio) quien captura puede aprobar: el comportamiento de hoy no cambia');

INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0b000000-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Con separación activada');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES (:C::uuid, '0b000000-0000-0000-0000-000000000005', 1, 'Material', 'gasto', 'mantenimiento', 1, 10);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0b000000-0000-0000-0000-000000000005' $$,
  'COMPRAS_OC_AUTOAPROBACION', '9 · con la separación activada, el solicitante NO aprueba lo suyo');
SELECT public.como(:UB::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0b000000-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = '0b000000-0000-0000-0000-000000000005'), :UB::uuid,
  '9 · otra persona autorizada sí la aprueba, y queda como aprobador');
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;

-- ── 10. El historial es solo de lectura y respeta el aislamiento ────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_eventos (company_id, orden_compra_id, tipo) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','0b000000-0000-0000-0000-000000000001','estado') $$,
  'permission denied', '10 · nadie escribe el historial desde la aplicación');
SELECT public.chk_falla($$ UPDATE public.orden_compra_eventos SET motivo = 'x' $$, 'permission denied', '10 · ni lo modifica');
SELECT public.chk_falla($$ DELETE FROM public.orden_compra_eventos $$, 'permission denied', '10 · ni lo borra');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos), 0, '10 · otra empresa no ve el historial de C');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra), 0, '10 · ni las órdenes de C');
UPDATE public.ordenes_compra SET notas = 'intruso' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_bool((SELECT notas IS DISTINCT FROM 'intruso' FROM public.ordenes_compra WHERE id = :O1::uuid), true,
  '10 · y no modifica órdenes ajenas');
