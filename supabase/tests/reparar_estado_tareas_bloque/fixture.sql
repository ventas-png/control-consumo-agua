-- ════════════════════════════════════════════════════════════════════════════
-- El estado de PRODUCCIÓN que 20260907000100 dio por bueno sin mirarlo
-- ════════════════════════════════════════════════════════════════════════════
--
-- NO es un esquema limpio a propósito. Un sandbox construido desde
-- supabase/migrations tiene el CHECK canónico y la reparación es un no-op:
-- probaría el escenario contrario al que dice reproducir (la misma lección de
-- drift_turnos/pre_produccion.sql). Aquí `tareas_bloque` nace con el
-- constraint ANTIGUO de producción BAJO EL MISMO NOMBRE:
--
--   tareas_bloque_estado_check
--     CHECK (estado IN ('pendiente', 'en_curso', 'completado', 'omitido'))
--
-- que es el vocabulario legacy del módulo (en masculino, el del comentario de
-- 20260424000060:25) colgado a mano sobre la tabla real. Con él vigente:
--   · el guard por conname de 20260907000100 se salta el ADD del canónico, y
--   · los tres cierres que escribe la UI ('completada', 'con_observacion',
--     'omitida') revientan con 23514.
--
-- Los datos siembran los dos legacy CON conversión definida ('completado',
-- 'omitido') junto a filas ya canónicas ('pendiente'). El valor SIN decisión
-- ('en_curso') no va aquí: lo agrega seed_en_curso.sql solo en el escenario
-- que prueba el aborto.
--
-- Y NO SOLO EL CONSTRAINT: también el TRIGGER que gatea la transición.
-- Cuando 20260907000700 corre en producción, trg_exigir_evidencia
-- (20260907000400) ya está instalado, y su cabecera avisa a propósito que un
-- script de migración de datos pasa por él igual. Un fixture sin ese trigger
-- probaría una conversión que en producción sí lo atraviesa: una fila legacy
-- con requiere_foto=true y sin fotos abortaría el apply real mientras este
-- sandbox saldría verde. La función se copia LITERAL de 20260907000400.
-- Los otros triggers de producción quedan fuera a sabiendas: no gatean nada
-- (sellar_cierre solo sella y con auth.uid() no nulo; la bitácora «nunca
-- aborta la operación original» por diseño).

CREATE TABLE public.bloques_turno (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turno       text NOT NULL DEFAULT 'manana',
  fecha       date NOT NULL,
  estado      text NOT NULL DEFAULT 'pendiente',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE public.tareas_bloque (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id            uuid NOT NULL REFERENCES public.bloques_turno(id) ON DELETE CASCADE,
  titulo               text NOT NULL,
  descripcion          text,
  orden                int  NOT NULL DEFAULT 0,
  estado               text NOT NULL DEFAULT 'pendiente',
  completada_en        timestamptz,
  -- El stack de evidencia que trg_exigir_evidencia lee (20260906000000 dejó
  -- foto_urls jsonb; 20260907000300 y 20260907000400 agregaron el resto).
  requiere_foto        boolean NOT NULL DEFAULT false,
  foto_urls            jsonb   NOT NULL DEFAULT '[]',
  evidencia_texto      text,
  requiere_comentario  boolean NOT NULL DEFAULT false,
  requiere_checklist   boolean NOT NULL DEFAULT false,
  checklist            jsonb   NOT NULL DEFAULT '[]'::jsonb,
  checklist_completado jsonb   NOT NULL DEFAULT '[]'::jsonb,
  motivo_sin_evidencia text,
  created_at           timestamptz DEFAULT now(),
  -- El homónimo incompatible, tal cual quedó en producción: mismo nombre que
  -- el canónico, vocabulario viejo, y VALIDADO (un constraint puesto a mano
  -- nace válido; el NOT VALID es una marca de las migraciones).
  CONSTRAINT tareas_bloque_estado_check
    CHECK (estado IN ('pendiente', 'en_curso', 'completado', 'omitido'))
);

-- Copia literal de 20260907000400 (el control que la conversión atraviesa).
CREATE OR REPLACE FUNCTION public.exigir_evidencia_al_cerrar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pasos int := jsonb_array_length(COALESCE(NEW.checklist, '[]'::jsonb));
BEGIN
  IF NEW.estado IS DISTINCT FROM 'completada'
     OR OLD.estado IS NOT DISTINCT FROM 'completada' THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_exigir_evidencia ON public.tareas_bloque;
CREATE TRIGGER trg_exigir_evidencia
  BEFORE UPDATE ON public.tareas_bloque
  FOR EACH ROW EXECUTE FUNCTION public.exigir_evidencia_al_cerrar();

INSERT INTO public.bloques_turno (id, fecha) VALUES
  ('b1000000-0000-0000-0000-000000000001', DATE '2026-08-01');

INSERT INTO public.tareas_bloque
  (id, bloque_id, titulo, estado, completada_en, requiere_foto, foto_urls) VALUES
  -- La que ejercita las cuatro transiciones canónicas tras la reparación.
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'Limpiar lobby', 'pendiente', NULL, false, '[]'),
  -- completado → completada, EXIGIENDO foto y SIN foto: la población exacta
  -- que hacía abortar la conversión contra el trigger. Debe pasar con
  -- motivo_sin_evidencia estampado.
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001',
   'Revisar luminarias', 'completado', TIMESTAMPTZ '2026-08-01 10:00Z', true, '[]'),
  -- omitido → omitida (el trigger no gatea esta transición).
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001',
   'Regar jardineras', 'omitido', NULL, false, '[]'),
  -- completado → completada CON su foto: debe pasar limpia, sin motivo espurio.
  ('a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001',
   'Sacar la basura', 'completado', TIMESTAMPTZ '2026-08-02 09:30Z', true,
   '["p1/turnos/basura.jpg"]');
