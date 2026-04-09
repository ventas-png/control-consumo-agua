-- Fase 3: Refactor Completo de Políticas RLS
-- Simplificación usando funciones helper optimizadas

-- ============================================================
-- PARTE 1: Funciones Helper Adicionales (company-scoped)
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_super_admin_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT current_user_role() = 'super_admin'
$$;

CREATE OR REPLACE FUNCTION public.has_company_owner_company_access(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT 
    current_user_role() = 'company_owner'
    AND get_my_company_id() = p_company_id
$$;

CREATE OR REPLACE FUNCTION public.has_admin_company_access(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT 
    current_user_role() = 'admin'
    AND get_my_company_id() = p_company_id
$$;

COMMENT ON FUNCTION has_super_admin_access() IS 'Performance: Check if user is super_admin (avoids duplicate current_user_role() calls)';
COMMENT ON FUNCTION has_company_owner_company_access(uuid) IS 'Performance: Combined company_owner + company_id check';
COMMENT ON FUNCTION has_admin_company_access(uuid) IS 'Performance: Combined admin + company_id check';

-- ============================================================
-- PARTE 2: Refactor Políticas RLS - Tabla CONTADORES
-- ============================================================

DROP POLICY IF EXISTS "operator insert contadores" ON public.contadores;
DROP POLICY IF EXISTS "operator update contadores" ON public.contadores;
DROP POLICY IF EXISTS "operator read contadores" ON public.contadores;

CREATE POLICY "operator insert contadores" ON public.contadores
  FOR INSERT TO authenticated
  WITH CHECK (has_operator_project_access(contadores.project_id));

CREATE POLICY "operator update contadores" ON public.contadores
  FOR UPDATE TO authenticated
  USING (has_operator_project_access(contadores.project_id))
  WITH CHECK (has_operator_project_access(contadores.project_id));

CREATE POLICY "operator read contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (has_operator_project_access(contadores.project_id));

-- ============================================================
-- PARTE 3: Refactor Políticas RLS - Tabla UNIDADES
-- ============================================================

DROP POLICY IF EXISTS "admin access on unidades" ON public.unidades;
DROP POLICY IF EXISTS "operator read unidades" ON public.unidades;
DROP POLICY IF EXISTS "operator insert unidades" ON public.unidades;
DROP POLICY IF EXISTS "operator update unidades" ON public.unidades;
DROP POLICY IF EXISTS "viewer read unidades" ON public.unidades;

CREATE POLICY "admin access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (has_admin_project_access(unidades.project_id))
  WITH CHECK (has_admin_project_access(unidades.project_id));

CREATE POLICY "operator read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (has_operator_project_access(unidades.project_id));

CREATE POLICY "operator insert unidades" ON public.unidades
  FOR INSERT TO authenticated
  WITH CHECK (has_operator_project_access(unidades.project_id));

CREATE POLICY "operator update unidades" ON public.unidades
  FOR UPDATE TO authenticated
  USING (has_operator_project_access(unidades.project_id))
  WITH CHECK (has_operator_project_access(unidades.project_id));

CREATE POLICY "viewer read unidades" ON public.unidades
  FOR SELECT TO authenticated
  USING (has_viewer_project_access(unidades.project_id));

-- ============================================================
-- PARTE 4: Refactor Políticas RLS - Tabla TARIFAS
-- ============================================================

DROP POLICY IF EXISTS "admin access on tarifas" ON public.tarifas;
DROP POLICY IF EXISTS "operator read tarifas" ON public.tarifas;

CREATE POLICY "admin access on tarifas" ON public.tarifas
  FOR ALL TO authenticated
  USING (has_admin_project_access(tarifas.project_id))
  WITH CHECK (has_admin_project_access(tarifas.project_id));

CREATE POLICY "operator read tarifas" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND project_id = tarifas.project_id
    )
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      JOIN public.user_project_assignments upa ON upa.user_id = u.id
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'operador', 'viewer', 'visor', 'user', 'cliente')
        AND upa.project_id = tarifas.project_id
    )
  );

-- ============================================================
-- PARTE 5: Refactor Políticas RLS - Tabla CONVERSATIONS
-- ============================================================

DROP POLICY IF EXISTS "super_admin full access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "company_owner access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "admin access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "cliente access on own conversations" ON public.conversations;

CREATE POLICY "super_admin full access on conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (has_super_admin_access())
  WITH CHECK (has_super_admin_access());

CREATE POLICY "company_owner access on conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (has_company_owner_company_access(conversations.company_id))
  WITH CHECK (has_company_owner_company_access(conversations.company_id));

CREATE POLICY "admin access on conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (has_admin_company_access(conversations.company_id))
  WITH CHECK (has_admin_company_access(conversations.company_id));

CREATE POLICY "cliente access on own conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'cliente' AND cliente_id = conversations.cliente_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'cliente' AND cliente_id = conversations.cliente_id
    )
  );

-- ============================================================
-- PARTE 6: Refactor Políticas RLS - Tabla CONVERSATION_MESSAGES
-- ============================================================

DROP POLICY IF EXISTS "privileged access on conversation_messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "cliente access on conversation_messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "agent access on conversation_messages" ON public.conversation_messages;

CREATE POLICY "privileged access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND (
          u.role = 'super_admin'
          OR (u.role IN ('company_owner', 'admin') AND u.company_id = c.company_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND (
          u.role = 'super_admin'
          OR (u.role IN ('company_owner', 'admin') AND u.company_id = c.company_id)
        )
    )
  );

CREATE POLICY "cliente access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role = 'cliente'
        AND u.cliente_id = c.cliente_id
        AND conversation_messages.is_internal_note = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role = 'cliente'
        AND u.cliente_id = c.cliente_id
        AND conversation_messages.is_internal_note = false
    )
  );

CREATE POLICY "agent access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role IN ('operator', 'collector', 'viewer')
        AND u.company_id = c.company_id
        AND (
          c.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR c.category = ANY(r.categories))
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role IN ('operator', 'collector', 'viewer')
        AND u.company_id = c.company_id
        AND (
          c.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR c.category = ANY(r.categories))
          )
        )
    )
  );
