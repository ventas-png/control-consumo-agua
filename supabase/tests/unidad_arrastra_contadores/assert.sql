-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261204000000_unidad_proyecto_arrastra_contadores.
--
--   A · catálogo: los dos triggers existen; sus funciones no son RPC
--   B · corrección: el contador que ya estaba desfasado quedó en el proyecto
--       de su unidad, con su historial
--   C · mover la unidad arrastra sus contadores y su historial, aunque quien
--       la mueve no pueda editar contadores; la carga masiva los encuentra en
--       el proyecto nuevo y ya no en el viejo
--   D · `registros` no se toca
--   E · cambiar el contador de unidad también arrastra su historial
--   F · cambio de empresa
--
-- Personas (registrar_lectura/fixture.sql): Ada · company_owner de ACME ·
--   Lucía · viewer de ACME, sin `agua.contadores.edit`.
-- Unidades: Casa 1 (M-1, M-3 con una lectura del sistema, M-4) y Casa 2 (M-2)
--   en Condominio Uno; Casa 3 (M-6) movida a Condominio Dos antes de la migración.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE SCHEMA ut;
GRANT USAGE ON SCHEMA ut TO authenticated, anon;

CREATE FUNCTION ut.ok(p_nombre text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALLO %', p_nombre; END IF;
  RAISE NOTICE 'OK    %', p_nombre;
END $$;

-- Verdad de terreno: corren como postgres, saltan la RLS.
CREATE FUNCTION ut.proyecto(p_contador uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT project_id FROM public.contadores WHERE id = p_contador $$;
CREATE FUNCTION ut.empresa(p_contador uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT company_id FROM public.contadores WHERE id = p_contador $$;
-- Filas de historial del contador que NO están en el proyecto/empresa dados.
CREATE FUNCTION ut.hist_fuera(p_contador uuid, p_project uuid, p_company uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*)::int FROM public.agua_historial_lecturas
      WHERE contador_id = p_contador AND (project_id <> p_project OR company_id <> p_company) $$;
CREATE FUNCTION ut.hist(p_contador uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*)::int FROM public.agua_historial_lecturas WHERE contador_id = p_contador $$;
CREATE FUNCTION ut.registros() RETURNS text LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT string_agg(id || '|' || project_id || '|' || contador_id, ',' ORDER BY id) FROM public.registros $$;
CREATE FUNCTION ut.error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ': ' || SQLERRM;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ut TO authenticated, anon;

CREATE TABLE ut.antes AS SELECT ut.registros() AS registros;
GRANT SELECT ON ut.antes TO authenticated;

-- ── A · catálogo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM ut.ok('A1 los triggers de arrastre existen en unidades y en contadores',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_unidades_arrastra_contadores' AND tgrelid = 'public.unidades'::regclass)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_contadores_arrastra_historial' AND tgrelid = 'public.contadores'::regclass));
  PERFORM ut.ok('A2 sus funciones no se pueden llamar como RPC (ni anon ni authenticated)',
    NOT has_function_privilege('anon', 'public.unidad_arrastra_contadores()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.unidad_arrastra_contadores()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.contador_arrastra_historial()', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.contador_arrastra_historial()', 'EXECUTE'));
END $$;

-- ── B · corrección de lo ya desfasado ───────────────────────────────────────
DO $$
DECLARE
  ACME constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1 constant uuid := '11111111-0000-0000-0000-000000000001';
  P2 constant uuid := '11111111-0000-0000-0000-000000000002';
  M6 constant uuid := 'c0000000-0000-0000-0000-000000000006';
BEGIN
  PERFORM ut.ok('B1 M-6 (su unidad ya estaba en Dos) pasa a Condominio Dos', ut.proyecto(M6) = P2);
  PERFORM ut.ok('B2 su historial lo sigue: ninguna fila queda en Uno', ut.hist(M6) = 2 AND ut.hist_fuera(M6, P2, ACME) = 0);
  PERFORM ut.ok('B3 los contadores que estaban bien no se movieron',
    ut.proyecto('c0000000-0000-0000-0000-000000000001') = P1
    AND ut.proyecto('c0000000-0000-0000-0000-000000000002') = P1
    AND ut.proyecto('c0000000-0000-0000-0000-000000000005') = P2
    AND ut.proyecto('c0000000-0000-0000-0000-000000000009') = '22222222-0000-0000-0000-000000000001');
  PERFORM ut.ok('B4 ningún contador con unidad queda en un proyecto distinto al de su unidad',
    NOT EXISTS (SELECT 1 FROM public.contadores c JOIN public.unidades u ON u.id = c.unidad_id
                 WHERE c.project_id IS DISTINCT FROM u.project_id));
END $$;

-- ── C · mover la unidad, como Lucía (no puede editar contadores) ────────────
SET ROLE authenticated;
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000001', false) \g /dev/null

DO $$
DECLARE
  ACME constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1 constant uuid := '11111111-0000-0000-0000-000000000001';
  P2 constant uuid := '11111111-0000-0000-0000-000000000002';
  M2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
  n  int;
BEGIN
  UPDATE public.contadores SET numero_serie = 'M-2x' WHERE id = M2;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM ut.ok('C0 (premisa) Lucía no puede editar el contador M-2 directamente', n = 0);

  UPDATE public.unidades SET nombre = 'Casa 2 bis' WHERE id = 'd1000000-0000-0000-0000-000000000002';
  PERFORM ut.ok('C1 editar la unidad sin cambiarle el proyecto no mueve nada',
    ut.proyecto(M2) = P1 AND ut.hist_fuera(M2, P1, ACME) = 0);

  UPDATE public.unidades SET project_id = P2 WHERE id = 'd1000000-0000-0000-0000-000000000002';
  PERFORM ut.ok('C2 mover Casa 2 a Condominio Dos arrastra su contador M-2, aunque quien la mueve no pueda editarlo',
    ut.proyecto(M2) = P2 AND ut.empresa(M2) = ACME);
  PERFORM ut.ok('C3 el historial de M-2 lo sigue', ut.hist(M2) = 1 AND ut.hist_fuera(M2, P2, ACME) = 0);
END $$;

-- La carga masiva, como Ada: encuentra a M-2 en Dos y ya no en Uno.
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', false) \g /dev/null
DO $$
DECLARE
  P1 constant uuid := '11111111-0000-0000-0000-000000000001';
  P2 constant uuid := '11111111-0000-0000-0000-000000000002';
  M2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
  r  jsonb;
  e  text;
BEGIN
  r := public.agua_historial_lecturas_importar(P2, jsonb_build_array(
    jsonb_build_object('fila', 2, 'contador', 'M-2', 'fecha', '2026-01-31', 'lectura', 9)));
  PERFORM ut.ok('C4 la carga masiva del historial reconoce a M-2 en su proyecto nuevo',
    (r->>'insertadas')::int = 1 AND ut.hist(M2) = 2);
  e := ut.error(format($q$SELECT public.agua_historial_lecturas_importar(%L, '[{"fila":2,"contador":"M-2","fecha":"2026-02-28","lectura":12}]'::jsonb)$q$, P1));
  PERFORM ut.ok('C5 …y ya no lo acepta en el proyecto viejo', e <> 'sin error' AND ut.hist(M2) = 2);
END $$;

-- ── D · una unidad con varios contadores y lecturas cobradas ────────────────
DO $$
DECLARE
  ACME constant uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1 constant uuid := '11111111-0000-0000-0000-000000000001';
  P2 constant uuid := '11111111-0000-0000-0000-000000000002';
  M1 constant uuid := 'c0000000-0000-0000-0000-000000000001';
  M3 constant uuid := 'c0000000-0000-0000-0000-000000000003';
  M4 constant uuid := 'c0000000-0000-0000-0000-000000000004';
BEGIN
  -- E antes de mover Casa 1: M-4 cambia de unidad (a Casa 3, que está en Dos).
  -- El UPDATE sólo nombra `unidad_id`: el proyecto lo cambia el trigger BEFORE.
  UPDATE public.contadores SET unidad_id = 'd1000000-0000-0000-0000-000000000003' WHERE id = M4;
  PERFORM ut.ok('E1 cambiar un contador a una unidad de otro proyecto lo pasa a ese proyecto',
    ut.proyecto(M4) = P2);
  PERFORM ut.ok('E2 …y su historial lo sigue, aunque el UPDATE no nombrara project_id',
    ut.hist(M4) = 1 AND ut.hist_fuera(M4, P2, ACME) = 0);

  UPDATE public.unidades SET project_id = P2 WHERE id = 'd1000000-0000-0000-0000-000000000001';
  PERFORM ut.ok('D1 mover Casa 1 arrastra TODOS sus contadores (M-1 y M-3)',
    ut.proyecto(M1) = P2 AND ut.proyecto(M3) = P2);
  PERFORM ut.ok('D2 el historial de M-3 lo sigue', ut.hist_fuera(M3, P2, ACME) = 0);
  PERFORM ut.ok('D3 `registros` no se toca: la lectura cobrada de M-3 conserva su proyecto',
    ut.registros() = (SELECT registros FROM ut.antes) AND ut.registros() LIKE '%|' || P1 || '|' || M3 || '%');
END $$;

-- ── F · cambio de empresa (operación de plataforma, como postgres) ──────────
RESET ROLE;
SELECT set_config('app.uid', '', false) \g /dev/null
DO $$
DECLARE
  OTRA  constant uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  AJENO constant uuid := '22222222-0000-0000-0000-000000000001';
  M6 constant uuid := 'c0000000-0000-0000-0000-000000000006';
  M4 constant uuid := 'c0000000-0000-0000-0000-000000000004';
BEGIN
  UPDATE public.unidades SET project_id = AJENO, company_id = OTRA WHERE id = 'd1000000-0000-0000-0000-000000000003';
  PERFORM ut.ok('F1 si la unidad cambia de empresa, sus contadores cambian de proyecto Y de empresa',
    ut.proyecto(M6) = AJENO AND ut.empresa(M6) = OTRA AND ut.proyecto(M4) = AJENO AND ut.empresa(M4) = OTRA);
  PERFORM ut.ok('F2 …y el historial también', ut.hist_fuera(M6, AJENO, OTRA) = 0 AND ut.hist_fuera(M4, AJENO, OTRA) = 0);
  PERFORM ut.ok('F3 al final, ningún contador ni historial queda fuera del proyecto de su unidad',
    NOT EXISTS (SELECT 1 FROM public.contadores c JOIN public.unidades u ON u.id = c.unidad_id
                 WHERE c.project_id IS DISTINCT FROM u.project_id OR c.company_id IS DISTINCT FROM u.company_id)
    AND NOT EXISTS (SELECT 1 FROM public.agua_historial_lecturas h JOIN public.contadores c ON c.id = h.contador_id
                     WHERE h.project_id IS DISTINCT FROM c.project_id OR h.company_id IS DISTINCT FROM c.company_id));
END $$;
