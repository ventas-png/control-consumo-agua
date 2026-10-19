-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20261031000700 (el catálogo RRHH cae con su condominio), sobre la base de
-- run.sh con 20261031000300 y 20261031000700 aplicadas. No depende de assert.sql.
--   I1 · precondición: el orden de cascada ADVERSO, forzado. Postgres dispara las acciones
--        de las llaves en orden de nombre de trigger (RI_ConstraintTrigger_a_<oid>); se
--        re-crean idénticas las llaves de quienes usan el catálogo para que, al borrar un
--        proyecto o una empresa, la cascada llegue ANTES a rrhh_cargos / rrhh_tipos_turno
--        (y, al borrar la empresa, antes que a projects: el catálogo cae con su proyecto vivo)
--   I2 · borrar un condominio con su cargo y su turno en uso (empleado, actividad,
--        programación y ejecución): se completa y se lleva todo
--   I3 · borrar una empresa: ídem
--   I4 · con el condominio vivo, borrar a mano un cargo o turno en uso sigue → 23503 (como
--        root y como la dueña, por la RLS); uno sin uso se borra
-- plantillas_tarea_cargo toma la forma de producción (project_id CASCADE, sin llave a
-- companies; supabase/tests/purgar_empresa/forma_produccion.sql): con la del repositorio
-- (NO ACTION) el borrado del proyecto no llegaría a la guarda, fallaría antes por la llave.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql

CREATE OR REPLACE FUNCTION hkt.cz(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ca000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pz(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ca100000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.gz(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('ca200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

-- Empresa n con un condominio (nace con su catálogo: trg_rrhh_sembrar_catalogos) y, usando
-- su «conserje» y su «diurno», un empleado, una actividad, una programación y una ejecución.
CREATE OR REPLACE FUNCTION hkt.poblar(n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.companies (id, nombre) VALUES (hkt.cz(n), 'ZZ Cascada ' || n);
  INSERT INTO public.projects (id, company_id, nombre) VALUES (hkt.pz(n), hkt.cz(n), 'ZZ Condominio ' || n);
  INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno)
    VALUES (hkt.cz(n), hkt.pz(n), 'Ana ' || n, 'conserje', 'diurno');
  INSERT INTO public.plantillas_tarea_cargo (company_id, project_id, cargo, titulo, servicio)
    VALUES (hkt.cz(n), hkt.pz(n), 'conserje', 'Trapear ' || n, 'otro');
  INSERT INTO public.programacion_limpieza (id, company_id, project_id, area, cargo, turno)
    VALUES (hkt.gz(n), hkt.cz(n), hkt.pz(n), 'Lobby', 'conserje', 'diurno');
  INSERT INTO public.ejecuciones_limpieza (company_id, project_id, programacion_id, fecha, turno)
    VALUES (hkt.cz(n), hkt.pz(n), hkt.gz(n), current_date, 'diurno');
END $$;

-- Filas del proyecto n en el catálogo y en cada tabla que lo usa (por proyecto: también
-- cuenta lo que sobreviviera a una empresa borrada).
CREATE OR REPLACE FUNCTION hkt.filas_de(n int) RETURNS bigint[] LANGUAGE sql AS $$
  SELECT ARRAY[
    (SELECT count(*) FROM public.rrhh_cargos            WHERE project_id = hkt.pz(n)),
    (SELECT count(*) FROM public.rrhh_tipos_turno       WHERE project_id = hkt.pz(n)),
    (SELECT count(*) FROM public.personal_condominio    WHERE project_id = hkt.pz(n)),
    (SELECT count(*) FROM public.plantillas_tarea_cargo WHERE project_id = hkt.pz(n)),
    (SELECT count(*) FROM public.programacion_limpieza  WHERE project_id = hkt.pz(n)),
    (SELECT count(*) FROM public.ejecuciones_limpieza   WHERE project_id = hkt.pz(n))] $$;

-- Sufijo de diagnóstico para una sentencia que debía completarse (hkt.mensaje_de).
CREATE OR REPLACE FUNCTION hkt.recibido(p_mensaje text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT CASE WHEN p_mensaje = 'SIN_ERROR_REVERTIDO' THEN '' ELSE ' (recibido: ' || p_mensaje || ')' END $$;

-- Re-crea, idéntica, cada llave de p_tabla hacia p_destino: sus triggers de acción reciben
-- un OID nuevo y pasan a dispararse después de los que ya había.
CREATE OR REPLACE FUNCTION hkt.recrear_fk(p_tabla regclass, p_destino regclass) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k record;
BEGIN
  FOR k IN SELECT c.conname, pg_get_constraintdef(c.oid) AS def
             FROM pg_catalog.pg_constraint c
            WHERE c.contype = 'f' AND c.conrelid = p_tabla AND c.confrelid = p_destino
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s', p_tabla, k.conname, k.conname, k.def);
  END LOOP;
END $$;

-- true si, al borrar de p_destino, las acciones de las llaves de p_catalogos se disparan
-- ANTES que todas las de p_usuarios (orden de nombre de trigger, byte a byte).
CREATE OR REPLACE FUNCTION hkt.catalogo_primero(p_destino regclass, p_catalogos regclass[], p_usuarios regclass[])
RETURNS boolean LANGUAGE sql AS $$
  SELECT max(t.tgname::text COLLATE "C") FILTER (WHERE k.conrelid = ANY (p_catalogos))
       < min(t.tgname::text COLLATE "C") FILTER (WHERE k.conrelid = ANY (p_usuarios))
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_constraint k ON k.oid = t.tgconstraint
   WHERE t.tgrelid = p_destino AND k.contype = 'f' AND k.confrelid = p_destino $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;

-- ── I1 · datos y orden adverso ──────────────────────────────────────────────
DO $$
DECLARE
  catalogos constant regclass[] := ARRAY['public.rrhh_cargos', 'public.rrhh_tipos_turno']::regclass[];
  usuarios  constant regclass[] := ARRAY['public.personal_condominio', 'public.plantillas_tarea_cargo',
                                         'public.programacion_limpieza', 'public.ejecuciones_limpieza']::regclass[];
  u record;
  v record;
BEGIN
  PERFORM hkt.root();
  ALTER TABLE public.plantillas_tarea_cargo
    DROP CONSTRAINT plantillas_tarea_cargo_company_id_fkey,
    DROP CONSTRAINT plantillas_tarea_cargo_project_id_fkey,
    ADD CONSTRAINT plantillas_tarea_cargo_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  PERFORM hkt.recrear_fk(t, 'public.projects')  FROM unnest(usuarios) AS t;
  PERFORM hkt.recrear_fk(t, 'public.companies') FROM unnest(usuarios || 'public.projects'::regclass) AS t;
  PERFORM hkt.ok('I1 · precondición: al borrar un proyecto, la cascada llega al catálogo ANTES que a empleados, actividades, programaciones y ejecuciones',
    hkt.catalogo_primero('public.projects', catalogos, usuarios));
  PERFORM hkt.ok('I1 · precondición: al borrar una empresa, la cascada llega al catálogo ANTES que a sus usuarios y a projects',
    hkt.catalogo_primero('public.companies', catalogos, usuarios || 'public.projects'::regclass));

  PERFORM hkt.poblar(1);
  PERFORM hkt.poblar(2);
  PERFORM hkt.poblar(3);
  SELECT * INTO u FROM public.rrhh_cargo_uso(hkt.pz(1), 'conserje');
  SELECT * INTO v FROM public.rrhh_turno_uso(hkt.pz(1), 'diurno');
  PERFORM hkt.ok('I1 · en cada condominio de prueba, «conserje» y «diurno» en uso por empleado, actividad, programación y ejecución',
    u.personal = 1 AND u.actividades = 1 AND u.programaciones = 1
    AND v.personal = 1 AND v.programaciones = 1 AND v.ejecuciones = 1
    AND hkt.filas_de(1) = ARRAY[6, 3, 1, 1, 1, 1]::bigint[]
    AND hkt.filas_de(2) = ARRAY[6, 3, 1, 1, 1, 1]::bigint[]);
END $$;

-- ── I2 · borrar el condominio ───────────────────────────────────────────────
-- El DELETE va en su propia sentencia: una subconsulta de la comprobación lo vería con la
-- foto de antes.
DO $$
DECLARE m text; n int;
BEGIN
  PERFORM hkt.root();
  m := hkt.mensaje_de(format('DELETE FROM public.projects WHERE id = %L', hkt.pz(1)));
  PERFORM hkt.ok('I2 · borrar un condominio con cargo y turno en uso se completa' || hkt.recibido(m),
    m = 'SIN_ERROR_REVERTIDO');
  n := hkt.afectadas(format('DELETE FROM public.projects WHERE id = %L', hkt.pz(1)));
  PERFORM hkt.ok('I2 · y se lleva su catálogo, empleado, actividad, programación y ejecución; la empresa sigue',
    n = 1 AND hkt.filas_de(1) = ARRAY[0, 0, 0, 0, 0, 0]::bigint[]
    AND EXISTS (SELECT 1 FROM public.companies WHERE id = hkt.cz(1)));
END $$;

-- ── I3 · borrar la empresa ──────────────────────────────────────────────────
DO $$
DECLARE m text; n int;
BEGIN
  PERFORM hkt.root();
  m := hkt.mensaje_de(format('DELETE FROM public.companies WHERE id = %L', hkt.cz(2)));
  PERFORM hkt.ok('I3 · borrar una empresa cuyo catálogo cae antes que su condominio se completa' || hkt.recibido(m),
    m = 'SIN_ERROR_REVERTIDO');
  n := hkt.afectadas(format('DELETE FROM public.companies WHERE id = %L', hkt.cz(2)));
  PERFORM hkt.ok('I3 · y se lleva condominio, catálogo, empleado, actividad, programación y ejecución',
    n = 1 AND hkt.filas_de(2) = ARRAY[0, 0, 0, 0, 0, 0]::bigint[]
    AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = hkt.pz(2)));
END $$;

-- ── I4 · con el condominio vivo, la guarda sigue en pie ─────────────────────
DO $$
DECLARE m text;
BEGIN
  PERFORM hkt.root();
  m := hkt.mensaje_de(format('DELETE FROM public.rrhh_cargos WHERE project_id = %L AND codigo = %L', hkt.pz(3), 'conserje'));
  PERFORM hkt.ok('I4 · root: borrar un cargo en uso → 23503 RRHH_CARGO_EN_USO con el detalle',
    hkt.estado_de(format('DELETE FROM public.rrhh_cargos WHERE project_id = %L AND codigo = %L', hkt.pz(3), 'conserje')) = '23503'
    AND m LIKE 'RRHH_CARGO_EN_USO:%1 empleado(s), 1 actividad(es) y 1 programación(es)%');
  m := hkt.mensaje_de(format('DELETE FROM public.rrhh_tipos_turno WHERE project_id = %L AND codigo = %L', hkt.pz(3), 'diurno'));
  PERFORM hkt.ok('I4 · root: borrar un turno en uso → 23503 RRHH_TURNO_EN_USO con el detalle',
    hkt.estado_de(format('DELETE FROM public.rrhh_tipos_turno WHERE project_id = %L AND codigo = %L', hkt.pz(3), 'diurno')) = '23503'
    AND m LIKE 'RRHH_TURNO_EN_USO:%1 empleado(s), 1 programación(es) y 1 ejecución(es)%');
  PERFORM hkt.ok('I4 · root: un cargo y un turno sin uso se borran',
    hkt.afectadas(format('DELETE FROM public.rrhh_cargos WHERE project_id = %L AND codigo = %L', hkt.pz(3), 'administrador')) = 1
    AND hkt.afectadas(format('DELETE FROM public.rrhh_tipos_turno WHERE project_id = %L AND codigo = %L', hkt.pz(3), 'rotativo')) = 1
    AND hkt.filas_de(3) = ARRAY[5, 2, 1, 1, 1, 1]::bigint[]);

  -- Por la API: la dueña de A (exenta) sobre PA1, donde datos.sql deja «jardinero» y
  -- «nocturno» en uso (Beto y la programación «Pasillo», con su ejecución).
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('I4 · la dueña, por la RLS: borrar un cargo en uso → 23503 RRHH_CARGO_EN_USO',
    hkt.estado_de($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'jardinero'$q$) = '23503'
    AND hkt.mensaje_de($q$DELETE FROM public.rrhh_cargos WHERE codigo = 'jardinero'$q$) LIKE 'RRHH_CARGO_EN_USO:%');
  PERFORM hkt.ok('I4 · la dueña, por la RLS: borrar un turno en uso → 23503 RRHH_TURNO_EN_USO',
    hkt.estado_de($q$DELETE FROM public.rrhh_tipos_turno WHERE codigo = 'nocturno'$q$) = '23503'
    AND hkt.mensaje_de($q$DELETE FROM public.rrhh_tipos_turno WHERE codigo = 'nocturno'$q$) LIKE 'RRHH_TURNO_EN_USO:%');
  PERFORM hkt.root();
END $$;
