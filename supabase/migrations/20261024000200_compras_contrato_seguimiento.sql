-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · SEGUIMIENTO DEL CONTRATO DE PROVEEDOR
--
-- QUÉ ES
--   Una sola consulta de servidor que junta, para UN contrato, lo que ya existe en el
--   circuito de compras: sus órdenes, las recepciones, las facturas y los pagos de esas
--   órdenes. Reutiliza `compras_seguimiento_orden` (la misma lógica de #918: pendientes por
--   renglón en cantidades, valoración al precio de la orden, diferencias de precio aparte),
--   así que contrato y orden nunca cuentan distinto.
--
-- QUÉ DISTINGUE (y NO suma como si fueran lo mismo)
--   contratado   = lo que dice el contrato: monto máximo original, ampliaciones documentadas
--                  y monto máximo vigente; para los recurrentes, importe periódico y vigencia.
--                  Si el contrato NO tiene monto máximo, no hay límite total: se devuelve
--                  `sin_limite_total = true` y ningún total inventado.
--   comprometido = órdenes aprobadas/emitidas/recibidas/cerradas (un borrador o una cancelada
--                  no compromete nada).
--   recibido     = valor de lo ACEPTADO en recepciones registradas.
--   facturado    = facturas aprobadas, pagadas o parcialmente pagadas.
--   pagado       = lo aplicado a esas facturas.
--   Cada indicador va aparte y POR MONEDA (`por_moneda`); jamás se suman monedas. Los
--   pendientes por recibir y por facturar cuentan solo órdenes vivas (aprobada, emitida,
--   recibida parcial o recibida); la diferencia de precio va aparte del pendiente.
--
-- ACCESO
--   · Contrato: empresa, acceso al proyecto y permiso de la pestaña de proveedores, o
--     Contabilidad (que ve la papelería del proveedor). Si no, devuelve NULL (no revela que existe).
--   · Lo financiero (facturado, pagado, pendiente por facturar, diferencia de precio, facturas y
--     pagos) es NULL/ausente sin acceso a Contabilidad: Operaciones no lo recibe ni por API.
--
-- LO QUE NO HACE: es de solo lectura; no crea ni cambia nada.
-- CÓMO REVERTIR: DROP FUNCTION public.compras_contrato_seguimiento(uuid).
-- IMPACTO EN DATOS: ninguno.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_contrato_seguimiento(p_contrato_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_c        public.contratos_proveedores%ROWTYPE;
  v_contab   boolean;
  v_prov     record;
  v_max_orig numeric;
  v_max_vig  numeric;
  v_ord      jsonb;
  v_porm     jsonb;
  v_res      jsonb;
BEGIN
  SELECT * INTO v_c FROM public.contratos_proveedores WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_contab := public.prov_puede_ver_papeleria();
  IF NOT (public.is_super_admin()
          OR (v_c.company_id = public.get_my_company_id()
              AND public.can_access_project(v_c.project_id)
              AND (public.user_has_permission('condominios.tab.proveedores') OR v_contab))) THEN
    RETURN NULL;
  END IF;

  SELECT p.id, p.codigo, p.nombre, p.estado INTO v_prov FROM public.proveedores p WHERE p.id = v_c.proveedor_id;
  v_max_orig := v_c.monto_maximo;
  v_max_vig  := public.contrato_monto_maximo_vigente(v_c.id);

  -- Órdenes del contrato (mismo alcance que la orden) con su seguimiento reutilizado.
  SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'created_at'), (e->>'id')), '[]'::jsonb) INTO v_ord
    FROM (
      SELECT jsonb_build_object(
               'id', o.id, 'numero', o.numero, 'concepto', o.concepto, 'estado', o.estado,
               'moneda', o.moneda, 'revision', o.revision, 'created_at', o.created_at,
               'aprobada_at', o.aprobada_at, 'emitida_at', o.emitida_at,
               'valor_orden', o.total,
               'compromete', o.estado IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida', 'cerrada'),
               'comprometido', CASE WHEN o.estado IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida', 'cerrada')
                                    THEN s->'indicadores'->'comprometido' ELSE to_jsonb(0) END,
               'recibido', s->'indicadores'->'recibido',
               'facturado', s->'indicadores'->'facturado',
               'pagado', s->'indicadores'->'pagado',
               'pendiente_por_recibir', CASE WHEN o.estado IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida')
                                             THEN s->'indicadores'->'pendiente_por_recibir' ELSE to_jsonb(0) END,
               'pendiente_por_facturar', CASE WHEN NOT v_contab THEN NULL
                                              WHEN o.estado IN ('aprobada', 'emitida', 'recibida_parcial', 'recibida')
                                              THEN s->'indicadores'->'pendiente_por_facturar' ELSE to_jsonb(0) END,
               'diferencia_precio_facturada', s->'indicadores'->'diferencia_precio_facturada',
               'con_excepcion', EXISTS (SELECT 1 FROM public.orden_compra_excepciones x
                                         WHERE x.orden_compra_id = o.id AND x.revision = o.revision),
               'recepciones', COALESCE(s->'recepciones', '[]'::jsonb),
               'facturas', CASE WHEN v_contab THEN COALESCE(s->'facturas', '[]'::jsonb) ELSE '[]'::jsonb END,
               'pagos', CASE WHEN v_contab THEN COALESCE(s->'pagos', '[]'::jsonb) ELSE '[]'::jsonb END) AS e
        FROM public.ordenes_compra o
        CROSS JOIN LATERAL (SELECT public.compras_seguimiento_orden(o.id) AS s) q
       WHERE o.contrato_id = v_c.id
         AND o.company_id = v_c.company_id
         AND (public.is_super_admin() OR o.project_id IS NULL OR public.can_access_project(o.project_id))
         AND q.s IS NOT NULL
    ) t;

  -- Por moneda, cada indicador aparte. NULL (no 0) donde el usuario no ve Contabilidad.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'moneda', m.moneda,
           'ordenes', m.ordenes,
           'comprometido', m.comprometido,
           'recibido', m.recibido,
           'facturado', CASE WHEN v_contab THEN m.facturado END,
           'pagado', CASE WHEN v_contab THEN m.pagado END,
           'pendiente_por_recibir', m.pend_rec,
           'pendiente_por_facturar', CASE WHEN v_contab THEN m.pend_fact END,
           'diferencia_precio_facturada', CASE WHEN v_contab THEN m.dif_precio END,
           'monto_maximo_vigente', CASE WHEN upper(m.moneda) = upper(v_c.moneda) THEN v_max_vig END,
           'disponible', CASE WHEN upper(m.moneda) = upper(v_c.moneda) AND v_max_vig IS NOT NULL
                              THEN v_max_vig - m.comprometido END)
         ORDER BY m.moneda), '[]'::jsonb) INTO v_porm
    FROM (
      SELECT e->>'moneda' AS moneda,
             count(*) AS ordenes,
             COALESCE(sum((e->>'comprometido')::numeric), 0) AS comprometido,
             COALESCE(sum((e->>'recibido')::numeric), 0) AS recibido,
             COALESCE(sum((e->>'facturado')::numeric), 0) AS facturado,
             COALESCE(sum((e->>'pagado')::numeric), 0) AS pagado,
             COALESCE(sum((e->>'pendiente_por_recibir')::numeric), 0) AS pend_rec,
             COALESCE(sum((e->>'pendiente_por_facturar')::numeric), 0) AS pend_fact,
             COALESCE(sum((e->>'diferencia_precio_facturada')::numeric), 0) AS dif_precio
        FROM jsonb_array_elements(v_ord) e
       GROUP BY 1
    ) m;

  v_res := jsonb_build_object(
    'contrato', jsonb_build_object(
      'id', v_c.id, 'referencia', v_c.referencia, 'estado', v_c.estado,
      'vigente', public.contrato_vigente(v_c.id, CURRENT_DATE),
      'modalidad', v_c.modalidad, 'periodicidad', v_c.periodicidad, 'moneda', v_c.moneda,
      'importe_periodico', v_c.importe_periodico,
      'fecha_inicio', v_c.fecha_inicio, 'fecha_fin', v_c.fecha_fin, 'indefinido', v_c.fecha_fin IS NULL,
      'monto_maximo_original', v_max_orig,
      'ampliaciones_total', CASE WHEN v_max_orig IS NULL THEN NULL ELSE v_max_vig - v_max_orig END,
      'monto_maximo_vigente', v_max_vig,
      'sin_limite_total', v_max_orig IS NULL,
      'renovado_de', v_c.renovado_de,
      'proveedor', jsonb_build_object('id', v_prov.id, 'codigo', v_prov.codigo,
                                      'nombre', COALESCE(v_prov.nombre, v_c.proveedor_nombre), 'estado', v_prov.estado)),
    'contabilidad_visible', v_contab,
    'por_moneda', v_porm,
    'ordenes', (SELECT COALESCE(jsonb_agg(e - 'recepciones' - 'facturas' - 'pagos' ORDER BY (e->>'created_at'), (e->>'id')), '[]'::jsonb)
                  FROM jsonb_array_elements(v_ord) e),
    'recepciones', (SELECT COALESCE(jsonb_agg(r || jsonb_build_object('orden_id', e->>'id', 'orden_numero', e->>'numero')
                                              ORDER BY (r->>'fecha'), (r->>'id')), '[]'::jsonb)
                      FROM jsonb_array_elements(v_ord) e, jsonb_array_elements(e->'recepciones') r),
    'facturas', (SELECT COALESCE(jsonb_agg((f - 'diferencias') || jsonb_build_object('orden_id', e->>'id', 'orden_numero', e->>'numero')
                                           ORDER BY (f->>'fecha_emision'), (f->>'id')), '[]'::jsonb)
                   FROM jsonb_array_elements(v_ord) e, jsonb_array_elements(e->'facturas') f),
    'pagos', (SELECT COALESCE(jsonb_agg(p || jsonb_build_object('orden_id', e->>'id', 'orden_numero', e->>'numero')
                                        ORDER BY (p->>'fecha_pago'), (p->>'id')), '[]'::jsonb)
                FROM jsonb_array_elements(v_ord) e, jsonb_array_elements(e->'pagos') p),
    'excepciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', x.id, 'orden_id', x.orden_compra_id, 'orden_numero', o.numero, 'etapa', x.etapa,
               'causas', x.causas, 'motivo', x.motivo, 'autorizado_por', x.autorizado_por,
               'revision', x.revision, 'created_at', x.created_at) ORDER BY x.created_at, x.id)
        FROM public.orden_compra_excepciones x JOIN public.ordenes_compra o ON o.id = x.orden_compra_id
       WHERE x.contrato_id = v_c.id), '[]'::jsonb),
    'ampliaciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', a.id, 'monto_anterior', a.monto_anterior, 'incremento', a.incremento,
               'monto_nuevo', a.monto_nuevo, 'moneda', a.moneda, 'motivo', a.motivo,
               'referencia_documento', a.referencia_documento, 'autorizado_por', a.autorizado_por,
               'created_at', a.created_at) ORDER BY a.created_at, a.id)
        FROM public.contrato_ampliaciones a WHERE a.contrato_id = v_c.id), '[]'::jsonb),
    'renovaciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'referencia', r.referencia, 'estado', r.estado,
               'fecha_inicio', r.fecha_inicio, 'fecha_fin', r.fecha_fin) ORDER BY r.fecha_inicio, r.id)
        FROM public.contratos_proveedores r WHERE r.renovado_de = v_c.id), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'tipo', ev.tipo, 'estado_anterior', ev.estado_anterior, 'estado_nuevo', ev.estado_nuevo,
               'motivo', ev.motivo, 'detalle', ev.detalle, 'actor_id', ev.actor_id,
               'created_at', ev.created_at) ORDER BY ev.created_at, ev.id)
        FROM public.contrato_proveedor_eventos ev WHERE ev.contrato_id = v_c.id), '[]'::jsonb));

  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_contrato_seguimiento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_contrato_seguimiento(uuid) TO authenticated;

COMMENT ON FUNCTION public.compras_contrato_seguimiento(uuid) IS
  'Seguimiento de un contrato: órdenes, recepciones, facturas y pagos vinculados; contratado, comprometido, recibido, facturado y pagado por separado y por moneda. Sin monto máximo = sin límite total. Lo financiero es NULL sin acceso a Contabilidad.';
