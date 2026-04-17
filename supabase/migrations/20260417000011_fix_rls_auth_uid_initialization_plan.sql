-- Fix Auth RLS Initialization Plan warnings: wrap bare auth.uid() in (SELECT auth.uid())
-- This caches the value per query instead of re-evaluating it for every row.

-- ============================================================
-- company_clientes
-- ============================================================
DROP POLICY IF EXISTS "staff_company_clientes_update" ON public.company_clientes;
CREATE POLICY "staff_company_clientes_update" ON public.company_clientes
  FOR UPDATE USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- broadcast_recipients
-- ============================================================
DROP POLICY IF EXISTS "staff_recipients_select" ON public.broadcast_recipients;
CREATE POLICY "staff_recipients_select" ON public.broadcast_recipients
  FOR SELECT USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "staff_recipients_update" ON public.broadcast_recipients;
CREATE POLICY "staff_recipients_update" ON public.broadcast_recipients
  FOR UPDATE USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "staff_recipients_delete" ON public.broadcast_recipients;
CREATE POLICY "staff_recipients_delete" ON public.broadcast_recipients
  FOR DELETE USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "staff_recipients_insert" ON public.broadcast_recipients;
CREATE POLICY "staff_recipients_insert" ON public.broadcast_recipients
  FOR INSERT WITH CHECK (
    broadcast_id IN (
      SELECT broadcasts.id FROM broadcasts
      WHERE broadcasts.company_id IN (
        SELECT app_users.company_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "cliente_recipients_select" ON public.broadcast_recipients;
CREATE POLICY "cliente_recipients_select" ON public.broadcast_recipients
  FOR SELECT USING (
    cliente_id IN (
      SELECT company_clientes.cliente_id FROM company_clientes
      WHERE company_clientes.company_id IN (
        SELECT app_users.company_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "cliente_recipients_update" ON public.broadcast_recipients;
CREATE POLICY "cliente_recipients_update" ON public.broadcast_recipients
  FOR UPDATE USING (
    cliente_id IN (
      SELECT company_clientes.cliente_id FROM company_clientes
      WHERE company_clientes.company_id IN (
        SELECT app_users.company_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
    )
  );

-- ============================================================
-- conversation_assignments
-- ============================================================
DROP POLICY IF EXISTS "ca_agent_can_assign_delete" ON public.conversation_assignments;
CREATE POLICY "ca_agent_can_assign_delete" ON public.conversation_assignments
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM app_users u
        JOIN conversations c ON c.id = conversation_assignments.conversation_id
        JOIN conversation_access_rules ar ON ar.company_id = c.company_id AND ar.role = u.role
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY(ARRAY['operator','collector'])
        AND u.company_id = c.company_id
        AND ar.can_assign = true
    )
  );

DROP POLICY IF EXISTS "ca_agent_can_assign_insert" ON public.conversation_assignments;
CREATE POLICY "ca_agent_can_assign_insert" ON public.conversation_assignments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
        JOIN conversations c ON c.id = conversation_assignments.conversation_id
        JOIN conversation_access_rules ar ON ar.company_id = c.company_id AND ar.role = u.role
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY(ARRAY['operator','collector'])
        AND u.company_id = c.company_id
        AND ar.can_assign = true
    )
  );

DROP POLICY IF EXISTS "ca_agent_select" ON public.conversation_assignments;
CREATE POLICY "ca_agent_select" ON public.conversation_assignments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM app_users u
        JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND u.role <> ALL(ARRAY['super_admin','cliente'])
        AND u.company_id = c.company_id
    )
  );

DROP POLICY IF EXISTS "ca_agent_update_seen" ON public.conversation_assignments;
CREATE POLICY "ca_agent_update_seen" ON public.conversation_assignments
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "ca_company_admin_all" ON public.conversation_assignments;
CREATE POLICY "ca_company_admin_all" ON public.conversation_assignments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM app_users u
        JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY(ARRAY['company_owner','admin'])
        AND u.company_id = c.company_id
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
        JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY(ARRAY['company_owner','admin'])
        AND u.company_id = c.company_id
    )
  );

DROP POLICY IF EXISTS "ca_super_admin_all" ON public.conversation_assignments;
CREATE POLICY "ca_super_admin_all" ON public.conversation_assignments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users u WHERE u.id = (SELECT auth.uid()) AND u.role = 'super_admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users u WHERE u.id = (SELECT auth.uid()) AND u.role = 'super_admin')
  );

-- ============================================================
-- facturas_energia
-- ============================================================
DROP POLICY IF EXISTS "company_owner access on facturas_energia" ON public.facturas_energia;
CREATE POLICY "company_owner access on facturas_energia" ON public.facturas_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = facturas_energia.company_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = facturas_energia.company_id)
  );

DROP POLICY IF EXISTS "super_admin full access on facturas_energia" ON public.facturas_energia;
CREATE POLICY "super_admin full access on facturas_energia" ON public.facturas_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  );

-- ============================================================
-- fuentes_energia
-- ============================================================
DROP POLICY IF EXISTS "company_owner access on fuentes_energia" ON public.fuentes_energia;
CREATE POLICY "company_owner access on fuentes_energia" ON public.fuentes_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = fuentes_energia.company_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = fuentes_energia.company_id)
  );

DROP POLICY IF EXISTS "super_admin full access on fuentes_energia" ON public.fuentes_energia;
CREATE POLICY "super_admin full access on fuentes_energia" ON public.fuentes_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  );

-- ============================================================
-- proveedores_energia
-- ============================================================
DROP POLICY IF EXISTS "company_owner access on proveedores_energia" ON public.proveedores_energia;
CREATE POLICY "company_owner access on proveedores_energia" ON public.proveedores_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = proveedores_energia.company_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = proveedores_energia.company_id)
  );

DROP POLICY IF EXISTS "super_admin full access on proveedores_energia" ON public.proveedores_energia;
CREATE POLICY "super_admin full access on proveedores_energia" ON public.proveedores_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  );

-- ============================================================
-- tarifas_energia
-- ============================================================
DROP POLICY IF EXISTS "company_owner access on tarifas_energia" ON public.tarifas_energia;
CREATE POLICY "company_owner access on tarifas_energia" ON public.tarifas_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = tarifas_energia.company_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = 'company_owner' AND app_users.company_id = tarifas_energia.company_id)
  );

DROP POLICY IF EXISTS "super_admin full access on tarifas_energia" ON public.tarifas_energia;
CREATE POLICY "super_admin full access on tarifas_energia" ON public.tarifas_energia
  FOR ALL USING (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM app_users WHERE app_users.id = (SELECT auth.uid()) AND app_users.role = ANY(ARRAY['super_admin','superadmin']))
  );
