-- Seguridad RBAC: quitar la rama suelta `company_id = get_my_company_id()` de las
-- policies de solicitud_renta_unidad / solicitud_mudanza_unidad.
--
-- HALLAZGO (recon del repunte #588): la consolidación 20260519000003 dejó en las
-- policies SELECT/INSERT/UPDATE de ambas tablas una rama `OR company_id =
-- get_my_company_id()` SIN chequeo de permiso, además de la rama gated
-- `(company_id = get_my_company_id() AND user_has_permission('condominios.tab.
-- solicitudes_*'))`. La rama suelta hace REDUNDANTE el gate RBAC: cualquier staff
-- del tenant (operator, viewer, roles custom) puede ver, crear y EDITAR
-- solicitudes sin tener el permiso. Verificado en prod: 3 usuarios staff (2
-- operator + 1 viewer) hoy pasan solo por la rama suelta.
--
-- FIX: recrear las 6 policies sin la rama suelta, preservando EXACTAMENTE el
-- resto (texto tomado de pg_policies en prod):
--   • is_super_admin()
--   • staff gated: company_id = get_my_company_id() AND user_has_permission(...)
--     (user_has_permission ya devuelve true incondicional para company_owner/
--     admin/super_admin → owners y admins NO pierden nada)
--   • ramas del residente intactas: mudanza usa mis_unidades_ids() (#588, ya en
--     prod); renta mantiene el EXISTS solo-dueño (decisión de producto).
-- DELETE no se toca (ya estaba correctamente acotado a owner/admin).
--
-- CAMBIO DE CONDUCTA (deseado): operator/viewer/custom SIN el permiso RBAC dejan
-- de ver/crear/editar solicitudes. Si un operador debe gestionarlas, se le asigna
-- el permiso por rol (UI de roles) — ese es el modelo RBAC del resto del módulo.
-- Validado contra prod vía BEGIN…ROLLBACK. Apply por el gate humano P0 #9.

-- ── solicitud_mudanza_unidad ────────────────────────────────────────────────
DROP POLICY IF EXISTS "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR unidad_id IN (SELECT public.mis_unidades_ids())
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR (
          estado = 'pendiente'
          AND unidad_id IN (SELECT public.mis_unidades_ids())
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_mudanza_unidad_update" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_update" ON public.solicitud_mudanza_unidad
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
  );

-- ── solicitud_renta_unidad ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR EXISTS (
          SELECT 1 FROM public.unidades u
          WHERE u.id = solicitud_renta_unidad.unidad_id
            AND u.cliente_id = public.get_my_cliente_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR (
          estado = 'pendiente'
          AND EXISTS (
            SELECT 1 FROM public.unidades u
            WHERE u.id = solicitud_renta_unidad.unidad_id
              AND u.cliente_id = public.get_my_cliente_id()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
  );
