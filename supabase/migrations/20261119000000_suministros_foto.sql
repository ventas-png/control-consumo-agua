-- ════════════════════════════════════════════════════════════════════════════
-- Suministros: la ficha del insumo lleva una foto
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- «Alcohol etílico al 70 %», «Bolsas de basura extra grande», «Papel toalla
-- jumbo»: el nombre no siempre basta para reconocer el insumo en la bodega ni
-- para pedirle al proveedor exactamente el mismo. La ficha sólo guardaba texto.
--
-- LO QUE HACE
--   `suministros_condominio.foto_url text` — UNA foto, la ruta en el bucket
--   privado `condominios-media` (`<project_id>/suministros/<archivo>.jpg`), el
--   mismo formato que `inventario_condominio.foto_url` y `mascotas.foto_url`: se
--   guarda la ruta, no una URL firmada, y SecureImage la firma al mostrarla.
--   NULL = sin foto.
--
-- LO QUE **NO** HACE: no toca las policies de la tabla (la UPDATE ya exige
-- suministros.edit, 20261104000600) ni las del bucket (20260603220000 ya acota
-- `condominios-media` por proyecto en la primera carpeta de la ruta). El guard
-- de stock (suministros_tg_guard_stock, 20260821000200) sólo vigila
-- stock_actual, así que cambiar la foto no se topa con él.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS.
--
-- REVERSA: ALTER TABLE public.suministros_condominio DROP COLUMN foto_url;
-- Los archivos del bucket no se borran solos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.suministros_condominio
  ADD COLUMN IF NOT EXISTS foto_url text;

COMMENT ON COLUMN public.suministros_condominio.foto_url IS
  'Ruta de la foto del insumo en el bucket condominios-media (<project_id>/suministros/...). NULL = sin foto.';
