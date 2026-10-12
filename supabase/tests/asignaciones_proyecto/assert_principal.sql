\set ON_ERROR_STOP on
-- ============================================================================
-- EL PRINCIPAL DE LA EMPRESA — quién escribe qué: las escrituras sensibles × diez actores, contra la base real de la suite
--
-- Decisión del dueño del negocio (2026-10-11): las asignaciones de proyecto, los permisos (roles y llaves), los administradores y los proyectos son del PRINCIPAL de la
-- empresa —«el que tiene los permisos de la empresa y todos los proyectos»—: el propietario (app_users.role = 'company_owner', sólo dentro de SU empresa) o el
-- superadministrador ('super_admin' / 'superadmin', cualquier empresa). Un administrador, acotado (AP) o sin filas (AX, «exento»), NO lo es; tampoco un operador con un rol
-- RBAC de administrador (OP2 + «Admin Plataforma»), ni una sesión sin fila en app_users (SINAPP). Lo cubren la regla de la 20261026000600 (user_project_assignments) y las
-- políticas de la 20261026000700 (projects, roles, role_permissions, user_roles, user_invitations); app_users ya era sólo del propietario.
--
-- Cada caso es una sesión simulada (SET ROLE + claims) dentro de una subtransacción que se DESHACE (asgt.caso): la comprobación de la sentencia, de sus filas y de su
-- mensaje, que la tabla no cambió y que la MISMA sentencia como SISTEMA sí habría afectado filas (el control): un «cero filas» nunca se presenta como éxito.
--   ok   la sentencia triunfa y afecta 1 fila
--   rls  falla con 42501 «row-level security» (INSERT, o un UPDATE cuyo WITH CHECK rechaza la fila nueva)
--   cero afecta 0 filas SIN error (un UPDATE o DELETE que la RLS filtra: la interfaz debe leer de vuelta para no dar un éxito falso)
--
-- Actores (fixture.sql), en este orden: SU super_admin de C · SU2 superadmin (la otra grafía) de D · OW propietario de C · AP administrador acotado de C (P1, P2, P3)
-- · AX administrador de C sin filas (exento) · OP1 operador de C · VW1 visor de C · SINAPP sesión SIN fila en app_users · DOW propietario de OTRA empresa (D)
-- · OP2 operador de C con el rol RBAC de sistema «Admin Plataforma» (que NO lo hace principal).
-- ============================================================================

CREATE TEMP TABLE _actores (n int PRIMARY KEY, etq text NOT NULL, actor text NOT NULL, prep text);
INSERT INTO _actores VALUES
  (1,  'SU',                'SU',     NULL),
  (2,  'SU2',               'SU2',    NULL),
  (3,  'OW',                'OW',     NULL),
  (4,  'AP',                'AP',     NULL),
  (5,  'AX',                'AX',     NULL),
  (6,  'OP1',               'OP1',    NULL),
  (7,  'VW1',               'VW1',    NULL),
  (8,  'SINAPP',            'SINAPP', NULL),
  (9,  'DOW',               'DOW',    NULL),
  (10, 'OP2+RBAC admin',    'OP2',    $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);

-- esp: un código por actor, en el orden de arriba. ctrl8: el control (la misma sentencia como SISTEMA) es posible para SINAPP (false si su fila en app_users haría fallar la sentencia).
CREATE TEMP TABLE _ops (n int PRIMARY KEY, id text NOT NULL, etq text NOT NULL, sql text NOT NULL, prep text, esp text NOT NULL, ctrl8 boolean NOT NULL DEFAULT true);
INSERT INTO _ops (n, id, etq, sql, prep, esp, ctrl8) VALUES
  -- ── user_invitations: crear administradores (el camino que se saltaba la lista de las funciones de borde) ──────────────────────────────────────────────────────
  (1,  'I1',  'INSERT user_invitations con role ''admin'' (nace un administrador exento)',
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i1@example.test', 'admin', 'asg-tok-i1')$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (2,  'I2',  'INSERT user_invitations con role ''operator'' (invitar operadores sigue permitido a los administradores)',
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i2@example.test', 'operator', 'asg-tok-i2')$q$, NULL,
       'ok,ok,ok,ok,ok,rls,rls,rls,rls,rls', true),
  (3,  'I3',  'UPDATE user_invitations: el role de una invitación de operador pasa a ''admin''',
       $q$UPDATE public.user_invitations SET role = 'admin'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i3@example.test', 'operator', 'asg-tok-i3')$q$,
       'ok,ok,ok,rls,rls,cero,cero,cero,cero,cero', true),
  (4,  'I4',  'UPDATE user_invitations: revocar una invitación de operador (sigue permitido a los administradores)',
       $q$UPDATE public.user_invitations SET status = 'revoked' WHERE email = 'asg-i4@example.test'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i4@example.test', 'operator', 'asg-tok-i4')$q$,
       'ok,ok,ok,ok,ok,cero,cero,cero,cero,cero', true),
  (5,  'I5',  'UPDATE user_invitations: revocar una invitación con role ''admin'' (la gestiona sólo el principal; el administrador ni siquiera la VE, así que no toca ninguna fila)',
       $q$UPDATE public.user_invitations SET status = 'revoked'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i5@example.test', 'admin', 'asg-tok-i5')$q$,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  -- ── app_users: ya era sólo del propietario y del superadministrador (no cambia) ─────────────────────────────────────────────────────────────────────────────
  (6,  'U0',  'UPDATE app_users: ascender a una persona a ''admin''',
       $q$UPDATE public.app_users SET role = 'admin' WHERE id = {NUEVO}$q$, NULL,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (7,  'U1',  'INSERT app_users directo con role ''admin''',
       $q$INSERT INTO public.app_users (id, company_id, full_name, role) VALUES ('a5e00000-0000-0000-0000-0000000000a1', {C}, 'ASG administrador directo', 'admin')$q$,
       $q$INSERT INTO auth.users (id) VALUES ('a5e00000-0000-0000-0000-0000000000a1')$q$,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  -- ── projects: crear y borrar son del principal; editar (fiscal, cobros) sigue abierto al administrador ──────────────────────────────────────────────────────
  (8,  'J1',  'INSERT projects (D-9: nadie más crea proyectos, así que nadie queda con un proyecto que no ve)',
       $q$INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f2', {C}, 'ASG proyecto nuevo')$q$,
       'SET session_replication_role = replica',
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (9,  'J2',  'DELETE projects (la baja en cascada vacía las filas de otras personas: F2-03 / D-16)',
       $q$DELETE FROM public.projects WHERE id = {P1}$q$, NULL,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (10, 'J3',  'UPDATE projects (projects_update NO cambió: los administradores configuran fiscal y cobros)',
       $q$UPDATE public.projects SET nombre = 'ASG renombrado' WHERE id = {P1}$q$, NULL,
       'ok,ok,ok,ok,ok,cero,cero,cero,cero,cero', true),
  -- ── roles, llaves y asignación de roles: conceder permisos ───────────────────────────────────────────────────────────────────────────────────────────────────
  (11, 'R1',  'INSERT roles (crear un rol de la empresa)',
       $q$INSERT INTO public.roles (company_id, name, is_system) VALUES ({C}, 'ASG rol nuevo', false)$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (12, 'R2',  'UPDATE roles (renombrar el rol de la empresa)',
       $q$UPDATE public.roles SET name = 'ASG rol renombrado' WHERE id = {ROLC}$q$, NULL,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (13, 'R3',  'DELETE roles',
       $q$DELETE FROM public.roles WHERE id = {ROLC}$q$, NULL,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (14, 'K1',  'INSERT role_permissions (conceder una llave al rol)',
       $q$INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ({ROLC}, (SELECT key FROM public.permissions ORDER BY key LIMIT 1), 'allow')$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (15, 'K2',  'DELETE role_permissions (quitar la llave al rol)',
       $q$DELETE FROM public.role_permissions WHERE role_id = {ROLC}$q$,
       $q$INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ({ROLC}, (SELECT key FROM public.permissions ORDER BY key LIMIT 1), 'allow')$q$,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (16, 'S1',  'INSERT user_roles a un TERCERO (asignarle el rol a OP1)',
       $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP1}, {ROLC})$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (17, 'S2',  'INSERT user_roles A SÍ MISMO (el actor se asigna el rol)',
       $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({ACTOR}, {ROLC})$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', false),
  (18, 'S3',  'DELETE user_roles (quitarle el rol a OP1)',
       $q$DELETE FROM public.user_roles WHERE user_id = {OP1} AND role_id = {ROLC}$q$,
       $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP1}, {ROLC})$q$,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  -- ── user_project_assignments: la regla de la 0600 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  (19, 'A1',  'INSERT user_project_assignments (asignar P1 a NUEVO)',
       $q$INSERT INTO public.user_project_assignments (user_id, project_id) VALUES ({NUEVO}, {P1})$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (20, 'A2',  'UPDATE user_project_assignments (cambiar el permission_type de OP1 en P1)',
       $q$UPDATE public.user_project_assignments SET permission_type = 'lectura' WHERE user_id = {OP1} AND project_id = {P1}$q$, NULL,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (21, 'A3',  'DELETE user_project_assignments (quitarle todo a OP1)',
       $q$DELETE FROM public.user_project_assignments WHERE user_id = {OP1}$q$, NULL,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  -- ── user_invitations, segunda parte (quinta verificación, E-01/E-02/H-02/H-06): la invitación 'admin' es del principal de punta a punta. Un administrador NO lee su token —es la
  --    credencial de accept-invitation—, NO la borra, NO la rebaja ni la reescribe (UPDATE, UPSERT); la de operador la sigue leyendo y gestionando.
  --    OJO (medido): un UPDATE o DELETE con un WHERE que LEE columnas de la tabla ejecuta TAMBIÉN la política SELECT sobre la fila vieja y la nueva, así que la guarda de la política
  --    SELECT tapa a la de UPDATE y DELETE. Por eso los casos de escritura de abajo (I3, I5, I8, I10, I12, I13) NO llevan WHERE: sin él sólo rige la política de ese comando y cada
  --    guarda se prueba por separado (si no, un USING(true) en update o delete —o sin la guarda— seguía en verde) ───────────────────────────────────────────────────────────
  (22, 'I6',  'SELECT del token de una invitación con role ''admin'' (la credencial para crear esa cuenta)',
       $q$SELECT token FROM public.user_invitations WHERE email = 'asg-i6@example.test'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i6@example.test', 'admin', 'asg-tok-i6')$q$,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (23, 'I7',  'SELECT del token de una invitación de operador (el administrador la sigue leyendo)',
       $q$SELECT token FROM public.user_invitations WHERE email = 'asg-i7@example.test'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i7@example.test', 'operator', 'asg-tok-i7')$q$,
       'ok,ok,ok,ok,ok,cero,cero,cero,cero,cero', true),
  (24, 'I8',  'DELETE de una invitación con role ''admin''',
       $q$DELETE FROM public.user_invitations$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i8@example.test', 'admin', 'asg-tok-i8')$q$,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (25, 'I9',  'DELETE de una invitación de operador (el administrador la sigue borrando)',
       $q$DELETE FROM public.user_invitations WHERE email = 'asg-i9@example.test'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i9@example.test', 'operator', 'asg-tok-i9')$q$,
       'ok,ok,ok,ok,ok,cero,cero,cero,cero,cero', true),
  (26, 'I10', 'UPDATE que REBAJA una invitación ''admin'' a operador y le cambia el token y el correo (suplantarla sin ser principal)',
       $q$UPDATE public.user_invitations SET role = 'operator', token = 'asg-tok-i10-nuevo', email = 'asg-i10-nuevo@example.test'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i10@example.test', 'admin', 'asg-tok-i10')$q$,
       'ok,ok,ok,cero,cero,cero,cero,cero,cero,cero', true),
  (27, 'I11', 'UPSERT de una invitación de operador sobre el correo de una ''admin'' pendiente (INSERT … ON CONFLICT DO UPDATE role y token)',
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i11@example.test', 'operator', 'asg-tok-i11-nuevo') ON CONFLICT (company_id, lower(email)) WHERE status = 'pending' DO UPDATE SET role = 'operator', token = EXCLUDED.token$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-i11@example.test', 'admin', 'asg-tok-i11')$q$,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', true),
  (28, 'I12', 'UPDATE de la invitación de operador de OTRA empresa (D): sólo la alcanzan el superadministrador y el propietario de D',
       $q$UPDATE public.user_invitations SET status = 'revoked'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-i12@example.test', 'operator', 'asg-tok-i12')$q$,
       'ok,ok,cero,cero,cero,cero,cero,cero,ok,cero', true),
  (29, 'I13', 'DELETE de la invitación de operador de OTRA empresa (D)',
       $q$DELETE FROM public.user_invitations$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-i13@example.test', 'operator', 'asg-tok-i13')$q$,
       'ok,ok,cero,cero,cero,cero,cero,cero,ok,cero', true),
  (30, 'I14', 'SELECT del token de la invitación de operador de OTRA empresa (D)',
       $q$SELECT token FROM public.user_invitations WHERE email = 'asg-i14@example.test'$q$,
       $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-i14@example.test', 'operator', 'asg-tok-i14')$q$,
       'ok,ok,cero,cero,cero,cero,cero,cero,ok,cero', true),
  -- ── roles, llaves y asignación de roles, segunda parte (H-05): lo que sólo detectaba el pin de texto de assert_catalogo (el traslado de un rol a otra empresa, roles_update, es la
  --    sección 3b de abajo: su fila nueva se comprueba con un UPDATE sin WHERE, y a SU se le actualizarían los cientos de roles de sistema) ─────────────────────────────────────────
  (31, 'K3',  'INSERT role_permissions sobre un rol de SISTEMA (el propietario no reescribe las llaves de los roles de plataforma)',
       $q$INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ({ROLS}, (SELECT p.key FROM public.permissions p WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id = {ROLS} AND rp.permission_key = p.key) ORDER BY p.key LIMIT 1), 'allow')$q$, NULL,
       'ok,ok,rls,rls,rls,rls,rls,rls,rls,rls', true),
  (32, 'K4',  'DELETE role_permissions de un rol de SISTEMA',
       $q$DELETE FROM public.role_permissions WHERE role_id = {ROLS} AND permission_key = (SELECT rp.permission_key FROM public.role_permissions rp WHERE rp.role_id = {ROLS} ORDER BY rp.permission_key LIMIT 1)$q$, NULL,
       'ok,ok,cero,cero,cero,cero,cero,cero,cero,cero', true),
  (33, 'S4',  'INSERT user_roles con assigned_by de OTRA persona (falsear la bitácora de quién asignó)',
       $q$INSERT INTO public.user_roles (user_id, role_id, assigned_by) VALUES ({OP1}, {ROLC}, {AP})$q$, NULL,
       'ok,ok,rls,rls,rls,rls,rls,rls,rls,rls', true),
  (34, 'S5',  'INSERT user_roles con assigned_by = quien asigna (lo legítimo)',
       $q$INSERT INTO public.user_roles (user_id, role_id, assigned_by) VALUES ({OP1}, {ROLC}, {ACTOR})$q$, NULL,
       'ok,ok,ok,rls,rls,rls,rls,rls,rls,rls', false),
  (35, 'K5',  'INSERT role_permissions sobre un rol de OTRA empresa (D): sólo el superadministrador y el propietario de D',
       $q$INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES ('a5b00000-0000-0000-0000-000000000002', (SELECT key FROM public.permissions ORDER BY key LIMIT 1), 'allow')$q$,
       $q$INSERT INTO public.roles (id, company_id, name, is_system) VALUES ('a5b00000-0000-0000-0000-000000000002', {D}, 'ASG rol de D', false)$q$,
       'ok,ok,rls,rls,rls,rls,rls,rls,ok,rls', true);
-- (35 operaciones × 10 actores = 350 casos; el DELETE de A3 borra las 2 filas de OP1)

-- ═══ 1 · la matriz ════════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  o record;  a record;  cod text;  v_sql text;  v_prep text;  v_etq text;  v_n bigint;
BEGIN
  FOR o IN SELECT * FROM _ops ORDER BY n LOOP
    FOR a IN SELECT * FROM _actores ORDER BY n LOOP
      cod    := (string_to_array(o.esp, ','))[a.n];
      v_sql  := replace(o.sql, '{ACTOR}', '{' || a.actor || '}');
      v_prep := NULLIF(concat_ws('; ', a.prep, o.prep), '');
      v_etq  := format('[%s] %s · %s', o.id, a.etq, o.etq);
      v_n    := CASE WHEN o.id = 'A3' THEN 2 ELSE 1 END;
      IF cod = 'ok' THEN
        PERFORM asgt.caso(v_etq, a.actor, v_sql, 'ok', p_filas => v_n, p_preparar => v_prep);
      ELSIF cod = 'rls' THEN
        PERFORM asgt.caso(v_etq, a.actor, v_sql, 'error', p_sqlstate => '42501', p_patron => 'row-level security', p_preparar => v_prep,
                          p_control => NOT (a.actor = 'SINAPP' AND NOT o.ctrl8));
      ELSIF cod = 'cero' THEN
        PERFORM asgt.caso(v_etq, a.actor, v_sql, 'cero', p_preparar => v_prep);
      ELSE
        RAISE EXCEPTION 'código esperado desconocido «%» en %', cod, v_etq;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ═══ 2 · el principal de OTRA empresa sí escribe en la SUYA (y no en la ajena) ═════════════════════════════════════════
-- Orden de los actores: SU SU2 OW AP AX OP1 VW1 SINAPP DOW OP2. La empresa D tiene a DOW (propietario) y a DAD (administrador).
SELECT asgt.ok('[D·I1] el propietario de D invita a un administrador de SU empresa', 'DOW',
  $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-d1@example.test', 'admin', 'asg-tok-d1')$q$, 1);
SELECT asgt.err_rls('[D·I1] el administrador de D NO invita a un administrador ni en su propia empresa', 'DAD',
  $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-d2@example.test', 'admin', 'asg-tok-d2')$q$);
SELECT asgt.ok('[D·I2] … pero sí a un operador', 'DAD',
  $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-d3@example.test', 'operator', 'asg-tok-d3')$q$, 1);
SELECT asgt.err_rls('[D·I1] el propietario de C no invita a nadie a la empresa D', 'OW',
  $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({D}, 'asg-d4@example.test', 'operator', 'asg-tok-d4')$q$);
SELECT asgt.ok('[D·J1] el propietario de D crea un proyecto en SU empresa', 'DOW',
  $q$INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f3', {D}, 'ASG proyecto de D')$q$, 1,
  p_preparar => 'SET session_replication_role = replica');
SELECT asgt.err_rls('[D·J1] el administrador de D NO', 'DAD',
  $q$INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f4', {D}, 'ASG proyecto de D')$q$,
  p_preparar => 'SET session_replication_role = replica');
SELECT asgt.err_rls('[D·J1] el propietario de C no crea proyectos en D', 'OW',
  $q$INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f5', {D}, 'ASG proyecto de D')$q$,
  p_preparar => 'SET session_replication_role = replica');
SELECT asgt.ok('[D·J2] el propietario de D borra un proyecto de SU empresa', 'DOW', $q$DELETE FROM public.projects WHERE id = {D2}$q$, 1);
SELECT asgt.cero('[D·J2] el administrador de D NO', 'DAD', $q$DELETE FROM public.projects WHERE id = {D2}$q$);
SELECT asgt.ok('[D·R1] el propietario de D crea un rol de SU empresa', 'DOW', $q$INSERT INTO public.roles (company_id, name, is_system) VALUES ({D}, 'ASG rol de D', false)$q$, 1);
SELECT asgt.err_rls('[D·R1] el administrador de D NO', 'DAD', $q$INSERT INTO public.roles (company_id, name, is_system) VALUES ({D}, 'ASG rol de D', false)$q$);
SELECT asgt.err_rls('[D·R1] el propietario de C no crea roles de la empresa D', 'OW', $q$INSERT INTO public.roles (company_id, name, is_system) VALUES ({D}, 'ASG rol de D', false)$q$);

-- ═══ 3 · lo que NO cambia: la lectura de roles y de asignaciones de roles, la edición de proyectos y las invitaciones de operador siguen abiertas al administrador ═══════
SELECT asgt.ok_sql('[lectura] el administrador acotado sigue LEYENDO los roles de sistema y los de su empresa (roles_select no cambió)', 'AP',
  'SELECT * FROM public.roles',
  $q$SELECT count(*) FROM public.roles WHERE is_system OR company_id = {C}$q$);
SELECT asgt.ok_sql('[lectura] … y las asignaciones de roles de las personas de su empresa (user_roles_select no cambió)', 'AX',
  'SELECT * FROM public.user_roles',
  $q$SELECT count(*) FROM public.user_roles ur WHERE ur.user_id IN (SELECT id FROM public.app_users WHERE company_id = {C})$q$,
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP1}, {ROLC})$q$);
SELECT asgt.ok_sql('[lectura] … y las invitaciones de operador de su empresa (la invitación ''admin'' ya NO: es del principal, 0700)', 'AP',
  'SELECT * FROM public.user_invitations',
  $q$SELECT count(*) FROM public.user_invitations WHERE company_id = {C} AND role <> 'admin'$q$,
  p_preparar => $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-l1@example.test', 'operator', 'asg-tok-l1'), ({C}, 'asg-l3@example.test', 'admin', 'asg-tok-l3')$q$);
SELECT asgt.ok_sql('[lectura] … y el propietario lee TODAS, también la ''admin'' (la tabla de la empresa tiene una más que lo que ve el administrador)', 'OW',
  'SELECT * FROM public.user_invitations',
  $q$SELECT count(*) FROM public.user_invitations WHERE company_id = {C}$q$,
  p_preparar => $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-l1@example.test', 'operator', 'asg-tok-l1'), ({C}, 'asg-l3@example.test', 'admin', 'asg-tok-l3')$q$);
SELECT asgt.chk_txt((SELECT count(*)::text FROM public.user_invitations), '0', '[lectura] montaje: la tabla user_invitations está vacía antes y después de los casos (sin residuos)');
SELECT asgt.ok('[lectura] un operador no ve ninguna invitación (0 filas, aunque la tabla tiene una)', 'OP1', 'SELECT * FROM public.user_invitations', 0,
  p_preparar => $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-l2@example.test', 'operator', 'asg-tok-l2')$q$);

-- ═══ 3b · roles_update (H-05/m17): un rol de la empresa NO se traslada a OTRA empresa ═══════════════════════════════════════════════════════════════════════════════
-- Sin WHERE: con un WHERE que lea columnas, la política roles_select (que se aplica también a la fila NUEVA) tapaba el WITH CHECK de roles_update. Como SISTEMA, un UPDATE sin WHERE tocaría también
-- los roles de sistema (company_id debe ser NULL en ellos: roles_company_or_system_chk), así que cada caso monta primero (como SISTEMA, deshecho al terminar) una tabla con SÓLO el rol de la
-- empresa C (ROLC). El propietario de C lo traslada a D: la fila nueva dejaría de ser de C y el WITH CHECK la rechaza (42501); los demás no alcanzan ningún rol (0 filas) y el control como SISTEMA sí
-- actualiza la fila.
SELECT asgt.caso('[R4] OW · UPDATE roles SET company_id = D (trasladar el rol de la empresa a otra): el WITH CHECK lo rechaza', 'OW',
  $q$UPDATE public.roles SET company_id = {D}$q$, 'error', p_sqlstate => '42501', p_patron => 'row-level security',
  p_preparar => $q$DELETE FROM public.roles WHERE is_system$q$);
SELECT asgt.caso('[R4] OW · … ni lo convierte en un rol de sistema (is_system = true)', 'OW',
  $q$UPDATE public.roles SET is_system = true, company_id = NULL$q$, 'error', p_sqlstate => '42501', p_patron => 'row-level security',
  p_preparar => $q$DELETE FROM public.roles WHERE is_system$q$);
SELECT asgt.caso('[R4] OW · … y renombrar su rol sin moverlo sí (lo legítimo)', 'OW',
  $q$UPDATE public.roles SET name = 'ASG rol renombrado'$q$, 'ok', p_filas => 1,
  p_preparar => $q$DELETE FROM public.roles WHERE is_system$q$);
DO $$
DECLARE a text;
BEGIN
  FOREACH a IN ARRAY ARRAY['AP', 'AX', 'OP1', 'VW1', 'SINAPP', 'DOW'] LOOP
    PERFORM asgt.caso('[R4] ' || a || ' · UPDATE roles SET company_id = D: no alcanza ningún rol de C (0 filas)', a, $q$UPDATE public.roles SET company_id = {D}$q$, 'cero',
      p_preparar => $q$DELETE FROM public.roles WHERE is_system$q$);
  END LOOP;
END $$;

-- ═══ 4 · sesión SIN fila en app_users: la regla dice false (nunca NULL) y todo se rechaza ═══════════════════════════════
DO $$
DECLARE v_regla boolean;  v_dueno text;  v_super text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', asgt.uid_de(10)::text, true);        -- SINAPP: existe en auth, no en app_users
  BEGIN
    v_regla := public.asignacion_puede_administrar(asgt.uid_de(21), asgt.pid_de(1));
  EXCEPTION WHEN undefined_function THEN
    -- sin la 0600 la regla no existe: se ANOTA como fallo (no aborta el archivo; sin la migración el resto de los casos se cuenta igual)
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM asgt.falla('[sin app_users] la regla de las asignaciones no existe (la 20261026000600 no está aplicada)');
    v_regla := NULL;
    PERFORM set_config('request.jwt.claim.sub', asgt.uid_de(10)::text, true);
  END;
  v_dueno := COALESCE(public.is_company_owner()::text, 'NULL');
  v_super := COALESCE(public.is_super_admin()::text, 'NULL');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_regla IS NOT NULL OR to_regprocedure('public.asignacion_puede_administrar(uuid,uuid)') IS NOT NULL THEN
    PERFORM asgt.chk_bool(v_regla, false, '[sin app_users] la regla de las asignaciones devuelve false, no NULL (COALESCE): la política no depende de cómo trate el NULL');
  END IF;
  PERFORM asgt.chk_txt(v_dueno || '/' || v_super, 'NULL/NULL',
    '[sin app_users] is_company_owner() e is_super_admin() devuelven NULL (límite documentado de las funciones auxiliares): las políticas lo tratan como rechazo, como prueba la matriz');
END $$;

-- ═══ 5 · el rol RBAC no confiere principal, ni siquiera el de «Admin Plataforma» ═══════════════════════════════════════
SELECT asgt.chk_bool(EXISTS (SELECT 1 FROM public.roles WHERE id = '00000000-0000-0000-0000-000000000201' AND is_system), true,
  '[rbac] montaje: existe el rol de sistema «Admin Plataforma» (el que create-user asigna a un administrador)');
SELECT asgt.err_rls('[rbac] un operador con «Admin Plataforma» no asigna proyectos a otra persona', 'OP2', asgt.ins('NUEVO', 'P1'),
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);
SELECT asgt.err_propia('[rbac] … ni se asigna a sí mismo (OP2 → P1)', 'OP2', asgt.ins('OP2', 'P1'),
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);
SELECT asgt.err_rls('[rbac] … ni crea un rol', 'OP2', $q$INSERT INTO public.roles (company_id, name, is_system) VALUES ({C}, 'ASG rol de OP2', false)$q$,
  p_preparar => $q$INSERT INTO public.user_roles (user_id, role_id) VALUES ({OP2}, '00000000-0000-0000-0000-000000000201')$q$);

-- ═══ 6 · D-9 y el flujo oficial: lo asigna el principal ════════════════════════════════════════════════════════════════
-- Un proyecto NUEVO de la empresa no es visible para un administrador acotado y NO se le asigna solo (no hay trigger AFTER INSERT ON projects ni autoasignación).
-- Lo asigna el principal; el administrador no puede asignárselo ni se lo asigna otro administrador.
SELECT asgt.ok('[D-9] el propietario le asigna a AP el proyecto nuevo (su alcance crece por decisión del principal)', 'OW', asgt.ins('AP', 'P4'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3,P4|false');
SELECT asgt.ok('[D-9] el superadministrador también', 'SU', asgt.ins('AP', 'P4'), 1,
  p_efecto_sql => $q$SELECT asgt.puede({AP}, {P4})::text$q$, p_efecto => 'true');
SELECT asgt.err_propia('[D-9] AP no puede asignarse el proyecto nuevo', 'AP', asgt.ins('AP', 'P4'));
SELECT asgt.err_rls('[D-9] ni se lo asigna otro administrador (AX)', 'AX', asgt.ins('AP', 'P4'));
SELECT asgt.cero('[D-9] y un proyecto que AP no ve (P4) lo borra sólo el principal: AP recibe 0 filas', 'AP', $q$DELETE FROM public.projects WHERE id = {P4}$q$);
SELECT asgt.ok('[D-2] el propietario SÍ acota a un administrador exento (AX → P1)', 'OW', asgt.ins('AX', 'P1'), 1,
  p_efecto_sql => $q$SELECT asgt.filas_de({AX}) || '|' || asgt.exento({AX})::text$q$, p_efecto => 'P1|false');
SELECT asgt.ok('[D-2] … y le quita el alcance a uno acotado: AP pasa a ser exento POR DECISIÓN DEL PROPIETARIO', 'OW', asgt.borrar_de('AP'), 3,
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => '|true');
SELECT asgt.cero('[D-2] un administrador NO le quita el alcance a otro (AX no borra las de AP)', 'AX', asgt.borrar_de('AP'),
  p_efecto_sql => $q$SELECT asgt.filas_de({AP}) || '|' || asgt.exento({AP})::text$q$, p_efecto => 'P1,P2,P3|false');
SELECT asgt.err_rls('[D-2] ni lo acota (AP → AX2 → P2)', 'AP', asgt.ins('AX2', 'P2'));

-- ═══ 7 · la sesión SIN app_users es rechazada también donde el resultado de la política es NULL ═══════════════════════════
SELECT asgt.err_rls('[sin app_users] no crea proyectos', 'SINAPP',
  $q$INSERT INTO public.projects (id, company_id, nombre) VALUES ('a5d00000-0000-0000-0000-0000000000f6', {C}, 'ASG proyecto de nadie')$q$,
  p_preparar => 'SET session_replication_role = replica');
SELECT asgt.err_rls('[sin app_users] no invita a un administrador', 'SINAPP',
  $q$INSERT INTO public.user_invitations (company_id, email, role, token) VALUES ({C}, 'asg-s1@example.test', 'admin', 'asg-tok-s1')$q$);
SELECT asgt.err_rls('[sin app_users] no asigna proyectos', 'SINAPP', asgt.ins('NUEVO', 'P1'));

-- ═══ 8 · app_users.project_id: el proyecto de una persona es de SU empresa, para CUALQUIER actor (H-01 de la quinta verificación) ═══════════════════════
-- user_has_project_access() y has_admin_project_access() leen app_users.project_id sin comprobar la empresa del proyecto: el propietario (app_users_update) podía fijarle a una persona
-- de SU empresa el proyecto de OTRA y darle acceso a las tablas con alcance por proyecto de la otra empresa. La 0700 añade trg_validar_proyecto_app_users (BEFORE INSERT OR UPDATE OF
-- project_id, company_id): el proyecto debe existir y ser de la empresa de la persona, también para el rol de servicio y el superusuario; NULL pasa; lo existente no se toca.
-- Actores: el sistema (superusuario sin sesión), el rol de servicio (las funciones de borde), el superadministrador de C y el de D (otra empresa) y el propietario de C.
DO $$
DECLARE
  a text;
  v_p text := $q$INSERT INTO auth.users (id) VALUES ('a5e00000-0000-0000-0000-0000000000b1')$q$;
BEGIN
  FOREACH a IN ARRAY ARRAY['SISTEMA', 'SERVICIO', 'SU', 'SU2', 'OW'] LOOP
    PERFORM asgt.caso('[app_users·1] ' || a || ' · fijar el project_id de una persona de C (AX) a un proyecto de OTRA empresa (D1)', a,
      $q$UPDATE public.app_users SET project_id = {D1} WHERE id = {AX}$q$, 'error',
      p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false);
    PERFORM asgt.caso('[app_users·2] ' || a || ' · … a un proyecto que no existe', a,
      $q$UPDATE public.app_users SET project_id = 'a5d00000-0000-0000-0000-0000000000ee' WHERE id = {AX}$q$, 'error',
      p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false);
    PERFORM asgt.caso('[app_users·3] ' || a || ' · … y a un proyecto de SU empresa (P1) sí', a,
      $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {AX}$q$, 'ok', p_filas => 1,
      p_efecto_sql => $q$SELECT (project_id = {P1})::text FROM public.app_users WHERE id = {AX}$q$, p_efecto => 'true');
    PERFORM asgt.caso('[app_users·4] ' || a || ' · … y a NULL (quitar el proyecto) también', a,
      $q$UPDATE public.app_users SET project_id = NULL WHERE id = {AX}$q$, 'ok', p_filas => 1,
      p_preparar => $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {AX}$q$,
      p_efecto_sql => $q$SELECT (project_id IS NULL)::text FROM public.app_users WHERE id = {AX}$q$, p_efecto => 'true');
    PERFORM asgt.caso('[app_users·5] ' || a || ' · cambiar la EMPRESA de una persona que tiene proyecto lo dejaría con el proyecto de la anterior', a,
      $q$UPDATE public.app_users SET company_id = {D} WHERE id = {AX}$q$, 'error',
      p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false,
      p_preparar => $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {AX}$q$);
    IF a <> 'OW' THEN          -- el propietario de C no alcanza a una persona sin empresa (la RLS la filtra: 0 filas), así que el trigger ni se evalúa
      PERFORM asgt.caso('[app_users·6] ' || a || ' · … y una persona SIN empresa (SINEMP) no recibe ningún proyecto', a,
        $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {SINEMP}$q$, 'error',
        p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false);
    END IF;
  END LOOP;
  -- INSERT directo (create-user, accept-invitation, signup-company escriben app_users con el rol de servicio): sin proyecto pasa; con el de otra empresa, no
  FOREACH a IN ARRAY ARRAY['SISTEMA', 'SERVICIO', 'SU', 'OW'] LOOP
    PERFORM asgt.caso('[app_users·7] ' || a || ' · INSERT de una persona de C con el project_id de un proyecto de D', a,
      $q$INSERT INTO public.app_users (id, company_id, full_name, role, project_id) VALUES ('a5e00000-0000-0000-0000-0000000000b1', {C}, 'ASG persona nueva', 'operator', {D1})$q$, 'error',
      p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false, p_preparar => v_p);
    PERFORM asgt.caso('[app_users·8] ' || a || ' · … con el de su empresa (P1) y sin project_id (el camino de create-user / accept-invitation / signup-company)', a,
      $q$INSERT INTO public.app_users (id, company_id, full_name, role, project_id) VALUES ('a5e00000-0000-0000-0000-0000000000b1', {C}, 'ASG persona nueva', 'operator', {P1}), ('a5e00000-0000-0000-0000-0000000000b2', {C}, 'ASG persona sin proyecto', 'operator', NULL)$q$,
      'ok', p_filas => 2, p_preparar => v_p || $q$; INSERT INTO auth.users (id) VALUES ('a5e00000-0000-0000-0000-0000000000b2')$q$);
  END LOOP;
END $$;
-- el propietario de OTRA empresa (D) escribe en la SUYA, y no toca a las personas de C
SELECT asgt.caso('[app_users·9] el propietario de D fija a su operador (DOP) a un proyecto de D', 'DOW',
  $q$UPDATE public.app_users SET project_id = {D1} WHERE id = {DOP}$q$, 'ok', p_filas => 1);
SELECT asgt.caso('[app_users·10] … y no al de C (P1): DOP es de D', 'DOW',
  $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {DOP}$q$, 'error',
  p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false);
-- un administrador, un operador y un visor no escriben app_users ajenos (la RLS ya lo decía: no cambia)
SELECT asgt.caso('[app_users·11] un administrador NO fija el project_id de otra persona (0 filas; app_users_update es del propietario)', 'AP',
  $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {AX}$q$, 'cero');
-- AUTOEDICIÓN: trg_lock_app_users_self_privilege restituye project_id; el trigger nuevo se dispara DESPUÉS (orden alfabético) y valida la fila ya restituida
SELECT asgt.caso('[app_users·12] un operador que intenta fijarse el proyecto de OTRA empresa: la autoedición se restituye y la escritura no falla', 'OP1',
  $q$UPDATE public.app_users SET project_id = {D1} WHERE id = {OP1}$q$, 'ok', p_filas => 1,
  p_efecto_sql => $q$SELECT (project_id IS NULL)::text FROM public.app_users WHERE id = {OP1}$q$, p_efecto => 'true');
-- LO EXISTENTE NO SE TOCA: una persona que ya cruza empresa (dato heredado, montado con los disparadores apagados) se puede seguir editando en lo demás
SELECT asgt.caso('[app_users·13] un dato heredado que ya cruza empresa no impide editar OTRAS columnas (el trigger sólo se dispara al escribir project_id / company_id)', 'OW',
  $q$UPDATE public.app_users SET full_name = 'ASG renombrado' WHERE id = {AX}$q$, 'ok', p_filas => 1,
  p_preparar => $q$SET session_replication_role = replica; UPDATE public.app_users SET project_id = {D1} WHERE id = {AX}; SET session_replication_role = origin$q$);
-- FLUJOS LEGÍTIMOS: borrar un proyecto al que apunta una persona (sin llave foránea no pasa nada; con ON DELETE SET NULL, el SET NULL en cascada pasa por el trigger y NULL pasa)
SELECT asgt.caso('[app_users·14] el propietario borra un proyecto al que una persona apunta con app_users.project_id (hoy no hay llave foránea: la columna queda sin proyecto válido y no falla nada)', 'OW',
  $q$DELETE FROM public.projects WHERE id = {P1}$q$, 'ok', p_filas => 1,
  p_preparar => $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {AX}$q$);
SELECT asgt.caso('[app_users·15] … y con una llave foránea ON DELETE SET NULL (el diseño que dejó anotado la migración baseline) el SET NULL en cascada pasa por el trigger sin fallar y deja NULL', 'OW',
  $q$DELETE FROM public.projects WHERE id = {P1}$q$, 'ok', p_filas => 1,
  p_preparar => $q$ALTER TABLE public.app_users ADD CONSTRAINT zz_app_users_project_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL; UPDATE public.app_users SET project_id = {P1} WHERE id = {AX}$q$,
  p_efecto_sql => $q$SELECT (project_id IS NULL)::text FROM public.app_users WHERE id = {AX}$q$, p_efecto => 'true');
-- BORRADO DE EMPRESA (delete-company): al superadministrador colgado de la empresa se le desliga con company_id = NULL (y, desde esta ronda, project_id = NULL en el mismo UPDATE)
SELECT asgt.caso('[app_users·16] SERVICIO · delete-company desliga al superadministrador (company_id = NULL, project_id = NULL en el mismo UPDATE)', 'SERVICIO',
  $q$UPDATE public.app_users SET company_id = NULL, project_id = NULL WHERE id = {SU}$q$, 'ok', p_filas => 1,
  p_preparar => $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {SU}$q$);
SELECT asgt.caso('[app_users·17] SERVICIO · … sólo company_id = NULL con un proyecto puesto dejaría un proyecto sin empresa y se rechaza (por eso delete-company limpia los dos)', 'SERVICIO',
  $q$UPDATE public.app_users SET company_id = NULL WHERE id = {SU}$q$, 'error',
  p_sqlstate => '23514', p_patron => 'APP_USERS_PROYECTO_EMPRESA_DISTINTA', p_control => false,
  p_preparar => $q$UPDATE public.app_users SET project_id = {P1} WHERE id = {SU}$q$);
SELECT asgt.caso('[app_users·18] SERVICIO · sin proyecto, desligar al superadministrador (company_id = NULL) pasa', 'SERVICIO',
  $q$UPDATE public.app_users SET company_id = NULL WHERE id = {SU}$q$, 'ok', p_filas => 1);

SELECT asgt.chk((SELECT count(*) FROM asgt.fallos), 0, '[principal] ningún veredicto fallido anotado');
SELECT asgt.chk((SELECT count(*) FROM public.user_project_assignments), 43, '[principal] tras deshacer los casos siguen las 43 filas');
