-- ============================================================================
-- CONTROL PREVIO: el estado de ANTES de 20261106000200 (fixture_antes.sql).
--
-- Reproduce los huecos: finalizar no calcula quórum ni resultado, el quórum
-- alcanzado se escribe a mano con cualquier número, el requerido cambia con
-- la asamblea en curso, vota una unidad dada de baja y no hay padrón ni
-- asistencia. Si esto no se reproduce, el padrón no prueba lo que dice.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT ae.chk((SELECT coalesce(quorum_alcanzado::text, 'NULL') FROM public.asambleas WHERE id = ae.id('X_FIN')), 'NULL',
  'antes · finalizar NO calcula el quórum alcanzado');
SELECT ae.chk((SELECT coalesce(resultado, 'NULL') FROM public.puntos_asamblea WHERE id = ae.id('XF_P')), 'NULL',
  'antes · finalizar NO deja resultado en el punto votado');
SELECT ae.chk(coalesce(to_regclass('public.padron_asamblea')::text, '') || coalesce(to_regclass('public.asistencia_asamblea')::text, ''), '',
  'antes · NO hay padrón ni asistencia');

SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_alcanzado = 500 WHERE id = $1', ae.id('X_CUR')), 'ok:1',
  'antes · el quórum alcanzado SÍ se escribe a mano, con cualquier número');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_requerido = 5 WHERE id = $1', ae.id('X_CUR')), 'ok:1',
  'antes · el quórum requerido SÍ se baja con la asamblea en curso');
SELECT ae.chk(ae.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''en_contra'')', ae.id('XC_P2'), ae.id('P5')), 'ok:1',
  'antes · una unidad dada de baja SÍ vota en una asamblea en curso');
RESET ROLE;
