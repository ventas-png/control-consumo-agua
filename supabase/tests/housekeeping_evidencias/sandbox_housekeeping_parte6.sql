-- GENERADO por generar_guion_sandbox.py (parte 6 de 6): NO editar a mano.
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
DECLARE n int;
BEGIN
  UPDATE storage.objects SET created_at = now() - interval '3 days' WHERE name = hkt.ruta(hkt.pa1(), 1, 'a.jpg');   -- referenciado y viejo
  INSERT INTO storage.objects (bucket_id, name, created_at) VALUES
    ('housekeeping-evidencias', hkt.ruta(hkt.pa1(), 9, 'huerfano-viejo.jpg'), now() - interval '2 days'),
    ('housekeeping-evidencias', hkt.ruta(hkt.pa1(), 9, 'huerfano-nuevo.jpg'), now());
  PERFORM hkt.como_servicio();
  n := public.hk_limpieza_encolar_huerfanas(interval '1 day');
  PERFORM hkt.root();
  PERFORM hkt.ok('H20 encola SOLO el huérfano viejo (no el recién subido, no el referenciado por una fila)', n = 1
    AND (SELECT path FROM public.hk_limpieza_storage) = hkt.ruta(hkt.pa1(), 9, 'huerfano-viejo.jpg'));
  PERFORM hkt.ok('H21 el huérfano trae motivo, empresa y proyecto resueltos',
    (SELECT motivo = 'huerfana' AND company_id = hkt.ca() AND project_id = hkt.pa1() FROM public.hk_limpieza_storage));
  PERFORM hkt.como_servicio();
  PERFORM hkt.ok('H22 es idempotente: la segunda pasada no encola de nuevo', public.hk_limpieza_encolar_huerfanas(interval '1 day') = 0);
  PERFORM hkt.root();
END;
  END;
  BEGIN
DECLARE antes record; despues record; n int; q int; r int;
BEGIN
  UPDATE public.servicios_housekeeping
     SET hallazgos_ingreso = 'Vaso roto en la cocina; mancha en el sofá', observaciones_cierre = 'Todo limpio; falta una toalla',
         estado = 'en_proceso' WHERE id = hkt.sv(16);
  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(16);
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES
    (hkt.sv(16), 'ingreso', hkt.ruta(hkt.pa1(), 16, 'a.jpg')), (hkt.sv(16), 'cierre', hkt.ruta(hkt.pa1(), 16, 'b.jpg'));
  PERFORM hkt.root();
  SELECT * INTO antes FROM public.servicios_housekeeping WHERE id = hkt.sv(16);
  SELECT count(*) INTO q FROM public.hk_limpieza_storage;

  PERFORM hkt.como_servicio();
  n := hkt.afectadas(format($f$UPDATE public.servicio_housekeeping_fotos SET path = NULL WHERE servicio_id = %L AND path IS NOT NULL$f$, hkt.sv(16)));
  PERFORM hkt.root();

  SELECT * INTO despues FROM public.servicios_housekeeping WHERE id = hkt.sv(16);
  PERFORM hkt.ok('I1 la purga anuló las 2 rutas', n = 2);
  PERFORM hkt.ok('I2 las FILAS de foto sobreviven (fase, quién, cuándo) con path NULL',
    (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(16) AND path IS NULL AND creado_por = hkt.uid(3)) = 2);
  PERFORM hkt.ok('I3 los TEXTOS no cambiaron',
    despues.hallazgos_ingreso = antes.hallazgos_ingreso AND despues.observaciones_cierre = antes.observaciones_cierre
    AND despues.hallazgos_ingreso LIKE 'Vaso roto%' AND despues.observaciones_cierre LIKE 'Todo limpio%');
  PERFORM hkt.ok('I4 los SELLOS de autoría no cambiaron',
    despues.creado_por IS NOT DISTINCT FROM antes.creado_por AND despues.iniciado_por IS NOT DISTINCT FROM antes.iniciado_por
    AND despues.completado_por IS NOT DISTINCT FROM antes.completado_por AND despues.completado_en IS NOT DISTINCT FROM antes.completado_en);
  PERFORM hkt.ok('I5 anular la ruta NO es un borrado: no encola nada (el objeto lo retira la propia purga)',
    (SELECT count(*) FROM public.hk_limpieza_storage) = q);
  PERFORM hkt.como(hkt.uid(1));
  r := public.hk_eliminar_servicio(hkt.sv(16));
  PERFORM hkt.root();
  PERFORM hkt.ok('I6 eliminar después ese servicio encola 0 archivos (ya no hay ruta)', r = 0 AND (SELECT count(*) FROM public.hk_limpieza_storage) = q);
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
