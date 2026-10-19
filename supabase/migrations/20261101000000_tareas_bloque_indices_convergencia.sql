-- ════════════════════════════════════════════════════════════════════════════
-- Convergencia de drift: los índices de tareas_bloque
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES ESTO. NO agrega funcionalidad. Escribe en el repositorio lo que
-- producción YA TIENE en los índices de `tareas_bloque`, que desde el
-- 2026-09-01 vive declarado como drift (`tabla:tareas_bloque/indices` en
-- scripts/schema-drift/drift-conocido.json, inventario #826). Sobre producción
-- es un no-op verificado índice por índice; lo que cambia es la
-- reconstrucción, que hasta ahora describía otra cosa.
--
-- POR QUÉ AHORA. Las rutinas como recorrido por áreas (#951) tienen que cambiar
-- la unicidad (bloque, plantilla) de esta tabla por (bloque, plantilla, área):
-- es la única forma de que la misma actividad exista en dos áreas de un turno.
-- Con el drift declarado, P ≠ M de antemano y el auditor de tres vías cierra
-- ese PR como CAMBIO AMBIGUO. Mismo argumento que 20260919000000: no se puede
-- desbloquear desde el PR que trae el cambio, así que la convergencia va ANTES
-- y sola. Con esto mergeado, P == M para el grupo y #951 sale CAMBIO
-- PLANIFICADO.
--
-- LAS TRES DIFERENCIAS, MEDIDAS CONTRA EL CATÁLOGO REAL
-- `pg_indexes` de producción, 2026-10-19. La forma de abajo, reconstruida sobre
-- la cadena del repositorio, da EXACTAMENTE la huella que
-- scripts/schema-drift/huella-produccion.json registra para el grupo
-- (d23b0e8d…a50f54, 6 índices).
--
--   (bloque_id, orden)  en producción se llama `tareas_bloque_bloque_id_orden_idx`,
--                       no `idx_tareas_bloque_bloque` (20260424000060). Mismas
--                       columnas: es sólo el nombre.
--   completado_por      en producción es (completado_por, completada_en DESC)
--                       WHERE completado_por IS NOT NULL; el repositorio
--                       (20260907000100) lo tenía sin `completada_en`. El de
--                       producción es mejor —sirve también para «lo último que
--                       cerró esta persona»— así que gana producción.
--   (plantilla_id)      producción NO lo tiene; el repositorio lo crea con la
--                       política de 20260606170000 (FK de dominio con índice
--                       líder). Se retira AQUÍ para que P == M, y vuelve —ya como
--                       cambio planificado que sí llega a producción— en la
--                       migración de #951.
--
-- NO-OP SOBRE PRODUCCIÓN, Y VERIFICADO ANTES DE ACTUAR. Cada bloque mide el
-- catálogo y sólo escribe si hace falta: ningún DROP/CREATE a ciegas.
-- supabase/tests/tareas_bloque_indices/run.sh lo prueba sobre las dos formas.
--
-- NO TOCA la unicidad `uq_tareas_bloque_plantilla`: coincide a ambos lados, y
-- cambiarla es justamente el trabajo de #951.
--
-- IDEMPOTENTE: todo dentro de DO $$ con guardia por catálogo.
--
-- REVERSA: no tiene sentido revertirla —dejaría al repositorio describiendo un
-- esquema que producción no tiene—, pero si hiciera falta:
--   ALTER INDEX public.tareas_bloque_bloque_id_orden_idx RENAME TO idx_tareas_bloque_bloque;
--   DROP INDEX public.idx_tareas_bloque_completado_por;
--   CREATE INDEX idx_tareas_bloque_completado_por ON public.tareas_bloque(completado_por)
--     WHERE completado_por IS NOT NULL;
--   CREATE INDEX idx_tareas_bloque_plantilla_id ON public.tareas_bloque(plantilla_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 1. (bloque_id, orden): el nombre de producción
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.idx_tareas_bloque_bloque') IS NOT NULL THEN
    IF to_regclass('public.tareas_bloque_bloque_id_orden_idx') IS NULL THEN
      ALTER INDEX public.idx_tareas_bloque_bloque RENAME TO tareas_bloque_bloque_id_orden_idx;
      RAISE NOTICE 'CONVERGENCIA: idx_tareas_bloque_bloque → tareas_bloque_bloque_id_orden_idx';
    ELSE
      -- Los dos a la vez serían el mismo índice duplicado.
      DROP INDEX public.idx_tareas_bloque_bloque;
      RAISE NOTICE 'CONVERGENCIA: retirado idx_tareas_bloque_bloque (duplicaba tareas_bloque_bloque_id_orden_idx)';
    END IF;
  ELSIF to_regclass('public.tareas_bloque_bloque_id_orden_idx') IS NULL THEN
    CREATE INDEX tareas_bloque_bloque_id_orden_idx ON public.tareas_bloque (bloque_id, orden);
    RAISE NOTICE 'CONVERGENCIA: creado tareas_bloque_bloque_id_orden_idx';
  ELSE
    RAISE NOTICE 'CONVERGENCIA: tareas_bloque_bloque_id_orden_idx ya estaba';
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. completado_por: la definición de producción
-- ────────────────────────────────────────────────────────────────────────────
-- Se compara la definición del catálogo, no sólo el nombre: con el nombre
-- bastaría un índice homónimo con otras columnas para darlo por bueno.
DO $$
DECLARE
  v_def  text;
  v_meta constant text :=
    'CREATE INDEX idx_tareas_bloque_completado_por ON public.tareas_bloque USING btree (completado_por, completada_en DESC) WHERE (completado_por IS NOT NULL)';
BEGIN
  IF to_regclass('public.idx_tareas_bloque_completado_por') IS NOT NULL THEN
    v_def := pg_get_indexdef('public.idx_tareas_bloque_completado_por'::regclass);
  END IF;

  IF v_def IS NOT DISTINCT FROM v_meta THEN
    RAISE NOTICE 'CONVERGENCIA: idx_tareas_bloque_completado_por ya tenía la forma de producción';
    RETURN;
  END IF;

  IF v_def IS NOT NULL THEN
    DROP INDEX public.idx_tareas_bloque_completado_por;
  END IF;
  CREATE INDEX idx_tareas_bloque_completado_por
    ON public.tareas_bloque (completado_por, completada_en DESC)
    WHERE completado_por IS NOT NULL;
  RAISE NOTICE 'CONVERGENCIA: idx_tareas_bloque_completado_por → (completado_por, completada_en DESC)';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. (plantilla_id): producción no lo tiene
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.idx_tareas_bloque_plantilla_id') IS NOT NULL THEN
    DROP INDEX public.idx_tareas_bloque_plantilla_id;
    RAISE NOTICE 'CONVERGENCIA: retirado idx_tareas_bloque_plantilla_id (producción no lo tiene; vuelve con #951)';
  ELSE
    RAISE NOTICE 'CONVERGENCIA: idx_tareas_bloque_plantilla_id ya no estaba';
  END IF;
END;
$$;
