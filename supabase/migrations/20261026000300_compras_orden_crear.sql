-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · ORDEN DE COMPRA: CREACIÓN TRANSACCIONAL E IDEMPOTENTE
-- (cierre técnico del circuito de compras y contabilidad)
--
-- QUÉ FALTABA
-- La interfaz creaba una orden en DOS peticiones: primero la cabecera
-- (`INSERT INTO ordenes_compra`) y luego los renglones (`INSERT INTO
-- orden_compra_lineas`). Una caída entre ambas, un renglón rechazado por los triggers
-- (insumo de otro proyecto, cuenta inválida, contrato vencido…) o un permiso que no
-- deja escribir renglones dejaban una cabecera huérfana, visible y sin renglones, y
-- el reintento —o un doble clic— creaba OTRA orden. No existía ninguna función de
-- servidor para crear órdenes; la carga masiva de renglones (`compras_lineas_importar_*`)
-- sí era transaccional, pero solo agrega renglones a una orden que ya existe.
--
-- QUÉ HACE `compras_orden_crear(empresa, proyecto, cabecera, renglones)`
-- Es la entrada transaccional a las MISMAS tablas y triggers de siempre
-- (`ordenes_compra`, `orden_compra_lineas`): no hay un motor paralelo. Sigue el
-- patrón de `compras_factura_crear` y `compras_recepcion_crear`:
--   · TODO O NADA: cabecera y renglones en una sola transacción. Si cualquier renglón
--     falla se revierte también la cabecera: no queda ni cabecera ni datos parciales.
--   · IDEMPOTENTE: exige `clave_idempotencia` (una por intento de captura) y guarda la
--     huella del contenido. Misma clave y mismo contenido (doble clic, respuesta
--     perdida, reintento) devuelve LA MISMA orden sin crear otra; misma clave con OTRO
--     contenido se rechaza (COMPRAS_ORDEN_CLAVE_CONFLICTO). Los intentos simultáneos
--     con la misma clave se serializan con un bloqueo: el segundo espera, ve la orden
--     del primero y la recupera.
--   · SECURITY INVOKER: la RLS y los triggers rigen igual que con un INSERT directo; no
--     se amplía ningún permiso. Se CONSERVAN, porque son los mismos triggers, las
--     validaciones de proveedor (habilitado en el proyecto), contrato (proveedor,
--     proyecto, empresa, moneda, vigencia), cuentas (la cuenta del renglón la resuelve y
--     valida el servidor) e inventario (insumo de la empresa y del proyecto, activo, misma
--     unidad, destino coherente).
--   · VALIDA en el servidor lo que antes solo validaba la pantalla (zod): empresa de
--     quien llama; proyecto de esa empresa y al que se tiene acceso; proveedor de esa
--     empresa; concepto de 3 a 300 caracteres; hasta 500 renglones, cada uno con
--     descripción, cantidad > 0, precio e IVA ≥ 0 y destino válido. Un tipo de dato
--     imposible (una cantidad «abc», una fecha mal escrita) sale con un código propio, no
--     con el error crudo de Postgres.
--   · El nombre del proveedor (columna heredada NOT NULL) lo pone el servidor desde el
--     catálogo: lo que el cliente mande en `proveedor_nombre` no cuenta.
--   · Una orden SIN renglones es válida (Operaciones puede capturar la cabecera y cargar
--     los renglones después con la importación, que sigue igual); la pantalla de
--     Contabilidad exige al menos uno.
--
-- TAMBIÉN
--   · `ordenes_compra.clave_idempotencia` y `hash_contenido`, con índice único (empresa,
--     clave) y protegidas contra edición posterior. Las órdenes existentes quedan en NULL.
--
-- NO CAMBIA: el ciclo de la orden, las políticas de escritura, la importación de
-- renglones ni las órdenes existentes.
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.compras_orden_crear(uuid, uuid, jsonb, jsonb);
--   DROP TRIGGER trg_compras_orden_clave_inmutable ON public.ordenes_compra;
--   DROP FUNCTION public.compras_tg_orden_clave_inmutable();
--   DROP INDEX public.uq_ordenes_compra_clave;
--   ALTER TABLE public.ordenes_compra DROP CONSTRAINT ordenes_compra_clave_longitud,
--     DROP COLUMN clave_idempotencia, DROP COLUMN hash_contenido;
--   (la interfaz anterior vuelve a insertar en dos pasos).
-- IMPACTO EN DATOS: dos columnas nuevas, NULL en todas las filas existentes.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS clave_idempotencia text,
  ADD COLUMN IF NOT EXISTS hash_contenido     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_compra_clave_longitud') THEN
    ALTER TABLE public.ordenes_compra
      ADD CONSTRAINT ordenes_compra_clave_longitud
      CHECK (clave_idempotencia IS NULL OR length(btrim(clave_idempotencia)) BETWEEN 8 AND 200);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ordenes_compra_clave
  ON public.ordenes_compra (company_id, clave_idempotencia)
  WHERE clave_idempotencia IS NOT NULL;

-- La clave y la huella identifican UN intento de captura: no se editan después.
CREATE OR REPLACE FUNCTION public.compras_tg_orden_clave_inmutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.clave_idempotencia IS DISTINCT FROM OLD.clave_idempotencia
      OR NEW.hash_contenido IS DISTINCT FROM OLD.hash_contenido)
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CLAVE_INMUTABLE: la clave de idempotencia y la huella de la orden no se modifican.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_orden_clave_inmutable ON public.ordenes_compra;
CREATE TRIGGER trg_compras_orden_clave_inmutable
  BEFORE UPDATE OF clave_idempotencia, hash_contenido ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_orden_clave_inmutable();

CREATE OR REPLACE FUNCTION public.compras_orden_crear(
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
  v_clave     text := NULLIF(btrim(COALESCE(p_cabecera->>'clave_idempotencia', '')), '');
  v_prov      uuid;
  v_contrato  uuid;
  v_obra      uuid;
  v_monto     numeric;
  v_dias      int;
  v_entrega   date;
  v_requerida date;
  v_concepto  text;
  v_desc      text;
  v_cond      text;
  v_notas     text;
  v_nombre    text;
  v_lineas    jsonb;
  v_n         int;
  v_invalid   int;
  v_cab       jsonb;
  v_norm      jsonb;
  v_hash      text;
  v_exist     public.ordenes_compra%ROWTYPE;
  v_o         public.ordenes_compra%ROWTYPE;
  v_cons      text;
BEGIN
  -- ── Quién llama y dónde ──────────────────────────────────────────────────
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_EMPRESA: falta la empresa de la orden.' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (public.is_super_admin() OR p_company_id = public.get_my_company_id()) THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_EMPRESA: no se crean órdenes en una empresa distinta de la tuya.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_cabecera IS NULL OR jsonb_typeof(p_cabecera) <> 'object' THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CABECERA: la cabecera de la orden es obligatoria.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CLAVE_REQUERIDA: la orden necesita una clave de idempotencia (una por intento de captura) para que un reintento o un doble clic no la duplique.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_clave) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CLAVE_REQUERIDA: la clave de idempotencia debe tener entre 8 y 200 caracteres.' USING ERRCODE = 'check_violation';
  END IF;

  -- ── La cabecera: tipos válidos, sin errores crudos de conversión ─────────
  BEGIN
    v_prov      := NULLIF(p_cabecera->>'proveedor_id', '')::uuid;
    v_contrato  := NULLIF(p_cabecera->>'contrato_id', '')::uuid;
    v_obra      := NULLIF(p_cabecera->>'obra_id', '')::uuid;
    v_monto     := NULLIF(p_cabecera->>'monto_estimado', '')::numeric;
    v_dias      := COALESCE(NULLIF(p_cabecera->>'dias_credito', '')::int, 0);
    v_entrega   := NULLIF(p_cabecera->>'fecha_entrega_esperada', '')::date;
    v_requerida := NULLIF(p_cabecera->>'fecha_requerida', '')::date;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
                 OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CABECERA: un dato de la cabecera no tiene el formato esperado (proveedor, contrato, obra, monto, días de crédito o fechas).'
      USING ERRCODE = 'check_violation';
  END;
  v_concepto := NULLIF(btrim(COALESCE(p_cabecera->>'concepto', '')), '');
  v_desc     := NULLIF(btrim(COALESCE(p_cabecera->>'descripcion', '')), '');
  v_cond     := NULLIF(btrim(COALESCE(p_cabecera->>'condiciones_pago', '')), '');
  v_notas    := NULLIF(btrim(COALESCE(p_cabecera->>'notas', '')), '');

  IF v_prov IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_PROVEEDOR: elige un proveedor del catálogo.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_concepto IS NULL OR length(v_concepto) < 3 OR length(v_concepto) > 300 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CONCEPTO: el concepto es obligatorio (de 3 a 300 caracteres).' USING ERRCODE = 'check_violation';
  END IF;
  IF length(COALESCE(v_desc, '')) > 1000 OR length(COALESCE(v_cond, '')) > 200 OR length(COALESCE(v_notas, '')) > 500 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CABECERA: descripción (1000), condiciones de pago (200) o notas (500) exceden el largo permitido.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_dias NOT BETWEEN 0 AND 365 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CABECERA: los días de crédito van de 0 a 365.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_monto IS NOT NULL AND v_monto < 0 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_CABECERA: el monto estimado no puede ser negativo.' USING ERRCODE = 'check_violation';
  END IF;

  -- ── Proyecto y proveedor: de esta empresa (y el proyecto, al alcance de quien llama) ──
  IF p_project_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = p_company_id) THEN
      RAISE EXCEPTION 'COMPRAS_ORDEN_PROYECTO: el proyecto no existe en esta empresa.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (public.is_super_admin() OR public.can_access_project(p_project_id)) THEN
      RAISE EXCEPTION 'COMPRAS_ORDEN_PROYECTO: no tienes acceso a ese proyecto.' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  SELECT nombre INTO v_nombre FROM public.proveedores WHERE id = v_prov AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_PROVEEDOR: el proveedor no existe en esta empresa.' USING ERRCODE = 'check_violation';
  END IF;

  -- ── Los renglones: arreglo de objetos, acotado y con datos posibles ──────
  v_lineas := COALESCE(p_lineas, '[]'::jsonb);
  IF jsonb_typeof(v_lineas) <> 'array' THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_LINEA_INVALIDA: los renglones deben venir como una lista.' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_array_length(v_lineas) > 500 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_LINEA_LIMITE: una orden admite hasta 500 renglones; esta trae %.', jsonb_array_length(v_lineas)
      USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    SELECT COUNT(*),
           COUNT(*) FILTER (WHERE r.descripcion IS NULL OR length(btrim(r.descripcion)) NOT BETWEEN 2 AND 300
                                  OR r.cantidad IS NULL OR r.cantidad <= 0
                                  OR r.precio_unitario IS NULL OR r.precio_unitario < 0
                                  OR COALESCE(r.iva_monto, 0) < 0
                                  OR COALESCE(r.destino_tipo, 'gasto') NOT IN ('inventario', 'activo_fijo', 'servicio', 'gasto')
                                  OR (r.unidad IS NOT NULL AND length(btrim(r.unidad)) NOT BETWEEN 1 AND 20))
      INTO v_n, v_invalid
      FROM jsonb_to_recordset(v_lineas) AS r(descripcion text, destino_tipo text, suministro_id uuid, cuenta_id uuid,
                                             categoria text, cantidad numeric, unidad text, precio_unitario numeric,
                                             iva_monto numeric);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_LINEA_INVALIDA: un renglón trae un dato imposible (cantidad, precio, IVA, insumo o cuenta con formato inválido).'
      USING ERRCODE = 'check_violation';
  END;
  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_LINEA_INVALIDA: % renglón(es) sin descripción (2 a 300 caracteres), con cantidad menor o igual a cero, con precio o IVA negativo, con unidad vacía o con un destino que no es inventario, activo fijo, servicio o gasto.', v_invalid
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Huella del contenido: las mismas cifras escritas distinto (10 / 10.0) NO la
  -- cambian; un valor distinto o el orden de los renglones sí. ─────────────────
  v_cab := jsonb_build_object(
    'company_id', p_company_id, 'project_id', p_project_id, 'proveedor_id', v_prov, 'contrato_id', v_contrato,
    'concepto', v_concepto, 'descripcion', v_desc, 'monto_estimado', round(v_monto, 2)::text,
    'fecha_entrega_esperada', v_entrega, 'fecha_requerida', v_requerida, 'condiciones_pago', v_cond,
    'dias_credito', v_dias, 'obra_id', v_obra, 'notas', v_notas);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'n', x.ord,
           'descripcion', btrim(x.descripcion),
           'destino_tipo', COALESCE(x.destino_tipo, 'gasto'),
           'suministro_id', x.suministro_id,
           'cuenta_id', x.cuenta_id,
           'categoria', COALESCE(NULLIF(btrim(x.categoria), ''), 'otros'),
           'cantidad', round(x.cantidad, 4)::text,
           'unidad', COALESCE(NULLIF(btrim(x.unidad), ''), 'unidad'),
           'precio_unitario', round(x.precio_unitario, 4)::text,
           'iva_monto', round(COALESCE(x.iva_monto, 0), 2)::text) ORDER BY x.ord), '[]'::jsonb)
    INTO v_norm
    FROM ROWS FROM (jsonb_to_recordset(v_lineas) AS (descripcion text, destino_tipo text, suministro_id uuid, cuenta_id uuid,
                                                     categoria text, cantidad numeric, unidad text, precio_unitario numeric,
                                                     iva_monto numeric))
         WITH ORDINALITY AS x(descripcion, destino_tipo, suministro_id, cuenta_id, categoria, cantidad, unidad,
                              precio_unitario, iva_monto, ord);
  v_hash := encode(sha256(convert_to(jsonb_build_object('cabecera', v_cab, 'lineas', v_norm)::text, 'UTF8')), 'hex');

  -- Los intentos simultáneos con la misma clave se ejecutan de uno en uno: el
  -- segundo espera, ve la orden del primero y la recupera (o se rechaza).
  PERFORM pg_advisory_xact_lock(hashtextextended('compras_orden:' || p_company_id::text || ':' || v_clave, 0));

  SELECT * INTO v_exist FROM public.ordenes_compra
   WHERE company_id = p_company_id AND clave_idempotencia = v_clave;
  IF FOUND THEN
    IF v_exist.hash_contenido IS NULL THEN
      RAISE EXCEPTION 'COMPRAS_ORDEN_CLAVE_SIN_HUELLA: la clave ya identifica una orden creada fuera de esta función y no se puede verificar que el contenido sea el mismo. Usa otra clave.'
        USING ERRCODE = 'unique_violation';
    END IF;
    IF v_exist.hash_contenido <> v_hash THEN
      RAISE EXCEPTION 'COMPRAS_ORDEN_CLAVE_CONFLICTO: la clave de idempotencia ya se usó para una orden con OTRO contenido. Un reintento debe enviar lo mismo; una orden distinta lleva una clave nueva.'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'orden', to_jsonb(v_exist),
      'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.linea), '[]'::jsonb)
                   FROM public.orden_compra_lineas l WHERE l.orden_compra_id = v_exist.id),
      'reutilizada', true);
  END IF;

  -- ── Escritura: cabecera y renglones en la MISMA transacción ──────────────
  BEGIN
    INSERT INTO public.ordenes_compra
      (company_id, project_id, proveedor_id, proveedor_nombre, contrato_id, concepto, descripcion, monto_estimado,
       fecha_entrega_esperada, fecha_requerida, condiciones_pago, dias_credito, obra_id, notas,
       estado, clave_idempotencia, hash_contenido)
    VALUES
      (p_company_id, p_project_id, v_prov, v_nombre, v_contrato, v_concepto, v_desc, v_monto,
       v_entrega, v_requerida, v_cond, v_dias, v_obra, v_notas,
       'borrador', v_clave, v_hash)
    RETURNING * INTO v_o;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons IS DISTINCT FROM 'uq_ordenes_compra_clave' THEN
      RAISE;   -- otra restricción única (p. ej. de un trigger): no se disfraza de «clave en uso»
    END IF;
    -- La clave la tiene una orden que esta sesión no ve (otro alcance): no se revela
    -- nada, solo se pide otra clave.
    RAISE EXCEPTION 'COMPRAS_ORDEN_CLAVE_EN_USO: la clave de idempotencia ya está en uso. Usa otra clave.'
      USING ERRCODE = 'unique_violation';
  END;

  -- Si un renglón falla (insumo de otro proyecto, cuenta inválida, contrato vencido…)
  -- se revierte TAMBIÉN la cabecera: no queda ninguna orden a medias.
  IF v_n > 0 THEN
    INSERT INTO public.orden_compra_lineas
      (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, cuenta_id, categoria,
       cantidad, unidad, precio_unitario, iva_monto)
    SELECT p_company_id, v_o.id, x.ord::int, btrim(x.descripcion), COALESCE(x.destino_tipo, 'gasto'),
           x.suministro_id, x.cuenta_id, COALESCE(NULLIF(btrim(x.categoria), ''), 'otros'),
           x.cantidad, COALESCE(NULLIF(btrim(x.unidad), ''), 'unidad'), x.precio_unitario, COALESCE(x.iva_monto, 0)
      FROM ROWS FROM (jsonb_to_recordset(v_lineas) AS (descripcion text, destino_tipo text, suministro_id uuid, cuenta_id uuid,
                                                       categoria text, cantidad numeric, unidad text, precio_unitario numeric,
                                                       iva_monto numeric))
           WITH ORDINALITY AS x(descripcion, destino_tipo, suministro_id, cuenta_id, categoria, cantidad, unidad,
                                precio_unitario, iva_monto, ord)
     ORDER BY x.ord;
  END IF;

  -- Se relee la cabecera: los triggers de los renglones ya actualizaron subtotal, IVA y total.
  SELECT * INTO v_o FROM public.ordenes_compra WHERE id = v_o.id;
  RETURN jsonb_build_object(
    'orden', to_jsonb(v_o),
    'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.linea), '[]'::jsonb)
                 FROM public.orden_compra_lineas l WHERE l.orden_compra_id = v_o.id),
    'reutilizada', false);
END;
$$;

COMMENT ON FUNCTION public.compras_orden_crear(uuid, uuid, jsonb, jsonb) IS
  'Crea una orden de compra en BORRADOR con sus renglones en UNA transacción: todo o nada, idempotente por clave + huella de contenido, validada en servidor. SECURITY INVOKER: RLS y los triggers de proveedor, contrato, cuentas e inventario rigen igual que con un INSERT directo.';

REVOKE ALL ON FUNCTION public.compras_orden_crear(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_orden_crear(uuid, uuid, jsonb, jsonb) TO authenticated;
