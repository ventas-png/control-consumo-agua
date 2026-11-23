-- Invariantes de 20261211000000_reservas_huesped_pais, sobre el estado que deja assert.sql.
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql
DO $$
DECLARE
  str_id uuid;
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  PERFORM hkt.ok('P1 lo que ya existía queda sin país, en las dos tablas',
    (SELECT count(*) = 0 FROM public.rentas_reservas WHERE huesped_pais IS NOT NULL)
    AND (SELECT count(*) = 0 FROM public.reservas_str WHERE huesped_pais IS NOT NULL));
  INSERT INTO public.rentas_reservas (id, company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida, huesped_pais)
    VALUES ('f1000000-0000-0000-0000-000000000041', hkt.ca(), hkt.pr(6), 'Viajera', '2026-04-02', '2026-04-05', 'US');
  PERFORM hkt.ok('P2 la reserva independiente guarda el país',
    (SELECT huesped_pais = 'US' FROM public.rentas_reservas WHERE id = 'f1000000-0000-0000-0000-000000000041'));
  PERFORM hkt.ok('P3 independiente: minúsculas, tres letras, nombre o vacío → 23514',
    hkt.estado_de('UPDATE public.rentas_reservas SET huesped_pais = ''us'' WHERE id = ''f1000000-0000-0000-0000-000000000041''') = '23514'
    AND hkt.estado_de('UPDATE public.rentas_reservas SET huesped_pais = ''USA'' WHERE id = ''f1000000-0000-0000-0000-000000000041''') = '23514'
    AND hkt.estado_de('UPDATE public.rentas_reservas SET huesped_pais = ''Guatemala'' WHERE id = ''f1000000-0000-0000-0000-000000000041''') = '23514'
    AND hkt.estado_de('UPDATE public.rentas_reservas SET huesped_pais = '''' WHERE id = ''f1000000-0000-0000-0000-000000000041''') = '23514');
  SELECT id INTO str_id FROM public.reservas_str ORDER BY id LIMIT 1;
  PERFORM hkt.ok('P4 hay una reserva enlazada con la que probar', str_id IS NOT NULL);
  UPDATE public.reservas_str SET huesped_pais = 'GT' WHERE id = str_id;
  PERFORM hkt.ok('P5 la reserva enlazada (reservas_str) guarda el país y se puede volver a dejar vacío',
    (SELECT huesped_pais = 'GT' FROM public.reservas_str WHERE id = str_id)
    AND hkt.estado_de(format('UPDATE public.reservas_str SET huesped_pais = NULL WHERE id = %L', str_id)) = 'SIN_ERROR');
  PERFORM hkt.ok('P6 enlazada: código mal formado → 23514',
    hkt.estado_de(format('UPDATE public.reservas_str SET huesped_pais = ''gt'' WHERE id = %L', str_id)) = '23514'
    AND hkt.estado_de(format('UPDATE public.reservas_str SET huesped_pais = ''GTM'' WHERE id = %L', str_id)) = '23514');
END $$;
