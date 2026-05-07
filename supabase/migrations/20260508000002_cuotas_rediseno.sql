-- Rediseño sistema de cuotas: soporte para alícuota, rubros por generación

-- 1. Campo alicuota_pct en unidades (% de participación 0-100, NULL = no definida)
ALTER TABLE unidades
  ADD COLUMN IF NOT EXISTS alicuota_pct numeric(8,4);

-- 2. Rubros en plantillas_cuota (reemplaza monto único con array de rubros)
ALTER TABLE plantillas_cuota
  ADD COLUMN IF NOT EXISTS rubros jsonb,
  ADD COLUMN IF NOT EXISTS monto_total_estimado numeric(12,2);
-- rubros: [{nombre, metodo, valor, notas?}]
-- monto_total_estimado: referencia para plantillas de monto fijo simple

-- 3. Rubros y método en generacion_cuotas_log
ALTER TABLE generacion_cuotas_log
  ADD COLUMN IF NOT EXISTS rubros jsonb,
  ADD COLUMN IF NOT EXISTS metodo_calculo text;
-- rubros: [{nombre, metodo, valor}]
-- metodo_calculo: 'fijo' | 'por_m2' | 'alicuota' | 'mixto'

-- 4. Detalle de rubros por unidad en cuotas_condominio
ALTER TABLE cuotas_condominio
  ADD COLUMN IF NOT EXISTS rubros_detalle jsonb;
-- [{nombre, metodo, valor_unitario, monto_calculado}]
