-- ============================================================================
-- CONTABILIDAD (7): correcciones de los bloques 1 y 2
--   A. Estado de la cuota cubierta por un saldo a favor (sincronización y su
--      reversión).
--   B. Borradores con importes SIN CONVERTIR: detección y bloqueo al publicar
--      (los anteriores a 20261008000000 y cualquier otro).
--
-- ── A. CUOTA CUBIERTA POR UN SALDO A FAVOR ─────────────────────────────────
-- QUÉ PASABA. conta_aplicar_saldo_favor dejaba la cuota en 0 en la CxC pero
-- NO tocaba `cuota_estado`: seguía 'pendiente' | 'emitida' | 'vencida'. Y
-- varias piezas deciden por ese estado, no por la contabilidad:
--   · el cron de recordatorios (20260713090000) avisa de toda cuota que no
--     esté 'pagada'/'anulada' → aviso de pago de una cuota ya cubierta;
--   · el cron de mora (20260604181000) pasa 'emitida' → 'vencida' y aplica el
--     recargo a toda 'vencida' sin mora → MORA sobre una cuota cubierta, que
--     además se devenga (conta_tg_cuotas) y vuelve a abrir la CxC;
--   · create-charge acepta cobrar en línea toda 'emitida'/'vencida' y calcula
--     el saldo como total − pagos, sin restar el saldo a favor aplicado →
--     COBRO DUPLICADO en la pasarela (el excedente volvería a ser saldo a
--     favor, pero el residente pagó dos veces).
--
-- REGLA DE SINCRONIZACIÓN (conta_cuota_sincronizar_estado). Sólo para cuotas
-- en las que intervino un saldo a favor; las demás siguen exactamente igual.
--   1. MARCAR. Si la cuota está abierta ('pendiente', 'emitida', 'vencida',
--      legacy 'moroso' o sin estado), sus devengos (principal y, si tiene,
--      mora) están publicados y concuerdan con la cuota, ningún cobro suyo
--      espera en borrador, y su saldo contable (devengo − cobros vivos −
--      aplicaciones vivas) es 0, pasa a 'pagada' con pagada_at = now(),
--      estado legacy 'pagado', fecha_pago = hoy y metodo_pago =
--      'saldo_a_favor'. NO se toca pago_id (la cuota no la pagó un cobro).
--   2. RESTAURAR. Si la marcó esta regla (último evento 'marcada', y la cuota
--      sigue con metodo_pago 'saldo_a_favor' y el mismo pagada_at) y su saldo
--      contable vuelve a ser > 0 —se revirtió una aplicación, se reversó su
--      asiento desde Pólizas o se rechazó/anuló un cobro que completaba la
--      cobertura—, vuelven EXACTAMENTE los valores anteriores (estado,
--      estado legacy, pagada_at, fecha_pago, metodo_pago). Desde ahí la cuota
--      sigue su curso normal: si ya venció, el cron la pasa a 'vencida' y le
--      aplica la mora que corresponda (si no la tenía ya).
--   3. Si alguien más cambió la cuota después de marcarla (otro pago, una
--      anulación), la regla no la toca.
--   Cada marca y cada restauración deja una fila en
--   conta_sf_cuota_estado_eventos (sólo inserción): hora del servidor, actor,
--   disparo, saldo y los valores anterior y nuevo.
-- DISPAROS (triggers AFTER, en la misma transacción que el cambio):
--   · conta_saldo_favor_aplicaciones: alta y reversión de una aplicación;
--   · conta_cobro_aplicaciones: un cobro por tipo que completa la cobertura
--     de una cuota que ya tenía saldo a favor aplicado;
--   · conta_asientos: el asiento de una aplicación o de un cobro de la cuota
--     se publica o se reversa (incluye el reverso manual desde Pólizas y el
--     rechazo o la anulación del cobro).
--   No se agrega ningún trigger a `pagos` (sus triggers son drift declarado;
--   ver scripts/schema-drift/drift-conocido.json): el rechazo llega por el
--   reverso de su asiento.
-- EN LÍNEA. create-charge resta del saldo lo aplicado por saldos a favor vivos
-- (conta_cuota_saldo_favor_aplicado, sólo service_role), para no cobrar dos
-- veces una cuota parcialmente cubierta.
--
-- ── B. BORRADORES SIN CONVERTIR ────────────────────────────────────────────
-- QUÉ PASABA. Antes de 20261008000000 el generador, sin tasa, dejaba el
-- asiento en BORRADOR con tasa 1 (importes en moneda de origen tal cual) y
-- «[SIN TIPO DE CAMBIO X→Y]» en el concepto, sin tipo_cambio_pendiente. Ese
-- borrador se podía publicar así. Lo mismo un asiento manual con una línea en
-- otra moneda sin tasa.
-- DETECCIÓN (conta_asiento_lineas_sin_convertir / conta_borradores_sin_conversion):
-- una línea en moneda distinta de la base del asiento, con monto de origen, y
--   · sin tasa (NULL o ≤ 0), o
--   · con tasa 1 cuando el asiento lleva la marca antigua, o cuando la tasa
--     mensual del mes de su fecha entre esas monedas no es 1 (una paridad 1:1
--     real, p. ej. PAB/USD configurada en 1, no se bloquea).
-- VALIDACIÓN (trg_conta_asiento_tc_validar_conversion, BEFORE UPDATE OF estado): un
-- borrador con líneas así NO se publica (CONVERSION_PENDIENTE). Corre después
-- de trg_conta_asiento_tc_al_publicar (orden alfabético), así que un
-- borrador nuevo con tipo_cambio_pendiente ya llega convertido.
-- RESOLUCIÓN EXPLÍCITA de un borrador antiguo (conta_borrador_tc_asignar_periodo):
-- una persona con permiso de editar en Contabilidad elige el MES cuya tasa
-- mensual corresponde y deja el motivo; el borrador pasa a
-- tipo_cambio_pendiente con ese período y, al publicarse, se convierte con
-- la tasa de ESE mes (trigger de 20261008000000). No se infiere el mes: la
-- fecha de un borrador antiguo pudo haberse movido a «hoy» por período
-- cerrado y no se reconstruyen fechas desconocidas. La alternativa sigue
-- siendo anular el borrador. Queda evidencia en
-- conta_borradores_tc_resoluciones (sólo inserción).
-- NADA PUBLICADO CAMBIA: la validación sólo mira la transición
-- borrador → publicado, y los reversos se insertan ya publicados.
--
-- CÓMO SE REVIERTE: DROP TRIGGER trg_conta_asiento_tc_validar_conversion,
-- trg_conta_asiento_sf_cuota, trg_conta_cobro_aplicacion_sf_cuota y
-- trg_conta_sf_aplicacion_cuota (y sus funciones); DROP FUNCTION de las
-- funciones nuevas; DROP TABLE conta_borradores_tc_resoluciones y
-- conta_sf_cuota_estado_eventos. Las cuotas que la regla marcó conservan su
-- estado (revisarlas con los eventos antes de borrar la tabla).
-- ============================================================================

-- ── A.1 Bitácora de la sincronización ──────────────────────────────────────
CREATE TABLE public.conta_sf_cuota_estado_eventos (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid          NOT NULL,
  project_id       uuid,
  cuota_id         uuid          NOT NULL,
  accion           text          NOT NULL,
  disparo          text          NOT NULL,
  saldo            numeric(14,2),
  valores_antes    jsonb         NOT NULL,
  valores_despues  jsonb         NOT NULL,
  actor            uuid          DEFAULT auth.uid(),
  ocurrido_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conta_sf_cuota_estado_eventos_accion CHECK (accion IN ('marcada','restaurada'))
);
-- Sin FK a cuotas_condominio ni a companies: como los saldos a favor
-- (20261007000000), la historia no bloquea la purga de retención.

CREATE INDEX idx_conta_sf_cuota_eventos_cuota ON public.conta_sf_cuota_estado_eventos(cuota_id, ocurrido_at DESC);
CREATE INDEX idx_conta_sf_cuota_eventos_empresa ON public.conta_sf_cuota_estado_eventos(company_id, project_id);

COMMENT ON TABLE public.conta_sf_cuota_estado_eventos IS
  'Marca (pagada) y restauración del estado de una cuota por la regla de saldo a favor (conta_cuota_sincronizar_estado). Sólo inserción; hora del servidor y actor de la sesión.';

CREATE FUNCTION public.conta_tg_bitacora_inmutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'BITACORA_INMUTABLE: % sólo admite inserciones.', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_bitacora_inmutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_sf_cuota_evento_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_sf_cuota_estado_eventos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

ALTER TABLE public.conta_sf_cuota_estado_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_sf_cuota_estado_eventos_select" ON public.conta_sf_cuota_estado_eventos
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id()) AND public.can_access_project(project_id)));

REVOKE ALL ON public.conta_sf_cuota_estado_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_sf_cuota_estado_eventos TO authenticated, service_role;

-- ── A.2 Lo aplicado por saldos a favor vivos a una cuota ───────────────────
-- Para create-charge (service_role): el saldo de una cuota en línea es
-- total − pagos − esto.
CREATE FUNCTION public.conta_cuota_saldo_favor_aplicado(p_cuota_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(x.monto), 0)::numeric(14,2)
    FROM public.conta_saldo_favor_aplicaciones x
   WHERE x.cuota_id = p_cuota_id AND public.conta_sf_asiento_vivo(x.asiento_id)
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_saldo_favor_aplicado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conta_cuota_saldo_favor_aplicado(uuid) TO service_role;

COMMENT ON FUNCTION public.conta_cuota_saldo_favor_aplicado(uuid) IS
  'Importe aplicado a la cuota por saldos a favor con asiento vivo. Sólo service_role (create-charge lo resta del saldo a cobrar en línea).';

-- ── A.3 La regla (INTERNA) ─────────────────────────────────────────────────
CREATE FUNCTION public.conta_cuota_sincronizar_estado(p_cuota_id uuid, p_disparo text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_c       public.cuotas_condominio;
  v_q       record;
  v_ev      public.conta_sf_cuota_estado_eventos;
  v_con_sf  boolean;
  v_saldo   numeric(14,2);
  v_listo   boolean;
  v_abierta boolean;
  v_antes   jsonb;
  v_ahora   timestamptz := now();
BEGIN
  IF p_cuota_id IS NULL THEN
    RETURN 'sin_cuota';
  END IF;
  SELECT * INTO v_c FROM public.cuotas_condominio c WHERE c.id = p_cuota_id FOR UPDATE;
  IF v_c.id IS NULL OR v_c.deleted_at IS NOT NULL THEN
    RETURN 'sin_cuota';
  END IF;

  SELECT * INTO v_ev FROM public.conta_sf_cuota_estado_eventos e
   WHERE e.cuota_id = v_c.id ORDER BY e.ocurrido_at DESC, e.id DESC LIMIT 1;
  v_con_sf := EXISTS (SELECT 1 FROM public.conta_saldo_favor_aplicaciones x WHERE x.cuota_id = v_c.id);
  -- Sólo las cuotas en las que intervino un saldo a favor.
  IF NOT v_con_sf AND v_ev.id IS NULL THEN
    RETURN 'sin_saldo_favor';
  END IF;

  SELECT * INTO v_q FROM public.conta_cuota_saldo_cobro(v_c.id);
  v_listo := v_q.princ_asiento_id IS NOT NULL AND v_q.princ_estado = 'publicado'
             AND v_q.princ_monto IS NOT DISTINCT FROM v_c.monto::numeric(14,2)
             AND (COALESCE(v_c.mora_monto, 0) = 0
                  OR (v_q.mora_asiento_id IS NOT NULL AND v_q.mora_estado = 'publicado'
                      AND v_q.mora_monto IS NOT DISTINCT FROM v_c.mora_monto::numeric(14,2)));
  v_saldo := COALESCE(v_q.princ_monto, 0) - COALESCE(v_q.aplicado_princ, 0)
           + CASE WHEN v_q.mora_asiento_id IS NOT NULL
                  THEN COALESCE(v_q.mora_monto, 0) - COALESCE(v_q.aplicado_mora, 0) ELSE 0 END;

  -- 1 · MARCAR: abierta, devengo listo, sin cobros en borrador, saldo 0.
  v_abierta := COALESCE(v_c.cuota_estado, 'pendiente') IN ('pendiente','emitida','vencida','moroso')
               AND COALESCE(v_c.estado, '') <> 'pagado';
  IF v_abierta AND v_con_sf AND v_listo AND v_saldo <= 0
     AND NOT EXISTS (SELECT 1 FROM public.conta_cobro_aplicaciones x
                       JOIN public.conta_asientos a ON a.id = x.asiento_id
                      WHERE x.cuota_id = v_c.id AND a.estado <> 'publicado' AND a.estado <> 'anulado'
                        AND a.anulado_por_id IS NULL) THEN
    v_antes := jsonb_build_object('cuota_estado', v_c.cuota_estado, 'estado', v_c.estado,
      'pagada_at', v_c.pagada_at, 'fecha_pago', v_c.fecha_pago, 'metodo_pago', v_c.metodo_pago);
    UPDATE public.cuotas_condominio c
       SET cuota_estado = 'pagada', pagada_at = v_ahora, estado = 'pagado',
           fecha_pago = CURRENT_DATE, metodo_pago = 'saldo_a_favor'
     WHERE c.id = v_c.id;
    INSERT INTO public.conta_sf_cuota_estado_eventos
      (company_id, project_id, cuota_id, accion, disparo, saldo, valores_antes, valores_despues, ocurrido_at)
    VALUES
      (v_c.company_id, v_c.project_id, v_c.id, 'marcada', p_disparo, v_saldo, v_antes,
       jsonb_build_object('cuota_estado', 'pagada', 'estado', 'pagado', 'pagada_at', v_ahora,
                          'fecha_pago', CURRENT_DATE, 'metodo_pago', 'saldo_a_favor'),
       v_ahora);
    RETURN 'marcada';
  END IF;

  -- 2 · RESTAURAR: la marcó esta regla, nadie la cambió después y vuelve a
  -- deber.
  IF v_ev.accion = 'marcada' AND v_c.cuota_estado = 'pagada'
     AND v_c.metodo_pago IS NOT DISTINCT FROM 'saldo_a_favor'
     AND v_c.pagada_at IS NOT DISTINCT FROM (v_ev.valores_despues->>'pagada_at')::timestamptz
     AND v_saldo > 0 THEN
    UPDATE public.cuotas_condominio c
       SET cuota_estado = v_ev.valores_antes->>'cuota_estado',
           estado       = v_ev.valores_antes->>'estado',
           pagada_at    = (v_ev.valores_antes->>'pagada_at')::timestamptz,
           fecha_pago   = (v_ev.valores_antes->>'fecha_pago')::date,
           metodo_pago  = v_ev.valores_antes->>'metodo_pago'
     WHERE c.id = v_c.id;
    INSERT INTO public.conta_sf_cuota_estado_eventos
      (company_id, project_id, cuota_id, accion, disparo, saldo, valores_antes, valores_despues, ocurrido_at)
    VALUES
      (v_c.company_id, v_c.project_id, v_c.id, 'restaurada', p_disparo, v_saldo, v_ev.valores_despues,
       v_ev.valores_antes, v_ahora);
    RETURN 'restaurada';
  END IF;

  RETURN 'sin_cambio';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cuota_sincronizar_estado(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_cuota_sincronizar_estado(uuid, text) IS
  'Regla de saldo a favor sobre el estado de la cuota: la marca pagada cuando un saldo a favor (con o sin cobros) la deja en 0 en la CxC, y restaura exactamente su estado anterior si vuelve a deber. Sólo cuotas con saldo a favor aplicado; deja evento en conta_sf_cuota_estado_eventos.';

-- ── A.4 Disparos ────────────────────────────────────────────────────────────
CREATE FUNCTION public.conta_tg_sf_aplicacion_cuota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.cuota_id IS NOT NULL THEN
    PERFORM public.conta_cuota_sincronizar_estado(NEW.cuota_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'aplicacion' ELSE 'reversion_aplicacion' END);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_sf_aplicacion_cuota() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_sf_aplicacion_cuota
  AFTER INSERT OR UPDATE OF revertida_at ON public.conta_saldo_favor_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_sf_aplicacion_cuota();

CREATE FUNCTION public.conta_tg_cobro_aplicacion_sf_cuota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Barato para las cuotas sin saldo a favor: la regla sale en la primera
  -- lectura.
  PERFORM public.conta_cuota_sincronizar_estado(NEW.cuota_id, 'cobro');
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_cobro_aplicacion_sf_cuota() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_cobro_aplicacion_sf_cuota
  AFTER INSERT ON public.conta_cobro_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_cobro_aplicacion_sf_cuota();

CREATE FUNCTION public.conta_tg_asiento_sf_cuota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cuota uuid;
BEGIN
  IF NEW.origen_tabla = 'conta_saldo_favor_aplicaciones' THEN
    FOR v_cuota IN SELECT x.cuota_id FROM public.conta_saldo_favor_aplicaciones x
                    WHERE x.asiento_id = NEW.id AND x.cuota_id IS NOT NULL LOOP
      PERFORM public.conta_cuota_sincronizar_estado(v_cuota, 'asiento_aplicacion');
    END LOOP;
  ELSIF NEW.origen_tabla = 'pagos' THEN
    FOR v_cuota IN SELECT DISTINCT x.cuota_id FROM public.conta_cobro_aplicaciones x
                    WHERE x.asiento_id = NEW.id LOOP
      PERFORM public.conta_cuota_sincronizar_estado(v_cuota, 'asiento_cobro');
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_asiento_sf_cuota() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_asiento_sf_cuota
  AFTER UPDATE OF estado, anulado_por_id ON public.conta_asientos
  FOR EACH ROW
  WHEN (NEW.origen_tabla IN ('conta_saldo_favor_aplicaciones','pagos')
        AND (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.anulado_por_id IS DISTINCT FROM NEW.anulado_por_id))
  EXECUTE FUNCTION public.conta_tg_asiento_sf_cuota();

-- ── B.1 Detección ──────────────────────────────────────────────────────────
CREATE FUNCTION public.conta_asiento_lineas_sin_convertir(p_asiento_id uuid, p_concepto text DEFAULT NULL)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::integer
    FROM public.conta_asientos a
    JOIN public.conta_asiento_lineas l ON l.asiento_id = a.id
   WHERE a.id = p_asiento_id
     AND l.moneda_origen IS NOT NULL AND l.monto_origen IS NOT NULL
     AND l.moneda_origen IS DISTINCT FROM a.moneda_base
     AND (COALESCE(l.tipo_cambio, 0) <= 0
          OR (l.tipo_cambio = 1
              AND (COALESCE(p_concepto, a.concepto) LIKE '%[SIN TIPO DE CAMBIO %'
                   OR public.conta_tasa_entre(a.company_id, l.moneda_origen, a.moneda_base, a.fecha)
                        IS DISTINCT FROM 1)))
$$;

REVOKE EXECUTE ON FUNCTION public.conta_asiento_lineas_sin_convertir(uuid, text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_asiento_lineas_sin_convertir(uuid, text) IS
  'Líneas del asiento en otra moneda cuyo importe no está convertido a la base (sin tasa, o tasa 1 con la marca antigua «SIN TIPO DE CAMBIO» o sin una tasa mensual 1:1 configurada para ese mes).';

-- Lectura para la pantalla y para revisar antes de desplegar: los borradores
-- de la empresa de la sesión con importes sin convertir.
CREATE FUNCTION public.conta_borradores_sin_conversion()
RETURNS TABLE (
  asiento_id        uuid,
  project_id        uuid,
  fecha             date,
  origen            text,
  origen_tabla      text,
  concepto          text,
  moneda_origen     text,
  moneda_base       text,
  lineas            integer,
  marca_antigua     boolean,
  pendiente_nuevo   boolean,
  periodo_asignado  text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid := public.get_my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión con empresa activa.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, a.project_id, a.fecha, a.origen, a.origen_tabla, a.concepto,
         (SELECT min(l.moneda_origen) FROM public.conta_asiento_lineas l
           WHERE l.asiento_id = a.id AND l.moneda_origen IS DISTINCT FROM a.moneda_base),
         a.moneda_base, public.conta_asiento_lineas_sin_convertir(a.id),
         a.concepto LIKE '%[SIN TIPO DE CAMBIO %', a.tipo_cambio_pendiente, a.tipo_cambio_periodo
    FROM public.conta_asientos a
   WHERE a.company_id = v_company AND a.estado = 'borrador'
     AND (a.project_id IS NULL OR public.can_access_project(a.project_id))
     AND (a.tipo_cambio_pendiente OR public.conta_asiento_lineas_sin_convertir(a.id) > 0)
   ORDER BY a.fecha, a.created_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_borradores_sin_conversion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_borradores_sin_conversion() TO authenticated;

-- ── B.2 Validación al publicar ─────────────────────────────────────────────
CREATE FUNCTION public.conta_tg_asiento_sin_convertir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (OLD.estado = 'borrador' AND NEW.estado = 'publicado') THEN
    RETURN NEW;
  END IF;
  -- El concepto de NEW: trg_conta_asiento_tc_al_publicar ya le quitó la
  -- marca a un borrador pendiente que acaba de convertir.
  v_n := public.conta_asiento_lineas_sin_convertir(NEW.id, NEW.concepto);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CONVERSION_PENDIENTE: % línea(s) de este borrador están en otra moneda sin convertir a %. No se publica. Si es un borrador anterior al tipo de cambio mensual, asígnale el mes cuya tasa corresponde (conta_borrador_tc_asignar_periodo) o anúlalo; si es manual, escribe la tasa de cada línea.',
      v_n, NEW.moneda_base USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_asiento_sin_convertir() FROM PUBLIC, anon, authenticated;

-- El nombre ordena DESPUÉS de trg_conta_asiento_tc_al_publicar: un borrador
-- con tipo_cambio_pendiente llega aquí ya convertido.
CREATE TRIGGER trg_conta_asiento_tc_validar_conversion
  BEFORE UPDATE OF estado ON public.conta_asientos
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_asiento_sin_convertir();

-- ── B.3 Resolución explícita de un borrador antiguo ────────────────────────
CREATE TABLE public.conta_borradores_tc_resoluciones (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid         NOT NULL,
  project_id   uuid,
  asiento_id   uuid         NOT NULL,
  moneda       text         NOT NULL,
  periodo      text         NOT NULL,
  fecha_asiento date        NOT NULL,
  motivo       text         NOT NULL,
  actor        uuid         NOT NULL DEFAULT auth.uid(),
  ocurrido_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT conta_borradores_tc_resoluciones_periodo CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

CREATE INDEX idx_conta_borradores_tc_res_asiento ON public.conta_borradores_tc_resoluciones(asiento_id);

COMMENT ON TABLE public.conta_borradores_tc_resoluciones IS
  'Evidencia de cada borrador antiguo sin tipo de cambio al que una persona le asignó el mes cuya tasa mensual se usa al publicarlo. Sólo inserción.';

CREATE TRIGGER trg_conta_borradores_tc_resoluciones_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_borradores_tc_resoluciones
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

ALTER TABLE public.conta_borradores_tc_resoluciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_borradores_tc_resoluciones_select" ON public.conta_borradores_tc_resoluciones
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR company_id = (SELECT public.get_my_company_id()));

REVOKE ALL ON public.conta_borradores_tc_resoluciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_borradores_tc_resoluciones TO authenticated, service_role;

CREATE FUNCTION public.conta_borrador_tc_asignar_periodo(p_asiento_id uuid, p_periodo text, p_motivo text)
RETURNS TABLE (asiento_id uuid, moneda text, periodo text, tasa_configurada boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_a       public.conta_asientos;
  v_monedas text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL OR NOT public.conta_puede_escribir('edit') THEN
    RAISE EXCEPTION 'No autorizado para resolver borradores sin tipo de cambio: requiere editar en Contabilidad.'
      USING ERRCODE = '42501';
  END IF;
  IF p_periodo IS NULL OR p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'El período tiene que ser YYYY-MM.' USING ERRCODE = '22023';
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 THEN
    RAISE EXCEPTION 'Indica por qué corresponde la tasa de ese mes.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_a FROM public.conta_asientos a
   WHERE a.id = p_asiento_id AND a.company_id = v_company
     AND (a.project_id IS NULL OR public.can_access_project(a.project_id))
     FOR UPDATE;
  IF v_a.id IS NULL THEN
    RAISE EXCEPTION 'El asiento no existe o no está en tu ámbito.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.estado <> 'borrador' THEN
    RAISE EXCEPTION 'BORRADOR_TC_NO_BORRADOR: sólo se resuelve un borrador; un asiento publicado no se modifica.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_a.tipo_cambio_pendiente THEN
    RAISE EXCEPTION 'BORRADOR_TC_YA_ASIGNADO: este borrador ya tiene su mes (%); configura esa tasa y publícalo.',
      v_a.tipo_cambio_periodo USING ERRCODE = 'check_violation';
  END IF;
  IF v_a.concepto NOT LIKE '%[SIN TIPO DE CAMBIO %' THEN
    RAISE EXCEPTION 'BORRADOR_TC_NO_ANTIGUO: sólo se resuelven así los borradores automáticos marcados «SIN TIPO DE CAMBIO» por el generador anterior; un asiento manual se corrige escribiendo la tasa de cada línea.'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT array_agg(DISTINCT l.moneda_origen) INTO v_monedas
    FROM public.conta_asiento_lineas l
   WHERE l.asiento_id = v_a.id AND l.moneda_origen IS NOT NULL AND l.moneda_origen IS DISTINCT FROM v_a.moneda_base;
  IF COALESCE(array_length(v_monedas, 1), 0) <> 1 THEN
    RAISE EXCEPTION 'BORRADOR_TC_MONEDAS: el borrador tiene % monedas de origen; se resuelve sólo con exactamente una.',
      COALESCE(array_length(v_monedas, 1), 0) USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.conta_asientos a
     SET tipo_cambio_moneda    = v_monedas[1],
         tipo_cambio_periodo   = p_periodo,
         tipo_cambio_tasa      = NULL,
         tipo_cambio_pendiente = true,
         concepto = btrim(regexp_replace(a.concepto, '\s*\[SIN TIPO DE CAMBIO [^]]*\]', '', 'g'))
                    || ' [SIN TIPO DE CAMBIO ' || v_monedas[1] || '→' || a.moneda_base || ' ' || p_periodo || ']',
         updated_at = now()
   WHERE a.id = v_a.id;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  INSERT INTO public.conta_borradores_tc_resoluciones
    (company_id, project_id, asiento_id, moneda, periodo, fecha_asiento, motivo)
  VALUES (v_a.company_id, v_a.project_id, v_a.id, v_monedas[1], p_periodo, v_a.fecha, btrim(p_motivo));

  RETURN QUERY SELECT v_a.id, v_monedas[1], p_periodo,
    public.conta_tasa_entre(v_a.company_id, v_monedas[1], v_a.moneda_base, to_date(p_periodo || '-01', 'YYYY-MM-DD')) IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_borrador_tc_asignar_periodo(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_borrador_tc_asignar_periodo(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.conta_borrador_tc_asignar_periodo(uuid, text, text) IS
  'Resuelve un borrador AUTOMÁTICO anterior al tipo de cambio mensual (marca «SIN TIPO DE CAMBIO» sin período): una persona con editar en Contabilidad elige el mes cuya tasa se usará y deja el motivo. El borrador queda tipo_cambio_pendiente; al publicarse se convierte con la tasa de ese mes. No toca nada publicado.';
