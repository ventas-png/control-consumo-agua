-- ════════════════════════════════════════════════════════════════════════════
-- `visitas_control.estado`: el vocabulario que la aplicación escribe de verdad
-- ════════════════════════════════════════════════════════════════════════════
--
-- EL BUG. `20260919000000` declaró el CHECK que producción tenía sin que
-- ninguna migración lo dijera:
--
--   CHECK (estado IN ('pendiente', 'visitado', 'con_novedad', 'omitido'))
--
-- La aplicación escribe otra cosa, y lo viene haciendo desde `20260424000059`,
-- que creó la tabla con ese vocabulario en un comentario:
--
--   'pendiente' | 'ok' | 'novedad' | 'omitido'
--
-- Es lo que dicen `EstadoVisitaControl`, `VISITA_CONFIG`, `progresoRonda()` y
-- `marcarVisita()`. O sea: marcar un punto de una ronda —darlo por verificado o
-- registrarle una novedad— viola el CHECK y revienta con 23514.
--
-- LA EVIDENCIA DE QUE NUNCA FUNCIONÓ. `public.visitas_control` tiene CERO filas
-- en producción. La función existe desde abril y el checklist de la ronda nunca
-- pudo cerrarse: cada intento rebotaba contra esta constraint.
--
-- POR QUÉ GANA EL CÓDIGO Y NO PRODUCCIÓN. No se presume que ninguno de los dos
-- lados sea el correcto; se decide. Aquí:
--   · el vocabulario del código es el declarado en el comentario de la
--     migración que creó la tabla — el CHECK es el que llegó después, a mano;
--   · 'ok' y 'novedad' son los que usan las cuatro capas de la aplicación;
--   · la tabla está vacía, así que alinear la BD no migra ni un dato real;
--   · alinear el código exigiría tocar tipos, UI, reglas y pruebas para
--     conservar un vocabulario que ningún código escribe.
--
-- POR QUÉ VA EN SU PROPIA MIGRACIÓN, DESPUÉS DE LA CONVERGENCIA
-- Meter esto dentro de `20260919000000` habría dejado la reconstrucción con un
-- CHECK que producción no tiene (R ≠ P) mientras P ≠ M seguía siendo cierto: el
-- mismo `CAMBIO AMBIGUO` que aquella migración venía a cerrar. Separadas, la
-- primera deja P == M y ésta sale `CAMBIO PLANIFICADO`, que es exactamente lo
-- que es: un cambio pendiente de desplegar.
--
-- TRADUCCIÓN DEFENSIVA. En producción no hay filas, pero este archivo también
-- corre sobre entornos reconstruidos y sobre cualquier base donde algo haya
-- escrito con el vocabulario viejo. Las dos equivalencias son inequívocas
-- ('visitado' = se verificó, 'con_novedad' = se encontró algo) y se traducen
-- ANTES de cambiar la constraint, para no dejar filas que el CHECK nuevo
-- rechace.
--
-- IDEMPOTENTE: el UPDATE está acotado a los valores viejos y el swap de la
-- constraint se decide leyendo el catálogo.
--
-- REVERSA (volvería a romper el marcaje de puntos; sólo por completitud):
--   UPDATE public.visitas_control SET estado = 'visitado'    WHERE estado = 'ok';
--   UPDATE public.visitas_control SET estado = 'con_novedad' WHERE estado = 'novedad';
--   ALTER TABLE public.visitas_control DROP CONSTRAINT visitas_control_estado_check;
--   ALTER TABLE public.visitas_control ADD CONSTRAINT visitas_control_estado_check
--     CHECK (estado IN ('pendiente', 'visitado', 'con_novedad', 'omitido'));
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_traducidas bigint := 0;
  v_parciales  bigint;
  v_definicion text;
BEGIN
  -- ── 1. Traducir lo que haya escrito con el vocabulario viejo ─────────────
  UPDATE public.visitas_control SET estado = 'ok'      WHERE estado = 'visitado';
  GET DIAGNOSTICS v_parciales = ROW_COUNT;
  v_traducidas := v_traducidas + v_parciales;

  UPDATE public.visitas_control SET estado = 'novedad' WHERE estado = 'con_novedad';
  GET DIAGNOSTICS v_parciales = ROW_COUNT;
  v_traducidas := v_traducidas + v_parciales;

  IF v_traducidas > 0 THEN
    RAISE NOTICE 'VOCABULARIO: % fila(s) traducidas al vocabulario de la aplicación', v_traducidas;
  END IF;

  -- ── 2. Cambiar la constraint, sólo si todavía dice lo viejo ──────────────
  SELECT pg_get_constraintdef(con.oid) INTO v_definicion
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'visitas_control'
    AND con.conname = 'visitas_control_estado_check';

  IF v_definicion IS NULL THEN
    RAISE EXCEPTION
      'VOCABULARIO: no existe visitas_control_estado_check. Lo declara 20260919000000; '
      'si se retiró, esta migración ya no sabe qué está arreglando.';
  END IF;

  IF v_definicion LIKE '%''ok''%' AND v_definicion LIKE '%''novedad''%' THEN
    RAISE NOTICE 'VOCABULARIO: el CHECK ya admitía ok/novedad';
  ELSE
    ALTER TABLE public.visitas_control DROP CONSTRAINT visitas_control_estado_check;
    ALTER TABLE public.visitas_control
      ADD CONSTRAINT visitas_control_estado_check
      CHECK (estado IN ('pendiente', 'ok', 'novedad', 'omitido'));
    RAISE NOTICE 'VOCABULARIO: el CHECK de estado ahora admite ok/novedad';
  END IF;
END;
$$;

COMMENT ON COLUMN public.visitas_control.estado IS
  'Estado de la parada dentro de la ronda: pendiente | ok | novedad | omitido. Mismo vocabulario que EstadoVisitaControl en el cliente.';

-- ── 3. Postcondición: que no quede ninguna fila fuera del dominio nuevo ────
DO $$
DECLARE
  v_fuera bigint;
BEGIN
  SELECT count(*) INTO v_fuera FROM public.visitas_control
   WHERE estado NOT IN ('pendiente', 'ok', 'novedad', 'omitido');
  IF v_fuera > 0 THEN
    RAISE EXCEPTION 'VOCABULARIO: quedaron % fila(s) con un estado fuera del dominio', v_fuera;
  END IF;
  RAISE NOTICE 'VOCABULARIO: marcar un punto de ronda ya no rebota contra el CHECK.';
END;
$$;
