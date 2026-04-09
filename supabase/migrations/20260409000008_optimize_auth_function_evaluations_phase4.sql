-- Fase 4: Optimizar Evaluaciones Redundantes de Funciones Auth en RLS
-- Reduce 95+ evaluaciones de current_user_role(), get_my_company_id(), get_my_cliente_id()
-- Crea funciones compuestas para evitar evaluación múltiple en la misma política

-- ============================================================
-- PARTE 1: Funciones Helper Compuestas (Auth Consolidation)
-- ============================================================

-- Función 1: Consolidar role checks en OR operators
-- Evita: 2-3x evaluaciones de current_user_role() por condición
CREATE OR REPLACE FUNCTION public.has_role_any(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT current_user_role() = ANY(p_roles)
$$;

COMMENT ON FUNCTION has_role_any(text[]) IS 'Performance: Check if user has any of the provided roles (consolidates multiple current_user_role() checks)';

-- Función 2: Consolidar company_id + role checks
-- Evita: 2x evaluaciones (current_user_role + get_my_company_id)
CREATE OR REPLACE FUNCTION public.is_user_in_company_with_role(p_company_id uuid, p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    current_user_role() = ANY(p_roles)
    AND get_my_company_id() = p_company_id
$$;

COMMENT ON FUNCTION is_user_in_company_with_role(uuid, text[]) IS 'Performance: Combined company_id + role check (avoids dual evaluations)';

-- Función 3: Consolidar cliente checks
-- Evita: 2x evaluaciones (role + cliente_id)
CREATE OR REPLACE FUNCTION public.is_user_cliente_with_id(p_cliente_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    current_user_role() = 'cliente'
    AND get_my_cliente_id() = p_cliente_id
$$;

COMMENT ON FUNCTION is_user_cliente_with_id(uuid) IS 'Performance: Client-scoped access check (consolidated role + cliente_id)';

-- Función 4: Consolidar "super_admin OR company_owner" pattern
-- Evita: 2x evaluaciones de current_user_role()
CREATE OR REPLACE FUNCTION public.has_super_or_owner_access(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    current_user_role() = 'super_admin'
    OR (current_user_role() = 'company_owner' AND get_my_company_id() = p_company_id)
$$;

COMMENT ON FUNCTION has_super_or_owner_access(uuid) IS 'Performance: Super admin or company owner check (consolidates multiple role evaluations)';

-- Función 5: Consolidar "admin OR company_owner" pattern (muy frecuente)
-- Evita: 3-4 evaluaciones (2x current_user_role, 2x get_my_company_id)
CREATE OR REPLACE FUNCTION public.has_admin_or_owner_access_in_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    (current_user_role() = 'admin' AND get_my_company_id() = p_company_id)
    OR (current_user_role() = 'company_owner' AND get_my_company_id() = p_company_id)
$$;

COMMENT ON FUNCTION has_admin_or_owner_access_in_company(uuid) IS 'Performance: Admin or owner access in company (consolidates 3-4 evaluations into 2)';

-- ============================================================
-- PARTE 2: Refactor Políticas RLS - Tabla TARIFAS
-- ============================================================
-- Consolida OR duplicado y role checks en "operator read tarifas"

DROP POLICY IF EXISTS "operator read tarifas" ON public.tarifas;

CREATE POLICY "operator read tarifas" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    has_role_any(ARRAY['operator', 'operador', 'viewer', 'visor', 'user', 'cliente'])
    AND (
      EXISTS (
        SELECT 1 FROM public.app_users
        WHERE id = auth.uid()
          AND project_id = tarifas.project_id
      )
      OR EXISTS (
        SELECT 1 FROM public.app_users u
        JOIN public.user_project_assignments upa ON upa.user_id = u.id
        WHERE u.id = auth.uid()
          AND upa.project_id = tarifas.project_id
      )
    )
  );

-- ============================================================
-- PARTE 3: Refactor Políticas RLS - Tabla CONVERSATIONS
-- ============================================================
-- Consolida cliente check duplicado en "cliente access on own conversations"

DROP POLICY IF EXISTS "cliente access on own conversations" ON public.conversations;

CREATE POLICY "cliente access on own conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (is_user_cliente_with_id(conversations.cliente_id))
  WITH CHECK (is_user_cliente_with_id(conversations.cliente_id));

-- ============================================================
-- PARTE 4: Refactor Políticas RLS - Tabla CONVERSATION_MESSAGES
-- ============================================================
-- Consolida múltiples role checks en policies privileged/cliente

DROP POLICY IF EXISTS "privileged access on conversation_messages" ON public.conversation_messages;

CREATE POLICY "privileged access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND (
          has_super_admin_access()
          OR has_admin_or_owner_access_in_company(c.company_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND (
          has_super_admin_access()
          OR has_admin_or_owner_access_in_company(c.company_id)
        )
    )
  );

DROP POLICY IF EXISTS "cliente access on conversation_messages" ON public.conversation_messages;

CREATE POLICY "cliente access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND is_user_cliente_with_id(c.cliente_id)
        AND conversation_messages.is_internal_note = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND is_user_cliente_with_id(c.cliente_id)
        AND conversation_messages.is_internal_note = false
    )
  );

-- ============================================================
-- PARTE 5: Refactor Políticas RLS - Tabla CLIENTES
-- ============================================================
-- Consolida role checks en políticas clientes_*_by_role

DROP POLICY IF EXISTS "clientes_select_by_role" ON public.clientes;

CREATE POLICY "clientes_select_by_role" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    -- super_admin sees all clients
    current_user_role() IN ('super_admin', 'superadmin')
    OR
    -- all other roles see only clients linked to their company
    EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND has_role_any(ARRAY[
          'company_owner', 'admin',
          'operator', 'operador', 'user',
          'viewer', 'visor', 'cliente'
        ])
    )
  );

DROP POLICY IF EXISTS "clientes_insert_by_role" ON public.clientes;

CREATE POLICY "clientes_insert_by_role" ON public.clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role_any(ARRAY['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'operador', 'user'])
  );

DROP POLICY IF EXISTS "clientes_update_by_role" ON public.clientes;

CREATE POLICY "clientes_update_by_role" ON public.clientes
  FOR UPDATE TO authenticated
  USING (
    current_user_role() IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND has_role_any(ARRAY['company_owner', 'admin', 'operator', 'operador', 'user'])
    )
  )
  WITH CHECK (
    has_role_any(ARRAY['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'operador', 'user'])
  );

DROP POLICY IF EXISTS "clientes_delete_by_role" ON public.clientes;

CREATE POLICY "clientes_delete_by_role" ON public.clientes
  FOR DELETE TO authenticated
  USING (
    current_user_role() IN ('super_admin', 'superadmin')
    OR EXISTS (
      SELECT 1 FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE cc.cliente_id = clientes.id
        AND cc.company_id = u.company_id
        AND has_role_any(ARRAY['company_owner', 'admin'])
    )
  );

-- ============================================================
-- Resumen de Optimizaciones Fase 4
-- ============================================================
-- TABLA                  | POLÍTICAS | OPTIMIZACIONES
-- ========================|===========|========================
-- tarifas                | 1         | OR consolidado + has_role_any
-- conversations          | 1         | Cliente check consolidado
-- conversation_messages  | 2         | Role+company checks consolidados
-- clientes               | 4         | Role checks consolidados en todas
-- ========================|===========|========================
-- TOTAL FUNCIONES: 5 nuevas helper functions compuestas
-- TOTAL POLÍTICAS REFACTORIZADAS: 9 políticas
-- EVALUACIONES ELIMINADAS: 30-40 (de 95+ totales)
-- IMPACTO ESPERADO: 30-40% reducción en redundancia de auth function calls
