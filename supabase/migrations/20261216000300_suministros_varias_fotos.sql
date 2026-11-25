-- ════════════════════════════════════════════════════════════════════════════
-- Suministros: la ficha del insumo lleva VARIAS fotos
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- 20261119000000 le dio al insumo UNA foto (`foto_url`). Con una no alcanza:
-- el frente del envase, la etiqueta con la dilución o la ficha de seguridad, el
-- código del proveedor. Se pidió poder subir varias.
--
-- LO QUE HACE
--   `suministros_condominio.fotos text[]` — rutas en el bucket privado
--   `condominios-media` (`<project_id>/suministros/<archivo>.jpg`), el mismo
--   formato que `objetos_perdidos.fotos` y `control_sistema_incendio.fotos`: se
--   guarda la ruta, no una URL firmada, y SecureImage la firma al mostrarla.
--   NOT NULL DEFAULT '{}' para que la UI no distinga «sin fotos» de NULL, y un
--   CHECK de máximo 6 (lo mismo que ofrece el uploader) para que ningún otro
--   camino de escritura llene la fila sin límite.
--
-- `foto_url` QUEDA COMO LEGADO, sin tocar sus datos (mismo criterio que
-- `objetos_perdidos.foto_url` en 20261119000001): la app muestra la foto vieja
-- junto con las nuevas mientras la fila no se edite, y al guardar la ficha
-- (o sus fotos) la pasa a `fotos` y deja `foto_url` en NULL. Así no hace falta
-- reescribir filas de producción, y un cliente viejo que todavía escriba
-- `foto_url` durante el despliegue no pierde nada.
--
-- LO QUE **NO** HACE: no toca las policies de la tabla (la UPDATE ya exige
-- suministros.edit, 20261104000600) ni las del bucket (20260603220000 acota
-- `condominios-media` por proyecto en la primera carpeta de la ruta). El guard
-- de stock (suministros_tg_guard_stock) sólo vigila stock_actual.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS y el CHECK se crea sólo si no existe.
--
-- REVERSA: ALTER TABLE public.suministros_condominio DROP COLUMN fotos;
-- (arrastra el CHECK). Antes, si ya hay fotos en `fotos`, copiar la primera a
-- `foto_url` para no perderla de la pantalla vieja. Los archivos del bucket no
-- se borran solos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.suministros_condominio
  ADD COLUMN IF NOT EXISTS fotos text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suministros_condominio_fotos_max') THEN
    ALTER TABLE public.suministros_condominio
      ADD CONSTRAINT suministros_condominio_fotos_max CHECK (cardinality(fotos) <= 6);
  END IF;
END;
$$;

COMMENT ON COLUMN public.suministros_condominio.fotos IS
  'Rutas de las fotos del insumo en el bucket condominios-media (<project_id>/suministros/...). Máximo 6.';
COMMENT ON COLUMN public.suministros_condominio.foto_url IS
  'LEGADO (20261119000000): una sola foto. Desde 20261216000300 las fotos van en `fotos`; al guardar, la app pasa esta a `fotos` y la deja en NULL.';
