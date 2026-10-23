\set ON_ERROR_STOP on

-- ════════════════════════════════════════════════════════════════════════════
-- Tras ejecutar el bloque REVERSIÓN de la migración: cada factura vuelve a sus
-- dos montos anteriores y la constancia se conserva.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.facturas_energia f
    JOIN sandbox.antes a USING (id)
   WHERE (f.monto_total, f.monto_credito_exportacion) IS DISTINCT FROM (a.monto_total, a.monto_credito_exportacion);
  IF v_n > 0 THEN RAISE EXCEPTION '5 · % factura(s) no volvieron a sus montos anteriores', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.audit_log
   WHERE after->>'correccion' = '20261104090000_facturas_energia_total_del_desglose';
  IF v_n <> 6 THEN RAISE EXCEPTION '5 · quedaron % constancias (esperadas 6)', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE table_name = 'pagos' AND after->>'monto_total' = '2') THEN
    RAISE EXCEPTION '5 · la reversión tocó una constancia de otra tabla';
  END IF;
  RAISE NOTICE 'OK 5  la reversión documentada devuelve los montos anteriores y conserva la constancia';
END;
$$;
