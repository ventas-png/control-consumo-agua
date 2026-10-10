-- GENERADO por generar_guion_sandbox.py (parte 2 de 6): NO editar a mano.
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
DECLARE i int; n int;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  FOR i IN 1..20 LOOP
    INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(8), 'ingreso', hkt.ruta(hkt.pa1(), 8, 'i' || i || '.jpg'));
  END LOOP;
  PERFORM hkt.ok('F1 la foto 21 de «ingreso» → check_violation',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$, hkt.sv(8), hkt.ruta(hkt.pa1(), 8, 'i21.jpg'))) = '23514');
  FOR i IN 1..20 LOOP
    INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(8), 'cierre', hkt.ruta(hkt.pa1(), 8, 'c' || i || '.jpg'));
  END LOOP;
  PERFORM hkt.ok('F2 «cierre» tiene su propio tope: 20 caben aunque «ingreso» esté lleno', true);
  PERFORM hkt.ok('F3 la foto 21 de «cierre» → check_violation',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'cierre',%L)$f$, hkt.sv(8), hkt.ruta(hkt.pa1(), 8, 'c21.jpg'))) = '23514');
  PERFORM hkt.root();
  SELECT count(*) INTO n FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(8);
  PERFORM hkt.ok('F4 el servicio quedó con exactamente 40 fotos (20 + 20)', n = 40);
END;
  END;
  BEGIN
DECLARE r text;
BEGIN
  PERFORM hkt.ok('J1 la tabla de fotos tiene EXACTAMENTE select + insert',
    (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'servicio_housekeeping_fotos')
      = ARRAY['hk_fotos_insert', 'hk_fotos_select']);
  PERFORM hkt.ok('J2 el bucket tiene EXACTAMENTE select + insert (los clientes no modifican ni borran archivos)',
    (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'hk\_evidencias\_%')
      = ARRAY['hk_evidencias_insert', 'hk_evidencias_select']);
  PERFORM hkt.ok('J3 authenticated tiene EXACTAMENTE SELECT + INSERT sobre la tabla de fotos (ni modificar, ni borrar, ni vaciar)',
    (SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants
      WHERE grantee = 'authenticated' AND table_schema = 'public' AND table_name = 'servicio_housekeeping_fotos')
      = ARRAY['INSERT', 'SELECT']);
  PERFORM hkt.ok('J4 anon: nada en la tabla de fotos ni en la cola',
    NOT has_table_privilege('anon', 'public.servicio_housekeeping_fotos', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.hk_limpieza_storage', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.hk_limpieza_storage', 'SELECT'));
  PERFORM hkt.ok('J5 las RPC de borrado: authenticated sí, anon no',
    has_function_privilege('authenticated', 'public.hk_eliminar_foto(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.hk_eliminar_servicio(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_eliminar_foto(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_eliminar_servicio(uuid)', 'EXECUTE'));
  PERFORM hkt.ok('J6 las funciones de la cola: solo service_role',
    has_function_privilege('service_role', 'public.hk_limpieza_tomar(uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_limpieza_tomar(uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.hk_limpieza_confirmar(bigint[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_limpieza_fallar(bigint[],text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.hk_limpieza_encolar_huerfanas(interval)', 'EXECUTE'));
  PERFORM hkt.ok('J7 las funciones SECURITY DEFINER fijan search_path vacío (o explícito)',
    (SELECT bool_and(p.proconfig IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef AND p.proname IN
        ('hk_acceso','hk_eliminar_foto','hk_eliminar_servicio','hk_fotos_encolar_limpieza','hk_limpieza_tomar',
         'hk_limpieza_confirmar','hk_limpieza_fallar','hk_limpieza_encolar_huerfanas','hk_servicio_alcance_inmutable','hk_objetos_del_servicio')));
  PERFORM hkt.ok('J8 el bucket es privado, 10 MiB y solo imágenes',
    (SELECT NOT public AND file_size_limit = 10485760 AND allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
       FROM storage.buckets WHERE id = 'housekeeping-evidencias'));
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
