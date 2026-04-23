-- Condominios Fase 24
-- Tablas: control_piscina, mantenimiento_jardineria, incidencias_elevador, mantenimiento_cisterna

-- ── control_piscina ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_piscina (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  hora            time,
  piscina         text        NOT NULL DEFAULT 'Principal',
  ph              numeric(4,2),
  cloro           numeric(6,2),
  temperatura     numeric(5,2),
  turbiedad       text        NOT NULL DEFAULT 'cristalina',
  -- 'cristalina' | 'ligeramente_turbia' | 'turbia'
  estado          text        NOT NULL DEFAULT 'abierta',
  -- 'abierta' | 'cerrada_mantenimiento' | 'cerrada_quimica' | 'cerrada_incidente'
  num_usuarios    int,
  registrado_por  text,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.control_piscina ENABLE ROW LEVEL SECURITY;
CREATE POLICY "piscina_select" ON public.control_piscina FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "piscina_insert" ON public.control_piscina FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "piscina_update" ON public.control_piscina FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "piscina_delete" ON public.control_piscina FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_piscina_project ON public.control_piscina(project_id);
CREATE INDEX IF NOT EXISTS idx_piscina_fecha   ON public.control_piscina(fecha DESC);

-- ── mantenimiento_jardineria ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mantenimiento_jardineria (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  tipo            text        NOT NULL DEFAULT 'mantenimiento_general',
  -- 'mantenimiento_general' | 'poda' | 'fumigacion' | 'siembra' | 'riego' | 'limpieza' | 'otro'
  areas           text[]      NOT NULL DEFAULT '{}',
  proveedor       text,
  trabajadores    int,
  horas_trabajo   numeric(5,1),
  insumos         text,
  costo           numeric(10,2),
  estado          text        NOT NULL DEFAULT 'completado',
  -- 'programado' | 'en_proceso' | 'completado' | 'cancelado'
  proxima_visita  date,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mantenimiento_jardineria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jardineria_select" ON public.mantenimiento_jardineria FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "jardineria_insert" ON public.mantenimiento_jardineria FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "jardineria_update" ON public.mantenimiento_jardineria FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "jardineria_delete" ON public.mantenimiento_jardineria FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_jardineria_project ON public.mantenimiento_jardineria(project_id);
CREATE INDEX IF NOT EXISTS idx_jardineria_fecha   ON public.mantenimiento_jardineria(fecha DESC);

-- ── incidencias_elevador ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incidencias_elevador (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  elevador        text        NOT NULL DEFAULT 'Elevador 1',
  tipo            text        NOT NULL DEFAULT 'falla',
  -- 'falla' | 'mantenimiento_preventivo' | 'mantenimiento_correctivo' | 'inspeccion_legal' | 'otro'
  descripcion     text        NOT NULL,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  hora_inicio     time,
  hora_fin        time,
  empresa_servicio text,
  tecnico         text,
  estado          text        NOT NULL DEFAULT 'reportado',
  -- 'reportado' | 'en_atencion' | 'resuelto' | 'requiere_seguimiento'
  costo           numeric(10,2),
  proxima_inspeccion date,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.incidencias_elevador ENABLE ROW LEVEL SECURITY;
CREATE POLICY "elevador_select" ON public.incidencias_elevador FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "elevador_insert" ON public.incidencias_elevador FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "elevador_update" ON public.incidencias_elevador FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "elevador_delete" ON public.incidencias_elevador FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_elevador_project ON public.incidencias_elevador(project_id);
CREATE INDEX IF NOT EXISTS idx_elevador_fecha   ON public.incidencias_elevador(fecha DESC);

-- ── mantenimiento_cisterna ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mantenimiento_cisterna (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  cisterna        text        NOT NULL DEFAULT 'Cisterna principal',
  tipo            text        NOT NULL DEFAULT 'lectura',
  -- 'lectura' | 'limpieza' | 'cloracion' | 'inspeccion' | 'reparacion'
  nivel_agua_pct  numeric(5,2),
  cloro_residual  numeric(6,3),
  ph              numeric(4,2),
  estado          text        NOT NULL DEFAULT 'normal',
  -- 'normal' | 'bajo_nivel' | 'mantenimiento' | 'fuera_servicio'
  empresa_servicio text,
  tecnico         text,
  costo           numeric(10,2),
  proxima_revision date,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mantenimiento_cisterna ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cisterna_select" ON public.mantenimiento_cisterna FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cisterna_insert" ON public.mantenimiento_cisterna FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cisterna_update" ON public.mantenimiento_cisterna FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cisterna_delete" ON public.mantenimiento_cisterna FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cisterna_project ON public.mantenimiento_cisterna(project_id);
CREATE INDEX IF NOT EXISTS idx_cisterna_fecha   ON public.mantenimiento_cisterna(fecha DESC);
