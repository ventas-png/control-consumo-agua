-- Create unidades table
-- Each project has units (apartments, houses, warehouses, commercial spaces, etc.)
-- Units are later associated with meters (contadores)
CREATE TABLE IF NOT EXISTS public.unidades (
  id                    uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id            uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre                text          NOT NULL,                -- e.g. "Apto 101", "Casa 5", "Local A"
  tipo                  text          NOT NULL DEFAULT 'otro', -- apartamento, casa, bodega, local_comercial, oficina, parqueadero, otro
  descripcion           text,
  piso                  integer,                               -- floor number (nullable)
  area_m2               numeric(10,2),                        -- area in square meters (nullable)
  propietario_nombre    text,
  propietario_telefono  text,
  propietario_email     text,
  activo                boolean       NOT NULL DEFAULT true,
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on unidades" ON public.unidades
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

-- company_owner: acceso a unidades de su empresa
CREATE POLICY "company_owner access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = unidades.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = unidades.company_id
    )
  );

-- admin: acceso total a unidades de su proyecto
CREATE POLICY "admin access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = unidades.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = unidades.project_id
    )
  );

-- operator: solo lectura
CREATE POLICY "operator read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = unidades.project_id
    )
  );

-- viewer: solo lectura
CREATE POLICY "viewer read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('viewer', 'visor', 'cliente')
        AND project_id = unidades.project_id
    )
  );
