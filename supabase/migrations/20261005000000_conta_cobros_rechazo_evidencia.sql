-- ============================================================================
-- FECHA DE RECHAZO DE LOS COBROS Y CORTES HISTÓRICOS
--
-- Un cobro (`pagos`) que se rechaza SIN haber tenido asiento no deja fecha:
-- no hay reverso cuyo registro la diga. El estado de cuenta con corte
-- (20261003000200) no podía situarlo: lo sacaba de TODOS los cortes —también
-- de los anteriores al rechazo, cuando seguía vigente y pendiente— y lo
-- contaba en `limitaciones.rechazo_sin_fecha`. Lo que quedaba en `pagos` no
-- sirve de fecha: `verified_at`/`verified_by` los manda el cliente al rechazar
-- desde Agua (y no se sellan al anular un cobro de cargo), `updated_at`
-- cambia con cualquier escritura y `verification_notes` se puede reescribir.
--
-- 1. EVIDENCIA EN SERVIDOR (`pagos_rechazo_eventos`). Bitácora de SÓLO
--    inserción: cada vez que un cobro PASA a `rechazado` (y, si alguna vez
--    sale de ese estado, también esa reactivación) queda una fila con la hora
--    del servidor (`now()`), el usuario de la sesión (`auth.uid()`, nunca un
--    dato del cliente), el motivo (`verification_notes` en ese momento) y el
--    estado anterior. La escribe `conta_tg_pagos`, el trigger AFTER que ya
--    corre en INSERT/UPDATE/DELETE de `pagos` en todos los entornos: el
--    rechazo desde Agua (UPDATE directo bajo la RLS de `pagos`), la anulación
--    de un cobro de cargo (conta_anular_cobro_cargo) y cualquier otro camino
--    autorizado pasan por él. No se agrega trigger, FK ni CHECK a `pagos`:
--    sus grupos de triggers y constraints tienen drift declarado (#826).
--      · Repetir el rechazo (rechazado → rechazado) no escribe otra fila, no
--        genera otro reverso y no toca la evidencia original.
--      · En un cobro rechazado, `verification_notes`, `verified_by` y
--        `verified_at` ya no se pueden reescribir (PAGO_RECHAZADO_INMUTABLE).
--      · La aplicación no puede escribir la bitácora: sin grants de
--        INSERT/UPDATE/DELETE, sólo lectura por empresa y proyecto.
--      · Reactivación: ningún flujo de la aplicación saca un cobro de
--        `rechazado`, pero la base no lo impide (UPDATE directo). No se
--        prohíbe aquí: se REGISTRA como evento propio, para que una fecha de
--        rechazo nunca se reutilice de forma ambigua.
--
-- 2. CORTES HISTÓRICOS (conta_ec_fuera_de_saldo, conta_ec_limitaciones).
--    Un cobro SIN asiento con eventos en la bitácora tiene su historia
--    completa desde el primero: intervalos separados por cada rechazo y cada
--    reactivación. Su estado a un corte sale del intervalo que lo contiene,
--    no del último rechazo ni del estado de hoy:
--      · antes del primer evento: el `estado_anterior` de ese evento, vigente
--        desde su `verified_at_anterior` —la verificación que había antes de
--        que el rechazo reescribiera `verified_at`—;
--      · tras un rechazo (y hasta la siguiente reactivación): rechazado, no
--        figura;
--      · tras una reactivación: el estado al que pasó, vigente desde la
--        reactivación (nunca desde una verificación anterior);
--      · si figura y el intervalo termina en un rechazo posterior al corte,
--        lleva la nota «se rechazó después del corte, el <fecha>».
--    Un cobro sin verificar en ese intervalo no figura, igual que cualquier
--    cobro sin verificar. La fecha de cada evento se compara como el resto de
--    fechas de registro del estado de cuenta (`anul_creado::date`,
--    `created_at::date`): la fecha de la marca de tiempo en la zona horaria
--    de la sesión de base de datos. Un cobro sin asiento no se convierte en
--    movimiento ni mueve el saldo: sólo cambia su clasificación informativa.
--    Los cobros CON asiento conservan su tratamiento (la fecha sale del
--    reverso, como antes), y los que nunca tuvieron eventos también.
--    Los rechazos anteriores a esta migración no tienen evidencia: NO se
--    rellenan con `created_at`, `updated_at`, `verified_at` ni la fecha de la
--    migración. Siguen declarados en `rechazo_sin_fecha` a todo corte en que
--    su estado dependa de ese rechazo: si el cobro sigue rechazado sin
--    eventos, o si su primer evento es una reactivación posterior al corte
--    (un rechazo o reactivación registrados después no fechan el anterior).
--
-- CÓMO SE REVIERTE (en este orden): restaurar conta_ec_limitaciones y
-- conta_ec_fuera_de_saldo desde 20261004000000 y conta_tg_pagos desde
-- 20261004000100; después, si se decide descartar la evidencia, DROP TABLE
-- public.pagos_rechazo_eventos (se pierde la historia registrada).
-- ============================================================================

-- ── 1. La bitácora ──────────────────────────────────────────────────────────
-- Sin FK a `pagos`: la evidencia de un rechazo sobrevive a un borrado del
-- cobro, y una FK nueva no bloquea borrados que hoy se permiten. Empresa y
-- proyecto se copian del cobro para acotar la lectura.
CREATE TABLE public.pagos_rechazo_eventos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pago_id          uuid        NOT NULL,
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  evento           text        NOT NULL,
  estado_anterior  text        NOT NULL,
  estado_nuevo     text        NOT NULL,
  motivo           text,
  actor            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- `pagos.verified_at` JUSTO ANTES del cambio de estado. Rechazar desde Agua
  -- lo reescribe con la hora del rechazo (o con lo que mande el cliente): sin
  -- esta copia se perdería desde cuándo estaba vigente el cobro. NULL en un
  -- alta (no había estado anterior).
  verified_at_anterior timestamptz,
  -- Reloj del servidor (no el inicio de la transacción): dos cambios de
  -- estado en la misma transacción quedan ordenados.
  ocurrido_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pagos_rechazo_eventos_evento_valido
    CHECK (evento IN ('rechazo', 'reactivacion')),
  CONSTRAINT pagos_rechazo_eventos_coherente
    CHECK ((evento = 'rechazo'      AND estado_nuevo = 'rechazado' AND estado_anterior <> 'rechazado')
        OR (evento = 'reactivacion' AND estado_anterior = 'rechazado' AND estado_nuevo <> 'rechazado'))
);

CREATE INDEX idx_pagos_rechazo_eventos_pago
  ON public.pagos_rechazo_eventos(pago_id, ocurrido_at DESC);

CREATE INDEX idx_pagos_rechazo_eventos_ledger
  ON public.pagos_rechazo_eventos(company_id, project_id, ocurrido_at DESC);

CREATE INDEX idx_pagos_rechazo_eventos_actor
  ON public.pagos_rechazo_eventos(actor) WHERE actor IS NOT NULL;

COMMENT ON TABLE public.pagos_rechazo_eventos IS
  'Evidencia de los rechazos (y reactivaciones) de cobros: hora del servidor, usuario de la sesión, motivo, estado anterior y la verified_at que había antes del cambio. Sólo inserción; la escribe conta_tg_pagos. Da la fecha de rechazo a los cortes históricos del estado de cuenta.';

ALTER TABLE public.pagos_rechazo_eventos ENABLE ROW LEVEL SECURITY;

-- Lectura: la empresa de la sesión Y los proyectos del usuario, como la
-- bitácora de intentos de contabilización.
DROP POLICY IF EXISTS "pagos_rechazo_eventos_select" ON public.pagos_rechazo_eventos;
CREATE POLICY "pagos_rechazo_eventos_select" ON public.pagos_rechazo_eventos
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND public.can_access_project(project_id))
  );

REVOKE ALL ON public.pagos_rechazo_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pagos_rechazo_eventos TO authenticated;
GRANT SELECT ON public.pagos_rechazo_eventos TO service_role;

-- ── 2. El trigger de PAGOS registra la evidencia ─────────────────────────────
-- Cuerpo idéntico a 20261004000100 salvo el bloque de evidencia, justo
-- después de resolver la empresa (antes de cualquier RETURN del UPDATE).
CREATE OR REPLACE FUNCTION public.conta_tg_pagos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_project    uuid;
  v_company    uuid;
  v_moneda     text;
  v_metodo     text;
  v_contra     text;
  v_es_cuota   boolean;
  v_reg_estado text;
BEGIN
  -- Cobros de cargos adicionales (20261004000100): la validación que antes
  -- hacía un trigger BEFORE propio. Lanzar aquí aborta la sentencia igual.
  IF (TG_OP <> 'INSERT' AND OLD.cargo_adicional_id IS NOT NULL)
     OR (TG_OP <> 'DELETE' AND NEW.cargo_adicional_id IS NOT NULL) THEN
    PERFORM public.conta_cobro_cargo_validar_escritura(
      TG_OP,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW END);
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Hard delete de un pago contabilizado → reverso (company vía proyecto).
    v_project := COALESCE(OLD.project_id, (SELECT project_id FROM public.clientes WHERE id = OLD.cliente_id));
    SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
    IF v_company IS NOT NULL THEN
      PERFORM public.conta_reversar_automatico(v_company, 'pagos', OLD.id,
        'pago_contabilizado', 'Pago eliminado');
    END IF;
    RETURN OLD;
  END IF;

  v_project := COALESCE(NEW.project_id, (SELECT project_id FROM public.clientes WHERE id = NEW.cliente_id));
  SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  -- Evidencia del rechazo (20261005000000). La hora es la del servidor y el
  -- actor el de la sesión: nada de lo que manda el cliente. Sólo la
  -- TRANSICIÓN escribe: repetir un rechazo no deja otra fila.
  IF TG_OP = 'UPDATE' AND OLD.estado = 'rechazado' AND NEW.estado = 'rechazado'
     AND (NEW.verification_notes IS DISTINCT FROM OLD.verification_notes
          OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
    RAISE EXCEPTION 'PAGO_RECHAZADO_INMUTABLE: el cobro ya está rechazado; su motivo y sus datos de revisión no se reescriben.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado = 'rechazado'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'rechazado') THEN
    INSERT INTO public.pagos_rechazo_eventos
      (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, motivo, actor,
       verified_at_anterior)
    VALUES
      (NEW.id, v_company, v_project, 'rechazo',
       CASE WHEN TG_OP = 'INSERT' THEN 'alta' ELSE COALESCE(OLD.estado, '-') END,
       'rechazado', NULLIF(btrim(COALESCE(NEW.verification_notes, '')), ''), auth.uid(),
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.verified_at END);
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'rechazado'
        AND NEW.estado IS DISTINCT FROM 'rechazado' THEN
    INSERT INTO public.pagos_rechazo_eventos
      (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, motivo, actor,
       verified_at_anterior)
    VALUES
      (NEW.id, v_company, v_project, 'reactivacion', 'rechazado', COALESCE(NEW.estado, '-'),
       NULL, auth.uid(), OLD.verified_at);
  END IF;

  -- Reverso: rechazado o soft-delete después de contabilizado.
  IF TG_OP = 'UPDATE'
     AND OLD.estado IN ('verificado','aplicado')
     AND (NEW.estado = 'rechazado'
          OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    PERFORM public.conta_reversar_automatico(v_company, 'pagos', NEW.id,
      'pago_contabilizado',
      CASE WHEN NEW.estado = 'rechazado' THEN 'Pago rechazado' ELSE 'Pago eliminado' END);
    -- Cobro de un cargo adicional (20261004000000): el reverso reabre el saldo
    -- y el estado del cargo se vuelve a derivar de sus cobros vivos.
    IF NEW.cargo_adicional_id IS NOT NULL THEN
      PERFORM public.conta_cargo_sincronizar_estado(NEW.cargo_adicional_id);
    END IF;
    RETURN NEW;
  END IF;

  -- Contabilizar: primera transición a verificado/aplicado (pago vivo).
  IF NEW.estado IN ('verificado','aplicado')
     AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('verificado','aplicado'))
     AND COALESCE(NEW.monto, 0) > 0 THEN

    -- Cobro de un CARGO ADICIONAL (20261004000000): se aplica contra la CxC
    -- de su devengo, nunca el mapeo general ni ingreso directo.
    IF NEW.cargo_adicional_id IS NOT NULL THEN
      PERFORM public.conta_contabilizar_cobro_cargo_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    -- Cobro de una cuota contabilizada por tipo (20261002000100): NUNCA el
    -- mapeo general. Reparto mora→principal contra la cuenta y dimensiones de
    -- cada devengo, o pendiente visible si falta alguno.
    IF public.conta_cobro_cuota_por_tipo(NEW.id) IS NOT NULL THEN
      PERFORM public.conta_contabilizar_cobro_seguro(NEW.id, 'cobro');
      RETURN NEW;
    END IF;

    v_metodo := CASE NEW.metodo
      WHEN 'efectivo'        THEN 'metodo_efectivo'
      WHEN 'transferencia'   THEN 'metodo_transferencia'
      WHEN 'deposito'        THEN 'metodo_deposito'
      WHEN 'cheque'          THEN 'metodo_cheque'
      WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
      WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
      WHEN 'paypal'          THEN 'metodo_pasarela'
      ELSE 'metodo_otro'
    END;

    -- Contrapartida: CxC si el documento origen ya devengó; ingreso directo si no.
    v_es_cuota := EXISTS (SELECT 1 FROM public.cuotas_condominio WHERE pago_id = NEW.id);
    IF NEW.registro_id IS NOT NULL THEN
      SELECT factura_estado INTO v_reg_estado FROM public.registros WHERE id = NEW.registro_id;
      v_contra := CASE WHEN v_reg_estado IN ('emitida','vencida','pagada')
                       THEN 'cxc_agua' ELSE 'ingreso_agua' END;
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    ELSIF v_es_cuota THEN
      v_contra := 'cxc_cuotas';
      SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
      FROM public.projects WHERE id = v_project;
    ELSE
      v_contra := 'ingreso_otros';
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    END IF;

    PERFORM public.conta_generar_asiento(
      v_company, v_project, 'pagos', NEW.id, 'pago_contabilizado',
      COALESCE(NEW.verified_at::date, CURRENT_DATE),
      'Pago ' || NEW.metodo || COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
      'ingreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_metodo, 'debe', NEW.monto),
        jsonb_build_object('evento', v_contra, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_pagos() FROM PUBLIC, anon, authenticated;

-- ── 3. Fuera del saldo al corte ─────────────────────────────────────────────
-- Cuerpo idéntico a 20261004000000 salvo, para los cobros CON HISTORIA
-- (con eventos en la bitácora y sin asiento de cobro): su inclusión aunque hoy no estén
-- verificados, su estado y fecha de vigencia al corte reconstruidos con la
-- bitácora (hx), y la nota «se rechazó después del corte». Los demás
-- documentos, y los cobros con asiento, conservan su tratamiento.
CREATE OR REPLACE FUNCTION public.conta_ec_fuera_de_saldo(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (
  clase          text,
  naturaleza     text,
  origen_tabla   text,
  origen_id      uuid,
  evento         text,
  fecha          date,
  concepto       text,
  tipo_cargo     text,
  unidad_id      uuid,
  responsable_id uuid,
  monto          numeric,
  estado_actual  text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_fecha  date,
  limitacion     text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH par AS (
    SELECT COALESCE(p_hasta, 'infinity'::date) AS h,
           (p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE) AS historico
  ),
  cu AS (
    SELECT c.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id) AS por_tipo,
           LEAST(c.deleted_at, c.anulada_at) AS cancelado_at
      FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  ca AS (
    SELECT x.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id) AS por_tipo
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
  ),
  -- Eventos: devengos de cuota, mora y cargo adicional; y cobros de cuotas.
  -- o_cancel = cuándo dejó de estar vigente, si se sabe por el documento.
  -- o_cancel_por_reverso = el documento está anulado/rechazado hoy y su fecha
  -- sólo se conoce por el registro del reverso de su asiento.
  ev AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, 'cuota_emitida'::text AS o_evento,
           'cargo'::text AS o_nat,
           c.created_at::date AS o_fecha, c.concepto || ' ' || c.periodo AS o_concepto,
           c.tipo_cargo AS o_tipo, c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp,
           c.monto AS o_monto, c.estado AS o_estado, c.por_tipo AS o_por_tipo,
           c.cancelado_at AS o_cancel, false AS o_cancel_por_reverso,
           false AS o_hist
      FROM cu c WHERE COALESCE(c.monto, 0) > 0
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', 'cargo',
           public.conta_fecha_evento_cargo('cuotas_condominio', c.id, 'cuota_mora'),
           'Mora · ' || c.concepto || ' ' || c.periodo,
           'recargo_mora', c.unidad_id, c.responsable_cliente_id,
           c.mora_monto, c.estado, c.por_tipo, c.cancelado_at, false, false
      FROM cu c WHERE COALESCE(c.mora_monto, 0) > 0
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', 'cargo', x.fecha_cargo, x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, x.monto, x.estado, x.por_tipo,
           NULL::timestamptz, x.estado = 'anulado', false
      FROM ca x WHERE COALESCE(x.monto, 0) > 0
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (p.id)
             'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
             COALESCE(p.verified_at, p.created_at)::date,
             'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · ' || c.concepto || ' ' || c.periodo,
             c.tipo_cargo, c.unidad_id, c.responsable_cliente_id, p.monto, p.estado, c.por_tipo,
             -- el cobro de una cuota anulada deja de estar vigente con ella
             LEAST(p.deleted_at, c.cancelado_at), p.estado = 'rechazado',
             hs.o_hist
        FROM cu c
        JOIN public.pagos p ON (p.cuota_id = c.id OR c.pago_id = p.id)
      CROSS JOIN LATERAL (
        -- Con historia (20261005000000): tiene eventos en la bitácora y nunca
        -- tuvo asiento de cobro (ningún reverso le da fecha).
        SELECT EXISTS (SELECT 1 FROM public.pagos_rechazo_eventos r WHERE r.pago_id = p.id)
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                                WHERE a.company_id = p_company AND a.origen = 'automatico'
                                  AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                                  AND a.origen_evento = 'pago_contabilizado') AS o_hist
      ) hs
       WHERE (p.estado IN ('verificado', 'aplicado', 'rechazado') OR hs.o_hist)
         AND p.cargo_adicional_id IS NULL
       ORDER BY p.id, c.id
    ) pg
    UNION ALL
    -- Cobros de cargos adicionales (20261004000000). El cargo no se puede
    -- anular con cobros vivos: la vigencia del cobro es la suya.
    SELECT 'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
           COALESCE(p.verified_at, p.created_at)::date,
           'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · cargo ' || x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, p.monto, p.estado, x.por_tipo,
           p.deleted_at, p.estado = 'rechazado', hs.o_hist
      FROM ca x
      JOIN public.pagos p ON p.cargo_adicional_id = x.id
    CROSS JOIN LATERAL (
        -- Con historia (20261005000000): tiene eventos en la bitácora y nunca
        -- tuvo asiento de cobro (ningún reverso le da fecha).
        SELECT EXISTS (SELECT 1 FROM public.pagos_rechazo_eventos r WHERE r.pago_id = p.id)
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos a
                                WHERE a.company_id = p_company AND a.origen = 'automatico'
                                  AND a.origen_tabla = 'pagos' AND a.origen_id = p.id
                                  AND a.origen_evento = 'pago_contabilizado') AS o_hist
      ) hs
     WHERE (p.estado IN ('verificado', 'aplicado', 'rechazado') OR hs.o_hist)
  ),
  -- Asientos del evento evaluados al corte.
  ev_a AS (
    SELECT e.*, par.h, par.historico,
           sal.id AS a_saldo,
           pos.id AS a_post, pos.fecha AS a_post_fecha,
           rev.id AS a_rev, rev.r_fecha, rev.r_creado,
           bor.id AS a_borr, bor.fecha AS a_borr_fecha,
           anu.r_creado AS anul_creado,
           ih.codigo AS ih_codigo, ih.motivo AS ih_motivo,
           ia.motivo AS ia_motivo,
           -- Cobro con historia (20261005000000): su estado al corte sale de
           -- la bitácora. `t_estado` es el estado en que quedó tras el último
           -- evento no posterior al corte (o el anterior al primero), y
           -- `t_desde` desde cuándo estaba vigente en ese intervalo.
           hx.t_estado, hx.t_desde, hx.nx_evento, hx.nx_at
      FROM ev e
      CROSS JOIN par
      LEFT JOIN LATERAL (
        SELECT COALESCE(nx.estado_anterior, p.estado) AS t_estado,
               CASE
                 -- antes del primer evento: vigente desde su verificación
                 -- (la que había ANTES de que el rechazo la reescribiera)
                 WHEN le.ocurrido_at IS NULL THEN
                   COALESCE(nx.verified_at_anterior, p.created_at)::date
                 -- reactivado directamente a vigente: desde la reactivación
                 WHEN le.estado_nuevo IN ('verificado', 'aplicado') THEN
                   le.ocurrido_at::date
                 -- reactivado a otro estado y verificado después: desde esa
                 -- verificación, nunca antes de la reactivación
                 ELSE GREATEST(le.ocurrido_at::date,
                        (CASE WHEN nx.ocurrido_at IS NOT NULL THEN nx.verified_at_anterior
                              ELSE p.verified_at END)::date)
               END AS t_desde,
               nx.evento AS nx_evento, nx.ocurrido_at AS nx_at
          FROM public.pagos p
          LEFT JOIN LATERAL (
            SELECT r.estado_nuevo, r.ocurrido_at FROM public.pagos_rechazo_eventos r
             WHERE r.pago_id = p.id AND r.ocurrido_at::date <= par.h
             ORDER BY r.ocurrido_at DESC, r.id DESC LIMIT 1
          ) le ON true
          LEFT JOIN LATERAL (
            SELECT r.evento, r.estado_anterior, r.verified_at_anterior, r.ocurrido_at
              FROM public.pagos_rechazo_eventos r
             WHERE r.pago_id = p.id AND r.ocurrido_at::date > par.h
             ORDER BY r.ocurrido_at, r.id LIMIT 1
          ) nx ON true
         WHERE e.o_hist AND p.id = e.o_id
      ) hx ON true
      LEFT JOIN LATERAL (
        SELECT a.id FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha <= par.h
           AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                            WHERE r.id = a.anulado_por_id AND r.estado = 'publicado' AND r.fecha <= par.h)
         ORDER BY a.fecha, a.created_at LIMIT 1
      ) sal ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.fecha FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha > par.h
         ORDER BY a.fecha, a.created_at LIMIT 1
      ) pos ON true
      LEFT JOIN LATERAL (
        SELECT a.id, r.fecha AS r_fecha, r.created_at AS r_creado
          FROM public.conta_asientos a
          JOIN public.conta_asientos r ON r.id = a.anulado_por_id AND r.estado = 'publicado'
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'publicado' AND a.fecha <= par.h AND r.fecha <= par.h
         ORDER BY r.created_at DESC LIMIT 1
      ) rev ON true
      LEFT JOIN LATERAL (
        SELECT a.id, a.fecha FROM public.conta_asientos a
         WHERE a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
           AND a.estado = 'borrador' AND a.created_at::date <= par.h
         ORDER BY a.created_at DESC LIMIT 1
      ) bor ON true
      -- Registro del reverso que acompañó la anulación/rechazo (sin corte):
      -- es la única fecha que el sistema guarda de ese cambio de estado.
      LEFT JOIN LATERAL (
        SELECT r.created_at AS r_creado
          FROM public.conta_asientos a
          JOIN public.conta_asientos r ON r.id = a.anulado_por_id AND r.estado = 'publicado'
         WHERE e.o_cancel_por_reverso
           AND a.company_id = p_company AND a.origen = 'automatico'
           AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
         ORDER BY r.created_at DESC LIMIT 1
      ) anu ON true
      LEFT JOIN LATERAL (
        SELECT i.codigo, i.motivo FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
           AND i.created_at::date <= par.h
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1
      ) ih ON true
      LEFT JOIN LATERAL (
        SELECT i.motivo FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1
      ) ia ON true
  ),
  -- Vigencia AL CORTE. Sin fecha de anulación/rechazo conocida, un documento
  -- que hoy está anulado/rechazado no se puede situar: queda fuera (y cuenta
  -- en conta_ec_limitaciones).
  vig AS (
    SELECT s.*,
           CASE WHEN s.o_hist THEN
                  -- lo que antes llegue: la baja del documento o el siguiente rechazo
                  LEAST(CASE WHEN s.o_cancel::date > s.h THEN s.o_cancel::date END,
                        CASE WHEN s.nx_evento = 'rechazo' THEN s.nx_at::date END)
                WHEN s.o_cancel IS NOT NULL AND s.o_cancel::date > s.h THEN s.o_cancel::date
                WHEN s.o_cancel_por_reverso AND s.anul_creado::date > s.h THEN s.anul_creado::date
           END AS cancelado_despues,
           (s.o_hist AND s.nx_evento = 'rechazo'
            AND (s.o_cancel IS NULL OR s.nx_at::date <= s.o_cancel::date)) AS rechazo_fechado,
           CASE WHEN s.o_hist THEN s.t_desde ELSE s.o_fecha END AS f_fecha,
           -- Asiento del camino histórico (sin dimensiones), vivo al corte.
           (SELECT a.id FROM public.conta_asientos a
             WHERE NOT s.o_por_tipo
               AND a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = s.o_tabla AND a.origen_id = s.o_id
               AND a.origen_evento NOT LIKE '%\_revertido'
               AND a.estado = 'publicado' AND a.fecha <= s.h
               AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                                WHERE r.id = a.anulado_por_id AND r.estado = 'publicado' AND r.fecha <= s.h)
             ORDER BY a.fecha DESC, a.created_at DESC LIMIT 1) AS a_hist
      FROM ev_a s
     WHERE (s.o_cancel IS NULL OR s.o_cancel::date > s.h)
       AND CASE WHEN s.o_hist
                -- Con historia: vigente al corte si en ese intervalo estaba
                -- verificado/aplicado desde una fecha no posterior al corte.
                -- Un intervalo cuyo inicio no se conoce (NULL) no se lista.
                THEN s.t_estado IN ('verificado', 'aplicado') AND s.t_desde <= s.h
                ELSE s.o_fecha <= s.h
                     AND (NOT s.o_cancel_por_reverso OR s.anul_creado::date > s.h)
           END
  ),
  clas AS (
    SELECT v.*,
           CASE
             WHEN NOT v.o_por_tipo THEN 'fuera_del_auxiliar'
             WHEN v.a_saldo IS NOT NULL THEN 'cobro_sin_vinculo'
             WHEN v.a_post IS NOT NULL THEN 'contabilizado_despues'
             WHEN v.a_borr IS NOT NULL THEN 'borrador'
             ELSE 'pendiente'
           END AS k
      FROM vig v
     WHERE NOT v.o_por_tipo
        OR v.a_saldo IS NULL
        -- «pagado» SIN cobro vinculado (marcado antes de 20261004000000): el
        -- estado de cuenta no puede acreditarlo. Con cobros, el estado se
        -- deriva de ellos y sus abonos ya están en el saldo.
        OR (v.o_tabla = 'cargos_adicionales_unidad' AND v.o_estado = 'pagado'
            AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cargo_adicional_id = v.o_id))
  )
  SELECT c.k, c.o_nat, c.o_tabla, c.o_id, c.o_evento, c.f_fecha, c.o_concepto, c.o_tipo,
         c.o_unidad, c.o_resp, c.o_monto, c.o_estado,
         CASE c.k
           WHEN 'contabilizado_despues' THEN 'contabilizado_despues_del_corte'
           WHEN 'pendiente' THEN
             CASE WHEN c.a_rev IS NOT NULL THEN 'asiento_reversado'
                  ELSE COALESCE(c.ih_codigo, 'sin_intento_al_corte') END
         END,
         CASE c.k
           WHEN 'fuera_del_auxiliar' THEN
             CASE WHEN c.a_hist IS NOT NULL THEN
               CASE WHEN c.o_nat = 'abono'
                 THEN 'Cobro contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.'
                 ELSE 'Contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.' END
             ELSE
               CASE WHEN c.o_nat = 'abono'
                 THEN 'Cobro de una cuota del camino histórico: no entra en este saldo.'
                 ELSE 'Anterior a la contabilización por tipo o sin clasificar: no se contabiliza retroactivamente.' END
             END
           WHEN 'cobro_sin_vinculo' THEN
             'Hoy el documento figura como pagado, pero los cargos adicionales no tienen pago vinculado: el estado de cuenta no puede acreditarlo.'
             || CASE WHEN c.historico THEN ' El documento no registra cuándo se marcó como pagado: es su estado de hoy, no necesariamente el del corte.' ELSE '' END
           WHEN 'contabilizado_despues' THEN
             'Contabilizado con fecha ' || to_char(c.a_post_fecha, 'YYYY-MM-DD')
             || ', posterior al corte: a esa fecha no estaba en el saldo. Entra al saldo en los cortes desde el '
             || to_char(c.a_post_fecha, 'YYYY-MM-DD') || '.'
           WHEN 'borrador' THEN
             CASE WHEN c.o_nat = 'abono'
               THEN 'Su asiento está en borrador: no reduce el saldo hasta publicarse.'
               ELSE 'Su asiento está en borrador: no suma al saldo hasta publicarse.' END
           ELSE
             CASE
               WHEN c.a_rev IS NOT NULL AND c.cancelado_despues IS NOT NULL THEN
                 'Al corte seguía vigente; se anuló el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD')
                 || ' y el reverso de su asiento lleva fecha contable ' || to_char(c.r_fecha, 'YYYY-MM-DD')
                 || ', no posterior al corte: no está en el saldo a esa fecha.'
               WHEN c.a_rev IS NOT NULL THEN
                 'Su asiento fue reversado con fecha ' || to_char(c.r_fecha, 'YYYY-MM-DD')
                 || ' y el documento sigue vigente: no se recrea automáticamente.'
               WHEN c.ih_codigo IS NOT NULL THEN
                 COALESCE(c.ih_motivo, 'Sin asiento contabilizado.')
               ELSE
                 'Sin intento de contabilización registrado a la fecha de corte.'
                 || COALESCE(' Motivo de hoy: ' || c.ia_motivo, '')
             END
             || CASE WHEN c.a_rev IS NULL AND c.cancelado_despues IS NOT NULL THEN
                  CASE WHEN c.rechazo_fechado
                    THEN ' El cobro se rechazó después del corte, el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD') || '.'
                    ELSE ' El documento se anuló después del corte, el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD') || '.' END
                ELSE '' END
         END,
         a.id, a.numero, a.fecha,
         CASE WHEN c.k = 'cobro_sin_vinculo' AND c.historico THEN 'estado_actual_sin_fecha' END
    FROM clas c
    LEFT JOIN public.conta_asientos a ON a.id = CASE c.k
           WHEN 'fuera_del_auxiliar' THEN c.a_hist
           WHEN 'cobro_sin_vinculo' THEN c.a_saldo
           WHEN 'contabilizado_despues' THEN c.a_post
           WHEN 'borrador' THEN c.a_borr
           ELSE c.a_rev
         END
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;

-- ── 4. Limitaciones ─────────────────────────────────────────────────────────
-- Cuerpo idéntico a 20261004000000 salvo `rech`: cuenta los cobros cuyo
-- estado al corte depende de un rechazo SIN evidencia (a/b abajo), y el
-- texto que lo dice. Un cobro cuya historia al corte está en la bitácora
-- deja de contar; uno con un rechazo legado ANTES del corte, no.
CREATE OR REPLACE FUNCTION public.conta_ec_limitaciones(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (codigo text, documentos bigint, monto numeric, descripcion text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH cu AS (
    SELECT c.id, c.pago_id FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  rech AS (
    SELECT DISTINCT p.id, p.monto
      FROM (SELECT c.id AS cuota_id, c.pago_id, NULL::uuid AS cargo_id FROM cu c
            UNION ALL
            -- cobros de cargos adicionales (20261004000000)
            SELECT NULL, NULL, x.id FROM public.cargos_adicionales_unidad x
             WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
               AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
               AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)) d
      JOIN public.pagos p ON (p.cuota_id = d.cuota_id OR d.pago_id = p.id OR p.cargo_adicional_id = d.cargo_id)
      -- Primer evento registrado del cobro (20261005000000), si lo hay.
      LEFT JOIN LATERAL (
        SELECT e.evento, e.ocurrido_at, e.verified_at_anterior FROM public.pagos_rechazo_eventos e
         WHERE e.pago_id = p.id ORDER BY e.ocurrido_at, e.id LIMIT 1
      ) fe ON true
     WHERE (
             -- (a) rechazado sin ningún evento: el rechazo es anterior a la
             --     bitácora y no se sabe cuándo ocurrió.
             (fe.evento IS NULL AND p.estado = 'rechazado'
              AND COALESCE(p.verified_at, p.created_at)::date <= p_hasta)
             -- (b) su primer evento es una REACTIVACIÓN posterior al corte:
             --     antes hubo un rechazo sin fecha, así que al corte no se
             --     sabe si seguía vigente o ya estaba rechazado. Un rechazo
             --     o reactivación posterior no le devuelve la fecha. El
             --     umbral es el mismo de (a), con la `verified_at` que tenía
             --     el cobro al reactivarse.
          OR (fe.evento = 'reactivacion' AND fe.ocurrido_at::date > p_hasta
              AND COALESCE(fe.verified_at_anterior, p.created_at)::date <= p_hasta)
           )
       AND (p.deleted_at IS NULL OR p.deleted_at::date > p_hasta)
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id AND a.origen_evento = 'pago_contabilizado'
            AND a.anulado_por_id IS NOT NULL)
  ),
  anul AS (
    SELECT x.id, x.monto FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
       AND x.estado = 'anulado' AND x.fecha_cargo <= p_hasta
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = x.id
            AND a.origen_evento = 'cargo_adicional_emitido'
            AND a.anulado_por_id IS NOT NULL)
  )
  SELECT 'rechazo_sin_fecha'::text, count(*), sum(r.monto)::numeric(14,2),
         'Cobros sin asiento que se rechazaron antes de que el sistema registrara la fecha de los rechazos: no se puede saber si al corte estaban vigentes o ya rechazados. No se listan como pendientes.'::text
    FROM rech r
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
  UNION ALL
  SELECT 'anulacion_sin_fecha', count(*), sum(n.monto)::numeric(14,2),
         'Cargos adicionales HOY anulados que nunca tuvieron asiento: el sistema no registra cuándo se anularon, así que no se puede saber si estaban vigentes al corte. No se listan como pendientes.'
    FROM anul n
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ec_limitaciones(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
