-- ════════════════════════════════════════════════════════════════════════════
-- Auditoría 2026-07-28 · corrección de PR-27
-- Revocar EXECUTE público sobre set_project_id_desde_padre()
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ PASÓ
-- `security-guard.mjs` (que corre contra el catálogo de PRODUCCIÓN) falló con:
--
--   (a) SECURITY DEFINER anon-ejecutables: 2 hallada(s), 1 no permitida(s)
--       ✗ set_project_id_desde_padre
--
-- La función la introduje en 20260729000600 (PR-27) y su comentario AFIRMABA:
-- «no se concede a `authenticated`: solo se alcanza vía los triggers, así que no
-- amplía superficie de RPC». **Eso era falso.** No hacía falta conceder nada:
-- `CREATE FUNCTION` otorga `EXECUTE` a `PUBLIC` POR DEFECTO, y `PUBLIC` incluye
-- a `anon` y `authenticated`. Afirmé una propiedad de seguridad que nunca
-- comprobé.
--
-- POR QUÉ NO SALTÓ EN EL PR DE PR-27
-- Dos motivos, y el segundo importa para el CI:
--   1. El guard lee PRODUCCIÓN, no el repo — y la función no existía en prod
--      hasta que se aplicó la migración.
--   2. En el push de merge de #678, `security-guard` y `apply-migrations-prod`
--      corren EN PARALELO: el guard terminó a las 18:59:24 y el apply escribió
--      la función entre 18:59:23 y 18:59:24. El guard leyó el catálogo de antes.
--      Pasó por sincronía, no porque la función estuviera bien. Lo cazó el
--      siguiente push. (Anotado como debilidad de orden en el CI.)
--
-- POR QUÉ `get_my_company_id` (recreada en 20260729000500) NO está afectada
-- Porque `CREATE OR REPLACE` sobre una función EXISTENTE **conserva su ACL**.
-- Sólo las funciones NUEVAS nacen con el grant a PUBLIC. Es la imagen especular
-- de la lección de PR-4: allí un `CREATE OR REPLACE` perdió un guard del CUERPO;
-- aquí lo que se hereda —o no— son los GRANTS.
--
-- POR QUÉ REVOCAR NO ROMPE LOS TRIGGERS
-- Verificado ejecutándolo contra PostgreSQL 16.13, no por lectura de la doc:
-- con un rol NO propietario y SIN `EXECUTE` sobre la función
-- (`has_function_privilege` = false), el `INSERT` en `movimientos_caja` sigue
-- funcionando y `project_id` se deriva correctamente del padre. Postgres
-- comprueba `EXECUTE` sobre la función de trigger al hacer `CREATE TRIGGER`, no
-- en cada disparo.
--
-- Severidad real: baja. Es una función `RETURNS trigger`; invocarla como RPC
-- fuera de contexto de trigger falla de todos modos. Pero la política del repo
-- (#378/#380) es que NINGUNA `SECURITY DEFINER` de `public` sea anon-ejecutable,
-- y el guard tiene razón en no admitir excepciones sin justificar.
--
-- Idempotente: `REVOKE` de un privilegio ya revocado no falla.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public.set_project_id_desde_padre()
  FROM PUBLIC, anon, authenticated;

-- Verificación dentro de la propia migración: si por lo que sea el REVOKE no
-- surtió efecto, esto falla aquí en vez de dejar que lo descubra el guard
-- nocturno. `to_regprocedure` evita romper si la función no existiera.
DO $$
DECLARE
  v_oid oid := to_regprocedure('public.set_project_id_desde_padre()');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'set_project_id_desde_padre() no existe — ¿faltó 20260729000600?';
  END IF;

  -- `anon` puede no existir fuera de Supabase (p. ej. en el harness local de
  -- supabase/tests/), así que sólo se comprueba si el rol está presente.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon SIGUE pudiendo ejecutar set_project_id_desde_padre()';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated SIGUE pudiendo ejecutar set_project_id_desde_padre()';
  END IF;
END $$;
