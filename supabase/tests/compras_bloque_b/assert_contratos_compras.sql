\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CONTRATOS DE PROVEEDOR CONECTADOS A LAS COMPRAS
-- (migraciones 20261024000000 … 20261024000300)
--
--   1 · ligar una orden a un contrato: proveedor, proyecto, empresa y MONEDA coherentes
--   2 · aprobar/emitir exige contrato vigente y proveedor autorizado; sin monto máximo no hay límite
--   3 · monto máximo del contrato (y ampliaciones documentadas) frente a lo comprometido
--   4 · excepción explícita, justificada y auditada (permiso, separación, idempotencia, revisión)
--   5 · contrato suspendido / proveedor suspendido
--   6 · renovación conserva historial y no genera facturas, pagos ni asientos; prórroga con motivo
--   7 · seguimiento del contrato: contratado ≠ comprometido ≠ recibido ≠ facturado ≠ pagado, por moneda
--   8 · aislamiento entre empresas y proyectos, y permisos de Operaciones vs Contabilidad
--   9 · evaluaciones ligadas al proveedor compartido, contrato y orden; una negativa no suspende
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UQ  '''c0c0c0c0-0000-0000-0000-0000000000f1'''
\set UR  '''c0c0c0c0-0000-0000-0000-0000000000f2'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set P4  '''e3000000-0000-0000-0000-0000000000f4'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''
\set K1  '''cf000000-0000-0000-0000-000000000001'''
\set K2  '''cf000000-0000-0000-0000-000000000002'''
\set K3  '''cf000000-0000-0000-0000-000000000003'''
\set K4  '''cf000000-0000-0000-0000-000000000004'''
\set K5  '''cf000000-0000-0000-0000-000000000005'''
\set K6  '''cf000000-0000-0000-0000-000000000006'''
\set K7  '''cf000000-0000-0000-0000-000000000007'''
\set K8  '''cf000000-0000-0000-0000-000000000008'''

-- ── Padrón adicional: Operaciones con contratos (sin Contabilidad) y un usuario solo de C2 ──
INSERT INTO auth.users (id) VALUES ('c0c0c0c0-0000-0000-0000-0000000000f1'), ('c0c0c0c0-0000-0000-0000-0000000000f2');
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('c0c0c0c0-0000-0000-0000-0000000000f1', :C::uuid, 'BB Operaciones contratos', 'operator'),
  ('c0c0c0c0-0000-0000-0000-0000000000f2', :C::uuid, 'BB Solo C2',               'operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('c0c0c0c0-0000-0000-0000-0000000000f1', 'c1c1c1c1-0000-0000-0000-000000000001', 'total'),
  ('c0c0c0c0-0000-0000-0000-0000000000f2', 'c2c2c2c2-0000-0000-0000-000000000001', 'total');
INSERT INTO public.roles (id, company_id, name) VALUES
  ('9b000000-0000-0000-0000-0000000000f1', :C::uuid, 'BB Operaciones contratos'),
  ('9b000000-0000-0000-0000-0000000000f2', :C::uuid, 'BB Solo C2');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('9b000000-0000-0000-0000-0000000000f1', 'condominios.tab.proveedores',    'allow'),
  ('9b000000-0000-0000-0000-0000000000f1', 'condominios.tab.ordenes_compra', 'allow'),
  ('9b000000-0000-0000-0000-0000000000f2', 'condominios.tab.proveedores',    'allow'),
  ('9b000000-0000-0000-0000-0000000000f2', 'condominios.tab.eval_proveedor', 'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('c0c0c0c0-0000-0000-0000-0000000000f1', '9b000000-0000-0000-0000-0000000000f1'),
  ('c0c0c0c0-0000-0000-0000-0000000000f2', '9b000000-0000-0000-0000-0000000000f2');

-- Un proveedor propio de esta suite (P3 de otras suites queda suspendido en el proyecto): se autoriza por la vía normal.
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
VALUES (:P4::uuid, :C::uuid, 'Proveedor a suspender (contratos)', '8100044-4', 'GT', 'empresa');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :P4::uuid;
RESET ROLE;

-- ── Contratos (por las vías normales: admin) ────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda,
   importe_periodico, monto_maximo, responsable_id) VALUES
  (:K1::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-K1', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'GTQ', NULL, 1000, :UA::uuid),
  (:K2::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-K2', CURRENT_DATE - 30, NULL,                'recurrente',  'mensual', 'GTQ', 500,  NULL, :UA::uuid),
  (:K3::uuid, :C::uuid, :C1::uuid, :P2::uuid, 'x', 'CF-K3', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'USD', NULL, NULL, :UA::uuid),
  (:K4::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-K4', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL,      'GTQ', NULL, NULL, :UA::uuid),
  (:K5::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-K5', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'GTQ', NULL, NULL, :UA::uuid),
  (:K6::uuid, :C::uuid, :C1::uuid, :P4::uuid, 'x', 'CF-K6', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL,      'GTQ', NULL, NULL, :UA::uuid),
  (:K8::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-K8', CURRENT_DATE - 30, CURRENT_DATE + 5,   'por_demanda', NULL,      'GTQ', NULL, NULL, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id IN (:K1::uuid, :K2::uuid, :K3::uuid, :K4::uuid, :K5::uuid, :K6::uuid, :K8::uuid);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE id::text LIKE 'cf000000-%' AND estado = 'activo'), 7,
  '0 · siete contratos activos (límite 1000, recurrente sin límite, USD, por vencer ×2, a suspender, de un proveedor a suspender)');

-- ═════════════ 1 · LIGAR UNA ORDEN: proveedor, proyecto, empresa y moneda ═════
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
-- Ordenes de la prueba: una línea de cantidad 1, así que el precio es el total.
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES
  ('0ce00000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OA 600 al amparo de K1', :K1::uuid),
  ('0ce00000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OC 300 al amparo de K1', :K1::uuid),
  ('0ce00000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OB 500 al amparo de K1', :K1::uuid),
  ('0ce00000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OD 400 al amparo de K1', :K1::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES
  (:C::uuid, '0ce00000-0000-0000-0000-000000000001', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 600),
  (:C::uuid, '0ce00000-0000-0000-0000-000000000002', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 300),
  (:C::uuid, '0ce00000-0000-0000-0000-000000000003', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 500),
  (:C::uuid, '0ce00000-0000-0000-0000-000000000004', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 400);
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE contrato_id = :K1::uuid), 4,
  '1 · cuatro órdenes ligadas al contrato K1 (mismo proveedor, proyecto, empresa y moneda)');

SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002', 'x', 'otro proveedor', 'cf000000-0000-0000-0000-000000000001') $$,
  'COMPRAS_CONTRATO_PROVEEDOR', '1 · un contrato de otro proveedor no ampara la orden');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c2c2c2c2-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'x', 'otro proyecto', 'cf000000-0000-0000-0000-000000000001') $$,
  'COMPRAS_CONTRATO_PROYECTO', '1 · el contrato es del proyecto C1: no ampara una orden del C2');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id, moneda)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'x', 'moneda distinta', 'cf000000-0000-0000-0000-000000000001', 'USD') $$,
  'COMPRAS_CONTRATO_MONEDA', '1 · contrato en GTQ, orden en USD: no se mezclan monedas');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002', 'x', 'GTQ contra contrato USD', 'cf000000-0000-0000-0000-000000000003') $$,
  'COMPRAS_CONTRATO_MONEDA', '1 · contrato en USD, orden en GTQ: no se mezclan monedas');
RESET ROLE;

-- Otra empresa: no puede ligar una orden suya a un contrato de C.
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1d1d1d1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-0000000000d1', 'x', 'contrato ajeno', 'cf000000-0000-0000-0000-000000000001') $$,
  'COMPRAS_CONTRATO_AJENO', '1 · la empresa D no puede amparar una orden en un contrato de la empresa C');
RESET ROLE;

-- ═════════════ 2 · APROBAR Y EMITIR CON CONTRATO VIGENTE ══════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0ce00000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-000000000001'), 'emitida',
  '2 · con contrato vigente y proveedor autorizado, la orden se aprueba y se emite (600 de 1000)');

-- Una orden SIN contrato sigue como siempre.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0ce00000-0000-0000-0000-000000000008', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Sin contrato');
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, '0ce00000-0000-0000-0000-000000000008', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 9999);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000008';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-000000000008'), 'aprobada',
  '2 · una orden sin contrato no cambia: el contrato no es obligatorio para comprar');

-- ═════════════ 3 · MONTO MÁXIMO Y AMPLIACIONES ════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000002';   -- 600 + 300 = 900 ≤ 1000
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000003' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE.*rebasa el monto máximo vigente de 1000', '3 · 900 + 500 rebasa el máximo de 1000: bloqueado');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-000000000003'), 'borrador',
  '3 · la orden que rebasaba sigue en borrador (no quedó a medias)');

-- Sin monto máximo NO hay límite total: una orden enorme sobre K2 se aprueba.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
VALUES ('0ce00000-0000-0000-0000-00000000000d', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Enorme sobre un contrato sin límite', :K2::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, '0ce00000-0000-0000-0000-00000000000d', 1, 'Servicio', 'gasto', 'servicios', 1, 'unidad', 5000000);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-00000000000d';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-00000000000d'), 'aprobada',
  '3 · el contrato sin monto máximo no tiene límite total: no se inventa uno');

-- Ampliaciones documentadas.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE amp (k text PRIMARY KEY, id uuid);
GRANT ALL ON amp TO authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000002', 100, 'Ampliar un contrato sin límite', 'amp-clave-sinlimite') $$,
  'CONTRATO_SIN_LIMITE', '3 · un contrato sin monto máximo no se «amplía»: no hay límite que subir');
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000001', 100, 'corto', 'amp-clave-corta1') $$,
  'CONTRATO_AMPLIACION_MOTIVO', '3 · la ampliación exige un motivo real');
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000001', -5, 'Incremento negativo no vale', 'amp-clave-neg1') $$,
  'CONTRATO_AMPLIACION_MONTO', '3 · el incremento es positivo');
INSERT INTO amp SELECT 'a1', public.contrato_ampliar_monto(:K1::uuid, 1000, 'Ampliación autorizada por el comité', 'amp-clave-0001', 'ADENDA-1');
INSERT INTO amp SELECT 'a2', public.contrato_ampliar_monto(:K1::uuid, 1000, 'Ampliación autorizada por el comité', 'amp-clave-0001', 'ADENDA-1');
SELECT public.chk_uuid((SELECT id FROM amp WHERE k = 'a1'), (SELECT id FROM amp WHERE k = 'a2'), '3 · reintentar la ampliación con la misma clave devuelve la misma');
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000001', 2000, 'Otro contenido con la misma clave', 'amp-clave-0001') $$,
  'CONTRATO_AMPLIACION_CLAVE', '3 · la misma clave con otro contenido se rechaza');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contrato_ampliaciones WHERE contrato_id = :K1::uuid), 1, '3 · una sola ampliación registrada (sin duplicar)');
SELECT public.chk_num((SELECT monto_maximo FROM public.contratos_proveedores WHERE id = :K1::uuid), 1000,
  '3 · la condición ORIGINAL del contrato no se sobrescribió (1000)');
SELECT public.chk_num((SELECT monto_nuevo FROM public.contrato_ampliaciones WHERE contrato_id = :K1::uuid), 2000,
  '3 · la ampliación documenta 1000 → 2000');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos WHERE contrato_id = :K1::uuid AND tipo = 'ampliacion_monto'), 1,
  '3 · y queda en el historial del contrato');
SELECT public.chk_falla($$ UPDATE public.contrato_ampliaciones SET incremento = 1 $$, 'CONTRATO_AMPLIACION_INMUTABLE',
  '3 · una ampliación documentada no se edita');

-- Sin permiso / de otra empresa.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000001', 10, 'Operador sin pestaña de contratos', 'amp-clave-op-01') $$,
  'CONTRATO_AMPLIACION_AJENA', '3 · quien no tiene la pestaña de contratos no amplía');
SELECT public.como(:UD::uuid);
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000001', 10, 'Otra empresa intentando ampliar', 'amp-clave-d-001') $$,
  'CONTRATO_AMPLIACION_AJENA', '3 · otra empresa no amplía el contrato de C');
RESET ROLE;

-- Con 2000 de máximo ya cabe OB (500): 900 + 500 = 1400.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000003';
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000004';   -- 1400 + 400 = 1800
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000004', 'emitir', 'No hace falta, está vigente') $$,
  'COMPRAS_EXCEPCION_INNECESARIA', '4 · no se autoriza una excepción donde no hace falta');
RESET ROLE;
SELECT public.chk_txt((SELECT string_agg(estado, ',' ORDER BY id) FROM public.ordenes_compra WHERE contrato_id = :K1::uuid),
  'emitida,aprobada,aprobada,aprobada', '3 · con la ampliación documentada caben las cuatro órdenes (1800 de 2000)');

-- ═════════════ 4 · VIGENCIA, SUSPENSIÓN Y EXCEPCIÓN AUDITADA ══════════════════
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES
  ('0ce00000-0000-0000-0000-000000000006', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OS amparada en K5 (se suspende)', :K5::uuid),
  ('0ce00000-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P4::uuid, 'Proveedor a suspender', 'OP de un proveedor que se suspende', :K6::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES
  (:C::uuid, '0ce00000-0000-0000-0000-000000000006', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 100),
  (:C::uuid, '0ce00000-0000-0000-0000-000000000007', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 100);
RESET ROLE;

-- OV la solicita UA (así, con la separación activada, UA no puede autorizar su propia excepción).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
VALUES ('0ce00000-0000-0000-0000-000000000005', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OV amparada en K4 (por vencer)', :K4::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, '0ce00000-0000-0000-0000-000000000005', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 100);
-- El contrato K4 vence DESPUÉS de ligar la orden (reducir el plazo es libre).
UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = :K4::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000005' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE.*no está vigente hoy', '4 · contrato vencido por fechas: no se aprueba la orden');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'x', 'orden nueva contra contrato vencido', 'cf000000-0000-0000-0000-000000000004') $$,
  'COMPRAS_CONTRATO_FUERA_DE_VIGENCIA', '4 · contra un contrato vencido por fechas ya no se ligan órdenes nuevas');

-- Quién autoriza la excepción.
RESET ROLE;
SELECT public.como(:UC::uuid);   -- contador: ve y escribe Contabilidad, pero SIN cambio de estado
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'Autorización sin permiso de cambio de estado') $$,
  'COMPRAS_EXCEPCION_PERMISO', '4 · quien no tiene el permiso de cambio de estado no autoriza la excepción');
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'Operador intentando autorizar la excepción') $$,
  'COMPRAS_EXCEPCION_PERMISO', '4 · el operador que solicitó la orden tampoco');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'Otra empresa autorizando una excepción') $$,
  'COMPRAS_EXCEPCION_ORDEN', '4 · otra empresa no ve la orden: no autoriza nada');
RESET ROLE;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'corto') $$,
  'COMPRAS_EXCEPCION_MOTIVO', '4 · la excepción exige un motivo justificado');
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'emitir', 'La orden aún no está aprobada') $$,
  'COMPRAS_EXCEPCION_ESTADO', '4 · para emitir la orden debe estar aprobada: la excepción es de la etapa que toca');
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000008', 'aprobar', 'Orden sin contrato no necesita nada') $$,
  'COMPRAS_EXCEPCION_SIN_CONTRATO', '4 · una orden sin contrato no tiene qué exceptuar');

-- Con la separación activada, quien solicitó la orden (UA) no autoriza su propia excepción; otra persona (UB) sí.
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'Quien solicitó la orden autoriza su excepción') $$,
  'COMPRAS_EXCEPCION_AUTOAUTORIZACION', '4 · con la separación activada, quien solicitó la orden no autoriza su excepción');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE exc (k text PRIMARY KEY, id uuid);
GRANT ALL ON exc TO authenticated;
INSERT INTO exc SELECT 'e1', public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'Contrato en renovación; el servicio no puede parar');
INSERT INTO exc SELECT 'e2', public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'aprobar', 'Contrato en renovación; el servicio no puede parar');
SELECT public.chk_uuid((SELECT id FROM exc WHERE k = 'e1'), (SELECT id FROM exc WHERE k = 'e2'), '4 · reintentar la excepción devuelve la misma (no se duplica)');
RESET ROLE;
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_excepciones WHERE orden_compra_id = '0ce00000-0000-0000-0000-000000000005'), 1,
  '4 · una sola excepción registrada');
SELECT public.chk_uuid((SELECT autorizado_por FROM public.orden_compra_excepciones WHERE orden_compra_id = '0ce00000-0000-0000-0000-000000000005'), :UB::uuid,
  '4 · la excepción queda a nombre de quien la autorizó (sellado por el servidor)');
SELECT public.chk_txt((SELECT causas FROM public.orden_compra_excepciones WHERE orden_compra_id = '0ce00000-0000-0000-0000-000000000005'), 'vigencia',
  '4 · y dice qué cubre (vigencia)');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = '0ce00000-0000-0000-0000-000000000005' AND tipo = 'excepcion_contrato'), 1,
  '4 · queda en el historial de la orden');
SELECT public.chk_falla($$ UPDATE public.orden_compra_excepciones SET motivo = 'cambiado a escondidas' $$, 'COMPRAS_EXCEPCION_INMUTABLE',
  '4 · la excepción es evidencia: no se edita');
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_excepciones (company_id, project_id, orden_compra_id, contrato_id, revision, etapa, causas, motivo, autorizado_por)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','0ce00000-0000-0000-0000-000000000005','cf000000-0000-0000-0000-000000000004',0,'aprobar','vigencia','Insertada a mano sin la RPC','c0c0c0c0-0000-0000-0000-00000000000a') $$,
  'permission denied|row-level security', '4 · la excepción no se inserta a mano: solo la RPC la escribe');
RESET ROLE;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-000000000005'), 'aprobada',
  '4 · con la excepción autorizada la orden se aprueba');

-- Emitir exige SU propia excepción.
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0ce00000-0000-0000-0000-000000000005' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '4 · la excepción de aprobar no cubre emitir: otra etapa, otra autorización');
SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000005', 'emitir', 'Se emite hoy; la renovación se firma esta semana');
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = '0ce00000-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-000000000005'), 'emitida',
  '4 · con la excepción de emitir, se emite');

-- Devolver a borrador invalida la excepción (nueva revisión). K8 vence después de ligar la orden.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
VALUES ('0ce00000-0000-0000-0000-00000000000e', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Revisión que invalida la excepción', :K8::uuid);
INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES (:C::uuid, '0ce00000-0000-0000-0000-00000000000e', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 50);
UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE - 1 WHERE id = :K8::uuid;
SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-00000000000e', 'aprobar', 'Primera excepción de la revisión cero');
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-00000000000e';
UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'Corregir el precio antes de emitir' WHERE id = '0ce00000-0000-0000-0000-00000000000e';
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-00000000000e' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '4 · devolver la orden a borrador (nueva revisión) invalida la excepción anterior');
RESET ROLE;

-- Contrato SUSPENDIDO después de ligar.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET estado = 'suspendido', motivo_estado = 'Incumplimiento de entregas' WHERE id = :K5::uuid;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000006' $$,
  'COMPRAS_CONTRATO_NO_VIGENTE', '5 · contrato suspendido: la orden ligada no se aprueba');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'x', 'nueva contra suspendido', 'cf000000-0000-0000-0000-000000000005') $$,
  'COMPRAS_CONTRATO_NO_ACTIVO', '5 · contra un contrato suspendido no se ligan órdenes nuevas');
RESET ROLE;

-- Proveedor SUSPENDIDO con el contrato vigente: el contrato no lo rescata.
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :P4::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0ce00000-0000-0000-0000-000000000007' $$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO', '5 · proveedor suspendido: aprobar sigue bloqueado aunque el contrato esté vigente');
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('0ce00000-0000-0000-0000-000000000007', 'aprobar', 'No se exceptúa al proveedor suspendido') $$,
  'COMPRAS_EXCEPCION_INNECESARIA', '5 · y la excepción de contrato no tapa un proveedor suspendido (no hay causa de contrato)');
RESET ROLE;
UPDATE public.proveedores SET estado = 'autorizado', motivo_estado = NULL WHERE id = :P4::uuid;

-- Cancelaciones: una orden cancelada no compromete monto.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'Ya no se necesita' WHERE id = '0ce00000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-000000000004'), 'cancelada',
  '5 · cancelar una orden amparada en contrato sigue permitido (cancelar no se bloquea)');

-- ═════════════ 6 · RENOVACIÓN, PRÓRROGA Y SIN EFECTOS CONTABLES ════════════════
CREATE TEMP TABLE antes AS
SELECT (SELECT count(*) FROM public.facturas_proveedor WHERE company_id = :C::uuid) AS facturas,
       (SELECT count(*) FROM public.ordenes_pago        WHERE company_id = :C::uuid) AS pagos,
       (SELECT count(*) FROM public.conta_asientos      WHERE company_id = :C::uuid) AS asientos,
       (SELECT count(*) FROM public.ordenes_compra      WHERE company_id = :C::uuid) AS ordenes;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE ren (k text PRIMARY KEY, id uuid);
GRANT ALL ON ren TO authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_renovar('cf000000-0000-0000-0000-000000000002', CURRENT_DATE + 10, NULL, 'x') $$,
  'CONTRATO_RENOVACION_MOTIVO', '6 · renovar exige motivo');
SELECT public.chk_falla($$ SELECT public.contrato_renovar('cf000000-0000-0000-0000-000000000002', CURRENT_DATE - 60, NULL, 'Renovación anual del servicio') $$,
  'CONTRATO_RENOVACION_FECHA', '6 · la renovación empieza después del inicio del contrato original');
INSERT INTO ren SELECT 'r1', public.contrato_renovar(:K2::uuid, CURRENT_DATE + 10, CURRENT_DATE + 375, 'Renovación anual del servicio');
INSERT INTO ren SELECT 'r2', public.contrato_renovar(:K2::uuid, CURRENT_DATE + 10, CURRENT_DATE + 375, 'Renovación anual del servicio');
SELECT public.chk_uuid((SELECT id FROM ren WHERE k = 'r1'), (SELECT id FROM ren WHERE k = 'r2'), '6 · reintentar la renovación devuelve el mismo contrato (no duplica)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE renovado_de = :K2::uuid), 1, '6 · un solo contrato de renovación');
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = (SELECT id FROM ren WHERE k = 'r1')), 'borrador',
  '6 · la renovación nace en BORRADOR: activarla es un acto explícito');
SELECT public.chk_txt((SELECT referencia FROM public.contratos_proveedores WHERE id = (SELECT id FROM ren WHERE k = 'r1')), 'CF-K2-R1',
  '6 · la referencia de la renovación es correlativa');
SELECT public.chk_txt((SELECT estado || '|' || fecha_inicio::text || '|' || importe_periodico::text || '|' || COALESCE(fecha_fin::text, 'indef')
                         FROM public.contratos_proveedores WHERE id = :K2::uuid),
  'activo|' || (CURRENT_DATE - 30)::text || '|500.00|indef', '6 · el contrato ORIGINAL conserva estado, inicio, importe y plazo');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos WHERE contrato_id = :K2::uuid AND tipo = 'renovado_por'), 1,
  '6 · el original registra «renovado por»');
SELECT public.chk_txt((SELECT motivo FROM public.contrato_proveedor_eventos WHERE contrato_id = (SELECT id FROM ren WHERE k = 'r1') AND tipo = 'renovacion'),
  'Renovación anual del servicio', '6 · la renovación registra su motivo');
SELECT public.chk_falla($$ INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, renovado_de)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x', CURRENT_DATE + 99,'recurrente','mensual','cf000000-0000-0000-0000-000000000002') $$,
  'CONTRATO_RENOVACION_POR_RPC', '6 · no se fabrica una renovación con un INSERT directo');
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET renovado_de = NULL WHERE id IN (SELECT id FROM public.contratos_proveedores WHERE renovado_de IS NOT NULL) $$,
  'CONTRATO_RENOVACION_INMUTABLE', '6 · la relación de renovación no se cambia');
-- Activar la renovación: sigue sin generar nada contable.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = (SELECT id FROM ren WHERE k = 'r1');
-- Un borrador no se renueva; otra empresa no ve el contrato.
INSERT INTO public.contratos_proveedores (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, modalidad, periodicidad)
VALUES ('cf000000-0000-0000-0000-0000000000b1', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'CF-B1', CURRENT_DATE, 'recurrente', 'mensual');
SELECT public.chk_falla($$ SELECT public.contrato_renovar('cf000000-0000-0000-0000-0000000000b1', CURRENT_DATE + 30, NULL, 'Renovar un borrador') $$,
  'CONTRATO_RENOVACION_ESTADO', '6 · un contrato en borrador no se renueva');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_renovar('cf000000-0000-0000-0000-000000000002', CURRENT_DATE + 20, NULL, 'Otra empresa intentando renovar') $$,
  'CONTRATO_RENOVACION_AJENA', '6 · otra empresa no renueva el contrato de C');
RESET ROLE;
SELECT public.chk((SELECT facturas FROM antes), (SELECT count(*) FROM public.facturas_proveedor WHERE company_id = :C::uuid), '6 · renovar y activar no generó facturas');
SELECT public.chk((SELECT pagos FROM antes), (SELECT count(*) FROM public.ordenes_pago WHERE company_id = :C::uuid), '6 · …ni pagos');
SELECT public.chk((SELECT asientos FROM antes), (SELECT count(*) FROM public.conta_asientos WHERE company_id = :C::uuid), '6 · …ni asientos');
SELECT public.chk((SELECT ordenes FROM antes), (SELECT count(*) FROM public.ordenes_compra WHERE company_id = :C::uuid), '6 · …ni órdenes');

-- Prórroga con motivo.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.contratos_proveedores SET fecha_fin = CURRENT_DATE + 900 WHERE id = 'cf000000-0000-0000-0000-000000000001' $$,
  'CONTRATO_AMPLIACION_MOTIVO', '6 · ampliar la vigencia con un UPDATE directo, sin motivo, se rechaza');
SELECT public.chk_falla($$ SELECT public.contrato_prorrogar('cf000000-0000-0000-0000-000000000001', CURRENT_DATE + 900, 'x') $$,
  'CONTRATO_AMPLIACION_MOTIVO', '6 · la prórroga exige motivo');
SELECT public.contrato_prorrogar(:K1::uuid, CURRENT_DATE + 900, 'Se amplía la vigencia por la adenda 2');
RESET ROLE;
SELECT public.chk_txt((SELECT detalle ->> 'motivo' FROM public.contrato_proveedor_eventos WHERE contrato_id = :K1::uuid AND tipo = 'prorroga' ORDER BY created_at DESC LIMIT 1),
  'Se amplía la vigencia por la adenda 2', '6 · la prórroga deja su motivo en el historial');
SET ROLE authenticated;
SELECT public.contrato_prorrogar(:K1::uuid, CURRENT_DATE + 400, 'Reducir el plazo');   -- reducir no exige proveedor habilitado ni se bloquea
RESET ROLE;
SELECT public.chk_txt((SELECT fecha_fin::text FROM public.contratos_proveedores WHERE id = :K1::uuid), (CURRENT_DATE + 400)::text,
  '6 · reducir el plazo con motivo funciona');
-- Con el proveedor suspendido no se amplía por la RPC.
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Prueba' WHERE id = :P1::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.contrato_prorrogar('cf000000-0000-0000-0000-000000000001', CURRENT_DATE + 800, 'Ampliar con el proveedor suspendido') $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '6 · con el proveedor suspendido no se amplía la vigencia');
SELECT public.chk_falla($$ SELECT public.contrato_ampliar_monto('cf000000-0000-0000-0000-000000000001', 100, 'Ampliar con el proveedor suspendido', 'amp-clave-susp-1') $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '6 · …ni su monto');
RESET ROLE;
UPDATE public.proveedores SET estado = 'autorizado', motivo_estado = NULL WHERE id = :P1::uuid;

-- ═════════════ 7 · SEGUIMIENTO DEL CONTRATO ═══════════════════════════════════
-- K2 (GTQ, sin límite): OF 10 × 100 + IVA 120, recibida 6 + 4, factura de 6 (672) con 300 pagados; las 4
-- restantes recibidas y SIN facturar. K3 (USD): OU 5 × 20 recibida y facturada.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id) VALUES
  ('0ce00000-0000-0000-0000-000000000009', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OF flujo completo en GTQ', :K2::uuid),
  ('0ce00000-0000-0000-0000-00000000000b', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OX cancelada', :K2::uuid),
  ('0ce00000-0000-0000-0000-00000000000f', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'OPAR recibida solo en parte', :K2::uuid);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, moneda, contrato_id)
VALUES ('0ce00000-0000-0000-0000-00000000000a', :C::uuid, :C1::uuid, :P2::uuid, 'Servicios Bloque B', 'OU flujo completo en USD', 'USD', :K3::uuid);
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto) VALUES
  ('0ce10000-0000-0000-0000-000000000009', :C::uuid, '0ce00000-0000-0000-0000-000000000009', 1, 'Material', 'gasto', 'mantenimiento', 10, 'unidad', 100, 120),
  ('0ce10000-0000-0000-0000-00000000000a', :C::uuid, '0ce00000-0000-0000-0000-00000000000a', 1, 'Servicio en dólares', 'gasto', 'servicios', 5, 'unidad', 20, 12),
  ('0ce10000-0000-0000-0000-00000000000b', :C::uuid, '0ce00000-0000-0000-0000-00000000000b', 1, 'Material', 'gasto', 'mantenimiento', 1, 'unidad', 70, 0),
  ('0ce10000-0000-0000-0000-00000000000f', :C::uuid, '0ce00000-0000-0000-0000-00000000000f', 1, 'Material', 'gasto', 'mantenimiento', 10, 'unidad', 50, 0);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN ('0ce00000-0000-0000-0000-000000000009', '0ce00000-0000-0000-0000-00000000000a', '0ce00000-0000-0000-0000-00000000000b', '0ce00000-0000-0000-0000-00000000000f');
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN ('0ce00000-0000-0000-0000-000000000009', '0ce00000-0000-0000-0000-00000000000a', '0ce00000-0000-0000-0000-00000000000f');
UPDATE public.ordenes_compra SET estado = 'cancelada', motivo_anulacion = 'Pedido duplicado' WHERE id = '0ce00000-0000-0000-0000-00000000000b';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES
  ('0ce20000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, '0ce00000-0000-0000-0000-000000000009', 'bienes'),
  ('0ce20000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, '0ce00000-0000-0000-0000-00000000000a', 'bienes'),
  ('0ce20000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, '0ce00000-0000-0000-0000-000000000009', 'bienes'),
  ('0ce20000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, '0ce00000-0000-0000-0000-00000000000f', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario) VALUES
  (:C::uuid, '0ce20000-0000-0000-0000-000000000001', '0ce10000-0000-0000-0000-000000000009', 6, 100),
  (:C::uuid, '0ce20000-0000-0000-0000-000000000002', '0ce10000-0000-0000-0000-00000000000a', 5, 20),
  (:C::uuid, '0ce20000-0000-0000-0000-000000000003', '0ce10000-0000-0000-0000-000000000009', 4, 100),
  (:C::uuid, '0ce20000-0000-0000-0000-000000000004', '0ce10000-0000-0000-0000-00000000000f', 4, 50);
UPDATE public.recepciones SET estado = 'registrada' WHERE id IN ('0ce20000-0000-0000-0000-000000000001', '0ce20000-0000-0000-0000-000000000002', '0ce20000-0000-0000-0000-000000000003', '0ce20000-0000-0000-0000-000000000004');
RESET ROLE;

SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE res_k (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_k TO authenticated;
INSERT INTO res_k SELECT 'fg', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","orden_compra_id":"0ce00000-0000-0000-0000-000000000009","numero_factura":"CK-G1","concepto":"Factura de 6","clave_idempotencia":"ck-clave-g1"}'::jsonb,
  '[{"orden_compra_linea_id":"0ce10000-0000-0000-0000-000000000009","cantidad":6,"precio_unitario":100,"iva_monto":72}]'::jsonb);
INSERT INTO res_k SELECT 'fu', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000002","orden_compra_id":"0ce00000-0000-0000-0000-00000000000a","numero_factura":"CK-U1","concepto":"Factura en USD","clave_idempotencia":"ck-clave-u1"}'::jsonb,
  '[{"orden_compra_linea_id":"0ce10000-0000-0000-0000-00000000000a","cantidad":5,"precio_unitario":20,"iva_monto":12}]'::jsonb);
SELECT public.como(:UA::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura IN ('CK-G1', 'CK-U1');
INSERT INTO public.ordenes_pago (id, company_id, project_id, proveedor_id, factura_id, monto, metodo_pago, referencia)
SELECT '0ce30000-0000-0000-0000-000000000001', f.company_id, f.project_id, f.proveedor_id, f.id, 300, 'transferencia', 'CK-TRF-300'
  FROM public.facturas_proveedor f WHERE f.numero_factura = 'CK-G1';
UPDATE public.ordenes_pago SET estado = 'pagada', fecha_pago = CURRENT_DATE WHERE id = '0ce30000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-00000000000a'), 'cerrada', '7 · la orden en USD quedó recibida y facturada (cerrada)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0ce00000-0000-0000-0000-00000000000f'), 'recibida_parcial', '7 · la orden OPAR quedó recibida en parte (4 de 10)');

-- Contabilidad: cada indicador por separado y por moneda.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE sk AS SELECT public.compras_contrato_seguimiento(:K2::uuid) AS j2, public.compras_contrato_seguimiento(:K3::uuid) AS j3,
                                public.compras_contrato_seguimiento(:K1::uuid) AS j1;
GRANT ALL ON sk TO authenticated;
SELECT public.chk_bool((SELECT (j2->>'contabilidad_visible')::boolean FROM sk), true, '7 · Contabilidad ve lo financiero del contrato');
SELECT public.chk((SELECT jsonb_array_length(j2->'por_moneda') FROM sk), 1, '7 · K2 (GTQ) solo tiene la moneda GTQ: no se mezclan monedas');
SELECT public.chk_txt((SELECT j2->'por_moneda'->0->>'moneda' FROM sk), 'GTQ', '7 · …y es GTQ');
SELECT public.chk((SELECT jsonb_array_length(j3->'por_moneda') FROM sk), 1, '7 · K3 (USD) solo tiene USD');
SELECT public.chk_txt((SELECT j3->'por_moneda'->0->>'moneda' FROM sk), 'USD', '7 · …y es USD');
-- K2: comprometido = enorme 5 000 000 + OF 1 120 (la OX cancelada no cuenta).
SELECT public.chk_num((SELECT (j2->'por_moneda'->0->>'comprometido')::numeric FROM sk), 5001620, '7 · comprometido de K2 = 5 000 000 + 1 120 + 500 (la orden cancelada no compromete)');
SELECT public.chk_num((SELECT (j2->'por_moneda'->0->>'facturado')::numeric FROM sk), 672, '7 · facturado de K2 = 672 (distinto de lo comprometido)');
SELECT public.chk_num((SELECT (j2->'por_moneda'->0->>'pagado')::numeric FROM sk), 300, '7 · pagado de K2 = 300 (distinto de lo facturado)');
SELECT public.chk_num((SELECT (j2->'por_moneda'->0->>'pendiente_por_facturar')::numeric FROM sk), 600,
  '7 · pendiente por facturar de K2 = 4 × 100 (OF) + 4 × 50 (OPAR), recibidas y sin facturar (#918: por renglón, a precio de la orden)');
SELECT public.chk_num((SELECT (j2->'por_moneda'->0->>'pendiente_por_recibir')::numeric FROM sk), 5000300,
  '7 · pendiente por recibir de K2 = 5 000 000 (orden enorme) + 6 × 50 (la orden parcial)');
SELECT public.chk_bool((SELECT (j2->'contrato'->>'sin_limite_total')::boolean FROM sk), true, '7 · K2 no tiene monto máximo: sin límite total');
SELECT public.chk_bool((SELECT (j2->'contrato'->'monto_maximo_vigente') = 'null'::jsonb FROM sk), true, '7 · …y no se inventa ningún total');
SELECT public.chk_bool((SELECT (j2->'contrato'->>'indefinido')::boolean FROM sk), true, '7 · K2 es recurrente e indefinido: se muestra su importe periódico y vigencia, no un tope');
SELECT public.chk_num((SELECT (j2->'contrato'->>'importe_periodico')::numeric FROM sk), 500, '7 · importe periódico mensual de 500');
-- Cuadra con el seguimiento de la orden (misma lógica de #918).
SELECT public.chk_num((SELECT (j2->'por_moneda'->0->>'recibido')::numeric FROM sk),
  (SELECT (public.compras_seguimiento_orden('0ce00000-0000-0000-0000-000000000009')->'indicadores'->>'recibido')::numeric
        + (public.compras_seguimiento_orden('0ce00000-0000-0000-0000-00000000000d')->'indicadores'->>'recibido')::numeric
        + (public.compras_seguimiento_orden('0ce00000-0000-0000-0000-00000000000f')->'indicadores'->>'recibido')::numeric),
  '7 · lo recibido del contrato es la suma de lo recibido de sus órdenes');
-- K3 en USD.
SELECT public.chk_num((SELECT (j3->'por_moneda'->0->>'facturado')::numeric FROM sk), 112, '7 · K3 facturado 112 USD (5 × 20 + IVA 12)');
-- K1: contratado (original, ampliación y vigente) distinto de lo comprometido.
SELECT public.chk_num((SELECT (j1->'contrato'->>'monto_maximo_original')::numeric FROM sk), 1000, '7 · K1 contratado original 1000');
SELECT public.chk_num((SELECT (j1->'contrato'->>'ampliaciones_total')::numeric FROM sk), 1000, '7 · …ampliaciones documentadas 1000');
SELECT public.chk_num((SELECT (j1->'contrato'->>'monto_maximo_vigente')::numeric FROM sk), 2000, '7 · …monto máximo vigente 2000');
SELECT public.chk_num((SELECT (j1->'por_moneda'->0->>'comprometido')::numeric FROM sk), 1400,
  '7 · K1 comprometido 1400 (600 + 300 + 500; la cancelada de 400 no cuenta)');
SELECT public.chk_num((SELECT (j1->'por_moneda'->0->>'disponible')::numeric FROM sk), 600, '7 · K1 disponible 600 = vigente 2000 − comprometido 1400');
SELECT public.chk((SELECT jsonb_array_length(j1->'ampliaciones') FROM sk), 1, '7 · la ampliación aparece documentada en el seguimiento');
SELECT public.chk_bool((SELECT jsonb_array_length(j1->'eventos') > 0 FROM sk), true, '7 · y el historial del contrato');
SELECT public.chk((SELECT jsonb_array_length(j2->'facturas') FROM sk), 1, '7 · K2 muestra su factura');
SELECT public.chk((SELECT jsonb_array_length(j2->'pagos') FROM sk), 1, '7 · …y su pago');
SELECT public.chk((SELECT jsonb_array_length(j2->'recepciones') FROM sk), 3, '7 · …y sus tres recepciones');
SELECT public.chk((SELECT jsonb_array_length(j2->'renovaciones') FROM sk), 1, '7 · …y la renovación que lo continúa');
SELECT public.chk((SELECT jsonb_array_length(j2->'ordenes') FROM sk), 4, '7 · K2 lista sus cuatro órdenes (una cancelada, que no compromete; una recibida en parte)');
RESET ROLE;

-- Operaciones con la pestaña de contratos, sin Contabilidad: ve el contrato y sus cantidades, no el dinero.
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE sk_q AS SELECT public.compras_contrato_seguimiento(:K2::uuid) AS j;
GRANT ALL ON sk_q TO authenticated;
SELECT public.chk_bool((SELECT (j->>'contabilidad_visible')::boolean FROM sk_q), false, '8 · Operaciones no tiene Contabilidad visible');
SELECT public.chk_bool((SELECT (j->'por_moneda'->0->>'facturado') IS NULL FROM sk_q), true, '8 · …no recibe lo facturado (NULL desde el servidor)');
SELECT public.chk_bool((SELECT (j->'por_moneda'->0->>'pagado') IS NULL FROM sk_q), true, '8 · …ni lo pagado');
SELECT public.chk_bool((SELECT (j->'por_moneda'->0->>'pendiente_por_facturar') IS NULL FROM sk_q), true, '8 · …ni el pendiente por facturar');
SELECT public.chk((SELECT jsonb_array_length(j->'facturas') FROM sk_q), 0, '8 · …ni las facturas');
SELECT public.chk((SELECT jsonb_array_length(j->'pagos') FROM sk_q), 0, '8 · …ni los pagos');
SELECT public.chk_num((SELECT (j->'por_moneda'->0->>'pendiente_por_recibir')::numeric FROM sk_q), 5000300,
  '8 · sí ve lo que falta por recibir (la orden enorme aprobada aún no recibe nada y la parcial debe 6 × 50)');
SELECT public.chk((SELECT jsonb_array_length(j->'recepciones') FROM sk_q), 3, '8 · y las recepciones');
RESET ROLE;

-- Sin acceso: otro proyecto, otra empresa, sin permiso.
SELECT public.como(:UR::uuid);   -- solo C2
SET ROLE authenticated;
SELECT public.chk_bool(public.compras_contrato_seguimiento(:K1::uuid) IS NULL, true, '8 · quien solo tiene el proyecto C2 no ve el seguimiento de un contrato de C1');
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE id::text LIKE 'cf000000-%'), 0, '8 · …ni lee los contratos de C1');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.compras_contrato_seguimiento(:K1::uuid) IS NULL, true, '8 · otra empresa no ve el seguimiento');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.compras_contrato_seguimiento(:K1::uuid) IS NULL, true, '8 · sin ningún permiso, tampoco');
RESET ROLE;
SELECT public.como(:UO::uuid);   -- operador con órdenes pero SIN la pestaña de contratos ni Contabilidad
SET ROLE authenticated;
SELECT public.chk_bool(public.compras_contrato_seguimiento(:K1::uuid) IS NULL, true, '8 · operador de órdenes sin la pestaña de contratos: no ve el seguimiento del contrato');
RESET ROLE;

-- ═════════════ 9 · EVALUACIONES ═══════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.evaluaciones_proveedor (company_id, project_id, nombre_proveedor, calificacion)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','Alguien en texto libre', 4) $$,
  'EVALUACION_PROVEEDOR_REQUERIDO', '9 · no se evalúa a «alguien» en texto libre: hace falta un proveedor del catálogo');
INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_catalogo_id, calificacion, puntualidad, calidad, precio, cumplimiento, comunicacion, comentarios, evaluado_por_id, evaluado_por)
VALUES ('0ce40000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 4, 4, 5, 3, 4, 5, 'Buen servicio', :UB::uuid, 'Otra persona');
RESET ROLE;
SELECT public.chk_uuid((SELECT evaluado_por_id FROM public.evaluaciones_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000001'), :UA::uuid,
  '9 · el evaluador lo sella el servidor (no se firma a nombre de otra persona)');
SELECT public.chk_txt((SELECT evaluado_por FROM public.evaluaciones_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000001'), 'BB Admin C',
  '9 · y su nombre sale de su perfil');
SELECT public.chk_txt((SELECT nombre_proveedor FROM public.evaluaciones_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000001'), 'Ferretería Bloque B',
  '9 · el nombre del proveedor sale del catálogo');

SET ROLE authenticated;
INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_catalogo_id, contrato_id, orden_compra_id, calificacion, comentarios)
VALUES ('0ce40000-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, :K1::uuid, '0ce00000-0000-0000-0000-000000000001', 5, 'Cumplió el contrato');
SELECT public.chk_falla($$ INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, contrato_id, calificacion)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000002','cf000000-0000-0000-0000-000000000001', 3) $$,
  'EVALUACION_PROVEEDOR_CONTRATO', '9 · el contrato debe ser del proveedor evaluado');
SELECT public.chk_falla($$ INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, contrato_id, orden_compra_id, calificacion)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','cf000000-0000-0000-0000-000000000002','0ce00000-0000-0000-0000-000000000001', 3) $$,
  'EVALUACION_ORDEN_CONTRATO', '9 · la orden debe estar amparada en el contrato indicado');
SELECT public.chk_falla($$ INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, calificacion)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-0000000000d1', 3) $$,
  'EVALUACION_PROVEEDOR_AJENO', '9 · no se evalúa a un proveedor de otra empresa');
SELECT public.chk_falla($$ INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, orden_compra_id, calificacion)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c2c2c2c2-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','0ce00000-0000-0000-0000-000000000001', 3) $$,
  'EVALUACION_ORDEN_AJENA', '9 · la orden debe ser del mismo proyecto de la evaluación');

-- Una evaluación NEGATIVA no suspende al proveedor.
INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_catalogo_id, contrato_id, calificacion, comentarios)
VALUES ('0ce40000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, :K1::uuid, 1, 'Entregas tardías y mala calidad');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.proveedores WHERE id = :P1::uuid), 'autorizado',
  '9 · una evaluación negativa NO suspende al proveedor: eso lo decide quien tiene el permiso de cambio de estado');
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = :K1::uuid), 'activo', '9 · …ni toca el contrato');
SELECT public.chk_bool((SELECT negativa FROM public.evaluaciones_por_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000003'), true,
  '9 · la vista la marca como negativa (solo señala)');
SELECT public.chk_uuid((SELECT proveedor_catalogo_id FROM public.evaluaciones_por_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000003'), :P1::uuid,
  '9 · la vista resuelve el proveedor del catálogo');
SELECT public.chk_uuid((SELECT contrato_id FROM public.evaluaciones_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000003'),
  (SELECT proveedor_id FROM public.evaluaciones_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000003'),
  '9 · el espejo legado (proveedor_id) coincide con el contrato');

-- Inmutabilidad y legado.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.evaluaciones_proveedor SET evaluado_por_id = 'c0c0c0c0-0000-0000-0000-00000000000b' WHERE id = '0ce40000-0000-0000-0000-000000000001' $$,
  'EVALUACION_INMUTABLE', '9 · el evaluador no se reescribe');
SELECT public.chk_falla($$ UPDATE public.evaluaciones_proveedor SET proveedor_catalogo_id = 'e3000000-0000-0000-0000-000000000002' WHERE id = '0ce40000-0000-0000-0000-000000000001' $$,
  'EVALUACION_INMUTABLE', '9 · el proveedor evaluado no se cambia');
UPDATE public.evaluaciones_proveedor SET comentarios = 'Buen servicio, con una observación' WHERE id = '0ce40000-0000-0000-0000-000000000001';
-- Estilo legado: proveedor_id apuntando a un contrato (lo que escribía la pantalla anterior).
INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_id, nombre_proveedor, calificacion)
VALUES ('0ce40000-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :K2::uuid, 'Ferretería Bloque B', 4);
RESET ROLE;
SELECT public.chk_uuid((SELECT proveedor_catalogo_id FROM public.evaluaciones_proveedor WHERE id = '0ce40000-0000-0000-0000-000000000004'), :P1::uuid,
  '9 · una evaluación al estilo antiguo (por contrato) queda ligada al proveedor del catálogo');

-- Aislamiento de las evaluaciones.
SELECT public.como(:UR::uuid);   -- solo C2, con la pestaña de evaluaciones
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.evaluaciones_proveedor WHERE id::text LIKE '0ce40000-%'), 0, '9 · quien solo tiene C2 no lee las evaluaciones de C1');
SELECT public.chk_falla($$ INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_catalogo_id, calificacion)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001', 3) $$,
  'row-level security', '9 · …ni evalúa en C1');
RESET ROLE;
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.evaluaciones_por_proveedor WHERE id::text LIKE '0ce40000-%'), 0, '9 · otra empresa no ve las evaluaciones (ni por la vista)');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.evaluaciones_proveedor WHERE id::text LIKE '0ce40000-%'), 0, '9 · sin el permiso de evaluaciones, tampoco');
RESET ROLE;
SELECT public.como(:UA::uuid);
