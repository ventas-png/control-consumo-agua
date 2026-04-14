-- Create proveedores_energia table
CREATE TABLE IF NOT EXISTS public.proveedores_energia (
  id            uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre        text          NOT NULL,
  nit           text,
  contacto      text,
  tipo          text          NOT NULL CHECK (tipo IN ('distribuidora', 'comercializadora', 'autogeneracion')),
  activo        boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   DEFAULT now(),
  updated_at    timestamptz   DEFAULT now()
);

-- Enable RLS on proveedores_energia
ALTER TABLE public.proveedores_energia ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on proveedores_energia" ON public.proveedores_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  );

-- company_owner: acceso a proveedores de su empresa
CREATE POLICY "company_owner access on proveedores_energia" ON public.proveedores_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = proveedores_energia.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = proveedores_energia.company_id
    )
  );

-- admin: acceso a proveedores de su proyecto
CREATE POLICY "admin access on proveedores_energia" ON public.proveedores_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = proveedores_energia.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = proveedores_energia.project_id
    )
  );

-- operator/viewer: solo lectura
CREATE POLICY "operator read proveedores_energia" ON public.proveedores_energia
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = proveedores_energia.project_id
    )
  );

-- Create tarifas_energia table
CREATE TABLE IF NOT EXISTS public.tarifas_energia (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id            uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  proveedor_id          uuid          NOT NULL REFERENCES public.proveedores_energia(id) ON DELETE CASCADE,
  nombre                text          NOT NULL,
  descripcion           text,
  precio_kwh_energia    numeric(12,6) NOT NULL DEFAULT 0,
  precio_kw_potencia    numeric(12,4) NOT NULL DEFAULT 0,
  cargo_fijo            numeric(12,2) NOT NULL DEFAULT 0,
  alumbrado_publico     numeric(12,4) NOT NULL DEFAULT 0,
  alumbrado_tipo        text          NOT NULL DEFAULT 'fijo' CHECK (alumbrado_tipo IN ('fijo', 'porcentual')),
  iva_porcentaje        numeric(5,2)  NOT NULL DEFAULT 0,
  precio_kwh_exportado  numeric(12,6) NOT NULL DEFAULT 0,
  moneda                text          NOT NULL DEFAULT 'Q',
  activa                boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now()
);

-- Enable RLS on tarifas_energia
ALTER TABLE public.tarifas_energia ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on tarifas_energia" ON public.tarifas_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  );

-- company_owner: acceso a tarifas de su empresa
CREATE POLICY "company_owner access on tarifas_energia" ON public.tarifas_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = tarifas_energia.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = tarifas_energia.company_id
    )
  );

-- admin: acceso a tarifas de su proyecto
CREATE POLICY "admin access on tarifas_energia" ON public.tarifas_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = tarifas_energia.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = tarifas_energia.project_id
    )
  );

-- operator/viewer: solo lectura
CREATE POLICY "operator read tarifas_energia" ON public.tarifas_energia
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = tarifas_energia.project_id
    )
  );

-- Create fuentes_energia table
CREATE TABLE IF NOT EXISTS public.fuentes_energia (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id            uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fuente_agua_id        uuid          NOT NULL REFERENCES public.fuentes_agua(id) ON DELETE CASCADE,
  nombre                text          NOT NULL,
  modo_suministro       text          NOT NULL CHECK (modo_suministro IN ('red', 'solar_autonomo', 'hibrido')),
  proveedor_id          uuid          REFERENCES public.proveedores_energia(id) ON DELETE SET NULL,
  tarifa_id             uuid          REFERENCES public.tarifas_energia(id) ON DELETE SET NULL,
  numero_medidor        text,
  numero_cuenta         text,
  potencia_contratada_kw numeric(10,2),
  capacidad_solar_kwp   numeric(10,2),
  activo                boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now()
);

-- Enable RLS on fuentes_energia
ALTER TABLE public.fuentes_energia ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on fuentes_energia" ON public.fuentes_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  );

-- company_owner: acceso a fuentes de su empresa
CREATE POLICY "company_owner access on fuentes_energia" ON public.fuentes_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = fuentes_energia.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = fuentes_energia.company_id
    )
  );

-- admin: acceso a fuentes de su proyecto
CREATE POLICY "admin access on fuentes_energia" ON public.fuentes_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = fuentes_energia.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = fuentes_energia.project_id
    )
  );

-- operator/viewer: solo lectura
CREATE POLICY "operator read fuentes_energia" ON public.fuentes_energia
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = fuentes_energia.project_id
    )
  );

-- Create facturas_energia table
CREATE TABLE IF NOT EXISTS public.facturas_energia (
  id                        uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id                uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id                uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  fuente_energia_id         uuid          NOT NULL REFERENCES public.fuentes_energia(id) ON DELETE CASCADE,
  proveedor_id              uuid          REFERENCES public.proveedores_energia(id) ON DELETE SET NULL,
  tarifa_id                 uuid          REFERENCES public.tarifas_energia(id) ON DELETE SET NULL,
  numero_factura            text,
  periodo_inicio            date          NOT NULL,
  periodo_fin               date          NOT NULL,
  fecha_emision             date,
  kwh_consumidos            numeric(12,3) NOT NULL DEFAULT 0,
  kwh_generados             numeric(12,3) NOT NULL DEFAULT 0,
  kwh_exportados            numeric(12,3) NOT NULL DEFAULT 0,
  kw_demanda_max            numeric(10,2),
  monto_energia             numeric(12,2) NOT NULL DEFAULT 0,
  monto_potencia            numeric(12,2) NOT NULL DEFAULT 0,
  monto_cargo_fijo          numeric(12,2) NOT NULL DEFAULT 0,
  monto_alumbrado           numeric(12,2) NOT NULL DEFAULT 0,
  monto_iva                 numeric(12,2) NOT NULL DEFAULT 0,
  monto_credito_exportacion numeric(12,2) NOT NULL DEFAULT 0,
  monto_otros               numeric(12,2) NOT NULL DEFAULT 0,
  monto_total               numeric(12,2) NOT NULL DEFAULT 0,
  moneda                    text          NOT NULL DEFAULT 'Q',
  estado                    text          NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagada', 'vencida')),
  fecha_pago                date,
  archivo_factura_url       text,
  notas                     text,
  created_at                timestamptz   DEFAULT now(),
  updated_at                timestamptz   DEFAULT now()
);

-- Enable RLS on facturas_energia
ALTER TABLE public.facturas_energia ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on facturas_energia" ON public.facturas_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role IN ('super_admin', 'superadmin')
    )
  );

-- company_owner: acceso a facturas de su empresa
CREATE POLICY "company_owner access on facturas_energia" ON public.facturas_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = facturas_energia.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = facturas_energia.company_id
    )
  );

-- admin: acceso a facturas de su proyecto
CREATE POLICY "admin access on facturas_energia" ON public.facturas_energia
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = facturas_energia.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = facturas_energia.project_id
    )
  );

-- operator/viewer: solo lectura
CREATE POLICY "operator read facturas_energia" ON public.facturas_energia
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = facturas_energia.project_id
    )
  );

-- Create indexes for performance
CREATE INDEX idx_proveedores_energia_company_id ON public.proveedores_energia(company_id);
CREATE INDEX idx_proveedores_energia_project_id ON public.proveedores_energia(project_id);
CREATE INDEX idx_proveedores_energia_company_activo ON public.proveedores_energia(company_id, activo);

CREATE INDEX idx_tarifas_energia_company_id ON public.tarifas_energia(company_id);
CREATE INDEX idx_tarifas_energia_project_id ON public.tarifas_energia(project_id);
CREATE INDEX idx_tarifas_energia_proveedor_id ON public.tarifas_energia(proveedor_id);
CREATE INDEX idx_tarifas_energia_company_activa ON public.tarifas_energia(company_id, activa);

CREATE INDEX idx_fuentes_energia_company_id ON public.fuentes_energia(company_id);
CREATE INDEX idx_fuentes_energia_project_id ON public.fuentes_energia(project_id);
CREATE INDEX idx_fuentes_energia_fuente_agua_id ON public.fuentes_energia(fuente_agua_id);
CREATE INDEX idx_fuentes_energia_proveedor_id ON public.fuentes_energia(proveedor_id);

CREATE INDEX idx_facturas_energia_company_id ON public.facturas_energia(company_id);
CREATE INDEX idx_facturas_energia_project_id ON public.facturas_energia(project_id);
CREATE INDEX idx_facturas_energia_fuente_energia_id ON public.facturas_energia(fuente_energia_id);
CREATE INDEX idx_facturas_energia_fuente_periodo ON public.facturas_energia(fuente_energia_id, periodo_fin DESC);
CREATE INDEX idx_facturas_energia_company_estado ON public.facturas_energia(company_id, estado);
