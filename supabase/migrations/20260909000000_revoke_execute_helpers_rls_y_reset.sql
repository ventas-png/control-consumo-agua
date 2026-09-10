-- ════════════════════════════════════════════════════════════════════════════
-- Security guard (T8) · P1 — el REPOSITORIO deja abiertas a `anon` 18 funciones
-- que producción ya cerró. Esta migración pone al repositorio al día.
--
-- POR QUÉ NADIE LO VIO. security-guard.mjs lee el catálogo de PRODUCCIÓN, y en
-- producción estas funciones YA tienen EXECUTE revocado a PUBLIC/anon: alguien
-- lo hizo a mano y nunca lo escribió como migración. El guard, por tanto, no
-- tiene nada que reportar. El lado roto es el repositorio, y el único que mira
-- ese lado es el auditor de drift (#827): sus 23 entradas
-- `funcion:*/grants` marcadas «SEGURIDAD · ALTA, Y EN CONTRA DEL REPOSITORIO»
-- son exactamente esto. 18 de las 23 corresponden a funciones que el
-- repositorio sí declara; las otras 5 son de funciones que sólo existen en
-- producción y no hay nada que revocar aquí.
--
-- QUÉ SIGNIFICA EN LA PRÁCTICA. `public` está expuesto por la Data API, así que
-- en CUALQUIER entorno reconstruido desde este repositorio —el sandbox de E2E,
-- una rama de preview, una recuperación ante desastre, un despliegue nuevo—
-- `anon` puede llamar por RPC, sin sesión:
--   · update_user_password(email, contraseña)  → cambiar la contraseña de
--     cualquier usuario sin autenticarse;
--   · request_password_reset(...) y validate_reset_token(...) → el flujo de
--     reseteo completo como oráculo;
--   · is_super_admin(), has_admin_company_access(), get_my_company_id() y el
--     resto de los predicados SECURITY DEFINER sobre los que se apoya la RLS.
-- Producción no está expuesta: por eso esto es drift y no un incidente.
--
-- LA CAUSA ES LA DE SIEMPRE: `CREATE FUNCTION` concede EXECUTE a PUBLIC por
-- defecto, y PUBLIC incluye a anon y a authenticated. Ninguna de las
-- migraciones de origen lo revocó. Es la misma lección de 20260729000700 y
-- 20260825010000, y por eso esta migración copia su forma: `FROM PUBLIC, anon`
-- —revocar sólo de `anon` es un NO-OP, porque su EXECUTE es heredado de PUBLIC,
-- no un grant directo— y verificación dentro de la propia migración.
--
-- EL ALCANCE NO SE ADIVINÓ, SE MIDIÓ. Cada REVOKE de aquí se eligió
-- reproduciendo el ACL de producción contra la huella versionada
-- (scripts/schema-drift/huella-produccion.json, captura del 2026-09-08): se
-- reconstruyó el esquema desde las 453 migraciones, se aplicaron estos REVOKE y
-- se comparó el hash de cada grupo `funcion:<firma>/grants` con el de
-- producción. Los 20 grupos coinciden EXACTAMENTE. De ahí sale la asimetría
-- del bloque (2): en el trío de reseteo producción tampoco deja a
-- `authenticated`, y con él dentro los cinco hashes no cuadran.
--
-- (1) HELPERS DE POLICIES RLS → REVOKE de PUBLIC y anon; authenticated SE
--     QUEDA. Estos predicados se evalúan DENTRO de policies, y una policy corre
--     con el rol que consulta, no con el dueño de la función: sin EXECUTE,
--     `authenticated` dejaría de poder leer sus propias filas. Ya tienen GRANT
--     explícito a authenticated (se verificó en la reconstrucción: aparece
--     `authenticated=X` en proacl), así que revocar PUBLIC no los toca.
--     Precedente idéntico: los tres helpers de 20260825010000.
--
-- (2) RESETEO DE CONTRASEÑA → REVOKE de PUBLIC, anon Y authenticated. Son
--     herencia del auth propio anterior a Supabase Auth: ni src/ ni
--     supabase/functions/ las llaman (verificado con grep), y el flujo real de
--     reseteo hoy es el de Supabase Auth. Sólo service_role las conserva, que
--     es como está producción.
--
-- REVERSIÓN
--   GRANT EXECUTE ON FUNCTION public.<fn> TO authenticated;   -- bloque (2)
--   GRANT EXECUTE ON FUNCTION public.<fn> TO PUBLIC;          -- estado previo
--
-- Idempotente: revocar un privilegio ya revocado no falla, y el DO final es de
-- sólo lectura. En producción es un no-op declarativo: ya está así.
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) Helpers de policies RLS: cerrar PUBLIC/anon, conservar authenticated ─
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'current_user_role()',
    'get_my_cliente_id()',
    'get_my_company_id()',
    'get_my_user_id()',
    'has_admin_company_access(uuid)',
    'has_admin_or_owner_access_in_company(uuid)',
    'has_admin_project_access(uuid)',
    'has_company_owner_company_access(uuid)',
    'has_operator_project_access(uuid)',
    'has_super_admin_access()',
    'has_viewer_project_access(uuid)',
    'is_company_owner()',
    'is_super_admin()',
    'is_user_cliente_with_id(uuid)',
    'user_has_project_access(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
  END LOOP;
END $$;

-- ── (2) Reseteo de contraseña: sólo service_role ────────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'request_password_reset(character varying, character varying, text)',
    'request_password_reset(text, text, text)',
    'update_user_password(character varying, character varying)',
    'validate_reset_token(character varying)',
    'validate_reset_token(text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- ── Verificación dentro de la propia migración (estilo 20260825010000) ──────
-- Si algo no surtió efecto, falla AQUÍ —en el apply o en la preview branch— y
-- no semanas después en un guard nocturno. to_regprocedure detecta renombres y
-- cambios de firma; los EXISTS(pg_roles) permiten correr en un Postgres pelado
-- (el harness de supabase/tests/, donde anon/authenticated pueden no existir).
DO $$
DECLARE
  v_fn       text;
  v_oid      oid;
  v_helpers  text[] := ARRAY[
    'current_user_role()',
    'get_my_cliente_id()',
    'get_my_company_id()',
    'get_my_user_id()',
    'has_admin_company_access(uuid)',
    'has_admin_or_owner_access_in_company(uuid)',
    'has_admin_project_access(uuid)',
    'has_company_owner_company_access(uuid)',
    'has_operator_project_access(uuid)',
    'has_super_admin_access()',
    'has_viewer_project_access(uuid)',
    'is_company_owner()',
    'is_super_admin()',
    'is_user_cliente_with_id(uuid)',
    'user_has_project_access(uuid)'
  ];
  v_reset    text[] := ARRAY[
    'request_password_reset(character varying, character varying, text)',
    'request_password_reset(text, text, text)',
    'update_user_password(character varying, character varying)',
    'validate_reset_token(character varying)',
    'validate_reset_token(text)'
  ];
  v_hay_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  v_hay_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH v_fn IN ARRAY v_helpers || v_reset LOOP
    v_oid := to_regprocedure('public.' || v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'public.% no existe — ¿se renombró o cambió de firma en otra migración?', v_fn;
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PUBLIC SIGUE pudiendo ejecutar public.%', v_fn;
    END IF;
    IF v_hay_anon AND has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon SIGUE pudiendo ejecutar public.%', v_fn;
    END IF;
  END LOOP;

  IF v_hay_auth THEN
    -- Los helpers de policies SIN authenticated dejarían la RLS a oscuras: la
    -- policy se evalúa con el rol que consulta.
    FOREACH v_fn IN ARRAY v_helpers LOOP
      IF NOT has_function_privilege('authenticated', to_regprocedure('public.' || v_fn), 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated NO puede ejecutar public.% — las policies que lo evalúan dejarían de leer', v_fn;
      END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY v_reset LOOP
      IF has_function_privilege('authenticated', to_regprocedure('public.' || v_fn), 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated SIGUE pudiendo ejecutar public.% (reseteo de contraseña)', v_fn;
      END IF;
    END LOOP;
  END IF;
END $$;
