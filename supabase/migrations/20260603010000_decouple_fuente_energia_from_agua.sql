-- serv:S2 — Desacoplar fuentes_energia.fuente_agua_id del módulo Agua.
--
-- POR QUÉ: Energía se modeló como sub-módulo de Agua: cada fuente de energía
-- DEBÍA pertenecer a una fuente de agua (columna NOT NULL) y se borraba en
-- cascada con ella (ON DELETE CASCADE). Eso impide tratar Energía como un
-- servicio de 1er nivel (serv:S1): un tablero solar de áreas comunes o una
-- acometida administrativa no necesariamente alimenta un pozo de agua, y
-- borrar la fuente de agua no debería arrastrar el histórico energético.
--
-- QUÉ: el vínculo agua↔energía pasa a ser OPCIONAL e informativo.
--   1. fuente_agua_id deja de ser NOT NULL (puede quedar en NULL si la fuente
--      de energía es un servicio independiente).
--   2. La FK pasa de ON DELETE CASCADE a ON DELETE SET NULL: al borrar la
--      fuente de agua, la fuente de energía sobrevive y solo se desvincula.
--
-- IMPACTO (datos productivos): cambio NO destructivo. Las filas existentes
-- conservan su fuente_agua_id; solo se relaja el constraint y la regla de
-- borrado. El índice idx_fuentes_energia_fuente_agua_id sigue válido (B-tree
-- indexa NULLs sin problema) y las policies RLS no dependen de esta columna
-- (keyean por company_id/project_id), así que la seguridad no cambia.
--
-- REVERTIR (requiere que no existan filas con fuente_agua_id NULL):
--   ALTER TABLE public.fuentes_energia
--     DROP CONSTRAINT IF EXISTS fuentes_energia_fuente_agua_id_fkey;
--   ALTER TABLE public.fuentes_energia
--     ADD CONSTRAINT fuentes_energia_fuente_agua_id_fkey
--       FOREIGN KEY (fuente_agua_id) REFERENCES public.fuentes_agua(id)
--       ON DELETE CASCADE;
--   ALTER TABLE public.fuentes_energia
--     ALTER COLUMN fuente_agua_id SET NOT NULL;

-- 1. Relajar NOT NULL. Idempotente: DROP NOT NULL no falla si ya es nullable.
ALTER TABLE public.fuentes_energia
  ALTER COLUMN fuente_agua_id DROP NOT NULL;

-- 2. Recrear la FK con ON DELETE SET NULL. El nombre por defecto que Postgres
--    asignó a la FK inline es "<tabla>_<columna>_fkey"
--    (verificado en producción: fuentes_energia_fuente_agua_id_fkey).
ALTER TABLE public.fuentes_energia
  DROP CONSTRAINT IF EXISTS fuentes_energia_fuente_agua_id_fkey;

ALTER TABLE public.fuentes_energia
  ADD CONSTRAINT fuentes_energia_fuente_agua_id_fkey
    FOREIGN KEY (fuente_agua_id)
    REFERENCES public.fuentes_agua(id)
    ON DELETE SET NULL;
