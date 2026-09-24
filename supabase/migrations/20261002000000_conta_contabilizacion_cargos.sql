-- ============================================================================
-- CONTABILIZACIÓN DE CARGOS CON LA CONFIGURACIÓN POR TIPO Y LOS AUXILIARES
-- (segunda entrega del bloque «auxiliares con imputación por tipo de cargo»)
--
-- QUÉ SE CONTABILIZA. Sólo documentos NUEVOS, en su evento real:
--   · cuota de condominio CLASIFICADA (tipo_cargo mantenimiento o
--     cuota_extraordinaria) al emitirse (INSERT)          → «cuota_emitida»;
--   · la mora de esa cuota cuando el cron la aplica       → «cuota_mora»,
--     con la configuración del tipo «recargo_mora»;
--   · cargo adicional de unidad al emitirse               → «cargo_adicional_emitido»,
--     con el tipo adicional_<categoría> (desconocida → adicional_otro).
--   Asiento: cargo a la cuenta por cobrar del tipo con el AUXILIAR (el
--   responsable histórico del cargo), la UNIDAD y el TIPO; abono a la cuenta de
--   ingreso del tipo con las mismas dimensiones. Balanceado por construcción.
--
-- QUÉ NO CAMBIA.
--   · Cuotas SIN clasificar (todas las históricas): siguen con el mapeo
--     general (cxc_cuotas / ingreso_cuota), rama por rama como antes.
--   · Agua (registros): intacta.
--   · Nada se contabiliza retroactivamente: los triggers sólo ven documentos
--     nuevos, y el reproceso exige un intento previo registrado por esta
--     lógica —un documento anterior a esta migración no lo tiene—.
--
-- PENDIENTES VISIBLES. Si el tipo no tiene configuración activa, si una
-- cuenta dejó de servir o si el cargo no tiene responsable (sin candidato
-- único), NO se asienta nada —ni parcial, ni con el mapeo general— y queda un
-- intento «pendiente» con su motivo en conta_intentos_contabilizacion, la
-- misma bitácora de las facturas de proveedor. La bandeja
-- conta_cargos_pendientes lo muestra; conta_reprocesar_cargo lo reintenta.
--
-- IDEMPOTENCIA Y CONCURRENCIA. Un evento de un documento = un asiento vivo
-- (índice único uq_conta_asiento_origen, el mismo de siempre). El reproceso
-- BLOQUEA la fila del documento (FOR UPDATE) antes de mirar nada: dos
-- reprocesos, o reproceso y anulación/borrado, se serializan; el segundo ve el
-- asiento del primero y responde «ya contabilizado».
--
-- PERÍODOS. Como las facturas de proveedor: al EMITIR, el generador fecha en
-- el período abierto si el del documento está cerrado (sin cambio); el
-- REPROCESO no re-fecha ni abre períodos: bloquea con «periodo_cerrado».
--
-- REVERSOS. Anular o borrar un cargo adicional, y borrar (duro o suave) una
-- cuota, reversan su asiento con conta_reversar_automatico, como ya ocurría con
-- las cuotas. Los reversos —automáticos y manuales— HEREDAN auxiliar, unidad y
-- tipo de la línea original: sin eso, el saldo por auxiliar no se cancelaría.
--
-- COBROS. El pago de una cuota contabilizada por configuración acredita la
-- MISMA cuenta por cobrar del devengo, con su auxiliar, unidad y tipo, en vez
-- de la CxC del mapeo general. Ningún otro pago cambia.
--
-- PIEZAS COMPARTIDAS QUE SE EXTIENDEN (sin cambiar su comportamiento para los
-- llamadores actuales):
--   · conta_generar_asiento: acepta tres claves opcionales por línea
--     (auxiliar_cliente_id, unidad_id, tipo_cargo). Quien no las manda no las
--     recibe; el resto del cuerpo es idéntico a 20260612000200.
--   · conta_intentos_contabilizacion: admite los dos nuevos orígenes, el
--     disparo «emision», el evento y los motivos nuevos.
--   · conta_tg_cuotas / conta_tg_pagos: sólo las ramas descritas arriba.
--
-- CÓMO SE REVIERTE (en este orden):
--   DROP FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer);
--   DROP FUNCTION public.conta_reprocesar_cargo(text, uuid);
--   DROP TRIGGER trg_conta_cargos_adicionales ON public.cargos_adicionales_unidad;
--   DROP FUNCTION public.conta_tg_cargos_adicionales();
--   restaurar conta_tg_cuotas y conta_tg_pagos de 20260611000200 y
--   conta_generar_asiento de 20260612000200;
--   DROP TRIGGER trg_conta_linea_a_heredar_dimensiones ON public.conta_asiento_lineas;
--   DROP FUNCTION public.conta_tg_linea_heredar_dimensiones();
--   DROP FUNCTION public.conta_contabilizar_cargo_seguro(text, uuid, text, text);
--   DROP FUNCTION public.conta_contabilizar_cargo_interno(text, uuid, text, text);
--   DROP FUNCTION public.conta_registrar_intento_cargo(uuid, uuid, text, uuid, text, text, text, text, text, jsonb, uuid);
--   DROP FUNCTION public.conta_tipo_cargo_de_documento(text, uuid, text);
--   restaurar los CHECK de conta_intentos_contabilizacion y DROP COLUMN evento
--   (tras borrar las filas de los orígenes nuevos, que son sólo historial).
-- ============================================================================

-- ── 1. Bitácora de intentos: nuevos orígenes, disparo, evento y motivos ──────
ALTER TABLE public.conta_intentos_contabilizacion
  ADD COLUMN evento text;

COMMENT ON COLUMN public.conta_intentos_contabilizacion.evento IS
  'Evento contable del intento cuando un documento tiene más de uno (cuota_emitida, cuota_mora, cargo_adicional_emitido). NULL en facturas de proveedor, que tienen uno solo.';

ALTER TABLE public.conta_intentos_contabilizacion
  DROP CONSTRAINT conta_intentos_origen_valido,
  ADD CONSTRAINT conta_intentos_origen_valido
    CHECK (origen_tabla IN ('facturas_proveedor','cuotas_condominio','cargos_adicionales_unidad')),
  DROP CONSTRAINT conta_intentos_disparo_valido,
  ADD CONSTRAINT conta_intentos_disparo_valido
    CHECK (disparo IN ('aprobacion','reproceso','emision')),
  DROP CONSTRAINT conta_intentos_codigo_valido,
  ADD CONSTRAINT conta_intentos_codigo_valido
    CHECK (codigo IS NULL OR codigo IN (
      'sin_cuenta','cuenta_invalida','configuracion_incompleta','reparto_lineas',
      'periodo_cerrado','documento_anulado','documento_no_aprobado',
      'asiento_reversado','error',
      'sin_configuracion','sin_responsable')),
  ADD CONSTRAINT conta_intentos_evento_valido
    CHECK (
      (origen_tabla = 'facturas_proveedor' AND evento IS NULL)
      OR (origen_tabla = 'cuotas_condominio' AND evento IN ('cuota_emitida','cuota_mora'))
      OR (origen_tabla = 'cargos_adicionales_unidad' AND evento = 'cargo_adicional_emitido')
    );

-- ── 2. Registrador de intentos de cargos (INTERNO) ──────────────────────────
-- Gemelo de conta_registrar_intento (que sigue fijo en facturas_proveedor):
-- aquí el origen y el evento son parámetros.
CREATE OR REPLACE FUNCTION public.conta_registrar_intento_cargo(
  p_company_id   uuid,
  p_project_id   uuid,
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_disparo      text,
  p_resultado    text,
  p_codigo       text  DEFAULT NULL,
  p_motivo       text  DEFAULT NULL,
  p_detalle      jsonb DEFAULT '[]'::jsonb,
  p_asiento_id   uuid  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.conta_intentos_contabilizacion
    (company_id, project_id, origen_tabla, origen_id, evento, disparo, resultado,
     codigo, motivo, detalle, asiento_id, actor, created_at)
  VALUES
    (p_company_id, p_project_id, p_origen_tabla, p_origen_id, p_evento, p_disparo, p_resultado,
     p_codigo, p_motivo, COALESCE(p_detalle, '[]'::jsonb), p_asiento_id, auth.uid(),
     -- clock_timestamp y no now(): varios intentos de la misma transacción
     -- (un reproceso con emisión y mora) deben quedar ordenados.
     clock_timestamp())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_registrar_intento_cargo(
  uuid, uuid, text, uuid, text, text, text, text, text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_registrar_intento_cargo(uuid, uuid, text, uuid, text, text, text, text, text, jsonb, uuid) IS
  'INTERNA. Inserta un intento de contabilización de una cuota o un cargo adicional, con auth.uid() como actor. Sin EXECUTE para authenticated.';

-- ── 3. Tipo de cargo de un documento (INTERNO) ──────────────────────────────
-- Nunca se adivina por texto: la cuota trae su tipo explícito; la mora es
-- siempre «recargo_mora»; el cargo adicional deriva de su CATEGORÍA, que es un
-- dominio cerrado del formulario. Devuelve NULL si el documento no está en el
-- alcance (cuota sin clasificar).
CREATE OR REPLACE FUNCTION public.conta_tipo_cargo_de_documento(
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_origen_tabla = 'cuotas_condominio' AND p_evento = 'cuota_emitida' THEN
      (SELECT c.tipo_cargo FROM public.cuotas_condominio c WHERE c.id = p_origen_id)
    WHEN p_origen_tabla = 'cuotas_condominio' AND p_evento = 'cuota_mora' THEN
      CASE WHEN (SELECT c.tipo_cargo FROM public.cuotas_condominio c WHERE c.id = p_origen_id) IS NOT NULL
           THEN 'recargo_mora' END
    WHEN p_origen_tabla = 'cargos_adicionales_unidad' AND p_evento = 'cargo_adicional_emitido' THEN
      (SELECT CASE WHEN ca.categoria IN ('reparacion','exceso_consumo','dano','servicio','multa','otro')
                   THEN 'adicional_' || ca.categoria ELSE 'adicional_otro' END
         FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_origen_id)
  END
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tipo_cargo_de_documento(text, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Generador: dimensiones opcionales por línea ──────────────────────────
-- Cuerpo IDÉNTICO a 20260612000200 salvo el INSERT de líneas, que ahora
-- también lleva auxiliar_cliente_id, unidad_id y tipo_cargo si la línea los
-- trae. Ningún llamador existente los manda: para ellos no cambia nada.
CREATE OR REPLACE FUNCTION public.conta_generar_asiento(
  p_company_id   uuid,
  p_project_id   uuid,
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_fecha        date,
  p_concepto     text,
  p_tipo         text,
  p_moneda_doc   text,
  p_lineas       jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_base       text;
  v_doc        text;
  v_tasa       numeric(12,6) := 1;
  v_publicar   boolean := true;
  v_concepto   text := p_concepto;
  v_fecha      date := COALESCE(p_fecha, CURRENT_DATE);
  v_asiento_id uuid;
  v_linea      jsonb;
  v_cuenta     uuid;
  v_orden      int := 0;
  v_debe       numeric(14,2);
  v_haber      numeric(14,2);
  v_tot_debe   numeric(14,2) := 0;
  v_tot_haber  numeric(14,2) := 0;
  v_diff       numeric(14,2);
BEGIN
  -- Ledger sin catálogo → esa contabilidad aún no opera; salir sin ruido.
  IF NOT EXISTS (
    SELECT 1 FROM public.conta_cuentas
    WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RETURN NULL;
  END IF;

  -- Resolución de cuentas ANTES de insertar: cuenta_id directo (cuenta de
  -- detalle DEL LEDGER) o evento→mapeo del ledger; si falta, no se asienta.
  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    IF v_linea ? 'cuenta_id' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.conta_cuentas
        WHERE id = (v_linea->>'cuenta_id')::uuid
          AND company_id = p_company_id
          AND project_id IS NOT DISTINCT FROM p_project_id
          AND es_detalle
      ) THEN
        RAISE WARNING 'conta_generar_asiento: cuenta_id % no pertenece al ledger (%/%) — asiento % omitido',
          v_linea->>'cuenta_id', p_company_id, p_project_id, p_evento;
        RETURN NULL;
      END IF;
    ELSIF public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento') IS NULL THEN
      RAISE WARNING 'conta_generar_asiento: falta mapeo % en el ledger (%/%) — asiento % omitido',
        v_linea->>'evento', p_company_id, p_project_id, p_evento;
      RETURN NULL;
    END IF;
  END LOOP;

  -- Moneda base DEL LEDGER y conversión cruzada doc→base (pivote = empresa).
  v_base := public.conta_moneda_base(p_company_id, p_project_id);
  v_doc  := COALESCE(public.conta_normalizar_moneda(p_moneda_doc), v_base);

  IF v_doc <> v_base THEN
    v_tasa := public.conta_tasa_entre(p_company_id, v_doc, v_base, v_fecha);
    IF v_tasa IS NULL THEN
      -- Nunca inventar tasa: queda en borrador para revisión manual.
      v_tasa := 1;
      v_publicar := false;
      v_concepto := v_concepto || ' [SIN TIPO DE CAMBIO ' || v_doc || '→' || v_base || ']';
    END IF;
  END IF;

  -- Si el periodo del documento ya está cerrado, el asiento se fecha hoy.
  IF p_project_id IS NOT NULL
     AND public.conta_periodo_cerrado(p_project_id, to_char(v_fecha, 'YYYY-MM')) THEN
    v_fecha := CURRENT_DATE;
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, fecha, tipo, concepto, estado,
    origen, origen_tabla, origen_id, origen_evento, moneda_base
  )
  VALUES (
    p_company_id, p_project_id, v_fecha, p_tipo, v_concepto, 'borrador',
    'automatico', p_origen_tabla, p_origen_id, p_evento, v_base
  )
  ON CONFLICT (company_id, origen_tabla, origen_id, origen_evento)
    WHERE origen = 'automatico' AND estado <> 'anulado'
  DO NOTHING
  RETURNING id INTO v_asiento_id;

  IF v_asiento_id IS NULL THEN
    -- Ya contabilizado (idempotencia).
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RETURN NULL;
  END IF;

  FOR v_linea IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    v_orden := v_orden + 1;
    v_cuenta := CASE WHEN v_linea ? 'cuenta_id' THEN (v_linea->>'cuenta_id')::uuid
                     ELSE public.conta_cuenta_para(p_company_id, p_project_id, v_linea->>'evento')
                END;
    v_debe  := round(COALESCE((v_linea->>'debe')::numeric, 0)  * v_tasa, 2);
    v_haber := round(COALESCE((v_linea->>'haber')::numeric, 0) * v_tasa, 2);
    IF v_debe = 0 AND v_haber = 0 THEN CONTINUE; END IF;

    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber,
      moneda_origen, monto_origen, tipo_cambio,
      auxiliar_cliente_id, unidad_id, tipo_cargo
    )
    VALUES (
      v_asiento_id, p_company_id, v_cuenta, v_orden, v_linea->>'descripcion',
      v_debe, v_haber,
      CASE WHEN v_doc <> v_base THEN v_doc END,
      CASE WHEN v_doc <> v_base THEN COALESCE((v_linea->>'debe')::numeric, 0)
                                      + COALESCE((v_linea->>'haber')::numeric, 0) END,
      CASE WHEN v_doc <> v_base THEN v_tasa END,
      -- Dimensiones opcionales (20261002000000): quien no las manda, no las
      -- recibe. Las valida trg_conta_linea_dimensiones.
      NULLIF(v_linea->>'auxiliar_cliente_id', '')::uuid,
      NULLIF(v_linea->>'unidad_id', '')::uuid,
      NULLIF(v_linea->>'tipo_cargo', '')
    );

    v_tot_debe  := v_tot_debe + v_debe;
    v_tot_haber := v_tot_haber + v_haber;
  END LOOP;

  -- Residuo de redondeo por conversión: se absorbe en la última línea del lado
  -- corto para garantizar debe = haber exacto.
  v_diff := v_tot_debe - v_tot_haber;
  IF v_diff <> 0 THEN
    IF v_diff > 0 THEN
      UPDATE public.conta_asiento_lineas SET haber = haber + v_diff
      WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = v_asiento_id AND haber > 0
                  ORDER BY orden DESC LIMIT 1);
      v_tot_haber := v_tot_haber + v_diff;
    ELSE
      UPDATE public.conta_asiento_lineas SET debe = debe - v_diff
      WHERE id = (SELECT id FROM public.conta_asiento_lineas
                  WHERE asiento_id = v_asiento_id AND debe > 0
                  ORDER BY orden DESC LIMIT 1);
      v_tot_debe := v_tot_debe - v_diff;
    END IF;
  END IF;

  UPDATE public.conta_asientos
  SET total_debe  = v_tot_debe,
      total_haber = v_tot_haber,
      estado      = CASE WHEN v_publicar THEN 'publicado' ELSE 'borrador' END,
      numero      = CASE WHEN v_publicar THEN public.conta_siguiente_folio(p_company_id, p_project_id) END,
      publicado_at = CASE WHEN v_publicar THEN now() END,
      updated_at  = now()
  WHERE id = v_asiento_id;

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_asiento_id;
EXCEPTION WHEN OTHERS THEN
  -- La contabilidad nunca rompe la operación de negocio.
  RAISE WARNING 'conta_generar_asiento(%/%/%): %', p_origen_tabla, p_origen_id, p_evento, SQLERRM;
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN NULL;
END;
$$;

-- ── 5. Reversos: heredar las dimensiones de la línea original ───────────────
-- conta_reversar_automatico y conta_anular_asiento copian cuenta, importes y
-- moneda de cada línea, pero no las dimensiones nuevas. Sin ellas el reverso
-- cancelaría el saldo de la CUENTA pero no el del AUXILIAR. En vez de reescribir
-- esas dos funciones, la línea de un asiento que es reverso de otro (reversa_de_id)
-- y llega sin dimensiones las toma de la línea original del mismo orden y cuenta.
-- El nombre ordena este trigger ANTES de trg_conta_linea_dimensiones, que las
-- valida.
CREATE OR REPLACE FUNCTION public.conta_tg_linea_heredar_dimensiones()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_original uuid;
  r          record;
BEGIN
  IF NEW.auxiliar_cliente_id IS NOT NULL OR NEW.unidad_id IS NOT NULL OR NEW.tipo_cargo IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.reversa_de_id INTO v_original
    FROM public.conta_asientos a WHERE a.id = NEW.asiento_id;
  IF v_original IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo INTO r
    FROM public.conta_asiento_lineas l
   WHERE l.asiento_id = v_original AND l.orden = NEW.orden AND l.cuenta_id = NEW.cuenta_id
   LIMIT 1;
  IF FOUND THEN
    NEW.auxiliar_cliente_id := r.auxiliar_cliente_id;
    NEW.unidad_id           := r.unidad_id;
    NEW.tipo_cargo          := r.tipo_cargo;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_linea_heredar_dimensiones() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_linea_a_heredar_dimensiones
  BEFORE INSERT ON public.conta_asiento_lineas
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_linea_heredar_dimensiones();

-- ── 6. El contabilizador de cargos (INTERNO) ────────────────────────────────
-- Única lógica para la emisión (triggers) y el reproceso. Diagnostica ANTES de
-- generar —configuración, cuentas, responsable— y registra el intento en la
-- misma transacción que el asiento. Nada parcial: o el asiento entero o
-- ninguno.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cargo_interno(
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_disparo      text
)
RETURNS TABLE (
  resultado  text,
  codigo     text,
  motivo     text,
  asiento_id uuid,
  intento_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company   uuid;
  v_project   uuid;
  v_unidad    uuid;
  v_resp      uuid;
  v_monto     numeric(14,2);
  v_fecha     date;
  v_concepto  text;
  v_tipo      text;
  v_etiqueta  text;
  v_cfg       record;
  v_cuenta    record;
  v_moneda    text;
  v_codigo    text;
  v_motivo    text;
  v_asiento   uuid;
  v_intento   uuid;
BEGIN
  IF p_disparo NOT IN ('emision','reproceso') THEN
    RAISE EXCEPTION 'conta_contabilizar_cargo_interno: disparo inválido %', p_disparo USING ERRCODE = '22023';
  END IF;

  -- ── El documento ──────────────────────────────────────────────────────────
  IF p_origen_tabla = 'cuotas_condominio' AND p_evento IN ('cuota_emitida','cuota_mora') THEN
    SELECT c.company_id, c.project_id, c.unidad_id, c.responsable_cliente_id,
           CASE WHEN p_evento = 'cuota_emitida' THEN c.monto ELSE c.mora_monto END,
           c.created_at::date,
           CASE WHEN p_evento = 'cuota_emitida'
                THEN 'Cuota ' || c.concepto || ' ' || c.periodo
                ELSE 'Mora aplicada — cuota ' || c.concepto || ' ' || c.periodo END
      INTO v_company, v_project, v_unidad, v_resp, v_monto, v_fecha, v_concepto
      FROM public.cuotas_condominio c WHERE c.id = p_origen_id;
  ELSIF p_origen_tabla = 'cargos_adicionales_unidad' AND p_evento = 'cargo_adicional_emitido' THEN
    SELECT ca.company_id, ca.project_id, ca.unidad_id, ca.responsable_cliente_id,
           ca.monto, ca.fecha_cargo, 'Cargo adicional ' || ca.concepto
      INTO v_company, v_project, v_unidad, v_resp, v_monto, v_fecha, v_concepto
      FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_origen_id;
  ELSE
    RAISE EXCEPTION 'conta_contabilizar_cargo_interno: origen/evento inválido %/%', p_origen_tabla, p_evento
      USING ERRCODE = '22023';
  END IF;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'conta_contabilizar_cargo_interno: documento % inexistente', p_origen_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_tipo := public.conta_tipo_cargo_de_documento(p_origen_tabla, p_origen_id, p_evento);
  SELECT t.etiqueta INTO v_etiqueta FROM public.conta_tipos_cargo() t WHERE t.tipo_cargo = v_tipo;

  -- ── Diagnóstico, en orden: el primer motivo manda ────────────────────────
  SELECT cfg.* INTO v_cfg
    FROM public.conta_config_tipo_cargo cfg
   WHERE cfg.company_id = v_company
     AND cfg.project_id IS NOT DISTINCT FROM v_project
     AND cfg.tipo_cargo = v_tipo;

  IF v_tipo IS NULL THEN
    v_codigo := 'sin_configuracion';
    v_motivo := 'El documento no tiene tipo de cargo: no se contabiliza con la configuración por tipo.';
  ELSIF NOT FOUND THEN
    v_codigo := 'sin_configuracion';
    v_motivo := format('Falta la configuración contable del tipo «%s» en esta contabilidad. Configúrala en Contabilidad › Tipos de cargo y reprocesa.',
                       COALESCE(v_etiqueta, v_tipo));
  ELSIF NOT v_cfg.activa THEN
    v_codigo := 'sin_configuracion';
    v_motivo := format('La configuración del tipo «%s» está desactivada. Actívala en Contabilidad › Tipos de cargo y reprocesa.',
                       COALESCE(v_etiqueta, v_tipo));
  END IF;

  IF v_codigo IS NULL THEN
    FOR v_cuenta IN
      SELECT x.rol, x.cuenta_id, x.tipo_esperado, c.id AS existe, c.company_id, c.project_id,
             c.es_detalle, c.activa, c.tipo, c.codigo
        FROM (VALUES ('por cobrar', v_cfg.cuenta_cxc_id, 'activo'),
                     ('de ingreso', v_cfg.cuenta_ingreso_id, 'ingreso')) AS x(rol, cuenta_id, tipo_esperado)
        LEFT JOIN public.conta_cuentas c ON c.id = x.cuenta_id
    LOOP
      IF v_cuenta.existe IS NULL
         OR v_cuenta.company_id <> v_company
         OR v_cuenta.project_id IS DISTINCT FROM v_project
         OR NOT v_cuenta.es_detalle OR NOT v_cuenta.activa
         OR v_cuenta.tipo <> v_cuenta.tipo_esperado THEN
        v_codigo := 'cuenta_invalida';
        v_motivo := format('La cuenta %s (%s) configurada para «%s» ya no sirve: tiene que ser de esta contabilidad, de detalle, activa y de tipo %s. Corrígela en Tipos de cargo y reprocesa.',
                           v_cuenta.rol, COALESCE(v_cuenta.codigo, '¿?'), COALESCE(v_etiqueta, v_tipo), v_cuenta.tipo_esperado);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_codigo IS NULL AND v_resp IS NULL THEN
    v_codigo := 'sin_responsable';
    v_motivo := 'El cargo no tiene responsable (no hubo un candidato único al emitirlo). Asigna el responsable del cargo y reprocesa: sin él el movimiento no tendría auxiliar.';
  END IF;

  IF v_codigo IS NULL AND COALESCE(v_monto, 0) <= 0 THEN
    v_codigo := 'error';
    v_motivo := 'El documento no tiene importe que contabilizar.';
  END IF;

  IF v_codigo IS NOT NULL THEN
    RAISE WARNING 'conta_contabilizar_cargo_interno: %/% (%) pendiente (%) — asiento omitido',
      p_origen_tabla, p_origen_id, p_evento, v_codigo;
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
      'pendiente', v_codigo, v_motivo, '[]'::jsonb, NULL);
    RETURN QUERY SELECT 'pendiente'::text, v_codigo, v_motivo, NULL::uuid, v_intento;
    RETURN;
  END IF;

  -- ── El asiento ────────────────────────────────────────────────────────────
  SELECT COALESCE(pr.moneda_condominios, pr.moneda) INTO v_moneda
    FROM public.projects pr WHERE pr.id = v_project;

  v_asiento := public.conta_generar_asiento(
    v_company, v_project, p_origen_tabla, p_origen_id, p_evento,
    v_fecha, v_concepto, 'diario', v_moneda,
    jsonb_build_array(
      jsonb_build_object('cuenta_id', v_cfg.cuenta_cxc_id, 'debe', v_monto,
                         'descripcion', COALESCE(v_etiqueta, v_tipo),
                         'auxiliar_cliente_id', v_resp, 'unidad_id', v_unidad, 'tipo_cargo', v_tipo),
      jsonb_build_object('cuenta_id', v_cfg.cuenta_ingreso_id, 'haber', v_monto,
                         'descripcion', COALESCE(v_etiqueta, v_tipo),
                         'auxiliar_cliente_id', v_resp, 'unidad_id', v_unidad, 'tipo_cargo', v_tipo)
    )
  );

  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
      'contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  -- El generador no creó nada: o ya existía (idempotencia) o falló por algo
  -- que el diagnóstico no previó y sólo quedó en el log.
  SELECT a.id INTO v_asiento FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.origen = 'automatico'
     AND a.origen_tabla = p_origen_tabla AND a.origen_id = p_origen_id
     AND a.origen_evento = p_evento AND a.estado <> 'anulado'
   ORDER BY a.created_at DESC LIMIT 1;

  IF v_asiento IS NOT NULL THEN
    v_intento := public.conta_registrar_intento_cargo(
      v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
      'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_asiento);
    RETURN QUERY SELECT 'ya_contabilizada'::text, NULL::text, NULL::text, v_asiento, v_intento;
    RETURN;
  END IF;

  v_intento := public.conta_registrar_intento_cargo(
    v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
    'pendiente', 'error',
    'El generador de asientos no produjo el asiento. Revisa la configuración y vuelve a intentar; si persiste, consulta el registro del servidor.',
    '[]'::jsonb, NULL);
  RETURN QUERY SELECT 'pendiente'::text, 'error'::text,
    'El generador de asientos no produjo el asiento.'::text, NULL::uuid, v_intento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cargo_interno(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_contabilizar_cargo_interno(text, uuid, text, text) IS
  'INTERNA. Única lógica de devengo de cuotas clasificadas, su mora y cargos adicionales, compartida por la emisión (triggers) y el reproceso. Diagnostica, genera el asiento o ninguno, y registra el intento.';

-- Envoltura para los TRIGGERS: la contabilidad nunca rompe la operación de
-- negocio. Un error inesperado queda en el log y en un intento «error»
-- (visible en la bandeja), y el INSERT/UPDATE del documento sigue.
CREATE OR REPLACE FUNCTION public.conta_contabilizar_cargo_seguro(
  p_origen_tabla text,
  p_origen_id    uuid,
  p_evento       text,
  p_disparo      text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_project uuid;
BEGIN
  BEGIN
    PERFORM public.conta_contabilizar_cargo_interno(p_origen_tabla, p_origen_id, p_evento, p_disparo);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'conta_contabilizar_cargo_seguro(%/%/%): %', p_origen_tabla, p_origen_id, p_evento, SQLERRM;
    BEGIN
      IF p_origen_tabla = 'cuotas_condominio' THEN
        SELECT c.company_id, c.project_id INTO v_company, v_project
          FROM public.cuotas_condominio c WHERE c.id = p_origen_id;
      ELSE
        SELECT ca.company_id, ca.project_id INTO v_company, v_project
          FROM public.cargos_adicionales_unidad ca WHERE ca.id = p_origen_id;
      END IF;
      IF v_company IS NOT NULL THEN
        PERFORM public.conta_registrar_intento_cargo(
          v_company, v_project, p_origen_tabla, p_origen_id, p_evento, p_disparo,
          'pendiente', 'error',
          'Error inesperado al contabilizar. Reprocesa; si persiste, consulta el registro del servidor.',
          '[]'::jsonb, NULL);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'conta_contabilizar_cargo_seguro: no se pudo registrar el intento: %', SQLERRM;
    END;
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_contabilizar_cargo_seguro(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- ── 7. Trigger de CUOTAS: rama clasificada ──────────────────────────────────
-- Cuerpo IDÉNTICO a 20260611000200 salvo dos ramas nuevas, ANTES de las de
-- siempre: emisión y mora de una cuota con tipo_cargo van al contabilizador de
-- cargos. Borrado duro/suave y reversos: sin cambios (el evento es el mismo,
-- «cuota_emitida»/«cuota_mora», así que el reverso encuentra el asiento).
CREATE OR REPLACE FUNCTION public.conta_tg_cuotas()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_moneda text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'cuotas_condominio', OLD.id,
      'cuota_emitida', 'Cuota eliminada');
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'cuotas_condominio', OLD.id,
      'cuota_mora', 'Cuota eliminada');
    RETURN OLD;
  END IF;

  -- Soft delete → reverso.
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'cuotas_condominio', NEW.id,
      'cuota_emitida', 'Cuota eliminada');
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'cuotas_condominio', NEW.id,
      'cuota_mora', 'Cuota eliminada');
    RETURN NEW;
  END IF;

  SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
  FROM public.projects WHERE id = NEW.project_id;

  -- Devengo al emitir (INSERT). Una cuota CLASIFICADA (tipo_cargo) se
  -- contabiliza con la configuración por tipo de cargo y sus auxiliares; una
  -- sin clasificar, con el mapeo general, exactamente como antes.
  IF TG_OP = 'INSERT' AND COALESCE(NEW.monto, 0) > 0 AND NEW.deleted_at IS NULL
     AND NEW.tipo_cargo IS NOT NULL THEN
    PERFORM public.conta_contabilizar_cargo_seguro('cuotas_condominio', NEW.id, 'cuota_emitida', 'emision');
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND COALESCE(NEW.monto, 0) > 0 AND NEW.deleted_at IS NULL THEN
    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'cuotas_condominio', NEW.id, 'cuota_emitida',
      CURRENT_DATE,
      'Cuota ' || NEW.concepto || ' ' || NEW.periodo,
      'diario', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', 'cxc_cuotas', 'debe', NEW.monto),
        jsonb_build_object('evento', 'ingreso_cuota', 'haber', NEW.monto)
      )
    );
    RETURN NEW;
  END IF;

  -- Mora aplicada por el cron. Cuota clasificada → tipo «recargo_mora».
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.mora_monto, 0) > 0 AND COALESCE(OLD.mora_monto, 0) = 0
     AND NEW.deleted_at IS NULL AND NEW.tipo_cargo IS NOT NULL THEN
    PERFORM public.conta_contabilizar_cargo_seguro('cuotas_condominio', NEW.id, 'cuota_mora', 'emision');
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.mora_monto, 0) > 0 AND COALESCE(OLD.mora_monto, 0) = 0
     AND NEW.deleted_at IS NULL THEN
    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'cuotas_condominio', NEW.id, 'cuota_mora',
      CURRENT_DATE,
      'Mora aplicada — cuota ' || NEW.concepto || ' ' || NEW.periodo,
      'diario', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', 'cxc_cuotas', 'debe', NEW.mora_monto),
        jsonb_build_object('evento', 'ingreso_mora', 'haber', NEW.mora_monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ── 8. Trigger de PAGOS: el cobro de una cuota clasificada ──────────────────
-- Cuerpo IDÉNTICO a 20260611000200 salvo el bloque previo a generar el asiento
-- del pago: si la cuota que abona (pagos.cuota_id o cuotas.pago_id) se
-- contabilizó por configuración, se acredita esa misma cuenta por cobrar con
-- sus dimensiones. Si no, todo sigue igual.
CREATE OR REPLACE FUNCTION public.conta_tg_pagos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_project    uuid;
  v_company    uuid;
  v_moneda     text;
  v_metodo     text;
  v_contra     text;
  v_es_cuota   boolean;
  v_reg_estado text;
  v_cxc        record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Hard delete de un pago contabilizado → reverso (company vía proyecto).
    v_project := COALESCE(OLD.project_id, (SELECT project_id FROM public.clientes WHERE id = OLD.cliente_id));
    SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
    IF v_company IS NOT NULL THEN
      PERFORM public.conta_reversar_automatico(v_company, 'pagos', OLD.id,
        'pago_contabilizado', 'Pago eliminado');
    END IF;
    RETURN OLD;
  END IF;

  v_project := COALESCE(NEW.project_id, (SELECT project_id FROM public.clientes WHERE id = NEW.cliente_id));
  SELECT company_id INTO v_company FROM public.projects WHERE id = v_project;
  IF v_company IS NULL THEN
    RETURN NEW;
  END IF;

  -- Reverso: rechazado o soft-delete después de contabilizado.
  IF TG_OP = 'UPDATE'
     AND OLD.estado IN ('verificado','aplicado')
     AND (NEW.estado = 'rechazado'
          OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)) THEN
    PERFORM public.conta_reversar_automatico(v_company, 'pagos', NEW.id,
      'pago_contabilizado',
      CASE WHEN NEW.estado = 'rechazado' THEN 'Pago rechazado' ELSE 'Pago eliminado' END);
    RETURN NEW;
  END IF;

  -- Contabilizar: primera transición a verificado/aplicado (pago vivo).
  IF NEW.estado IN ('verificado','aplicado')
     AND NEW.deleted_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado NOT IN ('verificado','aplicado'))
     AND COALESCE(NEW.monto, 0) > 0 THEN

    v_metodo := CASE NEW.metodo
      WHEN 'efectivo'        THEN 'metodo_efectivo'
      WHEN 'transferencia'   THEN 'metodo_transferencia'
      WHEN 'deposito'        THEN 'metodo_deposito'
      WHEN 'cheque'          THEN 'metodo_cheque'
      WHEN 'tarjeta_credito' THEN 'metodo_tarjeta'
      WHEN 'tarjeta_debito'  THEN 'metodo_tarjeta'
      WHEN 'paypal'          THEN 'metodo_pasarela'
      ELSE 'metodo_otro'
    END;

    -- Contrapartida: CxC si el documento origen ya devengó; ingreso directo si no.
    v_es_cuota := EXISTS (SELECT 1 FROM public.cuotas_condominio WHERE pago_id = NEW.id);
    IF NEW.registro_id IS NOT NULL THEN
      SELECT factura_estado INTO v_reg_estado FROM public.registros WHERE id = NEW.registro_id;
      v_contra := CASE WHEN v_reg_estado IN ('emitida','vencida','pagada')
                       THEN 'cxc_agua' ELSE 'ingreso_agua' END;
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    ELSIF v_es_cuota THEN
      v_contra := 'cxc_cuotas';
      SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
      FROM public.projects WHERE id = v_project;
    ELSE
      v_contra := 'ingreso_otros';
      SELECT moneda INTO v_moneda FROM public.projects WHERE id = v_project;
    END IF;

    -- Cuota contabilizada por configuración (20261002000000): el cobro
    -- acredita la MISMA cuenta por cobrar del devengo, con su auxiliar,
    -- unidad y tipo. Así el saldo del cliente en la CxC compartida baja
    -- donde subió y el ingreso no se reconoce dos veces. Cualquier otro pago
    -- sigue exactamente igual que antes.
    SELECT l.cuenta_id, l.auxiliar_cliente_id, l.unidad_id, l.tipo_cargo
      INTO v_cxc
      FROM public.cuotas_condominio cq
      JOIN public.conta_asientos a
        ON a.company_id = v_company AND a.origen = 'automatico'
       AND a.origen_tabla = 'cuotas_condominio' AND a.origen_id = cq.id
       AND a.origen_evento = 'cuota_emitida'
       AND a.estado = 'publicado' AND a.anulado_por_id IS NULL
      JOIN public.conta_asiento_lineas l
        ON l.asiento_id = a.id AND l.debe > 0 AND l.tipo_cargo IS NOT NULL
     WHERE cq.id = COALESCE(NEW.cuota_id,
             (SELECT cq2.id FROM public.cuotas_condominio cq2 WHERE cq2.pago_id = NEW.id LIMIT 1))
     ORDER BY l.orden
     LIMIT 1;

    IF v_cxc.cuenta_id IS NOT NULL THEN
      SELECT COALESCE(moneda_condominios, moneda) INTO v_moneda
      FROM public.projects WHERE id = v_project;
      PERFORM public.conta_generar_asiento(
        v_company, v_project, 'pagos', NEW.id, 'pago_contabilizado',
        COALESCE(NEW.verified_at::date, CURRENT_DATE),
        'Pago ' || NEW.metodo || COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
        'ingreso', v_moneda,
        jsonb_build_array(
          jsonb_build_object('evento', v_metodo, 'debe', NEW.monto),
          jsonb_build_object('cuenta_id', v_cxc.cuenta_id, 'haber', NEW.monto,
                             'auxiliar_cliente_id', v_cxc.auxiliar_cliente_id,
                             'unidad_id', v_cxc.unidad_id,
                             'tipo_cargo', v_cxc.tipo_cargo)
        )
      );
      RETURN NEW;
    END IF;

    PERFORM public.conta_generar_asiento(
      v_company, v_project, 'pagos', NEW.id, 'pago_contabilizado',
      COALESCE(NEW.verified_at::date, CURRENT_DATE),
      'Pago ' || NEW.metodo || COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
      'ingreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_metodo, 'debe', NEW.monto),
        jsonb_build_object('evento', v_contra, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ── 9. Trigger de CARGOS ADICIONALES ────────────────────────────────────────
-- Devengo al emitir (INSERT con importe y no anulado). Reverso al anular o
-- borrar. El responsable ya está fijado por tg_responsable_cargo_ins (BEFORE).
CREATE OR REPLACE FUNCTION public.conta_tg_cargos_adicionales()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'cargos_adicionales_unidad', OLD.id,
      'cargo_adicional_emitido', 'Cargo adicional eliminado');
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.estado = 'anulado' AND OLD.estado IS DISTINCT FROM 'anulado' THEN
      PERFORM public.conta_reversar_automatico(NEW.company_id, 'cargos_adicionales_unidad', NEW.id,
        'cargo_adicional_emitido', 'Cargo adicional anulado');
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.monto, 0) > 0 AND NEW.estado IS DISTINCT FROM 'anulado' THEN
    PERFORM public.conta_contabilizar_cargo_seguro('cargos_adicionales_unidad', NEW.id,
      'cargo_adicional_emitido', 'emision');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_cargos_adicionales() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_cargos_adicionales
  AFTER INSERT OR UPDATE OF estado OR DELETE ON public.cargos_adicionales_unidad
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cargos_adicionales();

-- ── 10. Reproceso de UN documento ───────────────────────────────────────────
-- Recibe el origen y el id. Empresa, proyecto y estado salen de la fila, que
-- se BLOQUEA antes de mirar nada. Reprocesa cada evento del documento que
-- tenga intentos y no tenga asiento; devuelve una fila por evento.
CREATE OR REPLACE FUNCTION public.conta_reprocesar_cargo(
  p_origen_tabla text,
  p_origen_id    uuid
)
RETURNS TABLE (
  evento         text,
  resultado      text,
  codigo         text,
  motivo         text,
  asiento_id     uuid,
  asiento_numero bigint,
  asiento_estado text,
  intento_id     uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company  uuid;
  v_doc_co   uuid;
  v_project  uuid;
  v_anulado  boolean;
  v_fecha    date;
  v_evento   text;
  v_a        record;
  v_res      record;
  v_intento  uuid;
  v_periodo  text;
  v_alguno   boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;

  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: la sesión no tiene empresa activa.' USING ERRCODE = '42501';
  END IF;

  -- Genera y publica un asiento: exige crear Y cambiar estado.
  IF NOT (public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status')) THEN
    RAISE EXCEPTION 'No autorizado para contabilizar cargos.' USING ERRCODE = '42501';
  END IF;

  IF p_origen_tabla IS NULL OR p_origen_tabla NOT IN ('cuotas_condominio','cargos_adicionales_unidad') THEN
    RAISE EXCEPTION 'Origen inválido: %', p_origen_tabla USING ERRCODE = '22023';
  END IF;
  IF p_origen_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere el id del documento.' USING ERRCODE = '22023';
  END IF;

  -- BLOQUEO: serializa con otro reproceso, con la anulación y con el borrado.
  -- Otra empresa o un proyecto no autorizado responden igual que un
  -- documento inexistente: no se confirma la existencia de lo ajeno.
  IF p_origen_tabla = 'cuotas_condominio' THEN
    SELECT c.company_id, c.project_id, c.deleted_at IS NOT NULL, c.created_at::date
      INTO v_doc_co, v_project, v_anulado, v_fecha
      FROM public.cuotas_condominio c
     WHERE c.id = p_origen_id AND c.company_id = v_company
       AND public.can_access_project(c.project_id)
       FOR UPDATE;
  ELSE
    SELECT ca.company_id, ca.project_id, ca.estado = 'anulado', ca.fecha_cargo
      INTO v_doc_co, v_project, v_anulado, v_fecha
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.id = p_origen_id AND ca.company_id = v_company
       AND public.can_access_project(ca.project_id)
       FOR UPDATE;
  END IF;

  IF v_doc_co IS NULL THEN
    RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_inexistente'::text,
      'El documento no existe o no está en tu ámbito.'::text,
      NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  FOR v_evento IN
    SELECT DISTINCT i.evento
      FROM public.conta_intentos_contabilizacion i
     WHERE i.origen_tabla = p_origen_tabla AND i.origen_id = p_origen_id
     ORDER BY 1
  LOOP
    v_alguno := true;

    IF v_anulado THEN
      v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
        v_evento, 'reproceso', 'bloqueada', 'documento_anulado',
        'El documento está anulado o eliminado: no se contabiliza.', '[]'::jsonb, NULL);
      RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'documento_anulado'::text,
        'El documento está anulado o eliminado: no se contabiliza.'::text,
        NULL::uuid, NULL::bigint, NULL::text, v_intento;
      CONTINUE;
    END IF;

    -- ¿Ya tiene asiento? Vivo → ya contabilizado. Reversado o anulado → no
    -- se recrea: eso lo decide una persona, no un botón.
    SELECT a.id, a.numero, a.estado, a.anulado_por_id INTO v_a
      FROM public.conta_asientos a
     WHERE a.company_id = v_doc_co AND a.origen = 'automatico'
       AND a.origen_tabla = p_origen_tabla AND a.origen_id = p_origen_id
       AND a.origen_evento = v_evento
     ORDER BY (a.estado <> 'anulado' AND a.anulado_por_id IS NULL) DESC, a.created_at DESC
     LIMIT 1;

    IF FOUND THEN
      IF v_a.estado <> 'anulado' AND v_a.anulado_por_id IS NULL THEN
        v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
          v_evento, 'reproceso', 'ya_contabilizada', NULL, NULL, '[]'::jsonb, v_a.id);
        RETURN QUERY SELECT v_evento, 'ya_contabilizada'::text, NULL::text,
          'El documento ya está contabilizado.'::text,
          v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
      ELSE
        v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
          v_evento, 'reproceso', 'bloqueada', 'asiento_reversado',
          'El asiento de este documento fue anulado o reversado: no se recrea automáticamente.',
          '[]'::jsonb, v_a.id);
        RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'asiento_reversado'::text,
          'El asiento de este documento fue anulado o reversado: no se recrea automáticamente.'::text,
          v_a.id, v_a.numero::bigint, v_a.estado::text, v_intento;
      END IF;
      CONTINUE;
    END IF;

    -- Período cerrado: el reproceso no re-fecha ni abre el período.
    v_periodo := to_char(v_fecha, 'YYYY-MM');
    IF v_project IS NOT NULL AND public.conta_periodo_cerrado(v_project, v_periodo) THEN
      v_intento := public.conta_registrar_intento_cargo(v_doc_co, v_project, p_origen_tabla, p_origen_id,
        v_evento, 'reproceso', 'bloqueada', 'periodo_cerrado',
        format('El período %s está cerrado. No se cambia la fecha ni se abre el período: resuélvelo con el cierre y vuelve a intentar.', v_periodo),
        '[]'::jsonb, NULL);
      RETURN QUERY SELECT v_evento, 'bloqueada'::text, 'periodo_cerrado'::text,
        format('El período %s está cerrado. No se cambia la fecha ni se abre el período.', v_periodo),
        NULL::uuid, NULL::bigint, NULL::text, v_intento;
      CONTINUE;
    END IF;

    -- La MISMA lógica que la emisión.
    SELECT * INTO v_res FROM public.conta_contabilizar_cargo_interno(p_origen_tabla, p_origen_id, v_evento, 'reproceso');
    IF v_res.asiento_id IS NOT NULL THEN
      SELECT a.numero, a.estado INTO v_a FROM public.conta_asientos a WHERE a.id = v_res.asiento_id;
      RETURN QUERY SELECT v_evento, v_res.resultado, v_res.codigo,
        CASE WHEN v_a.estado = 'borrador'
             THEN 'Asiento generado en borrador: falta el tipo de cambio de la fecha. Publícalo desde Pólizas.'
             ELSE NULL END,
        v_res.asiento_id, v_a.numero::bigint, v_a.estado::text, v_res.intento_id;
    ELSE
      RETURN QUERY SELECT v_evento, v_res.resultado, v_res.codigo, v_res.motivo,
        NULL::uuid, NULL::bigint, NULL::text, v_res.intento_id;
    END IF;
  END LOOP;

  -- Sin intentos previos: documento anterior a esta contabilización, o cuota
  -- sin clasificar. No se contabiliza retroactivamente, y NO se registra un
  -- intento (eso lo volvería elegible).
  IF NOT v_alguno THEN
    RETURN QUERY SELECT NULL::text, 'bloqueada'::text, 'documento_anterior'::text,
      'Este documento no pasó por la contabilización por tipo de cargo (es anterior a ella o no está clasificado): no se contabiliza retroactivamente.'::text,
      NULL::uuid, NULL::bigint, NULL::text, NULL::uuid;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reprocesar_cargo(text, uuid) TO authenticated;

COMMENT ON FUNCTION public.conta_reprocesar_cargo(text, uuid) IS
  'Reprocesa la contabilización de UNA cuota clasificada o UN cargo adicional sin asiento. Bloquea la fila, exige platform.contabilidad.create y change_status, no re-fecha en período cerrado, no recrea asientos reversados, no contabiliza documentos sin intento previo y usa la misma lógica que la emisión.';

-- ── 11. Bandeja de cargos pendientes ────────────────────────────────────────
-- «Pendiente» = un evento de un documento vivo, con al menos un intento y SIN
-- ningún asiento de ese evento (ni vivo, ni borrador, ni reversado). Filtro por
-- motivo y búsqueda, paginada en servidor, acotada a la contabilidad elegida,
-- a la empresa de la sesión y a los proyectos del usuario.
CREATE OR REPLACE FUNCTION public.conta_cargos_pendientes(
  p_project_id uuid    DEFAULT NULL,
  p_codigo     text    DEFAULT NULL,
  p_busqueda   text    DEFAULT NULL,
  p_limite     integer DEFAULT 25,
  p_offset     integer DEFAULT 0
)
RETURNS TABLE (
  origen_tabla      text,
  origen_id         uuid,
  evento            text,
  concepto          text,
  unidad_id         uuid,
  unidad_nombre     text,
  responsable_id    uuid,
  responsable_nombre text,
  tipo_cargo        text,
  fecha             date,
  monto             numeric,
  project_id        uuid,
  codigo            text,
  motivo            text,
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
     ('sin_configuracion','cuenta_invalida','sin_responsable','periodo_cerrado','otro') THEN
    RAISE EXCEPTION 'Filtro de motivo inválido: %', p_codigo USING ERRCODE = '22023';
  END IF;

  v_puede := public.conta_puede_escribir('create') AND public.conta_puede_escribir('change_status');
  v_busqueda := NULLIF(btrim(COALESCE(p_busqueda, '')), '');

  RETURN QUERY
  WITH docs AS (
    SELECT 'cuotas_condominio'::text AS o_tabla, c.id AS o_id, c.concepto || ' ' || c.periodo AS o_concepto,
           c.unidad_id AS o_unidad, c.responsable_cliente_id AS o_resp, c.created_at::date AS o_fecha,
           c.monto AS o_monto, c.mora_monto AS o_mora, c.project_id AS o_project
      FROM public.cuotas_condominio c
     WHERE c.company_id = v_company AND c.project_id IS NOT DISTINCT FROM p_project_id
       AND c.deleted_at IS NULL AND c.tipo_cargo IS NOT NULL
    UNION ALL
    SELECT 'cargos_adicionales_unidad', ca.id, ca.concepto, ca.unidad_id, ca.responsable_cliente_id,
           ca.fecha_cargo, ca.monto, NULL::numeric, ca.project_id
      FROM public.cargos_adicionales_unidad ca
     WHERE ca.company_id = v_company AND ca.project_id IS NOT DISTINCT FROM p_project_id
       AND ca.estado IS DISTINCT FROM 'anulado'
  ),
  eventos AS (
    SELECT DISTINCT d.*, i.evento AS o_evento
      FROM docs d
      JOIN public.conta_intentos_contabilizacion i
        ON i.origen_tabla = d.o_tabla AND i.origen_id = d.o_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.conta_asientos a
        WHERE a.company_id = v_company AND a.origen = 'automatico'
          AND a.origen_tabla = d.o_tabla AND a.origen_id = d.o_id
          AND a.origen_evento = i.evento)
  ),
  diag AS (
    SELECT e.*, ui.created_at AS i_at, ui.disparo AS i_disparo, ui.resultado AS i_resultado,
           ui.codigo AS i_codigo, ui.motivo AS i_motivo,
           (SELECT count(*) FROM public.conta_intentos_contabilizacion i2
             WHERE i2.origen_tabla = e.o_tabla AND i2.origen_id = e.o_id AND i2.evento = e.o_evento) AS n_intentos,
           u.nombre AS u_nombre, cl.nombre AS r_nombre,
           public.conta_tipo_cargo_de_documento(e.o_tabla, e.o_id, e.o_evento) AS o_tipo
      FROM eventos e
      LEFT JOIN LATERAL (
        SELECT i.* FROM public.conta_intentos_contabilizacion i
         WHERE i.origen_tabla = e.o_tabla AND i.origen_id = e.o_id AND i.evento = e.o_evento
         ORDER BY i.created_at DESC, i.id DESC LIMIT 1) ui ON true
      LEFT JOIN public.unidades u ON u.id = e.o_unidad
      LEFT JOIN public.clientes cl ON cl.id = e.o_resp
     WHERE v_busqueda IS NULL
        OR e.o_concepto ILIKE '%' || v_busqueda || '%'
        OR u.nombre ILIKE '%' || v_busqueda || '%'
        OR cl.nombre ILIKE '%' || v_busqueda || '%'
  ),
  clasif AS (
    SELECT d.*,
      CASE WHEN d.i_resultado IN ('pendiente','bloqueada') THEN d.i_codigo ELSE 'error' END AS c_codigo,
      CASE WHEN d.i_resultado IN ('pendiente','bloqueada') THEN d.i_motivo
           ELSE 'El último intento no dejó asiento vigente. Reprocesa para diagnosticar.' END AS c_motivo
      FROM diag d
  ),
  filtrado AS (
    SELECT c.* FROM clasif c
     WHERE p_codigo IS NULL
        OR (p_codigo = 'otro' AND c.c_codigo NOT IN ('sin_configuracion','cuenta_invalida','sin_responsable','periodo_cerrado'))
        OR c.c_codigo = p_codigo
  )
  SELECT f.o_tabla, f.o_id, f.o_evento, f.o_concepto, f.o_unidad, f.u_nombre, f.o_resp, f.r_nombre,
         f.o_tipo, f.o_fecha,
         (CASE WHEN f.o_evento = 'cuota_mora' THEN f.o_mora ELSE f.o_monto END)::numeric,
         f.o_project, f.c_codigo, f.c_motivo, f.i_at, f.i_disparo, f.n_intentos, v_puede,
         count(*) OVER ()
    FROM filtrado f
   ORDER BY f.i_at DESC NULLS LAST, f.o_id, f.o_evento
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 25), 1), 100)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.conta_cargos_pendientes(uuid, text, text, integer, integer) IS
  'Bandeja de cuotas clasificadas y cargos adicionales con un evento contable SIN asiento y con al menos un intento, de la contabilidad indicada, acotada a la empresa de la sesión y a los proyectos del usuario. Filtro por motivo y búsqueda, paginada en servidor.';
