-- ============================================================================
-- ESTADO DE CUENTA · guard de alcance explícito (correctiva de 20261003000000)
--
-- 20261003000000 ya está aplicada en el sandbox; no se reescribe.
--
-- POR QUÉ. Las tres consultas públicas del estado de cuenta ya validan la
-- empresa de la sesión, el permiso, el proyecto y el sujeto en
-- conta_ec_autorizar. Pero la convención del repositorio (y la regla (b) de
-- scripts/migrations-guard.mjs) exige que TODA RPC SECURITY DEFINER con
-- p_project_id ejecutable por authenticated consulte la identidad del caller
-- en su PROPIO cuerpo: un guard que vive sólo en una función auxiliar se
-- pierde en silencio el día que alguien la cambia o deja de llamarla (el caso
-- de get_company_effective_limits, 20260729000200). Esta migración añade
-- `assert_company_scope()` justo después de la autorización, con la empresa
-- del proyecto pedido (o la de la sesión, en la contabilidad de empresa).
--
-- QUÉ NO CAMBIA. Ningún resultado ni mensaje: conta_ec_autorizar ya rechaza
-- antes, con su motivo, todo lo que este guard rechazaría. Es defensa en
-- profundidad. El resto del cuerpo es idéntico a 20261003000000.
--
-- CÓMO SE REVIERTE: restaurar las tres funciones desde 20261003000000.
-- ============================================================================

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
         f.monto, f.estado_documento, f.codigo, f.motivo, f.asiento_id, f.asiento_numero,
         count(*) OVER ()
    FROM public.conta_ec_fuera_de_saldo(v_company, p_project_id, p_cliente_id, p_unidad_id, p_hasta) f
    LEFT JOIN public.unidades u ON u.id = f.unidad_id
    LEFT JOIN public.clientes cl ON cl.id = f.responsable_id
   ORDER BY f.fecha, f.origen_tabla, f.origen_id, f.evento
   LIMIT p_limite OFFSET p_offset;
END;
$$;

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
  -- Guard de alcance explícito (convención del repo para toda RPC SECURITY
  -- DEFINER con p_project_id): la empresa del proyecto pedido —o la de la
  -- sesión si es la contabilidad de la empresa— debe ser la del caller.
  PERFORM public.assert_company_scope(
    COALESCE((SELECT pr.company_id FROM public.projects pr WHERE pr.id = p_project_id), v_company));

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

-- CREATE OR REPLACE conserva los privilegios; se reafirman igual, por si esta
-- migración se aplica sobre una base donde alguien los tocó a mano.
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta(uuid, uuid, uuid, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_pendientes(uuid, uuid, uuid, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.conta_estado_cuenta_conciliacion(uuid, uuid, uuid, date) TO authenticated;
