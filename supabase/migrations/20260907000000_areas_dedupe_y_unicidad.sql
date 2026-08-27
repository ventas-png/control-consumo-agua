-- ════════════════════════════════════════════════════════════════════════════
-- Áreas: fusionar las duplicadas históricas y cerrar la puerta a nuevas
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL PROBLEMA
-- `areas_condominio` nació sin UNIQUE (20260424000059), así que el catálogo
-- canónico admite "Lobby", " lobby " y "LOBBY" como tres áreas distintas del
-- mismo proyecto. Eso ya tiene consecuencia operativa: el backfill de
-- 20260904000100 dejó a propósito con `area_id = NULL` toda programación de
-- limpieza cuyo texto normalizaba contra DOS o más áreas ("pendiente de
-- resolución manual"), porque elegir una al azar habría atado la limpieza al
-- área equivocada en silencio. Mientras el catálogo tenga duplicados, esas
-- filas no se pueden cerrar y cada consumidor nuevo hereda la ambigüedad.
--
-- LO QUE HACE ESTA MIGRACIÓN
--   1. Elige una superviviente por grupo (project_id, nombre normalizado) con
--      un criterio determinista: activa > más referenciada > más antigua > id.
--   2. Re-apunta a la superviviente las CUATRO FKs entrantes que existen:
--      puntos_control_ruta.area_id (NOT NULL), plantillas_tarea_cargo.area_id,
--      tareas_bloque.area_id y programacion_limpieza.area_id.
--   3. Verifica FAIL-CLOSED antes de destruir nada: si quedara una sola
--      referencia a una perdedora, o si el re-apuntado hubiera cruzado de
--      proyecto o de empresa, aborta y no se aplica nada.
--   4. Retira las perdedoras.
--   5. Impone UNIQUE (project_id, nombre normalizado).
--   6. Re-corre el backfill de áreas de limpieza: los grupos que la fusión
--      acaba de desambiguar ya se pueden cerrar. Sin este paso el catálogo
--      queda limpio pero las programaciones ambiguas siguen colgando.
--
-- POR QUÉ EL UNIQUE ES TOTAL Y NO PARCIAL POR `activo`
-- La UI ya trata la colisión contra un área INACTIVA como duplicado y pide
-- reactivarla en vez de crear otra (AreasCatalog: "Edítala o reactívala").
-- Un índice parcial `WHERE activo` permitiría exactamente lo que ese mensaje
-- dice que no se haga.
--
-- POR QUÉ NO SE TOCAN LAS COLUMNAS DE TEXTO
-- Hay ~12 tablas con un `area`/`areas` de texto libre (checklist_areas,
-- consumo_energia_areas, movimientos_suministro.area_destino, …). No están
-- atadas por id a este catálogo y NO se reescriben: misma política que fijó
-- 20260904000100 para `programacion_limpieza.area` (snapshot, no fuente).
--
-- IDEMPOTENTE: el dedupe solo actúa sobre grupos con más de una fila (re-corre
-- en vacío), y el índice va con IF NOT EXISTS.
--
-- REVERSA: una fusión NO se revierte — las perdedoras se retiran y sus
-- referencias quedan apuntando a la superviviente. Lo reversible es el índice
-- (DROP INDEX public.uq_areas_nombre_normalizado). Mismo criterio honesto que
-- 20260904000100 para las áreas que creó su backfill.

-- ────────────────────────────────────────────────────────────────────────────
-- 1-4. Fusión, verificada fail-closed, en UNA sola transacción
-- ────────────────────────────────────────────────────────────────────────────
-- Todo en un bloque DO: psql corre en autocommit, así que sentencias sueltas
-- podrían dejar el catálogo a medio fusionar si algo falla (doctrina de
-- 20260903000000). Aquí, o se aplica entero, o no se aplica.
DO $$
DECLARE
  v_grupos    bigint;
  v_fusionadas bigint;
  v_huerfanas bigint;
  v_cruzadas  bigint;
BEGIN
  -- Mapa perdedora → superviviente. Se materializa en una tabla temporal
  -- porque lo consultan seis sentencias distintas (cuatro UPDATE, la
  -- verificación y el DELETE).
  CREATE TEMP TABLE _areas_fusion ON COMMIT DROP AS
  WITH ranked AS (
    SELECT
      a.id,
      a.company_id,
      a.project_id,
      public.areas_normalizar_nombre(a.nombre) AS norm,
      row_number() OVER (
        PARTITION BY a.project_id, public.areas_normalizar_nombre(a.nombre)
        ORDER BY
          a.activo DESC,                        -- un área viva gana a una dada de baja
          (                                     -- luego la que más se usa
            (SELECT count(*) FROM public.puntos_control_ruta   p WHERE p.area_id = a.id)
          + (SELECT count(*) FROM public.plantillas_tarea_cargo t WHERE t.area_id = a.id)
          + (SELECT count(*) FROM public.tareas_bloque          b WHERE b.area_id = a.id)
          + (SELECT count(*) FROM public.programacion_limpieza  l WHERE l.area_id = a.id)
          ) DESC,
          a.created_at ASC NULLS LAST,          -- luego la más antigua
          a.id ASC                              -- desempate estable
      ) AS rn,
      first_value(a.id) OVER (
        PARTITION BY a.project_id, public.areas_normalizar_nombre(a.nombre)
        ORDER BY
          a.activo DESC,
          (
            (SELECT count(*) FROM public.puntos_control_ruta   p WHERE p.area_id = a.id)
          + (SELECT count(*) FROM public.plantillas_tarea_cargo t WHERE t.area_id = a.id)
          + (SELECT count(*) FROM public.tareas_bloque          b WHERE b.area_id = a.id)
          + (SELECT count(*) FROM public.programacion_limpieza  l WHERE l.area_id = a.id)
          ) DESC,
          a.created_at ASC NULLS LAST,
          a.id ASC
      ) AS ganadora_id
    FROM public.areas_condominio a
    WHERE public.areas_normalizar_nombre(a.nombre) IS NOT NULL
  )
  SELECT id AS perdedora_id, ganadora_id, company_id, project_id, norm
  FROM ranked
  WHERE rn > 1;

  SELECT count(*), count(DISTINCT ganadora_id) INTO v_fusionadas, v_grupos FROM _areas_fusion;

  IF v_fusionadas = 0 THEN
    RAISE NOTICE 'areas_dedupe: no hay áreas duplicadas; nada que fusionar.';
  ELSE
    RAISE NOTICE 'areas_dedupe: % áreas duplicadas se fusionan en % supervivientes.', v_fusionadas, v_grupos;

    -- 2. Re-apuntar las CUATRO FKs entrantes. `puntos_control_ruta.area_id` es
    --    NOT NULL: no hay opción de "desatar", hay que re-apuntar.
    UPDATE public.puntos_control_ruta p
    SET area_id = f.ganadora_id
    FROM _areas_fusion f WHERE p.area_id = f.perdedora_id;

    UPDATE public.plantillas_tarea_cargo t
    SET area_id = f.ganadora_id
    FROM _areas_fusion f WHERE t.area_id = f.perdedora_id;

    UPDATE public.tareas_bloque b
    SET area_id = f.ganadora_id
    FROM _areas_fusion f WHERE b.area_id = f.perdedora_id;

    UPDATE public.programacion_limpieza l
    SET area_id = f.ganadora_id
    FROM _areas_fusion f WHERE l.area_id = f.perdedora_id;

    -- 3. Verificación fail-closed ANTES de retirar nada.
    --    (a) ninguna referencia puede seguir apuntando a una perdedora.
    SELECT
      (SELECT count(*) FROM public.puntos_control_ruta   p JOIN _areas_fusion f ON p.area_id = f.perdedora_id)
    + (SELECT count(*) FROM public.plantillas_tarea_cargo t JOIN _areas_fusion f ON t.area_id = f.perdedora_id)
    + (SELECT count(*) FROM public.tareas_bloque          b JOIN _areas_fusion f ON b.area_id = f.perdedora_id)
    + (SELECT count(*) FROM public.programacion_limpieza  l JOIN _areas_fusion f ON l.area_id = f.perdedora_id)
    INTO v_huerfanas;

    IF v_huerfanas > 0 THEN
      RAISE EXCEPTION 'areas_dedupe abortado: % referencias siguen apuntando a un área fusionada.', v_huerfanas;
    END IF;

    --    (b) el re-apuntado no puede haber cruzado de proyecto ni de empresa.
    --    `puntos_control_ruta` y `tareas_bloque` no tienen project_id propio:
    --    se comprueban por JOIN a su padre (rutas_ronda / bloques_turno).
    SELECT
      (SELECT count(*)
         FROM public.programacion_limpieza l
         JOIN public.areas_condominio a ON a.id = l.area_id
        WHERE a.project_id IS DISTINCT FROM l.project_id
           OR a.company_id IS DISTINCT FROM l.company_id)
    + (SELECT count(*)
         FROM public.plantillas_tarea_cargo t
         JOIN public.areas_condominio a ON a.id = t.area_id
        WHERE a.project_id IS DISTINCT FROM t.project_id
           OR a.company_id IS DISTINCT FROM t.company_id)
    + (SELECT count(*)
         FROM public.puntos_control_ruta p
         JOIN public.rutas_ronda r      ON r.id = p.ruta_id
         JOIN public.areas_condominio a ON a.id = p.area_id
        WHERE a.project_id IS DISTINCT FROM r.project_id
           OR a.company_id IS DISTINCT FROM r.company_id)
    + (SELECT count(*)
         FROM public.tareas_bloque b
         JOIN public.bloques_turno bt   ON bt.id = b.bloque_id
         JOIN public.areas_condominio a ON a.id = b.area_id
        WHERE a.project_id IS DISTINCT FROM bt.project_id
           OR a.company_id IS DISTINCT FROM bt.company_id)
    INTO v_cruzadas;

    IF v_cruzadas > 0 THEN
      RAISE EXCEPTION 'areas_dedupe abortado: % referencias quedaron apuntando a un área de otro proyecto o empresa.', v_cruzadas;
    END IF;

    -- 4. Retirar las perdedoras. Si algo hubiera quedado sin re-apuntar, el
    --    RESTRICT de programacion_limpieza.area_id (20260904000100) revienta
    --    aquí — que es exactamente lo que debe pasar.
    DELETE FROM public.areas_condominio a
    USING _areas_fusion f
    WHERE a.id = f.perdedora_id;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. La garantía: un nombre normalizado por proyecto
-- ────────────────────────────────────────────────────────────────────────────
-- Indexable porque `areas_normalizar_nombre` es IMMUTABLE (20260904000100).
CREATE UNIQUE INDEX IF NOT EXISTS uq_areas_nombre_normalizado
  ON public.areas_condominio (project_id, public.areas_normalizar_nombre(nombre));

COMMENT ON INDEX public.uq_areas_nombre_normalizado IS
  'Un área por nombre normalizado y proyecto (espeja areaDuplicada() del cliente). TOTAL, no parcial por `activo`: la UI pide reactivar el área inactiva en vez de crear otra igual.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Cerrar las programaciones que la fusión acaba de desambiguar
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo UPDATE que 20260904000100: coincidencia ÚNICA por nombre normalizado
-- dentro del proyecto. El NOT EXISTS ya no puede encontrar una segunda área
-- (el UNIQUE lo impide), así que los grupos antes ambiguos ahora cierran.
-- Los que siguen sin coincidencia alguna se quedan en NULL, como corresponde.
UPDATE public.programacion_limpieza pl
SET area_id = a.id
FROM public.areas_condominio a
WHERE pl.area_id IS NULL
  AND public.areas_normalizar_nombre(pl.area) IS NOT NULL
  AND a.company_id = pl.company_id
  AND a.project_id = pl.project_id
  AND public.areas_normalizar_nombre(a.nombre) = public.areas_normalizar_nombre(pl.area);
