-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de supabase/migrations/20261026000700_autoridad_principal_empresa.sql
--
-- Devuelve las 13 políticas que cambió esa migración a su texto EXACTO de PRODUCCIÓN (el de 20260417000013_consolidate_rls_policies_part2.sql,
-- 20260518000004_rbac_schema.sql, 20260518000016_perf_rls_initplan_wrap.sql y 20260604130000_user_invitations.sql, idéntico al leído en producción con
-- un SELECT sobre pg_policy el 2026-10-11 y el 2026-10-12: el md5 de pg_get_expr de las 18 políticas de las cinco tablas coincide):
--   projects_insert, projects_delete · roles_insert, roles_update, roles_delete · role_permissions_insert, role_permissions_delete ·
--   user_roles_insert, user_roles_delete · user_invitations_insert, user_invitations_select, user_invitations_update, user_invitations_delete.
-- y quita el trigger trg_validar_proyecto_app_users de app_users y su función public.app_users_validar_proyecto().
-- Sólo cambian EXPRESIONES (ALTER POLICY): nombres, comandos, tipo y roles de base de datos quedan como están. No toca ninguna fila (comprueba el conteo y la huella de la
-- fila completa de las seis tablas) ni ninguna otra política, función, trigger o privilegio. Los nombres van CALIFICADOS (public.…): con un search_path vacío «is_super_admin()» no
-- existe (V3-04); el árbol guardado es el mismo que el original. IDEMPOTENTE: se puede correr dos veces, y con cualquier search_path.
-- DROP TRIGGER pide ACCESS EXCLUSIVE sobre app_users (la tabla que consulta la RLS de todo el sistema) unos milisegundos: lock_timeout de 5 s, falla limpia si hay una transacción larga.
--
-- ⚠ QUIEN REVIERTE REABRE LOS HUECOS: un administrador vuelve a poder crear y borrar proyectos, escribir roles, llaves y asignaciones de roles de su empresa, invitar
-- administradores (user_invitations con role 'admin') por la API, y leer, rebajar o borrar las invitaciones 'admin' del propietario; el propietario vuelve a poder fijarle a una
-- persona de su empresa el project_id de otra. Sólo se usa si la migración causa un problema en producción; se cierran de nuevo volviendo a aplicarla
-- (que es idempotente). No revierte 20261026000600 (para eso, scripts/reversion-asignaciones-proyecto.sql): las dos se pueden revertir juntas o por separado.
--
-- Cómo correrla: en el Editor SQL de Supabase, o  psql "$CONEXION" -v ON_ERROR_STOP=1 -f scripts/reversion-principal-empresa.sql
-- Después hay que RECAPTURAR scripts/schema-drift/huella-produccion.json si ya se había recapturado tras el despliegue.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE
  v_tablas constant text[] := ARRAY['app_users', 'projects', 'role_permissions', 'roles', 'user_invitations', 'user_roles'];
  v_t      text;
  v_n      bigint;
  v_h      text;
  v_faltan text[] := ARRAY[]::text[];
  v_esp    constant jsonb := $json$
[
  {"t":"projects","p":"projects_delete","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""]},
  {"t":"projects","p":"projects_insert","o":["","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"]},
  {"t":"role_permissions","p":"role_permissions_delete","o":["(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR ((r.is_system = false) AND (r.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))))))",""]},
  {"t":"role_permissions","p":"role_permissions_insert","o":["","(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR ((r.is_system = false) AND (r.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))))))"]},
  {"t":"roles","p":"roles_delete","o":["(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""]},
  {"t":"roles","p":"roles_insert","o":["","(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"]},
  {"t":"roles","p":"roles_update","o":["(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"]},
  {"t":"user_invitations","p":"user_invitations_delete","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""]},
  {"t":"user_invitations","p":"user_invitations_insert","o":["","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"]},
  {"t":"user_invitations","p":"user_invitations_select","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""]},
  {"t":"user_invitations","p":"user_invitations_update","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"]},
  {"t":"user_roles","p":"user_roles_delete","o":["(is_super_admin() OR (EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))))",""]},
  {"t":"user_roles","p":"user_roles_insert","o":["","(is_super_admin() OR ((EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))) AND (EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = user_roles.role_id) AND ((r.is_system = true) OR (r.company_id = get_my_company_id()))))) AND ((assigned_by IS NULL) OR (assigned_by = ( SELECT uid() AS uid)))))"]}
]
$json$::jsonb;
  e        jsonb;
BEGIN
  IF to_regprocedure('public.is_super_admin()')    IS NULL THEN v_faltan := array_append(v_faltan, 'is_super_admin()'); END IF;
  IF to_regprocedure('public.current_user_role()') IS NULL THEN v_faltan := array_append(v_faltan, 'current_user_role()'); END IF;
  IF to_regprocedure('public.get_my_company_id()') IS NULL THEN v_faltan := array_append(v_faltan, 'get_my_company_id()'); END IF;
  FOREACH v_t IN ARRAY v_tablas LOOP
    IF to_regclass('public.' || v_t) IS NULL THEN v_faltan := array_append(v_faltan, 'tabla ' || v_t); END IF;
  END LOOP;
  FOR e IN SELECT * FROM jsonb_array_elements(v_esp) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public.' || (e->>'t')) AND p.polname = e->>'p') THEN
      v_faltan := array_append(v_faltan, 'política ' || (e->>'t') || '.' || (e->>'p'));
    END IF;
  END LOOP;
  IF array_length(v_faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'reversion_autoridad_principal_empresa: faltan % — no hay nada que revertir', array_to_string(v_faltan, ', ');
  END IF;
  -- bloqueo ANTES de medir (como la migración), siempre en el mismo orden (alfabético; app_users primero: DROP TRIGGER pide ACCESS EXCLUSIVE)
  LOCK TABLE public.app_users, public.projects, public.role_permissions, public.roles, public.user_invitations, public.user_roles IN ACCESS EXCLUSIVE MODE;
  FOREACH v_t IN ARRAY v_tablas LOOP
    EXECUTE format('SELECT count(*), md5(COALESCE(string_agg(x.t, E''\n'' ORDER BY x.t), '''')) FROM (SELECT r::text AS t FROM public.%I r) x', v_t) INTO v_n, v_h;
    PERFORM set_config('app.principal_rev_' || v_t, v_n::text || ':' || v_h, true);
  END LOOP;
  PERFORM set_config('app.principal_rev_esp', v_esp::text, true);
  PERFORM set_config('app.principal_rev_attr',
    (SELECT md5(COALESCE(string_agg(c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text, ',' ORDER BY c.relname, p.polname), ''))
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.oid = ANY (ARRAY['public.projects'::regclass, 'public.role_permissions'::regclass, 'public.roles'::regclass, 'public.user_invitations'::regclass, 'public.user_roles'::regclass])), true);
END
$pre$;

-- ── 1 · proyectos ────────────────────────────────────────────────────────────
ALTER POLICY "projects_insert" ON public.projects
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])));
ALTER POLICY "projects_delete" ON public.projects
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])));

-- ── 2 · roles, llaves y asignación de roles ─────────────────────────────────
ALTER POLICY "roles_insert" ON public.roles
  WITH CHECK (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])));
ALTER POLICY "roles_update" ON public.roles
  USING      (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
  WITH CHECK (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])));
ALTER POLICY "roles_delete" ON public.roles
  USING (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])));

ALTER POLICY "role_permissions_insert" ON public.role_permissions
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND (public.is_super_admin()
              OR (r.is_system = false AND r.company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    )
  );
ALTER POLICY "role_permissions_delete" ON public.role_permissions
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND (public.is_super_admin()
              OR (r.is_system = false AND r.company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    )
  );

ALTER POLICY "user_roles_insert" ON public.user_roles
  WITH CHECK (
    public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1 FROM public.app_users u
         WHERE u.id = user_roles.user_id
           AND u.company_id = public.get_my_company_id()
           AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
      )
      AND EXISTS (
        SELECT 1 FROM public.roles r
         WHERE r.id = user_roles.role_id
           AND (r.is_system = true OR r.company_id = public.get_my_company_id())
      )
      AND (assigned_by IS NULL OR assigned_by = (SELECT auth.uid()))
    )
  );
ALTER POLICY "user_roles_delete" ON public.user_roles
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
       WHERE u.id = user_roles.user_id
         AND u.company_id = public.get_my_company_id()
         AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
    )
  );

-- ── 3 · invitaciones ─────────────────────────────────────────────────────────
ALTER POLICY "user_invitations_insert" ON public.user_invitations
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  );
ALTER POLICY "user_invitations_select" ON public.user_invitations
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  );
ALTER POLICY "user_invitations_update" ON public.user_invitations
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  );
ALTER POLICY "user_invitations_delete" ON public.user_invitations
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  );

-- ── 4 · app_users.project_id: se quita el trigger de integridad y su función ─────────────────────────────────────────────────────
-- (las filas no se tocan; lo que se escribió con el trigger puesto queda como está)
DROP TRIGGER IF EXISTS trg_validar_proyecto_app_users ON public.app_users;
DROP FUNCTION IF EXISTS public.app_users_validar_proyecto();

-- ── Post-vuelo ──────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_tablas constant text[] := ARRAY['app_users', 'projects', 'role_permissions', 'roles', 'user_invitations', 'user_roles'];
  v_t      text;
  v_n      bigint;
  v_h      text;
  v_re     constant text := E'\\m(public|auth)\\.';
  v_esp    constant jsonb := current_setting('app.principal_rev_esp', true)::jsonb;
  v_attr   text;
BEGIN
  FOREACH v_t IN ARRAY v_tablas LOOP
    EXECUTE format('SELECT count(*), md5(COALESCE(string_agg(x.t, E''\n'' ORDER BY x.t), '''')) FROM (SELECT r::text AS t FROM public.%I r) x', v_t) INTO v_n, v_h;
    IF (v_n::text || ':' || v_h) IS DISTINCT FROM current_setting('app.principal_rev_' || v_t, true) THEN
      RAISE EXCEPTION 'reversion_autoridad_principal_empresa: las filas de % CAMBIARON (no debía tocarlas)', v_t;
    END IF;
  END LOOP;
  SELECT md5(COALESCE(string_agg(c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text, ',' ORDER BY c.relname, p.polname), ''))
    INTO v_attr
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.oid = ANY (ARRAY['public.projects'::regclass, 'public.role_permissions'::regclass, 'public.roles'::regclass, 'public.user_invitations'::regclass, 'public.user_roles'::regclass]);
  IF v_attr IS DISTINCT FROM current_setting('app.principal_rev_attr', true) THEN
    RAISE EXCEPTION 'reversion_autoridad_principal_empresa: cambió el nombre, el comando, el tipo o los roles de alguna política';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v_esp) e
       JOIN pg_policy p ON p.polrelid = to_regclass('public.' || (e->>'t')) AND p.polname = e->>'p'
      WHERE regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') = e->'o'->>0
        AND regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') = e->'o'->>1) <> jsonb_array_length(v_esp) THEN
    RAISE EXCEPTION 'reversion_autoridad_principal_empresa: las políticas no quedaron como las originales';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.app_users'::regclass AND t.tgname = 'trg_validar_proyecto_app_users' AND NOT t.tgisinternal)
     OR to_regprocedure('public.app_users_validar_proyecto()') IS NOT NULL THEN
    RAISE EXCEPTION 'reversion_autoridad_principal_empresa: el trigger trg_validar_proyecto_app_users o su función siguen en app_users';
  END IF;
  RAISE NOTICE 'reversion_autoridad_principal_empresa: hecha. 13 políticas con su texto de producción, trigger y función de app_users quitados, filas de las 6 tablas intactas.';
END
$post$;

COMMIT;
