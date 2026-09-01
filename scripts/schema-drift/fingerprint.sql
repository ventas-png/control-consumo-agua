-- ════════════════════════════════════════════════════════════════════════════
-- Huella normalizada del esquema `public`
-- ════════════════════════════════════════════════════════════════════════════
--
-- La MISMA consulta corre contra el esquema reconstruido desde
-- supabase/migrations y contra producción (por SELECT, solo lectura). Si las dos
-- huellas coinciden, el repositorio describe producción. Donde difieren, hay
-- drift.
--
-- QUÉ SE MIRA. Nueve dimensiones, agrupadas por objeto para que el diff diga
-- *qué* tabla y *qué* aspecto cambió:
--   tabla, columnas, constraints, índices, policies, grants, triggers,
--   funciones (+ sus grants), vistas, vistas materializadas y enums.
--
-- QUÉ **NO** SE MIRA, A PROPÓSITO:
--   · Ninguna FILA. Ni un `count(*)`. Esta consulta jamás lee datos de negocio.
--   · Nada fuera de `public`: ni `auth`, ni `storage`, ni `vault`. El andamiaje
--     de bootstrap.sql no se compara, y los secretos del vault no se tocan.
--   · Nada que pueda contener una credencial. Lo único que se proyecta es DDL:
--     tipos, defaults, expresiones de policy, cuerpos de función. `__tests__`
--     tiene un guard que falla si aparece algo con forma de secreto.
--
-- POR QUÉ `prosrc` Y NO `pg_get_functiondef`. `pg_get_functiondef` reimprime la
-- definición y su formato cambia entre versiones mayores de Postgres. La
-- reconstrucción corre en el Postgres del runner y producción va por su cuenta,
-- así que compararlas produciría drift falso en cada upgrade. `prosrc` es el
-- texto tal cual se guardó: idéntico si lo creó el mismo DDL.
--
-- POR QUÉ LOS GRANTS SON UNA DIMENSIÓN DE PRIMERA. Una policy permisiva sólo es
-- peligrosa si el rol tiene además el privilegio. En Supabase `anon` y
-- `authenticated` lo tienen sobre casi todo por los privilegios por defecto, así
-- que la RLS es el único control — y un grant que se mueva cambia el modelo de
-- amenaza sin tocar una sola policy. Sin esta dimensión el auditor no lo vería.
--
-- SALIDA. Una sola fila, un solo texto: líneas `clave<TAB>huella<TAB>n`.
-- Una sola fila mantiene manejable la respuesta de la Management API en modo
-- live, y el orquestador la parte por líneas.

WITH t AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
),
g AS (  -- tabla · estado de RLS
  SELECT 'tabla:'||relname||'/rls' AS clave,
         'rls='||relrowsecurity||' force='||relforcerowsecurity AS linea, 1 AS n
  FROM t
),
gc AS ( -- tabla · columnas
  SELECT 'tabla:'||t.relname||'/columnas' AS clave,
         string_agg(a.attname||' :: '||format_type(a.atttypid,a.atttypmod)
                    ||' notnull='||a.attnotnull
                    ||' default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'-')
                    ||' identity='||coalesce(nullif(a.attidentity::text,''),'-')
                    ||' generated='||coalesce(nullif(a.attgenerated::text,''),'-'),
                    E'\n' ORDER BY a.attname) AS linea,
         count(*) AS n
  FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
  GROUP BY 1
),
gk AS ( -- tabla · constraints
  SELECT 'tabla:'||t.relname||'/constraints' AS clave,
         coalesce(string_agg(x.conname||' :: '||pg_get_constraintdef(x.oid), E'\n' ORDER BY x.conname),'') AS linea,
         count(x.*) AS n
  FROM t LEFT JOIN pg_constraint x ON x.conrelid = t.oid
  GROUP BY 1
),
gi AS ( -- tabla · índices
  SELECT 'tabla:'||t.relname||'/indices' AS clave,
         coalesce(string_agg(i.indexname||' :: '||i.indexdef, E'\n' ORDER BY i.indexname),'') AS linea,
         count(i.*) AS n
  FROM t LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.tablename = t.relname
  GROUP BY 1
),
gp AS ( -- tabla · policies
  SELECT 'tabla:'||t.relname||'/policies' AS clave,
         coalesce(string_agg(p.policyname||' :: '||p.cmd
                             ||' roles='||array_to_string(p.roles,'+')
                             ||' '||p.permissive
                             ||' using='||coalesce(p.qual,'-')
                             ||' check='||coalesce(p.with_check,'-'),
                             E'\n' ORDER BY p.policyname),'') AS linea,
         count(p.*) AS n
  FROM t LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = t.relname
  GROUP BY 1
),
gg AS ( -- tabla · grants
  SELECT 'tabla:'||t.relname||'/grants' AS clave,
         coalesce(string_agg(rg.grantee||':'||rg.privilege_type, ' ' ORDER BY rg.grantee, rg.privilege_type),'') AS linea,
         count(rg.*) AS n
  FROM t LEFT JOIN information_schema.role_table_grants rg
    ON rg.table_schema = 'public' AND rg.table_name = t.relname
  GROUP BY 1
),
gt AS ( -- tabla · triggers
  SELECT 'tabla:'||t.relname||'/triggers' AS clave,
         coalesce(string_agg(tg.tgname||' :: '||pg_get_triggerdef(tg.oid)||' enabled='||tg.tgenabled::text,
                             E'\n' ORDER BY tg.tgname),'') AS linea,
         count(tg.*) AS n
  FROM t LEFT JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
  GROUP BY 1
),
gf AS ( -- funciones
  SELECT 'funcion:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS clave,
         'returns='||pg_get_function_result(p.oid)
         ||' lang='||l.lanname
         ||' secdef='||p.prosecdef
         ||' volatility='||p.provolatile::text
         ||' leakproof='||p.proleakproof
         ||' config='||coalesce(array_to_string(p.proconfig,','),'-')
         ||' cuerpo='||md5(regexp_replace(coalesce(p.prosrc,''), '\s+', ' ', 'g')) AS linea,
         1 AS n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
),
gfg AS ( -- funciones · grants de EXECUTE
  SELECT 'funcion:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/grants' AS clave,
         coalesce((SELECT string_agg(grantee||':'||privilege_type, ' ' ORDER BY grantee)
                   FROM information_schema.role_routine_grants rr
                   WHERE rr.specific_schema = 'public'
                     AND rr.specific_name = p.proname||'_'||p.oid),'') AS linea,
         1 AS n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
gv AS ( -- vistas
  SELECT 'vista:'||viewname AS clave,
         regexp_replace(definition, '\s+', ' ', 'g') AS linea, 1 AS n
  FROM pg_views WHERE schemaname = 'public'
),
gm AS ( -- vistas materializadas
  SELECT 'matview:'||matviewname AS clave,
         regexp_replace(definition, '\s+', ' ', 'g') AS linea, 1 AS n
  FROM pg_matviews WHERE schemaname = 'public'
),
ge AS ( -- enums
  SELECT 'enum:'||ty.typname AS clave,
         string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS linea,
         count(*) AS n
  FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
  JOIN pg_enum e ON e.enumtypid = ty.oid
  WHERE n.nspname = 'public' AND ty.typtype = 'e'
  GROUP BY 1
),
todo AS (
  SELECT * FROM g   UNION ALL SELECT * FROM gc  UNION ALL SELECT * FROM gk
  UNION ALL SELECT * FROM gi  UNION ALL SELECT * FROM gp  UNION ALL SELECT * FROM gg
  UNION ALL SELECT * FROM gt  UNION ALL SELECT * FROM gf  UNION ALL SELECT * FROM gfg
  UNION ALL SELECT * FROM gv  UNION ALL SELECT * FROM gm  UNION ALL SELECT * FROM ge
)
SELECT string_agg(clave||E'\t'||substr(md5(linea),1,12)||E'\t'||n, E'\n' ORDER BY clave) AS huella
FROM todo;
