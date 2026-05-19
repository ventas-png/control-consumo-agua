-- perf(indexes): drop redundant duplicate indexes
--
-- Postgres maintains separate b-tree structures for each index even when
-- their column lists and predicates are identical, which doubles write cost
-- and inflates the buffer cache without ever speeding up reads. The advisor
-- check (see supabase/scripts/duplicate-indexes-audit, or `pg_index`
-- joined on equal `indkey`+`indpred`) flagged these three pairs as fully
-- redundant. Each `DROP` keeps the UNIQUE or more-descriptively-named
-- variant.

-- company_clientes: the UNIQUE constraint
-- `company_clientes_company_id_cliente_id_key` already backs (company_id,
-- cliente_id) lookups. `idx_company_clientes_lookup` is a non-unique
-- duplicate added in an earlier migration.
DROP INDEX IF EXISTS public.idx_company_clientes_lookup;

-- config_condominio: the UNIQUE constraint
-- `config_condominio_project_id_key` already backs project_id lookups.
-- `idx_config_cond_project` duplicates it without adding the uniqueness
-- guarantee.
DROP INDEX IF EXISTS public.idx_config_cond_project;

-- reservas_str: two identical non-unique indexes on (unidad_id). We keep
-- the longer name with the table prefix (`idx_reservas_str_unidad_id`)
-- to match the project's naming convention; the short alias goes.
DROP INDEX IF EXISTS public.idx_str_unidad;

-- Intentionally NOT dropped:
--   idx_solicitud_renta_unidad vs idx_solicitud_renta_unidad_activa
-- The `_activa` variant is a UNIQUE PARTIAL index with predicate
--   WHERE estado IN ('pendiente', 'aprobada')
-- so it enforces a business rule (one active request per unit) on a
-- subset of rows. The full non-unique index covers history queries that
-- ignore status. Same columns, but different planner roles.
