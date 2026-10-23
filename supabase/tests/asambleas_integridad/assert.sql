-- ============================================================================
-- INVARIANTES de 20261105000100 sobre el padrón (fixture.sql).
--
-- Vocabulario cerrado; el estado sólo avanza (programada → en curso →
-- finalizada; se cancela antes de finalizar); con la asamblea finalizada o
-- cancelada, agenda y votos congelados aun para service_role, salvo las
-- acciones referenciales; cada cambio de voto queda en el historial, visible
-- para el admin de la empresa de la asamblea y de ninguna otra.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT ai.como('ADM_A'); SET ROLE authenticated;

-- ── 1 · Vocabulario ─────────────────────────────────────────────────────────
SELECT ai.chk(ai.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, tipo)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 'anual')$q$, ai.id('A'), ai.id('A1')),
  '23514:asambleas_tipo_check', 'el tipo de asamblea sólo es ordinaria o extraordinaria');
SELECT ai.chk(ai.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, estado)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 'archivada')$q$, ai.id('A'), ai.id('A1')),
  '23514:asambleas_estado_check', 'el estado sólo es programada, en_curso, finalizada o cancelada');
SELECT ai.chk(ai.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, 'x', 'eleccion')$q$, ai.id('CUR')),
  '23514:puntos_asamblea_tipo_check', 'el tipo de punto sólo es informativo, votacion o debate');
SELECT ai.chk(ai.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, tipo)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 'extraordinaria')$q$, ai.id('A'), ai.id('A1')),
  'ok:1', 'ADM_A SÍ convoca una asamblea extraordinaria (programada por defecto)');

-- ── 2 · Transiciones ────────────────────────────────────────────────────────
SELECT ai.chk(ai.transicion('PROG', 'en_curso'),   'ok:1',  'programada → en_curso SÍ');
SELECT ai.chk(ai.transicion('PROG', 'cancelada'),  'ok:1',  'programada → cancelada SÍ');
SELECT ai.chk(ai.transicion('PROG', 'finalizada'), '23514:ASAMBLEA_TRANSICION', 'programada → finalizada NO (hay que pasar por en curso)');
SELECT ai.chk(ai.transicion('CUR',  'finalizada'), 'ok:1',  'en_curso → finalizada SÍ');
SELECT ai.chk(ai.transicion('CUR',  'cancelada'),  'ok:1',  'en_curso → cancelada SÍ');
SELECT ai.chk(ai.transicion('CUR',  'programada'), '23514:ASAMBLEA_TRANSICION', 'en_curso → programada NO');
SELECT ai.chk(ai.transicion('FIN',  'en_curso'),   '23514:ASAMBLEA_TRANSICION', 'finalizada → en_curso NO');
SELECT ai.chk(ai.transicion('FIN',  'programada'), '23514:ASAMBLEA_TRANSICION', 'finalizada → programada NO');
SELECT ai.chk(ai.transicion('FIN',  'cancelada'),  '23514:ASAMBLEA_TRANSICION', 'finalizada → cancelada NO');
SELECT ai.chk(ai.transicion('CAN',  'programada'), '23514:ASAMBLEA_TRANSICION', 'cancelada → programada NO');
SELECT ai.chk(ai.transicion('CAN',  'en_curso'),   '23514:ASAMBLEA_TRANSICION', 'cancelada → en_curso NO');
SELECT ai.chk(ai.transicion('FIN',  'finalizada'), 'ok:1',  'finalizada → finalizada SÍ (no es una transición)');
SELECT ai.chk(ai.prueba('UPDATE public.asambleas SET acta = ''Acta corregida'' WHERE id = $1', ai.id('FIN')), 'ok:1',
  'el acta de una asamblea finalizada SÍ se sigue editando');

-- ── 3 · Agenda congelada ────────────────────────────────────────────────────
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Nuevo'', ''votacion'')', ai.id('FIN')),
  '23514:ASAMBLEA_CERRADA', 'NO se agrega un punto a una asamblea finalizada');
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Nuevo'', ''votacion'')', ai.id('CAN')),
  '23514:ASAMBLEA_CERRADA', 'NO se agrega un punto a una asamblea cancelada');
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Nuevo'', ''votacion'')', ai.id('CUR')),
  'ok:1', 'SÍ se agrega un punto a una asamblea en curso');
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Nuevo'', ''votacion'')', ai.id('PROG')),
  'ok:1', 'SÍ se agrega un punto a una asamblea programada');
SELECT ai.chk(ai.prueba('UPDATE public.puntos_asamblea SET titulo = ''Otro'' WHERE id = $1', ai.id('PUN_FIN')),
  '23514:ASAMBLEA_CERRADA', 'NO se edita un punto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.puntos_asamblea SET titulo = ''Otro'' WHERE id = $1', ai.id('PUN_CAN')),
  '23514:ASAMBLEA_CERRADA', 'NO se edita un punto de una asamblea cancelada');
SELECT ai.chk(ai.prueba('UPDATE public.puntos_asamblea SET titulo = ''Otro'' WHERE id = $1', ai.id('PUN_CUR')),
  'ok:1', 'SÍ se edita un punto de una asamblea en curso');
SELECT ai.chk(ai.prueba('DELETE FROM public.puntos_asamblea WHERE id = $1', ai.id('PUN_FIN')),
  '23514:ASAMBLEA_CERRADA', 'NO se borra un punto de una asamblea finalizada (ni, con él, sus votos)');
SELECT ai.chk(ai.prueba('DELETE FROM public.puntos_asamblea WHERE id = $1', ai.id('PUN_CUR')),
  'ok:1', 'SÍ se borra un punto de una asamblea en curso, con sus votos');
SELECT ai.chk(ai.prueba('UPDATE public.puntos_asamblea SET asamblea_id = $2 WHERE id = $1', ai.id('PUN_CUR'), ai.id('FIN')),
  '23514:ASAMBLEA_CERRADA', 'NO se mueve un punto a una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.puntos_asamblea SET asamblea_id = $2 WHERE id = $1', ai.id('PUN_FIN'), ai.id('CUR')),
  '23514:ASAMBLEA_CERRADA', 'NO se saca un punto de una asamblea finalizada');

-- ── 4 · Votos congelados ────────────────────────────────────────────────────
SELECT ai.chk(ai.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ai.id('PUN_FIN'), ai.id('U3')),
  '23514:ASAMBLEA_CERRADA', 'NO se registra un voto en una asamblea finalizada');
SELECT ai.chk(ai.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ai.id('PUN_CAN'), ai.id('U3')),
  '23514:ASAMBLEA_CERRADA', 'NO se registra un voto en una asamblea cancelada');
SELECT ai.chk(ai.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ai.id('PUN_CUR'), ai.id('U2')),
  'ok:1', 'SÍ se registra un voto en una asamblea en curso');
SELECT ai.chk(ai.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ai.id('PUN_PROG'), ai.id('U1')),
  'ok:1', 'SÍ se registra un voto en una asamblea programada (la regla es el cierre)');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE id = $1', ai.id('V_FIN1')),
  '23514:ASAMBLEA_CERRADA', 'NO se cambia un voto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE id = $1', ai.id('V_CAN')),
  '23514:ASAMBLEA_CERRADA', 'NO se cambia un voto de una asamblea cancelada');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE id = $1', ai.id('V_CUR')),
  'ok:1', 'SÍ se cambia un voto de una asamblea en curso');
SELECT ai.chk(ai.prueba('DELETE FROM public.votos_asamblea WHERE id = $1', ai.id('V_FIN1')),
  '23514:ASAMBLEA_CERRADA', 'NO se borra un voto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('DELETE FROM public.votos_asamblea WHERE id = $1', ai.id('V_CAN')),
  '23514:ASAMBLEA_CERRADA', 'NO se borra un voto de una asamblea cancelada');
SELECT ai.chk(ai.prueba('DELETE FROM public.votos_asamblea WHERE id = $1', ai.id('V_CUR')),
  'ok:1', 'SÍ se borra un voto de una asamblea en curso');
-- El upsert del panel (AsambleasTab.registrarVoto): sobre la unidad que ya
-- votó es el re-voto.
SELECT ai.chk(ai.prueba($q$INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por)
                           VALUES ($1, $2, 'abstencion', auth.uid())
                           ON CONFLICT (punto_id, unidad_id) DO UPDATE
                             SET voto = EXCLUDED.voto, registrado_por = EXCLUDED.registrado_por$q$, ai.id('PUN_FIN'), ai.id('U1')),
  '23514:ASAMBLEA_CERRADA', 'NO se re-vota con el upsert del panel en una asamblea finalizada');
SELECT ai.chk(ai.prueba($q$INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por)
                           VALUES ($1, $2, 'abstencion', auth.uid())
                           ON CONFLICT (punto_id, unidad_id) DO UPDATE
                             SET voto = EXCLUDED.voto, registrado_por = EXCLUDED.registrado_por$q$, ai.id('PUN_CUR'), ai.id('U1')),
  'ok:1', 'SÍ se re-vota con el upsert del panel en una asamblea en curso');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET punto_id = $2 WHERE id = $1', ai.id('V_CUR'), ai.id('PUN_FIN')),
  '23514:ASAMBLEA_CERRADA', 'NO se mueve un voto a un punto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET punto_id = $2 WHERE id = $1', ai.id('V_FIN2'), ai.id('PUN_CUR')),
  '23514:ASAMBLEA_CERRADA', 'NO se saca un voto de una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET registrado_por = NULL WHERE id = $1', ai.id('V_FIN1')),
  '23514:ASAMBLEA_CERRADA', 'NO se borra a mano quién registró un voto cerrado (su usuario sigue existiendo)');
RESET ROLE;

-- Ni con service_role: la regla es de la base, no de la RLS.
SELECT ai.chk(ai.transicion('FIN', 'en_curso'), '23514:ASAMBLEA_TRANSICION',
  'service_role tampoco reabre una asamblea finalizada');
SELECT ai.chk(ai.prueba('UPDATE public.votos_asamblea SET voto = ''en_contra'' WHERE id = $1', ai.id('V_FIN1')),
  '23514:ASAMBLEA_CERRADA', 'service_role tampoco cambia un voto cerrado');
SELECT ai.chk(ai.prueba('INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo) VALUES ($1, ''Nuevo'', ''debate'')', ai.id('FIN')),
  '23514:ASAMBLEA_CERRADA', 'service_role tampoco agrega un punto a una asamblea cerrada');

-- ── 5 · Historial de votos ──────────────────────────────────────────────────
SELECT ai.como('ADM_A'); SET ROLE authenticated;
INSERT INTO public.votos_asamblea (id, punto_id, unidad_id, voto, registrado_por)
VALUES (ai.id('V_NUEVO'), ai.id('PUN_CUR'), ai.id('U2'), 'en_contra', auth.uid());
UPDATE public.votos_asamblea SET voto = 'abstencion' WHERE id = ai.id('V_NUEVO');
DELETE FROM public.votos_asamblea WHERE id = ai.id('V_NUEVO');
RESET ROLE;
SELECT ai.chk(
  (SELECT string_agg(action || ' ' || coalesce(before->>'voto', '-') || '→' || coalesce(after->>'voto', '-'), ', ' ORDER BY id)
     FROM public.audit_log WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_NUEVO')),
  'INSERT -→en_contra, UPDATE en_contra→abstencion, DELETE abstencion→-',
  'alta, cambio y baja de un voto quedan en el historial con el voto antes y después');
SELECT ai.chk(
  (SELECT bool_and(actor_id = ai.id('ADM_A') AND company_id = ai.id('A') AND project_id = ai.id('A1'))::text
     FROM public.audit_log WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_NUEVO')),
  'true', 'cada entrada guarda quién lo hizo y la empresa y el proyecto de la asamblea');

SELECT ai.como('ADM_B'); SET ROLE authenticated;
UPDATE public.votos_asamblea SET voto = 'en_contra' WHERE id = ai.id('V_B');
SELECT ai.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_NUEVO'))::text, '0',
  'ADM_B NO lee el historial de votos de la empresa A');
SELECT ai.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_B'))::text, '1',
  'ADM_B SÍ lee el historial de los votos de su empresa');
RESET ROLE;
SELECT ai.como('ADM_A'); SET ROLE authenticated;
SELECT ai.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_NUEVO'))::text, '3',
  'ADM_A SÍ lee el historial de los votos de su empresa');
SELECT ai.chk((SELECT count(*) FROM public.audit_log WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_B'))::text, '0',
  'ADM_A NO lee el historial de votos de la empresa B');

-- ── 6 · Acciones referenciales ──────────────────────────────────────────────
-- La purga de una empresa (purgar_empresa) borra sus proyectos: asambleas,
-- unidades, puntos y votos cerrados caen juntos, en el orden que elija la
-- cascada.
RESET ROLE;
SELECT ai.chk(ai.prueba('DELETE FROM public.projects WHERE id = $1', ai.id('A1')), 'ok:1',
  'SÍ se borra el condominio con asambleas cerradas, sus puntos y sus votos');
SELECT ai.chk(ai.prueba('DELETE FROM public.companies WHERE id = $1', ai.id('A')), 'ok:1',
  'SÍ se borra la empresa con asambleas cerradas, sus puntos y sus votos');

SELECT ai.como('ADM_A'); SET ROLE authenticated;
-- Borrar una asamblea cerrada sigue siendo la decisión de quien tiene
-- «Eliminar»: sus puntos y votos caen con ella, y la baja queda en el
-- historial.
SELECT ai.chk(ai.prueba('DELETE FROM public.asambleas WHERE id = $1', ai.id('FIN_B')), 'ok:1',
  'ADM_A SÍ borra una asamblea finalizada, con sus puntos y votos (cascada)');
DELETE FROM public.asambleas WHERE id = ai.id('FIN_B');
RESET ROLE;
SELECT ai.chk(
  ((SELECT count(*) FROM public.puntos_asamblea WHERE asamblea_id = ai.id('FIN_B'))
   + (SELECT count(*) FROM public.votos_asamblea WHERE id = ai.id('V_FIN_B')))::text, '0',
  'con la asamblea se fueron su punto y su voto');
SELECT ai.chk(
  (SELECT action || ' ' || (company_id = ai.id('A'))::text FROM public.audit_log
    WHERE table_name = 'votos_asamblea' AND record_id = ai.id('V_FIN_B')),
  'DELETE true', 'la baja en cascada del voto queda en el historial, con su empresa');

-- Dar de baja una unidad que votó en una asamblea cerrada: su voto cae con ella.
SELECT ai.chk(ai.prueba('DELETE FROM public.unidades WHERE id = $1', ai.id('U2')), 'ok:1',
  'SÍ se borra una unidad que votó en una asamblea finalizada (su voto cae con ella)');

-- Borrar el usuario que registró un voto cerrado: registrado_por pasa a NULL
-- y el voto queda igual.
SELECT ai.chk(ai.prueba('DELETE FROM auth.users WHERE id = $1', ai.id('REG')), 'ok:1',
  'SÍ se borra el usuario que registró un voto de una asamblea finalizada');
DELETE FROM auth.users WHERE id = ai.id('REG');
SELECT ai.chk(
  (SELECT coalesce(registrado_por::text, 'NULL') || ' ' || voto FROM public.votos_asamblea WHERE id = ai.id('V_FIN1')),
  'NULL a_favor', 'el voto queda igual, sin quién lo registró');
