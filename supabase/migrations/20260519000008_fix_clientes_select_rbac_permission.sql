-- ============================================================
-- Fix: gate clientes SELECT on the RBAC permission, not legacy role
-- ============================================================
-- The previous clientes_select policy granted read access to a hardcoded
-- list of legacy roles that included 'viewer'/'visor'. That let any viewer
-- (e.g. the "Visualizador Plataforma" marker role, which has NO RBAC
-- permissions) read ALL of their company's clients, exposing PII
-- (DPI/identificación, dirección, fecha de nacimiento, email, teléfono).
--
-- New policy aligns with the RBAC model used by the condominios tables:
--   * super_admin  -> all clients (global)
--   * cliente      -> only their own record
--   * everyone else-> only their company's clients, AND only if they hold
--                     the 'platform.clientes.view' permission
--                     (user_has_permission auto-grants company_owner/admin;
--                      Operador/Admin Plataforma grant it explicitly).
-- Roles without that permission (viewer/visor "Visualizador Plataforma")
-- no longer see clients. Company scoping (cross-company isolation) preserved.

DROP POLICY IF EXISTS "clientes_select" ON public.clientes;

CREATE POLICY "clientes_select" ON public.clientes
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = 'cliente' AND id = (SELECT get_my_cliente_id()))
    OR (
      (SELECT public.user_has_permission('platform.clientes.view'))
      AND EXISTS (
        SELECT 1 FROM public.company_clientes cc
        WHERE cc.cliente_id = clientes.id
          AND cc.company_id = (SELECT get_my_company_id())
      )
    )
  );
