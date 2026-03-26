-- Create company_clientes junction table
-- Links clients directly to companies for cross-company visibility
-- Enables client onboarding flow: search by CUI/DUI + fecha_nacimiento + email
CREATE TABLE IF NOT EXISTS public.company_clientes (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id  uuid        NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  added_by    uuid        REFERENCES auth.users(id),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (company_id, cliente_id)
);

-- Enable RLS
ALTER TABLE public.company_clientes ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "super_admin full access on company_clientes" ON public.company_clientes
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

-- company_owner: acceso a vinculaciones de su empresa
CREATE POLICY "company_owner access on company_clientes" ON public.company_clientes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = company_clientes.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = company_clientes.company_id
    )
  );

-- admin: acceso a vinculaciones de su empresa
CREATE POLICY "admin access on company_clientes" ON public.company_clientes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND company_id = company_clientes.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND company_id = company_clientes.company_id
    )
  );

-- operator: solo lectura scoped a su empresa
CREATE POLICY "operator read company_clientes" ON public.company_clientes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'user')
        AND company_id = company_clientes.company_id
    )
  );

-- viewer: solo lectura scoped a su empresa
CREATE POLICY "viewer read company_clientes" ON public.company_clientes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('viewer', 'visor', 'cliente')
        AND company_id = company_clientes.company_id
    )
  );

-- ============================================================
-- RPC function: buscar_cliente_para_onboarding
-- Searches the global clientes pool by CUI/DUI + fecha_nacimiento + email
-- Returns match_count (3, 2, or 0) and client info when matched
-- SECURITY DEFINER to bypass company-scoped RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.buscar_cliente_para_onboarding(
  p_cui_dui      text,
  p_fecha_nac    date,
  p_email        text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client   record;
BEGIN
  -- Check 3-of-3 match (exact)
  SELECT id, nombre, cui_dui, fecha_nacimiento, email
    INTO v_client
    FROM clientes
   WHERE cui_dui = p_cui_dui
     AND fecha_nacimiento = p_fecha_nac
     AND lower(email) = lower(p_email)
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'match_count', 3,
      'cliente_id', v_client.id,
      'cliente_nombre', v_client.nombre
    );
  END IF;

  -- Check 2-of-3 matches
  SELECT id, nombre, cui_dui, fecha_nacimiento, email
    INTO v_client
    FROM clientes
   WHERE (
     (cui_dui = p_cui_dui AND fecha_nacimiento = p_fecha_nac) OR
     (cui_dui = p_cui_dui AND lower(email) = lower(p_email)) OR
     (fecha_nacimiento = p_fecha_nac AND lower(email) = lower(p_email))
   )
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'match_count', 2,
      'cliente_id', v_client.id,
      'cliente_nombre', v_client.nombre,
      'mismatched_fields', (
        SELECT jsonb_agg(field) FROM (
          SELECT 'cui_dui' AS field WHERE v_client.cui_dui IS DISTINCT FROM p_cui_dui
          UNION ALL
          SELECT 'fecha_nacimiento' WHERE v_client.fecha_nacimiento IS DISTINCT FROM p_fecha_nac
          UNION ALL
          SELECT 'email' WHERE lower(COALESCE(v_client.email, '')) IS DISTINCT FROM lower(p_email)
        ) sub
      )
    );
  END IF;

  -- 0 or 1 match - client not found
  RETURN jsonb_build_object('match_count', 0, 'cliente_id', NULL);
END;
$$;

-- Index for lookup performance
CREATE INDEX IF NOT EXISTS idx_clientes_onboarding_lookup
  ON public.clientes (cui_dui, fecha_nacimiento);
