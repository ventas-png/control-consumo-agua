-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261106000300 (fixture_antes.sql).
--
-- Reproduce los huecos: dos tablas de asambleas, un acta formal sin relación
-- con su asamblea, y votaciones sin reglas (opción inexistente, unidad y
-- empresa ajenas, votar con la votación cerrada, resultado escrito a mano).
-- ============================================================================
\set ON_ERROR_STOP on

SELECT au.chk((to_regclass('public.asambleas_digital') IS NOT NULL)::text, 'true',
  'antes · hay dos tablas de asambleas (asambleas y asambleas_digital)');
SELECT au.chk((SELECT count(*)::text FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'actas_reunion' AND column_name = 'asamblea_id'), '0',
  'antes · el acta formal no tiene relación con su asamblea');

SELECT au.como('ADM_A'); SET ROLE authenticated;
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''9'')', au.id('P2')),
                        au.id('A'), au.id('V_ABIERTA')), 'ok:1',
  'antes · SÍ se vota una opción que no existe');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('UB')),
                        au.id('A'), au.id('V_ABIERTA')), 'ok:1',
  'antes · SÍ vota en A una unidad de la empresa B (la policy sólo mira el company_id que manda el cliente)');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''2'')', au.id('P2')),
                        au.id('A'), au.id('V_CERRADA')), 'ok:1',
  'antes · SÍ se vota con la votación cerrada');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET resultado = ''Ganó el sí'' WHERE id = $1', au.id('V_ABIERTA')), 'ok:1',
  'antes · el resultado SÍ se escribe a mano');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET estado = ''abierta'', resultado = NULL WHERE id = $1', au.id('V_CERRADA')), 'ok:1',
  'antes · una votación cerrada SÍ se reabre');
RESET ROLE;
