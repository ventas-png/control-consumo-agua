-- ════════════════════════════════════════════════════════════════════════════
-- Minutas de reunión: la minuta lleva fotos
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- Una reunión se documenta también con fotos: la hoja de asistencia firmada, el
-- pizarrón con los acuerdos, el daño que se revisó en sitio. La minuta
-- (notas_admin, 20261110000000) sólo guardaba texto y JSON.
--
-- LO QUE HACE
--   `notas_admin.fotos text[]` — rutas en el bucket privado `condominios-media`
--   (`<project_id>/minutas/<archivo>.jpg`), el mismo formato que
--   `control_sistema_incendio.fotos` (20261111000100): se guarda la ruta, no una
--   URL firmada, y SecureImage la firma al mostrarla. NOT NULL DEFAULT '{}' para
--   que la UI no distinga «sin fotos» de NULL, y un CHECK de máximo 10 (lo
--   mismo que ofrece el uploader) para que ningún otro camino de escritura llene
--   la fila sin límite.
--
-- LO QUE **NO** HACE: no toca las policies de la tabla ni las del bucket
-- (20260603220000 ya acota `condominios-media` por proyecto en la primera
-- carpeta de la ruta).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS y el CHECK se crea solo si no existe.
--
-- REVERSA: ALTER TABLE public.notas_admin DROP COLUMN fotos;
-- (arrastra el CHECK). Los archivos del bucket no se borran solos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notas_admin
  ADD COLUMN IF NOT EXISTS fotos text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notas_admin_fotos_max') THEN
    ALTER TABLE public.notas_admin
      ADD CONSTRAINT notas_admin_fotos_max CHECK (cardinality(fotos) <= 10);
  END IF;
END;
$$;

COMMENT ON COLUMN public.notas_admin.fotos IS
  'Rutas de las fotos de la minuta en el bucket condominios-media (<project_id>/minutas/...). Máximo 10.';
