-- Performance fix #2: consolidar políticas RLS permisivas múltiples.
--
-- El advisor "multiple_permissive_policies" detectaba 43 casos donde una
-- misma (tabla, acción) tenía 2-3 políticas PERMISSIVE para el mismo rol.
-- Postgres las OR-ea por cada fila, lo que multiplica el costo de la
-- evaluación RLS (especialmente cuando cada política hace subqueries a
-- unidades/app_users/asambleas).
--
-- Solución: por cada (tabla, acción), fusionar todas las políticas
-- permisivas en UNA sola política con sus condiciones OR-eadas.
-- Resultado: misma semántica de acceso, una sola evaluación por fila.
--
-- Patrones:
--   A) Admin/RBAC (`*_select/insert/etc.`) + Cliente (`residents_*` o
--      `*_cliente_portal`) → merge en una política con OR.
--   B) Legacy (`puntos_*`, `votos_*`, `solicitud_*_unidad_*` vs
--      `solicitud_*`) → merge OR (algunos quals son distintos: uno
--      mira role, otro mira user_has_permission).
--   C) Duplicados internos del portal residente (residents_select_mensajes
--      vs residents_select_own_mensajes_portal) → merge OR.
--
-- Todas las políticas resultantes se crean TO authenticated. Las versiones
-- anteriores con role `public` se pierden, pero `authenticated` cubre el
-- caso de uso real (Supabase Auth siempre asigna `authenticated` a usuarios
-- con sesión).

-- ── amenidades ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "amenidades_select" ON public.amenidades;
DROP POLICY IF EXISTS "residents_select_amenidades" ON public.amenidades;
CREATE POLICY "amenidades_select" ON public.amenidades
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (project_id IN (
      SELECT u.project_id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ── amenidades_bloqueos ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "amenidades_bloqueos_select" ON public.amenidades_bloqueos;
DROP POLICY IF EXISTS "residents_select_amenidades_bloqueos" ON public.amenidades_bloqueos;
CREATE POLICY "amenidades_bloqueos_select" ON public.amenidades_bloqueos
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (project_id IN (
      SELECT u.project_id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ── config_condominio ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "config_cond_select" ON public.config_condominio;
DROP POLICY IF EXISTS "config_cond_cliente_select" ON public.config_condominio;
CREATE POLICY "config_cond_select" ON public.config_condominio
  FOR SELECT TO authenticated
  USING (
    company_id = get_my_company_id()
    OR project_id = (
      SELECT app_users.project_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid())
    )
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM unidades u
        WHERE u.project_id = config_condominio.project_id
          AND u.cliente_id = get_my_cliente_id()
          AND u.activo = true
      )
    )
  );

-- ── reservas_amenidades ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "reservas_amenidades_select" ON public.reservas_amenidades;
DROP POLICY IF EXISTS "residents_select_reservas_amenidades" ON public.reservas_amenidades;
CREATE POLICY "reservas_amenidades_select" ON public.reservas_amenidades
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

DROP POLICY IF EXISTS "reservas_amenidades_insert" ON public.reservas_amenidades;
DROP POLICY IF EXISTS "residents_insert_reservas_amenidades" ON public.reservas_amenidades;
CREATE POLICY "reservas_amenidades_insert" ON public.reservas_amenidades
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.amenidades'))
    OR (unidad_id IN (
      SELECT u.id FROM unidades u
      JOIN app_users au ON au.cliente_id = u.cliente_id
      WHERE au.id = (SELECT auth.uid()) AND u.activo = true
    ))
  );

-- ── tickets_mantenimiento ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tickets_mantenimiento_select" ON public.tickets_mantenimiento;
DROP POLICY IF EXISTS "residents_select_tickets" ON public.tickets_mantenimiento;
CREATE POLICY "tickets_mantenimiento_select" ON public.tickets_mantenimiento
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mantenimiento'))
    OR (unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    ))
  );

DROP POLICY IF EXISTS "tickets_mantenimiento_insert" ON public.tickets_mantenimiento;
DROP POLICY IF EXISTS "residents_insert_tickets" ON public.tickets_mantenimiento;
CREATE POLICY "tickets_mantenimiento_insert" ON public.tickets_mantenimiento
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mantenimiento'))
    OR (unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    ))
  );

-- ── visitantes ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "visitantes_select" ON public.visitantes;
DROP POLICY IF EXISTS "residents_select_visitantes" ON public.visitantes;
CREATE POLICY "visitantes_select" ON public.visitantes
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.visitantes'))
    OR (unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    ))
  );

DROP POLICY IF EXISTS "visitantes_insert" ON public.visitantes;
DROP POLICY IF EXISTS "residents_insert_visitantes" ON public.visitantes;
CREATE POLICY "visitantes_insert" ON public.visitantes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.visitantes'))
    OR (unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    ))
  );

-- ── contratos_arrendamiento ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "contratos_arr_cliente_portal" ON public.contratos_arrendamiento;
DROP POLICY IF EXISTS "contratos_arrendamiento_select" ON public.contratos_arrendamiento;
CREATE POLICY "contratos_arrendamiento_select" ON public.contratos_arrendamiento
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.arrendamientos'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = contratos_arrendamiento.unidad_id
          AND s.company_id = contratos_arrendamiento.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "contratos_arrendamiento_insert" ON public.contratos_arrendamiento;
CREATE POLICY "contratos_arrendamiento_insert" ON public.contratos_arrendamiento
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.arrendamientos'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = contratos_arrendamiento.unidad_id
          AND s.company_id = contratos_arrendamiento.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "contratos_arrendamiento_update" ON public.contratos_arrendamiento;
CREATE POLICY "contratos_arrendamiento_update" ON public.contratos_arrendamiento
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.arrendamientos'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = contratos_arrendamiento.unidad_id
          AND s.company_id = contratos_arrendamiento.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
      )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.arrendamientos'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = contratos_arrendamiento.unidad_id
          AND s.company_id = contratos_arrendamiento.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "contratos_arrendamiento_delete" ON public.contratos_arrendamiento;
CREATE POLICY "contratos_arrendamiento_delete" ON public.contratos_arrendamiento
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR ((current_user_role() = ANY (ARRAY['company_owner', 'admin'])) AND company_id = get_my_company_id())
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = contratos_arrendamiento.unidad_id
          AND s.company_id = contratos_arrendamiento.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('arrendamiento', 'ambas')
      )
    )
  );

-- ── huespedes_str ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "huespedes_str_cliente_portal" ON public.huespedes_str;
DROP POLICY IF EXISTS "huespedes_str_select" ON public.huespedes_str;
CREATE POLICY "huespedes_str_select" ON public.huespedes_str
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = get_my_company_id()
        AND user_has_permission('condominios.tab.str')
    )
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1
        FROM reservas_str r
        JOIN solicitud_renta_unidad s ON s.unidad_id = r.unidad_id AND s.company_id = r.company_id
        WHERE r.id = huespedes_str.reserva_str_id
          AND s.cliente_id = get_my_cliente_id()
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "huespedes_str_insert" ON public.huespedes_str;
CREATE POLICY "huespedes_str_insert" ON public.huespedes_str
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = get_my_company_id()
        AND user_has_permission('condominios.tab.str')
    )
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1
        FROM reservas_str r
        JOIN solicitud_renta_unidad s ON s.unidad_id = r.unidad_id AND s.company_id = r.company_id
        WHERE r.id = huespedes_str.reserva_str_id
          AND s.cliente_id = get_my_cliente_id()
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "huespedes_str_update" ON public.huespedes_str;
CREATE POLICY "huespedes_str_update" ON public.huespedes_str
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = get_my_company_id()
        AND user_has_permission('condominios.tab.str')
    )
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1
        FROM reservas_str r
        JOIN solicitud_renta_unidad s ON s.unidad_id = r.unidad_id AND s.company_id = r.company_id
        WHERE r.id = huespedes_str.reserva_str_id
          AND s.cliente_id = get_my_cliente_id()
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = get_my_company_id()
        AND user_has_permission('condominios.tab.str')
    )
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1
        FROM reservas_str r
        JOIN solicitud_renta_unidad s ON s.unidad_id = r.unidad_id AND s.company_id = r.company_id
        WHERE r.id = huespedes_str.reserva_str_id
          AND s.cliente_id = get_my_cliente_id()
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "huespedes_str_delete" ON public.huespedes_str;
CREATE POLICY "huespedes_str_delete" ON public.huespedes_str
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM reservas_str r
      WHERE r.id = huespedes_str.reserva_str_id
        AND r.company_id = get_my_company_id()
        AND (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
    )
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1
        FROM reservas_str r
        JOIN solicitud_renta_unidad s ON s.unidad_id = r.unidad_id AND s.company_id = r.company_id
        WHERE r.id = huespedes_str.reserva_str_id
          AND s.cliente_id = get_my_cliente_id()
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

-- ── reservas_str ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "str_cliente_portal_select" ON public.reservas_str;
DROP POLICY IF EXISTS "reservas_str_select" ON public.reservas_str;
CREATE POLICY "reservas_str_select" ON public.reservas_str
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "str_cliente_portal_insert" ON public.reservas_str;
DROP POLICY IF EXISTS "reservas_str_insert" ON public.reservas_str;
CREATE POLICY "reservas_str_insert" ON public.reservas_str
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "str_cliente_portal_update" ON public.reservas_str;
DROP POLICY IF EXISTS "reservas_str_update" ON public.reservas_str;
CREATE POLICY "reservas_str_update" ON public.reservas_str
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.str'))
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

DROP POLICY IF EXISTS "str_cliente_portal_delete" ON public.reservas_str;
DROP POLICY IF EXISTS "reservas_str_delete" ON public.reservas_str;
CREATE POLICY "reservas_str_delete" ON public.reservas_str
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR ((current_user_role() = ANY (ARRAY['company_owner', 'admin'])) AND company_id = get_my_company_id())
    OR (
      current_user_role() = 'cliente'
      AND EXISTS (
        SELECT 1 FROM solicitud_renta_unidad s
        WHERE s.cliente_id = get_my_cliente_id()
          AND s.unidad_id = reservas_str.unidad_id
          AND s.company_id = reservas_str.company_id
          AND s.estado = 'aprobada'
          AND COALESCE(s.tipo_aprobado, s.tipo_renta) IN ('str', 'ambas')
      )
    )
  );

-- ── mensajes_portal ───────────────────────────────────────────────────────────
-- SELECT: 3 políticas → 1
-- INSERT: 2 políticas idénticas (cliente) → 1
-- UPDATE: 1 política, no requiere fusión (pero la reconvertimos a TO authenticated)
DROP POLICY IF EXISTS "company_users_select_mensajes_portal" ON public.mensajes_portal;
DROP POLICY IF EXISTS "residents_select_mensajes" ON public.mensajes_portal;
DROP POLICY IF EXISTS "residents_select_own_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "mensajes_portal_select" ON public.mensajes_portal
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.company_id IS NOT NULL
    )
    OR unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

DROP POLICY IF EXISTS "residents_insert_mensajes" ON public.mensajes_portal;
DROP POLICY IF EXISTS "residents_insert_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "mensajes_portal_insert" ON public.mensajes_portal
  FOR INSERT TO authenticated
  WITH CHECK (
    unidad_id IN (
      SELECT unidades.id FROM unidades
      WHERE unidades.cliente_id = (
        SELECT app_users.cliente_id FROM app_users
        WHERE app_users.id = (SELECT auth.uid())
      )
      AND unidades.activo = true
    )
  );

DROP POLICY IF EXISTS "company_users_update_mensajes_portal" ON public.mensajes_portal;
CREATE POLICY "mensajes_portal_update" ON public.mensajes_portal
  FOR UPDATE TO authenticated
  USING (
    company_id IN (
      SELECT app_users.company_id FROM app_users
      WHERE app_users.id = (SELECT auth.uid()) AND app_users.company_id IS NOT NULL
    )
  );

-- ── puntos_asamblea ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "puntos_asamblea_select" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_select" ON public.puntos_asamblea;
CREATE POLICY "puntos_asamblea_select" ON public.puntos_asamblea
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.asambleas')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  );

DROP POLICY IF EXISTS "puntos_asamblea_insert" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_insert" ON public.puntos_asamblea;
CREATE POLICY "puntos_asamblea_insert" ON public.puntos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.asambleas')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  );

DROP POLICY IF EXISTS "puntos_asamblea_update" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_update" ON public.puntos_asamblea;
CREATE POLICY "puntos_asamblea_update" ON public.puntos_asamblea
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.asambleas')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.asambleas')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  );

DROP POLICY IF EXISTS "puntos_asamblea_delete" ON public.puntos_asamblea;
DROP POLICY IF EXISTS "puntos_delete" ON public.puntos_asamblea;
CREATE POLICY "puntos_asamblea_delete" ON public.puntos_asamblea
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM asambleas a
      WHERE a.id = puntos_asamblea.asamblea_id
        AND a.company_id = get_my_company_id()
        AND (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
    )
  );

-- ── votos_asamblea ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "votos_asamblea_select" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_select" ON public.votos_asamblea;
CREATE POLICY "votos_asamblea_select" ON public.votos_asamblea
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.votaciones')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  );

DROP POLICY IF EXISTS "votos_asamblea_insert" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_insert" ON public.votos_asamblea;
CREATE POLICY "votos_asamblea_insert" ON public.votos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.votaciones')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  );

DROP POLICY IF EXISTS "votos_asamblea_update" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_update" ON public.votos_asamblea;
CREATE POLICY "votos_asamblea_update" ON public.votos_asamblea
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.votaciones')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  )
  WITH CHECK (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (
          user_has_permission('condominios.tab.votaciones')
          OR (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
        )
    )
  );

DROP POLICY IF EXISTS "votos_asamblea_delete" ON public.votos_asamblea;
DROP POLICY IF EXISTS "votos_delete" ON public.votos_asamblea;
CREATE POLICY "votos_asamblea_delete" ON public.votos_asamblea
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM puntos_asamblea p
      JOIN asambleas a ON a.id = p.asamblea_id
      WHERE p.id = votos_asamblea.punto_id
        AND a.company_id = get_my_company_id()
        AND (current_user_role() = ANY (ARRAY['company_owner', 'admin']))
    )
  );

-- ── solicitud_mudanza_unidad ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_select" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_cliente_select" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_select" ON public.solicitud_mudanza_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR company_id = get_my_company_id()
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR EXISTS (
          SELECT 1 FROM unidades u
          WHERE u.id = solicitud_mudanza_unidad.unidad_id
            AND u.cliente_id = get_my_cliente_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_insert" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_cliente_insert" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_insert" ON public.solicitud_mudanza_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR company_id = get_my_company_id()
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR (
          estado = 'pendiente'
          AND EXISTS (
            SELECT 1 FROM unidades u
            WHERE u.id = solicitud_mudanza_unidad.unidad_id
              AND u.cliente_id = get_my_cliente_id()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_mudanza_unidad_update" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_update" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_update" ON public.solicitud_mudanza_unidad
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR company_id = get_my_company_id()
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_mudanza'))
    OR company_id = get_my_company_id()
  );

DROP POLICY IF EXISTS "solicitud_mudanza_unidad_delete" ON public.solicitud_mudanza_unidad;
DROP POLICY IF EXISTS "solicitud_mudanza_delete" ON public.solicitud_mudanza_unidad;
CREATE POLICY "solicitud_mudanza_unidad_delete" ON public.solicitud_mudanza_unidad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR ((current_user_role() = ANY (ARRAY['company_owner', 'admin'])) AND company_id = get_my_company_id())
  );

-- ── solicitud_renta_unidad ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_select" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_cliente_select" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR company_id = get_my_company_id()
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR EXISTS (
          SELECT 1 FROM unidades u
          WHERE u.id = solicitud_renta_unidad.unidad_id
            AND u.cliente_id = get_my_cliente_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_insert" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR company_id = get_my_company_id()
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR (
          estado = 'pendiente'
          AND EXISTS (
            SELECT 1 FROM unidades u
            WHERE u.id = solicitud_renta_unidad.unidad_id
              AND u.cliente_id = get_my_cliente_id()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_update" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR company_id = get_my_company_id()
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR company_id = get_my_company_id()
  );

DROP POLICY IF EXISTS "solicitud_renta_unidad_delete" ON public.solicitud_renta_unidad;
DROP POLICY IF EXISTS "solicitud_renta_delete" ON public.solicitud_renta_unidad;
CREATE POLICY "solicitud_renta_unidad_delete" ON public.solicitud_renta_unidad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR ((current_user_role() = ANY (ARRAY['company_owner', 'admin'])) AND company_id = get_my_company_id())
  );
