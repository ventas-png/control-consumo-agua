-- Condominios Fase 36
-- Tabla: generacion_cuotas_log (auditoría de generaciones masivas de cuotas)

CREATE TABLE IF NOT EXISTS public.generacion_cuotas_log (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  periodo             text        NOT NULL,
  concepto            text        NOT NULL,
  monto_unitario      numeric(12,2) NOT NULL,
  fecha_vencimiento   date        NOT NULL,
  unidades_generadas  int         NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.generacion_cuotas_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gen_cuotas_sel" ON public.generacion_cuotas_log FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gen_cuotas_ins" ON public.generacion_cuotas_log FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gen_cuotas_del" ON public.generacion_cuotas_log FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_gen_cuotas_project ON public.generacion_cuotas_log(project_id);
CREATE INDEX IF NOT EXISTS idx_gen_cuotas_periodo ON public.generacion_cuotas_log(periodo);
