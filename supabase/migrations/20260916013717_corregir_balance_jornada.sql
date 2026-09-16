-- ════════════════════════════════════════════════════════════════════════════
-- Tres cosas que el balance leía mal (corrección de 20260913040400)
-- ════════════════════════════════════════════════════════════════════════════
-- Las tres salieron de la revisión de #844 y comparten una forma: el balance NO
-- calcula de menos, calcula de más. Afirma una demora que no hubo, un cero de
-- exceso que sí hubo, y una jornada abierta donde no hubo jornada. Ninguna
-- rompe nada —el balance es lectura pura y ningún número de planilla depende de
-- él—, y precisamente por eso ninguna se habría notado sola: producen un juicio
-- equivocado sobre una persona, y el juicio no tiene quien lo contradiga.
--
-- Esta migración SÓLO reemplaza el cuerpo de `presencia_balance_dia`. No toca
-- `presencia_corregir`, ni los sellos de evidencia, ni `calcular_horas_personal`,
-- ni una sola tabla. La firma, las columnas de retorno, el `SECURITY DEFINER`,
-- la cadena de control de empresa/proyecto/permiso y los REVOKE/GRANT quedan
-- exactamente como estaban; se re-emiten al final porque `CREATE OR REPLACE`
-- conserva la ACL pero decirlo aquí es más barato que confiar en recordarlo.
--
-- ── 1 · EL SELLO ES EVIDENCIA, NO EL HORARIO VIGENTE ───────────────────────
--
-- `presencia_corregir` (20260908000200) reescribe `hora_entrada`/`hora_salida`
-- y conserva `entrada_marcada_en`/`salida_marcada_en` A PROPÓSITO: son la
-- prueba de a qué hora se tocó el botón, y el rastro de que alguien corrigió
-- —con su nombre y su motivo— vale justamente porque el original no se borra.
--
-- El balance los tomaba como EL instante a juzgar, siempre. Resultado: se
-- corrige una entrada de 06:00 a 07:00 y el balance sigue midiendo la demora
-- contra las 06:00 del sello. La planilla, mientras tanto, ya usa 07:00 —
-- `calcular_horas_personal` lee `hora_entrada`/`hora_salida` y nunca los
-- sellos—. Dos cifras distintas para el mismo día, y la que juzga a la persona
-- es la vieja.
--
-- ANTES: sello exacto → demora contra 06:00 (la hora corregida se ignora).
-- AHORA: el sello sólo contesta si `corregido_en IS NULL`. Corregida la fila,
--        `turnos_instante_turno` recibe NULL y resuelve la hora efectiva contra
--        la ventana del turno, que es lo que ya hacía para toda hora capturada
--        a mano.
--
-- ── 2 · EL CUPO ES DEL DÍA Y DEL TIPO, NO DE CADA PAUSA ────────────────────
--
-- El exceso restaba el cupo FILA POR FILA. Quien parte su almuerzo en dos
-- tramos de 30 min contra un cupo de 45 se lleva 60 minutos y el balance decía
-- CERO de exceso: 30−45 y 30−45, los dos recortados a cero. Basta con pausar
-- dos veces para que el cupo deje de existir.
--
-- ANTES: SUM sobre las pausas, cupo aplicado a cada una.
-- AHORA: se agrupa por tipo, se compara el TOTAL del tipo contra su cupo, y
--        recién entonces se suman los excesos. Tipo a tipo se mantiene —era
--        correcto y la invariante 6 lo cuida—, y «no declarar no es declarar
--        cero» también: un tipo sin cupo usa su propio total como cupo.
--
-- ── 3 · UNA AUSENCIA NO ES UNA JORNADA ABIERTA ─────────────────────────────
--
-- La pantalla guarda `ausente`, `permiso` y `vacaciones` SIN horas, que es lo
-- correcto: no hubo entrada que registrar. Pero `abiertos` contaba
-- `hora_salida IS NULL` a secas, y eso también es verdad en esas tres filas: el
-- día salía como `jornada_abierta`, como si la persona hubiera quedado fichada
-- adentro. Y `sin_marcaje` miraba sólo si existía `registro_id`, así que el día
-- tampoco se declaraba sin marcar.
--
-- ANTES: ausencia → `jornada_abierta`, sin `sin_marcaje`.
-- AHORA: `abiertos` exige `hora_entrada IS NOT NULL AND hora_salida IS NULL`;
--        un día cuyas filas no traen ninguna entrada da `sin_marcaje` aunque
--        haya `registro_id`. La entrada real sin salida sigue dando
--        `jornada_abierta`, que es para lo que existe. No se inventan horas
--        para las ausencias: siguen sin tenerlas.
--
-- `cumple` pasa a exigir `con_entrada > 0` en lugar de `registro_id IS NOT
-- NULL`. No es un criterio nuevo: las tres condiciones que lo componen tienen
-- cada una su hallazgo, así que `cumple ⇔ sin hallazgos` —la invariante 18—
-- se conserva.
--
-- REVERSIÓN. Re-aplicar 20260913040400 tal cual devuelve la versión anterior:
-- esta migración no cambia el esquema, sólo el cuerpo de una función.

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
  registro_ids     uuid[],
  registros        int,
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

  -- LA EMPRESA NO ES EL ALCANCE. Dentro de una empresa hay proyectos, y desde
  -- 20260815000000 el alcance por proyecto es la puerta real: un `admin` con
  -- asignaciones explícitas ve los suyos y no los ajenos. Faltando esta línea,
  -- cualquiera con el permiso del tab leía el balance de CUALQUIER condominio
  -- de su empresa con sólo cambiar el uuid del argumento — y esta función es
  -- SECURITY DEFINER, así que la RLS de `bloques_turno` y `personal_presencia`
  -- no estaba ahí para atajarlo.
  --
  -- `can_access_project` ya deja pasar a super_admin, superadmin y
  -- company_owner por `user_is_project_exempt()`; se nombra igualmente a
  -- `is_super_admin()` aparte para que ese caso quede escrito aquí y no dependa
  -- de la implementación de otro helper.
  --
  -- p_project_id NULL no llega hasta acá: sin proyecto no hay `v_company` y ya
  -- salió por 42704 más arriba. Importa decirlo porque `can_access_project`
  -- devuelve `true` ante NULL a propósito (fila ambigua, no ajena), y esa
  -- puerta no debe quedar abierta por descuido en una función que sí exige
  -- proyecto.
  IF NOT (public.is_super_admin() OR public.can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

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
      -- La ventana del bloque es un dato del PLAN, no un marcaje: se arma
      -- directo y no pasa por la resolución de ambigüedad, que existe sólo para
      -- horas capturadas a mano.
      (b.fecha + b.hora_inicio)::timestamp AS ini_ts,
      (b.fecha + b.hora_fin)::timestamp
        + CASE WHEN COALESCE(b.cruza_medianoche, false)
               THEN interval '1 day' ELSE interval '0' END AS fin_ts
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
    -- TODOS los marcajes vigentes del día, no el primero. `presencia_personal`
    -- permite varias filas manuales para la misma persona y fecha —el turno que
    -- se parte, la cobertura que se agrega a media tarde— y
    -- `calcular_horas_personal` las SUMA todas. El primer borrador tomaba
    -- `DISTINCT ON (personal_id, fecha)` ordenado por `created_at`: se quedaba
    -- con una y tiraba el resto, así que el balance y la planilla contaban
    -- horas distintas para el mismo día sin que nada lo dijera.
    --
    -- Ahora se agregan con el MISMO criterio que la planilla: la estadía se
    -- suma fila por fila, no se mide de la primera entrada a la última salida
    -- (entre las dos puede haber un hueco que nadie trabajó).
    --
    -- Lo que NO se puede agregar es el juicio: con dos marcajes no se sabe cuál
    -- corresponde a qué tramo del turno, así que el día sale como
    -- `marcajes_multiples` y no se afirma que cumple. Los ids viajan todos,
    -- para que la pantalla pueda señalar las filas involucradas y no sólo una.
    SELECT
      pp.personal_id AS pid,
      pp.fecha,
      count(*)::int                                       AS registros,
      array_agg(pp.id ORDER BY pp.created_at)             AS registro_ids,
      (array_agg(pp.id ORDER BY pp.created_at))[1]        AS registro_id,
      MIN(pp.hora_entrada)                                AS hora_entrada,
      MAX(pp.hora_salida)                                 AS hora_salida,
      -- EL SELLO ES EVIDENCIA, NO EL HORARIO VIGENTE. `presencia_corregir`
      -- reescribe `hora_entrada`/`hora_salida` y CONSERVA a propósito
      -- `entrada_marcada_en`/`salida_marcada_en`: son la prueba de a qué hora
      -- se tocó el botón, y borrarlas destruiría el rastro de la corrección.
      -- Pero tomarlas como el instante a juzgar hace que el balance mida el
      -- horario ANTERIOR a la corrección —mientras la planilla, que lee
      -- `hora_entrada`/`hora_salida`, ya usa el nuevo—: dos cifras distintas
      -- para el mismo día, y la equivocada es justo la que juzga a la persona.
      -- Con `corregido_en IS NOT NULL` el sello deja de contestar y
      -- `turnos_instante_turno` resuelve la hora efectiva contra la ventana del
      -- turno, que es lo que hace para cualquier hora capturada a mano.
      MIN(pp.entrada_marcada_en) FILTER (WHERE pp.corregido_en IS NULL) AS entrada_exacta,
      MAX(pp.salida_marcada_en)  FILTER (WHERE pp.corregido_en IS NULL) AS salida_exacta,
      -- ABIERTA ES ENTRÓ Y NO SALIÓ. `hora_salida IS NULL` a secas también es
      -- verdad en una ausencia, un permiso y unas vacaciones, que la pantalla
      -- guarda SIN horas a propósito: el día salía marcado `jornada_abierta`,
      -- como si alguien hubiera quedado fichado adentro. No hay jornada que
      -- cerrar donde no hubo jornada.
      count(*) FILTER (WHERE pp.hora_entrada IS NOT NULL
                         AND pp.hora_salida  IS NULL)::int AS abiertos,
      -- Cuántas de las filas del día traen una entrada de verdad. Cero es «no
      -- se marcó», aunque haya fila: es lo que distingue la ausencia del
      -- olvido de fichar.
      count(*) FILTER (WHERE pp.hora_entrada IS NOT NULL)::int AS con_entrada,
      SUM(public.turnos_horas_jornada(pp.hora_entrada, pp.hora_salida, false, 0)) AS h_estadia,
      SUM(mp.total)                                       AS min_pausa,
      SUM(mp.descontables)                                AS min_pausa_desc
    FROM public.presencia_personal pp
    LEFT JOIN LATERAL public.presencia_minutos_pausa(pp.id, v_tz) mp ON true
    WHERE pp.project_id = p_project_id
      AND pp.company_id = v_company
      AND pp.fecha BETWEEN p_desde AND p_hasta
      AND pp.personal_id IS NOT NULL
      -- Las anuladas no se juzgan: ya no cuentan.
      AND pp.anulado_en IS NULL
    GROUP BY pp.personal_id, pp.fecha
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
      ma.registro_id, ma.registro_ids, ma.registros, ma.abiertos, ma.con_entrada,
      ma.hora_entrada, ma.hora_salida, ma.entrada_exacta, ma.salida_exacta,
      ma.h_estadia, ma.min_pausa, ma.min_pausa_desc
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
      (COALESCE(d.registros, 0) > 1)                                 AS multiple,
      GREATEST(0, COALESCE(d.h_estadia, 0)
                  - COALESCE(d.min_pausa_desc, 0) / 60.0)            AS h_laborales,
      -- El instante real de la entrada. Con `entrada_marcada_en` no hay nada
      -- que decidir; sin él, lo resuelve la ventana del turno o devuelve NULL.
      public.turnos_instante_turno(
        d.fecha, d.hora_inicio, d.hora_fin, d.cruza,
        d.hora_entrada, d.entrada_exacta, v_tz)                      AS entrada_ts
    FROM dias d
  ),
  anclado AS (
    SELECT
      m.*,
      public.turnos_instante_turno(
        m.fecha, m.hora_inicio, m.hora_fin, m.cruza,
        m.hora_salida, m.salida_exacta, v_tz) AS salida_cruda
    FROM medido m
  ),
  anclado2 AS (
    SELECT
      a.*,
      -- «Nadie sale antes de entrar» sigue puesto para el turno que NO declara
      -- cruce y sin embargo terminó pasada la medianoche. Con instantes exactos
      -- no puede dispararse: los pone el servidor, y en orden.
      CASE
        WHEN a.salida_cruda IS NULL THEN NULL
        WHEN a.entrada_ts IS NOT NULL AND a.salida_cruda < a.entrada_ts
          THEN a.salida_cruda + interval '1 day'
        ELSE a.salida_cruda
      END AS salida_ts
    FROM anclado a
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
    FROM anclado2 a
  ),
  contado AS (
    SELECT
      c.*,
      -- Exceso de descanso: se compara TIPO A TIPO contra el cupo de la vara.
      -- Sumar todo y comparar contra el total dejaría pasar a quien se toma dos
      -- horas de almuerzo y ninguna refacción.
      -- EL CUPO ES DEL DÍA Y DEL TIPO, NO DE CADA PAUSA. Restarlo fila por
      -- fila le regala un cupo entero a cada vez que la persona vuelve a
      -- pausar: dos almuerzos de 30 min contra un cupo de 45 daban CERO de
      -- exceso —30−45 y 30−45, los dos recortados a 0— cuando el día se llevó
      -- 60 y el exceso real es 15. Se agrupa por tipo primero y recién
      -- entonces se compara.
      --
      -- La semántica de «no declarar no es declarar cero» se conserva intacta:
      -- un tipo sin cupo en la vara usa su propio total como cupo, así que no
      -- inventa exceso.
      COALESCE((
        SELECT SUM(GREATEST(0, t.total - COALESCE((c.cupos->>t.tipo)::int, t.total)))
        FROM (
          SELECT pa.tipo, SUM(pa.minutos) AS total
          FROM public.presencia_pausas pa
          WHERE pa.registro_id = ANY(c.registro_ids)
            AND pa.anulado_en IS NULL
            AND pa.minutos IS NOT NULL
          GROUP BY pa.tipo
        ) t
      ), 0) AS exceso_descanso,
      -- Lo que excede la jornada planificada. Es CANDIDATO a extra, no extra:
      -- si la vara exige autorización previa, reconocerlo aquí sería saltarse
      -- justo el paso que se quiso agregar.
      --
      -- NULL en un día partido: con un marcaje y dos bloques, el hueco entre
      -- ellos no está registrado y repartirlo sería inventarlo. NULL se lee «no
      -- se puede saber»; un cero se leería «no hubo», que es una afirmación.
      --
      -- NULL también con VARIOS marcajes, por lo mismo: la suma de horas es
      -- correcta, pero atribuir el exceso a un tramo del turno no se puede.
      CASE
        WHEN c.partido OR c.multiple THEN NULL
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
        CASE WHEN k.multiple                      THEN 'marcajes_multiples' END,
        -- Sin fila, o con filas que ninguna trae entrada (ausencia, permiso,
        -- vacaciones): el día no se marcó. Mirar sólo `registro_id` daba por
        -- marcado un día que la pantalla guardó justamente para decir lo
        -- contrario.
        CASE WHEN k.registro_id IS NULL OR COALESCE(k.con_entrada, 0) = 0
                                                  THEN 'sin_marcaje' END,
        -- Con varios marcajes basta UNO sin salida para que el día siga
        -- abierto: mirar sólo el último los dejaría cerrados a todos.
        CASE WHEN COALESCE(k.abiertos, 0) > 0     THEN 'jornada_abierta' END,
        -- El marcaje manual que no se pudo ubicar en el día se DICE, no se
        -- convierte en una tardanza de veintitrés horas.
        CASE WHEN (k.hora_entrada IS NOT NULL AND k.entrada_ts IS NULL)
                  OR (k.hora_salida IS NOT NULL AND k.salida_ts IS NULL)
                                                  THEN 'marcaje_ambiguo' END,
        CASE WHEN k.vara_unica AND NOT k.multiple AND k.desvio_entrada > COALESCE(k.tol_entrada, 0)
                                                  THEN 'demora' END,
        CASE WHEN k.vara_unica AND NOT k.multiple AND -k.desvio_salida > COALESCE(k.tol_salida, 0)
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
    COALESCE(j.registro_ids, ARRAY[]::uuid[]),
    COALESCE(j.registros, 0),
    j.hora_entrada,
    j.hora_salida,
    ROUND(COALESCE(j.h_estadia, 0), 2),
    ROUND(COALESCE(j.min_pausa, 0) / 60.0, 2),
    ROUND(COALESCE(j.h_laborales, 0), 2),
    -- Solo la demora cuenta: llegar antes no es un desvío que reportar.
    CASE WHEN j.desvio_entrada > 0 THEN ROUND(j.desvio_entrada, 0) ELSE 0 END,
    CASE
      WHEN NOT j.vara_unica OR j.multiple OR j.desvio_entrada IS NULL THEN NULL
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
      AND COALESCE(j.con_entrada, 0) > 0
      AND COALESCE(j.abiertos, 0) = 0
      AND cardinality(j.hallazgos) = 0,
    j.hallazgos
  FROM juzgado j
  JOIN public.personal_condominio pc ON pc.id = j.pid
  WHERE pc.project_id = p_project_id
  ORDER BY j.fecha, pc.nombre;
END;
$$;

COMMENT ON FUNCTION public.presencia_balance_dia(uuid, date, date) IS
  'Lo esperado contra lo ocurrido, por persona y día: horas planificadas vs estadía/descanso/laborales, minutos de demora con su tramo, salida temprana, exceso de descanso por tipo y horas sobre la jornada. NO persiste nada y NO cambia ningún número de planilla — es la lectura previa a decidir consecuencias (fase 4). Mide contra la vara CONGELADA en el bloque y ancla las horas a la ventana real del turno, así que la medianoche no se adivina. Una fila corregida se juzga por su hora CORREGIDA: el sello de marcaje queda como evidencia, no como el horario vigente. El cupo de descanso se compara contra el TOTAL del tipo en el día, no contra cada pausa. Un día sin entrada —ausencia, permiso, vacaciones— sale sin_marcaje y nunca jornada_abierta. Un día con varios bloques suma sus horas y sale como turno_partido: sin un marcaje por bloque no se puede repartir la presencia, y no se afirma que cumple.';

-- Se re-emiten aunque `CREATE OR REPLACE` conserve la ACL: el modelo de
-- permisos de esta función es parte de lo que hay que preservar, y dejarlo
-- escrito es lo que permite verificarlo sin ir a buscar la migración anterior.
-- Sin service_role, por lo mismo que en 20260913040400: su único llamador es el
-- frontend como `authenticated`, y abrir una entrada SECURITY DEFINER que nadie
-- ejerce dejaría el control por proyecto sin nada que decidir.
REVOKE EXECUTE ON FUNCTION public.presencia_balance_dia(uuid, date, date) FROM PUBLIC, anon, service_role;
GRANT  EXECUTE ON FUNCTION public.presencia_balance_dia(uuid, date, date) TO authenticated;
