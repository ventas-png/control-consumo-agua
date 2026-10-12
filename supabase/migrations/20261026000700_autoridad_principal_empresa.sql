-- ════════════════════════════════════════════════════════════════════════════
-- SEGURIDAD · LA AUTORIDAD SOBRE PROYECTOS, PERMISOS Y ADMINISTRADORES ES DEL PRINCIPAL DE LA EMPRESA
-- Complementa 20261026000600 (asignaciones de proyecto). Sólo el PRINCIPAL —el propietario de SU
-- empresa (company_owner) o el superadministrador— crea y borra proyectos, escribe roles, llaves y
-- asignaciones de roles de la empresa, y crea o invita administradores.
--
-- DECISIÓN DEL DUEÑO DEL NEGOCIO (2026-10-11)
--   · «Debería de quedar para que el principal de la empresa asigne permisos.» (llaves de compras)
--   · «Debería ser en función del que tiene los permisos de la empresa y todos los proyectos.» (D-2 / D-9)
--   PRINCIPAL = app_users.role 'company_owner' (sólo dentro de su propia company_id) o 'super_admin' / 'superadmin'
--   (cualquier empresa): public.is_super_admin() OR public.is_company_owner(). Un administrador —acotado, o sin
--   filas (exento por omisión)— NO es principal, y tampoco quien sólo tenga un rol RBAC de «administrador»: se
--   mide app_users.role y nada más. No se crea ninguna función; se usan las que ya existen.
--
-- QUÉ FALLABA (medido en una copia con el texto de pg_policy de producción, leído por SELECT el 2026-10-11)
--   Un administrador, por la API, y aunque la pantalla nunca se lo ofrezca (la ruta /empresa sólo la abre
--   company_owner):
--     · creaba y borraba proyectos (projects_insert / projects_delete admitían company_owner Y admin); borrar un
--       proyecto vacía en cascada las filas de otras personas (F2-03) y, con dos sesiones REPEATABLE READ, las
--       propias (D-16);
--     · creaba roles de empresa, concedía llaves en role_permissions y asignaba roles a un tercero o a sí mismo
--       (roles_*, role_permissions_*, user_roles_* admitían company_owner Y admin): podía repartir las llaves
--       nuevas de compras sin que el principal las asignara;
--     · se fabricaba otros administradores —que nacen sin filas, es decir exentos— insertando una invitación con
--       role 'admin' directamente en user_invitations (la lista blanca de las funciones de borde no es un control:
--       accept-invitation crea app_users con invitation.role sin saber quién invitó).
--
-- QUÉ CAMBIA (11 políticas; los mismos nombres, comandos y roles de base de datos; ALTER POLICY sólo cambia las expresiones)
--   1. projects_insert, projects_delete: public.is_super_admin() OR (company_id = public.get_my_company_id() AND
--      public.is_company_owner()). projects_update NO cambia: los administradores siguen configurando fiscal y cobros.
--   2. roles_insert / roles_update / roles_delete, role_permissions_insert / role_permissions_delete,
--      user_roles_insert / user_roles_delete: se CONSERVAN EXACTAMENTE los demás predicados de producción (rol no
--      de sistema, empresa del rol, persona de la empresa, assigned_by) y
--      `current_user_role() = ANY (ARRAY['company_owner','admin'])` pasa a public.is_company_owner(); is_super_admin() se mantiene.
--   3. user_invitations_insert y user_invitations_update (WITH CHECK): se añade, además de lo que ya había,
--      (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin()). Invitar operador, visor o cobros
--      sigue permitido a los administradores.
--   Los SELECT de todas esas tablas, user_invitations_delete y app_users_* (que ya eran sólo del propietario) NO cambian.
--   Los administradores conservan, por perfil, todas las llaves (user_has_permission() los deja pasar): eso NO cambia aquí.
--
-- QUÉ NO CAMBIA
--   · NINGUNA fila: roles, role_permissions, user_roles, user_invitations y projects se miden (conteo y md5 de la fila completa) antes y después y
--     la migración aborta si difieren. Ningún privilegio, ninguna función, ningún trigger.
--
-- QUÉ SUPONE DEL ENTORNO (y lo comprueba el pre-vuelo, con un mensaje claro)
--   · existen is_super_admin(), is_company_owner(), current_user_role(), get_my_company_id() y las cinco tablas con sus políticas;
--   · cada una de las 18 políticas de esas cinco tablas tiene el texto de producción (o ya el nuevo, si se corre dos veces): si hubiera deriva,
--     aborta en vez de sobrescribir un predicado que no es el que se leyó;
--   · quien corre la migración es el propietario de las cinco tablas (o miembro de su rol);
--   · NADA del search_path de la sesión (los nombres van calificados public.*; el texto de pg_get_expr cambia con el search_path y el pre/post-vuelo
--     lo normaliza quitando «public.» y «auth.») NI la ACL de las tablas o las funciones (no se consulta ningún privilegio): lección del P0 de la 0600.
--
-- DESPLIEGUE: va en el MISMO push que 20261026000600 (2 archivos, bajo el tope MAX_APPLY = 10) y ANTES de la serie 20261027… (PR #926). Las cinco
-- tablas se bloquean (ACCESS EXCLUSIVE, lock_timeout de 5 s, siempre en el mismo orden) unos milisegundos: si hay una transacción larga sobre alguna,
-- falla limpia, sin dejar nada, y se reintenta. roles, user_roles y projects se leen en cada inicio de sesión: elegir un horario tranquilo.
-- Hasta que esta migración llegue a producción un administrador SIGUE pudiendo escribir RBAC, crear proyectos e invitar administradores por la API.
-- Tras el despliegue hay que RECAPTURAR scripts/schema-drift/huella-produccion.json (cambian 11 políticas).
-- Verificación posterior: scripts/diagnostico-asignaciones-proyecto.sql.
--
-- CÓMO REVERTIR: scripts/reversion-principal-empresa.sql (devuelve las 11 políticas a su texto exacto de producción; idempotente). La reversión
-- reabre los huecos de arriba.
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── Pre-vuelo ────────────────────────────────────────────────────────────────
-- Exige lo que la migración da por existente, BLOQUEA las cinco tablas ANTES de medir, mide (conteo y huella de la fila completa; set_config local a la
-- transacción), comprueba que las 18 políticas tienen el texto esperado (producción o ya el nuevo) e INFORMA —sin fallar— de a quién afecta.
-- v_esp: por política, el texto normalizado (sin «public.» ni «auth.», espacios colapsados) del USING y del WITH CHECK: «o» = producción, «n» = el nuevo.
DO $pre$
DECLARE
  v_faltan  text[] := ARRAY[]::text[];
  v_deriva  text[] := ARRAY[]::text[];
  v_tablas  constant text[] := ARRAY['projects', 'role_permissions', 'roles', 'user_invitations', 'user_roles'];
  v_t       text;
  v_n       bigint;
  v_h       text;
  v_re      constant text := E'\\m(public|auth)\\.';
  v_esp     constant jsonb := $json$
[
  {"t":"projects","p":"projects_delete","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""],"n":["(is_super_admin() OR ((company_id = get_my_company_id()) AND is_company_owner()))",""]},
  {"t":"projects","p":"projects_insert","o":["","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["","(is_super_admin() OR ((company_id = get_my_company_id()) AND is_company_owner()))"]},
  {"t":"projects","p":"projects_select","o":["(is_super_admin() OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND (user_is_project_exempt() OR user_has_project_access(id))) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1 FROM company_clientes cc WHERE ((cc.company_id = projects.company_id) AND (cc.cliente_id = ( SELECT get_my_cliente_id() AS get_my_cliente_id)))))))",""],"n":["(is_super_admin() OR ((company_id = ( SELECT get_my_company_id() AS get_my_company_id)) AND (user_is_project_exempt() OR user_has_project_access(id))) OR ((current_user_role() = 'cliente'::text) AND (EXISTS ( SELECT 1 FROM company_clientes cc WHERE ((cc.company_id = projects.company_id) AND (cc.cliente_id = ( SELECT get_my_cliente_id() AS get_my_cliente_id)))))))",""]},
  {"t":"projects","p":"projects_update","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"]},
  {"t":"role_permissions","p":"role_permissions_delete","o":["(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR ((r.is_system = false) AND (r.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))))))",""],"n":["(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR ((r.is_system = false) AND (r.company_id = get_my_company_id()) AND is_company_owner())))))",""]},
  {"t":"role_permissions","p":"role_permissions_insert","o":["","(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR ((r.is_system = false) AND (r.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))))))"],"n":["","(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR ((r.is_system = false) AND (r.company_id = get_my_company_id()) AND is_company_owner())))))"]},
  {"t":"role_permissions","p":"role_permissions_select","o":["(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR (r.is_system = true) OR (r.company_id = get_my_company_id())))))",""],"n":["(EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = role_permissions.role_id) AND (is_super_admin() OR (r.is_system = true) OR (r.company_id = get_my_company_id())))))",""]},
  {"t":"roles","p":"roles_delete","o":["(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""],"n":["(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND is_company_owner()))",""]},
  {"t":"roles","p":"roles_insert","o":["","(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["","(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND is_company_owner()))"]},
  {"t":"roles","p":"roles_select","o":["(is_super_admin() OR (is_system = true) OR (company_id = get_my_company_id()))",""],"n":["(is_super_admin() OR (is_system = true) OR (company_id = get_my_company_id()))",""]},
  {"t":"roles","p":"roles_update","o":["(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND is_company_owner()))","(is_super_admin() OR ((is_system = false) AND (company_id = get_my_company_id()) AND is_company_owner()))"]},
  {"t":"user_invitations","p":"user_invitations_delete","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""],"n":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""]},
  {"t":"user_invitations","p":"user_invitations_insert","o":["","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["","((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))"]},
  {"t":"user_invitations","p":"user_invitations_select","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""],"n":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""]},
  {"t":"user_invitations","p":"user_invitations_update","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))"]},
  {"t":"user_roles","p":"user_roles_delete","o":["(is_super_admin() OR (EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))))",""],"n":["(is_super_admin() OR (EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND is_company_owner()))))",""]},
  {"t":"user_roles","p":"user_roles_insert","o":["","(is_super_admin() OR ((EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))) AND (EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = user_roles.role_id) AND ((r.is_system = true) OR (r.company_id = get_my_company_id()))))) AND ((assigned_by IS NULL) OR (assigned_by = ( SELECT uid() AS uid)))))"],"n":["","(is_super_admin() OR ((EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND is_company_owner()))) AND (EXISTS ( SELECT 1 FROM roles r WHERE ((r.id = user_roles.role_id) AND ((r.is_system = true) OR (r.company_id = get_my_company_id()))))) AND ((assigned_by IS NULL) OR (assigned_by = ( SELECT uid() AS uid)))))"]},
  {"t":"user_roles","p":"user_roles_select","o":["(is_super_admin() OR (user_id = ( SELECT uid() AS uid)) OR (EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))))",""],"n":["(is_super_admin() OR (user_id = ( SELECT uid() AS uid)) OR (EXISTS ( SELECT 1 FROM app_users u WHERE ((u.id = user_roles.user_id) AND (u.company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))))",""]}
]
$json$::jsonb;
  e         jsonb;
  v_u       text;
  v_c       text;
  v_hay     boolean;
  v_orig    int := 0;
  v_nueva   int := 0;
  v_admins  bigint;
  v_propiet bigint;
  v_super   bigint;
  v_adm_sin_prop bigint;
  v_inv_admin bigint;
BEGIN
  IF to_regprocedure('public.is_super_admin()')    IS NULL THEN v_faltan := array_append(v_faltan, 'is_super_admin()'); END IF;
  IF to_regprocedure('public.is_company_owner()')  IS NULL THEN v_faltan := array_append(v_faltan, 'is_company_owner()'); END IF;
  IF to_regprocedure('public.current_user_role()') IS NULL THEN v_faltan := array_append(v_faltan, 'current_user_role()'); END IF;
  IF to_regprocedure('public.get_my_company_id()') IS NULL THEN v_faltan := array_append(v_faltan, 'get_my_company_id()'); END IF;
  IF to_regprocedure('auth.uid()')                 IS NULL THEN v_faltan := array_append(v_faltan, 'auth.uid()'); END IF;
  IF to_regclass('public.app_users') IS NULL THEN v_faltan := array_append(v_faltan, 'tabla app_users'); END IF;
  FOREACH v_t IN ARRAY v_tablas LOOP
    IF to_regclass('public.' || v_t) IS NULL THEN v_faltan := array_append(v_faltan, 'tabla ' || v_t); END IF;
  END LOOP;
  IF array_length(v_faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): faltan % — la cadena de migraciones anterior está incompleta', array_to_string(v_faltan, ', ');
  END IF;
  -- quien corre la migración debe poder administrar las tablas (propietario o miembro de su rol); si no, ALTER POLICY fallaría
  FOREACH v_t IN ARRAY v_tablas LOOP
    IF NOT pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = ('public.' || v_t)::regclass), 'USAGE') THEN
      RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): % no es el propietario de % (% lo es) ni miembro de su rol; corre la migración con el rol propietario',
        current_user, v_t, (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = ('public.' || v_t)::regclass);
    END IF;
  END LOOP;

  -- BLOQUEO ANTES DE MEDIR (como la 0600): con las tablas ya bloqueadas ninguna escritura legítima puede confirmarse entre la medición y el post-vuelo.
  -- Siempre en el mismo orden (alfabético) para no interbloquearse con otra sesión que bloquee las mismas.
  LOCK TABLE public.projects, public.role_permissions, public.roles, public.user_invitations, public.user_roles IN ACCESS EXCLUSIVE MODE;

  FOREACH v_t IN ARRAY v_tablas LOOP
    EXECUTE format('SELECT count(*), md5(COALESCE(string_agg(x.t, E''\n'' ORDER BY x.t), '''')) FROM (SELECT r::text AS t FROM public.%I r) x', v_t) INTO v_n, v_h;
    PERFORM set_config('app.principal_pre_' || v_t, v_n::text || ':' || v_h, true);
  END LOOP;
  PERFORM set_config('app.principal_esp', v_esp::text, true);      -- el post-vuelo (otro bloque) compara contra lo mismo
  -- atributos de TODAS las políticas de las cinco tablas (nombre, comando, permisiva, roles): la migración sólo cambia expresiones
  PERFORM set_config('app.principal_pre_attr',
    (SELECT md5(COALESCE(string_agg(c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text, ',' ORDER BY c.relname, p.polname), ''))
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.oid = ANY (ARRAY['public.projects'::regclass, 'public.role_permissions'::regclass, 'public.roles'::regclass, 'public.user_invitations'::regclass, 'public.user_roles'::regclass])), true);

  -- deriva: cada política debe existir con el texto de producción o con el nuevo
  FOR e IN SELECT * FROM jsonb_array_elements(v_esp) LOOP
    SELECT true,
           regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g'),
           regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g')
      INTO v_hay, v_u, v_c
      FROM pg_policy p
     WHERE p.polrelid = to_regclass('public.' || (e->>'t')) AND p.polname = e->>'p';
    IF v_hay IS NOT TRUE THEN
      v_faltan := array_append(v_faltan, 'política ' || (e->>'t') || '.' || (e->>'p'));
    ELSIF v_u = e->'o'->>0 AND v_c = e->'o'->>1 THEN
      v_orig := v_orig + 1;
    ELSIF v_u = e->'n'->>0 AND v_c = e->'n'->>1 THEN
      v_nueva := v_nueva + 1;
    ELSE
      v_deriva := array_append(v_deriva, (e->>'t') || '.' || (e->>'p'));
    END IF;
    v_hay := NULL;
  END LOOP;
  IF array_length(v_faltan, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): faltan las políticas %', array_to_string(v_faltan, ', ');
  END IF;
  IF array_length(v_deriva, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): DERIVA: % no tiene el texto de producción ni el nuevo; revisa antes de sobrescribirla', array_to_string(v_deriva, ', ');
  END IF;

  SELECT count(*) FILTER (WHERE u.role = 'admin'), count(*) FILTER (WHERE u.role = 'company_owner'), count(*) FILTER (WHERE u.role IN ('super_admin', 'superadmin'))
    INTO v_admins, v_propiet, v_super
    FROM public.app_users u;
  SELECT count(DISTINCT a.company_id) INTO v_adm_sin_prop
    FROM public.app_users a
   WHERE a.role = 'admin' AND NOT EXISTS (SELECT 1 FROM public.app_users o WHERE o.company_id = a.company_id AND o.role = 'company_owner');
  SELECT count(*) INTO v_inv_admin FROM public.user_invitations i WHERE i.role = 'admin';

  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): políticas: % con el texto de producción y % ya con el nuevo (de 18; 11 se cambian)', v_orig, v_nueva;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % administradores dejan de escribir proyectos, roles, llaves, asignaciones de roles e invitaciones «admin» por la API; % propietarios y % superadministradores son los principales', v_admins, v_propiet, v_super;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % empresas con administradores y SIN propietario: sólo el superadministrador escribiría sus roles y proyectos', v_adm_sin_prop;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % invitaciones con role admin ya existentes (no se tocan)', v_inv_admin;
END
$pre$;

-- ── 1. Proyectos: sólo el principal los crea y los borra ─────────────────────
-- projects_update NO cambia (los administradores configuran fiscal y cobros). Los nombres van calificados public.* (el texto no depende del search_path).
ALTER POLICY "projects_insert" ON public.projects
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.is_company_owner()));
ALTER POLICY "projects_delete" ON public.projects
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.is_company_owner()));

-- ── 2. Roles, llaves y asignación de roles de la empresa: sólo el principal ──
-- Se conserva EXACTAMENTE el resto del predicado de producción; sólo `current_user_role() = ANY (company_owner, admin)` pasa a is_company_owner().
ALTER POLICY "roles_insert" ON public.roles
  WITH CHECK (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.is_company_owner()));
ALTER POLICY "roles_update" ON public.roles
  USING      (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.is_company_owner()))
  WITH CHECK (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.is_company_owner()));
ALTER POLICY "roles_delete" ON public.roles
  USING (public.is_super_admin() OR (is_system = false AND company_id = public.get_my_company_id() AND public.is_company_owner()));

ALTER POLICY "role_permissions_insert" ON public.role_permissions
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND (public.is_super_admin()
              OR (r.is_system = false AND r.company_id = public.get_my_company_id() AND public.is_company_owner()))
    )
  );
ALTER POLICY "role_permissions_delete" ON public.role_permissions
  USING (
    EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND (public.is_super_admin()
              OR (r.is_system = false AND r.company_id = public.get_my_company_id() AND public.is_company_owner()))
    )
  );

ALTER POLICY "user_roles_insert" ON public.user_roles
  WITH CHECK (
    public.is_super_admin()
    OR (
      -- la persona es de la empresa de quien asigna, y quien asigna es el propietario
      EXISTS (
        SELECT 1 FROM public.app_users u
         WHERE u.id = user_roles.user_id
           AND u.company_id = public.get_my_company_id()
           AND public.is_company_owner()
      )
      -- el rol es de sistema o de su empresa (impide conceder entre empresas)
      AND EXISTS (
        SELECT 1 FROM public.roles r
         WHERE r.id = user_roles.role_id
           AND (r.is_system = true OR r.company_id = public.get_my_company_id())
      )
      -- assigned_by es quien asigna (impide falsear la bitácora)
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
         AND public.is_company_owner()
    )
  );

-- ── 3. Invitaciones: el rol «admin» sólo lo invita el principal ──────────────
-- Lo que ya había (superadministrador, o propietario/administrador de la empresa de la invitación) Y (role <> 'admin' OR propietario OR superadministrador).
ALTER POLICY "user_invitations_insert" ON public.user_invitations
  WITH CHECK (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  );
ALTER POLICY "user_invitations_update" ON public.user_invitations
  WITH CHECK (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  );

-- ── Post-vuelo: las filas son IDÉNTICAS y las 18 políticas quedaron como se esperaba ──
DO $post$
DECLARE
  v_tablas  constant text[] := ARRAY['projects', 'role_permissions', 'roles', 'user_invitations', 'user_roles'];
  v_t       text;
  v_n       bigint;
  v_h       text;
  v_re      constant text := E'\\m(public|auth)\\.';
  v_esp     constant jsonb := current_setting('app.principal_esp', true)::jsonb;
  v_attr    text;
BEGIN
  FOREACH v_t IN ARRAY v_tablas LOOP
    EXECUTE format('SELECT count(*), md5(COALESCE(string_agg(x.t, E''\n'' ORDER BY x.t), '''')) FROM (SELECT r::text AS t FROM public.%I r) x', v_t) INTO v_n, v_h;
    IF (v_n::text || ':' || v_h) IS DISTINCT FROM current_setting('app.principal_pre_' || v_t, true) THEN
      RAISE EXCEPTION 'autoridad_principal_empresa (post-vuelo): las filas de % CAMBIARON (antes %, ahora %)', v_t, current_setting('app.principal_pre_' || v_t, true), v_n::text || ':' || v_h;
    END IF;
  END LOOP;

  SELECT md5(COALESCE(string_agg(c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text, ',' ORDER BY c.relname, p.polname), ''))
    INTO v_attr
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.oid = ANY (ARRAY['public.projects'::regclass, 'public.role_permissions'::regclass, 'public.roles'::regclass, 'public.user_invitations'::regclass, 'public.user_roles'::regclass]);
  IF v_attr IS DISTINCT FROM current_setting('app.principal_pre_attr', true) THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (post-vuelo): cambió el nombre, el comando, el tipo o los roles de alguna política (la migración sólo cambia expresiones)';
  END IF;

  IF (SELECT count(*) FROM jsonb_array_elements(v_esp) e
       JOIN pg_policy p ON p.polrelid = to_regclass('public.' || (e->>'t')) AND p.polname = e->>'p'
      WHERE regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') = e->'n'->>0
        AND regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') = e->'n'->>1) <> jsonb_array_length(v_esp) THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (post-vuelo): alguna política no quedó con el texto esperado (%)',
      (SELECT string_agg((e->>'t') || '.' || (e->>'p'), ', ')
         FROM jsonb_array_elements(v_esp) e
         LEFT JOIN pg_policy p ON p.polrelid = to_regclass('public.' || (e->>'t')) AND p.polname = e->>'p'
        WHERE p.polname IS NULL
           OR regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') <> e->'n'->>0
           OR regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') <> e->'n'->>1);
  END IF;

  RAISE NOTICE 'autoridad_principal_empresa (post-vuelo): filas de las 5 tablas idénticas; 18 políticas con el texto esperado (11 cambiadas, 7 intactas); nombres, comandos y roles sin cambio';
END
$post$;

COMMIT;
