-- ════════════════════════════════════════════════════════════════════════════
-- Verificación POSTDEPLOY de 20260907000800 (#813) — SOLO LECTURA
-- ════════════════════════════════════════════════════════════════════════════
--
-- Las dos funciones del snapshot son la clase de objeto que se degrada en
-- silencio: SECURITY DEFINER que un CREATE OR REPLACE posterior puede
-- re-declarar sin `SET search_path` (secuestrable vía pg_temp) o cuyo EXECUTE
-- un GRANT ancho puede devolverle al cliente. Aquí se mira la CONFIGURACIÓN
-- viva (proconfig) y los PRIVILEGIOS vivos (has_function_privilege), no los
-- nombres. Puede correrse tal cual contra producción tras el apply.

DO $$
DECLARE
  fn text;
  v_oid oid;
  v_config text[];
  v_sp text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['tarea_copiar_snapshot_plantilla',
                            'tarea_referencias_del_scope'] LOOP
    SELECT p.oid, p.proconfig INTO v_oid, v_config
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public' AND p.proname = fn;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'PD813-1: public.%() no existe', fn; END IF;

    -- search_path FIJO y mínimo, declarado en la función.
    SELECT cfg INTO v_sp FROM unnest(COALESCE(v_config, '{}')) AS cfg
     WHERE cfg LIKE 'search_path=%';
    IF v_sp IS NULL THEN
      RAISE EXCEPTION 'PD813-2: %() perdió su SET search_path — secuestrable vía pg_temp', fn; END IF;
    IF v_sp !~ 'search_path=("?public"?)(,\s*"?pg_temp"?)?$' THEN
      RAISE EXCEPTION 'PD813-2b: el search_path de %() dejó de ser mínimo: %', fn, v_sp; END IF;

    -- Sin EXECUTE para PUBLIC, anon ni authenticated: solo el trigger las
    -- corre. has_function_privilege HEREDA lo otorgado a PUBLIC, así que si el
    -- REVOKE de PUBLIC se perdiera, estos dos chequeos lo ven igual.
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PD813-3: anon puede ejecutar %()', fn; END IF;
    IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'PD813-3b: authenticated puede ejecutar %()', fn; END IF;
  END LOOP;

  RAISE NOTICE 'postdeploy OK (#813): search_path fijo y EXECUTE revocado a PUBLIC/anon/authenticated en las dos funciones del snapshot';
END;
$$;
