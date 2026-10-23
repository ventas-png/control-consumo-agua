-- ============================================================================
-- INVARIANTES de 20261106000300 sobre el padrón (fixture.sql).
--
-- La asamblea tiene modalidad y un link que sólo puede ser http/https; el acta
-- formal se liga a UNA asamblea finalizada de su condominio y se levanta desde
-- ella con lo que la asamblea sabe, para quien la ve y puede crear actas; y la
-- votación es una consulta con reglas: nace abierta, se cierra o se anula una
-- vez, su resultado lo escribe la base y sus votos son de una opción, una
-- unidad y una empresa que existen en ella.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT au.como('ADM_A'); SET ROLE authenticated;

-- ── 1 · Modalidad y link ────────────────────────────────────────────────────
SELECT au.chk(au.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, modalidad)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 'remota')$q$, au.id('A'), au.id('PU')),
  '23514:asambleas_modalidad_check', 'la modalidad sólo es presencial, virtual o híbrida');
SELECT au.chk(au.prueba('UPDATE public.asambleas SET link_reunion = ''javascript:alert(1)'' WHERE id = $1', au.id('A_PROG')),
  '23514:asambleas_link_reunion_check', 'un link que no es http/https NO entra (se muestra como enlace)');
SELECT au.chk(au.prueba('UPDATE public.asambleas SET link_reunion = ''meet.google.com/abc'' WHERE id = $1', au.id('A_PROG')),
  '23514:asambleas_link_reunion_check', 'ni uno sin esquema');
SELECT au.chk(au.prueba('UPDATE public.asambleas SET link_reunion = ''https://meet.google.com/abc def'' WHERE id = $1', au.id('A_PROG')),
  '23514:asambleas_link_reunion_check', 'ni uno con espacios');
SELECT au.chk(au.prueba('UPDATE public.asambleas SET modalidad = ''virtual'', link_reunion = ''https://meet.google.com/abc'', descripcion = ''Por video'' WHERE id = $1', au.id('A_PROG')),
  'ok:1', 'SÍ se pone virtual con un link https y una descripción');
SELECT au.chk((SELECT column_default FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'asambleas' AND column_name = 'modalidad'), '''presencial''::text',
  'sin modalidad, la asamblea es presencial');

-- ── 2 · El acta formal, ligada ──────────────────────────────────────────────
SELECT au.chk(au.prueba($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                           VALUES ($1, $2, NULL, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('A'), au.id('PU')), 'ok:1',
  '(control) un acta suelta, sin asamblea, SÍ entra');
SELECT au.chk(au.prueba(format($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                                 VALUES ($1, $2, %L, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('A_CUR')), au.id('A'), au.id('PU')),
  '23514:ACTA_ASAMBLEA_ABIERTA', 'NO se liga un acta a una asamblea en curso');
SELECT au.chk(au.prueba(format($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                                 VALUES ($1, $2, %L, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('A_PROG')), au.id('A'), au.id('PU')),
  '23514:ACTA_ASAMBLEA_ABIERTA', 'ni a una programada');
SELECT au.chk(au.prueba(format($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                                 VALUES ($1, $2, %L, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('A_CAN')), au.id('A'), au.id('PU')),
  '23514:ACTA_ASAMBLEA_ABIERTA', 'ni a una cancelada');
SELECT au.chk(au.prueba(format($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                                 VALUES ($1, $2, %L, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('X_FIN')), au.id('A'), au.id('PU')),
  '23514:ACTA_ASAMBLEA', 'ni a una asamblea de otro condominio de la empresa');
SELECT au.chk(au.prueba(format($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                                 VALUES ($1, $2, %L, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('B_FIN')), au.id('A'), au.id('PU')),
  '23514:ACTA_ASAMBLEA', 'ni a una asamblea de otra empresa');
SELECT au.chk(au.prueba(format($q$INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha)
                                 VALUES ($1, $2, %L, 'x', 'ordinaria', CURRENT_DATE)$q$, au.id('A_FIN2')), au.id('A'), au.id('PU')),
  '23505:actas_reunion_asamblea_key', 'una asamblea tiene UNA acta formal');
SELECT au.chk(au.prueba('UPDATE public.actas_reunion SET asamblea_id = $2 WHERE id = $1', au.id('ACTA_SUELTA'), au.id('A_FIN')),
  'ok:1', 'un acta suelta SÍ se liga después a una asamblea finalizada de su condominio');
SELECT au.chk(au.prueba('UPDATE public.actas_reunion SET project_id = $2 WHERE id = $1', au.id('ACTA_FIN2'), au.id('PX')),
  '23514:ACTA_ASAMBLEA', 'NO se mueve a otro condominio un acta ligada');
SELECT au.chk(au.prueba('UPDATE public.actas_reunion SET titulo = ''Corregida'' WHERE id = $1', au.id('ACTA_FIN2')),
  'ok:1', 'lo demás del acta ligada SÍ se edita');
RESET ROLE;
SELECT au.chk(au.tras('DELETE FROM public.asambleas WHERE id = $1',
                      'SELECT coalesce(asamblea_id::text, ''NULL'') FROM public.actas_reunion WHERE id = $2', au.id('A_FIN2'), au.id('ACTA_FIN2')),
  'NULL', 'borrar la asamblea NO borra su acta: queda suelta');

-- ── 3 · Levantar el acta desde la asamblea ──────────────────────────────────
SELECT au.como('ACT_A'); SET ROLE authenticated;
SELECT au.chk((SELECT count(*)::text FROM public.votos_asamblea), '0',
  '(control) ACT_A no ve Votaciones: no lee ningún voto');
SELECT au.chk(au.tras('SELECT public.asamblea_generar_acta($1)',
                      'SELECT titulo || '' | '' || tipo || '' | '' || fecha || '' | '' || lugar || '' | '' || quorum || ''/'' || quorum_requerido FROM public.actas_reunion WHERE asamblea_id = $1',
                      au.id('A_FIN')),
  format('Acta — Ordinaria de octubre | ordinaria | %s | Salón | 75/50', CURRENT_DATE - 3),
  'el acta sale con título, tipo, fecha, lugar y quórum de la asamblea (75 % de 50 %)');
SELECT au.chk(au.tras('SELECT public.asamblea_generar_acta($1)',
                      'SELECT asistentes::text FROM public.actas_reunion WHERE asamblea_id = $1', au.id('A_FIN')),
  '[{"rol": "Presencial", "nombre": "Ana Ruiz", "unidad": "Casa 1"}, {"rol": "Apoderado", "nombre": "Juana Pérez", "unidad": "Casa 2"}, {"rol": "Votó", "nombre": "Casa 3", "unidad": "Casa 3"}]',
  'asistentes: el propietario de P1, la apoderada de P2 y P3, que votó (aunque ACT_A no vea los votos); P4 faltó');
SELECT au.chk(au.tras('SELECT public.asamblea_generar_acta($1)',
                      'SELECT string_agg(e ->> ''punto'' || '': '' || (e ->> ''acuerdo''), '' || '' ORDER BY i) FROM public.actas_reunion, jsonb_array_elements(orden_del_dia) WITH ORDINALITY t(e, i) WHERE asamblea_id = $1',
                      au.id('A_FIN')),
  'Presupuesto 2027: Aprobado — a favor 2, en contra 1, abstención 0 · mayoría simple || Cuota extraordinaria: Rechazado — a favor 1, en contra 0, abstención 2 · mayoría absoluta || Informe del tesorero: ',
  'orden del día: cada punto con el resultado del escrutinio y su regla; el informativo, sin acuerdo');
SELECT au.chk(au.tras('SELECT public.asamblea_generar_acta($1)',
                      'SELECT acuerdos FROM public.actas_reunion WHERE asamblea_id = $1', au.id('A_FIN')),
  '• Presupuesto 2027', 'acuerdos: sólo los puntos aprobados');
SELECT au.chk(au.tras('SELECT public.asamblea_generar_acta($1)',
                      'SELECT observaciones FROM public.actas_reunion WHERE asamblea_id = $1', au.id('A_FIN')),
  E'Quórum: 75.00 % de 50 % requerido (por unidad). Presentes: 3 de 4 unidades del padrón.\n\nResumen del secretario',
  'observaciones: el quórum del escrutinio y el resumen que ya tenía la asamblea');
SELECT au.chk(au.tras('SELECT public.asamblea_generar_acta($1)',
                      'SELECT (public.asamblea_generar_acta($1) = (SELECT id FROM public.actas_reunion WHERE asamblea_id = $1))::text || '' '' || (SELECT count(*) FROM public.actas_reunion WHERE asamblea_id = $1)',
                      au.id('A_FIN')),
  'true 1', 'levantarla otra vez devuelve la misma acta, no otra');
SELECT au.chk(au.tras('SELECT 1', 'SELECT (public.asamblea_generar_acta($1) = $2)::text', au.id('A_FIN2'), au.id('ACTA_FIN2')),
  'true', 'si la asamblea ya tenía acta, devuelve esa');
SELECT au.chk(au.prueba('SELECT public.asamblea_generar_acta($1)', au.id('A_CUR')),
  '23514:ACTA_ASAMBLEA_ABIERTA', 'NO se levanta el acta de una asamblea en curso');
RESET ROLE;
SELECT au.como('VSA_A'); SET ROLE authenticated;
SELECT au.chk(au.prueba('SELECT public.asamblea_generar_acta($1)', au.id('A_FIN')),
  '42501:No autorizado', 'VSA_A ve la asamblea pero no crea actas: NO la levanta');
RESET ROLE;
SELECT au.como('VAC_A'); SET ROLE authenticated;
SELECT au.chk(au.prueba('SELECT public.asamblea_generar_acta($1)', au.id('A_FIN')),
  '42501:No autorizado', 'VAC_A crea actas pero no ve la asamblea: NO la levanta');
RESET ROLE;
SELECT au.como('ADM_B'); SET ROLE authenticated;
SELECT au.chk(au.prueba('SELECT public.asamblea_generar_acta($1)', au.id('A_FIN')),
  '42501:No autorizado', 'el admin de otra empresa NO la levanta');
RESET ROLE;
SELECT au.como('SIN'); SET ROLE authenticated;
SELECT au.chk(au.prueba('SELECT public.asamblea_generar_acta($1)', au.id('A_FIN')),
  '42501:No autorizado', 'una sesión sin perfil NO la levanta');
RESET ROLE;
SELECT au.chk(has_function_privilege('anon', 'public.asamblea_generar_acta(uuid)', 'EXECUTE')::text, 'false', 'anon no la ejecuta');

-- ── 4 · Votaciones: consulta con reglas ─────────────────────────────────────
SELECT au.como('ADM_A'); SET ROLE authenticated;
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}]')$q$, au.id('A'), au.id('PU')),
  '23514:votaciones_opciones_check', 'una votación lleva al menos dos opciones');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}, {"id": "1", "texto": "No"}]')$q$, au.id('A'), au.id('PU')),
  '23514:votaciones_opciones_check', 'con ids distintos');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "  "}]')$q$, au.id('A'), au.id('PU')),
  '23514:votaciones_opciones_check', 'y con texto');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones) VALUES ($1, $2, 'x', '{"1": "Sí", "2": "No"}')$q$, au.id('A'), au.id('PU')),
  '23514:votaciones_opciones_check', 'las opciones son una lista');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones, quorum_requerido) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "No"}]', -1)$q$, au.id('A'), au.id('PU')),
  '23514:votaciones_quorum_check', 'el mínimo de votos no es negativo');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones, estado) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "No"}]', 'cerrada')$q$, au.id('A'), au.id('PU')),
  '23514:VOTACION_ESCRUTINIO', 'una votación nace abierta');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones, resultado) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "No"}]', 'Sí')$q$, au.id('A'), au.id('PU')),
  '23514:VOTACION_ESCRUTINIO', 'y sin resultado');
SELECT au.chk(au.prueba($q$INSERT INTO public.votaciones (company_id, project_id, titulo, opciones) VALUES ($1, $2, 'x', '[{"id": "1", "texto": "Sí"}, {"id": "2", "texto": "No"}, {"id": "3", "texto": "Me abstengo"}]')$q$, au.id('A'), au.id('PU')),
  'ok:1', 'SÍ entra una consulta de tres opciones');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET estado = ''pausada'' WHERE id = $1', au.id('V_ABIERTA')),
  '23514:votaciones_estado_check', 'el estado sólo es abierta, cerrada o anulada');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET resultado = ''Sí'' WHERE id = $1', au.id('V_ABIERTA')),
  '23514:VOTACION_ESCRUTINIO', 'el resultado NO se escribe a mano');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET conteo = ''{"1": 9}'' WHERE id = $1', au.id('V_ABIERTA')),
  '23514:VOTACION_ESCRUTINIO', 'ni el conteo');
SELECT au.chk(au.prueba($q$UPDATE public.votaciones SET opciones = '[{"id": "1", "texto": "Verde"}, {"id": "2", "texto": "Azul"}]' WHERE id = $1$q$, au.id('V_ABIERTA')),
  '23514:VOTACION_CON_VOTOS', 'con votos, las opciones no cambian');
SELECT au.chk(au.prueba($q$UPDATE public.votaciones SET opciones = '[{"id": "1", "texto": "Rosas"}, {"id": "2", "texto": "Palmas"}]' WHERE id = $1$q$, au.id('V_SINVOTOS')),
  'ok:1', 'sin votos, SÍ');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET titulo = ''Otro'' WHERE id = $1', au.id('V_ABIERTA')),
  'ok:1', 'el título de una abierta SÍ se edita');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET titulo = ''Otro'' WHERE id = $1', au.id('V_CERRADA')),
  '23514:VOTACION_CERRADA', 'una cerrada ya no cambia');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET estado = ''abierta'' WHERE id = $1', au.id('V_CERRADA')),
  '23514:VOTACION_CERRADA', 'ni se reabre');
SELECT au.chk(au.prueba('UPDATE public.votaciones SET estado = ''abierta'' WHERE id = $1', au.id('V_ANULADA')),
  '23514:VOTACION_CERRADA', 'una anulada tampoco');

SELECT au.chk(au.tras('UPDATE public.votaciones SET estado = ''cerrada'' WHERE id = $1',
                      'SELECT resultado || '' '' || conteo::text || '' '' || (fecha_cierre IS NOT NULL) FROM public.votaciones WHERE id = $1', au.id('V_ABIERTA')),
  'Sí {"1": 2, "2": 1} true', 'al cerrar, la base escribe el conteo, la opción ganadora y la fecha de cierre');
SELECT au.chk(au.tras('UPDATE public.votaciones SET estado = ''cerrada'' WHERE id = $1',
                      'SELECT resultado FROM public.votaciones WHERE id = $1', au.id('V_EMPATE')),
  'Empate', '1 a 1: «Empate»');
SELECT au.chk(au.tras('UPDATE public.votaciones SET estado = ''cerrada'' WHERE id = $1',
                      'SELECT resultado FROM public.votaciones WHERE id = $1', au.id('V_SINQ')),
  'Sin quórum', '1 voto de un mínimo de 3: «Sin quórum»');
SELECT au.chk(au.tras('UPDATE public.votaciones SET estado = ''cerrada'' WHERE id = $1',
                      'SELECT resultado || '' '' || conteo::text FROM public.votaciones WHERE id = $1', au.id('V_SINVOTOS')),
  'Sin votos {"1": 0, "2": 0}', 'sin votos: «Sin votos»');
SELECT au.chk(au.tras('UPDATE public.votaciones SET estado = ''anulada'' WHERE id = $1',
                      'SELECT coalesce(resultado, ''NULL'') FROM public.votaciones WHERE id = $1', au.id('V_ABIERTA')),
  'NULL', 'anular no escribe resultado');
SELECT au.chk((SELECT resultado FROM public.votaciones WHERE id = au.id('V_CERRADA')), 'Sí', 'V_CERRADA quedó «Sí» al cerrarse en el padrón');

SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''9'')', au.id('P4')),
                        au.id('A'), au.id('V_ABIERTA')),
  '23514:VOTO_OPCION', 'NO se vota una opción que no existe');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('P4')),
                        au.id('A'), au.id('V_ABIERTA')),
  'ok:1', 'SÍ vota una unidad del condominio por una opción que existe');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('P4')),
                        au.id('A'), au.id('V_CERRADA')),
  '23514:VOTACION_CERRADA', 'NO se vota con la votación cerrada');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('P4')),
                        au.id('A'), au.id('V_ANULADA')),
  '23514:VOTACION_CERRADA', 'ni anulada');
SELECT au.chk(au.prueba('DELETE FROM public.votos WHERE votacion_id = $1', au.id('V_CERRADA')),
  '23514:VOTACION_CERRADA', 'los votos de una cerrada no se borran');
SELECT au.chk(au.prueba('DELETE FROM public.votos WHERE votacion_id = $1', au.id('V_ABIERTA')),
  'ok:3', 'los de una abierta SÍ');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('X1')),
                        au.id('A'), au.id('V_ABIERTA')),
  '42501:VOTO_CONDOMINIO', 'NO vota una unidad de otro condominio de la empresa');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('UB')),
                        au.id('A'), au.id('V_ABIERTA')),
  '42501:VOTO_CONDOMINIO', 'ni una unidad de otra empresa');
SELECT au.chk(au.prueba(format('INSERT INTO public.votos (company_id, votacion_id, unidad_id, opcion_id) VALUES ($1, $2, %L, ''1'')', au.id('UB')),
                        au.id('A'), au.id('V_B')),
  '42501:VOTO_CONDOMINIO', 'ni se vota en la votación de otra empresa diciendo ser la propia');
RESET ROLE;

-- ── 5 · Retiro y cascadas ───────────────────────────────────────────────────
SELECT au.chk(coalesce(to_regclass('public.asambleas_digital')::text, 'NULL'), 'NULL', 'asambleas_digital ya no existe');
SELECT au.chk(au.prueba('DELETE FROM public.unidades WHERE id = $1', au.id('P1')), 'ok:1',
  'SÍ se borra una unidad con votos en una votación cerrada (caen con ella)');
SELECT au.chk(au.prueba('DELETE FROM public.votaciones WHERE id = $1', au.id('V_CERRADA')), 'ok:1',
  'SÍ se borra una votación cerrada, con sus votos');
SELECT au.chk(au.prueba('DELETE FROM public.projects WHERE id = $1', au.id('PU')), 'ok:1',
  'SÍ se borra el condominio entero');
