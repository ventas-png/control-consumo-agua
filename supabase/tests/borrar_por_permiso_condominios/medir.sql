\set ON_ERROR_STOP on

-- Corre cada caso de `bpc_casos` con la identidad de su usuario y anota el
-- resultado en `bpc_medicion` bajo la etapa recibida (`-v etapa=antes|despues`).
-- `bpc_intento` deshace todo lo que hace, así que los casos no se pisan.
--
-- `:etapa` viaja por un GUC porque psql no interpola variables dentro de un
-- literal con comillas de dólar.
SELECT set_config('test.etapa', :'etapa', false) \gset

DO $medir$
DECLARE
  c record;
BEGIN
  DELETE FROM public.bpc_medicion WHERE etapa = current_setting('test.etapa');
  FOR c IN
    SELECT k.caso, k.sql, u.uid
      FROM public.bpc_casos k
      JOIN public.bpc_usuarios u USING (quien)
     ORDER BY k.caso
  LOOP
    INSERT INTO public.bpc_medicion (etapa, caso, resultado)
    VALUES (current_setting('test.etapa'), c.caso, public.bpc_intento(c.uid, c.sql));
  END LOOP;
END;
$medir$;
