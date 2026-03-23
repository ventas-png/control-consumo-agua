-- Create tarifas table
CREATE TABLE IF NOT EXISTS public.tarifas (
  id            uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id    uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre        text          NOT NULL,
  descripcion   text,
  tipo_agua     text          NOT NULL,
  precio_m3     numeric(10,4) NOT NULL DEFAULT 0,
  canon_fijo    numeric(10,2) NOT NULL DEFAULT 0,
  activa        boolean       NOT NULL DEFAULT true,
  created_at    timestamptz   DEFAULT now(),
  updated_at    timestamptz   DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.tarifas ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on tarifas" ON public.tarifas
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
CREATE POLICY "company_owner access on tarifas" ON public.tarifas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = tarifas.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = tarifas.company_id
    )
  );

-- admin: acceso a tarifas de su proyecto
CREATE POLICY "admin access on tarifas" ON public.tarifas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = tarifas.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = tarifas.project_id
    )
  );

-- operator/viewer: solo lectura
CREATE POLICY "operator read tarifas" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = tarifas.project_id
    )
  );

-- Add tarifa_id FK to clientes (no-breaking, nullable)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tarifa_id uuid REFERENCES public.tarifas(id) ON DELETE SET NULL;
