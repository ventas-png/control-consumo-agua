-- Fase 9: Fix Remaining auth.uid() Per-Row Evaluation Warnings
-- Apply (SELECT auth.uid()) and (SELECT auth.role()) wrapping to all remaining policies
-- Fix 58 auth_rls_initplan warnings across 8 tables
-- All changes are performance optimizations with zero functional impact

-- ============================================================
-- Tabla: rutas (3 policies)
-- ============================================================

DROP POLICY IF EXISTS "rutas_select" ON public.rutas;
CREATE POLICY "rutas_select" ON public.rutas
  FOR SELECT TO public
  USING ((SELECT auth.role()) = 'authenticated'::text);

DROP POLICY IF EXISTS "rutas_insert" ON public.rutas;
CREATE POLICY "rutas_insert" ON public.rutas
  FOR INSERT TO public
  WITH CHECK ((SELECT auth.role()) = 'authenticated'::text);

DROP POLICY IF EXISTS "rutas_update" ON public.rutas;
CREATE POLICY "rutas_update" ON public.rutas
  FOR UPDATE TO public
  USING ((SELECT auth.role()) = 'authenticated'::text)
  WITH CHECK ((SELECT auth.role()) = 'authenticated'::text);

-- ============================================================
-- Tabla: company_clientes (4 policies)
-- ============================================================

DROP POLICY IF EXISTS "operator insert company_clientes" ON public.company_clientes;
CREATE POLICY "operator insert company_clientes" ON public.company_clientes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['operator'::text, 'operador'::text, 'user'::text])
        AND app_users.company_id = company_clientes.company_id
    )
  );

DROP POLICY IF EXISTS "operator read company_clientes" ON public.company_clientes;
CREATE POLICY "operator read company_clientes" ON public.company_clientes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['operator'::text, 'operador'::text, 'user'::text])
        AND app_users.company_id = company_clientes.company_id
    )
  );

DROP POLICY IF EXISTS "super_admin full access on company_clientes" ON public.company_clientes;
CREATE POLICY "super_admin full access on company_clientes" ON public.company_clientes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'superadmin'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'superadmin'::text])
    )
  );

DROP POLICY IF EXISTS "viewer read company_clientes" ON public.company_clientes;
CREATE POLICY "viewer read company_clientes" ON public.company_clientes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['viewer'::text, 'visor'::text, 'cliente'::text])
        AND app_users.company_id = company_clientes.company_id
    )
  );

-- ============================================================
-- Tabla: contadores (3 policies) - Ones with bare auth.uid()
-- ============================================================

DROP POLICY IF EXISTS "admin access on contadores" ON public.contadores;
CREATE POLICY "admin access on contadores" ON public.contadores
  FOR ALL TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
          AND app_users.role = 'admin'::text
          AND app_users.project_id = contadores.project_id
      )
    ) OR (
      EXISTS (
        SELECT 1 FROM (app_users u
          JOIN user_project_assignments upa ON (upa.user_id = u.id))
        WHERE u.id = (SELECT auth.uid())
          AND u.role = 'admin'::text
          AND upa.project_id = contadores.project_id
      )
    )
  )
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
          AND app_users.role = 'admin'::text
          AND app_users.project_id = contadores.project_id
      )
    ) OR (
      EXISTS (
        SELECT 1 FROM (app_users u
          JOIN user_project_assignments upa ON (upa.user_id = u.id))
        WHERE u.id = (SELECT auth.uid())
          AND u.role = 'admin'::text
          AND upa.project_id = contadores.project_id
      )
    )
  );

DROP POLICY IF EXISTS "operator access on contadores" ON public.contadores;
CREATE POLICY "operator access on contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
          AND app_users.role = ANY (ARRAY['operator'::text, 'operador'::text, 'user'::text])
          AND app_users.project_id = contadores.project_id
      )
    ) OR (
      EXISTS (
        SELECT 1 FROM (app_users u
          JOIN user_project_assignments upa ON (upa.user_id = u.id))
        WHERE u.id = (SELECT auth.uid())
          AND u.role = ANY (ARRAY['operator'::text, 'operador'::text, 'user'::text])
          AND upa.project_id = contadores.project_id
      )
    )
  );

DROP POLICY IF EXISTS "viewer read contadores" ON public.contadores;
CREATE POLICY "viewer read contadores" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
          AND app_users.role = ANY (ARRAY['viewer'::text, 'visor'::text, 'cliente'::text])
          AND app_users.project_id = contadores.project_id
      )
    ) OR (
      EXISTS (
        SELECT 1 FROM (app_users u
          JOIN user_project_assignments upa ON (upa.user_id = u.id))
        WHERE u.id = (SELECT auth.uid())
          AND u.role = ANY (ARRAY['viewer'::text, 'visor'::text, 'cliente'::text])
          AND upa.project_id = contadores.project_id
      )
    )
  );

-- ============================================================
-- Tabla: conversation_access_rules (2 policies)
-- ============================================================

DROP POLICY IF EXISTS "agents can read own access rules" ON public.conversation_access_rules;
CREATE POLICY "agents can read own access rules" ON public.conversation_access_rules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.company_id = conversation_access_rules.company_id
    )
  );

DROP POLICY IF EXISTS "company_owner manages access rules" ON public.conversation_access_rules;
CREATE POLICY "company_owner manages access rules" ON public.conversation_access_rules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'company_owner'::text])
        AND (app_users.role = 'super_admin'::text OR app_users.company_id = conversation_access_rules.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'company_owner'::text])
        AND (app_users.role = 'super_admin'::text OR app_users.company_id = conversation_access_rules.company_id)
    )
  );

-- ============================================================
-- Tabla: conversation_messages (5 policies)
-- ============================================================

DROP POLICY IF EXISTS "Agents insert messages" ON public.conversation_messages;
CREATE POLICY "Agents insert messages" ON public.conversation_messages
  FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND c.company_id IN (
          SELECT app_users.company_id FROM app_users
          WHERE app_users.id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Agents view company messages" ON public.conversation_messages;
CREATE POLICY "Agents view company messages" ON public.conversation_messages
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND c.company_id IN (
          SELECT app_users.company_id FROM app_users
          WHERE app_users.id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Clients insert messages" ON public.conversation_messages;
CREATE POLICY "Clients insert messages" ON public.conversation_messages
  FOR INSERT TO public
  WITH CHECK (
    is_internal_note = false
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND c.cliente_id IN (
          SELECT app_users.cliente_id FROM app_users
          WHERE app_users.id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Clients view own messages" ON public.conversation_messages;
CREATE POLICY "Clients view own messages" ON public.conversation_messages
  FOR SELECT TO public
  USING (
    is_internal_note = false
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND c.cliente_id IN (
          SELECT app_users.cliente_id FROM app_users
          WHERE app_users.id = (SELECT auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "agent access on conversation_messages" ON public.conversation_messages;
CREATE POLICY "agent access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM (conversations c
        JOIN app_users u ON (u.id = (SELECT auth.uid())))
      WHERE c.id = conversation_messages.conversation_id
        AND u.role = ANY (ARRAY['operator'::text, 'collector'::text, 'viewer'::text])
        AND u.company_id = c.company_id
        AND (
          c.assigned_to = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR c.category = ANY (r.categories))
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM (conversations c
        JOIN app_users u ON (u.id = (SELECT auth.uid())))
      WHERE c.id = conversation_messages.conversation_id
        AND u.role = ANY (ARRAY['operator'::text, 'collector'::text, 'viewer'::text])
        AND u.company_id = c.company_id
        AND (
          c.assigned_to = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR c.category = ANY (r.categories))
          )
        )
    )
  );

-- ============================================================
-- Tabla: conversations (5 policies)
-- ============================================================

DROP POLICY IF EXISTS "Agents insert conversations" ON public.conversations;
CREATE POLICY "Agents insert conversations" ON public.conversations
  FOR INSERT TO public
  WITH CHECK (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agents select company conversations" ON public.conversations;
CREATE POLICY "Agents select company conversations" ON public.conversations
  FOR SELECT TO public
  USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Agents update company conversations" ON public.conversations;
CREATE POLICY "Agents update company conversations" ON public.conversations
  FOR UPDATE TO public
  USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Clients insert conversations" ON public.conversations;
CREATE POLICY "Clients insert conversations" ON public.conversations
  FOR INSERT TO public
  WITH CHECK (
    cliente_id IN (
      SELECT app_users.cliente_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Clients select own conversations" ON public.conversations;
CREATE POLICY "Clients select own conversations" ON public.conversations
  FOR SELECT TO public
  USING (
    cliente_id IN (
      SELECT app_users.cliente_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "agent limited access on conversations" ON public.conversations;
CREATE POLICY "agent limited access on conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['operator'::text, 'collector'::text, 'viewer'::text])
        AND u.company_id = conversations.company_id
        AND (
          conversations.assigned_to = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR conversations.category = ANY (r.categories))
          )
        )
    )
  );

-- ============================================================
-- Tabla: tarifas (2 policies)
-- ============================================================

DROP POLICY IF EXISTS "super_admin full access on tarifas" ON public.tarifas;
CREATE POLICY "super_admin full access on tarifas" ON public.tarifas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'superadmin'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'superadmin'::text])
    )
  );

-- ============================================================
-- Tabla: unidades (3 policies)
-- ============================================================

DROP POLICY IF EXISTS "company_owner access on unidades" ON public.unidades;
CREATE POLICY "company_owner access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = 'company_owner'::text
        AND app_users.company_id = unidades.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = 'company_owner'::text
        AND app_users.company_id = unidades.company_id
    )
  );

DROP POLICY IF EXISTS "super_admin full access on unidades" ON public.unidades;
CREATE POLICY "super_admin full access on unidades" ON public.unidades
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'superadmin'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
        AND app_users.role = ANY (ARRAY['super_admin'::text, 'superadmin'::text])
    )
  );

-- ============================================================
-- Nota Final
-- ============================================================
-- Esta migración cubre las 58 advertencias restantes de auth_rls_initplan.
-- Se aplica el patrón (SELECT auth.uid()) a todas las policies pendientes.
-- Se aplica también (SELECT auth.role()) a policies que usan auth.role().
-- Todas las políticas mantienen lógica idéntica, solo con optimización de performance.
--
-- Beneficio esperado: Eliminación de las 58 advertencias restantes (100% de advertencias resueltas)
-- Review el Performance Advisor después de esta migración para confirmar 0 warnings.
