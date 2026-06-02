-- ============================================================================
-- report_templates + report_runs — F4.5.1: Reportes guardados (MVP)
-- ============================================================================
-- Permite al usuario guardar la definicion de un reporte (tabla fuente +
-- columnas + filtros) y re-ejecutarlo en un click. El MVP soporta solo
-- ejecucion manual (descarga client-side via exportData de F4.5.2).
--
-- PRs siguientes:
--   F4.5.1b — edge function run-report (server-side execution)
--   F4.5.1c — pg_cron schedule (monthly_day1, weekly_monday)
--   F4.5.1d — email delivery a recipients (Resend via email_send_queue F2.15e)
--
-- Scope MVP: 5 source_table whitelisted (las con soft delete F2.7) para
-- evitar SQL injection. Filters son key-value simples interpretados client-side.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_templates (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid          REFERENCES public.projects(id) ON DELETE SET NULL,
  name          text          NOT NULL,
  description   text,
  -- Tabla fuente (whitelist por seguridad)
  source_table  text          NOT NULL CHECK (source_table IN (
                                'cuotas_condominio',
                                'pagos',
                                'tickets_mantenimiento',
                                'gastos_condominio',
                                'fondo_reserva_condominio'
                              )),
  -- Columnas a incluir: [{ header, accessor }]
  columns       jsonb         NOT NULL DEFAULT '[]'::jsonb,
  -- Filtros simples key-value: { "estado": "pendiente", "periodo": "2026-06" }
  filters       jsonb         NOT NULL DEFAULT '{}'::jsonb,
  -- Schedule (MVP solo 'manual')
  schedule_kind text          NOT NULL DEFAULT 'manual'
                              CHECK (schedule_kind IN ('manual', 'monthly_day1', 'weekly_monday')),
  -- Destinatarios para email (preparado para F4.5.1d)
  recipients    jsonb         NOT NULL DEFAULT '[]'::jsonb,
  -- Format default sugerido
  default_format text         NOT NULL DEFAULT 'xlsx'
                              CHECK (default_format IN ('xlsx', 'csv', 'pdf')),
  created_by    uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_templates_company
  ON public.report_templates(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.report_runs (
  id            bigserial     PRIMARY KEY,
  template_id   uuid          NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  company_id    uuid          NOT NULL,
  triggered_by  text          NOT NULL CHECK (triggered_by IN ('manual', 'scheduled', 'api')),
  triggered_at  timestamptz   NOT NULL DEFAULT now(),
  rows_count    integer,
  format        text          CHECK (format IN ('xlsx', 'csv', 'pdf')),
  status        text          NOT NULL DEFAULT 'success'
                              CHECK (status IN ('success', 'failed')),
  error_msg     text,
  actor_id      uuid          REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_report_runs_template
  ON public.report_runs(template_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_runs_company
  ON public.report_runs(company_id, triggered_at DESC);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_runs ENABLE ROW LEVEL SECURITY;

-- Templates: lectura/escritura per-tenant (admin/owner), super_admin todo
DROP POLICY IF EXISTS "report_templates_select" ON public.report_templates;
CREATE POLICY "report_templates_select" ON public.report_templates
  FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

DROP POLICY IF EXISTS "report_templates_write" ON public.report_templates;
CREATE POLICY "report_templates_write" ON public.report_templates
  FOR ALL TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner', 'admin']))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND current_user_role() = ANY(ARRAY['company_owner', 'admin']))
  );

-- Runs: solo lectura (los inserts vienen de la edge function via service role)
DROP POLICY IF EXISTS "report_runs_select" ON public.report_runs;
CREATE POLICY "report_runs_select" ON public.report_runs
  FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

DROP POLICY IF EXISTS "report_runs_insert_self" ON public.report_runs;
CREATE POLICY "report_runs_insert_self" ON public.report_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND actor_id = auth.uid())
  );

COMMENT ON TABLE public.report_templates IS
  'F4.5.1 — Definicion guardada de un reporte. MVP soporta ejecucion manual; PRs siguientes agregan schedule + email.';

COMMENT ON TABLE public.report_runs IS
  'F4.5.1 — Bitacora de ejecuciones de reportes. Cada manual run desde el frontend inserta una row para trazabilidad.';
