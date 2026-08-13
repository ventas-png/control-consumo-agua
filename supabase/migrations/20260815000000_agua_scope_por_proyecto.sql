-- ============================================================================
-- Módulo Agua: alcance por proyecto (medidores, unidades, tarifas, lecturas)
-- ============================================================================
-- Problema: las policies de `contadores` / `unidades` / `tarifas` / `registros`
-- terminan todas en una rama de EMPRESA del tipo
--
--     company_id = get_my_company_id() AND user_has_permission('agua.*.view')
--
-- y `user_has_permission()` auto-concede a super_admin / company_owner / admin.
-- Esa rama se evalúa en OR junto a las de proyecto (has_admin_project_access,
-- has_operator_project_access, has_viewer_project_access), así que concede el
-- acceso antes de llegar a ellas y las deja MUERTAS: un usuario asignado a un
-- solo proyecto —el "Administrador del Condominio" típico— leía los medidores,
-- las unidades, las tarifas y el histórico de lecturas de TODA la empresa, y con
-- ellos el dashboard, los cobros, el mapa y el historial. Es el mismo agujero
-- que 20260814000000 cerró en `conversations`.
--
-- Esta migración:
--   1. añade `user_is_project_exempt()` — quién ve la empresa entera— y
--      `can_access_project()` — la puerta por fila—;
--   2. re-crea las policies de SELECT de agua metiendo esa puerta en AND sobre
--      la rama de staff, sin tocar las ramas del portal del cliente;
--   3. alinea `projects_select` y `rutas_select` con la misma regla;
--   4. acota la RPC `agua_anomalias_consumo` (SECURITY DEFINER, alimenta las
--      "Alertas de consumo" del dashboard), que hoy devuelve toda la empresa.
--
-- REGLA DE EXENCIÓN (espeja src/lib/proyectosAccess.ts → isProjectExempt):
--   · super_admin / company_owner  → siempre ven la empresa entera;
--   · admin                        → ve la empresa entera SOLO mientras no tenga
--                                    asignaciones en user_project_assignments.
--                                    Asignarle un proyecto es un acto explícito
--                                    de acotarlo, y a partir de ahí ve solo ese;
--   · el resto (operator, collector, viewer, roles RBAC) → solo sus proyectos.
--
-- REGLA DE AMBIGÜEDAD: `project_id IS NULL` (lecturas y rutas heredadas que
-- nunca se sellaron) sigue siendo visible para la empresa. No se puede afirmar
-- que sea de otro proyecto, y ocultarlo escondería histórico propio.
--
-- Nota: el cliente además desactiva la exención cuando el usuario tiene un rol
-- de condominios restringido (RESTRICTED_COND_ROLE_IDS). Ese matiz no se
-- replica aquí —igual que en can_access_conversation_project— porque la BD no
-- distingue esos ids; la BD acota por asignación, que es el eje que importa.
--
-- IMPACTO EN DATOS: ninguno (no toca filas). Solo cambia quién LEE qué. Un
-- `admin` con asignaciones deja de ver los proyectos ajenos de su empresa.
--
-- CÓMO REVERTIR: re-aplicar las policies previas —`projects_select` de
-- 20260519000007, `contadores_select`/`unidades_select`/`tarifas_select` de
-- 20260521000003, `registros_select` de 20260519000009, `rutas_select` de
-- 20260521000002— y el cuerpo original de `agua_anomalias_consumo`
-- (20260717050000). Los dos helpers nuevos pueden quedarse (nadie más los usa)
-- o borrarse con DROP FUNCTION public.can_access_project(uuid),
-- public.user_is_project_exempt().

-- ── 1. Helpers ───────────────────────────────────────────────────────────────
-- SECURITY DEFINER para no re-entrar en la RLS de app_users /
-- user_project_assignments (mismo patrón que user_has_project_access).
CREATE OR REPLACE FUNCTION public.user_is_project_exempt()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    public.current_user_role() = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
    OR (
      public.current_user_role() = 'admin'
      AND NOT EXISTS (
        SELECT 1 FROM public.user_project_assignments upa
        WHERE upa.user_id = (SELECT auth.uid())
      )
    )
$$;

COMMENT ON FUNCTION public.user_is_project_exempt() IS
  'true si el usuario ve TODOS los proyectos de su empresa: super_admin/company_owner siempre, admin solo mientras no tenga asignaciones explícitas. Espeja isProjectExempt() del cliente.';

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    -- Fila sin proyecto sellado: ambigua, no ajena (ver cabecera).
    p_project_id IS NULL
    OR public.user_is_project_exempt()
    OR public.user_has_project_access(p_project_id)
$$;

COMMENT ON FUNCTION public.can_access_project(uuid) IS
  'Puerta por fila del alcance por proyecto: NULL (ambiguo) o rol de empresa o proyecto asignado.';

REVOKE EXECUTE ON FUNCTION public.user_is_project_exempt() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_access_project(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.user_is_project_exempt() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated;

-- ── 2. projects ──────────────────────────────────────────────────────────────
-- Sustituye la lista literal de roles de 20260519000007 por la regla de
-- exención: un admin CON proyectos asignados deja de enumerar toda la empresa.
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = (SELECT get_my_company_id())
      AND (
        public.user_is_project_exempt()
        OR public.user_has_project_access(projects.id)
      )
    )
    OR (
      current_user_role() = 'cliente' AND EXISTS (
        SELECT 1 FROM public.company_clientes cc
        WHERE cc.company_id = projects.company_id
          AND cc.cliente_id = (SELECT get_my_cliente_id())
      )
    )
  );

-- ── 3. contadores ────────────────────────────────────────────────────────────
-- Misma policy de 20260521000003 con la rama de staff envuelta en la puerta de
-- proyecto. La rama del portal del cliente (su propio medidor) queda intacta.
DROP POLICY IF EXISTS "contadores_select" ON public.contadores;
CREATE POLICY "contadores_select" ON public.contadores
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR (
      (
        has_company_owner_company_access(company_id)
        OR has_admin_project_access(project_id)
        OR has_operator_project_access(project_id)
        OR has_viewer_project_access(project_id)
        OR (company_id = (SELECT get_my_company_id())
            AND (SELECT public.user_has_permission('agua.contadores.view')))
      )
      AND public.can_access_project(project_id)
    )
    OR (
      current_user_role() = 'cliente'
      AND activo = true
      AND EXISTS (
        SELECT 1 FROM public.unidades u
        WHERE u.id = contadores.unidad_id AND u.cliente_id = get_my_cliente_id()
      )
    )
  );

-- ── 4. unidades ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "unidades_select" ON public.unidades;
CREATE POLICY "unidades_select" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR (
      (
        has_company_owner_company_access(company_id)
        OR has_admin_project_access(project_id)
        OR has_operator_project_access(project_id)
        OR has_viewer_project_access(project_id)
        OR (company_id = (SELECT get_my_company_id())
            AND (SELECT public.user_has_permission('platform.unidades.view')))
      )
      AND public.can_access_project(project_id)
    )
    OR (current_user_role() = 'cliente' AND cliente_id = get_my_cliente_id() AND activo = true)
  );

-- ── 5. tarifas ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tarifas_select" ON public.tarifas;
CREATE POLICY "tarifas_select" ON public.tarifas
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR (
      (
        (current_user_role() = 'company_owner' AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = tarifas.project_id AND p.company_id = get_my_company_id()
        ))
        OR has_admin_project_access(project_id)
        OR has_operator_project_access(project_id)
        OR has_viewer_project_access(project_id)
        OR (project_id IN (
              SELECT p.id FROM public.projects p
              WHERE p.company_id = (SELECT get_my_company_id())
            )
            AND (SELECT public.user_has_permission('agua.tarifas.view')))
      )
      AND public.can_access_project(project_id)
    )
  );

-- ── 6. registros ─────────────────────────────────────────────────────────────
-- Igual que 20260519000009 con la puerta de proyecto sobre la rama de staff.
-- Las dos ramas del portal del cliente (su cliente_id, o el medidor de su
-- unidad) se conservan literales: el residente no tiene proyecto asignado.
DROP POLICY IF EXISTS "registros_select" ON public.registros;
CREATE POLICY "registros_select" ON public.registros
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      (
        (SELECT public.user_has_permission('agua.tabla.view'))
        OR (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.dashboard.view'))
        OR (SELECT public.user_has_permission('agua.cobros.view'))
        OR (SELECT public.user_has_permission('agua.mapa.view'))
      )
      AND (SELECT get_my_company_id()) IS NOT NULL
      AND (
        project_id IN (
          SELECT p.id FROM public.projects p
          WHERE p.company_id = (SELECT get_my_company_id())
        )
        OR (project_id IS NULL AND cliente_id IN (
          SELECT cc.cliente_id FROM public.company_clientes cc
          WHERE cc.company_id = (SELECT get_my_company_id())
        ))
      )
      AND public.can_access_project(project_id)
    )
    OR (current_user_role() = 'cliente' AND cliente_id = (SELECT get_my_cliente_id()))
    OR (current_user_role() = 'cliente' AND contador_id IN (
      SELECT c.id FROM public.contadores c
      JOIN public.unidades u ON u.id = c.unidad_id
      WHERE u.cliente_id = (SELECT get_my_cliente_id()) AND c.activo = true AND u.activo = true
    ))
  );

-- ── 7. rutas ─────────────────────────────────────────────────────────────────
-- 20260521000002 ya acotaba por proyecto, pero con la misma lista literal de
-- roles que projects_select. Se cambia por la regla de exención; la ruta
-- asignada al propio usuario se sigue viendo siempre.
DROP POLICY IF EXISTS "rutas_select" ON public.rutas;
CREATE POLICY "rutas_select" ON public.rutas
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR asignado_a = (SELECT auth.uid())
    OR (
      company_id = (SELECT get_my_company_id())
      AND (SELECT public.user_has_permission('agua.rutas.view'))
      AND public.can_access_project(project_id)
    )
  );

-- ── 8. RPC de anomalías (alertas del dashboard) ──────────────────────────────
-- Es SECURITY DEFINER, así que el `p_project_id` que manda el cliente no es una
-- garantía: sin filtro propio, cualquier usuario de la empresa podía pedirla sin
-- argumento y recibir las fugas/medidores parados de todos los condominios (que
-- es justo lo que muestra hoy la tarjeta "Alertas de consumo"). Se le añade el
-- mismo recorte por proyecto; el resto del cuerpo queda igual.
CREATE OR REPLACE FUNCTION public.agua_anomalias_consumo(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  contador_id        uuid,
  cliente_id         uuid,
  cliente_nombre     text,
  project_id         uuid,
  ultima_fecha       timestamptz,
  ultimo_consumo     numeric,
  promedio           numeric,
  desviacion         numeric,
  z_score            numeric,
  ceros_consecutivos int,
  n_lecturas         int,
  tipo_anomalia      text,
  severidad          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH r AS (
    SELECT
      reg.contador_id,
      reg.cliente_id,
      reg.cliente_nombre,
      reg.project_id,
      reg.fecha,
      COALESCE(reg.consumo, 0) AS consumo,
      row_number() OVER (PARTITION BY reg.contador_id ORDER BY reg.fecha DESC) AS rn_desc
    FROM public.registros reg
    JOIN public.projects p ON p.id = reg.project_id
    WHERE reg.deleted_at IS NULL
      AND reg.contador_id IS NOT NULL
      AND p.company_id = public.get_my_company_id()
      AND (p_project_id IS NULL OR reg.project_id = p_project_id)
      -- Alcance por proyecto del usuario (ver cabecera de la migración).
      AND public.can_access_project(reg.project_id)
  ),
  stats AS (
    SELECT
      contador_id,
      -- Media/desv del histórico EXCLUYENDO la última lectura (rn_desc > 1).
      avg(consumo) FILTER (WHERE rn_desc > 1)         AS media,
      stddev_pop(consumo) FILTER (WHERE rn_desc > 1)  AS desv,
      count(*)::int                                   AS n_lecturas,
      -- Ceros consecutivos desde la lectura más reciente.
      (COALESCE(min(rn_desc) FILTER (WHERE consumo <> 0), max(rn_desc) + 1) - 1)::int AS ceros_consecutivos
    FROM r
    GROUP BY contador_id
  ),
  ult AS (
    SELECT contador_id, cliente_id, cliente_nombre, project_id, fecha, consumo
    FROM r WHERE rn_desc = 1
  ),
  eval AS (
    SELECT
      u.contador_id, u.cliente_id, u.cliente_nombre, u.project_id,
      u.fecha AS ultima_fecha, u.consumo AS ultimo_consumo,
      s.media, s.desv, s.n_lecturas, s.ceros_consecutivos,
      CASE WHEN s.desv IS NOT NULL AND s.desv > 0
           THEN (u.consumo - s.media) / s.desv
           ELSE NULL END AS z_score
    FROM ult u
    JOIN stats s ON s.contador_id = u.contador_id
    WHERE s.n_lecturas >= 3  -- se necesita algo de historia para tener señal
  )
  SELECT
    e.contador_id, e.cliente_id, e.cliente_nombre, e.project_id,
    e.ultima_fecha,
    e.ultimo_consumo::numeric(14,2),
    round(e.media, 2),
    round(e.desv, 2),
    round(e.z_score, 2),
    e.ceros_consecutivos,
    e.n_lecturas,
    tipo,
    CASE
      WHEN tipo = 'medidor_parado' AND e.ceros_consecutivos >= 3 THEN 'alta'
      WHEN tipo = 'fuga_probable'  AND e.z_score >= 5           THEN 'alta'
      ELSE 'media'
    END AS severidad
  FROM eval e
  CROSS JOIN LATERAL (
    SELECT CASE
      -- Medidor parado: 2+ lecturas consecutivas en cero.
      WHEN e.ceros_consecutivos >= 2 THEN 'medidor_parado'
      -- Fuga probable: pico atípico (z>3) con piso absoluto para evitar ruido.
      WHEN e.z_score >= 3 AND e.ultimo_consumo >= 5 AND e.ultimo_consumo >= e.media * 1.5 THEN 'fuga_probable'
      ELSE NULL
    END AS tipo
  ) t
  WHERE tipo IS NOT NULL
  ORDER BY (tipo = 'fuga_probable') DESC, e.z_score DESC NULLS LAST, e.ceros_consecutivos DESC
$$;

COMMENT ON FUNCTION public.agua_anomalias_consumo(uuid) IS
  'Anomalías retrospectivas de consumo de agua por medidor (fuga_probable por z-score>3 con piso absoluto; medidor_parado por 2+ ceros consecutivos). SECURITY DEFINER con scope por tenant Y por proyecto asignado. Auditoría 2026-07-16 O1; alcance por proyecto en 20260815000000.';

REVOKE EXECUTE ON FUNCTION public.agua_anomalias_consumo(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_anomalias_consumo(uuid) TO authenticated;
