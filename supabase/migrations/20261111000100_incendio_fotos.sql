-- ════════════════════════════════════════════════════════════════════════════
-- Contra incendio: la inspección lleva fotos
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- Una inspección de extintor o gabinete se documenta con fotos: la etiqueta de
-- la última recarga, el manómetro, el sello, el daño encontrado. Hasta ahora
-- solo cabía texto en `observaciones`.
--
-- LO QUE HACE
--   `control_sistema_incendio.fotos text[]` — rutas en el bucket privado
--   `condominios-media` (`<project_id>/incendio/<archivo>.jpg`), el mismo
--   formato que `novedades_seguridad.fotos` y `paquetes_recibidos.fotos`: se
--   guarda la ruta, no una URL firmada, y SecureImage la firma al mostrarla.
--   NOT NULL DEFAULT '{}' para que la UI no distinga «sin fotos» de NULL, y un
--   CHECK de máximo 10 (lo mismo que ofrece el uploader) para que ningún otro
--   camino de escritura llene la fila sin límite.
--
-- LO QUE **NO** HACE: no toca las policies de la tabla ni las del bucket
-- (20260603220000 ya acota `condominios-media` por proyecto en la primera
-- carpeta de la ruta).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS y el CHECK se crea solo si no existe.
--
-- REVERSA: ALTER TABLE public.control_sistema_incendio DROP COLUMN fotos;
-- (arrastra el CHECK). Los archivos del bucket no se borran solos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.control_sistema_incendio
  ADD COLUMN IF NOT EXISTS fotos text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'control_sistema_incendio_fotos_max') THEN
    ALTER TABLE public.control_sistema_incendio
      ADD CONSTRAINT control_sistema_incendio_fotos_max CHECK (cardinality(fotos) <= 10);
  END IF;
END;
$$;

COMMENT ON COLUMN public.control_sistema_incendio.fotos IS
  'Rutas de las fotos de la inspección en el bucket condominios-media (<project_id>/incendio/...). Máximo 10.';
