-- Datos propios de housekeeping_flujo, sobre el padrón de housekeeping_responsable/datos.sql
-- (dos empresas, tres proyectos, trece cuentas). Se cargan ANTES de la migración.
--
-- Zonas horarias: A = Guatemala (UTC−6, sin horario de verano); B = Madrid (UTC+1 en
-- noviembre). Unidades y reservas de prueba:
--   r1  PA1 · u1 · en_curso   · HM-001 · Ana Pérez
--   r2  PA1 · u2 · confirmada · HM-002 · Luis Gómez (futura)
--   r3  PA1 · u1 · cancelada  · HM-003
--   r4  PA1 · u1 · completada · HM-004
--   r5  PA2 · u3 · confirmada · HM-005 (otro proyecto de la misma empresa)
--   r6  PB1 · ub · confirmada · HM-006 (otra empresa)
--   r7  PA1 · —  · confirmada · HM-007 (sin unidad)
UPDATE public.companies SET timezone = 'America/Guatemala' WHERE id = hkt.ca();
UPDATE public.companies SET timezone = 'Europe/Madrid'     WHERE id = hkt.cb();

CREATE OR REPLACE FUNCTION hkt.un(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('d1000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.rs(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ee000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

INSERT INTO public.unidades (id, project_id, company_id, nombre) VALUES
  (hkt.un(1), hkt.pa1(), hkt.ca(), 'Apto 1A'),
  (hkt.un(2), hkt.pa1(), hkt.ca(), 'Apto 2B'),
  (hkt.un(3), hkt.pa2(), hkt.ca(), 'Casa 3'),
  (hkt.un(9), hkt.pb1(), hkt.cb(), 'Loft B');

INSERT INTO public.reservas_str (id, company_id, project_id, unidad_id, huesped_nombre, huesped_email, huesped_telefono,
                                 fecha_entrada, fecha_salida, hora_llegada_estimada, hora_salida_estimada, plataforma, estado, codigo_confirmacion) VALUES
  (hkt.rs(1), hkt.ca(), hkt.pa1(), hkt.un(1), 'Ana Pérez',  'ana@huesped.test', '+50255550001', '2026-11-08', '2026-11-12', '15:00', '11:00', 'airbnb',  'en_curso',   'HM-001'),
  (hkt.rs(2), hkt.ca(), hkt.pa1(), hkt.un(2), 'Luis Gómez', NULL,               NULL,           '2026-11-20', '2026-11-25', '14:00', '10:00', 'booking', 'confirmada', 'HM-002'),
  (hkt.rs(3), hkt.ca(), hkt.pa1(), hkt.un(1), 'Cancelado',  NULL,               NULL,           '2026-11-15', '2026-11-16', NULL,    NULL,    'directo', 'cancelada',  'HM-003'),
  (hkt.rs(4), hkt.ca(), hkt.pa1(), hkt.un(1), 'Pasado',     NULL,               NULL,           '2026-10-01', '2026-10-03', NULL,    NULL,    'directo', 'completada', 'HM-004'),
  (hkt.rs(5), hkt.ca(), hkt.pa2(), hkt.un(3), 'Otro proy',  NULL,               NULL,           '2026-11-18', '2026-11-19', NULL,    NULL,    'directo', 'confirmada', 'HM-005'),
  (hkt.rs(6), hkt.cb(), hkt.pb1(), hkt.un(9), 'Otra emp',   NULL,               NULL,           '2026-11-18', '2026-11-19', NULL,    NULL,    'directo', 'confirmada', 'HM-006'),
  (hkt.rs(7), hkt.ca(), hkt.pa1(), NULL,      'Sin unidad', NULL,               NULL,           '2026-11-30', '2026-12-02', NULL,    NULL,    'vrbo',    'confirmada', 'HM-007');

-- La persona 6 no tiene correo: sólo recibe campana.
UPDATE auth.users SET email = NULL WHERE id = hkt.uid(6);
