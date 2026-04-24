-- Condominios Fase 23
-- Tablas: cargos_adicionales_unidad, programa_actividades, registro_autoridades, notas_admin

-- ── cargos_adicionales_unidad ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cargos_adicionales_unidad (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id       uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  concepto        text        NOT NULL,
  categoria       text        NOT NULL DEFAULT 'otro',
  -- 'reparacion' | 'exceso_consumo' | 'dano' | 'servicio' | 'multa' | 'otro'
  monto           numeric(12,2) NOT NULL,
  fecha_cargo     date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento date,
  estado          text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'pagado' | 'anulado'
  referencia      text,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cargos_adicionales_unidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cargos_add_select" ON public.cargos_adicionales_unidad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cargos_add_insert" ON public.cargos_adicionales_unidad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cargos_add_update" ON public.cargos_adicionales_unidad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cargos_add_delete" ON public.cargos_adicionales_unidad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cargos_add_project ON public.cargos_adicionales_unidad(project_id);
CREATE INDEX IF NOT EXISTS idx_cargos_add_unidad  ON public.cargos_adicionales_unidad(unidad_id);
CREATE INDEX IF NOT EXISTS idx_cargos_add_estado  ON public.cargos_adicionales_unidad(estado);

-- ── programa_actividades ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.programa_actividades (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre          text        NOT NULL,
  descripcion     text,
  categoria       text        NOT NULL DEFAULT 'recreativa',
  -- 'recreativa' | 'deportiva' | 'cultural' | 'educativa' | 'salud' | 'otro'
  instructor      text,
  lugar           text,
  fecha_inicio    date        NOT NULL,
  fecha_fin       date,
  hora_inicio     time,
  hora_fin        time,
  dias_semana     text[],
  cupo_maximo     int,
  inscritos       int         NOT NULL DEFAULT 0,
  costo           numeric(10,2) NOT NULL DEFAULT 0,
  estado          text        NOT NULL DEFAULT 'programada',
  -- 'programada' | 'activa' | 'completada' | 'cancelada'
  activo          boolean     NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.programa_actividades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prog_act_select" ON public.programa_actividades FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prog_act_insert" ON public.programa_actividades FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prog_act_update" ON public.programa_actividades FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prog_act_delete" ON public.programa_actividades FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_prog_act_project ON public.programa_actividades(project_id);

-- ── registro_autoridades ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registro_autoridades (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tipo_autoridad  text        NOT NULL DEFAULT 'policia',
  -- 'policia' | 'bomberos' | 'salud' | 'municipalidad' | 'electricidad' | 'agua' | 'otro'
  nombre_institucion text,
  nombre_funcionario text,
  motivo          text        NOT NULL,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  hora_llegada    time,
  hora_salida     time,
  resultado       text,
  -- 'sin_novedad' | 'acta_levantada' | 'sancion' | 'recomendacion' | 'otro'
  documento_referencia text,
  requiere_seguimiento boolean NOT NULL DEFAULT false,
  fecha_seguimiento date,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.registro_autoridades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reg_auto_select" ON public.registro_autoridades FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reg_auto_insert" ON public.registro_autoridades FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reg_auto_update" ON public.registro_autoridades FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reg_auto_delete" ON public.registro_autoridades FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_reg_auto_project ON public.registro_autoridades(project_id);
CREATE INDEX IF NOT EXISTS idx_reg_auto_fecha   ON public.registro_autoridades(fecha DESC);

-- ── notas_admin ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notas_admin (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo          text        NOT NULL,
  contenido       text        NOT NULL,
  categoria       text        NOT NULL DEFAULT 'general',
  -- 'general' | 'urgente' | 'recordatorio' | 'seguimiento' | 'reunion' | 'otro'
  prioridad       text        NOT NULL DEFAULT 'normal',
  -- 'normal' | 'alta' | 'urgente'
  fijada          boolean     NOT NULL DEFAULT false,
  resuelta        boolean     NOT NULL DEFAULT false,
  fecha_recordatorio date,
  autor           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notas_admin ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notas_admin_select" ON public.notas_admin FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "notas_admin_insert" ON public.notas_admin FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "notas_admin_update" ON public.notas_admin FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "notas_admin_delete" ON public.notas_admin FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_notas_admin_project ON public.notas_admin(project_id);
CREATE INDEX IF NOT EXISTS idx_notas_admin_fijada  ON public.notas_admin(fijada DESC);
