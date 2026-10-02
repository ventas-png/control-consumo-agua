-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · SEGUIMIENTO COMPARTIDO DE LA ORDEN
--
-- QUÉ FALTABA
-- Operaciones, Compras y Contabilidad miran la MISMA orden pero cada pantalla
-- reconstruía su propia versión (y `compras_compromisos` solo agrega por
-- proveedor). No había un lugar donde ver, de una orden: proveedor y contrato,
-- lo autorizado, lo recibido y lo pendiente, las facturas y sus diferencias, el
-- estado de contabilización y pago, los movimientos de inventario y activos, y
-- el historial.
--
-- QUÉ HACE (solo LECTURA; no escribe nada)
--   · `compras_seguimiento_orden(orden)` → jsonb con secciones.
--   · `compras_seguimiento_lista(filtros)` → una fila por orden con los
--     indicadores, para filtrar por proyecto, proveedor, estado y fechas.
--
-- COMPROMETIDO, RECIBIDO, FACTURADO Y PAGADO son indicadores DISTINTOS y se
-- devuelven por separado, nunca sumados:
--   comprometido = total de la orden con IVA (lo autorizado); `comprometido_neto` sin IVA
--   recibido     = lo ACEPTADO en recepciones registradas, a precio de orden y SIN IVA
--                  (la recepción no reconoce IVA; se reconoce al facturar)
--   facturado    = facturas aprobadas/pagadas contra la orden (no anuladas), con IVA;
--                  `facturado_neto` sin IVA, comparable con `recibido`
--   pagado       = lo pagado de esas facturas
-- «Pendiente por facturar» compara recibido contra facturado NETO: sin IVA en
-- ambos lados.
-- Moneda: todos en la de la orden (sin convertir: no se mezclan monedas).
--
-- QUIÉN VE QUÉ. Mismo alcance que la orden: empresa y proyecto accesible. Las
-- secciones de FACTURAS, PAGOS y ASIENTOS solo las ve quien puede ver
-- Contabilidad (`prov_puede_ver_papeleria()`: la misma puerta que protege la
-- papelería del proveedor); un usuario de Operaciones ve la orden, las
-- recepciones, el inventario y las diferencias de CANTIDAD, no los importes de
-- facturación ni los pagos.
--
-- CÓMO REVERTIR: DROP FUNCTION public.compras_seguimiento_orden(uuid),
--   public.compras_seguimiento_lista(uuid, uuid, text, date, date, boolean);
-- IMPACTO EN DATOS: ninguno (solo funciones).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_seguimiento_orden(p_orden_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_oc      public.ordenes_compra%ROWTYPE;
  v_prov    record;
  v_contab  boolean;
  v_res     jsonb;
  v_comprometido numeric;
  v_comp_neto    numeric;
  v_fact_neto    numeric;
  v_recibido     numeric;
  v_facturado    numeric;
  v_pagado       numeric;
BEGIN
  SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = p_orden_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Mismo alcance que la orden: se FILTRA (no se revela que existe).
  IF NOT (public.is_super_admin()
          OR (v_oc.company_id = public.get_my_company_id()
              AND (v_oc.project_id IS NULL OR public.can_access_project(v_oc.project_id)))) THEN
    RETURN NULL;
  END IF;

  v_contab := public.prov_puede_ver_papeleria();

  SELECT p.codigo, p.nombre, COALESCE(p.nit, p.rfc) AS identificacion, p.pais, p.estado
    INTO v_prov FROM public.proveedores p WHERE p.id = v_oc.proveedor_id;

  SELECT COALESCE(sum(l.total), 0), COALESCE(sum(round(l.cantidad * l.precio_unitario, 2)), 0)
    INTO v_comprometido, v_comp_neto
    FROM public.orden_compra_lineas l WHERE l.orden_compra_id = v_oc.id;

  SELECT COALESCE(sum(rl.total), 0) INTO v_recibido
    FROM public.recepcion_lineas rl
    JOIN public.recepciones r ON r.id = rl.recepcion_id
   WHERE r.orden_compra_id = v_oc.id AND r.estado = 'registrada';

  IF v_contab THEN
    SELECT COALESCE(sum(f.monto_total), 0), COALESCE(sum(f.monto_pagado), 0),
           COALESCE(sum(f.monto_total - COALESCE(f.iva_monto, 0)), 0)
      INTO v_facturado, v_pagado, v_fact_neto
      FROM public.facturas_proveedor f
     WHERE f.orden_compra_id = v_oc.id AND f.estado IN ('aprobada', 'pagada_parcial', 'pagada');
  END IF;

  v_res := jsonb_build_object(
    'orden', jsonb_build_object(
      'id', v_oc.id, 'numero', v_oc.numero, 'concepto', v_oc.concepto, 'estado', v_oc.estado,
      'revision', v_oc.revision, 'project_id', v_oc.project_id, 'moneda', v_oc.moneda,
      'fecha_requerida', v_oc.fecha_requerida, 'aprobada_at', v_oc.aprobada_at,
      'emitida_at', v_oc.emitida_at, 'cerrada_at', v_oc.cerrada_at,
      'solicitada_por', v_oc.created_by, 'aprobada_por', v_oc.aprobada_por,
      'motivo_devolucion', v_oc.motivo_devolucion, 'motivo_anulacion', v_oc.motivo_anulacion,
      'proveedor', jsonb_build_object(
        'id', v_oc.proveedor_id, 'codigo', v_prov.codigo, 'nombre', COALESCE(v_prov.nombre, v_oc.proveedor_nombre),
        'identificacion', v_prov.identificacion, 'pais', v_prov.pais, 'estado', v_prov.estado),
      'contrato', (SELECT jsonb_build_object('id', c.id, 'referencia', c.referencia, 'estado', c.estado)
                     FROM public.contratos_proveedores c WHERE c.id = v_oc.contrato_id)),
    'contabilidad_visible', v_contab,
    -- Cuatro indicadores DISTINTOS; ninguno es suma de otro.
    'indicadores', jsonb_build_object(
      'comprometido', v_comprometido,
      'comprometido_neto', v_comp_neto,
      'recibido', v_recibido,
      'facturado', CASE WHEN v_contab THEN v_facturado END,
      'facturado_neto', CASE WHEN v_contab THEN v_fact_neto END,
      'pagado', CASE WHEN v_contab THEN v_pagado END,
      'pendiente_por_recibir', GREATEST(v_comp_neto - v_recibido, 0),
      'pendiente_por_facturar', CASE WHEN v_contab THEN GREATEST(v_recibido - v_fact_neto, 0) END),
    'lineas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'linea', l.linea, 'descripcion', l.descripcion, 'destino', l.destino_tipo,
        'unidad', l.unidad, 'precio_unitario', l.precio_unitario,
        'cantidad_ordenada', l.cantidad,
        'cantidad_aceptada', l.cantidad_recibida,
        'cantidad_rechazada', COALESCE((SELECT sum(rl.cantidad_rechazada) FROM public.recepcion_lineas rl
                                          JOIN public.recepciones r ON r.id = rl.recepcion_id
                                         WHERE rl.orden_compra_linea_id = l.id AND r.estado = 'registrada'), 0),
        'cantidad_pendiente', GREATEST(l.cantidad - l.cantidad_recibida, 0),
        'cantidad_facturada', CASE WHEN v_contab THEN l.cantidad_facturada END,
        'cantidad_pendiente_facturar', CASE WHEN v_contab THEN GREATEST(l.cantidad_recibida - l.cantidad_facturada, 0) END,
        'cuenta', (SELECT jsonb_build_object('id', c.id, 'codigo', c.codigo, 'nombre', c.nombre)
                     FROM public.conta_cuentas c WHERE c.id = l.cuenta_id),
        'cuenta_origen', l.cuenta_origen) ORDER BY l.linea)
      FROM public.orden_compra_lineas l WHERE l.orden_compra_id = v_oc.id), '[]'::jsonb),
    'recepciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'numero', r.numero, 'fecha', r.fecha, 'tipo', r.tipo, 'estado', r.estado,
        'recibido_por', r.recibido_por, 'destino_fisico', r.destino_fisico,
        'documento_referencia', r.documento_referencia, 'tiene_respaldo', r.respaldo_path IS NOT NULL,
        'motivo_anulacion', r.motivo_anulacion,
        'aceptado', COALESCE((SELECT sum(rl.cantidad) FROM public.recepcion_lineas rl WHERE rl.recepcion_id = r.id), 0),
        'rechazado', COALESCE((SELECT sum(rl.cantidad_rechazada) FROM public.recepcion_lineas rl WHERE rl.recepcion_id = r.id), 0))
        ORDER BY r.fecha, r.created_at)
      FROM public.recepciones r WHERE r.orden_compra_id = v_oc.id), '[]'::jsonb),
    'movimientos_inventario', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'tipo', m.tipo, 'cantidad', m.cantidad, 'fecha', m.fecha, 'suministro_id', m.suministro_id,
        'origen', m.origen_tabla) ORDER BY m.fecha, m.id)
      FROM public.movimientos_suministro m
      JOIN public.recepcion_lineas rl ON rl.id = m.origen_id
      JOIN public.recepciones r ON r.id = rl.recepcion_id
     WHERE r.orden_compra_id = v_oc.id AND m.origen_tabla IN ('recepcion_lineas', 'recepcion_lineas_anulada')), '[]'::jsonb),
    'activos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'codigo', a.codigo, 'nombre', a.nombre, 'estado', a.estado, 'costo', a.costo)
                       ORDER BY a.codigo)
      FROM public.activos_fijos a
      JOIN public.recepcion_lineas rl ON rl.id = a.recepcion_linea_id
      JOIN public.recepciones r ON r.id = rl.recepcion_id
     WHERE r.orden_compra_id = v_oc.id), '[]'::jsonb),
    'eventos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'tipo', e.tipo, 'estado_anterior', e.estado_anterior, 'estado_nuevo', e.estado_nuevo,
        'motivo', e.motivo, 'revision', e.revision, 'origen', e.origen, 'actor_id', e.actor_id,
        'created_at', e.created_at) ORDER BY e.created_at, e.id)
      FROM public.orden_compra_eventos e WHERE e.orden_compra_id = v_oc.id), '[]'::jsonb)
  );

  IF v_contab THEN
    v_res := v_res || jsonb_build_object(
      'facturas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', f.id, 'numero_factura', f.numero_factura, 'fecha_emision', f.fecha_emision, 'estado', f.estado,
          'moneda', f.moneda, 'monto_total', f.monto_total, 'iva_monto', f.iva_monto,
          'monto_pagado', f.monto_pagado, 'saldo', f.monto_total - f.monto_pagado,
          'contabilizada', EXISTS (SELECT 1 FROM public.conta_asientos a
                                    WHERE a.company_id = f.company_id AND a.origen_tabla = 'facturas_proveedor'
                                      AND a.origen_id = f.id AND a.estado = 'publicado'
                                      AND a.anulado_por_id IS NULL),
          'match_forzado', f.match_forzado_por IS NOT NULL,
          'justificacion', f.match_justificacion,
          'diferencias', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'linea', m.linea, 'descripcion', m.descripcion, 'motivo', m.motivo,
              'dif_precio', m.diferencia_precio, 'dif_iva', m.diferencia_iva,
              'moneda_orden', m.moneda_orden, 'moneda_factura', m.moneda_factura,
              'cantidad_factura', m.cantidad_factura) ORDER BY m.linea)
            FROM public.compras_validar_match(f.id) m WHERE NOT m.dentro_tolerancia), '[]'::jsonb))
          ORDER BY f.fecha_emision, f.created_at)
        FROM public.facturas_proveedor f WHERE f.orden_compra_id = v_oc.id), '[]'::jsonb));
  END IF;

  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_seguimiento_orden(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_seguimiento_orden(uuid) TO authenticated;

COMMENT ON FUNCTION public.compras_seguimiento_orden(uuid) IS
  'Vista compartida de una orden: proveedor/contrato, comprometido/recibido/facturado/pagado por separado, líneas, recepciones, inventario, activos, facturas con diferencias (solo si puede ver Contabilidad) e historial.';

-- ── Lista filtrable ─────────────────────────────────────────────────────────
-- p_project_id: uuid = ese proyecto; NULL con p_solo_empresa = contabilidad de la empresa;
-- NULL sin ella = todo lo que el usuario puede ver.
CREATE OR REPLACE FUNCTION public.compras_seguimiento_lista(
  p_project_id   uuid DEFAULT NULL,
  p_proveedor_id uuid DEFAULT NULL,
  p_estado       text DEFAULT NULL,
  p_desde        date DEFAULT NULL,
  p_hasta        date DEFAULT NULL,
  p_solo_empresa boolean DEFAULT false
)
RETURNS TABLE (
  orden_id        uuid,
  numero          text,
  concepto        text,
  estado          text,
  project_id      uuid,
  proveedor_id    uuid,
  proveedor       text,
  moneda          text,
  fecha           date,
  comprometido    numeric,
  comprometido_neto numeric,
  recibido        numeric,
  facturado       numeric,
  pagado          numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
  v_contab  boolean := public.prov_puede_ver_papeleria();
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND (
       NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company)
       OR NOT public.can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa o no tienes acceso.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT o.id, o.numero, o.concepto, o.estado, o.project_id, o.proveedor_id,
         COALESCE(p.nombre, o.proveedor_nombre), o.moneda, COALESCE(o.aprobada_at::date, o.created_at::date),
         COALESCE((SELECT sum(l.total) FROM public.orden_compra_lineas l WHERE l.orden_compra_id = o.id), 0),
         COALESCE((SELECT sum(round(l.cantidad * l.precio_unitario, 2)) FROM public.orden_compra_lineas l WHERE l.orden_compra_id = o.id), 0),
         COALESCE((SELECT sum(rl.total) FROM public.recepcion_lineas rl
                     JOIN public.recepciones r ON r.id = rl.recepcion_id
                    WHERE r.orden_compra_id = o.id AND r.estado = 'registrada'), 0),
         CASE WHEN v_contab THEN COALESCE((SELECT sum(f.monto_total) FROM public.facturas_proveedor f
                    WHERE f.orden_compra_id = o.id AND f.estado IN ('aprobada','pagada_parcial','pagada')), 0) END,
         CASE WHEN v_contab THEN COALESCE((SELECT sum(f.monto_pagado) FROM public.facturas_proveedor f
                    WHERE f.orden_compra_id = o.id AND f.estado IN ('aprobada','pagada_parcial','pagada')), 0) END
    FROM public.ordenes_compra o
    LEFT JOIN public.proveedores p ON p.id = o.proveedor_id
   WHERE o.company_id = v_company
     AND (o.project_id IS NULL OR public.can_access_project(o.project_id))
     AND (p_project_id IS NULL OR o.project_id = p_project_id)
     AND (NOT p_solo_empresa OR o.project_id IS NULL)
     AND (p_proveedor_id IS NULL OR o.proveedor_id = p_proveedor_id)
     AND (p_estado IS NULL OR o.estado = p_estado)
     AND (p_desde IS NULL OR COALESCE(o.aprobada_at::date, o.created_at::date) >= p_desde)
     AND (p_hasta IS NULL OR COALESCE(o.aprobada_at::date, o.created_at::date) <= p_hasta)
   ORDER BY COALESCE(o.aprobada_at, o.created_at) DESC, o.id
   LIMIT 500;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_seguimiento_lista(uuid, uuid, text, date, date, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.compras_seguimiento_lista(uuid, uuid, text, date, date, boolean) TO authenticated;

COMMENT ON FUNCTION public.compras_seguimiento_lista(uuid, uuid, text, date, date, boolean) IS
  'Una fila por orden con comprometido / recibido / facturado / pagado por separado (facturado y pagado solo si el usuario ve Contabilidad). Máx. 500.';
