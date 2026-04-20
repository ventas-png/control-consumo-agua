-- Condominios Fase 8
-- Tablas: firmas_digitales, solicitudes_concierge, llaves_condominio, encuestas, respuestas_encuesta

-- ── firmas_digitales ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.firmas_digitales (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  documento_titulo text        NOT NULL,
  documento_tipo   text        NOT NULL DEFAULT 'otro',
  -- tipo: 'contrato' | 'reglamento' | 'acta' | 'aviso' | 'otro'
  firmante_nombre  text,
  firmante_email   text,
  estado           text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'firmado' | 'rechazado' | 'expirado'
  fecha_vencimiento date,
  fecha_firma      timestamptz,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.firmas_digitales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "firmas_select" ON public.firmas_digitales
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "firmas_insert" ON public.firmas_digitales
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "firmas_update" ON public.firmas_digitales
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "firmas_delete" ON public.firmas_digitales
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_firmas_project ON public.firmas_digitales(project_id);
CREATE INDEX IF NOT EXISTS idx_firmas_unidad  ON public.firmas_digitales(unidad_id);
CREATE INDEX IF NOT EXISTS idx_firmas_estado  ON public.firmas_digitales(estado);

-- ── solicitudes_concierge ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solicitudes_concierge (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo             text        NOT NULL DEFAULT 'otro',
  -- tipo: 'taxi' | 'restaurante' | 'tour' | 'compras' | 'mensajeria' | 'limpieza_extra' | 'otro'
  descripcion      text        NOT NULL,
  fecha_solicitud  date        NOT NULL DEFAULT CURRENT_DATE,
  hora_solicitud   time,
  estado           text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'en_proceso' | 'completado' | 'cancelado'
  atendido_por     text,
  costo            numeric(10,2),
  notas_staff      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitudes_concierge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "concierge_select" ON public.solicitudes_concierge
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "concierge_insert" ON public.solicitudes_concierge
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "concierge_update" ON public.solicitudes_concierge
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "concierge_delete" ON public.solicitudes_concierge
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_concierge_project ON public.solicitudes_concierge(project_id);
CREATE INDEX IF NOT EXISTS idx_concierge_unidad  ON public.solicitudes_concierge(unidad_id);
CREATE INDEX IF NOT EXISTS idx_concierge_estado  ON public.solicitudes_concierge(estado);

-- ── llaves_condominio ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.llaves_condominio (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id         uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo              text        NOT NULL DEFAULT 'fisica',
  -- tipo: 'fisica' | 'tarjeta' | 'codigo' | 'app'
  descripcion       text        NOT NULL,
  codigo            text,
  cantidad          int         NOT NULL DEFAULT 1,
  fecha_entrega     date,
  fecha_devolucion  date,
  estado            text        NOT NULL DEFAULT 'activa',
  -- estado: 'activa' | 'devuelta' | 'perdida' | 'bloqueada'
  deposito_pagado   boolean     NOT NULL DEFAULT false,
  monto_deposito    numeric(10,2),
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llaves_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "llaves_select" ON public.llaves_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "llaves_insert" ON public.llaves_condominio
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "llaves_update" ON public.llaves_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "llaves_delete" ON public.llaves_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_llaves_project ON public.llaves_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_llaves_unidad  ON public.llaves_condominio(unidad_id);
CREATE INDEX IF NOT EXISTS idx_llaves_estado  ON public.llaves_condominio(estado);

-- ── encuestas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.encuestas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo      text        NOT NULL,
  descripcion text,
  preguntas   jsonb       NOT NULL DEFAULT '[]',
  -- [{id: string, texto: string, tipo: 'texto'|'rating_5'|'si_no'}]
  fecha_inicio date,
  fecha_fin    date,
  estado       text       NOT NULL DEFAULT 'borrador',
  -- estado: 'borrador' | 'activa' | 'cerrada'
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.encuestas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "encuestas_select" ON public.encuestas
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "encuestas_insert" ON public.encuestas
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "encuestas_update" ON public.encuestas
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "encuestas_delete" ON public.encuestas
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_encuestas_project ON public.encuestas(project_id);
CREATE INDEX IF NOT EXISTS idx_encuestas_estado  ON public.encuestas(estado);

-- ── respuestas_encuesta ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.respuestas_encuesta (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  encuesta_id         uuid        NOT NULL REFERENCES public.encuestas(id) ON DELETE CASCADE,
  unidad_id           uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  nombre_respondente  text,
  respuestas          jsonb       NOT NULL DEFAULT '{}',
  -- {pregunta_id: value}
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.respuestas_encuesta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "respuestas_select" ON public.respuestas_encuesta
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "respuestas_insert" ON public.respuestas_encuesta
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "respuestas_update" ON public.respuestas_encuesta
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "respuestas_delete" ON public.respuestas_encuesta
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_respuestas_encuesta ON public.respuestas_encuesta(encuesta_id);
CREATE INDEX IF NOT EXISTS idx_respuestas_project  ON public.respuestas_encuesta(project_id);
