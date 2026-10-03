\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · RECEPCIÓN POR LÍNEA, SERVICIOS, ACTIVOS E INVENTARIO
-- (migración 20261021000100) sobre el motor de Fase 6.
-- Orden OS (C1, P1): L1 inventario (Cloro) 100 × 10 · L2 activo fijo (Bomba)
-- 2 × 500 · L3 servicio (Mantenimiento) 1 × 300.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set S1  '''50000000-0000-0000-0000-0000000000c1'''
\set OS  '''0b100000-0000-0000-0000-000000000001'''
\set L1  '''0b110000-0000-0000-0000-000000000001'''
\set L2  '''0b110000-0000-0000-0000-000000000002'''
\set L3  '''0b110000-0000-0000-0000-000000000003'''

-- ── Preparación: el operador solicita, el admin aprueba y emite ─────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES (:OS::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Cloro, bomba y mantenimiento');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  (:L1::uuid, :C::uuid, :OS::uuid, 1, 'Cloro industrial', 'inventario',  :S1::uuid, 'limpieza',      100, 'litro',  10,  120),
  (:L2::uuid, :C::uuid, :OS::uuid, 2, 'Bomba de agua',    'activo_fijo', NULL,      'mantenimiento',   2, 'unidad', 500, 120),
  (:L3::uuid, :C::uuid, :OS::uuid, 3, 'Mantenimiento mensual', 'servicio', NULL,    'mantenimiento',   1, 'servicio', 300, 36);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :OS::uuid;
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = :OS::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OS::uuid), 'emitida', '0 · la orden está emitida al proveedor');

-- ── 1. Recepción PARCIAL de bienes: aceptado, rechazado, destino físico ─────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, destino_fisico, documento_referencia, clave_idempotencia)
VALUES ('0b200000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :OS::uuid, 'bienes', 'Bodega general', 'REM-0001', 'intento-001');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada, motivo_rechazo) VALUES
  (:C::uuid, '0b200000-0000-0000-0000-000000000001', :L1::uuid, 40, 5, 'Envases dañados'),
  (:C::uuid, '0b200000-0000-0000-0000-000000000001', :L2::uuid,  1, 0, NULL);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones'), 0,
  '1 · capturar la recepción (borrador) NO contabiliza ni mueve nada');

-- Un rechazo sin motivo no se acepta.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','0b200000-0000-0000-0000-000000000001','0b110000-0000-0000-0000-000000000003', 1, 2) $$,
  'recepcion_lineas_motivo_check', '1 · una cantidad rechazada exige motivo');
RESET ROLE;

-- Quien NO tiene permiso de edición no registra (y por tanto no contabiliza).
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = '0b200000-0000-0000-0000-000000000001'), 'borrador',
  '1 · un usuario sin permisos NO registra la recepción');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OS::uuid), 'recibida_parcial', '1 · la orden pasa a recibida parcial');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = :L1::uuid), 40,
  '1 · recibido = lo ACEPTADO (40); lo rechazado (5) no cuenta como recibido');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), 40, '1 · el inventario sube solo por lo aceptado');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0b200000-0000-0000-0000-000000000001')), 1,
  '1 · el equipo recibido da de alta UN activo (1 unidad aceptada)');
SELECT public.chk_bool((SELECT total_debe = 900 AND total_haber = 900 FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = '0b200000-0000-0000-0000-000000000001' AND origen_evento = 'recepcion_registrada'),
  true, '1 · asiento GR/IR cuadrado por lo ACEPTADO: 400 inventario + 500 activo = 900 contra «por facturar»');
SELECT public.chk_bool((SELECT string_agg(codigo, ',' ORDER BY codigo) = '1106,1401,2105'
                          FROM (SELECT DISTINCT c.codigo FROM public.conta_asientos a
                                  JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
                                  JOIN public.conta_cuentas c ON c.id = l.cuenta_id
                                 WHERE a.origen_tabla = 'recepciones' AND a.origen_id = '0b200000-0000-0000-0000-000000000001') x),
  true, '1 · las cuentas salen de la configuración (1106 inventario, 1401 activo fijo, 2105 por facturar), sin códigos fijos en la regla');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE origen_tabla = 'recepcion_lineas'), 1,
  '1 · una entrada al kardex, ligada a la línea de recepción');

-- ── 2. Doble clic / reintento: nada se duplica ──────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000001';
SELECT public.chk_falla($$ INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, clave_idempotencia)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','0b100000-0000-0000-0000-000000000001','bienes','intento-001') $$,
  'uq_recepciones_clave', '2 · el mismo intento de captura (misma clave) NO crea un segundo borrador');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = '0b200000-0000-0000-0000-000000000001'), 1,
  '2 · registrar dos veces la misma recepción no duplica el asiento');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), 40, '2 · ni las existencias');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0b200000-0000-0000-0000-000000000001')), 1,
  '2 · ni los activos');

-- ── 3. Servicio: conformidad, sin entrada ficticia a bodega ─────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
-- Una recepción de BIENES no admite líneas de servicio.
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0b200000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :OS::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0b200000-0000-0000-0000-000000000002', :L3::uuid, 1);
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000002' $$,
  'COMPRAS_SERVICIO_SIN_CONFORMIDAD', '3 · un servicio NO se recibe como un bien: exige conformidad de servicio');
RESET ROLE;
-- Conformidad de servicio, con responsable. El respaldo ya NO se declara al crear (una ruta sin archivo
-- registrado se rechaza: ver assert_correcciones_c.sql); se adjunta después con compras_recepcion_adjuntar.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por, notas)
VALUES ('0b200000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :OS::uuid, 'servicio', :UC::uuid,
        'Hito: mantenimiento de octubre');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0b200000-0000-0000-0000-000000000003', :L3::uuid, 1);
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0b200000-0000-0000-0000-000000000003', :L2::uuid, 1) ON CONFLICT DO NOTHING;
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000003' $$,
  'COMPRAS_CONFORMIDAD_SOLO_SERVICIOS', '3 · una conformidad de servicio NO admite líneas de bienes');
DELETE FROM public.recepcion_lineas WHERE recepcion_id = '0b200000-0000-0000-0000-000000000003' AND orden_compra_linea_id = :L2::uuid;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = '0b200000-0000-0000-0000-000000000003'), 'registrada', '3 · la conformidad se registra');
SELECT public.chk_uuid((SELECT recibido_por FROM public.recepciones WHERE id = '0b200000-0000-0000-0000-000000000003'), :UC::uuid,
  '3 · con el responsable que confirma la prestación');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE origen_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0b200000-0000-0000-0000-000000000003')), 0,
  '3 · un servicio NO mueve inventario');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = '0b200000-0000-0000-0000-000000000003')), 0,
  '3 · ni da de alta activos');
SELECT public.chk_bool((SELECT total_debe = 300 AND total_haber = 300 FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = '0b200000-0000-0000-0000-000000000003'),
  true, '3 · el servicio aceptado se devenga (300) contra «por facturar», con la misma política de siempre');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = :L3::uuid), 1, '3 · la línea de servicio queda cumplida');

-- ── 4. Sobre-recepción cortada, también en concurrencia secuencial ──────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0b200000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :OS::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0b200000-0000-0000-0000-000000000004', :L1::uuid, 70);
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000004' $$,
  'COMPRAS_SOBRE_RECEPCION', '4 · recibir más de lo pedido (40 + 70 > 100): CORTADO');
RESET ROLE;
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), 40, '4 · y no se movió nada');

-- ── 5. Recepción FINAL: se completa y la orden queda recibida ───────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepcion_lineas SET cantidad = 60 WHERE recepcion_id = '0b200000-0000-0000-0000-000000000004';
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0b200000-0000-0000-0000-000000000004', :L2::uuid, 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OS::uuid), 'recibida', '5 · con todo aceptado la orden queda RECIBIDA');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), 100, '5 · existencias: 40 + 60 = 100');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE proveedor_id = :P1::uuid), 2, '5 · dos activos en total (uno por unidad)');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = :OS::uuid AND origen = 'sistema'), 2,
  '5 · el historial registra las dos transiciones hechas por las recepciones (origen sistema)');

-- ── 6. Una entrega totalmente RECHAZADA también queda registrada ────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0b100000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Entrega rechazada');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
VALUES ('0b110000-0000-0000-0000-000000000010', :C::uuid, '0b100000-0000-0000-0000-000000000002', 1, 'Tubería', 'gasto', 'mantenimiento', 10, 20);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0b100000-0000-0000-0000-000000000002';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0b100000-0000-0000-0000-000000000002';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0b200000-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, '0b100000-0000-0000-0000-000000000002', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada, motivo_rechazo)
VALUES (:C::uuid, '0b200000-0000-0000-0000-000000000005', '0b110000-0000-0000-0000-000000000010', 0, 10, 'No cumple la especificación');
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0b200000-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = '0b200000-0000-0000-0000-000000000005'), 'registrada',
  '6 · la entrega 100 % rechazada se registra (queda constancia y motivo)');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = '0b110000-0000-0000-0000-000000000010'), 0,
  '6 · y no cuenta como recibida: el pendiente sigue siendo 10');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = '0b200000-0000-0000-0000-000000000005'), 0,
  '6 · y no contabiliza nada');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0b100000-0000-0000-0000-000000000002'), 'emitida',
  '6 · la orden sigue EMITIDA: no se recibió nada');

-- ── 7. Cancelar una emitida CON recepciones se bloquea; sin ellas, no ───────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'x' WHERE id = '0b100000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_TRANSICION_INVALIDA|COMPRAS_OC_CANCELAR_CON_RECEPCION', '7 · una orden ya recibida no se cancela (se cierra)');
RESET ROLE;

-- ── 8. Aislamiento: otra empresa no ve ni registra nada ─────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.recepciones), 0, '8 · otra empresa no ve las recepciones de C');
SELECT public.chk((SELECT count(*) FROM public.recepcion_lineas), 0, '8 · ni sus líneas');
SELECT public.chk_falla($$ INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo)
                           VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','0b100000-0000-0000-0000-000000000001','bienes') $$,
  'row-level security|violates|COMPRAS|foreign key', '8 · ni crea una recepción contra una orden de C');
RESET ROLE;
