-- ════════════════════════════════════════════════════════════════════════════
-- security_logs — cerrar el drift de SEGURIDAD · ALTA (baseline desde 2026-09-01)
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES `security_logs`. El log de auditoría de la PLATAFORMA: intentos de
-- acceso, cambios de contraseña, eventos de seguridad de todos los tenants en
-- una sola tabla. No lleva `company_id`, así que no hay forma de acotarlo por
-- empresa: o lo lee el operador de la plataforma, o no lo lee nadie.
--
-- ── EL HALLAZGO ────────────────────────────────────────────────────────────
--
-- El auditor de drift (#827) declara `tabla:security_logs/policies` como
-- SEGURIDAD · ALTA desde el 2026-09-01. Producción tiene CUATRO policies y el
-- repositorio declara UNA. Las tres que sobran:
--
--   · `security_logs_insert_anon` — INSERT a `anon`, con CHECK que sólo exige
--     `user_id IS NULL`. Un visitante SIN SESIÓN puede escribir en el log de
--     auditoría: inundarlo, o peor, FABRICAR entradas que después alguien lee
--     como evidencia. Un log al que puede escribir cualquiera no es un log.
--   · `security_logs_insert_authenticated` — lo mismo para cualquier usuario
--     con sesión, de cualquier tenant.
--   · `security_logs_select_by_role` — SELECT a `public` con
--     `current_user_role() = 'admin'` y SIN filtro por company_id. Como la
--     tabla es global, el admin de UN tenant lee los eventos de seguridad de
--     TODOS los demás. Es una fuga entre tenants, no un permiso de más.
--
-- NINGUNA de las tres hace falta. Los dos únicos escritores son las edge
-- functions `log-security-event` y `create-cliente-account`, y las dos usan
-- `SUPABASE_SERVICE_ROLE_KEY` (`adminClient`), que ignora la RLS. Ningún
-- cliente —ni `src/`, ni ninguna otra función— inserta ni lee esta tabla; lo
-- único que la menciona en `src/` es el tipo generado en `database.types.ts`.
--
-- ── LA SEGUNDA CAPA, QUE NADIE MIRÓ ────────────────────────────────────────
--
-- Los GRANTS de tabla. `anon` y `authenticated` tienen los SIETE privilegios
-- (`arwdDxt`) sobre `security_logs`, en producción Y en el repositorio — es el
-- grant por defecto que Supabase da a los tres roles sobre `public`, y ninguna
-- migración lo tocó. Hoy la RLS los contiene: sin policy de INSERT, el INSERT
-- se deniega aunque el grant esté.
--
-- Pero eso es UNA sola capa, y es exactamente la capa que falló en producción:
-- `security_logs_insert_anon` sólo era explotable PORQUE `anon` además tenía el
-- grant de INSERT. Quitar las policies y dejar los grants deja el arma cargada
-- para la próxima policy permisiva que alguien agregue a mano. Se cierran las
-- dos capas, y esta migración es la que escribe la segunda en el repositorio.
--
-- ── LA POSTURA QUE QUEDA ───────────────────────────────────────────────────
--
--   RLS                habilitada (no se toca, se re-afirma)
--   policies           UNA sola: `security_logs_select_superadmin`, la del
--                      repositorio (20260729000300). SELECT, a `authenticated`,
--                      con `is_super_admin()`. Ninguna de INSERT/UPDATE/DELETE:
--                      con RLS activa su ausencia las deniega.
--   anon               NADA. Ni un privilegio.
--   authenticated      SELECT y nada más. Lo necesita para que la policy de
--                      super_admin pueda concederle algo: una policy se evalúa
--                      con el rol que consulta, y sin el grant de tabla ni el
--                      super_admin llegaría a leer.
--   service_role       SELECT e INSERT. Es quien escribe. NO conserva UPDATE ni
--                      DELETE: un log de auditoría es de sólo-anexar, y nada en
--                      el repositorio los usa (se verificó: ninguna migración,
--                      ningún script y ninguna función borra ni actualiza esta
--                      tabla). El dueño (`postgres`) conserva todo, así que una
--                      purga administrativa sigue siendo posible.
--
-- ── POR QUÉ `FROM PUBLIC, anon, authenticated` Y NO SÓLO LOS ROLES ─────────
--
-- Misma lección ya pagada en 20260729000700, 20260825010000 y 20260909000000:
-- un privilegio HEREDADO de `PUBLIC` no se quita revocándoselo al rol. Aquí
-- `PUBLIC` no tiene nada (la ACL de producción y la reconstrucción coinciden en
-- eso), así que el REVOKE de PUBLIC es un no-op deliberado: cuesta nada y cierra
-- la puerta por la que ya se coló este mismo fallo tres veces.
--
-- ── QUÉ PASA EN PRODUCCIÓN Y QUÉ EN EL REPOSITORIO ─────────────────────────
--
-- Esta migración NO es un no-op declarativo: cambia las dos partes.
--
--   · Los tres `DROP POLICY` sólo hacen algo en PRODUCCIÓN — el repositorio
--     nunca declaró esas policies, así que sobre la reconstrucción son no-ops.
--   · Los REVOKE/GRANT hacen algo en LOS DOS lados: hoy el grupo
--     `tabla:security_logs/grants` es idéntico en producción y en el
--     repositorio (`f96a9d92…:28`, los 7 privilegios × 4 grantees), y después
--     de esto será idéntico otra vez, pero con la ACL cerrada.
--
-- Por eso el auditor clasificará `/grants` como CAMBIO PLANIFICADO —P == M y
-- R ≠ M— hasta que la migración llegue a producción y se recapture la huella.
-- La entrada `tabla:security_logs/policies` de `drift-conocido.json` NO se
-- retira acá: se retira cuando el auditor demuestre la convergencia con una
-- huella de producción tomada DESPUÉS de aplicar esto. Ni se amplía la baseline
-- ni se tocan hashes.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Las tres policies que sobran ───────────────────────────────────────
-- `IF EXISTS`: en la reconstrucción no existen, y la migración tiene que
-- aplicar igual sobre una base limpia.
DROP POLICY IF EXISTS "security_logs_insert_anon" ON public.security_logs;
DROP POLICY IF EXISTS "security_logs_insert_authenticated" ON public.security_logs;
DROP POLICY IF EXISTS "security_logs_select_by_role" ON public.security_logs;

-- ── 2 · La RLS sigue habilitada ────────────────────────────────────────────
-- Idempotente. Se re-afirma para que la postura quede escrita en un solo sitio
-- y no dependa de que nadie la haya apagado por fuera.
ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- ── 3 · La única policy autoritativa, re-declarada ─────────────────────────
-- Es la misma de 20260729000300, con la misma definición: sobre la
-- reconstrucción el par DROP+CREATE deja el objeto idéntico (no mueve la
-- huella). Se repite acá para que producción termine con EXACTAMENTE esta y no
-- con una variante que alguien haya editado a mano.
DROP POLICY IF EXISTS "security_logs_select_superadmin" ON public.security_logs;
CREATE POLICY "security_logs_select_superadmin" ON public.security_logs
  FOR SELECT
  TO authenticated
  USING (is_super_admin());

COMMENT ON POLICY "security_logs_select_superadmin" ON public.security_logs IS
  'Log de auditoría de plataforma: SOLO super_admin lee. La escritura llega por service_role desde las edges log-security-event y create-cliente-account (que ignoran RLS); la ausencia deliberada de policies de INSERT/UPDATE/DELETE las deniega para cualquier otro rol. Auditoría 2026-07-28 (Bloque A · PR-6); grants cerrados en 20260910000000.';

-- ── 4 · Los grants: cerrar y volver a abrir sólo lo necesario ──────────────
REVOKE ALL ON public.security_logs FROM PUBLIC;
REVOKE ALL ON public.security_logs FROM anon;
REVOKE ALL ON public.security_logs FROM authenticated;
REVOKE ALL ON public.security_logs FROM service_role;

-- Lo mínimo, y nada más.
GRANT SELECT          ON public.security_logs TO authenticated;  -- la policy de super_admin
GRANT SELECT, INSERT  ON public.security_logs TO service_role;   -- los dos escritores

-- ── 5 · Verificación DENTRO de la propia migración ─────────────────────────
--
-- Un REVOKE sin autoridad no falla: emite un WARNING y sale 0. Si esto se
-- aplicara con un rol que no puede revocar, la migración quedaría registrada
-- como aplicada con la puerta abierta. Se mide el resultado y se aborta.
--
-- Los roles se comprueban con guardas de existencia: el harness de
-- `supabase/tests/` levanta clústeres donde `anon` o `service_role` pueden no
-- existir, y ahí la ausencia del rol es la ausencia del privilegio.
DO $verificar$
DECLARE
  v_existe boolean;
  v_priv   text;
  v_rol    text;
BEGIN
  -- (a) anon y authenticated: NADA de escritura.
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rol) INTO v_existe;
    CONTINUE WHEN NOT v_existe;
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_rol, 'public.security_logs', v_priv) THEN
        RAISE EXCEPTION 'security_logs: % conserva % después del REVOKE', v_rol, v_priv
          USING HINT = 'El REVOKE no tuvo autoridad, o algo volvió a conceder el privilegio.';
      END IF;
    END LOOP;
  END LOOP;

  -- (b) anon tampoco lee.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND has_table_privilege('anon', 'public.security_logs', 'SELECT') THEN
    RAISE EXCEPTION 'security_logs: anon conserva SELECT después del REVOKE';
  END IF;

  -- (c) authenticated SÍ conserva SELECT: sin él, ni el super_admin leería.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND NOT has_table_privilege('authenticated', 'public.security_logs', 'SELECT') THEN
    RAISE EXCEPTION 'security_logs: authenticated se quedó sin SELECT'
      USING HINT = 'Una policy se evalúa con el rol que consulta: sin el grant de tabla, is_super_admin() no alcanza.';
  END IF;

  -- (d) service_role escribe y lee, y NO actualiza ni borra.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    IF NOT has_table_privilege('service_role', 'public.security_logs', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.security_logs', 'SELECT') THEN
      RAISE EXCEPTION 'security_logs: service_role perdió SELECT o INSERT'
        USING HINT = 'log-security-event y create-cliente-account escriben con esta llave.';
    END IF;
    FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('service_role', 'public.security_logs', v_priv) THEN
        RAISE EXCEPTION 'security_logs: service_role conserva % (el log es de sólo-anexar)', v_priv;
      END IF;
    END LOOP;
  END IF;

  -- (e) RLS habilitada y UNA sola policy, la autoritativa.
  IF NOT (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'security_logs') THEN
    RAISE EXCEPTION 'security_logs: la RLS quedó DESHABILITADA';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'security_logs') <> 1 THEN
    RAISE EXCEPTION 'security_logs: quedaron % policies, se esperaba exactamente 1',
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'security_logs');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'security_logs'
                    AND policyname = 'security_logs_select_superadmin' AND cmd = 'SELECT') THEN
    RAISE EXCEPTION 'security_logs: la policy que queda no es security_logs_select_superadmin';
  END IF;
END
$verificar$;
