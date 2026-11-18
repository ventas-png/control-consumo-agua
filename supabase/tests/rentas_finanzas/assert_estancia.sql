-- Invariantes de 20261203000000_rentas_reservas_estancia, sobre el estado que deja assert.sql.
\set ON_ERROR_STOP on
\i ../housekeeping_evidencias/lib.sql
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(1));
  INSERT INTO public.rentas_reservas (id, company_id, propiedad_id, huesped_nombre, fecha_entrada, fecha_salida,
                                      num_huespedes, num_ninos, num_bebes, fecha_reservacion, hora_llegada_estimada, hora_salida_estimada)
    VALUES ('f1000000-0000-0000-0000-000000000031', hkt.ca(), hkt.pr(6), 'Familia', '2026-03-02', '2026-03-05', 4, 1, 1, '2026-02-20', '15:00', '11:00');
  PERFORM hkt.ok('S1 la reserva independiente guarda fecha de reservación, horas y el desglose del grupo',
    (SELECT fecha_reservacion = '2026-02-20' AND hora_llegada_estimada = '15:00' AND num_ninos = 1 AND num_bebes = 1
       FROM public.rentas_reservas WHERE id = 'f1000000-0000-0000-0000-000000000031'));
  PERFORM hkt.ok('S2 lo que ya existía queda sin niños ni bebés', (SELECT bool_and(num_ninos = 0 AND num_bebes = 0)
       FROM public.rentas_reservas WHERE id <> 'f1000000-0000-0000-0000-000000000031'));
  PERFORM hkt.ok('S3 sin ningún adulto, o con negativos → 23514',
    hkt.estado_de('UPDATE public.rentas_reservas SET num_ninos = 3, num_bebes = 1 WHERE id = ''f1000000-0000-0000-0000-000000000031''') = '23514'
    AND hkt.estado_de('UPDATE public.rentas_reservas SET num_bebes = -1 WHERE id = ''f1000000-0000-0000-0000-000000000031''') = '23514');
END $$;
