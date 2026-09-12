-- ════════════════════════════════════════════════════════════════════════════
-- Revalidación de 20260912020100 · CORRER INMEDIATAMENTE ANTES DE FUSIONAR
-- ════════════════════════════════════════════════════════════════════════════
--
-- SÓLO LECTURA. Ni un INSERT, ni un UPDATE, ni un DDL. Se pega en el SQL Editor
-- de producción (nnsqmeigtgewatameexo) y devuelve UNA fila con un veredicto.
--
-- POR QUÉ HAY QUE REPETIRLA. La evidencia que justifica retirar estas tres
-- funciones se tomó el 2026-09-10. Entre esa fecha y el merge —y entre el merge
-- y el despliegue— alguien puede cablear una de ellas a una policy nueva. Si
-- eso pasa:
--
--   · con una dependencia de catálogo, el DROP falla con un error poco legible;
--   · con un enganche POR NOMBRE dentro de un cuerpo, `pg_depend` NO lo ve, el
--     DROP no falla, y la función que la llamaba se rompe en tiempo de
--     ejecución. Ése es el caso silencioso, y es el que esto busca.
--
-- La migración lleva su propia guarda con las mismas dos consultas y ABORTA si
-- encuentra algo. Esto es la misma medición hecha ANTES, para no descubrirlo con
-- el despliegue a medias.
--
-- CÓMO SE LEE. `veredicto` dice `SEGUIR` o `PARAR`. Si dice PARAR, `detalle`
-- nombra qué apareció. No fusionar hasta entenderlo.
--
-- LO QUE ESTO **NO** MIDE. Las llamadas por RPC. `track_functions` está en
-- `none` en este proyecto, así que el catálogo no lleva contador de ejecuciones
-- y no hay forma de saber por SQL si alguien las llamó. Eso se mira aparte, en
-- los registros del gateway (`/rest/v1/rpc/`), y la última lectura —24 h al
-- 2026-09-10, 28 endpoints distintos— no encontró ninguna de las tres.
-- ════════════════════════════════════════════════════════════════════════════

WITH objetivo AS (
  SELECT p.oid, p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
),
-- (a) Dependencias reales de catálogo: policies, defaults, vistas materializadas…
dependencias AS (
  SELECT DISTINCT 'dependencia de catálogo: ' || COALESCE(cl.relname, d.classid::regclass::text) AS hallazgo
  FROM pg_depend d
  JOIN objetivo o ON o.oid = d.refobjid AND d.refclassid = 'pg_proc'::regclass
  LEFT JOIN pg_class cl ON cl.oid = d.objid
  WHERE d.deptype <> 'i'
),
-- (b) Enganches POR NOMBRE, que pg_depend no ve.
por_nombre AS (
  SELECT 'cuerpo de función: ' || p.proname AS hallazgo
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
    AND p.proname NOT IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
    AND p.prosrc ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
  UNION ALL
  SELECT 'policy: ' || schemaname || '.' || tablename || '.' || policyname
  FROM pg_policies
  WHERE COALESCE(qual,'') || COALESCE(with_check,'')
        ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
  UNION ALL
  SELECT 'vista: ' || table_schema || '.' || table_name
  FROM information_schema.views
  WHERE table_schema NOT IN ('pg_catalog','information_schema')
    AND view_definition ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
  UNION ALL
  SELECT 'default de columna: ' || c.relname || '.' || a.attname
  FROM pg_attrdef d
  JOIN pg_class c ON c.oid = d.adrelid
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE pg_get_expr(d.adbin, d.adrelid)
        ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
),
todo AS (SELECT hallazgo FROM dependencias UNION ALL SELECT hallazgo FROM por_nombre)
SELECT
  CASE WHEN (SELECT count(*) FROM todo) = 0 THEN 'SEGUIR' ELSE 'PARAR' END      AS veredicto,
  (SELECT count(*) FROM objetivo)                                               AS funciones_presentes,
  (SELECT count(*) FROM todo)                                                   AS consumidores,
  COALESCE((SELECT string_agg(hallazgo, ' · ' ORDER BY hallazgo) FROM todo),
           'ninguna policy, vista, trigger, default ni cuerpo de función las nombra') AS detalle,
  -- Para contrastar: los mismos números en helpers que SÍ se usan. Si estos
  -- salen en cero también, la consulta está rota y no es que nadie las use.
  (SELECT count(*) FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE d.refclassid = 'pg_proc'::regclass AND n.nspname = 'public'
      AND p.proname = 'get_my_company_id' AND d.deptype <> 'i')                 AS control_get_my_company_id,
  (SELECT count(*) FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE d.refclassid = 'pg_proc'::regclass AND n.nspname = 'public'
      AND p.proname = 'is_super_admin' AND d.deptype <> 'i')                    AS control_is_super_admin,
  now()                                                                         AS medido_en;
