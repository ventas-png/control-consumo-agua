\set ON_ERROR_STOP on
-- ============================================================================
-- ASG-1 · Nadie se asigna ni se quita proyectos a sí mismo escribiendo en user_project_assignments
--
-- ⚠ PRUEBA DE UNA CORRECCIÓN QUE NO ESTÁ EN LA MIGRACIÓN 20261027000900 (fix_asignaciones.sql, propuesta aparte). NO copiarla a
--   hallazgos/ sin la corrección: run.sh la recogería por el glob y saldría ROJA (ese es justo su sentido). SOLO clúster local.
--
-- CAUSA RAÍZ
--   Las políticas INSERT / UPDATE / DELETE de public.user_project_assignments (20260417000013) terminan en
--   `OR user_id = (SELECT auth.uid())`: cualquier usuario autenticado puede insertarse una asignación a CUALQUIER proyecto (también de
--   otra empresa) o borrar las suyas. Como `can_access_project()` y `user_is_project_exempt()` leen esa tabla, el alcance de proyecto
--   deja de ser un límite: un operador asignado a un proyecto se asigna otro con un POST a la API, y un administrador con asignaciones
--   borra las suyas y pasa a ser «exento de proyecto» (administrador sin asignaciones).
--
-- COMPORTAMIENTO ESPERADO
--   a. CATÁLOGO: las políticas de escritura ya no tienen la rama `user_id = auth.uid()`; la de lectura sí (cada persona lee las suyas).
--   b. NO se puede: un operador (ni ningún no administrador) inserta, cambia o borra sus propias asignaciones (INSERT → 42501 de RLS;
--      UPDATE / DELETE → 0 filas), ni a un proyecto de OTRA empresa; un administrador CON asignaciones no amplía las suyas ni se vuelve
--      exento borrándolas; el administrador de otra empresa no toca las asignaciones de esta.
--   c. LEGÍTIMO (lo que hace AsignacionModal): el administrador de la empresa reemplaza las asignaciones de OTRA persona de su empresa;
--      el propietario, las de cualquiera de su empresa (también las suyas: es exento); el superadministrador, cualquiera.
--   d. LEER: cada persona sigue viendo SOLO sus propias asignaciones.
--   e. EFECTO: tras todos los intentos, el alcance real de cada persona es el que tenía.
--
-- Ids propios: fa570000-0000-0000-0000-0000000000XX. Re-ejecutable en la misma base (limpia sus asignaciones al empezar y al terminar).
-- Se ejecuta con:  psql -X -v ON_ERROR_STOP=1 -d <BD copia de hall_b0800> -f ASG-1.sql      (usa las ayudas chk* de fixture.sql)
-- ============================================================================

-- ── Ayudas (se borran al final) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asg_falla(p_sql text, p_estado text, p_patron text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado AND SQLERRM ~ p_patron THEN
      RAISE NOTICE '✓ % (%)', p_msg, left(SQLERRM, 80);
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló con % «%», y se esperaba % «%»', p_msg, SQLSTATE, left(SQLERRM, 240), p_estado, p_patron;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', p_msg;
END;
$$;

-- Ejecuta un INSERT / UPDATE / DELETE y exige EXACTAMENTE `p_filas` filas afectadas (nunca éxito si no hubo operación).
CREATE OR REPLACE FUNCTION public.asg_filas(p_sql text, p_filas bigint, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM p_filas THEN
    RAISE EXCEPTION '% — se esperaban % filas afectadas y fueron %', p_msg, p_filas, n;
  END IF;
  RAISE NOTICE '✓ % (% fila(s))', p_msg, n;
END;
$$;

-- Sesión de una persona como `authenticated` (dentro de un DO) / de sistema (superusuario sin sub).
CREATE OR REPLACE FUNCTION public.asg_como(p_uid uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  IF p_uid IS NULL THEN RESET ROLE; ELSE SET LOCAL ROLE authenticated; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.asg_proyectos(p_uid uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(string_agg(project_id::text, ',' ORDER BY project_id), '') FROM public.user_project_assignments WHERE user_id = p_uid
$$;

-- ── Montaje (superusuario): proyecto C3 y cinco personas de la empresa C ─────────────────────────────────────
--   UOW propietario · USU superadministrador · UAX administrador SIN asignaciones (exento) · UOP operador de C3 · UAP administrador de C3
SET session_replication_role = replica;      -- sin el tope de proyectos del plan ni la siembra contable (no es lo que se prueba)
INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('fa570000-0000-0000-0000-0000000000c3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ASG-1 Proyecto C3')
ON CONFLICT (id) DO NOTHING;
SET session_replication_role = origin;
INSERT INTO auth.users (id) VALUES
  ('fa570000-0000-0000-0000-0000000000a1'), ('fa570000-0000-0000-0000-0000000000a2'), ('fa570000-0000-0000-0000-0000000000a3'),
  ('fa570000-0000-0000-0000-0000000000a4'), ('fa570000-0000-0000-0000-0000000000a5')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES
  ('fa570000-0000-0000-0000-0000000000a1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ASG-1 propietario de C',            'company_owner'),
  ('fa570000-0000-0000-0000-0000000000a2', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ASG-1 superadministrador',          'super_admin'),
  ('fa570000-0000-0000-0000-0000000000a3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ASG-1 administrador de C (exento)', 'admin'),
  ('fa570000-0000-0000-0000-0000000000a4', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ASG-1 operador de C3',              'operator'),
  ('fa570000-0000-0000-0000-0000000000a5', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'ASG-1 administrador de C3',         'admin')
ON CONFLICT (id) DO NOTHING;
DELETE FROM public.user_project_assignments WHERE user_id::text LIKE 'fa570000-0000-0000-0000-0000000000a_';
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES
  ('fa570000-0000-0000-0000-0000000000a4', 'fa570000-0000-0000-0000-0000000000c3', 'total'),
  ('fa570000-0000-0000-0000-0000000000a5', 'fa570000-0000-0000-0000-0000000000c3', 'total');

-- ═══════════════════════════════════════════════════════════════════════════
-- a · CATÁLOGO: las políticas de escritura ya no tienen la rama «user_id = auth.uid()»; la de lectura sí
-- ═══════════════════════════════════════════════════════════════════════════
DO $catalogo$
DECLARE
  v_cmd text;
  v_n bigint;
  v_tiene boolean;
BEGIN
  SELECT count(*) INTO v_n FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass;
  PERFORM public.chk(v_n, 4, '[catálogo] user_project_assignments tiene exactamente 4 políticas (select, insert, update, delete)');
  FOR v_cmd, v_tiene IN
    SELECT p.polcmd::text,
           (COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ 'user_id = \( SELECT auth\.uid'
      FROM pg_policy p WHERE p.polrelid = 'public.user_project_assignments'::regclass ORDER BY p.polcmd
  LOOP
    IF v_cmd = 'r' THEN
      PERFORM public.chk_bool(v_tiene, true, '[catálogo] la política de LECTURA conserva «user_id = auth.uid()»: cada persona lee las suyas');
    ELSE
      PERFORM public.chk_bool(v_tiene, false, format('[catálogo] la política de ESCRITURA «%s» ya no tiene la rama «user_id = auth.uid()»',
        CASE v_cmd WHEN 'a' THEN 'insert' WHEN 'w' THEN 'update' ELSE 'delete' END));
    END IF;
  END LOOP;
END;
$catalogo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- b1 · Un operador no se asigna proyectos, no cambia ni borra las suyas (ni a un proyecto de otra empresa)
-- ═══════════════════════════════════════════════════════════════════════════
DO $operador$
DECLARE
  UOP constant uuid := 'fa570000-0000-0000-0000-0000000000a4';
  C1 constant uuid := 'c1c1c1c1-0000-0000-0000-000000000001';  C3 constant uuid := 'fa570000-0000-0000-0000-0000000000c3';
  D1 constant uuid := 'd1d1d1d1-0000-0000-0000-000000000001';
BEGIN
  PERFORM public.asg_como(UOP);
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, C1),
    '42501', 'row-level security', '[operador] no se inserta una asignación propia a otro proyecto de su empresa (C1)');
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, D1),
    '42501', 'row-level security', '[operador] ni a un proyecto de OTRA empresa (D1)');
  PERFORM public.asg_filas(format('UPDATE public.user_project_assignments SET project_id = %L WHERE user_id = %L', C1, UOP), 0,
    '[operador] cambiar su propia asignación a otro proyecto afecta 0 filas');
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UOP), 0,
    '[operador] borrar sus propias asignaciones afecta 0 filas');
  PERFORM public.asg_como(NULL);
  PERFORM public.chk_txt(public.asg_proyectos(UOP), C3::text, '[operador] sus asignaciones siguen siendo exactamente {C3}');
  PERFORM public.asg_como(UOP);
  PERFORM public.chk_bool(public.can_access_project(C1), false, '[operador] y NO tiene acceso a C1');
  PERFORM public.chk_bool(public.can_access_project(C3), true, '[operador] y sigue teniendo acceso a C3');
  PERFORM public.asg_como(NULL);
END;
$operador$;

-- ═══════════════════════════════════════════════════════════════════════════
-- b2 · Un administrador CON asignaciones no amplía las suyas ni se vuelve exento borrándolas
-- ═══════════════════════════════════════════════════════════════════════════
DO $admin$
DECLARE
  UAP constant uuid := 'fa570000-0000-0000-0000-0000000000a5';  UAX constant uuid := 'fa570000-0000-0000-0000-0000000000a3';
  C1 constant uuid := 'c1c1c1c1-0000-0000-0000-000000000001';  C3 constant uuid := 'fa570000-0000-0000-0000-0000000000c3';
  D1 constant uuid := 'd1d1d1d1-0000-0000-0000-000000000001';
BEGIN
  PERFORM public.asg_como(UAP);
  PERFORM public.chk_bool(public.user_is_project_exempt(), false, '[administrador] montaje: con asignaciones NO es exento de proyecto');
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UAP, C1),
    '42501', 'row-level security', '[administrador] no se asigna a sí mismo otro proyecto de su empresa (C1)');
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UAP, D1),
    '42501', 'row-level security', '[administrador] ni uno de OTRA empresa (D1)');
  PERFORM public.asg_filas(format('UPDATE public.user_project_assignments SET project_id = %L WHERE user_id = %L', C1, UAP), 0,
    '[administrador] cambiar su propia asignación afecta 0 filas');
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UAP), 0,
    '[administrador] borrar SUS asignaciones afecta 0 filas (si pudiera, pasaría a ser exento de proyecto)');
  PERFORM public.chk_bool(public.user_is_project_exempt(), false, '[administrador] sigue sin ser exento');
  PERFORM public.chk_bool(public.can_access_project(C1), false, '[administrador] y sigue sin acceso a C1');
  PERFORM public.asg_como(NULL);
  PERFORM public.chk_txt(public.asg_proyectos(UAP), C3::text, '[administrador] sus asignaciones siguen siendo exactamente {C3}');
  -- el administrador exento (sin asignaciones) tampoco se escribe las suyas: no hay nada que ampliar y, si lo hiciera, dejaría de ser exento
  PERFORM public.asg_como(UAX);
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UAX, C1),
    '42501', 'row-level security', '[administrador exento] el administrador no edita sus propias asignaciones (compensación documentada: se las edita otro administrador o el propietario)');
  PERFORM public.asg_como(NULL);
END;
$admin$;

-- ═══════════════════════════════════════════════════════════════════════════
-- b3 · El administrador de OTRA empresa no toca las asignaciones de esta
-- ═══════════════════════════════════════════════════════════════════════════
DO $otra$
DECLARE
  UD  constant uuid := 'd0d0d0d0-0000-0000-0000-00000000000d';  UOP constant uuid := 'fa570000-0000-0000-0000-0000000000a4';
  C1 constant uuid := 'c1c1c1c1-0000-0000-0000-000000000001';  C3 constant uuid := 'fa570000-0000-0000-0000-0000000000c3';
BEGIN
  PERFORM public.asg_como(UD);
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UOP), 0,
    '[otra empresa] el administrador de D no borra las asignaciones de una persona de C (0 filas)');
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, C1),
    '42501', 'row-level security', '[otra empresa] ni le asigna un proyecto de C');
  PERFORM public.asg_como(NULL);
  PERFORM public.chk_txt(public.asg_proyectos(UOP), C3::text, '[otra empresa] las asignaciones de la persona de C no cambiaron');
END;
$otra$;

-- ═══════════════════════════════════════════════════════════════════════════
-- c · LEGÍTIMO: lo que hace la pantalla de administración de usuarios (AsignacionModal: borra e inserta las de LA PERSONA EDITADA)
-- ═══════════════════════════════════════════════════════════════════════════
DO $legitimo$
DECLARE
  UOW constant uuid := 'fa570000-0000-0000-0000-0000000000a1';  USU constant uuid := 'fa570000-0000-0000-0000-0000000000a2';
  UAX constant uuid := 'fa570000-0000-0000-0000-0000000000a3';  UOP constant uuid := 'fa570000-0000-0000-0000-0000000000a4';
  UAP constant uuid := 'fa570000-0000-0000-0000-0000000000a5';
  C1 constant uuid := 'c1c1c1c1-0000-0000-0000-000000000001';  C2 constant uuid := 'c2c2c2c2-0000-0000-0000-000000000001';
  C3 constant uuid := 'fa570000-0000-0000-0000-0000000000c3';  D1 constant uuid := 'd1d1d1d1-0000-0000-0000-000000000001';
BEGIN
  -- el administrador CON asignaciones reemplaza las de OTRA persona de su empresa, sobre los proyectos que él ve (comportamiento de hoy: la política
  -- exige `project_id IN (proyectos de mi empresa)` y la RLS de `projects` solo le deja ver los suyos, así que un administrador parcial solo
  -- reparte proyectos que tiene)
  PERFORM public.asg_como(UAP);
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UOP), 1,
    '[legítimo · administrador] borra las asignaciones de otra persona de su empresa (paso 1 del reemplazo)');
  PERFORM public.asg_filas(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, C3), 1,
    '[legítimo · administrador] e inserta la nueva (paso 2): C3, un proyecto que él ve');
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, C1),
    '42501', 'row-level security', '[legítimo · administrador] y, como hoy, no reparte un proyecto que él no ve (C1)');
  PERFORM public.asg_como(NULL);
  PERFORM public.chk_txt(public.asg_proyectos(UOP), C3::text, '[legítimo · administrador] la persona quedó con {C3}');

  -- el administrador exento (ve todos los proyectos de la empresa) hace el reemplazo completo sobre otra persona
  PERFORM public.asg_como(UAX);
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UOP), 1, '[legítimo · administrador exento] borra las de otra persona');
  PERFORM public.asg_filas(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total''), (%L, %L, ''total'')', UOP, C1, UOP, C2), 2,
    '[legítimo · administrador exento] e inserta las nuevas: C1 y C2');
  PERFORM public.asg_como(NULL);
  PERFORM public.chk_txt(public.asg_proyectos(UOP), (SELECT string_agg(x::text, ',' ORDER BY x) FROM unnest(ARRAY[C1, C2]) x), '[legítimo · administrador exento] la persona quedó con {C1, C2}');
  PERFORM public.asg_como(UOP);
  PERFORM public.chk_bool(public.can_access_project(C1), true, '[legítimo · administrador exento] y ahora SÍ tiene acceso a C1 (lo dio un administrador, no ella)');
  -- d · LEER: la persona ve SOLO las suyas
  PERFORM public.chk((SELECT count(*) FROM public.user_project_assignments), 2, '[leer] la persona ve solo sus 2 asignaciones (no las de las demás)');
  PERFORM public.asg_como(NULL);
  PERFORM public.asg_como(UAX);
  PERFORM public.asg_filas(format('UPDATE public.user_project_assignments SET project_id = %L WHERE user_id = %L AND project_id = %L', C3, UOP, C2), 1,
    '[legítimo · administrador exento] cambia una asignación de otra persona (C2 → C3)');
  PERFORM public.asg_como(NULL);

  -- el propietario: la de cualquiera de su empresa, y las suyas (es exento: no cambia su alcance)
  PERFORM public.asg_como(UOW);
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UOP), 2, '[legítimo · propietario] borra las asignaciones de otra persona');
  PERFORM public.asg_filas(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, C3), 1,
    '[legítimo · propietario] y deja a la persona como estaba (C3)');
  PERFORM public.asg_filas(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOW, C1), 1,
    '[legítimo · propietario] puede asignarse a sí mismo (es exento de proyecto: su alcance no cambia)');
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L', UOW), 1, '[legítimo · propietario] y borrarse la suya');
  PERFORM public.asg_falla(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, D1),
    '42501', 'row-level security', '[legítimo · propietario] pero no asigna un proyecto de OTRA empresa');
  PERFORM public.asg_como(NULL);

  -- el superadministrador: cualquier proyecto, de cualquier empresa
  PERFORM public.asg_como(USU);
  PERFORM public.asg_filas(format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (%L, %L, ''total'')', UOP, D1), 1,
    '[legítimo · superadministrador] asigna un proyecto de cualquier empresa');
  PERFORM public.asg_filas(format('DELETE FROM public.user_project_assignments WHERE user_id = %L AND project_id = %L', UOP, D1), 1, '[legítimo · superadministrador] y lo quita');
  PERFORM public.asg_como(NULL);
END;
$legitimo$;

-- ═══════════════════════════════════════════════════════════════════════════
-- e · EFECTO: tras todos los intentos y los cambios legítimos, el alcance de cada persona es el esperado
-- ═══════════════════════════════════════════════════════════════════════════
DO $efecto$
DECLARE
  UOP constant uuid := 'fa570000-0000-0000-0000-0000000000a4';  UAP constant uuid := 'fa570000-0000-0000-0000-0000000000a5';
  C1 constant uuid := 'c1c1c1c1-0000-0000-0000-000000000001';  C3 constant uuid := 'fa570000-0000-0000-0000-0000000000c3';
BEGIN
  PERFORM public.chk_txt(public.asg_proyectos(UOP), C3::text, '[efecto] el operador quedó con {C3}');
  PERFORM public.chk_txt(public.asg_proyectos(UAP), C3::text, '[efecto] el administrador con asignaciones quedó con {C3}');
  PERFORM public.asg_como(UAP);
  PERFORM public.chk_bool(public.user_is_project_exempt() OR public.can_access_project(C1), false, '[efecto] ni exento ni con acceso a C1');
  PERFORM public.asg_como(NULL);
END;
$efecto$;

-- ── Limpieza ────────────────────────────────────────────────────────────────
DELETE FROM public.user_project_assignments WHERE user_id::text LIKE 'fa570000-0000-0000-0000-0000000000a_';
DROP FUNCTION IF EXISTS public.asg_proyectos(uuid);
DROP FUNCTION IF EXISTS public.asg_como(uuid);
DROP FUNCTION IF EXISTS public.asg_filas(text, bigint, text);
DROP FUNCTION IF EXISTS public.asg_falla(text, text, text, text);
SELECT public.chk((SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'asg\_%'), 0,
  '[limpieza] la prueba no deja ninguna ayuda asg_* en la base');
