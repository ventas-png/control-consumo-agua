-- Lo que 20261215000000_agua_primera_lectura_fecha_del_historial necesita además
-- del fixture de registrar_lectura y de la RPC (20260910000200):
--   · `agua_historial_lecturas` reducida a lo que el contexto lee (contador,
--     fecha, lectura, consumo), con el mismo CHECK y la misma unicidad
--   · el estado que deja la importación: la última lectura del historial como
--     `lectura_inicial` del contador, cuando corresponde
-- Las fechas son relativas a hoy: `registrar_lectura` rechaza las del futuro.
CREATE TABLE public.agua_historial_lecturas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contador_id uuid NOT NULL REFERENCES public.contadores(id),
  fecha       date NOT NULL,
  lectura     numeric(12,4),
  consumo     numeric(12,4),
  CONSTRAINT agua_historial_lecturas_dato_check CHECK (lectura IS NOT NULL OR consumo IS NOT NULL),
  CONSTRAINT agua_historial_lecturas_contador_fecha_key UNIQUE (contador_id, fecha)
);
-- Sin RLS ni grants: sólo la lee `agua_lectura_contexto` (SECURITY DEFINER).

-- M-2 (inicial 0, instalado 2026-02-01) · HEREDÓ: su inicial es la última del
--   historial. Después hay una fila más reciente SIN lectura (sólo consumo).
-- M-4 (inicial 0, instalado 2026-01-01) · NO heredó: el historial dice 50 y su
--   inicial sigue en 0.
-- M-1 (inicial 100, instalado 2026-01-15) · el historial coincide en valor pero
--   es ANTERIOR a la instalación.
-- M-5 (inicial 0, instalado 2026-01-01) · heredó (40); se usa para el inicio de
--   servicio puesto a mano.
-- M-9 (de la vecina) · una lectura 0 más reciente que todas: no es de M-4.
INSERT INTO public.agua_historial_lecturas (contador_id, fecha, lectura, consumo) VALUES
  ('c0000000-0000-0000-0000-000000000002', current_date - 90, 300, NULL),
  ('c0000000-0000-0000-0000-000000000002', current_date - 60, 330, 30),
  ('c0000000-0000-0000-0000-000000000002', current_date - 45, NULL, 5),
  ('c0000000-0000-0000-0000-000000000004', current_date - 60, 50, NULL),
  ('c0000000-0000-0000-0000-000000000001', DATE '2025-12-25', 100, NULL),
  ('c0000000-0000-0000-0000-000000000005', current_date - 60, 40, NULL),
  ('c0000000-0000-0000-0000-000000000009', current_date - 10, 0, NULL);
UPDATE public.contadores SET lectura_inicial = 330 WHERE id = 'c0000000-0000-0000-0000-000000000002';
UPDATE public.contadores SET lectura_inicial = 40  WHERE id = 'c0000000-0000-0000-0000-000000000005';
