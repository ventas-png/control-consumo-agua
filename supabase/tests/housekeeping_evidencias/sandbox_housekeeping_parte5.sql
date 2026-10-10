-- GENERADO por generar_guion_sandbox.py (parte 5 de 6): NO editar a mano.
-- Una sentencia que TERMINA SIEMPRE con una excepción que REVIERTE todo (GUION_OK_REVERTIDO / GUION_FALLO / GUION_ABORTA).
DO $guion$
DECLARE
  fallos int; total int; detalle text;
BEGIN
  SET LOCAL lock_timeout = '10s';
CREATE SCHEMA hkt;
GRANT USAGE ON SCHEMA hkt TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hkt.uid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('c0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.sv(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('5e000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.ca() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-0000-0000-00000000000a'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.cb() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-0000-0000-00000000000b'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pa1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a1000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pa2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a1000000-0000-0000-0000-000000000002'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pb1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b1000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.u1()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'd1000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.ruta(p_proyecto uuid, n int, p_archivo text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_proyecto::text || '/' || hkt.sv(n)::text || '/' || p_archivo $$;

CREATE TABLE hkt.res (n serial PRIMARY KEY, ok boolean NOT NULL, txt text NOT NULL);
GRANT ALL ON hkt.res TO PUBLIC;
GRANT USAGE ON SEQUENCE hkt.res_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION hkt.ok(p_lbl text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hkt.res (ok, txt) VALUES (coalesce(p_cond, false), p_lbl);
END $$;

CREATE OR REPLACE FUNCTION hkt.como(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  EXECUTE 'SET ROLE authenticated';
END $$;
CREATE OR REPLACE FUNCTION hkt.como_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'SET ROLE anon'; END $$;
CREATE OR REPLACE FUNCTION hkt.como_servicio() RETURNS void LANGUAGE plpgsql AS $$
BEGIN RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', false); EXECUTE 'SET ROLE service_role'; END $$;
CREATE OR REPLACE FUNCTION hkt.root() RETURNS void LANGUAGE plpgsql AS $$
BEGIN RESET ROLE; PERFORM set_config('request.jwt.claim.sub', '', false); END $$;

CREATE OR REPLACE FUNCTION hkt.estado_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN_ERROR'; END IF;
  RETURN SQLSTATE;
END $$;
CREATE OR REPLACE FUNCTION hkt.mensaje_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION hkt.afectadas(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;
IF EXISTS (SELECT 1 FROM public.companies WHERE id IN (hkt.ca(), hkt.cb())) THEN
  RAISE EXCEPTION 'GUION_ABORTA: las empresas de prueba ya existen; no se escribe nada.';
END IF;
IF to_regclass('public.servicio_housekeeping_fotos') IS NULL OR to_regprocedure('public.hk_acceso(uuid,uuid)') IS NULL THEN
  RAISE EXCEPTION 'GUION_ABORTA: la migración 20261028000000_housekeeping_evidencias NO está aplicada en este proyecto.';
END IF;
IF (SELECT count(*) FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias') <> 0
   OR (SELECT count(*) FROM public.servicio_housekeeping_fotos) <> 0 THEN
  RAISE EXCEPTION 'GUION_ABORTA: el bucket o la tabla de fotos ya tienen datos; las comprobaciones de conteo no serían atribuibles.';
END IF;
ALTER TABLE public.servicios_housekeeping ALTER COLUMN fecha SET DEFAULT CURRENT_DATE;   -- se revierte con todo lo demás
INSERT INTO public.companies (id, nombre, default_currency) VALUES (hkt.ca(), 'ZZ HK Empresa A', 'gtq'), (hkt.cb(), 'ZZ HK Empresa B', 'gtq');
INSERT INTO public.projects (id, company_id, nombre) VALUES
  (hkt.pa1(), hkt.ca(), 'ZZ HK A1'), (hkt.pa2(), hkt.ca(), 'ZZ HK A2'), (hkt.pb1(), hkt.cb(), 'ZZ HK B1');
INSERT INTO auth.users (id) SELECT hkt.uid(n) FROM generate_series(1, 7) n;
INSERT INTO public.app_users (id, company_id, full_name, role, project_id) VALUES
  (hkt.uid(1), hkt.ca(), 'ZZ HK Owner A',        'company_owner', NULL),
  (hkt.uid(2), hkt.ca(), 'ZZ HK Admin A (PA1)',  'admin',         NULL),
  (hkt.uid(3), hkt.ca(), 'ZZ HK Operador PA1',   'operator',      hkt.pa1()),
  (hkt.uid(4), hkt.ca(), 'ZZ HK Operador PA2',   'operator',      hkt.pa2()),
  (hkt.uid(5), hkt.ca(), 'ZZ HK Operador sin permiso', 'operator', hkt.pa1()),
  (hkt.uid(6), hkt.ca(), 'ZZ HK Operador PA1 bis', 'operator',    hkt.pa1()),
  (hkt.uid(7), hkt.cb(), 'ZZ HK Admin B',        'admin',         NULL);
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (hkt.uid(2), hkt.pa1(), 'total');
INSERT INTO public.roles (id, company_id, name) VALUES ('5b710000-0000-0000-0000-0000000000a8', hkt.ca(), 'ZZ HK Housekeeping');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('5b710000-0000-0000-0000-0000000000a8', 'condominios.tab.housekeeping', 'allow');
INSERT INTO public.user_roles (user_id, role_id) SELECT hkt.uid(n), '5b710000-0000-0000-0000-0000000000a8' FROM unnest(ARRAY[3,4,6]) n;
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id, estado) VALUES
  (hkt.sv(1), hkt.ca(), hkt.pa1(), NULL, 'en_proceso'),
  (hkt.sv(2), hkt.ca(), hkt.pa2(), NULL, 'en_proceso'),
  (hkt.sv(3), hkt.cb(), hkt.pb1(), NULL, 'en_proceso');
INSERT INTO public.servicios_housekeeping (id, company_id, project_id, estado)
  SELECT hkt.sv(n), hkt.ca(), hkt.pa1(), 'en_proceso' FROM generate_series(4, 30) n;
INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, creado_por) VALUES
  (hkt.sv(1), 'ingreso', hkt.ruta(hkt.pa1(), 1, 'a.jpg'), hkt.uid(3)),
  (hkt.sv(1), 'cierre',  hkt.ruta(hkt.pa1(), 1, 'b.jpg'), hkt.uid(6)),
  (hkt.sv(2), 'ingreso', hkt.ruta(hkt.pa2(), 2, 'c.jpg'), hkt.uid(4)),
  (hkt.sv(3), 'ingreso', hkt.ruta(hkt.pb1(), 3, 'd.jpg'), hkt.uid(7));
INSERT INTO storage.objects (bucket_id, name, owner)
  SELECT 'housekeeping-evidencias', path, creado_por FROM public.servicio_housekeeping_fotos;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('housekeeping-evidencias', hkt.ruta(hkt.pa2(), 1, 'rogue-proyecto-ajeno.jpg')),
  ('housekeeping-evidencias', 'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-0000000000fe/rogue-sin-servicio.jpg');
  BEGIN
DECLARE a bigint[]; r record; n int; ids bigint[]; t timestamptz;
BEGIN
  INSERT INTO public.hk_limpieza_storage (bucket, path, company_id) VALUES
    ('housekeeping-evidencias', 'q/1', hkt.ca()), ('housekeeping-evidencias', 'q/2', hkt.ca()),
    ('housekeeping-evidencias', 'q/3', hkt.ca()), ('housekeeping-evidencias', 'q/4', hkt.cb()),
    ('housekeeping-evidencias', 'q/5', hkt.ca());

  PERFORM hkt.como_servicio();
  SELECT count(*) INTO n FROM public.hk_limpieza_tomar(NULL, 2);
  PERFORM hkt.ok('H1 tomar(NULL, 2) entrega 2 filas', n = 2);
  SELECT count(*) INTO n FROM public.hk_limpieza_tomar(NULL, 10);
  PERFORM hkt.ok('H2 un segundo drenaje simultáneo NO vuelve a tomar las arrendadas: recibe las otras 3', n = 3);
  SELECT count(*) INTO n FROM public.hk_limpieza_tomar(NULL, 10);
  PERFORM hkt.ok('H3 con todo arrendado no hay nada que tomar', n = 0);
  PERFORM hkt.root();
  PERFORM hkt.ok('H4 el arrendamiento vence en ~10 min',
    (SELECT min(proximo_intento) FROM public.hk_limpieza_storage) > now() + interval '9 minutes');

  UPDATE public.hk_limpieza_storage SET proximo_intento = now();
  PERFORM hkt.como_servicio();
  SELECT array_agg(id) INTO a FROM public.hk_limpieza_tomar(hkt.cb(), 10);
  PERFORM hkt.ok('H5 tomar(empresa B) solo entrega lo de B', cardinality(a) = 1 AND (SELECT company_id FROM public.hk_limpieza_storage WHERE id = a[1]) = hkt.cb());

  SELECT array_agg(id) INTO ids FROM public.hk_limpieza_storage WHERE path IN ('q/1','q/2');
  n := public.hk_limpieza_fallar(ids, 'storage: 503 Service Unavailable');
  PERFORM hkt.root();
  PERFORM hkt.ok('H6 fallar() informa las 2 filas actualizadas', n = 2);
  PERFORM hkt.ok('H7 tras el 1.er fallo: intentos=1, error guardado, reintento en ~5 min',
    (SELECT bool_and(intentos = 1 AND ultimo_error = 'storage: 503 Service Unavailable'
                     AND proximo_intento > now() + interval '4 minutes' AND proximo_intento < now() + interval '6 minutes')
       FROM public.hk_limpieza_storage WHERE path IN ('q/1','q/2')));
  PERFORM hkt.como_servicio();
  n := public.hk_limpieza_fallar(ids, 'otra vez');
  PERFORM hkt.root();
  PERFORM hkt.ok('H8 tras el 2.º fallo: intentos=2 y la espera sube a ~10 min',
    (SELECT bool_and(intentos = 2 AND proximo_intento > now() + interval '9 minutes' AND proximo_intento < now() + interval '11 minutes')
       FROM public.hk_limpieza_storage WHERE path IN ('q/1','q/2')));
  PERFORM hkt.como_servicio();
  PERFORM hkt.ok('H9 mientras espera su reintento no se vuelve a tomar',
    (SELECT count(*) FROM public.hk_limpieza_tomar(NULL, 100) WHERE path IN ('q/1','q/2')) = 0);
  PERFORM hkt.root();

  UPDATE public.hk_limpieza_storage SET intentos = 10, proximo_intento = now() - interval '1 hour' WHERE path = 'q/1';
  PERFORM hkt.como_servicio();
  PERFORM hkt.ok('H10 con 10 intentos fallidos queda ATASCADA: no se reintenta sola (y sigue en la cola con su error)',
    (SELECT count(*) FROM public.hk_limpieza_tomar(NULL, 100) WHERE path = 'q/1') = 0);
  PERFORM hkt.root();
  PERFORM hkt.ok('H11 …la fila atascada conserva su último error',
    (SELECT ultimo_error FROM public.hk_limpieza_storage WHERE path = 'q/1') = 'otra vez');

  SELECT array_agg(id) INTO ids FROM public.hk_limpieza_storage WHERE path IN ('q/3','q/5');
  PERFORM hkt.como_servicio();
  n := public.hk_limpieza_confirmar(ids || ARRAY[999999::bigint]);
  PERFORM hkt.root();
  PERFORM hkt.ok('H12 confirmar() devuelve 2 aunque le pasen además un id que no existe (el que llama compara y detecta)', n = 2);
  PERFORM hkt.como_servicio();
  PERFORM hkt.ok('H13 confirmar() sobre ids ya confirmados devuelve 0 (cero filas ≠ éxito)', public.hk_limpieza_confirmar(ids) = 0);
  PERFORM hkt.root();

  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('H14 authenticated no lee la cola → 42501', hkt.estado_de('SELECT 1 FROM public.hk_limpieza_storage') = '42501');
  PERFORM hkt.ok('H15 authenticated no la escribe → 42501', hkt.estado_de($f$INSERT INTO public.hk_limpieza_storage (bucket, path) VALUES ('housekeeping-evidencias','x')$f$) = '42501');
  PERFORM hkt.ok('H16 authenticated no ejecuta hk_limpieza_tomar → 42501', hkt.estado_de('SELECT * FROM public.hk_limpieza_tomar()') = '42501');
  PERFORM hkt.ok('H17 authenticated no ejecuta hk_limpieza_confirmar → 42501', hkt.estado_de('SELECT public.hk_limpieza_confirmar(ARRAY[1]::bigint[])') = '42501');
  PERFORM hkt.ok('H18 authenticated no ejecuta hk_limpieza_encolar_huerfanas → 42501', hkt.estado_de('SELECT public.hk_limpieza_encolar_huerfanas()') = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('H19 anon no lee la cola → 42501', hkt.estado_de('SELECT 1 FROM public.hk_limpieza_storage') = '42501');
  PERFORM hkt.root();
END;
  END;
  PERFORM hkt.root();
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO fallos, total FROM hkt.res;
  SELECT string_agg(CASE WHEN ok THEN 'OK    ' ELSE 'FALLO ' END || txt, E'\n' ORDER BY n) INTO detalle FROM hkt.res;
  IF fallos > 0 THEN
    RAISE EXCEPTION E'GUION_FALLO · % de % comprobaciones no coinciden\n%', fallos, total, detalle;
  END IF;
  RAISE EXCEPTION E'GUION_OK_REVERTIDO · % comprobaciones, 0 con FALLO\n%', total, detalle;
END
$guion$;
