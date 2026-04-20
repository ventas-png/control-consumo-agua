-- Condominios Fase 18
-- Tablas: fondo_reserva_condominio, permisos_obra_unidad, tarifas_condominio, incidentes_seguridad

-- ── fondo_reserva_condominio ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fondo_reserva_condominio (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tipo          text        NOT NULL DEFAULT 'aporte',
  -- 'aporte' | 'retiro' | 'ajuste'
  concepto      text        NOT NULL,
  monto         numeric(12,2) NOT NULL,
  fecha         date        NOT NULL DEFAULT CURRENT_DATE,
  justificacion text,
  aprobado_por  text,
  estado        text        NOT NULL DEFAULT 'aprobado',
  -- 'pendiente' | 'aprobado' | 'rechazado'
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fondo_reserva_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fondo_reserva_select" ON public.fondo_reserva_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "fondo_reserva_insert" ON public.fondo_reserva_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "fondo_reserva_update" ON public.fondo_reserva_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "fondo_reserva_delete" ON public.fondo_reserva_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_fondo_reserva_project ON public.fondo_reserva_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_fondo_reserva_fecha   ON public.fondo_reserva_condominio(fecha DESC);

-- ── permisos_obra_unidad ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.permisos_obra_unidad (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id          uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo_obra          text        NOT NULL DEFAULT 'remodelacion',
  -- 'remodelacion' | 'ampliacion' | 'reparacion' | 'pintura' | 'otro'
  descripcion        text        NOT NULL,
  fecha_inicio       date,
  fecha_fin_estimada date,
  horario_permitido  text,
  fianza             numeric(10,2),
  estado             text        NOT NULL DEFAULT 'solicitado',
  -- 'solicitado' | 'aprobado' | 'en_ejecucion' | 'completado' | 'rechazado'
  aprobado_por       text,
  observaciones      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.permisos_obra_unidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "permisos_obra_select" ON public.permisos_obra_unidad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "permisos_obra_insert" ON public.permisos_obra_unidad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "permisos_obra_update" ON public.permisos_obra_unidad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "permisos_obra_delete" ON public.permisos_obra_unidad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_permisos_obra_project ON public.permisos_obra_unidad(project_id);
CREATE INDEX IF NOT EXISTS idx_permisos_obra_unidad  ON public.permisos_obra_unidad(unidad_id);

-- ── tarifas_condominio ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tarifas_condominio (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  concepto      text        NOT NULL,
  descripcion   text,
  monto         numeric(12,2) NOT NULL,
  tipo_unidad   text        NOT NULL DEFAULT 'todas',
  -- 'todas' | 'residencial' | 'comercial' | 'bodega' | 'parqueo'
  periodicidad  text        NOT NULL DEFAULT 'mensual',
  -- 'mensual' | 'trimestral' | 'semestral' | 'anual' | 'unica_vez'
  activo        boolean     NOT NULL DEFAULT true,
  vigente_desde date,
  vigente_hasta date,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tarifas_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tarifas_cond_select" ON public.tarifas_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "tarifas_cond_insert" ON public.tarifas_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "tarifas_cond_update" ON public.tarifas_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "tarifas_cond_delete" ON public.tarifas_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_tarifas_cond_project ON public.tarifas_condominio(project_id);

-- ── incidentes_seguridad ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incidentes_seguridad (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha         date        NOT NULL DEFAULT CURRENT_DATE,
  hora          time,
  tipo          text        NOT NULL DEFAULT 'otro',
  -- 'robo' | 'vandalismo' | 'accidente' | 'incendio' | 'pelea' | 'otro'
  descripcion   text        NOT NULL,
  area          text,
  reportado_por text,
  estado        text        NOT NULL DEFAULT 'reportado',
  -- 'reportado' | 'investigando' | 'resuelto' | 'cerrado'
  involucrados  text,
  seguimiento   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.incidentes_seguridad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidentes_seg_select" ON public.incidentes_seguridad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "incidentes_seg_insert" ON public.incidentes_seguridad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "incidentes_seg_update" ON public.incidentes_seguridad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "incidentes_seg_delete" ON public.incidentes_seguridad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_incidentes_seg_project ON public.incidentes_seguridad(project_id);
CREATE INDEX IF NOT EXISTS idx_incidentes_seg_fecha   ON public.incidentes_seguridad(fecha DESC);
