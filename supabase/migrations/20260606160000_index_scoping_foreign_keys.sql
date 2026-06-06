-- Performance/robustez · índices en las FKs de scoping multi-tenant.
--
-- El performance advisor reportó 250 FKs sin índice de cobertura. Indexar TODAS
-- agregaría ruido (el mismo advisor reporta ~298 índices ya sin uso → write
-- amplification sin beneficio a este volumen). En cambio indexamos solo las FKs
-- de SCOPING (company_id / project_id / unidad_id / cliente_id), que son las de
-- mayor valor real:
--   • toda policy RLS filtra por company_id/project_id → evita seq scans,
--   • aceleran los DELETE en cascada (borrar company/project/unidad escanea hijos),
--   • son las columnas que los loaders filtran siempre.
--
-- Idempotente y auto-sanador: un DO recorre las FKs de scoping de una sola columna
-- que aún no tengan un índice con esa columna a la cabeza, y crea el índice. Volver
-- a correrlo no hace nada (CREATE INDEX IF NOT EXISTS + el filtro NOT EXISTS).
-- Validado contra prod en transacción con ROLLBACK (≈175 índices nuevos).

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and array_length(c.conkey, 1) = 1
      and c.connamespace = 'public'::regnamespace
      and a.attname in ('company_id', 'project_id', 'unidad_id', 'cliente_id')
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
      )
  loop
    execute format(
      'create index if not exists %I on public.%I (%I)',
      left('idx_' || r.tbl || '_' || r.col, 63), r.tbl, r.col
    );
  end loop;
end $$;
