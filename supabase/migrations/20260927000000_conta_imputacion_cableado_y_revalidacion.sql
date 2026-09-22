-- ============================================================================
-- IMPUTACIÓN: REVALIDACIÓN, ENDURECIMIENTO Y CABLEADO AL FLUJO REAL
--
-- 20260926000000 dejó el motor de reglas construido y probado, pero con tres
-- agujeros que una revisión encontró. Esta migración los cierra. Es
-- APPEND-ONLY: no toca ni una línea de las migraciones ya aplicadas.
--
-- ── 1. LA CUENTA DE UNA REGLA SE REVALIDA AL RESOLVER ───────────────────────
-- El trigger `conta_tg_regla_cuenta_valida` comprueba la cuenta cuando la
-- regla se ESCRIBE. Eso no alcanza, y el caso es trivial de producir: se crea
-- la regla con una cuenta buena y después alguien DESACTIVA esa cuenta desde
-- el catálogo. La regla queda apuntando a algo que ya no recibe movimientos y
-- el resolutor la devolvía igual.
--
-- Peor todavía sería lo contrario: saltarse la regla rota y caer al mapeo del
-- evento. Eso imputa a OTRA cuenta sin que nadie se entere de que la
-- configuración está rota — exactamente el fallo silencioso que todo este
-- diseño existe para evitar. Así que una regla inválida devuelve
-- `sin_resolver` con un motivo que la NOMBRA.
--
-- ── 2. LA BITÁCORA NO ACEPTA CUALQUIER COSA ─────────────────────────────────
-- `conta_registrar_resolucion` recibía `p_origen_tabla text` y `p_origen_id
-- uuid` y los escribía tal cual, con EXECUTE para `authenticated`. Cualquier
-- usuario podía ensuciar el registro contable con tablas inventadas, UUIDs
-- inexistentes o documentos de otra empresa. Ahora:
--   · es INTERNA: sin EXECUTE para authenticated, la llaman los triggers;
--   · allowlist explícita de tablas de origen;
--   · el documento tiene que EXISTIR y ser de la empresa y el ledger que se
--     declaran.
-- Las tres capas juntas, no una sola: revocar el EXECUTE cierra el camino de
-- hoy, y la validación cierra el de mañana, cuando alguien agregue un llamador.
--
-- ── 3. EL RESOLUTOR SE CABLEA AL FLUJO REAL ─────────────────────────────────
-- Hasta ahora `conta_resolver_imputacion` existía y nadie lo llamaba: aprobar
-- una factura seguía imputando por `'gasto_' || categoria` y las reglas que la
-- pantalla dejaba guardar no las consumía NADIE. `conta_tg_facturas_prov()` se
-- reescribe para resolver la cuenta de gasto y registrar la resolución en la
-- MISMA transacción que el asiento.
--
-- QUÉ SE CABLEA Y QUÉ NO, y el «no» es deliberado. Se cablea el destino
-- `gasto`, que es el único que una factura determina por sí sola. NO se
-- inventan `inventario` ni `activo_fijo`: en la ruta GR/IR esos destinos los
-- decide la RECEPCIÓN, no la factura, y adivinarlos desde `categoria` sería
-- exactamente la clase de suposición que este PR vino a eliminar. La ruta
-- GR/IR conserva íntegra su lógica de 20260821000300.
--
-- COMPORTAMIENTO SIN REGLAS: idéntico al de hoy. El resolutor cae al escalón 4
-- y devuelve la cuenta del mapeo del evento, que es la misma que
-- `conta_generar_asiento` habría resuelto sola.
--
-- CÓMO SE REVIERTE: restaurar las tres funciones a su versión previa —
-- `conta_resolver_imputacion` y `conta_registrar_resolucion` de
-- 20260926000000, `conta_tg_facturas_prov` de 20260821000300— y dropear
-- `conta_resolver_imputacion_interno` y `conta_origenes_resolucion`.
-- ============================================================================

-- ── 1. Catálogo declarado de orígenes válidos para la bitácora ──────────────
-- Allowlist, no validación por nombre libre. Agregar un origen nuevo es
-- agregar una fila acá, y eso se ve en el diff.
CREATE OR REPLACE FUNCTION public.conta_origenes_resolucion()
RETURNS TABLE (origen_tabla text, etiqueta text)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    ('facturas_proveedor',        'Factura de proveedor'),
    ('cargos_adicionales_unidad', 'Cargo adicional de unidad')
  ) AS t(origen_tabla, etiqueta)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_origenes_resolucion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_origenes_resolucion() TO authenticated;

COMMENT ON FUNCTION public.conta_origenes_resolucion() IS
  'Allowlist de tablas que pueden originar una fila de conta_resoluciones. Agregar un origen es agregar una fila acá.';

-- ── 2. El resolutor, ahora INTERNO y con revalidación ───────────────────────
-- Recibe la empresa como parámetro en vez de leerla de la sesión: los triggers
-- corren en la transacción del documento y el documento ya sabe de qué empresa
-- es. NO es ejecutable por authenticated; el camino público sigue siendo el
-- wrapper de abajo, que sí ancla a la sesión.
CREATE OR REPLACE FUNCTION public.conta_resolver_imputacion_interno(
  p_company_id       uuid,
  p_project_id       uuid,
  p_destino          text    DEFAULT NULL,
  p_proveedor_id     uuid    DEFAULT NULL,
  p_cliente_id       uuid    DEFAULT NULL,
  p_unidad_id        uuid    DEFAULT NULL,
  p_categoria        text    DEFAULT NULL,
  p_evento           text    DEFAULT NULL,
  p_cuenta_explicita uuid    DEFAULT NULL
)
RETURNS TABLE (
  cuenta_id         uuid,
  origen_resolucion text,
  regla_tabla       text,
  regla_id          uuid,
  evento_usado      text,
  motivo            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta uuid;
  v_regla  uuid;
  v_evento text;
  v_ok     boolean;
BEGIN
  -- Una cuenta SIRVE si es de este ledger, de detalle y activa. Es la misma
  -- condición que el trigger exige al escribir una regla; acá se vuelve a
  -- medir porque el mundo pudo cambiar desde entonces.
  --
  -- ── Escalón 1: la cuenta elegida a mano ─────────────────────────────────
  IF p_cuenta_explicita IS NOT NULL THEN
    SELECT (c.company_id = p_company_id
            AND c.project_id IS NOT DISTINCT FROM p_project_id
            AND c.es_detalle AND c.activa)
      INTO v_ok
      FROM public.conta_cuentas c
     WHERE c.id = p_cuenta_explicita;

    IF COALESCE(v_ok, false) THEN
      RETURN QUERY SELECT p_cuenta_explicita, 'linea_explicita'::text,
                          NULL::text, NULL::uuid, NULL::text, NULL::text;
      RETURN;
    END IF;

    RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::text, NULL::uuid, NULL::text,
      'La cuenta elegida en el documento no sirve para esta contabilidad: tiene que ser de este ledger, de detalle y activa.'::text;
    RETURN;
  END IF;

  -- ── Escalón 2: regla del proveedor ──────────────────────────────────────
  IF p_proveedor_id IS NOT NULL AND p_destino IS NOT NULL THEN
    SELECT r.cuenta_id, r.id INTO v_cuenta, v_regla
      FROM public.conta_reglas_proveedor r
     WHERE r.company_id = p_company_id
       AND r.project_id IS NOT DISTINCT FROM p_project_id
       AND r.proveedor_id = p_proveedor_id
       AND r.destino = p_destino
       AND r.activa
     LIMIT 1;

    IF v_cuenta IS NOT NULL THEN
      SELECT (c.company_id = p_company_id
              AND c.project_id IS NOT DISTINCT FROM p_project_id
              AND c.es_detalle AND c.activa)
        INTO v_ok
        FROM public.conta_cuentas c
       WHERE c.id = v_cuenta;

      IF COALESCE(v_ok, false) THEN
        RETURN QUERY SELECT v_cuenta, 'regla_proveedor'::text,
                            'conta_reglas_proveedor'::text, v_regla, NULL::text, NULL::text;
        RETURN;
      END IF;

      -- La regla EXISTE pero su cuenta ya no sirve. Se corta acá a propósito:
      -- seguir al escalón siguiente imputaría a otra cuenta y nadie se
      -- enteraría de que la regla configurada está rota.
      RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text,
                          'conta_reglas_proveedor'::text, v_regla, NULL::text,
        'La regla del proveedor apunta a una cuenta que ya no sirve: fue desactivada, pasó a agrupadora o dejó de ser de esta contabilidad. Corrige la regla.'::text;
      RETURN;
    END IF;
  END IF;

  -- ── Escalón 3: regla de cliente/unidad y tipo de cargo ──────────────────
  IF p_cliente_id IS NOT NULL OR p_unidad_id IS NOT NULL OR p_categoria IS NOT NULL THEN
    SELECT r.cuenta_id, r.id INTO v_cuenta, v_regla
      FROM public.conta_reglas_cargo r
     WHERE r.company_id = p_company_id
       AND r.project_id IS NOT DISTINCT FROM p_project_id
       AND r.activa
       AND (r.unidad_id  IS NULL OR r.unidad_id  = p_unidad_id)
       AND (r.cliente_id IS NULL OR r.cliente_id = p_cliente_id)
       AND (r.categoria  IS NULL OR r.categoria  = p_categoria)
     ORDER BY r.especificidad DESC, r.id
     LIMIT 1;

    IF v_cuenta IS NOT NULL THEN
      SELECT (c.company_id = p_company_id
              AND c.project_id IS NOT DISTINCT FROM p_project_id
              AND c.es_detalle AND c.activa)
        INTO v_ok
        FROM public.conta_cuentas c
       WHERE c.id = v_cuenta;

      IF COALESCE(v_ok, false) THEN
        RETURN QUERY SELECT v_cuenta, 'regla_cargo'::text,
                            'conta_reglas_cargo'::text, v_regla, NULL::text, NULL::text;
        RETURN;
      END IF;

      RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text,
                          'conta_reglas_cargo'::text, v_regla, NULL::text,
        'La regla de cliente/unidad apunta a una cuenta que ya no sirve: fue desactivada, pasó a agrupadora o dejó de ser de esta contabilidad. Corrige la regla.'::text;
      RETURN;
    END IF;
  END IF;

  -- ── Escalón 4: mapeo general del evento ─────────────────────────────────
  v_evento := COALESCE(
    p_evento,
    (SELECT d.evento_fallback FROM public.conta_destinos_imputacion() d
      WHERE d.destino = p_destino));

  IF v_evento IS NOT NULL THEN
    v_cuenta := public.conta_cuenta_para(p_company_id, p_project_id, v_evento);

    -- El mapeo también se revalida: `conta_mapeo_cuentas` tiene su propio
    -- trigger de ledger, pero nada impide desactivar la cuenta después.
    IF v_cuenta IS NOT NULL THEN
      SELECT (c.es_detalle AND c.activa) INTO v_ok
        FROM public.conta_cuentas c WHERE c.id = v_cuenta;

      IF COALESCE(v_ok, false) THEN
        RETURN QUERY SELECT v_cuenta, 'mapeo_evento'::text,
                            NULL::text, NULL::uuid, v_evento, NULL::text;
        RETURN;
      END IF;

      RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::text, NULL::uuid, v_evento,
        format('El evento «%s» está mapeado a una cuenta que ya no sirve: fue desactivada o pasó a agrupadora. Corrige el mapeo.', v_evento)::text;
      RETURN;
    END IF;
  END IF;

  -- ── Escalón 5: no se inventa nada ───────────────────────────────────────
  RETURN QUERY SELECT NULL::uuid, 'sin_resolver'::text, NULL::text, NULL::uuid, v_evento,
    CASE
      WHEN v_evento IS NULL THEN
        'No hay regla aplicable y el destino no tiene evento contable asociado. Configura una regla o elige la cuenta en el documento.'
      ELSE
        format('No hay regla aplicable y el evento «%s» no está mapeado en esta contabilidad. Configura el mapeo o una regla.', v_evento)
    END::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_resolver_imputacion_interno(uuid, uuid, text, uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_resolver_imputacion_interno(uuid, uuid, text, uuid, uuid, uuid, text, text, uuid) IS
  'Motor de resolución. INTERNO: recibe la empresa como parámetro y no es invocable por authenticated. Revalida la cuenta de cada regla antes de devolverla.';

-- ── 3. El wrapper público, anclado a la sesión ──────────────────────────────
-- Misma firma y mismo contrato que en 20260926000000: la UI no cambia.
CREATE OR REPLACE FUNCTION public.conta_resolver_imputacion(
  p_project_id       uuid,
  p_destino          text    DEFAULT NULL,
  p_proveedor_id     uuid    DEFAULT NULL,
  p_cliente_id       uuid    DEFAULT NULL,
  p_unidad_id        uuid    DEFAULT NULL,
  p_categoria        text    DEFAULT NULL,
  p_evento           text    DEFAULT NULL,
  p_cuenta_explicita uuid    DEFAULT NULL
)
RETURNS TABLE (
  cuenta_id         uuid,
  origen_resolucion text,
  regla_tabla       text,
  regla_id          uuid,
  evento_usado      text,
  motivo            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
BEGIN
  v_company := public.get_my_company_id();

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.'
      USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_project_id AND company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT * FROM public.conta_resolver_imputacion_interno(
    v_company, p_project_id, p_destino, p_proveedor_id, p_cliente_id,
    p_unidad_id, p_categoria, p_evento, p_cuenta_explicita);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_resolver_imputacion(uuid, text, uuid, uuid, uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_resolver_imputacion(uuid, text, uuid, uuid, uuid, text, text, uuid)
  TO authenticated;

-- ── 4. El registrador, endurecido e interno ─────────────────────────────────
-- La firma de 10 parámetros de 20260926000000 se ELIMINA en lugar de quedar
-- como sobrecarga: con todos sus argumentos opcionales, cualquier llamada
-- parcial sería ambigua contra la de 11 («function ... is not unique»), y el
-- camino viejo —sin allowlist ni verificación del documento— es justamente el
-- que este cambio cierra. Sólo se puede porque 20260926000000 es de esta misma
-- PR y no está en producción; no se edita esa migración, se la corrige acá.
DROP FUNCTION IF EXISTS public.conta_registrar_resolucion(
  text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.conta_registrar_resolucion(
  p_origen_tabla     text,
  p_origen_id        uuid,
  p_project_id       uuid,
  p_destino          text    DEFAULT NULL,
  p_proveedor_id     uuid    DEFAULT NULL,
  p_cliente_id       uuid    DEFAULT NULL,
  p_unidad_id        uuid    DEFAULT NULL,
  p_categoria        text    DEFAULT NULL,
  p_evento           text    DEFAULT NULL,
  p_cuenta_explicita uuid    DEFAULT NULL,
  p_company_id       uuid    DEFAULT NULL
)
RETURNS TABLE (
  resolucion_id     uuid,
  cuenta_id         uuid,
  origen_resolucion text,
  regla_tabla       text,
  regla_id          uuid,
  evento_usado      text,
  motivo            text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_existe  boolean;
  r         record;
  v_id      uuid;
BEGIN
  -- La empresa llega del llamador (trigger, que la toma del documento) o de la
  -- sesión. Nunca de `p_origen_id`: es lo que permitiría escribir bajo otra.
  v_company := COALESCE(p_company_id, public.get_my_company_id());

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: no se pudo determinar la empresa.'
      USING ERRCODE = '42501';
  END IF;

  -- Allowlist. Un origen que no está declarado no entra, por más que el
  -- llamador insista.
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_origenes_resolucion() o
     WHERE o.origen_tabla = p_origen_tabla
  ) THEN
    RAISE EXCEPTION 'ORIGEN_NO_PERMITIDO: «%» no es una tabla de origen declarada.', p_origen_tabla
      USING ERRCODE = '22023';
  END IF;

  IF p_origen_id IS NULL THEN
    RAISE EXCEPTION 'ORIGEN_INEXISTENTE: se requiere el id del documento.'
      USING ERRCODE = '22023';
  END IF;

  -- El documento tiene que EXISTIR y ser de esta empresa y este ledger. Sin
  -- esto, la bitácora podía afirmar que se imputó un documento que no existe,
  -- o uno de otra empresa.
  IF p_origen_tabla = 'facturas_proveedor' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.facturas_proveedor f
       WHERE f.id = p_origen_id AND f.company_id = v_company
         AND f.project_id IS NOT DISTINCT FROM p_project_id
    ) INTO v_existe;
    IF NOT v_existe THEN
      IF EXISTS (SELECT 1 FROM public.facturas_proveedor WHERE id = p_origen_id) THEN
        RAISE EXCEPTION 'ORIGEN_AJENO: el documento no pertenece a la empresa/contabilidad declarada.'
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'ORIGEN_INEXISTENTE: no existe el documento % en %.', p_origen_id, p_origen_tabla
        USING ERRCODE = '22023';
    END IF;

  ELSIF p_origen_tabla = 'cargos_adicionales_unidad' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cargos_adicionales_unidad c
       WHERE c.id = p_origen_id AND c.company_id = v_company
         AND c.project_id IS NOT DISTINCT FROM p_project_id
    ) INTO v_existe;
    IF NOT v_existe THEN
      IF EXISTS (SELECT 1 FROM public.cargos_adicionales_unidad WHERE id = p_origen_id) THEN
        RAISE EXCEPTION 'ORIGEN_AJENO: el documento no pertenece a la empresa/contabilidad declarada.'
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'ORIGEN_INEXISTENTE: no existe el documento % en %.', p_origen_id, p_origen_tabla
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO r FROM public.conta_resolver_imputacion_interno(
    v_company, p_project_id, p_destino, p_proveedor_id, p_cliente_id,
    p_unidad_id, p_categoria, p_evento, p_cuenta_explicita);

  INSERT INTO public.conta_resoluciones
    (company_id, project_id, origen_tabla, origen_id, destino, evento,
     cuenta_id, origen_resolucion, regla_tabla, regla_id, motivo, resuelto_por)
  VALUES
    (v_company, p_project_id, p_origen_tabla, p_origen_id, p_destino, r.evento_usado,
     r.cuenta_id, r.origen_resolucion, r.regla_tabla, r.regla_id, r.motivo, auth.uid())
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, r.cuenta_id, r.origen_resolucion,
                      r.regla_tabla, r.regla_id, r.evento_usado, r.motivo;
END;
$$;

-- INTERNA: la llaman los triggers. `authenticated` NO la invoca a mano — para
-- previsualizar está `conta_resolver_imputacion`, que no escribe nada.
REVOKE EXECUTE ON FUNCTION public.conta_registrar_resolucion(text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_registrar_resolucion(text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid, uuid) IS
  'Resuelve y registra en la bitácora. INTERNA: allowlist de orígenes, el documento debe existir y ser de la empresa/ledger declarados, y no es invocable por authenticated.';

-- ── 5. El cableado: la factura de proveedor usa la cuenta resuelta ──────────
-- Se conserva ÍNTEGRA la lógica de 20260821000300 —ruta GR/IR, variación de
-- precio, IVA, resto— y sólo cambia de dónde sale la cuenta de GASTO: antes
-- era siempre el evento `'gasto_' || categoria`; ahora es lo que resuelve el
-- motor, que sin reglas devuelve ESE MISMO evento.
CREATE OR REPLACE FUNCTION public.conta_tg_facturas_prov()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_proveedor text;
  v_moneda    text;
  v_gasto     text;
  v_iva       numeric;
  v_neto      numeric;
  v_grni      numeric;
  v_var       jsonb;
  v_resto     numeric;
  v_lineas    jsonb;
  v_cuenta_expl uuid;
  v_n_expl    int;
  r           record;
  -- La línea de gasto, ya resuelta: o `cuenta_id` o `evento`. Es lo único que
  -- este cableado cambia respecto de la versión anterior.
  v_gasto_ref jsonb;
BEGIN
  IF NEW.estado = 'anulada' AND OLD.estado IN ('aprobada','pagada_parcial','pagada') THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'facturas_proveedor', NEW.id,
      'factura_prov_aprobada', 'Factura de proveedor anulada');
    RETURN NEW;
  END IF;

  IF NOT (NEW.estado = 'aprobada' AND OLD.estado = 'registrada') THEN
    RETURN NEW;
  END IF;

  v_gasto := CASE WHEN NEW.categoria IN ('mantenimiento','servicios','administrativo',
                                         'seguridad','limpieza','obras')
                  THEN 'gasto_' || NEW.categoria ELSE 'gasto_otros' END;
  SELECT nombre INTO v_proveedor FROM public.proveedores WHERE id = NEW.proveedor_id;
  v_moneda := COALESCE(NEW.moneda,
    (SELECT COALESCE(moneda_condominios, moneda) FROM public.projects WHERE id = NEW.project_id));
  v_iva  := COALESCE(NEW.iva_monto, 0);
  v_neto := NEW.monto_total - v_iva;

  -- ── La cuenta explícita de la factura, si la hay y es INEQUÍVOCA ─────────
  -- Una sola cuenta distinta entre las líneas es una elección clara. Dos o más
  -- no lo son, y adivinar cuál manda sería inventar: en ese caso se ignora el
  -- escalón 1 y decide la regla, como si nadie hubiera elegido.
  -- `min()` no existe para uuid, de ahí el rodeo por texto: sólo se usa para
  -- sacar el ÚNICO valor cuando la cuenta distinta es una sola, así que qué
  -- elemento devuelva el agregado es indistinto.
  SELECT count(DISTINCT fl.cuenta_id), min(fl.cuenta_id::text)::uuid
    INTO v_n_expl, v_cuenta_expl
    FROM public.factura_proveedor_lineas fl
   WHERE fl.factura_id = NEW.id AND fl.cuenta_id IS NOT NULL;
  IF COALESCE(v_n_expl, 0) <> 1 THEN
    v_cuenta_expl := NULL;
  END IF;

  -- ── Resolución + bitácora, en ESTA transacción ───────────────────────────
  -- El destino es `gasto` y nada más: es el único que una factura determina
  -- por sí sola. Inventario y activo fijo los decide la recepción, no acá.
  SELECT * INTO r FROM public.conta_registrar_resolucion(
    'facturas_proveedor', NEW.id, NEW.project_id, 'gasto',
    NEW.proveedor_id, NULL, NULL, NULL, v_gasto, v_cuenta_expl, NEW.company_id);

  IF r.cuenta_id IS NULL THEN
    -- Sin cuenta NO se asienta. Es el mismo desenlace que tenía la versión
    -- anterior cuando faltaba el mapeo (conta_generar_asiento omitía con
    -- WARNING), pero ahora queda dicho POR QUÉ, en la bitácora.
    RAISE WARNING 'conta_tg_facturas_prov: factura % sin cuenta de gasto resuelta (%) — asiento omitido',
      NEW.id, r.motivo;
    RETURN NEW;
  END IF;

  v_gasto_ref := CASE
    WHEN r.origen_resolucion = 'mapeo_evento' THEN jsonb_build_object('evento', v_gasto)
    ELSE jsonb_build_object('cuenta_id', r.cuenta_id)
  END;

  IF NEW.orden_compra_id IS NOT NULL
     AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'compras_por_facturar') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.factura_proveedor_lineas fl
       JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
       WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0
     ) THEN

    SELECT COALESCE(SUM(round(fl.cantidad * ocl.precio_unitario, 2)), 0)
      INTO v_grni
    FROM public.factura_proveedor_lineas fl
    JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
    WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0;

    -- La variación de precio sigue yendo por EVENTO y por categoría de la
    -- LÍNEA DE ORDEN, igual que en 20260821000300. No se le aplica la regla
    -- del proveedor: el motivo original —mantener mayor y auxiliar cuadrados
    -- valuando al precio de la orden— no cambia porque ahora haya reglas.
    SELECT jsonb_agg(CASE WHEN monto >= 0
                          THEN jsonb_build_object('evento', evento, 'debe', monto,
                                                  'descripcion', 'Variación de precio de compra')
                          ELSE jsonb_build_object('evento', evento, 'haber', -monto,
                                                  'descripcion', 'Variación de precio de compra') END)
      INTO v_var
    FROM (
      SELECT CASE WHEN COALESCE(ocl.categoria, 'otros') IN
                       ('mantenimiento','servicios','administrativo','seguridad','limpieza','obras')
                  THEN 'gasto_' || ocl.categoria ELSE 'gasto_otros' END AS evento,
             SUM(round(fl.cantidad * (fl.precio_unitario - ocl.precio_unitario), 2)) AS monto
      FROM public.factura_proveedor_lineas fl
      JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
      WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0
      GROUP BY 1
      HAVING SUM(round(fl.cantidad * (fl.precio_unitario - ocl.precio_unitario), 2)) <> 0
    ) v;

    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'compras_por_facturar', 'debe', v_grni,
                         'descripcion', 'Liquidación de bienes/servicios recibidos'))
      || COALESCE(v_var, '[]'::jsonb);

    v_resto := round(v_neto - v_grni - COALESCE((
      SELECT SUM(round(fl.cantidad * (fl.precio_unitario - ocl.precio_unitario), 2))
      FROM public.factura_proveedor_lineas fl
      JOIN public.orden_compra_lineas ocl ON ocl.id = fl.orden_compra_linea_id
      WHERE fl.factura_id = NEW.id AND ocl.cantidad_recibida > 0), 0), 2);
    IF v_resto <> 0 THEN
      v_lineas := v_lineas || jsonb_build_array(
        v_gasto_ref
        || jsonb_build_object(CASE WHEN v_resto > 0 THEN 'debe' ELSE 'haber' END, abs(v_resto))
        || jsonb_build_object('descripcion', 'Cargos adicionales de la factura'));
    END IF;

    IF v_iva > 0 AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'iva_credito') IS NOT NULL THEN
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'));
    ELSIF v_iva > 0 THEN
      v_lineas := v_lineas || jsonb_build_array(
        v_gasto_ref || jsonb_build_object('debe', v_iva));
    END IF;

    v_lineas := v_lineas || jsonb_build_array(
      jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total));

  ELSIF v_iva > 0 AND v_iva < NEW.monto_total
        AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'iva_credito') IS NOT NULL THEN
    v_lineas := jsonb_build_array(
      v_gasto_ref || jsonb_build_object('debe', v_neto),
      jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'),
      jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total)
    );
  ELSE
    v_lineas := jsonb_build_array(
      v_gasto_ref || jsonb_build_object('debe', NEW.monto_total),
      jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total)
    );
  END IF;

  PERFORM public.conta_generar_asiento(
    NEW.company_id, NEW.project_id, 'facturas_proveedor', NEW.id, 'factura_prov_aprobada',
    NEW.fecha_emision,
    'Factura proveedor ' || COALESCE(v_proveedor, '') ||
      COALESCE(' #' || NULLIF(NEW.numero_factura, ''), '') || ' — ' || NEW.concepto,
    'diario', v_moneda,
    v_lineas
  );

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_facturas_prov() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_tg_facturas_prov() IS
  'Devengo de la factura de proveedor. La cuenta de gasto sale de conta_resolver_imputacion (destino `gasto`) y la resolución queda en conta_resoluciones, en la misma transacción. Ruta GR/IR intacta: inventario y activo fijo los decide la recepción, no la factura.';
