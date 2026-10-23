-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261106000100, sobre el mismo padrón.
--
-- Reproduce los huecos: con la asamblea finalizada, el admin cambia y borra
-- votos y agrega puntos; una asamblea finalizada vuelve a «en curso»; tipo y
-- estado aceptan cualquier texto; y un voto cambiado no deja rastro.
--
-- Si esto no se reproduce, el padrón no prueba lo que dice: la suite de después
-- pasaría igual sin la migración.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT ai.como('ADM_A'); SET ROLE authenticated;
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE id = $1', ai.id('V_FIN1')), 'ok:1',
  'antes · ADM_A SÍ cambia un voto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('DELETE FROM public.votos_asamblea WHERE id = $1', ai.id('V_FIN1')), 'ok:1',
  'antes · ADM_A SÍ borra un voto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Agregado después'', ''votacion'')', ai.id('FIN')), 'ok:1',
  'antes · ADM_A SÍ agrega un punto a una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.asambleas SET estado = ''en_curso'' WHERE id = $1', ai.id('FIN')), 'ok:1',
  'antes · una asamblea finalizada SÍ vuelve a «en curso»');
SELECT ai.chk(ai.prueba('UPDATE public.asambleas SET estado = ''archivada'' WHERE id = $1', ai.id('PROG')), 'ok:1',
  'antes · el estado SÍ acepta cualquier texto');
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''x'', ''eleccion'')', ai.id('CUR')), 'ok:1',
  'antes · el tipo de punto SÍ acepta cualquier texto');

-- Un cambio de voto real (no deshecho) y el historial vacío.
UPDATE public.votos_asamblea SET voto = 'abstencion' WHERE id = ai.id('V_CUR');
RESET ROLE;
SELECT ai.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'votos_asamblea')::text, '0',
  'antes · cambiar un voto NO deja rastro en audit_log');
