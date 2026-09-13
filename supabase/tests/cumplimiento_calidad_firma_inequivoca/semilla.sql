-- ════════════════════════════════════════════════════════════════════════════
-- Fixture — PARTE 2: los datos. Se aplica DESPUÉS de S22 y S23 reales, así que
-- el catálogo global de 9 tipologías ya está sembrado por 20260605160000.
--
-- Dos empresas, un admin en cada una, tres fuentes y dos overrides:
--   · Empresa A (aaaa…): fuente potable FA_POT y fuente piscina FA_PIS.
--     Override INACTIVO de piscina con umbrales absurdos: si la función lo
--     usara, todo daría false; la prueba exige que caiga al global.
--   · Empresa B (bbbb…): fuente potable FB_POT y override ACTIVO de potable con
--     pH [7.0, 7.2]: un pH 7.5 cumple con el global y NO cumple con el de B.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Empresa A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Empresa B');

INSERT INTO public.app_users (id, role, company_id) VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'admin', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'admin', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public.fuentes_agua (id, identificador, nombre, tipo_agua, company_id) VALUES
  ('fa0f0f0f-0000-4000-8000-00000000a001', 'FA_POT', 'Tanque potable A', 'potable', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('fa0f0f0f-0000-4000-8000-00000000a002', 'FA_PIS', 'Alberca A',        'piscina', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('fb0f0f0f-0000-4000-8000-00000000b001', 'FB_POT', 'Tanque potable B', 'potable', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public.calidad_tipologias (tipo_agua, company_id, label, parametros, activo) VALUES
  ('potable', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Potable (B, más estricta)',
   '[{"key":"pH","label":"pH","unidad":"","min":7.0,"max":7.2},
     {"key":"turbiedad","label":"Turbiedad","unidad":"NTU","min":0,"max":5}]'::jsonb, true),
  ('piscina', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Piscina (A, override apagado)',
   '[{"key":"pH","label":"pH","unidad":"","min":9,"max":10}]'::jsonb, false);

-- En Supabase los grants de tabla los reparten los DEFAULT PRIVILEGES de la
-- plataforma (anon, authenticated y service_role tienen TODO sobre las tablas
-- de public; la RLS es lo que separa). S23 no los escribe porque los da por
-- hechos; aquí se reproducen para la tabla que S23 acaba de crear.
GRANT ALL ON public.calidad_tipologias TO anon, authenticated, service_role;

-- ── Usuarios NO administrativos de la empresa A ─────────────────────────────
-- `operator` es el caso del hallazgo: la policy de INSERT le deja escribir POR
-- SU ROL, pero `user_has_permission('agua.calidad.view')` le da false, así que
-- NO ve fuentes_agua. Se siembran dos para que la prueba distinga «el RBAC del
-- fixture es real» de «siempre false»:
--   · a2a2… operador SIN agua.calidad.view  → el caso del hallazgo.
--   · a3a3… operador CON agua.calidad.view  → control: sí ve la fuente.
INSERT INTO public.app_users (id, role, company_id) VALUES
  ('a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2', 'operator', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3', 'operator', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.roles (id, nombre)
VALUES ('c0c0c0c0-0000-4000-8000-00000000c001', 'lector_calidad');
INSERT INTO public.role_permissions (role_id, permission_key, effect)
VALUES ('c0c0c0c0-0000-4000-8000-00000000c001', 'agua.calidad.view', 'allow');
INSERT INTO public.user_roles (user_id, role_id)
VALUES ('a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3', 'c0c0c0c0-0000-4000-8000-00000000c001');
