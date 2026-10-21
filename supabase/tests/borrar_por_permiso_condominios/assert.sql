\set ON_ERROR_STOP on

-- Compara la medición de una etapa (`-v etapa=antes|despues`) con lo esperado en
-- `bpc_casos`. Lista TODOS los casos que no cuadran antes de fallar: con un
-- solo nombre no se sabe si se rompió una tabla o la regla entera.
SELECT set_config('test.etapa', :'etapa', false) \gset

DO $assert$
DECLARE
  v_etapa   text := current_setting('test.etapa');
  v_total   int;
  v_medidos int;
  v_fallos  text;
  v_n       int;
BEGIN
  SELECT count(*) INTO v_total FROM public.bpc_casos;
  SELECT count(*) INTO v_medidos FROM public.bpc_medicion WHERE etapa = v_etapa;
  IF v_total = 0 OR v_medidos <> v_total THEN
    RAISE EXCEPTION '[%] se esperaban % casos medidos, hay %', v_etapa, v_total, v_medidos;
  END IF;

  SELECT count(*),
         string_agg(format('%s: esperado %s, medido %s', k.caso,
                           CASE v_etapa WHEN 'antes' THEN k.antes ELSE k.despues END,
                           coalesce(m.resultado, '—')), E'\n  ' ORDER BY k.caso)
    INTO v_n, v_fallos
  FROM public.bpc_casos k
  LEFT JOIN public.bpc_medicion m ON m.caso = k.caso AND m.etapa = v_etapa
  WHERE m.resultado IS DISTINCT FROM CASE v_etapa WHEN 'antes' THEN k.antes ELSE k.despues END;

  IF v_n > 0 THEN
    RAISE EXCEPTION E'[%] % de % casos no cuadran:\n  %', v_etapa, v_n, v_total, v_fallos;
  END IF;

  RAISE NOTICE 'OK    [%] los % casos dan lo esperado', v_etapa, v_total;
END;
$assert$;
