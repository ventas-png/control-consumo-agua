-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN DE LAS MIGRACIONES 20261027000000…0900 (compras · controles de servidor)
-- GENERADO del catálogo de una cadena real de migraciones (no se edita a mano): cada sección deshace UNA migración
-- y supone que las posteriores ya están revertidas (por eso van de la última a la primera).
-- Cada bloque es una transacción: si algo falla, no queda nada a medias. Son solo funciones, disparadores,
-- índices y restricciones; NO hay datos que borrar ni restaurar (salvo las claves de idempotencia de 0800).
-- Revertir REABRE los defectos que cada migración cerraba. Verificado con 
-- supabase/tests/compras_bloque_b/run.sh §6c (aplica la cadena, revierte TODO y revierte SOLO la sección de 0900; compara el catálogo).
-- La sección de 20261027000900 está escrita con sus tres piezas (facturas, separación, permisos) y se puede correr SOLA para volver al
-- estado posterior a 0800. La bitácora de la separación se conserva si tiene cambios (ver su aviso).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 20261027000900_compras_permisos_accion_separacion_y_numeros_factura ────
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Se revierte en orden inverso al de la migración: números de factura → protección de la separación → permisos por acción.
-- Las cinco llaves del catálogo NO se borran (borrarlas elimina en cascada cualquier concesión ya hecha): ver el bloque opcional del final.
-- La bitácora de la separación es EVIDENCIA: si tiene cambios se CONSERVA con un aviso; para descartarla a propósito (base desechable):
--   SET compras.reversion_descartar_bitacora = 'si';   (en la misma sesión, antes de ejecutar esta sección)

-- ─── Números de factura (alternativa A de RG-4) ───
-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de la pieza RG-4 (números de factura, alternativa A) · sin pérdida de datos
-- ════════════════════════════════════════════════════════════════════════════
-- Devuelve el catálogo a lo que había tras 20261027000800: el cuerpo del trigger de equivalencia (EV-09 + clave
-- sola, sin criterio de separadores), su comentario, el cuerpo de compras_factura_crear de 20261021000900, y quita las
-- dos funciones nuevas. No toca filas, ni el índice idx_facturas_prov_numero_norm, ni el trigger, ni
-- compras_normalizar_numero. Idempotente. El ORDEN importa: primero los cuerpos que usan las funciones nuevas,
-- después los DROP.
--   · Efecto de revertir: «1-23» y «12-3» vuelven a rechazarse entre sí (la regla de 0400/0800: clave sola). Los
--     pares que se hayan registrado mientras regía la alternativa A (separadores en posiciones distintas) siguen
--     ahí: la regla antigua tampoco revalida lo que ya existe.
--   · Las copias exactas de los cuerpos vigentes están en vigente_0800_trigger.sql y vigente_0800_factura_crear.sql
--     (salida de pg_get_functiondef sobre una base con la cadena hasta 0800).
-- ════════════════════════════════════════════════════════════════════════════

-- 1 · Trigger de equivalencia: cuerpo y comentario de 0800
CREATE OR REPLACE FUNCTION public.compras_tg_factura_numero_equivalente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.compras_normalizar_numero(NEW.numero_factura);
  v_dup  record;
BEGIN
  IF v_norm IS NULL OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.numero_factura IS NOT DISTINCT FROM OLD.numero_factura
     AND NEW.proveedor_id   =  OLD.proveedor_id THEN
    RETURN NEW;
  END IF;

  -- Dos altas simultáneas del mismo número se serializan: la segunda ve a la primera.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('factura-numero:' || NEW.company_id::text || ':' || NEW.proveedor_id::text || ':' || v_norm, 0));

  -- [EV-09] se trae también el proyecto de la factura existente, y se prefiere una que la
  -- persona pueda ver para que el mensaje, si nombra algo, nombre algo suyo.
  SELECT f.numero_factura, f.estado, f.fecha_emision, f.monto_total, f.company_id, f.project_id INTO v_dup
    FROM public.facturas_proveedor f
   WHERE f.company_id   = NEW.company_id
     AND f.proveedor_id = NEW.proveedor_id
     AND f.id          <> NEW.id
     AND f.estado      <> 'anulada'
     -- El número IDÉNTICO lo rechaza el índice único `uq_facturas_prov_numero` con su error
     -- de siempre; aquí solo el mismo número escrito de otra forma.
     AND f.numero_factura IS DISTINCT FROM NEW.numero_factura
     AND public.compras_normalizar_numero(f.numero_factura) = v_norm
   ORDER BY public.compras_puede_ver_documento(f.company_id, f.project_id) DESC
   LIMIT 1;

  IF FOUND THEN
    -- Mismo SQLSTATE y mismo nombre de restricción que el índice único exacto: la RPC
    -- `compras_factura_crear` ya traduce ese error y el cliente ya lo muestra.
    -- [EV-09] si la factura existente es de un proyecto que la persona no ve, el mensaje no
    -- dice su número, fecha, importe ni estado (el aviso de duplicado se conserva).
    IF public.compras_puede_ver_documento(v_dup.company_id, v_dup.project_id) THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («%», % por %, %). Si es la misma, no la registres otra vez.',
        v_dup.numero_factura, to_char(v_dup.fecha_emision, 'DD/MM/YYYY'), v_dup.monto_total, v_dup.estado
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
    END IF;
    RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente. Si es la misma, no la registres otra vez.'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
  END IF;
  RETURN NEW;
END;
$function$

;

COMMENT ON FUNCTION public.compras_tg_factura_numero_equivalente() IS
  'Rechaza una factura cuyo número, ignorando mayúsculas, espacios y puntuación, ya existe (no anulada) para el mismo proveedor. Solo al nacer o al cambiar número/proveedor.';
REVOKE ALL ON FUNCTION public.compras_tg_factura_numero_equivalente() FROM PUBLIC, anon, authenticated;

-- 2 · compras_factura_crear: cuerpo de 20261021000900 (vigente tras 0800)
CREATE OR REPLACE FUNCTION public.compras_factura_crear(p_company_id uuid, p_project_id uuid, p_cabecera jsonb, p_lineas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$

;

REVOKE ALL ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_factura_crear(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;

-- 3 · Las dos funciones nuevas (ya nada las usa)
DROP FUNCTION IF EXISTS public.compras_numeros_equivalentes(text, text);
DROP FUNCTION IF EXISTS public.compras_numero_separadores(text);

-- ─── Protección de la separación solicitante/aprobador ───
-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de la pieza SEP (separación solicitante/aprobador protegida) · para agregar a scripts/reversion-compras-controles.sql
-- (sección de 20261027000900, ANTES de las secciones de las migraciones anteriores).
-- Revertir REABRE el defecto que la pieza cerraba: el interruptor vuelve a cambiarse escribiendo en compras_config (y TRUNCATE a
-- estar al alcance de `authenticated`). No hay datos de negocio que restaurar.
--
-- LA BITÁCORA ES EVIDENCIA: por defecto NO se borra si contiene algo más que la línea base. Para descartarla a propósito (base
-- desechable, comprobación de catálogo) se declara en la sesión:   SET compras.reversion_descartar_bitacora = 'si';
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_compras_00_config_separacion          ON public.compras_config;
DROP TRIGGER IF EXISTS trg_compras_00_config_separacion_truncate ON public.compras_config;
DROP TRIGGER IF EXISTS trg_zz_compras_config_separacion_bitacora ON public.compras_config;
DROP FUNCTION IF EXISTS public.compras_separacion_configurar(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.compras_tg_config_separacion();
DROP FUNCTION IF EXISTS public.compras_tg_config_separacion_truncate();
DROP FUNCTION IF EXISTS public.compras_tg_config_separacion_bitacora();
DROP FUNCTION IF EXISTS public.compras_separacion_registrar(uuid, boolean, boolean);
DROP FUNCTION IF EXISTS public.compras_separacion_rechazar(text);
DROP FUNCTION IF EXISTS public.compras_separacion_via_rpc(uuid, boolean);
DROP FUNCTION IF EXISTS public.compras_separacion_memoria(uuid);

DO $$
BEGIN
  IF to_regclass('public.compras_config_separacion_bitacora') IS NULL THEN
    DROP FUNCTION IF EXISTS public.compras_tg_config_separacion_bitacora_inmutable();
  ELSIF current_setting('compras.reversion_descartar_bitacora', true) = 'si'
        OR NOT EXISTS (SELECT 1 FROM public.compras_config_separacion_bitacora WHERE origen <> 'linea_base') THEN
    DROP TABLE public.compras_config_separacion_bitacora;      -- se lleva sus triggers, índices, restricciones y política
    DROP FUNCTION IF EXISTS public.compras_tg_config_separacion_bitacora_inmutable();
  ELSE
    RAISE NOTICE 'La bitácora de la separación (public.compras_config_separacion_bitacora) se CONSERVA: tiene cambios registrados. Para descartarla: SET compras.reversion_descartar_bitacora = ''si'' y repetir.';
  END IF;
END $$;

-- Privilegios de compras_config como estaban antes de la pieza (los de siempre de Supabase).
GRANT ALL ON TABLE public.compras_config TO anon;
GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLE public.compras_config TO authenticated;

-- ─── Permisos independientes por acción ───
-- ════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN DE LA PIEZA «PERMISOS POR ACCIÓN» (parte de 20261027000900)
-- Quita el disparador trg_zzcompras_mover_alcance de las cinco tablas y su función, devuelve las cinco funciones de disparador de
-- permiso a su definición VIGENTE antes de la pieza (la de 20261027000700 para la orden de compra y la de 20261027000300 para
-- recepción, factura, orden de pago y contraseña; copiadas con pg_get_functiondef de hall_b0800) y elimina la comprobación común.
-- No toca ningún documento, rol, asignación ni proyecto.
-- Revertir REABRE los defectos: `approve` y `change_status` genéricos vuelven a decidir las seis acciones, las escrituras directas de
-- otro proyecto de la empresa vuelven a pasar sin comprobar el alcance de proyecto, y emitir/cancelar/cerrar la orden y anular
-- recepción, factura y contraseña vuelven a no mirar ni la empresa ni el proyecto del documento.
-- Las cinco llaves del catálogo NO se borran: son inofensivas sin el disparador y borrarlas elimina EN CASCADA cualquier fila de
-- role_permissions que ya se haya concedido (ver el bloque comentado del final, SOLO si se pide expresamente).
-- Idempotente: se puede correr dos veces. DROP TRIGGER toma un bloqueo exclusivo breve de cada tabla: usar SET LOCAL lock_timeout.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 · Primero el disparador de mover (ya nada lo necesita) y su función
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_zzcompras_mover_alcance ON public.contrasenas_pago;
DROP FUNCTION IF EXISTS public.compras_tg_mover_alcance();

-- 2 · Las cinco funciones de permiso, como estaban antes de la pieza
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado = 'borrador' THEN
      RETURN NEW;
    ELSIF NEW.estado = 'aprobada' THEN
      PERFORM public.compras_exigir_accion('approve', 'crear una orden de compra ya aprobada');
    ELSIF NEW.estado = 'emitida' THEN
      PERFORM public.compras_exigir_accion('approve', 'crear una orden de compra ya aprobada');
      PERFORM public.compras_exigir_accion('change_status', 'crear una orden de compra ya emitida');
    ELSE
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una orden de compra nace en borrador (o, con permiso, aprobada o emitida); no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'borrador' AND NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar una orden de compra');
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
  ELSIF OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN
    PERFORM public.compras_exigir_accion('approve', 'devolver a borrador una orden aprobada');
  ELSIF NEW.estado = 'emitida' THEN
    PERFORM public.compras_exigir_accion('change_status', 'emitir una orden de compra al proveedor');
  ELSIF NEW.estado = 'cancelada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'cancelar una orden de compra');
  ELSIF NEW.estado = 'cerrada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'cerrar una orden de compra');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compras_tg_permiso_recepcion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una recepción nace en borrador y se registra después (eso mueve existencias y contabiliza); no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'registrada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'registrar una recepción (mueve existencias y contabiliza)');
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una recepción');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compras_tg_permiso_factura()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'registrada' OR NEW.monto_pagado <> 0 THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una factura nace «registrada» y sin pagos; se aprueba (se cuadra y se contabiliza) y se paga después. No se crea ya «%» con % pagado.', NEW.estado, NEW.monto_pagado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Pagada / pagada parcial y el monto pagado los deja el trigger de pago.
  IF (NEW.estado IS DISTINCT FROM OLD.estado AND NEW.estado IN ('pagada', 'pagada_parcial'))
     OR NEW.monto_pagado IS DISTINCT FROM OLD.monto_pagado THEN
    RAISE EXCEPTION 'COMPRAS_ESTADO_SOLO_SISTEMA: lo pagado de una factura y su estado «pagada» los deja una orden de pago al pagarse; no se escriben a mano.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar (contabilizar) una factura de proveedor');
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una factura de proveedor');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden_pago()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() OR TG_OP = 'INSERT'
     OR NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar una orden de pago');
  ELSIF NEW.estado = 'pagada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'marcar pagada una orden de pago (contabiliza el pago)');
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una orden de pago');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compras_tg_permiso_contrasena()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'emitida' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una contraseña de pago nace «emitida»; se paga con su orden de pago y se anula con motivo. No se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF NEW.estado = 'pagada' THEN
    RAISE EXCEPTION 'COMPRAS_ESTADO_SOLO_SISTEMA: una contraseña queda «pagada» cuando se paga la orden de pago que la liquida; no se marca a mano.'
      USING ERRCODE = 'check_violation';
  ELSIF NEW.estado = 'anulada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'anular una contraseña de pago');
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_recepcion()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_factura()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_orden_pago() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compras_tg_permiso_contrasena() FROM PUBLIC, anon, authenticated;

-- 3 · Va DESPUÉS de restaurar los cinco cuerpos: ya nada llama a la comprobación común.
DROP FUNCTION IF EXISTS public.compras_exigir_permiso(text, text, uuid, uuid);

-- ── OPCIONAL, SOLO SI SE PIDE EXPRESAMENTE: retirar las cinco llaves del catálogo ───────────────────────────────────────
-- ¡Borra EN CASCADA las filas de role_permissions que concedan estas llaves (role_permissions_permission_key_fkey ON DELETE CASCADE)!
-- Antes, listar lo que se perdería:
--   SELECT r.name, rp.permission_key FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
--    WHERE rp.permission_key LIKE 'platform.contabilidad.compras.%';
-- DELETE FROM public.permissions WHERE key IN (
--   'platform.contabilidad.compras.recepcion_registrar', 'platform.contabilidad.compras.factura_aprobar',
--   'platform.contabilidad.compras.orden_pago_aprobar',  'platform.contabilidad.compras.pago_ejecutar',
--   'platform.contabilidad.compras.pago_anular');
COMMIT;

-- ── 20261027000800_compras_cierre_hallazgos_adversariales ─────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.activos_fijos;
DROP TRIGGER IF EXISTS trg_compras_alcance_activo ON public.activos_fijos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_bloqueo_partida ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_bloqueo_partida_orden ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_contrasena ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_contrasena_cabecera_fija ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_contrasena_clave_inmutable ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_contrasena_total_derivado ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_zcompras_contrasena_estados ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.contratos_proveedores;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.evaluaciones_proveedor;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.factura_proveedor_lineas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zcompras_factura_estados ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zcompras_factura_identidad ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zcompras_factura_total_cuadra ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_zzcompras_congelar_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.gastos_condominio;
DROP TRIGGER IF EXISTS trg_compras_alcance_gasto ON public.gastos_condominio;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_compras_oc_linea_acumulados ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_01_importes_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden_obra ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_oc_motivos ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_permiso_orden_separada ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden_pago_ref ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_bloqueo_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_bloqueo ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_clave_inmutable ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles_contrasena ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles_partidas ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_conta_ordenes_pago_verificar ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_zzcompras_congelar_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proformas_condominio;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proveedor_contactos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proveedor_proyectos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.proveedores;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.recepcion_lineas;
DROP TRIGGER IF EXISTS trg_00_compras_rls_respaldo_recepcion ON public.recepcion_respaldos;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.recepciones;
DROP TRIGGER IF EXISTS trg_compras_00_numero_servidor ON public.recepciones;
DROP TRIGGER IF EXISTS trg_compras_00_sellos_recepcion ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zcompras_recepcion_estados ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zcompras_recepcion_identidad ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zzcompras_congelar_recepcion ON public.recepciones;
DROP TRIGGER IF EXISTS trg_zzcompras_numero_fijo ON public.recepciones;
DROP TRIGGER IF EXISTS trg_00_compras_rls_empresa ON public.suministros_condominio;
DROP INDEX IF EXISTS public.uq_contrasenas_pago_clave;
DROP INDEX IF EXISTS public.uq_ordenes_pago_clave;
DROP INDEX IF EXISTS public.uq_ordenes_pago_contrasena_viva;
ALTER TABLE contrasenas_pago DROP CONSTRAINT IF EXISTS contrasenas_pago_clave_longitud;
ALTER TABLE ordenes_pago DROP CONSTRAINT IF EXISTS ordenes_pago_clave_longitud;
ALTER TABLE public.contrasenas_pago DROP COLUMN IF EXISTS clave_idempotencia;
ALTER TABLE public.ordenes_pago DROP COLUMN IF EXISTS clave_idempotencia;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_normalizar_numero(p_numero text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT NULLIF(regexp_replace(upper(coalesce(p_numero, '')), '[^A-Z0-9]', '', 'g'), '')
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_alcance_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.company_id   IS NOT DISTINCT FROM OLD.company_id
     AND NEW.project_id   IS NOT DISTINCT FROM OLD.project_id
     AND NEW.proveedor_id IS NOT DISTINCT FROM OLD.proveedor_id THEN
    RETURN NEW;
  END IF;
  PERFORM public.compras_alcance_verificar(NEW.company_id, NEW.project_id, NEW.proveedor_id, TG_ARGV[0]);
  RETURN NEW;
END;
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_factura_numero_equivalente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.compras_normalizar_numero(NEW.numero_factura);
  v_dup  record;
BEGIN
  IF v_norm IS NULL OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.numero_factura IS NOT DISTINCT FROM OLD.numero_factura
     AND NEW.proveedor_id   =  OLD.proveedor_id THEN
    RETURN NEW;
  END IF;

  -- Dos altas simultáneas del mismo número se serializan: la segunda ve a la primera.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('factura-numero:' || NEW.company_id::text || ':' || NEW.proveedor_id::text || ':' || v_norm, 0));

  SELECT f.numero_factura, f.estado, f.fecha_emision, f.monto_total INTO v_dup
    FROM public.facturas_proveedor f
   WHERE f.company_id   = NEW.company_id
     AND f.proveedor_id = NEW.proveedor_id
     AND f.id          <> NEW.id
     AND f.estado      <> 'anulada'
     -- El número IDÉNTICO lo rechaza el índice único `uq_facturas_prov_numero` con su error
     -- de siempre; aquí solo el mismo número escrito de otra forma.
     AND f.numero_factura IS DISTINCT FROM NEW.numero_factura
     AND public.compras_normalizar_numero(f.numero_factura) = v_norm
   LIMIT 1;

  IF FOUND THEN
    -- Mismo SQLSTATE y mismo nombre de restricción que el índice único exacto: la RPC
    -- `compras_factura_crear` ya traduce ese error y el cliente ya lo muestra.
    RAISE EXCEPTION 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («%», % por %, %). Si es la misma, no la registres otra vez.',
      v_dup.numero_factura, to_char(v_dup.fecha_emision, 'DD/MM/YYYY'), v_dup.monto_total, v_dup.estado
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'uq_facturas_prov_numero';
  END IF;
  RETURN NEW;
END;
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_no_borrar_documento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_puede boolean;
  v_que   text;
  v_como  text;
BEGIN
  -- Cascada de la purga de una empresa o de un proyecto: no es un borrado de usuario.
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = OLD.company_id) THEN
    RETURN OLD;
  END IF;
  IF OLD.project_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    RETURN OLD;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'ordenes_compra' THEN
      v_puede := OLD.estado = 'borrador' AND OLD.revision = 0 AND OLD.aprobada_at IS NULL AND OLD.numero IS NULL;
      v_que := format('la orden de compra %s (%s)', COALESCE(OLD.numero, OLD.id::text), OLD.estado);
      v_como := 'Cancélala indicando el motivo: queda en su historial.';
    WHEN 'recepciones' THEN
      v_puede := OLD.estado = 'borrador' AND OLD.registrada_at IS NULL;
      v_que := format('la recepción %s (%s)', COALESCE(OLD.numero, OLD.id::text), OLD.estado);
      v_como := 'Anúlala indicando el motivo: se revierten el asiento, las existencias y los activos, y queda en el historial.';
    WHEN 'facturas_proveedor' THEN
      v_puede := OLD.estado = 'registrada' AND OLD.aprobada_at IS NULL AND OLD.monto_pagado = 0;
      v_que := format('la factura %s (%s)', COALESCE(OLD.numero_factura, OLD.id::text), OLD.estado);
      v_como := 'Anúlala: se revierten el devengo y lo facturado de la orden, y queda en el historial.';
    WHEN 'ordenes_pago' THEN
      v_puede := OLD.estado = 'borrador';
      v_que := format('la orden de pago (%s)', OLD.estado);
      v_como := 'Anúlala: se revierten el asiento y el saldo de la factura, y queda en el historial.';
    WHEN 'contrasenas_pago' THEN
      v_puede := false;
      v_que := format('la contraseña de pago %s (%s)', COALESCE(OLD.numero, OLD.id::text), OLD.estado);
      v_como := 'Anúlala indicando el motivo: es un acuse entregado al proveedor y queda en el historial.';
    ELSE
      RETURN OLD;
  END CASE;

  IF NOT v_puede THEN
    RAISE EXCEPTION 'COMPRAS_DOCUMENTO_NO_SE_BORRA: no se borra %. %', v_que, v_como
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_orden_pago_controles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_f         public.facturas_proveedor;
  v_c         public.contrasenas_pago;
  v_it        record;
  v_reservado numeric(14,2);
  v_saldo     numeric(14,2);
  v_pasa      boolean;     -- ¿hay que validar la factura/contraseña en esta operación?
  v_paga      boolean;     -- ¿esta operación la deja «pagada»?
BEGIN
  -- ── Máquina de estados ────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_ESTADO_INICIAL: una orden de pago nace en borrador y luego se aprueba y se paga; no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_uid IS NOT NULL THEN
      NEW.solicitada_por := v_uid;
    END IF;
  ELSE
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND NOT ((OLD.estado = 'borrador' AND NEW.estado IN ('aprobada', 'anulada'))
             OR (OLD.estado = 'aprobada' AND NEW.estado IN ('pagada', 'anulada'))
             OR (OLD.estado = 'pagada'   AND NEW.estado = 'anulada')) THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_TRANSICION_INVALIDA: una orden de pago no pasa de «%» a «%»; el camino es borrador → aprobada → pagada, y anular.', OLD.estado, NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.estado <> 'borrador'
       AND (NEW.company_id          IS DISTINCT FROM OLD.company_id
         OR NEW.project_id          IS DISTINCT FROM OLD.project_id
         OR NEW.proveedor_id        IS DISTINCT FROM OLD.proveedor_id
         OR NEW.factura_id          IS DISTINCT FROM OLD.factura_id
         OR NEW.contrasena_pago_id  IS DISTINCT FROM OLD.contrasena_pago_id
         OR NEW.monto               IS DISTINCT FROM OLD.monto) THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_INMUTABLE: la orden de pago ya no está en borrador y no cambia de factura, contraseña, proveedor, proyecto ni monto. Anúlala y captura otra.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Sellos del servidor: quién aprueba y cuándo se paga no lo dice el navegador.
    IF v_uid IS NOT NULL THEN
      IF NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada' THEN
        NEW.aprobada_por := v_uid;
        NEW.aprobada_at  := now();
      ELSIF NEW.aprobada_por IS DISTINCT FROM OLD.aprobada_por OR NEW.aprobada_at IS DISTINCT FROM OLD.aprobada_at THEN
        NEW.aprobada_por := OLD.aprobada_por;
        NEW.aprobada_at  := OLD.aprobada_at;
      END IF;
      IF NEW.estado = 'pagada' AND OLD.estado <> 'pagada' THEN
        NEW.pagada_at := now();
      ELSIF NEW.pagada_at IS DISTINCT FROM OLD.pagada_at THEN
        NEW.pagada_at := OLD.pagada_at;
      END IF;
      IF NEW.solicitada_por IS DISTINCT FROM OLD.solicitada_por THEN
        NEW.solicitada_por := OLD.solicitada_por;
      END IF;
    END IF;
  END IF;

  -- ── ¿Qué hay que comprobar contra la factura o la contraseña? ─────────────
  v_paga := NEW.estado = 'pagada' AND (TG_OP = 'INSERT' OR OLD.estado <> 'pagada');
  v_pasa := TG_OP = 'INSERT'
         OR (NEW.estado = 'aprobada' AND OLD.estado <> 'aprobada')
         OR v_paga
         OR (OLD.estado = 'borrador'
             AND (NEW.factura_id IS DISTINCT FROM OLD.factura_id
               OR NEW.contrasena_pago_id IS DISTINCT FROM OLD.contrasena_pago_id
               OR NEW.monto IS DISTINCT FROM OLD.monto
               OR NEW.proveedor_id IS DISTINCT FROM OLD.proveedor_id
               OR NEW.project_id IS DISTINCT FROM OLD.project_id));
  IF NOT v_pasa OR NEW.estado = 'anulada' THEN
    RETURN NEW;
  END IF;

  -- ── Orden contra UNA factura ──────────────────────────────────────────────
  IF NEW.factura_id IS NOT NULL THEN
    -- La fila de la factura se bloquea: dos órdenes que se aprueban o se pagan a la
    -- vez sobre la misma factura se serializan y la segunda lee el saldo ya movido.
    SELECT * INTO v_f FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEW;   -- la FK rechaza la fila
    END IF;

    IF v_f.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_FACTURA_AJENA: la factura no pertenece a la empresa de la orden de pago.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.proveedor_id <> NEW.proveedor_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_FACTURA_AJENA: la orden de pago es de otro proveedor que la factura.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_FACTURA_AJENA: la orden de pago es de otra contabilidad (proyecto o empresa) que la factura.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.estado NOT IN ('aprobada', 'pagada_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_NO_PAGABLE: la factura % está «%»; solo se paga una factura aprobada (o pagada parcial). Una factura sin aprobar no se ha cuadrado contra la orden ni contabilizado.',
        COALESCE(v_f.numero_factura, v_f.id::text), v_f.estado
        USING ERRCODE = 'check_violation';
    END IF;

    v_saldo := v_f.monto_total - v_f.monto_pagado;
    IF NEW.monto > v_saldo THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_EXCEDE_SALDO: la factura % tiene un saldo de % y la orden de pago es por %. No se paga más de lo que se debe.',
        COALESCE(v_f.numero_factura, v_f.id::text), v_saldo, NEW.monto
        USING ERRCODE = 'check_violation';
    END IF;

    IF NOT v_paga THEN
      -- Al crear o aprobar: tampoco puede rebasar lo que ya reservan OTRAS órdenes
      -- vivas de la misma factura ni las contraseñas emitidas que la incluyen.
      SELECT COALESCE(SUM(o.monto), 0) INTO v_reservado
        FROM public.ordenes_pago o
       WHERE o.factura_id = NEW.factura_id AND o.id <> NEW.id AND o.estado IN ('borrador', 'aprobada');
      v_reservado := v_reservado + COALESCE((
        SELECT SUM(cf.monto)
          FROM public.contrasena_pago_facturas cf
          JOIN public.contrasenas_pago c ON c.id = cf.contrasena_id
         WHERE cf.factura_id = NEW.factura_id AND c.estado = 'emitida'), 0);
      IF NEW.monto > v_saldo - v_reservado THEN
        RAISE EXCEPTION 'COMPRAS_PAGO_EXCEDE_SALDO: la factura % tiene un saldo de % y ya hay % reservado en otras órdenes de pago o contraseñas vivas; esta orden es por %.',
          COALESCE(v_f.numero_factura, v_f.id::text), v_saldo, v_reservado, NEW.monto
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- ── Orden que liquida una CONTRASEÑA ──────────────────────────────────────
  IF NEW.contrasena_pago_id IS NOT NULL THEN
    SELECT * INTO v_c FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_pago_id;
    IF NOT FOUND THEN
      RETURN NEW;   -- la FK rechaza la fila
    END IF;
    IF v_c.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'COMPRAS_PAGO_CONTRASENA_AJENA: la contraseña no pertenece a la empresa de la orden de pago.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_paga THEN
      IF v_c.estado <> 'emitida' THEN
        RAISE EXCEPTION 'COMPRAS_CONTRASENA_CERRADA: la contraseña % está «%» y no se puede pagar.', COALESCE(v_c.numero, v_c.id::text), v_c.estado
          USING ERRCODE = 'check_violation';
      END IF;
      -- Cada partida debe caber en el saldo ACTUAL de su factura (un pago directo
      -- posterior pudo dejarlo corto). Se bloquean en orden de id: sin interbloqueos.
      FOR v_it IN
        SELECT cf.factura_id, cf.monto FROM public.contrasena_pago_facturas cf
         WHERE cf.contrasena_id = NEW.contrasena_pago_id ORDER BY cf.factura_id
      LOOP
        SELECT * INTO v_f FROM public.facturas_proveedor f WHERE f.id = v_it.factura_id FOR UPDATE;
        IF v_f.estado NOT IN ('aprobada', 'pagada_parcial') THEN
          RAISE EXCEPTION 'COMPRAS_FACTURA_NO_PAGABLE: la factura % de la contraseña está «%» y no se puede pagar.',
            COALESCE(v_f.numero_factura, v_f.id::text), v_f.estado
            USING ERRCODE = 'check_violation';
        END IF;
        IF v_it.monto > v_f.monto_total - v_f.monto_pagado THEN
          RAISE EXCEPTION 'COMPRAS_PAGO_EXCEDE_SALDO: la factura % de la contraseña tiene un saldo de % y la partida es por %.',
            COALESCE(v_f.numero_factura, v_f.id::text), v_f.monto_total - v_f.monto_pagado, v_it.monto
            USING ERRCODE = 'check_violation';
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.proveedor_habilitado(p_proveedor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.proveedores
    WHERE id = p_proveedor_id
      AND estado = 'autorizado'
      AND (autorizacion_vence IS NULL OR autorizacion_vence >= CURRENT_DATE)
  )
$function$;
DROP FUNCTION IF EXISTS compras_evidencia_documento(text,uuid);
DROP FUNCTION IF EXISTS compras_puede_ver_documento(uuid,uuid);
DROP FUNCTION IF EXISTS compras_sello_conservar(text,text,anyelement,anyelement);
DROP FUNCTION IF EXISTS compras_tg_alcance_orden_obra();
DROP FUNCTION IF EXISTS compras_tg_alcance_orden_pago_ref();
DROP FUNCTION IF EXISTS compras_tg_alcance_referencias();
DROP FUNCTION IF EXISTS compras_tg_bloqueo_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_bloqueo_partida();
DROP FUNCTION IF EXISTS compras_tg_bloqueo_partida_orden();
DROP FUNCTION IF EXISTS compras_tg_congelar_factura();
DROP FUNCTION IF EXISTS compras_tg_congelar_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_congelar_recepcion();
DROP FUNCTION IF EXISTS compras_tg_contrasena_cabecera_fija();
DROP FUNCTION IF EXISTS compras_tg_contrasena_maquina_estados();
DROP FUNCTION IF EXISTS compras_tg_contrasena_total_derivado();
DROP FUNCTION IF EXISTS compras_tg_factura_identidad_fija();
DROP FUNCTION IF EXISTS compras_tg_factura_maquina_estados();
DROP FUNCTION IF EXISTS compras_tg_factura_total_cuadra();
DROP FUNCTION IF EXISTS compras_tg_importes_orden();
DROP FUNCTION IF EXISTS compras_tg_motivos_orden();
DROP FUNCTION IF EXISTS compras_tg_numero_del_servidor();
DROP FUNCTION IF EXISTS compras_tg_oc_linea_acumulados();
DROP FUNCTION IF EXISTS compras_tg_orden_pago_bloqueo();
DROP FUNCTION IF EXISTS compras_tg_orden_pago_controles_contrasena();
DROP FUNCTION IF EXISTS compras_tg_orden_pago_controles_partidas();
DROP FUNCTION IF EXISTS compras_tg_pago_clave_inmutable();
DROP FUNCTION IF EXISTS compras_tg_permiso_orden_separada();
DROP FUNCTION IF EXISTS compras_tg_recepcion_identidad_fija();
DROP FUNCTION IF EXISTS compras_tg_recepcion_maquina_estados();
DROP FUNCTION IF EXISTS compras_tg_rls_empresa();
DROP FUNCTION IF EXISTS compras_tg_rls_respaldo_recepcion();
DROP FUNCTION IF EXISTS compras_tg_sellos_contrasena();
DROP FUNCTION IF EXISTS compras_tg_sellos_factura();
DROP FUNCTION IF EXISTS compras_tg_sellos_orden();
DROP FUNCTION IF EXISTS compras_tg_sellos_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_sellos_recepcion();
DROP FUNCTION IF EXISTS conta_tg_ordenes_pago_verificar();
COMMIT;

-- ── 20261027000700_compras_orden_nace_con_permiso ─────────────────────────
BEGIN;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.compras_tg_permiso_orden()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.compras_sesion_usuario() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'borrador' THEN
      RAISE EXCEPTION 'COMPRAS_ESTADO_INICIAL: una orden de compra nace en borrador y se aprueba y emite después; no se crea ya «%».', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  IF OLD.estado = 'borrador' AND NEW.estado = 'aprobada' THEN
    PERFORM public.compras_exigir_accion('approve', 'aprobar una orden de compra');
    NEW.aprobada_por := auth.uid();     -- quién aprueba lo dice el servidor
    NEW.aprobada_at  := now();
  ELSIF OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN
    PERFORM public.compras_exigir_accion('approve', 'devolver a borrador una orden aprobada');
  ELSIF NEW.estado = 'emitida' THEN
    PERFORM public.compras_exigir_accion('change_status', 'emitir una orden de compra al proveedor');
  ELSIF NEW.estado = 'cancelada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'cancelar una orden de compra');
  ELSIF NEW.estado = 'cerrada' THEN
    PERFORM public.compras_exigir_accion('change_status', 'cerrar una orden de compra');
  END IF;
  RETURN NEW;
END;
$function$;
COMMIT;

-- ── 20261027000600_compras_proveedor_identidad_restaurada ─────────────────
BEGIN;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm      text;
  v_norm_old  text;
  v_dup       record;
  v_nombre_n  text;
  v_codigo_propio boolean;
BEGIN
  NEW.pais   := NULLIF(upper(btrim(NEW.pais)), '');
  NEW.codigo := NULLIF(btrim(NEW.codigo), '');
  -- ¿La persona eligió un código? (antes de que el correlativo lo rellene)
  v_codigo_propio := NEW.codigo IS NOT NULL;

  IF TG_OP = 'INSERT' AND NEW.codigo IS NULL THEN
    NEW.codigo := public.proveedor_siguiente_codigo(NEW.company_id);
  END IF;

  -- La columna generada todavía no existe en un BEFORE: se calcula la misma
  -- expresión.
  v_norm := public.proveedor_normalizar_identificacion(
    COALESCE(NULLIF(btrim(NEW.nit), ''), NULLIF(btrim(NEW.rfc), '')));

  IF TG_OP = 'UPDATE' THEN
    v_norm_old := public.proveedor_normalizar_identificacion(
      COALESCE(NULLIF(btrim(OLD.nit), ''), NULLIF(btrim(OLD.rfc), '')));
  END IF;

  -- Solo cuando la IDENTIDAD cambia (o nace). Editar el teléfono de un
  -- proveedor que ya está duplicado de antes no puede quedar bloqueado: esos
  -- casos se resuelven con proveedores_duplicados_fiscales(), no aquí.
  IF v_norm IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_norm IS DISTINCT FROM v_norm_old
          OR NEW.pais IS DISTINCT FROM OLD.pais) THEN

    -- Candado consultivo: dos altas simultáneas del mismo NIT se serializan y
    -- la segunda ve a la primera.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-identidad:' || NEW.company_id::text || ':' || v_norm, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR NEW.pais IS NULL OR p.pais = NEW.pais)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: la identificación fiscal ya pertenece a "%" (código %). Usa ese proveedor o corrige la identificación.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Sin identificación fiscal y sin código propio, el NOMBRE es lo único que hay: el mismo
  -- nombre escrito otra vez (otras mayúsculas, acentos, espacios o puntuación) no crea
  -- OTRO proveedor. La misma regla que la carga masiva. Solo al nacer, al cambiar el
  -- nombre o al quitar la identificación: un duplicado histórico no se bloquea.
  v_nombre_n := public.proveedor_normalizar_nombre(NEW.nombre);
  IF v_norm IS NULL AND v_nombre_n <> ''
     AND ((TG_OP = 'INSERT' AND NOT v_codigo_propio)
          OR (TG_OP = 'UPDATE'
              AND (NEW.nombre IS DISTINCT FROM OLD.nombre OR v_norm_old IS NOT NULL))) THEN

    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-nombre:' || NEW.company_id::text || ':' || v_nombre_n, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND public.proveedor_normalizar_nombre(p.nombre) = v_nombre_n
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: ya existe un proveedor con ese nombre ("%", código %). Los nombres no unen registros: usa ese proveedor, o agrega la identificación fiscal (o un código propio) para crear otro distinto.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
COMMIT;

-- ── 20261027000500_compras_orden_trazabilidad_posterior ───────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_oc_identidad ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_oc_modificacion ON public.ordenes_compra;
-- La restricción orden_compra_eventos_tipo_check se AMPLIÓ y se conserva: las filas ya escritas con los valores nuevos violarían la anterior.
-- (solo si NO hay filas con los valores nuevos:)  ALTER TABLE orden_compra_eventos DROP CONSTRAINT orden_compra_eventos_tipo_check, ADD CONSTRAINT orden_compra_eventos_tipo_check CHECK ((tipo = ANY (ARRAY['estado'::text, 'devolucion'::text, 'excepcion_contrato'::text])));
DROP FUNCTION IF EXISTS compras_tg_oc_identidad();
DROP FUNCTION IF EXISTS compras_tg_oc_modificacion();
COMMIT;

-- ── 20261027000400_compras_duplicados_proveedor_y_factura ─────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_factura_numero_equivalente ON public.facturas_proveedor;
DROP INDEX IF EXISTS public.idx_facturas_prov_numero_norm;
-- función reescrita: se restaura su definición anterior
CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm     text;
  v_norm_old text;
  v_dup      record;
BEGIN
  NEW.pais   := NULLIF(upper(btrim(NEW.pais)), '');
  NEW.codigo := NULLIF(btrim(NEW.codigo), '');

  IF TG_OP = 'INSERT' AND NEW.codigo IS NULL THEN
    NEW.codigo := public.proveedor_siguiente_codigo(NEW.company_id);
  END IF;

  -- La columna generada todavía no existe en un BEFORE: se calcula la misma
  -- expresión.
  v_norm := public.proveedor_normalizar_identificacion(
    COALESCE(NULLIF(btrim(NEW.nit), ''), NULLIF(btrim(NEW.rfc), '')));

  IF TG_OP = 'UPDATE' THEN
    v_norm_old := public.proveedor_normalizar_identificacion(
      COALESCE(NULLIF(btrim(OLD.nit), ''), NULLIF(btrim(OLD.rfc), '')));
  END IF;

  -- Solo cuando la IDENTIDAD cambia (o nace). Editar el teléfono de un
  -- proveedor que ya está duplicado de antes no puede quedar bloqueado: esos
  -- casos se resuelven con proveedores_duplicados_fiscales(), no aquí.
  IF v_norm IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR v_norm IS DISTINCT FROM v_norm_old
          OR NEW.pais IS DISTINCT FROM OLD.pais) THEN

    -- Candado consultivo: dos altas simultáneas del mismo NIT se serializan y
    -- la segunda ve a la primera.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('proveedor-identidad:' || NEW.company_id::text || ':' || v_norm, 0));

    SELECT p.id, p.nombre, p.codigo INTO v_dup
      FROM public.proveedores p
     WHERE p.company_id = NEW.company_id
       AND p.id <> NEW.id
       AND p.identificacion_norm = v_norm
       AND (p.pais IS NULL OR NEW.pais IS NULL OR p.pais = NEW.pais)
     LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'PROVEEDOR_DUPLICADO: la identificación fiscal ya pertenece a "%" (código %). Usa ese proveedor o corrige la identificación.',
        v_dup.nombre, COALESCE(v_dup.codigo, 's/código')
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
DROP FUNCTION IF EXISTS compras_normalizar_numero(text);
DROP FUNCTION IF EXISTS compras_tg_factura_numero_equivalente();
COMMIT;

-- ── 20261027000300_compras_permisos_y_estados_por_accion ──────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_permiso_contrasena ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_permiso_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_permiso_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_permiso_orden_pago ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_permiso_recepcion ON public.recepciones;
DROP FUNCTION IF EXISTS compras_exigir_accion(text,text);
DROP FUNCTION IF EXISTS compras_sesion_usuario();
DROP FUNCTION IF EXISTS compras_tg_permiso_contrasena();
DROP FUNCTION IF EXISTS compras_tg_permiso_factura();
DROP FUNCTION IF EXISTS compras_tg_permiso_orden();
DROP FUNCTION IF EXISTS compras_tg_permiso_orden_pago();
DROP FUNCTION IF EXISTS compras_tg_permiso_recepcion();
COMMIT;

-- ── 20261027000200_compras_documentos_sin_borrado ─────────────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_no_borrar_partida ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.ordenes_pago;
DROP TRIGGER IF EXISTS trg_compras_no_borrar ON public.recepciones;
DROP FUNCTION IF EXISTS compras_tg_no_borrar_documento();
DROP FUNCTION IF EXISTS compras_tg_no_borrar_partida();
COMMIT;

-- ── 20261027000100_compras_pagos_controles ────────────────────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_orden_pago_controles ON public.ordenes_pago;
DROP FUNCTION IF EXISTS compras_tg_orden_pago_controles();
COMMIT;

-- ── 20261027000000_compras_aislamiento_referencias ────────────────────────
BEGIN;
DROP TRIGGER IF EXISTS trg_compras_alcance_contrasena_factura ON public.contrasena_pago_facturas;
DROP TRIGGER IF EXISTS trg_compras_alcance_contrasena ON public.contrasenas_pago;
DROP TRIGGER IF EXISTS trg_compras_alcance_factura_linea ON public.factura_proveedor_lineas;
DROP TRIGGER IF EXISTS trg_compras_alcance_factura ON public.facturas_proveedor;
DROP TRIGGER IF EXISTS trg_compras_alcance_oc_linea ON public.orden_compra_lineas;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden ON public.ordenes_compra;
DROP TRIGGER IF EXISTS trg_compras_alcance_orden_pago ON public.ordenes_pago;
DROP FUNCTION IF EXISTS compras_alcance_verificar(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS compras_tg_alcance_contrasena_factura();
DROP FUNCTION IF EXISTS compras_tg_alcance_documento();
DROP FUNCTION IF EXISTS compras_tg_alcance_factura_linea();
DROP FUNCTION IF EXISTS compras_tg_alcance_oc_linea();
COMMIT;
