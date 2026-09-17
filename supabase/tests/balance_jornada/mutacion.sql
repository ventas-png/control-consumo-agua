-- ════════════════════════════════════════════════════════════════════════════
-- La prueba de la prueba: sin `c.abiertos > 0`, la invariante 28 tiene que ROJO
-- ════════════════════════════════════════════════════════════════════════════
-- Una invariante que pasa con y sin el arreglo no prueba nada. Este archivo es
-- la invariante 28 reducida a su afirmación decisiva —«con la jornada abierta,
-- horas_sobre_jornada es NULL»— para poder correrla dos veces desde `run.sh`:
--
--   · contra la función REAL  → tiene que pasar;
--   · contra un mutante al que se le quitó `OR COALESCE(c.abiertos, 0) > 0`
--     del caso indeterminado de `extra` → tiene que fallar.
--
-- Se apoya en el día que la invariante 28 ya sembró (CURRENT_DATE − 47): una
-- entrada a las 06:00 sin salida, contra un bloque de 7.25 h planificadas.
-- Sin la condición, ese día devuelve 0 —`GREATEST(0, 0 − 7.25)`— y la línea de
-- abajo es la que lo atrapa.
DO $$
DECLARE b record;
BEGIN
  PERFORM set_config('app.uid', 'e0000000-0000-0000-0000-00000000000d', true);
  SELECT * INTO b FROM public.presencia_balance_dia(
    '11111111-0000-0000-0000-000000000001'::uuid, CURRENT_DATE - 47, CURRENT_DATE - 47);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MUTACIÓN: el día sembrado por la invariante 28 no está; el arnés no probaría nada';
  END IF;
  IF NOT ('jornada_abierta' = ANY(b.hallazgos)) THEN
    RAISE EXCEPTION 'MUTACIÓN: el día de la invariante 28 dejó de estar abierto (%)', b.hallazgos;
  END IF;
  IF b.horas_sobre_jornada IS NOT NULL THEN
    RAISE EXCEPTION
      'MUTACIÓN: con la jornada abierta horas_sobre_jornada dio % en vez de NULL', b.horas_sobre_jornada;
  END IF;
END $$;
