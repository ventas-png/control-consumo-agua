-- ============================================================================
-- ESTADO DE CUENTA · corte histórico coherente (correctiva de 20261003000000)
--
-- 20261003000000 y 20261003000100 ya están aplicadas en el sandbox; no se
-- reescriben.
--
-- EL DEFECTO. El saldo ya se calculaba al corte (líneas publicadas con fecha
-- contable <= corte), pero la lista «fuera del saldo» clasificaba cada
-- documento con su estado de HOY: una cuota emitida en enero cuyo asiento se
-- publicó con fecha de febrero no aparecía al consultar enero (hoy tiene
-- asiento vivo) aunque ese asiento no estaba en el saldo de enero; un cobro
-- reversado después del corte se mostraba como reversado; un documento
-- anulado después del corte desaparecía de un corte en el que estaba vigente;
-- y el estado del documento (pagado, rechazado…) se mostraba sin decir que es
-- el de hoy.
--
-- EL CRITERIO. Al corte H (sin corte = hoy, sin límite):
--   · EN EL SALDO: un asiento publicado del evento con fecha contable <= H
--     cuyo reverso, si existe, tiene fecha contable > H. Es exactamente lo que
--     suma el saldo; no se lista.
--   · CONTABILIZADO DESPUÉS DEL CORTE (clase nueva contabilizado_despues): su
--     asiento publicado tiene fecha contable > H. Al corte no estaba en el
--     saldo; en un corte >= esa fecha entra al saldo y deja de listarse.
--   · BORRADOR: un asiento en borrador creado <= H.
--   · REVERSADO AL CORTE: su asiento y el reverso tienen fecha contable <= H y
--     el documento seguía vigente al corte (codigo asiento_reversado).
--   · PENDIENTE: nada de lo anterior; el motivo es el del último intento
--     registrado <= H. Si no había intento a esa fecha, se dice
--     (sin_intento_al_corte) y el motivo de hoy se rotula como tal.
--   · Vigencia del documento AL CORTE, no hoy:
--       cuota   anulación/borrado por deleted_at / anulada_at (> H = vigente);
--       cobro   verificado <= H; borrado por deleted_at; rechazo fechado por
--               el registro del reverso de su asiento;
--       cargo   anulación fechada por el registro del reverso de su asiento.
--     Un cobro rechazado o un cargo anulado SIN asiento no dejan fecha de
--     rechazo/anulación: no se puede saber si estaban vigentes al corte. No
--     se listan y se informan como LIMITACIÓN (conta_ec_limitaciones), igual
--     que el «pagado» de un cargo adicional, que tampoco tiene fecha.
--   · estado_documento pasa a llamarse estado_actual: es el de hoy y así se
--     rotula.
--   · Movimientos: un reverso con fecha contable posterior al corte no se
--     presenta como reverso de la fila (reversado_despues_del_corte).
--
-- Las fechas contables mandan sobre el saldo, como en cualquier libro: un
-- reverso de período abierto lleva la fecha del original, así que un cobro
-- rechazado después del corte, con su reverso fechado antes, aparece «fuera
-- del saldo · asiento reversado» con el motivo que lo explica.
--
-- QUÉ NO CAMBIA. El saldo, los movimientos y la conciliación (que ya evaluaba
-- asientos y reversos al corte). No se escribe nada: sólo lectura.
--
-- CÓMO SE REVIERTE:
--   DROP FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer);
--   DROP FUNCTION public.conta_ec_limitaciones(uuid, uuid, uuid, uuid, date);
--   DROP FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date);
--   y recrear las tres funciones públicas y conta_ec_fuera_de_saldo desde
--   20261003000000 / 20261003000100.
-- ============================================================================

-- El tipo de retorno cambia (estado_actual, asiento_fecha, limitacion): hay
-- que soltar y recrear. conta_estado_cuenta la invoca por nombre y se redefine
-- abajo en esta misma migración.
DROP FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer);
DROP FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date);

-- ── 1. Documentos fuera del saldo, AL CORTE ─────────────────────────────────
CREATE FUNCTION public.conta_ec_fuera_de_saldo(
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
           c.cancelado_at AS o_cancel, false AS o_cancel_por_reverso
      FROM cu c WHERE COALESCE(c.monto, 0) > 0
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', 'cargo',
           public.conta_fecha_evento_cargo('cuotas_condominio', c.id, 'cuota_mora'),
           'Mora · ' || c.concepto || ' ' || c.periodo,
           'recargo_mora', c.unidad_id, c.responsable_cliente_id,
           c.mora_monto, c.estado, c.por_tipo, c.cancelado_at, false
      FROM cu c WHERE COALESCE(c.mora_monto, 0) > 0
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', 'cargo', x.fecha_cargo, x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, x.monto, x.estado, x.por_tipo,
           NULL::timestamptz, x.estado = 'anulado'
      FROM ca x WHERE COALESCE(x.monto, 0) > 0
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (p.id)
             'pagos'::text, p.id, 'pago_contabilizado'::text, 'abono'::text,
             COALESCE(p.verified_at, p.created_at)::date,
             'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), '') || ' · ' || c.concepto || ' ' || c.periodo,
             c.tipo_cargo, c.unidad_id, c.responsable_cliente_id, p.monto, p.estado, c.por_tipo,
             -- el cobro de una cuota anulada deja de estar vigente con ella
             LEAST(p.deleted_at, c.cancelado_at), p.estado = 'rechazado'
        FROM cu c
        JOIN public.pagos p ON (p.cuota_id = c.id OR c.pago_id = p.id)
       WHERE p.estado IN ('verificado', 'aplicado', 'rechazado')
       ORDER BY p.id, c.id
    ) pg
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
           ia.motivo AS ia_motivo
      FROM ev e
      CROSS JOIN par
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
           CASE WHEN s.o_cancel IS NOT NULL AND s.o_cancel::date > s.h THEN s.o_cancel::date
                WHEN s.o_cancel_por_reverso AND s.anul_creado::date > s.h THEN s.anul_creado::date
           END AS cancelado_despues,
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
     WHERE s.o_fecha <= s.h
       AND (s.o_cancel IS NULL OR s.o_cancel::date > s.h)
       AND (NOT s.o_cancel_por_reverso OR s.anul_creado::date > s.h)
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
        OR (v.o_tabla = 'cargos_adicionales_unidad' AND v.o_estado = 'pagado')
  )
  SELECT c.k, c.o_nat, c.o_tabla, c.o_id, c.o_evento, c.o_fecha, c.o_concepto, c.o_tipo,
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
                  ' El documento se anuló después del corte, el ' || to_char(c.cancelado_despues, 'YYYY-MM-DD') || '.'
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

-- ── 2. Lo que no se puede reconstruir al corte ──────────────────────────────
-- Sólo para cortes ANTERIORES a hoy (sin corte, el estado de hoy es el que se
-- pide). Documentos que hoy están rechazados/anulados sin asiento que feche el
-- cambio: no se sabe si al corte estaban vigentes, así que no se listan como
-- pendientes, y se cuentan aquí para que la omisión sea visible.
CREATE FUNCTION public.conta_ec_limitaciones(
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
      FROM cu c
      JOIN public.pagos p ON (p.cuota_id = c.id OR c.pago_id = p.id)
     WHERE p.estado = 'rechazado'
       AND COALESCE(p.verified_at, p.created_at)::date <= p_hasta
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
         'Cobros HOY rechazados que nunca tuvieron asiento: el sistema no registra cuándo se rechazaron, así que no se puede saber si estaban vigentes al corte. No se listan como pendientes.'::text
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

-- ── 3. Estado de cuenta: igual que 20261003000100, con limitaciones y
--      reversos rotulados respecto del corte ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta(
  p_project_id uuid,
  p_cliente_id uuid    DEFAULT NULL,
  p_unidad_id  uuid    DEFAULT NULL,
  p_desde      date    DEFAULT NULL,
  p_hasta      date    DEFAULT NULL,
  p_limite     integer DEFAULT 100,
  p_offset     integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_sujeto  jsonb;
  v_res     jsonb;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));

  IF p_desde IS NOT NULL AND p_hasta IS NOT NULL AND p_desde > p_hasta THEN
    RAISE EXCEPTION 'La fecha inicial es posterior a la final.' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
    RAISE EXCEPTION 'El tamaño de página debe estar entre 1 y 500.' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'El desplazamiento no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT jsonb_build_object('tipo', 'cliente', 'id', cl.id, 'nombre', cl.nombre,
                              'codigo_auxiliar', ax.codigo)
      INTO v_sujeto
      FROM public.clientes cl
      LEFT JOIN public.conta_auxiliares ax ON ax.company_id = v_company AND ax.cliente_id = cl.id
     WHERE cl.id = p_cliente_id;
  ELSE
    SELECT jsonb_build_object('tipo', 'unidad', 'id', u.id, 'nombre', u.nombre)
      INTO v_sujeto
      FROM public.unidades u WHERE u.id = p_unidad_id;
  END IF;

  WITH base AS (
    SELECT * FROM public.conta_ec_lineas(v_company, p_project_id, p_cliente_id, p_unidad_id) b
     WHERE p_hasta IS NULL OR b.fecha <= p_hasta
  ),
  ini AS (
    SELECT COALESCE(sum(b.debe - b.haber), 0)::numeric(14,2) AS saldo
      FROM base b WHERE p_desde IS NOT NULL AND b.fecha < p_desde
  ),
  per AS (
    SELECT b.*,
           (SELECT saldo FROM ini)
             + sum(b.debe - b.haber) OVER w AS saldo,
           row_number() OVER w AS n
      FROM base b
     WHERE p_desde IS NULL OR b.fecha >= p_desde
    WINDOW w AS (ORDER BY b.fecha, b.asiento_numero NULLS LAST, b.asiento_creado, b.asiento_id,
                          b.linea_orden, b.linea_id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  ),
  tot AS (
    SELECT count(*) AS movimientos,
           COALESCE(sum(p.debe), 0)::numeric(14,2)  AS cargos,
           COALESCE(sum(p.haber), 0)::numeric(14,2) AS abonos
      FROM per p
  ),
  por_tipo AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'tipo_cargo', t.tipo_cargo,
             'saldo_inicial', t.ini, 'cargos', t.cargos, 'abonos', t.abonos,
             'saldo_final', t.ini + t.cargos - t.abonos) ORDER BY t.tipo_cargo NULLS LAST), '[]'::jsonb) AS j
      FROM (
        SELECT b.tipo_cargo,
               COALESCE(sum(b.debe - b.haber) FILTER (WHERE p_desde IS NOT NULL AND b.fecha < p_desde), 0)::numeric(14,2) AS ini,
               COALESCE(sum(b.debe)  FILTER (WHERE p_desde IS NULL OR b.fecha >= p_desde), 0)::numeric(14,2) AS cargos,
               COALESCE(sum(b.haber) FILTER (WHERE p_desde IS NULL OR b.fecha >= p_desde), 0)::numeric(14,2) AS abonos
          FROM base b GROUP BY b.tipo_cargo
      ) t
  ),
  pagina AS (
    SELECT p.* FROM per p
     WHERE p.n > p_offset AND p.n <= p_offset + p_limite
  ),
  filas AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'n', p.n,
             'linea_id', p.linea_id,
             'asiento_id', p.asiento_id,
             'asiento_numero', p.asiento_numero,
             'fecha', p.fecha,
             'origen', p.origen,
             'documento_tabla', CASE WHEN p.origen = 'automatico' THEN p.origen_tabla END,
             'documento_id', CASE WHEN p.origen = 'automatico' THEN p.origen_id END,
             'evento', p.origen_evento,
             'documento', CASE
                WHEN p.origen <> 'automatico' THEN 'Póliza manual'
                WHEN p.origen_tabla = 'cuotas_condominio' THEN
                  COALESCE('Cuota ' || c.concepto || ' ' || c.periodo, 'Cuota')
                WHEN p.origen_tabla = 'cargos_adicionales_unidad' THEN
                  COALESCE('Cargo ' || ca.concepto, 'Cargo adicional')
                WHEN p.origen_tabla = 'pagos' THEN
                  'Pago' || COALESCE(' ' || pg.metodo, '')
                    || COALESCE(' ref. ' || NULLIF(pg.referencia, ''), '')
                    || COALESCE(' · cuota ' || cap.concepto || ' ' || cap.periodo, '')
                ELSE p.origen_tabla
              END,
             'concepto', p.asiento_concepto,
             'descripcion', p.linea_descripcion,
             'tipo_cargo', p.tipo_cargo,
             'componente', CASE
                WHEN p.origen_tabla = 'pagos' AND p.origen = 'automatico' THEN
                  CASE WHEN p.tipo_cargo = 'recargo_mora' THEN 'mora' ELSE 'principal' END
                WHEN p.origen_evento LIKE 'cuota_mora%' THEN 'mora'
                WHEN p.origen_evento LIKE 'cuota_emitida%' THEN 'principal'
                WHEN p.origen_evento LIKE 'cargo_adicional_emitido%' THEN 'cargo'
              END,
             'cuota_id', ap.cuota_id,
             'cuenta_id', p.cuenta_id,
             'cuenta_codigo', cta.codigo,
             'cuenta_nombre', cta.nombre,
             'unidad_id', p.unidad_id,
             'unidad_nombre', un.nombre,
             'auxiliar_id', p.auxiliar_cliente_id,
             'auxiliar_nombre', cl.nombre,
             'es_reverso', p.reversa_de_id IS NOT NULL,
             'reversa_de_id', p.reversa_de_id,
             'reversa_de_numero', ro.numero,
             -- Un reverso con fecha POSTERIOR al corte no existía a esa fecha:
             -- no se presenta como reverso, se avisa aparte.
             'reversado_por_id', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.id END,
             'reversado_por_numero', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.numero END,
             'reversado_por_fecha', CASE WHEN rv.id IS NOT NULL AND (p_hasta IS NULL OR rv.fecha <= p_hasta) THEN rv.fecha END,
             'reversado_despues_del_corte', rv.id IS NOT NULL AND p_hasta IS NOT NULL AND rv.fecha > p_hasta,
             'reversado_despues_fecha', CASE WHEN rv.id IS NOT NULL AND p_hasta IS NOT NULL AND rv.fecha > p_hasta THEN rv.fecha END,
             'cargo', p.debe,
             'abono', p.haber,
             'saldo', p.saldo::numeric(14,2)
           ) ORDER BY p.n), '[]'::jsonb) AS j
      FROM pagina p
      LEFT JOIN public.conta_cuentas cta ON cta.id = p.cuenta_id
      LEFT JOIN public.unidades un ON un.id = p.unidad_id
      LEFT JOIN public.clientes cl ON cl.id = p.auxiliar_cliente_id
      LEFT JOIN public.conta_asientos ro ON ro.id = p.reversa_de_id
      LEFT JOIN public.conta_asientos rv ON rv.id = p.anulado_por_id
      LEFT JOIN public.cuotas_condominio c
        ON p.origen = 'automatico' AND p.origen_tabla = 'cuotas_condominio' AND c.id = p.origen_id
      LEFT JOIN public.cargos_adicionales_unidad ca
        ON p.origen = 'automatico' AND p.origen_tabla = 'cargos_adicionales_unidad' AND ca.id = p.origen_id
      LEFT JOIN public.pagos pg
        ON p.origen = 'automatico' AND p.origen_tabla = 'pagos' AND pg.id = p.origen_id
      LEFT JOIN LATERAL (
        SELECT x.cuota_id FROM public.conta_cobro_aplicaciones x
         WHERE p.origen = 'automatico' AND p.origen_tabla = 'pagos'
           AND x.asiento_id = COALESCE(p.reversa_de_id, p.asiento_id)
           AND x.evento = CASE WHEN p.tipo_cargo = 'recargo_mora' THEN 'cuota_mora' ELSE 'cuota_emitida' END
         LIMIT 1
      ) ap ON true
      LEFT JOIN public.cuotas_condominio cap ON cap.id = ap.cuota_id
  ),
  fuera_filas AS (
    SELECT * FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta)
  ),
  fuera AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'clase', f.clase, 'naturaleza', f.naturaleza, 'documentos', f.n, 'monto', f.monto)
             ORDER BY f.clase, f.naturaleza), '[]'::jsonb) AS j
      FROM (
        SELECT x.clase, x.naturaleza, count(*) AS n, sum(x.monto)::numeric(14,2) AS monto
          FROM fuera_filas x
         GROUP BY x.clase, x.naturaleza
      ) f
  ),
  -- Lo que NO se puede reconstruir al corte con los datos existentes: se dice,
  -- con cuántos documentos afecta, en vez de presentar el estado de hoy como
  -- si fuera el de entonces.
  limitaciones AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'codigo', l.codigo, 'documentos', l.documentos, 'monto', l.monto, 'descripcion', l.descripcion)
             ORDER BY l.codigo), '[]'::jsonb) AS j
      FROM (
        SELECT * FROM public.conta_ec_limitaciones(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta)
        UNION ALL
        SELECT 'estado_actual_sin_fecha', count(*), sum(x.monto)::numeric(14,2),
               'Cargos adicionales que HOY figuran como pagados: el documento no registra cuándo se marcaron, así que no se sabe si ya lo estaban al corte. Se informan con su estado de hoy.'
          FROM fuera_filas x WHERE x.limitacion = 'estado_actual_sin_fecha'
        HAVING count(*) > 0
      ) l
  )
  SELECT jsonb_build_object(
           'sujeto', v_sujeto,
           'project_id', p_project_id,
           'desde', p_desde,
           'hasta', p_hasta,
           'resumen', jsonb_build_object(
             'saldo_inicial', (SELECT saldo FROM ini),
             'cargos', tot.cargos,
             'abonos', tot.abonos,
             'saldo_final', ((SELECT saldo FROM ini) + tot.cargos - tot.abonos)::numeric(14,2),
             'movimientos', tot.movimientos),
           'por_tipo', (SELECT j FROM por_tipo),
           'fuera_de_saldo', (SELECT j FROM fuera),
           'limitaciones', (SELECT j FROM limitaciones),
           'limite', p_limite,
           'offset', p_offset,
           'movimientos', (SELECT j FROM filas))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

-- ── 4. Documentos fuera del saldo, paginados (retorno nuevo) ────────────────
CREATE FUNCTION public.conta_estado_cuenta_pendientes(
  p_project_id uuid,
  p_cliente_id uuid    DEFAULT NULL,
  p_unidad_id  uuid    DEFAULT NULL,
  p_hasta      date    DEFAULT NULL,
  p_limite     integer DEFAULT 50,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE (
  clase              text,
  naturaleza         text,
  origen_tabla       text,
  origen_id          uuid,
  evento             text,
  fecha              date,
  concepto           text,
  tipo_cargo         text,
  unidad_id          uuid,
  unidad_nombre      text,
  responsable_id     uuid,
  responsable_nombre text,
  monto              numeric,
  estado_actual      text,
  codigo             text,
  motivo             text,
  asiento_id         uuid,
  asiento_numero     bigint,
  asiento_fecha      date,
  limitacion         text,
  total_filas        bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
    RAISE EXCEPTION 'El tamaño de página debe estar entre 1 y 500.' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'El desplazamiento no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT f.clase, f.naturaleza, f.origen_tabla, f.origen_id, f.evento, f.fecha, f.concepto,
         f.tipo_cargo, f.unidad_id, u.nombre, f.responsable_id, cl.nombre,
         f.monto, f.estado_actual, f.codigo, f.motivo, f.asiento_id, f.asiento_numero,
         f.asiento_fecha, f.limitacion,
         count(*) OVER ()
    FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta) f
    LEFT JOIN public.unidades u ON u.id = f.unidad_id
    LEFT JOIN public.clientes cl ON cl.id = f.responsable_id
   ORDER BY f.fecha, f.origen_tabla, f.origen_id, f.evento
   LIMIT p_limite OFFSET p_offset;
END;
$$;

-- ── 5. Permisos de ejecución ─────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_ec_limitaciones(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) IS
  'Documentos del sujeto que no están en su saldo contable AL CORTE: pendientes, contabilizados con fecha posterior al corte, en borrador, reversados al corte, del camino histórico o cargos adicionales pagados sin vínculo. estado_actual es el estado de hoy del documento.';
COMMENT ON FUNCTION public.conta_ec_limitaciones(uuid, uuid, uuid, uuid, date) IS
  'Documentos cuyo estado al corte no se puede reconstruir con los datos existentes (rechazos y anulaciones sin asiento que los feche).';
