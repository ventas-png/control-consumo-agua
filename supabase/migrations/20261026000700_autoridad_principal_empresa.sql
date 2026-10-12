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
-- QUÉ CAMBIA (13 políticas y 1 trigger; los mismos nombres, comandos y roles de base de datos; ALTER POLICY sólo cambia las expresiones)
--   1. projects_insert, projects_delete: public.is_super_admin() OR (company_id = public.get_my_company_id() AND
--      public.is_company_owner()). projects_update NO cambia: los administradores siguen configurando fiscal y cobros.
--   2. roles_insert / roles_update / roles_delete, role_permissions_insert / role_permissions_delete,
--      user_roles_insert / user_roles_delete: se CONSERVAN EXACTAMENTE los demás predicados de producción (rol no
--      de sistema, empresa del rol, persona de la empresa, assigned_by) y
--      `current_user_role() = ANY (ARRAY['company_owner','admin'])` pasa a public.is_company_owner(); is_super_admin() se mantiene.
--   3. user_invitations_insert, _select, _update (USING y WITH CHECK) y _delete: se añade, además de lo que ya había,
--      (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin()). Invitar operador, visor o cobros sigue permitido a los administradores, que ven
--      y gestionan esas invitaciones; la invitación 'admin' es del principal de punta a punta: un administrador NO la crea, NO la rebaja ni la modifica, NO la
--      borra y NO lee su fila (ni el token, ni el correo). El token de una invitación es una credencial (accept-invitation crea la cuenta con quien lo presente): sin
--      la guarda en la lectura un administrador leía el token de la invitación 'admin' que el propietario emitió para otra persona y la completaba él con una
--      contraseña que elige. Lo que sí sigue viendo (no se puede cerrar por RLS, y invite-user ya lo dice con su 409): que hay una invitación pendiente para un correo
--      que ÉL elige, porque el índice único parcial de correos pendientes rechaza la suya (23505); no ve el token ni descubre correos que no conozca.
--   4. Integridad de app_users.project_id (trigger trg_validar_proyecto_app_users, AFTER INSERT OR UPDATE OF project_id, company_id): el proyecto de una persona
--      debe existir y ser de SU empresa, para cualquier actor, también service_role y el superusuario (NEW.project_id NULL pasa). Es la columna hermana de
--      user_project_assignments: user_has_project_access() y has_admin_project_access() leen app_users.project_id SIN comprobar la empresa del proyecto, y el
--      propietario podía fijarle a una persona de su empresa el proyecto de OTRA (preexistente; producción hoy: 0 filas con project_id). Sólo valida lo que se
--      escribe: no mira ni toca las filas existentes (el pre-vuelo cuenta, y sólo informa, las que ya crucen empresa). NO cubre app_users.cliente_id: decisión
--      abierta D-20 del documento.
--   Los demás SELECT de esas tablas (projects, roles, role_permissions, user_roles) y app_users_* (que ya eran sólo del propietario) NO cambian.
--   Los administradores conservan, por perfil, todas las llaves (user_has_permission() los deja pasar): eso NO cambia aquí.
--
-- QUÉ NO CAMBIA
--   · NINGUNA fila: app_users, roles, role_permissions, user_roles, user_invitations y projects se miden (conteo y md5 de la fila completa) antes y después y
--     la migración aborta si difieren. Ningún privilegio y ninguna otra función o trigger.
--
-- QUÉ SUPONE DEL ENTORNO (y lo comprueba el pre-vuelo, con un mensaje claro)
--   · existen is_super_admin(), is_company_owner(), current_user_role(), get_my_company_id() y las seis tablas con sus políticas;
--   · la 20261026000600 ESTÁ APLICADA Y ES LA VIGENTE (REQUISITO/DERIVA), comprobado de forma EXACTA y no por palabras: el cuerpo de
--     public.asignacion_puede_administrar tiene el md5 del de la 0600 vigente y las políticas de user_project_assignments que no son de lectura son EXACTAMENTE sus tres
--     (nombre, comando, permisiva y expresiones, normalizadas como las 18 de abajo). Una base que ya registró una versión ANTERIOR de la 0600 (la rama de Preview del
--     #928 en 8d34392b: Supabase no reaplica un archivo cuya versión ya está registrada) NO la tiene, y sin esta comprobación la 0700 pasaba en silencio dejando que
--     un administrador siguiera escribiendo asignaciones;
--   · cada una de las 18 políticas de las cinco tablas con políticas tiene el texto de producción (o ya el nuevo, si se corre dos veces): si hubiera deriva,
--     aborta en vez de sobrescribir un predicado que no es el que se leyó;
--   · quien corre la migración es el propietario de las seis tablas (o miembro de su rol);
--   · NADA del search_path de la sesión (los nombres van calificados public.*; el texto de pg_get_expr cambia con el search_path y el pre/post-vuelo
--     lo normaliza quitando «public.» y «auth.») NI la ACL de las tablas o las funciones (no se consulta ningún privilegio): lección del P0 de la 0600.
--
-- DESPLIEGUE: va en el MISMO push que 20261026000600 (2 archivos, bajo el tope MAX_APPLY = 10) y ANTES de la serie 20261027… (PR #926). Las cinco tablas con
-- políticas se bloquean (ACCESS EXCLUSIVE) y app_users (SHARE ROW EXCLUSIVE: se sigue pudiendo leer, no escribir), con lock_timeout de 5 s y siempre en el mismo
-- orden, unos milisegundos: si hay una transacción larga sobre alguna, falla limpia, sin dejar nada, y se reintenta. roles, user_roles y projects se leen en cada
-- inicio de sesión: elegir un horario tranquilo.
-- Hasta que esta migración llegue a producción un administrador SIGUE pudiendo escribir RBAC, crear proyectos e invitar administradores por la API. Y, desplegada
-- esta migración antes que las funciones create-user / invite-user (deploy-functions va después), las funciones viejas —service_role, sin RLS— siguen dejando
-- crear o invitar administradores hasta que se desplieguen: ver la ventana en docs/SEGURIDAD_ASIGNACIONES_PROYECTO.md (consulta posterior al despliegue).
-- Tras el despliegue hay que RECAPTURAR scripts/schema-drift/huella-produccion.json (cambian 13 políticas y hay un trigger y una función nuevos).
-- Verificación posterior: scripts/diagnostico-asignaciones-proyecto.sql.
--
-- CÓMO REVERTIR: scripts/reversion-principal-empresa.sql (devuelve las 13 políticas a su texto exacto de producción y quita el trigger y su función; idempotente).
-- La reversión reabre los huecos de arriba.
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── Pre-vuelo ────────────────────────────────────────────────────────────────
-- Exige lo que la migración da por existente (también que la 0600 sea la REGLA DEL PRINCIPAL), BLOQUEA las tablas ANTES de medir, mide (conteo y huella de la fila
-- completa; set_config local a la transacción), comprueba que las 18 políticas tienen el texto esperado (producción o ya el nuevo) e INFORMA —sin fallar— de a quién
-- afecta y de las filas de app_users cuyo project_id ya cruce empresa.
-- v_esp: por política, el texto normalizado (sin «public.» ni «auth.», espacios colapsados) del USING y del WITH CHECK: «o» = producción, «n» = el nuevo.
DO $pre$
DECLARE
  v_faltan  text[] := ARRAY[]::text[];
  v_deriva  text[] := ARRAY[]::text[];
  v_tablas  constant text[] := ARRAY['app_users', 'projects', 'role_permissions', 'roles', 'user_invitations', 'user_roles'];
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
  {"t":"user_invitations","p":"user_invitations_delete","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""],"n":["((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))",""]},
  {"t":"user_invitations","p":"user_invitations_insert","o":["","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["","((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))"]},
  {"t":"user_invitations","p":"user_invitations_select","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))",""],"n":["((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))",""]},
  {"t":"user_invitations","p":"user_invitations_update","o":["(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))","(is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))"],"n":["((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))","((is_super_admin() OR ((company_id = get_my_company_id()) AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text])))) AND ((role <> 'admin'::text) OR is_company_owner() OR is_super_admin()))"]},
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
  v_regla   text;
  v_pol_asg text;
  -- las políticas de user_project_assignments que no son de lectura, tal como las deja la 0600 vigente (nombre:comando:permisiva:USING|WITH CHECK, normalizadas)
  v_pol_asg_esp constant text := 'user_project_assignments_delete:d:true:asignacion_puede_administrar(user_id, project_id)|, '
                              || 'user_project_assignments_insert:a:true:|asignacion_puede_administrar(user_id, project_id), '
                              || 'user_project_assignments_update:w:true:asignacion_puede_administrar(user_id, project_id)|asignacion_puede_administrar(user_id, project_id)';
  v_con_proy  bigint;
  v_cruzan    bigint;
BEGIN
  IF to_regprocedure('public.is_super_admin()')    IS NULL THEN v_faltan := array_append(v_faltan, 'is_super_admin()'); END IF;
  IF to_regprocedure('public.is_company_owner()')  IS NULL THEN v_faltan := array_append(v_faltan, 'is_company_owner()'); END IF;
  IF to_regprocedure('public.current_user_role()') IS NULL THEN v_faltan := array_append(v_faltan, 'current_user_role()'); END IF;
  IF to_regprocedure('public.get_my_company_id()') IS NULL THEN v_faltan := array_append(v_faltan, 'get_my_company_id()'); END IF;
  IF to_regprocedure('auth.uid()')                 IS NULL THEN v_faltan := array_append(v_faltan, 'auth.uid()'); END IF;
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

  -- REQUISITO (H-04): la regla de las asignaciones de proyecto es la del PRINCIPAL. Una base que ya registró una versión ANTERIOR de la 0600 (Supabase Preview del #928 en
  -- 8d34392b: la versión está registrada y el archivo nuevo NO se reaplica) tiene una regla que admite al administrador (user_is_project_exempt() / 'admin'); la 0700 pasaba
  -- limpia sobre ella y el administrador seguía escribiendo asignaciones sin ningún aviso.
  -- Comprobación EXACTA, no por palabras (SQL-02 de la octava verificación: una regla con una rama de administrador que no nombrara 'admin' ni user_is_project_exempt(),
  -- una política «… OR true» o una FOR ALL añadida pasaban la heurística anterior): (1) el cuerpo de la regla es el de la 0600 vigente —prosrc se guarda tal cual
  -- (medido: el mismo md5 en PostgreSQL 16 y en la rama de Preview, 17.11)— y (2) las políticas de user_project_assignments que no son de lectura (FOR ALL incluida)
  -- son EXACTAMENTE las tres de la 0600, normalizadas como las 18 de abajo (sin «public.»/«auth.», espacios colapsados). Si la 0600 cambia, este md5 cambia con ella.
  v_regla := (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.asignacion_puede_administrar(uuid,uuid)'));
  IF v_regla IS NULL THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): REQUISITO: falta public.asignacion_puede_administrar(uuid, uuid): la 20261026000600 debe estar aplicada ANTES (van en el mismo push y la 0700 la complementa)';
  END IF;
  IF md5(v_regla) <> 'dca52dfdabe4de1253591cb9735a1b41' THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): DERIVA: public.asignacion_puede_administrar no codifica la regla del principal: su cuerpo (md5 %) no es el de la 20261026000600 vigente (dca52dfdabe4de1253591cb9735a1b41); es una versión anterior que ya quedó registrada o se cambió a mano. Recrea la base (rama de Preview) o aplica a mano el CREATE OR REPLACE FUNCTION de la 20261026000600 vigente antes de esta migración',
      md5(v_regla);
  END IF;
  SELECT string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':'
                    || regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polqual, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g') || '|'
                    || regexp_replace(regexp_replace(COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), ''), v_re, '', 'g'), '\s+', ' ', 'g'),
                    ', ' ORDER BY p.polname)
    INTO v_pol_asg
    FROM pg_policy p
   WHERE p.polrelid = to_regclass('public.user_project_assignments')
     AND p.polcmd <> 'r';
  IF v_pol_asg IS DISTINCT FROM v_pol_asg_esp THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (pre-vuelo): DERIVA: las políticas de escritura de user_project_assignments (insert, update, delete) deben usar asignacion_puede_administrar exactamente como la 20261026000600 vigente, y no puede haber otras de escritura; hay: %',
      COALESCE(v_pol_asg, '(ninguna)');
  END IF;

  -- BLOQUEO ANTES DE MEDIR (como la 0600): con las tablas ya bloqueadas ninguna escritura legítima puede confirmarse entre la medición y el post-vuelo.
  -- Siempre en el mismo orden (alfabético) para no interbloquearse con otra sesión que bloquee las mismas. app_users sólo recibe un CREATE TRIGGER: SHARE ROW EXCLUSIVE
  -- (se sigue LEYENDO —la RLS de todo el sistema la consulta—, no se escribe) y primero; las otras cinco, ACCESS EXCLUSIVE, porque se les altera una política.
  LOCK TABLE public.app_users IN SHARE ROW EXCLUSIVE MODE;
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
  -- app_users.project_id: personas que ya tienen proyecto y, de ellas, las que NO son de su empresa (proyecto de otra empresa, inexistente, o persona sin empresa). Sólo se
  -- informa: el trigger nuevo valida lo que se ESCRIBE a partir de ahora y no toca las filas existentes.
  SELECT count(*) FILTER (WHERE u.project_id IS NOT NULL),
         count(*) FILTER (WHERE u.project_id IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = u.project_id AND p.company_id IS NOT NULL AND p.company_id IS NOT DISTINCT FROM u.company_id))
    INTO v_con_proy, v_cruzan
    FROM public.app_users u;

  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): políticas: % con el texto de producción y % ya con el nuevo (de 18; 13 se cambian)', v_orig, v_nueva;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % administradores dejan de escribir proyectos, roles, llaves, asignaciones de roles e invitaciones «admin» por la API; % propietarios y % superadministradores son los principales', v_admins, v_propiet, v_super;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % empresas con administradores y SIN propietario: sólo el superadministrador escribiría sus roles y proyectos', v_adm_sin_prop;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % invitaciones con role admin ya existentes (no se tocan; desde ahora sólo el principal las lee, las modifica y las borra)', v_inv_admin;
  RAISE NOTICE 'autoridad_principal_empresa (pre-vuelo): % personas con app_users.project_id, % de ellas con un proyecto que NO es de su empresa (de otra, inexistente o sin empresa): no se tocan; el trigger nuevo sólo valida lo que se escribe', v_con_proy, v_cruzan;
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

-- ── 3. Invitaciones: el rol «admin» es del principal de punta a punta (crearla, leerla, modificarla, borrarla) ──────────
-- Lo que ya había (superadministrador, o propietario/administrador de la empresa de la invitación) Y (role <> 'admin' OR propietario OR superadministrador).
-- La LECTURA importa: el token es la credencial de accept-invitation. Sin la guarda en SELECT/UPDATE/DELETE un administrador leía el token de una invitación 'admin'
-- del propietario, la rebajaba a 'operator' (cambiándole token y correo), la borraba o la completaba él mismo.
ALTER POLICY "user_invitations_insert" ON public.user_invitations
  WITH CHECK (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  );
ALTER POLICY "user_invitations_select" ON public.user_invitations
  USING (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  );
ALTER POLICY "user_invitations_update" ON public.user_invitations
  USING (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  )
  WITH CHECK (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  );
ALTER POLICY "user_invitations_delete" ON public.user_invitations
  USING (
    (public.is_super_admin()
     OR (company_id = public.get_my_company_id() AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])))
    AND (role <> 'admin' OR public.is_company_owner() OR public.is_super_admin())
  );

-- ── 4. app_users.project_id: el proyecto de una persona es de SU empresa, para CUALQUIER actor ──────────────────────────────
-- La columna hermana de user_project_assignments (H-01 de la quinta verificación): user_has_project_access() y has_admin_project_access() leen app_users.project_id sin
-- comprobar la empresa del proyecto, y el propietario (app_users_update) podía fijarle a una persona de SU empresa el proyecto de OTRA y darle así acceso a las tablas
-- con alcance por proyecto de la otra empresa. Mismo patrón y mismo rigor que trg_asignacion_empresa de la 0600: SECURITY DEFINER con search_path vacío (la validación no
-- depende de qué proyectos ve quien escribe) y vale para service_role y el superusuario (no hay excepción por actor). NEW.project_id NULL pasa (la mayoría de las personas
-- no tiene proyecto «principal»; también es lo que escribe un SET NULL en cascada si algún día se añadiera la llave foránea). Si no, el proyecto debe EXISTIR y ser de la
-- empresa de la persona (NEW.company_id): un proyecto inexistente, de otra empresa o una persona sin empresa se rechazan. FOR SHARE: si otra transacción cambia la
-- empresa del proyecto o lo borra, esta escritura ESPERA y ve el estado nuevo (como en la 0600). Valida SÓLO lo que se escribe (INSERT o UPDATE OF project_id,
-- company_id); no mira ni toca las filas existentes, y una escritura que no toque esas columnas ni lo evalúa.
-- AFTER y no BEFORE (SQL-01 de la octava verificación): un trigger BEFORE se ejecuta ANTES del WITH CHECK de la RLS, y como lee projects sin RLS, a quien la RLS iba a
-- rechazar le contestaba 23514 si el par (empresa, proyecto) no casaba y 42501 si casaba: anon —que conserva INSERT sobre app_users— y cualquier sesión sabían, sin
-- permiso, si el proyecto Y es de la empresa X (conociendo los dos uuid). AFTER se dispara cuando la RLS ya aceptó la fila: a quien no puede escribir le responde la RLS
-- (42501) siempre igual, y para quien sí puede valida lo mismo, sobre la fila FINAL (después de todos los BEFORE, también de trg_lock_app_users_self_privilege, que
-- restituye las columnas de una autoedición). La función no modifica NEW. NO cubre app_users.cliente_id (decisión abierta D-20).
CREATE OR REPLACE FUNCTION public.app_users_validar_proyecto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_emp_proyecto uuid;
  v_hay_proyecto boolean;
BEGIN
  IF NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT true, p.company_id INTO v_hay_proyecto, v_emp_proyecto
    FROM public.projects p WHERE p.id = NEW.project_id FOR SHARE OF p;
  IF v_hay_proyecto IS NOT TRUE OR v_emp_proyecto IS NULL OR NEW.company_id IS NULL OR v_emp_proyecto <> NEW.company_id THEN
    RAISE EXCEPTION 'APP_USERS_PROYECTO_EMPRESA_DISTINTA: el proyecto de una persona debe existir y pertenecer a la misma empresa que ella'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Función de trigger: nadie la invoca directamente.
REVOKE ALL ON FUNCTION public.app_users_validar_proyecto() FROM PUBLIC, anon, authenticated;

-- CREATE OR REPLACE TRIGGER (PostgreSQL 14+) y no DROP + CREATE: DROP TRIGGER (también con IF EXISTS, en cuanto el trigger ya existe: una segunda pasada o un reintento) pide ACCESS EXCLUSIVE
-- sobre app_users, y esa tabla la consulta la RLS de todo el sistema; CREATE OR REPLACE TRIGGER sólo pide SHARE ROW EXCLUSIVE (la tabla se sigue leyendo) y es idempotente igual.
CREATE OR REPLACE TRIGGER trg_validar_proyecto_app_users
  AFTER INSERT OR UPDATE OF project_id, company_id ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.app_users_validar_proyecto();

-- ── Post-vuelo: las filas son IDÉNTICAS, las 18 políticas quedaron como se esperaba y el trigger de app_users existe ──
DO $post$
DECLARE
  v_tablas  constant text[] := ARRAY['app_users', 'projects', 'role_permissions', 'roles', 'user_invitations', 'user_roles'];
  v_t       text;
  v_n       bigint;
  v_h       text;
  v_re      constant text := E'\\m(public|auth)\\.';
  v_esp     constant jsonb := current_setting('app.principal_esp', true)::jsonb;
  v_attr    text;
  v_def     text;
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

  -- el trigger de integridad de app_users.project_id: existe, habilitado, AFTER por fila para INSERT y UPDATE OF project_id, company_id; su función es SECURITY DEFINER con
  -- search_path vacío y nadie (anon, authenticated) la invoca directamente
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.app_users'::regclass AND t.tgname = 'trg_validar_proyecto_app_users' AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v_def IS NULL OR v_def !~ 'AFTER INSERT OR UPDATE OF project_id, company_id ON' OR v_def !~ 'FOR EACH ROW' OR v_def !~ 'app_users_validar_proyecto' THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (post-vuelo): falta el trigger trg_validar_proyecto_app_users de app_users (o no es AFTER INSERT OR UPDATE OF project_id, company_id): %', COALESCE(v_def, 'no existe');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.app_users_validar_proyecto()') AND p.prosecdef AND COALESCE(array_to_string(p.proconfig, ','), '') = 'search_path=""') THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (post-vuelo): public.app_users_validar_proyecto debe ser SECURITY DEFINER con search_path vacío';
  END IF;
  IF has_function_privilege('anon', 'public.app_users_validar_proyecto()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.app_users_validar_proyecto()', 'EXECUTE') THEN
    RAISE EXCEPTION 'autoridad_principal_empresa (post-vuelo): EXECUTE de la función de trigger app_users_validar_proyecto mal repartido';
  END IF;

  RAISE NOTICE 'autoridad_principal_empresa (post-vuelo): filas de las 6 tablas idénticas; 18 políticas con el texto esperado (13 cambiadas, 5 intactas); nombres, comandos y roles sin cambio; trigger trg_validar_proyecto_app_users presente';
END
$post$;

COMMIT;
