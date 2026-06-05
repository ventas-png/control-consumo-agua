-- serv:S23 — Catálogo de tipologías de calidad en base de datos.
--
-- POR QUÉ: TIPOLOGIAS_CALIDAD vivía hardcodeado en el cliente (constants.ts) y
-- duplicado en la función Postgres calcular_cumplimiento_calidad (S22). Cualquier
-- ajuste de umbrales regulatorios exigía despliegue de código. Esta migración
-- mueve el catálogo a la tabla public.calidad_tipologias, permitiendo gestión de
-- umbrales sin redeploy, soporte de overrides por empresa (company_id no nulo) y
-- una única fuente de verdad compartida por cliente y servidor.
--
-- QUÉ:
--   1. Tabla public.calidad_tipologias con catálogo global (company_id NULL) y
--      soporte de sobreescrituras por empresa.
--   2. RLS: cualquier usuario autenticado puede leer; solo admin/owner escribe
--      overrides de su propia empresa (nunca el catálogo global).
--   3. Seed de las 9 tipologías portadas 1:1 desde constants.ts.
--   4. public.calcular_cumplimiento_calidad reescrita para leer de la tabla
--      (firma ampliada con p_company_id DEFAULT NULL para retrocompatibilidad
--      con el trigger existente).
--
-- BACKFILL: no necesario; el trigger de S22 sigue activo y se reejecutará
-- automáticamente en el próximo INSERT/UPDATE de cada registro.
--
-- REVERTIR:
--   DROP FUNCTION IF EXISTS public.calcular_cumplimiento_calidad(text,jsonb,uuid);
--   -- Restaurar versión S22 de calcular_cumplimiento_calidad(text,jsonb).
--   DROP TABLE IF EXISTS public.calidad_tipologias;

-- ── 1. Tabla de catálogo ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.calidad_tipologias (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo_agua   text        NOT NULL,
  company_id  uuid        REFERENCES public.companies(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  parametros  jsonb       NOT NULL,  -- array de {key, label, unidad, min, max}
  activo      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calidad_tipologias_scope_unique UNIQUE (tipo_agua, company_id)
);

COMMENT ON TABLE public.calidad_tipologias IS
  'Catálogo de tipologías de calidad de agua con sus parámetros y umbrales. '
  'Filas con company_id NULL son el catálogo global (gestionado por el equipo). '
  'Filas con company_id son overrides de empresa que prevalecen sobre el global. '
  'Reemplaza TIPOLOGIAS_CALIDAD hardcodeado en constants.ts (serv:S23).';

COMMENT ON COLUMN public.calidad_tipologias.tipo_agua IS
  'Clave de la tipología, p.ej. "potable", "piscina". Debe coincidir con el '
  'campo tipo_agua de public.fuentes_agua.';

COMMENT ON COLUMN public.calidad_tipologias.company_id IS
  'NULL = catálogo global. UUID = override exclusivo de esa empresa.';

COMMENT ON COLUMN public.calidad_tipologias.parametros IS
  'Array JSON de parámetros: [{key, label, unidad, min, max}, ...]. '
  'min = max = 0 indica "debe ser exactamente 0" (e.g. coliformes).';

-- ── 2. Índices ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_calidad_tipologias_tipo_agua
  ON public.calidad_tipologias(tipo_agua);

CREATE INDEX IF NOT EXISTS idx_calidad_tipologias_company_id
  ON public.calidad_tipologias(company_id);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.calidad_tipologias ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier usuario autenticado ve el catálogo global + overrides de su empresa.
DROP POLICY IF EXISTS "calidad_tipologias_select" ON public.calidad_tipologias;
CREATE POLICY "calidad_tipologias_select" ON public.calidad_tipologias
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR company_id = get_my_company_id());

-- INSERT: solo admin/owner puede crear overrides para su propia empresa.
-- No se permite insertar en el catálogo global (company_id NULL) desde el cliente.
DROP POLICY IF EXISTS "calidad_tipologias_insert" ON public.calidad_tipologias;
CREATE POLICY "calidad_tipologias_insert" ON public.calidad_tipologias
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = get_my_company_id()
    AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
  );

-- UPDATE: misma restricción que insert.
DROP POLICY IF EXISTS "calidad_tipologias_update" ON public.calidad_tipologias;
CREATE POLICY "calidad_tipologias_update" ON public.calidad_tipologias
  FOR UPDATE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
  )
  WITH CHECK (
    company_id = get_my_company_id()
    AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
  );

-- DELETE: misma restricción que insert.
DROP POLICY IF EXISTS "calidad_tipologias_delete" ON public.calidad_tipologias;
CREATE POLICY "calidad_tipologias_delete" ON public.calidad_tipologias
  FOR DELETE TO authenticated
  USING (
    company_id = get_my_company_id()
    AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
  );

-- ── 4. Seed del catálogo global (company_id = NULL) ──────────────────────────
-- Portado 1:1 desde TIPOLOGIAS_CALIDAD en src/components/calidad/constants.ts.
-- ON CONFLICT DO NOTHING garantiza idempotencia.

INSERT INTO public.calidad_tipologias (tipo_agua, company_id, label, parametros)
VALUES
  -- potable ----------------------------------------------------------------
  (
    'potable',
    NULL,
    'Agua Potable',
    '[
      {"key":"pH",                 "label":"pH",                  "unidad":"",           "min":6.5, "max":8.5},
      {"key":"turbiedad",          "label":"Turbiedad",           "unidad":"NTU",        "min":0,   "max":5},
      {"key":"cloro_residual",     "label":"Cloro Residual",      "unidad":"mg/L",       "min":0.2, "max":1.0},
      {"key":"coliformes_totales", "label":"Coliformes Totales",  "unidad":"UFC/100mL",  "min":0,   "max":0},
      {"key":"coliformes_fecales", "label":"Coliformes Fecales",  "unidad":"UFC/100mL",  "min":0,   "max":0},
      {"key":"color",              "label":"Color",               "unidad":"UPC",        "min":0,   "max":15},
      {"key":"dureza",             "label":"Dureza",              "unidad":"mg/L CaCO₃", "min":0,   "max":400},
      {"key":"nitratos",           "label":"Nitratos",            "unidad":"mg/L",       "min":0,   "max":50},
      {"key":"nitritos",           "label":"Nitritos",            "unidad":"mg/L",       "min":0,   "max":3},
      {"key":"sulfatos",           "label":"Sulfatos",            "unidad":"mg/L",       "min":0,   "max":250},
      {"key":"conductividad",      "label":"Conductividad",       "unidad":"µS/cm",      "min":0,   "max":1500}
    ]'::jsonb
  ),
  -- rehuso -----------------------------------------------------------------
  (
    'rehuso',
    NULL,
    'Agua de Rehuso',
    '[
      {"key":"pH",                  "label":"pH",                 "unidad":"",          "min":6.0, "max":9.0},
      {"key":"DBO",                 "label":"DBO",                "unidad":"mg/L",      "min":0,   "max":30},
      {"key":"DQO",                 "label":"DQO",                "unidad":"mg/L",      "min":0,   "max":100},
      {"key":"solidos_suspendidos", "label":"Sólidos Suspendidos","unidad":"mg/L",      "min":0,   "max":30},
      {"key":"coliformes_fecales",  "label":"Coliformes Fecales", "unidad":"UFC/100mL", "min":0,   "max":1000},
      {"key":"grasas_aceites",      "label":"Grasas y Aceites",   "unidad":"mg/L",      "min":0,   "max":10}
    ]'::jsonb
  ),
  -- piscina ----------------------------------------------------------------
  (
    'piscina',
    NULL,
    'Agua Piscina',
    '[
      {"key":"pH",             "label":"pH",             "unidad":"",    "min":7.2, "max":7.8},
      {"key":"cloro_libre",    "label":"Cloro Libre",    "unidad":"mg/L","min":1.0, "max":3.0},
      {"key":"cloro_combinado","label":"Cloro Combinado","unidad":"mg/L","min":0,   "max":0.5},
      {"key":"temperatura",    "label":"Temperatura",    "unidad":"°C",  "min":0,   "max":30},
      {"key":"turbiedad",      "label":"Turbiedad",      "unidad":"NTU", "min":0,   "max":0.5}
    ]'::jsonb
  ),
  -- desalinada -------------------------------------------------------------
  (
    'desalinada',
    NULL,
    'Agua Desalinada',
    '[
      {"key":"conductividad","label":"Conductividad","unidad":"µS/cm","min":0,   "max":1000},
      {"key":"TDS",          "label":"TDS",          "unidad":"mg/L", "min":0,   "max":500},
      {"key":"pH",           "label":"pH",           "unidad":"",     "min":6.5, "max":8.5},
      {"key":"salinidad",    "label":"Salinidad",    "unidad":"g/L",  "min":0,   "max":0.5},
      {"key":"turbiedad",    "label":"Turbiedad",    "unidad":"NTU",  "min":0,   "max":1},
      {"key":"sulfatos",     "label":"Sulfatos",     "unidad":"mg/L", "min":0,   "max":250}
    ]'::jsonb
  ),
  -- riego ------------------------------------------------------------------
  (
    'riego',
    NULL,
    'Agua de Riego',
    '[
      {"key":"pH",           "label":"pH",          "unidad":"",      "min":5.5, "max":8.5},
      {"key":"conductividad","label":"Conductividad","unidad":"µS/cm","min":0,   "max":3000},
      {"key":"sodio",        "label":"Sodio",        "unidad":"mg/L", "min":0,   "max":200},
      {"key":"cloruros",     "label":"Cloruros",     "unidad":"mg/L", "min":0,   "max":350},
      {"key":"bicarbonatos", "label":"Bicarbonatos", "unidad":"mg/L", "min":0,   "max":400},
      {"key":"nitratos",     "label":"Nitratos",     "unidad":"mg/L", "min":0,   "max":50},
      {"key":"RAS",          "label":"RAS",          "unidad":"",     "min":0,   "max":18}
    ]'::jsonb
  ),
  -- jacuzzi ----------------------------------------------------------------
  (
    'jacuzzi',
    NULL,
    'Agua Jacuzzi',
    '[
      {"key":"pH",               "label":"pH",              "unidad":"",    "min":7.2, "max":7.8},
      {"key":"cloro_libre",      "label":"Cloro Libre",     "unidad":"mg/L","min":2.0, "max":5.0},
      {"key":"cloro_combinado",  "label":"Cloro Combinado", "unidad":"mg/L","min":0,   "max":1.0},
      {"key":"temperatura",      "label":"Temperatura",     "unidad":"°C",  "min":0,   "max":40},
      {"key":"alcalinidad_total","label":"Alcalinidad Total","unidad":"mg/L","min":80,  "max":120},
      {"key":"turbiedad",        "label":"Turbiedad",       "unidad":"NTU", "min":0,   "max":0.5}
    ]'::jsonb
  ),
  -- consumo_humano ---------------------------------------------------------
  (
    'consumo_humano',
    NULL,
    'Agua de Consumo Humano',
    '[
      {"key":"pH",                 "label":"pH",                 "unidad":"",           "min":6.5, "max":8.5},
      {"key":"turbiedad",          "label":"Turbiedad",          "unidad":"NTU",        "min":0,   "max":1},
      {"key":"cloro_residual",     "label":"Cloro Residual",     "unidad":"mg/L",       "min":0.2, "max":1.5},
      {"key":"coliformes_totales", "label":"Coliformes Totales", "unidad":"UFC/100mL",  "min":0,   "max":0},
      {"key":"ecoli",              "label":"E. coli",            "unidad":"UFC/100mL",  "min":0,   "max":0},
      {"key":"color",              "label":"Color",              "unidad":"UPC",        "min":0,   "max":15},
      {"key":"dureza_total",       "label":"Dureza Total",       "unidad":"mg/L CaCO₃", "min":0,   "max":500}
    ]'::jsonb
  ),
  -- desmineralizada --------------------------------------------------------
  (
    'desmineralizada',
    NULL,
    'Agua Desmineralizada',
    '[
      {"key":"conductividad","label":"Conductividad","unidad":"µS/cm",   "min":0,   "max":10},
      {"key":"TDS",          "label":"TDS",          "unidad":"mg/L",    "min":0,   "max":5},
      {"key":"pH",           "label":"pH",           "unidad":"",        "min":5.5, "max":7.0},
      {"key":"silice",       "label":"Sílice",       "unidad":"mg/L",    "min":0,   "max":0.02},
      {"key":"dureza",       "label":"Dureza",       "unidad":"mg/L CaCO₃","min":0, "max":1}
    ]'::jsonb
  ),
  -- residuales_tratadas ----------------------------------------------------
  (
    'residuales_tratadas',
    NULL,
    'Aguas Residuales Tratadas',
    '[
      {"key":"pH",               "label":"pH",                         "unidad":"",          "min":6.0, "max":9.0},
      {"key":"DBO",              "label":"DBO",                        "unidad":"mg/L",      "min":0,   "max":20},
      {"key":"DQO",              "label":"DQO",                        "unidad":"mg/L",      "min":0,   "max":60},
      {"key":"SST",              "label":"Sólidos Suspendidos Totales","unidad":"mg/L",      "min":0,   "max":20},
      {"key":"grasas_aceites",   "label":"Grasas y Aceites",           "unidad":"mg/L",      "min":0,   "max":5},
      {"key":"coliformes_fecales","label":"Coliformes Fecales",        "unidad":"UFC/100mL", "min":0,   "max":400},
      {"key":"nitrogeno_total",  "label":"Nitrógeno Total",            "unidad":"mg/L",      "min":0,   "max":15},
      {"key":"fosforo_total",    "label":"Fósforo Total",              "unidad":"mg/L",      "min":0,   "max":2}
    ]'::jsonb
  )
ON CONFLICT ON CONSTRAINT calidad_tipologias_scope_unique DO NOTHING;

-- ── 5. Función calcular_cumplimiento_calidad actualizada ─────────────────────
-- Firma ampliada con p_company_id DEFAULT NULL para retrocompatibilidad total:
--   · El trigger de S22 llama calcular_cumplimiento_calidad(text, jsonb) sin
--     company_id → usa DEFAULT NULL → consulta catálogo global.
--   · Llamadas futuras con company_id buscan primero el override de empresa y
--     hacen fallback al catálogo global si no existe.
-- STABLE (no IMMUTABLE) porque ahora lee de una tabla.

CREATE OR REPLACE FUNCTION public.calcular_cumplimiento_calidad(
  p_tipo_agua  text,
  p_parametros jsonb,
  p_company_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_tipologia  public.calidad_tipologias%ROWTYPE;
  v_param_def  jsonb;
  v_param      text;
  v_min        numeric;
  v_max        numeric;
  v_valtxt     text;
  v_val        numeric;
  v_ok         boolean;
  v_cumplimiento jsonb   := '{}'::jsonb;
  v_todos        boolean := true;
BEGIN
  -- Buscar override de empresa si se proporcionó company_id; si no hay override
  -- (o company_id es NULL), usar el catálogo global (company_id IS NULL).
  IF p_company_id IS NOT NULL THEN
    SELECT * INTO v_tipologia
    FROM public.calidad_tipologias
    WHERE tipo_agua  = p_tipo_agua
      AND company_id = p_company_id
      AND activo     = true
    LIMIT 1;
  END IF;

  -- Fallback al catálogo global cuando no hay override o no se pidió empresa.
  IF NOT FOUND THEN
    SELECT * INTO v_tipologia
    FROM public.calidad_tipologias
    WHERE tipo_agua  = p_tipo_agua
      AND company_id IS NULL
      AND activo     = true
    LIMIT 1;
  END IF;

  -- Tipología desconocida → mismo fallback que el cliente y la versión S22.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('cumplimiento', '{}'::jsonb, 'cumple_total', false);
  END IF;

  -- Iterar parámetros en el orden del array (equivalente al forEach del cliente).
  FOR v_param_def IN
    SELECT jsonb_array_elements(v_tipologia.parametros)
  LOOP
    v_param  := v_param_def ->> 'key';
    v_min    := (v_param_def ->> 'min')::numeric;
    v_max    := (v_param_def ->> 'max')::numeric;
    v_valtxt := p_parametros ->> v_param;

    -- Valor ausente o no numérico → null (no afecta cumple_total), igual que
    -- el cliente (isNaN → cumplimiento[key]=null; no marca todosCumplen=false).
    IF v_valtxt IS NULL OR v_valtxt !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
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

-- ── 6. Permisos de la función ────────────────────────────────────────────────
-- La función lee de calidad_tipologias (cubierta por RLS para el cliente) y es
-- llamada por el trigger (que corre como el dueño de la tabla, generalmente
-- postgres / service_role). No se expone a anon ni authenticated directamente.
REVOKE EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.calcular_cumplimiento_calidad(text, jsonb, uuid)
  TO service_role;
