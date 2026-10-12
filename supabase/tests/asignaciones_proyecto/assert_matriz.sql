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
-- REGLA (20261026000600, decisión del dueño del negocio del 2026-10-11): sólo el PRINCIPAL de la empresa escribe user_project_assignments —el superadministrador en cualquier
-- empresa, el propietario sobre personas y proyectos de SU empresa—. Un administrador, acotado (AP) o sin filas (AX, AX2), NO lo es: no asigna, no quita, no mueve, ni a otro
-- administrador ni a un operador ni a sí mismo (INSERT: 42501 por la política, o por el trigger de autoasignación en lo propio; UPDATE y DELETE: 0 filas SIN error). La sección B
-- y la C documentan ese rechazo; la D y la E, lo que el principal sí puede (también sobre los administradores); la H, el principal frente a quien se le parece.
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
SELECT asgt.cero('[B1] UPDATE de la fila de OTRA persona que la deja a su nombre y en otro proyecto (user_id := AP, project_id := P8): la política filtra primero, 0 filas', 'AP',
  $q$UPDATE public.user_project_assignments SET user_id = {AP}, project_id = {P8} WHERE user_id = {OP1} AND project_id = {P1}$q$,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2,P3|P1,P2');
SELECT asgt.err_propia('[B1] copiar las filas de otra persona a su nombre (INSERT … SELECT)', 'AP',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {AP}, project_id FROM public.user_project_assignments WHERE user_id = {OP2}$q$,
  p_control => false);  -- como SISTEMA chocaría con la llave única (AP ya tiene P2 y P3): el control legítimo del INSERT … SELECT es [B2]

-- B2 · sobre otras personas de su empresa: NADA. Sólo el principal escribe la tabla (antes de la decisión del 2026-10-11 el administrador acotado repartía, y borraba, las
--      filas de SUS proyectos). Cada caso conserva su sentencia de siempre y ahora se rechaza: el control (la misma sentencia como SISTEMA) prueba que no es un WHERE equivocado.
SELECT asgt.err_rls('[B2] NO asigna a OP1 un proyecto que él ve (P3): sólo el principal asigna', 'AP', asgt.ins('OP1', 'P3'));
SELECT asgt.err_rls('[B2] NO asigna a una persona sin filas (NUEVO → P1)', 'AP', asgt.ins('NUEVO', 'P1'));
SELECT asgt.err_rls('[B2] NO acota a otro administrador exento (AX2 → P2): D-2, la colusión entre administradores queda cerrada', 'AP', asgt.ins('AX2', 'P2'));
SELECT asgt.err_rls('[B2] NO reparte un proyecto de su empresa que él no ve (P4): como antes de la corrección', 'AP', asgt.ins('NUEVO', 'P4'));
SELECT asgt.err_rls('[B2] ni otro (P8)', 'AP', asgt.ins('OP1', 'P8'));
SELECT asgt.err_empresa('[B2] ni a una persona de OTRA empresa a un proyecto suyo', 'AP', asgt.ins('DOP', 'P1'));
SELECT asgt.err_empresa('[B2] ni a una persona de C a un proyecto de OTRA empresa', 'AP', asgt.ins('OP1', 'D1'));
SELECT asgt.err_empresa('[B2] ni a una huérfana', 'AP', asgt.ins('ORF1', 'P3'));
SELECT asgt.err_empresa('[B2] ni a una persona sin empresa (SINEMP)', 'AP', asgt.ins('SINEMP', 'P1'));
SELECT asgt.err_empresa('[B2] ni a un cliente', 'AP', asgt.ins('CLI', 'P1'));
SELECT asgt.err_empresa('[B2] ni a una sesión sin app_users', 'AP', asgt.ins('SINAPP', 'P1'));
SELECT asgt.cero('[B2] NO borra TODAS las de OP2 (P2, P3: ambos suyos) — el paso 1 del reemplazo de la pantalla afecta 0 filas', 'AP', asgt.borrar_de('OP2'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP2})$q$, p_efecto => 'P2,P3');
SELECT asgt.cero('[B2] «borrar todas» de OP4 (P4, P5: ninguno lo ve) tampoco: las filas que no ve sobreviven', 'AP', asgt.borrar_de('OP4'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P4,P5');
SELECT asgt.cero('[B2] «borrar todas» de OP3 (P3 suyo, P4 no) no borra ni la que ve', 'AP', asgt.borrar_de('OP3'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP3})$q$, p_efecto => 'P3,P4');
SELECT asgt.cero('[B2] no puede borrar las filas HUÉRFANAS (ORF1 · P1, P2): no son de una persona de su empresa', 'AP', asgt.borrar_de('ORF1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({ORF1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[B2] ni cambiar una huérfana', 'AP', asgt.permiso('ORF1', 'P1', 'lectura'));
SELECT asgt.cero('[B2] ni borrar las de una persona de OTRA empresa (DOP · D1)', 'AP', asgt.borrar_de('DOP'), p_preparar => asgt.ins('DOP', 'D1'));
SELECT asgt.cero('[B2] NO cambia el permission_type de OP1 en un proyecto suyo (P1)', 'AP', asgt.permiso('OP1', 'P1', 'lectura'),
  p_efecto_sql => $q$SELECT permission_type FROM public.user_project_assignments WHERE user_id = {OP1} AND project_id = {P1}$q$, p_efecto => 'total');
SELECT asgt.cero('[B2] NO mueve la fila de OP1 de P1 a P3 (ambos suyos)', 'AP', asgt.mover('OP1', 'P1', 'P3'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[B2] tampoco a un proyecto que no ve (P2 → P4): la política filtra primero', 'AP', asgt.mover('OP1', 'P2', 'P4'));
SELECT asgt.caso('[B2] ni a un proyecto de otra empresa (P1 → D1): la política filtra primero, el trigger de integridad ni llega a verla (0 filas)', 'AP', asgt.mover('OP1', 'P1', 'D1'), 'cero',
  p_efecto_sql => $q$SELECT asgt.filas_de({OP1})$q$, p_efecto => 'P1,P2', p_control => false);  -- sin control: como SISTEMA la integridad también lo rechaza (ASIGNACION_EMPRESA_DISTINTA)
SELECT asgt.cero('[B2] no cambia una fila de un proyecto que no ve (OP3 · P4)', 'AP', asgt.permiso('OP3', 'P4', 'lectura'));
SELECT asgt.err_rls('[B2] el UPSERT sobre una fila de OP1 en un proyecto suyo (DO UPDATE) falla antes de tocar nada', 'AP',
  asgt.ins('OP1', 'P1') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'financiero'$q$);
SELECT asgt.err_rls('[B2] ni el UPSERT que inserta (NUEVO → P2)', 'AP',
  asgt.ins('NUEVO', 'P2') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'financiero'$q$);
SELECT asgt.err_rls('[B2] UPSERT sobre una fila de un proyecto que no ve (OP3 · P4)', 'AP',
  asgt.ins('OP3', 'P4') || $q$ ON CONFLICT (user_id, project_id) DO UPDATE SET permission_type = 'financiero'$q$);
SELECT asgt.err_rls('[B2] INSERT … SELECT de los proyectos que ve (NUEVO ← P1, P2, P3) tampoco', 'AP',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {NUEVO}, id FROM public.projects WHERE id IN ({P1}, {P2}, {P3})$q$);
SELECT asgt.cero('[B2] DELETE sin WHERE: no borra nada (ni las ajenas de SUS proyectos, ni las suyas), y no se vuelve exento', 'AP',
  $q$DELETE FROM public.user_project_assignments$q$,
  p_efecto_sql => $q$SELECT count(*) || '|' || asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text FROM public.user_project_assignments$q$, p_efecto => '43|P1,P2,P3|false');
SELECT asgt.cero('[B2] UPDATE sin WHERE: no cambia nada', 'AP',
  $q$UPDATE public.user_project_assignments SET permission_type = 'administrativo'$q$,
  p_efecto_sql => $q$SELECT string_agg(DISTINCT permission_type, ',') FROM public.user_project_assignments$q$, p_efecto => 'total');

-- ═══ C · administrador EXENTO (AX: sin filas, ve toda su empresa) — ser «exento» NO lo hace principal ═══════════════════════════════════════════════
-- Un administrador sin filas es exento de proyecto sólo por omisión (user_is_project_exempt()), y ese estado se fabrica sin ser principal: lo deja otro administrador al borrar
-- sus filas o su último proyecto (F2-03), él solo con dos sesiones REPEATABLE READ (D-16), o nace así (create-user / invite-user / una invitación directa). Por eso la autoridad
-- se mide por el ROL, no por «no tener filas».
SELECT asgt.err_propia('[C1] no se asigna ni el primer proyecto (si pudiera, dejaría de ser exento)', 'AX', asgt.ins('AX', 'P1'));
SELECT asgt.err_empresa('[C1] ni uno de otra empresa', 'AX', asgt.ins('AX', 'D1'));
SELECT asgt.err_rls('[C2] NO asigna a OP1 un proyecto (P3): ser exento no lo hace principal', 'AX', asgt.ins('OP1', 'P3'));
SELECT asgt.err_rls('[C2] NO asigna cualquier proyecto de su empresa (NUEVO → P8)', 'AX', asgt.ins('NUEVO', 'P8'));
SELECT asgt.cero('[C2] NO borra TODAS las de OP4 (P4, P5) — el paso 1 del reemplazo afecta 0 filas', 'AX', asgt.borrar_de('OP4'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P4,P5');
SELECT asgt.cero('[C2] NO mueve la fila de OP4 de P4 a P8', 'AX', asgt.mover('OP4', 'P4', 'P8'),
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P4,P5');
SELECT asgt.err_rls('[C2] INSERT … SELECT de todos los proyectos (NUEVO ← P1…P8) tampoco', 'AX',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) SELECT {NUEVO}, id FROM public.projects WHERE company_id = {C}$q$);
SELECT asgt.err_empresa('[C3] a una persona de otra empresa a un proyecto de C', 'AX', asgt.ins('DOP', 'P1'));
SELECT asgt.err_empresa('[C3] a una persona de C a un proyecto de otra empresa', 'AX', asgt.ins('NUEVO', 'D1'));
SELECT asgt.err_rls('[C3] a una persona de otra empresa en un proyecto de ESA empresa (no es suya)', 'AX', asgt.ins('DOP', 'D1'));
SELECT asgt.err_empresa('[C3] a una huérfana', 'AX', asgt.ins('ORF1', 'P1'));
SELECT asgt.caso('[C3] mueve la fila de OP4 a un proyecto de otra empresa: la política filtra primero, 0 filas', 'AX', asgt.mover('OP4', 'P4', 'D1'), 'cero',
  p_efecto_sql => $q$SELECT asgt.filas_de({OP4})$q$, p_efecto => 'P4,P5', p_control => false);  -- sin control: como SISTEMA la integridad también lo rechaza
SELECT asgt.cero('[C3] no borra filas huérfanas', 'AX', asgt.borrar_de('ORF1'), p_efecto_sql => $q$SELECT asgt.filas_de({ORF1})$q$, p_efecto => 'P1,P2');
SELECT asgt.cero('[C3] ni las de una persona de otra empresa', 'AX', asgt.borrar_de('DOP'), p_preparar => asgt.ins('DOP', 'D1'));
-- Un administrador NO puede cambiar a OTRO administrador: era la colusión de D-2 (uno acotaba, ampliaba o dejaba exento a otro). Sólo lo decide el principal (sección D).
SELECT asgt.err_rls('[C4] NO acota a otro administrador exento (AX2 → P1)', 'AX', asgt.ins('AX2', 'P1'));
SELECT asgt.cero('[C4] ni QUITA el alcance a un administrador acotado (no borra las de AP): AP sigue acotado', 'AX', asgt.borrar_de('AP'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3|false');
SELECT asgt.err_rls('[C4] ni amplía a AP con otro proyecto (AP → P4)', 'AX', asgt.ins('AP', 'P4'));

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
-- el principal SÍ decide sobre los administradores (D-2): es el único que acota, amplía o deja exento a otro administrador; D-9: asigna el proyecto nuevo a un administrador acotado
SELECT asgt.ok('[D2] acota a un administrador exento (AX2 → P1)', 'OW', asgt.ins('AX2', 'P1'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AX2}) || '|' || asgt.exento({AX2})::text$q$, p_efecto => 'P1|false');
SELECT asgt.ok('[D2] amplía a un administrador acotado (AP → P4)', 'OW', asgt.ins('AP', 'P4'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3,P4|false');
SELECT asgt.ok('[D2] y le quita el alcance (borra las 3 de AP): AP pasa a ser exento POR DECISIÓN DEL PROPIETARIO, no de otro administrador', 'OW', asgt.borrar_de('AP'), 3,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => '|true');
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
SELECT asgt.ok('[E1] y acota o amplía a un administrador (AP → P4; AX2 → P2)', 'SU', asgt.ins('AP', 'P4') || '; ' || asgt.ins('AX2', 'P2'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.filas_de({AX2})$q$, p_efecto => 'P1,P2,P3,P4|P2');
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
SELECT asgt.err_rls('[F2] NO administra ni siquiera su propia empresa (DOP → D1): sólo la administra su propietario (DOW)', 'DAD', asgt.ins('DOP', 'D1'));
SELECT asgt.err_propia('[F2] y no se asigna a sí mismo', 'DAD', asgt.ins('DAD', 'D1'));

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

-- ═══ H · quien se le parece al principal y NO lo es ═══════════════════════════════════════════════════════════════════════════════
-- H1 · un operador con el rol RBAC de sistema «Admin Plataforma» (el que create-user asigna a un administrador): el rol RBAC no confiere principal, sólo se mide app_users.role
SELECT asgt.err_rls('[H1] un operador con el rol RBAC «Admin Plataforma» NO asigna proyectos a otra persona', 'OP2', asgt.ins('NUEVO', 'P1'),
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);
SELECT asgt.err_propia('[H1] ni se asigna a sí mismo (OP2 → P1)', 'OP2', asgt.ins('OP2', 'P1'),
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);
SELECT asgt.cero('[H1] ni borra las de otra persona', 'OP2', asgt.borrar_de('OP4'),
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);
-- H2 · un administrador al que otro administrador dejó SIN filas es exento, pero no principal (F2-03)
SELECT asgt.err_rls('[H2] AP, dejado sin filas por el sistema (exento), tampoco asigna', 'AP', asgt.ins('NUEVO', 'P1'),
  p_preparar => asgt.borrar_de('AP'));
SELECT asgt.cero('[H2] ni borra', 'AP', asgt.borrar_de('OP4'), p_preparar => asgt.borrar_de('AP'));
-- H3 · D-9: el proyecto NUEVO de la empresa lo asigna el principal; el administrador no puede asignárselo, ni otro administrador
SELECT asgt.ok('[H3] el propietario asigna a AP un proyecto recién creado', 'OW',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) VALUES ({AP}, 'a5d00000-0000-0000-0000-0000000000f1')$q$, 1,
  p_efecto_sql => $q$SELECT asgt.puede({AP}, 'a5d00000-0000-0000-0000-0000000000f1'::uuid)::text$q$, p_efecto => 'true',
  p_preparar => $q$SET session_replication_role = replica; INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f1', {C}, 'ASG proyecto nuevo'); SET session_replication_role = origin$q$);
SELECT asgt.err_propia('[H3] AP no puede asignárselo', 'AP',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) VALUES ({AP}, 'a5d00000-0000-0000-0000-0000000000f1')$q$,
  p_preparar => $q$SET session_replication_role = replica; INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f1', {C}, 'ASG proyecto nuevo'); SET session_replication_role = origin$q$);
SELECT asgt.err_rls('[H3] ni se lo asigna AX', 'AX',
  $q$INSERT INTO public.user_project_assignments (user_id, project_id) VALUES ({AP}, 'a5d00000-0000-0000-0000-0000000000f1')$q$,
  p_preparar => $q$SET session_replication_role = replica; INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f1', {C}, 'ASG proyecto nuevo'); SET session_replication_role = origin$q$);
