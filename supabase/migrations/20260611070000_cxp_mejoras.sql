-- ════════════════════════════════════════════════════════════════════════════
-- CxP · Desglose de IVA crédito fiscal + proyección de pagos
-- (pendientes declarados de la Fase 2 del roadmap ERP)
--
--   1105 IVA crédito fiscal + mapeo 'iva_credito' — cuenta de activo donde se
--     separa el IVA de las facturas de proveedor (las UIs ya capturan
--     iva_monto; hasta ahora el devengo iba completo al gasto).
--   conta_tg_facturas_prov v2 — el devengo separa el IVA cuando iva_monto > 0
--     y la empresa tiene el mapeo: gasto (base) + IVA crédito (iva) contra
--     CxP (total). Sin mapeo, comportamiento anterior (todo al gasto) para no
--     romper empresas sin re-seedear.
--   cxp_proyeccion_pagos — proyección del flujo de pagos por proveedor según
--     vencimientos (vencido / 0-7 / 8-14 / 15-30 / 31+ / sin fecha),
--     complemento forward-looking del aging.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Cuenta 1105 + mapeo (empresas nuevas vía trigger + backfill) ─────────
CREATE OR REPLACE FUNCTION public.cxp_seed_iva(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cuenta uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conta_cuentas WHERE company_id = p_company_id) THEN
    RETURN; -- empresa sin catálogo contable
  END IF;

  INSERT INTO public.conta_cuentas (company_id, codigo, nombre, tipo, naturaleza, padre_id, nivel, es_detalle, activa, es_sistema)
  SELECT p_company_id, '1105', 'IVA crédito fiscal', 'activo', 'deudora', c.id, 3, true, true, true
  FROM public.conta_cuentas c
  WHERE c.company_id = p_company_id AND c.codigo = '11'
  ON CONFLICT (company_id, codigo) DO NOTHING;

  SELECT id INTO v_cuenta FROM public.conta_cuentas
  WHERE company_id = p_company_id AND codigo = '1105';
  IF v_cuenta IS NULL THEN RETURN; END IF;

  INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
  VALUES (p_company_id, NULL, 'iva_credito', v_cuenta)
  ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), evento)
  DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cxp_seed_iva(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cxp_seed_iva_on_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  BEGIN
    PERFORM public.cxp_seed_iva(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cxp_seed_iva_on_company(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 'trg_cxp_seed_iva_company' ordena alfabéticamente DESPUÉS del seed del
-- catálogo ('trg_conta_...') y del mapeo CxP ('trg_cxp_seed_company').
DROP TRIGGER IF EXISTS trg_cxp_seed_iva_company ON public.companies;
CREATE TRIGGER trg_cxp_seed_iva_company
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.cxp_seed_iva_on_company();

DO $$
DECLARE v_company uuid;
BEGIN
  FOR v_company IN SELECT id FROM public.companies LOOP
    PERFORM public.cxp_seed_iva(v_company);
  END LOOP;
END $$;

-- ── 2. Devengo con desglose de IVA ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_tg_facturas_prov()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_moneda    text;
  v_gasto     text;
  v_proveedor text;
  v_iva       numeric(14,2);
  v_lineas    jsonb;
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

    -- Desglose de IVA crédito fiscal: solo si la factura trae IVA y la empresa
    -- tiene el mapeo 'iva_credito' (1105). Sin mapeo → todo al gasto (legacy).
    v_iva := COALESCE(NEW.iva_monto, 0);
    IF v_iva > 0 AND v_iva < NEW.monto_total
       AND public.conta_cuenta_para(NEW.company_id, NEW.project_id, 'iva_credito') IS NOT NULL THEN
      v_lineas := jsonb_build_array(
        jsonb_build_object('evento', v_gasto, 'debe', NEW.monto_total - v_iva),
        jsonb_build_object('evento', 'iva_credito', 'debe', v_iva,
                           'descripcion', 'IVA crédito fiscal'),
        jsonb_build_object('evento', 'cxp_proveedores', 'haber', NEW.monto_total)
      );
    ELSE
      v_lineas := jsonb_build_array(
        jsonb_build_object('evento', v_gasto, 'debe', NEW.monto_total),
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
  END IF;

  RETURN NEW;
END;
$$;

-- El trigger trg_conta_facturas_prov ya existe y apunta a esta función
-- (CREATE OR REPLACE la re-define in situ).

-- ── 3. Proyección de pagos ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cxp_proyeccion_pagos(
  p_company_id uuid,
  p_project_id uuid
)
RETURNS TABLE (
  proveedor_id uuid,
  proveedor    text,
  total        numeric,
  vencido      numeric,
  d0_7         numeric,
  d8_14        numeric,
  d15_30       numeric,
  d31_mas      numeric,
  sin_fecha    numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT
    p.id,
    p.nombre,
    SUM(f.monto_total - f.monto_pagado)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE BETWEEN 0 AND 7
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE BETWEEN 8 AND 14
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE BETWEEN 15 AND 30
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento - CURRENT_DATE > 30
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2),
    SUM(CASE WHEN f.fecha_vencimiento IS NULL
             THEN f.monto_total - f.monto_pagado ELSE 0 END)::numeric(14,2)
  FROM public.facturas_proveedor f
  JOIN public.proveedores p ON p.id = f.proveedor_id
  WHERE f.company_id = p_company_id
    AND f.estado IN ('aprobada','pagada_parcial')
    AND (p_project_id IS NULL OR f.project_id = p_project_id)
  GROUP BY p.id, p.nombre
  ORDER BY 4 DESC, 3 DESC
$$;

REVOKE EXECUTE ON FUNCTION public.cxp_proyeccion_pagos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cxp_proyeccion_pagos(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.cxp_proyeccion_pagos(uuid, uuid) IS
  'Proyección del flujo de pagos CxP por proveedor según vencimientos (vencido / 0-7 / 8-14 / 15-30 / 31+ / sin fecha). Complemento forward-looking de cxp_antiguedad_saldos.';
