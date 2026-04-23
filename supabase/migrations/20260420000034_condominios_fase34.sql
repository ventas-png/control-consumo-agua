-- Condominios Fase 34
-- Tabla: automatizaciones_cond

CREATE TABLE IF NOT EXISTS public.automatizaciones_cond (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre            text        NOT NULL,
  trigger_tipo      text        NOT NULL DEFAULT 'cuota_vencida_dias',
  -- 'cuota_vencida_dias' | 'ticket_sin_resolver_dias' | 'vencimiento_critico_dias' | 'cert_personal_vence_dias'
  trigger_valor     int         NOT NULL DEFAULT 30,
  accion_tipo       text        NOT NULL DEFAULT 'notificacion_interna',
  -- 'notificacion_interna' | 'crear_alerta' | 'marcar_moroso'
  accion_config     jsonb       NOT NULL DEFAULT '{}',
  activa            boolean     NOT NULL DEFAULT true,
  ultima_ejecucion  timestamptz,
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automatizaciones_cond ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auto_cond_sel" ON public.automatizaciones_cond FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "auto_cond_ins" ON public.automatizaciones_cond FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "auto_cond_upd" ON public.automatizaciones_cond FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "auto_cond_del" ON public.automatizaciones_cond FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_auto_cond_project ON public.automatizaciones_cond(project_id);
CREATE INDEX IF NOT EXISTS idx_auto_cond_activa  ON public.automatizaciones_cond(activa);
