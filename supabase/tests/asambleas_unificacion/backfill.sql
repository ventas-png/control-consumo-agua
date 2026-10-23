-- ============================================================================
-- LA FUSIÓN: fixture_antes.sql con 20261106000300 encima.
--
-- Cada asamblea digital queda en asambleas con su id, la fecha y la hora de
-- su huso, el acta, quien la convocó y su modalidad; el link útil queda como
-- link y el que no es una dirección, en la descripción. asambleas_digital ya
-- no existe; votaciones pierde tipo y asamblea_id y conserva sus votos.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT au.chk(coalesce(to_regclass('public.asambleas_digital')::text, 'NULL'), 'NULL', 'fusión · asambleas_digital ya no existe');
SELECT au.chk((SELECT count(*)::text FROM public.asambleas WHERE id IN (au.id('D_FIN'), au.id('D_PROG'), au.id('D_CUR'))), '3',
  'fusión · las tres asambleas digitales están en asambleas, con su mismo id');
SELECT au.chk((SELECT fecha || ' ' || hora_inicio FROM public.asambleas WHERE id = au.id('D_FIN')), '2026-08-20 18:30:00',
  'fusión · 00:30 UTC del 21 es el 20 a las 18:30 en el huso de la empresa');
SELECT au.chk((SELECT estado || ' ' || modalidad || ' ' || quorum_requerido FROM public.asambleas WHERE id = au.id('D_FIN')), 'finalizada virtual 60',
  'fusión · conserva estado, modalidad y quórum requerido');
SELECT au.chk((SELECT link_reunion FROM public.asambleas WHERE id = au.id('D_FIN')), 'https://meet.google.com/abc-defg-hij',
  'fusión · un link sin esquema que parece un dominio recibe https://');
SELECT au.chk((SELECT acta FROM public.asambleas WHERE id = au.id('D_FIN')), 'Se aprobó el presupuesto.',
  'fusión · el acta (acta_url) pasa a asambleas.acta');
SELECT au.chk((SELECT convocado_por::text FROM public.asambleas WHERE id = au.id('D_FIN')), au.id('ADM_A')::text,
  'fusión · quien la creó queda como quien la convocó');
SELECT au.chk((SELECT coalesce(link_reunion, 'NULL') FROM public.asambleas WHERE id = au.id('D_PROG')), 'NULL',
  'fusión · un «link» que no es una dirección web no queda como enlace');
SELECT au.chk((SELECT descripcion FROM public.asambleas WHERE id = au.id('D_PROG')),
  E'Orden: presupuesto y portón\n\nEnlace de reunión registrado (no es una dirección web): sala 4',
  'fusión · pero no se pierde: queda en la descripción, después de la que ya tenía');
SELECT au.chk((SELECT link_reunion || ' ' || modalidad FROM public.asambleas WHERE id = au.id('D_CUR')), 'https://zoom.us/j/123 presencial',
  'fusión · un link https queda tal cual');
SELECT au.chk((SELECT base_votacion || ' ' || (SELECT count(*) FROM public.padron_asamblea WHERE asamblea_id = a.id) FROM public.asambleas a WHERE a.id = au.id('D_CUR')),
  'unidad 3', 'fusión · la que estaba en curso entra con base y padrón, como cualquier asamblea que abre');
SELECT au.chk((SELECT tipo FROM public.asambleas WHERE id = au.id('D_PROG')), 'ordinaria', 'fusión · sin tipo, ordinaria');

SELECT au.chk((SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'votaciones' AND column_name IN ('asamblea_id', 'tipo', 'conteo')), 'conteo',
  'votaciones · sin asamblea_id ni tipo; con conteo');
SELECT au.chk((SELECT count(*)::text FROM public.votos WHERE votacion_id = au.id('V_ABIERTA')), '1', 'votaciones · conserva sus votos');
SELECT au.chk((SELECT resultado FROM public.votaciones WHERE id = au.id('V_CERRADA')), 'Mañana', 'votaciones · y el resultado de las ya cerradas');
