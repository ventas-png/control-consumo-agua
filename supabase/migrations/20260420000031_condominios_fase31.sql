-- Condominios Fase 31
-- Tablas: cobranza_judicial, recibos_digitales, informes_mensuales, sugerencias_condominio

-- ── cobranza_judicial ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cobranza_judicial (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id            uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  etapa                text        NOT NULL DEFAULT 'carta_notarial',
  -- 'carta_notarial' | 'juzgado' | 'sentencia' | 'ejecutado' | 'archivado'
  monto_adeudado       numeric(12,2) NOT NULL DEFAULT 0,
  fecha_inicio         date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_actualizacion  date,
  abogado              text,
  expediente           text,
  notas                text,
  estado               text        NOT NULL DEFAULT 'activo',
  -- 'activo' | 'resuelto' | 'archivado'
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cobranza_judicial ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cob_jud_select" ON public.cobranza_judicial FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cob_jud_insert" ON public.cobranza_judicial FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cob_jud_update" ON public.cobranza_judicial FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cob_jud_delete" ON public.cobranza_judicial FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cob_jud_project ON public.cobranza_judicial(project_id);
CREATE INDEX IF NOT EXISTS idx_cob_jud_unidad  ON public.cobranza_judicial(unidad_id);
CREATE INDEX IF NOT EXISTS idx_cob_jud_estado  ON public.cobranza_judicial(estado);

-- ── recibos_digitales ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recibos_digitales (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id           uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  cuota_id            uuid        REFERENCES public.cuotas_condominio(id)  ON DELETE SET NULL,
  numero_recibo       text        NOT NULL,
  monto               numeric(12,2) NOT NULL,
  concepto            text        NOT NULL,
  fecha_emision       date        NOT NULL DEFAULT CURRENT_DATE,
  enviado_por         text,
  destinatario_email  text,
  destinatario_nombre text,
  estado              text        NOT NULL DEFAULT 'generado',
  -- 'generado' | 'enviado' | 'anulado'
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recibos_digitales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recibo_select" ON public.recibos_digitales FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recibo_insert" ON public.recibos_digitales FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recibo_update" ON public.recibos_digitales FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recibo_delete" ON public.recibos_digitales FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_recibo_project ON public.recibos_digitales(project_id);
CREATE INDEX IF NOT EXISTS idx_recibo_unidad  ON public.recibos_digitales(unidad_id);
CREATE INDEX IF NOT EXISTS idx_recibo_fecha   ON public.recibos_digitales(fecha_emision DESC);

-- ── informes_mensuales ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.informes_mensuales (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  periodo            text        NOT NULL,
  -- 'YYYY-MM'
  total_cuotas       int         NOT NULL DEFAULT 0,
  cuotas_pagadas     int         NOT NULL DEFAULT 0,
  cuotas_morosas     int         NOT NULL DEFAULT 0,
  total_recaudado    numeric(12,2) NOT NULL DEFAULT 0,
  total_gastos       numeric(12,2) NOT NULL DEFAULT 0,
  num_tickets        int         NOT NULL DEFAULT 0,
  tickets_resueltos  int         NOT NULL DEFAULT 0,
  num_visitantes     int         NOT NULL DEFAULT 0,
  num_incidentes     int         NOT NULL DEFAULT 0,
  notas              text,
  firmado_por        text,
  estado             text        NOT NULL DEFAULT 'borrador',
  -- 'borrador' | 'publicado'
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, periodo)
);
ALTER TABLE public.informes_mensuales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "informe_men_select" ON public.informes_mensuales FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "informe_men_insert" ON public.informes_mensuales FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "informe_men_update" ON public.informes_mensuales FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "informe_men_delete" ON public.informes_mensuales FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_informe_men_project ON public.informes_mensuales(project_id);
CREATE INDEX IF NOT EXISTS idx_informe_men_periodo ON public.informes_mensuales(periodo DESC);

-- ── sugerencias_condominio ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sugerencias_condominio (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  categoria        text        NOT NULL DEFAULT 'otro',
  -- 'instalaciones' | 'seguridad' | 'servicios' | 'convivencia' | 'otro'
  titulo           text        NOT NULL,
  descripcion      text        NOT NULL,
  estado           text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'en_revision' | 'respondida' | 'archivada'
  respuesta        text,
  respondido_por   text,
  fecha_respuesta  timestamptz,
  anonima          boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sugerencias_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suger_select" ON public.sugerencias_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "suger_insert" ON public.sugerencias_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "suger_update" ON public.sugerencias_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "suger_delete" ON public.sugerencias_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_suger_project ON public.sugerencias_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_suger_estado  ON public.sugerencias_condominio(estado);
