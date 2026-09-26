-- ============================================================================
-- COBROS REACTIVADOS Y VERIFICADOS SIN FECHA: vigencia desconocida al corte
--
-- 20261005000000 reconstruye el estado de un cobro sin asiento por intervalos
-- de su bitácora de rechazos. Tras una reactivación a un estado NO vigente
-- (p. ej. `pendiente`) y una verificación posterior, el inicio de la vigencia
-- se tomaba como GREATEST(fecha de la reactivación, verified_at). Con
-- `verified_at` NULL, GREATEST ignora el NULL y devolvía la fecha de la
-- reactivación: una fecha DESCONOCIDA se acreditaba como vigencia histórica
-- (el cobro figuraba vigente en cortes en que quizá seguía sin verificar).
-- Lo mismo con un `verified_at` anterior a la reactivación (el que quedó del
-- rechazo): no es la fecha de la verificación posterior.
--
-- Contrato:
--   · Un solo lugar calcula el estado de un cobro al corte:
--     conta_ec_cobro_al_corte (lo usan conta_ec_fuera_de_saldo y
--     conta_ec_limitaciones, que así no pueden divergir).
--   · Tras reactivarse a un estado no vigente, la vigencia empieza en la
--     verificación posterior SÓLO si está registrada y no es anterior a la
--     reactivación. Si no: inicio desconocido.
--   · Inicio desconocido, corte histórico: el cobro no se lista y cuenta en
--     la limitación nueva `verificacion_sin_fecha`. No se le inventa fecha.
--   · Inicio desconocido, corte de hoy (o sin corte): su estado de hoy sí se
--     conoce; se lista con fecha NULL, `limitacion = verificacion_sin_fecha`
--     y una nota.
--   · Nada más cambia: los otros intervalos, los cobros con asiento, los que
--     no tienen eventos, saldos, reversos y asientos publicados.
--
-- CÓMO SE REVIERTE: restaurar conta_ec_fuera_de_saldo y conta_ec_limitaciones
-- desde 20261005000000 y después DROP FUNCTION
-- public.conta_ec_cobro_al_corte(uuid, date).
-- ============================================================================

-- ── 1. Estado de un cobro al corte ──────────────────────────────────────────
CREATE FUNCTION public.conta_ec_cobro_al_corte(p_pago uuid, p_hasta date)
RETURNS TABLE (
  t_estado    text,
  t_desde     date,
  t_sin_fecha boolean,
  le_at       timestamptz,
  nx_evento   text,
  nx_at       timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    -- estado en el intervalo que contiene el corte: el anterior al siguiente
    -- evento, o el de hoy si no hay ninguno después
    COALESCE(nx.estado_anterior, p.estado),
    CASE
      -- antes del primer evento: desde su verificación (la que había ANTES de
      -- que el rechazo pudiera reescribirla); sin ella, la convención de
      -- siempre del estado de cuenta (created_at)
      WHEN le.ocurrido_at IS NULL THEN COALESCE(nx.verified_at_anterior, p.created_at)::date
      -- reactivado directamente a vigente: desde la reactivación
      WHEN le.estado_nuevo IN ('verificado', 'aplicado') THEN le.ocurrido_at::date
      -- reactivado a otro estado y verificado después: desde esa verificación,
      -- sólo si está registrada y no es anterior a la reactivación. Si no, no
      -- se sabe (NULL): nunca la fecha de la reactivación.
      WHEN v.v_fin >= le.ocurrido_at THEN v.v_fin::date
    END,
    (le.ocurrido_at IS NOT NULL
     AND le.estado_nuevo NOT IN ('verificado', 'aplicado')
     AND COALESCE(nx.estado_anterior, p.estado) IN ('verificado', 'aplicado')
     AND (v.v_fin IS NULL OR v.v_fin < le.ocurrido_at)),
    le.ocurrido_at,
    nx.evento,
    nx.ocurrido_at
    FROM public.pagos p
    CROSS JOIN LATERAL (SELECT COALESCE(p_hasta, 'infinity'::date) AS h) par
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
    -- la verificación con que termina el intervalo: la que guardó el
    -- siguiente evento, o la de hoy si no hay siguiente
    CROSS JOIN LATERAL (
      SELECT CASE WHEN nx.ocurrido_at IS NOT NULL THEN nx.verified_at_anterior
                  ELSE p.verified_at END AS v_fin
    ) v
   WHERE p.id = p_pago
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ec_cobro_al_corte(uuid, date) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_ec_cobro_al_corte(uuid, date) IS
  'Estado de un cobro al corte según pagos_rechazo_eventos: t_estado del intervalo, t_desde (inicio de su vigencia, NULL si no se conoce) y t_sin_fecha (vigente hoy pero verificado sin fecha tras reactivarse). Uso interno del estado de cuenta.';

-- ── 2. Fuera del saldo al corte ─────────────────────────────────────────────
-- Cuerpo idéntico a 20261005000000 salvo: el estado del cobro al corte sale
-- de conta_ec_cobro_al_corte, y el verificado sin fecha tras reactivarse sólo
-- figura en el corte de hoy, marcado (fecha NULL, limitacion y nota).
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
           -- Cobro con historia (20261005000000, 20261006000000): su estado
           -- al corte sale de la bitácora (conta_ec_cobro_al_corte).
           hx.t_estado, hx.t_desde, hx.t_sin_fecha, hx.le_at, hx.nx_evento, hx.nx_at
      FROM ev e
      CROSS JOIN par
      -- Estado del cobro al corte según la bitácora (20261006000000).
      LEFT JOIN LATERAL (
        SELECT k.* FROM public.conta_ec_cobro_al_corte(e.o_id, p_hasta) k WHERE e.o_hist
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
                THEN s.t_estado IN ('verificado', 'aplicado')
                     AND (s.t_desde <= s.h
                          -- Verificado sin fecha tras reactivarse: sólo el
                          -- corte de HOY conoce su estado (el de hoy); en un
                          -- corte histórico es limitación (conta_ec_limitaciones).
                          OR (s.t_sin_fecha AND s.nx_evento IS NULL AND NOT s.historico))
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
             || CASE WHEN c.o_hist AND c.t_sin_fecha THEN
                  ' Se reactivó el ' || to_char(c.le_at::date, 'YYYY-MM-DD')
                  || ' y después se verificó sin fecha registrada: se lista por su estado de hoy.'
                ELSE '' END
         END,
         a.id, a.numero, a.fecha,
         CASE WHEN c.k = 'cobro_sin_vinculo' AND c.historico THEN 'estado_actual_sin_fecha'
              WHEN c.o_hist AND c.t_sin_fecha THEN 'verificacion_sin_fecha' END
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

-- ── 3. Limitaciones ─────────────────────────────────────────────────────────
-- Cuerpo idéntico a 20261005000000 salvo `sinv` y su fila
-- `verificacion_sin_fecha`.
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
    SELECT c.id, c.pago_id, LEAST(c.deleted_at, c.anulada_at) AS cancelado_at FROM public.cuotas_condominio c
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
  -- Cobros sin asiento reactivados a un estado no vigente y verificados
  -- después sin fecha registrada (20261006000000): al corte, en ese
  -- intervalo, no se sabe si ya estaban vigentes. No se listan ni se les
  -- inventa fecha (ni la de la reactivación ni otra).
  sinv AS (
    SELECT DISTINCT p.id, p.monto
      FROM (SELECT c.id AS cuota_id, c.pago_id, NULL::uuid AS cargo_id, c.cancelado_at FROM cu c
            UNION ALL
            SELECT NULL, NULL, x.id, NULL::timestamptz FROM public.cargos_adicionales_unidad x
             WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
               AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
               AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)) d
      JOIN public.pagos p ON (p.cuota_id = d.cuota_id OR d.pago_id = p.id OR p.cargo_adicional_id = d.cargo_id)
      CROSS JOIN LATERAL public.conta_ec_cobro_al_corte(p.id, p_hasta) k
     WHERE k.t_sin_fecha
       AND (d.cancelado_at IS NULL OR d.cancelado_at::date > p_hasta)
       AND (p.deleted_at IS NULL OR p.deleted_at::date > p_hasta)
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = p_company AND a.origen = 'automatico'
            AND a.origen_tabla = 'pagos' AND a.origen_id = p.id AND a.origen_evento = 'pago_contabilizado')
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
  UNION ALL
  SELECT 'verificacion_sin_fecha', count(*), sum(s.monto)::numeric(14,2),
         'Cobros sin asiento que se reactivaron y después se verificaron sin fecha de verificación registrada: no se sabe desde cuándo estaban vigentes al corte. No se listan como pendientes.'
    FROM sinv s
   WHERE p_hasta IS NOT NULL AND p_hasta < CURRENT_DATE
  HAVING count(*) > 0
$$;

REVOKE EXECUTE ON FUNCTION public.conta_ec_limitaciones(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
