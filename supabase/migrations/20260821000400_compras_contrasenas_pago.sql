-- ════════════════════════════════════════════════════════════════════════════
-- COMPRAS — FASE 6 · parte E: CONTRASEÑA DE PAGO Y PAGO MULTI-FACTURA
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 6). Depende de la parte D.
--
-- POR QUÉ EXISTE
-- Cuando el proveedor entrega su factura, la administración le devuelve una
-- CONTRASEÑA DE PAGO: un acuse con correlativo propio que dice "recibí tu
-- factura y te pago el día X". Es el documento con el que el proveedor cobra, y
-- hoy no existe en el sistema: la factura entra a cuentas por pagar y el
-- proveedor se queda sin comprobante de que su documento fue recibido ni de
-- cuándo le van a pagar.
--
-- Una contraseña normalmente cubre VARIAS facturas del mismo proveedor —es su
-- razón de ser: juntar lo que se le debe y pagarlo de una sola vez— y eso
-- choca con `ordenes_pago.factura_id NOT NULL`, que ata cada orden a UNA
-- factura. Resolverlo es exactamente el «órdenes multi-factura» que el roadmap
-- dejó diferido en la Fase 2, así que esta parte lo entrega de paso.
--
-- QUÉ HACE
--   1. `contrasenas_pago` + `contrasena_pago_facturas` (N facturas por
--      contraseña, del MISMO proveedor y la MISMA contabilidad).
--   2. `ordenes_pago.contrasena_pago_id`, con `factura_id` ya opcional y un
--      CHECK de "exactamente uno de los dos".
--   3. `cxp_tg_orden_saldo` reparte el pago entre las facturas de la
--      contraseña, con el monto que quedó escrito por factura — no prorrateado
--      a ojo.
--
-- LO QUE NO HACE: la contraseña NO genera asiento. Es un acuse y una promesa de
-- fecha, no un hecho económico; la deuda ya la registró el devengo de la
-- factura y el movimiento de dinero lo registra la orden de pago. Meterla en la
-- contabilidad sería contar dos veces la misma obligación.
--
-- COMPATIBILIDAD
-- Las órdenes de pago existentes (todas con `factura_id`) siguen exactamente
-- igual: misma ruta de saldos, mismo asiento, misma conciliación bancaria.
--
-- CÓMO REVERTIR
--   Restaurar cxp_tg_orden_saldo() y conta_tg_ordenes_pago() a 20260611010100;
--   ALTER TABLE public.ordenes_pago DROP CONSTRAINT ordenes_pago_destino_check,
--     DROP COLUMN contrasena_pago_id, ALTER COLUMN factura_id SET NOT NULL;
--   DROP TABLE public.contrasena_pago_facturas, public.contrasenas_pago;
--
-- IMPACTO EN DATOS PRODUCTIVOS: ninguno sobre filas existentes.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. La contraseña ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contrasenas_pago (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid          REFERENCES public.projects(id) ON DELETE SET NULL,
  proveedor_id          uuid          NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  numero                text,
  fecha_emision         date          NOT NULL DEFAULT CURRENT_DATE,
  -- El dato por el que existe el documento: cuándo se le paga al proveedor.
  fecha_pago_programada date          NOT NULL,
  moneda                text,
  total                 numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  estado                text          NOT NULL DEFAULT 'emitida'
                          CHECK (estado IN ('emitida','pagada','anulada')),
  entregada_por         text,         -- quién de la administración la entregó
  recibida_por          text,         -- quién del proveedor la recibió
  observaciones         text,
  motivo_anulacion      text,
  created_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  pagada_at             timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contrasenas_numero
  ON public.contrasenas_pago (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), numero)
  WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contrasenas_ledger
  ON public.contrasenas_pago(company_id, project_id, estado, fecha_pago_programada);
CREATE INDEX IF NOT EXISTS idx_contrasenas_proveedor ON public.contrasenas_pago(proveedor_id);

CREATE TABLE IF NOT EXISTS public.contrasena_pago_facturas (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  contrasena_id uuid          NOT NULL REFERENCES public.contrasenas_pago(id) ON DELETE CASCADE,
  factura_id    uuid          NOT NULL REFERENCES public.facturas_proveedor(id) ON DELETE RESTRICT,
  monto         numeric(14,2) NOT NULL CHECK (monto > 0),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT contrasena_factura_unica UNIQUE (contrasena_id, factura_id)
);

CREATE INDEX IF NOT EXISTS idx_contrasena_fact_contrasena ON public.contrasena_pago_facturas(contrasena_id);
CREATE INDEX IF NOT EXISTS idx_contrasena_fact_factura    ON public.contrasena_pago_facturas(factura_id);

COMMENT ON TABLE public.contrasenas_pago IS
  'Acuse de recepción de facturas que se entrega al proveedor, con correlativo por contabilidad y fecha programada de pago. Agrupa N facturas del mismo proveedor. No genera asiento.';
COMMENT ON COLUMN public.contrasena_pago_facturas.monto IS
  'Cuánto de ESA factura cubre la contraseña. Es el monto que la orden de pago aplicará: el reparto queda escrito, no se prorratea después.';

-- ── 2. La orden de pago puede liquidar una contraseña ───────────────────────
ALTER TABLE public.ordenes_pago
  ADD COLUMN IF NOT EXISTS contrasena_pago_id uuid REFERENCES public.contrasenas_pago(id) ON DELETE RESTRICT;

ALTER TABLE public.ordenes_pago ALTER COLUMN factura_id DROP NOT NULL;

-- Exactamente uno de los dos: o liquida una factura suelta (como siempre) o
-- una contraseña (que ya sabe qué facturas cubre). Permitir ambos abriría la
-- puerta a aplicar el pago dos veces.
DO $$ BEGIN
  ALTER TABLE public.ordenes_pago
    ADD CONSTRAINT ordenes_pago_destino_check
    CHECK ((factura_id IS NOT NULL) <> (contrasena_pago_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ordenes_pago_contrasena
  ON public.ordenes_pago(contrasena_pago_id) WHERE contrasena_pago_id IS NOT NULL;

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- ENABLE literal (ver la nota de la parte C): el guard estático del repo no
-- ejecuta `format()`, y una tabla que habilita RLS dentro de un DO le parece
-- una tabla sin RLS.
ALTER TABLE public.contrasenas_pago         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contrasena_pago_facturas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  ins_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
      OR public.conta_puede_escribir('create')))$e$;
  upd_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.conta_puede_escribir('edit')))$e$;
  del_expr text := $e$is_super_admin() OR (company_id = get_my_company_id() AND (
      current_user_role() = ANY(ARRAY['company_owner','admin'])
      OR public.conta_puede_escribir('delete')))$e$;
BEGIN
  FOREACH t IN ARRAY ARRAY['contrasenas_pago','contrasena_pago_facturas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                      USING (company_id = get_my_company_id() OR is_super_admin())$p$,
                   t || '_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                   t || '_insert', t, ins_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                   t || '_update', t, upd_expr, upd_expr);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
                   t || '_delete', t, del_expr);
  END LOOP;

  -- Puerta MFA: la contraseña autoriza una salida de dinero, va con las demás.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mfa_requirement_met') THEN
    FOREACH t IN ARRAY ARRAY['contrasenas_pago','contrasena_pago_facturas','ordenes_pago'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())', t);
    END LOOP;
  END IF;
END $$;

-- ── 4. Qué facturas puede cubrir una contraseña ─────────────────────────────
CREATE OR REPLACE FUNCTION public.compras_tg_contrasena_factura()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c      record;
  v_f      record;
  v_saldo  numeric(14,2);
  v_ocupado numeric(14,2);
  v_total  numeric(14,2);
  v_id     uuid := COALESCE(NEW.contrasena_id, OLD.contrasena_id);
BEGIN
  IF TG_OP <> 'DELETE' THEN
    SELECT * INTO v_c FROM public.contrasenas_pago WHERE id = NEW.contrasena_id;
    SELECT * INTO v_f FROM public.facturas_proveedor WHERE id = NEW.factura_id;

    IF v_c.estado <> 'emitida' THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_CERRADA: la contraseña está % y ya no admite cambios.', v_c.estado
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.proveedor_id <> v_c.proveedor_id THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_OTRO_PROVEEDOR: la contraseña es de un proveedor y la factura de otro.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Mismo ledger: si no, el pago saldría de una contabilidad y la deuda
    -- viviría en otra.
    IF v_f.project_id IS DISTINCT FROM v_c.project_id THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_OTRA_CONTABILIDAD: la factura pertenece a otra contabilidad.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_f.estado NOT IN ('aprobada','pagada_parcial') THEN
      RAISE EXCEPTION 'COMPRAS_FACTURA_NO_PAGABLE: la factura está % y no se puede incluir en una contraseña.', v_f.estado
        USING ERRCODE = 'check_violation';
    END IF;

    -- No comprometer dos veces el mismo saldo: se descuenta lo que ya
    -- reservaron OTRAS contraseñas vivas de esa factura.
    v_saldo := v_f.monto_total - v_f.monto_pagado;
    SELECT COALESCE(SUM(cf.monto), 0) INTO v_ocupado
    FROM public.contrasena_pago_facturas cf
    JOIN public.contrasenas_pago c ON c.id = cf.contrasena_id
    WHERE cf.factura_id = NEW.factura_id
      AND c.estado = 'emitida'
      AND cf.id IS DISTINCT FROM COALESCE(OLD.id, '00000000-0000-0000-0000-000000000000'::uuid);

    IF NEW.monto > v_saldo - v_ocupado + 0.001 THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_EXCEDE_SALDO: la factura % tiene saldo disponible % (ya comprometido % en otras contraseñas) y se intenta cubrir %.',
        COALESCE(v_f.numero_factura, ''), v_saldo - v_ocupado, v_ocupado, NEW.monto
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Total de la cabecera = suma de sus renglones.
  SELECT COALESCE(SUM(monto), 0) INTO v_total
  FROM public.contrasena_pago_facturas
  WHERE contrasena_id = v_id
    AND (TG_OP <> 'DELETE' OR id <> OLD.id);
  IF TG_OP = 'INSERT' THEN
    v_total := v_total + NEW.monto;
  ELSIF TG_OP = 'UPDATE' THEN
    v_total := v_total - OLD.monto + NEW.monto;
  END IF;

  UPDATE public.contrasenas_pago SET total = v_total, updated_at = now() WHERE id = v_id;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_contrasena_factura() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_contrasena_factura ON public.contrasena_pago_facturas;
CREATE TRIGGER trg_compras_contrasena_factura
  BEFORE INSERT OR UPDATE OR DELETE ON public.contrasena_pago_facturas
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_contrasena_factura();

-- Correlativo, moneda y sellos de la contraseña.
CREATE OR REPLACE FUNCTION public.compras_tg_contrasena_estado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' THEN
    IF NEW.numero IS NULL THEN
      NEW.numero := 'CP-' || lpad(
        public.compras_siguiente_correlativo(NEW.company_id, NEW.project_id, 'contrasena_pago')::text, 6, '0');
    END IF;
    NEW.moneda     := COALESCE(NEW.moneda, public.conta_moneda_base(NEW.company_id, NEW.project_id));
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    RETURN NEW;
  END IF;

  IF OLD.estado = 'anulada' AND NEW.estado <> 'anulada' THEN
    RAISE EXCEPTION 'COMPRAS_CONTRASENA_INMUTABLE: una contraseña anulada no se reabre.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'pagada' AND NEW.estado = 'anulada'
     AND COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'COMPRAS_CONTRASENA_PAGADA: anula primero la orden de pago que la liquidó.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.estado = 'pagada' AND OLD.estado <> 'pagada' THEN
    NEW.pagada_at := COALESCE(NEW.pagada_at, now());
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_contrasena_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_contrasena_estado ON public.contrasenas_pago;
CREATE TRIGGER trg_compras_contrasena_estado
  BEFORE INSERT OR UPDATE ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_contrasena_estado();

-- ── 5. La orden que liquida una contraseña paga su total ────────────────────
-- No se acepta pagar "una parte" de una contraseña: el documento que se le
-- entregó al proveedor dice un monto y una fecha. Si hay que pagar menos, se
-- anula y se emite otra — que es lo que la administración hace en la práctica,
-- y deja el rastro correcto en manos del proveedor.
CREATE OR REPLACE FUNCTION public.compras_tg_orden_contrasena()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c record;
BEGIN
  IF NEW.contrasena_pago_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_c FROM public.contrasenas_pago WHERE id = NEW.contrasena_pago_id;

  IF TG_OP = 'INSERT' THEN
    IF v_c.estado <> 'emitida' THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_CERRADA: la contraseña % está %.', v_c.numero, v_c.estado
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ordenes_pago
               WHERE contrasena_pago_id = NEW.contrasena_pago_id AND estado <> 'anulada') THEN
      RAISE EXCEPTION 'COMPRAS_CONTRASENA_YA_TIENE_ORDEN: la contraseña % ya tiene una orden de pago viva.', v_c.numero
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.proveedor_id IS DISTINCT FROM v_c.proveedor_id THEN
      NEW.proveedor_id := v_c.proveedor_id;
    END IF;
    IF NEW.project_id IS DISTINCT FROM v_c.project_id THEN
      NEW.project_id := v_c.project_id;
    END IF;
  END IF;

  IF round(NEW.monto, 2) <> round(v_c.total, 2) THEN
    RAISE EXCEPTION 'COMPRAS_ORDEN_MONTO_DISTINTO: la contraseña % es por % y la orden por %. Emite otra contraseña si el monto cambió.',
      v_c.numero, v_c.total, NEW.monto USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compras_tg_orden_contrasena() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compras_orden_contrasena ON public.ordenes_pago;
CREATE TRIGGER trg_compras_orden_contrasena
  BEFORE INSERT OR UPDATE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_orden_contrasena();

-- ── 6. Reparto del pago entre las facturas de la contraseña ─────────────────
-- Reescribe cxp_tg_orden_saldo() de 20260611010100 conservando ÍNTEGRA la ruta
-- de factura única y añadiendo la de contraseña. Además cambia el `off` final
-- por la restauración del valor previo del GUC: si esta función corre anidada
-- bajo otra que ya lo tenía en 'on', apagarlo se lo apagaba a la de afuera.
CREATE OR REPLACE FUNCTION public.cxp_tg_orden_saldo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_factura public.facturas_proveedor;
  v_pagado  numeric(14,2);
  v_cf      record;
  v_prev    text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  -- Escritura de sistema: el guard cxp_proteger_factura respeta este GUC.
  PERFORM set_config('conta.allow_system_write', 'on', true);

  -- ── Pagada ───────────────────────────────────────────────────────────────
  IF NEW.estado = 'pagada' AND OLD.estado <> 'pagada' THEN
    IF NEW.contrasena_pago_id IS NOT NULL THEN
      FOR v_cf IN
        SELECT factura_id, monto FROM public.contrasena_pago_facturas
        WHERE contrasena_id = NEW.contrasena_pago_id
      LOOP
        SELECT * INTO v_factura FROM public.facturas_proveedor WHERE id = v_cf.factura_id FOR UPDATE;
        v_pagado := LEAST(v_factura.monto_pagado + v_cf.monto, v_factura.monto_total);
        UPDATE public.facturas_proveedor
        SET monto_pagado = v_pagado,
            estado = CASE WHEN v_pagado >= monto_total THEN 'pagada' ELSE 'pagada_parcial' END,
            updated_at = now()
        WHERE id = v_cf.factura_id;
      END LOOP;
      UPDATE public.contrasenas_pago SET estado = 'pagada', pagada_at = now(), updated_at = now()
       WHERE id = NEW.contrasena_pago_id;
    ELSE
      SELECT * INTO v_factura FROM public.facturas_proveedor WHERE id = NEW.factura_id FOR UPDATE;
      v_pagado := LEAST(v_factura.monto_pagado + NEW.monto, v_factura.monto_total);
      UPDATE public.facturas_proveedor
      SET monto_pagado = v_pagado,
          estado = CASE WHEN v_pagado >= monto_total THEN 'pagada' ELSE 'pagada_parcial' END,
          updated_at = now()
      WHERE id = NEW.factura_id;
    END IF;
  END IF;

  -- ── Anulada después de pagada ────────────────────────────────────────────
  IF NEW.estado = 'anulada' AND OLD.estado = 'pagada' THEN
    IF NEW.contrasena_pago_id IS NOT NULL THEN
      FOR v_cf IN
        SELECT factura_id, monto FROM public.contrasena_pago_facturas
        WHERE contrasena_id = NEW.contrasena_pago_id
      LOOP
        SELECT * INTO v_factura FROM public.facturas_proveedor WHERE id = v_cf.factura_id FOR UPDATE;
        v_pagado := GREATEST(v_factura.monto_pagado - v_cf.monto, 0);
        UPDATE public.facturas_proveedor
        SET monto_pagado = v_pagado,
            estado = CASE
              WHEN v_factura.estado = 'anulada' THEN 'anulada'
              WHEN v_pagado <= 0 THEN 'aprobada'
              WHEN v_pagado >= v_factura.monto_total THEN 'pagada'
              ELSE 'pagada_parcial'
            END,
            updated_at = now()
        WHERE id = v_cf.factura_id;
      END LOOP;
      -- La contraseña vuelve a estar viva: el proveedor sigue con su acuse.
      UPDATE public.contrasenas_pago SET estado = 'emitida', pagada_at = NULL, updated_at = now()
       WHERE id = NEW.contrasena_pago_id;
    ELSE
      SELECT * INTO v_factura FROM public.facturas_proveedor WHERE id = NEW.factura_id FOR UPDATE;
      v_pagado := GREATEST(v_factura.monto_pagado - NEW.monto, 0);
      UPDATE public.facturas_proveedor
      SET monto_pagado = v_pagado,
          estado = CASE
            WHEN v_factura.estado = 'anulada' THEN 'anulada'
            WHEN v_pagado <= 0 THEN 'aprobada'
            WHEN v_pagado >= v_factura.monto_total THEN 'pagada'
            ELSE 'pagada_parcial'
          END,
          updated_at = now()
      WHERE id = NEW.factura_id;
    END IF;
  END IF;

  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RETURN NEW;
END;
$$;

-- ── 7. El asiento del pago aprende a mirar la contraseña ────────────────────
-- Misma forma de siempre (Dr 2104 Proveedores / Cr banco-caja): lo único que
-- cambia es de dónde sale la MONEDA cuando la orden liquida una contraseña, ya
-- que entonces no hay una `factura_id` de la cual leerla.
CREATE OR REPLACE FUNCTION public.conta_tg_ordenes_pago()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda    text;
  v_metodo    text;
  v_proveedor text;
  v_ref       text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'ordenes_pago', OLD.id,
      'orden_pago_pagada', 'Orden de pago eliminada');
    RETURN OLD;
  END IF;

  IF NEW.estado = 'anulada' AND OLD.estado = 'pagada' THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'ordenes_pago', NEW.id,
      'orden_pago_pagada', 'Orden de pago anulada');
    RETURN NEW;
  END IF;

  IF NEW.estado = 'pagada' AND OLD.estado <> 'pagada' THEN
    v_metodo := CASE NEW.metodo_pago
      WHEN 'efectivo'      THEN 'metodo_efectivo'
      WHEN 'transferencia' THEN 'metodo_transferencia'
      WHEN 'deposito'      THEN 'metodo_deposito'
      WHEN 'cheque'        THEN 'metodo_cheque'
      WHEN 'tarjeta'       THEN 'metodo_tarjeta'
      ELSE 'metodo_otro'
    END;
    SELECT nombre INTO v_proveedor FROM public.proveedores WHERE id = NEW.proveedor_id;

    IF NEW.contrasena_pago_id IS NOT NULL THEN
      SELECT COALESCE(c.moneda,
        (SELECT COALESCE(p.moneda_condominios, p.moneda) FROM public.projects p WHERE p.id = NEW.project_id)),
        'contraseña ' || COALESCE(c.numero, '')
      INTO v_moneda, v_ref
      FROM public.contrasenas_pago c WHERE c.id = NEW.contrasena_pago_id;
    ELSE
      SELECT COALESCE(f.moneda,
        (SELECT COALESCE(p.moneda_condominios, p.moneda) FROM public.projects p WHERE p.id = NEW.project_id))
      INTO v_moneda
      FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id;
    END IF;

    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'ordenes_pago', NEW.id, 'orden_pago_pagada',
      COALESCE(NEW.fecha_pago, CURRENT_DATE),
      'Pago a proveedor ' || COALESCE(v_proveedor, '') ||
        COALESCE(' ' || v_ref, '') ||
        COALESCE(' ref. ' || NULLIF(NEW.referencia, ''), ''),
      'egreso', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', 'cxp_proveedores', 'debe', NEW.monto),
        jsonb_build_object('evento', v_metodo, 'haber', NEW.monto)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contrasenas_pago_touch ON public.contrasenas_pago;
CREATE TRIGGER trg_contrasenas_pago_touch
  BEFORE UPDATE ON public.contrasenas_pago
  FOR EACH ROW EXECUTE FUNCTION public.compras_tg_touch_updated_at();
