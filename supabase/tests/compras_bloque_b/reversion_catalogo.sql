-- Huella del catálogo de `public` que importa a la reversión: disparadores, funciones (hash de su definición), índices,
-- restricciones, políticas y columnas. Una línea por objeto, ordenada; se compara con `diff`. Solo lectura.
-- Excluye dos objetos a propósito: la restricción orden_compra_eventos_tipo_check (20261027000500 la AMPLÍA y la reversión
-- NO la estrecha, porque las filas ya escritas con los tipos nuevos la violarían) y los objetos de otros esquemas.
SELECT 'trg|' || c.relname || '.' || t.tgname || '|' || md5(pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname = 'public'
UNION ALL
SELECT 'fn|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
UNION ALL
SELECT 'idx|' || i.tablename || '.' || i.indexname || '|' || md5(i.indexdef) FROM pg_indexes i WHERE i.schemaname = 'public'
UNION ALL
SELECT 'con|' || c.conrelid::regclass::text || '.' || c.conname || '|' || md5(pg_get_constraintdef(c.oid))
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE n.nspname = 'public' AND c.contype IN ('c', 'u', 'f', 'p') AND c.conname <> 'orden_compra_eventos_tipo_check'
UNION ALL
SELECT 'pol|' || p.polrelid::regclass::text || '.' || p.polname || '|' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '/' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
  FROM pg_policy p
UNION ALL
SELECT 'col|' || table_name || '.' || column_name || '|' || data_type FROM information_schema.columns WHERE table_schema = 'public'
ORDER BY 1;
