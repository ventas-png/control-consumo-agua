-- ════════════════════════════════════════════════════════════════════════════
-- RECURSOS HUMANOS · EL CATÁLOGO CAE CON SU CONDOMINIO
-- (sigue a 20261031000300_rrhh_catalogos_cargos_y_turnos §7)
--
-- QUÉ FALLABA
--   `rrhh_tg_cargo_borrable` / `rrhh_tg_turno_borrable` abortan el borrado de un cargo o
--   tipo de turno que algún empleado, actividad, programación o ejecución usa
--   (RRHH_CARGO_EN_USO / RRHH_TURNO_EN_USO, 23503). Son BEFORE DELETE por fila, así que
--   también se disparan cuando el catálogo cae en la cascada de `DELETE FROM projects` (o
--   de `companies`). En esa cascada quien lo usa cae también —personal_condominio,
--   programacion_limpieza y ejecuciones_limpieza cuelgan del proyecto con CASCADE, y
--   plantillas_tarea_cargo también en producción—, pero Postgres dispara las acciones de
--   las llaves en orden de nombre de trigger (`RI_ConstraintTrigger_a_<oid>`): si la del
--   catálogo va antes que la de sus usuarios, la guarda los cuenta todavía vivos y aborta.
--   Con la forma de llaves de producción, `purgar_empresa` no podía purgar ninguna empresa
--   con una sola actividad:
--     ERROR:  RRHH_CARGO_EN_USO: el cargo "conserje" lo usan 0 empleado(s), 1 actividad(es) y 0 programación(es)…
--     CONTEXT:  … public.purgar_empresa(uuid,uuid,text,integer,text,boolean) line 189 (DELETE FROM public.projects)
--   y, como el orden sale de los OID, lo mismo podía pasar con empleados y programaciones.
--
-- QUÉ HACE
--   Las dos guardas se apartan cuando el dueño del catálogo ya no existe: si el proyecto
--   o la empresa de la fila ya están borrados, este DELETE es su cascada y el catálogo se
--   va con ellos. Sus usuarios caen en la misma sentencia (CASCADE hacia el proyecto y la
--   empresa) o, si alguna llave no los arrastra, esa llave hace fallar el DELETE del
--   proyecto: nunca queda un empleado, actividad o programación con el código de un
--   catálogo borrado en un condominio vivo.
--   Se mira la existencia del dueño y no `pg_trigger_depth()` (el escape de
--   conta_reglas_compra_borrado_tg): la profundidad eximiría también a un DELETE lanzado
--   desde otro trigger con el condominio vivo. La ausencia del dueño sólo se da en su
--   cascada: `project_id` y `company_id` del catálogo son NOT NULL con llave no diferible.
--   Siguen SECURITY DEFINER: la existencia del proyecto no depende de la RLS de quien borra.
--
-- LO QUE NO CAMBIA
--   Borrar a mano (por la API o por SQL) un cargo o turno en uso con su condominio vivo
--   sigue abortando con RRHH_CARGO_EN_USO / RRHH_TURNO_EN_USO (23503). Triggers, firmas,
--   mensajes y ACL, iguales.
--
-- PRUEBAS
--   · supabase/tests/rrhh_catalogos/run.sh (assert_cascada.sql): borrar un condominio y
--     una empresa con cargo y turno en uso por empleados, actividades, programaciones y
--     ejecuciones, con el orden de cascada ADVERSO forzado; el borrado a mano sigue
--     rechazado; un mutante por condición.
--   · supabase/tests/purgar_empresa/run.sh (assert_rrhh.sql): purgar_empresa con todo eso,
--     en las dos formas de llaves; sin cada bloque `[paso:…]` de este archivo, falla.
--
-- CÓMO REVERTIR: volver a aplicar `rrhh_tg_cargo_borrable` y `rrhh_tg_turno_borrable` de
--   20261031000300 §7 (y la purga de una empresa con actividades vuelve a fallar).
-- IMPACTO EN DATOS: ninguno. Dos CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rrhh_tg_cargo_borrable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u record;
BEGIN
  -- [paso:cascada_cargo]
  -- El condominio o la empresa ya no existen: es su cascada y el cargo se va con ellos.
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id)
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  -- [/paso:cascada_cargo]
  SELECT * INTO u FROM public.rrhh_cargo_uso(OLD.project_id, OLD.codigo);
  IF u.personal + u.actividades + u.programaciones > 0 THEN
    RAISE EXCEPTION 'RRHH_CARGO_EN_USO: el cargo "%" lo usan % empleado(s), % actividad(es) y % programación(es): desactívalo en vez de borrarlo', OLD.codigo, u.personal, u.actividades, u.programaciones
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_tg_cargo_borrable() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rrhh_tg_turno_borrable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  u record;
BEGIN
  -- [paso:cascada_turno]
  -- El condominio o la empresa ya no existen: es su cascada y el turno se va con ellos.
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id)
     OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  -- [/paso:cascada_turno]
  SELECT * INTO u FROM public.rrhh_turno_uso(OLD.project_id, OLD.codigo);
  IF u.personal + u.programaciones + u.ejecuciones > 0 THEN
    RAISE EXCEPTION 'RRHH_TURNO_EN_USO: el turno "%" lo usan % empleado(s), % programación(es) y % ejecución(es): desactívalo en vez de borrarlo', OLD.codigo, u.personal, u.programaciones, u.ejecuciones
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rrhh_tg_turno_borrable() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.rrhh_tg_cargo_borrable() IS
  'BEFORE DELETE de rrhh_cargos: un cargo que usan empleados, actividades o programaciones no se borra (RRHH_CARGO_EN_USO, 23503: desactívalo). Se aparta sólo en la cascada de su proyecto o su empresa (ya no existen), donde sus usuarios caen con él.';
COMMENT ON FUNCTION public.rrhh_tg_turno_borrable() IS
  'BEFORE DELETE de rrhh_tipos_turno: un turno que usan empleados, programaciones o ejecuciones no se borra (RRHH_TURNO_EN_USO, 23503: desactívalo). Se aparta sólo en la cascada de su proyecto o su empresa (ya no existen), donde sus usuarios caen con él.';
