\set ON_ERROR_STOP on

-- ============================================================================
-- REGRESIÓN · COHERENCIA ORDEN ↔ CONTRATO AL EDITAR, Y EXCEPCIÓN NO REUTILIZABLE
-- (migración 20261025000000)
--
--   10 · «API directa» (DML como `authenticated`, la misma vía que PostgREST): en una orden en BORRADOR que
--        conserva `contrato_id`, cambiar el proveedor, la moneda o el proyecto NO puede romper la coherencia
--        con el contrato. Cambiar el contrato y la condición a la vez, de forma coherente, sí se permite.
--   11 · una excepción autorizada vale para ESAS condiciones (orden, revisión, etapa, causas, contrato,
--        proveedor, moneda e importe). Cambiar el contrato o el importe exige una autorización nueva.
--
-- Corre DESPUÉS de assert_contratos_compras.sql (comparte empresa C, proyectos C1/C2 y proveedores P1/P2);
-- crea sus propios contratos y órdenes (prefijos cf1… y 0ce5…).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set KA  '''cf100000-0000-0000-0000-000000000001'''
\set KU  '''cf100000-0000-0000-0000-000000000002'''
\set KE  '''cf100000-0000-0000-0000-000000000003'''
\set KF  '''cf100000-0000-0000-0000-000000000004'''
\set KV1 '''cf100000-0000-0000-0000-000000000005'''
\set KV2 '''cf100000-0000-0000-0000-000000000006'''
\set OX  '''0ce50000-0000-0000-0000-000000000001'''
\set OE  '''0ce50000-0000-0000-0000-000000000002'''
\set OV  '''0ce50000-0000-0000-0000-000000000003'''

-- ── Contratos (por las vías normales: admin) ────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda,
   importe_periodico, monto_maximo, responsable_id) VALUES
  (:KA::uuid,  :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CH-KA',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 1000, :UA::uuid),
  (:KU::uuid,  :C::uuid, :C1::uuid, :P2::uuid, 'x', 'CH-KU',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'USD', NULL, NULL, :UA::uuid),
  (:KE::uuid,  :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CH-KE',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 1000, :UA::uuid),
  (:KF::uuid,  :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CH-KF',  CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 500,  :UA::uuid),
  (:KV1::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CH-KV1', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL, 'GTQ', NULL, NULL, :UA::uuid),
  (:KV2::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CH-KV2', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL, 'GTQ', NULL, NULL, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id IN (:KA::uuid, :KU::uuid, :KE::uuid, :KF::uuid, :KV1::uuid, :KV2::uuid);
RESET ROLE;

-- ═════════════ 10 · EDITAR UNA ORDEN EN BORRADOR CONSERVANDO EL CONTRATO ═══════
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
VALUES (:OX::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OX en borrador al amparo de KA', :KA::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, :OX::uuid, 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 100);

RESET ROLE;
SELECT public.como(:UA::uuid);   -- editar un borrador: administrador (la política de UPDATE no admite al operador)
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0ce50000-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRATO_PROVEEDOR', '10 · cambiar el proveedor de una orden en borrador conservando el contrato: rechazado');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET moneda = 'USD' WHERE id = '0ce50000-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRATO_MONEDA', '10 · cambiar la moneda conservando el contrato (GTQ): rechazado');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET proveedor_id = 'e3000000-0000-0000-0000-000000000002', moneda = 'USD' WHERE id = '0ce50000-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRATO_PROVEEDOR', '10 · proveedor y moneda a la vez, conservando el contrato: rechazado');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET project_id = 'c2c2c2c2-0000-0000-0000-000000000001' WHERE id = '0ce50000-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRATO_PROYECTO', '10 · cambiar el proyecto conservando el contrato (es de C1): rechazado');
RESET ROLE;
SELECT public.chk_txt((SELECT proveedor_id::text || '|' || COALESCE(upper(moneda), '-') || '|' || project_id::text FROM public.ordenes_compra WHERE id = :OX::uuid),
  'e3000000-0000-0000-0000-000000000001|-|c1c1c1c1-0000-0000-0000-000000000001',
  '10 · tras los rechazos la orden conserva proveedor, moneda y proyecto (nada se aplicó a medias)');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- Quitar el contrato y cambiar de proveedor es una decisión válida; volver a ligarlo ya no.
UPDATE public.ordenes_compra SET proveedor_id = :P2::uuid, contrato_id = NULL WHERE id = :OX::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET contrato_id = 'cf100000-0000-0000-0000-000000000001' WHERE id = '0ce50000-0000-0000-0000-000000000001' $$,
  'COMPRAS_CONTRATO_PROVEEDOR', '10 · sin contrato y con otro proveedor, volver a ligar el contrato anterior: rechazado');
-- Cambio coherente de proveedor, moneda y contrato en UNA sentencia.
UPDATE public.ordenes_compra SET proveedor_id = :P2::uuid, moneda = 'USD', contrato_id = :KU::uuid WHERE id = :OX::uuid;
SELECT public.chk_txt((SELECT proveedor_id::text || '|' || COALESCE(upper(moneda), '-') || '|' || contrato_id::text FROM public.ordenes_compra WHERE id = :OX::uuid),
  'e3000000-0000-0000-0000-000000000002|USD|cf100000-0000-0000-0000-000000000002',
  '10 · proveedor, moneda y contrato cambiados juntos y de forma coherente: permitido');
UPDATE public.ordenes_compra SET proveedor_id = :P1::uuid, moneda = 'GTQ', contrato_id = :KA::uuid WHERE id = :OX::uuid;
SELECT public.chk_uuid((SELECT contrato_id FROM public.ordenes_compra WHERE id = :OX::uuid), :KA::uuid,
  '10 · y de regreso al contrato en GTQ de P1');
-- Una edición ajena al contrato no se bloquea.
UPDATE public.ordenes_compra SET concepto = 'OX con el concepto corregido' WHERE id = :OX::uuid;
SELECT public.chk_txt((SELECT concepto FROM public.ordenes_compra WHERE id = :OX::uuid), 'OX con el concepto corregido',
  '10 · editar el concepto (sin tocar proveedor, moneda ni contrato) sigue permitido');
RESET ROLE;

-- Un contrato que venció DESPUÉS de ligar no impide editar el borrador (la vigencia se exige al aprobar/emitir).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = :KA::uuid;
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET concepto = 'OX editada con el contrato ya vencido' WHERE id = :OX::uuid;
SELECT public.chk_txt((SELECT concepto FROM public.ordenes_compra WHERE id = :OX::uuid), 'OX editada con el contrato ya vencido',
  '10 · con el contrato vencido, el borrador se puede seguir editando; aprobar sí se bloquea');
RESET ROLE;

-- ═════════════ 11 · UNA EXCEPCIÓN NO SE REUTILIZA SI CAMBIAN LAS CONDICIONES ════
-- OE: 1200 sobre KE (máximo 1000) → causa «monto». La solicita UO; la autoriza UB.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
VALUES (:OE::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OE sobre el máximo de KE', :KE::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, :OE::uuid, 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 1200);
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce50000-0000-0000-0000-000000000002' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE.*monto', '11 · 1200 sobre un máximo de 1000: no se aprueba sin excepción');
RESET ROLE;

SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.compras_oc_excepcion_contrato(:OE::uuid, 'aprobar', 'Compra urgente autorizada por la gerencia (1200)') AS ex1 \gset
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_excepciones WHERE orden_compra_id = :OE::uuid), 1,
  '11 · queda UNA excepción, con el contrato, el proveedor, la moneda y el importe autorizados');
SELECT public.chk_txt((SELECT contrato_id::text || '|' || proveedor_id::text || '|' || upper(moneda) || '|' || trim_scale(total)::text
                         FROM public.orden_compra_excepciones WHERE id = :'ex1'::uuid),
  'cf100000-0000-0000-0000-000000000003|e3000000-0000-0000-0000-000000000001|GTQ|1200',
  '11 · …y guarda exactamente las condiciones que se autorizaron');

-- (a) Cambia el IMPORTE (precio de la línea) y se intenta aprobar con la excepción de 1200.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET precio_unitario = 5000 WHERE orden_compra_id = :OE::uuid;
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = :OE::uuid), 5000, '11 · el total de la orden pasó a 5000');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce50000-0000-0000-0000-000000000002' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '11 · la excepción de 1200 NO sirve para 5000: se exige una autorización nueva');
RESET ROLE;
-- (b) Se vuelve al importe de 1200.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET precio_unitario = 1200 WHERE orden_compra_id = :OE::uuid;
RESET ROLE;
-- (c) Cambia el CONTRATO (otro, también más chico que el importe) conservando proveedor y moneda.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET contrato_id = :KF::uuid WHERE id = :OE::uuid;
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce50000-0000-0000-0000-000000000002' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '11 · la excepción dada para KE NO cubre a KF (otro contrato, mismo importe y causa): se exige autorización nueva');
RESET ROLE;
-- La autorización nueva queda además de la anterior (historial), y es idempotente.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.compras_oc_excepcion_contrato(:OE::uuid, 'aprobar', 'Se amplía la compra: ahora contra el contrato KF (1200)') AS ex2 \gset
SELECT public.compras_oc_excepcion_contrato(:OE::uuid, 'aprobar', 'Se amplía la compra: ahora contra el contrato KF (1200)') AS ex3 \gset
RESET ROLE;
SELECT public.chk_bool(:'ex2'::uuid <> :'ex1'::uuid, true, '11 · la autorización para KF es OTRA, no la de KE');
SELECT public.chk_bool(:'ex2'::uuid = :'ex3'::uuid, true, '11 · reintentar la misma autorización devuelve la misma (sin duplicar)');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_excepciones WHERE orden_compra_id = :OE::uuid), 2,
  '11 · quedan DOS excepciones en el historial (la de KE y la de KF)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :OE::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OE::uuid), 'aprobada',
  '11 · con la autorización vigente para ESAS condiciones, la orden se aprueba');

-- (d) Vigencia: una excepción dada porque KV1 venció no se traslada a KV2 (que venció después de ligarse).
--     (Cambiar a un contrato YA vencido ni siquiera se permite: se rechaza al ligar.)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
VALUES (:OV::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OV en KV1 (vence)', :KV1::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, :OV::uuid, 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 100);
UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = :KV1::uuid;
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.compras_oc_excepcion_contrato(:OV::uuid, 'aprobar', 'Contrato KV1 en renovación; no se puede parar el servicio') AS exv \gset
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET contrato_id = :KV2::uuid WHERE id = :OV::uuid;     -- KV2 aún está vigente: se liga
UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = :KV2::uuid;   -- …y vence después
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce50000-0000-0000-0000-000000000003' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '11 · la excepción por vigencia de KV1 NO cubre a KV2: se exige autorización nueva');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.compras_oc_excepcion_contrato(:OV::uuid, 'aprobar', 'Contrato KV2 también en renovación; el servicio sigue') AS exv2 \gset
RESET ROLE;
SELECT public.chk_bool(:'exv2'::uuid <> :'exv'::uuid, true, '11 · la autorización para KV2 es otra');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :OV::uuid;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = :OV::uuid), 'aprobada',
  '11 · con la autorización para KV2, la orden se aprueba');
RESET ROLE;

-- (e) La fila de excepción sigue siendo evidencia inmutable y no se escribe por la API.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_excepciones (company_id, project_id, orden_compra_id, contrato_id, revision, etapa, causas, motivo, autorizado_por)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','0ce50000-0000-0000-0000-000000000002','cf100000-0000-0000-0000-000000000004', 9, 'aprobar', 'monto', 'Excepción fabricada a mano', 'c0c0c0c0-0000-0000-0000-00000000000a') $$,
  'permission denied', '11 · una excepción no se inserta a mano por la API');
RESET ROLE;
SELECT public.como(:UA::uuid);
