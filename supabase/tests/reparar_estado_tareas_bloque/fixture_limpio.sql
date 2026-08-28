-- ════════════════════════════════════════════════════════════════════════════
-- El OTRO estado de partida: el que deja un esquema construido desde el repo
-- ════════════════════════════════════════════════════════════════════════════
--
-- Donde el guard por conname de 20260907000100 SÍ corrió el ADD (no había
-- homónimo), el CHECK quedó canónico pero NOT VALID — y ninguna migración lo
-- validaba después, así que el histórico anterior al constraint podía
-- conservar valores legacy para siempre. Sobre este estado la reparación no
-- debe dropear nada: solo convertir lo convertible y VALIDAR, dejando
-- convalidated = true.
--
-- Se declara el estado directamente en vez de aplicar 20260907000100 entera:
-- esa migración arrastra policies, roles y helpers que no pintan nada aquí, y
-- lo que este escenario fija es EXACTAMENTE la forma del constraint que deja.

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
  requiere_foto        boolean NOT NULL DEFAULT false,
  foto_urls            jsonb   NOT NULL DEFAULT '[]',
  evidencia_texto      text,
  requiere_comentario  boolean NOT NULL DEFAULT false,
  requiere_checklist   boolean NOT NULL DEFAULT false,
  checklist            jsonb   NOT NULL DEFAULT '[]'::jsonb,
  checklist_completado jsonb   NOT NULL DEFAULT '[]'::jsonb,
  motivo_sin_evidencia text,
  created_at           timestamptz DEFAULT now()
);

-- El esquema declarado también trae trg_exigir_evidencia (20260907000400 <
-- 20260907000700): la conversión lo atraviesa igual que en producción. La
-- función es la copia literal que instala fixture.sql; aquí solo se reusa.
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
    RAISE EXCEPTION 'EVIDENCIA: la tarea "%" exige foto y no tiene ninguna', NEW.titulo
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.requiere_comentario
     AND COALESCE(btrim(NEW.evidencia_texto), '') = '' THEN
    RAISE EXCEPTION 'EVIDENCIA: la tarea "%" exige un comentario de quien la ejecuta', NEW.titulo
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.requiere_checklist AND v_pasos > 0 THEN
    IF EXISTS (
      SELECT 1 FROM generate_series(0, v_pasos - 1) AS i
      WHERE NOT (COALESCE(NEW.checklist_completado, '[]'::jsonb) @> to_jsonb(i))
    ) THEN
      RAISE EXCEPTION 'EVIDENCIA: la tarea "%" tiene el checklist a medias', NEW.titulo
        USING ERRCODE = 'check_violation';
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

-- Los datos entran ANTES del constraint — así es como una fila legacy convive
-- con un CHECK canónico NOT VALID en la realidad: es anterior a él y NOT VALID
-- no revisa el histórico. La legacy exige COMENTARIO y no lo trae: es la otra
-- rama del trigger (fixture.sql ejercita la de la foto).
INSERT INTO public.tareas_bloque
  (id, bloque_id, titulo, estado, completada_en, requiere_comentario) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'Limpiar lobby', 'pendiente', NULL, false),
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001',
   'Revisar luminarias', 'completado', TIMESTAMPTZ '2026-08-01 10:00Z', true);

-- Tal cual lo deja 20260907000100: canónico y NOT VALID.
ALTER TABLE public.tareas_bloque
  ADD CONSTRAINT tareas_bloque_estado_check
  CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
  NOT VALID;
