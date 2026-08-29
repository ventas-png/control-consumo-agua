-- ════════════════════════════════════════════════════════════════════════════
-- El snapshot deja de copiar plantillas ajenas: el UUID no es una credencial
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO QUE CIERRA (seguimiento de seguridad de 20260907000600 / #810)
-- `tarea_copiar_snapshot_plantilla()` es SECURITY DEFINER —tiene que serlo:
-- quien inserta con solo `turnos` no puede leer el catálogo— y busca la
-- plantilla POR ID, sin mirar de quién es. Como el trigger se salta la RLS,
-- cualquier usuario que pueda crear tareas en SU bloque y conozca (o enumere)
-- el UUID de una plantilla AJENA se lleva copiado su checklist, sus
-- instrucciones de seguridad, su duración y sus exigencias: fuga entre
-- tenants con solo un UUID. Y la referencia misma también entra: las FKs de
-- `tareas_bloque` (plantilla_id, area_id, rutina_id) son SIMPLES, y el chequeo
-- de FK corre como el dueño de la tabla — la RLS no lo frena.
--
-- QUÉ HACE
--   1. Reemplaza la función del snapshot: resuelve company/project DESDE EL
--      BLOQUE de la tarea y exige que la plantilla tenga exactamente esa
--      compañía y ese proyecto ANTES de copiar nada. Si plantilla_id viene y
--      no casa, FALLA CERRADO: nada de continuar con un snapshot vacío (el
--      «NOT FOUND ⇒ no copio» de 20260907000600 pasaba a ser la vía de
--      inserción silenciosa de referencias ajenas) y nada de delegar en una
--      RLS que un SECURITY DEFINER no ve.
--   2. Estrena un guard REUTILIZABLE (`tarea_referencias_del_scope`, BEFORE
--      INSERT OR UPDATE) que valida las TRES referencias con FK simple —
--      plantilla_id, area_id y rutina_id— contra el tenant del bloque. Cubre
--      también el UPDATE, que el trigger del snapshot (solo INSERT) no ve: sin
--      esto, editar la tarea era la puerta de atrás para colgar la referencia
--      ajena. En UPDATE solo re-valida lo que cambió (o todo, si cambió el
--      bloque): cerrar una tarea no paga lookups.
--
-- POR QUÉ GUARD Y NO FKs COMPUESTAS. Las anclas UNIQUE (id, company_id,
-- project_id) ya existen en plantillas_tarea_cargo, areas_condominio y
-- rutinas_limpieza (20260904000200, 20260907000200) — pero una FK compuesta
-- necesita las columnas EN LA HIJA, y `tareas_bloque` no tiene company_id ni
-- project_id: su tenant se deriva del bloque (así lo consumen sus policies
-- desde 20260424000060). Retrofitear dos columnas NOT NULL selladas + backfill
-- sobre la tabla operativa más caliente del módulo es un rediseño, no un fix
-- de seguridad. El guard impone lo mismo, en los mismos puntos de escritura,
-- con el patrón que 20260907000200 ya usa para validar rutina_actividades.
--
-- LOS MENSAJES NO SON UN ORÁCULO. «No existe» y «es de otro» responden LO
-- MISMO: distinguirlos regalaría un oráculo de existencia sobre catálogos
-- ajenos, y el mensaje solo repite el UUID que el llamador ya envió — jamás
-- datos de la fila ajena. ERRCODE foreign_key_violation: para el cliente es
-- indistinguible de la referencia rota que moralmente es.
--
-- ORDEN DE TRIGGERS (alfabético por nombre, mismo evento): en INSERT,
-- trg_referencias_del_scope < trg_tarea_copiar_snapshot — primero se valida,
-- después se copia. El chequeo del snapshot queda además DENTRO de su función:
-- si alguien dropeara el guard, la copia sigue sin cruzar tenants.
--
-- 20260907000600 QUEDA INTACTA: esto es una migración nueva, append-only.
--
-- IDEMPOTENTE: CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
--
-- REVERSA:
-- DROP TRIGGER trg_referencias_del_scope ON public.tareas_bloque;
-- DROP FUNCTION public.tarea_referencias_del_scope();
-- y recrear tarea_copiar_snapshot_plantilla() con su cuerpo de 20260907000600
-- (que es el vulnerable).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. El snapshot solo copia plantillas del scope del bloque
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tarea_copiar_snapshot_plantilla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  p record;
BEGIN
  -- Tarea ad-hoc: no hay receta que copiar. No es un error.
  IF NEW.plantilla_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- El scope se resuelve del BLOQUE, nunca del llamador: es la misma
  -- derivación de tenant que usan las policies de esta tabla.
  SELECT company_id, project_id INTO v_company, v_project
    FROM public.bloques_turno
   WHERE id = NEW.bloque_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE: el bloque % de la tarea no existe', NEW.bloque_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT duracion_estimada_min, checklist, instrucciones_seguridad,
         requiere_foto, requiere_comentario, requiere_checklist
    INTO p
    FROM public.plantillas_tarea_cargo
   WHERE id = NEW.plantilla_id
     AND company_id = v_company
     AND project_id = v_project;

  -- FALLA CERRADO, con el mismo mensaje para «no existe» y «es de otro»: un
  -- SECURITY DEFINER no puede apoyarse en la RLS, y continuar sin copiar era
  -- la vía silenciosa para colgar referencias ajenas. El mensaje solo repite
  -- el UUID que el llamador envió — nada de la fila ajena.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE: la plantilla % no existe en el proyecto de este bloque', NEW.plantilla_id
      USING ERRCODE = 'foreign_key_violation',
            HINT = 'La plantilla de una tarea tiene que ser del mismo condominio y proyecto que su bloque de turno.';
  END IF;

  -- Nullables: se llenan sólo si vienen vacíos. Lo que el llamador mandó manda.
  NEW.duracion_estimada_min   := COALESCE(NEW.duracion_estimada_min, p.duracion_estimada_min);
  NEW.instrucciones_seguridad := COALESCE(NEW.instrucciones_seguridad, p.instrucciones_seguridad);

  -- `checklist` es NOT NULL DEFAULT '[]': el arreglo vacío ES el centinela.
  IF jsonb_array_length(COALESCE(NEW.checklist, '[]'::jsonb)) = 0 THEN
    NEW.checklist := COALESCE(p.checklist, '[]'::jsonb);
  END IF;

  -- Las tres banderas: OR y no asignación (la regla monótona de 20260907000600).
  NEW.requiere_foto        := NEW.requiere_foto        OR COALESCE(p.requiere_foto, false);
  NEW.requiere_comentario  := NEW.requiere_comentario  OR COALESCE(p.requiere_comentario, false);
  NEW.requiere_checklist   := NEW.requiere_checklist   OR COALESCE(p.requiere_checklist, false);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tarea_copiar_snapshot_plantilla() IS
  'Completa el snapshot de la tarea desde su plantilla al crearse — SOLO si la plantilla pertenece a la misma compañía y proyecto que el bloque de la tarea (resueltos del bloque, no del llamador). Si plantilla_id no casa con ese scope, aborta con foreign_key_violation sin revelar si el UUID existe en otro tenant. Llena los nullables vacíos y SUBE las banderas con OR (nunca las baja).';

-- Regla (e) del migrations-guard: SECURITY DEFINER sin ejecución directa.
-- Solo la invoca el trigger autorizado.
REVOKE EXECUTE ON FUNCTION public.tarea_copiar_snapshot_plantilla() FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Guard reutilizable: TODA referencia de la tarea es del scope del bloque
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER a propósito y con el mismo argumento que el snapshot: el
-- guard tiene que ver los catálogos ENTEROS para decidir — la RLS del llamador
-- le mostraría solo su tenant y convertiría «ajena» en «invisible», que es
-- indistinguible de «no existe»… y eso está bien para el MENSAJE, pero el
-- guard no puede depender de que la RLS del llamador exista o cambie: valida
-- contra el catálogo real. No lee nada del otro tenant salvo un EXISTS.
CREATE OR REPLACE FUNCTION public.tarea_referencias_del_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company       uuid;
  v_project       uuid;
  v_chk_plantilla boolean := true;
  v_chk_area      boolean := true;
  v_chk_rutina    boolean := true;
BEGIN
  -- En UPDATE solo se re-valida lo que cambió; si cambió el bloque, todo.
  -- OLD solo se toca dentro de la rama UPDATE — en INSERT no está asignado, y
  -- el orden de evaluación de un AND en SQL no está garantizado: el IF anidado
  -- es lo que hace imposible tocarlo fuera de esta rama.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.bloque_id IS NOT DISTINCT FROM OLD.bloque_id THEN
      v_chk_plantilla := NEW.plantilla_id IS DISTINCT FROM OLD.plantilla_id;
      v_chk_area      := NEW.area_id      IS DISTINCT FROM OLD.area_id;
      v_chk_rutina    := NEW.rutina_id    IS DISTINCT FROM OLD.rutina_id;
    END IF;
  END IF;
  v_chk_plantilla := v_chk_plantilla AND NEW.plantilla_id IS NOT NULL;
  v_chk_area      := v_chk_area      AND NEW.area_id      IS NOT NULL;
  v_chk_rutina    := v_chk_rutina    AND NEW.rutina_id    IS NOT NULL;

  -- Nada nuevo que validar: cerrar/editar una tarea no paga ningún lookup.
  IF NOT (v_chk_plantilla OR v_chk_area OR v_chk_rutina) THEN
    RETURN NEW;
  END IF;

  SELECT company_id, project_id INTO v_company, v_project
    FROM public.bloques_turno
   WHERE id = NEW.bloque_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE: el bloque % de la tarea no existe', NEW.bloque_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Tres EXISTS por PK: el mismo mensaje para «no existe» y «es de otro»
  -- (sin oráculo de existencia) y nada de la fila ajena en el error.
  IF v_chk_plantilla AND NOT EXISTS (
       SELECT 1 FROM public.plantillas_tarea_cargo p
        WHERE p.id = NEW.plantilla_id
          AND p.company_id = v_company AND p.project_id = v_project) THEN
    RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE: la plantilla % no existe en el proyecto de este bloque', NEW.plantilla_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_chk_area AND NOT EXISTS (
       SELECT 1 FROM public.areas_condominio a
        WHERE a.id = NEW.area_id
          AND a.company_id = v_company AND a.project_id = v_project) THEN
    RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE: el área % no existe en el proyecto de este bloque', NEW.area_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_chk_rutina AND NOT EXISTS (
       SELECT 1 FROM public.rutinas_limpieza r
        WHERE r.id = NEW.rutina_id
          AND r.company_id = v_company AND r.project_id = v_project) THEN
    RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE: la rutina % no existe en el proyecto de este bloque', NEW.rutina_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tarea_referencias_del_scope() IS
  'Valida que plantilla_id, area_id y rutina_id de una tarea pertenezcan a la misma compañía y proyecto que su bloque de turno (las FKs simples no lo imponen y su chequeo ignora la RLS). En UPDATE solo re-valida referencias que cambian. Rechaza con foreign_key_violation sin distinguir «no existe» de «es de otro tenant».';

REVOKE EXECUTE ON FUNCTION public.tarea_referencias_del_scope() FROM PUBLIC, anon, authenticated;

-- El nombre decide el orden: trg_referencias_del_scope < trg_tarea_copiar_snapshot,
-- así que en INSERT primero se valida y después se copia.
DROP TRIGGER IF EXISTS trg_referencias_del_scope ON public.tareas_bloque;
CREATE TRIGGER trg_referencias_del_scope
  BEFORE INSERT OR UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.tarea_referencias_del_scope();
