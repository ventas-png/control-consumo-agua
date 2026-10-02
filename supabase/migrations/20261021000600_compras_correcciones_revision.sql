-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · CORRECCIONES DE REVISIÓN (#911)
--
-- Migración CORRECTIVA: las seis del bloque (20261021000000…0500) pueden estar ya
-- aplicadas en Preview u otro entorno, así que NO se editan; esta redefine lo que
-- hay que corregir (CREATE OR REPLACE) y agrega lo nuevo.
--
-- 1. RECEPCIÓN DE ACTIVOS: RESOLUCIÓN SEMÁNTICA DE CUENTAS
--    20261021000100 copió compras_tg_recepcion_registrar() de la versión de
--    20260821000200 y con ello VOLVIÓ a buscar las cuentas del activo por código
--    ('1401', '1409', '5107'), deshaciendo 20260918121413 (cuentas especiales por
--    significado). Un ledger con otros códigos o sin esas cuentas dejaba los
--    activos sin cuenta aunque el mapeo fuera válido. Aquí se restaura la
--    resolución conta_cuenta_especial(company, project, evento) conservando
--    TODO lo del bloque B (aceptado/rechazado, servicios, bloqueo de líneas).
--    Sigue siendo NO bloqueante: sin mapeo, el activo nace sin cuenta contable y
--    la recepción se registra igual.
--
-- 2. ORDEN: CONDICIONES APROBADAS INMUTABLES TAMBIÉN AL EMITIR Y DESPUÉS
--    El congelamiento de 20261021000000 solo aplicaba a aprobada → aprobada: una
--    petición directa que cambiaba condiciones y a la vez emitía la orden lo
--    esquivaba, y una orden emitida no tenía candado. Ahora se rechaza cualquier
--    cambio de proveedor, moneda, proyecto, contrato, condiciones de pago, crédito,
--    obra o fecha requerida sobre una orden que ya no es borrador, cambie o no el
--    estado en la misma operación. «Devolver a borrador» (con motivo) sigue siendo
--    la vía legítima y es una operación propia.
--
-- 3. RECEPCIÓN + LÍNEAS: CREACIÓN TRANSACCIONAL E IDEMPOTENTE
--    La pantalla creaba la cabecera y luego las líneas en dos peticiones: un fallo
--    entre ambas dejaba un borrador vacío, y el reintento con la misma clave
--    chocaba con él. compras_recepcion_crear(...) crea todo en UNA transacción;
--    la misma clave con el MISMO contenido (huella sha256 guardada en
--    recepciones.hash_contenido) devuelve el documento completo ya creado (la
--    respuesta se pudo perder); con contenido distinto se rechaza con
--    COMPRAS_RECEPCION_CLAVE_CONFLICTO. Un candado de asesoramiento por
--    empresa+clave serializa los intentos simultáneos.
--
-- CÓMO RECUPERAR (NO es una reversión sin pérdida)
--   Las funciones se restauran con CREATE OR REPLACE desde la versión anterior
--   (compras_tg_recepcion_registrar de 20261021000100; compras_tg_oc_ciclo de
--   20261021000000) y la función nueva se elimina con
--   DROP FUNCTION public.compras_recepcion_crear(uuid, uuid, jsonb, jsonb).
--   La columna recepciones.hash_contenido NO debe eliminarse una vez haya
--   recepciones creadas con ella: se perdería la huella que permite distinguir un
--   reintento legítimo de una clave reutilizada con otro contenido. Eliminar las
--   tablas o columnas que introdujo el bloque B (orden_compra_eventos,
--   cantidad_rechazada, motivo_rechazo, tipo, destino_fisico, respaldo_path,
--   clave_idempotencia, revision, motivo_devolucion, aprobacion_separada,
--   proveedor_id de suministros/proformas, etc.) BORRA los datos registrados
--   después del despliegue (historial de la orden, rechazos y motivos, claves,
--   vínculos con el catálogo). Si ya se operó con ellas, la recuperación es
--   corregir hacia adelante con una migración nueva, o restaurar una copia de
--   respaldo aceptando perder lo posterior. Las notas «CÓMO REVERTIR» de las
--   cabeceras de 20261021000000…0500 quedan SUPERADAS por esta nota.
--
-- IMPACTO EN DATOS: una columna nueva nullable; ninguna fila cambia.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Recepción de activos con cuentas semánticas ──────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_recepcion_registrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_oc       record;
  v_l        record;
  v_tol      numeric;
  v_moneda   text;
  v_lineas   jsonb;
  v_total    numeric(14,2);
  v_prov     text;
  v_pend     int;
  v_con_recibido int;
  v_recib    int;
  v_codigo   text;
  v_cta_af   uuid;
  v_cta_dep  uuid;
  v_cta_gdep uuid;
  -- Mismo cuidado que en suministros_tg_stock: se restaura el valor previo del
  -- GUC en vez de forzar 'off', para no apagárselo a un trigger de afuera.
  v_prev     text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  -- ─ Registrar ─────────────────────────────────────────────────────────────
  IF NEW.estado = 'registrada' AND OLD.estado = 'borrador' THEN
    SELECT * INTO v_oc FROM public.ordenes_compra WHERE id = NEW.orden_compra_id;
    IF v_oc.estado NOT IN ('aprobada','emitida','recibida_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_OC_NO_RECIBIBLE: la orden % está en estado "%" y no admite recepciones.',
        COALESCE(v_oc.numero, v_oc.concepto), v_oc.estado USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.recepcion_lineas WHERE recepcion_id = NEW.id) THEN
      RAISE EXCEPTION 'COMPRAS_RECEPCION_VACIA: no se registra una recepción sin líneas.'
        USING ERRCODE = 'check_violation';
    END IF;

    v_tol := public.compras_tolerancia(NEW.company_id, 'cantidad');

    -- Bienes y servicios no se mezclan: un servicio se CONFIRMA (conformidad
    -- con responsable), no entra a una bodega que no existe.
    IF NEW.tipo = 'servicio' THEN
      IF EXISTS (SELECT 1 FROM public.recepcion_lineas rl
                  JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
                 WHERE rl.recepcion_id = NEW.id AND ocl.destino_tipo <> 'servicio') THEN
        RAISE EXCEPTION 'COMPRAS_CONFORMIDAD_SOLO_SERVICIOS: una conformidad de servicio solo admite líneas con destino «servicio»; los bienes se reciben con una recepción de bienes.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.recibido_por IS NULL THEN
        RAISE EXCEPTION 'COMPRAS_CONFORMIDAD_RESPONSABLE: la conformidad de servicio necesita un responsable que confirme la prestación.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF EXISTS (SELECT 1 FROM public.recepcion_lineas rl
                   JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
                  WHERE rl.recepcion_id = NEW.id AND ocl.destino_tipo = 'servicio') THEN
      RAISE EXCEPTION 'COMPRAS_SERVICIO_SIN_CONFORMIDAD: las líneas de servicio se confirman con una conformidad de servicio, no con una recepción de bienes.'
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM set_config('conta.allow_system_write', 'on', true);

    FOR v_l IN
      SELECT rl.id AS rl_id, rl.cantidad, rl.costo_unitario, rl.total,
             ocl.id AS ocl_id, ocl.descripcion, ocl.destino_tipo, ocl.suministro_id,
             ocl.cuenta_id, ocl.categoria, ocl.cantidad AS pedida, ocl.cantidad_recibida,
             ocl.unidad
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id
        AND rl.cantidad > 0            -- lo rechazado no entra ni se contabiliza
      ORDER BY ocl.linea
      -- Bloquea las líneas de la ORDEN: dos recepciones simultáneas contra la
      -- misma orden leían `cantidad_recibida` sin bloqueo y las dos pasaban el
      -- corte de sobre-recepción con el valor viejo.
      FOR UPDATE OF ocl
    LOOP
      -- Recibir de más es un error de captura o una entrega fuera de contrato:
      -- se corta aquí, no en la factura, que es donde ya sería tarde.
      IF v_l.cantidad_recibida + v_l.cantidad > v_l.pedida * (1 + v_tol / 100) THEN
        RAISE EXCEPTION 'COMPRAS_SOBRE_RECEPCION: "%" — pedido %, ya recibido %, ahora %. Tolerancia: % por ciento.',
          v_l.descripcion, v_l.pedida, v_l.cantidad_recibida, v_l.cantidad, v_tol
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.orden_compra_lineas
         SET cantidad_recibida = cantidad_recibida + v_l.cantidad, updated_at = now()
       WHERE id = v_l.ocl_id;

      -- Inventario: una entrada al kardex; el trigger de stock hace el resto.
      IF v_l.destino_tipo = 'inventario' AND v_l.suministro_id IS NOT NULL THEN
        INSERT INTO public.movimientos_suministro
          (company_id, suministro_id, tipo, cantidad, motivo, fecha, costo_unitario, origen_tabla, origen_id)
        VALUES (NEW.company_id, v_l.suministro_id, 'entrada', v_l.cantidad,
                'Recepción ' || COALESCE(NEW.numero, '') || ' — OC ' || COALESCE(v_oc.numero, ''),
                NEW.fecha, v_l.costo_unitario, 'recepcion_lineas', v_l.rl_id);
      END IF;

      -- Activo fijo: una fila por unidad recibida, porque un activo se
      -- etiqueta, se ubica y se depreciará de a uno.
      IF v_l.destino_tipo = 'activo_fijo' THEN
        -- Cuentas especiales del LEDGER, por significado (20260918121413), no por
        -- código: un catálogo con códigos propios o sin 1401/1409/5107 sigue
        -- resolviendo bien. NULL si el ledger no las tiene mapeadas: el activo
        -- nace sin cuenta contable y la recepción NO se detiene.
        v_cta_af   := public.conta_cuenta_especial(NEW.company_id, NEW.project_id, 'activo_fijo');
        v_cta_dep  := public.conta_cuenta_especial(NEW.company_id, NEW.project_id, 'depreciacion_acumulada');
        v_cta_gdep := public.conta_cuenta_especial(NEW.company_id, NEW.project_id, 'gasto_depreciacion');

        FOR v_recib IN 1..GREATEST(1, floor(v_l.cantidad)::int) LOOP
          v_codigo := 'AF-' || lpad(
            public.compras_siguiente_correlativo(NEW.company_id, NEW.project_id, 'activo_fijo')::text, 6, '0');
          INSERT INTO public.activos_fijos
            (company_id, project_id, codigo, nombre, fecha_alta, costo,
             cuenta_activo_id, cuenta_dep_acum_id, cuenta_gasto_dep_id,
             proveedor_id, recepcion_linea_id, notas)
          VALUES (NEW.company_id, NEW.project_id, v_codigo, v_l.descripcion, NEW.fecha,
                  v_l.costo_unitario, COALESCE(v_l.cuenta_id, v_cta_af), v_cta_dep, v_cta_gdep,
                  v_oc.proveedor_id, v_l.rl_id,
                  'Alta automática por recepción ' || COALESCE(NEW.numero, NEW.id::text));
        END LOOP;
      END IF;
    END LOOP;

    -- ─ Estado de la orden ──────────────────────────────────────────────────
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida < cantidad;
    SELECT COUNT(*) INTO v_con_recibido FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida > 0;
    -- Una entrega totalmente rechazada no cambia el estado: no se recibió nada.
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_pend = 0 THEN 'recibida'
                         WHEN v_con_recibido = 0 THEN estado
                         ELSE 'recibida_parcial' END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;

    -- ─ Asiento GR/IR ───────────────────────────────────────────────────────
    -- Dr por destino (cuenta de la línea si la trae; si no, el mapeo del
    -- evento) contra Cr `compras_por_facturar`. Agrupado por cuenta para no
    -- escribir diez líneas de la misma cuenta.
    WITH destinos AS (
      SELECT ocl.cuenta_id,
             CASE ocl.destino_tipo
               WHEN 'inventario'  THEN 'inventario'
               WHEN 'activo_fijo' THEN 'activo_fijo'
               ELSE CASE WHEN COALESCE(ocl.categoria, 'otros') IN
                          ('mantenimiento','servicios','administrativo','seguridad','limpieza','obras')
                         THEN 'gasto_' || ocl.categoria ELSE 'gasto_otros' END
             END AS evento,
             rl.total
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id AND rl.cantidad > 0
    ), agrupado AS (
      SELECT cuenta_id, evento, SUM(total) AS monto FROM destinos GROUP BY cuenta_id, evento
    )
    SELECT jsonb_agg(CASE WHEN cuenta_id IS NOT NULL
                          THEN jsonb_build_object('cuenta_id', cuenta_id, 'debe', monto)
                          ELSE jsonb_build_object('evento', evento, 'debe', monto) END),
           SUM(monto)
      INTO v_lineas, v_total
      FROM agrupado;

    IF COALESCE(v_total, 0) > 0 THEN
      SELECT nombre INTO v_prov FROM public.proveedores WHERE id = v_oc.proveedor_id;
      v_moneda := COALESCE(v_oc.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id));

      PERFORM public.conta_generar_asiento(
        NEW.company_id, NEW.project_id, 'recepciones', NEW.id, 'recepcion_registrada',
        NEW.fecha,
        'Recepción ' || COALESCE(NEW.numero, '') || ' — OC ' || COALESCE(v_oc.numero, v_oc.concepto)
          || COALESCE(' — ' || v_prov, ''),
        'diario', v_moneda,
        v_lineas || jsonb_build_array(
          jsonb_build_object('evento', 'compras_por_facturar', 'haber', v_total,
                             'descripcion', 'Pendiente de facturación'))
      );
    END IF;

    PERFORM set_config('conta.allow_system_write', v_prev, true);
    RETURN NEW;
  END IF;

  -- ─ Anular ────────────────────────────────────────────────────────────────
  IF NEW.estado = 'anulada' AND OLD.estado = 'registrada' THEN
    PERFORM set_config('conta.allow_system_write', 'on', true);

    FOR v_l IN
      SELECT rl.id AS rl_id, rl.cantidad, rl.costo_unitario,
             ocl.id AS ocl_id, ocl.destino_tipo, ocl.suministro_id, ocl.cantidad_facturada
      FROM public.recepcion_lineas rl
      JOIN public.orden_compra_lineas ocl ON ocl.id = rl.orden_compra_linea_id
      WHERE rl.recepcion_id = NEW.id AND rl.cantidad > 0
      ORDER BY ocl.linea
      FOR UPDATE OF ocl
    LOOP
      -- Lo ya facturado no se puede "des-recibir": primero se anula la factura.
      IF v_l.cantidad_facturada > 0 THEN
        RAISE EXCEPTION 'COMPRAS_RECEPCION_FACTURADA: la línea ya tiene % facturada; anula primero la factura.',
          v_l.cantidad_facturada USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.orden_compra_lineas
         SET cantidad_recibida = GREATEST(0, cantidad_recibida - v_l.cantidad), updated_at = now()
       WHERE id = v_l.ocl_id;

      -- El kardex no se reescribe: se compensa con una salida, que es lo que
      -- de verdad pasó (entró y volvió a salir).
      IF v_l.destino_tipo = 'inventario' AND v_l.suministro_id IS NOT NULL THEN
        INSERT INTO public.movimientos_suministro
          (company_id, suministro_id, tipo, cantidad, motivo, fecha, costo_unitario, origen_tabla, origen_id)
        VALUES (NEW.company_id, v_l.suministro_id, 'salida', v_l.cantidad,
                'Anulación de recepción ' || COALESCE(NEW.numero, ''), CURRENT_DATE,
                v_l.costo_unitario, 'recepcion_lineas_anulada', v_l.rl_id);
      END IF;

      -- Los activos no se borran: se dan de baja con su motivo.
      UPDATE public.activos_fijos
         SET estado = 'dado_de_baja',
             motivo_baja = 'Recepción anulada',
             updated_at = now()
       WHERE recepcion_linea_id = v_l.rl_id AND estado <> 'dado_de_baja';
    END LOOP;

    SELECT COUNT(*) INTO v_recib FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida > 0;
    SELECT COUNT(*) INTO v_pend FROM public.orden_compra_lineas
     WHERE orden_compra_id = NEW.orden_compra_id AND cantidad_recibida < cantidad;
    -- Sin nada recibido, la orden vuelve a donde estaba ANTES de la entrega:
    -- 'emitida' si llegó a enviarse al proveedor, 'aprobada' si no. Forzar
    -- siempre 'emitida' inventaría un envío que quizá nunca ocurrió.
    UPDATE public.ordenes_compra
       SET estado = CASE WHEN v_recib = 0 THEN
                           CASE WHEN emitida_at IS NOT NULL THEN 'emitida' ELSE 'aprobada' END
                         WHEN v_pend = 0 THEN 'recibida'
                         ELSE 'recibida_parcial' END,
           updated_at = now()
     WHERE id = NEW.orden_compra_id;

    PERFORM public.conta_reversar_automatico(NEW.company_id, 'recepciones', NEW.id,
      'recepcion_registrada', 'Recepción anulada');

    PERFORM set_config('conta.allow_system_write', v_prev, true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_recepcion_registrar() FROM PUBLIC, anon, authenticated;

-- ── 2. Orden: condiciones inmutables al emitir y después ────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_oc_ciclo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok       boolean;
  v_separada boolean;
  v_cambia   boolean;
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') = 'on' THEN
    RETURN NEW;   -- recepciones y facturas moviendo el estado de lo comprometido
  END IF;

  -- El solicitante (`created_by`) es el que capturó la orden: no se reasigna,
  -- porque la separación solicitante/aprobador se apoya en él.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'COMPRAS_OC_SOLICITANTE_INMUTABLE: el solicitante de la orden no se cambia.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Aprobada y emitida son documentos congelados ─────────────────────────
  -- La regla anterior solo miraba aprobada → aprobada: una petición directa que
  -- cambiaba el proveedor, la moneda, las condiciones… Y A LA VEZ pasaba la
  -- orden a «emitida» (o a cualquier otro estado) esquivaba el congelamiento, y
  -- una orden ya emitida no tenía candado alguno. Ahora el candado depende del
  -- estado de ORIGEN: cualquier cambio de estas condiciones sobre una orden que
  -- ya no es borrador se rechaza, cambie o no el estado en la misma operación.
  -- Devolver a borrador es una operación PROPIA (estado + motivo, sin tocar
  -- condiciones): invalida la aprobación y recién entonces se edita.
  v_cambia := NEW.proveedor_id      IS DISTINCT FROM OLD.proveedor_id
           OR NEW.moneda            IS DISTINCT FROM OLD.moneda
           OR NEW.project_id        IS DISTINCT FROM OLD.project_id
           OR NEW.company_id        IS DISTINCT FROM OLD.company_id
           OR NEW.contrato_id       IS DISTINCT FROM OLD.contrato_id
           OR NEW.condiciones_pago  IS DISTINCT FROM OLD.condiciones_pago
           OR NEW.dias_credito      IS DISTINCT FROM OLD.dias_credito
           OR NEW.obra_id           IS DISTINCT FROM OLD.obra_id
           OR NEW.fecha_requerida   IS DISTINCT FROM OLD.fecha_requerida;
  IF v_cambia AND OLD.estado = 'aprobada' THEN
    RAISE EXCEPTION 'COMPRAS_OC_APROBADA_CAMBIO: la orden está aprobada y sus condiciones (proveedor, moneda, proyecto, contrato, condiciones de pago, crédito, obra, fecha requerida) no se modifican en silencio, ni en la misma operación que la emite. Devuélvela a borrador indicando el motivo: la aprobación se invalida y queda como revisión.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_cambia AND OLD.estado <> 'borrador' THEN
    RAISE EXCEPTION 'COMPRAS_OC_EMITIDA_CAMBIO: la orden ya está «%» y sus condiciones (proveedor, moneda, proyecto, contrato, condiciones de pago, crédito, obra, fecha requerida) no se modifican. Si el acuerdo cambió, cancela la orden y emite otra.', OLD.estado
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;

  -- ── Máquina de estados ────────────────────────────────────────────────────
  v_ok := CASE OLD.estado
    WHEN 'borrador'         THEN NEW.estado IN ('aprobada', 'cancelada')
    WHEN 'aprobada'         THEN NEW.estado IN ('emitida', 'borrador', 'cancelada')
    WHEN 'emitida'          THEN NEW.estado IN ('cancelada', 'cerrada')
    WHEN 'recibida_parcial' THEN NEW.estado IN ('cerrada')
    WHEN 'recibida'         THEN NEW.estado IN ('cerrada')
    ELSE false                       -- cerrada y cancelada son finales
  END;
  IF NOT v_ok THEN
    IF NEW.estado IN ('recibida', 'recibida_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_OC_RECIBIDA_MANUAL: una orden no se marca como recibida a mano: pasa a «%» cuando se REGISTRA una recepción contra ella.', NEW.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'COMPRAS_OC_TRANSICION_INVALIDA: de «%» a «%» no es un cambio de estado permitido.', OLD.estado, NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cancelar una emitida con recepciones registradas dejaría existencias,
  -- activos y asientos sin orden: se CIERRA (o se anula la recepción primero).
  IF NEW.estado = 'cancelada' AND OLD.estado = 'emitida'
     AND EXISTS (SELECT 1 FROM public.recepciones r
                  WHERE r.orden_compra_id = OLD.id AND r.estado = 'registrada') THEN
    RAISE EXCEPTION 'COMPRAS_OC_CANCELAR_CON_RECEPCION: la orden tiene recepciones registradas; anúlalas primero o cierra la orden.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Devolver a borrador = invalidar la aprobación (revisión) ──────────────
  IF OLD.estado = 'aprobada' AND NEW.estado = 'borrador' THEN
    IF btrim(COALESCE(NEW.motivo_devolucion, '')) = ''
       OR NEW.motivo_devolucion IS NOT DISTINCT FROM OLD.motivo_devolucion THEN
      RAISE EXCEPTION 'COMPRAS_OC_DEVOLUCION_MOTIVO: devolver una orden aprobada a borrador exige indicar el motivo (nuevo en cada devolución).'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.aprobada_por := NULL;
    NEW.aprobada_at  := NULL;
    NEW.revision     := OLD.revision + 1;
  END IF;

  -- ── Separación solicitante / aprobador (si la empresa la activó) ──────────
  IF NEW.estado = 'aprobada' AND OLD.estado = 'borrador' THEN
    SELECT c.aprobacion_separada INTO v_separada
      FROM public.compras_config c WHERE c.company_id = NEW.company_id;
    IF COALESCE(v_separada, false)
       AND NEW.created_by IS NOT NULL AND NEW.created_by = auth.uid() THEN
      RAISE EXCEPTION 'COMPRAS_OC_AUTOAPROBACION: quien solicita la orden no la aprueba; la empresa exige que la apruebe otra persona.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.compras_tg_oc_ciclo() FROM PUBLIC, anon, authenticated;

-- ── 3. Creación transaccional e idempotente de la recepción ─────────────────
ALTER TABLE public.recepciones
  ADD COLUMN IF NOT EXISTS hash_contenido text;

COMMENT ON COLUMN public.recepciones.hash_contenido IS
  'sha256 del contenido solicitado (cabecera + líneas normalizadas) con el que se creó la recepción por compras_recepcion_crear. Distingue el reintento legítimo de una clave de idempotencia reutilizada con otro contenido.';

CREATE OR REPLACE FUNCTION public.compras_recepcion_crear(
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
  v_clave   text := NULLIF(btrim(COALESCE(p_cabecera->>'clave_idempotencia', '')), '');
  v_orden   uuid := NULLIF(p_cabecera->>'orden_compra_id', '')::uuid;
  v_tipo    text := COALESCE(NULLIF(p_cabecera->>'tipo', ''), 'bienes');
  v_fecha   date := COALESCE(NULLIF(p_cabecera->>'fecha', '')::date, CURRENT_DATE);
  v_cab     jsonb;
  v_norm    jsonb;
  v_hash    text;
  v_exist   public.recepciones%ROWTYPE;
  v_rec     public.recepciones%ROWTYPE;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_EMPRESA: falta la empresa de la recepción.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_orden IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_ORDEN: falta la orden de compra de la recepción.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_CLAVE_REQUERIDA: la recepción necesita una clave de idempotencia (una por intento de captura) para que un reintento no la duplique.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'COMPRAS_RECEPCION_VACIA: no se crea una recepción sin líneas.' USING ERRCODE = 'check_violation';
  END IF;

  -- Contenido normalizado: las mismas cifras escritas distinto (40 / 40.0) y el
  -- orden de las líneas NO cambian la huella; un valor distinto sí.
  v_cab := jsonb_build_object(
    'company_id', p_company_id,
    'project_id', p_project_id,
    'orden_compra_id', v_orden,
    'tipo', v_tipo,
    'fecha', v_fecha,
    'documento_referencia', NULLIF(btrim(COALESCE(p_cabecera->>'documento_referencia', '')), ''),
    'destino_fisico',       NULLIF(btrim(COALESCE(p_cabecera->>'destino_fisico', '')), ''),
    'recibido_por',         NULLIF(p_cabecera->>'recibido_por', '')::uuid,
    'respaldo_path',        NULLIF(btrim(COALESCE(p_cabecera->>'respaldo_path', '')), ''),
    'notas',                NULLIF(btrim(COALESCE(p_cabecera->>'notas', '')), ''));

  SELECT jsonb_agg(x.l ORDER BY x.l::text)
    INTO v_norm
    FROM (
      SELECT jsonb_build_object(
               'orden_compra_linea_id', NULLIF(e->>'orden_compra_linea_id', '')::uuid,
               'cantidad',             round(COALESCE(NULLIF(e->>'cantidad', '')::numeric, 0), 4)::text,
               'cantidad_rechazada',   round(COALESCE(NULLIF(e->>'cantidad_rechazada', '')::numeric, 0), 4)::text,
               'motivo_rechazo',       NULLIF(btrim(COALESCE(e->>'motivo_rechazo', '')), ''),
               'costo_unitario',       round(COALESCE(NULLIF(e->>'costo_unitario', '')::numeric, 0), 4)::text,
               'observacion',          NULLIF(btrim(COALESCE(e->>'observacion', '')), '')) AS l
        FROM jsonb_array_elements(p_lineas) e
    ) x;

  v_hash := encode(sha256(convert_to(jsonb_build_object('cabecera', v_cab, 'lineas', v_norm)::text, 'UTF8')), 'hex');

  -- Los intentos simultáneos con la misma clave se ejecutan de uno en uno: el
  -- segundo espera, ve el documento del primero y lo recupera (o se rechaza).
  PERFORM pg_advisory_xact_lock(hashtextextended('compras_recepcion:' || p_company_id::text || ':' || v_clave, 0));

  SELECT * INTO v_exist FROM public.recepciones
   WHERE company_id = p_company_id AND clave_idempotencia = v_clave;

  IF FOUND THEN
    IF v_exist.hash_contenido IS NULL THEN
      RAISE EXCEPTION 'COMPRAS_RECEPCION_CLAVE_SIN_HUELLA: la clave ya identifica una recepción creada fuera de esta función y no se puede verificar que el contenido sea el mismo. Usa otra clave.'
        USING ERRCODE = 'unique_violation';
    END IF;
    IF v_exist.hash_contenido <> v_hash THEN
      RAISE EXCEPTION 'COMPRAS_RECEPCION_CLAVE_CONFLICTO: la clave de idempotencia ya se usó para una recepción con OTRO contenido. Un reintento debe enviar lo mismo; una recepción distinta lleva una clave nueva.'
        USING ERRCODE = 'unique_violation';
    END IF;
    RETURN jsonb_build_object(
      'recepcion', to_jsonb(v_exist),
      'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(rl) ORDER BY rl.created_at, rl.id), '[]'::jsonb)
                   FROM public.recepcion_lineas rl WHERE rl.recepcion_id = v_exist.id),
      'reutilizada', true);
  END IF;

  BEGIN
    INSERT INTO public.recepciones
      (company_id, project_id, orden_compra_id, tipo, fecha, documento_referencia, destino_fisico,
       recibido_por, respaldo_path, clave_idempotencia, hash_contenido, notas, estado)
    VALUES
      (p_company_id, p_project_id, v_orden, v_tipo, v_fecha,
       NULLIF(btrim(COALESCE(p_cabecera->>'documento_referencia', '')), ''),
       NULLIF(btrim(COALESCE(p_cabecera->>'destino_fisico', '')), ''),
       NULLIF(p_cabecera->>'recibido_por', '')::uuid,
       NULLIF(btrim(COALESCE(p_cabecera->>'respaldo_path', '')), ''),
       v_clave, v_hash,
       NULLIF(btrim(COALESCE(p_cabecera->>'notas', '')), ''),
       'borrador')
    RETURNING * INTO v_rec;
  EXCEPTION WHEN unique_violation THEN
    -- La clave la tiene una recepción que esta sesión no ve (otro alcance): no
    -- se revela nada, solo se pide otra clave.
    RAISE EXCEPTION 'COMPRAS_RECEPCION_CLAVE_EN_USO: la clave de idempotencia ya está en uso. Usa otra clave.'
      USING ERRCODE = 'unique_violation';
  END;

  -- Las líneas van en la MISMA transacción: si una falla (línea ajena a la
  -- orden, rechazo sin motivo, cantidad inválida…) se revierte TAMBIÉN la
  -- cabecera y no queda ningún borrador a medias.
  INSERT INTO public.recepcion_lineas
    (company_id, recepcion_id, orden_compra_linea_id, cantidad, cantidad_rechazada,
     motivo_rechazo, costo_unitario, observacion)
  SELECT p_company_id, v_rec.id, r.orden_compra_linea_id, COALESCE(r.cantidad, 0),
         COALESCE(r.cantidad_rechazada, 0), NULLIF(btrim(COALESCE(r.motivo_rechazo, '')), ''),
         COALESCE(r.costo_unitario, 0), NULLIF(btrim(COALESCE(r.observacion, '')), '')
    FROM jsonb_to_recordset(p_lineas) AS r(
      orden_compra_linea_id uuid, cantidad numeric, cantidad_rechazada numeric,
      motivo_rechazo text, costo_unitario numeric, observacion text);

  SELECT * INTO v_rec FROM public.recepciones WHERE id = v_rec.id;
  RETURN jsonb_build_object(
    'recepcion', to_jsonb(v_rec),
    'lineas', (SELECT COALESCE(jsonb_agg(to_jsonb(rl) ORDER BY rl.created_at, rl.id), '[]'::jsonb)
                 FROM public.recepcion_lineas rl WHERE rl.recepcion_id = v_rec.id),
    'reutilizada', false);
END;
$$;

REVOKE ALL ON FUNCTION public.compras_recepcion_crear(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compras_recepcion_crear(uuid, uuid, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.compras_recepcion_crear(uuid, uuid, jsonb, jsonb) IS
  'Crea la recepción (borrador) y sus líneas en una sola transacción, con idempotencia por (empresa, clave) y huella del contenido: mismo contenido = recupera el documento completo; otro contenido = COMPRAS_RECEPCION_CLAVE_CONFLICTO. SECURITY INVOKER: rige la RLS de quien llama.';
