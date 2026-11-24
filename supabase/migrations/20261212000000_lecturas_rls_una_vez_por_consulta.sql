-- ============================================================================
-- Lecturas y bitácora: la RLS se calcula una vez por consulta, no por fila
-- ============================================================================
-- POR QUÉ. Las pantallas de agua (Historial, Dashboard, Cobros) dejaron de
-- cargar para las empresas con más datos. La policy de lectura de `registros`
-- llamaba, EN CADA FILA, a `is_super_admin()`, `current_user_role()` (dos
-- veces) y `can_access_project(project_id)`, y la policy restrictiva de MFA a
-- `mfa_requirement_met()`. Son ~0,35 ms por fila; con las 6 833 lecturas de una
-- empresa, 2,4 s por consulta en frío (medido en producción, solo lectura, como
-- su dueña). La pantalla pagina con OFFSET —y la base evalúa la policy sobre
-- todas las filas anteriores a la página—, varias pantallas piden lo mismo a la
-- vez y el rol `authenticated` tiene 8 s de tope: en un día, 231 consultas de
-- `registros` canceladas («statement timeout») y la pantalla sin datos.
-- `bitacora_acciones` tiene el mismo defecto (tres funciones por fila, 2 s de
-- media, 13 cancelaciones el mismo día).
--
-- QUÉ CAMBIA. Sólo la FORMA de tres policies; el alcance es el mismo:
--   1. `registros_select`: las funciones sin argumentos de fila pasan a
--      `(SELECT f())`, que el planificador evalúa una vez por consulta. El
--      alcance por proyecto deja de ser `can_access_project(project_id)` por
--      fila y pasa a la subconsulta de proyectos, que ya existía:
--      `project_id IN (SELECT p.id … AND can_access_project(p.id))`. Es la
--      misma función sobre los mismos proyectos, calculada una vez por
--      proyecto. Para las filas sin proyecto (`project_id IS NULL`),
--      `can_access_project(NULL)` es siempre verdadero, así que esa rama queda
--      igual sin la llamada.
--   2. `mfa_gate_aal2` de `registros`: `(SELECT mfa_requirement_met())`, en
--      USING y en WITH CHECK. La función no depende de la fila.
--   3. `bitacora_acciones_select`: sus tres funciones pasan a `(SELECT f())`.
-- Con la forma nueva la misma consulta de 2,4 s tarda 13 ms y devuelve las
-- mismas 6 833 filas (medido en producción, solo lectura).
--
-- QUÉ NO CAMBIA. Quién ve qué: empresa, permiso, proyecto asignado, residente
-- (sus cobros y los de sus contadores activos), super admin y MFA, idénticos.
-- Las policies de escritura de `registros` y de `bitacora_acciones` no se
-- tocan. Las demás tablas con `mfa_gate_aal2` tampoco (no son las que fallan).
--
-- IMPACTO EN DATOS: ninguno. CÓMO REVERTIR: re-aplicar `registros_select` de
-- 20260815000000, `mfa_gate_aal2` de 20260717020000 y la policy anterior de
-- `bitacora_acciones` (DROP + CREATE). Idempotente.

-- ── 1. registros · lectura ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "registros_select" ON public.registros;
CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      (
        (SELECT public.user_has_permission('agua.tabla.view'))
        OR (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.dashboard.view'))
        OR (SELECT public.user_has_permission('agua.cobros.view'))
        OR (SELECT public.user_has_permission('agua.mapa.view'))
      )
      AND (SELECT public.get_my_company_id()) IS NOT NULL
      AND (
        project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.company_id = (SELECT public.get_my_company_id())
            AND public.can_access_project(p.id)
        )
        -- Sin proyecto sellado: ambigua, no ajena (can_access_project(NULL) es
        -- siempre verdadero); la acota la empresa del cliente.
        OR (project_id IS NULL AND cliente_id IN (
          SELECT cc.cliente_id FROM public.company_clientes cc
          WHERE cc.company_id = (SELECT public.get_my_company_id())
        ))
      )
    )
    -- El residente: sus cobros y los de sus contadores activos.
    OR (
      (SELECT public.current_user_role()) = 'cliente'
      AND registros.cliente_id = (SELECT public.get_my_cliente_id())
    )
    OR (
      (SELECT public.current_user_role()) = 'cliente'
      AND contador_id IN (
        SELECT c.id FROM public.contadores c
        JOIN public.unidades u ON u.id = c.unidad_id
        WHERE u.cliente_id = (SELECT public.get_my_cliente_id())
          AND c.activo = true
          AND u.activo = true
      )
    )
  );

-- ── 2. registros · MFA ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS mfa_gate_aal2 ON public.registros;
CREATE POLICY mfa_gate_aal2 ON public.registros
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.mfa_requirement_met()))
  WITH CHECK ((SELECT public.mfa_requirement_met()));

-- ── 3. bitácora de acciones · lectura ───────────────────────────────────────
DROP POLICY IF EXISTS bitacora_acciones_select ON public.bitacora_acciones;
CREATE POLICY bitacora_acciones_select ON public.bitacora_acciones
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      bitacora_acciones.company_id = (SELECT public.get_my_company_id())
      AND (SELECT public.user_has_permission('condominios.tab.bitacora_acciones'))
    )
  );
