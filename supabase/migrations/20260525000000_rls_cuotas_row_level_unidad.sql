-- ============================================================================
-- RLS row-level por unidad en cuotas_condominio (cond:C1, F2.4)
-- ============================================================================
-- Defense in depth: agregar rama OR a la policy SELECT de cuotas_condominio
-- para que un cliente residente pueda ver únicamente las cuotas de sus propias
-- unidades, alineando el patrón con tickets_mantenimiento y visitantes (que
-- ya lo hacen así desde 20260512000000~).
--
-- Hoy el rol "Cliente residente" NO tiene el permiso condominios.tab.cuotas
-- (validado vía MCP), por lo que la brecha es teórica. Sin embargo agregamos
-- la rama row-level para:
--   1. Habilitar el caso de uso futuro de "cliente ve sus propias cuotas
--      desde el portal".
--   2. Garantizar que aunque a alguien le sea asignado el permiso por error,
--      el cliente nunca pueda ver cuotas de otras unidades.
--
-- Solo SELECT recibe la rama nueva. INSERT/UPDATE/DELETE permanecen iguales
-- (solo admins/finanzas/junta pueden emitir/modificar/borrar cuotas; el
-- residente no crea sus propias cuotas en este modelo).
--
-- Patrón replica exactamente lo que ya está en tickets_mantenimiento_select
-- y visitantes_select (validado al inspeccionar pg_policy el 2026-05-27).
-- ============================================================================

DROP POLICY IF EXISTS cuotas_condominio_select ON public.cuotas_condominio;

CREATE POLICY cuotas_condominio_select ON public.cuotas_condominio
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      (company_id = get_my_company_id())
      AND user_has_permission('condominios.tab.cuotas')
    )
    OR (
      -- Rama row-level (cond:C1): el cliente residente solo ve cuotas de
      -- las unidades donde está vinculado como cliente activo.
      unidad_id IN (
        SELECT u.id FROM public.unidades u
        WHERE u.cliente_id = (
          SELECT app_users.cliente_id FROM public.app_users
          WHERE app_users.id = (SELECT auth.uid())
        )
        AND u.activo = true
      )
    )
  );
