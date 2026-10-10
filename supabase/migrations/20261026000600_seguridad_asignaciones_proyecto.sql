-- ════════════════════════════════════════════════════════════════════════════
-- SEGURIDAD · NADIE SE ASIGNA NI SE QUITA PROYECTOS A SÍ MISMO
-- user_project_assignments: escritura sólo por quien administra, dentro de SU
-- empresa, y nunca sobre su propio alcance (salvo propietario y superadministrador).
--
-- QUÉ FALLABA (preexistente; producción = repositorio, verificado en solo lectura el 2026-10-10)
-- Las políticas INSERT / UPDATE / DELETE de public.user_project_assignments
-- (20260417000013_consolidate_rls_policies_part2.sql) terminaban en
-- `OR user_id = (SELECT auth.uid())`. Cualquier usuario autenticado, de cualquier
-- rol, podía:
--   · insertarse una asignación a CUALQUIER proyecto, también de otra empresa
--     (el project_id de la fila propia no se acotaba): un operador asignado a A se
--     asignaba B con un POST /rest/v1/user_project_assignments y desde ese momento
--     veía y actuaba en B;
--   · borrar sus propias asignaciones: un administrador con asignaciones borraba
--     las suyas y pasaba a ser «exento de proyecto» (administrador sin filas = ve
--     TODA la empresa, user_is_project_exempt());
--   · y, además, asignar a una persona de OTRA empresa a un proyecto propio: las
--     políticas comprobaban el proyecto pero nunca a la persona.
-- Como can_access_project(), user_is_project_exempt() y user_has_project_access()
-- leen esta tabla, el alcance por proyecto no era un límite real contra un usuario
-- hostil.
--
-- QUÉ CAMBIA
--   1. public.asignacion_puede_administrar(p_user_id, p_project_id): UNA sola regla
--      (SECURITY DEFINER, search_path vacío) que usan las tres políticas de
--      escritura:
--        · super_admin / superadmin  → cualquiera;
--        · company_owner             → persona Y proyecto de SU empresa (también a sí
--                                      mismo: es exento, su alcance no cambia);
--        · admin                     → persona Y proyecto de SU empresa, a OTRAS
--                                      personas (nunca a sí mismo) y sólo sobre los
--                                      proyectos que él mismo ve. ESTO ÚLTIMO CONSERVA
--                                      LO QUE HACÍA LA POLÍTICA ANTERIOR: su subconsulta
--                                      `project_id IN (SELECT id FROM projects …)` corría
--                                      bajo la RLS de projects, de modo que un
--                                      administrador acotado sólo repartía (y sólo
--                                      podía borrar) filas de SUS proyectos. Si la
--                                      función sólo comparara la empresa, el
--                                      «borrar todas y volver a insertar» de la pantalla
--                                      de un administrador acotado borraría también las
--                                      asignaciones de la persona a proyectos que ese
--                                      administrador no ve, y no podría restituirlas.
--        · cualquier otro rol        → nada.
--      «Persona de su empresa» = existe en app_users con su misma company_id. Las
--      filas HUÉRFANAS (user_id sin app_users) no son administrables por un
--      administrador ni por el propietario: sólo por el superadministrador o el
--      rol de servicio. No se tocan ni se «arreglan» aquí.
--   2. Se reescriben SÓLO las políticas INSERT, UPDATE (USING y WITH CHECK) y DELETE,
--      con los mismos nombres, usando esa función. La política SELECT NO se toca
--      (cada persona sigue leyendo las suyas). Un UPSERT (INSERT … ON CONFLICT DO
--      UPDATE) queda cubierto por las políticas INSERT y UPDATE.
--   3. Trigger de INTEGRIDAD (trg_asignacion_empresa, BEFORE INSERT OR UPDATE OF
--      user_id, project_id): para CUALQUIER actor, también service_role y
--      superusuario, la empresa de la persona debe existir y ser IGUAL a la del
--      proyecto (ASIGNACION_EMPRESA_DISTINTA, check_violation). Valida sólo lo que se
--      escribe; no mira ni toca las filas existentes.
--   4. Trigger de AUTOASIGNACIÓN (trg_asignacion_propia, BEFORE INSERT OR UPDATE OR
--      DELETE): defensa en profundidad. Con una sesión de la API (auth.uid() no
--      nulo), tocar una fila propia exige ser propietario o superadministrador
--      (ASIGNACION_PROPIA_NO_PERMITIDA, insufficient_privilege). Si una política
--      permisiva futura reabriera el hueco, esto lo sigue cerrando. service_role y
--      superusuario (auth.uid() nulo) pasan.
--      Efecto colateral deliberado: la baja EN CASCADA de la fila propia (un
--      administrador que borra por la API un proyecto al que él mismo está asignado)
--      también se rechaza; si fuera su último proyecto quedaría sin filas y pasaría a
--      ser exento. Lo borra el propietario o el superadministrador. La pantalla no
--      ofrece borrar proyectos.
--   5. Privilegios: anon pierde TODOS (la RLS no le daba nada, pero el privilegio
--      estaba) y authenticated pierde TRUNCATE, TRIGGER y REFERENCES (TRUNCATE no
--      pasa por RLS). Conserva SELECT, INSERT, UPDATE y DELETE, que la RLS gobierna
--      fila por fila. La misma higiene de 20261026000200 (compras y contabilidad).
--
-- QUÉ NO CAMBIA
--   · NINGUNA fila (la migración comprueba que el conteo y la huella md5 de
--     (id, user_id, project_id, permission_type) sean idénticos antes y después y
--     aborta si no lo son). Las asignaciones actuales se conservan tal cual,
--     incluidas las 10 huérfanas.
--   · La política SELECT, la columna permission_type (hoy todas «total»; nada la lee
--     para decidir acceso), user_has_project_access / can_access_project /
--     user_is_project_exempt, ni ninguna otra tabla.
--
-- DESPLIEGUE: va en SU PROPIO push a main, ANTES de la serie 20261027… (PR #926) y
-- de 20261028… (PR #927): apply-migrations-prod.yml aplica sólo los .sql añadidos en
-- cada push y con tope MAX_APPLY = 10. Tabla pequeña; DROP/CREATE POLICY toman
-- ACCESS EXCLUSIVE un instante (lock_timeout de 5 s: si hay una transacción larga
-- sobre la tabla, falla limpia y se reintenta). Verificación posterior:
-- scripts/diagnostico-asignaciones-proyecto.sql. Tras el despliegue hay que
-- RECAPTURAR scripts/schema-drift/huella-produccion.json (cambian los grants, las
-- políticas y los triggers de esta tabla y hay tres funciones nuevas).
--
-- CÓMO REVERTIR: scripts/reversion-asignaciones-proyecto.sql (devuelve las cuatro
-- políticas a su texto original, quita triggers y funciones y restaura los
-- privilegios; idempotente). IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── Pre-vuelo ────────────────────────────────────────────────────────────────
-- Exige lo que esta migración da por existente, guarda el conteo y la huella de la
-- tabla (set_config local a la transacción) e INFORMA —sin fallar— de lo que ya
-- hay en los datos y que esta migración no corrige.
DO $pre$
DECLARE
  v_faltan    text[] := ARRAY[]::text[];
  v_n         bigint;
  v_huella    text;
  v_huerfanas bigint;
  v_cruces    bigint;
  v_sin_filas bigint;
BEGIN
  IF to_regprocedure('public.is_super_admin()')           IS NULL THEN v_faltan := array_append(v_faltan, 'is_super_admin()'); END IF;
  IF to_regprocedure('public.current_user_role()')        IS NULL THEN v_faltan := array_append(v_faltan, 'current_user_role()'); END IF;
  IF to_regprocedure('public.get_my_company_id()')        IS NULL THEN v_faltan := array_append(v_faltan, 'get_my_company_id()'); END IF;
  IF to_regprocedure('public.can_access_project(uuid)')   IS NULL THEN v_faltan := array_append(v_faltan, 'can_access_project(uuid)'); END IF;
  IF to_regprocedure('public.user_is_project_exempt()')   IS NULL THEN v_faltan := array_append(v_faltan, 'user_is_project_exempt()'); END IF;
  IF to_regprocedure('public.user_has_project_access(uuid)') IS NULL THEN v_faltan := array_append(v_faltan, 'user_has_project_access(uuid)'); END IF;
  IF to_regclass('public.user_project_assignments') IS NULL THEN v_faltan := array_append(v_faltan, 'tabla user_project_assignments'); END IF;
  IF to_regclass('public.app_users')                IS NULL THEN v_faltan := array_append(v_faltan, 'tabla app_users'); END IF;
  IF to_regclass('public.projects')                 IS NULL THEN v_faltan := array_append(v_faltan, 'tabla projects'); END IF;
  IF array_length(v_faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (pre-vuelo): faltan % — la cadena de migraciones anterior está incompleta',
      array_to_string(v_faltan, ', ');
  END IF;

  SELECT count(*),
         md5(COALESCE(string_agg(upa.id::text || '|' || upa.user_id::text || '|' || upa.project_id::text || '|' || upa.permission_type,
                                 E'\n' ORDER BY upa.id), ''))
    INTO v_n, v_huella
    FROM public.user_project_assignments upa;
  PERFORM set_config('app.asg_pre_n', v_n::text, true);
  PERFORM set_config('app.asg_pre_huella', v_huella, true);

  SELECT count(*) INTO v_huerfanas
    FROM public.user_project_assignments upa
   WHERE NOT EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = upa.user_id);
  SELECT count(*) INTO v_cruces
    FROM public.user_project_assignments upa
    JOIN public.app_users u ON u.id = upa.user_id
    JOIN public.projects  p ON p.id = upa.project_id
   WHERE u.company_id IS DISTINCT FROM p.company_id;
  SELECT count(*) INTO v_sin_filas
    FROM public.app_users u
   WHERE u.role = 'admin'
     AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id);

  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % filas, huella %', v_n, v_huella;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % filas HUÉRFANAS (user_id sin app_users): no se tocan', v_huerfanas;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % filas con empresa de la persona distinta de la del proyecto: no se tocan', v_cruces;
  RAISE NOTICE 'asignaciones_proyecto (pre-vuelo): % administradores sin filas (exentos de proyecto)', v_sin_filas;
END
$pre$;

-- ── 1. Regla única: quién puede administrar una asignación ──────────────────
CREATE OR REPLACE FUNCTION public.asignacion_puede_administrar(p_user_id uuid, p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    public.is_super_admin()
    OR (
      public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
      -- un administrador nunca toca sus propias asignaciones; el propietario sí (es exento)
      AND (public.current_user_role() = 'company_owner' OR p_user_id IS DISTINCT FROM (SELECT auth.uid()))
      -- la persona es de SU empresa (una huérfana o sin empresa no lo es)
      AND EXISTS (
        SELECT 1 FROM public.app_users u
         WHERE u.id = p_user_id AND u.company_id = public.get_my_company_id()
      )
      -- el proyecto es de SU empresa …
      AND EXISTS (
        SELECT 1 FROM public.projects pr
         WHERE pr.id = p_project_id AND pr.company_id = public.get_my_company_id()
      )
      -- … y es uno de los que él ve (como la RLS de projects acotaba la política anterior)
      AND (public.user_is_project_exempt() OR public.user_has_project_access(p_project_id))
    ),
    false
  )
$$;

COMMENT ON FUNCTION public.asignacion_puede_administrar(uuid, uuid) IS
  'Regla de las políticas de escritura de user_project_assignments: superadministrador cualquiera; propietario de su empresa (también a sí mismo); administrador de su empresa a OTRAS personas y sólo en proyectos que él ve; nadie más. La persona y el proyecto deben ser de la empresa de quien administra.';

REVOKE ALL ON FUNCTION public.asignacion_puede_administrar(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asignacion_puede_administrar(uuid, uuid) TO authenticated, service_role;

-- ── 2. Políticas de escritura (mismos nombres; la SELECT no se toca) ─────────
DROP POLICY IF EXISTS "user_project_assignments_insert" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_insert" ON public.user_project_assignments
  FOR INSERT TO authenticated
  WITH CHECK (public.asignacion_puede_administrar(user_id, project_id));

DROP POLICY IF EXISTS "user_project_assignments_update" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_update" ON public.user_project_assignments
  FOR UPDATE TO authenticated
  USING (public.asignacion_puede_administrar(user_id, project_id))
  WITH CHECK (public.asignacion_puede_administrar(user_id, project_id));

DROP POLICY IF EXISTS "user_project_assignments_delete" ON public.user_project_assignments;
CREATE POLICY "user_project_assignments_delete" ON public.user_project_assignments
  FOR DELETE TO authenticated
  USING (public.asignacion_puede_administrar(user_id, project_id));

-- ── 3. Trigger de integridad: la persona y el proyecto son de la MISMA empresa ──
CREATE OR REPLACE FUNCTION public.asignacion_validar_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp_persona  uuid;
  v_emp_proyecto uuid;
  v_hay_persona  boolean;
  v_hay_proyecto boolean;
BEGIN
  SELECT true, u.company_id INTO v_hay_persona, v_emp_persona
    FROM public.app_users u WHERE u.id = NEW.user_id;
  SELECT true, p.company_id INTO v_hay_proyecto, v_emp_proyecto
    FROM public.projects p WHERE p.id = NEW.project_id;

  IF v_hay_persona IS NOT TRUE OR v_emp_persona IS NULL
     OR v_hay_proyecto IS NOT TRUE OR v_emp_proyecto IS NULL
     OR v_emp_persona <> v_emp_proyecto THEN
    RAISE EXCEPTION 'ASIGNACION_EMPRESA_DISTINTA: la persona y el proyecto deben pertenecer a la misma empresa'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- ── 4. Trigger de autoasignación (defensa en profundidad) ───────────────────
CREATE OR REPLACE FUNCTION public.asignacion_bloquear_propia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := (SELECT auth.uid());
  v_toca  boolean;
BEGIN
  -- service_role, superusuario y migraciones: sin sesión de la API
  IF v_uid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_toca := (TG_OP IN ('UPDATE', 'DELETE') AND OLD.user_id = v_uid)
         OR (TG_OP IN ('INSERT', 'UPDATE') AND NEW.user_id = v_uid);

  IF v_toca AND NOT (public.is_super_admin() OR public.current_user_role() = 'company_owner') THEN
    RAISE EXCEPTION 'ASIGNACION_PROPIA_NO_PERMITIDA: nadie cambia sus propias asignaciones de proyecto; lo hace otro administrador, el propietario o el superadministrador'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

-- Funciones de trigger: nadie las invoca directamente.
REVOKE ALL ON FUNCTION public.asignacion_validar_empresa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asignacion_bloquear_propia() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_asignacion_empresa ON public.user_project_assignments;
CREATE TRIGGER trg_asignacion_empresa
  BEFORE INSERT OR UPDATE OF user_id, project_id ON public.user_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.asignacion_validar_empresa();

DROP TRIGGER IF EXISTS trg_asignacion_propia ON public.user_project_assignments;
CREATE TRIGGER trg_asignacion_propia
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_project_assignments
  FOR EACH ROW EXECUTE FUNCTION public.asignacion_bloquear_propia();

-- ── 5. Privilegios mínimos ──────────────────────────────────────────────────
REVOKE ALL ON TABLE public.user_project_assignments FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.user_project_assignments FROM authenticated;

-- ── Post-vuelo: las filas son IDÉNTICAS y todo lo esperado existe ────────────
DO $post$
DECLARE
  v_n         bigint;
  v_huella    text;
  v_cat       text;
  v_def       text;
BEGIN
  SELECT count(*),
         md5(COALESCE(string_agg(upa.id::text || '|' || upa.user_id::text || '|' || upa.project_id::text || '|' || upa.permission_type,
                                 E'\n' ORDER BY upa.id), ''))
    INTO v_n, v_huella
    FROM public.user_project_assignments upa;
  IF v_n::text IS DISTINCT FROM current_setting('app.asg_pre_n', true)
     OR v_huella IS DISTINCT FROM current_setting('app.asg_pre_huella', true) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): las filas de user_project_assignments CAMBIARON (antes % / %, ahora % / %)',
      current_setting('app.asg_pre_n', true), current_setting('app.asg_pre_huella', true), v_n, v_huella;
  END IF;

  -- cuatro políticas con los nombres de siempre; las de escritura usan la función; la SELECT conserva la rama propia
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.user_project_assignments'::regclass) <> 4 THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): user_project_assignments debe tener exactamente 4 políticas';
  END IF;
  FOREACH v_cat IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
    SELECT COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO v_def
      FROM pg_policy p
     WHERE p.polrelid = 'public.user_project_assignments'::regclass AND p.polname = 'user_project_assignments_' || v_cat;
    IF v_def IS NULL OR v_def !~ 'asignacion_puede_administrar' OR v_def ~ 'auth\.uid' THEN
      RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): la política % no usa la regla única o conserva la rama propia', v_cat;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = 'public.user_project_assignments'::regclass AND p.polname = 'user_project_assignments_select'
       AND pg_get_expr(p.polqual, p.polrelid) ~ 'auth\.uid'
  ) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): la política SELECT no existe o perdió la lectura de las propias';
  END IF;

  -- triggers y funciones
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgrelid = 'public.user_project_assignments'::regclass AND NOT t.tgisinternal
         AND t.tgname IN ('trg_asignacion_empresa', 'trg_asignacion_propia') AND t.tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): faltan los triggers trg_asignacion_empresa / trg_asignacion_propia';
  END IF;
  IF to_regprocedure('public.asignacion_puede_administrar(uuid,uuid)') IS NULL
     OR to_regprocedure('public.asignacion_validar_empresa()') IS NULL
     OR to_regprocedure('public.asignacion_bloquear_propia()') IS NULL THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): faltan funciones';
  END IF;
  IF has_function_privilege('anon', 'public.asignacion_puede_administrar(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.asignacion_puede_administrar(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): EXECUTE de asignacion_puede_administrar mal repartido';
  END IF;

  -- privilegios
  IF has_table_privilege('anon', 'public.user_project_assignments', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', 'public.user_project_assignments', 'TRUNCATE, REFERENCES, TRIGGER')
     OR NOT (has_table_privilege('authenticated', 'public.user_project_assignments', 'SELECT')
             AND has_table_privilege('authenticated', 'public.user_project_assignments', 'INSERT')
             AND has_table_privilege('authenticated', 'public.user_project_assignments', 'UPDATE')
             AND has_table_privilege('authenticated', 'public.user_project_assignments', 'DELETE')) THEN
    RAISE EXCEPTION 'seguridad_asignaciones_proyecto (post-vuelo): privilegios de la tabla mal repartidos';
  END IF;

  RAISE NOTICE 'asignaciones_proyecto (post-vuelo): % filas, huella % — idénticas a las de antes; 4 políticas, 2 triggers, 3 funciones, privilegios mínimos', v_n, v_huella;
END
$post$;

COMMIT;
