-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte B: moneda base por ledger + tasa cruzada
-- + folios correlativos por ledger
--
--   · conta_moneda_base(company, project): empresa → companies.default_currency;
--     proyecto → COALESCE(projects.moneda_condominios, projects.moneda)
--     normalizada (la "moneda predominante" ya configurada del proyecto).
--     La firma de 1 arg queda como wrapper (compat con funciones previas).
--   · conta_tasa_entre(company, de, a, fecha): conversión cruzada con PIVOTE =
--     moneda de la empresa (conta_tipos_cambio sigue siendo una sola tabla de
--     tasas por empresa, expresadas en moneda-empresa por unidad extranjera).
--     Sin tasa necesaria → NULL (regla de Fase 1: nunca inventar tasa).
--   · conta_folios por ledger: cada contabilidad lleva su correlativo 1,2,3…
--     El contador existente pasa a ser el del ledger EMPRESA (su numeración
--     continúa); los ledgers de proyecto arrancan en 1.
--
-- Firmas nuevas SIN DEFAULT para no crear ambigüedad de overload en PostgREST.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Moneda base por ledger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.conta_moneda_base(p_company_id uuid, p_project_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_project_id IS NULL THEN
      COALESCE(public.conta_normalizar_moneda(c.default_currency), 'GTQ')
    ELSE
      COALESCE(
        public.conta_normalizar_moneda(COALESCE(pr.moneda_condominios, pr.moneda)),
        public.conta_normalizar_moneda(c.default_currency),
        'GTQ'
      )
  END
  FROM public.companies c
  LEFT JOIN public.projects pr ON pr.id = p_project_id
  WHERE c.id = p_company_id
$$;

REVOKE EXECUTE ON FUNCTION public.conta_moneda_base(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_moneda_base(uuid, uuid) TO authenticated;

-- Wrapper de compat: la 1-arg sigue siendo "moneda del ledger empresa".
CREATE OR REPLACE FUNCTION public.conta_moneda_base(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.conta_moneda_base(p_company_id, NULL)
$$;

-- ── 2. Tasa cruzada (pivote = moneda de la empresa) ─────────────────────────
-- Devuelve unidades de p_a por 1 unidad de p_de a la fecha, o NULL si falta
-- alguna tasa necesaria (el generador deja el asiento en borrador).
CREATE OR REPLACE FUNCTION public.conta_tasa_entre(
  p_company_id uuid, p_de text, p_a text, p_fecha date
)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pivote text;
  v_de numeric(18,8);
  v_a  numeric(18,8);
BEGIN
  IF p_de IS NULL OR p_a IS NULL THEN RETURN NULL; END IF;
  IF p_de = p_a THEN RETURN 1; END IF;

  v_pivote := public.conta_moneda_base(p_company_id, NULL);
  v_de := CASE WHEN p_de = v_pivote THEN 1
               ELSE public.conta_tasa_vigente(p_company_id, p_de, p_fecha) END;
  v_a  := CASE WHEN p_a = v_pivote THEN 1
               ELSE public.conta_tasa_vigente(p_company_id, p_a, p_fecha) END;
  IF v_de IS NULL OR v_a IS NULL OR v_a = 0 THEN RETURN NULL; END IF;
  RETURN round(v_de / v_a, 6);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_tasa_entre(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_tasa_entre(uuid, text, text, date) TO authenticated;

-- ── 3. Folios por ledger ────────────────────────────────────────────────────
-- conta_folios pierde su PK por company (pasa a surrogate) y gana project_id;
-- la unicidad real vive en el índice de expresión por ledger.
ALTER TABLE public.conta_folios DROP CONSTRAINT IF EXISTS conta_folios_pkey;
ALTER TABLE public.conta_folios ADD COLUMN IF NOT EXISTS id uuid;
UPDATE public.conta_folios SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.conta_folios ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.conta_folios ALTER COLUMN id SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conta_folios_pkey'
  ) THEN
    ALTER TABLE public.conta_folios ADD CONSTRAINT conta_folios_pkey PRIMARY KEY (id);
  END IF;
END $$;
ALTER TABLE public.conta_folios
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_folios_ledger
  ON public.conta_folios(company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE OR REPLACE FUNCTION public.conta_siguiente_folio(p_company_id uuid, p_project_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_folio bigint;
BEGIN
  INSERT INTO public.conta_folios (company_id, project_id, ultimo)
  VALUES (p_company_id, p_project_id, 0)
  ON CONFLICT (company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO NOTHING;
  SELECT ultimo + 1 INTO v_folio FROM public.conta_folios
  WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id
  FOR UPDATE;
  UPDATE public.conta_folios SET ultimo = v_folio
  WHERE company_id = p_company_id AND project_id IS NOT DISTINCT FROM p_project_id;
  RETURN v_folio;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_siguiente_folio(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Wrapper de compat (ledger empresa) — lo consumen funciones que se
-- actualizan en la parte C/PR2; se elimina al final de la serie ledger.
CREATE OR REPLACE FUNCTION public.conta_siguiente_folio(p_company_id uuid)
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.conta_siguiente_folio(p_company_id, NULL)
$$;

-- ── 4. Unicidad de folio por ledger en asientos ─────────────────────────────
-- Los asientos existentes (numerados por company) la satisfacen trivialmente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_asiento_numero_ledger
  ON public.conta_asientos(company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), numero)
  WHERE numero IS NOT NULL;

DROP INDEX IF EXISTS public.uq_conta_asiento_numero;

COMMENT ON FUNCTION public.conta_moneda_base(uuid, uuid) IS
  'Moneda base del ledger: (company, NULL) = empresa (default_currency); (company, project) = moneda predominante del proyecto (moneda_condominios o moneda).';
COMMENT ON FUNCTION public.conta_tasa_entre(uuid, text, text, date) IS
  'Tasa de conversión entre dos monedas vía pivote (moneda de la empresa) con las tasas de conta_tipos_cambio. NULL si falta una tasa: nunca se inventa.';
