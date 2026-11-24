-- ============================================================================
-- Contadores y unidades: la RLS de lectura se calcula una vez por consulta
-- ============================================================================
-- POR QUÉ. Después de 20261212000000 (`registros`) las consultas canceladas
-- que quedan son las de `contadores` y `unidades`: 8 de golpe en un minuto
-- («statement timeout», tope de 8 s del rol `authenticated`). Son tablas chicas
-- (747 y 661 filas), pero su policy de lectura llama EN CADA FILA a seis
-- funciones (`has_super_admin_access()`, `has_company_owner_company_access`,
-- `has_admin_project_access`, `has_operator_project_access`,
-- `has_viewer_project_access`, `can_access_project`), cada una con sus propias
-- lecturas de `app_users` y `user_project_assignments`. Medido en producción,
-- solo lectura: 0,4 a 1,1 s por consulta según el rol —y la base evalúa la
-- policy sobre TODAS las filas, vea el usuario 76 o 747—. Varias pantallas las
-- piden a la vez al abrir, y juntas pasan del tope.
--
-- QUÉ CAMBIA. Sólo la FORMA de `contadores_select` y `unidades_select`:
--   · Lo que no depende de la fila pasa a `(SELECT f())`: se evalúa una vez.
--   · Lo que depende del PROYECTO de la fila se calcula una vez por proyecto
--     del usuario y la fila sólo se compara contra ese conjunto. El conjunto
--     sale de `mis_proyectos_asignados()` (nueva): los proyectos del perfil
--     (`app_users.project_id`) y de `user_project_assignments` de quien llama,
--     que es exactamente lo que miran `user_has_project_access` y los
--     `has_*_project_access`. Sobre cada uno se llama a las MISMAS funciones de
--     antes, así que la regla por rol no se reescribe: sólo cambia cuántas
--     veces se evalúa.
--   · `has_company_owner_company_access(company_id)` se abre en sus dos
--     mitades (rol = dueña, misma empresa), que es su cuerpo literal.
-- No se usa la tabla `projects` para el conjunto: su RLS exige además que el
-- proyecto sea de la empresa del perfil, y la regla vigente no lo exige. Así
-- ninguna asignación existente cambia de efecto.
--
-- Con la forma nueva la consulta de contadores pasa de 426–1 078 ms a 2–5 ms,
-- con las mismas filas para dueña, operador, admin y viewer (medido en
-- producción, solo lectura).
--
-- QUÉ NO CAMBIA. Quién ve qué: super admin, dueña, admin/operador/viewer con
-- proyecto asignado, permiso RBAC, filas sin proyecto y residente, idénticos.
-- Las policies de escritura no se tocan.
--
-- `mis_proyectos_asignados()` es SECURITY DEFINER por la misma razón que
-- `user_has_project_access`: no re-entrar en la RLS de `app_users` /
-- `user_project_assignments`. No recibe argumentos y sólo devuelve los
-- proyectos de quien llama. No es ejecutable por anon.
--
-- IMPACTO EN DATOS: ninguno. CÓMO REVERTIR: re-aplicar las dos policies
-- anteriores (DROP + CREATE) y DROP FUNCTION public.mis_proyectos_asignados().
-- Idempotente.

-- ── 1. Los proyectos de quien llama ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mis_proyectos_asignados()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT au.project_id
    FROM public.app_users au
   WHERE au.id = (SELECT auth.uid())
     AND au.project_id IS NOT NULL
  UNION
  SELECT upa.project_id
    FROM public.user_project_assignments upa
   WHERE upa.user_id = (SELECT auth.uid())
$$;

COMMENT ON FUNCTION public.mis_proyectos_asignados() IS
  'Proyectos de quien llama: el de su perfil y los de user_project_assignments. El mismo conjunto que mira user_has_project_access, para compararlo una vez por consulta en vez de por fila.';

REVOKE EXECUTE ON FUNCTION public.mis_proyectos_asignados() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.mis_proyectos_asignados() TO authenticated, service_role;

-- ── 2. contadores · lectura ─────────────────────────────────────────────────
DROP POLICY IF EXISTS contadores_select ON public.contadores;
CREATE POLICY contadores_select ON public.contadores
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_super_admin_access())
    OR (
      (
        -- has_company_owner_company_access(company_id)
        (
          (SELECT public.current_user_role()) = 'company_owner'
          AND contadores.company_id = (SELECT public.get_my_company_id())
        )
        -- has_admin / has_operator / has_viewer _project_access(project_id)
        OR contadores.project_id IN (
          SELECT m.x FROM public.mis_proyectos_asignados() AS m(x)
           WHERE public.has_admin_project_access(m.x)
              OR public.has_operator_project_access(m.x)
              OR public.has_viewer_project_access(m.x)
        )
        OR (
          contadores.company_id = (SELECT public.get_my_company_id())
          AND (SELECT public.user_has_permission('agua.contadores.view'))
        )
      )
      -- can_access_project(project_id)
      AND (
        contadores.project_id IS NULL
        OR (SELECT public.user_is_project_exempt())
        OR contadores.project_id IN (SELECT public.mis_proyectos_asignados())
      )
    )
    -- El residente: los contadores activos de sus unidades.
    OR (
      (SELECT public.current_user_role()) = 'cliente'
      AND contadores.activo = true
      AND contadores.unidad_id IN (
        SELECT u.id FROM public.unidades u
         WHERE u.cliente_id = (SELECT public.get_my_cliente_id())
      )
    )
  );

-- ── 3. unidades · lectura ───────────────────────────────────────────────────
DROP POLICY IF EXISTS unidades_select ON public.unidades;
CREATE POLICY unidades_select ON public.unidades
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_super_admin_access())
    OR (
      (
        -- has_company_owner_company_access(company_id)
        (
          (SELECT public.current_user_role()) = 'company_owner'
          AND unidades.company_id = (SELECT public.get_my_company_id())
        )
        -- has_admin / has_operator / has_viewer _project_access(project_id)
        OR unidades.project_id IN (
          SELECT m.x FROM public.mis_proyectos_asignados() AS m(x)
           WHERE public.has_admin_project_access(m.x)
              OR public.has_operator_project_access(m.x)
              OR public.has_viewer_project_access(m.x)
        )
        OR (
          unidades.company_id = (SELECT public.get_my_company_id())
          AND (SELECT public.user_has_permission('platform.unidades.view'))
        )
      )
      -- can_access_project(project_id)
      AND (
        unidades.project_id IS NULL
        OR (SELECT public.user_is_project_exempt())
        OR unidades.project_id IN (SELECT public.mis_proyectos_asignados())
      )
    )
    -- El residente: sus unidades (propietario o inquilino).
    OR (
      (SELECT public.current_user_role()) = 'cliente'
      AND unidades.id IN (SELECT public.mis_unidades_ids())
    )
  );
