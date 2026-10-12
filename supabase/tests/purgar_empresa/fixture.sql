-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de purgar_empresa. Base desechable: NUNCA contra un proyecto remoto.
--
--   X  «Residencial Purga»  suspendida hace 120 días  → la que se purga
--   Y  «Condominio Vecino»  activa                    → no se toca
--   Z  «Recién Suspendida»  suspendida hace 10 días   → en gracia
--   Q  «Solo Catálogo»      suspendida hace 200 días  → la forma EXACTA de la única
--      empresa elegible de producción el 2026-10-12: sin proyectos ni personas,
--      49 cuentas contables de sistema, 31 mapeos y 1 suscripción
--
-- Personas
--   A   super_admin sin empresa      → el actor de la purga
--   S   super_admin colgado de X/P1  → se DESLIGA, no se borra
--   O   company_owner de X           → se borra (con su user_roles)
--   D   admin de X                   → se borra (con su rol de ajustes)
--   OP  operador de X (P1)           → se borra
--   YU  admin de Y                   → no se toca
--   W   visor de Y con project_id P2 (de X, dato cruzado) → sólo pierde el project_id
--   CU1 cuenta cliente de C1 (exclusivo de X)            → se borra
--   CU2 cuenta cliente de C2 (vinculado a X y a Y)       → se conserva
--   CUY cuenta cliente de CY (de Y)                      → no se toca
--
-- Clientes
--   C1  proyecto P1, sólo X            → se borra (y su pago, en cascada)
--   C2  proyecto P1, X y Y             → se conserva, con project_id NULL
--   C3  sin proyecto, sólo X           → se borra
--   CY  proyecto PY, sólo Y            → no se toca
--
-- Y en X, filas en TODAS las tablas cuya FK hacia companies/projects es NO
-- ACTION en el repositorio o en producción (docs/PURGA_EMPRESA.md),
-- más el catálogo contable con cuentas de sistema (protegidas contra el borrado).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'actor@purga.test'),
  ('a0000000-0000-4000-8000-00000000005a', 'colgado@purga.test'),
  ('a0000000-0000-4000-8000-0000000000a1', 'owner@purga.test'),
  ('a0000000-0000-4000-8000-0000000000a2', 'admin@purga.test'),
  ('a0000000-0000-4000-8000-0000000000a3', 'operador@purga.test'),
  ('a0000000-0000-4000-8000-0000000000b1', 'admin@vecino.test'),
  ('a0000000-0000-4000-8000-0000000000b2', 'visor@vecino.test'),
  ('a0000000-0000-4000-8000-0000000000c1', 'cliente1@purga.test'),
  ('a0000000-0000-4000-8000-0000000000c2', 'cliente2@ambas.test'),
  ('a0000000-0000-4000-8000-0000000000c9', 'clientey@vecino.test');

INSERT INTO public.companies (id, nombre, activa, suspended_at, suspended_reason, logo_url) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'Residencial Purga', false, now() - interval '120 days', 'impago', 'logos/x.png'),
  ('e2000000-0000-4000-8000-000000000002', 'Condominio Vecino', true,  NULL, NULL, NULL),
  ('e3000000-0000-4000-8000-000000000003', 'Recién Suspendida', false, now() - interval '10 days', 'impago', NULL);

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Torre Norte'),
  ('f1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Torre Sur'),
  ('f2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'Vecino Único');

INSERT INTO public.clientes (id, nombre, codigo, project_id) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'Cliente Exclusivo', 'X-001', 'f1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000002', 'Cliente Compartido', 'X-002', 'f1000000-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000003', 'Cliente Sin Proyecto', 'X-003', NULL),
  ('c2000000-0000-4000-8000-000000000001', 'Cliente de Y', 'Y-001', 'f2000000-0000-4000-8000-000000000001');

INSERT INTO public.company_clientes (company_id, cliente_id) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002'),
  ('e2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002'),
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003'),
  ('e2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001');

INSERT INTO public.app_users (id, full_name, role, company_id, project_id, cliente_id) VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'Actor',     'super_admin',   NULL, NULL, NULL),
  ('a0000000-0000-4000-8000-00000000005a', 'Colgado',   'superadmin',    'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', NULL),
  ('a0000000-0000-4000-8000-0000000000a1', 'Owner X',   'company_owner', 'e1000000-0000-4000-8000-000000000001', NULL, NULL),
  ('a0000000-0000-4000-8000-0000000000a2', 'Admin X',   'admin',         'e1000000-0000-4000-8000-000000000001', NULL, NULL),
  ('a0000000-0000-4000-8000-0000000000a3', 'Operador X','operador',      'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', NULL),
  ('a0000000-0000-4000-8000-0000000000b1', 'Admin Y',   'admin',         'e2000000-0000-4000-8000-000000000002', NULL, NULL),
  ('a0000000-0000-4000-8000-0000000000b2', 'Visor Y',   'viewer',        'e2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', NULL),
  ('a0000000-0000-4000-8000-0000000000c1', 'Cliente 1', 'cliente',       NULL, 'f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-0000000000c2', 'Cliente 2', 'cliente',       NULL, 'f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-0000000000c9', 'Cliente Y', 'cliente',       NULL, 'f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001');

-- Roles: uno de empresa asignado al owner, y el rol de ajustes del admin.
INSERT INTO public.roles (id, company_id, name) VALUES
  ('b1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Rol de X');
INSERT INTO public.roles (id, company_id, name, user_override_for) VALUES
  ('b1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'Ajustes de Admin X', 'a0000000-0000-4000-8000-0000000000a2');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-000000000001');

INSERT INTO public.unidades (id, company_id, project_id, nombre, cliente_id) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'A-101', 'c1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Y-101', 'c2000000-0000-4000-8000-000000000001');

INSERT INTO public.pagos (cliente_id, project_id, monto, metodo) VALUES
  ('c1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 100, 'efectivo'),
  ('c2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 50,  'efectivo');

-- Catálogo contable con cuentas de sistema: la cascada sólo pasa con
-- conta.allow_system_write (como la única empresa elegible de producción).
SELECT public.conta_seed_catalogo('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001');
SELECT public.conta_seed_catalogo('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001');

-- ── Tablas con FK NO ACTION hacia companies/projects ───────────────────────
INSERT INTO public.fuentes_agua (id, company_id, identificador, nombre, tipo_agua) VALUES
  ('a1000000-0000-4000-8000-0000000000f1', 'e1000000-0000-4000-8000-000000000001', 'POZO-X', 'Pozo X', 'subterranea'),
  ('a2000000-0000-4000-8000-0000000000f1', 'e2000000-0000-4000-8000-000000000002', 'POZO-Y', 'Pozo Y', 'subterranea');
INSERT INTO public.registros_calidad (company_id, fuente_id) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000f1'),
  ('e2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-0000000000f1');
INSERT INTO public.rutas (company_id, project_id, nombre) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Ruta X'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Ruta Y');
INSERT INTO public.convenios_pago (company_id, project_id, cliente_id, numero_convenio, monto_total) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'CONV-X', 300),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'CONV-Y', 300);
INSERT INTO public.payment_requests (company_id, cliente_id, monto, provider) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 100, 'sandbox'),
  ('e2000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000001', 100, 'sandbox');
INSERT INTO public.areas_condominio (company_id, project_id, nombre) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Piscina X'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Piscina Y');
INSERT INTO public.mensajes_portal (company_id, project_id, unidad_id, asunto, cuerpo) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Hola X', '…'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Hola Y', '…');
INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'conserje', 'Barrer X'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'conserje', 'Barrer Y');
INSERT INTO public.rutas_ronda (company_id, project_id, nombre) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Ronda X'),
  ('e2000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001', 'Ronda Y');

-- ── Q: la única empresa elegible de producción, tal cual se midió ─────────
INSERT INTO public.companies (id, nombre, activa, suspended_at, suspended_reason) VALUES
  ('e4000000-0000-4000-8000-000000000004', 'Solo Catálogo', false, now() - interval '200 days', 'impago');
SELECT public.conta_seed_catalogo('e4000000-0000-4000-8000-000000000004', NULL);
SELECT public.compras_seed_cuentas('e4000000-0000-4000-8000-000000000004', NULL);
SELECT public.conta_seed_mapeos_especiales('e4000000-0000-4000-8000-000000000004', NULL);
