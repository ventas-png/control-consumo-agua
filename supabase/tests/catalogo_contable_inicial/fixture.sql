\set ON_ERROR_STOP on

-- `compras_flujo/fixture.sql` (cargado antes, en la misma base) define su
-- propio `chk(numeric, numeric, text)`. Con los dos overloads, una llamada con
-- `integer` es ambigua (integer → bigint y integer → numeric son implícitas
-- las dos) y PostgreSQL aborta con «function public.chk(integer, integer,
-- unknown) is not unique»: la suite nunca llegaba a sus últimas invariantes.
-- En esta base desechable manda el helper de esta suite.
DROP FUNCTION IF EXISTS public.chk(numeric, numeric, text);

CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chk_txt(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '% — esperado %, recibido %', msg, esperado, actual;
  END IF;
  RAISE NOTICE '✓ %', msg;
END;
$$;

CREATE OR REPLACE FUNCTION public.chk_falla(sql text, patron text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%' || patron || '%' THEN
      RAISE NOTICE '✓ %', msg;
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló con mensaje inesperado: %', msg, SQLERRM;
  END;
  RAISE EXCEPTION '% — la sentencia debía fallar', msg;
END;
$$;

-- El padrón existente lo aporta `compras_flujo/fixture.sql`. Se carga antes de
-- las migraciones de compras para reproducir producción: catálogo LATAM más
-- inventario, activo fijo y GR/IR ya retro-sembrados antes de este cambio.
