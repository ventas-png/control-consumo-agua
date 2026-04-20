-- Condominios Fase 9
-- Tablas: gastos_condominio, presupuesto_condominio, alertas_condominio

-- ── gastos_condominio ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gastos_condominio (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  concepto         text        NOT NULL,
  categoria        text        NOT NULL DEFAULT 'otros',
  -- 'mantenimiento' | 'servicios' | 'administrativo' | 'seguridad' | 'limpieza' | 'obras' | 'otros'
  monto            numeric(12,2) NOT NULL,
  fecha            date        NOT NULL,
  proveedor_nombre text,
  estado           text        NOT NULL DEFAULT 'pagado',
  -- 'pendiente' | 'pagado' | 'anulado'
  metodo_pago      text,
  -- 'efectivo' | 'transferencia' | 'cheque' | 'tarjeta' | 'otro'
  comprobante_num  text,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gastos_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gastos_select" ON public.gastos_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gastos_insert" ON public.gastos_condominio
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gastos_update" ON public.gastos_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "gastos_delete" ON public.gastos_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_gastos_project  ON public.gastos_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha    ON public.gastos_condominio(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_categoria ON public.gastos_condominio(categoria);
CREATE INDEX IF NOT EXISTS idx_gastos_estado   ON public.gastos_condominio(estado);

-- ── presupuesto_condominio ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presupuesto_condominio (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  anio                int         NOT NULL,
  categoria           text        NOT NULL,
  monto_presupuestado numeric(14,2) NOT NULL,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, anio, categoria)
);

ALTER TABLE public.presupuesto_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "presupuesto_select" ON public.presupuesto_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "presupuesto_insert" ON public.presupuesto_condominio
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "presupuesto_update" ON public.presupuesto_condominio
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "presupuesto_delete" ON public.presupuesto_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_presupuesto_project ON public.presupuesto_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_presupuesto_anio    ON public.presupuesto_condominio(anio);

-- ── alertas_condominio ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alertas_condominio (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tipo             text        NOT NULL DEFAULT 'aviso',
  -- 'vencimiento' | 'recordatorio' | 'aviso' | 'urgente'
  titulo           text        NOT NULL,
  descripcion      text,
  fecha_alerta     date        NOT NULL,
  estado           text        NOT NULL DEFAULT 'activa',
  -- 'activa' | 'resuelta' | 'ignorada'
  referencia_tabla text,
  referencia_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alertas_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alertas_select" ON public.alertas_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "alertas_insert" ON public.alertas_condominio
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "alertas_update" ON public.alertas_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "alertas_delete" ON public.alertas_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_alertas_project ON public.alertas_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_alertas_fecha   ON public.alertas_condominio(fecha_alerta);
CREATE INDEX IF NOT EXISTS idx_alertas_estado  ON public.alertas_condominio(estado);
