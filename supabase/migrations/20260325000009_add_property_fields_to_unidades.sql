-- Add property registration, occupational status, and contract fields to unidades

ALTER TABLE public.unidades
  ADD COLUMN IF NOT EXISTS direccion                  text,
  ADD COLUMN IF NOT EXISTS datos_registrales          text,
  ADD COLUMN IF NOT EXISTS tipo_regimen               text,
  ADD COLUMN IF NOT EXISTS fecha_construccion         date,
  ADD COLUMN IF NOT EXISTS estado_ocupacional         text,
  ADD COLUMN IF NOT EXISTS contrato_suministro        text,
  ADD COLUMN IF NOT EXISTS fecha_firma_contrato       date,
  ADD COLUMN IF NOT EXISTS numero_contrato_suministro text,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento_contrato date;

ALTER TABLE public.unidades
  ADD CONSTRAINT unidades_tipo_regimen_check CHECK (
    tipo_regimen IS NULL OR tipo_regimen IN (
      'no_sujeto', 'urbanizacion', 'condominio', 'propiedad_horizontal', 'otro'
    )
  ),
  ADD CONSTRAINT unidades_estado_ocupacional_check CHECK (
    estado_ocupacional IS NULL OR estado_ocupacional IN (
      'en_construccion', 'habitado', 'en_remodelacion', 'desabitado',
      'en_proceso_de_mudanza', 'desocupada', 'disponible_venta',
      'disponible_renta', 'en_mantenimiento', 'problemas_legales',
      'activo_extraordinario'
    )
  ),
  ADD CONSTRAINT unidades_contrato_suministro_check CHECK (
    contrato_suministro IS NULL OR contrato_suministro IN ('si', 'no', 'na')
  );
