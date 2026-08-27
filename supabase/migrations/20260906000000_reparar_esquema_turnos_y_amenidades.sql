-- ════════════════════════════════════════════════════════════════════════════
-- Turnos y amenidades: producción toma la forma que el repositorio declara
-- ════════════════════════════════════════════════════════════════════════════
--
-- CÓMO SE ENCONTRÓ. La guarda de #796 (scripts/migraciones-vs-produccion.mjs)
-- corrió por primera vez contra producción y devolvió 10 columnas que
-- migraciones YA REGISTRADAS declaran y la base real no tiene. No es un desfase
-- benigno: dos de las tres tablas existen en producción con una forma MÁS VIEJA
-- y con OTROS NOMBRES para el mismo concepto.
--
--   concepto            producción        20260424000060 declara
--   ─────────────────── ───────────────── ───────────────────────
--   cierre del bloque   finalizado_en     cerrado_en
--   cierre de la tarea  completado_en     completada_en
--   evidencia           foto_url (text)   foto_urls (jsonb)
--   (no existen)        —                 plantilla_id, requiere_foto,
--                                         evidencia_texto, notas_operativo,
--                                         puntaje_completitud
--
-- Ninguno de los nombres de producción aparece en migración alguna: esas tablas
-- se crearon a mano y el repositorio nunca describió lo que hay.
--
-- QUÉ ESTÁ ROTO HOY, y por qué no se había notado:
--   · Cerrar un bloque de turno escribe `cerrado_en` + `puntaje_completitud`
--     (TareasPersonalTab:106). Falla, y el código NO mira el error que devuelve
--     updateCondominioRow: el turno simplemente no se cierra, sin decir nada.
--   · Completar una tarea escribe `completada_en` + `notas_operativo` (:175,
--     :180). Mismo fallo mudo.
--   · Agregar una tarea a un bloque manda `plantilla_id` + `requiere_foto`
--     (:127) → 400.
--   · Crear un bloqueo de amenidad manda `notas` + `created_by`
--     (AmenidadesTab:341) → 400, éste sí con mensaje visible.
--
-- POR QUÉ SE ELIGE ALINEAR PRODUCCIÓN Y NO LA APP. El repositorio es la fuente
-- de verdad del esquema: es lo que construye el sandbox de los E2E, un restore
-- de disaster-recovery y cualquier región nueva. Cambiar la app a los nombres de
-- producción dejaría a esos entornos con el esquema declarado y a la app
-- hablándole a otro, y encima cinco de las diez columnas no tienen equivalente
-- en producción — habría que crearlas igual. Se alinea la base.
--
-- IDEMPOTENTE y NO-OP SOBRE ESQUEMA LIMPIO: todo va con guarda por catálogo. En
-- un entorno construido desde supabase/migrations los nombres correctos ya
-- existen y esta migración no hace nada.
--
-- REVERSA: renombrar de vuelta las dos columnas y DROP de las siete añadidas.
-- `foto_urls` NO se puede revertir sin pérdida si alguien ya guardó una segunda
-- foto — por eso `foto_url` se conserva (ver el punto 3).

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Ayuda: renombrar sólo si es inequívoco
-- ────────────────────────────────────────────────────────────────────────────
-- Renombrar cuando EXISTEN LAS DOS columnas no es una migración, es una
-- decisión: habría datos en ambas y elegir una descarta los de la otra en
-- silencio. Ahí se aborta y se pide intervención. Es el mismo criterio que el
-- backfill de 20260904000100 aplica a los nombres ambiguos: atar mal es peor
-- que no atar.
CREATE OR REPLACE FUNCTION pg_temp.renombrar_si_inequivoco(
  p_tabla text, p_vieja text, p_nueva text
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  v_vieja boolean;
  v_nueva boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = ('public.' || p_tabla)::regclass
                    AND attname = p_vieja AND attnum > 0 AND NOT attisdropped),
         EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = ('public.' || p_tabla)::regclass
                    AND attname = p_nueva AND attnum > 0 AND NOT attisdropped)
    INTO v_vieja, v_nueva;

  IF v_vieja AND v_nueva THEN
    RAISE EXCEPTION
      'ESQUEMA_TURNOS: %.% y %.% existen LAS DOS. Hay datos en ambas y elegir una descartaría los de la otra: decidir a mano antes de re-aplicar.',
      p_tabla, p_vieja, p_tabla, p_nueva
      USING ERRCODE = 'duplicate_column';
  END IF;

  IF v_vieja AND NOT v_nueva THEN
    EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I', p_tabla, p_vieja, p_nueva);
    RAISE NOTICE 'ESQUEMA_TURNOS: %.% renombrada a %.', p_tabla, p_vieja, p_nueva;
    RETURN true;
  END IF;

  RETURN false;  -- ya estaba con el nombre bueno (o no existe ninguna)
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. amenidades_bloqueos — el caso limpio
-- ────────────────────────────────────────────────────────────────────────────
-- Las dos columnas faltan sin más: no chocan con ningún nombre existente, así
-- que es un ADD COLUMN y ya. Declaradas en 20260425000002:16-17.
DO $$
BEGIN
  IF to_regclass('public.amenidades_bloqueos') IS NULL THEN RETURN; END IF;

  ALTER TABLE public.amenidades_bloqueos
    ADD COLUMN IF NOT EXISTS notas      text,
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. bloques_turno — el cierre del turno
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.bloques_turno') IS NULL THEN RETURN; END IF;

  PERFORM pg_temp.renombrar_si_inequivoco('bloques_turno', 'finalizado_en', 'cerrado_en');

  ALTER TABLE public.bloques_turno
    ADD COLUMN IF NOT EXISTS cerrado_en          timestamptz,
    ADD COLUMN IF NOT EXISTS puntaje_completitud int;

  COMMENT ON COLUMN public.bloques_turno.cerrado_en IS
    'Cuándo se cerró el bloque de turno. En producción se llamaba `finalizado_en` (nombre que ninguna migración declaraba); 20260906000000 lo alineó conservando los datos.';
  COMMENT ON COLUMN public.bloques_turno.puntaje_completitud IS
    'Porcentaje 0-100 de tareas completadas, calculado al cerrar el bloque.';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. tareas_bloque — el cierre de la tarea y su evidencia
-- ────────────────────────────────────────────────────────────────────────────
-- `completado_en` → `completada_en` es un rename: mismo dato, mismo tipo.
--
-- `foto_url` → `foto_urls` NO lo es. Producción tiene UN text; la migración
-- declara un jsonb con la LISTA. Se crea la nueva y se copia envolviendo el
-- valor en un array de un elemento.
--
-- Y la vieja SE CONSERVA. Borrar la única copia de la evidencia en la misma
-- migración que la convierte no deja a dónde volver si la conversión estuviera
-- mal; el retiro va en un cierre posfusión aparte, cuando se haya comprobado
-- contra los datos reales (mismo patrón que 20260903000000 con recepción).
DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.tareas_bloque') IS NULL THEN RETURN; END IF;

  PERFORM pg_temp.renombrar_si_inequivoco('tareas_bloque', 'completado_en', 'completada_en');

  ALTER TABLE public.tareas_bloque
    ADD COLUMN IF NOT EXISTS completada_en   timestamptz,
    ADD COLUMN IF NOT EXISTS plantilla_id    uuid REFERENCES public.plantillas_tarea_cargo(id),
    ADD COLUMN IF NOT EXISTS requiere_foto   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS evidencia_texto text,
    ADD COLUMN IF NOT EXISTS notas_operativo text,
    ADD COLUMN IF NOT EXISTS foto_urls       jsonb NOT NULL DEFAULT '[]'::jsonb;

  -- La copia sólo tiene sentido donde la columna vieja existe (producción). En
  -- un esquema limpio `foto_url` no está y esto no corre.
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.tareas_bloque'::regclass
                AND attname = 'foto_url' AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE $q$
      UPDATE public.tareas_bloque
         SET foto_urls = jsonb_build_array(foto_url)
       WHERE foto_url IS NOT NULL
         AND btrim(foto_url) <> ''
         AND foto_urls = '[]'::jsonb
    $q$;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE 'ESQUEMA_TURNOS: % tarea(s) con foto migradas de foto_url a foto_urls. La columna vieja SE CONSERVA hasta el cierre posfusión.', n;
  END IF;

  COMMENT ON COLUMN public.tareas_bloque.completada_en IS
    'Cuándo se completó la tarea. En producción se llamaba `completado_en`; 20260906000000 lo alineó conservando los datos. El par de sellado correcto es (completada_en, completado_por).';
  COMMENT ON COLUMN public.tareas_bloque.foto_urls IS
    'Paths (bare) de la evidencia, en lista. Producción guardaba UNA sola en `foto_url` (text); 20260906000000 la envolvió en un array de un elemento y conserva la columna vieja hasta el cierre posfusión.';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Contrato: lo que la app escribe tiene que existir — fail-closed
-- ────────────────────────────────────────────────────────────────────────────
-- Se acumula todo lo que falte y se levanta UNA excepción con la lista
-- completa. Un run tiene que contar la historia entera; ir descubriendo un
-- hueco por corrida es lo que hizo caro el diagnóstico del 2026-08-27.
DO $$
DECLARE
  faltan text[] := ARRAY[]::text[];
  r      record;
  oid_t  oid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- TareasPersonalTab.cerrarBloque
      ('bloques_turno',       'cerrado_en'),
      ('bloques_turno',       'puntaje_completitud'),
      -- TareasPersonalTab: alta de tarea y marcado
      ('tareas_bloque',       'plantilla_id'),
      ('tareas_bloque',       'requiere_foto'),
      ('tareas_bloque',       'completada_en'),
      ('tareas_bloque',       'notas_operativo'),
      ('tareas_bloque',       'evidencia_texto'),
      ('tareas_bloque',       'foto_urls'),
      -- AmenidadesTab: alta de bloqueo
      ('amenidades_bloqueos', 'notas'),
      ('amenidades_bloqueos', 'created_by')
    ) AS t(tabla, col)
  LOOP
    oid_t := to_regclass('public.' || r.tabla);
    IF oid_t IS NULL THEN
      faltan := faltan || format('tabla public.%s', r.tabla);
    ELSIF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = oid_t AND attname = r.col AND attnum > 0 AND NOT attisdropped
    ) THEN
      faltan := faltan || format('columna public.%s.%s', r.tabla, r.col);
    END IF;
  END LOOP;

  IF array_length(faltan, 1) > 0 THEN
    RAISE EXCEPTION E'ESQUEMA_TURNOS: la reparación no dejó el esquema que la app escribe.\nFalta:\n  · %',
      array_to_string(faltan, E'\n  · ')
      USING ERRCODE = 'undefined_column';
  END IF;

  RAISE NOTICE 'ESQUEMA_TURNOS: contrato completo. Cerrar bloque, completar tarea, agregar tarea y bloquear amenidad tienen sus columnas.';
END;
$$;
