-- ════════════════════════════════════════════════════════════════════════════
-- Catálogo RRHH en uso (20261031000700): X, con empleados, actividades,
-- programaciones y ejecuciones de limpieza que usan los cargos y tipos de turno
-- de sus condominios, se purga; y borrar a mano un cargo o turno en uso sigue
-- rechazado, antes de la purga en X y después en Y.
--
-- El fallo dependía del ORDEN en que `DELETE FROM projects` dispara las
-- acciones de sus llaves (por nombre de trigger, RI_ConstraintTrigger_a_<oid>):
-- si las del catálogo (rrhh_cargos, rrhh_tipos_turno) iban antes que las de
-- quienes lo usan, la guarda de borrado los contaba todavía vivos. Ese orden sale
-- de los OID y cambia de una base a otra (aplicando forma_produccion.sql DESPUÉS
-- de todas las migraciones, la llave de plantillas_tarea_cargo queda más nueva
-- que la del catálogo y la purga fallaba), así que aquí se FUERZA el orden
-- adverso —re-creando idénticas las llaves de los usuarios hacia projects— y se
-- comprueba como precondición.
--
-- Requiere fixture.sql + fixture_politica.sql y helpers.sql en la misma sesión;
-- run.sh lo corre sobre una copia desechable, con las dos formas de llaves.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

-- Re-crea, idéntica, cada llave de p_tabla hacia p_destino: sus triggers de
-- acción reciben un OID nuevo y pasan a dispararse después de los que ya había.
CREATE FUNCTION pg_temp.recrear_fk(p_tabla regclass, p_destino regclass) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k record;
BEGIN
  FOR k IN SELECT c.conname, pg_get_constraintdef(c.oid) AS def
             FROM pg_catalog.pg_constraint c
            WHERE c.contype = 'f' AND c.conrelid = p_tabla AND c.confrelid = p_destino
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s', p_tabla, k.conname, k.conname, k.def);
  END LOOP;
END $$;

-- true si, al borrar de p_destino, las acciones de las llaves de p_catalogos se
-- disparan ANTES que todas las de p_usuarios (Postgres las dispara en orden de
-- nombre de trigger, byte a byte).
CREATE FUNCTION pg_temp.catalogo_primero(p_destino regclass, p_catalogos regclass[], p_usuarios regclass[])
RETURNS boolean LANGUAGE sql AS $$
  SELECT max(t.tgname::text COLLATE "C") FILTER (WHERE k.conrelid = ANY (p_catalogos))
       < min(t.tgname::text COLLATE "C") FILTER (WHERE k.conrelid = ANY (p_usuarios))
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_constraint k ON k.oid = t.tgconstraint
   WHERE t.tgrelid = p_destino AND k.contype = 'f' AND k.confrelid = p_destino;
$$;

DO $$
DECLARE
  X  constant uuid := 'e1000000-0000-4000-8000-000000000001';
  P1 constant uuid := 'f1000000-0000-4000-8000-000000000001';
  P2 constant uuid := 'f1000000-0000-4000-8000-000000000002';
  Y  constant uuid := 'e2000000-0000-4000-8000-000000000002';
  PY constant uuid := 'f2000000-0000-4000-8000-000000000001';
  catalogos constant regclass[] := ARRAY['public.rrhh_cargos', 'public.rrhh_tipos_turno']::regclass[];
  usuarios  constant regclass[] := ARRAY['public.personal_condominio', 'public.plantillas_tarea_cargo',
                                         'public.programacion_limpieza', 'public.ejecuciones_limpieza']::regclass[];
  u      record;
  v      record;
  r      text;
  quedan text[];
BEGIN
  -- Quién usa el catálogo. Las actividades «Barrer X» (P1) y «Barrer Y» (PY)
  -- vienen de fixture.sql, y los empleados «Conserje X» (P1) y «Conserje Y» (PY)
  -- de fixture_politica.sql: todos conserje, y los empleados de turno diurno.
  INSERT INTO public.personal_condominio (company_id, project_id, nombre, cargo, turno) VALUES
    (X, P2, 'Guardia X', 'guardia', 'nocturno');
  INSERT INTO public.programacion_limpieza (id, company_id, project_id, area, cargo, turno) VALUES
    ('93000000-0000-4000-8000-000000000001', X, P1, 'Lobby', 'conserje', 'diurno');
  INSERT INTO public.ejecuciones_limpieza (company_id, project_id, programacion_id, fecha, turno) VALUES
    (X, P1, '93000000-0000-4000-8000-000000000001', current_date, 'diurno');
  SELECT * INTO u FROM public.rrhh_cargo_uso(P1, 'conserje');
  SELECT * INTO v FROM public.rrhh_turno_uso(P1, 'diurno');
  PERFORM pg_temp.chk(u.personal = 1 AND u.actividades = 1 AND u.programaciones = 1
                      AND v.personal = 1 AND v.programaciones = 1 AND v.ejecuciones = 1,
    'en P1 «conserje» lo usan 1 empleado, 1 actividad y 1 programación; «diurno», 1 empleado, 1 programación y 1 ejecución');

  -- El orden adverso, forzado y comprobado.
  PERFORM pg_temp.recrear_fk(t, 'public.projects') FROM unnest(usuarios) AS t;
  PERFORM pg_temp.chk(pg_temp.catalogo_primero('public.projects', catalogos, usuarios),
    'precondición: al borrar projects, la cascada llega a rrhh_cargos y rrhh_tipos_turno ANTES que a quienes los usan');

  -- Con el condominio vivo, la guarda sigue en pie.
  r := pg_temp.intento(format('DELETE FROM public.rrhh_cargos WHERE project_id = %L AND codigo = %L', P1, 'conserje'));
  PERFORM pg_temp.chk(r LIKE '23503 RRHH_CARGO_EN_USO:%1 empleado(s), 1 actividad(es) y 1 programación(es)%',
    format('X: borrar a mano un cargo en uso → 23503 RRHH_CARGO_EN_USO (recibido: %s)', left(r, 140)));
  r := pg_temp.intento(format('DELETE FROM public.rrhh_tipos_turno WHERE project_id = %L AND codigo = %L', P1, 'diurno'));
  PERFORM pg_temp.chk(r LIKE '23503 RRHH_TURNO_EN_USO:%1 empleado(s), 1 programación(es) y 1 ejecución(es)%',
    format('X: borrar a mano un turno en uso → 23503 RRHH_TURNO_EN_USO (recibido: %s)', left(r, 140)));

  -- La purga.
  r := pg_temp.intento(pg_temp.purga_x());
  PERFORM pg_temp.chk(r = 'OK',
    format('X con empleados, actividades, programaciones y ejecuciones que usan su catálogo RRHH se purga (recibido: %s)', left(r, 200)));
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.rrhh_cargos WHERE company_id = X)
                      AND NOT EXISTS (SELECT 1 FROM public.rrhh_tipos_turno WHERE company_id = X)
                      AND NOT EXISTS (SELECT 1 FROM public.personal_condominio WHERE company_id = X)
                      AND NOT EXISTS (SELECT 1 FROM public.plantillas_tarea_cargo WHERE company_id = X)
                      AND NOT EXISTS (SELECT 1 FROM public.programacion_limpieza WHERE company_id = X)
                      AND NOT EXISTS (SELECT 1 FROM public.ejecuciones_limpieza WHERE company_id = X),
    'el catálogo de X se fue con sus condominios, y con él empleados, actividades, programaciones y ejecuciones');
  quedan := pg_temp.restos_de(X, ARRAY[P1, P2],
                              ARRAY['c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003']::uuid[]);
  PERFORM pg_temp.chk(cardinality(quedan) = 0,
    format('ninguna tabla de public conserva filas de X ni de sus proyectos (quedan: %s)', array_to_string(quedan, ', ')));

  -- Y no se toca, y su catálogo sigue protegido.
  PERFORM pg_temp.chk((SELECT count(*) FROM public.rrhh_cargos WHERE project_id = PY) = 6
                      AND (SELECT count(*) FROM public.rrhh_tipos_turno WHERE project_id = PY) = 3
                      AND EXISTS (SELECT 1 FROM public.personal_condominio WHERE project_id = PY AND nombre = 'Conserje Y')
                      AND EXISTS (SELECT 1 FROM public.plantillas_tarea_cargo WHERE project_id = PY AND titulo = 'Barrer Y'),
    'Y: sus 6 cargos, 3 turnos, su personal y su actividad, intactos');
  r := pg_temp.intento(format('DELETE FROM public.rrhh_cargos WHERE project_id = %L AND codigo = %L', PY, 'conserje'));
  PERFORM pg_temp.chk(r LIKE '23503 RRHH_CARGO_EN_USO:%1 empleado(s), 1 actividad(es) y 0 programación(es)%',
    format('Y: borrar a mano un cargo en uso sigue → 23503 RRHH_CARGO_EN_USO (recibido: %s)', left(r, 140)));
  r := pg_temp.intento(format('DELETE FROM public.rrhh_tipos_turno WHERE project_id = %L AND codigo = %L', PY, 'diurno'));
  PERFORM pg_temp.chk(r LIKE '23503 RRHH_TURNO_EN_USO:%',
    format('Y: borrar a mano un turno en uso sigue → 23503 RRHH_TURNO_EN_USO (recibido: %s)', left(r, 140)));
END $$;
