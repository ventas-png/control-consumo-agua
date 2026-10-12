\set ON_ERROR_STOP on

-- ============================================================================
-- HELPERS Y PREDICADOS, ACTOR POR ACTOR (estado CON la migración)
--
-- Se evalúan desde una función SECURITY DEFINER del esquema de la prueba: así ANON
-- —que no tiene EXECUTE sobre los helpers— los ve como los ven los triggers y las
-- funciones DEFINER que sí los llaman en su nombre (el rol de la SESIÓN sigue siendo
-- anon). Para las demás sesiones la matriz ya compara cada helper antes/después.
-- ============================================================================

CREATE OR REPLACE FUNCTION fos.evaluar(p_actor text, p_expr text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM fos.poner_actor(p_actor);
    EXECUTE 'SELECT fos.evaluar_como_dueno(' || quote_literal(p_expr) || ')' INTO v;
    RAISE EXCEPTION USING ERRCODE = 'FOS00', MESSAGE = COALESCE(v, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'FOS00' THEN v := SQLERRM; ELSE v := 'ERROR ' || SQLSTATE || ' ' || SQLERRM; END IF;
  END;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION fos.evaluar_como_dueno(p_expr text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  EXECUTE 'SELECT (' || p_expr || ')::text' INTO v;
  RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION fos.evaluar_como_dueno(text) TO PUBLIC;

CREATE TEMP TABLE helpers_esperado (actor text, expr text, esperado text);
INSERT INTO helpers_esperado
SELECT a.actor, x.expr, CASE
         WHEN x.expr = 'public.sesion_de_api()' THEN
           CASE WHEN a.actor IN ('SERVICIO', 'SISTEMA') THEN 'false' ELSE 'true' END
         WHEN x.expr = 'public.sesion_api_sin_empresa()' THEN
           CASE WHEN a.actor IN ('SINAPP', 'CLI', 'ANON') THEN 'true' ELSE 'false' END
       END
  FROM unnest(ARRAY['OWN_D', 'ADM_D', 'OPE_D', 'VIS_D', 'SA', 'OP_C', 'CLI', 'SINAPP', 'ANON', 'SERVICIO', 'SISTEMA']) AS a(actor)
 CROSS JOIN (VALUES ('public.sesion_de_api()'), ('public.sesion_api_sin_empresa()')) AS x(expr);

-- ANON: false (no NULL) en cada helper reescrito; servicio y sistema: NULL, como antes.
INSERT INTO helpers_esperado
SELECT a.actor, h.expr, CASE WHEN a.actor = 'ANON' THEN 'false' ELSE 'NULL' END
  FROM unnest(ARRAY['ANON', 'SERVICIO', 'SISTEMA']) AS a(actor)
 CROSS JOIN (VALUES
   ('public.is_super_admin()'),
   ('public.is_company_owner()'),
   ('public.has_super_admin_access()'),
   ('public.user_is_project_exempt()'),
   ('public.can_access_project(' || quote_literal(fos.id('D1')) || '::uuid)'),
   ('public.can_access_conversation_project(' || quote_literal(fos.id('D1')) || '::uuid)'),
   ('public.has_admin_or_owner_access_in_company(' || quote_literal(fos.id('D')) || '::uuid)'),
   ('public.is_user_cliente_with_id(' || quote_literal(fos.id('CLI_D')) || '::uuid)'),
   ('public.conta_puede_escribir(''view'')'),
   ('public.prov_puede_ver_papeleria()')) AS h(expr);

-- can_access_project(NULL) sigue siendo true para todos («fila sin proyecto sellado: ambigua, no ajena»).
INSERT INTO helpers_esperado
SELECT a.actor, 'public.can_access_project(NULL)', 'true'
  FROM unnest(ARRAY['ANON', 'SINAPP', 'SERVICIO', 'SISTEMA', 'OWN_D']) AS a(actor);

DO $$
DECLARE e record; v text; v_n int := 0;
BEGIN
  FOR e IN SELECT * FROM helpers_esperado ORDER BY expr, actor LOOP
    v := fos.evaluar(e.actor, e.expr);
    v_n := v_n + 1;
    IF v IS DISTINCT FROM e.esperado THEN
      PERFORM fos.falla(format('HELPER %s · %s = %s (se esperaba %s)', e.actor, e.expr, v, e.esperado));
    END IF;
  END LOOP;
  RAISE NOTICE '✓ % evaluaciones de helpers y predicados por actor', v_n;
END $$;

DROP TABLE helpers_esperado;

-- Los predicados nuevos no son API: sin EXECUTE para anon ni authenticated.
SELECT fos.chk_txt(
  (SELECT string_agg(f || ':' || r, ',' ORDER BY f, r)
     FROM unnest(ARRAY['public.sesion_de_api()', 'public.sesion_api_sin_empresa()', 'public.tope_plan_exigir_alcance()']) AS f
    CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r
    WHERE has_function_privilege(r, f::regprocedure, 'EXECUTE')),
  NULL, 'sesion_de_api, sesion_api_sin_empresa y tope_plan_exigir_alcance: sin EXECUTE para anon ni authenticated');
