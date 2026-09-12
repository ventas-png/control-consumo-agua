-- ════════════════════════════════════════════════════════════════════════════
-- Retirar tres helpers de RBAC que sólo existen en producción y nadie usa
-- ════════════════════════════════════════════════════════════════════════════
--
--   public.has_role_any(text[])
--   public.has_super_or_owner_access(uuid)
--   public.is_user_in_company_with_role(uuid, text[])
--
-- QUÉ SON. Tres de los doce helpers marcados `Performance:` que se crearon a
-- mano en producción entre marzo y junio de 2026 para sacar `current_user_role()`
-- y `get_my_company_id()` de las policies fila a fila. Nueve de esos doce
-- volvieron al repositorio como migraciones; estos tres nunca lo hicieron.
--
-- POR QUÉ SE RETIRAN Y NO SE INCORPORAN. Porque no las usa nadie, y eso se midió
-- (2026-09-10, contra el catálogo de producción):
--
--   · dependencias de catálogo (pg_depend):  0
--     Sus hermanos del mismo lote que SÍ se usan tienen 47, 40, 35, 22, 7 y 4.
--     `get_my_company_id` tiene 1 091 y `is_super_admin` 1 055.
--   · policies, vistas, triggers, defaults y cuerpos de otras funciones que las
--     nombren: NINGUNO, ni en producción ni en el repositorio.
--   · llamadas por RPC en las últimas 24 h: NINGUNA. Se registraron 28 endpoints
--     distintos bajo /rest/v1/rpc/ y ninguno es de estas tres.
--   · código de la aplicación: no aparecen en `src/` ni en `supabase/functions/`.
--     El único archivo que las nombra es `src/types/database.types.ts`, que se
--     GENERA desde producción — es un reflejo suyo, no un consumidor.
--
-- Y el argumento que cierra el caso: como no existen en el repositorio, TODA
-- rama Preview, todo sandbox de CI y todo entorno provisionado desde estas
-- migraciones lleva funcionando sin ellas desde siempre. Si algo dependiera de
-- ellas, esos entornos estarían rotos. No lo están.
--
-- LO QUE NO SE HACE. No se copia la definición viva al repositorio. Incorporar
-- una función sin llamadores sólo mueve el problema: quedaría una superficie
-- SECURITY DEFINER ejecutable por `authenticated` que nadie ejerce, y que
-- habría que mantener y revisar en cada auditoría. El drift se cierra igual de
-- bien retirándolas, y con menos superficie.
--
-- LA GUARDA DE ABAJO NO ES ADORNO. La evidencia se tomó el 2026-09-10; esta
-- migración se aplicará después. Si entre una fecha y otra alguien las cablea a
-- una policy, el DROP fallaría con un error de dependencia poco legible o —peor,
-- si el enganche fuera por nombre dentro de un cuerpo— no fallaría y rompería
-- esa función en tiempo de ejecución. La guarda mira las dos cosas y ABORTA con
-- un mensaje que dice qué apareció.
--
-- REVERSA. Hay DDL EJECUTABLE, y está acá:
--
--     supabase/reversas/20260912020100_reponer_helpers_rbac_huerfanos.sql
--
-- Sale de `pg_get_functiondef()` sobre el catálogo vivo de producción, leído el
-- 2026-09-10, con los cuerpos copiados verbatim y con lo que una función
-- restaurada a medias pierde: dueño, SECURITY DEFINER, `search_path` fijado, la
-- ACL —EXECUTE revocado a PUBLIC— y el COMMENT.
--
-- UNA VERSIÓN ANTERIOR DE ESTA CABECERA DECÍA OTRA COSA, y estaba mal: afirmaba
-- que la definición «no se pierde» porque su huella está en `drift-conocido.json`
-- y el inventario en #826. Ninguna de las dos repone nada. Una huella es un
-- `sha256(prosrc)`: sirve para DETECTAR que algo cambió, no para reconstruirlo.
-- Y #826 nombra las tres firmas en su §3.5 pero no incluye una sola línea de su
-- DDL. Era exactamente el mismo tipo de afirmación sin respaldo que esta
-- migración vino a corregir en los `motivo` de la baseline.
--
-- Que la reversa repone lo que había no se afirma: se comprueba. El sandbox
-- `supabase/tests/reversa_helpers_rbac/` la ejecuta contra un Postgres real y
-- exige que las SEIS huellas resultantes —tres definiciones y tres grants—
-- coincidan con las que la baseline declara para producción.
--
-- ANTES DE FUSIONAR, REVALIDAR. `supabase/reversas/20260912020100_revalidar_antes_de_fusionar.sql`
-- es de sólo lectura y devuelve `SEGUIR` o `PARAR`. La evidencia de acá abajo se
-- tomó el 2026-09-10; entre esa fecha y el despliegue alguien puede cablear una
-- de estas funciones a una policy nueva.
--
-- Retirar las seis entradas de la baseline va en el PR que refresque
-- `huella-produccion.json` después de aplicar esto — la baseline sólo puede
-- encoger, y encoge ahí. Mientras esas entradas sigan, la reversa de arriba se
-- puede seguir verificando contra ellas.
--
-- IDEMPOTENTE: `DROP FUNCTION IF EXISTS`. En cualquier entorno construido desde
-- el repositorio es un no-op, porque las funciones nunca estuvieron.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_obj   text;
  v_lista text := '';
BEGIN
  -- (a) Dependencias de catálogo: policies, defaults, vistas materializadas…
  FOR v_obj IN
    SELECT DISTINCT COALESCE(cl.relname, d.classid::regclass::text)
    FROM pg_depend d
    JOIN pg_proc p ON p.oid = d.refobjid AND d.refclassid = 'pg_proc'::regclass
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN pg_class cl ON cl.oid = d.objid
    WHERE n.nspname = 'public'
      AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
      AND d.deptype <> 'i'
  LOOP
    v_lista := v_lista || ' · dependencia: ' || v_obj;
  END LOOP;

  -- (b) Enganches POR NOMBRE, que pg_depend no ve: cuerpos de funciones,
  --     expresiones de policies y definiciones de vistas.
  FOR v_obj IN
    SELECT 'funcion ' || p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND p.proname NOT IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
      AND p.prosrc ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
    UNION ALL
    SELECT 'policy ' || schemaname || '.' || tablename || '.' || policyname
    FROM pg_policies
    WHERE COALESCE(qual,'') || COALESCE(with_check,'')
          ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
    UNION ALL
    SELECT 'vista ' || table_schema || '.' || table_name
    FROM information_schema.views
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
      AND view_definition ~ '\mhas_role_any|has_super_or_owner_access|is_user_in_company_with_role\M'
  LOOP
    v_lista := v_lista || ' · referencia: ' || v_obj;
  END LOOP;

  IF v_lista <> '' THEN
    RAISE EXCEPTION
      'ABORTADO: alguien empezó a usar estos helpers después de la auditoría del 2026-09-10.%'
      '  Revisar antes de retirarlos: la migración NO los borra si hay consumidores.', v_lista;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.has_role_any(text[]);
DROP FUNCTION IF EXISTS public.has_super_or_owner_access(uuid);
DROP FUNCTION IF EXISTS public.is_user_in_company_with_role(uuid, text[]);

-- ── Postcondición: que de verdad no quedaron ────────────────────────────────
DO $$
DECLARE v_quedan int;
BEGIN
  SELECT count(*) INTO v_quedan
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role');
  IF v_quedan <> 0 THEN
    RAISE EXCEPTION 'quedaron % helper(s) sin retirar: revisar sobrecargas con otra firma', v_quedan;
  END IF;
END $$;
