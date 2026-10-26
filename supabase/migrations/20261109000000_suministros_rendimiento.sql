-- ════════════════════════════════════════════════════════════════════════════
-- Suministros: rendimiento declarado por unidad de medida
-- ════════════════════════════════════════════════════════════════════════════
--
-- «Alcohol etílico al 70 %: 1 litro rinde 40 aplicaciones». La ficha del insumo
-- guardaba el stock, el mínimo y el costo, pero no cuánto da cada unidad; sin
-- eso el stock no dice cuántos usos quedan ni cuánto cuesta cada uso, y la
-- pantalla no ofrecía dónde anotarlo.
--
--   rendimiento         cuántos «usos» da UNA unidad_medida (NULL = no declarado)
--   rendimiento_unidad  en qué se mide ese uso: aplicaciones, limpiezas, m², días…
--
-- Lo derivado —usos disponibles = stock_actual × rendimiento, costo por uso =
-- costo_unitario / rendimiento— se calcula en pantalla (src/lib/suministros.ts):
-- es aritmética sobre columnas de la misma fila, no un hecho que haya que
-- persistir ni mantener sincronizado.
--
-- Sin RLS nueva: son columnas de una tabla ya protegida (la UPDATE exige
-- suministros.edit, 20261104000600) y el guard de stock
-- (suministros_tg_guard_stock, 20260821000200) sólo vigila stock_actual, así
-- que editar el rendimiento no toca ni se topa con él.

ALTER TABLE public.suministros_condominio
  ADD COLUMN IF NOT EXISTS rendimiento        numeric(10,2),
  ADD COLUMN IF NOT EXISTS rendimiento_unidad text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suministros_rendimiento_check') THEN
    ALTER TABLE public.suministros_condominio
      ADD CONSTRAINT suministros_rendimiento_check CHECK (rendimiento IS NULL OR rendimiento > 0);
  END IF;
END;
$$;

COMMENT ON COLUMN public.suministros_condominio.rendimiento IS
  'Cuántos usos (rendimiento_unidad) da UNA unidad_medida. NULL = no declarado.';
COMMENT ON COLUMN public.suministros_condominio.rendimiento_unidad IS
  'En qué se mide el rendimiento: aplicaciones, limpiezas, m², días… Texto libre; sólo tiene sentido con rendimiento.';
