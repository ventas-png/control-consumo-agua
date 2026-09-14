-- ════════════════════════════════════════════════════════════════════════════
-- EL CONTRATO PRIVILEGIADO: sesión administrativa y service_role, SIN JWT.
--
-- `get_my_company_id()` e `is_super_admin()` salen de `auth.uid()`. Sin JWT son
-- NULL, así que la función acotada no devolvería NINGUNA fuente y todo
-- INSERT/UPDATE con `fuente_id` no nula moriría con 42501: seeds, backfills y
-- cualquier operación de servicio, rotos.
--
-- El trigger resuelve eso con DOS caminos y decide con `rolsuper OR
-- rolbypassrls` sobre CURRENT_USER, evaluado DENTRO de la función de trigger,
-- que es SECURITY INVOKER (en la acotada, SECURITY DEFINER, CURRENT_USER sería
-- el dueño y el cheque no identificaría a nadie).
--
-- Aquí se miden INSERT y UPDATE REALES con `fuente_id` no nula:
--   1. el predicado, rol por rol;
--   2. sesión administrativa (postgres): INSERT, cálculo real, UPDATE que
--      recalcula, pisado de lo que manda el cliente, fuente inexistente → 23503;
--   3. service_role: INSERT y UPDATE contra la fuente de OTRA empresa —legítimo
--      para un actor de servicio— con el override de esa empresa aplicado;
--   4. service_role NO tiene EXECUTE sobre la acotada, y si la llamara le
--      devolvería cero filas: su camino es el privilegiado, no ése;
--   5. `authenticated` sigue SIN el predicado: el camino privilegiado no se
--      alcanza desde la API.
-- Transacción revertida.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public;

-- 1 · el predicado, rol por rol.
DO $$
DECLARE v_r record;
BEGIN
  FOR v_r IN SELECT rolname, (rolsuper OR rolbypassrls) AS sin_rls FROM pg_catalog.pg_roles
              WHERE rolname IN ('postgres', 'service_role', 'authenticated', 'anon') ORDER BY rolname
  LOOP
    PERFORM public.chk(v_r.sin_rls, v_r.rolname IN ('postgres', 'service_role'),
      '1 · ' || v_r.rolname || ': rolsuper OR rolbypassrls = ' || v_r.sin_rls::text);
  END LOOP;
  -- Y el cheque NO puede vivir en la acotada: allí CURRENT_USER es el dueño.
  PERFORM public.chk(
    (SELECT prosrc NOT LIKE '%current_user%' AND prosrc NOT LIKE '%CURRENT_USER%'
       FROM pg_proc WHERE oid = 'public.agua_fuente_de_mi_empresa(uuid)'::regprocedure),
    true, '1 · la SECURITY DEFINER no mira CURRENT_USER (allí sería el dueño, no el invocador)');
  PERFORM public.chk(
    (SELECT prosrc LIKE '%rolbypassrls%' FROM pg_proc
      WHERE oid = 'public.trg_registros_calidad_cumplimiento_catalogo()'::regprocedure),
    true, '1 · el predicado vive en la función de trigger, que es SECURITY INVOKER');
END $$;

-- 2 · sesión administrativa (postgres), con fuente_id NO nula.
DO $$
DECLARE v_estado text; v_r record; v_n int;
BEGIN
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (id, fuente_id, parametros, company_id, cumplimiento, cumple_total)
    VALUES ('0f0f0f0f-0000-4000-8000-000000000001', 'fa0f0f0f-0000-4000-8000-00000000a001',
            '{"pH": 7.5, "turbiedad": 2}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            '{"pH": false, "inventado": true}'::jsonb, false) $q$);
  PERFORM public.chk_txt(v_estado, 'OK', '2 · postgres INSERTA con fuente_id no nula (antes: 42501)');

  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0f0f0f0f-0000-4000-8000-000000000001';
  PERFORM public.chk((SELECT count(*) FROM jsonb_object_keys(v_r.cumplimiento)), 11,
    '2 · con el cálculo REAL del catálogo global potable (11 claves), no {}');
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'true', '2 · el servidor pisó el pH=false que mandó el cliente');
  PERFORM public.chk(v_r.cumplimiento ? 'inventado', false, '2 · y descartó su clave inventada');
  PERFORM public.chk(v_r.cumple_total, true, '2 · cumple_total = true');

  UPDATE public.registros_calidad SET parametros = '{"pH": 9.5, "turbiedad": 2}'::jsonb
   WHERE id = '0f0f0f0f-0000-4000-8000-000000000001';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.chk(v_n, 1, '2 · postgres ACTUALIZA parametros y alcanza la fila');
  SELECT * INTO v_r FROM public.registros_calidad WHERE id = '0f0f0f0f-0000-4000-8000-000000000001';
  PERFORM public.chk_txt(v_r.cumplimiento ->> 'pH', 'false', '2 · y el servidor recalculó: pH 9.5 → false');
  PERFORM public.chk(v_r.cumple_total, false, '2 · cumple_total = false');

  UPDATE public.registros_calidad SET cumple_total = true
   WHERE id = '0f0f0f0f-0000-4000-8000-000000000001';
  PERFORM public.chk((SELECT cumple_total FROM public.registros_calidad WHERE id = '0f0f0f0f-0000-4000-8000-000000000001'),
    false, '2 · el servidor sigue siendo autoritativo también para postgres');

  -- Para el privilegiado no hay nada oculto: una fuente inexistente es un fallo
  -- de FK (23503), no un 42501 de RLS.
  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (fuente_id, parametros, company_id)
    VALUES ('00000000-0000-4000-8000-000000000000', '{}'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '23503', '2 · fuente inexistente → 23503 foreign_key_violation, no 42501: ' || v_estado);
  PERFORM public.chk(v_estado LIKE '%no existe%' AND v_estado NOT LIKE '%no pertenece%', true,
    '2 · con el mensaje del camino privilegiado');
END $$;

-- 3 · service_role (rolbypassrls, NO superusuario), contra la fuente de OTRA
--     empresa: legítimo para un actor de servicio, y con el override de esa
--     empresa aplicado (pH [7.0, 7.2] de B, no el global).
SET LOCAL ROLE service_role;
DO $$
DECLARE v_estado text; v_n int;
BEGIN
  PERFORM public.chk_txt(CURRENT_USER::text, 'service_role', '3 · la sesión corre como service_role');
  PERFORM public.chk((SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER), false,
    '3 · service_role NO es superusuario: la rama la abre rolbypassrls, como en producción');

  v_estado := public.intentar($q$ INSERT INTO public.registros_calidad (id, fuente_id, parametros, company_id)
    VALUES ('0f0f0f0f-0000-4000-8000-000000000002', 'fb0f0f0f-0000-4000-8000-00000000b001',
            '{"pH": 7.5, "turbiedad": 2}'::jsonb, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') $q$);
  PERFORM public.chk_txt(v_estado, 'OK', '3 · service_role INSERTA con fuente_id no nula (antes: 42501)');
  PERFORM public.chk((SELECT count(*) FROM jsonb_object_keys(
      (SELECT cumplimiento FROM public.registros_calidad WHERE id = '0f0f0f0f-0000-4000-8000-000000000002'))), 2,
    '3 · con el override de la empresa DE LA FUENTE (2 claves de B), no el global de 11');
  PERFORM public.chk((SELECT cumple_total FROM public.registros_calidad WHERE id = '0f0f0f0f-0000-4000-8000-000000000002'),
    false, '3 · pH 7.5 no cumple el [7.0, 7.2] de B → cumple_total = false');

  UPDATE public.registros_calidad SET parametros = '{"pH": 7.15, "turbiedad": 2}'::jsonb
   WHERE id = '0f0f0f0f-0000-4000-8000-000000000002';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.chk(v_n, 1, '3 · service_role ACTUALIZA parametros y alcanza la fila');
  PERFORM public.chk((SELECT cumple_total FROM public.registros_calidad WHERE id = '0f0f0f0f-0000-4000-8000-000000000002'),
    true, '3 · y el servidor recalculó con el override de B: pH 7.15 → true');

  -- 4 · su camino NO es la acotada, y se nota.
  PERFORM public.chk(has_function_privilege('service_role', 'public.agua_fuente_de_mi_empresa(uuid)', 'EXECUTE'),
    false, '4 · service_role NO tiene EXECUTE sobre la acotada (para él siempre daría cero filas)');
  v_estado := public.intentar($q$ SELECT * FROM public.agua_fuente_de_mi_empresa('fb0f0f0f-0000-4000-8000-00000000b001') $q$);
  PERFORM public.chk_txt(left(v_estado, 5), '42501', '4 · y si la llamara, 42501 en vez de un silencio raro: ' || v_estado);
END $$;
RESET ROLE;

-- 5 · desde la API el camino privilegiado no se alcanza.
DO $$
BEGIN
  PERFORM public.chk((SELECT (rolsuper OR rolbypassrls) FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'),
    false, '5 · authenticated no cumple el predicado: no puede tomar la rama privilegiada');
  PERFORM public.chk((SELECT (rolsuper OR rolbypassrls) FROM pg_catalog.pg_roles WHERE rolname = 'anon'),
    false, '5 · anon tampoco');
END $$;

ROLLBACK;
SELECT public.chk((SELECT count(*) FROM public.registros_calidad), 0, 'la transacción se revirtió: registros_calidad queda vacía');
