-- ============================================================================
-- INVARIANTES de 20261106000200 sobre el padrón (fixture.sql).
--
-- El padrón se toma al abrir con la base del condominio y no lo escribe
-- nadie más; la asistencia (presencial, virtual o por poder) va sólo con la
-- asamblea en curso y para unidades del padrón; vota sólo el padrón; con
-- votos, la regla de mayoría no cambia; al finalizar la base escribe quórum,
-- escrutinio y resultado según la mayoría de cada punto, ponderado por la
-- base; el panel lee el escrutinio sólo dentro de su empresa; y las cascadas
-- siguen pasando.
-- ============================================================================
\set ON_ERROR_STOP on

SELECT ae.como('ADM_A'); SET ROLE authenticated;

-- ── 1 · Vocabulario ─────────────────────────────────────────────────────────
SELECT ae.chk(ae.prueba($q$INSERT INTO public.configuracion_condominio (company_id, project_id, clave, valor, tipo)
                           VALUES ($1, $2, 'asambleas_base_votacion', 'mixta', 'texto')$q$, ae.id('A'), ae.id('PU')),
  '23514:configuracion_condominio_base_votacion_check', 'la base de votación del condominio sólo es unidad o alicuota');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.configuracion_condominio (company_id, project_id, clave, valor, tipo)
                           VALUES ($1, $2, 'asambleas_base_votacion', 'unidad', 'texto')$q$, ae.id('A'), ae.id('PU')),
  'ok:1', 'ADM_A SÍ configura «por unidad»');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.configuracion_condominio (company_id, project_id, clave, valor, tipo)
                           VALUES ($1, $2, 'nombre_condominio', 'mixta', 'texto')$q$, ae.id('A'), ae.id('PU')),
  'ok:1', 'el CHECK sólo mira su clave: las demás siguen siendo texto libre');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria) VALUES ($1, 'x', 'votacion', 'unanime')$q$, ae.id('U_PROG')),
  '23514:puntos_asamblea_mayoria_check', 'la mayoría sólo es simple, absoluta o calificada');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria) VALUES ($1, 'x', 'votacion', 'calificada')$q$, ae.id('U_PROG')),
  '23514:puntos_asamblea_mayoria_pct_check', 'una calificada sin porcentaje NO entra');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria, mayoria_pct) VALUES ($1, 'x', 'votacion', 'calificada', 50)$q$, ae.id('U_PROG')),
  '23514:puntos_asamblea_mayoria_pct_check', 'una calificada del 50 % NO entra (eso es absoluta)');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria, mayoria_pct) VALUES ($1, 'x', 'votacion', 'calificada', 100.01)$q$, ae.id('U_PROG')),
  '23514:puntos_asamblea_mayoria_pct_check', 'una calificada de más del 100 % NO entra');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria, mayoria_pct) VALUES ($1, 'x', 'votacion', 'simple', 60)$q$, ae.id('U_PROG')),
  '23514:puntos_asamblea_mayoria_pct_check', 'una simple con porcentaje NO entra');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria, mayoria_pct) VALUES ($1, 'x', 'votacion', 'calificada', 66.67)$q$, ae.id('U_PROG')),
  'ok:1', 'SÍ entra una calificada de dos tercios');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.puntos_asamblea (asamblea_id, titulo, tipo, mayoria, mayoria_pct) VALUES ($1, 'x', 'votacion', 'calificada', 100)$q$, ae.id('U_PROG')),
  'ok:1', 'SÍ entra una calificada de unanimidad (100 %)');
SELECT ae.chk((SELECT column_default FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'puntos_asamblea' AND column_name = 'mayoria'), '''simple''::text',
  'un punto sin mayoría declarada es de mayoría simple');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, quorum_requerido)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 150)$q$, ae.id('A'), ae.id('PU')),
  '23514:asambleas_quorum_requerido_check', 'el quórum requerido va de 0 a 100');

-- ── 2 · Apertura y padrón ───────────────────────────────────────────────────
SELECT ae.chk(ae.abrir('U_PROG'), 'unidad 4 4.00', 'abrir U_PROG fija «por unidad» y toma las 4 unidades activas, cada una vale 1');
SELECT ae.chk((SELECT base_votacion FROM public.asambleas WHERE id = ae.id('U_CUR')), 'unidad',
  'U_CUR, abierta con un UPDATE, rige por unidad');
SELECT ae.chk((SELECT string_agg(i.alias || '=' || pa.peso, ' ' ORDER BY i.alias)
                 FROM public.padron_asamblea pa JOIN ae.ids i ON i.id = pa.unidad_id WHERE pa.asamblea_id = ae.id('U_CUR')),
  'P1=1.0000 P2=1.0000 P3=1.0000 P4=1.0000', 'el padrón de U_CUR: P1…P4, sin la unidad dada de baja');
SELECT ae.chk((SELECT base_votacion FROM public.asambleas WHERE id = ae.id('A_CUR')), 'alicuota',
  'A_CUR, insertada en curso, rige por la alícuota de su condominio');
SELECT ae.chk((SELECT string_agg(i.alias || '=' || pa.peso, ' ' ORDER BY i.alias)
                 FROM public.padron_asamblea pa JOIN ae.ids i ON i.id = pa.unidad_id WHERE pa.asamblea_id = ae.id('A_CUR')),
  'L1=40.0000 L2=35.0000 L3=20.0000 L4=0.0000',
  'pesos por alícuota: la propia; sin ella, su parte de los m² activos (50/250); sin ninguna, 0; la dada de baja no está');
SELECT ae.chk(ae.abrir('Z_PROG'), '23514:ASAMBLEA_PADRON', 'NO se abre por alícuota si ninguna unidad tiene alícuota ni m²');
UPDATE public.configuracion_condominio SET valor = 'unidad' WHERE project_id = ae.id('PZ') AND clave = 'asambleas_base_votacion';
SELECT ae.chk(ae.abrir('Z_PROG'), 'unidad 2 2.00', 'con el condominio pasado a «por unidad», SÍ abre: la base se lee al abrir');
UPDATE public.configuracion_condominio SET valor = 'alicuota' WHERE project_id = ae.id('PZ') AND clave = 'asambleas_base_votacion';
UPDATE public.configuracion_condominio SET valor = 'unidad' WHERE project_id = ae.id('PA') AND clave = 'asambleas_base_votacion';
SELECT ae.chk((SELECT base_votacion || ' ' || (SELECT round(sum(peso), 2) FROM public.padron_asamblea WHERE asamblea_id = a.id)
                 FROM public.asambleas a WHERE a.id = ae.id('A_CUR')), 'alicuota 95.00',
  'cambiar la base del condominio NO cambia la de una asamblea ya abierta');
UPDATE public.configuracion_condominio SET valor = 'alicuota' WHERE project_id = ae.id('PA') AND clave = 'asambleas_base_votacion';

SELECT ae.chk(ae.codigo('INSERT INTO public.padron_asamblea (asamblea_id, unidad_id, unidad_nombre, peso) VALUES ($1, $2, ''x'', 1)', ae.id('U_CUR'), ae.id('P5')),
  '42501', 'ni el admin agrega una unidad al padrón');
SELECT ae.chk(ae.codigo('UPDATE public.padron_asamblea SET peso = 10 WHERE asamblea_id = $1', ae.id('U_CUR')),
  '42501', 'ni le cambia el peso');
SELECT ae.chk(ae.codigo('DELETE FROM public.padron_asamblea WHERE asamblea_id = $1', ae.id('U_CUR')),
  '42501', 'ni saca unidades del padrón');
RESET ROLE;
SELECT ae.como('VER_A'); SET ROLE authenticated;
SELECT ae.chk((SELECT count(*)::text FROM public.padron_asamblea WHERE asamblea_id = ae.id('U_CUR')), '4', 'VER_A, que ve Asambleas, SÍ lee el padrón');
RESET ROLE;
SELECT ae.como('NOP_A'); SET ROLE authenticated;
SELECT ae.chk((SELECT count(*)::text FROM public.padron_asamblea WHERE asamblea_id = ae.id('U_CUR')), '0', 'NOP_A, sin permiso, NO lee el padrón');
RESET ROLE;
SELECT ae.como('ADM_B'); SET ROLE authenticated;
SELECT ae.chk((SELECT count(*)::text FROM public.padron_asamblea WHERE asamblea_id = ae.id('U_CUR')), '0', 'el admin de otra empresa NO lee el padrón');
RESET ROLE;

-- El padrón es el de la apertura: una unidad nueva no entra, una dada de baja
-- no sale y el nombre queda el de ese día.
SELECT ae.como('ADM_A');
INSERT INTO public.unidades (id, project_id, company_id, nombre) VALUES (ae.id('P6'), ae.id('PU'), ae.id('A'), 'Casa 6');
UPDATE public.unidades SET activo = false WHERE id = ae.id('P4');
UPDATE public.unidades SET nombre = 'Casa Uno' WHERE id = ae.id('P1');
SELECT ae.chk((SELECT string_agg(i.alias || ':' || pa.unidad_nombre, ' ' ORDER BY i.alias)
                 FROM public.padron_asamblea pa JOIN ae.ids i ON i.id = pa.unidad_id WHERE pa.asamblea_id = ae.id('U_CUR')),
  'P1:Casa 1 P2:Casa 2 P3:Casa 3 P4:Casa 4',
  'el padrón de U_CUR no cambia: sin P6 (alta posterior), con P4 (baja posterior), con el nombre del día');
SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(ae.abrir('U_PROG'), 'unidad 4 4.00', 'y una asamblea que abre ahora toma las activas de ahora (P1, P2, P3, P6)');
RESET ROLE;
UPDATE public.unidades SET activo = true WHERE id = ae.id('P4');

-- ── 3 · Lo calculado no se escribe a mano ───────────────────────────────────
SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET base_votacion = ''alicuota'' WHERE id = $1', ae.id('U_CUR')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se cambia a mano la base de votación de una asamblea abierta');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_alcanzado = 99 WHERE id = $1', ae.id('U_CUR')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se escribe a mano el quórum alcanzado');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET escrutinio = ''{}'' WHERE id = $1', ae.id('U_CUR')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se escribe a mano el escrutinio');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET escrutinio = NULL WHERE id = $1', ae.id('U_FIN')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se borra el escrutinio de una asamblea finalizada');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_alcanzado = 100 WHERE id = $1', ae.id('U_FIN')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se corrige el quórum alcanzado de una asamblea finalizada');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, quorum_alcanzado)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 10)$q$, ae.id('A'), ae.id('PU')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se convoca una asamblea con el quórum alcanzado ya escrito');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asambleas (company_id, project_id, titulo, fecha, hora_inicio, base_votacion)
                           VALUES ($1, $2, 'x', CURRENT_DATE, '18:00', 'alicuota')$q$, ae.id('A'), ae.id('PU')),
  '23514:ASAMBLEA_ESCRUTINIO', 'NO se convoca una asamblea con otra base que la del condominio');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET titulo = ''Otro título'', lugar = ''Salón'' WHERE id = $1', ae.id('U_CUR')),
  'ok:1', 'lo demás de la asamblea SÍ se edita');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_requerido = 60 WHERE id = $1', ae.id('U_PROG')),
  'ok:1', 'el quórum requerido SÍ cambia mientras la asamblea está programada');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_requerido = 10 WHERE id = $1', ae.id('U_CUR')),
  '23514:ASAMBLEA_QUORUM', 'el quórum requerido NO cambia con la asamblea en curso');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_requerido = 10 WHERE id = $1', ae.id('U_FIN')),
  '23514:ASAMBLEA_QUORUM', 'ni finalizada');
SELECT ae.chk(ae.prueba('UPDATE public.asambleas SET quorum_requerido = 10 WHERE id = $1', ae.id('U_CAN')),
  '23514:ASAMBLEA_QUORUM', 'ni cancelada');
RESET ROLE;

-- ── 4 · Asistencia ──────────────────────────────────────────────────────────
SELECT ae.como('EDT_A'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CUR'), ae.id('P4')),
  'ok:1', 'EDT_A, que edita Asambleas, SÍ registra una asistencia');
SELECT ae.chk(ae.prueba('UPDATE public.asistencia_asamblea SET modalidad = ''virtual'' WHERE id = $1', ae.id('S_UC_P1')),
  'ok:1', 'EDT_A SÍ corrige la modalidad con la asamblea en curso');
SELECT ae.chk(ae.prueba('DELETE FROM public.asistencia_asamblea WHERE id = $1', ae.id('S_UC_P1')),
  'ok:1', 'EDT_A SÍ quita una asistencia mal registrada con la asamblea en curso');
RESET ROLE;
SELECT ae.como('VER_A'); SET ROLE authenticated;
SELECT ae.chk(ae.codigo('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CUR'), ae.id('P4')),
  '42501', 'VER_A, que sólo ve Asambleas, NO registra asistencia');
SELECT ae.chk(ae.prueba('UPDATE public.asistencia_asamblea SET modalidad = ''virtual'' WHERE id = $1', ae.id('S_UC_P1')),
  'ok:0', 'ni la cambia');
SELECT ae.chk(ae.prueba('DELETE FROM public.asistencia_asamblea WHERE id = $1', ae.id('S_UC_P1')),
  'ok:0', 'ni la quita');
SELECT ae.chk((SELECT count(*)::text FROM public.asistencia_asamblea WHERE asamblea_id = ae.id('U_CUR')), '2', 'pero SÍ la lee');
RESET ROLE;
SELECT ae.como('NOP_A'); SET ROLE authenticated;
SELECT ae.chk(ae.codigo('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CUR'), ae.id('P4')),
  '42501', 'NOP_A, sin permiso, NO registra asistencia');
SELECT ae.chk((SELECT count(*)::text FROM public.asistencia_asamblea WHERE asamblea_id = ae.id('U_CUR')), '0', 'ni la lee');
RESET ROLE;
SELECT ae.como('ADM_B'); SET ROLE authenticated;
SELECT ae.chk(ae.codigo('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CUR'), ae.id('P4')),
  '42501', 'el admin de otra empresa NO registra asistencia en U_CUR');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('B_CUR'), ae.id('UB1')),
  'ok:1', 'el admin de B SÍ la registra en su asamblea (B tiene el plan)');
RESET ROLE;
SELECT ae.como('ADM_C'); SET ROLE authenticated;
SELECT ae.chk(ae.codigo('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('C_CUR'), ae.id('UC1')),
  '42501', 'el admin de C NO la registra: su plan no incluye asambleas digitales');
RESET ROLE;

SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba(format($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, poder_documento)
                                 VALUES ($1, $2, 'poder', %L)$q$, ae.id('PU')::text || '/asambleas/poderes/carta.pdf'), ae.id('U_CUR'), ae.id('P4')),
  '23514:asistencia_asamblea_poder_check', 'un poder sin apoderado NO entra');
SELECT ae.chk(ae.prueba(format($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre, poder_documento)
                                 VALUES ($1, $2, 'poder', '   ', %L)$q$, ae.id('PU')::text || '/asambleas/poderes/carta.pdf'), ae.id('U_CUR'), ae.id('P4')),
  '23514:asistencia_asamblea_poder_check', 'ni con el apoderado en blanco');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre)
                           VALUES ($1, $2, 'poder', 'Luis Gómez')$q$, ae.id('U_CUR'), ae.id('P4')),
  '23514:asistencia_asamblea_poder_check', 'un poder sin documento NO entra');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre)
                           VALUES ($1, $2, 'presencial', 'Luis Gómez')$q$, ae.id('U_CUR'), ae.id('P4')),
  '23514:asistencia_asamblea_poder_check', 'una asistencia presencial NO lleva apoderado');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, 'remota')$q$, ae.id('U_CUR'), ae.id('P4')),
  '23514:asistencia_asamblea_modalidad_check', 'la modalidad sólo es presencial, virtual o poder');
SELECT ae.chk(ae.prueba(format($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre, poder_documento)
                                 VALUES ($1, $2, 'poder', 'Luis Gómez', %L)$q$, ae.id('PU')::text || '/asambleas/poderes/carta-p4.pdf'), ae.id('U_CUR'), ae.id('P4')),
  'ok:1', 'un poder con apoderado y documento del condominio SÍ entra');
SELECT ae.chk(ae.prueba(format($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre, poder_documento)
                                 VALUES ($1, $2, 'poder', 'Luis Gómez', %L)$q$, ae.id('PA')::text || '/asambleas/poderes/carta-p4.pdf'), ae.id('U_CUR'), ae.id('P4')),
  '23514:ASISTENCIA_PODER', 'NO con el documento en el espacio de otro condominio');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad, apoderado_nombre, poder_documento)
                           VALUES ($1, $2, 'poder', 'Luis Gómez', 'carta.pdf')$q$, ae.id('U_CUR'), ae.id('P4')),
  '23514:ASISTENCIA_PODER', 'ni con un documento fuera de todo condominio');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''virtual'')', ae.id('U_CUR'), ae.id('P1')),
  '23505:asistencia_asamblea_unidad_key', 'una unidad asiste una sola vez');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CUR'), ae.id('P5')),
  '23514:ASAMBLEA_PADRON', 'NO asiste una unidad que no está en el padrón (dada de baja)');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CUR'), ae.id('L1')),
  '23514:ASAMBLEA_PADRON', 'ni una unidad de otro condominio');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_PROG'), ae.id('P1')),
  '23514:ASAMBLEA_NO_ABIERTA', 'NO se toma asistencia con la asamblea programada');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_FIN'), ae.id('P2')),
  '23514:ASAMBLEA_CERRADA', 'NO se agrega asistencia a una asamblea finalizada');
SELECT ae.chk(ae.prueba('INSERT INTO public.asistencia_asamblea (asamblea_id, unidad_id, modalidad) VALUES ($1, $2, ''presencial'')', ae.id('U_CAN'), ae.id('P2')),
  '23514:ASAMBLEA_CERRADA', 'ni a una cancelada');
SELECT ae.chk(ae.prueba('UPDATE public.asistencia_asamblea SET modalidad = ''virtual'' WHERE id = $1', ae.id('S_UF_P1')),
  '23514:ASAMBLEA_CERRADA', 'NO se cambia la asistencia de una asamblea finalizada');
SELECT ae.chk(ae.prueba('DELETE FROM public.asistencia_asamblea WHERE id = $1', ae.id('S_UF_P1')),
  '23514:ASAMBLEA_CERRADA', 'ni se quita');
SELECT ae.chk(ae.prueba('DELETE FROM public.asistencia_asamblea WHERE id = $1', ae.id('S_CAN_P1')),
  '23514:ASAMBLEA_CERRADA', 'ni la de una cancelada');
SELECT ae.chk(ae.prueba('UPDATE public.asistencia_asamblea SET asamblea_id = $2 WHERE id = $1', ae.id('S_UC_P1'), ae.id('U_FIN')),
  '23514:ASAMBLEA_CERRADA', 'NO se mueve una asistencia a una asamblea finalizada');
RESET ROLE;

-- ── 5 · Vota el padrón ──────────────────────────────────────────────────────
SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ae.id('UC_ABS'), ae.id('P5')),
  '23514:ASAMBLEA_PADRON', 'con el padrón tomado, NO vota una unidad dada de baja');
SELECT ae.chk(ae.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ae.id('UC_ABS'), ae.id('P6')),
  '23514:ASAMBLEA_PADRON', 'ni una unidad dada de alta después de abrir');
SELECT ae.chk(ae.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ae.id('UC_ABS'), ae.id('L1')),
  '23514:ASAMBLEA_PADRON', 'ni una unidad de otro condominio');
SELECT ae.chk(ae.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ae.id('UC_ABS'), ae.id('P4')),
  'ok:1', 'SÍ vota una unidad del padrón');
SELECT ae.chk(ae.prueba('INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto) VALUES ($1, $2, ''a_favor'')', ae.id('PU_PROG_P'), ae.id('P5')),
  'ok:1', 'antes de abrir (sin padrón) se vota como hasta ahora; el escrutinio sólo cuenta el padrón');
SELECT ae.chk(ae.prueba('UPDATE public.votos_asamblea SET unidad_id = $2 WHERE punto_id = $1 AND unidad_id = ae.id(''P1'')', ae.id('UC_SIMPLE'), ae.id('P5')),
  '23514:ASAMBLEA_PADRON', 'NO se pasa un voto a una unidad fuera del padrón');
SELECT ae.chk(ae.prueba('UPDATE public.votos_asamblea SET voto = ''abstencion'' WHERE punto_id = $1 AND unidad_id = $2', ae.id('UC_SIMPLE'), ae.id('P1')),
  'ok:1', 'una unidad del padrón SÍ cambia su voto con la asamblea en curso');
SELECT ae.chk(ae.prueba($q$INSERT INTO public.votos_asamblea (punto_id, unidad_id, voto, registrado_por) VALUES ($1, $2, 'en_contra', auth.uid())
                           ON CONFLICT (punto_id, unidad_id) DO UPDATE
                           SET punto_id = EXCLUDED.punto_id, unidad_id = EXCLUDED.unidad_id, voto = EXCLUDED.voto, registrado_por = EXCLUDED.registrado_por$q$,
                        ae.id('UC_SIMPLE'), ae.id('P1')),
  'ok:1', 'el re-voto del panel (upsert que reescribe punto y unidad) SÍ pasa');

-- ── 6 · Con votos, la regla de mayoría no cambia ────────────────────────────
SELECT ae.chk(ae.prueba('UPDATE public.puntos_asamblea SET mayoria = ''absoluta'' WHERE id = $1', ae.id('UC_SIMPLE')),
  '23514:PUNTO_CON_VOTOS', 'NO se cambia la mayoría de un punto con votos');
SELECT ae.chk(ae.prueba('UPDATE public.puntos_asamblea SET mayoria_pct = 70 WHERE id = $1', ae.id('UC_CAL')),
  '23514:PUNTO_CON_VOTOS', 'ni el porcentaje de una calificada');
SELECT ae.chk(ae.prueba('UPDATE public.puntos_asamblea SET tipo = ''informativo'' WHERE id = $1', ae.id('UC_SIMPLE')),
  '23514:PUNTO_CON_VOTOS', 'ni su tipo (sacarlo de la votación escondería los votos)');
SELECT ae.chk(ae.prueba('UPDATE public.puntos_asamblea SET mayoria = ''calificada'', mayoria_pct = 60 WHERE id = $1', ae.id('UC_SINVOTOS')),
  'ok:1', 'sin votos, la mayoría SÍ cambia');
SELECT ae.chk(ae.prueba('UPDATE public.puntos_asamblea SET titulo = ''Presupuesto 2027'' WHERE id = $1', ae.id('UC_SIMPLE')),
  'ok:1', 'con votos, el título SÍ cambia');

-- ── 7 · El escrutinio al finalizar ──────────────────────────────────────────
SELECT ae.chk(ae.cerrar('U_CUR') #>> '{escrutinio,padron,unidades}', '4', 'U_CUR · padrón de 4 unidades');
SELECT ae.chk(ae.cerrar('U_CUR') #>> '{escrutinio,presentes,unidades}', '3',
  'U_CUR · 3 presentes: P1 en persona, P2 por poder, P3 porque votó; P4 faltó');
SELECT ae.chk(ae.cerrar('U_CUR') #>> '{escrutinio,quorum_pct}', '75.00', 'U_CUR · quórum del 75 %');
SELECT ae.chk(ae.cerrar('U_CUR') #>> '{escrutinio,hay_quorum}', 'true', 'U_CUR · hay quórum (75 ≥ 50)');
SELECT ae.chk(ae.cerrar('U_CUR') ->> 'quorum_alcanzado', '75.00', 'U_CUR · quorum_alcanzado queda escrito en la asamblea');
SELECT ae.chk((ae.punto(ae.cerrar('U_CUR') -> 'escrutinio', 'UC_SIMPLE') #>> '{en_contra,unidades}'), '1',
  'UC_SIMPLE · el voto en contra de P5 (fuera del padrón) no cuenta: 1 en contra, no 2');
SELECT ae.chk(ae.punto(ae.cerrar('U_CUR') -> 'escrutinio', 'UC_SIMPLE') ->> 'decision', 'aprobado', 'UC_SIMPLE · simple, 2 a 1: aprobado');
SELECT ae.chk(ae.cerrar('U_CUR') #>> '{resultados,UC_SIMPLE}', 'Aprobado', 'UC_SIMPLE · y el punto dice «Aprobado»');
SELECT ae.chk(ae.punto(ae.cerrar('U_CUR') -> 'escrutinio', 'UC_ABS') ->> 'decision', 'rechazado',
  'UC_ABS · absoluta: 1 a favor de 3 presentes no supera la mitad (aunque le gane a 0 en contra)');
SELECT ae.chk(ae.cerrar('U_CUR') #>> '{resultados,UC_ABS}', 'Rechazado', 'UC_ABS · y el punto dice «Rechazado»');
SELECT ae.chk(ae.punto(ae.cerrar('U_CUR') -> 'escrutinio', 'UC_CAL') ->> 'decision', 'aprobado',
  'UC_CAL · calificada 75 %: 3 de 4 del padrón llega justo');
SELECT ae.chk(ae.punto(ae.cerrar('U_CUR') -> 'escrutinio', 'UC_CAL80') ->> 'decision', 'rechazado',
  'UC_CAL80 · calificada 80 %: 3 de 4 del padrón no llega (aunque sean todos los presentes)');
SELECT ae.chk(ae.punto(ae.cerrar('U_CUR') -> 'escrutinio', 'UC_SINVOTOS') ->> 'decision', 'rechazado',
  'UC_SINVOTOS · simple 0 a 0: un empate no aprueba');
SELECT ae.chk(jsonb_array_length(ae.cerrar('U_CUR') #> '{escrutinio,puntos}')::text, '5',
  'U_CUR · el escrutinio trae los 5 puntos de votación y no el informativo');
SELECT ae.chk(coalesce(ae.cerrar('U_CUR') #>> '{resultados,UC_INFO}', 'NULL'), 'NULL', 'UC_INFO · el punto informativo queda sin resultado');

SELECT ae.chk(ae.cerrar('A_CUR') #>> '{escrutinio,quorum_pct}', '63.16',
  'A_CUR · quórum ponderado: L1 (40) + L3 (20) + L4 (0) de 95 = 63,16 %');
SELECT ae.chk(ae.cerrar('A_CUR') #>> '{escrutinio,presentes,unidades}', '3', 'A_CUR · 3 unidades presentes (L4 cuenta, pesa 0)');
SELECT ae.chk(ae.punto(ae.cerrar('A_CUR') -> 'escrutinio', 'A_SIMPLE') #>> '{a_favor,peso}', '20.0000', 'A_SIMPLE · a favor pesa 20');
SELECT ae.chk(ae.punto(ae.cerrar('A_CUR') -> 'escrutinio', 'A_SIMPLE') #>> '{en_contra,peso}', '40.0000', 'A_SIMPLE · en contra pesa 40');
SELECT ae.chk(ae.punto(ae.cerrar('A_CUR') -> 'escrutinio', 'A_SIMPLE') ->> 'decision', 'rechazado',
  'A_SIMPLE · por alícuota se rechaza, aunque por cabeza ganaba 2 a 1');

SELECT ae.chk(ae.cerrar('U_SINQ') #>> '{escrutinio,quorum_pct}', '50.00', 'U_SINQ · 2 de 4: 50 % (P2 asistió sin votar: también cuenta)');
SELECT ae.chk(ae.cerrar('U_SINQ') #>> '{escrutinio,hay_quorum}', 'false', 'U_SINQ · sin quórum (50 < 80)');
SELECT ae.chk(ae.punto(ae.cerrar('U_SINQ') -> 'escrutinio', 'US_P') ->> 'decision', 'sin_quorum', 'US_P · sin quórum no se decide, aunque fue 1 a 0');
SELECT ae.chk(ae.cerrar('U_SINQ') #>> '{resultados,US_P}', 'Sin quórum', 'US_P · y el punto dice «Sin quórum»');

SELECT ae.chk((SELECT quorum_alcanzado::text FROM public.asambleas WHERE id = ae.id('U_FIN')), '50.00',
  'U_FIN · finalizada en el padrón: 2 de 4 presentes = 50 %, quedó escrito');
SELECT ae.chk((SELECT escrutinio ->> 'hay_quorum' FROM public.asambleas WHERE id = ae.id('U_FIN')), 'true',
  'U_FIN · 50 % alcanza un quórum requerido de 50 %');
SELECT ae.chk((SELECT resultado FROM public.puntos_asamblea WHERE id = ae.id('UF_P')), 'Aprobado', 'UF_P · quedó «Aprobado»');

SELECT ae.chk(coalesce(ae.cerrar('U_CUR', 'cancelada') ->> 'escrutinio', 'NULL') || ' ' || coalesce(ae.cerrar('U_CUR', 'cancelada') #>> '{resultados,UC_SIMPLE}', 'NULL'),
  'NULL NULL', 'cancelar NO escribe escrutinio ni resultados');
RESET ROLE;

-- ── 8 · El escrutinio para el panel ─────────────────────────────────────────
SELECT ae.como('ADM_A'); SET ROLE authenticated;
SELECT ae.chk(public.asamblea_escrutinio(ae.id('U_CUR')) ->> 'quorum_pct', '75.00', 'panel · en curso, el conteo de ahora');
SELECT ae.chk(public.asamblea_escrutinio(ae.id('U_FIN'))::text, (SELECT escrutinio::text FROM public.asambleas WHERE id = ae.id('U_FIN')),
  'panel · finalizada, el escrutinio que quedó escrito');
SELECT ae.chk(coalesce(public.asamblea_escrutinio(ae.id('U_PROG'))::text, 'NULL'), 'NULL', 'panel · programada, nada');
SELECT ae.chk(coalesce(public.asamblea_escrutinio(ae.id('U_CAN'))::text, 'NULL'), 'NULL', 'panel · cancelada, nada');
RESET ROLE;
SELECT ae.como('VER_A'); SET ROLE authenticated;
SELECT ae.chk(public.asamblea_escrutinio(ae.id('U_CUR')) ->> 'quorum_pct', '75.00', 'panel · VER_A, que ve Asambleas, SÍ lo lee');
RESET ROLE;
SELECT ae.como('NOP_A'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('SELECT public.asamblea_escrutinio($1)', ae.id('U_CUR')), '42501:No autorizado', 'panel · NOP_A, sin permiso, NO');
RESET ROLE;
SELECT ae.como('ADM_B'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('SELECT public.asamblea_escrutinio($1)', ae.id('U_CUR')), '42501:No autorizado', 'panel · el admin de otra empresa NO');
RESET ROLE;
SELECT ae.como('SIN'); SET ROLE authenticated;
SELECT ae.chk(ae.prueba('SELECT public.asamblea_escrutinio($1)', ae.id('U_CUR')), '42501:No autorizado', 'panel · una sesión sin perfil NO');
RESET ROLE;
SELECT ae.chk(has_function_privilege('anon', 'public.asamblea_escrutinio(uuid)', 'EXECUTE')::text, 'false', 'panel · anon no la ejecuta');
SELECT ae.chk((SELECT string_agg(p::text, ',') FROM unnest(ARRAY[
                 has_function_privilege('authenticated', 'public.asambleas_calcular_escrutinio(uuid)', 'EXECUTE'),
                 has_function_privilege('authenticated', 'public.asambleas_tomar_padron(uuid)', 'EXECUTE')]) p), 'false,false',
  'el cálculo y la toma del padrón no se llaman desde la API');

-- ── 9 · Las cascadas siguen pasando ─────────────────────────────────────────
SELECT ae.chk(ae.prueba('DELETE FROM public.unidades WHERE id = $1', ae.id('P1')), 'ok:1',
  'SÍ se borra una unidad con asistencia y votos en una asamblea finalizada (caen con ella)');
SELECT ae.chk(ae.prueba('DELETE FROM public.asambleas WHERE id = $1', ae.id('U_FIN')), 'ok:1',
  'SÍ se borra una asamblea finalizada, con su padrón y su asistencia');
SELECT ae.chk(ae.prueba('DELETE FROM auth.users WHERE id = $1', ae.id('REG')), 'ok:1',
  'SÍ se borra el usuario que registró una asistencia de una asamblea finalizada');
SELECT ae.chk(ae.prueba('DELETE FROM public.projects WHERE id = $1', ae.id('PU')), 'ok:1',
  'SÍ se borra el condominio entero');
