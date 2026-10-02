-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · FACTURA DE PROVEEDOR: CREACIÓN TRANSACCIONAL E IDEMPOTENTE
--
-- QUÉ FALTABA
-- La interfaz creaba una factura contra una orden en DOS peticiones (cabecera y
-- luego renglones) y, si los renglones fallaban, intentaba BORRAR la cabecera
-- desde el cliente. Eso no es una operación: una caída entre las dos peticiones,
-- un permiso que no deja borrar o un doble clic dejaban una factura ligada a la
-- orden sin renglones (que además aprobaría sin cuadre) o dos facturas iguales.
-- No existía ninguna función de servidor para crear facturas.
--
-- QUÉ HACE `compras_factura_crear(empresa, proyecto, cabecera, renglones)`
-- Es la entrada transaccional a las MISMAS tablas y triggers de siempre
-- (`facturas_proveedor`, `factura_proveedor_lineas`, el cuadre y el devengo); no
-- hay un motor paralelo. Sigue el patrón de `compras_recepcion_crear`:
--   · TODO O NADA: cabecera y renglones en una sola transacción. Si cualquier
--     renglón falla se revierte también la cabecera.
--   · IDEMPOTENTE: exige `clave_idempotencia` (una por intento de captura) y
--     guarda la huella del contenido. Misma clave y mismo contenido (doble clic,
--     respuesta perdida) devuelve LA MISMA factura sin crear otra; misma clave
--     con OTRO contenido se rechaza (COMPRAS_FACTURA_CLAVE_CONFLICTO). Los
--     intentos simultáneos con la misma clave se serializan con un bloqueo.
--   · VALIDA en el servidor, sin fiarse de la pantalla: la empresa es la de quien
--     llama; el proyecto es de esa empresa; el proveedor es de esa empresa; la
--     orden es de esa empresa, de ese proveedor y de ese proyecto y está en un
--     estado facturable; cada renglón es de ESA orden, sin repetirse; cantidad > 0,
--     precio e IVA ≥ 0. Con orden, el total, el IVA y la moneda SALEN de los
--     renglones y de la orden; lo que el cliente mande en esos campos no cuenta (la
--     moneda distinta de la de la orden se rechaza).
--   · SIN orden (gasto directo): no admite renglones; monto e IVA los manda quien
--     captura, como siempre.
--   · SECURITY INVOKER: RLS y los triggers de integridad rigen igual que con un
--     INSERT directo; no se amplía ningún permiso.
--
-- TAMBIÉN
--   · `facturas_proveedor.clave_idempotencia` y `hash_contenido`, con índice único
--     (empresa, clave) y protegidas contra edición posterior.
--   · El número de factura repetido sale con un código propio, no con el error
--     crudo del índice.
--
-- NO CAMBIA: el cuadre, las tolerancias, el devengo, los permisos ni las facturas
-- existentes (sus columnas nuevas quedan en NULL).
--
-- CÓMO REVERTIR
--   DROP FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb);
--   DROP TRIGGER trg_compras_factura_clave_inmutable ON public.facturas_proveedor;
--   DROP FUNCTION public.compras_tg_factura_clave_inmutable();
--   DROP INDEX public.uq_facturas_prov_clave;
--   ALTER TABLE public.facturas_proveedor DROP COLUMN clave_idempotencia, DROP COLUMN hash_contenido;
--   (la interfaz anterior vuelve a insertar en dos pasos).
-- IMPACTO EN DATOS: dos columnas nuevas, NULL en todas las filas existentes.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.facturas_proveedor
  ADD COLUMN IF NOT EXISTS clave_idempotencia text,
  ADD COLUMN IF NOT EXISTS hash_contenido     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facturas_proveedor_clave_longitud') THEN
    ALTER TABLE public.facturas_proveedor
      ADD CONSTRAINT facturas_proveedor_clave_longitud
      CHECK (clave_idempotencia IS NULL OR length(btrim(clave_idempotencia)) BETWEEN 8 AND 200);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_facturas_prov_clave
  ON public.facturas_proveedor (company_id, clave_idempotencia)
  WHERE clave_idempotencia IS NOT NULL;

-- La clave y la huella identifican UN intento de captura: no se editan después.
CREATE OR REPLACE FUNCTION public.compras_tg_factura_clave_inmutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.clave_idempotencia IS DISTINCT FROM OLD.clave_idempotencia
      OR NEW.hash_contenido IS DISTINCT FROM OLD.hash_contenido)
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_FACTURA_CLAVE_INMUTABLE: la clave de idempotencia y la huella de la factura no se modifican.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_compras_factura_clave_inmutable ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_factura_clave_inmutable
  BEFORE UPDATE OF clave_idempotencia, hash_contenido ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_clave_inmutable();

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
    IF v_o.estado NOT IN ('emitida', 'recibida_parcial', 'recibida') THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_ORDEN_ESTADO: la orden está "%" y no admite facturas nuevas (solo emitida, recibida parcial o recibida).', v_o.estado
        USING ERRCODE = 'check_violation';
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
