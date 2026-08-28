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
  created_at    timestamptz DEFAULT now(),
  -- El homónimo incompatible, tal cual quedó en producción: mismo nombre que
  -- el canónico, vocabulario viejo, y VALIDADO (un constraint puesto a mano
  -- nace válido; el NOT VALID es una marca de las migraciones).
  CONSTRAINT tareas_bloque_estado_check
    CHECK (estado IN ('pendiente', 'en_curso', 'completado', 'omitido'))
);

INSERT INTO public.bloques_turno (id, fecha) VALUES
  ('b1000000-0000-0000-0000-000000000001', DATE '2026-08-01');

INSERT INTO public.tareas_bloque (id, bloque_id, titulo, estado, completada_en) VALUES
  -- La que ejercita las cuatro transiciones canónicas tras la reparación.
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'Limpiar lobby', 'pendiente', NULL),
  -- Los dos legacy con conversión DEFINIDA: completado → completada …
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001',
   'Revisar luminarias', 'completado', TIMESTAMPTZ '2026-08-01 10:00Z'),
  -- … y omitido → omitida.
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000001',
   'Regar jardineras', 'omitido', NULL),
  -- Una segunda completado: la conversión debe alcanzar TODAS las filas.
  ('a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001',
   'Sacar la basura', 'completado', TIMESTAMPTZ '2026-08-02 09:30Z');
