-- Condominios Fase 35
-- Tablas: plantillas_mensaje_cond, flujo_aprobacion_cond

CREATE TABLE IF NOT EXISTS public.plantillas_mensaje_cond (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre      text        NOT NULL,
  canal       text        NOT NULL DEFAULT 'whatsapp',
  -- 'whatsapp' | 'email' | 'sms'
  asunto      text,
  cuerpo      text        NOT NULL,
  variables   jsonb       NOT NULL DEFAULT '[]',
  activa      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plantillas_mensaje_cond ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plantillas_msg_sel" ON public.plantillas_mensaje_cond FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plantillas_msg_ins" ON public.plantillas_mensaje_cond FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plantillas_msg_upd" ON public.plantillas_mensaje_cond FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plantillas_msg_del" ON public.plantillas_mensaje_cond FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_plantillas_msg_project ON public.plantillas_mensaje_cond(project_id);
CREATE INDEX IF NOT EXISTS idx_plantillas_msg_canal   ON public.plantillas_mensaje_cond(canal);

-- -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.flujo_aprobacion_cond (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id              uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tipo                    text        NOT NULL DEFAULT 'otro',
  -- 'gasto_mayor' | 'propuesta' | 'permiso_obra' | 'mudanza' | 'otro'
  titulo                  text        NOT NULL,
  descripcion             text,
  monto                   numeric(14,2),
  solicitado_por          text,
  aprobado_por            text,
  estado                  text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'aprobado' | 'rechazado'
  fecha_solicitud         date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_resolucion        date,
  comentario_resolucion   text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.flujo_aprobacion_cond ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flujo_aprobacion_sel" ON public.flujo_aprobacion_cond FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "flujo_aprobacion_ins" ON public.flujo_aprobacion_cond FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "flujo_aprobacion_upd" ON public.flujo_aprobacion_cond FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "flujo_aprobacion_del" ON public.flujo_aprobacion_cond FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_flujo_aprobacion_project ON public.flujo_aprobacion_cond(project_id);
CREATE INDEX IF NOT EXISTS idx_flujo_aprobacion_estado  ON public.flujo_aprobacion_cond(estado);
