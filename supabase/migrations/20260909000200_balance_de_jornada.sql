-- ════════════════════════════════════════════════════════════════════════════
-- El balance del día: lo esperado contra lo ocurrido (Fase 2)
-- ════════════════════════════════════════════════════════════════════════════
-- La fase 1 (20260909000100) declaró QUÉ espera cada jornada y lo congeló en
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
-- ─────────────────────────────────────────────────────────────────────────────
-- LA MEDIANOCHE SE RESUELVE CON FECHAS, NO CON UNA CORAZONADA
-- ─────────────────────────────────────────────────────────────────────────────
-- El primer borrador de esta migración restaba dos `time` y, si el resultado
-- bajaba de −12 h, le sumaba un día. Esa heurística acierta en el caso que la
-- motivó y falla callada en otro:
--
--   turno 22:00–06:00, alguien se va a las 23:00 del MISMO día.
--   Restando horas: 23:00 − 06:00 = −7 h. No baja de −12 h, así que no se
--   corrige, y −7 h se lee «se fue 7 h antes»… lo cual es cierto, pero por
--   accidente: con la salida a las 05:00 el mismo cálculo da −1 h en vez de las
--   −1 h reales sólo porque los números coinciden. En cuanto el turno cambia de
--   forma, ±12 h deja de separar «cruzó el día» de «se fue temprano», porque
--   NINGUNA cantidad de horas puede separarlos: falta el dato, que es la fecha.
--
-- Ahora el dato está. Un turno con `cruza_medianoche` ocupa la ventana
-- [fecha + hora_inicio, fecha+1 + hora_fin], y dentro de esa ventana una hora
-- del reloj tiene UN solo instante posible: si es menor que `hora_inicio`,
-- pertenece al día siguiente; si no, al de inicio. `turnos_instante_turno`
-- aplica esa regla y todo lo demás es una resta de timestamps, sin umbrales.
--
--   esperado 22:00–06:00, salida 23:00 →  420 min de salida anticipada
--   esperado 22:00–06:00, salida 05:00 →   60 min
--   esperado 22:00–06:00, salida 06:00 →    0
--   esperado 22:00–06:00, entrada 00:30 → 150 min tarde
--
-- ─────────────────────────────────────────────────────────────────────────────
-- EL TURNO PARTIDO NO SE JUZGA DESCARTANDO LA MITAD
-- ─────────────────────────────────────────────────────────────────────────────
-- El primer borrador tomaba `DISTINCT ON (personal_id, fecha)` y tiraba el
-- resto. Con 06:00–10:00 y 14:00–18:00 eso planificaba 4 h en vez de 8, y una
-- jornada de 06:00 a 18:00 salía con 8 h de «extra sin autorizar» y una salida
-- anticipada de ocho horas. Tres números inventados por descartar una fila.
--
-- Ahora los bloques del día se AGREGAN: las horas planificadas se suman, la
-- entrada se compara contra el PRIMER bloque y la salida contra el ÚLTIMO.
--
-- Y ahí se acaba lo que se puede afirmar. Con un solo marcaje y dos bloques no
-- hay forma de saber si la persona trabajó de corrido o se fue a su casa entre
-- las 10:00 y las 14:00: el hueco no está registrado en ningún lado. Cualquier
-- reparto de esas horas sería una invención, así que el día sale con el hallazgo
-- `turno_partido`, `cumple = false` y `horas_sobre_jornada` en NULL — no en cero,
-- que se leería «no hubo extra». Lo que sí se puede medir (demora contra el
-- primer bloque, salida contra el último, exceso de descanso) se mide y se
-- reporta. Atribuir presencia a cada bloque necesita un marcaje por bloque, y
-- eso es una decisión de producto, no una que se pueda tomar en un SELECT.
--
-- LA VARA DE UN DÍA PARTIDO. Si los bloques del día no congelaron la MISMA
-- política, no hay una vara del día: qué tolerancia rige a las 06:00 y cuál a
-- las 14:00 no lo dice ningún dato. El día sale `sin_vara` + `politica_ambigua`
-- en vez de elegir una de las dos.
--
-- LOS HALLAZGOS SON UNA LISTA, no un estado. Un día puede llegar tarde Y
-- excederse en el descanso Y salir temprano; un `estado` de un solo valor
-- obligaría a elegir cuál contar, que es como se pierden los otros dos.
--
-- Y `cumple` SE DERIVA DE LA LISTA, no se calcula aparte. Enumerar a mano qué
-- hallazgos lo invalidan es cómo el primer borrador terminó afirmando que un día
-- con `extra_sin_autorizar` cumplía: la condición se escribió dos veces y sólo
-- se actualizó una. Ahora `cumple` es «hay con qué juzgar Y la lista está
-- vacía», así que un hallazgo nuevo lo invalida sin que nadie tenga que
-- acordarse.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.presencia_balance_dia(uuid, date, date);
--   DROP FUNCTION IF EXISTS public.turnos_minutos_desvio(timestamp, timestamp);
--   DROP FUNCTION IF EXISTS public.turnos_instante_turno(date, time, boolean, time);
--
-- Idempotente: CREATE OR REPLACE en las tres funciones, con DROP previo de la
-- firma vieja de `turnos_minutos_desvio` (cambió de (time,time) a timestamps).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Dónde cae una hora del reloj dentro de la ventana del turno ──────────
CREATE OR REPLACE FUNCTION public.turnos_instante_turno(
  p_fecha  date,
  p_inicio time,
  p_cruza  boolean,
  p_hora   time
)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_fecha IS NULL OR p_hora IS NULL THEN NULL
    ELSE (p_fecha + p_hora)::timestamp
       + CASE
           -- Sólo un turno que cruza puede tener horas del día siguiente, y
           -- dentro de él son exactamente las anteriores a su hora de inicio:
           -- la ventana es [inicio, inicio + duración) y no se solapa consigo
           -- misma. Sin cruce, todo cae en el día del turno — una hora menor
           -- que la de entrada es «llegó antes», no «llegó mañana».
           WHEN COALESCE(p_cruza, false) AND p_inicio IS NOT NULL AND p_hora < p_inicio
             THEN interval '1 day'
           ELSE interval '0'
         END
  END
$$;

COMMENT ON FUNCTION public.turnos_instante_turno(date, time, boolean, time) IS
  'El instante real de una hora del reloj dentro de la ventana de un turno: en un turno que cruza la medianoche, las horas anteriores a la de inicio pertenecen al día siguiente. Reemplaza la heurística de ±12 h, que no podía distinguir «cruzó el día» de «se fue temprano» porque le faltaba la fecha.';

REVOKE EXECUTE ON FUNCTION public.turnos_instante_turno(date, time, boolean, time) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_instante_turno(date, time, boolean, time) TO authenticated, service_role;

-- ── 2. La diferencia entre lo esperado y lo real, ya sin ambigüedad ─────────
-- La firma vieja tomaba dos `time` y adivinaba el día. Se retira: dejarla
-- disponible sería dejar disponible el error.
DROP FUNCTION IF EXISTS public.turnos_minutos_desvio(time, time);

CREATE OR REPLACE FUNCTION public.turnos_minutos_desvio(
  p_esperado timestamp,
  p_real     timestamp
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_esperado IS NULL OR p_real IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (p_real - p_esperado)) / 60.0
  END
$$;

COMMENT ON FUNCTION public.turnos_minutos_desvio(timestamp, timestamp) IS
  'Minutos entre el instante esperado y el real: positivo = después (tarde), negativo = antes. Sin heurísticas: los instantes ya vienen anclados por turnos_instante_turno.';

REVOKE EXECUTE ON FUNCTION public.turnos_minutos_desvio(timestamp, timestamp) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_minutos_desvio(timestamp, timestamp) TO authenticated, service_role;

-- ── 3. El balance ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.presencia_balance_dia(uuid, date, date);

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
  -- Lo esperado (de los bloques del día y de su vara congelada)
  bloque_id            uuid,
  bloques              int,
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
  WITH bloque AS (
    -- Cada bloque con su ventana ya anclada. Un turno partido son dos filas
    -- acá y se agregan abajo; ninguna se descarta.
    SELECT
      b.personal_id AS pid,
      b.fecha,
      b.id AS bloque_id,
      b.hora_inicio,
      b.hora_fin,
      b.cruza_medianoche,
      b.horas_planificadas,
      b.politica,
      public.turnos_instante_turno(b.fecha, b.hora_inicio, b.cruza_medianoche, b.hora_inicio) AS ini_ts,
      public.turnos_instante_turno(b.fecha, b.hora_inicio, b.cruza_medianoche, b.hora_fin)    AS fin_ts
    FROM public.bloques_turno b
    WHERE b.project_id = p_project_id
      AND b.company_id = v_company
      AND b.fecha BETWEEN p_desde AND p_hasta
  ),
  plan AS (
    SELECT
      bq.pid,
      bq.fecha,
      count(*)::int                            AS bloques,
      SUM(COALESCE(bq.horas_planificadas, 0))  AS horas_planificadas,
      -- El primero por instante de inicio: contra él se mide la llegada.
      (array_agg(bq.bloque_id   ORDER BY bq.ini_ts NULLS LAST))[1] AS bloque_id,
      (array_agg(bq.hora_inicio ORDER BY bq.ini_ts NULLS LAST))[1] AS hora_inicio,
      (array_agg(bq.ini_ts      ORDER BY bq.ini_ts NULLS LAST))[1] AS ini_ts,
      (array_agg(bq.cruza_medianoche ORDER BY bq.ini_ts NULLS LAST))[1] AS cruza,
      -- El último por instante de fin: contra él se mide la salida. Medir
      -- contra el primero es lo que fabricaba salidas anticipadas de horas.
      (array_agg(bq.hora_fin ORDER BY bq.fin_ts DESC NULLS LAST))[1] AS hora_fin,
      (array_agg(bq.fin_ts   ORDER BY bq.fin_ts DESC NULLS LAST))[1] AS fin_ts,
      -- La vara del día existe sólo si TODOS los bloques congelaron la misma.
      -- Con dos políticas distintas no hay una del día, y elegir una sería
      -- inventar cuál rige a qué hora.
      count(DISTINCT bq.politica) FILTER (WHERE bq.politica IS NOT NULL) AS varas,
      count(*) FILTER (WHERE bq.politica IS NULL)                        AS sin_politica,
      (array_agg(bq.politica ORDER BY bq.ini_ts NULLS LAST))[1]          AS politica
    FROM bloque bq
    GROUP BY bq.pid, bq.fecha
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
      pl.bloque_id, pl.bloques, pl.hora_inicio, pl.hora_fin, pl.cruza,
      pl.ini_ts, pl.fin_ts, pl.horas_planificadas,
      pl.varas, pl.sin_politica, pl.politica,
      ma.registro_id, ma.hora_entrada, ma.hora_salida
    FROM plan pl
    FULL OUTER JOIN marcaje ma ON ma.pid = pl.pid AND ma.fecha = pl.fecha
  ),
  medido AS (
    SELECT
      d.*,
      -- Una vara del día sólo cuando hay bloques, todos con política y todos
      -- con LA MISMA.
      (d.bloques IS NOT NULL AND d.sin_politica = 0 AND d.varas = 1) AS vara_unica,
      (d.bloques IS NOT NULL AND d.bloques > 1)                      AS partido,
      mp.total        AS min_pausa,
      mp.descontables AS min_pausa_desc,
      public.turnos_horas_jornada(d.hora_entrada, d.hora_salida, false, 0) AS h_estadia,
      GREATEST(0,
        COALESCE(public.turnos_horas_jornada(d.hora_entrada, d.hora_salida, false, 0), 0)
        - mp.descontables / 60.0) AS h_laborales,
      -- El instante real de la entrada, anclado en la ventana del turno.
      public.turnos_instante_turno(d.fecha, d.hora_inicio, d.cruza, d.hora_entrada) AS entrada_ts
    FROM dias d
    LEFT JOIN LATERAL public.presencia_minutos_pausa(d.registro_id, v_tz) mp ON true
  ),
  anclado AS (
    SELECT
      m.*,
      -- La salida se ancla igual, con una corrección que no necesita umbrales:
      -- nadie sale antes de entrar. Cubre el turno que NO declara cruce y sin
      -- embargo terminó pasada la medianoche.
      CASE
        WHEN m.hora_salida IS NULL THEN NULL
        ELSE public.turnos_instante_turno(m.fecha, m.hora_inicio, m.cruza, m.hora_salida)
           + CASE
               WHEN m.entrada_ts IS NOT NULL
                AND public.turnos_instante_turno(m.fecha, m.hora_inicio, m.cruza, m.hora_salida) < m.entrada_ts
                 THEN interval '1 day' ELSE interval '0'
             END
      END AS salida_ts
    FROM medido m
  ),
  comparado AS (
    SELECT
      a.*,
      CASE WHEN a.vara_unica THEN (a.politica->>'tolerancia_entrada_min')::int END       AS tol_entrada,
      CASE WHEN a.vara_unica THEN (a.politica->>'tolerancia_salida_min')::int END        AS tol_salida,
      CASE WHEN a.vara_unica THEN (a.politica->>'demora_compensable_hasta_min')::int END AS compensable,
      CASE WHEN a.vara_unica THEN (a.politica->>'extra_requiere_autorizacion')::boolean END AS extra_autoriza,
      CASE WHEN a.vara_unica THEN a.politica->'cupos' END                                AS cupos,
      public.turnos_minutos_desvio(a.ini_ts, a.entrada_ts) AS desvio_entrada,
      public.turnos_minutos_desvio(a.fin_ts, a.salida_ts)  AS desvio_salida
    FROM anclado a
  ),
  contado AS (
    SELECT
      c.*,
      -- Exceso de descanso: se compara TIPO A TIPO contra el cupo de la vara.
      -- Sumar todo y comparar contra el total dejaría pasar a quien se toma dos
      -- horas de almuerzo y ninguna refacción.
      COALESCE((
        SELECT SUM(GREATEST(0, pa.minutos - COALESCE((c.cupos->>pa.tipo)::int, pa.minutos)))
        FROM public.presencia_pausas pa
        WHERE pa.registro_id = c.registro_id
          AND pa.anulado_en IS NULL
          AND pa.minutos IS NOT NULL
      ), 0) AS exceso_descanso,
      -- Lo que excede la jornada planificada. Es CANDIDATO a extra, no extra:
      -- si la vara exige autorización previa, reconocerlo aquí sería saltarse
      -- justo el paso que se quiso agregar.
      --
      -- NULL en un día partido: con un marcaje y dos bloques, el hueco entre
      -- ellos no está registrado y repartirlo sería inventarlo. NULL se lee «no
      -- se puede saber»; un cero se leería «no hubo», que es una afirmación.
      CASE
        WHEN c.partido THEN NULL
        ELSE GREATEST(0, ROUND(COALESCE(c.h_laborales, 0) - COALESCE(c.horas_planificadas, 0), 2))
      END AS extra
    FROM comparado c
  ),
  juzgado AS (
    SELECT
      k.*,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN NOT k.vara_unica                THEN 'sin_vara' END,
        CASE WHEN k.bloques IS NOT NULL AND k.sin_politica = 0 AND k.varas > 1
                                                  THEN 'politica_ambigua' END,
        CASE WHEN k.bloques IS NULL               THEN 'sin_planificar' END,
        CASE WHEN k.partido                       THEN 'turno_partido' END,
        CASE WHEN k.registro_id IS NULL           THEN 'sin_marcaje' END,
        CASE WHEN k.registro_id IS NOT NULL AND k.hora_salida IS NULL
                                                  THEN 'jornada_abierta' END,
        CASE WHEN k.vara_unica AND k.desvio_entrada > COALESCE(k.tol_entrada, 0)
                                                  THEN 'demora' END,
        CASE WHEN k.vara_unica AND -k.desvio_salida > COALESCE(k.tol_salida, 0)
                                                  THEN 'salida_temprana' END,
        CASE WHEN k.exceso_descanso > 0           THEN 'exceso_descanso' END,
        CASE WHEN COALESCE(k.extra, 0) > 0.01 AND COALESCE(k.extra_autoriza, false)
                                                  THEN 'extra_sin_autorizar' END
      ], NULL) AS hallazgos
    FROM contado k
  )
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    j.fecha,
    j.bloque_id,
    j.bloques,
    j.hora_inicio,
    j.hora_fin,
    ROUND(COALESCE(j.horas_planificadas, 0), 2),
    j.vara_unica,
    j.registro_id,
    j.hora_entrada,
    j.hora_salida,
    ROUND(COALESCE(j.h_estadia, 0), 2),
    ROUND(COALESCE(j.min_pausa, 0) / 60.0, 2),
    ROUND(COALESCE(j.h_laborales, 0), 2),
    -- Solo la demora cuenta: llegar antes no es un desvío que reportar.
    CASE WHEN j.desvio_entrada > 0 THEN ROUND(j.desvio_entrada, 0) ELSE 0 END,
    CASE
      WHEN NOT j.vara_unica OR j.desvio_entrada IS NULL THEN NULL
      WHEN j.desvio_entrada <= COALESCE(j.tol_entrada, 0) THEN 'sin_consecuencia'
      WHEN COALESCE(j.compensable, 0) > COALESCE(j.tol_entrada, 0)
           AND j.desvio_entrada <= j.compensable THEN 'compensable'
      ELSE 'debitada'
    END,
    -- Salida temprana: el desvío es negativo, se reporta en positivo y solo
    -- cuando supera la tolerancia declarada.
    CASE
      WHEN j.desvio_salida IS NULL THEN 0
      WHEN -j.desvio_salida > COALESCE(j.tol_salida, 0) THEN ROUND(-j.desvio_salida, 0)
      ELSE 0
    END,
    ROUND(j.exceso_descanso, 0),
    j.extra,
    COALESCE(j.extra_autoriza, false),
    -- `cumple` = hay con qué juzgar Y no hay ni un hallazgo. Derivarlo de la
    -- lista en vez de re-enumerar las condiciones es lo que impide que vuelva a
    -- existir un día que «cumple» con un hallazgo encima.
    j.vara_unica
      AND j.registro_id IS NOT NULL
      AND j.hora_salida IS NOT NULL
      AND cardinality(j.hallazgos) = 0,
    j.hallazgos
  FROM juzgado j
  JOIN public.personal_condominio pc ON pc.id = j.pid
  WHERE pc.project_id = p_project_id
  ORDER BY j.fecha, pc.nombre;
END;
$$;

COMMENT ON FUNCTION public.presencia_balance_dia(uuid, date, date) IS
  'Lo esperado contra lo ocurrido, por persona y día: horas planificadas vs estadía/descanso/laborales, minutos de demora con su tramo, salida temprana, exceso de descanso por tipo y horas sobre la jornada. NO persiste nada y NO cambia ningún número de planilla — es la lectura previa a decidir consecuencias (fase 4). Mide contra la vara CONGELADA en el bloque y ancla las horas a la ventana real del turno, así que la medianoche no se adivina. Un día con varios bloques suma sus horas y sale como turno_partido: sin un marcaje por bloque no se puede repartir la presencia, y no se afirma que cumple.';

REVOKE EXECUTE ON FUNCTION public.presencia_balance_dia(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_balance_dia(uuid, date, date) TO authenticated, service_role;
