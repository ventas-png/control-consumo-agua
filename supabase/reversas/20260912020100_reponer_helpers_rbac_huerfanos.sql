-- ════════════════════════════════════════════════════════════════════════════
-- REVERSA de 20260912020100_retirar_helpers_rbac_huerfanos.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- Repone las tres funciones que aquella migración retira:
--
--   public.has_role_any(text[])
--   public.has_super_or_owner_access(uuid)
--   public.is_user_in_company_with_role(uuid, text[])
--
-- DE DÓNDE SALE ESTO. De `pg_get_functiondef()` sobre el catálogo VIVO de
-- producción (proyecto nnsqmeigtgewatameexo), leído el 2026-09-10 con un
-- `SELECT`. Los tres cuerpos están copiados VERBATIM, con su indentación y sus
-- saltos de línea: la huella del auditor hashea `prosrc` en crudo, así que un
-- espacio de más produciría una función que se parece pero no es la misma.
--
-- POR QUÉ ESTE ARCHIVO Y NO UNA HUELLA. Porque una huella no repone nada. La
-- baseline del auditor guarda `sha256(prosrc)` para DETECTAR que algo cambió;
-- de ese hash no sale el cuerpo. El PR que retira estas funciones llegó a
-- afirmar que la definición «no se pierde porque está en drift-conocido.json
-- con su huella exacta», y era falso — igual que era falso el `motivo` que ese
-- mismo PR vino a corregir. Esto es lo que hacía falta: DDL que se ejecuta.
--
-- QUÉ SE REPONE, Y NO SÓLO EL CUERPO. Una función restaurada a medias es peor
-- que ninguna, porque parece estar. Se repone todo lo que el catálogo
-- distingue y lo que la huella compara:
--
--   · el cuerpo, byte por byte;
--   · `RETURNS boolean`, `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`;
--   · `SET search_path TO 'public'` — que en una función SECURITY DEFINER no
--     es cosmético: sin él, el `search_path` del llamador decide qué
--     `current_user_role()` se ejecuta;
--   · el dueño (`postgres`), del que dependen los privilegios efectivos;
--   · la ACL exacta: EXECUTE revocado a PUBLIC y concedido a `authenticated` y
--     `service_role`. `CREATE OR REPLACE` sobre una función que no existe la
--     crea con la ACL POR DEFECTO, que incluye a PUBLIC —y por tanto a `anon`—:
--     omitir el REVOKE de abajo dejaría estas tres funciones SECURITY DEFINER
--     abiertas a cualquiera con la clave anon. Es el agujero que producción
--     cerró a mano y que el repositorio nunca escribió;
--   · el `COMMENT`, que es lo único que dice de dónde salieron.
--
-- IDEMPOTENTE: `CREATE OR REPLACE` y `REVOKE`/`GRANT` fijan un estado, no lo
-- incrementan. Correrlo dos veces da lo mismo que correrlo una.
--
-- CÓMO COMPROBAR QUE REPUSO LO QUE HABÍA. Ejecutar
-- `scripts/schema-drift/fingerprint.sql` y comparar estas seis claves contra
-- `scripts/schema-drift/drift-conocido.json`, campo `produccion`:
--
--   funcion:has_role_any(p_roles text[])
--       b71b07a39c96a790e3fe13745961462d64dbbda6f1a2e862e117b51d26a8e717:1
--   funcion:has_super_or_owner_access(p_company_id uuid)
--       f6db70ae8f9a6f493ce2644c4ee665527385ee8841993eb950e92bb0f75ad7b7:1
--   funcion:is_user_in_company_with_role(p_company_id uuid, p_roles text[])
--       9bec92a81d951c09d57f5199e918fed1fd49a61deeabcf2fb21c68599e777f7d:1
--   …y las tres claves `/grants`, las tres con
--       f87f132c48f7276eb776d666a507cbc5e81f2d7a33eeed63e433af6cd702e759:1
--
-- Si las seis coinciden, lo repuesto es indistinguible de lo que había. Esa
-- comprobación está automatizada en `src/__tests__/reversaHelpersRbac.test.ts`,
-- que la corre contra un PostgreSQL de verdad.
--
-- DEPENDENCIAS. Las tres llaman a `public.current_user_role()`, y dos de ellas
-- además a `public.get_my_company_id()`. Las dos existen en el repositorio
-- (20260518000008) y esta reversa NO las toca.
--
-- NO SE APLICA SOLO. Vive fuera de `supabase/migrations/` a propósito; ver
-- `supabase/reversas/README.md`.
--
--   psql "$CADENA" -v ON_ERROR_STOP=1 -f supabase/reversas/20260912020100_reponer_helpers_rbac_huerfanos.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · has_role_any(text[]) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role_any(p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT current_user_role() = ANY(p_roles)
$function$;

ALTER FUNCTION public.has_role_any(text[]) OWNER TO postgres;
COMMENT ON FUNCTION public.has_role_any(text[]) IS
  'Performance: Check if user has any of the provided roles';
REVOKE ALL    ON FUNCTION public.has_role_any(text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_role_any(text[]) TO authenticated, service_role;

-- ── 2 · has_super_or_owner_access(uuid) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_super_or_owner_access(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'company_owner' AND get_my_company_id() = p_company_id)
$function$;

ALTER FUNCTION public.has_super_or_owner_access(uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.has_super_or_owner_access(uuid) IS
  'Performance: Super admin or company owner check';
REVOKE ALL    ON FUNCTION public.has_super_or_owner_access(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_super_or_owner_access(uuid) TO authenticated, service_role;

-- ── 3 · is_user_in_company_with_role(uuid, text[]) ──────────────────────────
CREATE OR REPLACE FUNCTION public.is_user_in_company_with_role(p_company_id uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    current_user_role() = ANY(p_roles)
    AND get_my_company_id() = p_company_id
$function$;

ALTER FUNCTION public.is_user_in_company_with_role(uuid, text[]) OWNER TO postgres;
COMMENT ON FUNCTION public.is_user_in_company_with_role(uuid, text[]) IS
  'Performance: Combined company_id + role check';
REVOKE ALL    ON FUNCTION public.is_user_in_company_with_role(uuid, text[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_user_in_company_with_role(uuid, text[]) TO authenticated, service_role;

-- ── Postcondición: que de verdad volvieron, y con la forma correcta ─────────
DO $$
DECLARE v_mal int;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')) <> 3 THEN
    RAISE EXCEPTION 'la reversa no repuso las tres funciones';
  END IF;

  SELECT count(*) INTO v_mal
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
    AND NOT (p.prosecdef
             AND p.provolatile = 's'
             AND p.proconfig @> ARRAY['search_path=public']);
  IF v_mal > 0 THEN
    RAISE EXCEPTION '% función(es) repuesta(s) sin SECURITY DEFINER, sin STABLE o sin search_path fijado', v_mal;
  END IF;
  -- PUBLIC no puede quedar con EXECUTE: sería abrir tres SECURITY DEFINER a anon.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE n.nspname = 'public'
      AND p.proname IN ('has_role_any','has_super_or_owner_access','is_user_in_company_with_role')
      AND a.privilege_type = 'EXECUTE'
      AND a.grantee = 0            -- 0 = PUBLIC
  ) THEN
    RAISE EXCEPTION 'PUBLIC conserva EXECUTE: la reversa dejó las funciones abiertas a anon';
  END IF;
END $$;

COMMIT;
