-- ════════════════════════════════════════════════════════════════════════════
-- Limpieza · el paso opcional de una rutina deja de contar como pendiente
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. El editor de rutinas (Condominios → Recursos Humanos → Limpieza →
-- Rutinas) marca cada paso «Obligatorio» u «Opcional» y lo guarda en
-- `rutina_actividades.obligatoria` (20260907000200). La columna dice «false =
-- paso opcional; la rutina se da por cumplida sin él. Se aplica al
-- materializar, en PRs posteriores», y eso nunca se hizo: ni
-- limpieza_asignar_rutinas (20261103000000) ni materializar_rutinas_turno
-- (20261102000000) lo leían, y `tareas_bloque` no tenía dónde ponerlo. Una
-- rutina con un paso opcional generaba las mismas tareas que una sin él, y el
-- opcional sin hacer contaba en Pendientes, en Atrasadas y en el puntaje de
-- cierre del turno.
--
-- QUÉ HACE
--   1. `tareas_bloque.obligatoria boolean NOT NULL DEFAULT true`. Toda tarea
--      que ya existe queda obligatoria —así se contaba— y también la que se
--      crea fuera de una rutina (a mano, «cargar tareas del cargo»).
--   2. `limpieza_asignar_rutinas` y `materializar_rutinas_turno` la COPIAN del
--      paso al crear la tarea, como copian duración, checklist y el resto de
--      lo que declara la actividad: es una foto del momento. Editar la rutina
--      después no reescribe las tareas ya asignadas, igual que no reescribe su
--      título ni su duración (criterio de 20260907000600).
--   3. Si en UNA llamada dos pasos caen en la misma tarea (la misma actividad
--      en la misma área, de dos rutinas o del paso legado y una parada), la
--      tarea es UNA (uq_tareas_bloque_plantilla_area) y es obligatoria si
--      CUALQUIERA de esos pasos lo es. Gana la exigencia: que el turno quede
--      con la tarea opcional dependería de qué fila insertó primero el motor.
--      Lo que el turno ya tenía no se toca (es la regla de siempre: «lo que ya
--      está no se vuelve a crear»).
--   4. `limpieza_calendario` deja de contar el opcional sin hacer:
--        · `pendientes` = obligatorias pendientes y no anuladas;
--        · `opcionales_sin_hacer` (nuevo) = opcionales que no están completas
--          ni con observación, para que los indicadores lo saquen del total.
--      `tareas`, `hechas` y `trabajadas` no cambian: el opcional HECHO suma
--      como cualquier otro.
--
-- LA REGLA DEL PUNTAJE, que la pantalla aplica al cerrar el turno (decidida con
-- el dueño del producto): el opcional SUMA SI SE HACE y NO RESTA SI NO. Sin
-- hacer sale del total; hecho cuenta en el total y en lo hecho.
--
-- POR QUÉ UNA COLUMNA Y NO UN JOIN AL PASO. La tarea no guarda de qué paso
-- salió (rutina, actividad y área no lo identifican cuando el paso legado y una
-- parada coinciden), quien ejecuta el turno no lee `rutina_actividades` por RLS
-- (gate del tab de Limpieza), y leerlo «en vivo» haría que editar la rutina hoy
-- cambiara cómo se contó un turno de la semana pasada.
--
-- QUIÉN LA PUEDE CAMBIAR. Lo mismo que `requiere_foto` y el resto de la foto:
-- quien puede editar la tarea (tareas_bloque_update). No se le pone un candado
-- propio porque no cerraría nada: quien edita la tarea ya puede marcarla hecha,
-- y el puntaje lo escribe la pantalla en bloques_turno.
--
-- DEPENDE DE 20261225000000. `tabla:tareas_bloque/columnas` estaba declarada
-- como drift; esa migración hizo converger el grupo a producción, así que la
-- columna nueva es un CAMBIO PLANIFICADO para el auditor de tres vías y no uno
-- ambiguo.
--
-- LAS FUNCIONES SE REESCRIBEN ENTERAS, con el texto de su versión anterior
-- intacto salvo lo que esta migración agrega. No es estética: los mutantes de
-- supabase/tests/limpieza_calendario y rutinas_recorrido mutan también la
-- versión viva, y lo encuentran por texto. Si alguien reescribe una de estas
-- funciones y pierde una compuerta, esas suites lo dicen.
--
-- REVERSIÓN
--   Volver a aplicar las definiciones de limpieza_asignar_rutinas y
--   limpieza_calendario de 20261103000000 y la de materializar_rutinas_turno
--   de 20261102000000, y después
--   ALTER TABLE public.tareas_bloque DROP COLUMN obligatoria;
--   Las tareas siguen donde están; sólo se pierde cuáles eran opcionales.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS y CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La columna ────────────────────────────────────────────────────────────
-- Con un default constante, el ADD COLUMN no reescribe la tabla (PG ≥ 11).
ALTER TABLE public.tareas_bloque
  ADD COLUMN IF NOT EXISTS obligatoria boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tareas_bloque.obligatoria IS
  'false = tarea opcional: sin hacer no cuenta como pendiente ni en el puntaje de cierre; hecha suma como cualquier otra. Se copia del paso de la rutina al asignarla (limpieza_asignar_rutinas, materializar_rutinas_turno); las tareas fuera de una rutina nacen obligatorias.';

COMMENT ON COLUMN public.rutina_actividades.obligatoria IS
  'false = paso opcional; la rutina se da por cumplida sin él. Se copia a tareas_bloque.obligatoria al asignar la rutina (20261225000100).';

-- ── 2. Asignar rutinas a un turno ────────────────────────────────────────────
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
      -- (20261225000100) Lo declara el PASO, no la actividad: la misma
      -- actividad puede ser obligatoria en una rutina y opcional en otra.
      ra.obligatoria,
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
           ) AS pos,
           -- (20261225000100) Dos pasos que caen en la MISMA tarea (misma
           -- actividad y área; PARTITION BY agrupa los NULL como el índice
           -- NULLS NOT DISTINCT) son una sola, y es obligatoria si cualquiera
           -- lo es. Así no depende de qué fila inserte primero el motor.
           bool_or(c.obligatoria) OVER (PARTITION BY c.plantilla_id, c.area_id) AS obligatoria_tarea
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
      requiere_comentario, requiere_checklist, obligatoria, orden, estado
    )
    SELECT
      v_b.id, n.plantilla_id, n.rutina_id, n.titulo, n.descripcion, n.area_id,
      n.requiere_foto, n.duracion_estimada_min, n.checklist, n.instrucciones_seguridad,
      n.requiere_comentario, n.requiere_checklist, n.obligatoria_tarea, bs.max_orden + n.pos, 'pendiente'
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
  'Asigna rutinas a UN turno: crea sus tareas (área de la parada, orden rutina → parada → paso, copia de la actividad y de si el paso es obligatorio) detrás de lo que el turno ya tenía, en el orden pedido. No duplica ni resucita lo anulado; si dos pasos caen en la misma tarea, es obligatoria si cualquiera lo es. Exige prog_limpieza.edit, empresa, proyecto, turno abierto y fecha de hoy en adelante.';

REVOKE EXECUTE ON FUNCTION public.limpieza_asignar_rutinas(uuid, uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.limpieza_asignar_rutinas(uuid, uuid[]) TO authenticated, service_role;

-- ── 3. El mes: el opcional sin hacer ya no es «pendiente» ────────────────────
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
             'trabajadas', x.trabajadas,
             'opcionales_sin_hacer', x.opcionales_sin_hacer
           ) ORDER BY x.primera) AS rutinas
    FROM (
      SELECT tb.rutina_id,
             count(*)::int AS tareas,
             -- (20261225000100) Pendiente es lo que FALTA: el opcional sin
             -- hacer no falta, la rutina se da por cumplida sin él.
             count(*) FILTER (WHERE tb.estado = 'pendiente' AND tb.anulada_en IS NULL AND tb.obligatoria)::int AS pendientes,
             count(*) FILTER (WHERE tb.estado IN ('completada', 'con_observacion'))::int AS hechas,
             count(*) FILTER (WHERE public.limpieza_tarea_trabajada(tb))::int AS trabajadas,
             -- Lo que los indicadores sacan del total: el opcional que no se
             -- hizo (pendiente, omitido o anulado). Hecho, suma.
             count(*) FILTER (WHERE NOT tb.obligatoria AND tb.estado NOT IN ('completada', 'con_observacion'))::int AS opcionales_sin_hacer,
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
  'Calendario de limpieza: los turnos del rango (≤ 92 días) con nombre, cargo y estado de la persona, su jornada y las rutinas que tiene asignadas (tareas, pendientes obligatorias, hechas, trabajadas, opcionales sin hacer). Exige condominios.tab.prog_limpieza, empresa y acceso al proyecto; proyecta lo mínimo del personal (patrón de rutas_operadores_asignables).';

REVOKE EXECUTE ON FUNCTION public.limpieza_calendario(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.limpieza_calendario(uuid, date, date) TO authenticated, service_role;

-- ── 4. «Generar tareas» por jornada: la misma copia ──────────────────────────
-- Ninguna pantalla la llama desde 20261103000000, pero sigue expuesta a
-- `authenticated`: si alguien la invoca, sus tareas tienen que nacer igual que
-- las del calendario.
CREATE OR REPLACE FUNCTION public.materializar_rutinas_turno(
  p_project_id uuid,
  p_desde      date DEFAULT NULL,
  p_hasta      date DEFAULT NULL
)
RETURNS TABLE (
  generadas               int,
  omitidas_existente      int,
  omitidas_bloque_cerrado int,
  rutinas_sin_jornada     int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_desde   date := COALESCE(p_desde, CURRENT_DATE);
  v_hasta   date;
BEGIN
  v_hasta := COALESCE(p_hasta, v_desde + 30);

  IF v_hasta < v_desde THEN
    RAISE EXCEPTION 'el rango termina antes de empezar' USING ERRCODE = '22007';
  END IF;

  -- Mismo techo duro que generar_bloques_turno: una rutina de 10 pasos sobre
  -- 20 bloques diarios a un año son 73.000 filas en una sola llamada.
  IF v_hasta - v_desde > 400 THEN
    RAISE EXCEPTION 'el rango no puede exceder 400 días' USING ERRCODE = '22003';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  -- Guard de scope (20260729000200) + permiso del tab. La SECURITY DEFINER se
  -- salta la RLS, así que este control ES el control.
  PERFORM public.assert_company_scope(v_company);

  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.prog_limpieza')
          OR public.user_has_permission('condominios.tab.turnos')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  WITH candidatas AS (
    SELECT
      b.id            AS bloque_id,
      r.id            AS rutina_id,
      p.id            AS plantilla_id,
      p.titulo,
      p.descripcion,
      -- (recorrido) El área de la parada. El paso legado (sin parada): la de
      -- la actividad y, si no declara ninguna, la de la rutina. Las tres son
      -- del mismo proyecto por construcción (FKs compuestas de 20260907000200
      -- y de rutina_areas), así que no puede colarse un área ajena.
      COALESCE(rz.area_id, p.area_id, r.area_id) AS area_id,
      p.requiere_foto,
      p.duracion_estimada_min,
      COALESCE(p.checklist, '[]'::jsonb) AS checklist,
      p.instrucciones_seguridad,
      p.requiere_comentario,
      p.requiere_checklist,
      -- (20261225000100) Si el paso es obligatorio. Dos pasos que caen en la
      -- MISMA tarea del bloque (misma actividad y área) son una sola, y es
      -- obligatoria si cualquiera lo es: la misma regla que el calendario.
      bool_or(ra.obligatoria) OVER (
        PARTITION BY b.id, p.id, COALESCE(rz.area_id, p.area_id, r.area_id)
      ) AS obligatoria,
      b.estado        AS bloque_estado,
      b.cerrado_en    AS bloque_cerrado_en,
      -- Denso y determinista: el `orden` de la rutina puede tener huecos, y dos
      -- rutinas pueden caer en el mismo bloque. (recorrido) Dentro de la
      -- rutina, primero los pasos legados y después las paradas en su orden.
      row_number() OVER (
        PARTITION BY b.id
        ORDER BY r.orden, r.nombre, r.id,
                 rz.orden NULLS FIRST, rz.id NULLS FIRST,
                 ra.orden, p.titulo, p.id
      ) AS pos,
      -- La fila ya existente cuenta AUNQUE esté anulada: anular es una decisión
      -- y re-materializar no la desautoriza. (recorrido) La identidad incluye
      -- el área, igual que uq_tareas_bloque_plantilla_area.
      EXISTS (
        SELECT 1 FROM public.tareas_bloque tb
        WHERE tb.bloque_id = b.id AND tb.plantilla_id = p.id
          AND tb.area_id IS NOT DISTINCT FROM COALESCE(rz.area_id, p.area_id, r.area_id)
      ) AS ya_existe
    FROM public.rutinas_limpieza  r
    JOIN public.rutina_actividades ra ON ra.rutina_id = r.id
    LEFT JOIN public.rutina_areas  rz ON rz.id = ra.rutina_area_id
    LEFT JOIN public.areas_condominio za ON za.id = rz.area_id
    JOIN public.plantillas_tarea_cargo p ON p.id = ra.plantilla_tarea_id
    JOIN public.bloques_turno      b  ON b.plantilla_horario_id = r.plantilla_horario_id
                                     AND b.project_id = r.project_id
    WHERE r.project_id = p_project_id
      AND r.company_id = v_company
      AND r.activa
      AND r.plantilla_horario_id IS NOT NULL
      -- La actividad dada de baja no se materializa: sigue en la rutina para no
      -- perder la definición, pero no genera trabajo nuevo.
      AND p.activo
      -- (recorrido) Lo mismo para la parada de un área dada de baja.
      AND (rz.id IS NULL OR za.activo)
      AND b.fecha BETWEEN v_desde AND v_hasta
  ),
  -- El desplazamiento por bloque: lo nuevo entra DETRÁS de lo que ya había.
  base AS (
    SELECT c.bloque_id, COALESCE(MAX(tb.orden), -1) AS max_orden
    FROM (SELECT DISTINCT bloque_id FROM candidatas) c
    LEFT JOIN public.tareas_bloque tb ON tb.bloque_id = c.bloque_id
    GROUP BY c.bloque_id
  ),
  insertadas AS (
    INSERT INTO public.tareas_bloque (
      bloque_id, plantilla_id, rutina_id, titulo, descripcion, area_id,
      requiere_foto, duracion_estimada_min, checklist, instrucciones_seguridad,
      requiere_comentario, requiere_checklist, obligatoria, orden, estado
    )
    SELECT
      c.bloque_id, c.plantilla_id, c.rutina_id, c.titulo, c.descripcion, c.area_id,
      c.requiere_foto, c.duracion_estimada_min, c.checklist, c.instrucciones_seguridad,
      c.requiere_comentario, c.requiere_checklist, c.obligatoria, bs.max_orden + c.pos, 'pendiente'
    FROM candidatas c
    JOIN base bs ON bs.bloque_id = c.bloque_id
    WHERE NOT c.ya_existe
      -- Un turno terminado no recibe tareas nuevas.
      AND c.bloque_cerrado_en IS NULL
      AND c.bloque_estado NOT IN ('completado', 'incompleto')
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM insertadas)::int,
    (SELECT count(*) FROM candidatas WHERE ya_existe)::int,
    (SELECT count(*) FROM candidatas
      WHERE NOT ya_existe
        AND (bloque_cerrado_en IS NOT NULL
             OR bloque_estado IN ('completado', 'incompleto')))::int,
    (SELECT count(*) FROM public.rutinas_limpieza r2
      WHERE r2.project_id = p_project_id
        AND r2.company_id = v_company
        AND r2.activa
        AND r2.plantilla_horario_id IS NULL)::int
  INTO generadas, omitidas_existente, omitidas_bloque_cerrado, rutinas_sin_jornada;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) IS
  'Convierte las rutinas activas de un proyecto en tareas de bloques_turno para el rango dado (por defecto 30 días desde hoy), emparejando por jornada. Sigue el recorrido de la rutina: el área de cada tarea es la de su parada y el orden es rutina → parada → paso. Copia lo que la actividad declara y si el paso es obligatorio; no pisa lo existente ni resucita lo anulado; no toca bloques cerrados ni áreas o actividades dadas de baja. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.materializar_rutinas_turno(uuid, date, date) TO authenticated, service_role;
