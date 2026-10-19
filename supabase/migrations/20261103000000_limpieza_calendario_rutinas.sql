-- ════════════════════════════════════════════════════════════════════════════
-- Limpieza · calendario: cada rutina se le asigna a una persona en un día de su turno
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. Hasta aquí una rutina entraba al trabajo de dos maneras, y ninguna
-- servía para repartir:
--
--   · «Generar tareas» (materializar_rutinas_turno, 20261102000000) le daba la
--     rutina a TODOS los turnos de su jornada: no hay forma de decir que el
--     recorrido de los niveles 1–4 lo hace Ana y el de los sótanos, Luis.
--   · La vista «Áreas» programaba cada área con frecuencia y responsable
--     (programacion_limpieza → ejecuciones_limpieza): otro motor, que no
--     conoce las rutinas ni los turnos.
--
-- La administración quiere un calendario: cada empleado con sus días de turno
-- del mes, y sobre cada día se suelta (o se agrega con ＋) la rutina que esa
-- persona tiene que hacer ese día.
--
-- QUÉ HACE
--   1. `limpieza_tarea_trabajada(tarea)` — la definición ÚNICA de «esta tarea ya
--      se tocó» (estado, cierre, anulación, evidencia, checklist, novedad,
--      revisión o insumo consumido). La usan la lectura (para ofrecer o no el
--      ✕) y el borrado (para negarlo): si divergieran, el calendario ofrecería
--      quitar lo que la base después rechaza.
--   2. `limpieza_asegurar_turno_programable(bloque)` — los controles comunes a
--      asignar y quitar: empresa, permiso de EDICIÓN del tab de Limpieza,
--      acceso al proyecto, turno abierto y día de hoy en adelante (zona de la
--      empresa).
--   3. `limpieza_calendario(proyecto, desde, hasta)` — los turnos del rango con
--      el nombre y el cargo de la persona, su jornada y, por turno, qué rutinas
--      tiene asignadas y cómo van (tareas, pendientes, hechas, trabajadas).
--   4. `limpieza_asignar_rutinas(bloque, rutinas[])` — crea en ese turno las
--      tareas del recorrido de cada rutina, con la misma regla que
--      materializar_rutinas_turno (área de la parada, orden rutina → parada →
--      paso, copia de lo que declara la actividad), DETRÁS de lo que el turno
--      ya tenía y en el orden en que se pidieron las rutinas.
--   5. `limpieza_quitar_rutina(bloque, rutina)` — borra las tareas de esa
--      rutina en ese turno mientras NINGUNA se haya trabajado. Si alguna sí, se
--      niega entera: lo trabajado es historia operativa y se corrige anulando
--      con motivo (Revisión), no borrando.
--
-- LA ASIGNACIÓN ES LA TAREA. No hay tabla de «planificación»: asignar una rutina
-- a un día ES crear sus tareas en el turno de ese día (tareas_bloque.rutina_id ya
-- dice de qué rutina salió cada una, desde 20260907000300). Una tabla aparte
-- obligaría a volver a «generar» y abriría la pregunta de qué manda cuando las
-- dos no coinciden.
--
-- SOLO DÍAS CON TURNO. Se asigna sobre un `bloques_turno` existente: el turno lo
-- crea «Asignación turnos» (generar el mes, o el día a mano). Esta migración no
-- crea turnos.
--
-- EL TURNO QUEDA OCUPADO. Un turno con tareas ya no se puede quitar ni
-- re-planificar desde «Asignación turnos» (turnos_asegurar_bloque_libre,
-- 20260916232549). Es la regla de siempre y se respeta: quitar la rutina
-- mientras nada esté trabajado deja el turno libre otra vez.
--
-- PERMISOS
--   · Lectura: `condominios.tab.prog_limpieza` + empresa + acceso al proyecto.
--     Es SECURITY DEFINER porque quien administra la limpieza tiene que ver A
--     QUIÉN le asigna: la RLS de personal_condominio pide el tab Personal y la
--     de plantillas_horario el de Turnos. Se proyecta lo mínimo —nombre, cargo
--     y estado de la persona; nombre, código y color de la jornada—: nada del
--     expediente (salario, DPI, cuenta, contactos). Es el patrón de
--     rutas_operadores_asignables (20260906000400).
--   · Escritura: `condominios_puede_actuar('prog_limpieza', 'edit')` —
--     visibilidad Y acción, no la clave de 3 segmentos a secas.
--
-- LO QUE NO HACE. No toca materializar_rutinas_turno (sigue existiendo; la
-- pantalla deja de ofrecerla) ni programacion_limpieza / ejecuciones_limpieza
-- (sus filas quedan como historia). No crea ni modifica turnos.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.limpieza_quitar_rutina(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.limpieza_asignar_rutinas(uuid, uuid[]);
--   DROP FUNCTION IF EXISTS public.limpieza_calendario(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.limpieza_asegurar_turno_programable(public.bloques_turno);
--   DROP FUNCTION IF EXISTS public.limpieza_tarea_trabajada(public.tareas_bloque);
-- Las tareas ya asignadas son tareas_bloque normales y siguen donde están.
--
-- Idempotente: CREATE OR REPLACE en las cinco funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Esta tarea ya se trabajó? ────────────────────────────────────────────
-- SQL sin SECURITY DEFINER ni SET: así se puede inlinear en la lectura del mes,
-- que la evalúa por fila. Sólo la llaman las funciones de abajo, que corren como
-- su dueño; por eso no hace falta que `authenticated` la ejecute.
CREATE OR REPLACE FUNCTION public.limpieza_tarea_trabajada(t public.tareas_bloque)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT t.estado <> 'pendiente'
      OR t.completada_en IS NOT NULL
      OR t.completado_por IS NOT NULL
      OR t.anulada_en IS NOT NULL
      OR NULLIF(btrim(t.evidencia_texto), '') IS NOT NULL
      OR NULLIF(btrim(t.motivo_sin_evidencia), '') IS NOT NULL
      OR NULLIF(btrim(t.novedad), '') IS NOT NULL
      OR NULLIF(btrim(t.notas_operativo), '') IS NOT NULL
      OR COALESCE(t.requiere_mantenimiento, false)
      -- Cualquier valor que no sea «vacío» cuenta: una foto o un paso marcado
      -- es trabajo, y un valor raro no se interpreta a favor de borrar.
      OR COALESCE(t.foto_urls, '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb)
      OR COALESCE(t.checklist_completado, '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb)
      OR EXISTS (SELECT 1 FROM public.revisiones_tarea r WHERE r.tarea_id = t.id)
      -- El plan de insumos se copia al crear la tarea (20260907000500): la fila
      -- en sí no es trabajo; sí lo es haberla consumido o declarado no usada.
      OR EXISTS (SELECT 1 FROM public.tarea_bloque_suministros s
                 WHERE s.tarea_id = t.id
                   AND (s.movimiento_id IS NOT NULL OR s.no_usado_en IS NOT NULL))
$$;

COMMENT ON FUNCTION public.limpieza_tarea_trabajada(public.tareas_bloque) IS
  'true si la tarea ya se tocó: estado distinto de pendiente, cerrada, anulada, con evidencia, checklist, novedad, revisión o insumo consumido. Definición única para el calendario de limpieza (qué rutina se puede quitar de un turno).';

REVOKE EXECUTE ON FUNCTION public.limpieza_tarea_trabajada(public.tareas_bloque) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.limpieza_tarea_trabajada(public.tareas_bloque) TO service_role;

-- ── 2. ¿Se puede programar este turno? ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.limpieza_asegurar_turno_programable(p_bloque public.bloques_turno)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hoy date;
BEGIN
  PERFORM public.assert_company_scope(p_bloque.company_id);

  IF NOT public.is_super_admin() THEN
    IF NOT public.condominios_puede_actuar('prog_limpieza', 'edit') THEN
      RAISE EXCEPTION 'No autorizado para programar la limpieza' USING ERRCODE = '42501';
    END IF;
    -- Sin esto, alguien acotado a un condominio programaría los turnos de otro
    -- de la misma empresa: la empresa sola no alcanza.
    IF NOT public.can_access_project(p_bloque.project_id) THEN
      RAISE EXCEPTION 'Proyecto fuera de tu alcance' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_bloque.cerrado_en IS NOT NULL OR p_bloque.estado IN ('completado', 'cancelado') THEN
    RAISE EXCEPTION 'El turno del % ya está cerrado: no se le asigna ni se le quita trabajo', p_bloque.fecha
      USING ERRCODE = '55000';
  END IF;

  -- «Hoy» es el de la EMPRESA, como en turnos_asegurar_dia_futuro: CURRENT_DATE
  -- es UTC y a las 18:00 de Guatemala ya sería mañana.
  v_hoy := (now() AT TIME ZONE public.presencia_zona_horaria(p_bloque.company_id))::date;
  IF p_bloque.fecha < v_hoy THEN
    RAISE EXCEPTION 'El % ya pasó: el calendario programa de hoy en adelante', p_bloque.fecha
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.limpieza_asegurar_turno_programable(public.bloques_turno) IS
  'Controles comunes a asignar y quitar rutinas de un turno: empresa, condominios_puede_actuar(prog_limpieza, edit), acceso al proyecto, turno abierto y fecha de hoy en adelante en la zona de la empresa. 42501 / 55000.';

REVOKE EXECUTE ON FUNCTION public.limpieza_asegurar_turno_programable(public.bloques_turno) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.limpieza_asegurar_turno_programable(public.bloques_turno) TO service_role;

-- ── 3. El mes: turnos, personas, jornadas y rutinas asignadas ────────────────
CREATE OR REPLACE FUNCTION public.limpieza_calendario(
  p_project_id uuid,
  p_desde      date,
  p_hasta      date
)
RETURNS TABLE (
  bloque_id            uuid,
  personal_id          uuid,
  personal_nombre      text,
  personal_cargo       text,
  personal_estado      text,
  fecha                date,
  turno                text,
  estado               text,
  iniciado_en          timestamptz,
  cerrado_en           timestamptz,
  plantilla_horario_id uuid,
  jornada_nombre       text,
  jornada_codigo       text,
  jornada_color        text,
  hora_inicio          time,
  hora_fin             time,
  horas_planificadas   numeric,
  rutinas              jsonb,
  otras_tareas         int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'Rango de fechas inválido' USING ERRCODE = '22023';
  END IF;
  -- Un mes con sus semanas de borde (42 días) más holgura; los indicadores piden
  -- los últimos 30. Más que eso no lo pinta ninguna pantalla.
  IF p_hasta - p_desde > 92 THEN
    RAISE EXCEPTION 'El rango no puede exceder 92 días' USING ERRCODE = '22003';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_company_scope(v_company);

  IF NOT public.is_super_admin() THEN
    IF NOT public.user_has_permission('condominios.tab.prog_limpieza') THEN
      RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_access_project(p_project_id) THEN
      RAISE EXCEPTION 'Proyecto fuera de tu alcance' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.personal_id,
    pc.nombre,
    pc.cargo,
    pc.estado,
    b.fecha,
    b.turno,
    b.estado,
    b.iniciado_en,
    b.cerrado_en,
    b.plantilla_horario_id,
    ph.nombre,
    ph.codigo,
    ph.color,
    -- Los bloques anteriores a 20260820000000 no tienen horas propias.
    COALESCE(b.hora_inicio, ph.hora_inicio),
    COALESCE(b.hora_fin, ph.hora_fin),
    b.horas_planificadas,
    COALESCE(asig.rutinas, '[]'::jsonb),
    COALESCE(otras.n, 0)
  FROM public.bloques_turno b
  JOIN public.personal_condominio pc ON pc.id = b.personal_id
  LEFT JOIN public.plantillas_horario ph ON ph.id = b.plantilla_horario_id
  -- Por rutina, en el orden en que entraron al turno (su primera tarea).
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
             'rutina_id',  x.rutina_id,
             'tareas',     x.tareas,
             'pendientes', x.pendientes,
             'hechas',     x.hechas,
             'trabajadas', x.trabajadas
           ) ORDER BY x.primera) AS rutinas
    FROM (
      SELECT tb.rutina_id,
             count(*)::int AS tareas,
             count(*) FILTER (WHERE tb.estado = 'pendiente' AND tb.anulada_en IS NULL)::int AS pendientes,
             count(*) FILTER (WHERE tb.estado IN ('completada', 'con_observacion'))::int AS hechas,
             count(*) FILTER (WHERE public.limpieza_tarea_trabajada(tb))::int AS trabajadas,
             min(tb.orden) AS primera
      FROM public.tareas_bloque tb
      WHERE tb.bloque_id = b.id AND tb.rutina_id IS NOT NULL
      GROUP BY tb.rutina_id
    ) x
  ) asig ON true
  -- Lo que el turno tiene fuera de las rutinas (tareas sueltas de «Tareas por
  -- turno»): no se programa aquí, pero se avisa para que el tiempo no engañe.
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n
    FROM public.tareas_bloque tb
    WHERE tb.bloque_id = b.id AND tb.rutina_id IS NULL AND tb.anulada_en IS NULL
  ) otras ON true
  WHERE b.project_id = p_project_id
    AND b.company_id = v_company
    AND b.fecha BETWEEN p_desde AND p_hasta
  ORDER BY pc.nombre, b.personal_id, b.fecha,
           COALESCE(b.hora_inicio, ph.hora_inicio) NULLS LAST, b.created_at;
END;
$$;

COMMENT ON FUNCTION public.limpieza_calendario(uuid, date, date) IS
  'Calendario de limpieza: los turnos del rango (≤ 92 días) con nombre, cargo y estado de la persona, su jornada y las rutinas que tiene asignadas (tareas, pendientes, hechas, trabajadas). Exige condominios.tab.prog_limpieza, empresa y acceso al proyecto; proyecta lo mínimo del personal (patrón de rutas_operadores_asignables).';

REVOKE EXECUTE ON FUNCTION public.limpieza_calendario(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.limpieza_calendario(uuid, date, date) TO authenticated, service_role;

-- ── 4. Asignar rutinas a un turno ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.limpieza_asignar_rutinas(
  p_bloque_id  uuid,
  p_rutina_ids uuid[]
)
RETURNS TABLE (
  generadas          int,
  omitidas_existente int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_b       public.bloques_turno%ROWTYPE;
  v_n       int := COALESCE(cardinality(p_rutina_ids), 0);
  v_vacia   text;
BEGIN
  IF v_n = 0 OR array_position(p_rutina_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Hay que indicar al menos una rutina' USING ERRCODE = '22023';
  END IF;
  IF v_n > 50 THEN
    RAISE EXCEPTION 'No se asignan más de 50 rutinas de una vez' USING ERRCODE = '22023';
  END IF;

  -- El turno se bloquea: dos asignaciones simultáneas calcularían el mismo
  -- `orden` de partida, y una que corre junto a un quitar vería un estado a
  -- medias.
  SELECT * INTO v_b FROM public.bloques_turno WHERE id = p_bloque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno inexistente' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.limpieza_asegurar_turno_programable(v_b);

  IF EXISTS (
    SELECT 1 FROM unnest(p_rutina_ids) AS u(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.rutinas_limpieza r
      WHERE r.id = u.id
        AND r.project_id = v_b.project_id
        AND r.company_id = v_b.company_id
        AND r.activa
    )
  ) THEN
    RAISE EXCEPTION 'Rutina inexistente, inactiva o de otro condominio' USING ERRCODE = '22023';
  END IF;

  -- Una rutina sin actividades vigentes no generaría nada, y el calendario no
  -- tendría cómo mostrarla asignada: se dice en vez de «asignar» en silencio.
  SELECT r.nombre INTO v_vacia
  FROM public.rutinas_limpieza r
  WHERE r.id = ANY (p_rutina_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.rutina_actividades ra
      LEFT JOIN public.rutina_areas rz ON rz.id = ra.rutina_area_id
      LEFT JOIN public.areas_condominio za ON za.id = rz.area_id
      JOIN public.plantillas_tarea_cargo p ON p.id = ra.plantilla_tarea_id
      WHERE ra.rutina_id = r.id AND p.activo AND (rz.id IS NULL OR za.activo)
    )
  ORDER BY r.nombre
  LIMIT 1;
  IF v_vacia IS NOT NULL THEN
    RAISE EXCEPTION 'La rutina «%» no tiene actividades activas en su recorrido', v_vacia
      USING ERRCODE = '22023';
  END IF;

  WITH pedidas AS (
    -- La misma rutina dos veces en la lista cuenta una: vale su primera posición.
    SELECT u.id AS rutina_id, min(u.k) AS k
    FROM unnest(p_rutina_ids) WITH ORDINALITY AS u(id, k)
    GROUP BY u.id
  ),
  candidatas AS (
    SELECT
      r.id AS rutina_id,
      p.id AS plantilla_id,
      p.titulo,
      p.descripcion,
      -- La misma regla que materializar_rutinas_turno (20261102000000): el área
      -- de la parada; el paso legado, la de la actividad o la de la rutina.
      COALESCE(rz.area_id, p.area_id, r.area_id) AS area_id,
      p.requiere_foto,
      p.duracion_estimada_min,
      COALESCE(p.checklist, '[]'::jsonb) AS checklist,
      p.instrucciones_seguridad,
      p.requiere_comentario,
      p.requiere_checklist,
      pe.k,
      rz.orden AS orden_parada,
      rz.id    AS parada_id,
      ra.orden AS orden_paso,
      -- Lo que ya está —aunque esté anulado— no se vuelve a crear: anular es una
      -- decisión, y re-asignar no la desautoriza.
      EXISTS (
        SELECT 1 FROM public.tareas_bloque tb
        WHERE tb.bloque_id = v_b.id AND tb.plantilla_id = p.id
          AND tb.area_id IS NOT DISTINCT FROM COALESCE(rz.area_id, p.area_id, r.area_id)
      ) AS ya_existe
    FROM pedidas pe
    JOIN public.rutinas_limpieza r ON r.id = pe.rutina_id
    JOIN public.rutina_actividades ra ON ra.rutina_id = r.id
    LEFT JOIN public.rutina_areas rz ON rz.id = ra.rutina_area_id
    LEFT JOIN public.areas_condominio za ON za.id = rz.area_id
    JOIN public.plantillas_tarea_cargo p ON p.id = ra.plantilla_tarea_id
    WHERE p.activo
      AND (rz.id IS NULL OR za.activo)
  ),
  nuevas AS (
    -- Denso y determinista: en el orden en que se pidieron las rutinas y, dentro
    -- de cada una, pasos legados → paradas → pasos.
    SELECT c.*,
           row_number() OVER (
             ORDER BY c.k, c.orden_parada NULLS FIRST, c.parada_id NULLS FIRST,
                      c.orden_paso, c.titulo, c.plantilla_id
           ) AS pos
    FROM candidatas c
    WHERE NOT c.ya_existe
  ),
  base AS (
    SELECT COALESCE(MAX(tb.orden), -1) AS max_orden
    FROM public.tareas_bloque tb
    WHERE tb.bloque_id = v_b.id
  ),
  insertadas AS (
    INSERT INTO public.tareas_bloque (
      bloque_id, plantilla_id, rutina_id, titulo, descripcion, area_id,
      requiere_foto, duracion_estimada_min, checklist, instrucciones_seguridad,
      requiere_comentario, requiere_checklist, orden, estado
    )
    SELECT
      v_b.id, n.plantilla_id, n.rutina_id, n.titulo, n.descripcion, n.area_id,
      n.requiere_foto, n.duracion_estimada_min, n.checklist, n.instrucciones_seguridad,
      n.requiere_comentario, n.requiere_checklist, bs.max_orden + n.pos, 'pendiente'
    FROM nuevas n CROSS JOIN base bs
    -- Dos rutinas pedidas juntas con la misma actividad en la misma área son UNA
    -- tarea (uq_tareas_bloque_plantilla_area): la segunda se omite.
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM insertadas)::int,
    ((SELECT count(*) FROM candidatas) - (SELECT count(*) FROM insertadas))::int
  INTO generadas, omitidas_existente;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.limpieza_asignar_rutinas(uuid, uuid[]) IS
  'Asigna rutinas a UN turno: crea sus tareas (área de la parada, orden rutina → parada → paso, copia de la actividad) detrás de lo que el turno ya tenía, en el orden pedido. No duplica ni resucita lo anulado. Exige prog_limpieza.edit, empresa, proyecto, turno abierto y fecha de hoy en adelante.';

REVOKE EXECUTE ON FUNCTION public.limpieza_asignar_rutinas(uuid, uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.limpieza_asignar_rutinas(uuid, uuid[]) TO authenticated, service_role;

-- ── 5. Quitar una rutina de un turno ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.limpieza_quitar_rutina(
  p_bloque_id uuid,
  p_rutina_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_b public.bloques_turno%ROWTYPE;
  v_n int;
BEGIN
  IF p_rutina_id IS NULL THEN
    RAISE EXCEPTION 'Hay que indicar la rutina' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_b FROM public.bloques_turno WHERE id = p_bloque_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno inexistente' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.limpieza_asegurar_turno_programable(v_b);

  -- Las filas se bloquean ANTES de mirarlas: un cierre que llega entre la
  -- comprobación y el DELETE borraría una tarea recién terminada. Con el lock,
  -- ese cierre espera y después no encuentra la fila.
  PERFORM 1 FROM public.tareas_bloque t
  WHERE t.bloque_id = v_b.id AND t.rutina_id = p_rutina_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.tareas_bloque t
    WHERE t.bloque_id = v_b.id AND t.rutina_id = p_rutina_id
      AND public.limpieza_tarea_trabajada(t)
  ) THEN
    RAISE EXCEPTION 'La rutina ya tiene tareas trabajadas en este turno: no se quita'
      USING ERRCODE = '55000',
            HINT = 'Lo trabajado es historia operativa; una tarea que no corresponde se anula con motivo desde Revisión.';
  END IF;

  -- El plan de insumos (tarea_bloque_suministros) cae en cascada; está intacto
  -- por la comprobación de arriba.
  DELETE FROM public.tareas_bloque t
  WHERE t.bloque_id = v_b.id AND t.rutina_id = p_rutina_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.limpieza_quitar_rutina(uuid, uuid) IS
  'Quita una rutina de UN turno borrando sus tareas, sólo si ninguna se trabajó (limpieza_tarea_trabajada); si alguna sí, 55000 y no borra nada. Mismos controles que limpieza_asignar_rutinas. Devuelve cuántas tareas borró (0 = no estaba).';

REVOKE EXECUTE ON FUNCTION public.limpieza_quitar_rutina(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.limpieza_quitar_rutina(uuid, uuid) TO authenticated, service_role;
