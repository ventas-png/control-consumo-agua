-- Create contadores table
-- Each meter (contador) belongs to a typology (tipo_agua) and can later be assigned to a client
CREATE TABLE IF NOT EXISTS public.contadores (
  id                uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id        uuid          NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id        uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  numero_serie      text          NOT NULL,
  tipo_agua         text          NOT NULL,
  descripcion       text,
  marca             text,
  modelo            text,
  fecha_instalacion date,
  lectura_inicial   numeric(12,4) NOT NULL DEFAULT 0,
  activo            boolean       NOT NULL DEFAULT true,
  cliente_id        uuid          REFERENCES public.clientes(id) ON DELETE SET NULL,
  tarifa_id         uuid          REFERENCES public.tarifas(id) ON DELETE SET NULL,
  created_at        timestamptz   DEFAULT now(),
  updated_at        timestamptz   DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contadores ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on contadores" ON public.contadores
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

-- company_owner: acceso a contadores de su empresa
CREATE POLICY "company_owner access on contadores" ON public.contadores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = contadores.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = contadores.company_id
    )
  );

-- admin: acceso a contadores de su proyecto
CREATE POLICY "admin access on contadores" ON public.contadores
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = contadores.project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND project_id = contadores.project_id
    )
  );

-- operator: lectura y actualización (puede asignar contadores)
CREATE POLICY "operator access on contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND project_id = contadores.project_id
    )
  );

-- viewer: solo lectura
CREATE POLICY "viewer read contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('viewer', 'visor', 'cliente')
        AND project_id = contadores.project_id
    )
  );
