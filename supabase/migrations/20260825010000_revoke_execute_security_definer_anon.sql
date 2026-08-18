-- ════════════════════════════════════════════════════════════════════════════
-- Security guard (T8) · P1 — cierra las funciones SECURITY DEFINER de `public`
-- que quedaban ejecutables por `anon` (clase #378/#380).
--
-- QUÉ PASÓ
-- security-guard.mjs (lee el catálogo de PRODUCCIÓN) reporta 8 funciones
-- SECURITY DEFINER de `public` con EXECUTE efectivo para `anon`. Ninguna fue
-- revocada en su migración de origen: `CREATE FUNCTION` concede EXECUTE a
-- PUBLIC POR DEFECTO, y PUBLIC incluye a `anon` y `authenticated`. Es la misma
-- lección ya pagada en 20260729000700 (set_project_id_desde_padre).
--
-- CAUSA RAÍZ de conta_puede_escribir — la única que SÍ intentó cerrarse:
-- 20260818000000 hizo `REVOKE EXECUTE ... FROM anon` SIN revocar PUBLIC.
-- Ese REVOKE es un no-op: revoca solo grants DIRECTOS, y `anon` nunca tuvo
-- uno — su EXECUTE viene HEREDADO del grant implícito a PUBLIC, que siguió
-- vivo. `REVOKE ... FROM anon` a secas NO basta; el cierre correcto es
-- `FROM PUBLIC, anon` (PUBLIC es lo que cierra el hueco; nombrar anon
-- documenta la intención y cubre un eventual grant directo futuro).
--
-- POR QUÉ TAMBIÉN cxp_seed_on_company() y cxp_seed_iva_on_company()
-- El barrido 20260612192952 revocó 14 funciones trigger del ledger pero omitió
-- estas 2 hermanas de la misma banda 20260611: también SECURITY DEFINER,
-- también RETURNS trigger, también nacidas con el grant implícito según el
-- repo. Se cierran aquí de una vez; si en prod ya estuvieran cerradas por otra
-- vía, el REVOKE es un no-op (idempotente).
--
-- CLASIFICACIÓN Y TRATAMIENTO
-- (1) 7 funciones trigger → REVOKE de PUBLIC, anon Y authenticated. Nadie las
--     invoca vía PostgREST, y Postgres verifica el EXECUTE sobre la función de
--     trigger al hacer CREATE TRIGGER, no en cada disparo — los triggers
--     siguen funcionando para roles sin EXECUTE (verificado ejecutándolo:
--     20260729000700 y supabase/tests/pr27_project_id; re-verificado en
--     supabase/tests/security_definer_anon). Precedente: 20260612192952.
-- (2) 3 helpers de policies RLS → REVOKE de PUBLIC y anon, GRANT explícito a
--     authenticated: las policies que los evalúan (conversations_select y
--     conv_messages_select de 20260814000000; escrituras conta/compras/gastos
--     de 20260818000000 en adelante) son TO authenticated y corren COMO el
--     usuario que consulta, así que authenticated SÍ necesita EXECUTE
--     (precedente: company_is_active en 20260612192952). Hasta hoy 2 de los 3
--     helpers funcionaban solo gracias al grant implícito de PUBLIC — el GRANT
--     explícito va en esta MISMA migración para que el REVOKE no deje a
--     oscuras el módulo de comunicación.
--     service_role NO recibe grant: tiene BYPASSRLS (las policies nunca se
--     evalúan para él) y nadie llama estos helpers vía supabase.rpc()
--     (verificado con grep en src/ y supabase/functions/).
--
-- El allowlist del guard NO se toca: ninguna de estas funciones es
-- anon-callable a propósito (la única excepción legítima es sso_lookup_domain).
--
-- REVERSIÓN
-- Re-otorgar lo revocado por función:
--   GRANT EXECUTE ON FUNCTION public.<fn> TO authenticated;
-- (el estado anterior era el grant implícito de PUBLIC: GRANT ... TO PUBLIC).
--
-- Idempotente: REVOKE de un privilegio ya revocado y GRANT de uno ya otorgado
-- no fallan; el DO de verificación final es de solo lectura.
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) Funciones trigger: nadie las ejecuta directo ────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'banco_tg_movimiento_ledger()',            -- 20260813000000
    'banco_tg_propagar_ledger_movimientos()',  -- 20260813000000
    'conta_tg_linea_mismo_ledger()',           -- 20260813120000
    'cxp_seed_iva_on_company()',               -- 20260611070000 (omitida en 20260612192952)
    'cxp_seed_on_company()',                   -- 20260611010100 (omitida en 20260612192952)
    'fn_sincronizar_estado_personal()',        -- 20260820000100
    'set_registros_project_id()'               -- 20260816000000
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- ── (2) Helpers de policies RLS: cerrar PUBLIC/anon, asegurar authenticated ─
REVOKE EXECUTE ON FUNCTION public.can_access_conversation_project(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_access_conversation_project(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_conversation_assigned_to_me(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_conversation_assigned_to_me(uuid) TO authenticated;

-- conta_puede_escribir YA tiene GRANT directo a authenticated (20260818000000);
-- aquí solo falta matar el grant heredable de PUBLIC. El GRANT se repite por
-- simetría y robustez (no-op si ya existe).
REVOKE EXECUTE ON FUNCTION public.conta_puede_escribir(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.conta_puede_escribir(text) TO authenticated;

-- ── Verificación dentro de la propia migración (estilo 20260729000700) ──────
-- Si algo no surtió efecto, falla AQUÍ (en preview/apply) y no en el guard
-- nocturno. to_regprocedure detecta renombres/firmas cambiadas; los guards de
-- EXISTS(pg_roles) permiten correr en un Postgres pelado (harness local de
-- supabase/tests/, donde anon/authenticated pueden no existir).
DO $$
DECLARE
  v_fn       text;
  v_oid      oid;
  v_triggers text[] := ARRAY[
    'banco_tg_movimiento_ledger()',
    'banco_tg_propagar_ledger_movimientos()',
    'conta_tg_linea_mismo_ledger()',
    'cxp_seed_iva_on_company()',
    'cxp_seed_on_company()',
    'fn_sincronizar_estado_personal()',
    'set_registros_project_id()'
  ];
  v_helpers  text[] := ARRAY[
    'can_access_conversation_project(uuid)',
    'is_conversation_assigned_to_me(uuid)',
    'conta_puede_escribir(text)'
  ];
  v_hay_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  v_hay_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  FOREACH v_fn IN ARRAY v_triggers || v_helpers LOOP
    v_oid := to_regprocedure('public.' || v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'public.% no existe — ¿se renombró o cambió de firma en otra migración?', v_fn;
    END IF;
    IF v_hay_anon AND has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon SIGUE pudiendo ejecutar public.%', v_fn;
    END IF;
  END LOOP;

  IF v_hay_auth THEN
    FOREACH v_fn IN ARRAY v_triggers LOOP
      IF has_function_privilege('authenticated', to_regprocedure('public.' || v_fn), 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated SIGUE pudiendo ejecutar public.% (función de trigger)', v_fn;
      END IF;
    END LOOP;
    FOREACH v_fn IN ARRAY v_helpers LOOP
      IF NOT has_function_privilege('authenticated', to_regprocedure('public.' || v_fn), 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated NO puede ejecutar public.% — las policies RLS que lo evalúan dejarían el módulo a oscuras', v_fn;
      END IF;
    END LOOP;
  END IF;
END $$;
