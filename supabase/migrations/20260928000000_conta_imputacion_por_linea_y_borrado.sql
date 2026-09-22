-- ============================================================================
-- IMPUTACIÓN POR LÍNEA, Y EL BORRADO QUE SE HABÍA PERDIDO
--
-- Corrige tres defectos de 20260927000000. Append-only: esa migración ya se
-- aplicó en la Preview, así que no se toca — se corrige desde acá.
--
-- 1 · EL BORRADO. `trg_conta_facturas_prov` está declarado
--     `AFTER UPDATE OF estado OR DELETE` desde 20260611010100, y la reescritura
--     del trigger perdió la rama `TG_OP = 'DELETE'`. El daño no es un error
--     ruidoso sino algo peor: en un DELETE, `NEW` es un registro nulo, así que
--     `NEW.estado = 'aprobada'` da NULL, `NULL AND FALSE` da FALSE, y la
--     función retorna sin hacer nada. El borrado se completa y el asiento
--     queda huérfano, sin reverso y sin que nadie se entere.
--
-- 2 · RESOLVER LO QUE EL ASIENTO NO USA. El gasto se resolvía ANTES de decidir
--     la ruta del asiento, y si no resolvía se abandonaba. Una factura GR/IR
--     íntegramente recibida, sin variación de precio y sin resto, NO lleva
--     ninguna línea de gasto: liquida el puente contra CxP con el IVA aparte.
--     Exigirle una cuenta de gasto configurada era exigir algo que no iba a
--     aparecer en el asiento, y dejaba sin contabilizar una factura correcta.
--     Ahora la ruta se decide primero, y el gasto se resuelve sólo si el
--     asiento lo necesita y por el importe que necesita.
--
-- 3 · UNA SOLA CUENTA PARA TODA LA FACTURA. La versión anterior reducía las
--     cuentas elegidas en las líneas a una: si había dos distintas las
--     descartaba a las dos, y si había una sola la estiraba sobre líneas que
--     no la habían elegido. Las dos formas contabilizan en una cuenta que
--     nadie eligió. Ahora cada línea resuelve la suya, por su importe.
--
-- Lo que NO cambia: sin reglas ni cuentas elegidas, la resolución devuelve
-- `mapeo_evento`, el trigger pasa `evento` —no `cuenta_id`— y el asiento sale
-- idéntico al de 20260821000300. La ruta GR/IR, la variación de precio y el
-- tratamiento del IVA conservan su lógica.
-- ============================================================================

-- ── 1. La bitácora distingue la línea ───────────────────────────────────────
-- Con imputación por línea, una factura produce VARIAS resoluciones. Sin esta
-- columna la bitácora las guardaría todas bajo el mismo documento y sin forma
-- de saber cuál explicó qué, que es tanto como no guardarlas.
ALTER TABLE public.conta_resoluciones
  ADD COLUMN IF NOT EXISTS origen_linea_id uuid;

COMMENT ON COLUMN public.conta_resoluciones.origen_linea_id IS
  'Línea del documento que esta resolución explica. NULL = la resolución es de la factura entera (el remanente no atribuible a ninguna línea).';

CREATE INDEX IF NOT EXISTS idx_conta_resoluciones_linea
  ON public.conta_resoluciones(origen_linea_id)
  WHERE origen_linea_id IS NOT NULL;

-- ── 2. El registrador, con línea y con motivo forzado ───────────────────────
-- La firma de 11 parámetros se ELIMINA en vez de quedar como sobrecarga: con
-- todos sus argumentos opcionales, cualquier llamada parcial sería ambigua
-- contra la de 13 («function ... is not unique»). Es la misma razón por la que
-- 20260927000000 eliminó la de 10.
DROP FUNCTION IF EXISTS public.conta_registrar_resolucion(
  text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid, uuid);

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
  p_company_id       uuid    DEFAULT NULL,
  p_origen_linea_id  uuid    DEFAULT NULL,
  p_motivo_forzado   text    DEFAULT NULL
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

  -- `p_motivo_forzado` deja registrar un «no se puede» que el resolutor no
  -- puede descubrir por sí mismo, porque no depende de la configuración sino
  -- de la forma del documento (por ejemplo: las líneas suman más de lo que el
  -- asiento tiene para imputar). Sin esto, el llamador tendría que escribir la
  -- bitácora por su cuenta y habría dos caminos de escritura en vez de uno.
  IF p_motivo_forzado IS NOT NULL THEN
    INSERT INTO public.conta_resoluciones
      (company_id, project_id, origen_tabla, origen_id, origen_linea_id, destino,
       evento, cuenta_id, origen_resolucion, regla_tabla, regla_id, motivo, resuelto_por)
    VALUES
      (v_company, p_project_id, p_origen_tabla, p_origen_id, p_origen_linea_id, p_destino,
       p_evento, NULL, 'sin_resolver', NULL, NULL, p_motivo_forzado, auth.uid())
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_id, NULL::uuid, 'sin_resolver'::text,
                        NULL::text, NULL::uuid, p_evento, p_motivo_forzado;
    RETURN;
  END IF;

  SELECT * INTO r FROM public.conta_resolver_imputacion_interno(
    v_company, p_project_id, p_destino, p_proveedor_id, p_cliente_id,
    p_unidad_id, p_categoria, p_evento, p_cuenta_explicita);

  INSERT INTO public.conta_resoluciones
    (company_id, project_id, origen_tabla, origen_id, origen_linea_id, destino, evento,
     cuenta_id, origen_resolucion, regla_tabla, regla_id, motivo, resuelto_por)
  VALUES
    (v_company, p_project_id, p_origen_tabla, p_origen_id, p_origen_linea_id, p_destino, r.evento_usado,
     r.cuenta_id, r.origen_resolucion, r.regla_tabla, r.regla_id, r.motivo, auth.uid())
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, r.cuenta_id, r.origen_resolucion,
                      r.regla_tabla, r.regla_id, r.evento_usado, r.motivo;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_registrar_resolucion(
  text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_registrar_resolucion(
  text, uuid, uuid, text, uuid, uuid, uuid, text, text, uuid, uuid, uuid, text) IS
  'Resuelve y registra en la bitácora, por documento o por línea. INTERNA: allowlist de orígenes, el documento debe existir y ser de la empresa/ledger declarados, y no es invocable por authenticated.';

-- ── 3. El trigger de facturas, con las tres correcciones ────────────────────
CREATE OR REPLACE FUNCTION public.conta_tg_facturas_prov()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_proveedor text;
  v_moneda    text;
  v_gasto     text;
  v_iva       numeric(14,2);
  v_neto      numeric(14,2);
  v_grni      numeric(14,2);
  v_var       jsonb;
  v_resto     numeric(14,2);
  v_lineas    jsonb := '[]'::jsonb;
  v_gr        boolean;
  v_iva_map   boolean;
  -- Lo que el asiento tiene que imputar a gasto, ya decidido por la ruta.
  v_base      numeric(14,2);
  -- Lo que suman las líneas que cargan gasto, y lo que queda sin atribuir.
  v_suma      numeric(14,2);
  v_remanente numeric(14,2);
  v_hay_expl  boolean;
  v_imputa    jsonb := '[]'::jsonb;
  v_falta     boolean := false;
  fl          record;
  r           record;
BEGIN
  -- ── El borrado reversa el devengo ────────────────────────────────────────
  -- Va PRIMERO y antes de tocar NEW: en un DELETE, NEW es un registro nulo.
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'facturas_proveedor', OLD.id,
      'factura_prov_aprobada', 'Factura de proveedor eliminada');
    RETURN OLD;
  END IF;

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

  v_iva_map := public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'iva_credito') IS NOT NULL;

  -- ── La RUTA se decide antes de resolver nada ─────────────────────────────
  v_gr := NEW.orden_compra_id IS NOT NULL
      AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'compras_por_facturar') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.factura_proveedor_lineas fl2
        JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
        WHERE fl2.factura_id = NEW.id AND ocl.cantidad_recibida > 0
      );

  IF v_gr THEN
    SELECT COALESCE(SUM(round(fl2.cantidad * ocl.precio_unitario, 2)), 0)
      INTO v_grni
      FROM public.factura_proveedor_lineas fl2
      JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
     WHERE fl2.factura_id = NEW.id AND ocl.cantidad_recibida > 0;

    -- La variación de precio sigue yendo por EVENTO y por categoría de la
    -- LÍNEA DE ORDEN, igual que en 20260821000300: el kardex y el registro de
    -- activos se valúan al precio de la ORDEN, y capitalizar acá la diferencia
    -- dejaría el mayor por encima del auxiliar sin nada que lo explique. Que
    -- ahora existan reglas no cambia ese motivo, así que no se le aplican.
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
             SUM(round(fl2.cantidad * (fl2.precio_unitario - ocl.precio_unitario), 2)) AS monto
        FROM public.factura_proveedor_lineas fl2
        JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
       WHERE fl2.factura_id = NEW.id AND ocl.cantidad_recibida > 0
       GROUP BY 1
      HAVING SUM(round(fl2.cantidad * (fl2.precio_unitario - ocl.precio_unitario), 2)) <> 0
    ) v;

    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'compras_por_facturar', 'debe', v_grni,
                         'descripcion', 'Liquidación de bienes/servicios recibidos'))
      || COALESCE(v_var, '[]'::jsonb);

    v_resto := round(v_neto - v_grni - COALESCE((
      SELECT SUM(round(fl2.cantidad * (fl2.precio_unitario - ocl.precio_unitario), 2))
        FROM public.factura_proveedor_lineas fl2
        JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
       WHERE fl2.factura_id = NEW.id AND ocl.cantidad_recibida > 0), 0), 2);

    IF v_iva > 0 AND v_iva_map THEN
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'));
    END IF;

    -- Lo que esta ruta imputa a gasto: los renglones que NO vinieron de una
    -- línea recibida, más el IVA cuando no hay dónde acreditarlo.
    v_base := v_resto + CASE WHEN v_iva > 0 AND NOT v_iva_map THEN v_iva ELSE 0 END;

  ELSIF v_iva > 0 AND v_iva < NEW.monto_total AND v_iva_map THEN
    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'));
    v_base := v_neto;

  ELSE
    -- Sin mapeo de IVA el impuesto se queda en el gasto, igual que siempre.
    v_base := NEW.monto_total;
  END IF;

  v_lineas := v_lineas || jsonb_build_array(
    jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total));

  -- ── Las líneas que cargan gasto ──────────────────────────────────────────
  -- En la ruta GR/IR, las recibidas ya se liquidaron contra el puente: las que
  -- cargan gasto son las demás. En las otras rutas, todas.
  SELECT COALESCE(SUM(round(l.cantidad * l.precio_unitario, 2)), 0),
         COALESCE(bool_or(l.cuenta_id IS NOT NULL), false)
    INTO v_suma, v_hay_expl
    FROM public.factura_proveedor_lineas l
    LEFT JOIN public.orden_compra_lineas ocl ON ocl.id = l.orden_compra_linea_id
   WHERE l.factura_id = NEW.id
     AND round(l.cantidad * l.precio_unitario, 2) <> 0
     AND NOT (v_gr AND ocl.id IS NOT NULL AND ocl.cantidad_recibida > 0);

  v_remanente := v_base - v_suma;

  IF v_base = 0 AND v_suma = 0 THEN
    -- El asiento no lleva gasto. No se resuelve nada: anotar una cuenta que no
    -- va a aparecer en el asiento sería afirmar en la bitácora algo que no
    -- ocurrió, y exigirla configurada dejaría sin contabilizar una factura
    -- correcta. Es el caso de la factura GR/IR íntegramente recibida.
    NULL;

  ELSIF v_suma = 0 OR v_base <= 0 THEN
    -- Sin líneas que atribuir (o con una base que no se reparte): una sola
    -- imputación para la factura entera, que es exactamente lo que hacía la
    -- versión anterior a las reglas.
    SELECT * INTO r FROM public.conta_registrar_resolucion(
      'facturas_proveedor', NEW.id, NEW.project_id, 'gasto',
      NEW.proveedor_id, NULL, NULL, NULL, v_gasto, NULL, NEW.company_id, NULL, NULL);
    IF r.cuenta_id IS NULL THEN
      v_falta := true;
    ELSE
      v_imputa := v_imputa || jsonb_build_array(
        (CASE WHEN r.origen_resolucion = 'mapeo_evento'
              THEN jsonb_build_object('evento', v_gasto)
              ELSE jsonb_build_object('cuenta_id', r.cuenta_id) END)
        || jsonb_build_object(CASE WHEN v_base > 0 THEN 'debe' ELSE 'haber' END, abs(v_base)));
    END IF;

  ELSIF v_remanente < 0 THEN
    -- Las líneas suman MÁS de lo que el asiento tiene para imputar. Repartir
    -- igual obligaría a recortar alguna, y recortar la cuenta que alguien
    -- eligió es contabilizar en otra sin decirlo. Queda pendiente.
    SELECT * INTO r FROM public.conta_registrar_resolucion(
      'facturas_proveedor', NEW.id, NEW.project_id, 'gasto',
      NEW.proveedor_id, NULL, NULL, NULL, v_gasto, NULL, NEW.company_id, NULL,
      'Las líneas de la factura suman más de lo que el asiento imputa a gasto: no se puede repartir sin alterar alguna cuenta elegida.');
    v_falta := true;

  ELSE
    -- ── Imputación POR LÍNEA ──────────────────────────────────────────────
    -- Cada línea resuelve la suya, con SU cuenta elegida y por SU importe.
    FOR fl IN
      SELECT l.id, l.cuenta_id, l.linea,
             round(l.cantidad * l.precio_unitario, 2) AS importe
        FROM public.factura_proveedor_lineas l
        LEFT JOIN public.orden_compra_lineas ocl ON ocl.id = l.orden_compra_linea_id
       WHERE l.factura_id = NEW.id
         AND round(l.cantidad * l.precio_unitario, 2) <> 0
         AND NOT (v_gr AND ocl.id IS NOT NULL AND ocl.cantidad_recibida > 0)
       ORDER BY l.linea
    LOOP
      SELECT * INTO r FROM public.conta_registrar_resolucion(
        'facturas_proveedor', NEW.id, NEW.project_id, 'gasto',
        NEW.proveedor_id, NULL, NULL, NULL, v_gasto, fl.cuenta_id, NEW.company_id,
        fl.id, NULL);

      IF r.cuenta_id IS NULL THEN
        -- Se siguen registrando las demás líneas: la bitácora tiene que poder
        -- decir CUÁL es la que falta, no sólo que falta alguna.
        v_falta := true;
      ELSE
        v_imputa := v_imputa || jsonb_build_array(
          (CASE WHEN r.origen_resolucion = 'mapeo_evento'
                THEN jsonb_build_object('evento', v_gasto)
                ELSE jsonb_build_object('cuenta_id', r.cuenta_id) END)
          || jsonb_build_object('debe', fl.importe)
          || jsonb_build_object('descripcion', 'Línea ' || fl.linea));
      END IF;
    END LOOP;

    -- Lo que no cae en ninguna línea —el IVA sin cuenta de crédito, cargos no
    -- desglosados— se imputa a nivel factura, como siempre.
    IF v_remanente <> 0 THEN
      SELECT * INTO r FROM public.conta_registrar_resolucion(
        'facturas_proveedor', NEW.id, NEW.project_id, 'gasto',
        NEW.proveedor_id, NULL, NULL, NULL, v_gasto, NULL, NEW.company_id, NULL, NULL);
      IF r.cuenta_id IS NULL THEN
        v_falta := true;
      ELSE
        v_imputa := v_imputa || jsonb_build_array(
          (CASE WHEN r.origen_resolucion = 'mapeo_evento'
                THEN jsonb_build_object('evento', v_gasto)
                ELSE jsonb_build_object('cuenta_id', r.cuenta_id) END)
          || jsonb_build_object('debe', v_remanente)
          || jsonb_build_object('descripcion', 'Cargos adicionales de la factura'));
      END IF;
    END IF;
  END IF;

  IF v_falta THEN
    -- Nada parcial: o el asiento entero o ninguno. La bitácora ya dice qué
    -- falta y en qué línea.
    RAISE WARNING 'conta_tg_facturas_prov: factura % sin imputación de gasto resuelta — asiento omitido', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM public.conta_generar_asiento(
    NEW.company_id, NEW.project_id, 'facturas_proveedor', NEW.id, 'factura_prov_aprobada',
    NEW.fecha_emision,
    'Factura proveedor ' || COALESCE(v_proveedor, '') ||
      COALESCE(' #' || NULLIF(NEW.numero_factura, ''), '') || ' — ' || NEW.concepto,
    'diario', v_moneda,
    v_imputa || v_lineas
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.conta_tg_facturas_prov() IS
  'Devengo de la factura de proveedor. Reversa al anular y al BORRAR. Decide la ruta (GR/IR o clásica) antes de resolver el gasto, y sólo lo resuelve si el asiento lo necesita. La imputación de gasto se reparte POR LÍNEA, respetando la cuenta elegida en cada una; lo no atribuible va a la resolución de la factura. Sin reglas ni cuentas elegidas, imputa por el evento como antes.';
