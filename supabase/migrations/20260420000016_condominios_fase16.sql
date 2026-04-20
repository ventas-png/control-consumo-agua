-- Condominios Fase 16
-- Tablas: planes_pago_condominio, cuotas_plan_pago,
--         accesos_residentes, garantias_equipo, entrega_unidades

-- ── planes_pago_condominio ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.planes_pago_condominio (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id     uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  concepto      text        NOT NULL,
  monto_total   numeric(12,2) NOT NULL,
  num_cuotas    int         NOT NULL DEFAULT 1,
  monto_cuota   numeric(12,2) NOT NULL,
  fecha_inicio  date        NOT NULL DEFAULT CURRENT_DATE,
  estado        text        NOT NULL DEFAULT 'activo',
  -- 'activo' | 'completado' | 'incumplido' | 'cancelado'
  notas         text,
  aprobado_por  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.planes_pago_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plan_pago_select" ON public.planes_pago_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plan_pago_insert" ON public.planes_pago_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plan_pago_update" ON public.planes_pago_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plan_pago_delete" ON public.planes_pago_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_plan_pago_project  ON public.planes_pago_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_plan_pago_unidad   ON public.planes_pago_condominio(unidad_id);

-- ── cuotas_plan_pago ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cuotas_plan_pago (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id           uuid        NOT NULL REFERENCES public.planes_pago_condominio(id) ON DELETE CASCADE,
  numero            int         NOT NULL,
  monto             numeric(12,2) NOT NULL,
  fecha_vencimiento date        NOT NULL,
  pagado            boolean     NOT NULL DEFAULT false,
  fecha_pago        date,
  comprobante       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, numero)
);
ALTER TABLE public.cuotas_plan_pago ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cuota_plan_select" ON public.cuotas_plan_pago FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cuota_plan_insert" ON public.cuotas_plan_pago FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cuota_plan_update" ON public.cuotas_plan_pago FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cuota_plan_delete" ON public.cuotas_plan_pago FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cuota_plan ON public.cuotas_plan_pago(plan_id);

-- ── accesos_residentes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.accesos_residentes (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id         uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  tipo              text        NOT NULL DEFAULT 'tarjeta',
  -- 'tarjeta' | 'codigo' | 'llave_digital' | 'biometrico'
  identificador     text        NOT NULL,
  titular           text        NOT NULL,
  activo            boolean     NOT NULL DEFAULT true,
  fecha_emision     date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento date,
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.accesos_residentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "accesos_select" ON public.accesos_residentes FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "accesos_insert" ON public.accesos_residentes FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "accesos_update" ON public.accesos_residentes FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "accesos_delete" ON public.accesos_residentes FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_accesos_project ON public.accesos_residentes(project_id);
CREATE INDEX IF NOT EXISTS idx_accesos_unidad  ON public.accesos_residentes(unidad_id);

-- ── garantias_equipo ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.garantias_equipo (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  equipo            text        NOT NULL,
  area              text,
  numero_serie      text,
  proveedor         text,
  contacto_soporte  text,
  fecha_compra      date,
  fecha_vencimiento date,
  monto_compra      numeric(12,2),
  estado            text        NOT NULL DEFAULT 'vigente',
  -- 'vigente' | 'vencida' | 'reclamada' | 'sin_garantia'
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.garantias_equipo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "garantias_select" ON public.garantias_equipo FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "garantias_insert" ON public.garantias_equipo FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "garantias_update" ON public.garantias_equipo FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "garantias_delete" ON public.garantias_equipo FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_garantias_project ON public.garantias_equipo(project_id);

-- ── entrega_unidades ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entrega_unidades (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id             uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  tipo                  text        NOT NULL DEFAULT 'entrega',
  -- 'entrega' | 'devolucion'
  fecha                 date        NOT NULL DEFAULT CURRENT_DATE,
  condicion_general     text        NOT NULL DEFAULT 'buena',
  -- 'excelente' | 'buena' | 'regular' | 'deteriorada'
  inquilino             text,
  propietario           text,
  representante_admin   text,
  observaciones         text,
  inventario_items      jsonb       NOT NULL DEFAULT '[]',
  -- [{item: string, condicion: string, notas: string}]
  firmado_propietario   boolean     NOT NULL DEFAULT false,
  firmado_inquilino     boolean     NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.entrega_unidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entrega_select" ON public.entrega_unidades FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "entrega_insert" ON public.entrega_unidades FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "entrega_update" ON public.entrega_unidades FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "entrega_delete" ON public.entrega_unidades FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_entrega_project ON public.entrega_unidades(project_id);
CREATE INDEX IF NOT EXISTS idx_entrega_unidad  ON public.entrega_unidades(unidad_id);
