-- Fase 10: Fix Final 3 auth_rls_initplan Warnings (Helper Function Wrapping)
-- Apply (SELECT ...) wrapping to helper function calls
-- Fix remaining 3 warnings in tarifas and conversation_messages tables
-- All changes are performance optimizations with zero functional impact

-- ============================================================
-- Tabla: tarifas - "operator read tarifas" policy
-- Issue: has_role_any() called without (SELECT ...) wrapping
-- ============================================================

DROP POLICY IF EXISTS "operator read tarifas" ON public.tarifas;
CREATE POLICY "operator read tarifas" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    (SELECT has_role_any(ARRAY['operator'::text, 'operador'::text, 'viewer'::text, 'visor'::text, 'user'::text, 'cliente'::text]))
    AND (
      (
        EXISTS (
          SELECT 1 FROM app_users
          WHERE app_users.id = (SELECT auth.uid())
            AND app_users.project_id = tarifas.project_id
        )
      ) OR (
        EXISTS (
          SELECT 1 FROM (app_users u
            JOIN user_project_assignments upa ON (upa.user_id = u.id))
          WHERE u.id = (SELECT auth.uid())
            AND upa.project_id = tarifas.project_id
        )
      )
    )
  );

-- ============================================================
-- Tabla: conversation_messages - "cliente access on conversation_messages" policy
-- Issue: is_user_cliente_with_id() called without (SELECT ...) wrapping
-- ============================================================

DROP POLICY IF EXISTS "cliente access on conversation_messages" ON public.conversation_messages;
CREATE POLICY "cliente access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM (conversations c
        JOIN app_users u ON (u.id = (SELECT auth.uid())))
      WHERE c.id = conversation_messages.conversation_id
        AND (SELECT is_user_cliente_with_id(c.cliente_id))
        AND conversation_messages.is_internal_note = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM (conversations c
        JOIN app_users u ON (u.id = (SELECT auth.uid())))
      WHERE c.id = conversation_messages.conversation_id
        AND (SELECT is_user_cliente_with_id(c.cliente_id))
        AND conversation_messages.is_internal_note = false
    )
  );

-- ============================================================
-- Tabla: conversation_messages - "privileged access on conversation_messages" policy
-- Issue: has_admin_or_owner_access_in_company() called without (SELECT ...) wrapping
-- ============================================================

DROP POLICY IF EXISTS "privileged access on conversation_messages" ON public.conversation_messages;
CREATE POLICY "privileged access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM (conversations c
        JOIN app_users u ON (u.id = (SELECT auth.uid())))
      WHERE c.id = conversation_messages.conversation_id
        AND ((SELECT has_super_admin_access()) OR (SELECT has_admin_or_owner_access_in_company(c.company_id)))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM (conversations c
        JOIN app_users u ON (u.id = (SELECT auth.uid())))
      WHERE c.id = conversation_messages.conversation_id
        AND ((SELECT has_super_admin_access()) OR (SELECT has_admin_or_owner_access_in_company(c.company_id)))
    )
  );

-- ============================================================
-- Nota Final
-- ============================================================
-- Esta migración cubre las 3 advertencias finales de auth_rls_initplan.
-- Se aplica (SELECT ...) wrapping a todas las llamadas de funciones helper.
-- Todas las políticas mantienen lógica idéntica, solo con optimización de performance.
--
-- Beneficio esperado: Eliminación de todas las 58+ advertencias (100% de advertencias resueltas)
-- Review el Performance Advisor después de esta migración para confirmar 0 warnings de auth_rls_initplan.
