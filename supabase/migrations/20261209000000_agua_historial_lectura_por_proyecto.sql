-- ============================================================================
-- Historial importado: el alcance por proyecto se decide una vez, no por fila
-- ============================================================================
-- POR QUÉ. La policy de lectura de `agua_historial_lecturas` llamaba a
-- `can_access_project(project_id)` en CADA fila. Para una cuenta acotada a sus
-- proyectos (operador, administrador de condominio) esa función cuesta ~0,6 ms
-- por fila. El Historial de Lecturas trae el historial de un proyecto en
-- páginas de 1 000 con OFFSET, y la base evalúa la policy sobre todas las filas
-- anteriores a la página: medido en producción, como un operador con acceso a
-- «Viñas del Sur Condominio Fase 2» (19 832 filas), la primera página tarda
-- 0,7 s y la última 11,9 s, contra un `statement_timeout` de 8 s. La consulta
-- se cancelaba y la pantalla mostraba «Sin registros».
--
-- QUÉ CAMBIA. Sólo cómo se escribe el alcance por proyecto en la policy de
-- LECTURA: en vez de la función por fila, `project_id IN (proyectos a los que
-- quien lee tiene acceso)`. La lista se calcula UNA vez por consulta, con la
-- misma función (`can_access_project`) evaluada una vez por proyecto.
--
-- QUÉ NO CAMBIA. Quién lee: el personal de la empresa con permiso de agua, en
-- los proyectos que tiene a su alcance; y el residente, sus propios contadores
-- (rama de 20261207000000, copiada tal cual). La subconsulta lee `projects` con
-- la RLS de quien consulta, que ya exige ese mismo alcance: no abre nada que
-- antes estuviera cerrado. Las policies de escritura no se tocan.
--
-- IMPACTO EN DATOS: ninguno. CÓMO REVERTIR: re-aplicar la policy de
-- 20261207000000 (DROP + CREATE). Idempotente.

DROP POLICY IF EXISTS agua_historial_lecturas_select ON public.agua_historial_lecturas;
CREATE POLICY agua_historial_lecturas_select ON public.agua_historial_lecturas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND project_id IN (
        SELECT p.id
          FROM public.projects p
         WHERE public.can_access_project(p.id)
      )
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
