-- ============================================================================
-- CONTABILIDAD (8): decisiones de negocio A1, B1 y D2
-- (docs/DECISIONES_PENDIENTES_CONTABILIDAD.md, aprobadas el 2026-09-26)
--
-- ── A1 · DIFERENCIAL CAMBIARIO REALIZADO EN CADA PAGO ──────────────────────
-- DECISIÓN: el diferencial entre la tasa del mes del documento y la del mes
-- del pago se reconoce AL PAGAR, contra la cuenta especial
-- `diferencial_cambiario`; la revaluación mensual queda para lo pendiente.
--
-- DÓNDE HAY DIFERENCIAL. Sólo donde el documento está en una moneda distinta
-- de la base de su libro: las COMPRAS (facturas de proveedor en otra moneda y
-- su orden de pago). En cuotas, cargos, sus cobros y los saldos a favor el
-- documento usa la moneda del proyecto, que ES la base del libro del
-- proyecto (conta_moneda_base): no hay conversión y no hay diferencial. Si
-- eso cambiara, el mismo mecanismo se extiende a esos orígenes.
--
-- CÓMO. Al publicarse el asiento de una orden de pago (orden_pago_pagada):
--   · se toma la tasa del PAGO de su línea de CxP y, para cada factura que
--     paga —la suya, o las de su contraseña con el reparto ESCRITO en
--     contrasena_pago_facturas.monto—, la tasa de la FACTURA de la línea de
--     CxP de su asiento de devengo;
--   · diferencial = round(monto × tasa_pago, 2) − round(monto × tasa_factura, 2);
--   · se genera un asiento propio (origen ordenes_pago/<orden>,
--     evento 'diferencial_cambiario', en la moneda base, sin conversión):
--     pérdida → cargo a diferencial y abono a CxP; ganancia → al revés. Así
--     la CxP de la factura queda en 0 en la base cuando se paga en su moneda.
--   · Cada cálculo deja una fila en conta_diferenciales_cambiarios: estado
--     'contabilizado', 'sin_diferencia', 'sin_cuenta' (falta la cuenta
--     especial: el pago NO se bloquea; queda pendiente y visible),
--     'pendiente' (la factura aún no está contabilizada o está en borrador
--     sin tasa), 'error' o 'reversado'. conta_reprocesar_diferenciales_cambiarios
--     reintenta los pendientes al configurar la cuenta.
--   · Si el asiento del pago se reversa (orden anulada), su diferencial se
--     reversa con él.
--   · Una factura que se contabiliza DESPUÉS de su pago reintenta los
--     diferenciales pendientes de sus órdenes.
--
-- ── B1 · TASA MANUAL CON MOTIVO ────────────────────────────────────────────
-- DECISIÓN: en un asiento MANUAL con líneas en otra moneda, la pantalla
-- propone la tasa mensual; se puede usar otra, pero con motivo auditado.
--   · conta_asientos.tipo_cambio_motivo (texto).
--   · Al publicar un asiento manual, cada línea en otra moneda cuya tasa no es
--     la mensual de su mes (o no hay mensual) exige motivo (≥ 5 caracteres):
--     sin él, TASA_MANUAL_SIN_MOTIVO. Con él, cada una deja una fila en
--     conta_tasas_manuales (sólo inserción): tasa usada, tasa mensual,
--     motivo, actor y hora del servidor.
--   · La regla de 20261009000000 (tasa 1 sin paridad = sin convertir) sigue.
--
-- ── D2 · MORA SOBRE EL SALDO REAL ──────────────────────────────────────────
-- DECISIÓN: con aplicar_sobre = 'saldo_vencido', la mora se calcula sobre el
-- saldo PENDIENTE; con 'monto_cuota', sobre el monto completo (sin cambios).
--   · aplicar_mora_cuotas_vencidas: saldo = monto − cobros verificados vivos
--     − saldos a favor aplicados vivos (nunca negativo). Lo demás, idéntico a
--     20260604181000 (y a calcularMora de src/lib/business.ts, que ya recibía
--     el saldo por separado).
--
-- CÓMO SE REVIERTE: restaurar aplicar_mora_cuotas_vencidas desde
-- 20260604181000 y conta_tg_asiento_sin_convertir desde 20261009000000;
-- DROP TRIGGER trg_conta_asiento_diferencial y sus funciones; DROP FUNCTION de
-- las nuevas; DROP TABLE conta_tasas_manuales y conta_diferenciales_cambiarios
-- (los asientos de diferencial publicados se reversan, no se borran); DROP
-- COLUMN conta_asientos.tipo_cambio_motivo sólo si ningún asiento la usa.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- A1
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE public.conta_diferenciales_cambiarios (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid          NOT NULL,
  project_id        uuid,
  orden_pago_id     uuid          NOT NULL,
  asiento_origen_id uuid          NOT NULL,
  estado            text          NOT NULL,
  moneda            text,
  tasa_pago         numeric(12,6),
  monto_neto        numeric(14,2),
  detalle           jsonb         NOT NULL DEFAULT '[]'::jsonb,
  motivo            text,
  asiento_id        uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT conta_diferenciales_cambiarios_estado CHECK (estado IN
    ('contabilizado','sin_diferencia','sin_cuenta','pendiente','error','reversado')),
  CONSTRAINT conta_diferenciales_cambiarios_asiento_origen_unico UNIQUE (asiento_origen_id)
);
-- Sin FK a ordenes_pago ni a conta_asientos: la historia no bloquea purgas
-- (mismo criterio que 20261007000000).

CREATE INDEX idx_conta_dif_cambiarios_empresa ON public.conta_diferenciales_cambiarios(company_id, project_id, estado);
CREATE INDEX idx_conta_dif_cambiarios_orden ON public.conta_diferenciales_cambiarios(orden_pago_id);

COMMENT ON TABLE public.conta_diferenciales_cambiarios IS
  'Diferencial cambiario REALIZADO de cada pago a proveedor en otra moneda (decisión A1): tasa del pago contra la tasa de cada factura pagada, el asiento que lo reconoce y, si no se pudo, por qué. Monto neto: + ganancia, − pérdida (en la base).';
COMMENT ON COLUMN public.conta_diferenciales_cambiarios.monto_neto IS
  'Diferencial neto en la moneda base: positivo = ganancia cambiaria, negativo = pérdida.';

ALTER TABLE public.conta_diferenciales_cambiarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_diferenciales_cambiarios_select" ON public.conta_diferenciales_cambiarios
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (project_id IS NULL OR public.can_access_project(project_id))));

REVOKE ALL ON public.conta_diferenciales_cambiarios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_diferenciales_cambiarios TO authenticated, service_role;

-- El cálculo (INTERNO). Idempotente por asiento de origen: recalcula sólo lo
-- que no quedó contabilizado.
CREATE FUNCTION public.conta_diferencial_orden_pago(p_asiento_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_a        public.conta_asientos;
  v_o        public.ordenes_pago;
  v_prev     public.conta_diferenciales_cambiarios;
  v_linea    record;
  v_rep      record;
  v_fa       record;
  v_tasa_f   numeric(12,6);
  v_d        numeric(14,2);
  v_total    numeric(14,2) := 0;
  v_suma     numeric(14,2) := 0;
  v_det      jsonb := '[]'::jsonb;
  v_estado   text;
  v_motivo   text;
  v_cta_dif  uuid;
  v_nuevo    uuid;
BEGIN
  SELECT * INTO v_a FROM public.conta_asientos a WHERE a.id = p_asiento_id;
  IF v_a.id IS NULL OR v_a.origen_tabla <> 'ordenes_pago' OR v_a.origen_evento <> 'orden_pago_pagada'
     OR v_a.estado <> 'publicado' OR v_a.anulado_por_id IS NOT NULL THEN
    RETURN 'no_aplica';
  END IF;
  SELECT * INTO v_prev FROM public.conta_diferenciales_cambiarios d WHERE d.asiento_origen_id = v_a.id;
  IF v_prev.estado IN ('contabilizado','sin_diferencia','reversado') THEN
    RETURN 'ya_' || v_prev.estado;
  END IF;

  -- La línea de CxP del pago: su moneda de origen y su tasa. Sin conversión
  -- (pago en la moneda base) no hay nada que calcular.
  SELECT l.cuenta_id, l.moneda_origen, l.tipo_cambio, l.auxiliar_cliente_id, l.unidad_id
    INTO v_linea
    FROM public.conta_asiento_lineas l
   WHERE l.asiento_id = v_a.id AND l.debe > 0 AND l.moneda_origen IS NOT NULL
   ORDER BY l.orden LIMIT 1;
  IF v_linea.cuenta_id IS NULL THEN
    RETURN 'sin_conversion';
  END IF;

  SELECT * INTO v_o FROM public.ordenes_pago o WHERE o.id = v_a.origen_id;

  BEGIN
    -- Las facturas que paga y cuánto de cada una: el reparto escrito.
    FOR v_rep IN
      SELECT x.factura_id, x.monto FROM (
        SELECT cf.factura_id, cf.monto FROM public.contrasena_pago_facturas cf
         WHERE v_o.contrasena_pago_id IS NOT NULL AND cf.contrasena_id = v_o.contrasena_pago_id
        UNION ALL
        SELECT v_o.factura_id, v_o.monto WHERE v_o.contrasena_pago_id IS NULL AND v_o.factura_id IS NOT NULL
      ) x ORDER BY x.factura_id
    LOOP
      v_suma := v_suma + v_rep.monto;
      SELECT a.id, a.estado, l.tipo_cambio, l.moneda_origen INTO v_fa
        FROM public.conta_asientos a
        LEFT JOIN LATERAL (
          SELECT l2.tipo_cambio, l2.moneda_origen FROM public.conta_asiento_lineas l2
           WHERE l2.asiento_id = a.id AND l2.haber > 0 AND l2.cuenta_id = v_linea.cuenta_id
           ORDER BY l2.orden LIMIT 1) l ON true
       WHERE a.company_id = v_a.company_id AND a.origen = 'automatico'
         AND a.origen_tabla = 'facturas_proveedor' AND a.origen_id = v_rep.factura_id
         AND a.origen_evento = 'factura_prov_aprobada'
         AND a.estado <> 'anulado' AND a.anulado_por_id IS NULL
       ORDER BY a.created_at DESC LIMIT 1;
      IF v_fa.id IS NULL OR v_fa.estado <> 'publicado' THEN
        v_estado := 'pendiente';
        v_motivo := format('La factura %s todavía no tiene su devengo publicado (o está en borrador sin tipo de cambio): el diferencial se calcula cuando se publique.', v_rep.factura_id);
        EXIT;
      END IF;
      IF v_fa.moneda_origen IS DISTINCT FROM v_linea.moneda_origen OR v_fa.tipo_cambio IS NULL THEN
        v_estado := 'error';
        v_motivo := format('La factura %s no está en %s en la misma cuenta por pagar que el pago: no se compara a ciegas.', v_rep.factura_id, v_linea.moneda_origen);
        EXIT;
      END IF;
      v_tasa_f := v_fa.tipo_cambio;
      v_d := round(v_rep.monto * v_linea.tipo_cambio, 2) - round(v_rep.monto * v_tasa_f, 2);
      v_total := v_total + v_d;
      v_det := v_det || jsonb_build_array(jsonb_build_object(
        'factura_id', v_rep.factura_id, 'monto', v_rep.monto, 'tasa_factura', v_tasa_f,
        'tasa_pago', v_linea.tipo_cambio, 'diferencial', v_d));
    END LOOP;

    IF v_estado IS NULL AND v_suma IS DISTINCT FROM v_o.monto::numeric(14,2) THEN
      v_estado := 'error';
      v_motivo := format('El reparto por factura (%s) no suma el monto de la orden (%s): no se reparte a ciegas.', v_suma, v_o.monto);
    END IF;

    IF v_estado IS NULL AND v_total = 0 THEN
      v_estado := 'sin_diferencia';
    END IF;

    IF v_estado IS NULL THEN
      v_cta_dif := public.conta_cuenta_especial(v_a.company_id, v_a.project_id, 'diferencial_cambiario');
      IF v_cta_dif IS NULL THEN
        v_estado := 'sin_cuenta';
        v_motivo := 'Falta la cuenta especial «Diferencial cambiario» en el mapeo de esta contabilidad. El pago quedó contabilizado; configura la cuenta y reprocesa el diferencial.';
      END IF;
    END IF;

    IF v_estado IS NULL THEN
      -- v_total > 0: se pagó MÁS en la base de lo que se reconoció al devengar
      -- (pérdida): cargo a diferencial y abono a CxP. v_total < 0: ganancia.
      v_nuevo := public.conta_generar_asiento(
        v_a.company_id, v_a.project_id, 'ordenes_pago', v_a.origen_id, 'diferencial_cambiario',
        v_a.fecha, 'Diferencial cambiario realizado · ' || v_a.concepto, 'diario', v_a.moneda_base,
        jsonb_build_array(
          jsonb_build_object('cuenta_id', v_cta_dif,
            CASE WHEN v_total > 0 THEN 'debe' ELSE 'haber' END, abs(v_total),
            'descripcion', CASE WHEN v_total > 0 THEN 'Pérdida cambiaria realizada' ELSE 'Ganancia cambiaria realizada' END),
          jsonb_build_object('cuenta_id', v_linea.cuenta_id,
            CASE WHEN v_total > 0 THEN 'haber' ELSE 'debe' END, abs(v_total),
            'descripcion', 'Ajuste de la CxP a la tasa de la factura',
            'auxiliar_cliente_id', v_linea.auxiliar_cliente_id, 'unidad_id', v_linea.unidad_id)));
      IF v_nuevo IS NULL THEN
        SELECT a.id INTO v_nuevo FROM public.conta_asientos a
         WHERE a.company_id = v_a.company_id AND a.origen = 'automatico' AND a.origen_tabla = 'ordenes_pago'
           AND a.origen_id = v_a.origen_id AND a.origen_evento = 'diferencial_cambiario'
           AND a.estado = 'publicado' AND a.anulado_por_id IS NULL;
      END IF;
      IF v_nuevo IS NULL THEN
        v_estado := 'error';
        v_motivo := 'No se pudo generar el asiento del diferencial (revisa que las cuentas sigan activas y en esta contabilidad).';
      ELSE
        v_estado := 'contabilizado';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_estado := 'error';
    v_motivo := SQLERRM;
    v_nuevo  := NULL;
  END;

  INSERT INTO public.conta_diferenciales_cambiarios AS d
    (company_id, project_id, orden_pago_id, asiento_origen_id, estado, moneda, tasa_pago,
     monto_neto, detalle, motivo, asiento_id)
  VALUES
    (v_a.company_id, v_a.project_id, v_a.origen_id, v_a.id, v_estado, v_linea.moneda_origen,
     v_linea.tipo_cambio, -v_total, v_det, v_motivo, v_nuevo)
  ON CONFLICT (asiento_origen_id) DO UPDATE
     SET estado = EXCLUDED.estado, tasa_pago = EXCLUDED.tasa_pago, monto_neto = EXCLUDED.monto_neto,
         detalle = EXCLUDED.detalle, motivo = EXCLUDED.motivo, asiento_id = EXCLUDED.asiento_id,
         updated_at = now()
   WHERE d.estado NOT IN ('contabilizado','sin_diferencia','reversado');
  RETURN v_estado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_diferencial_orden_pago(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.conta_diferencial_orden_pago(uuid) IS
  'Decisión A1: reconoce el diferencial cambiario realizado de una orden de pago (tasa del pago contra la de cada factura, reparto escrito de la contraseña) en un asiento propio contra diferencial_cambiario, o deja el motivo por el que no pudo. Idempotente.';

-- Disparos en conta_asientos.
CREATE FUNCTION public.conta_tg_asiento_diferencial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_asiento uuid;
BEGIN
  IF NEW.origen_tabla = 'ordenes_pago' AND NEW.origen_evento = 'orden_pago_pagada' THEN
    IF OLD.estado IS DISTINCT FROM 'publicado' AND NEW.estado = 'publicado' AND NEW.anulado_por_id IS NULL THEN
      PERFORM public.conta_diferencial_orden_pago(NEW.id);
    ELSIF OLD.anulado_por_id IS NULL AND NEW.anulado_por_id IS NOT NULL THEN
      -- El pago se reversó: su diferencial también.
      PERFORM public.conta_reversar_automatico(NEW.company_id, 'ordenes_pago', NEW.origen_id,
        'diferencial_cambiario', 'Reverso de diferencial cambiario (pago reversado)');
      UPDATE public.conta_diferenciales_cambiarios d
         SET estado = 'reversado', updated_at = now()
       WHERE d.asiento_origen_id = NEW.id AND d.estado <> 'reversado';
    END IF;
  ELSIF NEW.origen_tabla = 'facturas_proveedor' AND NEW.origen_evento = 'factura_prov_aprobada'
        AND OLD.estado IS DISTINCT FROM 'publicado' AND NEW.estado = 'publicado' THEN
    -- Una factura que se publica después de su pago: reintentar los
    -- diferenciales pendientes de sus órdenes.
    FOR v_asiento IN
      SELECT d.asiento_origen_id FROM public.conta_diferenciales_cambiarios d
        JOIN public.ordenes_pago o ON o.id = d.orden_pago_id
       WHERE d.company_id = NEW.company_id AND d.estado = 'pendiente'
         AND (o.factura_id = NEW.origen_id
              OR EXISTS (SELECT 1 FROM public.contrasena_pago_facturas cf
                          WHERE cf.contrasena_id = o.contrasena_pago_id AND cf.factura_id = NEW.origen_id))
    LOOP
      PERFORM public.conta_diferencial_orden_pago(v_asiento);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tg_asiento_diferencial() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_conta_asiento_diferencial
  AFTER UPDATE OF estado, anulado_por_id ON public.conta_asientos
  FOR EACH ROW
  WHEN (NEW.origen_tabla IN ('ordenes_pago','facturas_proveedor')
        AND (OLD.estado IS DISTINCT FROM NEW.estado OR OLD.anulado_por_id IS DISTINCT FROM NEW.anulado_por_id))
  EXECUTE FUNCTION public.conta_tg_asiento_diferencial();

-- Reproceso (RPC): al configurar la cuenta, o tras corregir la causa.
CREATE FUNCTION public.conta_reprocesar_diferenciales_cambiarios(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (orden_pago_id uuid, resultado text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company uuid;
  v_d       public.conta_diferenciales_cambiarios;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado: se requiere una sesión.' USING ERRCODE = '42501';
  END IF;
  v_company := public.get_my_company_id();
  IF v_company IS NULL OR NOT public.conta_puede_escribir('create') THEN
    RAISE EXCEPTION 'No autorizado para reprocesar diferenciales: requiere crear en Contabilidad.' USING ERRCODE = '42501';
  END IF;
  FOR v_d IN
    SELECT * FROM public.conta_diferenciales_cambiarios d
     WHERE d.company_id = v_company AND d.estado IN ('sin_cuenta','pendiente','error')
       AND (p_project_id IS NULL OR d.project_id = p_project_id)
       AND (d.project_id IS NULL OR public.can_access_project(d.project_id))
     ORDER BY d.created_at
  LOOP
    orden_pago_id := v_d.orden_pago_id;
    resultado := public.conta_diferencial_orden_pago(v_d.asiento_origen_id);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_reprocesar_diferenciales_cambiarios(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_reprocesar_diferenciales_cambiarios(uuid) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- B1
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.conta_asientos ADD COLUMN tipo_cambio_motivo text;

COMMENT ON COLUMN public.conta_asientos.tipo_cambio_motivo IS
  'Asiento MANUAL: por qué una línea en otra moneda usa una tasa distinta de la mensual (decisión B1). Obligatorio al publicar si alguna la usa.';

CREATE TABLE public.conta_tasas_manuales (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL,
  project_id    uuid,
  asiento_id    uuid          NOT NULL,
  linea_id      uuid          NOT NULL,
  moneda        text          NOT NULL,
  moneda_base   text          NOT NULL,
  periodo       text          NOT NULL,
  tasa_usada    numeric(12,6) NOT NULL,
  tasa_mensual  numeric(12,6),
  motivo        text          NOT NULL,
  actor         uuid          DEFAULT auth.uid(),
  ocurrido_at   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX idx_conta_tasas_manuales_asiento ON public.conta_tasas_manuales(asiento_id);
CREATE INDEX idx_conta_tasas_manuales_empresa ON public.conta_tasas_manuales(company_id, periodo);

COMMENT ON TABLE public.conta_tasas_manuales IS
  'Cada línea de un asiento manual publicada con una tasa distinta de la mensual (o sin mensual): tasa usada, mensual, motivo, actor y hora del servidor. Sólo inserción.';

CREATE TRIGGER trg_conta_tasas_manuales_inmutable
  BEFORE UPDATE OR DELETE ON public.conta_tasas_manuales
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_bitacora_inmutable();

ALTER TABLE public.conta_tasas_manuales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conta_tasas_manuales_select" ON public.conta_tasas_manuales
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR company_id = (SELECT public.get_my_company_id()));

REVOKE ALL ON public.conta_tasas_manuales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.conta_tasas_manuales TO authenticated, service_role;

-- La validación al publicar (20261009000000) más la regla B1.
CREATE OR REPLACE FUNCTION public.conta_tg_asiento_sin_convertir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_n      integer;
  v_l      record;
  v_motivo text := NULLIF(btrim(COALESCE(NEW.tipo_cambio_motivo, '')), '');
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

  -- B1: asiento manual con una tasa distinta de la mensual → motivo.
  IF NEW.origen = 'manual' THEN
    FOR v_l IN
      SELECT l.id, l.moneda_origen, l.tipo_cambio,
             public.conta_tasa_entre(NEW.company_id, l.moneda_origen, NEW.moneda_base, NEW.fecha) AS mensual
        FROM public.conta_asiento_lineas l
       WHERE l.asiento_id = NEW.id AND l.moneda_origen IS NOT NULL
         AND l.moneda_origen IS DISTINCT FROM NEW.moneda_base
       ORDER BY l.orden
    LOOP
      IF v_l.mensual IS DISTINCT FROM v_l.tipo_cambio THEN
        IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
          RAISE EXCEPTION 'TASA_MANUAL_SIN_MOTIVO: la línea en % usa la tasa % y la mensual de % es %. Usa la mensual o indica el motivo de la tasa distinta.',
            v_l.moneda_origen, v_l.tipo_cambio, to_char(NEW.fecha, 'YYYY-MM'), COALESCE(v_l.mensual::text, 'inexistente')
            USING ERRCODE = 'check_violation';
        END IF;
        INSERT INTO public.conta_tasas_manuales
          (company_id, project_id, asiento_id, linea_id, moneda, moneda_base, periodo, tasa_usada, tasa_mensual, motivo)
        VALUES
          (NEW.company_id, NEW.project_id, NEW.id, v_l.id, v_l.moneda_origen, NEW.moneda_base,
           to_char(NEW.fecha, 'YYYY-MM'), v_l.tipo_cambio, v_l.mensual, v_motivo);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- D2
-- ════════════════════════════════════════════════════════════════════════════
-- Cuerpo idéntico a 20260604181000 salvo el cálculo del saldo.
CREATE OR REPLACE FUNCTION public.aplicar_mora_cuotas_vencidas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  -- ── 1) Transición emitida → vencida ──────────────────────────────────────
  -- Vence cuando fecha_vencimiento + periodo_gracia (de la regla activa del
  -- proyecto; 0 si no hay regla) ya pasó. Tenant-safe: la regla se busca por el
  -- project_id de la propia cuota. Excluye soft-deleted.
  UPDATE public.cuotas_condominio c
  SET cuota_estado = 'vencida',
      vencida_at   = COALESCE(c.vencida_at, v_now)
  FROM (
    SELECT cu.id AS cuota_id,
           (cu.fecha_vencimiento
              + (COALESCE(rule.periodo_gracia, 0) || ' days')::interval) AS limite
    FROM public.cuotas_condominio cu
    LEFT JOIN LATERAL (
      SELECT rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = cu.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) rule ON true
    WHERE cu.cuota_estado = 'emitida'
      AND cu.fecha_vencimiento IS NOT NULL
      AND cu.deleted_at IS NULL
  ) v
  WHERE c.id = v.cuota_id
    AND v.limite < v_now;

  -- ── 2) Recargo de mora (replica calcularMora) ────────────────────────────
  -- Sólo cuotas ya vencidas, con regla activa, con unidad dueña, sin mora
  -- aplicada todavía (idempotencia por mora_aplicada_at). Se calcula la
  -- base/monto exactamente como la función pura y se persiste en
  -- cuotas_condominio + recargos_mora.
  WITH candidatas AS (
    SELECT
      cu.id             AS cuota_id,
      cu.project_id     AS project_id,
      cu.company_id     AS company_id,
      cu.unidad_id      AS unidad_id,
      r.id              AS regla_mora_id,
      r.tipo            AS tipo,
      r.valor           AS valor,
      r.aplicar_sobre   AS aplicar_sobre,
      r.dias_vencimiento AS dias_vencimiento,
      r.periodo_gracia  AS periodo_gracia,
      GREATEST(COALESCE(cu.monto, 0), 0) AS cuota,
      -- SALDO VENCIDO REAL (20261010000000, decisión D2): el monto menos los
      -- cobros verificados vivos de la cuota y lo aplicado por saldos a
      -- favor vivos. Antes era el monto entero, así que «saldo_vencido» y
      -- «monto_cuota» daban lo mismo aunque hubiera abonos. Todavía no hay
      -- mora (mora_aplicada_at IS NULL): todo lo abonado es principal.
      GREATEST(COALESCE(cu.monto, 0)
        - COALESCE((SELECT sum(p.monto) FROM public.pagos p
                     WHERE (p.cuota_id = cu.id OR p.id = cu.pago_id)
                       AND p.deleted_at IS NULL
                       AND p.estado IN ('verificado','aplicado')), 0)
        - public.conta_cuota_saldo_favor_aplicado(cu.id), 0) AS saldo,
      -- dias = floor(diasTranscurridos) medido desde emitida_at (fallback created_at).
      floor(
        EXTRACT(EPOCH FROM (v_now - COALESCE(cu.emitida_at, cu.created_at))) / 86400.0
      )::int AS dias
    FROM public.cuotas_condominio cu
    JOIN LATERAL (
      SELECT rmc.id, rmc.tipo, rmc.valor, rmc.aplicar_sobre,
             rmc.dias_vencimiento, rmc.periodo_gracia
      FROM public.reglas_mora_config rmc
      WHERE rmc.project_id = cu.project_id
        AND rmc.activa = true
      ORDER BY rmc.created_at DESC
      LIMIT 1
    ) r ON true
    WHERE cu.cuota_estado = 'vencida'
      AND cu.mora_aplicada_at IS NULL       -- idempotencia
      AND cu.unidad_id IS NOT NULL          -- recargo necesita unidad dueña (owner_check)
      AND cu.deleted_at IS NULL
  ),
  calc AS (
    SELECT
      c.*,
      (c.dias - COALESCE(c.dias_vencimiento, 0))                      AS dias_atraso,
      CASE WHEN c.aplicar_sobre = 'monto_cuota' THEN c.cuota ELSE c.saldo END AS base,
      CASE WHEN COALESCE(c.valor, 0) > 0 THEN c.valor ELSE 0 END      AS valor_eff
    FROM candidatas c
  ),
  aplicables AS (
    SELECT
      calc.*,
      CASE
        WHEN calc.tipo = 'monto_fijo' THEN round(calc.valor_eff::numeric, 2)
        ELSE round((calc.base * (calc.valor_eff / 100.0))::numeric, 2)
      END AS monto
    FROM calc
    WHERE calc.dias_atraso > 0                                -- diasAtraso <= 0 → no
      AND calc.dias_atraso > COALESCE(calc.periodo_gracia, 0) -- dentro de gracia → no
      AND NOT (calc.tipo = 'porcentaje' AND calc.base <= 0)   -- % sin base → no
      AND calc.valor_eff > 0                                  -- valor 0 → no
  ),
  finales AS (
    SELECT * FROM aplicables WHERE monto > 0  -- aplica = monto > 0
  ),
  -- Inserta el recargo en el ledger compartido recargos_mora, por unidad/cuota
  -- (forma condominios). ON CONFLICT contra el índice único parcial (cuota viva)
  -- → no duplica si por carrera ya existe.
  ins AS (
    INSERT INTO public.recargos_mora
      (company_id, project_id, unidad_id, cuota_id, registro_id,
       tipo, valor, monto_calculado, fecha_aplicacion, estado, motivo)
    SELECT
      f.company_id, f.project_id, f.unidad_id, f.cuota_id, NULL,
      f.tipo, f.valor_eff, f.monto, v_now::date, 'aplicado',
      'Recargo por mora automático (cron cond:C6) — ' || f.dias_atraso || ' días de atraso'
    FROM finales f
    ON CONFLICT (cuota_id) WHERE (cuota_id IS NOT NULL AND estado <> 'anulado')
    DO NOTHING
    RETURNING cuota_id
  )
  -- Persiste en la cuota: mora_monto, regla, timestamp y total recompuesto
  -- (monto + mora; SIN IVA).
  UPDATE public.cuotas_condominio cu
  SET mora_monto       = f.monto,
      regla_mora_id    = f.regla_mora_id,
      mora_aplicada_at = v_now,
      total_a_pagar    = round((COALESCE(cu.monto, 0) + f.monto)::numeric, 2)
  FROM finales f
  WHERE cu.id = f.cuota_id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.aplicar_mora_cuotas_vencidas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aplicar_mora_cuotas_vencidas() TO service_role;

COMMENT ON FUNCTION public.aplicar_mora_cuotas_vencidas() IS
  'Cron de mora de condominios (cond:C6): marca cuotas emitidas vencidas (emitida→vencida) y aplica el recargo replicando calcularMora; con aplicar_sobre = saldo_vencido la base es el SALDO pendiente (monto − cobros verificados vivos − saldos a favor aplicados vivos, decisión D2), con monto_cuota el monto completo. Idempotente (mora_aplicada_at + uq_recargos_mora_cuota_vivo). SECURITY DEFINER; sólo service_role / el job.';
