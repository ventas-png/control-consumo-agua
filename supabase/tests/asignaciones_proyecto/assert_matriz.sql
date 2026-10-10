\set ON_ERROR_STOP on
-- ============================================================================
-- MATRIZ rol × operación × objetivo sobre public.user_project_assignments
--
-- Cada caso corre como una sesión simulada (SET ROLE + claims) dentro de una subtransacción que se DESHACE: la tabla queda como
-- estaba para el caso siguiente. Los «no debe pasar» comprueban el CÓDIGO y el MENSAJE del error (o 0 filas), que la tabla no
-- cambió y que la MISMA sentencia como SISTEMA sí habría funcionado (el control): un «cero filas» nunca se presenta como éxito.
--
-- Orden en que dispara cada barrera al INSERTAR: trigger de INTEGRIDAD (23514 ASIGNACION_EMPRESA_DISTINTA) → trigger de
-- AUTOASIGNACIÓN (42501 ASIGNACION_PROPIA_NO_PERMITIDA) → política RLS (42501 row-level security) → llave única.
-- Al ACTUALIZAR o BORRAR, la política filtra primero (0 filas) y los triggers sólo ven las filas que la política dejó pasar.
--
-- Personas (ver fixture.sql): SU super_admin · SU2 superadmin de D · OW propietario · DOW propietario de D · AX/AX2 administradores
-- exentos (sin filas) · AP administrador acotado {P1,P2,P3} · DAD administrador de D · OP1..OP7 operadores (OPk → Pk,Pk+1) ·
-- VW1..VW13 visores · NUEVO operador sin filas · DOP operador de D · CLI cliente · SINEMP sin empresa · SINAPP sin app_users ·
-- ORF1..ORF6 huérfanas (user_id sin app_users). Proyectos P1..P8 de C, D1/D2 de D.
-- ============================================================================

-- ═══ A · quien NO administra: operador, visor, cliente, sin app_users, sin empresa, otra empresa, anon ══════════════
-- A1 · operador OP1 (tiene P1 y P2)
SELECT asgt.err_propia('[A1] operador no se asigna otro proyecto de su empresa (P3)', 'OP1', asgt.ins('OP1', 'P3'));
SELECT asgt.err_propia('[A1] ni repite uno que ya tiene (el trigger corre antes que la llave única)', 'OP1', asgt.ins('OP1', 'P1'),
  p_control => false);  -- como SISTEMA sería una llave duplicada (23505): no hay control posible
SELECT asgt.err_empresa('[A1] ni uno de OTRA empresa (D1): la integridad corta primero', 'OP1', asgt.ins('OP1', 'D1'));
SELECT asgt.err_rls('[A1] no asigna a otra persona de su empresa (NUEVO → P1)', 'OP1', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_rls('[A1] ni a otro operador un proyecto que ya tiene (OP7 → P1)', 'OP1', asgt.ins('OP7', 'P1'));
SELECT asgt.err_rls('[A1] ni a una persona de otra empresa en un proyecto de esa empresa (DOP → D1)', 'OP1', asgt.ins('DOP', 'D1'));
SELECT asgt.err_empresa('[A1] ni a una huérfana', 'OP1', asgt.ins('ORF1', 'P1'));
SELECT asgt.cero('[A1] cambiar su propia asignación de proyecto afecta 0 filas', 'OP1', asgt.mover('OP1', 'P1', 'P3'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[A1] cambiar el permission_type de la propia afecta 0 filas', 'OP1', asgt.permiso('OP1', 'P1', 'lectura'),
  p_efecto_sql => $q$SELECT permission_type FROM public.user_project_assignments WHERE user_id = {OP1} AND project_id = {P1}$q$, p_efecto => 'total');
SELECT asgt.cero('[A1] pasar su fila a otra persona afecta 0 filas', 'OP1', asgt.pasar_a('OP1', 'P1', 'NUEVO'));
SELECT asgt.cero('[A1] UPDATE sin WHERE: no ve ni cambia filas ajenas ni las propias', 'OP1',
  $q$UPDATE public.user_project_assignments SET permission_type = 'lectura'$q$);
SELECT asgt.cero('[A1] borrar las propias afecta 0 filas', 'OP1', asgt.borrar_de('OP1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[A1] borrar una propia concreta afecta 0 filas', 'OP1', asgt.borrar_fila('OP1', 'P2'));
SELECT asgt.cero('[A1] DELETE sin WHERE afecta 0 filas', 'OP1', $q$DELETE FROM public.user_project_assignments$q$,
  p_efecto_sql => $q$SELECT count(*) FROM public.user_project_assignments$q$, p_efecto => '43');
SELECT asgt.err_propia('[A1] UPSERT sobre su fila (DO UPDATE) falla antes de tocar nada', 'OP1',
  asgt.ins('OP1', 'P1') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'lectura'$q$);
SELECT asgt.err_propia('[A1] UPSERT sobre su fila (DO NOTHING) tampoco pasa en silencio', 'OP1',
  asgt.ins('OP1', 'P1') || ' ON CONFLICT (user_id, project_id) DO NOTHING', p_control => false);  -- como SISTEMA no afecta filas
SELECT asgt.err_rls('[A1] UPSERT sobre la fila de otro operador (OP7 · P7)', 'OP1',
  asgt.ins('OP7', 'P7') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'lectura'$q$);
SELECT asgt.err_propia('[A1] INSERT … SELECT con su propio id como valor', 'OP1',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {OP1}, {P3} FROM generate_series(1, 1)$q$);
SELECT asgt.cero('[A1] INSERT … SELECT de todos los proyectos que ve: sólo ve los suyos y no hay nada que agregar', 'OP1',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id)
     SELECT {OP1}, p.id FROM public.projects p
      WHERE p.company_id = {C} AND p.id NOT IN (SELECT project_id FROM public.user_project_assignments WHERE user_id = {OP1})$q$,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2');
SELECT asgt.caso('[A1] TRUNCATE no está permitido', 'OP1', 'TRUNCATE public.user_project_assignments', 'error',
  p_sqlstate => '42501', p_patron => 'permission denied for table user_project_assignments', p_control => false);

-- A2 · visor VW4 (una sola fila) y operador sin filas NUEVO
SELECT asgt.err_propia('[A2] un visor no se asigna otro proyecto', 'VW4', asgt.ins('VW4', 'P8'));
SELECT asgt.cero('[A2] ni borra la suya', 'VW4', asgt.borrar_de('VW4'), p_efecto_sql => $q$SELECT asgt.filas_de({VW4})$q$, p_efecto => 'P5');
SELECT asgt.cero('[A2] ni la cambia de proyecto', 'VW4', asgt.mover('VW4', 'P5', 'P1'));
SELECT asgt.err_rls('[A2] ni asigna a otro visor', 'VW4', asgt.ins('VW5', 'P1'));
SELECT asgt.err_propia('[A2] un operador SIN filas tampoco se asigna el primer proyecto', 'NUEVO', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_rls('[A2] ni se lo asigna a otro operador sin filas (misma empresa)', 'NUEVO', asgt.ins('AX2', 'P1'));

-- A3 · cliente (sin empresa), sin app_users, sin empresa
SELECT asgt.err_empresa('[A3] un cliente (company_id NULL) no se asigna: la integridad exige empresa', 'CLI', asgt.ins('CLI', 'P1'));
SELECT asgt.err_empresa('[A3] una sesión sin app_users no se asigna: la persona no existe', 'SINAPP', asgt.ins('SINAPP', 'P1'));
SELECT asgt.err_rls('[A3] ni asigna a otra persona de la empresa (sin rol no administra)', 'SINAPP', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_empresa('[A3] un operador sin empresa no se asigna', 'SINEMP', asgt.ins('SINEMP', 'P1'));
SELECT asgt.err_rls('[A3] ni asigna a otra persona', 'SINEMP', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_rls('[A3] un cliente no asigna a nadie', 'CLI', asgt.ins('NUEVO', 'P1'));

-- A4 · operador de OTRA empresa (DOP)
SELECT asgt.err_propia('[A4] el operador de D no se asigna su propio proyecto (D1)', 'DOP', asgt.ins('DOP', 'D1'));
SELECT asgt.err_empresa('[A4] ni un proyecto de C', 'DOP', asgt.ins('DOP', 'P1'));
SELECT asgt.err_rls('[A4] ni asigna a una persona de C a un proyecto de C', 'DOP', asgt.ins('NUEVO', 'P1'));
SELECT asgt.cero('[A4] ni borra las asignaciones de una persona de C', 'DOP', asgt.borrar_de('OP1'));
SELECT asgt.cero('[A4] ni las cambia', 'DOP', asgt.mover('OP1', 'P1', 'P3'));

-- A5 · anon (sin sesión): ya no tiene ningún privilegio sobre la tabla
SELECT asgt.err_priv('[A5] anon no inserta', 'ANON', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_priv('[A5] anon no lee', 'ANON', 'SELECT * FROM public.user_project_assignments');
SELECT asgt.err_priv('[A5] anon no actualiza', 'ANON', asgt.permiso('OP1', 'P1', 'lectura'));
SELECT asgt.err_priv('[A5] anon no borra', 'ANON', asgt.borrar_de('OP1'));

-- ═══ B · administrador ACOTADO (AP: P1, P2, P3 — la forma de Marco) ═══════════════════════════════════════════
-- B1 · sobre sí mismo
SELECT asgt.err_propia('[B1] no se asigna otro proyecto de su empresa (P4)', 'AP', asgt.ins('AP', 'P4'));
SELECT asgt.err_propia('[B1] ni uno que ya tiene (la llave única no es la barrera)', 'AP', asgt.ins('AP', 'P1'), p_control => false);
SELECT asgt.err_empresa('[B1] ni uno de OTRA empresa', 'AP', asgt.ins('AP', 'D1'));
SELECT asgt.cero('[B1] borrar SUS asignaciones afecta 0 filas (si pudiera, pasaría a ser exento de proyecto)', 'AP', asgt.borrar_de('AP'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3|false');
SELECT asgt.cero('[B1] borrar una propia concreta afecta 0 filas', 'AP', asgt.borrar_fila('AP', 'P3'));
SELECT asgt.cero('[B1] cambiar una propia de proyecto afecta 0 filas', 'AP', asgt.mover('AP', 'P3', 'P4'));
SELECT asgt.cero('[B1] pasar una propia a otra persona afecta 0 filas', 'AP', asgt.pasar_a('AP', 'P3', 'NUEVO'));
SELECT asgt.err_propia('[B1] UPSERT sobre una propia', 'AP',
  asgt.ins('AP', 'P1') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'lectura'$q$);
SELECT asgt.err_propia('[B1] UPDATE de la fila de OTRA persona que la deja a su nombre y en otro proyecto (user_id := AP, project_id := P8)', 'AP',
  $q$UPDATE public.user_project_assignments SET user_id = {AP}, project_id = {P8} WHERE user_id = {OP1} AND project_id = {P1}$q$);
SELECT asgt.err_propia('[B1] copiar las filas de otra persona a su nombre (INSERT … SELECT)', 'AP',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {AP}, project_id FROM public.user_project_assignments WHERE user_id = {OP2}$q$,
  p_control => false);  -- como SISTEMA chocaría con la llave única (AP ya tiene P2 y P3): el control legítimo del INSERT … SELECT es [B2]

-- B2 · sobre otras personas de su empresa y sobre los proyectos que él ve
SELECT asgt.ok('[B2] asigna a OP1 un proyecto que él ve (P3)', 'AP', asgt.ins('OP1', 'P3'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2,P3');
SELECT asgt.ok('[B2] asigna a una persona sin filas (NUEVO → P1)', 'AP', asgt.ins('NUEVO', 'P1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P1');
SELECT asgt.ok('[B2] asigna a otro administrador exento (AX2 → P2): lo vuelve acotado', 'AP', asgt.ins('AX2', 'P2'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AX2}) || '|' || asgt.exento({AX2})::text$q$, p_efecto => 'P2|false');
SELECT asgt.err_rls('[B2] NO reparte un proyecto de su empresa que él no ve (P4): como antes de la corrección', 'AP', asgt.ins('NUEVO', 'P4'));
SELECT asgt.err_rls('[B2] ni otro (P8)', 'AP', asgt.ins('OP1', 'P8'));
SELECT asgt.err_empresa('[B2] ni a una persona de OTRA empresa a un proyecto suyo', 'AP', asgt.ins('DOP', 'P1'));
SELECT asgt.err_empresa('[B2] ni a una persona de C a un proyecto de OTRA empresa', 'AP', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[B2] ni a una huérfana', 'AP', asgt.ins('ORF1', 'P3'));
SELECT asgt.err_empresa('[B2] ni a una persona sin empresa (SINEMP)', 'AP', asgt.ins('SINEMP', 'P1'));
SELECT asgt.err_empresa('[B2] ni a un cliente', 'AP', asgt.ins('CLI', 'P1'));
SELECT asgt.err_empresa('[B2] ni a una sesión sin app_users', 'AP', asgt.ins('SINAPP', 'P1'));
SELECT asgt.ok('[B2] borra TODAS las de OP2 (P2, P3: ambos suyos) — paso 1 del reemplazo de la pantalla', 'AP', asgt.borrar_de('OP2'), 2,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP2})$q$, p_efecto => '');
SELECT asgt.cero('[B2] «borrar todas» de OP4 (P4, P5: ninguno lo ve) NO borra nada: las filas que no ve sobreviven', 'AP', asgt.borrar_de('OP4'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P4,P5');
SELECT asgt.ok('[B2] «borrar todas» de OP3 (P3 suyo, P4 no) borra SÓLO la que ve: P4 sobrevive', 'AP', asgt.borrar_de('OP3'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP3})$q$, p_efecto => 'P4');
SELECT asgt.cero('[B2] no puede borrar las filas HUÉRFANAS (ORF1 · P1, P2): no son de una persona de su empresa', 'AP', asgt.borrar_de('ORF1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({ORF1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[B2] ni cambiar una huérfana', 'AP', asgt.permiso('ORF1', 'P1', 'lectura'));
SELECT asgt.cero('[B2] ni borrar las de una persona de OTRA empresa (DOP · D1)', 'AP', asgt.borrar_de('DOP'), p_preparar => asgt.ins('DOP', 'D1'));
SELECT asgt.ok('[B2] cambia el permission_type de OP1 en un proyecto suyo (P1)', 'AP', asgt.permiso('OP1', 'P1', 'lectura'),
  p_efecto_sql => $q$SELECT permission_type FROM public.user_project_assignments WHERE user_id = {OP1} AND project_id = {P1}$q$, p_efecto => 'lectura');
SELECT asgt.ok('[B2] mueve la fila de OP1 de P1 a P3 (ambos suyos)', 'AP', asgt.mover('OP1', 'P1', 'P3'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P2,P3');
SELECT asgt.err_rls('[B2] no la mueve a un proyecto que no ve (P2 → P4)', 'AP', asgt.mover('OP1', 'P2', 'P4'));
SELECT asgt.err_empresa('[B2] ni a un proyecto de otra empresa (P1 → D1)', 'AP', asgt.mover('OP1', 'P1', 'D1'));
SELECT asgt.cero('[B2] no cambia una fila de un proyecto que no ve (OP3 · P4)', 'AP', asgt.permiso('OP3', 'P4', 'lectura'));
SELECT asgt.ok('[B2] UPSERT sobre una fila de OP1 en un proyecto suyo actualiza (1 fila)', 'AP',
  asgt.ins('OP1', 'P1') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'financiero'$q$,
  p_efecto_sql => $q$SELECT permission_type FROM public.user_project_assignments WHERE user_id = {OP1} AND project_id = {P1}$q$, p_efecto => 'financiero');
SELECT asgt.ok('[B2] UPSERT que inserta (NUEVO → P2)', 'AP',
  asgt.ins('NUEVO', 'P2') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'financiero'$q$,
  p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P2');
SELECT asgt.err_rls('[B2] UPSERT sobre una fila de un proyecto que no ve (OP3 · P4)', 'AP',
  asgt.ins('OP3', 'P4') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'financiero'$q$);
SELECT asgt.ok('[B2] INSERT … SELECT de los proyectos que ve (NUEVO ← P1, P2, P3)', 'AP',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {NUEVO}, id FROM public.projects$q$, 3,
  p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P1,P2,P3');
SELECT asgt.ok_sql('[B2] DELETE sin WHERE: borra las filas ajenas de SUS proyectos y NO las suyas ni se vuelve exento', 'AP',
  $q$DELETE FROM public.user_project_assignments$q$,
  $q$SELECT count(*) FROM public.user_project_assignments u JOIN public.app_users a ON a.id = u.user_id
      WHERE a.company_id = {C} AND u.project_id IN ({P1}, {P2}, {P3}) AND u.user_id <> {AP}$q$,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3|false');
SELECT asgt.ok_sql('[B2] UPDATE sin WHERE: cambia las ajenas de SUS proyectos y NO las suyas', 'AP',
  $q$UPDATE public.user_project_assignments SET permission_type = 'administrativo'$q$,
  $q$SELECT count(*) FROM public.user_project_assignments u JOIN public.app_users a ON a.id = u.user_id
      WHERE a.company_id = {C} AND u.project_id IN ({P1}, {P2}, {P3}) AND u.user_id <> {AP}$q$,
  p_efecto_sql => $q$SELECT string_agg(DISTINCT permission_type, ',') FROM public.user_project_assignments WHERE user_id = {AP}$q$, p_efecto => 'total');

-- ═══ C · administrador EXENTO (AX: sin filas, ve toda su empresa) ════════════════════════════════════════════
SELECT asgt.err_propia('[C1] no se asigna ni el primer proyecto (si pudiera, dejaría de ser exento)', 'AX', asgt.ins('AX', 'P1'));
SELECT asgt.err_empresa('[C1] ni uno de otra empresa', 'AX', asgt.ins('AX', 'D1'));
SELECT asgt.ok('[C2] asigna a OP1 un proyecto (P3)', 'AX', asgt.ins('OP1', 'P3'), p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2,P3');
SELECT asgt.ok('[C2] asigna cualquier proyecto de su empresa (NUEVO → P8)', 'AX', asgt.ins('NUEVO', 'P8'),
  p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P8');
SELECT asgt.ok('[C2] borra TODAS las de OP4 (P4, P5) — paso 1 del reemplazo', 'AX', asgt.borrar_de('OP4'), 2,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => '');
SELECT asgt.ok('[C2] mueve la fila de OP4 de P4 a P8', 'AX', asgt.mover('OP4', 'P4', 'P8'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P5,P8');
SELECT asgt.ok('[C2] INSERT … SELECT de todos los proyectos (NUEVO ← P1…P8)', 'AX',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {NUEVO}, id FROM public.projects WHERE company_id = {C}$q$, 8,
  p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P1,P2,P3,P4,P5,P6,P7,P8');
SELECT asgt.err_empresa('[C3] a una persona de otra empresa a un proyecto de C', 'AX', asgt.ins('DOP', 'P1'));
SELECT asgt.err_empresa('[C3] a una persona de C a un proyecto de otra empresa', 'AX', asgt.ins('NUEVO', 'D1'));
SELECT asgt.err_rls('[C3] a una persona de otra empresa en un proyecto de ESA empresa (no es suya)', 'AX', asgt.ins('DOP', 'D1'));
SELECT asgt.err_empresa('[C3] a una huérfana', 'AX', asgt.ins('ORF1', 'P1'));
SELECT asgt.err_empresa('[C3] mueve la fila de OP4 a un proyecto de otra empresa', 'AX', asgt.mover('OP4', 'P4', 'D1'));
SELECT asgt.cero('[C3] no borra filas huérfanas', 'AX', asgt.borrar_de('ORF1'), p_efecto_sql => $q$SELECT asgt.filas_de({ORF1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[C3] ni las de una persona de otra empresa', 'AX', asgt.borrar_de('DOP'), p_preparar => asgt.ins('DOP', 'D1'));
-- Un administrador SÍ puede cambiar a OTRO administrador: es la colaboración que la pantalla ofrece (decisión documentada).
SELECT asgt.ok('[C4] puede acotar a otro administrador exento (AX2 → P1)', 'AX', asgt.ins('AX2', 'P1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AX2}) || '|' || asgt.exento({AX2})::text$q$, p_efecto => 'P1|false');
SELECT asgt.ok('[C4] y puede QUITAR el alcance a un administrador acotado (borra las de AP): AP pasa a ser exento — lo decide otra persona, no AP', 'AX',
  asgt.borrar_de('AP'), 3, p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => '|true');
SELECT asgt.ok('[C4] y ampliar a AP con otro proyecto (AP → P4)', 'AX', asgt.ins('AP', 'P4'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AP})$q$, p_efecto => 'P1,P2,P3,P4');

-- ═══ D · propietario de la empresa ═══════════════════════════════════════════════════════════════════════════
SELECT asgt.ok('[D1] puede asignarse a sí mismo (es exento: su alcance no cambia)', 'OW', asgt.ins('OW', 'P1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OW}) || '|' || asgt.exento({OW})::text$q$, p_efecto => 'P1|true');
SELECT asgt.ok('[D1] y borrarse la suya', 'OW', asgt.borrar_de('OW'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({OW}) || '|' || asgt.exento({OW})::text$q$, p_efecto => '|true', p_preparar => asgt.ins('OW', 'P1'));
SELECT asgt.ok('[D2] asigna a OP1 (P3)', 'OW', asgt.ins('OP1', 'P3'), p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2,P3');
SELECT asgt.ok('[D2] asigna cualquier proyecto de su empresa (NUEVO → P8)', 'OW', asgt.ins('NUEVO', 'P8'));
SELECT asgt.ok('[D2] borra TODAS las de OP4 (que un administrador acotado no vería)', 'OW', asgt.borrar_de('OP4'), 2,
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => '');
SELECT asgt.ok('[D2] mueve una fila (OP4: P4 → P8)', 'OW', asgt.mover('OP4', 'P4', 'P8'));
SELECT asgt.ok('[D2] deja una fila de otra persona a su nombre (update de user_id)', 'OW', asgt.pasar_a('OP1', 'P1', 'OW'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OW})$q$, p_efecto => 'P1');
SELECT asgt.ok('[D2] INSERT … SELECT (NUEVO ← los 8 proyectos)', 'OW',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {NUEVO}, id FROM public.projects WHERE company_id = {C}$q$, 8);
SELECT asgt.err_empresa('[D3] no asigna a una persona de otra empresa a un proyecto de C', 'OW', asgt.ins('DOP', 'P1'));
SELECT asgt.err_empresa('[D3] ni a una de C a un proyecto de otra empresa', 'OW', asgt.ins('OP1', 'D1'));
SELECT asgt.err_rls('[D3] ni a una de D a uno de D (no es su empresa)', 'OW', asgt.ins('DOP', 'D1'));
SELECT asgt.err_empresa('[D3] ni a una huérfana', 'OW', asgt.ins('ORF1', 'P3'));
SELECT asgt.err_empresa('[D3] ni mueve una fila a otra empresa', 'OW', asgt.mover('OP4', 'P4', 'D1'));
SELECT asgt.cero('[D3] no borra filas huérfanas', 'OW', asgt.borrar_de('ORF2'), p_efecto_sql => $q$SELECT asgt.filas_de({ORF2})$q$, p_efecto => 'P2,P3');
-- propietario de OTRA empresa
SELECT asgt.err_rls('[D4] el propietario de D no asigna a una persona de C', 'DOW', asgt.ins('OP1', 'P3'));
SELECT asgt.cero('[D4] ni borra las de una persona de C', 'DOW', asgt.borrar_de('OP1'));
SELECT asgt.cero('[D4] ni las cambia', 'DOW', asgt.mover('OP1', 'P1', 'P3'));
SELECT asgt.ok('[D4] SÍ administra su propia empresa (DOP → D1)', 'DOW', asgt.ins('DOP', 'D1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({DOP})$q$, p_efecto => 'D1');

-- ═══ E · superadministrador (super_admin y superadmin) ═══════════════════════════════════════════════════════
SELECT asgt.ok('[E1] super_admin asigna a OP1 (P3)', 'SU', asgt.ins('OP1', 'P3'), p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2,P3');
SELECT asgt.ok('[E1] y a una persona de otra empresa en SU empresa (DOP → D1)', 'SU', asgt.ins('DOP', 'D1'));
SELECT asgt.ok('[E1] puede asignarse a sí mismo (SU → P1)', 'SU', asgt.ins('SU', 'P1'));
SELECT asgt.ok('[E1] borra las de cualquier empresa (OP1)', 'SU', asgt.borrar_de('OP1'), 2);
SELECT asgt.ok('[E1] y las HUÉRFANAS (ORF1: P1, P2): sólo el superadministrador y el servicio pueden', 'SU', asgt.borrar_de('ORF1'), 2,
  p_efecto_sql => $q$SELECT asgt.filas_de({ORF1})$q$, p_efecto => '');
SELECT asgt.ok('[E1] y cambia el permission_type de una huérfana', 'SU', asgt.permiso('ORF1', 'P1', 'lectura'));
SELECT asgt.err_empresa('[E1] pero NO mueve una huérfana a otro proyecto: la persona no existe', 'SU', asgt.mover('ORF1', 'P1', 'P8'));
SELECT asgt.err_empresa('[E1] ni asigna a una persona de C a un proyecto de otra empresa (la integridad vale para todos)', 'SU', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[E1] ni a una huérfana', 'SU', asgt.ins('ORF1', 'P5'));
SELECT asgt.err_empresa('[E1] ni mueve una fila de C a otra empresa', 'SU', asgt.mover('OP1', 'P1', 'D1'));
SELECT asgt.ok('[E1] DELETE sin WHERE borra las 43', 'SU', 'DELETE FROM public.user_project_assignments', 43);
SELECT asgt.ok('[E2] superadmin (la otra grafía), de la empresa D: asigna a OP1 (empresa C)', 'SU2', asgt.ins('OP1', 'P3'));
SELECT asgt.ok('[E2] y borra las de OP1', 'SU2', asgt.borrar_de('OP1'), 2);
SELECT asgt.ok('[E2] y las huérfanas', 'SU2', asgt.borrar_de('ORF3'), 2);

-- ═══ F · administrador de OTRA empresa (DAD, exento) ═════════════════════════════════════════════════════════
SELECT asgt.err_rls('[F1] el administrador de D no asigna a una persona de C a un proyecto de C', 'DAD', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_empresa('[F1] ni a una persona de C a un proyecto de D', 'DAD', asgt.ins('NUEVO', 'D1'));
SELECT asgt.cero('[F1] no borra las asignaciones de una persona de C', 'DAD', asgt.borrar_de('OP1'), p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[F1] ni las cambia', 'DAD', asgt.mover('OP1', 'P1', 'P3'));
SELECT asgt.cero('[F1] DELETE sin WHERE tampoco toca la empresa C', 'DAD', 'DELETE FROM public.user_project_assignments',
  p_efecto_sql => $q$SELECT count(*) FROM public.user_project_assignments$q$, p_efecto => '43');
SELECT asgt.ok('[F2] SÍ administra su empresa (DOP → D1)', 'DAD', asgt.ins('DOP', 'D1'), p_efecto_sql => $q$SELECT asgt.filas_de({DOP})$q$, p_efecto => 'D1');
SELECT asgt.err_propia('[F2] pero no se asigna a sí mismo', 'DAD', asgt.ins('DAD', 'D1'));

-- ═══ G · rol de servicio y sistema: las migraciones, las edge functions y el SQL Editor siguen funcionando ═══════
SELECT asgt.ok('[G1] service_role asigna (NUEVO → P3)', 'SERVICIO', asgt.ins('NUEVO', 'P3'), p_efecto_sql => $q$SELECT asgt.filas_de({NUEVO})$q$, p_efecto => 'P3');
SELECT asgt.ok('[G1] service_role asigna a cualquier persona (sin auth.uid() el trigger de autoasignación no interviene)', 'SERVICIO', asgt.ins('OP7', 'P1'));
SELECT asgt.ok('[G1] service_role borra huérfanas', 'SERVICIO', asgt.borrar_de('ORF4'), 2);
SELECT asgt.ok('[G1] service_role borra todo lo de una persona', 'SERVICIO', asgt.borrar_de('OP1'), 2);
SELECT asgt.err_empresa('[G2] service_role NO asigna entre empresas: la integridad vale para todo actor', 'SERVICIO', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[G2] ni a una huérfana', 'SERVICIO', asgt.ins('ORF1', 'P5'));
SELECT asgt.err_empresa('[G2] ni mueve una fila a otra empresa', 'SERVICIO', asgt.mover('OP1', 'P1', 'D1'));
SELECT asgt.err_empresa('[G3] el superusuario (SQL Editor, migraciones) tampoco', 'SISTEMA', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[G3] ni asigna a una persona sin empresa', 'SISTEMA', asgt.ins('CLI', 'P1'));
SELECT asgt.err_empresa('[G3] ni a una sesión sin app_users', 'SISTEMA', asgt.ins('SINAPP', 'P1'));
SELECT asgt.ok('[G3] y sí asigna lo correcto (NUEVO → P5)', 'SISTEMA', asgt.ins('NUEVO', 'P5'));
SELECT asgt.ok('[G3] y cambia sin tocar user_id/project_id: el trigger de integridad no se dispara (huérfana, permission_type)', 'SISTEMA',
  asgt.permiso('ORF1', 'P1', 'lectura'));
SELECT asgt.ok('[G3] y borra huérfanas', 'SISTEMA', asgt.borrar_de('ORF5'), 1);
