-- P0 #6 (auditoría 2026-07-10) — candado de ejercicio cerrado en el ledger.
--
-- BUG: conta_publicar_asiento solo valida periodo cerrado a nivel MENSUAL y solo
-- cuando project_id IS NOT NULL (via conta_periodo_cerrado → cierres_mensuales,
-- que es per-proyecto). Tras conta_cierre_anual(anio, ledger) se podían seguir
-- publicando asientos fechados DENTRO del año cerrado — en cualquier ledger,
-- incluido el de empresa (project_id NULL) — descuadrando un resultado ya
-- trasladado a 3201 y la apertura del año siguiente.
--
-- FIX: nuevo helper conta_anio_cerrado(company, ledger, año) sobre
-- conta_cierres_anuales (presencia de fila = cerrado; unicidad por
-- (company, COALESCE(project_id,zero), anio) → NULL-safe con IS NOT DISTINCT
-- FROM), y guard en conta_publicar_asiento que bloquea publicar en un ejercicio
-- cerrado. Aplica a AMBOS ledgers (empresa y proyecto).
--
-- Seguro por diseño: conta_cierre_anual publica SU asiento de cierre con un
-- UPDATE directo (no via conta_publicar_asiento) y recién DESPUÉS inserta la
-- fila de cierre → el propio asiento de cierre nunca choca con este guard (no
-- se necesita excepción). Validado en prod con BEGIN … ROLLBACK.
--
-- Alcance: este fix cubre el candado ANUAL (el hueco verificado). El candado
-- MENSUAL del ledger de EMPRESA queda como follow-up: hoy no existe un cierre
-- mensual a nivel empresa (cierres_mensuales es per-proyecto); requiere una
-- feature de cierre mensual de la contabilidad de empresa, no solo un guard.

-- ── Helper: ¿está cerrado el ejercicio de este ledger? ──────────────────────
CREATE OR REPLACE FUNCTION public.conta_anio_cerrado(
  p_company_id uuid,
  p_project_id uuid,
  p_anio       int
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conta_cierres_anuales
    WHERE company_id = p_company_id
      AND project_id IS NOT DISTINCT FROM p_project_id   -- NULL-safe: ledger empresa
      AND anio = p_anio
  )
$$;

REVOKE EXECUTE ON FUNCTION public.conta_anio_cerrado(uuid, uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.conta_anio_cerrado(uuid, uuid, int) TO authenticated;

-- ── conta_publicar_asiento: + guard de ejercicio cerrado ────────────────────
-- Reproduce la función vigente (20260612000200) añadiendo, junto al guard
-- mensual, el guard anual. El resto del cuerpo es idéntico.
CREATE OR REPLACE FUNCTION public.conta_publicar_asiento(p_asiento_id uuid)
RETURNS public.conta_asientos LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_asiento   public.conta_asientos;
  v_debe      numeric(14,2);
  v_haber     numeric(14,2);
  v_invalidas int;
BEGIN
  SELECT * INTO v_asiento FROM public.conta_asientos WHERE id = p_asiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Guard tenant + rol (la función es DEFINER: valida explícito).
  IF NOT (
    public.is_super_admin()
    OR (v_asiento.company_id = public.get_my_company_id()
        AND public.current_user_role() = ANY(ARRAY['company_owner','admin']))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_asiento.estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo un borrador puede publicarse (estado actual: %).', v_asiento.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0) INTO v_debe, v_haber
  FROM public.conta_asiento_lineas WHERE asiento_id = p_asiento_id;

  IF v_debe <= 0 OR v_debe <> v_haber THEN
    RAISE EXCEPTION 'Asiento descuadrado: debe % vs haber % (deben ser iguales y > 0).', v_debe, v_haber
      USING ERRCODE = 'check_violation';
  END IF;

  -- Todas las cuentas: de detalle, activas y DEL LEDGER del asiento.
  SELECT count(*) INTO v_invalidas
  FROM public.conta_asiento_lineas l
  JOIN public.conta_cuentas c ON c.id = l.cuenta_id
  WHERE l.asiento_id = p_asiento_id
    AND (NOT c.es_detalle OR NOT c.activa
         OR c.company_id <> v_asiento.company_id
         OR c.project_id IS DISTINCT FROM v_asiento.project_id);
  IF v_invalidas > 0 THEN
    RAISE EXCEPTION 'El asiento usa % cuenta(s) no válidas (agrupadoras, inactivas o de otra contabilidad).', v_invalidas
      USING ERRCODE = 'check_violation';
  END IF;

  -- Candado MENSUAL (solo ledger de proyecto: cierres_mensuales es per-proyecto).
  IF v_asiento.project_id IS NOT NULL
     AND public.conta_periodo_cerrado(v_asiento.project_id, v_asiento.periodo) THEN
    RAISE EXCEPTION 'El periodo % de este proyecto está cerrado.', v_asiento.periodo
      USING ERRCODE = 'check_violation';
  END IF;

  -- Candado ANUAL (P0 #6): aplica a AMBOS ledgers (empresa y proyecto).
  IF public.conta_anio_cerrado(
       v_asiento.company_id, v_asiento.project_id,
       EXTRACT(YEAR FROM v_asiento.fecha)::int
     ) THEN
    RAISE EXCEPTION 'El ejercicio % de esta contabilidad está cerrado; no se pueden publicar asientos con esa fecha.',
      EXTRACT(YEAR FROM v_asiento.fecha)::int
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.conta_asientos
  SET estado       = 'publicado',
      numero       = public.conta_siguiente_folio(v_asiento.company_id, v_asiento.project_id),
      total_debe   = v_debe,
      total_haber  = v_haber,
      publicado_at = now(),
      updated_at   = now()
  WHERE id = p_asiento_id
  RETURNING * INTO v_asiento;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  RETURN v_asiento;
END;
$$;
