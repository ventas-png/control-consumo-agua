-- ════════════════════════════════════════════════════════════════════════════
-- Control de asignación de turnos: días del mes + excepciones por fecha
--
-- PROBLEMA
-- Dos huecos que el tab de Asignación de turnos no puede tapar desde el cliente:
--
--   1. NO HAY "los días del mes que elijas". Las diez periodicidades de
--      20260820000000 cubren «los días de la semana que elijas» (semanal) pero
--      del lado mensual solo existe UN día fijo (`dia_mes`). Un guardia que
--      entra el 1, el 15 y el 30 de cada mes necesita hoy TRES reglas, o
--      `frecuencia='fechas'` reescrita a mano cada mes.
--
--   2. NO SE PUEDE QUITAR UN DÍA. `generar_bloques_turno()` solo suma
--      (20260820000200:41-47): si alguien borra el bloque del jueves porque ese
--      día no se cubre, la siguiente generación lo vuelve a crear. Borrar el
--      bloque es una decisión que la base olvida al instante, así que en la
--      práctica el calendario generado es inmodificable.
--
-- CÓMO
--   · `asignaciones_turno.dias_mes` (jsonb, días 1..31) + la periodicidad
--     `mensual_dias`. Es el espejo exacto de `dias_semana`/`semanal`: mismo
--     formato de array, misma semántica de "vacío = no filtra" invertida (aquí
--     vacío cae de vuelta en `dia_mes`, ver abajo).
--   · `excepciones_turno`: una fila = "este empleado NO trabaja este día",
--     aunque una regla activa diga lo contrario. El generador la respeta y el
--     calendario la pinta. Es el negativo de la regla, y por eso es una tabla
--     propia y no un `estado='cancelado'` en `bloques_turno`: un bloque
--     cancelado seguiría contando horas planificadas en los reportes de nómina
--     (`horas_personal`, 20260820000300) y arrastraría su checklist de
--     `tareas_bloque`. La ausencia de turno no es un turno.
--
-- POR QUÉ `mensual_dias` Y NO REUTILIZAR `fechas`
-- `fechas_especificas` es una lista cerrada de fechas ISO: no se repite. La
-- periodicidad que pide el condominio es "el 1, el 15 y el 30 de CADA mes",
-- que es recurrencia, no calendario. Reutilizar `fechas` obligaría a editar la
-- regla todos los meses — exactamente el trabajo que la recurrencia elimina.
--
-- FIRMA DE `turnos_regla_aplica()`. Gana un noveno parámetro con DEFAULT, así
-- que las llamadas de 8 argumentos que ya existen (supabase/tests/turnos/
-- assert.sql) siguen compilando. La versión de 8 parámetros se DROPEA primero:
-- conservarla haría ambigua toda llamada de 8 argumentos.
--
-- DELETE EN `bloques_turno`. Se amplía la policy —owner/admin, más ahora quien
-- tenga el permiso del tab SI el bloque sigue pendiente y su fecha no pasó. Sin
-- esto, "quitar el turno del martes que viene" es un DELETE de 0 filas y en
-- silencio para el operador que administra el tab, que ya podía vaciar el mismo
-- bloque con un UPDATE. Lo pasado y lo ya iniciado siguen siendo intocables por
-- esa vía.
--
-- IMPACTO EN DATOS: ninguna fila cambia de valor. Se añade una columna con
-- DEFAULT, una tabla vacía y se reemplazan dos funciones y una policy.
--
-- CÓMO REVERTIR
--   DROP TABLE public.excepciones_turno;
--   ALTER TABLE public.asignaciones_turno DROP COLUMN dias_mes;
--   ALTER TABLE public.asignaciones_turno DROP CONSTRAINT asignaciones_turno_frecuencia_chk;
--   -- y re-crear el CHECK sin 'mensual_dias', y las dos funciones desde
--   -- 20260820000200 (firma de 8 parámetros).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- DROP … IF EXISTS antes de cada CREATE, CREATE OR REPLACE en las funciones.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Días del mes en la regla ─────────────────────────────────────────────
ALTER TABLE public.asignaciones_turno
  ADD COLUMN IF NOT EXISTS dias_mes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.asignaciones_turno.dias_mes IS
  'Días del mes 1..31 para frecuencia=mensual_dias, p. ej. [1,15,30]. Mismo formato que dias_semana. Un día mayor que el último del mes se recorta a ese último día (31 en febrero → 28/29).';

DO $$
BEGIN
  ALTER TABLE public.asignaciones_turno DROP CONSTRAINT IF EXISTS asignaciones_turno_frecuencia_chk;
  ALTER TABLE public.asignaciones_turno
    ADD CONSTRAINT asignaciones_turno_frecuencia_chk
    CHECK (frecuencia IN (
      'unica', 'diaria', 'semanal', 'quincenal', 'mensual', 'mensual_dias',
      'bimestral', 'trimestral', 'semestral', 'anual', 'fechas'
    ));

  ALTER TABLE public.asignaciones_turno DROP CONSTRAINT IF EXISTS asignaciones_turno_dias_mes_chk;
  ALTER TABLE public.asignaciones_turno
    ADD CONSTRAINT asignaciones_turno_dias_mes_chk
    CHECK (jsonb_typeof(dias_mes) = 'array');
END;
$$;

COMMENT ON COLUMN public.asignaciones_turno.frecuencia IS
  'unica | diaria | semanal | quincenal | mensual | mensual_dias | bimestral | trimestral | semestral | anual | fechas. Extiende el vocabulario de rutas (20260522000008).';

-- ── 2. excepciones_turno — el día que NO se cubre ───────────────────────────
CREATE TABLE IF NOT EXISTS public.excepciones_turno (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  personal_id   uuid        NOT NULL REFERENCES public.personal_condominio(id) ON DELETE CASCADE,
  -- Regla que cubría el día, cuando se conoce. Informativa: la excepción vale
  -- para la fecha completa aunque después se cambie de regla, porque lo que el
  -- administrador decidió es "esta persona no viene ese día".
  asignacion_id uuid        REFERENCES public.asignaciones_turno(id) ON DELETE SET NULL,
  fecha         date        NOT NULL,
  motivo        text,
  creado_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT excepciones_turno_unica UNIQUE (personal_id, fecha)
);

COMMENT ON TABLE public.excepciones_turno IS
  'El negativo de asignaciones_turno: esta persona NO trabaja este día aunque una regla activa lo cubra. La respeta generar_bloques_turno() y la pinta el calendario. Quitar la fila devuelve el día a la regla.';
COMMENT ON COLUMN public.excepciones_turno.asignacion_id IS
  'Regla que cubría el día cuando se creó la excepción. Informativa: la excepción es por (personal, fecha), no por regla.';
COMMENT ON COLUMN public.excepciones_turno.motivo IS
  'Texto libre del administrador ("permiso", "cambio con Pérez"). No lo interpreta nadie.';
COMMENT ON COLUMN public.excepciones_turno.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

CREATE INDEX IF NOT EXISTS idx_excepciones_turno_project
  ON public.excepciones_turno(project_id, company_id, fecha);
CREATE INDEX IF NOT EXISTS idx_excepciones_turno_personal
  ON public.excepciones_turno(personal_id, fecha);

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.excepciones_turno;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.excepciones_turno
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- RLS: el mismo gate que la regla que niega. DELETE con el permiso del tab y no
-- con owner/admin —misma desviación deliberada que 20260907000200:263-270—:
-- restaurar un día que uno mismo quitó es edición del calendario, no borrado de
-- historial, y con owner/admin el operador sufriría deletes silenciosos de 0
-- filas.
ALTER TABLE public.excepciones_turno ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.excepciones_turno FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.excepciones_turno TO authenticated;
GRANT ALL ON public.excepciones_turno TO service_role;

DROP POLICY IF EXISTS "excepciones_turno_select" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_select" ON public.excepciones_turno
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "excepciones_turno_insert" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_insert" ON public.excepciones_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "excepciones_turno_update" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_update" ON public.excepciones_turno
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "excepciones_turno_delete" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_delete" ON public.excepciones_turno
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

-- ── 3. bloques_turno: quitar un día pendiente sin ser owner/admin ───────────
-- Ampliación acotada de 20260820000000:492-498. Quien administra el tab ya
-- podía dejar el bloque vacío con un UPDATE; negarle el DELETE solo conseguía
-- que la operación fallara sin decirlo (RLS no distingue "prohibido" de "no
-- había filas"). Lo cerrado y lo pasado siguen exigiendo owner/admin.
DROP POLICY IF EXISTS "bloques_turno_delete" ON public.bloques_turno;
CREATE POLICY "bloques_turno_delete" ON public.bloques_turno
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR ((SELECT public.current_user_role()) = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = (SELECT public.get_my_company_id()))
    OR (company_id = (SELECT public.get_my_company_id())
        AND estado = 'pendiente'
        AND fecha >= CURRENT_DATE
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

-- ── 4. La recurrencia aprende los días del mes ─────────────────────────────
-- Se dropea la firma de 8 parámetros ANTES de crear la de 9 con DEFAULT: con
-- las dos vivas, cualquier llamada de 8 argumentos sería ambigua (42725).
DROP FUNCTION IF EXISTS public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date);

CREATE OR REPLACE FUNCTION public.turnos_regla_aplica(
  p_frecuencia         text,
  p_fecha_inicio       date,
  p_dias_semana        jsonb,
  p_intervalo_dias     int,
  p_dia_mes            int,
  p_mes_ancla          int,
  p_fechas_especificas jsonb,
  p_fecha              date,
  p_dias_mes           jsonb DEFAULT '[]'::jsonb
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
  v_dia        int;
BEGIN
  IF p_fecha IS NULL OR p_fecha_inicio IS NULL OR p_fecha < p_fecha_inicio THEN
    RETURN false;
  END IF;

  -- Sin días declarados, el filtro semanal no filtra: la regla cubre la semana
  -- completa. Con días declarados, solo esos.
  v_encaja_dow :=
    COALESCE(jsonb_array_length(COALESCE(p_dias_semana, '[]'::jsonb)), 0) = 0
    OR p_dias_semana @> to_jsonb(EXTRACT(ISODOW FROM p_fecha)::int);

  v_ultimo_dia := EXTRACT(DAY FROM (
    make_date(EXTRACT(YEAR FROM p_fecha)::int, EXTRACT(MONTH FROM p_fecha)::int, 1)
    + INTERVAL '1 month' - INTERVAL '1 day'
  ))::int;
  v_dia := EXTRACT(DAY FROM p_fecha)::int;

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

    WHEN 'mensual_dias' THEN
      -- El gemelo mensual de 'semanal': los días del mes que el administrador
      -- marcó, todos los meses. Un día que ese mes no existe (31 en febrero) se
      -- recorta al último real, con el mismo criterio que las periodicidades de
      -- día fijo: saltarse el mes dejaría al empleado sin turno siete veces al
      -- año. Sin lista, se cae de vuelta en dia_mes para no producir una regla
      -- que no cae nunca.
      IF COALESCE(jsonb_array_length(COALESCE(p_dias_mes, '[]'::jsonb)), 0) = 0 THEN
        RETURN v_dia = LEAST(
          COALESCE(p_dia_mes, EXTRACT(DAY FROM p_fecha_inicio)::int), v_ultimo_dia);
      END IF;
      RETURN EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(p_dias_mes) AS d(v)
        WHERE d.v ~ '^[0-9]+$' AND LEAST(d.v::int, v_ultimo_dia) = v_dia
      );

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
  v_dia_objetivo := LEAST(
    COALESCE(p_dia_mes, EXTRACT(DAY FROM p_fecha_inicio)::int),
    v_ultimo_dia
  );

  RETURN v_dia = v_dia_objetivo;
END;
$$;

COMMENT ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date, jsonb) IS
  'Definición ejecutable de las 11 periodicidades de asignaciones_turno. Pura y determinista. Espejo de reglaAplicaEn() en src/domain/condominios/turnos.ts — si cambia una, cambia la otra.';

REVOKE EXECUTE ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date, jsonb) TO authenticated, service_role;

-- ── 5. El generador respeta los días quitados ──────────────────────────────
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
            a.dia_mes, a.mes_ancla, a.fechas_especificas, d::date, a.dias_mes)
      -- El día que un administrador quitó a mano no vuelve. Sin esto, "quitar
      -- el turno del jueves" dura hasta la siguiente generación.
      AND NOT EXISTS (
        SELECT 1 FROM public.excepciones_turno ex
        WHERE ex.personal_id = a.personal_id
          AND ex.fecha = d::date
      )
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
  'Materializa las reglas activas de un proyecto en bloques_turno para el rango dado (por defecto, 60 días desde hoy). Se salta ausencias aprobadas, días no laborables, excepciones_turno y lo ya existente. Nunca borra ni sobrescribe. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) TO authenticated, service_role;
