-- ============================================================================
-- PENDIENTES DE CONTABILIZACIÓN Y REPROCESO SEGURO DE FACTURAS DE PROVEEDOR
--
-- Una factura puede quedar APROBADA SIN ASIENTO: 20260928000000 deja el
-- documento aprobado y omite el asiento cuando falta una cuenta o un mapeo
-- («nada parcial, nada inventado»). Eso es correcto, pero dejaba al usuario
-- sin forma de encontrar esas facturas ni de contabilizarlas después de
-- corregir la configuración. Esta migración añade las dos cosas, y nada más:
--
-- 1 · UNA BITÁCORA DE INTENTOS (`conta_intentos_contabilizacion`).
--     `conta_resoluciones` dice qué CUENTA se resolvió; no dice si el ASIENTO
--     se generó. Son cosas distintas: la cuenta de gasto puede resolverse y el
--     asiento omitirse igual porque falta el mapeo de CxP. Cada intento —la
--     aprobación y cada reproceso— deja una fila con actor, fecha, documento,
--     resultado, motivo tipificado y el asiento cuando lo hubo. Es de sólo
--     inserción: nada la borra para «quitar» un pendiente.
--
-- 2 · UNA SOLA LÓGICA DE CONTABILIZACIÓN.
--     El cuerpo de la rama de aprobación de `conta_tg_facturas_prov()` (el de
--     20260928000000, con la prioridad por línea, GR/IR, IVA, moneda y
--     redondeo) se MUEVE sin cambios de reglas a
--     `conta_contabilizar_factura_prov_interno(factura, disparo)`. El trigger y
--     el reproceso llaman a esa misma función: no hay dos implementaciones que
--     puedan divergir. Lo único que se AÑADE a esa lógica es el diagnóstico
--     previo a `conta_generar_asiento`, que antes callaba (RAISE WARNING y
--     NULL): catálogo vacío, evento sin mapeo o cuenta inactiva/agrupadora/de
--     otro ledger se detectan ANTES y se registran con su motivo.
--
--     Cambio de comportamiento deliberado y único: un evento mapeado a una
--     cuenta INACTIVA o agrupadora (por ejemplo CxP) ya no genera un asiento
--     publicado contra esa cuenta; queda pendiente con motivo `cuenta_invalida`.
--     `conta_generar_asiento` sólo comprobaba `es_detalle` en las cuentas
--     directas y nada en las mapeadas, mientras que `conta_publicar_asiento`
--     rechaza ambas cosas: el asiento automático era el único camino que las
--     dejaba pasar.
--
-- 3 · EL REPROCESO (`conta_reprocesar_factura_proveedor(p_factura_id)`).
--     Recibe SÓLO el id. Empresa, proyecto y estado salen de la fila, que se
--     BLOQUEA (`FOR UPDATE`) antes de mirar nada: dos reprocesos simultáneos,
--     o un reproceso y una anulación/borrado, se serializan en la base. El
--     segundo reproceso ve el asiento del primero y responde «ya
--     contabilizada». Detrás queda el índice único `uq_conta_asiento_origen`
--     (un evento de un documento = un asiento vivo), que es la segunda red.
--     No toca la factura: ni estado, ni fechas, ni saldos, ni pagos. Con el
--     período del documento cerrado NO re-fecha (la aprobación sí lo hace, y
--     eso no cambia): bloquea y lo dice.
--
-- 4 · LA BANDEJA (`conta_facturas_pendientes`). Filtro y paginación en
--     servidor, acotada a la contabilidad elegida, a la empresa de la sesión
--     y a los proyectos del usuario. «Pendiente» NO es «tiene filas
--     sin_resolver»: es una factura aprobada (aprobada/pagada_parcial/pagada)
--     SIN NINGÚN asiento automático de devengo, y con al menos un intento
--     registrado. Un intento fallido antiguo seguido de un éxito deja de
--     figurar porque el asiento existe; una anulada o borrada no figura porque
--     no está aprobada (o no existe); una con el asiento reversado tampoco,
--     porque el reproceso nunca la «resucitaría».
--
-- Permisos. Ver la bandeja exige `platform.contabilidad.view` (o rol de
-- empresa). Reprocesar exige `create` Y `change_status`: genera un asiento y
-- lo publica, que es lo que `conta_publicar_asiento` pide por separado. Las
-- funciones internas (`conta_registrar_resolucion`, `conta_generar_asiento`,
-- el contabilizador y el registrador de intentos) siguen sin EXECUTE para
-- authenticated.
--
-- CÓMO SE REVIERTE: restaurar `conta_tg_facturas_prov()` de
-- 20260928000000 (su cuerpo es exactamente el del contabilizador interno más
-- las ramas de borrado/anulación), y dropear
-- `conta_facturas_pendientes`, `conta_reprocesar_factura_proveedor`,
-- `conta_contabilizar_factura_prov_interno`, `conta_registrar_intento`,
-- `conta_clasificar_resolucion` y la tabla `conta_intentos_contabilizacion`
-- (su contenido es historial, no afecta saldos).
-- ============================================================================

-- ── 1. Bitácora de intentos ─────────────────────────────────────────────────
-- `origen_id` NO lleva FK a propósito: el historial de una factura borrada se
-- conserva. `asiento_id` sí: si se borra un borrador, la fila queda con NULL.
CREATE TABLE public.conta_intentos_contabilizacion (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  origen_tabla     text        NOT NULL,
  origen_id        uuid        NOT NULL,
  disparo          text        NOT NULL,
  resultado        text        NOT NULL,
  codigo           text,
  motivo           text,
  origen_linea_id  uuid,
  detalle          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  asiento_id       uuid        REFERENCES public.conta_asientos(id) ON DELETE SET NULL,
  actor            uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Por ahora sólo facturas de proveedor: ampliar el alcance es ampliar esta
  -- lista, y eso se ve en el diff.
  CONSTRAINT conta_intentos_origen_valido
    CHECK (origen_tabla IN ('facturas_proveedor')),
  CONSTRAINT conta_intentos_disparo_valido
    CHECK (disparo IN ('aprobacion','reproceso')),
  CONSTRAINT conta_intentos_resultado_valido
    CHECK (resultado IN ('contabilizada','ya_contabilizada','pendiente','bloqueada')),
  CONSTRAINT conta_intentos_codigo_valido
    CHECK (codigo IS NULL OR codigo IN (
      'sin_cuenta','cuenta_invalida','configuracion_incompleta','reparto_lineas',
      'periodo_cerrado','documento_anulado','documento_no_aprobado',
      'asiento_reversado','error')),
  -- Un éxito nombra su asiento; un fallo nombra su motivo. Nunca a medias.
  CONSTRAINT conta_intentos_coherente
    CHECK (
      (resultado = 'contabilizada' AND codigo IS NULL)
      OR (resultado = 'ya_contabilizada' AND codigo IS NULL)
      OR (resultado IN ('pendiente','bloqueada') AND codigo IS NOT NULL AND motivo IS NOT NULL)
    )
);

CREATE INDEX idx_conta_intentos_origen
  ON public.conta_intentos_contabilizacion(origen_tabla, origen_id, created_at DESC);

CREATE INDEX idx_conta_intentos_ledger
  ON public.conta_intentos_contabilizacion(company_id, project_id, created_at DESC);

CREATE INDEX idx_conta_intentos_asiento
  ON public.conta_intentos_contabilizacion(asiento_id) WHERE asiento_id IS NOT NULL;

CREATE INDEX idx_conta_intentos_actor
  ON public.conta_intentos_contabilizacion(actor) WHERE actor IS NOT NULL;

COMMENT ON TABLE public.conta_intentos_contabilizacion IS
  'Bitácora de intentos de contabilización (aprobación y reprocesos): actor, fecha, documento, resultado, motivo tipificado y asiento. Sólo inserción, la escriben funciones internas. Distinta de conta_resoluciones: resolver la cuenta no implica que exista asiento.';

ALTER TABLE public.conta_intentos_contabilizacion ENABLE ROW LEVEL SECURITY;

-- Lectura: la empresa de la sesión Y los proyectos del usuario. Más estrecha
-- que conta_resoluciones a propósito: la bandeja no debe mostrar a un usuario
-- asignado a un proyecto los intentos de otro.
DROP POLICY IF EXISTS "conta_intentos_contabilizacion_select" ON public.conta_intentos_contabilizacion;
CREATE POLICY "conta_intentos_contabilizacion_select" ON public.conta_intentos_contabilizacion
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND public.can_access_project(project_id))
  );

REVOKE ALL ON public.conta_intentos_contabilizacion FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_intentos_contabilizacion TO authenticated;
GRANT SELECT ON public.conta_intentos_contabilizacion TO service_role;

-- ── 2. Registrador de intentos (INTERNO) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_registrar_intento(
  p_company_id      uuid,
  p_project_id      uuid,
  p_origen_id       uuid,
  p_disparo         text,
  p_resultado       text,
  p_codigo          text  DEFAULT NULL,
  p_motivo          text  DEFAULT NULL,
  p_origen_linea_id uuid  DEFAULT NULL,
  p_detalle         jsonb DEFAULT '[]'::jsonb,
  p_asiento_id      uuid  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.conta_intentos_contabilizacion
    (company_id, project_id, origen_tabla, origen_id, disparo, resultado,
     codigo, motivo, origen_linea_id, detalle, asiento_id, actor)
  VALUES
    (p_company_id, p_project_id, 'facturas_proveedor', p_origen_id, p_disparo, p_resultado,
     p_codigo, p_motivo, p_origen_linea_id, COALESCE(p_detalle, '[]'::jsonb), p_asiento_id,
     auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_registrar_intento(
  uuid, uuid, uuid, text, text, text, text, uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_registrar_intento(uuid, uuid, uuid, text, text, text, text, uuid, jsonb, uuid) IS
  'INTERNA. Inserta una fila en conta_intentos_contabilizacion con auth.uid() como actor. Sin EXECUTE para authenticated.';

-- ── 3. Clasificación de una resolución fallida (INTERNO) ────────────────────
-- El resolutor devuelve texto libre en `motivo`; la bandeja necesita un
-- código. Se deriva de la ESTRUCTURA de la respuesta, no del texto:
--   · hubo cuenta elegida en la línea, o una regla, o el evento SÍ está
--     mapeado → la cuenta existe pero no sirve → `cuenta_invalida`;
--   · si no → no hay nada configurado → `sin_cuenta`.
CREATE OR REPLACE FUNCTION public.conta_clasificar_resolucion(
  p_company_id       uuid,
  p_project_id       uuid,
  p_cuenta_explicita uuid,
  p_regla_id         uuid,
  p_evento           text
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_cuenta_explicita IS NOT NULL OR p_regla_id IS NOT NULL THEN 'cuenta_invalida'
    WHEN p_evento IS NOT NULL
         AND public.conta_cuenta_para(p_company_id, p_project_id, p_evento) IS NOT NULL
      THEN 'cuenta_invalida'
    ELSE 'sin_cuenta'
  END
$$;

REVOKE EXECUTE ON FUNCTION public.conta_clasificar_resolucion(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── 4. El contabilizador compartido (INTERNO) ───────────────────────────────
-- Cuerpo de la rama de aprobación de 20260928000000, sin cambios en la
-- decisión de ruta, en la prioridad por línea ni en importes. Añade:
--   (a) el motivo tipificado de cada imputación fallida, con su línea;
--   (b) el diagnóstico previo al generador (catálogo, mapeos, cuentas);
--   (c) la fila de intento, en la misma transacción que el asiento.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_factura_prov_interno(
  p_f       public.facturas_proveedor,
  p_disparo text
)
RETURNS TABLE (
  resultado       text,
  codigo          text,
  motivo          text,
  origen_linea_id uuid,
  asiento_id      uuid,
  intento_id      uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  v_base      numeric(14,2);
  v_suma      numeric(14,2);
  v_remanente numeric(14,2);
  v_hay_expl  boolean;
  v_imputa    jsonb := '[]'::jsonb;
  v_falta     boolean := false;
  -- Diagnóstico: la primera falla manda en la bandeja; todas van al detalle.
  v_fallas    jsonb := '[]'::jsonb;
  v_codigo    text;
  v_motivo    text;
  v_linea_id  uuid;
  v_linea     jsonb;
  v_cuenta    uuid;
  v_ok        boolean;
  v_asiento   uuid;
  v_intento   uuid;
  fl          record;
  r           record;
BEGIN
  IF p_disparo NOT IN ('aprobacion','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_factura_prov_interno: disparo inválido %', p_disparo
      USING ERRCODE = '22023';
  END IF;

  v_gasto := CASE WHEN p_f.categoria IN ('mantenimiento','servicios','administrativo',
                                         'seguridad','limpieza','obras')
                  THEN 'gasto_' || p_f.categoria ELSE 'gasto_otros' END;
  SELECT p.nombre INTO v_proveedor FROM public.proveedores p WHERE p.id = p_f.proveedor_id;
  v_moneda := COALESCE(p_f.moneda,
    (SELECT COALESCE(pr.moneda_condominios, pr.moneda) FROM public.projects pr WHERE pr.id = p_f.project_id));
  v_iva  := COALESCE(p_f.iva_monto, 0);
  v_neto := p_f.monto_total - v_iva;

  v_iva_map := public.conta_cuenta_para(p_f.company_id, p_f.project_id, 'iva_credito') IS NOT NULL;

  -- ── La RUTA se decide antes de resolver nada ─────────────────────────────
  v_gr := p_f.orden_compra_id IS NOT NULL
      AND public.conta_cuenta_para(p_f.company_id, p_f.project_id, 'compras_por_facturar') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.factura_proveedor_lineas fl2
        JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
        WHERE fl2.factura_id = p_f.id AND ocl.cantidad_recibida > 0
      );

  IF v_gr THEN
    SELECT COALESCE(SUM(round(fl2.cantidad * ocl.precio_unitario, 2)), 0)
      INTO v_grni
      FROM public.factura_proveedor_lineas fl2
      JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
     WHERE fl2.factura_id = p_f.id AND ocl.cantidad_recibida > 0;

    SELECT jsonb_agg(CASE WHEN v.monto >= 0
                          THEN jsonb_build_object('evento', v.evento, 'debe', v.monto,
                                                  'descripcion', 'Variación de precio de compra')
                          ELSE jsonb_build_object('evento', v.evento, 'haber', -v.monto,
                                                  'descripcion', 'Variación de precio de compra') END)
      INTO v_var
    FROM (
      SELECT CASE WHEN COALESCE(ocl.categoria, 'otros') IN
                       ('mantenimiento','servicios','administrativo','seguridad','limpieza','obras')
                  THEN 'gasto_' || ocl.categoria ELSE 'gasto_otros' END AS evento,
             SUM(round(fl2.cantidad * (fl2.precio_unitario - ocl.precio_unitario), 2)) AS monto
        FROM public.factura_proveedor_lineas fl2
        JOIN public.orden_compra_lineas ocl ON ocl.id = fl2.orden_compra_linea_id
       WHERE fl2.factura_id = p_f.id AND ocl.cantidad_recibida > 0
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
       WHERE fl2.factura_id = p_f.id AND ocl.cantidad_recibida > 0), 0), 2);

    IF v_iva > 0 AND v_iva_map THEN
      v_lineas := v_lineas || jsonb_build_array(
        jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'));
    END IF;

    v_base := v_resto + CASE WHEN v_iva > 0 AND NOT v_iva_map THEN v_iva ELSE 0 END;

  ELSIF v_iva > 0 AND v_iva < p_f.monto_total AND v_iva_map THEN
    v_lineas := jsonb_build_array(
      jsonb_build_object('evento', 'iva_credito', 'debe', v_iva, 'descripcion', 'IVA crédito fiscal'));
    v_base := v_neto;

  ELSE
    v_base := p_f.monto_total;
  END IF;

  v_lineas := v_lineas || jsonb_build_array(
    jsonb_build_object('evento', 'cxp_proveedores', 'haber', p_f.monto_total));

  -- ── Las líneas que cargan gasto ──────────────────────────────────────────
  SELECT COALESCE(SUM(round(l.cantidad * l.precio_unitario, 2)), 0),
         COALESCE(bool_or(l.cuenta_id IS NOT NULL), false)
    INTO v_suma, v_hay_expl
    FROM public.factura_proveedor_lineas l
    LEFT JOIN public.orden_compra_lineas ocl ON ocl.id = l.orden_compra_linea_id
   WHERE l.factura_id = p_f.id
     AND round(l.cantidad * l.precio_unitario, 2) <> 0
     AND NOT (v_gr AND ocl.id IS NOT NULL AND ocl.cantidad_recibida > 0);

  v_remanente := v_base - v_suma;

  IF v_base = 0 AND v_suma = 0 THEN
    -- GR/IR íntegramente recibida: el asiento no lleva gasto.
    NULL;

  ELSIF v_suma = 0 OR v_base <= 0 THEN
    SELECT * INTO r FROM public.conta_registrar_resolucion(
      'facturas_proveedor', p_f.id, p_f.project_id, 'gasto',
      p_f.proveedor_id, NULL, NULL, NULL, v_gasto, NULL, p_f.company_id, NULL, NULL);
    IF r.cuenta_id IS NULL THEN
      v_falta := true;
      v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
        'linea_id', NULL, 'linea', NULL,
        'codigo', public.conta_clasificar_resolucion(p_f.company_id, p_f.project_id,
                    NULL, r.regla_id, r.evento_usado),
        'motivo', r.motivo));
    ELSE
      v_imputa := v_imputa || jsonb_build_array(
        (CASE WHEN r.origen_resolucion = 'mapeo_evento'
              THEN jsonb_build_object('evento', v_gasto)
              ELSE jsonb_build_object('cuenta_id', r.cuenta_id) END)
        || jsonb_build_object(CASE WHEN v_base > 0 THEN 'debe' ELSE 'haber' END, abs(v_base)));
    END IF;

  ELSIF v_remanente < 0 THEN
    SELECT * INTO r FROM public.conta_registrar_resolucion(
      'facturas_proveedor', p_f.id, p_f.project_id, 'gasto',
      p_f.proveedor_id, NULL, NULL, NULL, v_gasto, NULL, p_f.company_id, NULL,
      'Las líneas de la factura suman más de lo que el asiento imputa a gasto: no se puede repartir sin alterar alguna cuenta elegida.');
    v_falta := true;
    v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
      'linea_id', NULL, 'linea', NULL, 'codigo', 'reparto_lineas', 'motivo', r.motivo));

  ELSE
    -- ── Imputación POR LÍNEA ──────────────────────────────────────────────
    FOR fl IN
      SELECT l.id, l.cuenta_id, l.linea,
             round(l.cantidad * l.precio_unitario, 2) AS importe
        FROM public.factura_proveedor_lineas l
        LEFT JOIN public.orden_compra_lineas ocl ON ocl.id = l.orden_compra_linea_id
       WHERE l.factura_id = p_f.id
         AND round(l.cantidad * l.precio_unitario, 2) <> 0
         AND NOT (v_gr AND ocl.id IS NOT NULL AND ocl.cantidad_recibida > 0)
       ORDER BY l.linea
    LOOP
      SELECT * INTO r FROM public.conta_registrar_resolucion(
        'facturas_proveedor', p_f.id, p_f.project_id, 'gasto',
        p_f.proveedor_id, NULL, NULL, NULL, v_gasto, fl.cuenta_id, p_f.company_id,
        fl.id, NULL);

      IF r.cuenta_id IS NULL THEN
        v_falta := true;
        v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
          'linea_id', fl.id, 'linea', fl.linea,
          'codigo', public.conta_clasificar_resolucion(p_f.company_id, p_f.project_id,
                      fl.cuenta_id, r.regla_id, r.evento_usado),
          'motivo', r.motivo));
      ELSE
        v_imputa := v_imputa || jsonb_build_array(
          (CASE WHEN r.origen_resolucion = 'mapeo_evento'
                THEN jsonb_build_object('evento', v_gasto)
                ELSE jsonb_build_object('cuenta_id', r.cuenta_id) END)
          || jsonb_build_object('debe', fl.importe)
          || jsonb_build_object('descripcion', 'Línea ' || fl.linea));
      END IF;
    END LOOP;

    IF v_remanente <> 0 THEN
      SELECT * INTO r FROM public.conta_registrar_resolucion(
        'facturas_proveedor', p_f.id, p_f.project_id, 'gasto',
        p_f.proveedor_id, NULL, NULL, NULL, v_gasto, NULL, p_f.company_id, NULL, NULL);
      IF r.cuenta_id IS NULL THEN
        v_falta := true;
        v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
          'linea_id', NULL, 'linea', NULL,
          'codigo', public.conta_clasificar_resolucion(p_f.company_id, p_f.project_id,
                      NULL, r.regla_id, r.evento_usado),
          'motivo', r.motivo));
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

  -- ── Diagnóstico previo al generador ──────────────────────────────────────
  -- `conta_generar_asiento` omite el asiento con un WARNING que nadie ve. Lo
  -- que omitiría se detecta acá, con el mismo criterio y más estricto en un
  -- punto (cuenta activa), para poder decir QUÉ falta.
  IF NOT v_falta THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.conta_cuentas c
       WHERE c.company_id = p_f.company_id
         AND c.project_id IS NOT DISTINCT FROM p_f.project_id
    ) THEN
      v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
        'linea_id', NULL, 'linea', NULL, 'codigo', 'configuracion_incompleta',
        'motivo', 'Esta contabilidad no tiene catálogo de cuentas. Inicialízalo antes de contabilizar.'));
    ELSE
      FOR v_linea IN SELECT e FROM jsonb_array_elements(v_imputa || v_lineas) AS t(e) LOOP
        IF v_linea ? 'cuenta_id' THEN
          SELECT (c.company_id = p_f.company_id
                  AND c.project_id IS NOT DISTINCT FROM p_f.project_id
                  AND c.es_detalle AND c.activa)
            INTO v_ok
            FROM public.conta_cuentas c WHERE c.id = (v_linea->>'cuenta_id')::uuid;
          IF NOT COALESCE(v_ok, false) THEN
            v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
              'linea_id', NULL, 'linea', NULL, 'codigo', 'cuenta_invalida',
              'motivo', 'Una cuenta del asiento ya no sirve: tiene que ser de esta contabilidad, de detalle y activa.'));
          END IF;
        ELSE
          v_cuenta := public.conta_cuenta_para(p_f.company_id, p_f.project_id, v_linea->>'evento');
          IF v_cuenta IS NULL THEN
            v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
              'linea_id', NULL, 'linea', NULL, 'codigo', 'configuracion_incompleta',
              'motivo', format('Falta el mapeo del evento «%s» en esta contabilidad. Configúralo en Contabilidad › Configuración.',
                               v_linea->>'evento')));
          ELSE
            SELECT (c.es_detalle AND c.activa) INTO v_ok
              FROM public.conta_cuentas c WHERE c.id = v_cuenta;
            IF NOT COALESCE(v_ok, false) THEN
              v_fallas := v_fallas || jsonb_build_array(jsonb_build_object(
                'linea_id', NULL, 'linea', NULL, 'codigo', 'cuenta_invalida',
                'motivo', format('El evento «%s» está mapeado a una cuenta inactiva o agrupadora. Corrige el mapeo.',
                                 v_linea->>'evento')));
            END IF;
          END IF;
        END IF;
      END LOOP;
    END IF;

    IF jsonb_array_length(v_fallas) > 0 THEN
      v_falta := true;
    END IF;
  END IF;

  IF v_falta THEN
    -- Nada parcial: o el asiento entero o ninguno.
    v_codigo   := v_fallas->0->>'codigo';
    v_motivo   := v_fallas->0->>'motivo';
    v_linea_id := NULLIF(v_fallas->0->>'linea_id', '')::uuid;
    IF v_codigo IS NULL THEN
      v_codigo := 'error';
      v_motivo := 'No se pudo determinar la imputación de gasto.';
    END IF;
    RAISE WARNING 'conta_contabilizar_factura_prov_interno: factura % pendiente (%) — asiento omitido', p_f.id, v_codigo;
    v_intento := public.conta_registrar_intento(
      p_f.company_id, p_f.project_id, p_f.id, p_disparo, 'pendiente',
      v_codigo, v_motivo, v_linea_id, v_fallas, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, v_linea_id, NULL::uuid, v_intento;
    RETURN;
  END IF;

  v_asiento := public.conta_generar_asiento(
    p_f.company_id, p_f.project_id, 'facturas_proveedor', p_f.id, 'factura_prov_aprobada',
    p_f.fecha_emision,
    'Factura proveedor ' || COALESCE(v_proveedor, '') ||
      COALESCE(' #' || NULLIF(p_f.numero_factura, ''), '') || ' — ' || p_f.concepto,
    'diario', v_moneda,
    v_imputa || v_lineas
  );

  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento(
      p_f.company_id, p_f.project_id, p_f.id, p_disparo, 'contabilizada',
      NULL, NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, NULL::uuid, v_asiento, v_intento;
    RETURN;
  END IF;

  -- El generador no creó nada. O ya existía (índice único: idempotencia) o
  -- falló por algo que el diagnóstico no previó y que sólo quedó en el log.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = p_f.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'facturas_proveedor' AND a.origen_id = p_f.id
     AND a.origen_evento = 'factura_prov_aprobada' AND a.estado <> 'anulado'
   ORDER BY a.created_at DESC LIMIT 1;

  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento(
      p_f.company_id, p_f.project_id, p_f.id, p_disparo, 'ya_contabilizada',
      NULL, NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, NULL::uuid, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento(
    p_f.company_id, p_f.project_id, p_f.id, p_disparo, 'pendiente',
    'error', 'El generador de asientos no produjo el asiento. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    NULL, '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento.'::text, NULL::uuid, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_factura_prov_interno(public.facturas_proveedor, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_factura_prov_interno(public.facturas_proveedor, text) IS
  'INTERNA. Única lógica de devengo de la factura de proveedor, compartida por la aprobación (trigger) y el reproceso. Resuelve por línea, diagnostica antes de generar, genera el asiento o ninguno y registra el intento.';

-- ── 5. El trigger delega en el contabilizador ───────────────────────────────
-- Las ramas de BORRADO y ANULACIÓN quedan exactamente como en 20260928000000.
CREATE OR REPLACE FUNCTION public.conta_tg_facturas_prov()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
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

  PERFORM public.conta_contabilizar_factura_prov_interno(NEW, 'aprobacion');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_facturas_prov() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_tg_facturas_prov() IS
  'Devengo de la factura de proveedor. Reversa al anular y al BORRAR. Al aprobar delega en conta_contabilizar_factura_prov_interno, la misma función que usa el reproceso.';

-- ── 6. Reproceso de UNA factura ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_reprocesar_factura_proveedor(p_factura_id uuid)
RETURNS TABLE (
  resultado       text,
  codigo          text,
  motivo          text,
  origen_linea_id uuid,
  asiento_id      uuid,
  asiento_numero  bigint,
  asiento_estado  text,
  intento_id      uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_f       public.facturas_proveedor;
  v_a       record;
  v_res     record;
  v_intento uuid;
  v_periodo text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;

  -- La empresa es la de la SESIÓN, nunca la del cliente.
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  -- Generar y publicar un asiento: las dos acciones que
  -- conta_publicar_asiento/conta_revaluar_fx exigen por separado.
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para contabilizar facturas.' USING ERRCODE = '42501';
  END IF;

  IF p_factura_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere el id de la factura.' USING ERRCODE = '22023';
  END IF;

  -- El BLOQUEO serializa este reproceso con cualquier otro, con la anulación
  -- (UPDATE de estado) y con el borrado de la misma factura. Tras la espera,
  -- en READ COMMITTED, se relee la versión vigente de la fila: una factura
  -- anulada o borrada mientras tanto se ve como tal.
  --
  -- Otra empresa o un proyecto no autorizado responden IGUAL que un documento
  -- inexistente: no se confirma la existencia de lo ajeno.
  SELECT f.* INTO v_f
    FROM public.facturas_proveedor f
   WHERE f.id = p_factura_id
     AND f.company_id = v_company
     AND public.can_access_project(f.project_id)
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_inexistente'::text,
      'La factura no existe o no está en tu ámbito.'::text,
      NULL::uuid, NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  IF v_f.estado = 'anulada' THEN
    v_intento := public.conta_registrar_intento(v_f.company_id, v_f.project_id, v_f.id,
      'reproceso', 'bloqueada', 'documento_anulado',
      'La factura está anulada: no se contabiliza.', NULL, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_anulado'::text,
      'La factura está anulada: no se contabiliza.'::text,
      NULL::uuid, NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  IF v_f.estado NOT IN ('aprobada','pagada_parcial','pagada') THEN
    v_intento := public.conta_registrar_intento(v_f.company_id, v_f.project_id, v_f.id,
      'reproceso', 'bloqueada', 'documento_no_aprobado',
      'La factura no está aprobada: se contabiliza al aprobarla.', NULL, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'documento_no_aprobado'::text,
      'La factura no está aprobada: se contabiliza al aprobarla.'::text,
      NULL::uuid, NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  -- ¿Ya tiene asiento de devengo? Cualquier estado cuenta. Vivo → «ya
  -- contabilizada» con ESE asiento. Reversado o anulado → no se recrea: eso
  -- lo decide una persona, no un botón.
  SELECT a.id, a.numero, a.estado, a.anulado_por_id INTO v_a
    FROM public.conta_asientos a
   WHERE a.company_id = v_f.company_id AND a.origen = 'automatico'
     AND a.origen_tabla = 'facturas_proveedor' AND a.origen_id = v_f.id
     AND a.origen_evento = 'factura_prov_aprobada'
   ORDER BY (a.estado <> 'anulado' AND a.anulado_por_id IS NULL) DESC, a.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_a.estado <> 'anulado' AND v_a.anulado_por_id IS NULL THEN
      v_intento := public.conta_registrar_intento(v_f.company_id, v_f.project_id, v_f.id,
        'reproceso', 'ya_contabilizada', NULL, NULL, NULL, '[]'::jsonb, v_a.id);
      RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text,
        'La factura ya está contabilizada.'::text,
        NULL::uuid, v_a.id, v_a.numero, v_a.estado, v_intento;
      RETURN;
    END IF;

    v_intento := public.conta_registrar_intento(v_f.company_id, v_f.project_id, v_f.id,
      'reproceso', 'bloqueada', 'asiento_reversado',
      'El asiento de esta factura fue anulado o reversado: no se recrea automáticamente.',
      NULL, '[]'::jsonb, v_a.id);
    RETURN QUERY SELECT 'bloqueada'::text, 'asiento_reversado'::text,
      'El asiento de esta factura fue anulado o reversado: no se recrea automáticamente.'::text,
      NULL::uuid, v_a.id, v_a.numero, v_a.estado, v_intento;
    RETURN;
  END IF;

  -- Período cerrado: el generador re-fecharía a hoy. Un reproceso no mueve la
  -- fecha contable de un documento del pasado ni abre el período: bloquea.
  v_periodo := to_char(v_f.fecha_emision, 'YYYY-MM');
  IF v_f.project_id IS NOT NULL
     AND public.conta_periodo_cerrado(v_f.project_id, v_periodo) THEN
    v_intento := public.conta_registrar_intento(v_f.company_id, v_f.project_id, v_f.id,
      'reproceso', 'bloqueada', 'periodo_cerrado',
      format('El período %s está cerrado. No se cambia la fecha ni se abre el período: resuélvelo con el cierre y vuelve a intentar.', v_periodo),
      NULL, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'bloqueada'::text, 'periodo_cerrado'::text,
      format('El período %s está cerrado. No se cambia la fecha ni se abre el período.', v_periodo),
      NULL::uuid, NULL::uuid, NULL::bigint, NULL::text, v_intento;
    RETURN;
  END IF;

  -- La MISMA lógica que la aprobación.
  SELECT * INTO v_res FROM public.conta_contabilizar_factura_prov_interno(v_f, 'reproceso');

  IF v_res.asiento_id IS NOT NULL THEN
    SELECT a.numero, a.estado INTO v_a FROM public.conta_asientos a WHERE a.id = v_res.asiento_id;
    RETURN QUERY SELECT v_res.resultado, v_res.codigo,
      CASE WHEN v_a.estado = 'borrador'
           THEN 'Asiento generado en borrador: falta el tipo de cambio de la fecha. Publícalo desde Pólizas.'
           ELSE NULL END,
      NULL::uuid, v_res.asiento_id, v_a.numero::bigint, v_a.estado::text, v_res.intento_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_res.resultado, v_res.codigo, v_res.motivo, v_res.origen_linea_id,
    NULL::uuid, NULL::bigint, NULL::text, v_res.intento_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_factura_proveedor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reprocesar_factura_proveedor(uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_reprocesar_factura_proveedor(uuid) IS
  'Reprocesa la contabilización de UNA factura de proveedor aprobada sin asiento. Toma empresa/proyecto/estado de la fila bloqueada (FOR UPDATE), exige platform.contabilidad.create y change_status, no re-fecha en período cerrado, no recrea asientos reversados y usa la misma lógica que la aprobación.';

-- ── 7. Bandeja de pendientes ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_facturas_pendientes(
  p_project_id uuid    DEFAULT NULL,
  p_codigo     text    DEFAULT NULL,
  p_busqueda   text    DEFAULT NULL,
  p_limite     integer DEFAULT 25,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE (
  factura_id        uuid,
  numero_factura    text,
  concepto          text,
  proveedor_id      uuid,
  proveedor_nombre  text,
  fecha_emision     date,
  monto_total       numeric,
  moneda            text,
  estado            text,
  project_id        uuid,
  codigo            text,
  motivo            text,
  linea_id          uuid,
  linea_numero      integer,
  linea_descripcion text,
  ultimo_intento_at timestamptz,
  ultimo_disparo    text,
  intentos          bigint,
  puede_reprocesar  boolean,
  total_filas       bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_puede    boolean;
  v_busqueda text;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT (public.is_super_admin()
          OR public.current_user_role() = ANY (ARRAY['company_owner','admin'])
          OR public.user_has_permission('platform.contabilidad.view')) THEN
    RAISE EXCEPTION 'No autorizado para ver la contabilidad.' USING ERRCODE = '42501';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a la empresa activa.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No autorizado para este proyecto.' USING ERRCODE = '42501';
  END IF;

  IF p_codigo IS NOT NULL AND p_codigo NOT IN
     ('sin_cuenta','cuenta_invalida','configuracion_incompleta','otro') THEN
    RAISE EXCEPTION 'Filtro de motivo inválido: %', p_codigo USING ERRCODE = '22023';
  END IF;

  v_puede := public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status');
  v_busqueda := NULLIF(btrim(COALESCE(p_busqueda, '')), '');

  RETURN QUERY
  WITH base AS (
    SELECT f.id, f.numero_factura, f.concepto, f.proveedor_id, p.nombre AS proveedor_nombre,
           f.fecha_emision, f.monto_total, f.moneda, f.estado, f.project_id
      FROM public.facturas_proveedor f
      LEFT JOIN public.proveedores p ON p.id = f.proveedor_id
     WHERE f.company_id = v_company
       AND f.project_id IS NOT DISTINCT FROM p_project_id
       AND f.estado IN ('aprobada','pagada_parcial','pagada')
       -- Sin NINGÚN asiento de devengo: ni vivo, ni borrador, ni reversado.
       AND NOT EXISTS (
         SELECT 1 FROM public.conta_asientos a
          WHERE a.company_id = f.company_id AND a.origen = 'automatico'
            AND a.origen_tabla = 'facturas_proveedor' AND a.origen_id = f.id
            AND a.origen_evento = 'factura_prov_aprobada')
       -- Con al menos un intento: nueva bitácora, o la de resoluciones de
       -- #885 para las aprobadas antes de esta migración. Las facturas
       -- anteriores a la contabilidad automática no son pendientes accionables.
       AND (EXISTS (SELECT 1 FROM public.conta_intentos_contabilizacion i
                     WHERE i.origen_tabla = 'facturas_proveedor' AND i.origen_id = f.id)
            OR EXISTS (SELECT 1 FROM public.conta_resoluciones cr
                        WHERE cr.origen_tabla = 'facturas_proveedor' AND cr.origen_id = f.id))
       AND (v_busqueda IS NULL
            OR f.numero_factura ILIKE '%' || v_busqueda || '%'
            OR f.concepto ILIKE '%' || v_busqueda || '%'
            OR p.nombre ILIKE '%' || v_busqueda || '%')
  ),
  diag AS (
    SELECT b.*,
           ui.created_at AS i_at, ui.disparo AS i_disparo, ui.resultado AS i_resultado,
           ui.codigo AS i_codigo, ui.motivo AS i_motivo, ui.origen_linea_id AS i_linea,
           ur.created_at AS r_at, ur.regla_id AS r_regla, ur.motivo AS r_motivo,
           ur.origen_linea_id AS r_linea, ur.origen_resolucion AS r_origen,
           (SELECT count(*) FROM public.conta_intentos_contabilizacion i2
             WHERE i2.origen_tabla = 'facturas_proveedor' AND i2.origen_id = b.id) AS n_intentos
      FROM base b
      LEFT JOIN LATERAL (
        SELECT i.* FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = 'facturas_proveedor' AND i.origen_id = b.id
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
      -- Sólo para lo aprobado antes de la bitácora de intentos: la última
      -- resolución FALLIDA, si la hubo.
      LEFT JOIN LATERAL (
        SELECT cr.* FROM public.conta_resoluciones cr
         WHERE cr.origen_tabla = 'facturas_proveedor' AND cr.origen_id = b.id
         ORDER BY (cr.origen_resolucion = 'sin_resolver') DESC, cr.created_at DESC LIMIT 1) ur ON true
  ),
  clasif AS (
    SELECT d.*,
      CASE
        WHEN d.i_at IS NOT NULL AND d.i_resultado IN ('pendiente','bloqueada') THEN d.i_codigo
        WHEN d.i_at IS NOT NULL THEN 'error'
        WHEN d.r_origen = 'sin_resolver' AND d.r_motivo LIKE 'Las líneas de la factura suman más%'
          THEN 'reparto_lineas'
        WHEN d.r_origen = 'sin_resolver' AND (d.r_regla IS NOT NULL OR d.r_motivo LIKE '%ya no sirve%'
                                             OR d.r_motivo LIKE '%no sirve para esta contabilidad%')
          THEN 'cuenta_invalida'
        WHEN d.r_origen = 'sin_resolver' THEN 'sin_cuenta'
        -- La cuenta de gasto se resolvió y aun así no hay asiento: faltó otra
        -- configuración. Resolver no es contabilizar.
        ELSE 'configuracion_incompleta'
      END AS c_codigo,
      CASE
        WHEN d.i_at IS NOT NULL AND d.i_resultado IN ('pendiente','bloqueada') THEN d.i_motivo
        WHEN d.i_at IS NOT NULL THEN 'El último intento no dejó asiento vigente. Reprocesa para diagnosticar.'
        WHEN d.r_origen = 'sin_resolver' THEN d.r_motivo
        ELSE 'La cuenta de gasto se resolvió pero el asiento no se generó (falta otra configuración, por ejemplo el mapeo de CxP). Reprocesa para ver el motivo exacto.'
      END AS c_motivo,
      CASE WHEN d.i_at IS NOT NULL THEN d.i_linea
           WHEN d.r_origen = 'sin_resolver' THEN d.r_linea END AS c_linea,
      GREATEST(d.i_at, d.r_at) AS c_at
    FROM diag d
  ),
  filtrado AS (
    SELECT c.* FROM clasif c
     WHERE p_codigo IS NULL
        OR (p_codigo = 'otro' AND c.c_codigo NOT IN ('sin_cuenta','cuenta_invalida','configuracion_incompleta'))
        OR c.c_codigo = p_codigo
  )
  SELECT x.id, x.numero_factura, x.concepto, x.proveedor_id, x.proveedor_nombre,
         x.fecha_emision, x.monto_total::numeric, x.moneda, x.estado, x.project_id,
         x.c_codigo, x.c_motivo, x.c_linea, l.linea::integer, l.descripcion,
         x.c_at, x.i_disparo, x.n_intentos, v_puede,
         count(*) OVER ()
    FROM filtrado x
    LEFT JOIN public.factura_proveedor_lineas l ON l.id = x.c_linea
   ORDER BY x.c_at DESC NULLS LAST, x.id
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_facturas_pendientes(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_facturas_pendientes(uuid, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.conta_facturas_pendientes(uuid, text, text, integer, integer) IS
  'Bandeja de facturas de proveedor aprobadas SIN asiento de devengo y con al menos un intento, de la contabilidad indicada (NULL = empresa), acotada a la empresa de la sesión y a los proyectos del usuario. Filtro por motivo y búsqueda, paginada en servidor.';
