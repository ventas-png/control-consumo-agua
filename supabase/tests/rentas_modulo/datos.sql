-- Datos propios de rentas_modulo, sobre el padrón de housekeeping_responsable/datos.sql
-- (empresas A/B, proyectos PA1/PA2/PB1, trece cuentas) y las unidades de str_importacion.
--
-- Roles de Rentas en la empresa A (RBAC real):
--   «Rentas completo»      (16 claves)                         → 3 (PA1), 4 (PA2)
--   «Rentas solo ver»      (4 × .view)                         → 6 (PA1)
--   «Rentas inventarista»  (inventario.view/.create/.edit)     → 13 (asignado a PA1)
--   5: sin ningún permiso de Rentas · 1 dueña · 12 admin exento · 2 admin acotado a PA1
--   7: admin de B (empresa con el servicio APAGADO hasta el bloque G)
CREATE OR REPLACE FUNCTION hkt.pr(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('f0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

INSERT INTO public.roles (id, company_id, name) VALUES
  ('e0000000-0000-0000-0000-0000000000a1'::uuid, hkt.ca(), 'Rentas completo'),
  ('e0000000-0000-0000-0000-0000000000a2'::uuid, hkt.ca(), 'Rentas solo ver'),
  ('e0000000-0000-0000-0000-0000000000a3'::uuid, hkt.ca(), 'Rentas inventarista');
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT 'e0000000-0000-0000-0000-0000000000a1', 'rentas.' || m || '.' || a, 'allow'
  FROM unnest(ARRAY['propiedades', 'reservas', 'contratos', 'inventario']) m,
       unnest(ARRAY['view', 'create', 'edit', 'delete']) a;
INSERT INTO public.role_permissions (role_id, permission_key, effect)
SELECT 'e0000000-0000-0000-0000-0000000000a2', 'rentas.' || m || '.view', 'allow'
  FROM unnest(ARRAY['propiedades', 'reservas', 'contratos', 'inventario']) m;
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('e0000000-0000-0000-0000-0000000000a3', 'rentas.inventario.view', 'allow'),
  ('e0000000-0000-0000-0000-0000000000a3', 'rentas.inventario.create', 'allow'),
  ('e0000000-0000-0000-0000-0000000000a3', 'rentas.inventario.edit', 'allow');
INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES
  (hkt.uid(3),  'e0000000-0000-0000-0000-0000000000a1', NULL),
  (hkt.uid(4),  'e0000000-0000-0000-0000-0000000000a1', NULL),
  (hkt.uid(6),  'e0000000-0000-0000-0000-0000000000a2', NULL),
  (hkt.uid(13), 'e0000000-0000-0000-0000-0000000000a3', NULL);
