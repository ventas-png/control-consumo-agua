-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · `compras_factura_crear`: EL REINTENTO RECUPERA LA FACTURA
-- ORIGINAL AUNQUE LA ORDEN YA ESTÉ CERRADA   (corrección incremental de 0800)
--
-- QUÉ FALLABA
-- La función validaba el ESTADO de la orden (emitida / recibida parcial /
-- recibida) ANTES de buscar la clave de idempotencia. Si la factura creada cerraba
-- la orden (facturó todo lo recibido), un reintento legítimo —respuesta perdida,
-- doble clic— llegaba con la orden «cerrada» y recibía COMPRAS_FACTURA_ORDEN_ESTADO
-- en vez de la factura que ya existía: el cliente creía que había fallado una
-- operación que sí se completó.
--
-- QUÉ CAMBIA (solo el orden de las comprobaciones; mismas reglas)
--   1. Se mantienen ANTES de la clave: identidad, empresa, acceso (RLS), alcance
--      (proyecto, proveedor, orden de esta empresa/proveedor/proyecto, renglones de
--      ESA orden) y la huella del contenido.
--   2. Con la clave ya existente: mismo contenido → la factura ORIGINAL
--      (`reutilizada: true`, sin escribir nada); contenido distinto →
--      COMPRAS_FACTURA_CLAVE_CONFLICTO (sin cambios).
--   3. El estado de la orden se comprueba DESPUÉS de lo anterior y solo frena
--      facturas NUEVAS: una clave nueva sobre una orden cerrada sigue rechazada con
--      COMPRAS_FACTURA_ORDEN_ESTADO.
--
-- NO CAMBIA: la firma, SECURITY INVOKER, los permisos (REVOKE a PUBLIC/anon, GRANT
-- a authenticated), el cálculo, el cuadre, el devengo ni ninguna tabla.
-- Quien no ve la factura por RLS no la recupera: la clave le sale como «en uso».
--
-- CÓMO REVERTIR: volver a aplicar la definición de 20261021000800 (CREATE OR
-- REPLACE). IMPACTO EN DATOS: ninguno (solo reemplaza una función).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.compras_factura_crear(
  p_company_id uuid,
  p_project_id uuid,
  p_cabecera   jsonb,
  p_lineas     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clave   text    := NULLIF(btrim(COALESCE(p_cabecera->>'clave_idempotencia', '')), '');
  v_prov    uuid    := NULLIF(p_cabecera->>'proveedor_id', '')::uuid;
  v_orden   uuid    := NULLIF(p_cabecera->>'orden_compra_id', '')::uuid;
  v_numero  text    := NULLIF(btrim(COALESCE(p_cabecera->>'numero_factura', '')), '');
  v_emision date    := COALESCE(NULLIF(p_cabecera->>'fecha_emision', '')::date, CURRENT_DATE);
  v_vence   date    := NULLIF(p_cabecera->>'fecha_vencimiento', '')::date;
  v_concepto text   := NULLIF(btrim(COALESCE(p_cabecera->>'concepto', '')), '');
  v_categ   text    := COALESCE(NULLIF(btrim(COALESCE(p_cabecera->>'categoria', '')), ''), 'otros');
  v_moneda  text    := NULLIF(upper(btrim(COALESCE(p_cabecera->>'moneda', ''))), '');
  v_notas   text    := NULLIF(btrim(COALESCE(p_cabecera->>'notas', '')), '');
  v_monto   numeric;
  v_iva     numeric;
  v_base    text;
  v_o       public.ordenes_compra%ROWTYPE;
  v_cab     jsonb;
  v_norm    jsonb;
  v_hash    text;
  v_exist   public.facturas_proveedor%ROWTYPE;
  v_fac     public.facturas_proveedor%ROWTYPE;
  v_n       int;
  v_invalid int;
  v_ajenas  int;
  v_dist    int;
  v_cons    text;
  v_estado  text;
BEGIN
  -- ── Quién llama y dónde ──────────────────────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_EMPRESA: falta la empresa de la factura.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (public.is_super_admin() OR p_company_id = public.get_my_company_id()) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_EMPRESA: no se registran facturas en una empresa distinta de la tuya.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_REQUERIDA: la factura necesita una clave de idempotencia (una por intento de captura) para que un reintento o un doble clic no la duplique.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_clave) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_REQUERIDA: la clave de idempotencia debe tener entre 8 y 200 caracteres.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_prov IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_PROVEEDOR: falta el proveedor.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_concepto IS NULL OR length(v_concepto) < 3 THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CONCEPTO: el concepto es obligatorio (mínimo 3 caracteres).' USING ERRCODE = 'check_violation';
  END IF;

  -- ── Proyecto, proveedor y orden: de esta empresa, y entre sí coherentes ──
  IF p_project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_PROYECTO: el proyecto no existe en esta empresa.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = v_prov AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_PROVEEDOR: el proveedor no existe en esta empresa.' USING ERRCODE = 'check_violation';
  END IF;
  v_base := public.conta_moneda_base(p_company_id, p_project_id);

  IF v_orden IS NOT NULL THEN
    SELECT * INTO v_o FROM public.ordenes_compra WHERE id = v_orden AND company_id = p_company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN: la orden no existe en esta empresa.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_o.proveedor_id IS DISTINCT FROM v_prov THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_PROVEEDOR: la orden es de otro proveedor que la factura.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_o.project_id IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_PROYECTO: la orden es de otra contabilidad (proyecto o empresa) que la factura.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_moneda IS NOT NULL AND v_moneda <> COALESCE(v_o.moneda, v_base) THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_MONEDA_ORDEN: la factura de una orden va en la moneda de la orden (%), no en %.',
        COALESCE(v_o.moneda, v_base), v_moneda USING ERRCODE = 'check_violation';
    END IF;
    v_moneda := v_o.moneda;        -- la moneda sale de la orden

    IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_SIN_RENGLONES: una factura contra una orden se captura por renglón: indica qué se factura de cada uno.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.orden_compra_linea_id IS NULL OR COALESCE(r.cantidad, 0) <= 0
                                  OR COALESCE(r.precio_unitario, -1) < 0 OR COALESCE(r.iva_monto, 0) < 0),
           COUNT(*) FILTER (WHERE r.orden_compra_linea_id IS NOT NULL AND NOT EXISTS (
                              SELECT 1 FROM public.orden_compra_lineas ocl
                               WHERE ocl.id = r.orden_compra_linea_id
                                 AND ocl.orden_compra_id = v_orden AND ocl.company_id = p_company_id)),
           COUNT(DISTINCT r.orden_compra_linea_id)
      INTO v_n, v_invalid, v_ajenas, v_dist
      FROM jsonb_to_recordset(p_lineas) AS r(orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                             precio_unitario numeric, iva_monto numeric);
    IF v_invalid > 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_INVALIDA: % renglón(es) sin renglón de orden, con cantidad menor o igual a cero, o con precio o IVA negativo.', v_invalid
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_ajenas > 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_AJENA: % renglón(es) no son de la orden de esta factura.', v_ajenas
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_dist <> v_n THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_LINEA_REPETIDA: un mismo renglón de la orden aparece más de una vez en la factura.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(round(r.cantidad * r.precio_unitario, 2) + COALESCE(r.iva_monto, 0)), 0),
           COALESCE(SUM(COALESCE(r.iva_monto, 0)), 0)
      INTO v_monto, v_iva
      FROM jsonb_to_recordset(p_lineas) AS r(orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                             precio_unitario numeric, iva_monto numeric);
  ELSE
    IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' AND jsonb_array_length(p_lineas) > 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_RENGLONES_SIN_ORDEN: los renglones se cuadran contra una orden; una factura sin orden no los lleva.'
        USING ERRCODE = 'check_violation';
    END IF;
    v_monto := NULLIF(p_cabecera->>'monto_total', '')::numeric;
    v_iva   := COALESCE(NULLIF(p_cabecera->>'iva_monto', '')::numeric, 0);
    IF v_monto IS NULL OR v_monto <= 0 THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_MONTO: el monto debe ser mayor que 0.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_iva < 0 OR v_iva > v_monto THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_MONTO: el IVA no puede ser negativo ni exceder el total.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ── Huella del contenido: las mismas cifras escritas distinto (40 / 40.0) y el
  -- orden de los renglones NO la cambian; un valor distinto sí. ──────────────
  v_cab := jsonb_build_object(
    'company_id', p_company_id, 'project_id', p_project_id, 'proveedor_id', v_prov,
    'orden_compra_id', v_orden, 'numero_factura', v_numero, 'fecha_emision', v_emision,
    'fecha_vencimiento', v_vence, 'concepto', v_concepto, 'categoria', v_categ,
    'moneda', v_moneda, 'notas', v_notas,
    'monto_total', round(v_monto, 2)::text, 'iva_monto', round(v_iva, 2)::text);
  IF v_orden IS NOT NULL THEN
    SELECT jsonb_agg(x.l ORDER BY x.l::text) INTO v_norm
      FROM (SELECT jsonb_build_object(
                     'orden_compra_linea_id', r.orden_compra_linea_id,
                     'descripcion',    NULLIF(btrim(COALESCE(r.descripcion, '')), ''),
                     'cantidad',       round(r.cantidad, 4)::text,
                     'precio_unitario', round(r.precio_unitario, 4)::text,
                     'iva_monto',      round(COALESCE(r.iva_monto, 0), 2)::text) AS l
              FROM jsonb_to_recordset(p_lineas) AS r(orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                                       precio_unitario numeric, iva_monto numeric)) x;
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object('cabecera', v_cab, 'lineas', v_norm)::text, 'UTF8')), 'hex');

  -- Los intentos simultáneos con la misma clave se ejecutan de uno en uno: el
  -- segundo espera, ve la factura del primero y la recupera (o se rechaza).
  PERFORM pg_advisory_xact_lock(hashtextextended('compras_factura:' || p_company_id::text || ':' || v_clave, 0));

  SELECT * INTO v_exist FROM public.facturas_proveedor
   WHERE company_id = p_company_id AND clave_idempotencia = v_clave;
  IF FOUND THEN
    IF v_exist.hash_contenido IS NULL THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_SIN_HUELLA: la clave ya identifica una factura creada fuera de esta función y no se puede verificar que el contenido sea el mismo. Usa otra clave.'
        USING ERRCODE = 'unique_violation';
    END IF;
    IF v_exist.hash_contenido <> v_hash THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_CONFLICTO: la clave de idempotencia ya se usó para una factura con OTRO contenido. Un reintento debe enviar lo mismo; una factura distinta lleva una clave nueva.'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'factura', to_jsonb(v_exist),
      'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(fl) ORDER BY fl.linea), '[]'::jsonb)
                   FROM public.factura_proveedor_lineas fl WHERE fl.factura_id = v_exist.id),
      'reutilizada', true);
  END IF;

  -- ── El estado de la orden limita las facturas NUEVAS ─────────────────────
  -- Va DESPUÉS de recuperar una operación ya completada: un reintento legítimo
  -- (respuesta perdida, doble clic) de una factura que cerró la orden devuelve la
  -- factura original; no se vuelve a escribir nada. Se relee el estado tras el
  -- bloqueo por si la orden cambió mientras esta sesión esperaba.
  IF v_orden IS NOT NULL THEN
    SELECT estado INTO v_estado FROM public.ordenes_compra WHERE id = v_orden AND company_id = p_company_id;
    IF v_estado IS NULL OR v_estado NOT IN ('emitida', 'recibida_parcial', 'recibida') THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_ESTADO: la orden está "%" y no admite facturas nuevas (solo emitida, recibida parcial o recibida).', COALESCE(v_estado, 'inexistente')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- ── Escritura: cabecera y renglones en la MISMA transacción ──────────────
  BEGIN
    INSERT INTO public.facturas_proveedor
      (company_id, project_id, proveedor_id, orden_compra_id, numero_factura, fecha_emision, fecha_vencimiento,
       concepto, categoria, moneda, monto_total, iva_monto, notas, clave_idempotencia, hash_contenido, estado)
    VALUES
      (p_company_id, p_project_id, v_prov, v_orden, v_numero, v_emision, v_vence,
       v_concepto, v_categ, v_moneda, v_monto, v_iva, v_notas, v_clave, v_hash, 'registrada')
    RETURNING * INTO v_fac;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons = 'uq_facturas_prov_numero' THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con el número "%". Si es la misma, no la registres otra vez.', v_numero
        USING ERRCODE = 'unique_violation';
    END IF;
    -- La clave la tiene una factura que esta sesión no ve (otro alcance): no se
    -- revela nada, solo se pide otra clave.
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_EN_USO: la clave de idempotencia ya está en uso. Usa otra clave.'
      USING ERRCODE = 'unique_violation';
  END;

  IF v_orden IS NOT NULL THEN
    -- Si un renglón falla (línea ajena a la orden, cantidad inválida…) se revierte
    -- TAMBIÉN la cabecera: no queda ninguna factura a medias.
    INSERT INTO public.factura_proveedor_lineas
      (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
    SELECT p_company_id, v_fac.id, r.orden_compra_linea_id, r.n,
           COALESCE(NULLIF(btrim(COALESCE(r.descripcion, '')), ''), ocl.descripcion),
           r.cantidad, r.precio_unitario, COALESCE(r.iva_monto, 0)
      FROM (SELECT x.*, row_number() OVER (ORDER BY x.ord) AS n
              FROM ROWS FROM (jsonb_to_recordset(p_lineas) AS (orden_compra_linea_id uuid, descripcion text, cantidad numeric,
                                                               precio_unitario numeric, iva_monto numeric))
                   WITH ORDINALITY AS x(orden_compra_linea_id, descripcion, cantidad, precio_unitario, iva_monto, ord)) r
      JOIN public.orden_compra_lineas ocl ON ocl.id = r.orden_compra_linea_id
     ORDER BY r.n;
  END IF;

  SELECT * INTO v_fac FROM public.facturas_proveedor WHERE id = v_fac.id;
  RETURN jsonb_build_object(
    'factura', to_jsonb(v_fac),
    'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(fl) ORDER BY fl.linea), '[]'::jsonb)
                 FROM public.factura_proveedor_lineas fl WHERE fl.factura_id = v_fac.id),
    'reutilizada', false);
END;
$$;

COMMENT ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) IS
  'Crea una factura de proveedor (y, con orden, sus renglones) en UNA transacción: todo o nada, idempotente por clave + huella de contenido, validada en servidor (empresa, proyecto, proveedor, orden, renglones). SECURITY INVOKER: RLS y triggers rigen igual que con un INSERT directo.';

REVOKE ALL ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) TO authenticated;
