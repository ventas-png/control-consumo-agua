-- Merge "Control de Mudanzas" (tabla mudanzas) into "Autorizaciones de Mudanza"
-- (tabla solicitud_mudanza_unidad). Toda mudanza pasa por solicitud del residente,
-- se aprueba/rechaza, y luego avanza por los estados operativos (programada → en_curso → completada).

-- 1) Eliminar tabla mudanzas (sin data sensible).
DROP TABLE IF EXISTS public.mudanzas CASCADE;

-- 2) Extender el CHECK de estado para cubrir el flujo completo.
ALTER TABLE public.solicitud_mudanza_unidad
  DROP CONSTRAINT IF EXISTS solicitud_mudanza_unidad_estado_check;

ALTER TABLE public.solicitud_mudanza_unidad
  ADD CONSTRAINT solicitud_mudanza_unidad_estado_check
  CHECK (estado IN ('pendiente','aprobada','rechazada','programada','en_curso','completada','cancelada'));

-- 3) Añadir columnas que vivían en mudanzas.
ALTER TABLE public.solicitud_mudanza_unidad
  ADD COLUMN IF NOT EXISTS imagenes            TEXT[],
  ADD COLUMN IF NOT EXISTS empresa_mudanza     TEXT,
  ADD COLUMN IF NOT EXISTS telefono            TEXT,
  ADD COLUMN IF NOT EXISTS hora_fin            TEXT,
  ADD COLUMN IF NOT EXISTS deposito_requerido  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposito_pagado     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monto_deposito      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ascensor_reservado  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notas               TEXT;

-- 4) Garantizar que config_condominio tenga la columna terminos_mudanza
--    (la UI ya la usa; la asegura aquí por si la migración base no la incluyó).
ALTER TABLE public.config_condominio
  ADD COLUMN IF NOT EXISTS terminos_mudanza TEXT;
