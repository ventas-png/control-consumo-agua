-- Condominios Fase 14
-- Tablas: correspondencia_condominio, libro_novedades, seguimiento_acuerdos

-- ── correspondencia_condominio ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.correspondencia_condominio (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  tipo          text        NOT NULL DEFAULT 'entrada',
  -- 'entrada' | 'salida'
  categoria     text        NOT NULL DEFAULT 'carta',
  -- 'carta' | 'notificacion_legal' | 'factura' | 'circular' | 'otro'
  asunto        text        NOT NULL,
  remitente     text,
  destinatario  text,
  fecha         date        NOT NULL DEFAULT CURRENT_DATE,
  numero_guia   text,
  prioridad     text        NOT NULL DEFAULT 'normal',
  -- 'normal' | 'urgente'
  estado        text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'atendido' | 'archivado'
  observaciones text,
  unidad_id     uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.correspondencia_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "correspondencia_select" ON public.correspondencia_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "correspondencia_insert" ON public.correspondencia_condominio
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "correspondencia_update" ON public.correspondencia_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "correspondencia_delete" ON public.correspondencia_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_correspondencia_project ON public.correspondencia_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_correspondencia_fecha   ON public.correspondencia_condominio(fecha DESC);

-- ── libro_novedades ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.libro_novedades (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)   ON DELETE CASCADE,
  fecha         date        NOT NULL DEFAULT CURRENT_DATE,
  turno         text        NOT NULL DEFAULT 'mañana',
  -- 'mañana' | 'tarde' | 'noche'
  responsable   text        NOT NULL,
  hora_inicio   time,
  hora_fin      time,
  novedades     text        NOT NULL,
  incidentes    jsonb       NOT NULL DEFAULT '[]',
  -- [{hora: text, descripcion: text, tipo: text}]
  firmado       boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.libro_novedades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "novedades_select" ON public.libro_novedades
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "novedades_insert" ON public.libro_novedades
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "novedades_update" ON public.libro_novedades
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "novedades_delete" ON public.libro_novedades
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_libro_project ON public.libro_novedades(project_id);
CREATE INDEX IF NOT EXISTS idx_libro_fecha   ON public.libro_novedades(fecha DESC);

-- ── seguimiento_acuerdos ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seguimiento_acuerdos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id)   ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)    ON DELETE CASCADE,
  acta_id             uuid        REFERENCES public.actas_reunion(id)        ON DELETE SET NULL,
  titulo              text        NOT NULL,
  descripcion         text,
  responsable         text,
  fecha_limite        date,
  estado              text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'en_proceso' | 'cumplido' | 'vencido' | 'cancelado'
  notas_seguimiento   text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.seguimiento_acuerdos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acuerdos_select" ON public.seguimiento_acuerdos
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "acuerdos_insert" ON public.seguimiento_acuerdos
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "acuerdos_update" ON public.seguimiento_acuerdos
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "acuerdos_delete" ON public.seguimiento_acuerdos
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_acuerdos_project ON public.seguimiento_acuerdos(project_id);
CREATE INDEX IF NOT EXISTS idx_acuerdos_acta    ON public.seguimiento_acuerdos(acta_id);
