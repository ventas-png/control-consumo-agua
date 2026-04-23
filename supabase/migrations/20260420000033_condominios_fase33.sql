-- Condominios Fase 33
-- Tabla: manual_residente_cond

CREATE TABLE IF NOT EXISTS public.manual_residente_cond (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  seccion     text        NOT NULL DEFAULT 'otro',
  -- 'amenidades' | 'normas' | 'faq' | 'contactos' | 'otro'
  titulo      text        NOT NULL,
  contenido   text        NOT NULL,
  orden       int         NOT NULL DEFAULT 0,
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_residente_cond ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manual_res_sel" ON public.manual_residente_cond FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "manual_res_ins" ON public.manual_residente_cond FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "manual_res_upd" ON public.manual_residente_cond FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "manual_res_del" ON public.manual_residente_cond FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_manual_res_project ON public.manual_residente_cond(project_id);
CREATE INDEX IF NOT EXISTS idx_manual_res_seccion ON public.manual_residente_cond(seccion);
