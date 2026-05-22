-- ============================================================
-- Periodicidad en rutas de lectura
-- ============================================================
-- Hasta ahora una ruta tenía una sola `fecha_programada`. Esta migración agrega
-- la configuración de recurrencia (diaria/semanal/quincenal/mensual/fechas
-- específicas), una hora opcional de ejecución y los ajustes de recordatorio.
-- Todo con defaults compatibles: las rutas existentes quedan como 'unica'.

ALTER TABLE public.rutas
  ADD COLUMN IF NOT EXISTS frecuencia text NOT NULL DEFAULT 'unica'
    CHECK (frecuencia IN ('unica','diaria','semanal','quincenal','mensual','fechas')),
  -- Para 'semanal': días ISO (1=lunes .. 7=domingo), p.ej. [1,3,5]
  ADD COLUMN IF NOT EXISTS dias_semana jsonb NOT NULL DEFAULT '[]',
  -- Para 'quincenal'/personalizado: cada N días desde fecha_inicio (quincenal=14)
  ADD COLUMN IF NOT EXISTS intervalo_dias int,
  -- Para 'mensual': día del mes (1..31, se ajusta a fin de mes)
  ADD COLUMN IF NOT EXISTS dia_mes int CHECK (dia_mes IS NULL OR dia_mes BETWEEN 1 AND 31),
  -- Para 'fechas': lista explícita de fechas ['YYYY-MM-DD', ...]
  ADD COLUMN IF NOT EXISTS fechas_especificas jsonb NOT NULL DEFAULT '[]',
  -- Hora local (America/Guatemala) en que debe realizarse la ruta
  ADD COLUMN IF NOT EXISTS hora_programada time,
  -- Si la recurrencia está activa (las 'unica' no la necesitan)
  ADD COLUMN IF NOT EXISTS recurrencia_activa boolean NOT NULL DEFAULT false,
  -- Ventana de vigencia de la recurrencia
  ADD COLUMN IF NOT EXISTS fecha_inicio date,
  ADD COLUMN IF NOT EXISTS fecha_fin date,
  -- Cuántos minutos antes de la ocurrencia se envía el recordatorio (1440 = 1 día)
  ADD COLUMN IF NOT EXISTS recordatorio_anticipacion_min int NOT NULL DEFAULT 1440,
  -- Canales de recordatorio activos: ['email','app']
  ADD COLUMN IF NOT EXISTS recordatorio_canales jsonb NOT NULL DEFAULT '["email","app"]';
