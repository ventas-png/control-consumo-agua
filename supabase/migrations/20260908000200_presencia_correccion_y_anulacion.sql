-- ════════════════════════════════════════════════════════════════════════════
-- Corregir un marcaje con nombre y motivo; anular en vez de borrar
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ. El primer día del autoservicio (20260908000000) dos de las cuatro
-- primeras personas cerraron su jornada por error, a los segundos de entrar. El
-- freno de la UI reduce que vuelva a pasar, pero no arregla lo ya escrito, y la
-- asistencia alimenta la planilla: un sistema que no se puede corregir no es más
-- honesto, es más ignorado — alguien acaba llevando el Excel paralelo, y ahí se
-- muda la verdad.
--
-- LA TENSIÓN, Y CÓMO SE RESUELVE. Todo el valor del marcaje es que la hora NO se
-- teclea. Si un administrador la reescribe sin dejar rastro, la garantía pasa a
-- ser «la hora es confiable salvo que alguien la haya cambiado, y no hay forma
-- de saberlo» — peor que el sistema viejo, porque PARECE confiable. Así que
-- corregir se permite, pero como un acto DISTINTO de marcar y con su propia
-- huella: quién, cuándo y por qué, visible donde se lee el dato.
--
-- LO QUE YA HABÍA Y NO SE DUPLICA. `bitacora_acciones` (20260731000100) ya cubre
-- `presencia_personal` y en un UPDATE guarda el delta antes/después de cada
-- columna con su autor, desnormalizado para sobrevivir al borrado de la cuenta.
-- El forense existe. Lo que faltaba es el MOTIVO —la bitácora dice qué cambió,
-- no por qué— y que la corrección se vea en la fila, no en otra pestaña: una
-- corrección que solo consta en la bitácora es, en la práctica, invisible.
--
-- ANULAR, NO BORRAR. Una fila de asistencia es evidencia de planilla; borrarla
-- destruye el rastro justo donde importa. `anulado_en` la deja visible, marcada
-- y FUERA del cómputo de horas — que es lo que hace que anular signifique algo:
-- sin tocar `calcular_horas_personal`, anular sería decorativo y la fila seguiría
-- sumando horas.
--
-- DOS PERMISOS, NO UNO. Corregir exige `condominios.tab.presencia.edit`; anular,
-- `.delete`. Anular es el acto con forma de borrado —saca un día de la planilla—
-- aunque no destruya nada, y separarlos deja dar el poder de corregir sin el de
-- invalidar una jornada entera. Ojo con el otro lado: un guardia necesita
-- `condominios.tab.presencia` (VER) para poder fichar; si por comodidad se le da
-- también `.edit`, podría corregir la asistencia de sus compañeros.
--
-- LA EVIDENCIA NO SE TOCA. Ni la foto ni el GPS se modifican al corregir: son
-- del marcaje original y lo siguen siendo. El bucket ya lo garantiza por su lado
-- (no tiene policy de UPDATE). La consecuencia hay que decirla en pantalla: la
-- foto y la hora corregida no son la misma afirmación.
--
-- POR QUÉ RPC Y NO UN UPDATE CON POLICY. Por lo mismo que `presencia_marcar`:
-- una policy no puede exigir que venga un motivo, ni impedir que el cliente
-- ponga los sellos que quiera en `corregido_por`/`corregido_en`.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.presencia_anular(uuid, text);
--   DROP FUNCTION IF EXISTS public.presencia_corregir(uuid, time, time, text, text);
--   -- y volver a declarar calcular_horas_personal sin el filtro de anulado
--   -- (su cuerpo de 20260820000300, idéntico salvo esa línea)
--   ALTER TABLE public.presencia_personal
--     DROP COLUMN IF EXISTS corregido_por, DROP COLUMN IF EXISTS corregido_en,
--     DROP COLUMN IF EXISTS motivo_correccion, DROP COLUMN IF EXISTS anulado_en,
--     DROP COLUMN IF EXISTS corregido_por_nombre;
--   DROP FUNCTION IF EXISTS public.presencia_nombre_de_usuario(uuid);
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La huella de la corrección ───────────────────────────────────────────
ALTER TABLE public.presencia_personal
  ADD COLUMN IF NOT EXISTS corregido_por     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corregido_por_nombre text,
  ADD COLUMN IF NOT EXISTS corregido_en      timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_correccion text,
  ADD COLUMN IF NOT EXISTS anulado_en        timestamptz;

COMMENT ON COLUMN public.presencia_personal.corregido_por IS
  'Cuenta que corrigió o anuló esta fila. ON DELETE SET NULL: dar de baja a un administrador no borra la constancia de que se corrigió (el nombre legible queda en bitacora_acciones, desnormalizado).';
COMMENT ON COLUMN public.presencia_personal.corregido_por_nombre IS
  'Nombre legible de quien corrigió, DESNORMALIZADO — mismo criterio que bitacora_acciones.usuario_nombre: la fila tiene que seguir diciendo quién la tocó aunque esa cuenta se borre después (corregido_por es ON DELETE SET NULL). Y evita una consulta a app_users para pintar la lista, que el permiso de Presencia no siempre autoriza.';
COMMENT ON COLUMN public.presencia_personal.corregido_en IS
  'Instante de la última corrección o anulación. NULL = la fila está como se marcó.';
COMMENT ON COLUMN public.presencia_personal.motivo_correccion IS
  'Por qué se corrigió o anuló. Obligatorio en las dos RPC: es lo único que separa una corrección legítima de una manipulación, y la bitácora no lo captura (guarda el qué, no el porqué).';
COMMENT ON COLUMN public.presencia_personal.anulado_en IS
  'NULL = fila vigente. Con valor, la fila queda visible y marcada pero FUERA del cómputo de horas. No se borra: una fila de asistencia es evidencia de planilla.';

-- Consultar las anuladas es raro; excluirlas del cómputo es lo que pasa en cada
-- corrida. Índice parcial sobre lo VIGENTE, que es el camino caliente.
CREATE INDEX IF NOT EXISTS idx_presencia_vigente_por_proyecto_fecha
  ON public.presencia_personal (project_id, fecha)
  WHERE anulado_en IS NULL;

-- ── 2. Guarda común de las dos RPC ──────────────────────────────────────────
-- Devuelve la fila si quien llama puede actuar sobre ella con `p_permiso`, y
-- levanta con el motivo exacto si no. Vive aparte para que corregir y anular no
-- puedan divergir en quién les contesta.
CREATE OR REPLACE FUNCTION public.presencia_fila_editable(p_registro_id uuid, p_permiso text)
RETURNS public.presencia_personal
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fila public.presencia_personal%ROWTYPE;
BEGIN
  SELECT * INTO v_fila FROM public.presencia_personal pp WHERE pp.id = p_registro_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El registro de asistencia no existe' USING ERRCODE = '42704';
  END IF;
  IF v_fila.company_id IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Registro fuera de la empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(v_fila.project_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este condominio' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin() OR public.user_has_permission(p_permiso)) THEN
    RAISE EXCEPTION 'No autorizado para esta acción sobre la asistencia' USING ERRCODE = '42501';
  END IF;
  RETURN v_fila;
END;
$$;

COMMENT ON FUNCTION public.presencia_fila_editable(uuid, text) IS
  'Guarda compartida de presencia_corregir y presencia_anular: devuelve la fila si el llamador es de su empresa, tiene acceso al condominio y ostenta el permiso pedido. SECURITY DEFINER porque tiene que leer la fila ANTES de decidir.';

-- No se le concede a `authenticated`: sus únicos llamadores son los cuerpos de
-- las dos RPC, que son SECURITY DEFINER y corren como el dueño (mismo remedio
-- que prescribe scripts/migrations-guard.allowlist.json para esta clase).
REVOKE EXECUTE ON FUNCTION public.presencia_fila_editable(uuid, text) FROM PUBLIC, anon, authenticated;

-- Nombre legible de una cuenta, con el MISMO fallback que usa la bitácora
-- (20260731000100): sin él, una cuenta sin `full_name` dejaría la fila diciendo
-- que la corrigió «nadie». SECURITY DEFINER porque `app_users_select` solo deja
-- enumerar la empresa a company_owner/admin, y quien corrige suele ser operator.
CREATE OR REPLACE FUNCTION public.presencia_nombre_de_usuario(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(btrim(u.full_name), ''),
    'Usuario ' || left(u.id::text, 8)
  )
  FROM public.app_users u
  WHERE u.id = p_user_id
$$;

COMMENT ON FUNCTION public.presencia_nombre_de_usuario(uuid) IS
  'Nombre legible de una cuenta para desnormalizarlo en presencia_personal.corregido_por_nombre, con el mismo fallback que bitacora_acciones.';

REVOKE EXECUTE ON FUNCTION public.presencia_nombre_de_usuario(uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Corregir ─────────────────────────────────────────────────────────────
-- Recibe el ESTADO COMPLETO deseado, no un delta: así «quitar la hora de salida»
-- (reabrir una jornada cerrada por error) se expresa mandando NULL, en vez de
-- necesitar un centinela para distinguir «no cambies» de «déjalo vacío».
--
-- `p_hora_entrada` es obligatoria: una fila de asistencia sin entrada no dice
-- nada. Si lo que hay que hacer es que la fila deje de contar, eso es anular.
CREATE OR REPLACE FUNCTION public.presencia_corregir(
  p_registro_id  uuid,
  p_hora_entrada time,
  p_hora_salida  time,
  p_estado       text,
  p_motivo       text
)
RETURNS TABLE (registro_id uuid, hora_entrada time, hora_salida time, estado text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fila   public.presencia_personal%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_estado text := lower(btrim(COALESCE(p_estado, '')));
  v_autor  text;
BEGIN
  v_fila := public.presencia_fila_editable(p_registro_id, 'condominios.tab.presencia.edit');

  IF v_fila.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Este registro está anulado: no se corrige, se vuelve a marcar'
      USING ERRCODE = '22023';
  END IF;

  -- El motivo es el punto entero. Un «.» no es un motivo.
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribí el motivo de la corrección (al menos 5 caracteres)'
      USING ERRCODE = '22023';
  END IF;

  IF p_hora_entrada IS NULL THEN
    RAISE EXCEPTION 'La hora de entrada es obligatoria. Si el registro no debe contar, anulalo.'
      USING ERRCODE = '22023';
  END IF;

  IF v_estado NOT IN ('presente', 'ausente', 'tardanza', 'permiso', 'vacaciones') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_estado USING ERRCODE = '22023';
  END IF;

  v_autor := public.presencia_nombre_de_usuario((SELECT auth.uid()));

  -- La foto, el GPS, el origen, el empleado y la fecha NO se tocan: la evidencia
  -- es del marcaje original y lo sigue siendo. Corregir la hora no reescribe lo
  -- que la cámara vio.
  UPDATE public.presencia_personal pp
     SET hora_entrada      = p_hora_entrada,
         hora_salida       = p_hora_salida,
         estado            = v_estado,
         corregido_por     = (SELECT auth.uid()),
         corregido_por_nombre = v_autor,
         corregido_en      = now(),
         motivo_correccion = v_motivo
   WHERE pp.id = p_registro_id;

  RETURN QUERY SELECT p_registro_id, p_hora_entrada, p_hora_salida, v_estado;
END;
$$;

COMMENT ON FUNCTION public.presencia_corregir(uuid, time, time, text, text) IS
  'Corrige las horas y el estado de un marcaje dejando huella: quién, cuándo y por qué (motivo obligatorio). Exige condominios.tab.presencia.edit. NO toca la foto ni el GPS — la evidencia es del marcaje original. Recibe el estado completo deseado: mandar NULL en la salida reabre la jornada.';

REVOKE EXECUTE ON FUNCTION public.presencia_corregir(uuid, time, time, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_corregir(uuid, time, time, text, text) TO authenticated;

-- ── 4. Anular ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presencia_anular(p_registro_id uuid, p_motivo text)
RETURNS TABLE (registro_id uuid, anulado_en timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fila   public.presencia_personal%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_ahora  timestamptz := now();
  v_autor  text;
BEGIN
  -- `.delete` y no `.edit`: anular es el acto con forma de borrado —saca el día
  -- de la planilla— aunque no destruya nada.
  v_fila := public.presencia_fila_editable(p_registro_id, 'condominios.tab.presencia.delete');

  IF v_fila.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Este registro ya estaba anulado' USING ERRCODE = '22023';
  END IF;

  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribí el motivo de la anulación (al menos 5 caracteres)'
      USING ERRCODE = '22023';
  END IF;

  v_autor := public.presencia_nombre_de_usuario((SELECT auth.uid()));

  UPDATE public.presencia_personal pp
     SET anulado_en        = v_ahora,
         corregido_por     = (SELECT auth.uid()),
         corregido_por_nombre = v_autor,
         corregido_en      = v_ahora,
         motivo_correccion = v_motivo
   WHERE pp.id = p_registro_id;

  RETURN QUERY SELECT p_registro_id, v_ahora;
END;
$$;

COMMENT ON FUNCTION public.presencia_anular(uuid, text) IS
  'Anula un registro de asistencia: queda visible y marcado pero fuera del cómputo de horas. NO borra — una fila de asistencia es evidencia de planilla. Exige condominios.tab.presencia.delete y un motivo.';

REVOKE EXECUTE ON FUNCTION public.presencia_anular(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_anular(uuid, text) TO authenticated;

-- ── 5. Que anular signifique algo: el cómputo excluye lo anulado ────────────
-- Se vuelve a declarar `calcular_horas_personal` ENTERA porque Postgres no deja
-- parchear una línea de un cuerpo. El único cambio respecto a 20260820000300 es
-- la condición `pp.anulado_en IS NULL` en el CTE `marcaje`, marcada abajo. Todo
-- lo demás es idéntico, a propósito: esta migración no es el sitio para tocar
-- cómo se calculan las horas extra.
--
-- Sin esto, una fila anulada seguiría sumando horas a la planilla y la anulación
-- sería un adorno en la pantalla.
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
      -- ▼ ÚNICO CAMBIO respecto a 20260820000300 (ver cabecera de esta sección).
      AND pp.anulado_en IS NULL
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
  'Consolidado de jornada por empleado en un rango: planificado vs marcado, ordinarias, extra, nocturnas (20:00–06:00) y asueto con su factor. Excluye los marcajes anulados (20260908000200). No persiste nada — se recalcula del marcaje vigente.';

REVOKE EXECUTE ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) TO authenticated, service_role;

-- ── 6. El empleado ve lo que le corrigieron ─────────────────────────────────
-- Enterarse por el recibo de pago de que a uno le cambiaron la jornada es la
-- peor forma de enterarse. `presencia_mi_ficha` gana tres columnas para
-- que la pantalla de autoservicio lo diga; el resto de la función es idéntica a
-- 20260908000000.
--
-- DROP + CREATE, no CREATE OR REPLACE: Postgres rechaza un REPLACE que cambie el
-- juego de parámetros OUT («cannot change return type of existing function»), y
-- agregar columnas al RETURNS TABLE es exactamente eso. Lo cazó el sandbox antes
-- que producción. Los privilegios se vuelven a otorgar abajo: el DROP se los lleva.
DROP FUNCTION IF EXISTS public.presencia_mi_ficha(uuid);

CREATE OR REPLACE FUNCTION public.presencia_mi_ficha(p_project_id uuid)
RETURNS TABLE (
  personal_id       uuid,
  nombre            text,
  cargo             text,
  foto_url          text,
  fecha_operativa   date,
  hora_servidor     time,
  bloque_id         uuid,
  turno             text,
  turno_inicio      time,
  turno_fin         time,
  registro_id       uuid,
  hora_entrada      time,
  hora_salida       time,
  estado            text,
  origen            text,
  corregido_en      timestamptz,
  corregido_por_nombre text,
  motivo_correccion text,
  anulado_en        timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
  v_ficha   uuid;
  v_tz      text;
  v_local   timestamp;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin() AND v_company IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  v_ficha := public.presencia_ficha_de_usuario(p_project_id);
  IF v_ficha IS NULL THEN
    RETURN;  -- sin ficha vinculada no hay autoservicio; no es un error.
  END IF;

  v_tz := public.presencia_zona_horaria(v_company);
  v_local := (now() AT TIME ZONE v_tz);

  RETURN QUERY
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    pc.foto_url,
    v_local::date,
    v_local::time,
    bt.id,
    bt.turno,
    bt.hora_inicio,
    bt.hora_fin,
    pp.id,
    pp.hora_entrada,
    pp.hora_salida,
    pp.estado,
    pp.origen,
    pp.corregido_en,
    pp.corregido_por_nombre,
    pp.motivo_correccion,
    pp.anulado_en
  FROM public.personal_condominio pc
  LEFT JOIN public.bloques_turno bt
    ON bt.personal_id = pc.id
   AND bt.project_id  = p_project_id
   AND bt.fecha       = v_local::date
  -- LATERAL y no un LEFT JOIN llano: desde que lo anulado no ocupa el día, una
  -- persona puede tener DOS filas la misma fecha (la anulada y la que marcó
  -- después), y el join devolvería las dos — la pantalla tomaría una al azar.
  -- Se elige la VIGENTE; si no hay, la anulada más reciente, para que la persona
  -- se entere de que le anularon el marcaje en vez de ver la pantalla en blanco.
  LEFT JOIN LATERAL (
    SELECT p2.*
    FROM public.presencia_personal p2
    WHERE p2.personal_id = pc.id
      AND p2.project_id  = p_project_id
      AND p2.fecha       = v_local::date
    ORDER BY (p2.anulado_en IS NULL) DESC, p2.created_at DESC
    LIMIT 1
  ) pp ON true
  WHERE pc.id = v_ficha;
END;
$$;

COMMENT ON FUNCTION public.presencia_mi_ficha(uuid) IS
  'Datos con los que se rellena solo el marcaje de autoservicio: expediente de quien llama en ese condominio, fecha y hora del SERVIDOR en la zona del tenant, turno planificado de hoy y el marcaje que ya exista — incluido si se lo corrigieron o anularon, y por qué (20260908000200). Cero filas = la cuenta no tiene expediente aquí (no es error).';

REVOKE EXECUTE ON FUNCTION public.presencia_mi_ficha(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_mi_ficha(uuid) TO authenticated;

-- ── 7. Lo anulado no ocupa el día ───────────────────────────────────────────
-- El índice único de 20260908000000 impide dos marcajes de autoservicio por
-- persona y día. Con la anulación eso se vuelve una trampa: la fila anulada
-- sigue ocupando el hueco, así que la persona a la que le anularon el marcaje de
-- HOY no podría volver a marcar — justo lo que `presencia_corregir` le dice que
-- haga. El índice pasa a mirar solo lo vigente.
DROP INDEX IF EXISTS public.presencia_autoservicio_una_por_dia;
CREATE UNIQUE INDEX IF NOT EXISTS presencia_autoservicio_una_por_dia
  ON public.presencia_personal (project_id, personal_id, fecha)
  WHERE origen = 'autoservicio' AND personal_id IS NOT NULL AND anulado_en IS NULL;

-- Y `presencia_marcar` tiene que ignorar las anuladas al buscar la fila del día
-- y la entrada abierta; si no, el índice abierto no serviría de nada porque la
-- RPC encontraría la anulada antes de intentar insertar. Se redeclara ENTERA
-- —Postgres no deja parchear un cuerpo— y las DOS únicas líneas nuevas van
-- marcadas con «▼ 20260908000200». Todo lo demás es idéntico a su original.
CREATE OR REPLACE FUNCTION public.presencia_marcar(
  p_project_id    uuid,
  p_tipo          text,
  p_foto          text    DEFAULT NULL,
  p_gps           jsonb   DEFAULT NULL,
  p_observaciones text    DEFAULT NULL
)
RETURNS TABLE (
  registro_id  uuid,
  fecha        date,
  hora         time,
  estado       text,
  tipo         text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company    uuid;
  v_ficha      uuid;
  v_nombre     text;
  v_cargo      text;
  v_tz         text;
  v_local      timestamp;
  v_fecha      date;
  v_hora       time;
  v_tipo       text := lower(btrim(COALESCE(p_tipo, '')));
  v_foto       text;
  v_gps        jsonb;
  v_lat        numeric;
  v_lng        numeric;
  v_exactitud  numeric;
  v_bloque_id  uuid;
  v_inicio     time;
  v_tolerancia int;
  v_retraso    numeric;
  v_estado     text := 'presente';
  v_obs        text := NULLIF(btrim(COALESCE(p_observaciones, '')), '');
  v_reg        public.presencia_personal%ROWTYPE;
BEGIN
  IF v_tipo NOT IN ('entrada', 'salida') THEN
    RAISE EXCEPTION 'Tipo de marcaje inválido (esperado entrada o salida)'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este condominio' USING ERRCODE = '42501';
  END IF;

  v_ficha := public.presencia_ficha_de_usuario(p_project_id);
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a un expediente de personal en este condominio. Pídele al administrador que la vincule desde el tab Personal.'
      USING ERRCODE = '42501';
  END IF;
  SELECT pc.nombre, pc.cargo INTO v_nombre, v_cargo
  FROM public.personal_condominio pc WHERE pc.id = v_ficha;

  v_tz    := public.presencia_zona_horaria(v_company);
  v_local := (now() AT TIME ZONE v_tz);
  v_fecha := v_local::date;
  -- A segundos: `time` guarda microsegundos y la asistencia no se discute en
  -- fracciones de segundo. Además hace legible el dato en la lista del día.
  v_hora  := date_trunc('second', v_local)::time;

  -- ── La foto tiene que ser SUYA y tiene que existir ────────────────────────
  v_foto := NULLIF(btrim(COALESCE(p_foto, '')), '');
  IF v_foto IS NOT NULL THEN
    IF v_foto <> p_project_id::text || '/' || v_ficha::text || '/' ||
                 split_part(v_foto, '/', 3)
       OR array_length(string_to_array(v_foto, '/'), 1) <> 3
       OR split_part(v_foto, '/', 3) = ''
    THEN
      RAISE EXCEPTION 'La foto no corresponde a tu expediente en este condominio'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
      WHERE o.bucket_id = 'presencia-evidencias' AND o.name = v_foto
    ) THEN
      RAISE EXCEPTION 'La foto no llegó a subirse. Intentá de nuevo.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ── La ubicación, normalizada o nada ─────────────────────────────────────
  -- Se guarda solo si es un par de coordenadas plausible. Una cadena vacía o un
  -- número fuera de rango no es "ubicación aproximada": es ruido que después se
  -- lee como si fuera un dato.
  IF p_gps IS NOT NULL AND jsonb_typeof(p_gps) = 'object' THEN
    BEGIN
      v_lat := (p_gps->>'lat')::numeric;
      v_lng := (p_gps->>'lng')::numeric;
      v_exactitud := NULLIF(p_gps->>'exactitud_m', '')::numeric;
      IF v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180 THEN
        v_gps := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'exactitud_m', v_exactitud);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_gps := NULL;
    END;
  END IF;

  -- ══ ENTRADA ══════════════════════════════════════════════════════════════
  IF v_tipo = 'entrada' THEN
    -- Turno planificado de hoy: de él salen `bloque_id` (que es lo que ata el
    -- marcaje al cómputo de horas) y la vara para la tardanza.
    SELECT bt.id, bt.hora_inicio,
           COALESCE(ph.tolerancia_entrada_min, 10)
      INTO v_bloque_id, v_inicio, v_tolerancia
    FROM public.bloques_turno bt
    LEFT JOIN public.plantillas_horario ph ON ph.id = bt.plantilla_horario_id
    WHERE bt.personal_id = v_ficha
      AND bt.project_id  = p_project_id
      AND bt.fecha       = v_fecha
    ORDER BY bt.hora_inicio NULLS LAST
    LIMIT 1;

    -- TARDANZA: solo cuando hay un turno planificado con hora y el retraso cae
    -- en una ventana razonable. Pasadas 4 horas ya no se está midiendo ese
    -- turno —lo más probable es que se marcara contra el bloque equivocado— y
    -- el sistema deja el estado neutro para que lo resuelva quien administra.
    -- La tolerancia es la de la plantilla de horario (tolerancia_entrada_min),
    -- que ya existía para el cómputo de horas: no se inventa una segunda vara.
    IF v_inicio IS NOT NULL THEN
      v_retraso := EXTRACT(EPOCH FROM (v_hora - v_inicio)) / 60;
      IF v_retraso > v_tolerancia AND v_retraso <= 240 THEN
        v_estado := 'tardanza';
      END IF;
    END IF;

    SELECT * INTO v_reg
    FROM public.presencia_personal pp
    WHERE pp.project_id  = p_project_id
      AND pp.personal_id = v_ficha
      AND pp.fecha       = v_fecha
      -- ▼ 20260908000200: una fila ANULADA no ocupa el día. El mensaje de
      --   `presencia_corregir` dice «se vuelve a marcar», y esto es lo que lo
      --   hace cierto: sin este filtro la anulada se encontraría igual y el
      --   marcaje moriría con «Ya marcaste tu entrada hoy».
      AND pp.anulado_en IS NULL
    ORDER BY pp.created_at
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_reg.hora_entrada IS NOT NULL THEN
      RAISE EXCEPTION 'Ya marcaste tu entrada hoy a las %', to_char(v_reg.hora_entrada, 'HH24:MI')
        USING ERRCODE = '23505';
    END IF;

    IF FOUND THEN
      UPDATE public.presencia_personal pp
         SET hora_entrada       = v_hora,
             estado             = v_estado,
             origen             = 'autoservicio',
             bloque_id          = COALESCE(pp.bloque_id, v_bloque_id),
             cargo              = COALESCE(pp.cargo, v_cargo),
             foto_entrada       = v_foto,
             gps_entrada        = v_gps,
             entrada_marcada_en = now(),
             observaciones      = NULLIF(
               btrim(concat_ws(' · ', NULLIF(btrim(COALESCE(pp.observaciones, '')), ''), v_obs)), '')
       WHERE pp.id = v_reg.id;
    ELSE
      INSERT INTO public.presencia_personal (
        company_id, project_id, personal_id, bloque_id, nombre, cargo, fecha,
        hora_entrada, estado, observaciones, origen, foto_entrada, gps_entrada,
        entrada_marcada_en
      ) VALUES (
        v_company, p_project_id, v_ficha, v_bloque_id, v_nombre, v_cargo, v_fecha,
        v_hora, v_estado, v_obs, 'autoservicio', v_foto, v_gps,
        now()
      )
      RETURNING id INTO v_reg.id;
    END IF;

    RETURN QUERY SELECT v_reg.id, v_fecha, v_hora, v_estado, 'entrada'::text;
    RETURN;
  END IF;

  -- ══ SALIDA ═══════════════════════════════════════════════════════════════
  SELECT * INTO v_reg
  FROM public.presencia_personal pp
  WHERE pp.project_id   = p_project_id
    AND pp.personal_id  = v_ficha
    AND pp.hora_entrada IS NOT NULL
    AND pp.hora_salida  IS NULL
    AND pp.fecha       >= v_fecha - 1
    AND pp.anulado_en IS NULL   -- ▼ 20260908000200: idem para la salida.
  ORDER BY pp.fecha DESC, pp.hora_entrada DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una entrada abierta que cerrar. Marcá primero tu entrada.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.presencia_personal pp
     SET hora_salida       = v_hora,
         foto_salida       = v_foto,
         gps_salida        = v_gps,
         salida_marcada_en = now(),
         observaciones     = NULLIF(
           btrim(concat_ws(' · ', NULLIF(btrim(COALESCE(pp.observaciones, '')), ''), v_obs)), '')
   WHERE pp.id = v_reg.id;

  RETURN QUERY SELECT v_reg.id, v_reg.fecha, v_hora, v_reg.estado, 'salida'::text;
END;
$$;

COMMENT ON FUNCTION public.presencia_marcar(uuid, text, text, jsonb, text) IS
  'Marcaje de asistencia por el propio empleado. La HORA y la FECHA las pone el servidor en la zona del tenant (nunca el cliente); el expediente sale de personal_condominio.user_id; el turno y la tardanza, del bloque planificado. La foto debe estar ya subida a presencia-evidencias bajo <project>/<ficha propia>/. Entrada: completa la fila del día o la crea, y rechaza el doble marcaje. Salida: cierra la última entrada abierta de las últimas 48 h (turno nocturno). Ignora las filas anuladas, que no ocupan el día (20260908000200). No exige el permiso del tab Presencia: exige SER el empleado.';

REVOKE EXECUTE ON FUNCTION public.presencia_marcar(uuid, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_marcar(uuid, text, text, jsonb, text) TO authenticated;
