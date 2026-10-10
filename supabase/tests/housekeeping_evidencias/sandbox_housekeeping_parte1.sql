-- GENERADO por generar_guion_sandbox.py (parte 1 de 6): NO editar a mano.
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
DECLARE
  n int; m int;
  esperado CONSTANT int[][] := ARRAY[[1,3],[2,2],[3,2],[4,1],[5,0],[6,2],[7,1]];
  i int; quien int; v int;
BEGIN
  FOR i IN 1..7 LOOP
    quien := esperado[i][1]; v := esperado[i][2];
    PERFORM hkt.como(hkt.uid(quien));
    SELECT count(*) INTO n FROM public.servicio_housekeeping_fotos;
    SELECT count(*) INTO m FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias';
    PERFORM hkt.root();
    PERFORM hkt.ok(format('A%s persona %s ve %s fotos (tabla) y %s objetos (bucket)', i, quien, v, v), n = v AND m = v);
  END LOOP;

  PERFORM hkt.como_anon();
  PERFORM hkt.ok('A10 anon: SELECT en la tabla de fotos → permission denied',
    hkt.estado_de('SELECT 1 FROM public.servicio_housekeeping_fotos') = '42501');
  PERFORM hkt.root();
END;
  END;
  BEGIN
DECLARE r record;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, company_id, project_id, creado_por)
  VALUES (hkt.sv(1), 'ingreso', hkt.ruta(hkt.pa1(), 1, 'nueva.jpg'), hkt.cb(), hkt.pb1(), hkt.uid(7))
  RETURNING * INTO r;
  PERFORM hkt.root();
  PERFORM hkt.ok('B1 empresa y proyecto salen del servicio, no del cliente', r.company_id = hkt.ca() AND r.project_id = hkt.pa1());
  PERFORM hkt.ok('B2 creado_por lo sella la BD (no el que mandó el cliente)', r.creado_por = hkt.uid(3));

  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('B3 operador de OTRO proyecto de la misma empresa → 42501 (acceso al proyecto)',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
      hkt.sv(1), hkt.ruta(hkt.pa1(), 1, 'x1.jpg'))) = '42501');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('B4 operador del proyecto SIN el permiso de la pestaña → falla (el servicio ni siquiera le es visible)',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
      hkt.sv(1), hkt.ruta(hkt.pa1(), 1, 'x2.jpg'))) <> 'SIN_ERROR');
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('B5 admin de OTRA empresa → falla',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
      hkt.sv(1), hkt.ruta(hkt.pa1(), 1, 'x3.jpg'))) <> 'SIN_ERROR');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('B7 anon → permission denied',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
      hkt.sv(1), hkt.ruta(hkt.pa1(), 1, 'x5.jpg'))) = '42501');
  PERFORM hkt.como(hkt.uid(2));
  PERFORM hkt.ok('B8 admin asignado a PA1 SÍ puede (empresa + proyecto + rol admin)',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'cierre',%L)$f$,
      hkt.sv(1), hkt.ruta(hkt.pa1(), 1, 'admin.jpg'))) = 'SIN_ERROR');
  PERFORM hkt.como(hkt.uid(2));
  PERFORM hkt.ok('B9 …pero el admin asignado SOLO a PA1 no sube al servicio 2 (PA2) → 42501',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
      hkt.sv(2), hkt.ruta(hkt.pa2(), 2, 'x6.jpg'))) = '42501');
  PERFORM hkt.root();
END;
  END;
  BEGIN
DECLARE
  i int;
  malas text[][] := ARRAY[
    ['proyecto ajeno (carpeta 1)',        'a1000000-0000-0000-0000-000000000002/5e000000-0000-0000-0000-000000000004/m.jpg'],
    ['carpeta de OTRO servicio',          'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-000000000005/m.jpg'],
    ['una carpeta de más',                'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-000000000004/sub/m.jpg'],
    ['sin archivo',                       'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-000000000004/'],
    ['sin carpetas',                      'm.jpg'],
    ['traversal',                         '../a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-000000000004/m.jpg'],
    ['servicio inexistente',              'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-0000000000ff/m.jpg'],
    ['uuid en mayúsculas',                'A1000000-0000-0000-0000-000000000001/5E000000-0000-0000-0000-000000000004/m.jpg']
  ];
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  FOR i IN 1..array_length(malas, 1) LOOP
    PERFORM hkt.ok('C1.' || i || ' fila con ruta «' || malas[i][1] || '» → check_violation',
      hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
        hkt.sv(4), malas[i][2])) = '23514');
  END LOOP;
  PERFORM hkt.ok('C1.9 ruta NULL → check_violation',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',NULL)$f$, hkt.sv(4))) = '23514');
  PERFORM hkt.ok('C1.10 ruta de OTRA empresa/proyecto (servicio 3) en la fila del servicio 4 → check_violation',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'ingreso',%L)$f$,
      hkt.sv(4), hkt.ruta(hkt.pb1(), 3, 'd.jpg'))) = '23514');
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(4), 'ingreso', hkt.ruta(hkt.pa1(), 4, 'unica.jpg'));
  PERFORM hkt.ok('C2 la MISMA ruta en dos filas → unique_violation',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'cierre',%L)$f$,
      hkt.sv(4), hkt.ruta(hkt.pa1(), 4, 'unica.jpg'))) = '23505');
  PERFORM hkt.root();

  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('C3 operador PA1 sube a PA1/servicio 5',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pa1(), 5, 'ok.jpg'), hkt.uid(3))) = 'SIN_ERROR');
  FOR i IN 1..array_length(malas, 1) LOOP
    CONTINUE WHEN i = 2;
    PERFORM hkt.ok('C4.' || i || ' objeto en «' || malas[i][1] || '» → denegado por la policy (42501)',
      hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
        malas[i][2], hkt.uid(3))) = '42501');
  END LOOP;
  PERFORM hkt.ok('C4.9 objeto bajo el servicio de OTRA empresa → 42501',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pb1(), 3, 'robo.jpg'), hkt.uid(3))) = '42501');
  PERFORM hkt.ok('C4.10 objeto con el proyecto del servicio 2 pero carpeta del servicio 1 → 42501',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pa2(), 1, 'cruce.jpg'), hkt.uid(3))) = '42501');
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('C5 operador de OTRO proyecto no sube a PA1/servicio 5 → 42501',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pa1(), 5, 'ajeno.jpg'), hkt.uid(4))) = '42501');
  PERFORM hkt.como(hkt.uid(5));
  PERFORM hkt.ok('C6 operador sin el permiso no sube → 42501',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pa1(), 5, 'sinpermiso.jpg'), hkt.uid(5))) = '42501');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('C8 anon no sube → 42501',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, NULL)$f$,
      hkt.ruta(hkt.pa1(), 5, 'anon.jpg'))) = '42501');
  PERFORM hkt.root();
END;
  END;
  BEGIN
BEGIN
  INSERT INTO storage.objects (bucket_id, name) SELECT 'housekeeping-evidencias', hkt.ruta(hkt.pa1(), 6, 'r' || g || '.jpg') FROM generate_series(1, 59) g;
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', hkt.ruta(hkt.pa1(), 6, 'ultimo.jpg'), hkt.uid(3));
  PERFORM hkt.ok('C9 con 59 objetos todavía entra el 60.º', true);
  PERFORM hkt.ok('C10 con 60 objetos el siguiente → 42501',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pa1(), 6, 'sesentayuno.jpg'), hkt.uid(3))) = '42501');
  PERFORM hkt.root();
END;
  END;
  BEGIN
DECLARE n int; antes int; despues int;
BEGIN
  SELECT count(*) INTO antes FROM public.servicio_housekeeping_fotos;
  PERFORM hkt.como(hkt.uid(1));   -- ni siquiera el dueño de la empresa
  PERFORM hkt.ok('D1 UPDATE de una foto (cambiar su ruta/fase) → permission denied',
    hkt.estado_de(format($f$UPDATE public.servicio_housekeeping_fotos SET fase = 'cierre' WHERE servicio_id = %L$f$, hkt.sv(1))) = '42501');
  PERFORM hkt.ok('D3 UPDATE sobre los objetos del bucket afecta 0 filas (sin policy)',
    hkt.afectadas($f$UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'housekeeping-evidencias'$f$) = 0);
  PERFORM hkt.root();
  SELECT count(*) INTO despues FROM public.servicio_housekeeping_fotos;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias';
  PERFORM hkt.ok('D5 nada cambió: mismas fotos y los objetos siguen', antes = despues AND n > 0);
END;
  END;
  BEGIN
DECLARE s record; v_id uuid := hkt.sv(20);
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, estado, creado_por, iniciado_por, completado_por)
  VALUES (hkt.sv(40), hkt.ca(), hkt.pa1(), 'pendiente', hkt.uid(7), hkt.uid(7), hkt.uid(7)) RETURNING * INTO s;
  PERFORM hkt.root();
  PERFORM hkt.ok('E1 al crear: creado_por = quien crea; iniciado/completado vacíos aunque el cliente los mande',
    s.creado_por = hkt.uid(3) AND s.iniciado_por IS NULL AND s.completado_por IS NULL AND s.completado_en IS NULL);

  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso', iniciado_por = hkt.uid(7) WHERE id = hkt.sv(40);
  PERFORM hkt.como(hkt.uid(6));
  UPDATE public.servicios_housekeeping SET estado = 'completado', completado_por = hkt.uid(7) WHERE id = hkt.sv(40);
  PERFORM hkt.root();
  SELECT * INTO s FROM public.servicios_housekeeping WHERE id = hkt.sv(40);
  PERFORM hkt.ok('E2 iniciado_por = quien pasó a en_proceso (persona 3), con hora',
    s.iniciado_por = hkt.uid(3) AND s.iniciado_en IS NOT NULL);
  PERFORM hkt.ok('E3 completado_por = quien completó (persona 6), con hora; no el que mandó el cliente',
    s.completado_por = hkt.uid(6) AND s.completado_en IS NOT NULL);

  PERFORM hkt.como(hkt.uid(3));
  UPDATE public.servicios_housekeeping SET completado_por = hkt.uid(1), iniciado_por = hkt.uid(1), creado_por = hkt.uid(1), notas = 'solo notas' WHERE id = hkt.sv(40);
  PERFORM hkt.root();
  SELECT * INTO s FROM public.servicios_housekeeping WHERE id = hkt.sv(40);
  PERFORM hkt.ok('E4 un UPDATE posterior no puede reescribir ninguno de los tres sellos',
    s.completado_por = hkt.uid(6) AND s.iniciado_por = hkt.uid(3) AND s.creado_por = hkt.uid(3) AND s.notas = 'solo notas');

  PERFORM hkt.como(hkt.uid(6));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, estado) VALUES (hkt.sv(41), hkt.ca(), hkt.pa1(), 'completado') RETURNING * INTO s;
  PERFORM hkt.root();
  PERFORM hkt.ok('E5 creado ya «completado»: completado_por = quien lo creó', s.completado_por = hkt.uid(6) AND s.iniciado_por IS NULL);

  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('E6 un servicio SIN fotos puede cambiar de proyecto',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET project_id = %L WHERE id = %L$f$, hkt.pa2(), hkt.sv(41))) = 'SIN_ERROR');
  PERFORM hkt.ok('E7 un servicio CON fotos NO cambia de proyecto → check_violation',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET project_id = %L WHERE id = %L$f$, hkt.pa2(), hkt.sv(1))) = '23514');
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
