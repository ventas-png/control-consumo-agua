-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261130000000_agua_historial_lecturas, ejercidas COMO cada
-- persona (SET ROLE authenticated + app.uid): la RLS es la de verdad.
--
--   A · catálogo: RLS encendida, ACL, la RPC no la ejecuta anon
--   B · importación: por número de serie en el proyecto, todo o nada,
--       re-importar reemplaza, lectura inicial sólo cuando corresponde
--   C · quién: alcance por proyecto, empresa ajena, cuenta sin permisos
--   D · integridad: el proyecto/empresa salen del contador, no cambia de
--       contador, no se toca `registros`
--
-- Personas (registrar_lectura/fixture.sql):
--   Ada   · company_owner de ACME          Lucía · captura en Uno (lecturas.create+view)
--   Beto  · captura en Uno sin poder ver   Nadia · dueña de la empresa vecina
--   Curro · de ACME, sin asignaciones ni permisos
-- Contadores: M-1 (inicial 100, instalado 2026-01-15) · M-2 (0, 2026-02-01)
--   · M-3 (ya tiene una lectura del sistema) · M-4 (0) · M-5 en Dos · M-9 de la
--   vecina · DUP-7 / «dup-7 » dos con el mismo número.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SET client_min_messages = notice;

CREATE SCHEMA ht;
GRANT USAGE ON SCHEMA ht TO authenticated, anon;

CREATE FUNCTION ht.ok(p_nombre text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN RAISE EXCEPTION 'FALLO %', p_nombre; END IF;
  RAISE NOTICE 'OK    %', p_nombre;
END $$;

-- Verdad de terreno: corren como postgres, saltan la RLS.
CREATE FUNCTION ht.filas(p_contador uuid) RETURNS int LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*)::int FROM public.agua_historial_lecturas WHERE contador_id = p_contador $$;
CREATE FUNCTION ht.inicial(p_contador uuid) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT lectura_inicial FROM public.contadores WHERE id = p_contador $$;
CREATE FUNCTION ht.fila(p_contador uuid, p_fecha date) RETURNS public.agua_historial_lecturas
  LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT * FROM public.agua_historial_lecturas WHERE contador_id = p_contador AND fecha = p_fecha $$;
CREATE FUNCTION ht.registros() RETURNS int LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*)::int FROM public.registros $$;

-- Corre una sentencia y devuelve «SQLSTATE: mensaje», o «sin error». El bloque
-- con EXCEPTION es una subtransacción: si falla, no deja nada escrito.
CREATE FUNCTION ht.error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'sin error';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ': ' || SQLERRM;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ht TO authenticated, anon;

-- ── A · catálogo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM ht.ok('A1 RLS encendida en agua_historial_lecturas, con policies de lectura y de escritura',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.agua_historial_lecturas'::regclass)
    AND (SELECT count(*) = 4 FROM pg_policies WHERE tablename = 'agua_historial_lecturas'));
  PERFORM ht.ok('A2 anon no toca la tabla ni ejecuta la importación',
    NOT has_table_privilege('anon', 'public.agua_historial_lecturas', 'SELECT')
    AND NOT has_function_privilege('anon', 'public.agua_historial_lecturas_importar(uuid, jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.agua_historial_lecturas_importar(uuid, jsonb)', 'EXECUTE'));
  PERFORM ht.ok('A3 la importación corre con los permisos de quien importa (SECURITY INVOKER)',
    NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.agua_historial_lecturas_importar(uuid, jsonb)'::regprocedure));
END $$;

-- ── B · importación, como Ada (dueña de ACME) ───────────────────────────────
SET ROLE authenticated;
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', false) \g /dev/null

DO $$
DECLARE
  P1 constant uuid := '11111111-0000-0000-0000-000000000001';
  M1 constant uuid := 'c0000000-0000-0000-0000-000000000001';
  M2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
  M3 constant uuid := 'c0000000-0000-0000-0000-000000000003';
  M4 constant uuid := 'c0000000-0000-0000-0000-000000000004';
  r  jsonb;
  f  public.agua_historial_lecturas;
BEGIN
  r := public.agua_historial_lecturas_importar(P1, jsonb_build_array(
    jsonb_build_object('fila', 2, 'contador', 'M-1',   'fecha', '2025-10-31', 'lectura', 120),
    jsonb_build_object('fila', 3, 'contador', ' m-1 ', 'fecha', '2025-11-30', 'lectura', 150),
    jsonb_build_object('fila', 4, 'contador', 'M-1',   'fecha', '2025-12-31', 'lectura', 180, 'consumo', 30),
    jsonb_build_object('fila', 5, 'contador', 'M-2',   'fecha', '2026-02-28', 'lectura', 10),
    jsonb_build_object('fila', 6, 'contador', 'M-2',   'fecha', '2026-03-31', 'lectura', 25, 'notas', '  cambio de llave '),
    jsonb_build_object('fila', 7, 'contador', 'M-3',   'fecha', '2026-01-31', 'lectura', 30),
    jsonb_build_object('fila', 8, 'contador', 'M-4',   'fecha', '2026-02-28', 'consumo', 7)
  ));
  PERFORM ht.ok('B1 importa 7 filas de 4 contadores, buscando el número sin distinguir mayúsculas ni espacios',
    (r->>'filas')::int = 7 AND (r->>'insertadas')::int = 7 AND (r->>'actualizadas')::int = 0
    AND (r->>'contadores')::int = 4 AND ht.filas(M1) = 3 AND ht.filas(M2) = 2);

  f := ht.fila(M2, '2026-03-31');
  PERFORM ht.ok('B2 cada fila queda con el proyecto y la empresa del contador, sellada por quien importa, notas limpias',
    f.project_id = P1 AND f.company_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
    AND f.creado_por = 'e0000000-0000-0000-0000-00000000000d' AND f.notas = 'cambio de llave');
  f := ht.fila(M4, '2026-02-28');
  PERFORM ht.ok('B3 una fila sólo con consumo es válida (la lectura queda vacía)', f.lectura IS NULL AND f.consumo = 7);

  PERFORM ht.ok('B4 lectura inicial: M-2 (sin lecturas) pasa a la última del historial (25), y el resumen dice cuál',
    ht.inicial(M2) = 25 AND (r #>> '{lectura_inicial,actualizadas}')::int = 1
    AND r #> '{lectura_inicial,contadores}' = jsonb_build_array(jsonb_build_object('id', M2, 'lectura_inicial', 25)));
  PERFORM ht.ok('B5 lectura inicial: M-1 no cambia — su historial es anterior a la instalación',
    ht.inicial(M1) = 100 AND (r #>> '{lectura_inicial,anteriores_a_instalacion}')::int = 1);
  PERFORM ht.ok('B6 lectura inicial: M-3 no cambia — ya tiene lecturas en el sistema',
    ht.inicial(M3) = 0 AND (r #>> '{lectura_inicial,con_lecturas}')::int = 1);

  -- Re-importar la misma fecha reemplaza, no duplica.
  r := public.agua_historial_lecturas_importar(P1, jsonb_build_array(
    jsonb_build_object('contador', 'M-2', 'fecha', '2026-03-31', 'lectura', 26)));
  PERFORM ht.ok('B7 re-importar la misma fecha reemplaza la fila (sin duplicar) y la base sube a 26',
    (r->>'insertadas')::int = 0 AND (r->>'actualizadas')::int = 1 AND ht.filas(M2) = 2
    AND (ht.fila(M2, '2026-03-31')).lectura = 26 AND (ht.fila(M2, '2026-03-31')).notas IS NULL
    AND ht.inicial(M2) = 26);

  -- Una lectura posterior MÁS BAJA (medidor reiniciado o cambiado) no baja la base.
  r := public.agua_historial_lecturas_importar(P1, jsonb_build_array(
    jsonb_build_object('contador', 'M-2', 'fecha', '2026-04-30', 'lectura', 3)));
  PERFORM ht.ok('B8 la lectura inicial sólo sube: una última lectura más baja no la toca',
    ht.inicial(M2) = 26 AND (r #>> '{lectura_inicial,menores}')::int = 1
    AND (r #>> '{lectura_inicial,actualizadas}')::int = 0);
END $$;

DO $$
DECLARE
  P1 constant uuid := '11111111-0000-0000-0000-000000000001';
  M2 constant uuid := 'c0000000-0000-0000-0000-000000000002';
  e  text;
  n  int := ht.filas('c0000000-0000-0000-0000-000000000002');
BEGIN
  e := ht.error(format($q$SELECT public.agua_historial_lecturas_importar(%L, %L::jsonb)$q$, P1,
    '[{"fila":2,"contador":"M-2","fecha":"2026-05-31","lectura":40},
      {"fila":3,"contador":"NOPE","fecha":"2026-05-31","lectura":1}]'));
  PERFORM ht.ok('B9 todo o nada: una fila con contador desconocido rechaza el lote y no escribe la válida',
    e LIKE '22023:%fila 3: el contador «NOPE» no existe en el proyecto%' AND ht.filas(M2) = n
    AND ht.fila(M2, '2026-05-31') IS NULL);

  e := ht.error(format($q$SELECT public.agua_historial_lecturas_importar(%L, %L::jsonb)$q$, P1,
    '[{"fila":2,"contador":"DUP-7","fecha":"2026-05-31","lectura":1}]'));
  PERFORM ht.ok('B10 un número de serie repetido en el proyecto es ambiguo: se rechaza', e LIKE '%fila 2: hay 2 contadores «DUP-7»%');

  e := ht.error(format($q$SELECT public.agua_historial_lecturas_importar(%L, %L::jsonb)$q$, P1,
    '[{"fila":2,"contador":"M-5","fecha":"2026-05-31","lectura":1}]'));
  PERFORM ht.ok('B11 un contador de OTRO proyecto no se encuentra en el elegido', e LIKE '%fila 2: el contador «M-5» no existe en el proyecto%');

  e := ht.error(format($q$SELECT public.agua_historial_lecturas_importar(%L, %L::jsonb)$q$, P1,
    '[{"fila":2,"contador":"M-2","fecha":"2026-06-30","lectura":41},
      {"fila":3,"contador":"m-2","fecha":"2026-06-30","lectura":42}]'));
  PERFORM ht.ok('B12 la misma fecha del mismo contador dos veces en el lote se rechaza', e LIKE '%fila 3: fecha 2026-06-30 repetida%');

  e := ht.error(format($q$SELECT public.agua_historial_lecturas_importar(%L, %L::jsonb)$q$, P1,
    jsonb_build_array(
      jsonb_build_object('fila', 2, 'contador', 'M-2', 'fecha', (current_date + 30)::text, 'lectura', 50),
      jsonb_build_object('fila', 3, 'contador', 'M-2', 'fecha', '2026-07-31', 'lectura', -5),
      jsonb_build_object('fila', 4, 'contador', 'M-2', 'fecha', '2026-08-31'),
      jsonb_build_object('fila', 5, 'contador', 'M-2', 'fecha', '31/08/2026', 'lectura', 9))::text));
  PERFORM ht.ok('B13 fecha futura, lectura negativa, fila sin dato y fecha mal escrita: cada una con su número de fila',
    e LIKE '%4 fila(s) con error%' AND e LIKE '%fila 2: la fecha%está en el futuro%'
    AND e LIKE '%fila 3: lectura inválida «-5»%' AND e LIKE '%fila 4: falta la lectura o el consumo%'
    AND e LIKE '%fila 5: fecha inválida «31/08/2026»%');

  PERFORM ht.ok('B14 la importación no crea ni toca lecturas del sistema (registros)', ht.registros() = 1);
END $$;

-- ── C · quién puede ─────────────────────────────────────────────────────────
-- Lucía: captura en Uno (lecturas.create), NO edita contadores.
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000001', false) \g /dev/null
DO $$
DECLARE
  M4 constant uuid := 'c0000000-0000-0000-0000-000000000004';
  r  jsonb;
  e  text;
BEGIN
  r := public.agua_historial_lecturas_importar('11111111-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('contador', 'M-4', 'fecha', '2026-03-31', 'lectura', 12)));
  PERFORM ht.ok('C1 quien captura en el proyecto importa; si no puede editar contadores la base no cambia y se dice',
    (r->>'insertadas')::int = 1 AND ht.inicial(M4) = 0
    AND (r #>> '{lectura_inicial,sin_permiso}')::int = 1 AND (r #>> '{lectura_inicial,actualizadas}')::int = 0);

  e := ht.error($q$SELECT public.agua_historial_lecturas_importar('11111111-0000-0000-0000-000000000002',
    '[{"contador":"M-5","fecha":"2026-03-31","lectura":5}]'::jsonb)$q$);
  PERFORM ht.ok('C2 no importa en un proyecto que no tiene asignado (RLS)',
    e LIKE '42501:%' AND ht.filas('c0000000-0000-0000-0000-000000000005') = 0);

  PERFORM ht.ok('C3 ve el historial de su proyecto', (SELECT count(*) > 0 FROM public.agua_historial_lecturas));
END $$;

-- Beto: captura en Uno pero NO puede ver lecturas.
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000002', false) \g /dev/null
DO $$
DECLARE r jsonb;
BEGIN
  r := public.agua_historial_lecturas_importar('11111111-0000-0000-0000-000000000001', jsonb_build_array(
    jsonb_build_object('contador', 'M-4', 'fecha', '2026-04-30', 'lectura', 20)));
  PERFORM ht.ok('C4 quien sólo captura también importa (y ve lo que escribe para que el ON CONFLICT funcione)',
    (r->>'insertadas')::int = 1);
END $$;

-- Nadia: dueña de la empresa vecina.
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000003', false) \g /dev/null
DO $$
DECLARE e text;
BEGIN
  e := ht.error($q$SELECT public.agua_historial_lecturas_importar('11111111-0000-0000-0000-000000000001',
    '[{"contador":"M-1","fecha":"2026-04-30","lectura":500}]'::jsonb)$q$);
  PERFORM ht.ok('C5 otra empresa no encuentra los contadores de ACME (ni por número)', e LIKE '%el contador «M-1» no existe en el proyecto%');

  e := ht.error($q$INSERT INTO public.agua_historial_lecturas (contador_id, fecha, lectura)
    VALUES ('c0000000-0000-0000-0000-000000000001', '2025-09-30', 500)$q$);
  PERFORM ht.ok('C6 ni escribiendo directo en la tabla con el id de un contador ajeno (RLS)',
    e LIKE '42501:%' AND ht.fila('c0000000-0000-0000-0000-000000000001', '2025-09-30') IS NULL);

  PERFORM ht.ok('C7 y no ve el historial de ACME', (SELECT count(*) = 0 FROM public.agua_historial_lecturas));
END $$;

-- Curro: de ACME, sin asignaciones ni permisos.
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-000000000004', false) \g /dev/null
DO $$
DECLARE e text;
BEGIN
  e := ht.error($q$SELECT public.agua_historial_lecturas_importar('11111111-0000-0000-0000-000000000001',
    '[{"contador":"M-1","fecha":"2025-09-30","lectura":100}]'::jsonb)$q$);
  PERFORM ht.ok('C8 una cuenta sin permisos de agua no importa', e LIKE '42501:%');
  PERFORM ht.ok('C9 ni ve el historial', (SELECT count(*) = 0 FROM public.agua_historial_lecturas));
END $$;

-- ── D · integridad, como Ada ────────────────────────────────────────────────
SELECT set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', false) \g /dev/null
DO $$
DECLARE
  M1 constant uuid := 'c0000000-0000-0000-0000-000000000001';
  f  public.agua_historial_lecturas;
  e  text;
BEGIN
  INSERT INTO public.agua_historial_lecturas (contador_id, fecha, lectura, project_id, company_id)
  VALUES (M1, '2025-09-30', 100, '11111111-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000b');
  f := ht.fila(M1, '2025-09-30');
  PERFORM ht.ok('D1 el proyecto y la empresa los decide el contador, no quien escribe',
    f.project_id = '11111111-0000-0000-0000-000000000001' AND f.company_id = 'aaaaaaaa-0000-0000-0000-00000000000a');

  e := ht.error(format($q$UPDATE public.agua_historial_lecturas SET contador_id = %L WHERE id = %L$q$,
    'c0000000-0000-0000-0000-000000000002', f.id));
  PERFORM ht.ok('D2 una fila no cambia de contador', e LIKE '%AGUA_HISTORIAL_INMUTABLE%');

  e := ht.error(format($q$INSERT INTO public.agua_historial_lecturas (contador_id, fecha) VALUES (%L, '2025-08-31')$q$, M1));
  PERFORM ht.ok('D3 una fila sin lectura ni consumo no existe', e LIKE '23514:%');

  PERFORM ht.ok('D4 nada de esto creó cobros: registros sigue con su única lectura', ht.registros() = 1);
END $$;

RESET ROLE;
