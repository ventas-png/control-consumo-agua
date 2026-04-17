-- Add route type and item arrays to rutas table
-- Supports 3 structuring modes: 'clientes' (default), 'contadores', 'unidades'
ALTER TABLE rutas
  ADD COLUMN IF NOT EXISTS tipo_ruta    text  NOT NULL DEFAULT 'clientes',
  ADD COLUMN IF NOT EXISTS contador_ids jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS unidad_ids   jsonb NOT NULL DEFAULT '[]';
