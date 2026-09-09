-- ════════════════════════════════════════════════════════════════════════════
-- El balance del día: lo esperado contra lo ocurrido (Fase 2)
-- ════════════════════════════════════════════════════════════════════════════
-- La fase 1 (20260909000000) declaró QUÉ espera cada jornada y lo congeló en
-- cada bloque. Ya existía QUÉ pasó: entrada, salida y pausas por tipo con su
-- duración real. Faltaba ponerlos uno al lado del otro.
--
-- ESTA MIGRACIÓN TAMPOCO TOCA LA PLANILLA, igual que la anterior y por la misma
-- razón. `presencia_balance_dia` es una función de LECTURA: no persiste nada, no
-- escribe en ninguna tabla y `calcular_horas_personal` sigue devolviendo
-- exactamente los mismos números. Lo que agrega es la lectura de esos números —
-- «llegó 12 minutos tarde, descansó 75 de 60, cubrió 7.8 de 8 horas»— para que
-- se pueda mirar un mes real ANTES de decidir que algo se descuente. Aplicar
-- consecuencias es la fase 4, y llega después de esa mirada, no antes.
--
-- POR QUÉ NO SE PERSISTE. Mismo criterio que `calcular_horas_personal`: el
-- balance es una FUNCIÓN de datos que ya están escritos. Guardarlo crearía una
-- segunda verdad que se desincroniza en cuanto alguien corrige un marcaje o
-- ajusta una pausa — y corregir es justo lo que 20260908000200 vino a permitir.
--
-- CONTRA QUÉ SE MIDE: contra la vara CONGELADA en el bloque, no contra la
-- jornada de hoy. Un día de agosto se juzga con lo que se esperaba en agosto.
-- Si el bloque no tiene vara —se planificó antes de la fase 1, o no tiene
-- jornada— el balance lo dice (`sin_vara`) en vez de inventarse una.
--
-- LA MEDIANOCHE, otra vez. `hora_entrada` y `turno_inicio` son `time`, así que
-- un guardia que entra a las 00:30 a un turno que empezó a las 22:00 da una
-- diferencia de −1290 minutos. Se aplica la misma lectura que
-- `turnos_horas_jornada` hace con `fin <= inicio`: una diferencia
-- absurdamente negativa solo puede ser un cruce de día. El umbral es 12 horas
-- —nadie llega doce horas antes de su turno— y va en una función propia para
-- que las cuatro comparaciones de este archivo no puedan divergir.
--
-- LOS HALLAZGOS SON UNA LISTA, no un estado. Un día puede llegar tarde Y
-- excederse en el descanso Y salir temprano; un `estado` de un solo valor
-- obligaría a elegir cuál contar, que es como se pierden los otros dos.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.presencia_balance_dia(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.turnos_minutos_desvio(time, time);
--
-- Idempotente: CREATE OR REPLACE en las dos funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La diferencia entre dos horas del reloj, sin caer en la medianoche ───
CREATE OR REPLACE FUNCTION public.turnos_minutos_desvio(p_esperada time, p_real time)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_esperada IS NULL OR p_real IS NULL THEN NULL
    ELSE (
      EXTRACT(EPOCH FROM (p_real - p_esperada)) / 60.0
      -- Una diferencia por debajo de −12 h no es «llegó doce horas antes»: es
      -- que el reloj dio la vuelta. Es la misma lectura que hace
      -- `turnos_horas_jornada` con un `fin <= inicio`.
      + CASE WHEN EXTRACT(EPOCH FROM (p_real - p_esperada)) / 60.0 < -720
             THEN 1440 ELSE 0 END
    )
  END
$$;

COMMENT ON FUNCTION public.turnos_minutos_desvio(time, time) IS
  'Minutos entre la hora esperada y la real: positivo = después (tarde), negativo = antes. Trata una diferencia menor a −12 h como cruce de medianoche, con el mismo criterio que turnos_horas_jornada. Fuente única de esa resta para que las comparaciones del balance no diverjan.';

REVOKE EXECUTE ON FUNCTION public.turnos_minutos_desvio(time, time) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_minutos_desvio(time, time) TO authenticated, service_role;

-- ── 2. El balance ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presencia_balance_dia(
  p_project_id uuid,
  p_desde      date,
  p_hasta      date
)
RETURNS TABLE (
  personal_id      uuid,
  nombre           text,
  cargo            text,
  fecha            date,
  -- Lo esperado (del bloque y de su vara congelada)
  bloque_id            uuid,
  turno_inicio         time,
  turno_fin            time,
  horas_planificadas   numeric,
  tiene_vara           boolean,
  -- Lo ocurrido (del marcaje y sus pausas)
  registro_id      uuid,
  hora_entrada     time,
  hora_salida      time,
  horas_estadia    numeric,
  horas_descanso   numeric,
  horas_laborales  numeric,
  -- La comparación
  minutos_tarde            numeric,
  tramo_demora             text,
  minutos_salida_temprana  numeric,
  minutos_exceso_descanso  numeric,
  horas_sobre_jornada      numeric,
  extra_requiere_autorizacion boolean,
  cumple                   boolean,
  hallazgos                text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_tz      text;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'rango de fechas inválido' USING ERRCODE = '22007';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  PERFORM public.assert_company_scope(v_company);

  -- Quien administra la asistencia ve el balance de su condominio: es la misma
  -- información que ya ve en la lista del día, leída. Turnos y horas extra
  -- también, porque es su insumo natural.
  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.presencia')
          OR public.user_has_permission('condominios.tab.turnos')
          OR public.user_has_permission('condominios.tab.horas_extra')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  v_tz := public.presencia_zona_horaria(v_company);

  RETURN QUERY
  WITH plan AS (
    -- Un bloque por persona y día. Con turno partido hay dos: se toma el
    -- primero por hora de inicio, que es contra el que se mide la llegada.
    SELECT DISTINCT ON (b.personal_id, b.fecha)
      b.personal_id AS pid, b.fecha, b.id AS bloque_id,
      b.hora_inicio, b.hora_fin, b.horas_planificadas, b.politica
    FROM public.bloques_turno b
    WHERE b.project_id = p_project_id
      AND b.company_id = v_company
      AND b.fecha BETWEEN p_desde AND p_hasta
    ORDER BY b.personal_id, b.fecha, b.hora_inicio NULLS LAST
  ),
  marcaje AS (
    -- La fila vigente del día. Las anuladas no se juzgan: ya no cuentan.
    SELECT DISTINCT ON (pp.personal_id, pp.fecha)
      pp.personal_id AS pid, pp.fecha, pp.id AS registro_id,
      pp.hora_entrada, pp.hora_salida
    FROM public.presencia_personal pp
    WHERE pp.project_id = p_project_id
      AND pp.company_id = v_company
      AND pp.fecha BETWEEN p_desde AND p_hasta
      AND pp.personal_id IS NOT NULL
      AND pp.anulado_en IS NULL
    ORDER BY pp.personal_id, pp.fecha, pp.created_at
  ),
  dias AS (
    -- FULL OUTER, igual que en calcular_horas_personal: importa tanto el día
    -- planificado que nadie cubrió como el cubierto que nadie planificó.
    SELECT
      COALESCE(pl.pid, ma.pid)     AS pid,
      COALESCE(pl.fecha, ma.fecha) AS fecha,
      pl.bloque_id, pl.hora_inicio, pl.hora_fin, pl.horas_planificadas, pl.politica,
      ma.registro_id, ma.hora_entrada, ma.hora_salida
    FROM plan pl
    FULL OUTER JOIN marcaje ma ON ma.pid = pl.pid AND ma.fecha = pl.fecha
  ),
  medido AS (
    SELECT
      d.*,
      mp.total        AS min_pausa,
      mp.descontables AS min_pausa_desc,
      public.turnos_horas_jornada(d.hora_entrada, d.hora_salida, false, 0) AS h_estadia,
      GREATEST(0,
        COALESCE(public.turnos_horas_jornada(d.hora_entrada, d.hora_salida, false, 0), 0)
        - mp.descontables / 60.0) AS h_laborales,
      -- La vara del bloque. Sin bloque o sin jornada no hay vara: los umbrales
      -- quedan NULL y el balance lo dirá, en vez de medir contra un cero que
      -- parecería una política estricta que nadie fijó.
      (d.politica->>'tolerancia_entrada_min')::int       AS tol_entrada,
      (d.politica->>'tolerancia_salida_min')::int        AS tol_salida,
      (d.politica->>'demora_compensable_hasta_min')::int AS compensable,
      (d.politica->>'extra_requiere_autorizacion')::boolean AS extra_autoriza,
      d.politica->'cupos'                                AS cupos
    FROM dias d
    LEFT JOIN LATERAL public.presencia_minutos_pausa(d.registro_id, v_tz) mp ON true
  ),
  comparado AS (
    SELECT
      m.*,
      public.turnos_minutos_desvio(m.hora_inicio, m.hora_entrada) AS desvio_entrada,
      public.turnos_minutos_desvio(m.hora_fin, m.hora_salida)     AS desvio_salida,
      -- Exceso de descanso: se compara TIPO A TIPO contra el cupo de la vara.
      -- Sumar todo y comparar contra el total dejaría pasar a quien se toma dos
      -- horas de almuerzo y ninguna refacción.
      COALESCE((
        SELECT SUM(GREATEST(0, pa.minutos - COALESCE((m.cupos->>pa.tipo)::int, pa.minutos)))
        FROM public.presencia_pausas pa
        WHERE pa.registro_id = m.registro_id
          AND pa.anulado_en IS NULL
          AND pa.minutos IS NOT NULL
      ), 0) AS exceso_descanso
    FROM medido m
  )
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    c.fecha,
    c.bloque_id,
    c.hora_inicio,
    c.hora_fin,
    ROUND(COALESCE(c.horas_planificadas, 0), 2),
    c.politica IS NOT NULL,
    c.registro_id,
    c.hora_entrada,
    c.hora_salida,
    ROUND(COALESCE(c.h_estadia, 0), 2),
    ROUND(COALESCE(c.min_pausa, 0) / 60.0, 2),
    ROUND(COALESCE(c.h_laborales, 0), 2),
    -- Solo la demora cuenta: llegar antes no es un desvío que reportar.
    CASE WHEN c.desvio_entrada > 0 THEN ROUND(c.desvio_entrada, 0) ELSE 0 END,
    CASE
      WHEN c.politica IS NULL OR c.desvio_entrada IS NULL THEN NULL
      WHEN c.desvio_entrada <= COALESCE(c.tol_entrada, 0) THEN 'sin_consecuencia'
      WHEN COALESCE(c.compensable, 0) > COALESCE(c.tol_entrada, 0)
           AND c.desvio_entrada <= c.compensable THEN 'compensable'
      ELSE 'debitada'
    END,
    -- Salida temprana: el desvío es negativo, se reporta en positivo y solo
    -- cuando supera la tolerancia declarada.
    CASE
      WHEN c.desvio_salida IS NULL THEN 0
      WHEN -c.desvio_salida > COALESCE(c.tol_salida, 0) THEN ROUND(-c.desvio_salida, 0)
      ELSE 0
    END,
    ROUND(c.exceso_descanso, 0),
    -- Lo que excede la jornada planificada. Es CANDIDATO a extra, no extra:
    -- si la vara exige autorización previa, reconocerlo aquí sería saltarse
    -- justo el paso que se quiso agregar.
    GREATEST(0, ROUND(COALESCE(c.h_laborales, 0) - COALESCE(c.horas_planificadas, 0), 2)),
    COALESCE(c.extra_autoriza, false),
    -- `cumple` solo puede afirmarse con vara Y con marcaje: sin una de las dos
    -- no hay nada que comparar, y decir «cumple» sería afirmar de más.
    c.politica IS NOT NULL AND c.registro_id IS NOT NULL
      AND c.hora_salida IS NOT NULL
      AND COALESCE(c.desvio_entrada, 0) <= COALESCE(c.tol_entrada, 0)
      AND COALESCE(-c.desvio_salida, 0) <= COALESCE(c.tol_salida, 0)
      AND c.exceso_descanso = 0,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.politica IS NULL              THEN 'sin_vara' END,
      CASE WHEN c.bloque_id IS NULL             THEN 'sin_planificar' END,
      CASE WHEN c.registro_id IS NULL           THEN 'sin_marcaje' END,
      CASE WHEN c.registro_id IS NOT NULL AND c.hora_salida IS NULL
                                                THEN 'jornada_abierta' END,
      CASE WHEN c.politica IS NOT NULL AND c.desvio_entrada > COALESCE(c.tol_entrada, 0)
                                                THEN 'demora' END,
      CASE WHEN c.politica IS NOT NULL AND -c.desvio_salida > COALESCE(c.tol_salida, 0)
                                                THEN 'salida_temprana' END,
      CASE WHEN c.exceso_descanso > 0           THEN 'exceso_descanso' END,
      CASE WHEN COALESCE(c.h_laborales, 0) - COALESCE(c.horas_planificadas, 0) > 0.01
                AND COALESCE(c.extra_autoriza, false)
                                                THEN 'extra_sin_autorizar' END
    ], NULL)
  FROM comparado c
  JOIN public.personal_condominio pc ON pc.id = c.pid
  WHERE pc.project_id = p_project_id
  ORDER BY c.fecha, pc.nombre;
END;
$$;

COMMENT ON FUNCTION public.presencia_balance_dia(uuid, date, date) IS
  'Lo esperado contra lo ocurrido, por persona y día: horas planificadas vs estadía/descanso/laborales, minutos de demora con su tramo, salida temprana, exceso de descanso por tipo y horas sobre la jornada. NO persiste nada y NO cambia ningún número de planilla — es la lectura previa a decidir consecuencias (fase 4). Mide contra la vara CONGELADA en el bloque, no contra la jornada de hoy; sin vara lo dice en vez de inventarla.';

REVOKE EXECUTE ON FUNCTION public.presencia_balance_dia(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_balance_dia(uuid, date, date) TO authenticated, service_role;
