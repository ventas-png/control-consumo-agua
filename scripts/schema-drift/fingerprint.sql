-- ════════════════════════════════════════════════════════════════════════════
-- Huella canónica del esquema `public` — SHA-256 por grupo
-- ════════════════════════════════════════════════════════════════════════════
--
-- La MISMA consulta corre contra el esquema reconstruido desde
-- supabase/migrations y contra producción (por SELECT, solo lectura). Si las dos
-- huellas coinciden, el repositorio describe producción. Donde difieren, hay
-- drift.
--
-- QUÉ SE MIRA. Nueve dimensiones, agrupadas por objeto para que el diff diga
-- *qué* objeto y *qué* aspecto cambió: tabla (estado de RLS), columnas,
-- constraints, índices, policies, grants, triggers, funciones (+ sus grants),
-- vistas, vistas materializadas y enums.
--
-- QUÉ **NO** SE MIRA, A PROPÓSITO:
--   · Ninguna FILA de negocio. Todo sale de pg_catalog e information_schema.
--   · Nada fuera de `public`: ni `auth`, ni `storage`, ni `vault`. El andamiaje
--     de bootstrap.sql no se compara, y los secretos del vault no se tocan.
--   · Nada reversible. Lo único que sale de aquí es un SHA-256 y un conteo.
--
-- ── LA SERIALIZACIÓN CANÓNICA ──────────────────────────────────────────────
--
-- Antes de hashear, cada grupo se serializa con reglas fijas. Sin ellas, dos
-- bases con el MISMO esquema pueden producir huellas distintas, que es el peor
-- fallo posible en un auditor: drift falso que enseña a ignorar la alarma.
--
--   1. ORDEN — todo `ORDER BY` va `COLLATE "C"`, es decir, orden de bytes.
--      Sin esto el orden depende de la collation de la base: la reconstrucción
--      corre con `--locale=C` y producción con la suya, así que dos catálogos
--      idénticos podrían serializar sus columnas en distinto orden y hashear
--      distinto. Es un fallo latente que no se ve hasta que un nombre con
--      acento o guion bajo cae en el sitio equivocado.
--
--   2. SEPARADORES QUE NO PUEDEN APARECER EN EL CONTENIDO —
--      registro \x1e, campo \x1f. El cuerpo de una policy contiene saltos de
--      línea (`pg_get_expr` los mete), así que separar registros con `\n` era
--      ambiguo: una policy multilínea podía serializarse igual que dos policies
--      distintas. Los caracteres de control C0 no aparecen en DDL.
--
--   3. NULL EXPLÍCITO — \x1d, distinto de la cadena vacía. `default=NULL` y
--      `default=''` son cosas distintas y tienen que hashear distinto.
--
--   4. HASH COMPLETO — `sha256`, 64 hex en minúsculas, sin truncar. Un md5
--      truncado a 12 hex son 48 bits: con ~2 400 grupos el riesgo de colisión
--      es pequeño pero real, y una colisión aquí significa exactamente «drift
--      que el auditor no ve». El costo de los 64 caracteres es un archivo más
--      grande; el beneficio es que la ausencia de drift signifique algo.
--
--   5. `sha256()` ES DE pg_catalog (Postgres >= 11), no de pgcrypto. Así la
--      huella no depende de que una extensión esté instalada ni de en qué
--      esquema viva.
--
--   6. NINGUNA NORMALIZACIÓN DE ESPACIOS. Ni `regexp_replace('\s+',' ')` ni
--      `btrim`, en ninguna dimensión. Todo el DDL se hashea EN CRUDO.
--
--      Una versión anterior sí colapsaba espacios en los cuerpos de función y
--      en las vistas, para evitar 11 grupos de drift meramente cosmético
--      (producción reformateó a mano varias funciones durante marzo-junio
--      2026). Estaba mal, y de la peor manera: un colapso GLOBAL no distingue
--      la sangría del contenido, así que borraba diferencias reales dentro de
--      · literales SQL: `SELECT 'a  b'` y `SELECT 'a b'` hasheaban IGUAL;
--      · cuerpos PL/pgSQL y dollar-quoted, donde un salto de línea dentro de
--        una cadena es dato, no formato;
--      · definiciones de vista con literales;
--      · identificadores entre comillas.
--
--      Eso es un FALSO NEGATIVO: drift real que el auditor no ve. Vale
--      infinitamente más conservar una diferencia cosmética declarada en
--      drift-conocido.json —donde alguien la lee y decide— que perder una
--      diferencia semántica en silencio. Una normalización correcta tendría
--      que ser consciente de la sintaxis (dollar-quoting anidado, cadenas E'',
--      comentarios, comillas dobles); escribir eso en SQL es un parser, y un
--      parser con bugs reintroduce exactamente el fallo que se quiere evitar.
--
--      Las demás dimensiones —defaults (`pg_get_expr`), constraints, índices,
--      policies (`qual`/`with_check`) y triggers— nunca se normalizaron.
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
-- SALIDA. Una sola fila, un solo texto: líneas `clave<TAB>sha256<TAB>n`.
-- Una sola fila mantiene manejable la respuesta de la Management API en modo
-- live, y el orquestador la parte por líneas.

WITH t AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
),
g AS (  -- tabla · estado de RLS
  SELECT 'tabla:'||relname||'/rls' AS clave,
         'rls='||relrowsecurity||E'\x1f'||'force='||relforcerowsecurity AS linea, 1 AS n
  FROM t
),
gc AS ( -- tabla · columnas
  SELECT 'tabla:'||t.relname||'/columnas' AS clave,
         string_agg(
           a.attname                                                            ||E'\x1f'||
           format_type(a.atttypid,a.atttypmod)                                  ||E'\x1f'||
           'notnull='||a.attnotnull                                             ||E'\x1f'||
           'default='||coalesce(pg_get_expr(d.adbin,d.adrelid), E'\x1d')           ||E'\x1f'||
           'identity='||coalesce(nullif(a.attidentity::text,''), E'\x1d')          ||E'\x1f'||
           'generated='||coalesce(nullif(a.attgenerated::text,''), E'\x1d'),
           E'\x1e' ORDER BY a.attname COLLATE "C") AS linea,
         count(*) AS n
  FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
  GROUP BY 1
),
gk AS ( -- tabla · constraints
  SELECT 'tabla:'||t.relname||'/constraints' AS clave,
         coalesce(string_agg(x.conname||E'\x1f'||pg_get_constraintdef(x.oid),
                             E'\x1e' ORDER BY x.conname COLLATE "C"),'') AS linea,
         count(x.*) AS n
  FROM t LEFT JOIN pg_constraint x ON x.conrelid = t.oid
  GROUP BY 1
),
gi AS ( -- tabla · índices
  SELECT 'tabla:'||t.relname||'/indices' AS clave,
         coalesce(string_agg(i.indexname||E'\x1f'||i.indexdef,
                             E'\x1e' ORDER BY i.indexname COLLATE "C"),'') AS linea,
         count(i.*) AS n
  FROM t LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.tablename = t.relname
  GROUP BY 1
),
gp AS ( -- tabla · policies
  SELECT 'tabla:'||t.relname||'/policies' AS clave,
         coalesce(string_agg(
           p.policyname                                     ||E'\x1f'||
           p.cmd                                            ||E'\x1f'||
           'roles='||array_to_string(p.roles,',')           ||E'\x1f'||
           p.permissive                                     ||E'\x1f'||
           'using='||coalesce(p.qual, E'\x1d')                 ||E'\x1f'||
           'check='||coalesce(p.with_check, E'\x1d'),
           E'\x1e' ORDER BY p.policyname COLLATE "C"),'') AS linea,
         count(p.*) AS n
  FROM t LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = t.relname
  GROUP BY 1
),
gg AS ( -- tabla · grants
  SELECT 'tabla:'||t.relname||'/grants' AS clave,
         coalesce(string_agg(rg.grantee||E'\x1f'||rg.privilege_type,
                             E'\x1e' ORDER BY rg.grantee COLLATE "C", rg.privilege_type COLLATE "C"),'') AS linea,
         count(rg.*) AS n
  FROM t LEFT JOIN information_schema.role_table_grants rg
    ON rg.table_schema = 'public' AND rg.table_name = t.relname
  GROUP BY 1
),
gt AS ( -- tabla · triggers
  SELECT 'tabla:'||t.relname||'/triggers' AS clave,
         coalesce(string_agg(tg.tgname||E'\x1f'||pg_get_triggerdef(tg.oid)||E'\x1f'||'enabled='||tg.tgenabled::text,
                             E'\x1e' ORDER BY tg.tgname COLLATE "C"),'') AS linea,
         count(tg.*) AS n
  FROM t LEFT JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
  GROUP BY 1
),
gf AS ( -- funciones
  SELECT 'funcion:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS clave,
         'returns='||pg_get_function_result(p.oid)                          ||E'\x1f'||
         'lang='||l.lanname                                                 ||E'\x1f'||
         'secdef='||p.prosecdef                                             ||E'\x1f'||
         'volatility='||p.provolatile::text                                 ||E'\x1f'||
         'leakproof='||p.proleakproof                                       ||E'\x1f'||
         'config='||coalesce(array_to_string(p.proconfig,','), E'\x1d')         ||E'\x1f'||
         'cuerpo='||encode(sha256(convert_to(coalesce(p.prosrc,''),'UTF8')),'hex') AS linea,
         1 AS n
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
),
gfg AS ( -- funciones · grants de EXECUTE
  SELECT 'funcion:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/grants' AS clave,
         coalesce((SELECT string_agg(grantee||E'\x1f'||privilege_type,
                                     E'\x1e' ORDER BY grantee COLLATE "C", privilege_type COLLATE "C")
                   FROM information_schema.role_routine_grants rr
                   WHERE rr.specific_schema = 'public'
                     AND rr.specific_name = p.proname||'_'||p.oid),'') AS linea,
         1 AS n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
gv AS ( -- vistas
  SELECT 'vista:'||viewname AS clave, definition AS linea, 1 AS n
  FROM pg_views WHERE schemaname = 'public'
),
gm AS ( -- vistas materializadas
  SELECT 'matview:'||matviewname AS clave, definition AS linea, 1 AS n
  FROM pg_matviews WHERE schemaname = 'public'
),
ge AS ( -- enums
  SELECT 'enum:'||ty.typname AS clave,
         string_agg(e.enumlabel, E'\x1e' ORDER BY e.enumsortorder) AS linea,
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
SELECT string_agg(clave||E'\t'||encode(sha256(convert_to(linea,'UTF8')),'hex')||E'\t'||n,
                  E'\n' ORDER BY clave COLLATE "C") AS huella
FROM todo;
