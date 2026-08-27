-- ════════════════════════════════════════════════════════════════════════════
-- Lo que el renombre de tareas_bloque no podía arrastrar consigo
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20260906000200 termina el trabajo de 20260906000000. Aquella migración
-- renombró `tareas_bloque.completado_en` → `completada_en` para que producción
-- tomara la forma que el repositorio declara, y estaba bien: PostgreSQL
-- actualiza solo los índices, las policies, las constraints y las vistas que
-- dependen de la columna.
--
-- NO actualiza dos cosas, y las dos quedaron rotas:
--
--   1. Los cuerpos plpgsql, que son TEXTO. `public.actividad_equipo` —última
--      declaración en 20260829000600:466— lee `tb.completado_en` en su UNION
--      ALL de limpiezas. La columna ya no existe, así que la función revienta
--      con 42703 al ejecutarse; plpgsql resuelve las consultas en la primera
--      ejecución de cada sesión, no al crearla. Es la ÚNICA función de todo
--      pg_proc que quedó apuntando a un nombre viejo. Alimenta la pestaña
--      «Actividad equipo» (tabRegistry:729 → domain/condominios/actividad.ts).
--
--   2. Los ARGUMENTOS de un trigger, que son literales de texto.
--      `trg_sellar_cierre` quedó instalado sobre tareas_bloque como
--      `sellar_cierre('completado_en', 'completado_por')`. Ese helper lee el
--      hito con `to_jsonb(OLD)->>v_hito`: una clave que no existe da NULL, no
--      error. O sea que NO revienta — deja de sellar en silencio, y
--      `completado_por` se queda vacío en cada tarea que se complete desde el
--      2026-08-27. El mismo modo de fallo mudo que 20260906000000 vino a
--      cerrar.
--
-- POR QUÉ NINGUNA GUARDA LO VIO. `drift-esquema` comprueba que lo que declara
-- una migración registrada exista en producción; no que los cuerpos de las
-- funciones sigan resolviendo. Y `completado_por` ni siquiera figura entre lo
-- declarado: lo crea el bucle dinámico de 20260731000000 con EXECUTE format(),
-- el punto ciego documentado del parser.
--
-- EL DESACUERDO DE FONDO, que se cierra de paso. Ese bucle sólo agrega la
-- columna de autor si YA existe la del hito:
--
--   ['tareas_bloque', 'completado_en', 'completado_por']   -- 20260731000000:253
--
-- En producción existía `completado_en`, así que `completado_por` se creó y el
-- trigger se instaló. En un esquema construido desde supabase/migrations la
-- columna se llama `completada_en`, el bucle hace CONTINUE y `completado_por`
-- NO EXISTE. Por eso no basta con corregir la RPC: en una base nueva seguiría
-- sin poder ejecutarse, porque `tb.completado_por` no está. El arreglo tiene
-- que valer en los dos mundos.
--
-- SE CONSERVA EL NOMBRE `completado_por`. Es el que ya tiene producción, el que
-- lee la RPC y el que espera #785. Renombrarlo a `completada_por` por simetría
-- sería otro renombre con la misma clase de arrastre que estamos pagando aquí.
--
-- IDEMPOTENTE y NO-OP donde ya está bien: todo va con guarda por catálogo.
-- REVERSA: reinstalar el trigger con el hito viejo y re-declarar la RPC desde
-- 20260829000600. La columna se deja: quitarla borraría quién cerró cada tarea.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. `completado_por` existe en los dos mundos
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.tareas_bloque') IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.tareas_bloque'::regclass
       AND attname = 'completado_por' AND attnum > 0 AND NOT attisdropped
  ) THEN
    ALTER TABLE public.tareas_bloque
      ADD COLUMN completado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;
    RAISE NOTICE 'DRIFT: tareas_bloque.completado_por NO existía y se creó.';
  END IF;

  COMMENT ON COLUMN public.tareas_bloque.completado_por IS
    'Usuario que marcó completada_en. Lo sella la BD (trg_sellar_cierre).';
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. El trigger de sellado vuelve a apuntar al hito que existe
-- ────────────────────────────────────────────────────────────────────────────
-- Estático y sobre el nombre real, en vez del bucle dinámico de
-- 20260731000000: aquél se lo saltaba entero cuando el hito no cuadraba, que es
-- justamente cómo esto se pudo torcer sin ruido.
DO $$
BEGIN
  IF to_regclass('public.tareas_bloque') IS NULL THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'sellar_cierre' AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'SELLADO_TAREAS: falta public.sellar_cierre(); no se puede '
                    'reinstalar trg_sellar_cierre sobre tareas_bloque.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.tareas_bloque'::regclass
       AND attname = 'completada_en' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'SELLADO_TAREAS: tareas_bloque.completada_en no existe. '
                    'Aplica 20260906000000 antes que esta migración.';
  END IF;

  DROP TRIGGER IF EXISTS trg_sellar_cierre ON public.tareas_bloque;
  CREATE TRIGGER trg_sellar_cierre
    BEFORE UPDATE ON public.tareas_bloque
    FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('completada_en', 'completado_por');
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. `actividad_equipo` deja de leer una columna que no existe
-- ────────────────────────────────────────────────────────────────────────────
-- Copia LITERAL de 20260829000600:466-664 salvo las tres apariciones de
-- `tb.completado_en`, que pasan a `tb.completada_en` — una en el SELECT del
-- UNION ALL de limpiezas y dos en su WHERE. Misma práctica que siguió
-- 20260829000600 con la versión de 20260731000300: se repite el cuerpo entero
-- para que el diff muestre exactamente qué cambió.
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
    SELECT tb.completado_por, 'limpiezas', 0, tb.completada_en
      FROM public.tareas_bloque tb
      JOIN public.bloques_turno bt ON bt.id = tb.bloque_id
     WHERE bt.project_id = p_project_id
       AND tb.completado_por IS NOT NULL
       AND tb.completada_en >= v_desde AND tb.completada_en < v_hasta

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
       -- ÚNICO CAMBIO respecto de 20260731000300: la tabla ahora también
       -- guarda correspondencia. La métrica contaba paquetes y sigue contando
       -- paquetes; sin este filtro subiría sola el día de la unificación.
       AND pr.clase = 'paquete'
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

REVOKE EXECUTE ON FUNCTION public.actividad_equipo(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.actividad_equipo(uuid, date, date) TO authenticated;
