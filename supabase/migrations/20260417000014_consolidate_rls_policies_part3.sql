-- Part 3: conversation_access_rules, conversation_assignments,
--         conversation_messages, conversations

-- ============================================================
-- conversation_access_rules (2 ALL + 1 SELECT → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "company_owner manages access rules" ON public.conversation_access_rules;
DROP POLICY IF EXISTS "conversation_access_rules_manage" ON public.conversation_access_rules;
DROP POLICY IF EXISTS "agents can read own access rules" ON public.conversation_access_rules;

CREATE POLICY "conv_access_rules_select" ON public.conversation_access_rules
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM app_users WHERE id = (SELECT auth.uid())
        AND company_id = conversation_access_rules.company_id
    )
  );

CREATE POLICY "conv_access_rules_insert" ON public.conversation_access_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "conv_access_rules_update" ON public.conversation_access_rules
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "conv_access_rules_delete" ON public.conversation_access_rules
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

-- ============================================================
-- conversation_assignments (2 ALL + 4 per-cmd → 4 policies)
-- ============================================================
DROP POLICY IF EXISTS "ca_company_admin_all" ON public.conversation_assignments;
DROP POLICY IF EXISTS "ca_super_admin_all" ON public.conversation_assignments;
DROP POLICY IF EXISTS "ca_agent_can_assign_delete" ON public.conversation_assignments;
DROP POLICY IF EXISTS "ca_agent_can_assign_insert" ON public.conversation_assignments;
DROP POLICY IF EXISTS "ca_agent_select" ON public.conversation_assignments;
DROP POLICY IF EXISTS "ca_agent_update_seen" ON public.conversation_assignments;

CREATE POLICY "conv_assignments_select" ON public.conversation_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND (u.role = 'super_admin'
             OR (u.role <> ALL(ARRAY['super_admin','cliente']) AND u.company_id = c.company_id))
    )
  );

CREATE POLICY "conv_assignments_insert" ON public.conversation_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users u
      JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND (u.role = 'super_admin'
             OR (u.role = ANY(ARRAY['company_owner','admin']) AND u.company_id = c.company_id)
             OR (u.role = ANY(ARRAY['operator','collector']) AND u.company_id = c.company_id
                 AND EXISTS (
                   SELECT 1 FROM conversation_access_rules ar
                   WHERE ar.company_id = c.company_id AND ar.role = u.role AND ar.can_assign = true
                 )))
    )
  );

CREATE POLICY "conv_assignments_update" ON public.conversation_assignments
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM app_users u
      JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND (u.role = 'super_admin'
             OR (u.role = ANY(ARRAY['company_owner','admin']) AND u.company_id = c.company_id))
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM app_users u
      JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND (u.role = 'super_admin'
             OR (u.role = ANY(ARRAY['company_owner','admin']) AND u.company_id = c.company_id))
    )
  );

CREATE POLICY "conv_assignments_delete" ON public.conversation_assignments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM app_users u
      JOIN conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = (SELECT auth.uid())
        AND (u.role = 'super_admin'
             OR (u.role = ANY(ARRAY['company_owner','admin']) AND u.company_id = c.company_id)
             OR (u.role = ANY(ARRAY['operator','collector']) AND u.company_id = c.company_id
                 AND EXISTS (
                   SELECT 1 FROM conversation_access_rules ar
                   WHERE ar.company_id = c.company_id AND ar.role = u.role AND ar.can_assign = true
                 )))
    )
  );

-- ============================================================
-- conversation_messages (3 ALL + 3 INSERT + 3 SELECT → 4 policies)
-- Drop old {public} policies; combine {authenticated} ones
-- ============================================================
DROP POLICY IF EXISTS "Agents insert messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "Clients insert messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "Users can insert conversation messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "Agents view company messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "Clients view own messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "Users can view conversation messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "agent access on conversation_messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "cliente access on conversation_messages" ON public.conversation_messages;
DROP POLICY IF EXISTS "privileged access on conversation_messages" ON public.conversation_messages;

CREATE POLICY "conv_messages_select" ON public.conversation_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND (c.company_id = (SELECT get_my_company_id()) OR c.cliente_id = (SELECT get_my_cliente_id()))
    )
  );

CREATE POLICY "conv_messages_insert" ON public.conversation_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND (c.company_id = (SELECT get_my_company_id()) OR c.cliente_id = (SELECT get_my_cliente_id()))
    )
  );

CREATE POLICY "conv_messages_update" ON public.conversation_messages
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      JOIN app_users u ON u.id = (SELECT auth.uid())
      WHERE c.id = conversation_messages.conversation_id
        AND (has_super_admin_access()
             OR has_admin_or_owner_access_in_company(c.company_id)
             OR (u.role = ANY(ARRAY['operator','collector','viewer']) AND u.company_id = c.company_id
                 AND (c.assigned_to = (SELECT auth.uid()) OR EXISTS (
                   SELECT 1 FROM conversation_access_rules r
                   WHERE r.company_id = u.company_id AND r.role = u.role AND r.can_view_all = true
                     AND (r.categories IS NULL OR c.category = ANY(r.categories))
                 )))
             OR is_user_cliente_with_id(c.cliente_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_messages.conversation_id
        AND (c.company_id = (SELECT get_my_company_id()) OR c.cliente_id = (SELECT get_my_cliente_id()))
    )
  );

CREATE POLICY "conv_messages_delete" ON public.conversation_messages
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      JOIN app_users u ON u.id = (SELECT auth.uid())
      WHERE c.id = conversation_messages.conversation_id
        AND (has_super_admin_access() OR has_admin_or_owner_access_in_company(c.company_id))
    )
  );

-- ============================================================
-- conversations (4 ALL + 6 per-cmd → 4 policies)
-- Drop old {public} policies; combine {authenticated} ones
-- ============================================================
DROP POLICY IF EXISTS "admin access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "cliente access on own conversations" ON public.conversations;
DROP POLICY IF EXISTS "company_owner access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "super_admin full access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Clients insert conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents select company conversations" ON public.conversations;
DROP POLICY IF EXISTS "Clients select own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users can view conversations for their company" ON public.conversations;
DROP POLICY IF EXISTS "agent limited access on conversations" ON public.conversations;
DROP POLICY IF EXISTS "Agents update company conversations" ON public.conversations;

CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR has_admin_or_owner_access_in_company(company_id)
    OR (company_id = (SELECT get_my_company_id()))
    OR is_user_cliente_with_id(cliente_id)
    OR (cliente_id = (SELECT get_my_cliente_id()))
    OR EXISTS (
      SELECT 1 FROM app_users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY(ARRAY['operator','collector','viewer'])
        AND u.company_id = conversations.company_id
        AND (conversations.assigned_to = (SELECT auth.uid()) OR EXISTS (
          SELECT 1 FROM conversation_access_rules r
          WHERE r.company_id = u.company_id AND r.role = u.role AND r.can_view_all = true
            AND (r.categories IS NULL OR conversations.category = ANY(r.categories))
        ))
    )
  );

CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    has_super_admin_access()
    OR has_admin_or_owner_access_in_company(company_id)
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','agent'])
        AND company_id = (SELECT get_my_company_id()))
    OR cliente_id = (SELECT get_my_cliente_id())
  );

CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    has_super_admin_access()
    OR has_admin_or_owner_access_in_company(company_id)
    OR company_id IN (SELECT app_users.company_id FROM app_users WHERE id = (SELECT auth.uid()))
    OR is_user_cliente_with_id(cliente_id)
  )
  WITH CHECK (
    has_super_admin_access()
    OR has_admin_or_owner_access_in_company(company_id)
    OR company_id IN (SELECT app_users.company_id FROM app_users WHERE id = (SELECT auth.uid()))
    OR is_user_cliente_with_id(cliente_id)
  );

CREATE POLICY "conversations_delete" ON public.conversations
  FOR DELETE TO authenticated
  USING (
    has_super_admin_access()
    OR has_admin_or_owner_access_in_company(company_id)
  );
