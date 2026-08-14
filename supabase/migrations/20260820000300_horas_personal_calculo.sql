-- ════════════════════════════════════════════════════════════════════════════
-- Control de asignación de turnos (4/5): horas normales y extras
--
-- PROBLEMA
-- El único cómputo de horas que existe en todo el repo son ocho líneas dentro
-- del render de PresenciaPersonalTab.tsx:167-174: resta `hora_salida -
-- hora_entrada` y pinta "8h 30min". Tiene tres defectos que lo hacen inservible
-- para control de jornada:
--   1. No persiste ni agrega: no hay forma de saber cuántas horas lleva alguien
--      en el mes.
--   2. No distingue ordinaria de extra, porque hasta esta serie de migraciones
--      no había con qué comparar (no existía la jornada planificada).
--   3. Devuelve NULL si el resultado es negativo — es decir, un turno nocturno
--      de 22:00 a 06:00 da -960 minutos y DESAPARECE de pantalla. Todo el
--      turno de noche del condominio está sin contabilizar.
--
-- CÓMO
-- Una RPC de agregación, `calcular_horas_personal(proyecto, desde, hasta)`, que
-- cruza las cuatro fuentes:
--
--   `bloques_turno`        lo PLANIFICADO (horas_planificadas, de 20260820000000)
--   `presencia_personal`   lo MARCADO    (entrada/salida, ya con personal_id)
--   `dias_no_laborables`   el RECARGO    (factor del asueto trabajado)
--   `ausencias_personal`   la JUSTIFICACIÓN de lo no trabajado
--
-- POR QUÉ RPC Y NO UNA TABLA DE HORAS
-- Persistir el resultado lo desincroniza del marcaje: se corrige una hora de
-- salida mal tecleada y la planilla sigue diciendo lo de antes. El cálculo es
-- barato (índices por persona y fecha) y siempre refleja el dato actual. Si más
-- adelante hace falta congelar un período para planilla, lo correcto es una
-- tabla de CIERRE que guarde el resultado firmado de un rango cerrado — no una
-- fila por día que haya que mantener al día.
--
-- CRITERIO DE ORDINARIA vs EXTRA (por día, nunca por semana)
--   ordinarias = min(trabajadas, planificadas)
--   extra      = max(0, trabajadas - planificadas)
-- Se compara contra la jornada PLANIFICADA de ese día, que es la única
-- definición defendible frente a un empleado: se le pagan extra las horas que
-- estuvo por encima del turno que se le asignó. Un marcaje sin bloque asignado
-- (nadie lo programó y vino igual) se compara contra `p_jornada_referencia`
-- (8 h por defecto) en vez de contar 100% extra.
--
-- JORNADA NOCTURNA: 20:00–06:00, que es el tramo del Código de Trabajo de
-- Guatemala (art. 116). Se informa aparte, sin aplicarle factor: el recargo
-- nocturno depende del contrato y esta RPC no decide sueldos, informa horas.
--
-- IMPACTO EN DATOS: ninguno. Solo lee.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.calcular_horas_personal(uuid, date, date, numeric);
--   DROP FUNCTION public.turnos_horas_nocturnas(time, time, boolean);
--
-- Idempotente: CREATE OR REPLACE en ambas funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Horas dentro de la franja nocturna ───────────────────────────────────
-- Se trabaja en minutos desde el inicio del día, dejando que el fin pase de
-- 1440 cuando cruza la medianoche. Así la franja nocturna son tres intervalos
-- fijos y el solape es una resta, sin casos especiales:
--   [0, 360)      la madrugada del propio día      (00:00–06:00)
--   [1200, 1800)  la noche que empieza ese día     (20:00–06:00 del siguiente)
--   [2640, 2880)  la madrugada del día siguiente   (20:00–24:00 +1d, borde)
CREATE OR REPLACE FUNCTION public.turnos_horas_nocturnas(
  p_inicio time,
  p_fin    time,
  p_cruza  boolean
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH jornada AS (
    SELECT
      EXTRACT(EPOCH FROM p_inicio) / 60.0 AS ini,
      EXTRACT(EPOCH FROM p_fin) / 60.0
        + CASE WHEN COALESCE(p_cruza, false) OR p_fin <= p_inicio THEN 1440 ELSE 0 END AS fin
  ),
  franja (desde, hasta) AS (
    VALUES (0::numeric, 360::numeric), (1200::numeric, 1800::numeric), (2640::numeric, 2880::numeric)
  )
  SELECT CASE
    WHEN p_inicio IS NULL OR p_fin IS NULL THEN NULL
    ELSE ROUND(
      COALESCE(SUM(GREATEST(0, LEAST(j.fin, f.hasta) - GREATEST(j.ini, f.desde))), 0) / 60.0,
      2)
  END
  FROM jornada j CROSS JOIN franja f
$$;

COMMENT ON FUNCTION public.turnos_horas_nocturnas(time, time, boolean) IS
  'Horas de la jornada que caen en la franja nocturna 20:00–06:00 (art. 116 del Código de Trabajo de Guatemala). Maneja el cruce de medianoche.';

REVOKE EXECUTE ON FUNCTION public.turnos_horas_nocturnas(time, time, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_horas_nocturnas(time, time, boolean) TO authenticated, service_role;

-- ── 2. Consolidado por empleado ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calcular_horas_personal(
  p_project_id          uuid,
  p_desde               date,
  p_hasta               date,
  p_jornada_referencia  numeric DEFAULT 8.0
)
RETURNS TABLE (
  personal_id             uuid,
  nombre                  text,
  cargo                   text,
  dias_planificados       int,
  dias_trabajados         int,
  dias_ausencia           int,
  dias_asueto_trabajado   int,
  tardanzas               int,
  horas_planificadas      numeric,
  horas_trabajadas        numeric,
  horas_ordinarias        numeric,
  horas_extra             numeric,
  horas_nocturnas         numeric,
  horas_asueto            numeric,
  horas_asueto_ponderadas numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'rango de fechas inválido' USING ERRCODE = '22007';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  PERFORM public.assert_company_scope(v_company);

  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.horas_extra')
          OR public.user_has_permission('condominios.tab.turnos')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH plan AS (
    -- Lo planificado, por persona y día. Se agrupa porque alguien puede tener
    -- dos bloques el mismo día (turno partido, o doblar).
    SELECT
      b.personal_id AS pid,
      b.fecha,
      SUM(COALESCE(b.horas_planificadas, 0))::numeric AS horas
    FROM public.bloques_turno b
    WHERE b.project_id = p_project_id
      AND b.company_id = v_company
      AND b.fecha BETWEEN p_desde AND p_hasta
    GROUP BY b.personal_id, b.fecha
  ),
  marcaje AS (
    -- Lo efectivamente trabajado. Solo cuenta el marcaje atado a un empleado del
    -- expediente: `personal_id` es NULL en el histórico anterior a
    -- 20260820000100 y en quien no está en plantilla, y sumar esas horas a
    -- alguien sería inventar el dato.
    SELECT
      pp.personal_id AS pid,
      pp.fecha,
      SUM(public.turnos_horas_jornada(pp.hora_entrada, pp.hora_salida, false, 0))::numeric AS horas,
      SUM(public.turnos_horas_nocturnas(pp.hora_entrada, pp.hora_salida, false))::numeric AS horas_noche,
      COUNT(*) FILTER (WHERE pp.estado = 'tardanza')::int AS tardanzas
    FROM public.presencia_personal pp
    WHERE pp.project_id = p_project_id
      AND pp.company_id = v_company
      AND pp.fecha BETWEEN p_desde AND p_hasta
      AND pp.personal_id IS NOT NULL
      AND pp.hora_entrada IS NOT NULL
      AND pp.hora_salida IS NOT NULL
    GROUP BY pp.personal_id, pp.fecha
  ),
  dias AS (
    -- FULL OUTER: hay días planificados que nadie marcó (falta) y días marcados
    -- que nadie planificó (cobertura de emergencia). Ambos importan.
    SELECT
      COALESCE(pl.pid, ma.pid)     AS pid,
      COALESCE(pl.fecha, ma.fecha) AS fecha,
      COALESCE(pl.horas, 0)        AS planificadas,
      COALESCE(ma.horas, 0)        AS trabajadas,
      COALESCE(ma.horas_noche, 0)  AS nocturnas,
      COALESCE(ma.tardanzas, 0)    AS tardanzas,
      pl.pid IS NOT NULL           AS fue_planificado,
      ma.pid IS NOT NULL           AS fue_trabajado
    FROM plan pl
    FULL OUTER JOIN marcaje ma ON ma.pid = pl.pid AND ma.fecha = pl.fecha
  ),
  dias_con_contexto AS (
    SELECT
      d.*,
      dnl.factor_recargo,
      dnl.paga_recargo,
      EXISTS (
        SELECT 1 FROM public.ausencias_personal au
        WHERE au.personal_id = d.pid
          AND au.estado = 'aprobada'
          AND d.fecha BETWEEN au.fecha_inicio AND au.fecha_fin
      ) AS hay_ausencia,
      -- Sin jornada planificada, la referencia evita que una cobertura no
      -- programada se contabilice entera como extra.
      CASE WHEN d.planificadas > 0 THEN d.planificadas ELSE p_jornada_referencia END AS base
    FROM dias d
    LEFT JOIN public.dias_no_laborables dnl
      ON dnl.project_id = p_project_id AND dnl.fecha = d.fecha
  )
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    COUNT(*) FILTER (WHERE dc.fue_planificado)::int,
    COUNT(*) FILTER (WHERE dc.fue_trabajado)::int,
    COUNT(*) FILTER (WHERE dc.hay_ausencia)::int,
    COUNT(*) FILTER (WHERE dc.fue_trabajado AND dc.factor_recargo IS NOT NULL)::int,
    COALESCE(SUM(dc.tardanzas), 0)::int,
    ROUND(COALESCE(SUM(dc.planificadas), 0), 2),
    ROUND(COALESCE(SUM(dc.trabajadas), 0), 2),
    ROUND(COALESCE(SUM(LEAST(dc.trabajadas, dc.base)), 0), 2),
    ROUND(COALESCE(SUM(GREATEST(0, dc.trabajadas - dc.base)), 0), 2),
    ROUND(COALESCE(SUM(dc.nocturnas), 0), 2),
    ROUND(COALESCE(SUM(dc.trabajadas) FILTER (WHERE dc.factor_recargo IS NOT NULL), 0), 2),
    -- Lo mismo, ya multiplicado por el factor del día: es la cifra que entra a
    -- planilla. Un asueto con paga_recargo=false cuenta como día ordinario.
    ROUND(COALESCE(SUM(
      dc.trabajadas * CASE WHEN COALESCE(dc.paga_recargo, false) THEN dc.factor_recargo ELSE 1 END
    ) FILTER (WHERE dc.factor_recargo IS NOT NULL), 0), 2)
  FROM dias_con_contexto dc
  JOIN public.personal_condominio pc ON pc.id = dc.pid
  WHERE pc.project_id = p_project_id
  GROUP BY pc.id, pc.nombre, pc.cargo
  ORDER BY pc.nombre;
END;
$$;

COMMENT ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) IS
  'Consolidado de jornada por empleado en un rango: planificado vs marcado, ordinarias, extra, nocturnas (20:00–06:00) y asueto con su factor. No persiste nada — se recalcula del marcaje vigente.';

REVOKE EXECUTE ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) TO authenticated, service_role;
