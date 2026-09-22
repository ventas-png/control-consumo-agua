\set ON_ERROR_STOP on

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
