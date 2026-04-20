-- Fix registros_select RLS: remove 'cliente' from broad admin list and add
-- counter-based fallback so portal clients can see their readings even when
-- cliente_id in registros doesn't match app_users.cliente_id (common in
-- manually imported or legacy data).

DROP POLICY IF EXISTS "registros_select" ON public.registros;

CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    -- Admin/staff roles: see all registros (no company filter needed here,
    -- existing company_id columns and app-level filters handle scoping)
    current_user_role() = ANY(ARRAY[
      'admin','super_admin','superadmin','company_owner',
      'operator','operador','user','viewer','visor'
    ])
    -- Client: primary match by cliente_id
    OR (
      current_user_role() = 'cliente'
      AND cliente_id = (SELECT get_my_cliente_id())
    )
    -- Client: fallback match by counter ownership
    -- Handles cases where cliente_id in registros is null or mismatched
    OR (
      current_user_role() = 'cliente'
      AND contador_id IN (
        SELECT c.id
        FROM public.contadores c
        INNER JOIN public.unidades u ON u.id = c.unidad_id
        WHERE u.cliente_id = (SELECT get_my_cliente_id())
          AND c.activo = true
          AND u.activo = true
      )
    )
  );
