-- Condominios Fase 12
-- Tablas: actas_reunion, cierres_mensuales, reglas_notificacion, medidores_unidad

-- ── actas_reunion ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.actas_reunion (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo          text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'ordinaria',
  -- 'ordinaria' | 'extraordinaria' | 'junta' | 'comite' | 'otro'
  fecha           date        NOT NULL,
  hora_inicio     time,
  hora_fin        time,
  lugar           text,
  quorum          int,
  quorum_requerido int,
  asistentes      jsonb       NOT NULL DEFAULT '[]',
  -- [{nombre, unidad, rol}]
  orden_del_dia   jsonb       NOT NULL DEFAULT '[]',
  -- [{punto, descripcion, acuerdo}]
  acuerdos        text,
  observaciones   text,
  redactada_por   text,
  aprobada        boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.actas_reunion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "actas_select" ON public.actas_reunion
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "actas_insert" ON public.actas_reunion
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "actas_update" ON public.actas_reunion
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "actas_delete" ON public.actas_reunion
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_actas_project ON public.actas_reunion(project_id);
CREATE INDEX IF NOT EXISTS idx_actas_fecha   ON public.actas_reunion(fecha DESC);

-- ── cierres_mensuales ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cierres_mensuales (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  periodo               text        NOT NULL,          -- '2026-04'
  total_cuotas_emitidas numeric(14,2) NOT NULL DEFAULT 0,
  total_cuotas_cobradas numeric(14,2) NOT NULL DEFAULT 0,
  total_gastos          numeric(14,2) NOT NULL DEFAULT 0,
  saldo_periodo         numeric(14,2) NOT NULL DEFAULT 0,
  unidades_morosas      int         NOT NULL DEFAULT 0,
  notas                 text,
  cerrado_por           text,
  estado                text        NOT NULL DEFAULT 'borrador',
  -- 'borrador' | 'cerrado'
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, periodo)
);

ALTER TABLE public.cierres_mensuales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cierres_select" ON public.cierres_mensuales
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cierres_insert" ON public.cierres_mensuales
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "cierres_update" ON public.cierres_mensuales
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "cierres_delete" ON public.cierres_mensuales
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_cierres_project ON public.cierres_mensuales(project_id);
CREATE INDEX IF NOT EXISTS idx_cierres_periodo  ON public.cierres_mensuales(periodo DESC);

-- ── reglas_notificacion ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reglas_notificacion (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre          text        NOT NULL,
  evento          text        NOT NULL,
  -- 'cuota_pendiente' | 'cuota_morosa' | 'visita_registrada' | 'ticket_abierto'
  -- 'ticket_resuelto' | 'reserva_confirmada' | 'alerta_activa' | 'solicitud_nueva'
  canal           text        NOT NULL DEFAULT 'email',
  -- 'email' | 'whatsapp' | 'push' | 'sms'
  destinatario    text        NOT NULL DEFAULT 'admin',
  -- 'admin' | 'residente' | 'ambos'
  dias_anticipacion int       DEFAULT 0,
  activo          boolean     NOT NULL DEFAULT true,
  mensaje_template text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reglas_notificacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reglas_select" ON public.reglas_notificacion
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglas_insert" ON public.reglas_notificacion
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "reglas_update" ON public.reglas_notificacion
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "reglas_delete" ON public.reglas_notificacion
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_reglas_project ON public.reglas_notificacion(project_id);

-- ── medidores_unidad ──────────────────────────────────────────────────────────
-- Vincula contadores del sistema de agua a unidades del condominio
CREATE TABLE IF NOT EXISTS public.medidores_unidad (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id     uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  contador_id   uuid        NOT NULL REFERENCES public.contadores(id) ON DELETE CASCADE,
  activo        boolean     NOT NULL DEFAULT true,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidad_id, contador_id)
);

ALTER TABLE public.medidores_unidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "medidores_unidad_select" ON public.medidores_unidad
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "medidores_unidad_insert" ON public.medidores_unidad
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "medidores_unidad_update" ON public.medidores_unidad
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "medidores_unidad_delete" ON public.medidores_unidad
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_medidores_unidad_project  ON public.medidores_unidad(project_id);
CREATE INDEX IF NOT EXISTS idx_medidores_unidad_unidad   ON public.medidores_unidad(unidad_id);
CREATE INDEX IF NOT EXISTS idx_medidores_unidad_contador ON public.medidores_unidad(contador_id);
