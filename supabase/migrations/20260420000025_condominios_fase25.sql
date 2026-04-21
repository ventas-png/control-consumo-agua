-- Condominios Fase 25
-- Tablas: control_generador, control_sistema_incendio, control_camaras_seguridad, lecturas_medidor_gas

-- ── control_generador ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_generador (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  generador       text        NOT NULL DEFAULT 'Generador principal',
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  tipo            text        NOT NULL DEFAULT 'lectura',
  -- 'lectura' | 'mantenimiento' | 'prueba' | 'falla' | 'arranque_emergencia'
  nivel_combustible_pct numeric(5,2),
  horas_operacion numeric(8,2),
  horas_acumuladas numeric(10,2),
  estado          text        NOT NULL DEFAULT 'standby',
  -- 'standby' | 'operando' | 'mantenimiento' | 'falla' | 'apagado'
  voltaje         numeric(7,2),
  frecuencia      numeric(5,2),
  operador        text,
  empresa_servicio text,
  costo           numeric(10,2),
  proximo_mantenimiento date,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.control_generador ENABLE ROW LEVEL SECURITY;
CREATE POLICY "generador_select" ON public.control_generador FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "generador_insert" ON public.control_generador FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "generador_update" ON public.control_generador FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "generador_delete" ON public.control_generador FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_generador_project ON public.control_generador(project_id);
CREATE INDEX IF NOT EXISTS idx_generador_fecha   ON public.control_generador(fecha DESC);

-- ── control_sistema_incendio ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_sistema_incendio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  tipo_sistema    text        NOT NULL DEFAULT 'extintor',
  -- 'extintor' | 'rociador' | 'alarma' | 'hidrant' | 'detector_humo' | 'gabinete' | 'otro'
  identificador   text        NOT NULL,
  -- nombre o código del equipo
  ubicacion       text        NOT NULL,
  tipo_inspeccion text        NOT NULL DEFAULT 'revision_visual',
  -- 'revision_visual' | 'prueba_funcional' | 'recarga' | 'reemplazo' | 'inspeccion_legal'
  resultado       text        NOT NULL DEFAULT 'aprobado',
  -- 'aprobado' | 'observacion' | 'requiere_mantenimiento' | 'fuera_servicio'
  fecha_vencimiento date,
  empresa_servicio text,
  tecnico         text,
  costo           numeric(10,2),
  proxima_inspeccion date,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.control_sistema_incendio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incendio_select" ON public.control_sistema_incendio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "incendio_insert" ON public.control_sistema_incendio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "incendio_update" ON public.control_sistema_incendio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "incendio_delete" ON public.control_sistema_incendio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_incendio_project ON public.control_sistema_incendio(project_id);
CREATE INDEX IF NOT EXISTS idx_incendio_fecha   ON public.control_sistema_incendio(fecha DESC);

-- ── control_camaras_seguridad ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_camaras_seguridad (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  codigo          text        NOT NULL,
  nombre          text        NOT NULL,
  ubicacion       text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'domo',
  -- 'domo' | 'bullet' | 'ptz' | 'fisheye' | 'otro'
  resolucion      text,
  -- '1080p' | '4K' | etc.
  ip_address      text,
  grabacion       boolean     NOT NULL DEFAULT true,
  dias_retencion  int,
  estado          text        NOT NULL DEFAULT 'activa',
  -- 'activa' | 'falla' | 'mantenimiento' | 'sin_señal' | 'inactiva'
  ultimo_mantenimiento date,
  proximo_mantenimiento date,
  observaciones   text,
  activo          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.control_camaras_seguridad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "camaras_select" ON public.control_camaras_seguridad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "camaras_insert" ON public.control_camaras_seguridad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "camaras_update" ON public.control_camaras_seguridad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "camaras_delete" ON public.control_camaras_seguridad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_camaras_project ON public.control_camaras_seguridad(project_id);
CREATE INDEX IF NOT EXISTS idx_camaras_estado  ON public.control_camaras_seguridad(estado);

-- ── lecturas_medidor_gas ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lecturas_medidor_gas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id       uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  area            text,
  -- si no hay unidad_id: 'Área común', 'Cocina comunitaria', etc.
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  lectura_anterior numeric(12,3),
  lectura_actual   numeric(12,3) NOT NULL,
  consumo          numeric(12,3),
  -- calculado: lectura_actual - lectura_anterior
  alerta_fuga     boolean     NOT NULL DEFAULT false,
  costo_unitario  numeric(10,4),
  costo_total     numeric(12,2),
  periodo         text,
  -- '2026-04'
  leido_por       text,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lecturas_medidor_gas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gas_select" ON public.lecturas_medidor_gas FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gas_insert" ON public.lecturas_medidor_gas FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gas_update" ON public.lecturas_medidor_gas FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gas_delete" ON public.lecturas_medidor_gas FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_gas_project ON public.lecturas_medidor_gas(project_id);
CREATE INDEX IF NOT EXISTS idx_gas_unidad  ON public.lecturas_medidor_gas(unidad_id);
CREATE INDEX IF NOT EXISTS idx_gas_fecha   ON public.lecturas_medidor_gas(fecha DESC);
