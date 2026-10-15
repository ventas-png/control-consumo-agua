-- Datos propios de plantillas_importacion, sobre el padrón de housekeeping_responsable/datos.sql
-- (dos empresas A/B, proyectos PA1/PA2/PB1, trece cuentas con RBAC real).
--
-- Permisos del catálogo (RBAC real, roles de la empresa A):
--   «Plantillas completo» (tab + create + edit + tab.suministros) → 3 (PA1), 4 (PA2), 13 (asignado a PA1)
--   «Plantillas solo ver» (tab)                                → 6 (PA1): ve el catálogo, no carga ni edita
--   «Plantillas crear sin editar» (tab + create + suministros) → 11 (PA1): carga, pero no bloque
--   «Plantillas sin suministros» (tab + create + edit)         → 10 (PA1, rol vigente): no ve insumos
--   5: sin permiso · 1 dueña, 2 admin PA1, 12 admin exento · 7 admin de B
-- Áreas PA1: Pasillo, Gradas, Dup ×2 (ambigua), Vieja (inactiva); PA2: Jardín.
-- Insumos PA1: Escoba, Bolsa, Cloro (inactivo), Dup ×2; PA2: Trapo; PB1: Escoba B.
-- Inventario PA1: Trapeador (herramienta), Carretilla (herramienta, en_uso), Hidrolavadora (equipo),
--   Pulidora (equipo), Aspiradora (equipo, dado de baja); PA2: Trapeador; PB1: Trapeador B.
-- Actividades previas PA1: «Barrido de Piso en Pasillo» (conserje, activa), «Vieja actividad»
--   (conserje, inactiva); PA2: «Barrido» (conserje).
CREATE OR REPLACE FUNCTION hkt.ar(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ab000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.su(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ac000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.inv(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ad000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pl(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ae000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

INSERT INTO public.roles (id, company_id, name) VALUES
  ('e0000000-0000-0000-0000-0000000000f1'::uuid, hkt.ca(), 'Plantillas completo'),
  ('e0000000-0000-0000-0000-0000000000f2'::uuid, hkt.ca(), 'Plantillas solo ver'),
  ('e0000000-0000-0000-0000-0000000000f3'::uuid, hkt.ca(), 'Plantillas crear sin editar'),
  ('e0000000-0000-0000-0000-0000000000f4'::uuid, hkt.ca(), 'Plantillas sin suministros');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('e0000000-0000-0000-0000-0000000000f1', 'condominios.tab.plantillas_cargo', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f1', 'condominios.tab.plantillas_cargo.create', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f1', 'condominios.tab.plantillas_cargo.edit', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f1', 'condominios.tab.suministros', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f2', 'condominios.tab.plantillas_cargo', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f3', 'condominios.tab.plantillas_cargo', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f3', 'condominios.tab.plantillas_cargo.create', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f3', 'condominios.tab.suministros', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f4', 'condominios.tab.plantillas_cargo', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f4', 'condominios.tab.plantillas_cargo.create', 'allow'),
  ('e0000000-0000-0000-0000-0000000000f4', 'condominios.tab.plantillas_cargo.edit', 'allow');
INSERT INTO public.user_roles (user_id, role_id, expires_at)
  SELECT hkt.uid(n), 'e0000000-0000-0000-0000-0000000000f1', NULL FROM unnest(ARRAY[3, 4, 13]) n;
INSERT INTO public.user_roles (user_id, role_id, expires_at) VALUES
  (hkt.uid(6),  'e0000000-0000-0000-0000-0000000000f2', NULL),
  (hkt.uid(11), 'e0000000-0000-0000-0000-0000000000f3', NULL),
  (hkt.uid(10), 'e0000000-0000-0000-0000-0000000000f4', NULL);

INSERT INTO public.areas_condominio (id, company_id, project_id, nombre, activo) VALUES
  (hkt.ar(1), hkt.ca(), hkt.pa1(), 'Pasillo', true),
  (hkt.ar(2), hkt.ca(), hkt.pa1(), 'Gradas',  true),
  (hkt.ar(3), hkt.ca(), hkt.pa1(), 'Dup',     true),
  (hkt.ar(4), hkt.ca(), hkt.pa1(), 'dup ',    true),
  (hkt.ar(5), hkt.ca(), hkt.pa1(), 'Vieja',   false),
  (hkt.ar(6), hkt.ca(), hkt.pa2(), 'Jardín',  true);

INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida, activo) VALUES
  (hkt.su(1), hkt.ca(), hkt.pa1(), 'Escoba',   'unidad', true),
  (hkt.su(2), hkt.ca(), hkt.pa1(), 'Bolsa',    'unidad', true),
  (hkt.su(3), hkt.ca(), hkt.pa1(), 'Cloro',    'litro',  false),
  (hkt.su(4), hkt.ca(), hkt.pa1(), 'Dup',      'unidad', true),
  (hkt.su(5), hkt.ca(), hkt.pa1(), 'dup ',     'unidad', true),
  (hkt.su(6), hkt.ca(), hkt.pa2(), 'Trapo',    'unidad', true),
  (hkt.su(9), hkt.cb(), hkt.pb1(), 'Escoba B', 'unidad', true);

INSERT INTO public.inventario_condominio (id, company_id, project_id, nombre, categoria, estado) VALUES
  (hkt.inv(1), hkt.ca(), hkt.pa1(), 'Trapeador',    'herramienta', 'disponible'),
  (hkt.inv(2), hkt.ca(), hkt.pa1(), 'Carretilla',   'herramienta', 'en_uso'),
  (hkt.inv(3), hkt.ca(), hkt.pa1(), 'Hidrolavadora','equipo',      'disponible'),
  (hkt.inv(4), hkt.ca(), hkt.pa1(), 'Pulidora',     'equipo',      'disponible'),
  (hkt.inv(5), hkt.ca(), hkt.pa1(), 'Aspiradora',   'equipo',      'dado_de_baja'),
  (hkt.inv(6), hkt.ca(), hkt.pa2(), 'Trapeador',    'herramienta', 'disponible'),
  (hkt.inv(9), hkt.cb(), hkt.pb1(), 'Trapeador B',  'herramienta', 'disponible');

INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo, servicio, duracion_estimada_min, activo) VALUES
  (hkt.pl(1), hkt.ca(), hkt.pa1(), 'conserje', 'Barrido de Piso en Pasillo', 'limpieza', 5, true),
  (hkt.pl(2), hkt.ca(), hkt.pa1(), 'conserje', 'Vieja actividad',            'limpieza', 5, false),
  (hkt.pl(3), hkt.ca(), hkt.pa2(), 'conserje', 'Barrido',                    'limpieza', 5, true);
INSERT INTO public.plantilla_tarea_suministros (company_id, project_id, plantilla_tarea_id, suministro_id, cantidad) VALUES
  (hkt.ca(), hkt.pa1(), hkt.pl(1), hkt.su(1), 1);
