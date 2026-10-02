\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · EMITIR REVALIDA AL PASAR DE APROBADA A EMITIDA · PRÓRROGAS DE
-- CONTRATOS (ampliación vs reducción; «indefinido» amplía)
-- Proveedores propios de este bloque (no dependen de lo que dejaron los otros).
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set E1    '''e1000000-0000-0000-0000-0000000000e1'''
\set E2    '''e1000000-0000-0000-0000-0000000000e2'''
\set E3    '''e1000000-0000-0000-0000-0000000000e3'''
\set E4    '''e1000000-0000-0000-0000-0000000000e4'''
\set K1    '''e1000000-0000-0000-0000-0000000000f1'''
\set K2    '''e1000000-0000-0000-0000-0000000000f2'''

SELECT public.como(:UA::uuid);

-- ── Proveedores del bloque: alta (superusuario, sin atajos de estado), luego
--    autorización y habilitación POR LAS VÍAS NORMALES (admin con permiso) ──────
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  (:E1::uuid, :A::uuid, 'Emisión Uno',  '7010001-1', 'GT', 'proyectos'),
  (:E2::uuid, :A::uuid, 'Emisión Dos',  '7010002-2', 'GT', 'proyectos'),
  (:E3::uuid, :A::uuid, 'Emisión Tres', '7010003-3', 'GT', 'proyectos'),
  (:E4::uuid, :A::uuid, 'Emisión Cuatro', '7010004-4', 'GT', 'empresa'),
  (:K1::uuid, :A::uuid, 'Prórroga Empresa', '7020001-1', 'GT', 'empresa'),
  (:K2::uuid, :A::uuid, 'Prórroga Proyecto', '7020002-2', 'GT', 'proyectos');
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado'
 WHERE id IN (:E1::uuid, :E2::uuid, :E3::uuid, :E4::uuid, :K1::uuid, :K2::uuid);
INSERT INTO public.proveedor_proyectos (company_id, proveedor_id, project_id) VALUES
  (:A::uuid, :E1::uuid, :A1::uuid), (:A::uuid, :E2::uuid, :A1::uuid), (:A::uuid, :E3::uuid, :A1::uuid),
  (:A::uuid, :K2::uuid, :A1::uuid), (:A::uuid, :K1::uuid, :A1::uuid);
UPDATE public.proveedor_proyectos SET estado = 'habilitado'
 WHERE proveedor_id IN (:E1::uuid, :E2::uuid, :E3::uuid, :K2::uuid) AND project_id = :A1::uuid;
RESET ROLE;

-- ════════════════════════ 1 · EMITIR REVALIDA ════════════════════════════════
-- Una orden por caso, todas aprobadas con el proveedor en regla.
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado) VALUES
  ('0e000000-0000-0000-0000-000000000001', :A::uuid, :A1::uuid, :E1::uuid, 'Emisión Uno',  'Caso suspensión general', 'aprobada'),
  ('0e000000-0000-0000-0000-000000000002', :A::uuid, :A1::uuid, :E2::uuid, 'Emisión Dos',  'Caso habilitación suspendida', 'aprobada'),
  ('0e000000-0000-0000-0000-000000000003', :A::uuid, :A1::uuid, :E3::uuid, 'Emisión Tres', 'Caso habilitación retirada', 'aprobada'),
  ('0e000000-0000-0000-0000-000000000004', :A::uuid, :A1::uuid, :E4::uuid, 'Emisión Cuatro', 'Caso autorizado', 'aprobada');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id::text LIKE '0e000000-%' AND estado = 'aprobada'), 4,
  '1 · las cuatro órdenes se aprobaron con el proveedor en regla');

-- (a) Suspensión GENERAL posterior a la aprobación → no se emite.
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Incumplimiento' WHERE id = :E1::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000001' $$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO', '1a · aprobar → suspender al proveedor → emitir: BLOQUEADO');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000001'),
  'aprobada', '1a · la orden sigue aprobada: nada se borró ni se reescribió');
-- …y lo necesario para resolver lo anterior NO se bloquea: cancelarla.
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'cancelada' WHERE id = '0e000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000001'),
  'cancelada', '1a · con el proveedor suspendido SÍ se puede cancelar la orden (historial conservado)');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000001'), 1,
  '1a · y la fila sigue ahí');

-- (b) Habilitación en el proyecto SUSPENDIDA después de aprobar → no se emite.
SET ROLE authenticated;
UPDATE public.proveedor_proyectos SET estado = 'suspendido', motivo_estado = 'Visita fallida'
 WHERE proveedor_id = :E2::uuid AND project_id = :A1::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000002' $$,
  'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO', '1b · aprobar → suspender la habilitación del proyecto → emitir: BLOQUEADO');
RESET ROLE;

-- (c) Habilitación RETIRADA.
SET ROLE authenticated;
UPDATE public.proveedor_proyectos SET estado = 'retirado', motivo_estado = 'Ya no opera en el proyecto'
 WHERE proveedor_id = :E3::uuid AND project_id = :A1::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000003' $$,
  'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO', '1c · aprobar → retirar al proveedor del proyecto → emitir: BLOQUEADO');
RESET ROLE;

-- (d) Habilitación VENCIDA (vigente_hasta pasada).
UPDATE public.proveedor_proyectos SET estado = 'habilitado', motivo_estado = NULL, vigente_hasta = CURRENT_DATE - 1
 WHERE proveedor_id = :E2::uuid AND project_id = :A1::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000002' $$,
  'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO', '1d · habilitación del proyecto vencida (vigente_hasta pasada): emitir BLOQUEADO');
RESET ROLE;

-- (e) AUTORIZACIÓN GENERAL vencida (autorizacion_vence pasada) con estado «autorizado».
UPDATE public.proveedor_proyectos SET vigente_hasta = NULL WHERE proveedor_id = :E2::uuid AND project_id = :A1::uuid;
UPDATE public.proveedores SET autorizacion_vence = CURRENT_DATE - 1 WHERE id = :E2::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000002' $$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO.*venció', '1e · autorización general vencida: emitir BLOQUEADO (mensaje de vencimiento)');
RESET ROLE;

-- (f) Directo de borrador a emitida con el proveedor suspendido: también. Desde el
--     Bloque B saltarse la aprobación es en sí una transición inválida (el
--     servidor la corta antes de llegar al proveedor); cualquiera de los dos
--     errores es un bloqueo correcto.
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('0e000000-0000-0000-0000-000000000005', :A::uuid, :A1::uuid, :E1::uuid, 'Emisión Uno', 'Borrador con proveedor suspendido', 'borrador');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000005' $$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO|COMPRAS_OC_TRANSICION_INVALIDA', '1f · borrador → emitida con el proveedor suspendido: BLOQUEADO');
RESET ROLE;

-- (g) CASO AUTORIZADO: todo en regla → aprobada → emitida SÍ funciona.
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000004'),
  'emitida', '1g · proveedor autorizado y habilitado: aprobada → emitida funciona');
SELECT public.chk_bool((SELECT emitida_at IS NOT NULL FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000004'),
  true, '1g · y la emisión queda sellada');

-- Y tras REVALIDAR bien también emite el que estuvo suspendido y volvió a estar en regla.
UPDATE public.proveedores SET autorizacion_vence = NULL WHERE id = :E2::uuid;
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0e000000-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000002'),
  'emitida', '1g · repuesta la autorización y la habilitación, la misma orden aprobada SÍ se emite');

-- (h) Resolver lo anterior tras suspender: la orden YA emitida se cierra y las
--     recepciones (con el GUC del sistema) siguen moviendo su estado.
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :E4::uuid;
RESET ROLE;
BEGIN;
SELECT set_config('conta.allow_system_write', 'on', true);
UPDATE public.ordenes_compra SET estado = 'recibida_parcial' WHERE id = '0e000000-0000-0000-0000-000000000004';
COMMIT;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000004'),
  'recibida_parcial', '1h · con el proveedor suspendido, una orden emitida sigue recibiéndose (resolver lo anterior)');
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'cerrada' WHERE id = '0e000000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0e000000-0000-0000-0000-000000000004'),
  'cerrada', '1h · …y se puede cerrar');

-- ═════════════════════ 2 · PRÓRROGAS: AMPLIACIÓN vs REDUCCIÓN ═════════════════
-- Dos contratos activos con fecha final definida: K1 (proveedor de alcance
-- EMPRESA) y K2 (alcance PROYECTOS, habilitado en A1).
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda, importe_periodico, responsable_id) VALUES
  ('ce000000-0000-0000-0000-0000000000d1', :A::uuid, :A1::uuid, :K1::uuid, 'x', '2026-01-01', '2026-12-31', 'recurrente', 'mensual', 'GTQ', 100, :UA::uuid),
  ('ce000000-0000-0000-0000-0000000000d2', :A::uuid, :A1::uuid, :K2::uuid, 'x', '2026-01-01', '2026-12-31', 'recurrente', 'mensual', 'GTQ', 100, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo'
 WHERE id IN ('ce000000-0000-0000-0000-0000000000d1', 'ce000000-0000-0000-0000-0000000000d2');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE id::text LIKE 'ce000000-%d_' AND estado = 'activo'), 2,
  '2 · dos contratos activos con fecha final definida');

-- 2a · Proveedor HABILITADO: ampliar a fecha posterior, ampliar a indefinido y reducir, todo libre.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = '2027-06-30' WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
UPDATE public.contratos_proveedores SET fecha_fin = NULL         WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT public.chk_bool((SELECT fecha_fin IS NULL FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d1'),
  true, '2a · proveedor habilitado (empresa): ampliar a una fecha posterior y luego a INDEFINIDO funciona');
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = '2028-01-31' WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT public.chk_txt((SELECT fecha_fin::text FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d1'),
  '2028-01-31', '2a · indefinido → fecha es una REDUCCIÓN y pasa');
-- Sentido registrado en el historial.
SELECT public.chk_txt((SELECT string_agg(detalle ->> 'sentido', ',' ORDER BY created_at, id)
                         FROM public.contrato_proveedor_eventos
                        WHERE contrato_id = 'ce000000-0000-0000-0000-0000000000d1' AND tipo = 'prorroga'),
  'ampliacion,ampliacion,reduccion', '2a · el historial distingue ampliación (fecha posterior, indefinido) de reducción');

-- 2b · Proveedor suspendido a nivel EMPRESA: ampliar (fecha o indefinido) bloqueado; reducir libre.
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :K1::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = '2029-01-31' WHERE id = 'ce000000-0000-0000-0000-0000000000d1' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '2b · empresa suspendido: ampliar a una fecha posterior BLOQUEADO');
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = NULL WHERE id = 'ce000000-0000-0000-0000-0000000000d1' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '2b · empresa suspendido: pasar a INDEFINIDO BLOQUEADO (es una ampliación)');
UPDATE public.contratos_proveedores SET fecha_fin = '2027-01-31' WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT public.chk_txt((SELECT fecha_fin::text FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d1'),
  '2027-01-31', '2b · empresa suspendido: REDUCIR el plazo sigue permitido (es la salida)');

-- Un contrato ya indefinido con proveedor suspendido: pasar a una fecha es reducir.
UPDATE public.proveedores SET estado = 'autorizado', motivo_estado = NULL WHERE id = :K1::uuid;
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = NULL WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
RESET ROLE;
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Otra vez' WHERE id = :K1::uuid;
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = '2027-03-31' WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT public.chk_txt((SELECT fecha_fin::text FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d1'),
  '2027-03-31', '2b · indefinido → fecha con el proveedor suspendido: es reducción y pasa');

-- 2c · Habilitado a nivel PROYECTO (alcance proyectos): libre. Suspendido en el proyecto: bloqueado.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = NULL WHERE id = 'ce000000-0000-0000-0000-0000000000d2';
UPDATE public.contratos_proveedores SET fecha_fin = '2027-09-30' WHERE id = 'ce000000-0000-0000-0000-0000000000d2';
RESET ROLE;
SELECT public.chk_txt((SELECT fecha_fin::text FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d2'),
  '2027-09-30', '2c · habilitado en el proyecto: ampliar a indefinido y reducir funcionan');
SET ROLE authenticated;
UPDATE public.proveedor_proyectos SET estado = 'suspendido', motivo_estado = 'Visita fallida'
 WHERE proveedor_id = :K2::uuid AND project_id = :A1::uuid;
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = NULL WHERE id = 'ce000000-0000-0000-0000-0000000000d2' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '2c · suspendido EN EL PROYECTO: pasar a indefinido BLOQUEADO');
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = '2030-01-01' WHERE id = 'ce000000-0000-0000-0000-0000000000d2' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '2c · suspendido EN EL PROYECTO: ampliar a fecha posterior BLOQUEADO');
UPDATE public.contratos_proveedores SET fecha_fin = '2027-08-31' WHERE id = 'ce000000-0000-0000-0000-0000000000d2';
RESET ROLE;
SELECT public.chk_txt((SELECT fecha_fin::text FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d2'),
  '2027-08-31', '2c · suspendido en el proyecto: reducir el plazo sigue permitido');
-- Retirado del proyecto: igual.
SET ROLE authenticated;
UPDATE public.proveedor_proyectos SET estado = 'retirado', motivo_estado = 'Sale del proyecto'
 WHERE proveedor_id = :K2::uuid AND project_id = :A1::uuid;
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = NULL WHERE id = 'ce000000-0000-0000-0000-0000000000d2' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '2c · retirado del proyecto: pasar a indefinido BLOQUEADO');
RESET ROLE;

-- 2d · Proveedor de alcance EMPRESA con veto en el proyecto (suspendido ahí).
UPDATE public.proveedores SET estado = 'autorizado', motivo_estado = NULL WHERE id = :K1::uuid;
UPDATE public.proveedor_proyectos SET estado = 'suspendido', motivo_estado = 'Veto del proyecto'
 WHERE proveedor_id = :K1::uuid AND project_id = :A1::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = NULL WHERE id = 'ce000000-0000-0000-0000-0000000000d1' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '2d · alcance empresa pero vetado en ESTE proyecto: indefinido BLOQUEADO');
RESET ROLE;

-- 2e · Y lo que no es prórroga no se bloquea: suspender, terminar y cancelar.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET estado = 'suspendido', motivo_estado = 'Por veto' WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
UPDATE public.contratos_proveedores SET estado = 'terminado',  motivo_estado = 'Fin del servicio' WHERE id = 'ce000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'ce000000-0000-0000-0000-0000000000d1'),
  'terminado', '2e · con el proveedor vetado se puede suspender y terminar (resolver lo anterior)');
