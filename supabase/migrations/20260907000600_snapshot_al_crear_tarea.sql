-- ════════════════════════════════════════════════════════════════════════════
-- La tarea cargada a mano deja de llegar desarmada
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO QUE CIERRA
-- Hay TRES rutas de alta de tareas desde plantilla. `materializar_rutinas_turno`
-- (20260907000300) copia el snapshot completo. Las otras dos —«desde plantilla»
-- y «cargar plantillas del cargo», ambas en TareasPersonalTab— escriben SÓLO
-- cuatro campos: titulo, descripcion, area_id y requiere_foto.
--
-- Se pierden `duracion_estimada_min`, `checklist`, `instrucciones_seguridad`,
-- `requiere_comentario` y `requiere_checklist`. Y las consecuencias no son
-- simétricas:
--
--   · `instrucciones_seguridad` es lo grave. 20260907000400 puso las
--     instrucciones arriba del panel y SIEMPRE, justamente porque leerlas al
--     cerrar es tarde. Una tarea cargada a mano llega sin la advertencia, en
--     silencio y con el mismo aspecto que una materializada.
--
--   · El gate de evidencia se desarma solo. `trg_exigir_evidencia` exige lo que
--     la FILA declara; con las banderas en false y el checklist vacío, la tarea
--     cierra sin nada y nadie se entera de que debía exigir.
--
-- POR QUÉ EN LA BASE Y NO EN LAS DOS FUNCIONES DEL CLIENTE
-- Mismo argumento que 20260907000500: son tres rutas de escritura, y un trigger
-- las cubre a las tres —incluida cualquiera que aparezca después—. Arreglar el
-- cliente dejaría la regla escrita en tres lugares que pueden divergir, que es
-- exactamente cómo nació este hueco.
--
-- LA REGLA ES MONÓTONA: SÓLO APRIETA
-- `requiere_foto`, `requiere_comentario` y `requiere_checklist` son
-- `boolean NOT NULL DEFAULT false` (20260907000300). NO hay forma de distinguir
-- «el que inserta dijo false» de «no dijo nada». Por eso el trigger NUNCA
-- asigna: hace OR. Sólo puede subir una exigencia, jamás bajarla.
--
-- Eso lo vuelve seguro por construcción —no puede debilitar lo que el llamador
-- pidió— y es lo que la pantalla ya hacía a mano con `requiere_foto`: la regla
-- se muda a un solo lugar en vez de vivir repetida.
--
-- Los nullables sí tienen un centinela limpio y se llenan sólo si vienen
-- vacíos: `duracion_estimada_min` e `instrucciones_seguridad` por COALESCE, y
-- `checklist` cuando está en '[]' (su DEFAULT).
--
-- LA MATERIALIZACIÓN NO SE VE AFECTADA
-- Ya escribe esos valores, así que los COALESCE no hacen nada y los OR operan
-- sobre valores iguales. El sandbox lo comprueba en vez de asumirlo.
--
-- SECURITY DEFINER, Y NO POR COSTUMBRE
-- `tareas_bloque_insert` (20260907000100) acepta `tareas_personal`, `turnos` y
-- `prog_limpieza`. Pero `plantillas_tarea_cargo_select` (20260904000200) acepta
-- `plantillas_cargo`, `tareas_personal` y `prog_limpieza` — NO `turnos`. Un
-- usuario con sólo `turnos` puede crear la tarea y, con INVOKER, la copia no
-- encontraría la plantilla: fallaría en silencio, que es el peor modo de fallar
-- para algo que existe para no perder datos.
--
-- BEFORE INSERT: hay que escribir sobre NEW antes de que la fila se grabe. Es
-- el primer BEFORE INSERT de esta tabla (los otros tres son BEFORE UPDATE, y el
-- de insumos es AFTER INSERT), así que no compite en orden con nada.
--
-- IDEMPOTENTE: sí — CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
--
-- REVERSA:
-- DROP TRIGGER trg_tarea_copiar_snapshot ON public.tareas_bloque;
-- DROP FUNCTION public.tarea_copiar_snapshot_plantilla();

CREATE OR REPLACE FUNCTION public.tarea_copiar_snapshot_plantilla()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  p record;
BEGIN
  -- Tarea ad-hoc: no hay receta que copiar. No es un error.
  IF NEW.plantilla_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT duracion_estimada_min, checklist, instrucciones_seguridad,
         requiere_foto, requiere_comentario, requiere_checklist
    INTO p
  FROM public.plantillas_tarea_cargo
  WHERE id = NEW.plantilla_id;

  -- Plantilla inexistente: la FK ya lo cubre. Aquí simplemente no se copia
  -- nada, en vez de abortar el alta del turno por una referencia rota.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Nullables: se llenan sólo si vienen vacíos. Lo que el llamador mandó manda.
  NEW.duracion_estimada_min   := COALESCE(NEW.duracion_estimada_min, p.duracion_estimada_min);
  NEW.instrucciones_seguridad := COALESCE(NEW.instrucciones_seguridad, p.instrucciones_seguridad);

  -- `checklist` es NOT NULL DEFAULT '[]': el arreglo vacío ES el centinela.
  IF jsonb_array_length(COALESCE(NEW.checklist, '[]'::jsonb)) = 0 THEN
    NEW.checklist := COALESCE(p.checklist, '[]'::jsonb);
  END IF;

  -- Las tres banderas: OR y no asignación. Es TODA la garantía de que este
  -- trigger no puede aflojar una exigencia que alguien puso a propósito —y de
  -- que la materialización, que ya las trae puestas, no cambia de resultado.
  NEW.requiere_foto        := NEW.requiere_foto        OR COALESCE(p.requiere_foto, false);
  NEW.requiere_comentario  := NEW.requiere_comentario  OR COALESCE(p.requiere_comentario, false);
  NEW.requiere_checklist   := NEW.requiere_checklist   OR COALESCE(p.requiere_checklist, false);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tarea_copiar_snapshot_plantilla() IS
  'Completa el snapshot de la tarea desde su plantilla al crearse: llena los nullables vacíos y SUBE las banderas de exigencia con OR (nunca las baja). Cubre las tres rutas de alta con una sola implementación; sin esto, las dos manuales pierden checklist, instrucciones de seguridad y exigencias.';

-- Regla (e) del migrations-guard: toda SECURITY DEFINER nueva revoca PUBLIC.
-- Sólo la invoca el trigger; nadie la llama directo.
REVOKE EXECUTE ON FUNCTION public.tarea_copiar_snapshot_plantilla() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tarea_copiar_snapshot ON public.tareas_bloque;
CREATE TRIGGER trg_tarea_copiar_snapshot
  BEFORE INSERT ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.tarea_copiar_snapshot_plantilla();
