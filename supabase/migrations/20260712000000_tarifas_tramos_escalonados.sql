-- Tarifas de agua ESCALONADAS (P1): cobro por bloques de consumo (increasing-block).
--
-- Columna aditiva y NULLABLE: las tarifas planas existentes no cambian de conducta.
--   • tramos NULL / vacío → el cálculo usa el modelo plano de 3 tramos
--     (precio_m3 / precio_m3_exceso / canon_fijo / derecho de servicio).
--   • tramos con ≥1 bloque → ANULA el modelo plano y el cobro se calcula por
--     bloques. `consumo_minimo` + `canon_fijo` siguen aplicando como piso mínimo.
--
-- Ver src/lib/business.ts::calcularCostoTarifa (punto único de decisión) y
-- calcularTotalPagarEscalonado. La UI valida la forma con validarTramos.
--
-- Forma esperada: array de objetos contiguos desde 0, último con hasta_m3 = null:
--   [{ "desde_m3": number, "hasta_m3": number|null, "precio_m3": number }, ...]
--
-- No requiere backfill (todas las filas quedan con tramos = NULL = modelo plano).
-- El cálculo es fail-safe: si `tramos` no es un array, la app cae al modelo plano.

ALTER TABLE public.tarifas
  ADD COLUMN IF NOT EXISTS tramos jsonb;

COMMENT ON COLUMN public.tarifas.tramos IS
  'Tarifa escalonada opcional: array [{desde_m3, hasta_m3|null, precio_m3}] contiguo desde 0 (último hasta_m3=null=∞). Si tiene ≥1 bloque anula el modelo plano (precio_m3/precio_m3_exceso).';
