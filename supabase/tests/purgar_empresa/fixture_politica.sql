-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de la POLÍTICA de retención y purga (20261030000000), encima de
-- fixture.sql. Base desechable: NUNCA contra un proyecto remoto.
--
-- X sigue siendo una empresa SIN historia que retener (se purga), pero ahora
-- con una fila en cada tabla que antes sobrevivía a la purga o la hacía fallar:
--
--   A. operación: reglas de acceso de conversaciones, diferenciales
--      cambiarios, una corrida de reporte, un turno FUTURO pendiente;
--   B. personales: una conversación con mensaje, una difusión con destinatario,
--      una solicitud de mudanza y una de renta;
--   C. movimientos que no retienen: un cobro PENDIENTE del cliente compartido
--      C2 (antes sobrevivía con project_id NULL), uno de C1 sobre el convenio
--      de X (antes impedía vaciar convenios_pago), una lectura SIN facturar con
--      su recordatorio y su documento fiscal en BORRADOR;
--   D. configuración que bloqueaba: una regla de compra VIGENTE, una cuenta
--      bancaria y una póliza en BORRADOR con líneas, las tres sobre cuentas del
--      proyecto (RESTRICT al borrar projects).
--
-- Y tiene lo mismo de A, B y C (y una lectura FACTURADA): nada de eso se toca.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- ── A. Operación y configuración ────────────────────────────────────────────
INSERT INTO public.conversation_access_rules (company_id, role) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'admin'),
  ('e2000000-0000-4000-8000-000000000002', 'admin');

INSERT INTO public.conta_diferenciales_cambiarios (company_id, project_id, orden_pago_id, asiento_origen_id, estado) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'pendiente'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(), 'pendiente');

INSERT INTO public.report_templates (id, company_id, name, source_table) VALUES
  ('91000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-000000000001', 'Cobros X', 'pagos'),
  ('92000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000002', 'Cobros Y', 'pagos');
INSERT INTO public.report_runs (template_id, company_id, triggered_by) VALUES
  ('91000000-0000-4000-8000-0000000000a1', 'e1000000-0000-4000-8000-000000000001', 'manual'),
  ('92000000-0000-4000-8000-0000000000a1', 'e2000000-0000-4000-8000-000000000002', 'manual');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('91000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Conserje X'),
  ('92000000-0000-4000-8000-0000000000b1', 'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Conserje Y');
INSERT INTO public.bloques_turno (company_id, project_id, personal_id, turno, fecha) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-0000000000b1', 'manana', CURRENT_DATE + 7),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-0000000000b1', 'manana', CURRENT_DATE + 7);

-- ── B. Comunicaciones y solicitudes (datos personales) ──────────────────────
INSERT INTO public.conversations (id, company_id, project_id, cliente_id, subject) VALUES
  ('91000000-0000-4000-8000-0000000000c1', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'Fuga en A-101'),
  ('92000000-0000-4000-8000-0000000000c1', 'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Ruido en Y-101');
INSERT INTO public.conversation_messages (conversation_id, sender_id, sender_type, body) VALUES
  ('91000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c2', 'cliente', 'Hay una fuga'),
  ('92000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-0000000000c9', 'cliente', 'Hay ruido');

INSERT INTO public.broadcasts (id, company_id, title, body, sent_by_id, sent_by_name, target_type) VALUES
  ('91000000-0000-4000-8000-0000000000d1', 'e1000000-0000-4000-8000-000000000001', 'Corte de agua', '…', 'a0000000-0000-4000-8000-0000000000a2', 'Admin X', 'todos'),
  ('92000000-0000-4000-8000-0000000000d1', 'e2000000-0000-4000-8000-000000000002', 'Asamblea', '…', 'a0000000-0000-4000-8000-0000000000b1', 'Admin Y', 'todos');
INSERT INTO public.broadcast_recipients (broadcast_id, cliente_id) VALUES
  ('91000000-0000-4000-8000-0000000000d1', 'c1000000-0000-4000-8000-000000000002'),
  ('92000000-0000-4000-8000-0000000000d1', 'c2000000-0000-4000-8000-000000000001');

INSERT INTO public.solicitud_mudanza_unidad (company_id, project_id, unidad_id, tipo_mudanza, cliente_id) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'nueva_mudanza', 'c1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'nueva_mudanza', 'c2000000-0000-4000-8000-000000000001');
INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, estado) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'borrador'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'borrador');

-- ── C. Movimientos que no retienen ──────────────────────────────────────────
INSERT INTO public.pagos (id, cliente_id, project_id, monto, metodo, convenio_id) VALUES
  ('91000000-0000-4000-8000-0000000000e1', 'c1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 40, 'transferencia', NULL),
  ('91000000-0000-4000-8000-0000000000e2', 'c1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 30, 'efectivo',
   (SELECT id FROM public.convenios_pago WHERE numero_convenio = 'CONV-X')),
  ('92000000-0000-4000-8000-0000000000e1', 'c2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 40, 'transferencia', NULL);

-- Las lecturas entran como las escribe registrar_lectura (su llave de capacidad).
SELECT set_config('agua.lectura_autoritativa', 'on', false);
INSERT INTO public.registros (id, fecha, project_id, cliente_id, cliente_nombre, estado, factura_estado) VALUES
  ('91000000-0000-4000-8000-0000000000f1', now(), 'f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'Cliente Compartido', 'pendiente', NULL),
  ('92000000-0000-4000-8000-0000000000f1', now(), 'f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Cliente de Y', 'pendiente', NULL),
  ('92000000-0000-4000-8000-0000000000f2', now(), 'f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Cliente de Y', 'pagado', 'pagada');
SELECT set_config('agua.lectura_autoritativa', 'off', false);
INSERT INTO public.registro_recordatorios_log (registro_id, user_id, hito, company_id) VALUES
  ('91000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000c2', 'proximo', 'e1000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000c9', 'proximo', 'e2000000-0000-4000-8000-000000000002');
INSERT INTO public.documentos_fiscales (company_id, regimen, registro_id, estado) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'fel_gt', '91000000-0000-4000-8000-0000000000f1', 'borrador'),
  ('e2000000-0000-4000-8000-000000000002', 'fel_gt', '92000000-0000-4000-8000-0000000000f1', 'borrador');

-- ── D. Configuración y borradores sobre cuentas del proyecto ────────────────
INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id, vigente_desde)
SELECT c.company_id, c.project_id, 'gasto', 'limpieza', c.id, CURRENT_DATE - 30
  FROM public.conta_cuentas c
 WHERE c.company_id = 'e1000000-0000-4000-8000-000000000001' AND c.es_detalle AND c.activa AND c.tipo = 'gasto'
 ORDER BY c.codigo LIMIT 1;

INSERT INTO public.cuentas_bancarias (company_id, project_id, nombre, banco, cuenta_contable_id)
SELECT c.company_id, c.project_id, 'Monetaria X', 'Banco Uno', c.id
  FROM public.conta_cuentas c
 WHERE c.company_id = 'e1000000-0000-4000-8000-000000000001' AND c.es_detalle AND c.activa
 ORDER BY c.codigo LIMIT 1;

INSERT INTO public.conta_asientos (id, company_id, project_id, fecha, tipo, concepto, estado, origen) VALUES
  ('91000000-0000-4000-8000-0000000000a9', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
   CURRENT_DATE, 'diario', 'Borrador de prueba', 'borrador', 'manual');
INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber)
SELECT '91000000-0000-4000-8000-0000000000a9', c.company_id, c.id, row_number() OVER (ORDER BY c.codigo),
       CASE WHEN row_number() OVER (ORDER BY c.codigo) = 1 THEN 10 ELSE 0 END,
       CASE WHEN row_number() OVER (ORDER BY c.codigo) = 1 THEN 0 ELSE 10 END
  FROM (SELECT * FROM public.conta_cuentas
         WHERE company_id = 'e1000000-0000-4000-8000-000000000001' AND es_detalle AND activa
         ORDER BY codigo LIMIT 2) c;
