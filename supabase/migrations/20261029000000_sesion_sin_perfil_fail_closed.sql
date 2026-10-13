-- ════════════════════════════════════════════════════════════════════════════
-- SEGURIDAD · UNA SESIÓN DE LA API SIN PERFIL YA NO PASA LAS GUARDAS POR NULL
--
-- QUÉ FALLABA (preexistente; igual en producción y en el repositorio)
-- Los helpers de autorización leen el perfil de app_users por auth.uid(). Para una
-- sesión `authenticated` SIN fila en app_users (alta a medias, perfil borrado con el
-- JWT aún vivo), para `anon` y para un perfil sin empresa (un `cliente`):
--   · current_user_role() y get_my_company_id() son NULL;
--   · is_super_admin(), is_company_owner(), can_access_project(),
--     user_is_project_exempt(), conta_puede_escribir()… devuelven NULL, no false;
--   · y `IF NOT (public.is_super_admin() OR x = public.get_my_company_id()) THEN
--     RAISE` evalúa `IF NOT (NULL)` = `IF NULL`, que NO lanza: la función sigue.
-- Medido en una base construida con toda la cadena de migraciones
-- (supabase/tests/fail_open_sin_perfil): de las 205 funciones SECURITY DEFINER
-- ejecutables por `authenticated`, una sesión sin perfil pasaba la guarda de 31
-- que a un operador de OTRA empresa le dicen «no autorizado». Entre ellas
-- export_company_data (exporta una empresa ajena), las cinco get_superadmin_*,
-- superadmin_comisiones_resumen / superadmin_timbres_resumen, get_company_usage,
-- get_company_effective_limits y calculate_monthly_total_cents (también para un
-- cliente), personal_usuarios_asignables / rutas_operadores_asignables (lista
-- personas de otra empresa), compras_validar_match / compras_seguimiento_orden
-- (también para un cliente) y ESCRITURAS: conta_publicar_asiento,
-- conta_anular_asiento, banco_conciliar / desconciliar / ajuste_conciliacion,
-- materializar_rutinas_turno, conta_revaluar_fx, conta_cierre_anual.
-- assert_company_scope(p) fallaba abierta igual (`p = NULL` es NULL).
--
-- Y el trigger del tope de plan (enforce_max_projects / enforce_max_units,
-- BEFORE INSERT, SECURITY DEFINER) corre ANTES del WITH CHECK de la RLS: anon, un
-- cliente o una sesión sin perfil que intentara insertar un proyecto en una
-- empresa ajena EN SU TOPE recibía `23514 plan_limit_reached: max_projects = N
-- (actual: M)` — el límite y el conteo de otra empresa — y 42501 si no estaba en
-- el tope: un oráculo.
--
-- LA REGLA
-- Una sesión de la API (rol `anon` o `authenticated`, o con auth.uid()) que no es
-- superadministradora y no tiene empresa NO está en el alcance de ninguna empresa.
-- Esa sesión recibe ahora, en cada guarda afectada, LA MISMA denegación que un
-- usuario de otra empresa (no una propia: no se distingue «sin perfil» de
-- «ajeno»).
--
-- POR QUÉ NO ES UN COALESCE(…, false) A SECAS
-- Las sesiones SIN persona —service_role (Edge Functions, webhooks) y el
-- propietario sin JWT (migraciones, SQL Editor, pg_cron)— también tienen
-- current_user_role() NULL, y hoy pasan esas mismas guardas por el mismo NULL. Con
-- un `false` a secas cambiaban de resultado (medido: sólo con is_super_admin() a
-- secas, 51 celdas función × {service_role, sistema} de la matriz: las
-- get_superadmin_*, export_company_data, materializar_rutinas_turno…). El requisito
-- es que ninguna sesión legítima cambie, así que el `false` se aplica SOLO a las
-- sesiones de la API (public.sesion_de_api()); para service_role y el sistema el
-- valor es el de siempre, bit a bit.
--
-- QUÉ CAMBIA
--   1. Dos predicados nuevos (SECURITY INVOKER, sin EXECUTE para la API):
--        public.sesion_de_api()          rol `anon`/`authenticated` o auth.uid()
--        public.sesion_api_sin_empresa() sesión de la API, no superadmin y sin empresa
--      `current_setting('role')` es el rol de la SESIÓN (el que fija PostgREST con
--      SET ROLE) y se conserva dentro de una función SECURITY DEFINER, cuyo
--      current_user es el propietario.
--   2. Diez helpers booleanos devuelven false (no NULL) a una sesión de la API sin
--      perfil: is_super_admin, is_company_owner, has_super_admin_access,
--      user_is_project_exempt, can_access_project, can_access_conversation_project,
--      has_admin_or_owner_access_in_company, is_user_cliente_with_id,
--      conta_puede_escribir, prov_puede_ver_papeleria. La forma es siempre
--      `COALESCE(<expresión de antes>, CASE WHEN public.sesion_de_api() THEN false END)`:
--      si la expresión no es NULL el resultado es EXACTAMENTE el de antes; si es
--      NULL, false para la API y NULL (como antes) para servicio/sistema.
--   3. Diez guardas que comparan con get_my_company_id() (y por eso seguirían
--      en NULL con los helpers ya arreglados) se cierran anteponiendo UNA cláusula:
--      `IF NOT (` → `IF public.sesion_api_sin_empresa() OR NOT (`. Para cualquier
--      sesión con empresa, superadmin, servicio o sistema la cláusula es false y la
--      guarda es la de antes, letra por letra. Son: assert_company_scope,
--      get_company_usage, calculate_monthly_total_cents, compras_validar_match,
--      compras_seguimiento_orden, conta_publicar_asiento, conta_anular_asiento,
--      banco_conciliar_movimiento, banco_desconciliar_movimiento,
--      banco_ajuste_conciliacion. Se parchean EN SITIO (pg_get_functiondef +
--      replace) y sólo si el cuerpo es exactamente el esperado (md5): si producción
--      tuviera otro texto, la migración aborta en vez de pisarlo.
--   4. Antes del tope de plan, un trigger BEFORE INSERT en projects y unidades
--      (alcance_tope_plan_before_insert, que por nombre dispara antes que
--      enforce_max_*_before_insert) llama a assert_company_scope(NEW.company_id):
--      quien no está en el alcance de la empresa recibe 42501 «no autorizado» SIN
--      que se lea el límite. Es lo que el cuerpo del repositorio de
--      enforce_max_projects ya hacía al leer el límite (vía
--      get_company_effective_limits), pero ahora no depende de ese cuerpo — el de
--      producción difiere del repositorio (drift-conocido.json) y no se toca.
--
-- QUÉ NO CAMBIA (y por qué)
--   · current_user_role() y get_my_company_id(): NULL es su valor correcto («no hay
--     rol», «no hay empresa»). Darles un centinela invertiría cada
--     `current_user_role() <> 'cliente'` de las políticas.
--   · has_admin_company_access / has_company_owner_company_access: tienen drift
--     cosmético declarado con producción (el auditor de tres vías marcaría AMBIGUO
--     cualquier cambio) y nunca se usan negados: su NULL ya equivale a false.
--   · enforce_max_projects / enforce_max_units y record_legal_acceptance: no se
--     tocan (drift con producción). El tope queda cubierto por el punto 4.
--   · Ninguna política, tabla, dato ni privilegio existente. Los CREATE OR REPLACE
--     conservan la ACL de cada función y el post-vuelo exige que sea idéntica.
--
-- GUARDAS DE LA MIGRACIÓN (todo en UNA transacción)
--   pre-vuelo   quien corre es el propietario de las funciones; existen todas; cada
--               cuerpo es el esperado o ya está migrado (idempotente); existen los
--               triggers del tope.
--   post-vuelo  cada cuerpo es el nuevo; SECURITY DEFINER, search_path, volatilidad
--               y ACL idénticos a los de antes; los triggers nuevos existen y
--               disparan antes que el tope; y, con una sesión simulada SIN perfil,
--               los helpers dan false y assert_company_scope lanza 42501, mientras
--               que sin JWT (sistema) dan NULL y no lanza, como antes.
--
-- Prueba: supabase/tests/fail_open_sin_perfil/run.sh (control negativo con la
-- fuga, cierre, matriz antes/después idéntica para propietario, administrador,
-- operador, visor, superadministrador, service_role y sistema, idempotencia y
-- mutaciones).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── Pre-vuelo ────────────────────────────────────────────────────────────────
-- Cuerpos esperados (md5 de prosrc): el ORIGINAL (repositorio = producción: estas
-- funciones no tienen drift declarado) y el NUEVO de los helpers reescritos.
CREATE TEMP TABLE sinperfil_esperado (
  firma        regprocedure PRIMARY KEY,
  md5_original text NOT NULL,
  md5_nuevo    text,            -- helpers reescritos enteros
  viejo        text,            -- guardas parcheadas en sitio
  nuevo        text
) ON COMMIT DROP;

INSERT INTO sinperfil_esperado (firma, md5_original, md5_nuevo) VALUES
  ('public.is_super_admin()',                              '77ae6871b0b2f9d2d9359d55d677e7e5', '05d07697b0befb4035c6e8eeffb3a86e'),
  ('public.is_company_owner()',                            'fc1c30b299f9f0fe013a7f1d6e977e6d', '9f07811b1c6bdbaa0a6678c4946f901e'),
  ('public.has_super_admin_access()',                      'c52ffcd75675a535fba1ea915e668896', '1c6e045087321a05b31ced36535cbf02'),
  ('public.user_is_project_exempt()',                      '71441fcd5c6d941cf309cad2f580e8b4', '7c6999de8d1f2bc639fe09abc84aafd8'),
  ('public.can_access_project(uuid)',                      '7eee0b68c537855ad1a9acf37bbcc879', '45ae02bbbbc4785689b94382afcd142c'),
  ('public.can_access_conversation_project(uuid)',         '7b5af178186f9299c084c8395a74ac47', '5bca6b22f1778ca9ddcee4a1a7599751'),
  ('public.has_admin_or_owner_access_in_company(uuid)',    '0441dc58ea88dbcf5050b440a9800be2', '42d6ef01a50a1a5575231335ce78e70a'),
  ('public.is_user_cliente_with_id(uuid)',                 '42b6279afd14e0ed5e59d4c07f624a8e', '3f95bfbed587e335666629829ab569e9'),
  ('public.conta_puede_escribir(text)',                    'dc1b0fcc6dc5db81e80e95834fe0ac40', '85f40030e8ea417d054d80e9f494f44d'),
  ('public.prov_puede_ver_papeleria()',                    '8539f9d93193ebba21b23c3cd04d3980', '49f755c3adafe58d64ceb2b3b1df1c2e');

-- Las guardas que se parchean: el texto VIEJO aparece exactamente una vez y se
-- sustituye por el NUEVO, que es el viejo con `public.sesion_api_sin_empresa() OR`
-- antepuesto a su `NOT (`.
INSERT INTO sinperfil_esperado (firma, md5_original, viejo, nuevo) VALUES
  ('public.assert_company_scope(uuid)', 'b54c018ed80cdd1cf61f6074dfda23b2',
   E'  IF NOT (\n    public.is_super_admin()\n    OR p_company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (\n    public.is_super_admin()\n    OR p_company_id = public.get_my_company_id()'),
  ('public.get_company_usage(uuid)', '584a9ff5dec1382307d29ec193022879',
   E'  if not (\n    public.is_super_admin()\n    or p_company_id = public.get_my_company_id()',
   E'  if public.sesion_api_sin_empresa() or not (\n    public.is_super_admin()\n    or p_company_id = public.get_my_company_id()'),
  ('public.calculate_monthly_total_cents(uuid)', 'f3da38c3b585513b919736e227b8ff0a',
   E'  if not (\n    public.is_super_admin()\n    or p_company_id = public.get_my_company_id()',
   E'  if public.sesion_api_sin_empresa() or not (\n    public.is_super_admin()\n    or p_company_id = public.get_my_company_id()'),
  ('public.compras_validar_match(uuid)', 'c5a1cfd19a5d3da9c521eec55fba3209',
   E'  IF NOT (public.is_super_admin() OR v_company = public.get_my_company_id()) THEN',
   E'  IF public.sesion_api_sin_empresa() OR NOT (public.is_super_admin() OR v_company = public.get_my_company_id()) THEN'),
  ('public.compras_seguimiento_orden(uuid)', '41c78685c61f8c2240ed4d58130ffddc',
   E'  IF NOT (public.is_super_admin()\n          OR (v_oc.company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (public.is_super_admin()\n          OR (v_oc.company_id = public.get_my_company_id()'),
  ('public.conta_publicar_asiento(uuid)', 'cf6d09c0e06af1ce245f0486df90a405',
   E'  IF NOT (\n    public.is_super_admin()\n    OR (v_asiento.company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (\n    public.is_super_admin()\n    OR (v_asiento.company_id = public.get_my_company_id()'),
  ('public.conta_anular_asiento(uuid,text)', '4977d5c4f21b828f3157e9a551dfc627',
   E'  IF NOT (\n    public.is_super_admin()\n    OR (v_asiento.company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (\n    public.is_super_admin()\n    OR (v_asiento.company_id = public.get_my_company_id()'),
  ('public.banco_conciliar_movimiento(uuid,text,uuid)', 'c01960dd024071ab50327986bc99db64',
   E'  IF NOT (\n    public.is_super_admin()\n    OR (v_mov.company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (\n    public.is_super_admin()\n    OR (v_mov.company_id = public.get_my_company_id()'),
  ('public.banco_desconciliar_movimiento(uuid)', '185a182586b76d8b76c03e9a8546245f',
   E'  IF NOT (\n    public.is_super_admin()\n    OR (v_mov.company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (\n    public.is_super_admin()\n    OR (v_mov.company_id = public.get_my_company_id()'),
  ('public.banco_ajuste_conciliacion(uuid,text)', '5e764bb573fda4ad61db3a7bbbd5aa65',
   E'  IF NOT (\n    public.is_super_admin()\n    OR (v_mov.company_id = public.get_my_company_id()',
   E'  IF public.sesion_api_sin_empresa() OR NOT (\n    public.is_super_admin()\n    OR (v_mov.company_id = public.get_my_company_id()');

-- Cuántas veces aparece `aguja` en `pajar`.
CREATE OR REPLACE FUNCTION pg_temp.sinperfil_veces(pajar text, aguja text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT (length(pajar) - length(replace(pajar, aguja, ''))) / length(aguja)
$$;

-- ¿El cuerpo actual de una función de la lista está en su estado original, ya
-- migrado, o en otro? (Recibe la firma y no la fila: una función que dependiera del
-- tipo de la tabla temporal impediría borrarla al confirmar.)
CREATE OR REPLACE FUNCTION pg_temp.sinperfil_estado(p_firma regprocedure) RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  e     record;
  v_src text := (SELECT prosrc FROM pg_proc WHERE oid = p_firma);
BEGIN
  SELECT * INTO e FROM sinperfil_esperado WHERE firma = p_firma;
  IF e.viejo IS NULL THEN
    IF md5(v_src) = e.md5_original THEN RETURN 'original'; END IF;
    IF md5(v_src) = e.md5_nuevo    THEN RETURN 'migrado';  END IF;
    RETURN 'inesperado';
  END IF;
  IF md5(v_src) = e.md5_original AND pg_temp.sinperfil_veces(v_src, e.viejo) = 1 THEN RETURN 'original'; END IF;
  IF pg_temp.sinperfil_veces(v_src, e.nuevo) = 1
     AND md5(replace(v_src, e.nuevo, e.viejo)) = e.md5_original THEN RETURN 'migrado'; END IF;
  RETURN 'inesperado';
END $$;

DO $pre$
DECLARE
  r       record;
  v_malos text[] := '{}';
BEGIN
  -- Primero quién corre: CREATE OR REPLACE exige ser el propietario de cada función.
  FOR r IN SELECT e.firma, p.proowner FROM sinperfil_esperado e JOIN pg_proc p ON p.oid = e.firma LOOP
    IF NOT pg_has_role(current_user, r.proowner, 'USAGE') THEN
      RAISE EXCEPTION 'sesion_sin_perfil (pre-vuelo): % no es propietario de % (lo es %); corre la migración con el rol propietario',
        current_user, r.firma, pg_get_userbyid(r.proowner);
    END IF;
  END LOOP;

  -- Los helpers base en los que se apoyan los nuevos (auth.uid() por catálogo: no
  -- exige USAGE sobre el esquema auth para saber que existe).
  IF to_regprocedure('public.current_user_role()') IS NULL
     OR to_regprocedure('public.get_my_company_id()') IS NULL
     OR to_regprocedure('public.user_has_project_access(uuid)') IS NULL
     OR to_regprocedure('public.user_has_permission(text)') IS NULL
     OR to_regprocedure('public.get_my_cliente_id()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'auth' AND p.proname = 'uid' AND p.pronargs = 0) THEN
    RAISE EXCEPTION 'sesion_sin_perfil (pre-vuelo): falta un helper base (current_user_role, get_my_company_id, user_has_project_access, user_has_permission, get_my_cliente_id o auth.uid)';
  END IF;

  FOR r IN SELECT e.firma, pg_temp.sinperfil_estado(e.firma) AS estado FROM sinperfil_esperado e LOOP
    IF r.estado = 'inesperado' THEN
      v_malos := v_malos || r.firma::text;
    END IF;
  END LOOP;
  IF cardinality(v_malos) > 0 THEN
    RAISE EXCEPTION 'sesion_sin_perfil (pre-vuelo): el cuerpo de % no es el esperado (ni el original ni el ya migrado); no se pisa un texto que no se revisó',
      array_to_string(v_malos, ', ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.projects'::regclass AND tgname = 'enforce_max_projects_before_insert' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.unidades'::regclass AND tgname = 'enforce_max_units_before_insert' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'sesion_sin_perfil (pre-vuelo): faltan los triggers del tope (enforce_max_projects_before_insert / enforce_max_units_before_insert)';
  END IF;

  RAISE NOTICE 'sesion_sin_perfil (pre-vuelo): % funciones en su estado original, % ya migradas',
    (SELECT count(*) FROM sinperfil_esperado e WHERE pg_temp.sinperfil_estado(e.firma) = 'original'),
    (SELECT count(*) FROM sinperfil_esperado e WHERE pg_temp.sinperfil_estado(e.firma) = 'migrado');
END
$pre$;

-- Lo que el post-vuelo exige que NO cambie: atributos y ACL de cada función.
CREATE TEMP TABLE sinperfil_antes ON COMMIT DROP AS
SELECT p.oid AS firma, p.prosecdef, p.proconfig, p.provolatile, p.proowner, p.proacl::text AS acl
  FROM pg_proc p JOIN sinperfil_esperado e ON e.firma = p.oid;

-- ── 1. Predicados ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sesion_de_api()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  -- PostgREST, Realtime y Storage fijan el rol de la sesión con SET ROLE; dentro de
  -- una SECURITY DEFINER `current_user` es el propietario, pero el GUC `role` sigue
  -- siendo el de la sesión. Sin JWT (migraciones, SQL Editor, pg_cron) es 'none';
  -- con la llave de servicio es 'service_role'. auth.uid() cubre además a quien
  -- traiga la identidad de una persona por otro camino.
  SELECT COALESCE(current_setting('role', true), 'none') IN ('anon', 'authenticated')
      OR auth.uid() IS NOT NULL
$$;

COMMENT ON FUNCTION public.sesion_de_api() IS
  'true si la sesión es de la API (rol anon/authenticated o con auth.uid()); false para service_role y para el propietario sin JWT (migraciones, SQL Editor, pg_cron). Base de la regla «una sesión de la API sin perfil no pasa una guarda por NULL» (20261029000000).';

REVOKE ALL ON FUNCTION public.sesion_de_api() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sesion_api_sin_empresa()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  -- Nunca NULL: para la API is_super_admin() ya no es NULL y `IS NULL` es booleano;
  -- fuera de la API el primer término es false.
  SELECT public.sesion_de_api()
     AND NOT public.is_super_admin()
     AND public.get_my_company_id() IS NULL
$$;

COMMENT ON FUNCTION public.sesion_api_sin_empresa() IS
  'true si la sesión es de la API, no es superadministradora y no tiene empresa (sin fila en app_users, cliente, perfil sin empresa): no está en el alcance de NINGUNA empresa. Se antepone a las guardas que comparan con get_my_company_id(), que para esa sesión darían NULL (20261029000000).';

REVOKE ALL ON FUNCTION public.sesion_api_sin_empresa() FROM PUBLIC, anon, authenticated;

-- ── 2. Helpers: false (no NULL) para una sesión de la API sin perfil ─────────
-- Cuerpo de antes, envuelto: COALESCE(<antes>, CASE WHEN public.sesion_de_api() THEN false END).
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(current_user_role() IN ('super_admin', 'superadmin'),
                  CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.is_company_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(current_user_role() = 'company_owner',
                  CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.has_super_admin_access()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(current_user_role() = 'super_admin',
                  CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.user_is_project_exempt()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
    OR (
      public.current_user_role() = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_project_assignments upa
        WHERE upa.user_id = (SELECT auth.uid())
      )
    ),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT COALESCE(
    -- Fila sin proyecto sellado: ambigua, no ajena (ver cabecera).
    p_project_id IS NULL
    OR public.user_is_project_exempt()
    OR public.user_has_project_access(p_project_id),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.can_access_conversation_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    -- Sin proyecto sellado: ambiguo, no ajeno (ver cabecera).
    p_project_id IS NULL
    -- Roles exentos: ven la empresa completa (espeja PROJECT_EXEMPT_ROLES y la
    -- rama equivalente de projects_select).
    OR public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin', 'company_owner', 'admin'])
    -- Resto: solo sus proyectos (app_users.project_id o user_project_assignments).
    OR public.user_has_project_access(p_project_id),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.has_admin_or_owner_access_in_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (current_user_role() = 'admin' AND get_my_company_id() = p_company_id)
    OR (current_user_role() = 'company_owner' AND get_my_company_id() = p_company_id),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.is_user_cliente_with_id(p_cliente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    current_user_role() = 'cliente'
    AND get_my_cliente_id() = p_cliente_id,
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.conta_puede_escribir(p_action text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.is_super_admin()
      OR public.current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.user_has_permission('platform.contabilidad.' || p_action),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

CREATE OR REPLACE FUNCTION public.prov_puede_ver_papeleria()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    public.is_super_admin()
      OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin', 'contador'])
      OR public.user_has_permission('platform.contabilidad.view'),
    CASE WHEN public.sesion_de_api() THEN false END)
$function$;

-- ── 3. Guardas que comparan con get_my_company_id(): una cláusula delante ────
-- En sitio: se toma la definición vigente (pg_get_functiondef), se sustituye el
-- texto viejo —que el pre-vuelo comprobó que aparece UNA vez en un cuerpo con el
-- md5 esperado— y se reejecuta. Si ya está migrada, no se toca.
DO $parche$
DECLARE
  r     record;
  v_def text;
BEGIN
  FOR r IN SELECT e.* FROM sinperfil_esperado e WHERE e.viejo IS NOT NULL ORDER BY e.firma::text LOOP
    IF pg_temp.sinperfil_estado(r.firma) = 'migrado' THEN
      CONTINUE;
    END IF;
    v_def := pg_get_functiondef(r.firma);
    IF pg_temp.sinperfil_veces(v_def, r.viejo) <> 1 THEN
      RAISE EXCEPTION 'sesion_sin_perfil: la guarda de % no aparece exactamente una vez en su definición', r.firma;
    END IF;
    EXECUTE replace(v_def, r.viejo, r.nuevo);
  END LOOP;
END
$parche$;

-- ── 4. El tope de plan no responde a quien no está en el alcance ─────────────
CREATE OR REPLACE FUNCTION public.tope_plan_exigir_alcance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Corre ANTES de enforce_max_*_before_insert (los triggers del mismo momento
  -- disparan por orden de nombre) y antes del WITH CHECK de la RLS: quien no está
  -- en el alcance de la empresa recibe aquí el mismo 42501 «no autorizado» que
  -- cualquier ajeno, sin que se llegue a leer el límite ni el conteo.
  -- Sin empresa no hay alcance que comprobar: igual que el tope, lo deja pasar a
  -- la restricción NOT NULL de la columna.
  IF NEW.company_id IS NOT NULL THEN
    PERFORM public.assert_company_scope(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tope_plan_exigir_alcance() IS
  'Trigger BEFORE INSERT en projects y unidades que dispara antes del tope de plan (enforce_max_*): exige assert_company_scope(NEW.company_id) para que el tope no le revele el límite ni el conteo de otra empresa a quien no está en su alcance (20261029000000).';

REVOKE ALL ON FUNCTION public.tope_plan_exigir_alcance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS alcance_tope_plan_before_insert ON public.projects;
CREATE TRIGGER alcance_tope_plan_before_insert
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tope_plan_exigir_alcance();

DROP TRIGGER IF EXISTS alcance_tope_plan_before_insert ON public.unidades;
CREATE TRIGGER alcance_tope_plan_before_insert
  BEFORE INSERT ON public.unidades
  FOR EACH ROW EXECUTE FUNCTION public.tope_plan_exigir_alcance();

-- ── Post-vuelo ───────────────────────────────────────────────────────────────
DO $post$
DECLARE
  r          record;
  v_malos    text[] := '{}';
  v_sub      text := current_setting('request.jwt.claim.sub', true);
  v_claims   text := current_setting('request.jwt.claims', true);
  v_falla    boolean;
BEGIN
  -- Cuerpos nuevos.
  FOR r IN SELECT e.firma, pg_temp.sinperfil_estado(e.firma) AS estado FROM sinperfil_esperado e LOOP
    IF r.estado <> 'migrado' THEN v_malos := v_malos || r.firma::text; END IF;
  END LOOP;
  IF cardinality(v_malos) > 0 THEN
    RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): % no quedaron con el cuerpo nuevo', array_to_string(v_malos, ', ');
  END IF;

  -- Atributos y ACL idénticos a los de antes.
  FOR r IN
    SELECT a.firma::regprocedure AS firma
      FROM sinperfil_antes a JOIN pg_proc p ON p.oid = a.firma
     WHERE (p.prosecdef, p.proconfig, p.provolatile, p.proowner, p.proacl::text)
           IS DISTINCT FROM (a.prosecdef, a.proconfig, a.provolatile, a.proowner, a.acl)
  LOOP
    v_malos := v_malos || r.firma::text;
  END LOOP;
  IF cardinality(v_malos) > 0 THEN
    RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): cambió SECURITY DEFINER, search_path, volatilidad, propietario o ACL de %', array_to_string(v_malos, ', ');
  END IF;

  -- Predicados y trigger: sin EXECUTE para la API.
  IF has_function_privilege('anon', 'public.sesion_de_api()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sesion_de_api()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sesion_api_sin_empresa()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sesion_api_sin_empresa()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tope_plan_exigir_alcance()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tope_plan_exigir_alcance()', 'EXECUTE') THEN
    RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): un predicado o el trigger nuevo quedó ejecutable por la API';
  END IF;

  -- El trigger de alcance existe y dispara ANTES que el del tope.
  IF (SELECT count(*) FROM pg_trigger t
       WHERE t.tgname = 'alcance_tope_plan_before_insert' AND NOT t.tgisinternal
         AND t.tgfoid = 'public.tope_plan_exigir_alcance()'::regprocedure
         AND t.tgrelid IN ('public.projects'::regclass, 'public.unidades'::regclass)
         AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 1 = 1) <> 2
     OR NOT ('alcance_tope_plan_before_insert' COLLATE "C" < 'enforce_max_projects_before_insert' COLLATE "C")
     OR NOT ('alcance_tope_plan_before_insert' COLLATE "C" < 'enforce_max_units_before_insert' COLLATE "C") THEN
    RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): el trigger alcance_tope_plan_before_insert no está (BEFORE INSERT FOR EACH ROW) en projects y unidades, o no dispara antes que el tope';
  END IF;

  -- Semántica con una sesión SIN perfil (un auth.uid() sin fila en app_users):
  -- false, no NULL, y assert_company_scope lanza.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  IF public.is_super_admin() IS DISTINCT FROM false
     OR public.is_company_owner() IS DISTINCT FROM false
     OR public.user_is_project_exempt() IS DISTINCT FROM false
     OR public.can_access_project(gen_random_uuid()) IS DISTINCT FROM false
     OR public.conta_puede_escribir('view') IS DISTINCT FROM false
     OR public.sesion_api_sin_empresa() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): con una sesión sin perfil los helpers no dan false';
  END IF;
  v_falla := false;
  BEGIN
    PERFORM public.assert_company_scope(gen_random_uuid());
  EXCEPTION WHEN insufficient_privilege THEN
    v_falla := true;
  END;
  IF NOT v_falla THEN
    RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): assert_company_scope no lanza 42501 a una sesión sin perfil';
  END IF;

  -- Y sin JWT (sistema), como antes: NULL y sin lanzar.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF COALESCE(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated') THEN
    IF public.is_super_admin() IS NOT NULL OR public.sesion_api_sin_empresa() IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'sesion_sin_perfil (post-vuelo): sin JWT is_super_admin() debe seguir en NULL y sesion_api_sin_empresa() en false';
    END IF;
    PERFORM public.assert_company_scope(gen_random_uuid());
  END IF;

  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_claims, ''), true);

  RAISE NOTICE 'sesion_sin_perfil (post-vuelo): % funciones migradas con su ACL intacta; trigger de alcance antes del tope en projects y unidades',
    (SELECT count(*) FROM sinperfil_esperado);
END
$post$;

DROP FUNCTION pg_temp.sinperfil_estado(regprocedure);
DROP FUNCTION pg_temp.sinperfil_veces(text, text);

COMMIT;
