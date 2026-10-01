\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CONTRATOS DE PROVEEDOR
-- Continúa el estado de assert_identidad.sql: P1 «Ferretería La Unión»
-- (autorizado, habilitado en A1, pendiente en A2), sus dos contactos y una OC.
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B     '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set B1    '''b1b1b1b1-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UP1   '''a0a0a0a0-0000-0000-0000-00000000000f'''
\set UP2   '''a0a0a0a0-0000-0000-0000-000000000012'''
\set UO    '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set UN    '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set UB    '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set P1    '''d1000000-0000-0000-0000-0000000000a1'''

SELECT public.como(:UA::uuid);

-- Otros proveedores para escenarios concretos (creados por el admin).
SET ROLE authenticated;
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais) VALUES
  ('d2000000-0000-0000-0000-0000000000a6', :A::uuid, 'Servicios Eléctricos del Norte', '5550001-1', 'GT'),
  ('d2000000-0000-0000-0000-0000000000a7', :A::uuid, 'Proveedor suspendido', '5550002-2', 'GT'),
  ('d2000000-0000-0000-0000-0000000000a8', :A::uuid, 'Proveedor vetado',     '5550003-3', 'GT');
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = 'd2000000-0000-0000-0000-0000000000a6';
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = 'd2000000-0000-0000-0000-0000000000a7';
UPDATE public.proveedores SET estado = 'vetado', motivo_estado = 'Fraude' WHERE id = 'd2000000-0000-0000-0000-0000000000a8';
RESET ROLE;

-- ── 1. Alta: lo que se rechaza ──────────────────────────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, estado)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'Texto libre', '2026-01-01', 'recurrente', 'mensual', 'borrador') $$,
  'CONTRATO_PROVEEDOR_REQUERIDO', '1 · un contrato NUEVO ya no admite proveedor solo en texto libre');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, estado)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente', 'mensual', 'activo') $$,
  'CONTRATO_ALTA_BORRADOR', '1 · los contratos nuevos nacen en borrador: no se activan al insertarlos');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000b1', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'CONTRATO_PROVEEDOR_AJENO', '1 · el proveedor de OTRA empresa se rechaza');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b1b1b1b1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'row-level security|CONTRATO_PROYECTO_AJENO', '1 · el proyecto de OTRA empresa se rechaza');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01') $$,
  'CONTRATO_MODALIDAD_REQUERIDA', '1 · sin modalidad (recurrente / por demanda) se rechaza');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente') $$,
  'CONTRATO_PERIODICIDAD_REQUERIDA', '1 · un servicio recurrente exige su periodicidad');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, importe_periodico, moneda)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'por_demanda', 100, 'GTQ') $$,
  'CONTRATO_IMPORTE_PERIODICO', '1 · una compra por demanda no lleva importe periódico');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, fecha_fin, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-06-01', '2026-01-01', 'recurrente', 'mensual') $$,
  'contratos_prov_vigencia', '1 · la fecha de fin no puede ser anterior a la de inicio');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd2000000-0000-0000-0000-0000000000a7', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'CONTRATO_PROVEEDOR_NO_AUTORIZADO', '1 · a un proveedor SUSPENDIDO no se le crean contratos nuevos');

SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd2000000-0000-0000-0000-0000000000a8', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'CONTRATO_PROVEEDOR_NO_AUTORIZADO', '1 · ni a uno VETADO');
RESET ROLE;

-- ── 2. Alta correcta: fotografía, contacto y compatibilidad ─────────────────
SET ROLE authenticated;
-- C1: recurrente mensual, con contacto del catálogo.
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, contacto_id, proveedor_nombre, servicio, fecha_inicio, fecha_fin,
   modalidad, periodicidad, moneda, importe_periodico, alcance, referencia)
VALUES ('cc000000-0000-0000-0000-0000000000c1', :A::uuid, :A1::uuid, :P1::uuid, 'c0000000-0000-0000-0000-0000000000a1',
        'LO QUE SEA QUE ESCRIBA EL CLIENTE', 'mantenimiento', '2026-01-01', '2026-12-31',
        'recurrente', 'mensual', 'GTQ', 1500.00, 'Mantenimiento mensual de herramientas', 'CTR-001');
-- C2: por demanda, con contacto del catálogo Y contacto propio del contrato.
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, contacto_id, proveedor_nombre, proveedor_contacto, fecha_inicio,
   modalidad, moneda, monto_maximo, alcance, referencia)
VALUES ('cc000000-0000-0000-0000-0000000000c2', :A::uuid, :A1::uuid, :P1::uuid, 'c0000000-0000-0000-0000-0000000000a2',
        'x', 'Contacto de obra (Luis)', '2026-01-01', 'por_demanda', 'GTQ', 20000.00,
        'Compras a demanda de ferretería', 'CTR-002');
-- C3 y C3b: borradores.
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, moneda, importe_periodico)
VALUES ('cc000000-0000-0000-0000-0000000000c3', :A::uuid, :A1::uuid, :P1::uuid, 'x', '2026-02-01', 'recurrente', 'trimestral', 'GTQ', 900),
       ('cc000000-0000-0000-0000-0000000000b3', :A::uuid, :A1::uuid, :P1::uuid, 'x', '2026-02-01', 'recurrente', 'anual', 'GTQ', 100);
-- C5: otro proveedor, para probar que cambiar al proveedor no reescribe lo firmado.
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, moneda, importe_periodico)
VALUES ('cc000000-0000-0000-0000-0000000000c5', :A::uuid, :A1::uuid, 'd2000000-0000-0000-0000-0000000000a6', 'x',
        '2026-01-01', 'recurrente', 'mensual', 'USD', 300);
RESET ROLE;

SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'Ferretería La Unión', '2 · el nombre sale del PROVEEDOR del catálogo, no de lo que mande el cliente');
SELECT public.chk_txt((SELECT proveedor_snapshot ->> 'nit' FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  '1234567-8', '2 · la fotografía guarda la identificación fiscal del momento');
SELECT public.chk_bool(
  (SELECT proveedor_snapshot ->> 'codigo' = (SELECT codigo FROM public.proveedores WHERE id = :P1::uuid)
     FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  true, '2 · …y el código visible del proveedor');
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'borrador', '2 · el contrato nuevo nace en borrador');
SELECT public.chk_txt((SELECT proveedor_contacto FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'Marta Ruiz', '2 · el contrato reutiliza el contacto del proveedor (copia)');
SELECT public.chk_txt((SELECT proveedor_contacto FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c2'),
  'Contacto de obra (Luis)', '2 · y admite un contacto ESPECÍFICO del contrato, que no se pisa');
SELECT public.chk_txt((SELECT proveedor_email FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c2'),
  'pedro@launion.test', '2 · lo que no se escribió se completa desde el contacto del catálogo');
SELECT public.chk((SELECT monto_mensual FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1')::bigint, 1500,
  '2 · monto_mensual (legado) se proyecta SOLO si la periodicidad es mensual');
SELECT public.chk_bool((SELECT monto_mensual IS NULL FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c3'),
  true, '2 · un contrato trimestral NO fuerza un monto mensual');
SELECT public.chk_bool((SELECT monto_mensual IS NULL AND importe_periodico IS NULL
                          FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c2'),
  true, '2 · una compra por demanda no tiene importe periódico ni mensual');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos
                    WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000c1' AND tipo = 'alta'), 1,
  '2 · el alta queda en el historial del contrato');

SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores
    (company_id, project_id, proveedor_id, contacto_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd2000000-0000-0000-0000-0000000000a6', 'c0000000-0000-0000-0000-0000000000a1', 'x',
          '2026-01-01', 'recurrente', 'mensual') $$,
  'CONTRATO_CONTACTO_AJENO', '2 · el contacto de OTRO proveedor se rechaza');
SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores
    (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad, referencia)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente', 'mensual', 'ctr-001') $$,
  'uq_contratos_prov_referencia', '2 · la referencia es única por proyecto (sin distinguir mayúsculas)');
RESET ROLE;

-- ── 3. Activar NO genera nada contable ni de compras ────────────────────────
CREATE TEMP TABLE antes AS
SELECT (SELECT count(*) FROM public.facturas_proveedor) AS facturas,
       (SELECT count(*) FROM public.ordenes_pago)       AS pagos,
       (SELECT count(*) FROM public.ordenes_compra)     AS ordenes,
       (SELECT count(*) FROM public.conta_asientos)     AS asientos,
       (SELECT count(*) FROM public.recepciones)        AS recepciones;
GRANT SELECT ON antes TO authenticated;

SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_DATOS_INCOMPLETOS', '3 · activar sin responsable se rechaza');
UPDATE public.contratos_proveedores SET responsable_id = 'a0a0a0a0-0000-0000-0000-00000000000a'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
UPDATE public.contratos_proveedores SET responsable_id = 'a0a0a0a0-0000-0000-0000-00000000000a', estado = 'activo'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c2';
RESET ROLE;

SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'activo', '3 · con sus datos completos el contrato se activa');
SELECT public.chk_bool((SELECT activado_at IS NOT NULL AND activado_por IS NOT NULL
                          FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  true, '3 · y queda sellado con quién y cuándo');
SELECT public.chk(
  (SELECT count(*) FROM public.facturas_proveedor) - (SELECT facturas FROM antes), 0,
  '3 · activar contratos NO genera facturas');
SELECT public.chk(
  (SELECT count(*) FROM public.ordenes_pago) - (SELECT pagos FROM antes), 0,
  '3 · …ni pagos');
SELECT public.chk(
  (SELECT count(*) FROM public.ordenes_compra) - (SELECT ordenes FROM antes), 0,
  '3 · …ni órdenes de compra');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos) - (SELECT asientos FROM antes), 0,
  '3 · …ni asientos contables');
SELECT public.chk(
  (SELECT count(*) FROM public.recepciones) - (SELECT recepciones FROM antes), 0,
  '3 · …ni recepciones');

-- ── 4. Lo firmado no se reescribe ───────────────────────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET proveedor_nombre = 'Otro nombre' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_FOTOGRAFIA_INMUTABLE', '4 · el nombre fotografiado no se edita');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET proveedor_snapshot = '{}'::jsonb WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_FOTOGRAFIA_INMUTABLE', '4 · la fotografía tampoco');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET proveedor_id = 'd2000000-0000-0000-0000-0000000000a6' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_PROVEEDOR_INMUTABLE', '4 · el proveedor de un contrato no cambia (se termina y se crea otro)');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET importe_periodico = 2000 WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_CONDICIONES_CONGELADAS', '4 · las condiciones económicas de un contrato activo no se editan');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET moneda = 'USD' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_CONDICIONES_CONGELADAS', '4 · …ni su moneda');
UPDATE public.contratos_proveedores SET notas = 'Nota operativa', descripcion = 'Descripción ampliada'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.chk_txt((SELECT notas FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'Nota operativa', '4 · lo operativo (notas, descripción) sí se edita');

-- Cambiar al PROVEEDOR no reescribe el contrato.
UPDATE public.proveedores SET nombre = 'Eléctricos del Norte, S.A.', nit = '9990009-9', direccion = 'Zona 4'
 WHERE id = 'd2000000-0000-0000-0000-0000000000a6';
SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c5'),
  'Servicios Eléctricos del Norte', '4 · renombrar al proveedor NO cambia el nombre del contrato firmado');
SELECT public.chk_txt((SELECT proveedor_snapshot ->> 'nit' FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c5'),
  '5550001-1', '4 · ni su identificación fiscal fotografiada');
UPDATE public.proveedor_contactos SET email = 'nuevo@launion.test' WHERE id = 'c0000000-0000-0000-0000-0000000000a1';
SELECT public.chk_txt((SELECT proveedor_email FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'marta@launion.test', '4 · cambiar el contacto del catálogo no altera el contacto del contrato');

-- Prórroga: se permite con proveedor habilitado y queda en el historial.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET fecha_fin = '2027-06-30' WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos
                    WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000c1' AND tipo = 'prorroga'), 1,
  '4 · prorrogar (con proveedor habilitado) queda registrado');

-- ── 5. Orden de compra ↔ contrato ───────────────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, contrato_id)
VALUES ('0c000000-0000-0000-0000-0000000000c2', :A::uuid, :A1::uuid, :P1::uuid, 'Ferretería La Unión',
        'Compra al amparo del contrato', 'borrador', 'cc000000-0000-0000-0000-0000000000c2');
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, contrato_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', 'Otro proyecto', 'borrador', 'cc000000-0000-0000-0000-0000000000c2') $$,
  'COMPRAS_CONTRATO_PROYECTO', '5 · una orden no se liga a un contrato de OTRO proyecto');
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, contrato_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd2000000-0000-0000-0000-0000000000a6', 'x', 'Otro proveedor', 'borrador', 'cc000000-0000-0000-0000-0000000000c2') $$,
  'COMPRAS_CONTRATO_PROVEEDOR', '5 · …ni a un contrato de OTRO proveedor');
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, contrato_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', 'Contrato en borrador', 'borrador', 'cc000000-0000-0000-0000-0000000000c3') $$,
  'COMPRAS_CONTRATO_NO_ACTIVO', '5 · …ni a un contrato que no está activo');
RESET ROLE;

-- Un contrato de OTRA empresa (insertado como sistema; ningún usuario de A podría).
SET conta.allow_system_write = on;
INSERT INTO public.contratos_proveedores (id, company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, estado)
VALUES ('cc000000-0000-0000-0000-0000000000b1', :B::uuid, :B1::uuid, 'd1000000-0000-0000-0000-0000000000b1',
        'Ferretería La Unión', '2026-01-01', 'activo');
RESET conta.allow_system_write;
SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, contrato_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', 'Contrato ajeno', 'borrador', 'cc000000-0000-0000-0000-0000000000b1') $$,
  'COMPRAS_CONTRATO_AJENO|row-level security', '5 · …ni a un contrato de OTRA empresa');
RESET ROLE;

-- ── 6. Suspender al PROVEEDOR: qué bloquea y qué deja abierto ───────────────
-- La orden aprobada de antes (0c..a1) y los contratos activos siguen en pie.
UPDATE public.proveedores SET estado = 'suspendido', motivo_estado = 'Papelería vencida' WHERE id = :P1::uuid;
SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'CONTRATO_PROVEEDOR_NO_AUTORIZADO', '6 · BLOQUEA: crear contratos nuevos');
UPDATE public.contratos_proveedores SET responsable_id = 'a0a0a0a0-0000-0000-0000-00000000000a'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c3';
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'cc000000-0000-0000-0000-0000000000c3' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '6 · BLOQUEA: activar un contrato en borrador');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET fecha_fin = '2028-12-31' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '6 · BLOQUEA: prorrogar un contrato vigente');
SELECT public.chk_falla($$
  INSERT INTO public.ordenes_compra (company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', 'Orden nueva', 'aprobada') $$,
  'COMPRAS_PROVEEDOR_NO_AUTORIZADO', '6 · BLOQUEA: aprobar órdenes de compra nuevas (candado existente)');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'activo', '6 · NO borra obligaciones: el contrato activo sigue activo');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = '0c000000-0000-0000-0000-0000000000a1'), 1,
  '6 · …y la orden de compra ya aprobada sigue en pie');

-- Las vías para resolver lo anterior siguen abiertas.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET estado = 'suspendido', motivo_estado = 'Se suspende mientras se aclara la papelería'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_PROVEEDOR_NO_HABILITADO', '6 · BLOQUEA: reanudar mientras el proveedor sigue suspendido');
UPDATE public.contratos_proveedores SET estado = 'terminado', motivo_estado = 'Terminación acordada con el proveedor'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c2';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c2'),
  'terminado', '6 · PERMITE: terminar un contrato con proveedor suspendido');
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'suspendido', '6 · PERMITE: suspender un contrato');

-- Se restablece al proveedor para lo que sigue.
UPDATE public.proveedores SET estado = 'autorizado', motivo_estado = NULL WHERE id = :P1::uuid;
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'activo', '6 · con el proveedor de nuevo autorizado, el contrato se reanuda');

-- ── 7. Ciclo de vida: motivo, transiciones e historial ──────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'terminado' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_MOTIVO_REQUERIDO', '7 · terminar exige motivo');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'terminado', motivo_estado = '   ' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_MOTIVO_REQUERIDO', '7 · …y un motivo en blanco no vale');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = 'cc000000-0000-0000-0000-0000000000c2' $$,
  'CONTRATO_TRANSICION_INVALIDA', '7 · un contrato terminado no se reabre');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'borrador' WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_TRANSICION_INVALIDA', '7 · un contrato activo no vuelve a borrador');
RESET ROLE;

-- C5: se activa y se termina con motivo; comprobar historial y sellos.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET responsable_id = 'a0a0a0a0-0000-0000-0000-00000000000a', estado = 'activo'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c5';
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET estado = 'terminado' WHERE id = 'cc000000-0000-0000-0000-0000000000c5' $$,
  'CONTRATO_MOTIVO_REQUERIDO', '7 · terminar sin motivo se rechaza también en un contrato que no se suspendió antes');
UPDATE public.contratos_proveedores SET estado = 'terminado', motivo_estado = 'Servicio concluido sin renovación'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c5';
RESET ROLE;
SELECT public.chk_bool((SELECT terminado_at IS NOT NULL AND terminado_por IS NOT NULL
                          FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c5'),
  true, '7 · terminar sella quién y cuándo');
SELECT public.chk_txt((SELECT motivo FROM public.contrato_proveedor_eventos
                        WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000c5' AND tipo = 'estado'
                          AND estado_nuevo = 'terminado'),
  'Servicio concluido sin renovación', '7 · el motivo queda en el historial');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos
                    WHERE contrato_id = 'cc000000-0000-0000-0000-0000000000c1' AND tipo = 'estado'), 3,
  '7 · C1 acumuló sus 3 cambios de estado en el historial (activar, suspender, reanudar)');

-- C3: cancelar un borrador con motivo.
SET ROLE authenticated;
UPDATE public.contratos_proveedores SET estado = 'cancelado', motivo_estado = 'Ya no se necesita'
 WHERE id = 'cc000000-0000-0000-0000-0000000000c3';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c3'),
  'cancelado', '7 · un borrador se cancela con su motivo (no se borra)');

-- El historial no se edita ni se borra desde la aplicación.
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.contrato_proveedor_eventos $$, 'permission denied',
  '7 · el historial del contrato es append-only (sin DELETE para la aplicación)');
SELECT public.chk_falla($$ UPDATE public.contrato_proveedor_eventos SET motivo = 'reescrito' $$, 'permission denied',
  '7 · …ni UPDATE');
SELECT public.chk_falla($$
  INSERT INTO public.contrato_proveedor_eventos (company_id, project_id, contrato_id, tipo)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'cc000000-0000-0000-0000-0000000000c1', 'alta') $$, 'permission denied',
  '7 · …ni INSERT directo (solo los triggers escriben)');
RESET ROLE;

-- ── 8. No se borra lo que tiene historia ────────────────────────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1' $$,
  'CONTRATO_NO_ELIMINABLE', '8 · un contrato activo no se borra: se termina o cancela con motivo');
SELECT public.chk_falla($$ DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c2' $$,
  'CONTRATO_NO_ELIMINABLE', '8 · un contrato terminado (con una orden vinculada) tampoco');
SELECT public.chk_falla($$ DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c3' $$,
  'CONTRATO_NO_ELIMINABLE', '8 · uno cancelado (con historial) tampoco');

-- Borrador con respaldo adjunto: tampoco.
UPDATE public.contratos_proveedores
   SET respaldo_path = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000b3/contrato.pdf'
 WHERE id = 'cc000000-0000-0000-0000-0000000000b3';
SELECT public.chk_falla($$ DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000b3' $$,
  'CONTRATO_NO_ELIMINABLE', '8 · un borrador con respaldo adjunto no se borra');
SELECT public.chk_falla($$
  UPDATE public.contratos_proveedores SET respaldo_path = 'otra-ruta/contrato.pdf'
   WHERE id = 'cc000000-0000-0000-0000-0000000000b3' $$,
  'CONTRATO_RESPALDO_RUTA', '8 · el respaldo solo puede vivir bajo la ruta del propio contrato');

-- Un borrador limpio SÍ se borra.
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
VALUES ('cc000000-0000-0000-0000-0000000000d1', :A::uuid, :A1::uuid, 'd2000000-0000-0000-0000-0000000000a6', 'x', '2026-03-01', 'recurrente', 'mensual');
DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000d1';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000d1'), 0,
  '8 · un borrador sin nada relacionado sí se puede borrar');

-- Un contrato HISTÓRICO activo (proveedor en texto, insertado como sistema).
SET conta.allow_system_write = on;
INSERT INTO public.contratos_proveedores (id, company_id, project_id, proveedor_nombre, fecha_inicio, estado, monto_mensual)
VALUES ('cc000000-0000-0000-0000-0000000000f1', :A::uuid, :A1::uuid, 'Ferretería La Unión', '2024-01-01', 'activo', 800);
RESET conta.allow_system_write;
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000f1' $$,
  'CONTRATO_NO_ELIMINABLE', '8 · tampoco se borra un contrato histórico vigente (ya no se elimina desde el navegador)');
UPDATE public.contratos_proveedores SET estado = 'terminado', motivo_estado = 'Depuración del padrón histórico'
 WHERE id = 'cc000000-0000-0000-0000-0000000000f1';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000f1'),
  'terminado', '8 · el histórico se termina con motivo; su id se conserva');
SELECT public.chk_txt((SELECT proveedor_nombre FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000f1'),
  'Ferretería La Unión', '8 · …y el texto histórico queda intacto');

-- ── 9. Evaluaciones: llegar al proveedor compartido ─────────────────────────
SET ROLE authenticated;
INSERT INTO public.evaluaciones_proveedor (id, company_id, project_id, proveedor_id, nombre_proveedor, calificacion)
VALUES ('e0000000-0000-0000-0000-0000000000e1', :A::uuid, :A1::uuid, 'cc000000-0000-0000-0000-0000000000c1',
        'Ferretería La Unión', 4);
SELECT public.chk_uuid((SELECT proveedor_catalogo_id FROM public.evaluaciones_por_proveedor
                         WHERE id = 'e0000000-0000-0000-0000-0000000000e1'),
  :P1::uuid, '9 · la vista resuelve el proveedor del catálogo a través del contrato');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.evaluaciones_por_proveedor), 0,
  '9 · la vista aplica la RLS de quien consulta (UB no ve evaluaciones de A)');
RESET ROLE;
SELECT public.como(:UA::uuid);

-- Un borrador con evaluación no se borra.
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
VALUES ('cc000000-0000-0000-0000-0000000000d2', :A::uuid, :A1::uuid, :P1::uuid, 'x', '2026-03-01', 'recurrente', 'mensual');
INSERT INTO public.evaluaciones_proveedor (company_id, project_id, proveedor_id, nombre_proveedor, calificacion)
VALUES (:A::uuid, :A1::uuid, 'cc000000-0000-0000-0000-0000000000d2', 'Ferretería La Unión', 3);
SELECT public.chk_falla($$ DELETE FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000d2' $$,
  'CONTRATO_NO_ELIMINABLE', '9 · un borrador con evaluaciones no se borra');
RESET ROLE;

-- ── 10. Aislamiento por empresa y por PROYECTO ──────────────────────────────
-- Otra empresa.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores WHERE company_id = :A::uuid), 0,
  '10 · UB (otra empresa) no ve contratos de A');
SELECT public.chk((SELECT count(*) FROM public.contrato_proveedor_eventos WHERE company_id = :A::uuid), 0,
  '10 · …ni su historial');
UPDATE public.contratos_proveedores SET notas = 'hackeo' WHERE id = 'cc000000-0000-0000-0000-0000000000c1';
SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'row-level security', '10 · UB no crea contratos en un proyecto de A');
RESET ROLE;
SELECT public.chk_txt((SELECT notas FROM public.contratos_proveedores WHERE id = 'cc000000-0000-0000-0000-0000000000c1'),
  'Nota operativa', '10 · UB no modificó el contrato de A (el UPDATE no alcanzó ninguna fila)');

-- Mismo empresa, OTRO proyecto: UP2 solo tiene A2.
SELECT public.como(:UP2::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores), 0,
  '10 · UP2 (solo A2) NO ve los contratos de A1, aunque sea de la misma empresa (alcance por proyecto)');
SELECT public.chk_falla($$
  INSERT INTO public.contratos_proveedores (company_id, project_id, proveedor_id, proveedor_nombre, fecha_inicio, modalidad, periodicidad)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
          'd1000000-0000-0000-0000-0000000000a1', 'x', '2026-01-01', 'recurrente', 'mensual') $$,
  'row-level security', '10 · UP2 no crea contratos en A1');
RESET ROLE;

-- UP1 (solo A1) ve los de A1.
SELECT public.como(:UP1::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.contratos_proveedores), true,
  '10 · UP1 (solo A1) sí ve los contratos de A1');
RESET ROLE;

-- Operativo con la pestaña (UO) ve los de su proyecto; sin pestaña (UN) ve 0.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((SELECT count(*) > 0 FROM public.contratos_proveedores), true,
  '10 · UO (permiso de la pestaña) ve los contratos de su proyecto');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.contratos_proveedores), 0,
  '10 · UN (sin el permiso de la pestaña) no ve ninguno');
RESET ROLE;
SELECT public.como(:UA::uuid);

-- ── 11. Respaldo PRIVADO: acceso resuelto desde la fila del contrato ────────
SELECT public.chk_bool((SELECT NOT public FROM storage.buckets WHERE id = 'contratos-respaldo'), true,
  '11 · el bucket contratos-respaldo es PRIVADO');
SELECT public.chk((SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname LIKE 'contratos_respaldo_%'), 3,
  '11 · el bucket tiene sus tres policies (lectura, alta, borrado) y ninguna de UPDATE');

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  true, '11 · UA accede al respaldo de un contrato de A1');
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  true, '11 · UO (permiso de la pestaña, proyecto asignado) también');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  false, '11 · UN (con acceso al proyecto pero SIN el permiso de la pestaña) no accede');
RESET ROLE;
SELECT public.como(:UP2::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  false, '11 · UP2 (admin de la misma empresa pero asignado solo a A2) no accede');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  false, '11 · UB (otra empresa) no accede');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- Rutas mal formadas o que no coinciden con la fila del contrato.
SELECT public.chk_bool(public.contrato_respaldo_autoriza('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/acta.pdf'),
  false, '11 · una ruta sin la carpeta del contrato se rechaza');
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  false, '11 · una ruta con la EMPRESA equivocada se rechaza');
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a2a2a2a2-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf'),
  false, '11 · una ruta con el PROYECTO equivocado se rechaza');
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000ff/acta.pdf'),
  false, '11 · una ruta de un contrato inexistente se rechaza');
-- Borrar un respaldo: solo mientras el contrato sea borrador.
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000c1/acta.pdf', true),
  false, '11 · borrar el respaldo de un contrato ACTIVO no se autoriza (sería destruir evidencia)');
SELECT public.chk_bool(public.contrato_respaldo_autoriza(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-0000-0000-0000-000000000001/cc000000-0000-0000-0000-0000000000b3/contrato.pdf', true),
  true, '11 · …en un borrador sí');
RESET ROLE;
SELECT public.chk_txt('ok', 'ok', 'CONTRATOS · bloque completo');
