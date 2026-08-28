-- ════════════════════════════════════════════════════════════════════════════
-- La evidencia deja de ser decorativa: se exige AL CERRAR
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL AGUJERO QUE CIERRA
-- `tareas_bloque.requiere_foto` existe desde 20260424000060 y nunca se exigió:
-- en la única pantalla que ejecuta tareas (TareasPersonalTab) aparece como una
-- etiqueta «📷 Requiere foto» y nada más — `marcarTarea()` pasa la tarea a
-- 'completada' sin mirar si hay foto, y ni siquiera escribe `foto_urls`.
--
-- La serie 20260904*–20260907000300 agravó el desperdicio: el catálogo declara
-- checklist, comentario obligatorio e instrucciones de seguridad, y
-- 20260907000300 los COPIA a cada tarea al materializar… para que nadie los
-- lea ni los exija. Dato muerto.
--
-- POR QUÉ EN LA BASE Y NO SÓLO EN LA UI
-- Porque «sólo en la UI» es exactamente cómo `requiere_foto` terminó siendo
-- decorativo. La pantalla es la cortesía; el trigger es el control. Cualquier
-- otra ruta de escritura —otro tab, la API, un script de migración de datos—
-- pasa por aquí igual.
--
-- SE GATEA LA TRANSICIÓN, NO LA FILA
-- El trigger sólo mira el paso a 'completada' (mismo criterio que sellar_cierre,
-- 20260731000000). Eso resuelve solo el problema de las filas históricas: las
-- tareas ya cerradas sin evidencia nunca se re-validan, porque nunca vuelven a
-- hacer esa transición. Por eso no hace falta un CHECK NOT VALID.
--
-- SÓLO 'completada'
-- `con_observacion` es el operativo diciendo «esto no se pudo / hay un
-- problema», y `omitida` es que no se hizo. Exigirles la evidencia completa
-- castigaría el reporte honesto y empujaría a cerrar en falso, que es
-- justamente lo que este trigger viene a evitar.
--
-- LA SALIDA DE EMERGENCIA TIENE NOMBRE
-- `motivo_sin_evidencia`: si trae texto, el cierre se permite y la fila DICE
-- por qué. Es el patrón de `motivo_anulacion` (20260907000100) y es mejor que
-- un bypass por rol: el admin que corrige un registro deja constancia en vez de
-- saltarse el control en silencio. Un bypass por `is_super_admin()` no dejaría
-- rastro en la fila, y la evidencia es justamente lo que esta tabla guarda.
--
-- EL CHECKLIST NECESITABA DÓNDE ANOTARSE
-- `checklist` guarda la DEFINICIÓN de pasos (snapshot de 20260907000300).
-- `checklist_completado` guarda las POSICIONES hechas. Posiciones y no textos
-- porque el snapshot es inmutable —los índices no se despegan de nada— y no
-- duplica el texto del paso en cada fila.
--
-- IDEMPOTENTE: sí — ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE y DROP IF
-- EXISTS antes del trigger.
--
-- REVERSA: DROP TRIGGER trg_exigir_evidencia ON public.tareas_bloque;
-- DROP FUNCTION public.exigir_evidencia_al_cerrar();
-- ALTER TABLE public.tareas_bloque
--   DROP COLUMN checklist_completado, DROP COLUMN motivo_sin_evidencia;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Dónde se anota lo cumplido, y dónde la excepción declarada
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tareas_bloque
  ADD COLUMN IF NOT EXISTS checklist_completado jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS motivo_sin_evidencia text;

COMMENT ON COLUMN public.tareas_bloque.checklist_completado IS
  'Posiciones (0-based) de `checklist` ya cumplidas. Índices y no textos: el checklist es un snapshot inmutable, así que las posiciones no se despegan de nada.';
COMMENT ON COLUMN public.tareas_bloque.motivo_sin_evidencia IS
  'Excepción DECLARADA: permite cerrar sin la evidencia exigida, dejando por escrito por qué. Es la alternativa a un bypass por rol, que no dejaría rastro en la fila.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. El control
-- ────────────────────────────────────────────────────────────────────────────
-- No es SECURITY DEFINER: no lee nada fuera de la fila que se está escribiendo,
-- así que no necesita saltarse ninguna RLS. Cuanto menos privilegio, mejor.
CREATE OR REPLACE FUNCTION public.exigir_evidencia_al_cerrar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pasos int := jsonb_array_length(COALESCE(NEW.checklist, '[]'::jsonb));
BEGIN
  -- Sólo la TRANSICIÓN a completada. Reabrir, corregir texto o tocar cualquier
  -- otra columna de una tarea ya cerrada no vuelve a pasar por aquí.
  IF NEW.estado IS DISTINCT FROM 'completada'
     OR OLD.estado IS NOT DISTINCT FROM 'completada' THEN
    RETURN NEW;
  END IF;

  -- Excepción declarada: se permite, y queda escrito por qué.
  IF COALESCE(btrim(NEW.motivo_sin_evidencia), '') <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.requiere_foto
     AND jsonb_array_length(COALESCE(NEW.foto_urls, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION
      'EVIDENCIA: la tarea "%" exige foto y no tiene ninguna', NEW.titulo
      USING ERRCODE = 'check_violation',
            HINT = 'Adjuntá al menos una foto, o declará el motivo en motivo_sin_evidencia.';
  END IF;

  IF NEW.requiere_comentario
     AND COALESCE(btrim(NEW.evidencia_texto), '') = '' THEN
    RAISE EXCEPTION
      'EVIDENCIA: la tarea "%" exige un comentario de quien la ejecuta', NEW.titulo
      USING ERRCODE = 'check_violation',
            HINT = 'Escribí el comentario en evidencia_texto, o declará el motivo en motivo_sin_evidencia.';
  END IF;

  -- El checklist se exige COMPLETO: un checklist a medias no es evidencia de
  -- que la tarea se hizo, es evidencia de que se hizo una parte.
  IF NEW.requiere_checklist AND v_pasos > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM generate_series(0, v_pasos - 1) AS i
      WHERE NOT (COALESCE(NEW.checklist_completado, '[]'::jsonb) @> to_jsonb(i))
    ) THEN
      RAISE EXCEPTION
        'EVIDENCIA: la tarea "%" tiene el checklist a medias', NEW.titulo
        USING ERRCODE = 'check_violation',
              HINT = 'Marcá todos los pasos, o declará el motivo en motivo_sin_evidencia.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.exigir_evidencia_al_cerrar() IS
  'Rechaza el paso de una tarea a estado completada si no trae la evidencia que ella misma declara (foto, comentario, checklist completo), salvo que se declare motivo_sin_evidencia. Sólo gatea la transición: las filas históricas no se re-validan.';

DROP TRIGGER IF EXISTS trg_exigir_evidencia ON public.tareas_bloque;
CREATE TRIGGER trg_exigir_evidencia
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.exigir_evidencia_al_cerrar();
