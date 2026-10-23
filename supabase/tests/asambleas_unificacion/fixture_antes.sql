-- ============================================================================
-- PADRÓN DE ANTES de 20261106000300: todavía hay asambleas_digital, y
-- votaciones con tipo y asamblea_id.
--
-- Empresa A (condominios_only, huso America/Guatemala), proyecto PU con P1…P3;
-- empresa B con UB. ADM_A es admin de A.
--   D_FIN   digital finalizada, virtual, link sin esquema
--           ('meet.google.com/abc-defg-hij'), con acta en `acta_url`, creada
--           por ADM_A, a las 00:30 UTC del 21 (18:30 del 20 en Guatemala)
--   D_PROG  digital programada, híbrida, con un «link» que no es una
--           dirección ('sala 4') y descripción
--   D_CUR   digital en curso, presencial, link https
--   V_ABIERTA votación «ponderada» ligada a una asamblea, con el voto de P1
--   V_CERRADA votación cerrada con resultado escrito por el navegador
-- Sirve dos veces: antes.sql reproduce los huecos, y con la migración encima
-- backfill.sql prueba la fusión.
-- ============================================================================
\set ON_ERROR_STOP on

INSERT INTO public.companies (id, nombre, timezone) VALUES
  (au.id('A'), 'Empresa A (unificación, antes)', 'America/Guatemala'),
  (au.id('B'), 'Empresa B (unificación, antes)', 'America/Guatemala');
UPDATE public.subscriptions s
   SET plan_id = (SELECT id FROM public.billing_plans WHERE code = 'condominios_only'), status = 'active'
 WHERE s.company_id IN (au.id('A'), au.id('B'));
INSERT INTO public.projects (id, company_id, nombre, tipo) VALUES
  (au.id('PU'), au.id('A'), 'Condominio PU', 'condominios'),
  (au.id('B1'), au.id('B'), 'Condominio B1', 'condominios');

INSERT INTO auth.users (id) VALUES (au.id('ADM_A'));
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (au.id('ADM_A'), au.id('A'), 'Unificación ADM_A', 'admin');

INSERT INTO public.unidades (id, project_id, company_id, nombre) VALUES
  (au.id('P1'), au.id('PU'), au.id('A'), 'Casa 1'),
  (au.id('P2'), au.id('PU'), au.id('A'), 'Casa 2'),
  (au.id('P3'), au.id('PU'), au.id('A'), 'Casa 3'),
  (au.id('UB'), au.id('B1'), au.id('B'), 'Casa B');

INSERT INTO public.asambleas_digital (id, company_id, project_id, titulo, descripcion, fecha_hora, modalidad,
                                      link_reunion, quorum_requerido, estado, acta_url, created_by) VALUES
  (au.id('D_FIN'),  au.id('A'), au.id('PU'), 'Digital finalizada', NULL, '2026-08-21 00:30:00+00', 'virtual',
   'meet.google.com/abc-defg-hij', 60, 'finalizada', 'Se aprobó el presupuesto.', au.id('ADM_A')),
  (au.id('D_PROG'), au.id('A'), au.id('PU'), 'Digital programada', 'Orden: presupuesto y portón', '2026-11-10 23:00:00+00', 'hibrida',
   'sala 4', 50, 'programada', NULL, NULL),
  (au.id('D_CUR'),  au.id('A'), au.id('PU'), 'Digital en curso', NULL, now(), 'presencial',
   'https://zoom.us/j/123', 50, 'en_curso', NULL, NULL);

INSERT INTO public.asambleas (id, company_id, project_id, titulo, fecha, hora_inicio, estado) VALUES
  (au.id('A_PROG'), au.id('A'), au.id('PU'), 'Asamblea clásica', CURRENT_DATE + 10, '18:00', 'programada');

INSERT INTO public.votaciones (id, company_id, project_id, asamblea_id, titulo, tipo, opciones, estado, quorum_requerido) VALUES
  (au.id('V_ABIERTA'), au.id('A'), au.id('PU'), au.id('A_PROG'), 'Pintar de verde', 'ponderada',
   '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "No"}]', 'abierta', NULL),
  (au.id('V_CERRADA'), au.id('A'), au.id('PU'), NULL, 'Horario de piscina', 'simple',
   '[{"id": "1", "texto": "Mañana"}, {"id": "2", "texto": "Tarde"}]', 'cerrada', NULL);
INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES
  (au.id('A'), au.id('V_ABIERTA'), au.id('P1'), '1');
UPDATE public.votaciones SET resultado = 'Mañana' WHERE id = au.id('V_CERRADA');
