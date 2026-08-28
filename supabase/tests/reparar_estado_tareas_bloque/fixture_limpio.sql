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
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id     uuid NOT NULL REFERENCES public.bloques_turno(id) ON DELETE CASCADE,
  titulo        text NOT NULL,
  descripcion   text,
  orden         int  NOT NULL DEFAULT 0,
  estado        text NOT NULL DEFAULT 'pendiente',
  completada_en timestamptz,
  created_at    timestamptz DEFAULT now()
);

INSERT INTO public.bloques_turno (id, fecha) VALUES
  ('b1000000-0000-0000-0000-000000000001', DATE '2026-08-01');

-- Los datos entran ANTES del constraint — así es como una fila legacy convive
-- con un CHECK canónico NOT VALID en la realidad: es anterior a él y NOT VALID
-- no revisa el histórico.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, estado, completada_en) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'Limpiar lobby', 'pendiente', NULL),
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001',
   'Revisar luminarias', 'completado', TIMESTAMPTZ '2026-08-01 10:00Z');

-- Tal cual lo deja 20260907000100: canónico y NOT VALID.
ALTER TABLE public.tareas_bloque
  ADD CONSTRAINT tareas_bloque_estado_check
  CHECK (estado IN ('pendiente', 'completada', 'con_observacion', 'omitida'))
  NOT VALID;
