\set ON_ERROR_STOP on

-- ============================================================================
-- EL TOPE DE PLAN NO ES UN ORÁCULO — INSERT reales en projects y unidades.
--
-- D está en su tope (2 de 2 proyectos, 1 de 1 unidad); C no (2 de 5, 0 de 50).
-- Cada intento corre como el actor, en su subtransacción, y se deshace.
--
-- Lo que se exige (estado CON la migración):
--   · quien no está en el alcance de la empresa —sin perfil, anon, un cliente, o
--     de otra empresa— recibe SIEMPRE 42501 «no autorizado», esté o no la empresa
--     en su tope: ni el límite ni el conteo, y ninguna diferencia entre «en el
--     tope» y «con hueco»;
--   · los demás, lo de siempre: el propietario, el administrador, el operador y el
--     visor de D ven el tope de SU empresa; el superadministrador lo salta;
--     service_role y el sistema (migraciones, SQL Editor) lo respetan.
-- Sin la migración fallan exactamente las filas de SINAPP, CLI y ANON (el
-- oráculo); run.sh lo cuenta.
-- ============================================================================

CREATE OR REPLACE FUNCTION fos.intento(p_actor text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM fos.poner_actor(p_actor);
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE = 'FOS00', MESSAGE = 'insertado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'FOS00' THEN v := 'insertado'; ELSE v := SQLSTATE || ' ' || SQLERRM; END IF;
  END;
  RETURN v;
END $$;

CREATE TEMP TABLE tope_esperado (actor text, tabla text, empresa text, esperado text);
INSERT INTO tope_esperado VALUES
  -- empresa D, EN su tope
  ('OWN_D',    'projects', 'D', '23514 plan_limit_reached: max_projects = 2 (actual: 2)%'),
  ('ADM_D',    'projects', 'D', '23514 plan_limit_reached: max_projects = 2 (actual: 2)%'),
  ('OPE_D',    'projects', 'D', '23514 plan_limit_reached: max_projects = 2 (actual: 2)%'),
  ('VIS_D',    'projects', 'D', '23514 plan_limit_reached: max_projects = 2 (actual: 2)%'),
  ('SA',       'projects', 'D', 'insertado'),
  ('SERVICIO', 'projects', 'D', '23514 plan_limit_reached: max_projects = 2 (actual: 2)%'),
  ('SISTEMA',  'projects', 'D', '23514 plan_limit_reached: max_projects = 2 (actual: 2)%'),
  ('OP_C',     'projects', 'D', '42501 no autorizado'),
  ('OWN_C',    'projects', 'D', '42501 no autorizado'),
  ('SINAPP',   'projects', 'D', '42501 no autorizado'),
  ('CLI',      'projects', 'D', '42501 no autorizado'),
  ('ANON',     'projects', 'D', '42501 no autorizado'),
  -- empresa C, con hueco: para quien no está en su alcance, la MISMA respuesta
  ('OWN_C',    'projects', 'C', 'insertado'),
  ('SINAPP',   'projects', 'C', '42501 no autorizado'),
  ('CLI',      'projects', 'C', '42501 no autorizado'),
  ('ANON',     'projects', 'C', '42501 no autorizado'),
  -- unidades: D en su tope (1 de 1)
  ('OWN_D',    'unidades', 'D', '23514 plan_limit_reached: max_units = 1 (actual: 1)%'),
  ('ADM_D',    'unidades', 'D', '23514 plan_limit_reached: max_units = 1 (actual: 1)%'),
  ('OPE_D',    'unidades', 'D', '23514 plan_limit_reached: max_units = 1 (actual: 1)%'),
  ('SA',       'unidades', 'D', 'insertado'),
  ('SERVICIO', 'unidades', 'D', '23514 plan_limit_reached: max_units = 1 (actual: 1)%'),
  ('SISTEMA',  'unidades', 'D', '23514 plan_limit_reached: max_units = 1 (actual: 1)%'),
  ('OP_C',     'unidades', 'D', '42501 no autorizado'),
  ('SINAPP',   'unidades', 'D', '42501 no autorizado'),
  ('CLI',      'unidades', 'D', '42501 no autorizado'),
  ('ANON',     'unidades', 'D', '42501 no autorizado'),
  ('SINAPP',   'unidades', 'C', '42501 no autorizado'),
  ('ANON',     'unidades', 'C', '42501 no autorizado');

DO $$
DECLARE e record; v_sql text; v text; v_n int := 0;
BEGIN
  FOR e IN SELECT * FROM tope_esperado ORDER BY tabla, empresa, actor LOOP
    v_sql := CASE e.tabla
      WHEN 'projects' THEN format('INSERT INTO public.projects (company_id, nombre) VALUES (%L, %L)', fos.id(e.empresa), 'tope ' || e.actor)
      ELSE format('INSERT INTO public.unidades (project_id, company_id, nombre) VALUES (%L, %L, %L)',
                  fos.id(e.empresa || '1'), fos.id(e.empresa), 'tope ' || e.actor)
    END;
    v := fos.intento(e.actor, v_sql);
    v_n := v_n + 1;
    IF v NOT LIKE e.esperado THEN
      PERFORM fos.falla(format('TOPE %s · INSERT en %s de %s: «%s» (se esperaba «%s»)', e.actor, e.tabla, e.empresa, left(v, 90), e.esperado));
    ELSE
      RAISE NOTICE '✓ % · INSERT en % de % → %', e.actor, e.tabla, e.empresa, left(v, 70);
    END IF;
  END LOOP;
  RAISE NOTICE '✓ % intentos de INSERT comprobados', v_n;
END $$;

DROP TABLE tope_esperado;
