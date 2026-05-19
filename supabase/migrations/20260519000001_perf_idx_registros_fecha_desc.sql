-- Index to support ORDER BY fecha DESC LIMIT N on registros
-- (used by useData.ts dashboard query). Without this, postgres does a
-- full seq scan + sort, which combined with RLS subquery evaluation
-- can exceed the 15s frontend fetch_timeout for company_owner users.
CREATE INDEX IF NOT EXISTS idx_registros_fecha_desc
  ON public.registros (fecha DESC);

-- Composite (project_id, fecha DESC) — RLS checks project_id per row;
-- an index here lets PG do an index-only scan within the company's projects.
CREATE INDEX IF NOT EXISTS idx_registros_project_fecha_desc
  ON public.registros (project_id, fecha DESC);

-- ANALYZE so the planner picks them up immediately.
ANALYZE public.registros;
