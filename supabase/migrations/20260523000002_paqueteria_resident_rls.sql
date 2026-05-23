-- ============================================================
-- Paquetería: acceso de lectura para el residente
-- ============================================================
-- Hasta ahora paquetes_recibidos solo era visible para portería/admin (RBAC por
-- empresa). El residente necesita ver los paquetes dirigidos a SUS unidades para
-- recibir el aviso y firmar la recepción desde su portal.
--
-- Se reemplaza solo la política SELECT, agregando la cláusula de residente con la
-- misma forma canónica usada en tickets_mantenimiento y visitantes
-- (20260519000003_perf_rls_consolidate_policies.sql): el usuario 'cliente' ve las
-- filas cuya unidad pertenece a su cliente_id y está activa.
--
-- INSERT/UPDATE/DELETE NO se tocan: el residente no recibe UPDATE directo. La
-- firma del residente se hace por la función SECURITY DEFINER
-- paquete_firmar_recepcion (migración siguiente), que acota la transición exacta.

DROP POLICY IF EXISTS "paquetes_recibidos_select" ON public.paquetes_recibidos;
CREATE POLICY "paquetes_recibidos_select" ON public.paquetes_recibidos
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.paqueteria'))
    OR (unidad_id IN (
      SELECT unidades.id FROM public.unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM public.app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    ))
  );
