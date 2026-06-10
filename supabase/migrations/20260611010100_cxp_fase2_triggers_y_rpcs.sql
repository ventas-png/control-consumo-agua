-- ════════════════════════════════════════════════════════════════════════════
-- CUENTAS POR PAGAR / PROVEEDORES — FASE 2 ERP · parte B: triggers + RPCs
--
--   cxp_seed_defaults        — mapeo contable 'cxp_proveedores' → cuenta 2104
--                              (companies nuevas vía trigger + backfill)
--   trigger de negocio       — orden pagada actualiza monto_pagado/estado de
--                              su factura (y al anularse, lo revierte)
--   triggers contables       — factura aprobada = devengo (gasto contra CxP);
--                              orden pagada = CxP contra banco/caja; reversos
--                              automáticos al anular (mismo patrón Fase 1:
--                              idempotentes, nunca rompen la operación)
--   cxp_antiguedad_saldos    — aging 30/60/90 por proveedor (server-side)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Mapeo contable del pasivo CxP ────────────────────────────────────────
-- La cuenta 2104 'Proveedores por pagar' ya existe en el seed de Fase 1; aquí
-- solo se registra el evento que la usa. Trigger aparte sobre companies para
-- no re-declarar conta_seed_catalogo completo.
CREATE OR REPLACE FUNCTION public.cxp_seed_defaults(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cuenta uuid;
BEGIN
  SELECT id INTO v_cuenta FROM public.conta_cuentas
  WHERE company_id = p_company_id AND codigo = '2104';
  IF v_cuenta IS NULL THEN
    RETURN; -- empresa sin catálogo contable: nada que mapear
  END IF;
  INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
  VALUES (p_company_id, NULL, 'cxp_proveedores', v_cuenta)
  ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), evento)
  DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cxp_seed_defaults(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cxp_seed_on_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.cxp_seed_defaults(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cxp_seed_on_company(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- Debe correr DESPUÉS de trg_conta_seed_on_company (que crea la cuenta 2104).
-- Los triggers del mismo evento se ejecutan en orden alfabético:
-- 'trg_conta_seed…' < 'trg_zcxp_seed…'.
DROP TRIGGER IF EXISTS trg_zcxp_seed_on_company ON public.companies;
CREATE TRIGGER trg_zcxp_seed_on_company
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.cxp_seed_on_company();

-- ── 2. Negocio: orden pagada ↔ saldo de la factura ──────────────────────────
CREATE OR REPLACE FUNCTION public.cxp_tg_orden_saldo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_factura public.facturas_proveedor;
  v_pagado  numeric(14,2);
BEGIN
  -- Escritura de sistema: el guard cxp_proteger_factura respeta este GUC.
  PERFORM set_config('conta.allow_system_write', 'on', true);

  -- Pagada: suma el monto al saldo pagado de la factura.
  IF NEW.estado = 'pagada' AND OLD.estado <> 'pagada' THEN
    SELECT * INTO v_factura FROM public.facturas_proveedor WHERE id = NEW.factura_id FOR UPDATE;
    v_pagado := LEAST(v_factura.monto_pagado + NEW.monto, v_factura.monto_total);
    UPDATE public.facturas_proveedor
    SET monto_pagado = v_pagado,
        estado = CASE WHEN v_pagado >= monto_total THEN 'pagada' ELSE 'pagada_parcial' END,
        updated_at = now()
    WHERE id = NEW.factura_id;
  END IF;

  -- Anulada después de pagada: resta y recalcula el estado.
  IF NEW.estado = 'anulada' AND OLD.estado = 'pagada' THEN
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

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cxp_orden_saldo ON public.ordenes_pago;
CREATE TRIGGER trg_cxp_orden_saldo
  AFTER UPDATE OF estado ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.cxp_tg_orden_saldo();

-- ── 3. Contabilidad: devengo de factura de proveedor ────────────────────────
-- Aprobada → cargo gasto_<categoria>, abono cxp_proveedores (monto total del
-- documento; el desglose de IVA crédito fiscal queda para una fase posterior).
CREATE OR REPLACE FUNCTION public.conta_tg_facturas_prov()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda    text;
  v_gasto     text;
  v_proveedor text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'facturas_proveedor', OLD.id,
      'factura_prov_aprobada', 'Factura de proveedor eliminada');
    RETURN OLD;
  END IF;

  -- Reverso del devengo al anular una factura ya aprobada.
  IF NEW.estado = 'anulada' AND OLD.estado IN ('aprobada','pagada_parcial','pagada') THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'facturas_proveedor', NEW.id,
      'factura_prov_aprobada', 'Factura de proveedor anulada');
    RETURN NEW;
  END IF;

  -- Devengo al aprobar.
  IF NEW.estado = 'aprobada' AND OLD.estado = 'registrada' THEN
    v_gasto := CASE WHEN NEW.categoria IN ('mantenimiento','servicios','administrativo',
                                           'seguridad','limpieza','obras')
                    THEN 'gasto_' || NEW.categoria ELSE 'gasto_otros' END;
    SELECT nombre INTO v_proveedor FROM public.proveedores WHERE id = NEW.proveedor_id;
    v_moneda := COALESCE(NEW.moneda,
      (SELECT COALESCE(moneda_condominios, moneda) FROM public.projects WHERE id = NEW.project_id));

    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'facturas_proveedor', NEW.id, 'factura_prov_aprobada',
      NEW.fecha_emision,
      'Factura proveedor ' || COALESCE(v_proveedor, '') ||
        COALESCE(' #' || NULLIF(NEW.numero_factura, ''), '') || ' — ' || NEW.concepto,
      'diario', v_moneda,
      jsonb_build_array(
        jsonb_build_object('evento', v_gasto, 'debe', NEW.monto_total),
        jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total)
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conta_facturas_prov ON public.facturas_proveedor;
CREATE TRIGGER trg_conta_facturas_prov
  AFTER UPDATE OF estado OR DELETE ON public.facturas_proveedor
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_facturas_prov();

-- ── 4. Contabilidad: orden de pago pagada ───────────────────────────────────
-- Pagada → cargo cxp_proveedores, abono cuenta del método (banco/caja).
CREATE OR REPLACE FUNCTION public.conta_tg_ordenes_pago()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda    text;
  v_metodo    text;
  v_proveedor text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.conta_reversar_automatico(OLD.company_id, 'ordenes_pago', OLD.id,
      'orden_pago_pagada', 'Orden de pago eliminada');
    RETURN OLD;
  END IF;

  -- Reverso al anular una orden ya pagada.
  IF NEW.estado = 'anulada' AND OLD.estado = 'pagada' THEN
    PERFORM public.conta_reversar_automatico(NEW.company_id, 'ordenes_pago', NEW.id,
      'orden_pago_pagada', 'Orden de pago anulada');
    RETURN NEW;
  END IF;

  -- Asiento al pagar.
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
    -- La orden paga en la moneda del documento que liquida.
    SELECT COALESCE(f.moneda,
      (SELECT COALESCE(p.moneda_condominios, p.moneda) FROM public.projects p WHERE p.id = NEW.project_id))
    INTO v_moneda
    FROM public.facturas_proveedor f WHERE f.id = NEW.factura_id;

    PERFORM public.conta_generar_asiento(
      NEW.company_id, NEW.project_id, 'ordenes_pago', NEW.id, 'orden_pago_pagada',
      COALESCE(NEW.fecha_pago, CURRENT_DATE),
      'Pago a proveedor ' || COALESCE(v_proveedor, '') ||
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

DROP TRIGGER IF EXISTS trg_conta_ordenes_pago ON public.ordenes_pago;
CREATE TRIGGER trg_conta_ordenes_pago
  AFTER UPDATE OF estado OR DELETE ON public.ordenes_pago
  FOR EACH ROW EXECUTE FUNCTION public.conta_tg_ordenes_pago();

-- ── 5. Antigüedad de saldos por pagar (aging 30/60/90) ──────────────────────
-- SECURITY INVOKER: la RLS de facturas_proveedor/proveedores aplica sola.
-- Saldo = monto_total − monto_pagado de facturas vivas (aprobada/pagada_parcial),
-- clasificado por días vencidos contra fecha_vencimiento (sin vencimiento =
-- corriente).
CREATE OR REPLACE FUNCTION public.cxp_antiguedad_saldos(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS TABLE (
  proveedor_id uuid,
  proveedor    text,
  total        numeric,
  corriente    numeric,
  d1_30        numeric,
  d31_60       numeric,
  d61_90       numeric,
  d90_mas      numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    p.id,
    p.nombre,
    SUM(f.monto_total - f.monto_pagado)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento IS NULL OR f.fecha_vencimiento >= CURRENT_DATE
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento BETWEEN 1 AND 30
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento BETWEEN 31 AND 60
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento BETWEEN 61 AND 90
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN CURRENT_DATE - f.fecha_vencimiento > 90
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2)
  FROM public.facturas_proveedor f
  JOIN public.proveedores p ON p.id = f.proveedor_id
  WHERE f.company_id = p_company_id
    AND f.estado IN ('aprobada','pagada_parcial')
    AND (p_project_id IS NULL OR f.project_id = p_project_id)
  GROUP BY p.id, p.nombre
  ORDER BY 3 DESC
$$;

REVOKE EXECUTE ON FUNCTION public.cxp_antiguedad_saldos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cxp_antiguedad_saldos(uuid, uuid) TO authenticated;

-- ── 6. Backfill del mapeo para companies existentes ─────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    BEGIN
      PERFORM public.cxp_seed_defaults(c.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'cxp seed backfill company %: %', c.id, SQLERRM;
    END;
  END LOOP;
END $$;
