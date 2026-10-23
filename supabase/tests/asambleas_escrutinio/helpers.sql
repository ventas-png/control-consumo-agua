-- ============================================================================
-- AYUDAS DE LA SUITE «asambleas_escrutinio» (20261106000200)
--
-- Las cargan los dos padrones (fixture_antes.sql, sobre la base de ANTES, y
-- fixture.sql, sobre la de después). Todo vive en el esquema «ae».
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA ae;
GRANT USAGE ON SCHEMA ae TO PUBLIC;

CREATE TABLE ae.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON ae.ids TO PUBLIC;

CREATE FUNCTION ae.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM ae.ids WHERE alias = p_alias $$;

INSERT INTO ae.ids (alias, id) VALUES
  -- empresas, proyectos
  ('A',  'e0000000-0000-0000-0000-00000000000a'),
  ('B',  'e0000000-0000-0000-0000-00000000000b'),
  ('C',  'e0000000-0000-0000-0000-00000000000c'),
  ('PU', 'e1000000-0000-0000-0000-000000000001'),
  ('PA', 'e1000000-0000-0000-0000-000000000002'),
  ('PZ', 'e1000000-0000-0000-0000-000000000003'),
  ('B1', 'e1000000-0000-0000-0000-0000000000b1'),
  ('C1', 'e1000000-0000-0000-0000-0000000000c1'),
  -- personas y roles
  ('ADM_A', 'e2000000-0000-0000-0000-00000000000a'),
  ('EDT_A', 'e2000000-0000-0000-0000-000000000001'),
  ('VER_A', 'e2000000-0000-0000-0000-000000000002'),
  ('NOP_A', 'e2000000-0000-0000-0000-000000000003'),
  ('ADM_B', 'e2000000-0000-0000-0000-00000000000b'),
  ('ADM_C', 'e2000000-0000-0000-0000-00000000000c'),
  ('REG',   'e2000000-0000-0000-0000-000000000004'),
  ('SIN',   'e2000000-0000-0000-0000-000000000005'),
  ('R_EDT', 'e2100000-0000-0000-0000-000000000001'),
  ('R_VER', 'e2100000-0000-0000-0000-000000000002'),
  -- unidades
  ('P1', 'e3000000-0000-0000-0000-000000000001'),
  ('P2', 'e3000000-0000-0000-0000-000000000002'),
  ('P3', 'e3000000-0000-0000-0000-000000000003'),
  ('P4', 'e3000000-0000-0000-0000-000000000004'),
  ('P5', 'e3000000-0000-0000-0000-000000000005'),
  ('P6', 'e3000000-0000-0000-0000-000000000006'),
  ('L1', 'e3000000-0000-0000-0000-000000000011'),
  ('L2', 'e3000000-0000-0000-0000-000000000012'),
  ('L3', 'e3000000-0000-0000-0000-000000000013'),
  ('L4', 'e3000000-0000-0000-0000-000000000014'),
  ('L5', 'e3000000-0000-0000-0000-000000000015'),
  ('Z1', 'e3000000-0000-0000-0000-000000000021'),
  ('Z2', 'e3000000-0000-0000-0000-000000000022'),
  ('UB1','e3000000-0000-0000-0000-0000000000b1'),
  ('UC1','e3000000-0000-0000-0000-0000000000c1'),
  -- asambleas
  ('U_PROG', 'e4000000-0000-0000-0000-000000000001'),
  ('U_CUR',  'e4000000-0000-0000-0000-000000000002'),
  ('U_SINQ', 'e4000000-0000-0000-0000-000000000003'),
  ('U_FIN',  'e4000000-0000-0000-0000-000000000004'),
  ('U_CAN',  'e4000000-0000-0000-0000-000000000005'),
  ('A_CUR',  'e4000000-0000-0000-0000-000000000011'),
  ('Z_PROG', 'e4000000-0000-0000-0000-000000000021'),
  ('B_CUR',  'e4000000-0000-0000-0000-0000000000b1'),
  ('C_CUR',  'e4000000-0000-0000-0000-0000000000c1'),
  ('X_CUR',  'e4000000-0000-0000-0000-0000000000f1'),
  ('X_FIN',  'e4000000-0000-0000-0000-0000000000f2'),
  -- puntos
  ('PU_PROG_P',   'e5000000-0000-0000-0000-000000000001'),
  ('UC_SIMPLE',   'e5000000-0000-0000-0000-000000000021'),
  ('UC_ABS',      'e5000000-0000-0000-0000-000000000022'),
  ('UC_CAL',      'e5000000-0000-0000-0000-000000000023'),
  ('UC_CAL80',    'e5000000-0000-0000-0000-000000000024'),
  ('UC_SINVOTOS', 'e5000000-0000-0000-0000-000000000025'),
  ('UC_INFO',     'e5000000-0000-0000-0000-000000000026'),
  ('US_P',        'e5000000-0000-0000-0000-000000000031'),
  ('UF_P',        'e5000000-0000-0000-0000-000000000041'),
  ('A_SIMPLE',    'e5000000-0000-0000-0000-000000000051'),
  ('XC_P',        'e5000000-0000-0000-0000-0000000000f1'),
  ('XC_P2',       'e5000000-0000-0000-0000-0000000000f2'),
  ('XF_P',        'e5000000-0000-0000-0000-0000000000f3'),
  -- asistencias
  ('S_UC_P1',  'e6000000-0000-0000-0000-000000000001'),
  ('S_UC_P2',  'e6000000-0000-0000-0000-000000000002'),
  ('S_UF_P1',  'e6000000-0000-0000-0000-000000000003'),
  ('S_CAN_P1', 'e6000000-0000-0000-0000-000000000004');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION ae.chk(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION ae.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', ae.id(p_alias)::text, false);
END;
$$;

-- Ejecuta la sentencia con el rol y la identidad de la sesión y la DESHACE
-- siempre. Devuelve 'ok:<filas>' o '<sqlstate>:<etiqueta>', donde la
-- etiqueta es la restricción que falló o lo que el mensaje trae antes de «:»
-- (ASAMBLEA_PADRON, ASAMBLEA_ESCRUTINIO…).
CREATE FUNCTION ae.prueba(p_sql text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n       int := 0;
  v_state text;
  v_msg   text;
  v_con   text;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a, p_b;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'AE000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'AE000' THEN RETURN 'ok:' || n;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
      RETURN v_state || ':' || CASE WHEN coalesce(v_con, '') <> '' THEN v_con ELSE split_part(v_msg, ':', 1) END;
  END;
END;
$$;

-- Sólo el SQLSTATE de ae.prueba (para los rechazos de RLS, cuyo mensaje no
-- es una etiqueta).
CREATE FUNCTION ae.codigo(p_sql text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$ SELECT split_part(ae.prueba(p_sql, p_a, p_b), ':', 1) $$;

-- Abre la asamblea y devuelve '<base> <unidades del padrón> <peso total>',
-- o el rechazo como ae.prueba. Siempre deshecho. (plpgsql resuelve las tablas
-- al ejecutar: se puede crear antes de la migración.)
CREATE FUNCTION ae.abrir(p_asamblea text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v       text;
  v_state text;
  v_msg   text;
  v_con   text;
BEGIN
  BEGIN
    UPDATE public.asambleas SET estado = 'en_curso' WHERE id = ae.id(p_asamblea);
    SELECT a.base_votacion || ' ' || count(pa.unidad_id) || ' ' || round(coalesce(sum(pa.peso), 0), 2)
      INTO v
      FROM public.asambleas a LEFT JOIN public.padron_asamblea pa ON pa.asamblea_id = a.id
     WHERE a.id = ae.id(p_asamblea)
     GROUP BY a.base_votacion;
    RAISE EXCEPTION USING ERRCODE = 'AE000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'AE000' THEN RETURN v;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
      RETURN v_state || ':' || CASE WHEN coalesce(v_con, '') <> '' THEN v_con ELSE split_part(v_msg, ':', 1) END;
  END;
END;
$$;

-- Lleva la asamblea a `p_estado` (finalizada por omisión) y devuelve lo que
-- quedó escrito: {escrutinio, quorum_alcanzado, resultados: {alias: resultado}}.
-- Siempre deshecho.
CREATE FUNCTION ae.cerrar(p_asamblea text, p_estado text DEFAULT 'finalizada') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
BEGIN
  BEGIN
    UPDATE public.asambleas SET estado = p_estado WHERE id = ae.id(p_asamblea);
    SELECT jsonb_build_object(
             'escrutinio',       a.escrutinio,
             'quorum_alcanzado', a.quorum_alcanzado,
             'resultados',       (SELECT jsonb_object_agg(i.alias, p.resultado)
                                    FROM public.puntos_asamblea p JOIN ae.ids i ON i.id = p.id
                                   WHERE p.asamblea_id = a.id))
      INTO v
      FROM public.asambleas a WHERE a.id = ae.id(p_asamblea);
    RAISE EXCEPTION USING ERRCODE = 'AE000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'AE000' THEN RETURN v;
  END;
END;
$$;

-- El punto `p_punto` dentro de un escrutinio.
CREATE FUNCTION ae.punto(p_esc jsonb, p_punto text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT e FROM jsonb_array_elements(p_esc -> 'puntos') e WHERE (e ->> 'punto_id')::uuid = ae.id(p_punto)
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ae TO PUBLIC;
