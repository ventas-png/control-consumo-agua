-- ════════════════════════════════════════════════════════════════════════════
-- Minutas de reunión: la minuta lleva documentos adjuntos
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- Además de fotos (20261112000000), una reunión deja papeles: la cotización que
-- se revisó, el contrato que se discutió, la lista de asistencia en PDF o la
-- hoja de cálculo con los números. La minuta no tenía dónde adjuntarlos.
--
-- LO QUE HACE
--   `notas_admin.documentos text[]` — rutas en el bucket privado
--   `condominios-media` (`<project_id>/minutas/<archivo>`), el mismo formato que
--   `fotos`: se guarda la ruta, no una URL firmada, y SecureFileLink la firma al
--   abrirla. El bucket ya acepta PDF, Word, Excel y PowerPoint hasta 10 MB
--   (20260729000400). NOT NULL DEFAULT '{}' y un CHECK de máximo 10, lo mismo
--   que ofrece el uploader, para que ningún otro camino de escritura llene la
--   fila sin límite.
--
-- LO QUE **NO** HACE: no toca las policies de la tabla ni las del bucket
-- (20260603220000 ya acota `condominios-media` por proyecto en la primera
-- carpeta de la ruta).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS y el CHECK se crea solo si no existe.
--
-- REVERSA: ALTER TABLE public.notas_admin DROP COLUMN documentos;
-- (arrastra el CHECK). Los archivos del bucket no se borran solos.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notas_admin
  ADD COLUMN IF NOT EXISTS documentos text[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notas_admin_documentos_max') THEN
    ALTER TABLE public.notas_admin
      ADD CONSTRAINT notas_admin_documentos_max CHECK (cardinality(documentos) <= 10);
  END IF;
END;
$$;

COMMENT ON COLUMN public.notas_admin.documentos IS
  'Rutas de los documentos adjuntos de la minuta en el bucket condominios-media (<project_id>/minutas/...). Máximo 10.';
