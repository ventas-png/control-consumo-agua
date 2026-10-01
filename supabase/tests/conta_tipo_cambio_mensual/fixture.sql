-- Datos de prueba del tipo de cambio mensual (20261008000000), sobre el padrón
-- de conta_auxiliares_tipo_cargo. La empresa A y su ledger A1, en GTQ. Todo lleva prefijo SINT-AUX.
\set ON_ERROR_STOP on

-- Monedas explícitas: la empresa A en GTQ (el pivote) y su proyecto A1 también.
UPDATE public.companies SET default_currency = 'gtq' WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.projects SET moneda = 'GTQ', moneda_condominios = NULL WHERE id = 'a1a1a1a1-0000-0000-0000-000000000001';

-- Una tasa DIARIA heredada de agosto: ya no convierte (sólo es historia).
INSERT INTO public.conta_tipos_cambio (company_id, moneda, fecha, tasa) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', '2026-07-01', 7.100000);

-- Genera un asiento automático en A1: «debe» a la CxC y «haber» al ingreso,
-- en la moneda del documento. Devuelve su id.
CREATE OR REPLACE FUNCTION public.tc_asiento(p_fecha date, p_moneda text, p_monto numeric) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.conta_generar_asiento(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
    'pruebas_tc', gen_random_uuid(), 'documento', p_fecha, 'SINT-AUX documento', 'diario', p_moneda,
    jsonb_build_array(
      jsonb_build_object('cuenta_id', '11000000-0000-0000-0000-00000000a101', 'debe', p_monto),
      jsonb_build_object('cuenta_id', '11000000-0000-0000-0000-00000000a102', 'haber', p_monto)))
$$;
-- Resumen de un asiento: «estado|total|periodo|tasa|pendiente».
CREATE OR REPLACE FUNCTION public.tc_resumen(p_asiento uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.estado || '|' || a.total_debe || '|' || COALESCE(a.tipo_cambio_periodo, '-') || '|'
         || COALESCE(a.tipo_cambio_tasa::text, '-') || '|' || a.tipo_cambio_pendiente
    FROM public.conta_asientos a WHERE a.id = p_asiento
$$;
GRANT EXECUTE ON FUNCTION public.tc_asiento(date, text, numeric), public.tc_resumen(uuid) TO authenticated;
