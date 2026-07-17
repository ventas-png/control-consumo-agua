-- ============================================================================
-- Timbrado fiscal: precio por DTE configurable + contador por tenant (F8)
-- ============================================================================
-- El transporte real de Ainnova sigue bloqueado por el contrato PAC (manual +
-- credenciales + allowlist de red — ver ainnovaProvider.ts, que falla seguro).
-- Lo que SÍ se deja listo y configurable es el modelo de COBRO del timbrado,
-- para que al cerrar el contrato solo haya que cargar credenciales:
--
--   1. timbrado_config — por empresa: precio por DTE (USD cents, coherente con
--      billing_plans) + timbres incluidos al mes + activo. Sin fila o inactiva
--      el timbrado NO genera costo (default seguro; hoy todo es sandbox).
--      La escribe el superadmin; el tenant puede LEERLA (transparencia).
--   2. documentos_fiscales.costo_cents — snapshot al TIMBRAR OK: 0 si el DTE
--      cayó dentro de la cuota incluida del mes, el precio vigente si no.
--      Cambios de config solo afectan timbrados futuros.
--   3. superadmin_timbres_resumen(company) — timbres y costo acumulado por mes
--      (últimos 6 con actividad) para el drawer del superadmin.
-- ============================================================================

-- ─── 1. Config por empresa ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.timbrado_config (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  activo            boolean     NOT NULL DEFAULT true,
  -- Precio por DTE timbrado, en USD cents (misma unidad que billing_plans).
  precio_dte_cents  integer     NOT NULL DEFAULT 0 CHECK (precio_dte_cents >= 0),
  -- DTEs incluidos sin costo cada mes calendario (0 = todos se cobran).
  timbres_incluidos integer     NOT NULL DEFAULT 0 CHECK (timbres_incluidos >= 0),
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timbrado_config_unica UNIQUE (company_id)
);

COMMENT ON TABLE public.timbrado_config IS
  'Modelo de cobro del timbrado fiscal por empresa (F8): precio por DTE (USD cents) + cuota mensual incluida. La fija el superadmin; el tenant la puede leer. Sin fila o inactiva → timbrar no genera costo. Se sella por DTE en documentos_fiscales.costo_cents.';

ALTER TABLE public.timbrado_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timbrado_config_sel" ON public.timbrado_config;
CREATE POLICY "timbrado_config_sel" ON public.timbrado_config
  FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

DROP POLICY IF EXISTS "timbrado_config_ins" ON public.timbrado_config;
CREATE POLICY "timbrado_config_ins" ON public.timbrado_config
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "timbrado_config_upd" ON public.timbrado_config;
CREATE POLICY "timbrado_config_upd" ON public.timbrado_config
  FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
DROP POLICY IF EXISTS "timbrado_config_del" ON public.timbrado_config;
CREATE POLICY "timbrado_config_del" ON public.timbrado_config
  FOR DELETE TO authenticated USING (is_super_admin());

-- ─── 2. Snapshot del costo en cada DTE timbrado ──────────────────────────────

ALTER TABLE public.documentos_fiscales
  ADD COLUMN IF NOT EXISTS costo_cents integer;

COMMENT ON COLUMN public.documentos_fiscales.costo_cents IS
  'Costo del timbre sellado al certificar (F8), en USD cents: 0 = dentro de la cuota incluida del mes; NULL = sin modelo de cobro vigente (config ausente/inactiva o documento anterior a F8).';

-- Índice para el conteo mensual del edge (timbrados del mes por empresa).
CREATE INDEX IF NOT EXISTS idx_documentos_fiscales_company_cert
  ON public.documentos_fiscales(company_id, fecha_certificacion)
  WHERE estado = 'timbrado';

-- ─── 3. Resumen mensual para el superadmin ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.superadmin_timbres_resumen(p_company_id uuid)
RETURNS TABLE (
  mes               text,
  timbres           integer,
  con_costo         integer,
  costo_total_cents bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT to_char(date_trunc('month', COALESCE(df.fecha_certificacion, df.created_at)), 'YYYY-MM') AS mes,
           count(*)::int                                              AS timbres,
           count(*) FILTER (WHERE df.costo_cents > 0)::int            AS con_costo,
           COALESCE(sum(df.costo_cents), 0)::bigint                   AS costo_total_cents
    FROM public.documentos_fiscales df
    WHERE df.company_id = p_company_id
      AND df.estado = 'timbrado'
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 6;
END
$$;

COMMENT ON FUNCTION public.superadmin_timbres_resumen(uuid) IS
  'Contador de timbres (DTEs estado=timbrado) y costo sellado acumulado por mes, por empresa. Solo superadmin.';

REVOKE ALL ON FUNCTION public.superadmin_timbres_resumen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_timbres_resumen(uuid) TO authenticated;
