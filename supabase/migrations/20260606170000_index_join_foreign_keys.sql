-- T7/PR3 — perf pass quirúrgico (#2): índices en las FKs de "join/cascada".
--
-- #470 ya indexó las FKs de scoping multi-tenant (company_id / project_id /
-- unidad_id / cliente_id). Esta migración cubre el resto de las FKs de UNA sola
-- columna que respaldan joins y borrados en cascada hacia entidades de dominio
-- (p.ej. recibos_digitales.cuota_id → cuotas_condominio, pagos.registro_id →
-- registros). Sin un índice líder, esos joins y los ON DELETE hacen seq-scan.
--
-- Criterio quirúrgico (no indexamos "todo"):
--   • Solo FKs de 1 columna en el esquema public.
--   • Excluye las columnas de scoping (ya cubiertas por #470).
--   • EXCLUYE columnas de actor/auditoría: las FKs que apuntan a auth.users
--     (~38) y a app_users (~9) son asignado_a / created_by / verified_by /
--     deleted_by / etc. — casi nunca se "joinan" para lectura y su cardinalidad
--     no justifica el costo de escritura del índice. Se omiten a propósito.
--   • Solo crea el índice si NO existe ya uno cuyo PRIMER campo sea la columna
--     (un índice compuesto que empiece por la FK ya sirve para el join).
--
-- Idempotente: `create index if not exists` + el guard `not exists (...)`.
-- Validado contra prod en una transacción con ROLLBACK: crea exactamente 28
-- índices y vuelve a 0 en una segunda corrida.
do $$
declare
  r        record;
  idx_name text;
begin
  for r in
    with fk as (
      select
        t.oid      as tbl_oid,
        t.relname  as tbl,
        a.attname  as col,
        cf.relname as ref_tbl,
        nf.nspname as ref_schema
      from pg_constraint c
      join pg_class t       on t.oid = c.conrelid
      join pg_namespace n   on n.oid = t.relnamespace
      join pg_class cf      on cf.oid = c.confrelid
      join pg_namespace nf  on nf.oid = cf.relnamespace
      join lateral unnest(c.conkey) as k(attnum) on true
      join pg_attribute a   on a.attrelid = t.oid and a.attnum = k.attnum
      where c.contype = 'f'
        and n.nspname = 'public'
        and array_length(c.conkey, 1) = 1
    )
    select fk.tbl_oid, fk.tbl, fk.col
    from fk
    where fk.col not in ('company_id', 'project_id', 'unidad_id', 'cliente_id')
      and not (fk.ref_schema = 'auth'   and fk.ref_tbl = 'users')
      and not (fk.ref_schema = 'public' and fk.ref_tbl = 'app_users')
      and not exists (
        select 1
        from pg_index i
        -- Se usa el OID que ya trae el CTE en vez de reconstruir el nombre y
        -- castearlo a regclass. Ese cast era un bug latente: Postgres inlinea
        -- los CTE no recursivos y NO garantiza el orden de evaluación entre el
        -- filtro `n.nspname = 'public'` y este subquery, así que el plan podía
        -- evaluar ('public.' || tbl)::regclass sobre filas de OTROS esquemas.
        -- `auth.identities` (única FK de 1 columna llamada así en el catálogo)
        -- producía 'public.identities'::regclass → 42P01 y la migración moría.
        -- Con el OID no hay nombre que construir ni cast que pueda fallar.
        where i.indrelid = fk.tbl_oid
          and i.indkey[0] = (
            select a2.attnum
            from pg_attribute a2
            where a2.attrelid = fk.tbl_oid
              and a2.attname = fk.col
          )
      )
  loop
    -- nombres de identificador de Postgres están limitados a 63 bytes
    idx_name := left('idx_' || r.tbl || '_' || r.col, 63);
    execute format(
      'create index if not exists %I on public.%I (%I)',
      idx_name, r.tbl, r.col
    );
  end loop;
end $$;
