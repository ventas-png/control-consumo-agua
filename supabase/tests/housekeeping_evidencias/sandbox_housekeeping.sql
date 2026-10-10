-- GENERADO por generar_guion_sandbox.py a partir de assert.sql: NO editar a mano.
-- VALIDACIÓN EN SANDBOX · 20261028000000_housekeeping_evidencias. UNA sentencia que TERMINA SIEMPRE con una
-- excepción que REVIERTE todo (GUION_OK_REVERTIDO / GUION_FALLO / GUION_ABORTA). Padrón de usar y tirar `ZZ HK`.
DO $guion$
DECLARE
  fallos int; total int; detalle text;
BEGIN
  SET LOCAL statement_timeout = '120s';
  SET LOCAL lock_timeout = '10s';
-- Ayudas de la prueba (esquema `hkt`, no pg_temp: el rol `authenticated` tiene que poder
-- llamarlas después de un SET ROLE).
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
-- Ruta correcta de un objeto del servicio n (proyecto, servicio, archivo).
CREATE OR REPLACE FUNCTION hkt.ruta(p_proyecto uuid, n int, p_archivo text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_proyecto::text || '/' || hkt.sv(n)::text || '/' || p_archivo $$;

CREATE TABLE hkt.res (n serial PRIMARY KEY, ok boolean NOT NULL, txt text NOT NULL);
GRANT ALL ON hkt.res TO PUBLIC;
GRANT USAGE ON SEQUENCE hkt.res_n_seq TO PUBLIC;
CREATE OR REPLACE FUNCTION hkt.ok(p_lbl text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO hkt.res (ok, txt) VALUES (coalesce(p_cond, false), p_lbl);
END $$;

-- Cambia de persona: JWT (GUC) + rol de Supabase.
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

-- SQLSTATE con el que falla una sentencia ('SIN_ERROR' si no falla). Si no falla, deshace el efecto.
CREATE OR REPLACE FUNCTION hkt.estado_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN_ERROR'; END IF;
  RETURN SQLSTATE;
END $$;
-- Mensaje de error de una sentencia.
CREATE OR REPLACE FUNCTION hkt.mensaje_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;
-- Filas afectadas por una sentencia DML.
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
-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261028000000_housekeeping_evidencias, ejercidas COMO cada persona
-- (JWT emulado + rol `authenticated`/`anon`/`service_role`), no leyendo el SQL.
--   A · aislamiento de lectura (proyecto, empresa, permiso, residente, anon)
--   B · inserción: autoría, derivación de empresa/proyecto, denegaciones
--   C · rutas manipuladas (fila de foto y objeto del bucket) y tope de objetos
--   D · clientes sin UPDATE/DELETE
--   E · autoría sellada por la BD y alcance inmutable
--   F · tope de 20 fotos por fase (secuencial; la concurrencia va en concurrencia.sql)
--   G · eliminar foto / eliminar servicio: autorización, una fila exacta, cola
--   H · cola de limpieza: arrendamiento, fallos con reintento, confirmación, huérfanas
--   I · la purga conserva textos y sellos
--   J · inventario de policies y privilegios
-- ════════════════════════════════════════════════════════════════════════════

-- ── Datos de lectura: fotos y objetos de los servicios base ─────────────────
INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, creado_por) VALUES
  (hkt.sv(1), 'ingreso', hkt.ruta(hkt.pa1(), 1, 'a.jpg'), hkt.uid(3)),
  (hkt.sv(1), 'cierre',  hkt.ruta(hkt.pa1(), 1, 'b.jpg'), hkt.uid(6)),
  (hkt.sv(2), 'ingreso', hkt.ruta(hkt.pa2(), 2, 'c.jpg'), hkt.uid(4)),
  (hkt.sv(3), 'ingreso', hkt.ruta(hkt.pb1(), 3, 'd.jpg'), hkt.uid(7));
INSERT INTO storage.objects (bucket_id, name, owner)
  SELECT 'housekeeping-evidencias', path, creado_por FROM public.servicio_housekeeping_fotos;
-- Objetos «fabricados» que NADIE debe ver aunque llegaran al bucket por otra vía (los siembra la
-- raíz: un cliente no puede crearlos): la carpeta de proyecto no es la del servicio, o el servicio
-- no existe. Si la policy de lectura dejara de exigir que la carpeta 1 sea el proyecto DEL servicio,
-- el operador del servicio 1 los vería y A3 fallaría.
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('housekeeping-evidencias', hkt.ruta(hkt.pa2(), 1, 'rogue-proyecto-ajeno.jpg')),
  ('housekeeping-evidencias', 'a1000000-0000-0000-0000-000000000001/5e000000-0000-0000-0000-0000000000fe/rogue-sin-servicio.jpg');
  BEGIN
DECLARE
  n int; m int;
  -- persona → (fotos visibles, objetos visibles)
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

  -- anon no lee nada de la tabla ni de la cola
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('A10 anon: SELECT en la tabla de fotos → permission denied',
    hkt.estado_de('SELECT 1 FROM public.servicio_housekeeping_fotos') = '42501');
  PERFORM hkt.root();
END;
  END;
  BEGIN
DECLARE r record;
BEGIN
  -- La persona manda empresa/proyecto/autor AJENOS: la BD los pisa.
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path, company_id, project_id, creado_por)
  VALUES (hkt.sv(1), 'ingreso', hkt.ruta(hkt.pa1(), 1, 'nueva.jpg'), hkt.cb(), hkt.pb1(), hkt.uid(7))
  RETURNING * INTO r;
  PERFORM hkt.root();
  PERFORM hkt.ok('B1 empresa y proyecto salen del servicio, no del cliente', r.company_id = hkt.ca() AND r.project_id = hkt.pa1());
  PERFORM hkt.ok('B2 creado_por lo sella la BD (no el que mandó el cliente)', r.creado_por = hkt.uid(3));

  -- Quién NO puede subir una foto al servicio 1 (A/PA1)
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
  -- Fila de foto del servicio 4 con una ruta que NO es la suya
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
  -- Un objeto = una fila
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(4), 'ingreso', hkt.ruta(hkt.pa1(), 4, 'unica.jpg'));
  PERFORM hkt.ok('C2 la MISMA ruta en dos filas → unique_violation',
    hkt.estado_de(format($f$INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (%L,'cierre',%L)$f$,
      hkt.sv(4), hkt.ruta(hkt.pa1(), 4, 'unica.jpg'))) = '23505');
  PERFORM hkt.root();

  -- Objetos del bucket: la persona legítima sube a SU servicio…
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('C3 operador PA1 sube a PA1/servicio 5',
    hkt.estado_de(format($f$INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('housekeeping-evidencias', %L, %L)$f$,
      hkt.ruta(hkt.pa1(), 5, 'ok.jpg'), hkt.uid(3))) = 'SIN_ERROR');
  -- …y NO puede con rutas fabricadas (mismas que arriba, contra el bucket)
  FOR i IN 1..array_length(malas, 1) LOOP
    -- La entrada 2 apunta al servicio 5, que ES del proyecto de esta persona: en el bucket es una subida
    -- legítima (la prueba de «servicio ajeno» en el bucket son C4.9, C4.10 y C5).
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
  -- Se inserta DE VERDAD (estado_de() revertiría el objeto y C10 partiría de 59).
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
  PERFORM hkt.ok('D2 DELETE directo de fotos → permission denied (no «0 filas» en silencio)',
    hkt.estado_de('DELETE FROM public.servicio_housekeeping_fotos') = '42501');
  PERFORM hkt.ok('D3 UPDATE sobre los objetos del bucket afecta 0 filas (sin policy)',
    hkt.afectadas($f$UPDATE storage.objects SET name = name || 'x' WHERE bucket_id = 'housekeeping-evidencias'$f$) = 0);
  PERFORM hkt.ok('D4 DELETE sobre los objetos del bucket afecta 0 filas (sin policy)',
    hkt.afectadas($f$DELETE FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias'$f$) = 0);
  PERFORM hkt.root();
  SELECT count(*) INTO despues FROM public.servicio_housekeeping_fotos;
  SELECT count(*) INTO n FROM storage.objects WHERE bucket_id = 'housekeeping-evidencias';
  PERFORM hkt.ok('D5 nada cambió: mismas fotos y los objetos siguen', antes = despues AND n > 0);
END;
  END;
  BEGIN
DECLARE s record; v_id uuid := hkt.sv(20);
BEGIN
  -- Crea con autor/sellos FALSOS en el payload
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

  -- Alcance: sin fotos se puede mover; con fotos no
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('E6 un servicio SIN fotos puede cambiar de proyecto',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET project_id = %L WHERE id = %L$f$, hkt.pa2(), hkt.sv(41))) = 'SIN_ERROR');
  PERFORM hkt.ok('E7 un servicio CON fotos NO cambia de proyecto → check_violation',
    hkt.estado_de(format($f$UPDATE public.servicios_housekeeping SET project_id = %L WHERE id = %L$f$, hkt.pa2(), hkt.sv(1))) = '23514');
  PERFORM hkt.root();
END;
  END;
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
DECLARE f1 uuid; f2 uuid; f3 uuid; p1 text; n int; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(12), 'ingreso', hkt.ruta(hkt.pa1(), 12, 'f1.jpg')) RETURNING id INTO f1;
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(12), 'ingreso', hkt.ruta(hkt.pa1(), 12, 'f2.jpg')) RETURNING id INTO f2;
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(12), 'cierre',  hkt.ruta(hkt.pa1(), 12, 'f3.jpg')) RETURNING id INTO f3;
  PERFORM hkt.root();
  p1 := hkt.ruta(hkt.pa1(), 12, 'f1.jpg');

  PERFORM hkt.como(hkt.uid(6));
  PERFORM hkt.ok('G1 otro operador (no la subió, no es admin) → 42501', hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', f1)) = '42501');
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('G2 operador de otro proyecto → P0002 «inexistente» (no revela que existe)', hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', f1)) = 'P0002');
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('G3 admin de OTRA empresa → P0002', hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', f1)) = 'P0002');
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('G4 id inexistente → P0002', hkt.estado_de($f$SELECT public.hk_eliminar_foto('00000000-0000-0000-0000-00000000dead')$f$) = 'P0002');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('G5 anon no puede ni ejecutar la RPC → 42501', hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', f1)) = '42501');
  PERFORM hkt.root();
  SELECT count(*) INTO n FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(12);
  PERFORM hkt.ok('G6 los intentos rechazados no borraron nada (3 fotos) ni encolaron nada',
    n = 3 AND (SELECT count(*) FROM public.hk_limpieza_storage) = 0);

  PERFORM hkt.como(hkt.uid(3));
  PERFORM public.hk_eliminar_foto(f1);
  PERFORM hkt.root();
  SELECT count(*) INTO n FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(12);
  PERFORM hkt.ok('G7 quien la subió, con el servicio sin completar, la elimina (quedan 2)', n = 2);
  PERFORM hkt.ok('G8 el archivo quedó en la cola, motivo foto_eliminada, sin intentos',
    (SELECT count(*) FROM public.hk_limpieza_storage WHERE path = p1 AND motivo = 'foto_eliminada' AND intentos = 0
        AND company_id = hkt.ca() AND project_id = hkt.pa1() AND bucket = 'housekeeping-evidencias') = 1);
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('G9 eliminar OTRA vez la misma foto → P0002 (cero filas ≠ éxito)', hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', f1)) = 'P0002');

  -- Con el servicio completado, el que la subió ya no puede; un admin sí
  PERFORM hkt.root();
  UPDATE public.servicios_housekeeping SET estado = 'completado' WHERE id = hkt.sv(12);
  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('G10 servicio completado: quien la subió → 42501', hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', f2)) = '42501');

  -- «Cero filas afectadas»: un BEFORE DELETE que cancela el borrado en silencio
  PERFORM hkt.root();
  CREATE FUNCTION hkt.cancela_borrado() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN RETURN NULL; END $t$;
  CREATE TRIGGER trg_hkt_cancela BEFORE DELETE ON public.servicio_housekeeping_fotos FOR EACH ROW EXECUTE FUNCTION hkt.cancela_borrado();
  PERFORM hkt.como(hkt.uid(2));
  msg := hkt.mensaje_de(format('SELECT public.hk_eliminar_foto(%L)', f3));
  PERFORM hkt.root();
  PERFORM hkt.ok('G11 si el DELETE afecta 0 filas la RPC FALLA («filas afectadas: 0») en vez de dar el borrado por hecho',
    msg LIKE '%filas afectadas: 0%');
  PERFORM hkt.ok('G12 …y no encola nada de esa foto',
    (SELECT count(*) FROM public.hk_limpieza_storage WHERE path = hkt.ruta(hkt.pa1(), 12, 'f3.jpg')) = 0
    AND (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE id = f3) = 1);
  DROP TRIGGER trg_hkt_cancela ON public.servicio_housekeeping_fotos;

  PERFORM hkt.como(hkt.uid(2));
  PERFORM public.hk_eliminar_foto(f2);
  PERFORM hkt.root();
  PERFORM hkt.ok('G13 un admin con acceso al proyecto elimina aunque esté completado',
    (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE id = f2) = 0
    AND (SELECT count(*) FROM public.hk_limpieza_storage WHERE path = hkt.ruta(hkt.pa1(), 12, 'f2.jpg')) = 1);
  PERFORM hkt.como(hkt.uid(2));
  PERFORM hkt.ok('G14 …pero el admin asignado solo a PA1 no elimina fotos de PA2 → P0002',
    hkt.estado_de(format('SELECT public.hk_eliminar_foto(%L)', (SELECT id FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(2) LIMIT 1))) = 'P0002');
  PERFORM hkt.root();
END;
  END;
  BEGIN
DECLARE n int; r int; msg text;
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES
    (hkt.sv(13), 'ingreso', hkt.ruta(hkt.pa1(), 13, 'a.jpg')),
    (hkt.sv(13), 'ingreso', hkt.ruta(hkt.pa1(), 13, 'b.jpg')),
    (hkt.sv(13), 'cierre',  hkt.ruta(hkt.pa1(), 13, 'c.jpg'));
  PERFORM hkt.root();
  UPDATE public.servicio_housekeeping_fotos SET path = NULL WHERE path = hkt.ruta(hkt.pa1(), 13, 'c.jpg');   -- depurada por la purga
  TRUNCATE public.hk_limpieza_storage;

  PERFORM hkt.como(hkt.uid(3));
  PERFORM hkt.ok('G20 un operador no elimina servicios → 42501', hkt.estado_de(format('SELECT public.hk_eliminar_servicio(%L)', hkt.sv(13))) = '42501');
  PERFORM hkt.como(hkt.uid(7));
  PERFORM hkt.ok('G21 admin de OTRA empresa → P0002', hkt.estado_de(format('SELECT public.hk_eliminar_servicio(%L)', hkt.sv(13))) = 'P0002');
  PERFORM hkt.como(hkt.uid(4));
  PERFORM hkt.ok('G22 operador de otro proyecto → P0002', hkt.estado_de(format('SELECT public.hk_eliminar_servicio(%L)', hkt.sv(13))) = 'P0002');
  PERFORM hkt.como_anon();
  PERFORM hkt.ok('G23 anon → 42501', hkt.estado_de(format('SELECT public.hk_eliminar_servicio(%L)', hkt.sv(13))) = '42501');
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('G24 servicio inexistente → P0002', hkt.estado_de($f$SELECT public.hk_eliminar_servicio('00000000-0000-0000-0000-00000000dead')$f$) = 'P0002');
  PERFORM hkt.root();
  PERFORM hkt.ok('G25 los rechazos no tocaron el servicio, sus 3 filas ni la cola',
    (SELECT count(*) FROM public.servicios_housekeeping WHERE id = hkt.sv(13)) = 1
    AND (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(13)) = 3
    AND (SELECT count(*) FROM public.hk_limpieza_storage) = 0);

  PERFORM hkt.como(hkt.uid(2));
  r := public.hk_eliminar_servicio(hkt.sv(13));
  PERFORM hkt.root();
  PERFORM hkt.ok('G26 el admin elimina el servicio y la RPC informa 2 archivos encolados (la depurada no cuenta)', r = 2);
  PERFORM hkt.ok('G27 servicio y filas de foto desaparecieron (cascada)',
    (SELECT count(*) FROM public.servicios_housekeeping WHERE id = hkt.sv(13)) = 0
    AND (SELECT count(*) FROM public.servicio_housekeeping_fotos WHERE servicio_id = hkt.sv(13)) = 0);
  PERFORM hkt.ok('G28 en la cola están EXACTAMENTE los 2 archivos vivos, motivo servicio_eliminado',
    (SELECT count(*) FROM public.hk_limpieza_storage) = 2
    AND (SELECT count(*) FROM public.hk_limpieza_storage WHERE motivo = 'servicio_eliminado'
          AND path IN (hkt.ruta(hkt.pa1(), 13, 'a.jpg'), hkt.ruta(hkt.pa1(), 13, 'b.jpg'))) = 2);

  -- «Cero filas» en el servicio
  CREATE FUNCTION hkt.cancela_borrado_s() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN RETURN NULL; END $t$;
  CREATE TRIGGER trg_hkt_cancela_s BEFORE DELETE ON public.servicios_housekeeping FOR EACH ROW EXECUTE FUNCTION hkt.cancela_borrado_s();
  PERFORM hkt.como(hkt.uid(1));
  msg := hkt.mensaje_de(format('SELECT public.hk_eliminar_servicio(%L)', hkt.sv(14)));
  PERFORM hkt.root();
  DROP TRIGGER trg_hkt_cancela_s ON public.servicios_housekeeping;
  PERFORM hkt.ok('G29 si el DELETE del servicio afecta 0 filas la RPC FALLA («filas afectadas: 0»)', msg LIKE '%filas afectadas: 0%');
  PERFORM hkt.ok('G30 …y el servicio sigue ahí', (SELECT count(*) FROM public.servicios_housekeeping WHERE id = hkt.sv(14)) = 1);

  -- Por la vía vieja (DELETE directo permitido por la policy de admin) el archivo también se encola
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES (hkt.sv(15), 'ingreso', hkt.ruta(hkt.pa1(), 15, 'x.jpg'));
  PERFORM hkt.como(hkt.uid(1));
  DELETE FROM public.servicios_housekeeping WHERE id = hkt.sv(15);
  PERFORM hkt.root();
  PERFORM hkt.ok('G31 DELETE directo del servicio (policy previa del admin): la cascada también encola el archivo',
    (SELECT count(*) FROM public.hk_limpieza_storage WHERE path = hkt.ruta(hkt.pa1(), 15, 'x.jpg')) = 1);

END;
  END;
  BEGIN
DECLARE a bigint[]; r record; n int; ids bigint[]; t timestamptz;
BEGIN
  TRUNCATE public.hk_limpieza_storage;
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

  -- Fallo de Storage: +1 intento, error, espera creciente
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

  -- Confirmar: cuenta lo que realmente salió
  SELECT array_agg(id) INTO ids FROM public.hk_limpieza_storage WHERE path IN ('q/3','q/5');
  PERFORM hkt.como_servicio();
  n := public.hk_limpieza_confirmar(ids || ARRAY[999999::bigint]);
  PERFORM hkt.root();
  PERFORM hkt.ok('H12 confirmar() devuelve 2 aunque le pasen además un id que no existe (el que llama compara y detecta)', n = 2);
  PERFORM hkt.como_servicio();
  PERFORM hkt.ok('H13 confirmar() sobre ids ya confirmados devuelve 0 (cero filas ≠ éxito)', public.hk_limpieza_confirmar(ids) = 0);
  PERFORM hkt.root();

  -- Los clientes no tocan la cola ni sus funciones
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
  BEGIN
DECLARE n int;
BEGIN
  TRUNCATE public.hk_limpieza_storage;
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

  -- Lo que hace la edge function de purga (service-role): anular `path` de las fotos viejas.
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
  BEGIN
DECLARE r text;
BEGIN
  PERFORM hkt.ok('J1 la tabla de fotos tiene EXACTAMENTE select + insert',
    (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'servicio_housekeeping_fotos')
      = ARRAY['hk_fotos_insert', 'hk_fotos_select']);
  PERFORM hkt.ok('J2 el bucket tiene EXACTAMENTE select + insert (ni update ni delete para clientes)',
    (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'hk\_evidencias\_%')
      = ARRAY['hk_evidencias_insert', 'hk_evidencias_select']);
  PERFORM hkt.ok('J3 authenticated: SELECT+INSERT sí; UPDATE/DELETE/TRUNCATE no',
    has_table_privilege('authenticated', 'public.servicio_housekeeping_fotos', 'SELECT')
    AND has_table_privilege('authenticated', 'public.servicio_housekeeping_fotos', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.servicio_housekeeping_fotos', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.servicio_housekeeping_fotos', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.servicio_housekeeping_fotos', 'TRUNCATE'));
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
