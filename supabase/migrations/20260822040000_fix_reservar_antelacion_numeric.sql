-- FIX: portal_reservar_amenidad falla con
--      "function make_interval(hours => numeric) does not exist"
--
-- La regla de anticipación (20260822030000) usaba
--   make_interval(hours => v_amen.horas_minimas_antelacion)
-- cuya firma exige INT. La migración histórica 20260425000004 declaraba
-- amenidades.horas_minimas_antelacion como int, pero en la base de PRODUCCIÓN la
-- columna es NUMERIC (drift del esquema real vs el repo). plpgsql resuelve los
-- nombres en la PRIMERA ejecución, no al crear la función: el apply pasó en
-- verde y el error apareció en runtime, en la primera reserva de una amenidad
-- con anticipación configurada — mismo patrón que el fix de 20260724000000.
--
-- Cambio: multiplicación numérica × interval ('h * interval ''1 hour'''),
-- válida para int y numeric. El resto del cuerpo es IDÉNTICO línea a línea al
-- de 20260822030000. Sin impacto en datos: solo se reemplaza la función.

CREATE OR REPLACE FUNCTION public.portal_reservar_amenidad(
  p_amenidad_id uuid,
  p_unidad_id uuid,
  p_fecha date,
  p_hora_inicio time,
  p_hora_fin time,
  p_num_invitados int DEFAULT 0,
  p_notas text DEFAULT NULL,
  p_metodo_pago text DEFAULT NULL,
  p_reglamento_aceptado boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_amen     public.amenidades%ROWTYPE;
  v_unidad   public.unidades%ROWTYPE;
  v_ahora    timestamp := (now() AT TIME ZONE 'America/Guatemala');
  v_tarifa   numeric(12,2) := 0;
  v_aplica   boolean;
  v_estado   text;
  v_cuota_id uuid;
  v_reserva  public.reservas_amenidades%ROWTYPE;
  v_ini_min  int;
  v_fin_min  int;
  v_usadas   int;
BEGIN
  -- Identidad: residente del portal con la unidad propia (dual: propietario
  -- legacy ∪ unidad_residentes), o STAFF del tenant con el mismo gate que tenía
  -- la policy de INSERT — la vista previa del portal (PortalResidenteTab) la usa
  -- el staff y reserva por este mismo camino.
  IF p_unidad_id IS NULL THEN
    RAISE EXCEPTION 'Unidad requerida.';
  END IF;
  SELECT * INTO v_unidad FROM public.unidades WHERE id = p_unidad_id AND activo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidad no encontrada o inactiva.';
  END IF;
  IF current_user_role() = 'cliente' THEN
    IF NOT EXISTS (SELECT 1 FROM public.mis_unidades_ids() x WHERE x = p_unidad_id) THEN
      RAISE EXCEPTION 'No autorizado: la unidad no le pertenece.';
    END IF;
  ELSIF NOT (is_super_admin()
             OR (v_unidad.company_id = get_my_company_id()
                 AND user_has_permission('condominios.tab.amenidades'))) THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  -- LOCK de la amenidad: serializa las reservas concurrentes de la MISMA
  -- amenidad que pasan por este RPC — el chequeo de conflicto de abajo queda
  -- sin carrera. company/project se derivan de ESTA fila (trg_set_project_id de
  -- 20260729000600 impone project_id desde la amenidad y exige company_id igual).
  SELECT * INTO v_amen FROM public.amenidades
   WHERE id = p_amenidad_id AND activo = true
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Amenidad no encontrada o inactiva.';
  END IF;
  IF v_amen.project_id IS DISTINCT FROM v_unidad.project_id THEN
    RAISE EXCEPTION 'La amenidad no pertenece al proyecto de la unidad.';
  END IF;

  -- Insumos básicos (espejo de hacerReserva + CHECK horas_validas de 20260524000000).
  IF p_fecha IS NULL OR p_hora_inicio IS NULL OR p_hora_fin IS NULL THEN
    RAISE EXCEPTION 'Fecha y horario son requeridos.';
  END IF;
  IF p_hora_fin <= p_hora_inicio THEN
    RAISE EXCEPTION 'La hora de fin debe ser posterior al inicio.';
  END IF;
  IF COALESCE(p_num_invitados, 0) < 0 THEN
    RAISE EXCEPTION 'Número de invitados inválido.';
  END IF;
  IF p_fecha < v_ahora::date THEN
    RAISE EXCEPTION 'No se puede reservar en fechas pasadas.';
  END IF;

  -- Reglamento.
  IF v_amen.reglamento IS NOT NULL AND NOT COALESCE(p_reglamento_aceptado, false) THEN
    RAISE EXCEPTION 'Debe leer y aceptar el reglamento antes de reservar.';
  END IF;

  -- Reglas configurables (espejo de validarReglasAmenidad).
  IF v_amen.duracion_max_horas IS NOT NULL AND v_amen.duracion_max_horas > 0
     AND (EXTRACT(EPOCH FROM (p_hora_fin - p_hora_inicio)) / 3600.0) > v_amen.duracion_max_horas THEN
    RAISE EXCEPTION 'La duración máxima permitida es de % horas.', v_amen.duracion_max_horas;
  END IF;
  IF v_amen.horas_minimas_antelacion IS NOT NULL AND v_amen.horas_minimas_antelacion > 0
     AND (p_fecha + p_hora_inicio) < v_ahora + (v_amen.horas_minimas_antelacion * interval '1 hour') THEN
    RAISE EXCEPTION 'Debes reservar con al menos % h de anticipación.', v_amen.horas_minimas_antelacion;
  END IF;
  IF v_amen.max_reservas_mes_unidad IS NOT NULL AND v_amen.max_reservas_mes_unidad > 0 THEN
    -- Server-side cuenta TODAS las reservas del mes (el cliente solo veía las
    -- futuras cargadas en memoria).
    SELECT count(*) INTO v_usadas
      FROM public.reservas_amenidades r
     WHERE r.amenidad_id = v_amen.id
       AND r.unidad_id = p_unidad_id
       AND r.estado <> 'cancelada'
       AND r.fecha >= date_trunc('month', p_fecha)::date
       AND r.fecha <  (date_trunc('month', p_fecha) + interval '1 month')::date;
    IF v_usadas >= v_amen.max_reservas_mes_unidad THEN
      RAISE EXCEPTION 'Esta unidad ya alcanzó el límite de % reserva(s) este mes para esta amenidad.',
        v_amen.max_reservas_mes_unidad;
    END IF;
  END IF;

  -- Bloqueos de la administración (hora NULL = día completo — espejo de
  -- bloqueoSolapaReserva).
  IF EXISTS (
    SELECT 1 FROM public.amenidades_bloqueos b
     WHERE b.amenidad_id = v_amen.id
       AND p_fecha BETWEEN b.fecha_inicio AND b.fecha_fin
       AND (b.hora_inicio IS NULL
            OR (p_hora_inicio < b.hora_fin AND p_hora_fin > b.hora_inicio))
  ) THEN
    RAISE EXCEPTION 'La amenidad no está disponible en esa fecha/horario (bloqueo de la administración).';
  END IF;

  -- Conflicto GLOBAL contra TODAS las reservas confirmadas (SECURITY DEFINER ve
  -- las de otras unidades, que el residente no ve — cierra la doble-reserva).
  -- En MINUTOS enteros clamped a [0,1440]: `time ± interval` en Postgres ENVUELVE
  -- (00:30 − 60min = 23:30), el mismo defecto que el wrap de addMinutosToTime JS.
  -- Solape medio-abierto idéntico al cliente: ini < efFin AND fin > efIni.
  v_ini_min := EXTRACT(HOUR FROM p_hora_inicio)::int * 60 + EXTRACT(MINUTE FROM p_hora_inicio)::int;
  v_fin_min := EXTRACT(HOUR FROM p_hora_fin)::int    * 60 + EXTRACT(MINUTE FROM p_hora_fin)::int;
  IF EXISTS (
    SELECT 1
      FROM public.reservas_amenidades r,
      LATERAL (SELECT
        GREATEST(0,
          EXTRACT(HOUR FROM r.hora_inicio)::int * 60 + EXTRACT(MINUTE FROM r.hora_inicio)::int
          - COALESCE(v_amen.minutos_preparacion_previa, 0))    AS ef_ini,
        LEAST(1440,
          EXTRACT(HOUR FROM r.hora_fin)::int * 60 + EXTRACT(MINUTE FROM r.hora_fin)::int
          + COALESCE(v_amen.minutos_preparacion_posterior, 0)) AS ef_fin
      ) e
     WHERE r.amenidad_id = v_amen.id
       AND r.fecha = p_fecha
       AND r.estado = 'confirmada'
       AND v_ini_min < e.ef_fin
       AND v_fin_min > e.ef_ini
  ) THEN
    RAISE EXCEPTION 'Esa amenidad ya está reservada en ese horario (o en su tiempo de preparación). Elige otro.';
  END IF;

  -- Tarifa SERVER-SIDE (nunca del cliente) — espejo de tarifaAplicable:
  -- EXTRACT(DOW): 0=domingo, 6=sábado (igual que getDay() sobre T12:00 local).
  IF v_amen.requiere_tarifa THEN
    IF EXTRACT(DOW FROM p_fecha) IN (0, 6) AND v_amen.tarifa_uso_finde IS NOT NULL THEN
      v_tarifa := v_amen.tarifa_uso_finde;
    ELSE
      v_tarifa := COALESCE(v_amen.tarifa_uso, 0);
    END IF;
  END IF;
  v_aplica := v_amen.requiere_tarifa AND v_tarifa > 0;
  IF v_aplica THEN
    IF p_metodo_pago IS NULL OR p_metodo_pago NOT IN ('cargar_unidad', 'pagar_momento') THEN
      RAISE EXCEPTION 'Indica cómo pagarás la tarifa (cargar a la unidad o pagar al momento).';
    END IF;
  ELSE
    p_metodo_pago := NULL;  -- sin tarifa no se persiste método (paridad con el flujo actual)
  END IF;

  v_estado := CASE WHEN v_amen.requiere_aprobacion THEN 'pendiente' ELSE 'confirmada' END;

  -- Cuota + reserva EN LA MISMA transacción: cualquier RAISE posterior revierte
  -- la cuota (muere la compensación best-effort del navegador). Cuota SOLO si
  -- confirmada + tarifa + cargar_unidad; 'pendiente' nunca genera cuota — la
  -- crea el admin al aprobar (flujo existente de AmenidadesTab.aprobarReserva).
  IF v_estado = 'confirmada' AND v_aplica AND p_metodo_pago = 'cargar_unidad' THEN
    INSERT INTO public.cuotas_condominio
      (company_id, project_id, unidad_id, concepto, monto, periodo,
       fecha_vencimiento, estado, notas, created_by)
    VALUES
      (v_amen.company_id, v_amen.project_id, p_unidad_id, 'amenidad', v_tarifa,
       to_char(p_fecha, 'YYYY-MM'), p_fecha, 'pendiente',
       'Reserva ' || v_amen.nombre || ' ' || to_char(p_fecha, 'YYYY-MM-DD')
         || ' ' || left(p_hora_inicio::text, 5) || '-' || left(p_hora_fin::text, 5),
       -- cuotas_condominio NO está en trg_sellar_creado_por (20260731000000):
       -- se sella aquí. rol_responsable queda NULL ⇒ visible para todos los
       -- residentes de la unidad (20260713070000).
       auth.uid())
    RETURNING id INTO v_cuota_id;
  END IF;

  INSERT INTO public.reservas_amenidades
    (company_id, amenidad_id, unidad_id, cliente_id, fecha, hora_inicio, hora_fin,
     num_invitados, notas, estado, monto_tarifa, metodo_pago_tarifa, tarifa_pagada,
     cuota_id, deposito_estado, reglamento_aceptado_at, created_by)
  VALUES
    (v_amen.company_id, v_amen.id, p_unidad_id, public.get_my_cliente_id(),
     p_fecha, p_hora_inicio, p_hora_fin,
     COALESCE(p_num_invitados, 0), NULLIF(btrim(p_notas), ''), v_estado,
     CASE WHEN v_aplica THEN v_tarifa END, p_metodo_pago, false,
     v_cuota_id,
     CASE WHEN v_amen.requiere_deposito THEN 'pendiente' ELSE 'no_aplica' END,
     CASE WHEN v_amen.reglamento IS NOT NULL THEN now() END,
     auth.uid())
  RETURNING * INTO v_reserva;
  -- project_id lo impone trg_set_project_id desde la amenidad (ignora el payload).

  RETURN to_jsonb(v_reserva);
END;
$fn$;

REVOKE ALL ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean) TO authenticated;
COMMENT ON FUNCTION public.portal_reservar_amenidad(uuid,uuid,date,time,time,int,text,text,boolean) IS
  'El residente (propietario o inquilino vía mis_unidades_ids) reserva una amenidad. Valida TODO server-side (reglas, bloqueos, conflicto global bajo FOR UPDATE de la amenidad) y calcula la tarifa en el servidor; si aplica cargar_unidad y la reserva queda confirmada, crea la cuota ''amenidad'' en la misma transacción. Horas = reloj de pared America/Guatemala.';
