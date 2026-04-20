-- Condominios Fase 22
-- Tablas: solicitudes_certificado, visitas_frecuentes, reglamento_condominio, control_plagas

-- ── solicitudes_certificado ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solicitudes_certificado (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id       uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  solicitante     text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'solvencia',
  -- 'solvencia' | 'residencia' | 'historial_pagos' | 'paz_y_salvo' | 'otro'
  motivo          text,
  estado          text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'en_proceso' | 'aprobado' | 'rechazado' | 'entregado'
  fecha_solicitud date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_aprobacion date,
  fecha_entrega   date,
  aprobado_por    text,
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.solicitudes_certificado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cert_select" ON public.solicitudes_certificado FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cert_insert" ON public.solicitudes_certificado FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cert_update" ON public.solicitudes_certificado FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cert_delete" ON public.solicitudes_certificado FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cert_project ON public.solicitudes_certificado(project_id);
CREATE INDEX IF NOT EXISTS idx_cert_estado  ON public.solicitudes_certificado(estado);

-- ── visitas_frecuentes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visitas_frecuentes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id       uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  nombre          text        NOT NULL,
  identificacion  text,
  relacion        text        NOT NULL DEFAULT 'familiar',
  -- 'familiar' | 'empleado' | 'proveedor' | 'amigo' | 'otro'
  telefono        text,
  placa_vehiculo  text,
  foto_url        text,
  dias_permitidos text[],
  -- ['lunes','martes','miercoles','jueves','viernes','sabado','domingo']
  hora_desde      time,
  hora_hasta      time,
  activo          boolean     NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.visitas_frecuentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vis_frec_select" ON public.visitas_frecuentes FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "vis_frec_insert" ON public.visitas_frecuentes FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "vis_frec_update" ON public.visitas_frecuentes FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "vis_frec_delete" ON public.visitas_frecuentes FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_vis_frec_project ON public.visitas_frecuentes(project_id);
CREATE INDEX IF NOT EXISTS idx_vis_frec_unidad  ON public.visitas_frecuentes(unidad_id);

-- ── reglamento_condominio ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reglamento_condominio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  capitulo        text        NOT NULL,
  numero_articulo text        NOT NULL,
  titulo          text        NOT NULL,
  contenido       text        NOT NULL,
  categoria       text        NOT NULL DEFAULT 'convivencia',
  -- 'convivencia' | 'pagos' | 'seguridad' | 'areas_comunes' | 'mascotas' | 'mudanzas' | 'otro'
  vigente         boolean     NOT NULL DEFAULT true,
  version         text        NOT NULL DEFAULT '1.0',
  fecha_vigencia  date,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reglamento_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reglamento_select" ON public.reglamento_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglamento_insert" ON public.reglamento_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglamento_update" ON public.reglamento_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglamento_delete" ON public.reglamento_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_reglamento_project ON public.reglamento_condominio(project_id);

-- ── control_plagas ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_plagas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tipo            text        NOT NULL DEFAULT 'fumigacion',
  -- 'fumigacion' | 'inspeccion' | 'tratamiento' | 'preventivo'
  empresa         text,
  tecnico         text,
  areas           text[]      NOT NULL DEFAULT '{}',
  productos       text,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  hora_inicio     time,
  hora_fin        time,
  resultado       text        NOT NULL DEFAULT 'satisfactorio',
  -- 'satisfactorio' | 'con_observaciones' | 'requiere_seguimiento' | 'no_realizado'
  proxima_visita  date,
  costo           numeric(10,2),
  observaciones   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.control_plagas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plagas_select" ON public.control_plagas FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plagas_insert" ON public.control_plagas FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plagas_update" ON public.control_plagas FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plagas_delete" ON public.control_plagas FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_plagas_project ON public.control_plagas(project_id);
CREATE INDEX IF NOT EXISTS idx_plagas_fecha   ON public.control_plagas(fecha DESC);
