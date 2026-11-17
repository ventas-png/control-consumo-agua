-- Invariantes de 20261129000000_rentas_moneda, sobre el estado que deja assert.sql.
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql
DO $$
BEGIN
  PERFORM hkt.root();
  PERFORM hkt.ok('M1 las tres tablas ganan moneda, USD por defecto y obligatoria',
    (SELECT count(*) = 3 AND bool_and(column_default LIKE '%USD%' AND is_nullable = 'NO') FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'moneda'
        AND table_name IN ('rentas_liquidaciones', 'rentas_gastos', 'rentas_contratos')));
  PERFORM hkt.ok('M2 lo que ya existía queda en USD', (SELECT bool_and(moneda = 'USD') FROM public.rentas_gastos));
  PERFORM hkt.como(hkt.uid(13));
  PERFORM hkt.ok('M3 Finanzas registra un gasto en otra moneda',
    hkt.afectadas(format('INSERT INTO public.rentas_gastos (company_id, propiedad_id, fecha, descripcion, monto, moneda) VALUES (%L, %L, %L, %L, 5, %L)',
      hkt.ca(), hkt.pr(2), '2026-02-03', 'en quetzales', 'GTQ')) = 1);
  PERFORM hkt.ok('M4 moneda que no es un código ISO en mayúsculas → 23514',
    hkt.estado_de('UPDATE public.rentas_gastos SET moneda = ''usd''') = '23514'
    AND hkt.estado_de('UPDATE public.rentas_gastos SET moneda = ''Q''') = '23514'
    AND hkt.estado_de('UPDATE public.rentas_gastos SET moneda = ''DOLAR''') = '23514');
  PERFORM hkt.como(hkt.uid(4));
  INSERT INTO public.rentas_liquidaciones (company_id, propiedad_id, reserva_str_id, moneda)
    VALUES (hkt.ca(), hkt.pr(4), hkt.rs(13), 'GTQ');
  PERFORM hkt.ok('M5 la ficha de una reserva guarda su moneda aunque no tenga desglose',
    (SELECT moneda = 'GTQ' AND importes = '{}'::jsonb FROM public.rentas_liquidaciones WHERE reserva_str_id = hkt.rs(13)));
  PERFORM hkt.ok('M6 … y rechaza una moneda mal escrita → 23514',
    hkt.estado_de('UPDATE public.rentas_liquidaciones SET moneda = ''gtq''') = '23514');
END $$;
