-- ============================================================================
-- Panel "Actividad del equipo" — qué hizo cada usuario en el período
-- ============================================================================
-- Trazabilidad sin lectura agregada es un dato muerto en una columna. Este RPC
-- convierte los sellos de 20260731000000 en supervisión operativa: cuántas
-- lecturas capturó cada lecturista, cuántas tareas de limpieza completó cada
-- persona, quién abrió y cerró rondas, quién registra las visitas, y —lo más
-- útil para un administrador— cuándo fue la ÚLTIMA vez que cada quien reportó
-- algo (detecta al que dejó de hacerlo).
--
-- FUENTE: las columnas selladas, no la bitácora. Son permanentes (la bitácora
-- se purga a los 24 meses), exactas y no dependen de que el trigger de bitácora
-- estuviera activo. `ultima_actividad` sí sale de bitacora_acciones porque es
-- justamente "el último acto registrado, sea del tipo que sea".
--
-- SCOPE: todo se ancla a project_id y se valida que el proyecto sea de la
-- empresa del llamador. Las tablas hijas sin project_id (visitas_control) se
-- resuelven por su padre. `registros` no tiene company_id, se une vía projects
-- (mismo patrón que agua_anomalias_consumo).
--
-- AUTORIZACIÓN: solo super admin, company_owner y admin — es información sobre
-- el desempeño de personas y no debe ser visible para cualquier rol operativo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.actividad_equipo(
  p_project_id uuid,
  p_desde      date DEFAULT (now() - interval '30 days')::date,
  p_hasta      date DEFAULT now()::date
)
RETURNS TABLE (
  usuario_id            uuid,
  usuario_nombre        text,
  usuario_rol           text,
  lecturas              bigint,
  lecturas_m3           numeric,
  limpiezas             bigint,
  checklists            bigint,
  rondas_iniciadas      bigint,
  puntos_marcados       bigint,
  visitas_registradas   bigint,
  paquetes              bigint,
  solicitudes_creadas   bigint,
  tareas_cerradas       bigint,
  total                 bigint,
  ultima_actividad      timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_desde   timestamptz := p_desde::timestamptz;
  -- p_hasta es inclusivo para el usuario: "al 31" incluye todo el día 31.
  v_hasta   timestamptz := (p_hasta + 1)::timestamptz;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY (ARRAY['company_owner', 'admin']))
  ) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH hechos AS (
    -- Lecturas de agua capturadas
    SELECT r.creado_por AS uid, 'lecturas'::text AS tipo,
           COALESCE(r.consumo, 0)::numeric AS m3, r.fecha AS cuando
      FROM public.registros r
     WHERE r.project_id = p_project_id
       AND r.deleted_at IS NULL
       AND r.creado_por IS NOT NULL
       AND r.fecha >= v_desde AND r.fecha < v_hasta

    -- Limpieza: ejecuciones del programa + tareas de bloque completadas
    UNION ALL
    SELECT pl.ejecutado_por, 'limpiezas', 0, pl.ultima_ejecucion::timestamptz
      FROM public.programacion_limpieza pl
     WHERE pl.project_id = p_project_id
       AND pl.ejecutado_por IS NOT NULL
       AND pl.ultima_ejecucion >= v_desde AND pl.ultima_ejecucion < v_hasta

    UNION ALL
    SELECT sh.creado_por, 'limpiezas', 0, sh.fecha::timestamptz
      FROM public.servicios_housekeeping sh
     WHERE sh.project_id = p_project_id
       AND sh.creado_por IS NOT NULL
       AND sh.fecha >= v_desde AND sh.fecha < v_hasta

    UNION ALL
    SELECT tb.completado_por, 'limpiezas', 0, tb.completado_en
      FROM public.tareas_bloque tb
      JOIN public.bloques_turno bt ON bt.id = tb.bloque_id
     WHERE bt.project_id = p_project_id
       AND tb.completado_por IS NOT NULL
       AND tb.completado_en >= v_desde AND tb.completado_en < v_hasta

    -- Checklists e inspecciones de área + bitácora de mantenimiento firmada
    UNION ALL
    SELECT ca.creado_por, 'checklists', 0, ca.fecha::timestamptz
      FROM public.checklist_areas ca
     WHERE ca.project_id = p_project_id
       AND ca.creado_por IS NOT NULL
       AND ca.fecha >= v_desde AND ca.fecha < v_hasta

    UNION ALL
    SELECT bm.creado_por, 'checklists', 0, bm.fecha::timestamptz
      FROM public.bitacora_manto bm
     WHERE bm.project_id = p_project_id
       AND bm.creado_por IS NOT NULL
       AND bm.fecha >= v_desde AND bm.fecha < v_hasta

    -- Rondas de seguridad abiertas y puntos de control marcados
    UNION ALL
    SELECT rs.creado_por, 'rondas_iniciadas', 0, rs.inicio
      FROM public.rondas_seguridad rs
     WHERE rs.project_id = p_project_id
       AND rs.creado_por IS NOT NULL
       AND rs.inicio >= v_desde AND rs.inicio < v_hasta

    UNION ALL
    SELECT vc.visitado_por, 'puntos_marcados', 0, vc.visitado_en
      FROM public.visitas_control vc
      JOIN public.rondas_seguridad rs2 ON rs2.id = vc.ronda_id
     WHERE rs2.project_id = p_project_id
       AND vc.visitado_por IS NOT NULL
       AND vc.visitado_en >= v_desde AND vc.visitado_en < v_hasta

    -- Visitas registradas en caseta
    UNION ALL
    SELECT v.registrado_por, 'visitas_registradas', 0, v.created_at
      FROM public.visitantes v
     WHERE v.project_id = p_project_id
       AND v.registrado_por IS NOT NULL
       AND v.created_at >= v_desde AND v.created_at < v_hasta

    -- Paquetes recibidos
    UNION ALL
    SELECT pr.creado_por, 'paquetes', 0, pr.created_at
      FROM public.paquetes_recibidos pr
     WHERE pr.project_id = p_project_id
       AND pr.creado_por IS NOT NULL
       AND pr.created_at >= v_desde AND pr.created_at < v_hasta

    -- Solicitudes levantadas
    UNION ALL
    SELECT sr.creado_por, 'solicitudes_creadas', 0, sr.created_at
      FROM public.solicitudes_residente sr
     WHERE sr.project_id = p_project_id
       AND sr.creado_por IS NOT NULL
       AND sr.created_at >= v_desde AND sr.created_at < v_hasta

    UNION ALL
    SELECT sc.creado_por, 'solicitudes_creadas', 0, sc.created_at
      FROM public.solicitudes_concierge sc
     WHERE sc.project_id = p_project_id
       AND sc.creado_por IS NOT NULL
       AND sc.created_at >= v_desde AND sc.created_at < v_hasta

    -- Tareas cerradas
    UNION ALL
    SELECT tc.cerrado_por, 'tareas_cerradas', 0, tc.fecha_cierre::timestamptz
      FROM public.tareas_condominio tc
     WHERE tc.project_id = p_project_id
       AND tc.cerrado_por IS NOT NULL
       AND tc.fecha_cierre >= v_desde AND tc.fecha_cierre < v_hasta
  ),
  agregado AS (
    SELECT
      h.uid,
      count(*) FILTER (WHERE h.tipo = 'lecturas')            AS lecturas,
      COALESCE(sum(h.m3) FILTER (WHERE h.tipo = 'lecturas'), 0) AS lecturas_m3,
      count(*) FILTER (WHERE h.tipo = 'limpiezas')           AS limpiezas,
      count(*) FILTER (WHERE h.tipo = 'checklists')          AS checklists,
      count(*) FILTER (WHERE h.tipo = 'rondas_iniciadas')    AS rondas_iniciadas,
      count(*) FILTER (WHERE h.tipo = 'puntos_marcados')     AS puntos_marcados,
      count(*) FILTER (WHERE h.tipo = 'visitas_registradas') AS visitas_registradas,
      count(*) FILTER (WHERE h.tipo = 'paquetes')            AS paquetes,
      count(*) FILTER (WHERE h.tipo = 'solicitudes_creadas') AS solicitudes_creadas,
      count(*) FILTER (WHERE h.tipo = 'tareas_cerradas')     AS tareas_cerradas,
      count(*)                                               AS total,
      max(h.cuando)                                          AS ultimo_hecho
    FROM hechos h
    GROUP BY h.uid
  ),
  ultima_bitacora AS (
    SELECT b.usuario_id AS uid, max(b.created_at) AS ultima
      FROM public.bitacora_acciones b
     WHERE b.project_id = p_project_id
       AND b.usuario_id IS NOT NULL
       AND b.created_at >= v_desde AND b.created_at < v_hasta
     GROUP BY b.usuario_id
  )
  SELECT
    a.uid,
    COALESCE(NULLIF(au.full_name, ''), 'Usuario ' || left(a.uid::text, 8)),
    COALESCE(au.role, '—'),
    a.lecturas, a.lecturas_m3, a.limpiezas, a.checklists,
    a.rondas_iniciadas, a.puntos_marcados, a.visitas_registradas,
    a.paquetes, a.solicitudes_creadas, a.tareas_cerradas, a.total,
    GREATEST(a.ultimo_hecho, ub.ultima)
  FROM agregado a
  LEFT JOIN public.app_users au ON au.id = a.uid
  LEFT JOIN ultima_bitacora ub  ON ub.uid = a.uid
  ORDER BY a.total DESC, 2 ASC;
END;
$$;

COMMENT ON FUNCTION public.actividad_equipo(uuid, date, date) IS
  'Actividad operativa por usuario en un proyecto y período (lecturas, limpiezas, checklists, rondas, visitas, paquetes, solicitudes, tareas). Agrega sobre las columnas selladas por trg_sellar_creado_por / trg_sellar_cierre. Solo super_admin, company_owner y admin.';

-- Ni anon ni el resto de roles: el RPC valida el rol internamente, pero se
-- revoca también el EXECUTE público (regresión #378/#380: RPCs SECURITY
-- DEFINER ejecutables por anon).
REVOKE EXECUTE ON FUNCTION public.actividad_equipo(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.actividad_equipo(uuid, date, date) TO authenticated;
