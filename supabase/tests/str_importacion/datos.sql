-- Datos propios de str_importacion, sobre el padrón de housekeeping_responsable/datos.sql
-- (dos empresas A/B, proyectos PA1/PA2/PB1, trece cuentas con RBAC real).
--
-- Permisos de STR (RBAC real, roles de la empresa A):
--   «STR completo» (tab.str + tab.str.create) → 3 (PA1), 4 (PA2), 13 (asignado a PA1)
--   «STR solo ver» (tab.str)                  → 6 (PA1): puede ver, no crear
--   5: sin ningún permiso de STR · 1 dueña, 2 admin PA1, 12 admin exento · 7 admin de B
-- Unidades: Apto 1A, Apto 2B, Dup ×2 (ambigua), Vieja (inactiva) en PA1; Casa 3 en PA2; Loft B en PB1.
-- Reservas previas: HM-001 (PA1, Apto 1A, confirmada, 08→12/11), HM-003 (PA1, cancelada), HM-006 (PB1).
CREATE OR REPLACE FUNCTION hkt.un(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('d1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.rs(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ee000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

INSERT INTO public.roles (id, company_id, name) VALUES
  ('e0000000-0000-0000-0000-00000000000f'::uuid, hkt.ca(), 'STR completo'),
  ('e0000000-0000-0000-0000-00000000000c'::uuid, hkt.ca(), 'STR solo ver');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('e0000000-0000-0000-0000-00000000000f', 'condominios.tab.str', 'allow'),
  ('e0000000-0000-0000-0000-00000000000f', 'condominios.tab.str.create', 'allow'),
  ('e0000000-0000-0000-0000-00000000000c', 'condominios.tab.str', 'allow');
INSERT INTO public.user_roles (user_id, role_id, expires_at)
  SELECT hkt.uid(n), 'e0000000-0000-0000-0000-00000000000f', NULL FROM unnest(ARRAY[3, 4, 13]) n;
INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES (hkt.uid(6), 'e0000000-0000-0000-0000-00000000000c', NULL);

INSERT INTO public.unidades (id, project_id, company_id, nombre, activo) VALUES
  (hkt.un(1), hkt.pa1(), hkt.ca(), 'Apto 1A', true),
  (hkt.un(2), hkt.pa1(), hkt.ca(), 'Apto 2B', true),
  (hkt.un(3), hkt.pa2(), hkt.ca(), 'Casa 3',  true),
  (hkt.un(4), hkt.pa1(), hkt.ca(), 'Dup',     true),
  (hkt.un(5), hkt.pa1(), hkt.ca(), 'dup ',    true),
  (hkt.un(6), hkt.pa1(), hkt.ca(), 'Vieja',   false),
  (hkt.un(9), hkt.pb1(), hkt.cb(), 'Loft B',  true);

INSERT INTO public.reservas_str (id, company_id, project_id, unidad_id, huesped_nombre, fecha_entrada, fecha_salida, estado, codigo_confirmacion) VALUES
  (hkt.rs(1), hkt.ca(), hkt.pa1(), hkt.un(1), 'Ana Pérez', '2026-11-08', '2026-11-12', 'confirmada', 'HM-001'),
  (hkt.rs(3), hkt.ca(), hkt.pa1(), hkt.un(1), 'Cancelado', '2026-12-01', '2026-12-03', 'cancelada',  'HM-003'),
  (hkt.rs(6), hkt.cb(), hkt.pb1(), hkt.un(9), 'Otra emp',  '2026-11-18', '2026-11-19', 'confirmada', 'HM-006');
