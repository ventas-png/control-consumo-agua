-- Performance fix: envolver llamadas a funciones STABLE en (SELECT ...) para
-- las políticas RLS de `registros`, replicando el patrón aplicado al resto
-- del esquema en 20260518000003_perf_rls_initplan_wrap.sql y
-- 20260519000003_perf_rls_consolidate_policies.sql.
--
-- Síntoma en producción: GET /rest/v1/registros?select=*&order=fecha.desc
-- &limit=5000 devuelve HTTP 500 con "canceling statement due to statement
-- timeout" de forma intermitente, dejando el dashboard del Admin de Empresa
-- sin datos de lecturas (0 m³, 0 lecturas). EXPLAIN ANALYZE muestra que
-- current_user_role() se invoca 4 veces por fila al recorrer las ~4.5k
-- filas que sobreviven al filtro del índice idx_registros_fecha_desc; bajo
-- cache fría o contención esto excede el statement_timeout de PostgREST.
--
-- Aunque current_user_role(), get_my_company_id() y get_my_cliente_id()
-- están marcadas STABLE SECURITY DEFINER, Postgres no garantiza un solo
-- cómputo por consulta cuando aparecen directamente en USING/CHECK. El
-- patrón recomendado es (SELECT fn()), que fuerza un InitPlan único.
--
-- Referencia oficial:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Esta migración NO cambia la semántica de las políticas, solo el plan de
-- ejecución.

DROP POLICY IF EXISTS "registros_select" ON public.registros;
CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    (SELECT current_user_role()) = ANY(ARRAY['super_admin','superadmin'])
    OR (
      (SELECT current_user_role()) = 'company_owner'
      AND (SELECT get_my_company_id()) IS NOT NULL
      AND (
        project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.company_id = (SELECT get_my_company_id())
        )
        OR (
          project_id IS NULL
          AND cliente_id IN (
            SELECT cc.cliente_id FROM public.company_clientes cc
            WHERE cc.company_id = (SELECT get_my_company_id())
          )
        )
      )
    )
    OR (SELECT current_user_role()) = ANY(ARRAY['admin','operator','operador','user','viewer','visor'])
    OR (
      (SELECT current_user_role()) = 'cliente'
      AND cliente_id = (SELECT get_my_cliente_id())
    )
    -- Cliente: fallback por contador cuando cliente_id quedó nulo o desalineado
    -- (registros importados manualmente o datos legacy). Se conserva la lógica
    -- añadida en 20260420000023_fix_registros_cliente_portal_access.sql.
    OR (
      (SELECT current_user_role()) = 'cliente'
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

DROP POLICY IF EXISTS "registros_update" ON public.registros;
CREATE POLICY "registros_update" ON public.registros
  FOR UPDATE TO authenticated
  USING (
    (SELECT current_user_role()) = ANY(ARRAY['admin','super_admin','superadmin','company_owner','operator','operador'])
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros.project_id
    )
  );

DROP POLICY IF EXISTS "registros_delete" ON public.registros;
CREATE POLICY "registros_delete" ON public.registros
  FOR DELETE TO authenticated
  USING (
    (SELECT current_user_role()) = ANY(ARRAY['admin','super_admin','superadmin','company_owner'])
    OR EXISTS (
      SELECT 1 FROM public.user_project_assignments upa
      WHERE upa.user_id = (SELECT auth.uid())
        AND upa.project_id = registros.project_id
    )
  );
