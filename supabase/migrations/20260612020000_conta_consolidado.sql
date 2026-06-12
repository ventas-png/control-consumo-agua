-- ════════════════════════════════════════════════════════════════════════════
-- CONTABILIDAD · Vista CONSOLIDADA (reporte de solo lectura)
--
-- Complemento del modelo ledger: las contabilidades siguen aisladas (cada una
-- con su moneda y sus libros), pero este RPC produce el panorama de TODA la
-- estructura — una fila por entidad contable (empresa + cada proyecto) con su
-- P&L del rango y su balance al corte, convertidos a la MONEDA DE LA EMPRESA
-- con la tasa de cierre del periodo (conta_tasa_entre, último día de p_hasta).
--
-- Reglas:
--   · Solo lectura: no genera asientos ni toca los libros de nadie.
--   · Nunca se inventa tasa: un ledger sin tasa registrada se devuelve con sus
--     cifras EN SU MONEDA y tasa NULL — la UI lo advierte y lo excluye del
--     total convertido.
--   · Metodología simplificada (documentada): TODO se convierte a la tasa de
--     cierre del periodo (no tasa promedio para resultados) — suficiente para
--     un reporte gerencial; los libros formales de cada entidad no cambian.
--   · El capital incluye el resultado acumulado sin cerrar (mismo criterio que
--     conta_balance_general) para que Activo = Pasivo + Capital por entidad.
--
-- SECURITY INVOKER: la RLS de conta_* / projects aplica sola, igual que el
-- resto de los reportes del módulo.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.conta_consolidado(
  p_company_id uuid,
  p_desde      text,  -- 'YYYY-MM' inclusive (rango del P&L)
  p_hasta      text   -- 'YYYY-MM' inclusive (cierre del balance y fecha de tasa)
)
RETURNS TABLE (
  ledger_project_id uuid,   -- NULL = empresa
  ledger_nombre     text,
  moneda            text,   -- moneda base del ledger
  tasa              numeric, -- ledger → moneda empresa (NULL = sin tasa registrada)
  -- Cifras en la moneda DEL LEDGER:
  ingresos_origen   numeric,
  gastos_origen     numeric,
  resultado_origen  numeric,
  activo_origen     numeric,
  pasivo_origen     numeric,
  capital_origen    numeric,
  -- Convertidas a la moneda de la EMPRESA (NULL cuando falta la tasa):
  ingresos          numeric,
  gastos            numeric,
  resultado         numeric,
  activo            numeric,
  pasivo            numeric,
  capital           numeric
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_base_empresa text;
  v_fecha_tasa   date;
  v_ledger       record;
  v_tasa         numeric(12,6);
  v_ing  numeric(14,2);
  v_gas  numeric(14,2);
  v_act  numeric(14,2);
  v_pas  numeric(14,2);
  v_capc numeric(14,2);  -- capital contable acumulado
  v_res  numeric(14,2);  -- resultado acumulado sin cerrar (a capital)
BEGIN
  v_base_empresa := public.conta_moneda_base(p_company_id, NULL);
  -- Tasa de cierre: último día del mes p_hasta.
  v_fecha_tasa := (to_date(p_hasta || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date;

  FOR v_ledger IN
    -- Universo contable: la empresa + cada proyecto con catálogo propio.
    SELECT NULL::uuid AS pid, 'Empresa'::text AS nombre
    UNION ALL
    SELECT p.id, p.nombre
    FROM public.projects p
    WHERE p.company_id = p_company_id
      AND EXISTS (
        SELECT 1 FROM public.conta_cuentas c
        WHERE c.company_id = p_company_id AND c.project_id = p.id
      )
    ORDER BY 1 NULLS FIRST
  LOOP
    -- P&L del rango (excluye asientos de cierre, como conta_estado_resultados).
    SELECT
      COALESCE(SUM(CASE WHEN c.tipo = 'ingreso' THEN l.haber - l.debe END), 0),
      COALESCE(SUM(CASE WHEN c.tipo = 'gasto'   THEN l.debe - l.haber END), 0)
    INTO v_ing, v_gas
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    WHERE l.company_id = p_company_id
      AND a.estado = 'publicado'
      AND a.tipo <> 'cierre'
      AND a.periodo BETWEEN p_desde AND p_hasta
      AND a.project_id IS NOT DISTINCT FROM v_ledger.pid
      AND c.tipo IN ('ingreso','gasto');

    -- Balance al corte: saldos acumulados ≤ p_hasta (signo por naturaleza);
    -- el resultado sin cerrar se integra a capital (criterio del balance).
    SELECT
      COALESCE(SUM(CASE WHEN c.tipo = 'activo'
        THEN CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber ELSE l.haber - l.debe END END), 0),
      COALESCE(SUM(CASE WHEN c.tipo = 'pasivo'
        THEN CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber ELSE l.haber - l.debe END END), 0),
      COALESCE(SUM(CASE WHEN c.tipo = 'capital'
        THEN CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber ELSE l.haber - l.debe END END), 0),
      COALESCE(SUM(CASE WHEN c.tipo IN ('ingreso','gasto') THEN l.haber - l.debe END), 0)
    INTO v_act, v_pas, v_capc, v_res
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
    WHERE l.company_id = p_company_id
      AND a.estado = 'publicado'
      AND a.periodo <= p_hasta
      AND a.project_id IS NOT DISTINCT FROM v_ledger.pid;

    ledger_project_id := v_ledger.pid;
    ledger_nombre     := v_ledger.nombre;
    moneda            := public.conta_moneda_base(p_company_id, v_ledger.pid);
    v_tasa            := public.conta_tasa_entre(p_company_id, moneda, v_base_empresa, v_fecha_tasa);
    tasa              := v_tasa;

    ingresos_origen  := v_ing;
    gastos_origen    := v_gas;
    resultado_origen := round(v_ing - v_gas, 2);
    activo_origen    := v_act;
    pasivo_origen    := v_pas;
    capital_origen   := round(v_capc + v_res, 2);

    IF v_tasa IS NULL THEN
      ingresos := NULL; gastos := NULL; resultado := NULL;
      activo := NULL; pasivo := NULL; capital := NULL;
    ELSE
      ingresos  := round(v_ing * v_tasa, 2);
      gastos    := round(v_gas * v_tasa, 2);
      resultado := round((v_ing - v_gas) * v_tasa, 2);
      activo    := round(v_act * v_tasa, 2);
      pasivo    := round(v_pas * v_tasa, 2);
      capital   := round((v_capc + v_res) * v_tasa, 2);
    END IF;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.conta_consolidado(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conta_consolidado(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.conta_consolidado(uuid, text, text) IS
  'Vista consolidada de solo lectura: P&L del rango y balance al corte de CADA entidad contable (empresa + proyectos), convertidos a la moneda de la empresa con la tasa de cierre del periodo. Ledger sin tasa → cifras en su moneda y tasa NULL (la UI advierte y excluye del total).';
