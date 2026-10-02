-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS · BLOQUE B · RECEPCIÓN POR LÍNEA: ACEPTADO / RECHAZADO, SERVICIOS Y
-- CONCURRENCIA
--
-- QUÉ FALTABA
--   · La recepción solo sabía de lo que ENTRÓ: no había forma de dejar por
--     escrito lo rechazado (cantidad, motivo), ni de que una entrega totalmente
--     rechazada quedara registrada.
--   · Un servicio se «recibía» igual que un bien (pasaba por la misma acta), sin
--     responsable que confirmara la prestación ni distinción de documento.
--   · No había dónde decir el destino físico de lo recibido ni adjuntar el
--     respaldo (remisión escaneada, evidencia del servicio).
--   · Doble clic o reintento al CREAR la recepción duplicaba el borrador.
--   · CONCURRENCIA: dos recepciones simultáneas contra la misma orden leían
--     `orden_compra_lineas.cantidad_recibida` sin bloquearla; las dos pasaban el
--     corte de sobre-recepción con el valor viejo y juntas lo superaban.
--
-- QUÉ HACE (aditivo)
--   · `recepcion_lineas.cantidad_rechazada` + `motivo_rechazo` (obligatorio si
--     hay rechazo). `cantidad` sigue siendo lo ACEPTADO: lo único que cuenta como
--     recibido, entra a inventario/activos y se contabiliza. Una línea puede
--     tener `cantidad = 0` si todo se rechazó; pendiente = pedido − aceptado.
--   · `recepciones.tipo` (bienes | servicio), `destino_fisico`, `respaldo_path`
--     y `clave_idempotencia` (única por empresa: el reintento no duplica).
--   · Registrar una conformidad de servicio exige líneas de servicio y un
--     responsable; una recepción de bienes no admite líneas de servicio. Ningún
--     servicio mueve inventario.
--   · El registro BLOQUEA las líneas de la orden (FOR UPDATE) antes de comparar
--     contra lo ya recibido, y se salta lo rechazado.
--   · NO cambia el criterio contable: sigue siendo Dr destino / Cr 2105 por lo
--     aceptado, con la valoración existente (costo de la orden).
--
-- CÓMO REVERTIR
--   Restaurar compras_tg_recepcion_registrar() de 20260821000200;
--   ALTER TABLE public.recepcion_lineas DROP COLUMN cantidad_rechazada, DROP COLUMN motivo_rechazo,
--     (y volver a añadir el CHECK cantidad > 0);
--   ALTER TABLE public.recepciones DROP COLUMN tipo, DROP COLUMN destino_fisico,
--     DROP COLUMN respaldo_path, DROP COLUMN clave_idempotencia;
--
-- IMPACTO EN DATOS: columnas nuevas con default; ninguna fila cambia.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.recepciones
  ADD COLUMN IF NOT EXISTS tipo              text NOT NULL DEFAULT 'bienes',
  ADD COLUMN IF NOT EXISTS destino_fisico    text,
  ADD COLUMN IF NOT EXISTS respaldo_path     text,
  ADD COLUMN IF NOT EXISTS clave_idempotencia text;

ALTER TABLE public.recepciones
  ADD CONSTRAINT recepciones_tipo_check CHECK (tipo IN ('bienes', 'servicio'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_recepciones_clave
  ON public.recepciones (company_id, clave_idempotencia) WHERE clave_idempotencia IS NOT NULL;

COMMENT ON COLUMN public.recepciones.tipo IS
  'bienes = acta de recepción (inventario/activos/gasto); servicio = conformidad del servicio (sin movimiento de inventario).';
COMMENT ON COLUMN public.recepciones.clave_idempotencia IS
  'Identificador que genera el cliente por intento de captura: un reintento o doble clic no crea otro borrador.';

ALTER TABLE public.recepcion_lineas
  ADD COLUMN IF NOT EXISTS cantidad_rechazada numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS motivo_rechazo     text;

-- `cantidad > 0` (CHECK anónimo de 20260821000200) pasa a «aceptada ≥ 0»: una
-- entrega puede rechazarse por completo y debe quedar registrada.
DO $$
DECLARE v_con text;
BEGIN
  SELECT con.conname INTO v_con
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'recepcion_lineas'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ~* '\(cantidad > \(0\)';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.recepcion_lineas DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE public.recepcion_lineas
  ADD CONSTRAINT recepcion_lineas_aceptada_check  CHECK (cantidad >= 0),
  ADD CONSTRAINT recepcion_lineas_rechazo_check   CHECK (cantidad_rechazada >= 0),
  ADD CONSTRAINT recepcion_lineas_algo_check      CHECK (cantidad > 0 OR cantidad_rechazada > 0),
  ADD CONSTRAINT recepcion_lineas_motivo_check    CHECK (cantidad_rechazada = 0 OR btrim(COALESCE(motivo_rechazo, '')) <> '');

COMMENT ON COLUMN public.recepcion_lineas.cantidad IS
  'Cantidad ACEPTADA: la que cuenta como recibida, entra a inventario/activos y se contabiliza.';
COMMENT ON COLUMN public.recepcion_lineas.cantidad_rechazada IS
  'Cantidad RECHAZADA en esta entrega (no cuenta como recibida ni se contabiliza). Exige motivo.';

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
        SELECT id INTO v_cta_af   FROM public.conta_cuentas
          WHERE company_id = NEW.company_id AND project_id IS NOT DISTINCT FROM NEW.project_id AND codigo = '1401';
        SELECT id INTO v_cta_dep  FROM public.conta_cuentas
          WHERE company_id = NEW.company_id AND project_id IS NOT DISTINCT FROM NEW.project_id AND codigo = '1409';
        SELECT id INTO v_cta_gdep FROM public.conta_cuentas
          WHERE company_id = NEW.company_id AND project_id IS NOT DISTINCT FROM NEW.project_id AND codigo = '5107';

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
