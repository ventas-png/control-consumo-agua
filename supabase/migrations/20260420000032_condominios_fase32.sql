-- Condominios Fase 32
-- Tablas: vencimientos_extra, capacitacion_personal_cond, proyectos_condominio

-- ── vencimientos_extra ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vencimientos_extra (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo           text        NOT NULL,
  descripcion      text,
  categoria        text        NOT NULL DEFAULT 'otro',
  -- 'contrato' | 'permiso' | 'certificacion' | 'seguro' | 'otro'
  fecha_vencimiento date       NOT NULL,
  entidad          text,
  monto            numeric(12,2),
  alerta_dias      int         NOT NULL DEFAULT 30,
  renovado         boolean     NOT NULL DEFAULT false,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vencimientos_extra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venc_extra_sel" ON public.vencimientos_extra FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "venc_extra_ins" ON public.vencimientos_extra FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "venc_extra_upd" ON public.vencimientos_extra FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "venc_extra_del" ON public.vencimientos_extra FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_venc_extra_project ON public.vencimientos_extra(project_id);
CREATE INDEX IF NOT EXISTS idx_venc_extra_fecha   ON public.vencimientos_extra(fecha_vencimiento);

-- ── capacitacion_personal_cond ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.capacitacion_personal_cond (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  personal_id            uuid        REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  nombre_empleado        text        NOT NULL,
  cargo                  text,
  curso                  text        NOT NULL,
  proveedor              text,
  fecha_inicio           date        NOT NULL,
  fecha_fin              date,
  fecha_vencimiento_cert date,
  costo                  numeric(10,2),
  estado                 text        NOT NULL DEFAULT 'completado',
  -- 'planificado' | 'en_progreso' | 'completado' | 'vencido'
  notas                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.capacitacion_personal_cond ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cap_pers_sel" ON public.capacitacion_personal_cond FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cap_pers_ins" ON public.capacitacion_personal_cond FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cap_pers_upd" ON public.capacitacion_personal_cond FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cap_pers_del" ON public.capacitacion_personal_cond FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cap_pers_project ON public.capacitacion_personal_cond(project_id);
CREATE INDEX IF NOT EXISTS idx_cap_pers_fecha   ON public.capacitacion_personal_cond(fecha_vencimiento_cert);

-- ── proyectos_condominio ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.proyectos_condominio (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre             text        NOT NULL,
  descripcion        text,
  categoria          text        NOT NULL DEFAULT 'mejora',
  -- 'mejora' | 'mantenimiento' | 'seguridad' | 'tecnologia' | 'otro'
  estado             text        NOT NULL DEFAULT 'planificado',
  -- 'planificado' | 'en_progreso' | 'pausado' | 'completado' | 'cancelado'
  responsable        text,
  fecha_inicio       date,
  fecha_fin_estimada date,
  fecha_fin_real     date,
  porcentaje_avance  int         NOT NULL DEFAULT 0,
  presupuesto        numeric(12,2),
  costo_real         numeric(12,2),
  notas              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.proyectos_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proy_cond_sel" ON public.proyectos_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "proy_cond_ins" ON public.proyectos_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "proy_cond_upd" ON public.proyectos_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "proy_cond_del" ON public.proyectos_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_proy_cond_project ON public.proyectos_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_proy_cond_estado  ON public.proyectos_condominio(estado);
