-- ============================================================================
-- ESTADO DE CUENTA POR AUXILIAR (CLIENTE) Y POR UNIDAD
-- (tercera entrega del bloque «auxiliares con imputación por tipo de cargo»)
--
-- QUÉ RESPONDE. Cuánto debe un auxiliar —o una unidad— en una contabilidad,
-- entre dos fechas: saldo inicial, cada movimiento del período con su saldo
-- acumulado y saldo final; qué documentos todavía NO están en ese saldo, y si
-- el saldo contable cuadra con los documentos y las aplicaciones reales de
-- los cobros.
--
-- DE DÓNDE SALE EL SALDO. Sólo de asientos PUBLICADOS: las líneas de las
-- cuentas por cobrar con la dimensión del auxiliar (o de la unidad) que
-- #889 añadió y #890 llena al contabilizar por tipo. Un borrador, un
-- documento pendiente o uno contabilizado por el camino histórico (sin
-- dimensiones) NUNCA suma al saldo: se listan aparte, con su motivo.
--
-- QUÉ ES «CUENTA POR COBRAR». No se deduce por prefijo ni por código. Son las
-- cuentas a las que la contabilidad efectivamente cargó los devengos por tipo
-- (línea de cargo de cuota_emitida, cuota_mora y cargo_adicional_emitido),
-- las que registró como destino de un cobro (conta_cobro_aplicaciones) y las
-- configuradas como CxC por tipo de cargo (salvo agua, que no entra aquí).
--
-- RESPONSABLE HISTÓRICO. Las dimensiones de cada línea se fijan al
-- contabilizar con el responsable del documento al EMITIRSE, y el cobro las
-- hereda de su devengo. Cambiar después el pagador de la unidad no mueve nada:
-- el estado de cuenta del cliente anterior conserva sus cargos y abonos, y el
-- de la unidad los muestra todos, cada uno con su responsable.
--
-- PRINCIPAL Y MORA. El asiento de un cobro por tipo tiene una línea de abono
-- por porción (mora primero, luego principal), cada una con la cuenta y el
-- tipo de su devengo; conta_cobro_aplicaciones registra lo mismo. El estado
-- de cuenta muestra esas líneas: la suma de las porciones es el cobro, que
-- así no se cuenta dos veces.
--
-- REVERSOS. Un asiento reversado sigue publicado y su reverso es otro asiento
-- publicado (misma fecha si el período estaba abierto; la de hoy si estaba
-- cerrado). Los dos se muestran: una consulta con corte ANTERIOR al reverso
-- ve el cargo o el abono; una POSTERIOR ve ambos y el efecto neto es cero.
-- No se oculta historia ni se descuenta dos veces.
--
-- CARGOS ADICIONALES. Todavía no tienen vínculo con los pagos: su devengo
-- aparece como cargo y queda debiendo. Si el documento dice «pagado», se
-- informa como cobro sin vínculo; no se inventa un abono.
--
-- QUÉ NO CAMBIA. No se escribe nada: sólo funciones de lectura. La
-- contabilización de agua, las cuotas sin clasificar y el camino histórico
-- siguen igual.
--
-- SIN ÍNDICES NUEVOS, a propósito. Filtrar por auxiliar o unidad pediría un
-- índice en conta_asiento_lineas, pero los índices de esa tabla son drift
-- DECLARADO (drift-conocido.json: producción tiene uno que el repositorio no
-- describe, #826). Tocarlos aquí dejaría el grupo en tres versiones distintas
-- —producción, main y este PR— y el auditor, con razón, no puede decidir. La
-- consulta usa idx_conta_lineas_cuenta (company_id, cuenta_id) y filtra la
-- dimensión después; el índice por auxiliar/unidad va cuando ese drift se
-- resuelva contra producción.
--
-- SEGURIDAD. Las tres funciones públicas son SECURITY DEFINER y exigen, en el
-- servidor: empresa activa; permiso de ver la contabilidad (rol de empresa o
-- platform.contabilidad.view); proyecto de la empresa y accesible
-- (can_access_project); y un sujeto de ESA empresa: el cliente vinculado a la
-- empresa o la unidad del proyecto. Las auxiliares no se pueden invocar desde
-- la aplicación.
--
-- CÓMO SE REVIERTE:
--   DROP FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date);
--   DROP FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer);
--   DROP FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer);
--   DROP FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date);
--   DROP FUNCTION public.conta_ec_lineas(uuid, uuid, uuid, uuid);
--   DROP FUNCTION public.conta_ec_cuentas_cxc(uuid, uuid);
--   DROP FUNCTION public.conta_ec_autorizar(uuid, uuid, uuid);
-- ============================================================================

-- ── 1. Autorización y sujeto ─────────────────────────────────────────────────
-- Devuelve la empresa de la sesión si puede consultar ese sujeto en ese
-- ledger; si no, aborta. Exactamente uno de cliente o unidad.
CREATE OR REPLACE FUNCTION public.conta_ec_autorizar(
  p_project_id uuid,
  p_cliente_id uuid,
  p_unidad_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
          OR public.user_has_permission('platform.contabilidad.view')) THEN
    RAISE EXCEPTION 'No autorizado para ver la contabilidad.' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  IF (p_cliente_id IS NULL) = (p_unidad_id IS NULL) THEN
    RAISE EXCEPTION 'Indica un auxiliar (cliente) o una unidad, uno solo.' USING ERRCODE = '22023';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.company_clientes cc
     WHERE cc.company_id = v_company AND cc.cliente_id = p_cliente_id
  ) THEN
    RAISE EXCEPTION 'El auxiliar no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF p_unidad_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.unidades u
     WHERE u.id = p_unidad_id AND u.company_id = v_company
       AND u.project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RAISE EXCEPTION 'La unidad no pertenece a esta contabilidad.' USING ERRCODE = '42501';
  END IF;

  RETURN v_company;
END;
$$;

-- ── 2. Cuentas por cobrar del ledger (sin prefijos ni códigos) ───────────────
CREATE OR REPLACE FUNCTION public.conta_ec_cuentas_cxc(p_company uuid, p_project uuid)
RETURNS TABLE (cuenta_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  -- a) donde se cargaron los devengos por tipo (sus líneas llevan tipo_cargo)
  SELECT l.cuenta_id
    FROM public.conta_asientos a
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
   WHERE a.company_id = p_company AND a.project_id IS NOT DISTINCT FROM p_project
     AND a.origen = 'automatico' AND a.reversa_de_id IS NULL
     AND a.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
     AND a.origen_evento IN ('cuota_emitida','cuota_mora','cargo_adicional_emitido')
     AND l.debe > 0 AND l.tipo_cargo IS NOT NULL
  UNION
  -- b) donde se aplicaron los cobros
  SELECT ap.cuenta_id
    FROM public.conta_cobro_aplicaciones ap
   WHERE ap.company_id = p_company AND ap.project_id IS NOT DISTINCT FROM p_project
  UNION
  -- c) las configuradas como CxC por tipo (el agua no entra en este estado)
  SELECT cfg.cuenta_cxc_id
    FROM public.conta_config_tipo_cargo cfg
   WHERE cfg.company_id = p_company AND cfg.project_id IS NOT DISTINCT FROM p_project
     AND cfg.tipo_cargo <> 'agua'
$$;

-- ── 3. Líneas contables del sujeto: publicadas, en CxC, con su dimensión ────
CREATE OR REPLACE FUNCTION public.conta_ec_lineas(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid
)
RETURNS TABLE (
  linea_id            uuid,
  linea_orden         integer,
  linea_descripcion   text,
  asiento_id          uuid,
  asiento_numero      bigint,
  asiento_creado      timestamptz,
  fecha               date,
  origen              text,
  origen_tabla        text,
  origen_id           uuid,
  origen_evento       text,
  asiento_concepto    text,
  reversa_de_id       uuid,
  anulado_por_id      uuid,
  cuenta_id           uuid,
  auxiliar_cliente_id uuid,
  unidad_id           uuid,
  tipo_cargo          text,
  debe                numeric,
  haber               numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT l.id, l.orden, l.descripcion,
         a.id, a.numero, a.created_at, a.fecha,
         a.origen, a.origen_tabla, a.origen_id, a.origen_evento, a.concepto,
         a.reversa_de_id, a.anulado_por_id,
         l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo,
         l.debe, l.haber
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
   WHERE l.company_id = p_company AND a.company_id = p_company
     AND a.project_id IS NOT DISTINCT FROM p_project
     AND a.estado = 'publicado'
     AND l.cuenta_id IN (SELECT c.cuenta_id FROM public.conta_ec_cuentas_cxc(p_company, p_project) c)
     AND (p_cliente IS NULL OR l.auxiliar_cliente_id = p_cliente)
     AND (p_unidad  IS NULL OR l.unidad_id = p_unidad)
$$;

-- ── 4. Documentos del sujeto que NO están en el saldo contable ──────────────
-- clase:
--   pendiente           por tipo, sin asiento vivo: último intento con su motivo
--   borrador            por tipo, su asiento está en borrador
--   fuera_del_auxiliar  camino histórico (sin clasificar o anterior a la
--                       contabilización por tipo): sus líneas no llevan el
--                       auxiliar ni la unidad
--   cobro_sin_vinculo   cargo adicional contabilizado que el documento marca
--                       como pagado: no hay pago vinculado que acreditar
-- naturaleza: cargo (aumentaría lo que se debe) o abono (lo reduciría).
-- Por cliente se atribuye por el responsable HISTÓRICO del documento; un
-- documento anterior a #889 no tiene responsable y sólo aparece por unidad.
CREATE OR REPLACE FUNCTION public.conta_ec_fuera_de_saldo(
  p_company uuid,
  p_project uuid,
  p_cliente uuid,
  p_unidad  uuid,
  p_hasta   date
)
RETURNS TABLE (
  clase            text,
  naturaleza       text,
  origen_tabla     text,
  origen_id        uuid,
  evento           text,
  fecha            date,
  concepto         text,
  tipo_cargo       text,
  unidad_id        uuid,
  responsable_id   uuid,
  monto            numeric,
  estado_documento text,
  codigo           text,
  motivo           text,
  asiento_id       uuid,
  asiento_numero   bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH cu AS (
    SELECT c.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id) AS por_tipo
      FROM public.cuotas_condominio c
     WHERE c.company_id = p_company AND c.project_id IS NOT DISTINCT FROM p_project
       AND c.deleted_at IS NULL
       AND (p_unidad  IS NULL OR c.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR c.responsable_cliente_id = p_cliente)
  ),
  ca AS (
    SELECT x.*,
           EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id) AS por_tipo
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = p_company AND x.project_id IS NOT DISTINCT FROM p_project
       AND x.estado IS DISTINCT FROM 'anulado'
       AND (p_unidad  IS NULL OR x.unidad_id = p_unidad)
       AND (p_cliente IS NULL OR x.responsable_cliente_id = p_cliente)
  ),
  ev AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, 'cuota_emitida'::text AS o_evento,
           c.created_at::date AS o_fecha, c.concepto || ' ' || c.periodo AS o_concepto,
           c.tipo_cargo AS o_tipo, c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp,
           c.monto AS o_monto, c.estado AS o_estado, c.por_tipo AS o_por_tipo
      FROM cu c WHERE COALESCE(c.monto, 0) > 0
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora',
           public.conta_fecha_evento_cargo('cuotas_condominio', c.id, 'cuota_mora'),
           'Mora · ' || c.concepto || ' ' || c.periodo,
           'recargo_mora', c.unidad_id, c.responsable_cliente_id,
           c.mora_monto, c.estado, c.por_tipo
      FROM cu c WHERE COALESCE(c.mora_monto, 0) > 0
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', x.fecha_cargo, x.concepto,
           public.conta_tipo_cargo_de_documento('cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido'),
           x.unidad_id, x.responsable_cliente_id, x.monto, x.estado, x.por_tipo
      FROM ca x WHERE COALESCE(x.monto, 0) > 0
  ),
  ev_estado AS (
    SELECT e.*,
           (SELECT a.id FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
               AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
             LIMIT 1) AS a_vivo,
           (SELECT a.id FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
               AND a.estado = 'borrador'
             ORDER BY a.created_at DESC LIMIT 1) AS a_borrador,
           EXISTS (SELECT 1 FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id AND a.origen_evento = e.o_evento
               AND a.estado = 'publicado' AND a.anulado_por_id IS NOT NULL) AS reversado,
           (SELECT a.id FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = e.o_tabla AND a.origen_id = e.o_id
               AND a.origen_evento NOT LIKE '%\_revertido'
               AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
             ORDER BY a.created_at DESC LIMIT 1) AS a_historico,
           (SELECT i.codigo FROM public.conta_intentos_contabilizacion i
             WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
             ORDER BY i.created_at DESC, i.id DESC LIMIT 1) AS i_codigo,
           (SELECT i.motivo FROM public.conta_intentos_contabilizacion i
             WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
             ORDER BY i.created_at DESC, i.id DESC LIMIT 1) AS i_motivo
      FROM ev e
  ),
  docs AS (
    SELECT CASE
             WHEN NOT s.o_por_tipo THEN 'fuera_del_auxiliar'
             WHEN s.a_vivo IS NOT NULL THEN 'cobro_sin_vinculo'
             WHEN s.a_borrador IS NOT NULL THEN 'borrador'
             ELSE 'pendiente'
           END AS clase,
           'cargo'::text AS naturaleza,
           s.o_tabla, s.o_id, s.o_evento, s.o_fecha, s.o_concepto, s.o_tipo, s.o_unidad, s.o_resp,
           s.o_monto, s.o_estado,
           CASE WHEN s.o_por_tipo AND s.a_vivo IS NULL AND s.a_borrador IS NULL THEN
             CASE WHEN s.reversado THEN 'asiento_reversado' ELSE s.i_codigo END END AS codigo,
           CASE
             WHEN NOT s.o_por_tipo AND s.a_historico IS NOT NULL THEN
               'Contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.'
             WHEN NOT s.o_por_tipo THEN
               'Anterior a la contabilización por tipo o sin clasificar: no se contabiliza retroactivamente.'
             WHEN s.a_vivo IS NOT NULL THEN
               'El documento está marcado como pagado, pero los cargos adicionales no tienen pago vinculado: el estado de cuenta no puede acreditarlo.'
             WHEN s.a_borrador IS NOT NULL THEN
               'Su asiento está en borrador: no suma al saldo hasta publicarse.'
             WHEN s.reversado THEN
               'Su asiento fue reversado y el documento sigue vigente: no se recrea automáticamente.'
             ELSE COALESCE(s.i_motivo, 'Sin asiento contabilizado.')
           END AS motivo,
           CASE
             WHEN NOT s.o_por_tipo THEN s.a_historico
             WHEN s.a_vivo IS NOT NULL THEN s.a_vivo
             ELSE s.a_borrador
           END AS asiento
      FROM ev_estado s
     WHERE NOT s.o_por_tipo
        OR s.a_vivo IS NULL
        OR (s.o_tabla = 'cargos_adicionales_unidad' AND s.o_estado = 'pagado')
  ),
  pg AS (
    SELECT DISTINCT ON (p.id)
           p.id, p.monto, p.metodo, p.referencia, p.estado,
           COALESCE(p.verified_at, p.created_at)::date AS fecha,
           c.id AS cuota_id, c.concepto || ' ' || c.periodo AS cuota_concepto,
           c.tipo_cargo, c.unidad_id, c.responsable_cliente_id, c.por_tipo
      FROM cu c
      JOIN public.pagos p ON (p.cuota_id = c.id OR c.pago_id = p.id)
     WHERE p.deleted_at IS NULL AND p.estado IN ('verificado','aplicado')
     ORDER BY p.id, c.id
  ),
  pg_estado AS (
    SELECT g.*,
           (SELECT a.id FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = 'pagos' AND a.origen_id = g.id AND a.origen_evento = 'pago_contabilizado'
               AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
             LIMIT 1) AS a_vivo,
           (SELECT a.id FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = 'pagos' AND a.origen_id = g.id AND a.origen_evento = 'pago_contabilizado'
               AND a.estado = 'borrador'
             ORDER BY a.created_at DESC LIMIT 1) AS a_borrador,
           EXISTS (SELECT 1 FROM public.conta_asientos a
             WHERE a.company_id = p_company AND a.origen = 'automatico'
               AND a.origen_tabla = 'pagos' AND a.origen_id = g.id AND a.origen_evento = 'pago_contabilizado'
               AND a.estado = 'publicado' AND a.anulado_por_id IS NOT NULL) AS reversado,
           (SELECT i.codigo FROM public.conta_intentos_contabilizacion i
             WHERE i.origen_tabla = 'pagos' AND i.origen_id = g.id AND i.evento = 'pago_contabilizado'
             ORDER BY i.created_at DESC, i.id DESC LIMIT 1) AS i_codigo,
           (SELECT i.motivo FROM public.conta_intentos_contabilizacion i
             WHERE i.origen_tabla = 'pagos' AND i.origen_id = g.id AND i.evento = 'pago_contabilizado'
             ORDER BY i.created_at DESC, i.id DESC LIMIT 1) AS i_motivo
      FROM pg g
  ),
  cobros AS (
    SELECT CASE
             WHEN NOT s.por_tipo THEN 'fuera_del_auxiliar'
             WHEN s.a_borrador IS NOT NULL THEN 'borrador'
             ELSE 'pendiente'
           END,
           'abono'::text,
           'pagos'::text, s.id, 'pago_contabilizado'::text, s.fecha,
           'Pago ' || s.metodo || COALESCE(' ref. ' || NULLIF(s.referencia, ''), '') || ' · ' || s.cuota_concepto,
           s.tipo_cargo, s.unidad_id, s.responsable_cliente_id, s.monto, s.estado,
           CASE WHEN s.por_tipo AND s.a_borrador IS NULL THEN
             CASE WHEN s.reversado THEN 'asiento_reversado' ELSE s.i_codigo END END,
           CASE
             WHEN NOT s.por_tipo AND s.a_vivo IS NOT NULL THEN
               'Cobro contabilizado por el mapeo general: su asiento no lleva el auxiliar ni la unidad, así que no entra en este saldo.'
             WHEN NOT s.por_tipo THEN
               'Cobro de una cuota del camino histórico: no entra en este saldo.'
             WHEN s.a_borrador IS NOT NULL THEN
               'Su asiento está en borrador: no reduce el saldo hasta publicarse.'
             WHEN s.reversado THEN
               'Su asiento fue reversado y el cobro sigue vigente: no se recrea automáticamente.'
             ELSE COALESCE(s.i_motivo, 'Sin asiento contabilizado.')
           END,
           CASE WHEN NOT s.por_tipo THEN s.a_vivo ELSE s.a_borrador END
      FROM pg_estado s
     WHERE NOT s.por_tipo OR s.a_vivo IS NULL
  ),
  todo AS (
    SELECT * FROM docs
    UNION ALL
    SELECT * FROM cobros
  )
  SELECT t.clase, t.naturaleza, t.o_tabla, t.o_id, t.o_evento, t.o_fecha, t.o_concepto, t.o_tipo,
         t.o_unidad, t.o_resp, t.o_monto, t.o_estado, t.codigo, t.motivo,
         t.asiento, a.numero
    FROM todo t
    LEFT JOIN public.conta_asientos a ON a.id = t.asiento
   WHERE p_hasta IS NULL OR t.o_fecha <= p_hasta
$$;

-- ── 5. Estado de cuenta: resumen y movimientos paginados ────────────────────
-- Todo se calcula sobre el conjunto completo antes de paginar: saldo inicial,
-- totales, saldo final y el saldo acumulado de cada fila no dependen de la
-- página. Orden estable: fecha, folio, creación del asiento, asiento, línea.
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
             'reversado_por_id', p.anulado_por_id,
             'reversado_por_numero', rv.numero,
             'reversado_por_fecha', rv.fecha,
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
  fuera AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'clase', f.clase, 'naturaleza', f.naturaleza, 'documentos', f.n, 'monto', f.monto)
             ORDER BY f.clase, f.naturaleza), '[]'::jsonb) AS j
      FROM (
        SELECT x.clase, x.naturaleza, count(*) AS n, sum(x.monto)::numeric(14,2) AS monto
          FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta) x
         GROUP BY x.clase, x.naturaleza
      ) f
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
           'limite', p_limite,
           'offset', p_offset,
           'movimientos', (SELECT j FROM filas))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

-- ── 6. Documentos fuera del saldo, paginados ────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta_pendientes(
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
  estado_documento   text,
  codigo             text,
  motivo             text,
  asiento_id         uuid,
  asiento_numero     bigint,
  total_filas        bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
    RAISE EXCEPTION 'El tamaño de página debe estar entre 1 y 500.' USING ERRCODE = '22023';
  END IF;
  IF p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'El desplazamiento no puede ser negativo.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT f.clase, f.naturaleza, f.origen_tabla, f.origen_id, f.evento, f.fecha, f.concepto,
         f.tipo_cargo, f.unidad_id, u.nombre, f.responsable_id, cl.nombre,
         f.monto, f.estado_documento, f.codigo, f.motivo, f.asiento_id, f.asiento_numero,
         count(*) OVER ()
    FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta) f
    LEFT JOIN public.unidades u ON u.id = f.unidad_id
    LEFT JOIN public.clientes cl ON cl.id = f.responsable_id
   ORDER BY f.fecha, f.origen_tabla, f.origen_id, f.evento
   LIMIT p_limite OFFSET p_offset;
END;
$$;

-- ── 7. Conciliación: saldo contable contra documentos y aplicaciones ────────
-- Al corte (NULL = sin límite):
--   contable    = líneas publicadas de CxC del sujeto;
--   documentos  = por documento por tipo del sujeto: su importe si su devengo
--                 está vivo al corte (publicado y no reversado al corte),
--                 menos lo aplicado por cobros vivos al corte
--                 (conta_cobro_aplicaciones).
-- Discrepancias:
--   documento     el saldo contable del documento (sus devengos y los cobros
--                 aplicados a él, con sus reversos) difiere del documental;
--   aplicacion    las líneas de CxC de un asiento de cobro no suman lo que
--                 registran sus aplicaciones, por cuenta;
--   sin_documento líneas del sujeto en CxC que no son de un devengo por tipo
--                 ni de un cobro con aplicaciones (p. ej. pólizas manuales).
CREATE OR REPLACE FUNCTION public.conta_estado_cuenta_conciliacion(
  p_project_id uuid,
  p_cliente_id uuid DEFAULT NULL,
  p_unidad_id  uuid DEFAULT NULL,
  p_corte      date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_res     jsonb;
BEGIN
  v_company := public.conta_ec_autorizar(p_project_id, p_cliente_id, p_unidad_id);

  WITH lin AS (
    SELECT l.*,
           -- el asiento «raíz» de un reverso es el reversado
           COALESCE(l.reversa_de_id, l.asiento_id) AS raiz_id
      FROM public.conta_ec_lineas(v_company, p_project_id, p_cliente_id, p_unidad_id) l
     WHERE p_corte IS NULL OR l.fecha <= p_corte
  ),
  lin_doc AS (
    SELECT l.*,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_tabla
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND ap.cuota_id IS NOT NULL
               THEN 'cuotas_condominio'
           END AS doc_tabla,
           CASE
             WHEN l.origen = 'automatico' AND l.origen_tabla IN ('cuotas_condominio','cargos_adicionales_unidad')
               THEN l.origen_id
             WHEN l.origen = 'automatico' AND l.origen_tabla = 'pagos'
               THEN ap.cuota_id
           END AS doc_id
      FROM lin l
      LEFT JOIN LATERAL (
        SELECT x.cuota_id FROM public.conta_cobro_aplicaciones x
         WHERE l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND x.asiento_id = l.raiz_id
         ORDER BY x.evento LIMIT 1
      ) ap ON true
  ),
  -- documentos por tipo del sujeto, por evento
  ev AS (
    SELECT 'cuotas_condominio'::text AS t, c.id, 'cuota_emitida'::text AS e, c.monto AS monto
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR c.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR c.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
    UNION ALL
    SELECT 'cuotas_condominio', c.id, 'cuota_mora', COALESCE(c.mora_monto, 0)
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR c.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR c.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cuotas_condominio' AND i.origen_id = c.id)
    UNION ALL
    SELECT 'cargos_adicionales_unidad', x.id, 'cargo_adicional_emitido', x.monto
      FROM public.cargos_adicionales_unidad x
     WHERE x.company_id = v_company AND x.project_id IS NOT DISTINCT FROM p_project_id
       AND (p_unidad_id  IS NULL OR x.unidad_id = p_unidad_id)
       AND (p_cliente_id IS NULL OR x.responsable_cliente_id = p_cliente_id)
       AND EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                    WHERE i.origen_tabla = 'cargos_adicionales_unidad' AND i.origen_id = x.id)
  ),
  ev_doc AS (
    SELECT e.t, e.id, e.e,
           CASE WHEN EXISTS (
             SELECT 1 FROM public.conta_asientos a
              WHERE a.company_id = v_company AND a.origen = 'automatico'
                AND a.origen_tabla = e.t AND a.origen_id = e.id AND a.origen_evento = e.e
                AND a.estado = 'publicado'
                AND (p_corte IS NULL OR a.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = a.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte)))
           THEN e.monto ELSE 0 END::numeric(14,2) AS devengado,
           COALESCE((
             SELECT sum(ap.monto) FROM public.conta_cobro_aplicaciones ap
               JOIN public.conta_asientos pa ON pa.id = ap.asiento_id
              WHERE e.t = 'cuotas_condominio' AND ap.cuota_id = e.id AND ap.evento = e.e
                AND pa.estado = 'publicado'
                AND (p_corte IS NULL OR pa.fecha <= p_corte)
                AND NOT EXISTS (
                  SELECT 1 FROM public.conta_asientos r
                   WHERE r.id = pa.anulado_por_id AND r.estado = 'publicado'
                     AND (p_corte IS NULL OR r.fecha <= p_corte))
           ), 0)::numeric(14,2) AS aplicado
      FROM ev e
  ),
  doc_saldo AS (
    SELECT d.t, d.id, sum(d.devengado - d.aplicado)::numeric(14,2) AS documentos
      FROM ev_doc d GROUP BY d.t, d.id
  ),
  lin_saldo AS (
    SELECT l.doc_tabla AS t, l.doc_id AS id, sum(l.debe - l.haber)::numeric(14,2) AS contable
      FROM lin_doc l WHERE l.doc_id IS NOT NULL
     GROUP BY l.doc_tabla, l.doc_id
  ),
  disc_doc AS (
    SELECT 'documento'::text AS clase, COALESCE(d.t, s.t) AS origen_tabla, COALESCE(d.id, s.id) AS origen_id,
           NULL::uuid AS asiento_id,
           COALESCE(s.contable, 0)::numeric(14,2) AS contable,
           COALESCE(d.documentos, 0)::numeric(14,2) AS documentos
      FROM doc_saldo d
      FULL JOIN lin_saldo s ON s.t = d.t AND s.id = d.id
     WHERE COALESCE(s.contable, 0) <> COALESCE(d.documentos, 0)
  ),
  -- asientos de cobro (originales) con líneas del sujeto: sus abonos en CxC
  -- por cuenta contra sus aplicaciones por cuenta
  cobro_lin AS (
    SELECT l.asiento_id, l.cuenta_id, sum(l.haber - l.debe)::numeric(14,2) AS abonado
      FROM lin l
     WHERE l.origen = 'automatico' AND l.origen_tabla = 'pagos' AND l.reversa_de_id IS NULL
       -- sólo cobros vivos al corte: uno reversado ya no aplica nada, y si su
       -- pago se eliminó, sus aplicaciones se fueron con él
       AND NOT EXISTS (SELECT 1 FROM public.conta_asientos r
                        WHERE r.id = l.anulado_por_id AND r.estado = 'publicado'
                          AND (p_corte IS NULL OR r.fecha <= p_corte))
     GROUP BY l.asiento_id, l.cuenta_id
  ),
  cobro_ap AS (
    SELECT ap.asiento_id, ap.cuenta_id, sum(ap.monto)::numeric(14,2) AS aplicado
      FROM public.conta_cobro_aplicaciones ap
     WHERE ap.asiento_id IN (SELECT DISTINCT c.asiento_id FROM cobro_lin c)
     GROUP BY ap.asiento_id, ap.cuenta_id
  ),
  disc_ap AS (
    SELECT 'aplicacion'::text, 'pagos'::text,
           (SELECT a.origen_id FROM public.conta_asientos a WHERE a.id = COALESCE(c.asiento_id, x.asiento_id)),
           COALESCE(c.asiento_id, x.asiento_id),
           COALESCE(c.abonado, 0)::numeric(14,2), COALESCE(x.aplicado, 0)::numeric(14,2)
      FROM cobro_lin c
      FULL JOIN cobro_ap x ON x.asiento_id = c.asiento_id AND x.cuenta_id = c.cuenta_id
     WHERE COALESCE(c.abonado, 0) <> COALESCE(x.aplicado, 0)
  ),
  -- agrupado por el asiento raíz: un asiento y su reverso se compensan y no
  -- son una discrepancia
  disc_sin AS (
    SELECT 'sin_documento'::text, CASE WHEN l.origen = 'automatico' THEN l.origen_tabla END,
           CASE WHEN l.origen = 'automatico' THEN l.origen_id END,
           l.raiz_id, sum(l.debe - l.haber)::numeric(14,2), 0::numeric(14,2)
      FROM lin_doc l
     WHERE l.doc_id IS NULL
     GROUP BY l.origen, l.origen_tabla, l.origen_id, l.raiz_id
    HAVING sum(l.debe - l.haber) <> 0
  ),
  disc AS (
    SELECT * FROM disc_doc
    UNION ALL SELECT * FROM disc_ap
    UNION ALL SELECT * FROM disc_sin
  ),
  por_cuenta AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'cuenta_id', q.cuenta_id, 'codigo', c.codigo, 'nombre', c.nombre, 'saldo', q.saldo)
             ORDER BY c.codigo), '[]'::jsonb) AS j
      FROM (SELECT l.cuenta_id, sum(l.debe - l.haber)::numeric(14,2) AS saldo
              FROM lin l GROUP BY l.cuenta_id) q
      JOIN public.conta_cuentas c ON c.id = q.cuenta_id
  ),
  tot AS (
    SELECT (SELECT COALESCE(sum(l.debe - l.haber), 0) FROM lin l)::numeric(14,2) AS contable,
           (SELECT COALESCE(sum(d.documentos), 0) FROM doc_saldo d)::numeric(14,2) AS documentos
  )
  SELECT jsonb_build_object(
           'corte', p_corte,
           'saldo_contable', tot.contable,
           'saldo_documentos', tot.documentos,
           'diferencia', (tot.contable - tot.documentos)::numeric(14,2),
           'cuadra', tot.contable = tot.documentos AND NOT EXISTS (SELECT 1 FROM disc),
           'por_cuenta', (SELECT j FROM por_cuenta),
           'total_discrepancias', (SELECT count(*) FROM disc),
           'discrepancias', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'clase', d.clase, 'origen_tabla', d.origen_tabla, 'origen_id', d.origen_id,
                      'asiento_id', d.asiento_id, 'asiento_numero', a.numero,
                      'contable', d.contable, 'documentos', d.documentos,
                      'diferencia', (d.contable - d.documentos)::numeric(14,2))
                      ORDER BY d.clase, d.origen_tabla, d.origen_id, d.asiento_id)
               FROM (SELECT * FROM disc ORDER BY clase, origen_tabla, origen_id, asiento_id LIMIT 200) d
               LEFT JOIN public.conta_asientos a ON a.id = d.asiento_id), '[]'::jsonb))
    INTO v_res
    FROM tot;

  RETURN v_res;
END;
$$;

-- ── 8. Permisos de ejecución ─────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.conta_ec_autorizar(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_ec_cuentas_cxc(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_ec_lineas(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.conta_ec_fuera_de_saldo(uuid, uuid, uuid, uuid, date) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) TO authenticated;

COMMENT ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) IS
  'Estado de cuenta de un auxiliar (cliente) o una unidad en una contabilidad: saldo inicial, movimientos publicados de CxC con saldo acumulado y saldo final, calculados sobre el conjunto completo antes de paginar.';
COMMENT ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) IS
  'Documentos del sujeto que no están en su saldo contable: pendientes, en borrador, del camino histórico o cargos adicionales pagados sin vínculo.';
COMMENT ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) IS
  'Concilia el saldo contable del sujeto contra sus documentos por tipo y las aplicaciones reales de los cobros, al corte.';
