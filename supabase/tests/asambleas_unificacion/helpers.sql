-- ============================================================================
-- AYUDAS DE LA SUITE «asambleas_unificacion» (20261106000300)
--
-- Las cargan los dos padrones (fixture_antes.sql, sobre la base de ANTES, y
-- fixture.sql, sobre la de después). Todo vive en el esquema «au».
-- ============================================================================
\set ON_ERROR_STOP on

CREATE SCHEMA au;
GRANT USAGE ON SCHEMA au TO PUBLIC;

CREATE TABLE au.ids (alias text PRIMARY KEY, id uuid NOT NULL UNIQUE);
GRANT SELECT ON au.ids TO PUBLIC;

CREATE FUNCTION au.id(p_alias text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM au.ids WHERE alias = p_alias $$;

INSERT INTO au.ids (alias, id) VALUES
  ('A',  'a0000000-0000-0000-0000-00000000000a'),
  ('B',  'a0000000-0000-0000-0000-00000000000b'),
  ('PU', 'a1000000-0000-0000-0000-000000000001'),
  ('PX', 'a1000000-0000-0000-0000-000000000002'),
  ('B1', 'a1000000-0000-0000-0000-0000000000b1'),
  ('ADM_A', 'a2000000-0000-0000-0000-00000000000a'),
  ('ACT_A', 'a2000000-0000-0000-0000-000000000001'),
  ('VSA_A', 'a2000000-0000-0000-0000-000000000002'),
  ('VAC_A', 'a2000000-0000-0000-0000-000000000003'),
  ('ADM_B', 'a2000000-0000-0000-0000-00000000000b'),
  ('SIN',   'a2000000-0000-0000-0000-000000000004'),
  ('R_ACT', 'a2100000-0000-0000-0000-000000000001'),
  ('R_VSA', 'a2100000-0000-0000-0000-000000000002'),
  ('R_VAC', 'a2100000-0000-0000-0000-000000000003'),
  ('P1', 'a3000000-0000-0000-0000-000000000001'),
  ('P2', 'a3000000-0000-0000-0000-000000000002'),
  ('P3', 'a3000000-0000-0000-0000-000000000003'),
  ('P4', 'a3000000-0000-0000-0000-000000000004'),
  ('X1', 'a3000000-0000-0000-0000-000000000011'),
  ('UB', 'a3000000-0000-0000-0000-0000000000b1'),
  -- asambleas (y las digitales de antes, que conservan su id)
  ('A_FIN',  'a4000000-0000-0000-0000-000000000001'),
  ('A_FIN2', 'a4000000-0000-0000-0000-000000000002'),
  ('A_CUR',  'a4000000-0000-0000-0000-000000000003'),
  ('A_PROG', 'a4000000-0000-0000-0000-000000000004'),
  ('A_CAN',  'a4000000-0000-0000-0000-000000000005'),
  ('X_FIN',  'a4000000-0000-0000-0000-000000000011'),
  ('B_FIN',  'a4000000-0000-0000-0000-0000000000b1'),
  ('D_FIN',  'a4000000-0000-0000-0000-0000000000d1'),
  ('D_PROG', 'a4000000-0000-0000-0000-0000000000d2'),
  ('D_CUR',  'a4000000-0000-0000-0000-0000000000d3'),
  -- puntos
  ('F_SI',   'a5000000-0000-0000-0000-000000000001'),
  ('F_NO',   'a5000000-0000-0000-0000-000000000002'),
  ('F_INFO', 'a5000000-0000-0000-0000-000000000003'),
  -- actas
  ('ACTA_SUELTA', 'a6000000-0000-0000-0000-000000000001'),
  ('ACTA_FIN2',   'a6000000-0000-0000-0000-000000000002'),
  -- votaciones
  ('V_ABIERTA',  'a7000000-0000-0000-0000-000000000001'),
  ('V_EMPATE',   'a7000000-0000-0000-0000-000000000002'),
  ('V_SINQ',     'a7000000-0000-0000-0000-000000000003'),
  ('V_SINVOTOS', 'a7000000-0000-0000-0000-000000000004'),
  ('V_CERRADA',  'a7000000-0000-0000-0000-000000000005'),
  ('V_ANULADA',  'a7000000-0000-0000-0000-000000000006'),
  ('V_B',        'a7000000-0000-0000-0000-0000000000b1');

-- ── Comprobaciones ──────────────────────────────────────────────────────────
CREATE FUNCTION au.chk(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE FUNCTION au.como(p_alias text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', au.id(p_alias)::text, false);
END;
$$;

-- '<sqlstate>:<etiqueta>' de un error: la restricción que falló o lo que el
-- mensaje trae antes de «:» (VOTO_OPCION, ACTA_ASAMBLEA…).
CREATE FUNCTION au.etiqueta(p_state text, p_msg text, p_con text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT p_state || ':' || CASE WHEN coalesce(p_con, '') <> '' THEN p_con ELSE split_part(p_msg, ':', 1) END
$$;

-- Ejecuta la sentencia con el rol y la identidad de la sesión y la DESHACE
-- siempre. Devuelve 'ok:<filas>' o la etiqueta del error.
CREATE FUNCTION au.prueba(p_sql text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n int := 0; v_state text; v_msg text; v_con text;
BEGIN
  BEGIN
    EXECUTE p_sql USING p_a, p_b;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'AU000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'AU000' THEN RETURN 'ok:' || n;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
      RETURN au.etiqueta(v_state, v_msg, v_con);
  END;
END;
$$;

-- Sólo el SQLSTATE (para los rechazos de RLS, cuyo mensaje no es una etiqueta).
CREATE FUNCTION au.codigo(p_sql text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL)
RETURNS text LANGUAGE sql AS $$ SELECT split_part(au.prueba(p_sql, p_a, p_b), ':', 1) $$;

-- Ejecuta `p_cambio`, después devuelve lo que da `p_consulta` (una fila, una
-- columna, como texto) y lo DESHACE todo. Si el cambio falla, la etiqueta.
CREATE FUNCTION au.tras(p_cambio text, p_consulta text, p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v text; v_state text; v_msg text; v_con text;
BEGIN
  BEGIN
    EXECUTE p_cambio USING p_a, p_b;
    EXECUTE p_consulta INTO v USING p_a, p_b;
    RAISE EXCEPTION USING ERRCODE = 'AU000', MESSAGE = 'deshacer';
  EXCEPTION
    WHEN SQLSTATE 'AU000' THEN RETURN v;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
      RETURN au.etiqueta(v_state, v_msg, v_con);
  END;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA au TO PUBLIC;
