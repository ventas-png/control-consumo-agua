-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · DUPLICADOS: EL PROVEEDOR REESCRITO Y LA FACTURA CON OTRO FORMATO
--
-- QUÉ FALLABA (reproducido con INSERT directo, el camino de PostgREST y de los
-- formularios)
--   1. PROVEEDOR. La única defensa contra el proveedor reescrito era `UNIQUE (company_id,
--      nombre)` —sensible a mayúsculas, espacios y acentos— y la huella fiscal (NIT/RFC).
--      «Distribuidora Aguas del Norte», «DISTRIBUIDORA AGUAS DEL NORTE» y «Distribuidora
--      Aguas del Norte, S.A.» eran tres proveedores distintos si no se capturaba el NIT.
--      La carga masiva YA rechaza ese caso («Ya existe un proveedor con ese nombre … los
--      nombres no unen registros: para crear otro agrega su identificación fiscal»), pero
--      el alta manual (formulario o API) no aplicaba la misma regla.
--   2. FACTURA. Su número es único por (empresa, proveedor) como texto EXACTO: «FAC-001»,
--      «fac-001» y « FAC 001 » convivían como tres facturas del mismo proveedor, y las
--      tres se pueden aprobar, contabilizar y pagar.
--
-- QUÉ HACE
--   · Alta/edición de proveedor SIN identificación fiscal y SIN código explícito: se
--     rechaza si otro proveedor de la empresa tiene el mismo nombre NORMALIZADO
--     (minúsculas, sin acentos ni puntuación, espacios colapsados; la forma societaria
--     cuenta: «X» y «X S.A.» no se igualan). Es EXACTAMENTE la regla de la carga masiva:
--     un nombre no une registros, pero tampoco se crea otro proveedor igual sin que
--     alguien lo decida (código propio o identificación fiscal). Con candado consultivo:
--     dos altas simultáneas del mismo nombre → una sola.
--   · Factura: número equivalente (solo letras y dígitos, sin mayúsculas) del mismo
--     proveedor ya registrado y no anulado → se rechaza como COMPRAS_FACTURA_NUMERO_
--     DUPLICADO, por la misma vía que el duplicado exacto (la RPC `compras_factura_crear`
--     ya traduce ese error). Candado consultivo por (empresa, proveedor, número).
--
-- SOLO NACE O CAMBIA
--   Los dos controles se evalúan cuando la fila NACE o cambia lo que la identifica
--   (nombre / identificación del proveedor; número / proveedor de la factura). Un duplicado
--   histórico que ya exista NO bloquea sus cambios de estado ni sus ediciones ajenas; no se
--   fusiona nada. `scripts/diagnostico-compras-controles.sql` (solo lectura) lista los que
--   ya existan para que quien administra decida.
--
-- QUÉ NO HACE
--   No fusiona ni borra proveedores o facturas. No detecta la misma factura SIN número
--   (mismo proveedor, fecha y monto): eso se lista en el diagnóstico, no se bloquea,
--   porque dos compras iguales el mismo día pueden ser legítimas.
--
-- CÓMO REVERTIR (sin pérdida de datos)
--   DROP TRIGGER trg_compras_factura_numero_equivalente ON public.facturas_proveedor;
--   DROP FUNCTION public.compras_tg_factura_numero_equivalente();
--   DROP INDEX public.idx_facturas_prov_numero_norm;
--   DROP FUNCTION public.compras_normalizar_numero(text);
--   y restaurar `proveedores_tg_identidad()` con el cuerpo de 20261020000000 (el bloque
--   «nombre» de abajo es lo único que cambia).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Número de factura normalizado ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_normalizar_numero(p_numero text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog'
AS $$
  SELECT NULLIF(regexp_replace(upper(coalesce(p_numero, '')), '[^A-Z0-9]', '', 'g'), '')
$$;

COMMENT ON FUNCTION public.compras_normalizar_numero(text) IS
  'Número de factura sin mayúsculas, espacios ni puntuación (solo A-Z y 0-9); NULL si queda vacío. Para detectar el mismo número escrito con otro formato.';

REVOKE ALL ON FUNCTION public.compras_normalizar_numero(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_normalizar_numero(text) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_facturas_prov_numero_norm
  ON public.facturas_proveedor (company_id, proveedor_id, public.compras_normalizar_numero(numero_factura))
  WHERE numero_factura IS NOT NULL AND estado <> 'anulada';

CREATE OR REPLACE FUNCTION public.compras_tg_factura_numero_equivalente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

COMMENT ON FUNCTION public.compras_tg_factura_numero_equivalente() IS
  'Rechaza una factura cuyo número, ignorando mayúsculas, espacios y puntuación, ya existe (no anulada) para el mismo proveedor. Solo al nacer o al cambiar número/proveedor.';

DROP TRIGGER IF EXISTS trg_compras_factura_numero_equivalente ON public.facturas_proveedor;
CREATE TRIGGER trg_compras_factura_numero_equivalente
  BEFORE INSERT OR UPDATE OF numero_factura, proveedor_id ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_factura_numero_equivalente();

REVOKE ALL ON FUNCTION public.compras_tg_factura_numero_equivalente() FROM PUBLIC, anon, authenticated;

-- ── Proveedor: la identidad (cuerpo de 20261020000000 + la regla del nombre) ─
CREATE OR REPLACE FUNCTION public.proveedores_tg_identidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;
