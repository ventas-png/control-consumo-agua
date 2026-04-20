-- Condominios Fase 19
-- Tablas: checklist_areas, programacion_limpieza, consumo_energia_areas, historial_residentes

-- ── checklist_areas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklist_areas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  area        text        NOT NULL,
  fecha       date        NOT NULL DEFAULT CURRENT_DATE,
  inspector   text,
  items       jsonb       NOT NULL DEFAULT '[]',
  -- [{item: string, ok: boolean, observacion: string}]
  estado      text        NOT NULL DEFAULT 'pendiente',
  -- 'completo' | 'con_observaciones' | 'pendiente'
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.checklist_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_areas_select" ON public.checklist_areas FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "checklist_areas_insert" ON public.checklist_areas FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "checklist_areas_update" ON public.checklist_areas FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "checklist_areas_delete" ON public.checklist_areas FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_checklist_areas_project ON public.checklist_areas(project_id);
CREATE INDEX IF NOT EXISTS idx_checklist_areas_fecha   ON public.checklist_areas(fecha DESC);

-- ── programacion_limpieza ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.programacion_limpieza (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  area                text        NOT NULL,
  frecuencia          text        NOT NULL DEFAULT 'semanal',
  -- 'diaria' | 'semanal' | 'quincenal' | 'mensual'
  responsable         text,
  ultima_ejecucion    date,
  proxima_ejecucion   date,
  estado              text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'en_curso' | 'completado'
  activo              boolean     NOT NULL DEFAULT true,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.programacion_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prog_limpieza_select" ON public.programacion_limpieza FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prog_limpieza_insert" ON public.programacion_limpieza FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prog_limpieza_update" ON public.programacion_limpieza FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prog_limpieza_delete" ON public.programacion_limpieza FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_prog_limpieza_project ON public.programacion_limpieza(project_id);

-- ── consumo_energia_areas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consumo_energia_areas (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid         NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid         NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  area             text         NOT NULL,
  tipo             text         NOT NULL DEFAULT 'electricidad',
  -- 'electricidad' | 'agua' | 'gas' | 'otro'
  periodo          text         NOT NULL,
  -- '2026-04'
  lectura_anterior numeric(12,3),
  lectura_actual   numeric(12,3) NOT NULL,
  unidad           text         NOT NULL DEFAULT 'kWh',
  -- 'kWh' | 'm3' | 'galones' | 'otro'
  costo_unitario   numeric(10,4),
  total_costo      numeric(12,2),
  fecha_lectura    date         NOT NULL DEFAULT CURRENT_DATE,
  notas            text,
  created_at       timestamptz  NOT NULL DEFAULT now()
);
ALTER TABLE public.consumo_energia_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consumo_energia_select" ON public.consumo_energia_areas FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "consumo_energia_insert" ON public.consumo_energia_areas FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "consumo_energia_update" ON public.consumo_energia_areas FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "consumo_energia_delete" ON public.consumo_energia_areas FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_consumo_energia_project ON public.consumo_energia_areas(project_id);
CREATE INDEX IF NOT EXISTS idx_consumo_energia_periodo ON public.consumo_energia_areas(periodo DESC);

-- ── historial_residentes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.historial_residentes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id      uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  nombre_completo text       NOT NULL,
  tipo           text        NOT NULL DEFAULT 'arrendatario',
  -- 'propietario' | 'arrendatario' | 'familiar' | 'otro'
  fecha_desde    date        NOT NULL,
  fecha_hasta    date,
  email          text,
  telefono       text,
  estado         text        NOT NULL DEFAULT 'activo',
  -- 'activo' | 'anterior'
  notas          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.historial_residentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "historial_res_select" ON public.historial_residentes FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "historial_res_insert" ON public.historial_residentes FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "historial_res_update" ON public.historial_residentes FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "historial_res_delete" ON public.historial_residentes FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_historial_res_project ON public.historial_residentes(project_id);
CREATE INDEX IF NOT EXISTS idx_historial_res_unidad  ON public.historial_residentes(unidad_id);
