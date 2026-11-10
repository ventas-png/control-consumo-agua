-- Datos propios de equipos_herramientas, sobre el padrón de housekeeping_responsable, los roles y
-- recursos de plantillas_importacion y los catálogos RRHH de rrhh_catalogos.
--
-- Permisos (empresa A), ANTES de la migración:
--   «Plantillas completo» (f1: 3, 4, 13) y «Plantillas crear sin editar» (f3: 11) y
--   «Plantillas sin suministros» (f4: 10) reciben además condominios.tab.equipos.
--   «Plantillas sin inventario» (f5: 14) NO lo recibe: es la cuenta «sin Equipos».
--   La clave nace en la categoría `instalaciones` (como la sembró 20260518000005); la
--   migración la mueve a `operaciones`.
-- Equipos PA1: Hidrolavadora (herramienta), Pulidora (limpieza), Trapeador (herramienta),
--   Aspiradora (limpieza, DE BAJA), Dup ×2 (ambiguo); PA2: Trapeador; PB1: Trapeador B.
-- Puente LEGADA: «Barrido de Piso en Pasillo» ↔ Trapeador de INVENTARIO (hkt.inv(1)),
--   insertada antes de la migración: debe seguir ahí y seguir siendo visible.
CREATE OR REPLACE FUNCTION hkt.eq(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('b3000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

INSERT INTO public.permissions (key, category, label) VALUES
  ('condominios.tab.equipos',        'instalaciones', 'Equipos'),
  ('condominios.tab.equipos.create', 'instalaciones', 'Crear — Equipos'),
  ('condominios.tab.equipos.edit',   'instalaciones', 'Editar — Equipos');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('e0000000-0000-0000-0000-0000000000f1', 'condominios.tab.equipos', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f3', 'condominios.tab.equipos', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f4', 'condominios.tab.equipos', 'allow');

INSERT INTO public.equipos_comunes (id, company_id, project_id, nombre, categoria, estado) VALUES
  (hkt.eq(1), hkt.ca(), hkt.pa1(), 'Hidrolavadora', 'herramienta', 'operativo'),
  (hkt.eq(2), hkt.ca(), hkt.pa1(), 'Pulidora',      'limpieza',    'mantenimiento'),
  (hkt.eq(3), hkt.ca(), hkt.pa1(), 'Trapeador',     'herramienta', 'operativo'),
  (hkt.eq(4), hkt.ca(), hkt.pa1(), 'Aspiradora',    'limpieza',    'baja'),
  (hkt.eq(5), hkt.ca(), hkt.pa1(), 'Dup',           'otro',        'operativo'),
  (hkt.eq(6), hkt.ca(), hkt.pa1(), 'dup ',          'otro',        'operativo'),
  (hkt.eq(7), hkt.ca(), hkt.pa2(), 'Trapeador',     'herramienta', 'operativo'),
  (hkt.eq(9), hkt.cb(), hkt.pb1(), 'Trapeador B',   'herramienta', 'operativo');

-- Vínculo LEGADO a Inventario, anterior a la migración.
INSERT INTO public.plantilla_tarea_herramientas (company_id, project_id, plantilla_tarea_id, inventario_id, cantidad, obligatoria) VALUES
  (hkt.ca(), hkt.pa1(), hkt.pl(1), hkt.inv(1), 1, false);
