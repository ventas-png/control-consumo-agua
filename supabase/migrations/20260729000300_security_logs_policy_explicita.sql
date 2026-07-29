-- ════════════════════════════════════════════════════════════════════════════
-- security_logs — declarar explícitamente su postura de acceso
-- (auditoría 2026-07-28, Bloque A · PR-6, alcance corregido).
--
-- POR QUÉ, Y POR QUÉ ES MUCHO MÁS PEQUEÑO DE LO QUE DECÍA LA AUDITORÍA
-- El informe listaba 12 tablas «con RLS habilitada y CERO policies» (conta_*,
-- cxp_*, presupuesto_*, bancos, security_logs) y proponía dotarlas a todas de
-- policies. Al implementarlo resultó que **11 de las 12 YA TIENEN policies
-- correctamente acotadas por tenant** — solo que se crean dentro de bloques
-- `DO $$ ... FOREACH t IN ARRAY ARRAY['tabla_a','tabla_b'] ...
-- EXECUTE format('CREATE POLICY ...') $$` (ver 20260611000000:~200,
-- 20260611010000:159, 20260611020000, 20260611030000). Un escaneo de texto que
-- no modele esa forma no las ve. Verificado leyendo el bloque: la policy real
-- es `USING (company_id = get_my_company_id() OR is_super_admin())`.
--
-- Queda UNA tabla de verdad sin policy: `security_logs`.
--
-- QUÉ POSTURA CORRESPONDE
-- `security_logs` se escribe SOLO desde la edge function `log-security-event`
-- con `adminClient` (service_role, que ignora RLS), y NO se lee desde `src/`
-- en ningún punto. Es decir: RLS-sin-policy es funcionalmente CORRECTO hoy
-- (deny-all para authenticated/anon, escritura por service_role).
--
-- El problema no es el acceso, es la AMBIGÜEDAD: sin policy no se distingue
-- «deny-all a propósito» de «se olvidó la policy», y el repo no reproduce prod,
-- donde el guard nocturno exige ≥1 policy (así que prod tiene alguna que el
-- repo no registra). Esta migración escribe la intención.
--
-- Se concede SELECT solo a super_admin: es el log de auditoría de la
-- plataforma, y su operador debe poder leerlo. Ningún tenant lo ve, y no hay
-- policy de INSERT/UPDATE/DELETE a propósito — con RLS activa, su ausencia
-- deniega esas operaciones a todo rol que no sea service_role.
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "security_logs_select_superadmin" ON public.security_logs;
CREATE POLICY "security_logs_select_superadmin" ON public.security_logs
  FOR SELECT
  TO authenticated
  USING (is_super_admin());

COMMENT ON POLICY "security_logs_select_superadmin" ON public.security_logs IS
  'Log de auditoría de plataforma: SOLO super_admin lee. La escritura llega por service_role desde la edge log-security-event (que ignora RLS); la ausencia deliberada de policies de INSERT/UPDATE/DELETE las deniega para cualquier otro rol. Auditoría 2026-07-28, Bloque A · PR-6.';
