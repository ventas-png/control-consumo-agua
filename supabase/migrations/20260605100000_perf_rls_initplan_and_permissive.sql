-- ============================================================================
-- Higiene de performance de RLS (Track T8/QA · banda de perf)
-- ============================================================================
-- Banda de migración: la guía reservó para esta sesión las horas 10:00–13:59.
-- Al arrancar, "hoy" era 2026-06-04 y esos slots (…0604100000/110000/130000) YA
-- estaban mergeados y, peor, ordenarían ANTES de las tablas que aquí se modifican
-- (legal_acceptances @…0604260000, user_preferences @…0604280000). La convención
-- de supabase/migrations/README.md es taxativa: "nunca insertar una migración con
-- timestamp anterior al último mergeado" (…0604300000). La fecha rodó a 2026-06-05,
-- así que esta banda de perf usa 20260605 en las horas 10–13 reservadas: sortea
-- después del último mergeado, usa timestamps válidos, y queda lejos de la banda
-- 14:00–15:59 de la otra sesión (Ops).
--
-- POR QUÉ: get_advisors(performance) reporta 9 WARN:
--   • 7× auth_rls_initplan — policies que llaman auth.uid() DIRECTO, así que el
--     planner re-evalúa la función POR FILA (suboptimal a escala). El fix
--     documentado por Supabase es envolverla en (select auth.uid()) para que se
--     evalúe UNA vez como InitPlan.
--   • 2× multiple_permissive_policies — report_templates y user_presence tienen
--     dos policies PERMISIVAS para authenticated+SELECT (una policy SELECT amplia
--     + una policy ALL de escritura que arrastra SELECT). Postgres evalúa AMBAS
--     en cada SELECT. Se consolida partiendo la policy ALL en INSERT/UPDATE/DELETE
--     explícitas, de modo que SELECT quede cubierto por UNA sola policy.
--
-- SEMÁNTICA: se preserva exactamente. En ambos casos la policy de escritura era
-- un subconjunto de la policy SELECT amplia (su rama SELECT era redundante:
-- user_id = me ⊂ company_id = mi_empresa; y owner/admin ⊂ miembros de la empresa),
-- así que quitarle SELECT no cambia qué filas se ven. Solo se tocan las policies
-- señaladas por el advisor; las demás (service_role, *_select amplias) intactas.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE POLICY. Re-ejecutable sin error.
--
-- CÓMO REVERTIR: recrear las policies originales — auth.uid() sin envolver y la
-- policy ALL de escritura (report_templates_write / user_presence_upsert_self) en
-- lugar de las INSERT/UPDATE/DELETE separadas. El detalle original quedó en las
-- migraciones que las crearon (saved_reports, user_presence, legal_acceptance,
-- user_preferences, rate_limit_log).
--
-- VALIDACIÓN: NO apply_migration a prod. Validar en el preview branch del PR y
-- re-correr get_advisors(performance) → los 9 WARN deben desaparecer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) auth_rls_initplan — envolver auth.uid() en (select auth.uid())
-- ----------------------------------------------------------------------------

-- legal_acceptances.legal_acc_select  (SELECT, authenticated)
DROP POLICY IF EXISTS legal_acc_select ON public.legal_acceptances;
CREATE POLICY legal_acc_select ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (
    (user_id = (select auth.uid()))
    OR is_super_admin()
    OR (
      (company_id = get_my_company_id())
      AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))
    )
  );

-- rate_limit_log.rate_limit_log_select  (SELECT, authenticated)
DROP POLICY IF EXISTS rate_limit_log_select ON public.rate_limit_log;
CREATE POLICY rate_limit_log_select ON public.rate_limit_log
  FOR SELECT TO authenticated
  USING (is_super_admin() OR (user_id = (select auth.uid())));

-- report_runs.report_runs_insert_self  (INSERT, authenticated)
DROP POLICY IF EXISTS report_runs_insert_self ON public.report_runs;
CREATE POLICY report_runs_insert_self ON public.report_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND (actor_id = (select auth.uid())))
  );

-- user_preferences  (INSERT/SELECT/UPDATE, authenticated) — fila propia del user
DROP POLICY IF EXISTS user_prefs_insert ON public.user_preferences;
CREATE POLICY user_prefs_insert ON public.user_preferences
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_prefs_select ON public.user_preferences;
CREATE POLICY user_prefs_select ON public.user_preferences
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS user_prefs_update ON public.user_preferences;
CREATE POLICY user_prefs_update ON public.user_preferences
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 2) multiple_permissive_policies (+ initplan en user_presence) — consolidar
--    la policy ALL de escritura en INSERT/UPDATE/DELETE, dejando SELECT a una
--    sola policy permisiva.
-- ----------------------------------------------------------------------------

-- report_templates: partir report_templates_write (ALL) → insert/update/delete.
-- report_templates_select (SELECT) se queda intacta y pasa a ser la ÚNICA policy
-- permisiva de SELECT para authenticated.
DROP POLICY IF EXISTS report_templates_write   ON public.report_templates;
DROP POLICY IF EXISTS report_templates_insert  ON public.report_templates;
DROP POLICY IF EXISTS report_templates_update  ON public.report_templates;
DROP POLICY IF EXISTS report_templates_delete  ON public.report_templates;

CREATE POLICY report_templates_insert ON public.report_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      (company_id = get_my_company_id())
      AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))
    )
  );

CREATE POLICY report_templates_update ON public.report_templates
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (
      (company_id = get_my_company_id())
      AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))
    )
  )
  WITH CHECK (
    is_super_admin()
    OR (
      (company_id = get_my_company_id())
      AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))
    )
  );

CREATE POLICY report_templates_delete ON public.report_templates
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (
      (company_id = get_my_company_id())
      AND (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))
    )
  );

-- user_presence: partir user_presence_upsert_self (ALL) → insert/update/delete,
-- envolviendo auth.uid() en (select …) (cierra TAMBIÉN el WARN de initplan).
-- user_presence_select (SELECT) se queda intacta y pasa a ser la ÚNICA policy
-- permisiva de SELECT para authenticated.
DROP POLICY IF EXISTS user_presence_upsert_self ON public.user_presence;
DROP POLICY IF EXISTS user_presence_insert_self ON public.user_presence;
DROP POLICY IF EXISTS user_presence_update_self ON public.user_presence;
DROP POLICY IF EXISTS user_presence_delete_self ON public.user_presence;

CREATE POLICY user_presence_insert_self ON public.user_presence
  FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (select auth.uid())) AND (company_id = get_my_company_id())
  );

CREATE POLICY user_presence_update_self ON public.user_presence
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    (user_id = (select auth.uid())) AND (company_id = get_my_company_id())
  );

CREATE POLICY user_presence_delete_self ON public.user_presence
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));
