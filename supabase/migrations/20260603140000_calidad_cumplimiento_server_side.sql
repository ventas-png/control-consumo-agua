-- serv:S22 — Cálculo de cumplimiento de calidad en Postgres (función + trigger).
--
-- POR QUÉ: hoy `registros_calidad.cumplimiento` y `.cumple_total` se calculan
-- SOLO en el cliente (src/components/calidad/constants.ts → calcularCumplimiento)
-- y se mandan en el INSERT. Un cliente con bug, una integración futura o un
-- INSERT directo pueden persistir un cumplimiento inconsistente con los umbrales
-- regulados. Movemos el cómputo al servidor para que sea la fuente de verdad:
-- el trigger recalcula ambas columnas en cada INSERT/UPDATE, ignorando lo que
-- mande el cliente.
--
-- QUÉ:
--   1. Función public.calcular_cumplimiento_calidad(tipo_agua, parametros) que
--      replica fielmente la lógica TS (umbrales por tipología + regla de
--      "debe ser 0" para microbiológicos).
--   2. Trigger BEFORE INSERT/UPDATE en registros_calidad que deriva el tipo de
--      agua de la fuente y setea NEW.cumplimiento / NEW.cumple_total.
--   3. Backfill de las filas existentes (recálculo idempotente).
--
-- UMBRALES: portados 1:1 de TIPOLOGIAS_CALIDAD (constants.ts). Mientras no exista
-- una tabla de umbrales (serv:S23 — "TIPOLOGIAS_CALIDAD a DB"), viven embebidos
-- aquí; cualquier cambio debe hacerse en AMBOS lugares hasta que S23 los unifique.
--
-- IMPACTO (datos productivos): el backfill recalcula filas existentes con la
-- misma fórmula que ya usaba el cliente → idempotente (no cambia valores salvo
-- que estuvieran inconsistentes, que es justo lo que queremos corregir).
--
-- REVERTIR:
--   DROP TRIGGER IF EXISTS registros_calidad_cumplimiento ON public.registros_calidad;
--   DROP FUNCTION IF EXISTS public.trg_registros_calidad_cumplimiento();
--   DROP FUNCTION IF EXISTS public.calcular_cumplimiento_calidad(text, jsonb);

-- ── 1. Función de cumplimiento (pura, umbrales embebidos) ────────────────────
CREATE OR REPLACE FUNCTION public.calcular_cumplimiento_calidad(
  p_tipo_agua text,
  p_parametros jsonb
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  -- Umbrales [min, max] por tipología, 1:1 con TIPOLOGIAS_CALIDAD (constants.ts).
  v_umbrales constant jsonb := '{
    "potable": {"pH":[6.5,8.5],"turbiedad":[0,5],"cloro_residual":[0.2,1.0],"coliformes_totales":[0,0],"coliformes_fecales":[0,0],"color":[0,15],"dureza":[0,400],"nitratos":[0,50],"nitritos":[0,3],"sulfatos":[0,250],"conductividad":[0,1500]},
    "rehuso": {"pH":[6.0,9.0],"DBO":[0,30],"DQO":[0,100],"solidos_suspendidos":[0,30],"coliformes_fecales":[0,1000],"grasas_aceites":[0,10]},
    "piscina": {"pH":[7.2,7.8],"cloro_libre":[1.0,3.0],"cloro_combinado":[0,0.5],"temperatura":[0,30],"turbiedad":[0,0.5]},
    "desalinada": {"conductividad":[0,1000],"TDS":[0,500],"pH":[6.5,8.5],"salinidad":[0,0.5],"turbiedad":[0,1],"sulfatos":[0,250]},
    "riego": {"pH":[5.5,8.5],"conductividad":[0,3000],"sodio":[0,200],"cloruros":[0,350],"bicarbonatos":[0,400],"nitratos":[0,50],"RAS":[0,18]},
    "jacuzzi": {"pH":[7.2,7.8],"cloro_libre":[2.0,5.0],"cloro_combinado":[0,1.0],"temperatura":[0,40],"alcalinidad_total":[80,120],"turbiedad":[0,0.5]},
    "consumo_humano": {"pH":[6.5,8.5],"turbiedad":[0,1],"cloro_residual":[0.2,1.5],"coliformes_totales":[0,0],"ecoli":[0,0],"color":[0,15],"dureza_total":[0,500]},
    "desmineralizada": {"conductividad":[0,10],"TDS":[0,5],"pH":[5.5,7.0],"silice":[0,0.02],"dureza":[0,1]},
    "residuales_tratadas": {"pH":[6.0,9.0],"DBO":[0,20],"DQO":[0,60],"SST":[0,20],"grasas_aceites":[0,5],"coliformes_fecales":[0,400],"nitrogeno_total":[0,15],"fosforo_total":[0,2]}
  }'::jsonb;
  v_tipo jsonb;
  v_param text;
  v_rango jsonb;
  v_min numeric;
  v_max numeric;
  v_valtxt text;
  v_val numeric;
  v_ok boolean;
  v_cumplimiento jsonb := '{}'::jsonb;
  v_todos boolean := true;
BEGIN
  v_tipo := v_umbrales -> p_tipo_agua;
  -- Tipología desconocida → mismo fallback que el cliente: {} y cumple_total false.
  IF v_tipo IS NULL THEN
    RETURN jsonb_build_object('cumplimiento', '{}'::jsonb, 'cumple_total', false);
  END IF;

  FOR v_param, v_rango IN SELECT * FROM jsonb_each(v_tipo) LOOP
    v_min := (v_rango ->> 0)::numeric;
    v_max := (v_rango ->> 1)::numeric;
    v_valtxt := p_parametros ->> v_param;

    -- Valor ausente o no numérico → null (no afecta cumple_total), igual que el
    -- cliente (isNaN → cumplimiento[key]=null; no marca todosCumplen=false).
    IF v_valtxt IS NULL OR v_valtxt !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      -- NULL::boolean para que jsonb_build_object no falle por tipo "unknown".
      v_cumplimiento := v_cumplimiento || jsonb_build_object(v_param, NULL::boolean);
      CONTINUE;
    END IF;

    v_val := v_valtxt::numeric;
    -- Microbiológicos / "debe ser 0": min=max=0 ⇒ se exige exactamente 0.
    IF v_min = 0 AND v_max = 0 THEN
      v_ok := (v_val = 0);
    ELSE
      v_ok := (v_val >= v_min AND v_val <= v_max);
    END IF;

    v_cumplimiento := v_cumplimiento || jsonb_build_object(v_param, v_ok);
    IF NOT v_ok THEN
      v_todos := false;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('cumplimiento', v_cumplimiento, 'cumple_total', v_todos);
END;
$$;

-- ── 2. Trigger: el servidor es autoritativo sobre cumplimiento/cumple_total ──
CREATE OR REPLACE FUNCTION public.trg_registros_calidad_cumplimiento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tipo_agua text;
  v_result jsonb;
BEGIN
  -- El tipo de agua se deriva de la fuente; sin fuente no hay tipología.
  SELECT fa.tipo_agua INTO v_tipo_agua
  FROM public.fuentes_agua fa
  WHERE fa.id = NEW.fuente_id;

  v_result := public.calcular_cumplimiento_calidad(
    COALESCE(v_tipo_agua, ''),
    COALESCE(NEW.parametros, '{}'::jsonb)
  );

  NEW.cumplimiento := v_result -> 'cumplimiento';
  NEW.cumple_total := (v_result ->> 'cumple_total')::boolean;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS registros_calidad_cumplimiento ON public.registros_calidad;
CREATE TRIGGER registros_calidad_cumplimiento
  BEFORE INSERT OR UPDATE OF parametros, fuente_id ON public.registros_calidad
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_registros_calidad_cumplimiento();

-- ── 3. Backfill idempotente de filas existentes ─────────────────────────────
-- Solo filas con fuente válida (sin fuente no se puede derivar la tipología).
UPDATE public.registros_calidad rc
SET cumplimiento = public.calcular_cumplimiento_calidad(
      COALESCE(fa.tipo_agua, ''), COALESCE(rc.parametros, '{}'::jsonb)) -> 'cumplimiento',
    cumple_total = (public.calcular_cumplimiento_calidad(
      COALESCE(fa.tipo_agua, ''), COALESCE(rc.parametros, '{}'::jsonb)) ->> 'cumple_total')::boolean
FROM public.fuentes_agua fa
WHERE rc.fuente_id = fa.id;
