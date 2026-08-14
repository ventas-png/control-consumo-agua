-- ════════════════════════════════════════════════════════════════════════════
-- Control de asignación de turnos (3/5): materializar la recurrencia
--
-- PROBLEMA
-- 20260820000000 creó la REGLA (`asignaciones_turno`). Falta convertirla en los
-- días concretos que el personal ve en su calendario. Sin esto, la regla es un
-- documento: nadie sabe si el 15 de septiembre le toca a Pérez.
--
-- CÓMO
-- Dos funciones:
--   `turnos_regla_aplica(...)`   pura y determinista: ¿esta regla cae en esta
--                                fecha? Es la definición ejecutable de las diez
--                                periodicidades, y está duplicada a propósito en
--                                TypeScript (domain/condominios/turnos.ts) para
--                                que el calendario pueda pintar el futuro sin
--                                haberlo materializado todavía. Las dos
--                                implementaciones se prueban contra los mismos
--                                casos.
--   `generar_bloques_turno(...)` inserta en `bloques_turno` los días que faltan,
--                                saltándose ausencias aprobadas, días no
--                                laborables y lo ya existente.
--
-- POR QUÉ CON PARÁMETRO DE PROYECTO (y no como el cron de rutas)
-- `generar_ocurrencias_rutas()` (20260522000004) no recibe scope porque la
-- dispara pg_cron sin `auth.uid()`. Ésta la dispara una PERSONA desde el tab
-- ("Generar turnos de octubre"), así que recibe el proyecto y se acota: resuelve
-- la empresa del proyecto, llama a `assert_company_scope()` y además exige el
-- permiso RBAC del tab. Agendarla en cron después es trivial (un wrapper por
-- proyecto); hacerla sin scope ahora sería dejar que cualquier usuario generara
-- turnos de toda la base.
--
-- IDEMPOTENCIA. Tres capas, porque `ON CONFLICT` solo no basta:
--   1. Índice parcial `uq_bloques_turno_regla_fecha` — la misma regla no
--      materializa dos veces el mismo día.
--   2. `NOT ya_existe` — tampoco pisa un bloque MANUAL que alguien puso ese día
--      en ese turno. Re-generar nunca duplica ni sobrescribe decisiones humanas.
--   3. `ON CONFLICT DO NOTHING` — red de seguridad ante ejecuciones simultáneas.
--
-- QUÉ NO HACE: no borra. Si se desactiva una regla o se aprueba una ausencia
-- después de generar, los bloques ya creados siguen ahí — borrarlos en silencio
-- destruiría el checklist de tareas que cuelga de ellos (`tareas_bloque`
-- ON DELETE CASCADE). El tab los marca en rojo como "en conflicto" y quien
-- corresponda decide. Es deliberado: esta función solo suma.
--
-- IMPACTO EN DATOS: ninguno hasta que alguien la invoque. Entonces INSERTA en
-- `bloques_turno`; no actualiza ni borra filas existentes.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.generar_bloques_turno(uuid, date, date);
--   DROP FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date);
--   -- y, si se quiere deshacer lo generado:
--   DELETE FROM public.bloques_turno WHERE origen = 'recurrencia' AND estado = 'pendiente';
--
-- Idempotente: CREATE OR REPLACE en ambas funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. ¿Cae la regla en esta fecha? ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.turnos_regla_aplica(
  p_frecuencia         text,
  p_fecha_inicio       date,
  p_dias_semana        jsonb,
  p_intervalo_dias     int,
  p_dia_mes            int,
  p_mes_ancla          int,
  p_fechas_especificas jsonb,
  p_fecha              date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_meses      int;
  v_offset     int;
  v_dia_objetivo int;
  v_ultimo_dia int;
  v_semanas    int;
  v_encaja_dow boolean;
BEGIN
  IF p_fecha IS NULL OR p_fecha_inicio IS NULL OR p_fecha < p_fecha_inicio THEN
    RETURN false;
  END IF;

  -- Sin días declarados, el filtro semanal no filtra: la regla cubre la semana
  -- completa. Con días declarados, solo esos.
  v_encaja_dow :=
    COALESCE(jsonb_array_length(COALESCE(p_dias_semana, '[]'::jsonb)), 0) = 0
    OR p_dias_semana @> to_jsonb(EXTRACT(ISODOW FROM p_fecha)::int);

  CASE p_frecuencia
    WHEN 'unica' THEN
      RETURN p_fecha = p_fecha_inicio;

    WHEN 'diaria' THEN
      -- intervalo_dias = 2 → día sí, día no, contando desde fecha_inicio.
      RETURN (p_fecha - p_fecha_inicio) % GREATEST(COALESCE(p_intervalo_dias, 1), 1) = 0;

    WHEN 'semanal' THEN
      RETURN v_encaja_dow;

    WHEN 'quincenal' THEN
      -- Semanas completas desde el inicio: la 0, la 2, la 4… Así una regla
      -- "lunes y jueves cada quince días" cae en las dos semanas alternas
      -- correctas, y no en cuatro días seguidos.
      v_semanas := ((p_fecha - p_fecha_inicio) / 7)::int;
      RETURN v_encaja_dow AND v_semanas % 2 = 0;

    WHEN 'mensual'    THEN v_meses := 1;
    WHEN 'bimestral'  THEN v_meses := 2;
    WHEN 'trimestral' THEN v_meses := 3;
    WHEN 'semestral'  THEN v_meses := 6;
    WHEN 'anual'      THEN v_meses := 12;

    WHEN 'fechas' THEN
      RETURN COALESCE(p_fechas_especificas, '[]'::jsonb) @> to_jsonb(p_fecha::text);

    ELSE
      RETURN false;
  END CASE;

  -- ── Periodicidades por mes (mensual … anual) ──────────────────────────────
  -- El ancla es (año de fecha_inicio, mes_ancla o el mes de fecha_inicio). El
  -- salto se cuenta en meses absolutos, así que diciembre→enero avanza 1 y no
  -- retrocede 11.
  v_offset :=
    (EXTRACT(YEAR FROM p_fecha)::int - EXTRACT(YEAR FROM p_fecha_inicio)::int) * 12
    + (EXTRACT(MONTH FROM p_fecha)::int
       - COALESCE(p_mes_ancla, EXTRACT(MONTH FROM p_fecha_inicio)::int));

  IF ((v_offset % v_meses) + v_meses) % v_meses <> 0 THEN
    RETURN false;
  END IF;

  -- Día 31 en un mes de 30 cae el 30, y en febrero el 28 o el 29. Recortar es lo
  -- único razonable: la alternativa (saltarse el mes) dejaría al empleado sin
  -- turno siete veces al año.
  v_ultimo_dia := EXTRACT(DAY FROM (
    make_date(EXTRACT(YEAR FROM p_fecha)::int, EXTRACT(MONTH FROM p_fecha)::int, 1)
    + INTERVAL '1 month' - INTERVAL '1 day'
  ))::int;

  v_dia_objetivo := LEAST(
    COALESCE(p_dia_mes, EXTRACT(DAY FROM p_fecha_inicio)::int),
    v_ultimo_dia
  );

  RETURN EXTRACT(DAY FROM p_fecha)::int = v_dia_objetivo;
END;
$$;

COMMENT ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date) IS
  'Definición ejecutable de las 10 periodicidades de asignaciones_turno. Pura y determinista. Espejo de reglaAplicaEn() en src/domain/condominios/turnos.ts — si cambia una, cambia la otra.';

REVOKE EXECUTE ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date) TO authenticated, service_role;

-- ── 2. Materializar los días que faltan ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generar_bloques_turno(
  p_project_id uuid,
  p_desde      date DEFAULT NULL,
  p_hasta      date DEFAULT NULL
)
RETURNS TABLE (
  generados             int,
  omitidos_ausencia     int,
  omitidos_no_laborable int,
  omitidos_existente    int
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
  v_hasta := COALESCE(p_hasta, v_desde + 60);

  IF v_hasta < v_desde THEN
    RAISE EXCEPTION 'el rango termina antes de empezar' USING ERRCODE = '22007';
  END IF;

  -- Techo duro: una regla diaria sobre 20 empleados a 5 años son 36.500 filas en
  -- una sola llamada. El tab genera de mes en mes o de año en año.
  IF v_hasta - v_desde > 400 THEN
    RAISE EXCEPTION 'el rango no puede exceder 400 días' USING ERRCODE = '22003';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  -- Guard de scope (20260729000200): super_admin, la propia empresa, o
  -- service_role. Todo lo demás sale con 42501.
  PERFORM public.assert_company_scope(v_company);

  -- Y además el permiso del tab: leer el proyecto no habilita a llenarle la
  -- agenda al personal.
  IF NOT (public.is_super_admin() OR public.user_has_permission('condominios.tab.turnos')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  WITH candidatos AS (
    SELECT
      a.id            AS asignacion_id,
      a.company_id,
      a.project_id,
      a.personal_id,
      a.plantilla_horario_id,
      a.cubre_dias_no_laborables,
      ph.turno,
      ph.hora_inicio,
      ph.hora_fin,
      ph.cruza_medianoche,
      d::date         AS fecha
    FROM public.asignaciones_turno a
    JOIN public.plantillas_horario   ph ON ph.id = a.plantilla_horario_id
    JOIN public.personal_condominio  pc ON pc.id = a.personal_id
    -- Cast explícito a timestamp: con `date` los dos overloads de
    -- generate_series (timestamp / timestamptz) compiten y la resolución
    -- depende del planner.
    CROSS JOIN LATERAL generate_series(
      GREATEST(v_desde, a.fecha_inicio)::timestamp,
      LEAST(v_hasta, COALESCE(a.fecha_fin, v_hasta))::timestamp,
      INTERVAL '1 day'
    ) AS d
    WHERE a.project_id = p_project_id
      AND a.company_id = v_company
      AND a.activa
      AND ph.activo
      -- Un empleado dado de baja no recibe turnos nuevos. 'vacaciones' e
      -- 'incapacidad' NO se filtran aquí: los cubre el chequeo de ausencia por
      -- fecha, que es el que sabe cuándo vuelve.
      AND pc.estado <> 'inactivo'
      AND public.turnos_regla_aplica(
            a.frecuencia, a.fecha_inicio, a.dias_semana, a.intervalo_dias,
            a.dia_mes, a.mes_ancla, a.fechas_especificas, d::date)
  ),
  clasificados AS (
    SELECT
      c.*,
      EXISTS (
        SELECT 1 FROM public.ausencias_personal au
        WHERE au.personal_id = c.personal_id
          AND au.estado = 'aprobada'
          AND c.fecha BETWEEN au.fecha_inicio AND au.fecha_fin
      ) AS hay_ausencia,
      EXISTS (
        SELECT 1 FROM public.dias_no_laborables dnl
        WHERE dnl.project_id = c.project_id
          AND dnl.fecha = c.fecha
      ) AS hay_no_laborable,
      -- Ya existe = esta misma regla ya lo generó, O alguien puso a mano un
      -- bloque de ese turno ese día. Lo segundo es lo que impide que generar
      -- pise una decisión humana.
      EXISTS (
        SELECT 1 FROM public.bloques_turno b
        WHERE b.personal_id = c.personal_id
          AND b.fecha = c.fecha
          AND (b.asignacion_id = c.asignacion_id OR b.turno = c.turno)
      ) AS ya_existe
    FROM candidatos c
  ),
  insertados AS (
    INSERT INTO public.bloques_turno (
      company_id, project_id, personal_id, asignacion_id, plantilla_horario_id,
      turno, fecha, hora_inicio, hora_fin, cruza_medianoche, origen, estado
    )
    SELECT
      company_id, project_id, personal_id, asignacion_id, plantilla_horario_id,
      turno, fecha, hora_inicio, hora_fin, cruza_medianoche, 'recurrencia', 'pendiente'
    FROM clasificados
    WHERE NOT hay_ausencia
      AND NOT ya_existe
      AND (cubre_dias_no_laborables OR NOT hay_no_laborable)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM insertados)::int,
    (SELECT count(*) FROM clasificados WHERE hay_ausencia)::int,
    (SELECT count(*) FROM clasificados
      WHERE hay_no_laborable AND NOT cubre_dias_no_laborables AND NOT hay_ausencia)::int,
    (SELECT count(*) FROM clasificados WHERE ya_existe AND NOT hay_ausencia)::int
  INTO generados, omitidos_ausencia, omitidos_no_laborable, omitidos_existente;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.generar_bloques_turno(uuid, date, date) IS
  'Materializa las reglas activas de un proyecto en bloques_turno para el rango dado (por defecto, 60 días desde hoy). Se salta ausencias aprobadas, días no laborables y lo ya existente. Nunca borra ni sobrescribe. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) TO authenticated, service_role;
