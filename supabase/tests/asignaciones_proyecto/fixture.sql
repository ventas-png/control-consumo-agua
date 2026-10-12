\set ON_ERROR_STOP on

-- ============================================================================
-- PADRÓN DE LA SUITE «asignaciones_proyecto» — datos con la FORMA de producción
--
-- Reproduce, en una base desechable, lo que se leyó (solo lectura) de producción el 2026-10-10
-- sobre public.user_project_assignments:
--   · 43 filas, TODAS permission_type = 'total', 27 user_id distintos;
--   · 10 de las 43 son HUÉRFANAS: 6 usuarios que ya no existen en app_users;
--   · por rol: admin 3 filas / 1 persona (un administrador acotado, como Marco), operator 14 / 7, viewer 16 / 13;
--   · UNA empresa con 8 proyectos y ningún cruce de empresa;
--   · el propietario, el superadministrador y los administradores exentos no tienen filas.
-- A eso se añaden las personas que hacen falta para probar lo que NO existe hoy en producción (otra empresa, una persona
-- sin app_users, una sin empresa, un cliente, un administrador de otra empresa…), SIN filas: así las 43 siguen siendo 43.
--
-- Los helpers viven en el esquema «asgt» (solo de la prueba): no tocan el catálogo de public que se compara antes/después.
-- ============================================================================

CREATE SCHEMA asgt;
GRANT USAGE ON SCHEMA asgt TO PUBLIC;

-- ── Identidades con nombre ───────────────────────────────────────────────────
CREATE TABLE asgt.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE, tipo text NOT NULL);
GRANT SELECT ON asgt.ids TO PUBLIC;

CREATE FUNCTION asgt.uid_de(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a5e00000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION asgt.pid_de(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a5d00000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;

-- {ALIAS} dentro de un SQL → 'uuid'::uuid
CREATE FUNCTION asgt.sub(p text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; v text := p;
BEGIN
  IF p IS NULL THEN RETURN NULL; END IF;
  FOR r IN SELECT alias, id FROM asgt.ids ORDER BY length(alias) DESC, alias LOOP
    v := replace(v, '{' || r.alias || '}', quote_literal(r.id::text) || '::uuid');
  END LOOP;
  RETURN v;
END $$;

-- ── Comprobaciones ───────────────────────────────────────────────────────────
CREATE FUNCTION asgt.chk(actual bigint, esperado bigint, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual; END IF;
  RAISE NOTICE '✓ %', msg;
END $$;
CREATE FUNCTION asgt.chk_txt(actual text, esperado text, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- modo MUESTRA (asgt.mostrar = on): imprime el resultado real para compararlo entre dos bases (antes / después de la migración)
  IF current_setting('asgt.mostrar', true) = 'on' THEN
    RAISE NOTICE 'MUESTRA|%|%', actual, msg;
    RETURN;
  END IF;
  IF actual IS DISTINCT FROM esperado THEN RAISE EXCEPTION '% — esperado «%», recibido «%»', msg, esperado, actual; END IF;
  RAISE NOTICE '✓ %', msg;
END $$;
CREATE FUNCTION asgt.chk_bool(actual boolean, esperado boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual; END IF;
  RAISE NOTICE '✓ %', msg;
END $$;

-- ── Sesiones simuladas: SET ROLE + claims (los dos GUC que lee auth.uid() de Supabase) ──
--   SISTEMA  superusuario sin sesión (migraciones, SQL Editor)     · ANON  rol anon
--   SERVICIO rol service_role (BYPASSRLS, sin auth.uid())          · <ALIAS> rol authenticated con auth.uid() = esa persona
--   !<ALIAS> el rol de base de datos PROPIETARIO (salta la RLS) con la sesión (auth.uid()) de esa persona: no es un camino de la API —con la 0700 un no principal ya no
--            borra proyectos por la API—, es la forma de seguir ejercitando los TRIGGERS (defensa en profundidad) con un actor que NO es principal. El trigger lee al actor de
--            app_users por auth.uid(), no del rol de base de datos; lo que ve y hace una función SECURITY DEFINER, una conexión del dueño con un JWT o una política futura más
--            permisiva es lo que este actor representa.
CREATE FUNCTION asgt.poner_actor(p_clave text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_uid uuid;
BEGIN
  IF p_clave = 'SISTEMA' THEN
    PERFORM set_config('request.jwt.claim.sub', '', false);
    PERFORM set_config('request.jwt.claims', '', false);
    RESET ROLE;
  ELSIF p_clave = 'ANON' THEN
    PERFORM set_config('request.jwt.claim.sub', '', false);
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', false);
    SET LOCAL ROLE anon;
  ELSIF p_clave = 'SERVICIO' THEN
    PERFORM set_config('request.jwt.claim.sub', '', false);
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', false);
    SET LOCAL ROLE service_role;
  ELSIF left(p_clave, 1) = '!' THEN
    SELECT id INTO v_uid FROM asgt.ids WHERE alias = substr(p_clave, 2);
    IF v_uid IS NULL THEN RAISE EXCEPTION 'actor desconocido «%»', p_clave; END IF;
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
    RESET ROLE;
  ELSE
    SELECT id INTO v_uid FROM asgt.ids WHERE alias = p_clave;
    IF v_uid IS NULL THEN RAISE EXCEPTION 'actor desconocido «%»', p_clave; END IF;
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, false);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, false);
    SET LOCAL ROLE authenticated;
  END IF;
END $$;

-- Huella de TODAS las columnas de la tabla (incluye created_at) y de las cuatro del contrato de la migración.
CREATE FUNCTION asgt.huella_total() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::text || ':' || md5(COALESCE(string_agg(to_jsonb(u)::text, E'\n' ORDER BY u.id), ''))
    FROM public.user_project_assignments u
$$;
CREATE FUNCTION asgt.huella_contrato() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::text || ':' || md5(COALESCE(string_agg(u.id::text || '|' || u.user_id::text || '|' || u.project_id::text || '|' || u.permission_type,
                                                          E'\n' ORDER BY u.id), ''))
    FROM public.user_project_assignments u
$$;

-- user_is_project_exempt() / can_access_project() «como» una persona (restaura el claim al terminar)
CREATE FUNCTION asgt.exento(p_uid uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_prev text := current_setting('request.jwt.claim.sub', true); v boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  SELECT public.user_is_project_exempt() INTO v;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
  RETURN v;
END $$;
CREATE FUNCTION asgt.puede(p_uid uuid, p_project uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_prev text := current_setting('request.jwt.claim.sub', true); v boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  SELECT public.can_access_project(p_project) INTO v;
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev, ''), true);
  RETURN v;
END $$;

-- Los proyectos que una persona alcanza, como texto estable: «P1,P3,D1» (alias), o «*» si los alcanza todos.
CREATE FUNCTION asgt.alcance(p_uid uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(i.alias, ',' ORDER BY i.alias), '')
    FROM asgt.ids i
   WHERE i.tipo = 'proyecto' AND asgt.puede(p_uid, i.id)
$$;

-- Proyectos asignados a una persona (alias ordenados), leído como sistema (nunca bajo RLS).
CREATE FUNCTION asgt.filas_de(p_uid uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(string_agg(i.alias, ',' ORDER BY i.alias), '')
    FROM public.user_project_assignments u JOIN asgt.ids i ON i.id = u.project_id
   WHERE u.user_id = p_uid
$$;

-- Veredicto fallido: aborta (modo normal) o se anota y sigue (asgt.continuar = on, para CONTAR los casos rojos del control negativo).
CREATE TABLE asgt.fallos (n serial PRIMARY KEY, msg text NOT NULL);
CREATE FUNCTION asgt.falla(p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('asgt.continuar', true) = 'on' THEN
    INSERT INTO asgt.fallos (msg) VALUES (p_msg);
    RAISE NOTICE '✗ %', p_msg;
  ELSE
    RAISE EXCEPTION '%', p_msg;
  END IF;
END $$;

-- ── El CASO: ejecuta UNA sentencia como un actor y comprueba resultado, filas, mensaje y efecto ──
--   p_esperado:  'ok'     la sentencia triunfa, afecta p_filas (o el resultado de p_filas_sql) y p_efecto_sql da p_efecto
--                'cero'   triunfa pero afecta 0 filas, la tabla queda IGUAL y, como SISTEMA, la MISMA sentencia sí afecta filas
--                         (así el cero se debe a la denegación y no a un WHERE equivocado)
--                'error'  falla con SQLSTATE p_sqlstate y mensaje que cumple p_patron, la tabla queda igual y (p_control) la misma
--                         sentencia como SISTEMA SÍ triunfa
--   p_preparar:  SQL previo ejecutado como SISTEMA (para montar el estado del caso).
--   Cada caso corre en una subtransacción que se DESHACE al final: la base queda como estaba.
CREATE FUNCTION asgt.caso(p_etq text, p_actor text, p_sql text, p_esperado text,
                          p_filas bigint DEFAULT NULL, p_filas_sql text DEFAULT NULL,
                          p_sqlstate text DEFAULT NULL, p_patron text DEFAULT NULL,
                          p_efecto_sql text DEFAULT NULL, p_efecto text DEFAULT NULL,
                          p_preparar text DEFAULT NULL, p_control boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_sql       text := asgt.sub(p_sql);
  v_prep      text := asgt.sub(p_preparar);
  v_res       text;  v_n bigint;  v_ss text;  v_msg text;  v_efecto text;
  v_esp_n     bigint;  v_h_pre text;  v_h_post text;  v_ctrl bigint;
BEGIN
  -- 1 · el actor
  BEGIN
    PERFORM asgt.poner_actor('SISTEMA');
    IF v_prep IS NOT NULL THEN EXECUTE v_prep; END IF;
    IF p_filas_sql IS NOT NULL THEN EXECUTE asgt.sub(p_filas_sql) INTO v_esp_n; ELSE v_esp_n := p_filas; END IF;
    v_h_pre := asgt.huella_total();
    PERFORM asgt.poner_actor(p_actor);
    EXECUTE v_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := 'ok';
    PERFORM asgt.poner_actor('SISTEMA');
    v_h_post := asgt.huella_total();
    IF p_efecto_sql IS NOT NULL THEN EXECUTE asgt.sub(p_efecto_sql) INTO v_efecto; END IF;
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'reversión deliberada del caso';
  EXCEPTION
    WHEN SQLSTATE 'AS999' THEN NULL;
    WHEN OTHERS THEN v_res := 'error'; v_ss := SQLSTATE; v_msg := SQLERRM;
  END;
  PERFORM asgt.poner_actor('SISTEMA');

  -- 2 · el control: la MISMA sentencia como SISTEMA
  IF p_control AND p_esperado IN ('cero', 'error') THEN
    BEGIN
      PERFORM asgt.poner_actor('SISTEMA');
      IF v_prep IS NOT NULL THEN EXECUTE v_prep; END IF;
      EXECUTE v_sql;
      GET DIAGNOSTICS v_ctrl = ROW_COUNT;
      RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'reversión deliberada del control';
    EXCEPTION
      WHEN SQLSTATE 'AS999' THEN NULL;
      WHEN OTHERS THEN
        PERFORM asgt.falla(format('[%s] el CONTROL (la misma sentencia como SISTEMA) falló con %s «%s»: la sentencia no prueba nada', p_etq, SQLSTATE, left(SQLERRM, 200)));
        RETURN;
    END;
    IF COALESCE(v_ctrl, 0) = 0 THEN
      PERFORM asgt.falla(format('[%s] el CONTROL (la misma sentencia como SISTEMA) afectó 0 filas: el 0 del actor no prueba la denegación', p_etq));
      RETURN;
    END IF;
  END IF;

  -- 3 · el veredicto
  IF p_esperado = 'ok' THEN
    IF v_res <> 'ok' THEN PERFORM asgt.falla(format('[%s] (%s) debía TRIUNFAR y falló con %s «%s»', p_etq, p_actor, v_ss, left(v_msg, 240))); RETURN; END IF;
    IF v_n IS DISTINCT FROM v_esp_n THEN PERFORM asgt.falla(format('[%s] (%s) afectó %s filas, se esperaban %s', p_etq, p_actor, v_n, v_esp_n)); RETURN; END IF;
    IF p_efecto_sql IS NOT NULL AND v_efecto IS DISTINCT FROM p_efecto THEN
      PERFORM asgt.falla(format('[%s] (%s) efecto posterior «%s», se esperaba «%s»', p_etq, p_actor, v_efecto, p_efecto)); RETURN;
    END IF;
    RAISE NOTICE '✓ % (% · % fila(s)%)', p_etq, p_actor, v_n, CASE WHEN p_efecto_sql IS NOT NULL THEN ' · efecto «' || v_efecto || '»' ELSE '' END;
  ELSIF p_esperado = 'cero' THEN
    IF v_res <> 'ok' THEN PERFORM asgt.falla(format('[%s] (%s) debía afectar 0 filas y falló con %s «%s»', p_etq, p_actor, v_ss, left(v_msg, 240))); RETURN; END IF;
    IF v_n <> 0 THEN PERFORM asgt.falla(format('[%s] (%s) afectó %s filas y debía afectar 0', p_etq, p_actor, v_n)); RETURN; END IF;
    IF v_h_post IS DISTINCT FROM v_h_pre THEN PERFORM asgt.falla(format('[%s] (%s) afectó 0 filas pero la tabla CAMBIÓ', p_etq, p_actor)); RETURN; END IF;
    IF p_efecto_sql IS NOT NULL AND v_efecto IS DISTINCT FROM p_efecto THEN
      PERFORM asgt.falla(format('[%s] (%s) efecto posterior «%s», se esperaba «%s»', p_etq, p_actor, v_efecto, p_efecto)); RETURN;
    END IF;
    RAISE NOTICE '✓ % (% · 0 filas, tabla intacta, %)', p_etq, p_actor,
      CASE WHEN p_control THEN 'el control sí afecta ' || v_ctrl ELSE 'sin control: como SISTEMA la misma sentencia tampoco es posible' END;
  ELSIF p_esperado = 'error' THEN
    IF v_res <> 'error' THEN PERFORM asgt.falla(format('[%s] (%s) NO falló (%s filas) y tenía que fallar con %s «%s»', p_etq, p_actor, v_n, p_sqlstate, p_patron)); RETURN; END IF;
    IF v_ss IS DISTINCT FROM p_sqlstate OR v_msg !~ p_patron THEN
      PERFORM asgt.falla(format('[%s] (%s) falló con %s «%s», y se esperaba %s «%s»', p_etq, p_actor, v_ss, left(v_msg, 240), p_sqlstate, p_patron)); RETURN;
    END IF;
    IF v_prep IS NULL AND asgt.huella_total() IS DISTINCT FROM v_h_pre THEN
      PERFORM asgt.falla(format('[%s] (%s) falló pero la tabla CAMBIÓ', p_etq, p_actor)); RETURN;
    END IF;
    RAISE NOTICE '✓ % (% · % «%»)', p_etq, p_actor, v_ss, left(v_msg, 60);
  ELSE
    RAISE EXCEPTION 'p_esperado desconocido «%»', p_esperado;
  END IF;
END $$;

-- ── Atajos: sentencias y veredictos con nombre (los {ALIAS} los resuelve asgt.sub) ──
CREATE FUNCTION asgt.ins(u text, p text, perm text DEFAULT 'total') RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES ({%s}, {%s}, %L)', u, p, perm) $$;
CREATE FUNCTION asgt.borrar_de(u text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('DELETE FROM public.user_project_assignments WHERE user_id = {%s}', u) $$;
CREATE FUNCTION asgt.borrar_fila(u text, p text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('DELETE FROM public.user_project_assignments WHERE user_id = {%s} AND project_id = {%s}', u, p) $$;
CREATE FUNCTION asgt.mover(u text, p_viejo text, p_nuevo text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('UPDATE public.user_project_assignments SET project_id = {%s} WHERE user_id = {%s} AND project_id = {%s}', p_nuevo, u, p_viejo) $$;
CREATE FUNCTION asgt.permiso(u text, p text, perm text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('UPDATE public.user_project_assignments SET permission_type = %L WHERE user_id = {%s} AND project_id = {%s}', perm, u, p) $$;
CREATE FUNCTION asgt.pasar_a(u_viejo text, p text, u_nuevo text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('UPDATE public.user_project_assignments SET user_id = {%s} WHERE user_id = {%s} AND project_id = {%s}', u_nuevo, u_viejo, p) $$;

CREATE FUNCTION asgt.ok(p_etq text, p_actor text, p_sql text, p_filas bigint DEFAULT 1, p_efecto_sql text DEFAULT NULL, p_efecto text DEFAULT NULL, p_preparar text DEFAULT NULL)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'ok', p_filas => p_filas, p_efecto_sql => p_efecto_sql, p_efecto => p_efecto, p_preparar => p_preparar) $$;
CREATE FUNCTION asgt.ok_sql(p_etq text, p_actor text, p_sql text, p_filas_sql text, p_efecto_sql text DEFAULT NULL, p_efecto text DEFAULT NULL, p_preparar text DEFAULT NULL)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'ok', p_filas_sql => p_filas_sql, p_efecto_sql => p_efecto_sql, p_efecto => p_efecto, p_preparar => p_preparar) $$;
CREATE FUNCTION asgt.cero(p_etq text, p_actor text, p_sql text, p_efecto_sql text DEFAULT NULL, p_efecto text DEFAULT NULL, p_preparar text DEFAULT NULL)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'cero', p_efecto_sql => p_efecto_sql, p_efecto => p_efecto, p_preparar => p_preparar) $$;
-- bloqueado por el trigger de AUTOASIGNACIÓN
CREATE FUNCTION asgt.err_propia(p_etq text, p_actor text, p_sql text, p_preparar text DEFAULT NULL, p_control boolean DEFAULT true)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'error', p_sqlstate => '42501', p_patron => 'ASIGNACION_PROPIA_NO_PERMITIDA', p_preparar => p_preparar, p_control => p_control) $$;
-- bloqueado por el trigger de INTEGRIDAD (vale para todo actor: el control como SISTEMA también falla, por eso no se hace)
CREATE FUNCTION asgt.err_empresa(p_etq text, p_actor text, p_sql text, p_preparar text DEFAULT NULL)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'error', p_sqlstate => '23514', p_patron => 'ASIGNACION_EMPRESA_DISTINTA', p_preparar => p_preparar, p_control => false) $$;
-- bloqueado por la política RLS
CREATE FUNCTION asgt.err_rls(p_etq text, p_actor text, p_sql text, p_preparar text DEFAULT NULL)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'error', p_sqlstate => '42501', p_patron => 'row-level security', p_preparar => p_preparar) $$;
-- bloqueado por el privilegio de la tabla
CREATE FUNCTION asgt.err_priv(p_etq text, p_actor text, p_sql text, p_control boolean DEFAULT true)
RETURNS void LANGUAGE sql AS
$$ SELECT asgt.caso(p_etq, p_actor, p_sql, 'error', p_sqlstate => '42501', p_patron => 'permission denied for table user_project_assignments', p_control => p_control) $$;

-- ── Empresas y proyectos ─────────────────────────────────────────────────────
-- C: 8 proyectos (como la empresa de producción). D: otra empresa con 2.
INSERT INTO public.companies (id, nombre, default_currency) VALUES
  ('a5c00000-0000-0000-0000-000000000001', 'ASG Empresa C', 'gtq'),
  ('a5c00000-0000-0000-0000-000000000002', 'ASG Empresa D', 'gtq');
INSERT INTO asgt.ids VALUES ('C', 'a5c00000-0000-0000-0000-000000000001', 'empresa'), ('D', 'a5c00000-0000-0000-0000-000000000002', 'empresa');

SET session_replication_role = replica;      -- sin el tope de proyectos del plan ni la siembra contable (no es lo que se prueba)
INSERT INTO public.projects (id, company_id, nombre)
SELECT asgt.pid_de(n), 'a5c00000-0000-0000-0000-000000000001', 'ASG C' || n FROM generate_series(1, 8) n;
INSERT INTO public.projects (id, company_id, nombre) VALUES
  (asgt.pid_de(11), 'a5c00000-0000-0000-0000-000000000002', 'ASG D1'),
  (asgt.pid_de(12), 'a5c00000-0000-0000-0000-000000000002', 'ASG D2');
SET session_replication_role = origin;
INSERT INTO asgt.ids SELECT 'P' || n, asgt.pid_de(n), 'proyecto' FROM generate_series(1, 8) n;
INSERT INTO asgt.ids VALUES ('D1', asgt.pid_de(11), 'proyecto'), ('D2', asgt.pid_de(12), 'proyecto');

-- ── Personas ─────────────────────────────────────────────────────────────────
-- (alias, n, rol, empresa)   SINAPP no tiene app_users; ORFn no existen en ningún lado.
CREATE TEMP TABLE _personas (alias text, n int, rol text, emp text, nombre text);
INSERT INTO _personas VALUES
  ('SU',     1, 'super_admin',   'C', 'ASG superadministrador (super_admin)'),
  ('SU2',    2, 'superadmin',    'D', 'ASG superadministrador (superadmin) de D'),
  ('OW',     3, 'company_owner', 'C', 'ASG propietario de C'),
  ('DOW',    4, 'company_owner', 'D', 'ASG propietario de D'),
  ('AX',     5, 'admin',         'C', 'ASG administrador de C exento (sin filas)'),
  ('AP',     6, 'admin',         'C', 'ASG administrador de C acotado (3 proyectos, como Marco)'),
  ('DAD',    7, 'admin',         'D', 'ASG administrador de D'),
  ('NUEVO',  8, 'operator',      'C', 'ASG operador nuevo de C (sin filas)'),
  ('CLI',    9, 'cliente',       NULL, 'ASG cliente (sin empresa)'),
  ('SINAPP',10, NULL,            NULL, 'ASG sesión sin app_users'),
  ('SINEMP',11, 'operator',      NULL, 'ASG operador sin empresa'),
  ('DOP',   12, 'operator',      'D', 'ASG operador de D (sin filas)'),
  ('AX2',   13, 'admin',         'C', 'ASG segundo administrador de C exento (sin filas)');
INSERT INTO _personas SELECT 'OP' || k, 20 + k, 'operator', 'C', 'ASG operador ' || k FROM generate_series(1, 7) k;
INSERT INTO _personas SELECT 'VW' || k, 30 + k, 'viewer',   'C', 'ASG visor ' || k FROM generate_series(1, 13) k;

INSERT INTO auth.users (id) SELECT asgt.uid_de(n) FROM _personas;
INSERT INTO public.app_users (id, company_id, full_name, role)
SELECT asgt.uid_de(n),
       CASE emp WHEN 'C' THEN 'a5c00000-0000-0000-0000-000000000001'::uuid WHEN 'D' THEN 'a5c00000-0000-0000-0000-000000000002'::uuid END,
       nombre, rol
  FROM _personas WHERE rol IS NOT NULL;
INSERT INTO asgt.ids SELECT alias, asgt.uid_de(n), 'persona' FROM _personas;
-- las huérfanas: user_id sin app_users ni auth.users (la tabla no tiene llave foránea hacia personas)
INSERT INTO asgt.ids SELECT 'ORF' || k, asgt.uid_de(50 + k), 'huerfana' FROM generate_series(1, 6) k;

-- ── RBAC de la empresa C (lo escribe assert_principal.sql): un rol de empresa, sin personas ni asignaciones nuevas ────────────────────────────────────────
INSERT INTO public.roles (id, company_id, name, is_system) VALUES ('a5b00000-0000-0000-0000-000000000001', 'a5c00000-0000-0000-0000-000000000001', 'ASG rol de empresa', false);
INSERT INTO asgt.ids VALUES ('ROLC', 'a5b00000-0000-0000-0000-000000000001', 'rol');
-- … y el rol de SISTEMA «Admin Plataforma» (el que create-user asigna a un administrador; 96 llaves): sobre él se prueba que el propietario NO escribe llaves de roles de sistema
INSERT INTO asgt.ids VALUES ('ROLS', '00000000-0000-0000-0000-000000000201', 'rol');

-- ── Las 43 filas (todas «total») ─────────────────────────────────────────────
--   AP: 3 (P1,P2,P3) · OP1..OP7: 14 (OPk → Pk y Pk+1) · VW1..VW3: 2 filas c/u, VW4..VW13: 1 c/u = 16 · ORF1..ORF4: 2 c/u, ORF5..ORF6: 1 c/u = 10
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT asgt.uid_de(6), asgt.pid_de(p), 'total' FROM generate_series(1, 3) p;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT asgt.uid_de(20 + k), asgt.pid_de(p), 'total' FROM generate_series(1, 7) k, LATERAL unnest(ARRAY[k, k + 1]) p;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT asgt.uid_de(30 + k), asgt.pid_de(1 + (k % 8)), 'total' FROM generate_series(1, 13) k;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT asgt.uid_de(30 + k), asgt.pid_de(1 + ((k + 3) % 8)), 'total' FROM generate_series(1, 3) k;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT asgt.uid_de(50 + k), asgt.pid_de(p), 'total' FROM generate_series(1, 4) k, LATERAL unnest(ARRAY[k, k + 1]) p;
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
VALUES (asgt.uid_de(55), asgt.pid_de(6), 'total'), (asgt.uid_de(56), asgt.pid_de(7), 'total');

DROP TABLE _personas;

-- ── Copia de las 43 filas tal como nacen (id, created_at, permission_type…) ─────────────────────────────────
-- Sirve para demostrar qué flujos CONSERVAN las filas que no cambian y cuáles las vuelven a crear con otro id.
CREATE TABLE asgt.snap_filas AS SELECT * FROM public.user_project_assignments;
GRANT SELECT ON asgt.snap_filas TO PUBLIC;

-- ── Reproduce la pantalla AsignacionModal.guardar() ─────────────────────────────────────────────────────────
--   'legado'       borra TODAS las de la persona y vuelve a insertar las marcadas (dos peticiones: si la segunda falla, la primera ya valió)
--   'diferencias'  lee las actuales, inserta las que faltan, borra SÓLO las que sobran y que el actor puede ver (nunca las demás)
-- Devuelve «proyectos finales de la persona | resultado | filas conservadas tal cual (mismo id y created_at)». La base queda como estaba.
CREATE FUNCTION asgt.modal(p_actor text, p_persona text, p_deseado text[], p_modo text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_persona uuid := (SELECT id FROM asgt.ids WHERE alias = p_persona);
  v_actuales text[];  v_universo text[];  v_faltan text[];  v_sobran text[];
  v_final text;  v_err text := 'ok';  v_conserv bigint;
BEGIN
  BEGIN
    PERFORM asgt.poner_actor(p_actor);
    IF p_modo = 'legado' THEN
      DELETE FROM public.user_project_assignments WHERE user_id = v_persona;
      BEGIN
        INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
        SELECT v_persona, i.id, 'total' FROM asgt.ids i WHERE i.alias = ANY (p_deseado);
      EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
      END;
    ELSE
      v_actuales := ARRAY(SELECT i.alias FROM public.user_project_assignments u JOIN asgt.ids i ON i.id = u.project_id WHERE u.user_id = v_persona);
      v_universo := ARRAY(SELECT i.alias FROM public.projects p JOIN asgt.ids i ON i.id = p.id);
      v_faltan := ARRAY(SELECT unnest(p_deseado) EXCEPT SELECT unnest(v_actuales));
      v_sobran := ARRAY((SELECT unnest(v_actuales) EXCEPT SELECT unnest(p_deseado)) INTERSECT SELECT unnest(v_universo));
      BEGIN
        INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
        SELECT v_persona, i.id, 'total' FROM asgt.ids i WHERE i.alias = ANY (v_faltan)
        ON CONFLICT (user_id, project_id) DO NOTHING;
      EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE;
      END;
      IF v_err = 'ok' THEN
        DELETE FROM public.user_project_assignments u USING asgt.ids i
         WHERE u.user_id = v_persona AND i.id = u.project_id AND i.alias = ANY (v_sobran);
      END IF;
    END IF;
    PERFORM asgt.poner_actor('SISTEMA');
    v_final := asgt.filas_de(v_persona);
    SELECT count(*) INTO v_conserv
      FROM public.user_project_assignments u
      JOIN asgt.snap_filas s ON s.id = u.id AND s.created_at = u.created_at AND s.user_id = u.user_id AND s.project_id = u.project_id
                            AND s.permission_type = u.permission_type
     WHERE u.user_id = v_persona;
    RAISE EXCEPTION USING ERRCODE = 'AS999', MESSAGE = 'reversión deliberada del flujo';
  EXCEPTION
    WHEN SQLSTATE 'AS999' THEN NULL;
    WHEN OTHERS THEN v_err := 'abortó ' || SQLSTATE;
  END;
  PERFORM asgt.poner_actor('SISTEMA');
  RETURN COALESCE(v_final, '?') || '|' || v_err || '|' || COALESCE(v_conserv, -1);
END $$;
