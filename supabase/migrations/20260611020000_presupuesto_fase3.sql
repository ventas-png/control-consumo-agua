-- ════════════════════════════════════════════════════════════════════════════
-- PRESUPUESTO AVANZADO — FASE 3 ERP
-- Ver ROADMAP_ERP_FINANZAS.md (Fase 3). Depende de la Fase 1 (conta_*).
--
-- Reemplaza el modelo anual por categoría (presupuesto_condominio, que se
-- mantiene intacto para el módulo legacy de condominios) por partidas
-- MENSUALIZADAS ligadas a CUENTAS CONTABLES, con flujo de aprobación y
-- versionado:
--
--   presupuestos          — cabecera por empresa/proyecto/año:
--                           borrador → propuesto → aprobado → archivado
--                           (aprobar una nueva versión archiva la anterior)
--   presupuesto_partidas  — (cuenta contable, periodo YYYY-MM, monto)
--   presupuesto_vs_real   — comparativo server-side contra la balanza
--                           (asientos publicados), no contra tablas operativas
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Cabecera ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presupuestos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- NULL = presupuesto a nivel empresa
  project_id   uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  anio         int         NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  nombre       text        NOT NULL,
  estado       text        NOT NULL DEFAULT 'borrador'
               CHECK (estado IN ('borrador','propuesto','aprobado','archivado')),
  notas        text,
  aprobado_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  aprobado_at  timestamptz,
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Un solo presupuesto APROBADO vigente por empresa+proyecto+año.
CREATE UNIQUE INDEX IF NOT EXISTS uq_presupuesto_aprobado
  ON public.presupuestos(company_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), anio)
  WHERE estado = 'aprobado';

CREATE INDEX IF NOT EXISTS idx_presupuestos_lista ON public.presupuestos(company_id, anio DESC, estado);
CREATE INDEX IF NOT EXISTS idx_presupuestos_project ON public.presupuestos(project_id);

-- ── 2. Partidas mensualizadas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presupuesto_partidas (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto_id uuid          NOT NULL REFERENCES public.presupuestos(id) ON DELETE CASCADE,
  -- denormalizado para RLS sin join (mismo patrón que conta_asiento_lineas)
  company_id     uuid          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cuenta_id      uuid          NOT NULL REFERENCES public.conta_cuentas(id) ON DELETE RESTRICT,
  periodo        text          NOT NULL CHECK (periodo ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monto          numeric(14,2) NOT NULL DEFAULT 0 CHECK (monto >= 0),
  UNIQUE (presupuesto_id, cuenta_id, periodo)
);

CREATE INDEX IF NOT EXISTS idx_presupuesto_partidas_cuenta
  ON public.presupuesto_partidas(company_id, cuenta_id, periodo);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.presupuestos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presupuesto_partidas ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['presupuestos','presupuesto_partidas'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_select" ON public.%I
        FOR SELECT TO authenticated
        USING (company_id = get_my_company_id() OR is_super_admin())
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_insert" ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_update" ON public.%I
        FOR UPDATE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
        WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
                    AND company_id = get_my_company_id()))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY "%s_delete" ON public.%I
        FOR DELETE TO authenticated
        USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
               AND company_id = get_my_company_id()))
    $p$, t, t);
  END LOOP;
END $$;

-- ── 4. Guardas de estado y versionado ───────────────────────────────────────
-- Un presupuesto aprobado/archivado es de solo lectura (las correcciones son
-- una NUEVA versión); aprobar una versión archiva automáticamente la vigente.
CREATE OR REPLACE FUNCTION public.presupuesto_proteger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.estado = 'archivado' THEN
    RAISE EXCEPTION 'PRESUPUESTO_INMUTABLE: un presupuesto archivado no se modifica.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.estado = 'aprobado' AND NEW.estado NOT IN ('aprobado','archivado') THEN
    RAISE EXCEPTION 'PRESUPUESTO_INMUTABLE: un presupuesto aprobado no se reabre; crea una nueva versión.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuesto_proteger ON public.presupuestos;
CREATE TRIGGER trg_presupuesto_proteger
  BEFORE UPDATE ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_proteger();

CREATE OR REPLACE FUNCTION public.presupuesto_proteger_partidas()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_estado text;
BEGIN
  IF current_setting('conta.allow_system_write', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT estado INTO v_estado FROM public.presupuestos
  WHERE id = COALESCE(NEW.presupuesto_id, OLD.presupuesto_id);
  IF v_estado IN ('aprobado','archivado') THEN
    RAISE EXCEPTION 'PRESUPUESTO_INMUTABLE: las partidas de un presupuesto aprobado/archivado no se modifican.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuesto_proteger_partidas ON public.presupuesto_partidas;
CREATE TRIGGER trg_presupuesto_proteger_partidas
  BEFORE INSERT OR UPDATE OR DELETE ON public.presupuesto_partidas
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_proteger_partidas();

-- Versionado: al aprobar, la versión aprobada anterior del mismo ámbito+año
-- pasa a 'archivado' (escritura de sistema, evita el índice único parcial).
CREATE OR REPLACE FUNCTION public.presupuesto_archivar_anterior()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'aprobado' AND OLD.estado <> 'aprobado' THEN
    PERFORM set_config('conta.allow_system_write', 'on', true);
    UPDATE public.presupuestos
    SET estado = 'archivado', updated_at = now()
    WHERE company_id = NEW.company_id
      AND COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(NEW.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND anio = NEW.anio
      AND estado = 'aprobado'
      AND id <> NEW.id;
    PERFORM set_config('conta.allow_system_write', 'off', true);
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE (no AFTER): archiva la versión vigente ANTES de que el índice único
-- parcial valide la fila nueva, evitando la violación transitoria.
DROP TRIGGER IF EXISTS trg_presupuesto_archivar_anterior ON public.presupuestos;
CREATE TRIGGER trg_presupuesto_archivar_anterior
  BEFORE UPDATE OF estado ON public.presupuestos
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_archivar_anterior();

-- ── 5. Comparativo presupuesto vs real ──────────────────────────────────────
-- El REAL sale de la contabilidad (asientos publicados), no de tablas
-- operativas: por cuenta y periodo, con signo según la naturaleza de la
-- cuenta (gasto/activo deudora = debe−haber; ingreso/pasivo acreedora =
-- haber−debe). SECURITY INVOKER: la RLS aplica sola.
CREATE OR REPLACE FUNCTION public.presupuesto_vs_real(p_presupuesto_id uuid)
RETURNS TABLE (
  cuenta_id     uuid,
  codigo        text,
  nombre        text,
  naturaleza    text,
  periodo       text,
  presupuestado numeric,
  ejecutado     numeric,
  variacion     numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH pres AS (
    SELECT * FROM public.presupuestos WHERE id = p_presupuesto_id
  ),
  reales AS (
    SELECT
      l.cuenta_id,
      a.periodo,
      SUM(CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber
               ELSE l.haber - l.debe END) AS ejecutado
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    JOIN pres ON true
    WHERE l.company_id = pres.company_id
      AND a.estado = 'publicado'
      AND a.periodo LIKE pres.anio::text || '-%'
      AND (pres.project_id IS NULL OR a.project_id = pres.project_id)
    GROUP BY l.cuenta_id, a.periodo
  )
  SELECT
    c.id,
    c.codigo,
    c.nombre,
    c.naturaleza,
    pp.periodo,
    pp.monto::numeric(14,2),
    COALESCE(r.ejecutado, 0)::numeric(14,2),
    (COALESCE(r.ejecutado, 0) - pp.monto)::numeric(14,2)
  FROM public.presupuesto_partidas pp
  JOIN public.conta_cuentas c ON c.id = pp.cuenta_id
  LEFT JOIN reales r ON r.cuenta_id = pp.cuenta_id AND r.periodo = pp.periodo
  WHERE pp.presupuesto_id = p_presupuesto_id
  ORDER BY c.codigo, pp.periodo
$$;

REVOKE EXECUTE ON FUNCTION public.presupuesto_vs_real(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presupuesto_vs_real(uuid) TO authenticated;

-- ── 6. Comentarios ──────────────────────────────────────────────────────────
COMMENT ON TABLE public.presupuestos IS
  'Presupuesto por empresa/proyecto/año ligado a cuentas contables (Fase 3 ERP). borrador→propuesto→aprobado→archivado; aprobar archiva la versión vigente.';
COMMENT ON TABLE public.presupuesto_partidas IS
  'Partidas mensualizadas: (cuenta contable, YYYY-MM, monto). Inmutables cuando el presupuesto está aprobado/archivado.';
COMMENT ON FUNCTION public.presupuesto_vs_real(uuid) IS
  'Comparativo presupuesto vs real desde la balanza (asientos publicados), por cuenta y periodo.';
