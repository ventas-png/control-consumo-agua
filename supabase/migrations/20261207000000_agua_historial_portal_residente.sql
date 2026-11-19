-- ============================================================================
-- El residente ve en su portal el historial importado de SUS contadores
-- ============================================================================
-- POR QUÉ. `agua_historial_lecturas` (20261130000000) guarda las lecturas que
-- la empresa llevaba a mano antes de la plataforma. Hasta ahora sólo la leía el
-- personal: el tablero del portal del residente («vs Mes Anterior», «vs Mismo
-- Mes Año Anterior», promedio e historial de consumo) arrancaba en cero aunque
-- su casa tuviera años de historia cargada.
--
-- QUÉ CAMBIA. Sólo la policy de LECTURA: se le agrega la rama del residente
-- (rol `cliente`), con la MISMA regla con la que ya ve sus lecturas en
-- `registros` (`registros_select`): los contadores activos de las unidades
-- activas cuyo cliente es él. La rama del personal queda idéntica.
--
-- QUÉ NO CAMBIA. El residente no escribe (insert/update/delete siguen siendo
-- del personal), no ve el historial de otros residentes ni de contadores que no
-- son suyos, y la tabla sigue sin importes: es consumo, no cobro.
--
-- IMPACTO EN DATOS: ninguno. CÓMO REVERTIR: re-aplicar la policy de
-- 20261130000000 (DROP + CREATE). Idempotente.

DROP POLICY IF EXISTS agua_historial_lecturas_select ON public.agua_historial_lecturas;
CREATE POLICY agua_historial_lecturas_select ON public.agua_historial_lecturas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
      AND (
        (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.tabla.view'))
        OR (SELECT public.user_has_permission('agua.dashboard.view'))
        OR (SELECT public.user_has_permission('agua.contadores.view'))
        OR (SELECT public.user_has_permission('agua.lecturas.create'))
        OR (SELECT public.current_user_role()) = ANY (ARRAY['admin','company_owner','operator','operador'])
      )
    )
    -- El residente: el historial de sus propios contadores, y nada más.
    OR (
      (SELECT public.current_user_role()) = 'cliente'
      AND contador_id IN (
        SELECT c.id
          FROM public.contadores c
          JOIN public.unidades u ON u.id = c.unidad_id
         WHERE u.cliente_id = (SELECT public.get_my_cliente_id())
           AND c.activo = true
           AND u.activo = true
      )
    )
  );
