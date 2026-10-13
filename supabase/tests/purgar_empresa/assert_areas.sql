-- ════════════════════════════════════════════════════════════════════════════
-- Un área con tareas (RESTRICT hacia areas_condominio): el caso donde la forma
-- de llaves del repositorio y la de producción dan resultados DISTINTOS.
--
--   · Producción: areas_condominio.project_id es ON DELETE CASCADE, así que el
--     área y sus tareas caen juntas con el proyecto → la purga se completa.
--   · Repositorio: esa FK es NO ACTION (drift declarado en
--     scripts/schema-drift/drift-conocido.json, #826). El área no se puede
--     vaciar antes —sus tareas la referencian con RESTRICT— ni caer con el
--     proyecto → la purga NO puede completarse.
--
-- Lo que se fija en el segundo caso es lo que importa aquí: que falle ENTERA.
-- Cuando #826 alinee el repositorio con producción, este caso pasará a
-- completarse también en la forma del repositorio y habrá que actualizarlo.
--
-- Uso: psql -v forma=produccion|repositorio, con helpers.sql en la misma sesión.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
SELECT set_config('purga.forma', :'forma', false);

DO $$
DECLARE
  X     constant uuid := 'e1000000-0000-4000-8000-000000000001';
  forma text := current_setting('purga.forma');
  antes jsonb;
  r     text;
BEGIN
  INSERT INTO public.tareas_condominio (company_id, project_id, titulo, area_id)
  SELECT company_id, project_id, 'Limpiar ' || nombre, id FROM public.areas_condominio WHERE company_id = X;
  antes := pg_temp.huella_x();
  r := pg_temp.intento(pg_temp.purga_x());

  IF forma = 'produccion' THEN
    PERFORM pg_temp.chk(r = 'OK', format('forma de producción: un área con tareas se purga (recibido: %s)', left(r, 120)));
    PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM public.areas_condominio WHERE company_id = X)
                        AND NOT EXISTS (SELECT 1 FROM public.tareas_condominio WHERE company_id = X),
      'forma de producción: el área y sus tareas ya no existen');
  ELSIF forma = 'repositorio' THEN
    PERFORM pg_temp.chk(r LIKE '23503 %areas_condominio%',
      format('forma del repositorio (#826): un área con tareas NO se puede purgar (recibido: %s)', left(r, 120)));
    PERFORM pg_temp.chk(pg_temp.huella_x() = antes,
      'forma del repositorio: y la purga falla ENTERA — personas, datos y auditoría intactos');
  ELSE
    RAISE EXCEPTION 'forma desconocida: %', forma;
  END IF;
END $$;
