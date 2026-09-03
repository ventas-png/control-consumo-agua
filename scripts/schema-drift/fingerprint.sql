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
--   2. SEPARADORES DE REGISTRO Y CAMPO — registro \x1e, campo \x1f. El cuerpo
--      de una policy contiene saltos de línea (`pg_get_expr` los mete), así que
--      separar registros con `\n` era ambiguo: una policy multilínea podía
--      serializarse igual que dos policies distintas.
--
--      NO ES CIERTO QUE LOS CONTROLES C0 «NO APAREZCAN EN DDL», y este comentario
--      lo afirmaba. Un identificador entre comillas admite cualquier carácter
--      menos NUL —`CREATE TABLE "a<0x1e>b"` es SQL válido—, y un literal dentro
--      de una expresión de policy o de un default puede llevarlos con `E'\x1e'`.
--      Con eso, dos catálogos DISTINTOS pueden serializar igual: es una colisión
--      construible, no un accidente, y sería drift invisible.
--
--      Cambiar el separador rompería `huella-produccion.json`. Así que en vez de
--      eso hay un GUARD FAIL-CLOSED al principio del archivo: si algún campo
--      trae \x1d, \x1e o \x1f, o si un componente de clave trae TAB o salto de
--      línea —que son los separadores de la SALIDA—, la huella no se emite: se
--      aborta con un error que nombra el objeto. Preferir no medir a medir mal.
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
--   7. LOS GRANTS SE LEEN DEL ACL (`relacl`/`proacl`), NO de
--      `information_schema.role_table_grants` ni de `role_routine_grants`.
--
--      Esos dos catálogos son RELATIVOS AL ROL: sólo proyectan concesiones en
--      las que el usuario actual es otorgante, otorgado, o miembro de alguno de
--      los dos. Un rol DEDICADO DE SOLO LECTURA —el que el modo live necesita—
--      no es miembro de `anon`, `authenticated` ni `service_role`, así que
--      vería CERO grants y hashearía la cadena vacía en las ~563 dimensiones
--      `/grants`. Medido sobre un clúster desechable con el patrón de Supabase:
--
--        rol                                        filas visibles
--        postgres (dueño)                                       28
--        rol de solo lectura, USAGE sobre public                  0
--        rol de solo lectura + membresía, INHERIT                28  ← y además
--                                                                     lee datos
--        rol de solo lectura + membresía, NOINHERIT                0
--
--      No existe configuración que sea a la vez de solo lectura y capaz de ver
--      los grants por esa vía: las únicas que los ven pueden leer el camino de
--      dinero. `relacl` y `proacl` son columnas de `pg_class`/`pg_proc`, no son
--      relativas al rol, y las lee cualquiera que pueda leer el catálogo.
--
--   8. `WITH GRANT OPTION` SE MARCA, Y SÓLO CUANDO EXISTE.
--
--      Un `GRANT SELECT … WITH GRANT OPTION` deja al otorgado repartir ese
--      privilegio a quien quiera. Es un cambio del modelo de amenaza sin tocar
--      ninguna policy ni agregar ninguna concesión visible en el conteo, así
--      que tiene que mover la huella.
--
--      La marca es un tercer campo `*` DETRÁS del privilegio, y se agrega
--      ÚNICAMENTE si `is_grantable`. Medido sobre la reconstrucción: hoy no hay
--      un solo aclitem con grant option —ni en tablas ni en funciones—, así que
--      la serialización de todo lo existente queda idéntica y
--      `huella-produccion.json` sigue siendo comparable sin regenerarla. Si en
--      cambio se hubiera puesto un campo fijo `grantable=false`, las 563
--      dimensiones `/grants` se habrían movido de golpe.
--
--      El ORDEN no depende de la marca: se sigue ordenando por otorgado y
--      privilegio, así que un grant option no reordena nada.
--
--      LA SERIALIZACIÓN NO CAMBIA. `information_schema.table_privileges` está
--      definido sobre `aclexplode(coalesce(relacl, acldefault(...)))`: se lee la
--      misma fuente, un paso antes del filtro por rol. La equivalencia byte a
--      byte se comprueba en `--prueba-acl` contra el catálogo real, para que
--      `huella-produccion.json` —capturada con la formulación anterior— siga
--      siendo válida sin regenerarla.
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

-- ════════════════════════════════════════════════════════════════════════════
-- GUARD FAIL-CLOSED: ningún separador dentro del contenido
-- ════════════════════════════════════════════════════════════════════════════
--
-- La serialización usa \x1e entre registros, \x1f entre campos y \x1d para el
-- NULL explícito; la SALIDA usa TAB entre las tres columnas y \n entre líneas.
-- Nada de eso está reservado por Postgres: un identificador entre comillas
-- admite cualquier carácter menos NUL, y un literal dentro de un default o de
-- una expresión de policy también. Un objeto llamado `a<0x1e>b` hace que dos
-- catálogos distintos hasheen igual, y uno con un TAB en el nombre parte la
-- línea de salida en columnas que el parser lee mal.
--
-- Cambiar los separadores rompería `huella-produccion.json`, así que en vez de
-- eso: si aparece uno, NO SE EMITE HUELLA. Se aborta nombrando el objeto.
-- Preferir no medir a medir mal — una colisión aquí es drift invisible, que es
-- el único fallo que este auditor no se puede permitir.
--
-- `ON_ERROR_STOP` va acá dentro y no en el llamador: el guard tiene que ser
-- fail-closed para CUALQUIERA que corra este archivo, no sólo para quien se
-- acuerde de pasar la bandera.
\set ON_ERROR_STOP on

DO $centinela$
DECLARE
  culpables text;
BEGIN
  -- ── 1 · separadores de la serialización dentro de un campo ───────────────
  SELECT string_agg(DISTINCT donde, ', ' ORDER BY donde) INTO culpables
  FROM (
    SELECT 'tabla '||c.relname AS donde, c.relname AS valor
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'columna '||c.relname||'.'||a.attname, a.attname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'tipo de '||c.relname||'.'||a.attname, format_type(a.atttypid, a.atttypmod)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'default de '||c.relname||'.'||a.attname, pg_get_expr(d.adbin, d.adrelid)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'constraint '||x.conname, x.conname || pg_get_constraintdef(x.oid)
      FROM pg_constraint x JOIN pg_class c ON c.oid = x.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'índice '||i.indexname, i.indexname || i.indexdef
      FROM pg_indexes i WHERE i.schemaname = 'public'
    UNION ALL
    SELECT 'policy '||p.policyname||' en '||p.tablename,
           p.policyname || p.cmd || array_to_string(p.roles, ',') || p.permissive ||
           coalesce(p.qual,'') || coalesce(p.with_check,'')
      FROM pg_policies p WHERE p.schemaname = 'public'
    UNION ALL
    SELECT 'trigger '||tg.tgname, tg.tgname || pg_get_triggerdef(tg.oid)
      FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT tg.tgisinternal
    UNION ALL
    SELECT 'función '||p.proname,
           p.proname || pg_get_function_identity_arguments(p.oid) ||
           pg_get_function_result(p.oid) || l.lanname ||
           coalesce(array_to_string(p.proconfig, ','), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'vista '||v.viewname, v.viewname || v.definition
      FROM pg_views v WHERE v.schemaname = 'public'
    UNION ALL
    SELECT 'matview '||m.matviewname, m.matviewname || m.definition
      FROM pg_matviews m WHERE m.schemaname = 'public'
    UNION ALL
    SELECT 'enum '||ty.typname, ty.typname || e.enumlabel
      FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
      JOIN pg_enum e ON e.enumtypid = ty.oid
     WHERE n.nspname = 'public' AND ty.typtype = 'e'
    UNION ALL
    -- Los nombres de rol entran en las dos dimensiones de grants.
    SELECT 'rol '||r.rolname, r.rolname FROM pg_roles r
  ) s
  WHERE valor IS NOT NULL AND valor ~ E'[\\x1d\\x1e\\x1f]';

  IF culpables IS NOT NULL THEN
    RAISE EXCEPTION 'SEPARADOR DE LA HUELLA DENTRO DEL CONTENIDO: %', culpables
      USING HINT = 'La serialización usa \x1d, \x1e y \x1f como separadores. Un valor que '
                   'los contenga hace que dos catálogos distintos hasheen igual. No se emite '
                   'huella: renombrar el objeto o corregir la expresión.';
  END IF;

  -- ── 2 · TAB o salto de línea en un componente de clave ───────────────────
  --
  -- La salida es `clave<TAB>sha256<TAB>n`, una línea por grupo. Un TAB o un
  -- salto de línea en la clave parte la línea donde no debe y el parser lee
  -- otra cosa —con suerte falla, sin suerte mide mal—.
  SELECT string_agg(DISTINCT donde, ', ' ORDER BY donde) INTO culpables
  FROM (
    SELECT 'tabla '||c.relname AS donde, c.relname AS valor
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
    UNION ALL
    SELECT 'función '||p.proname, p.proname || pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'vista '||v.viewname, v.viewname FROM pg_views v WHERE v.schemaname = 'public'
    UNION ALL
    SELECT 'matview '||m.matviewname, m.matviewname FROM pg_matviews m WHERE m.schemaname = 'public'
    UNION ALL
    SELECT 'enum '||ty.typname, ty.typname
      FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
     WHERE n.nspname = 'public' AND ty.typtype = 'e'
  ) s
  WHERE valor IS NOT NULL AND valor ~ E'[\\t\\n\\r]';

  IF culpables IS NOT NULL THEN
    RAISE EXCEPTION 'TAB O SALTO DE LÍNEA EN UN COMPONENTE DE CLAVE: %', culpables
      USING HINT = 'La salida es `clave<TAB>sha256<TAB>n`, una línea por grupo. Un TAB o un '
                   'salto de línea en la clave rompe esa estructura. No se emite huella.';
  END IF;
END
$centinela$;

WITH t AS (
  SELECT c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
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
gg AS ( -- tabla · grants  (ver regla 7: se lee el ACL, no information_schema)
  SELECT 'tabla:'||t.relname||'/grants' AS clave,
         coalesce(string_agg(rg.grantee||E'\x1f'||rg.privilege_type,
                             E'\x1e' ORDER BY rg.grantee COLLATE "C", rg.privilege_type COLLATE "C"),'') AS linea,
         count(rg.*) AS n
  FROM t LEFT JOIN LATERAL (
    -- `acldefault` cubre el ACL nulo: una tabla sin GRANT explícito no tiene
    -- relacl, pero sí los privilegios implícitos de su dueño. Es la misma
    -- expresión que usa internamente information_schema.table_privileges.
    SELECT coalesce(r.rolname::text, 'PUBLIC') AS grantee,
           -- La marca `*` de WITH GRANT OPTION se AGREGA sólo cuando existe
           -- (ver regla 8): así la serialización de un ACL sin grant option no
           -- se mueve y `huella-produccion.json` sigue siendo comparable.
           a.privilege_type::text || CASE WHEN a.is_grantable THEN E'\x1f*' ELSE '' END
                                               AS privilege_type
    FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
    -- pg_roles, no pg_authid: pg_authid exige superusuario y este catálogo
    -- tiene que poder leerse con un rol de solo lectura.
    LEFT JOIN pg_roles r ON r.oid = a.grantee
    -- Los siete privilegios de tabla que enumera information_schema. Fijarlos
    -- explícitamente mantiene la huella estable entre versiones de Postgres:
    -- 17 agregó MAINTAIN, que aquel catálogo no proyecta y que aparecería como
    -- drift falso al comparar una reconstrucción en 16 contra producción en 17.
    WHERE a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE',
                               'TRUNCATE','REFERENCES','TRIGGER')
  ) rg ON true
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
gfg AS ( -- funciones · grants de EXECUTE  (ver regla 7)
  SELECT 'funcion:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')/grants' AS clave,
         coalesce((SELECT string_agg(coalesce(r.rolname::text,'PUBLIC')||E'\x1f'||a.privilege_type::text||
                                     CASE WHEN a.is_grantable THEN E'\x1f*' ELSE '' END,
                                     E'\x1e' ORDER BY coalesce(r.rolname::text,'PUBLIC') COLLATE "C",
                                                      a.privilege_type::text COLLATE "C")
                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   LEFT JOIN pg_roles r ON r.oid = a.grantee
                   WHERE a.privilege_type = 'EXECUTE'),'') AS linea,
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
