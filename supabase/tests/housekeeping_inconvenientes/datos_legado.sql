-- Servicios ANTERIORES a 20261124000000, creados como la operadora 3 (PA1) con el modelo
-- viejo: un texto único en `inconvenientes` y fotos de la fase sin dueño.
--   sv 31  texto «Grifo roto» + 2 fotos de inconvenientes (+ 1 de ingreso, que no se toca)
--   sv 32  sólo fotos de inconvenientes (sin texto)
--   sv 33  sólo texto, con espacios alrededor
--   sv 34  nada
DO $$
BEGIN
  PERFORM hkt.como(hkt.uid(3));
  INSERT INTO public.servicios_housekeeping (id, company_id, project_id, unidad_id) VALUES
    (hkt.sv(31), hkt.ca(), hkt.pa1(), hkt.un(1)),
    (hkt.sv(32), hkt.ca(), hkt.pa1(), hkt.un(1)),
    (hkt.sv(33), hkt.ca(), hkt.pa1(), hkt.un(2)),
    (hkt.sv(34), hkt.ca(), hkt.pa1(), hkt.un(2));
  UPDATE public.servicios_housekeeping SET estado = 'en_proceso' WHERE id IN (hkt.sv(31), hkt.sv(32), hkt.sv(33), hkt.sv(34));
  UPDATE public.servicios_housekeeping SET inconvenientes = 'Grifo roto'       WHERE id = hkt.sv(31);
  UPDATE public.servicios_housekeeping SET inconvenientes = '  Solo texto  '   WHERE id = hkt.sv(33);
  INSERT INTO public.servicio_housekeeping_fotos (servicio_id, fase, path) VALUES
    (hkt.sv(31), 'inconvenientes', hkt.ruta(hkt.pa1(), 31, 'a.jpg')),
    (hkt.sv(31), 'inconvenientes', hkt.ruta(hkt.pa1(), 31, 'b.jpg')),
    (hkt.sv(31), 'ingreso',        hkt.ruta(hkt.pa1(), 31, 'in.jpg')),
    (hkt.sv(32), 'inconvenientes', hkt.ruta(hkt.pa1(), 32, 'c.jpg'));
  PERFORM hkt.root();
END $$;
