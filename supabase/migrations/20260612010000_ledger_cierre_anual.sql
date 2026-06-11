-- ════════════════════════════════════════════════════════════════════════════
-- LEDGER (entidad contable) · parte D: cierre anual POR LEDGER
--
-- Cada contabilidad (empresa y cada proyecto) cierra su ejercicio por
-- separado: asiento de cierre en el ledger contra SU 3201, registro en
-- conta_cierres_anuales con project_id, y unicidad (company, ledger, año).
-- La firma vieja conta_cierre_anual(int) queda como wrapper (ledger empresa)
-- hasta que el frontend pase el ledger explícito.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla: cierre por ledger ─────────────────────────────────────────────
ALTER TABLE public.conta_cierres_anuales
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conta_cierres_ledger_anio
  ON public.conta_cierres_anuales(company_id,
    COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), anio);

ALTER TABLE public.conta_cierres_anuales
  DROP CONSTRAINT IF EXISTS conta_cierres_anuales_company_id_anio_key;

-- ── 2. RPC por ledger (sin DEFAULT: coexiste con el wrapper de 1 arg) ───────
CREATE OR REPLACE FUNCTION public.conta_cierre_anual(p_anio int, p_project_id uuid)
RETURNS public.conta_asientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_company   uuid;
  v_cta3201   uuid;
  v_neto      numeric(14,2) := 0;
  v_asiento   public.conta_asientos;
  v_orden     int := 0;
  r           record;
BEGIN
  v_company := public.get_my_company_id();
  IF NOT (
    public.is_super_admin()
    OR (v_company IS NOT NULL
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio >= extract(year FROM CURRENT_DATE) THEN
    RAISE EXCEPTION 'Solo se cierran ejercicios terminados (año < %).', extract(year FROM CURRENT_DATE)
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.conta_cierres_anuales
    WHERE company_id = v_company AND anio = p_anio
      AND project_id IS NOT DISTINCT FROM p_project_id
  ) THEN
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad ya está cerrado.', p_anio USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_cta3201 FROM public.conta_cuentas
  WHERE company_id = v_company AND codigo = '3201' AND es_detalle
    AND project_id IS NOT DISTINCT FROM p_project_id;
  IF v_cta3201 IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 3201 (Resultado del ejercicio) en el catálogo de esta contabilidad.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);

  INSERT INTO public.conta_asientos (
    company_id, project_id, fecha, tipo, concepto, estado, origen, moneda_base, created_by
  )
  VALUES (
    v_company, p_project_id, make_date(p_anio, 12, 31), 'cierre',
    'Cierre del ejercicio ' || p_anio, 'borrador', 'manual',
    public.conta_moneda_base(v_company, p_project_id), auth.uid()
  )
  RETURNING * INTO v_asiento;

  -- Salda cada cuenta de resultados DEL LEDGER con movimiento neto en el año.
  FOR r IN
    SELECT c.id AS cuenta_id, c.tipo,
           SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                    ELSE l.debe - l.haber END)::numeric(14,2) AS neto
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    WHERE l.company_id = v_company
      AND a.estado = 'publicado'
      AND a.periodo BETWEEN p_anio::text || '-01' AND p_anio::text || '-12'
      AND a.project_id IS NOT DISTINCT FROM p_project_id
      AND c.tipo IN ('ingreso','gasto')
    GROUP BY c.id, c.tipo
    HAVING SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe
                    ELSE l.debe - l.haber END) <> 0
  LOOP
    v_orden := v_orden + 1;
    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber
    )
    VALUES (
      v_asiento.id, v_company, r.cuenta_id, v_orden, 'Cierre ' || p_anio,
      CASE WHEN (r.tipo = 'ingreso') = (r.neto > 0) THEN abs(r.neto) ELSE 0 END,
      CASE WHEN (r.tipo = 'ingreso') = (r.neto > 0) THEN 0 ELSE abs(r.neto) END
    );
    v_neto := v_neto + CASE WHEN r.tipo = 'ingreso' THEN r.neto ELSE -r.neto END;
  END LOOP;

  IF v_orden = 0 THEN
    PERFORM set_config('conta.allow_system_write', 'off', true);
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad no tiene movimientos de resultados que cerrar.', p_anio
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_neto <> 0 THEN
    INSERT INTO public.conta_asiento_lineas (
      asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber
    )
    VALUES (
      v_asiento.id, v_company, v_cta3201, v_orden + 1,
      CASE WHEN v_neto > 0 THEN 'Utilidad del ejercicio ' ELSE 'Pérdida del ejercicio ' END || p_anio,
      CASE WHEN v_neto < 0 THEN abs(v_neto) ELSE 0 END,
      CASE WHEN v_neto > 0 THEN v_neto ELSE 0 END
    );
  END IF;

  UPDATE public.conta_asientos
  SET estado = 'publicado',
      numero = public.conta_siguiente_folio(v_company, p_project_id),
      total_debe  = (SELECT COALESCE(SUM(debe), 0)  FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id),
      total_haber = (SELECT COALESCE(SUM(haber), 0) FROM public.conta_asiento_lineas WHERE asiento_id = v_asiento.id),
      publicado_at = now(),
      updated_at = now()
  WHERE id = v_asiento.id
  RETURNING * INTO v_asiento;

  INSERT INTO public.conta_cierres_anuales (company_id, project_id, anio, asiento_id, cerrado_por)
  VALUES (v_company, p_project_id, p_anio, v_asiento.id, auth.uid());

  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN v_asiento;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_cierre_anual(int, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_cierre_anual(int, uuid) TO authenticated;

-- Wrapper de compat: el cierre "a secas" es el del ledger EMPRESA.
CREATE OR REPLACE FUNCTION public.conta_cierre_anual(p_anio int)
RETURNS public.conta_asientos LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT public.conta_cierre_anual(p_anio, NULL)
$$;

COMMENT ON TABLE public.conta_cierres_anuales IS
  'Cierres de ejercicio POR LEDGER (empresa o proyecto): un asiento publicado al 31/12 que salda ingresos/gastos del ledger contra SU 3201. Escritura solo vía conta_cierre_anual().';
