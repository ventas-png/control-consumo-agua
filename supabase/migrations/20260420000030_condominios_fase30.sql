-- Condominios Fase 30
-- Tablas: reglas_mora_config, campanas_cobro, cierres_anuales

-- ── reglas_mora_config ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reglas_mora_config (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre           text        NOT NULL,
  dias_vencimiento int         NOT NULL DEFAULT 30,
  tipo             text        NOT NULL DEFAULT 'porcentaje',
  -- 'porcentaje' | 'monto_fijo'
  valor            numeric(8,4) NOT NULL,
  aplicar_sobre    text        NOT NULL DEFAULT 'saldo_vencido',
  -- 'saldo_vencido' | 'monto_cuota'
  periodo_gracia   int         NOT NULL DEFAULT 0,
  activa           boolean     NOT NULL DEFAULT true,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reglas_mora_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reglas_mora_sel" ON public.reglas_mora_config FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglas_mora_ins" ON public.reglas_mora_config FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglas_mora_upd" ON public.reglas_mora_config FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reglas_mora_del" ON public.reglas_mora_config FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_reglas_mora_project ON public.reglas_mora_config(project_id);

-- ── campanas_cobro ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campanas_cobro (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre               text        NOT NULL,
  mensaje              text        NOT NULL,
  canal                text        NOT NULL DEFAULT 'whatsapp',
  -- 'whatsapp' | 'email' | 'sms'
  estado               text        NOT NULL DEFAULT 'borrador',
  -- 'borrador' | 'enviada' | 'completada'
  total_destinatarios  int         NOT NULL DEFAULT 0,
  enviadas             int         NOT NULL DEFAULT 0,
  fallidas             int         NOT NULL DEFAULT 0,
  criterio_dias_mora   int,
  criterio_monto_min   numeric(12,2),
  enviada_por          text,
  fecha_envio          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.campanas_cobro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campanas_sel" ON public.campanas_cobro FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "campanas_ins" ON public.campanas_cobro FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "campanas_upd" ON public.campanas_cobro FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "campanas_del" ON public.campanas_cobro FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_campanas_project ON public.campanas_cobro(project_id);
CREATE INDEX IF NOT EXISTS idx_campanas_estado  ON public.campanas_cobro(estado);

-- ── cierres_anuales ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cierres_anuales (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id               uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  anio                     int         NOT NULL,
  total_ingresos           numeric(12,2) NOT NULL DEFAULT 0,
  total_egresos            numeric(12,2) NOT NULL DEFAULT 0,
  saldo                    numeric(12,2) NOT NULL DEFAULT 0,
  total_cuotas_generadas   int         NOT NULL DEFAULT 0,
  total_cuotas_cobradas    int         NOT NULL DEFAULT 0,
  tasa_recaudacion         numeric(5,2),
  unidades_morosas         int         NOT NULL DEFAULT 0,
  monto_mora_total         numeric(12,2) NOT NULL DEFAULT 0,
  notas                    text,
  firmado_por              text,
  fecha_cierre             timestamptz,
  estado                   text        NOT NULL DEFAULT 'borrador',
  -- 'borrador' | 'cerrado'
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, anio)
);
ALTER TABLE public.cierres_anuales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cierre_anual_sel" ON public.cierres_anuales FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cierre_anual_ins" ON public.cierres_anuales FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cierre_anual_upd" ON public.cierres_anuales FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cierre_anual_del" ON public.cierres_anuales FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cierre_anual_project ON public.cierres_anuales(project_id);
CREATE INDEX IF NOT EXISTS idx_cierre_anual_anio    ON public.cierres_anuales(anio DESC);
