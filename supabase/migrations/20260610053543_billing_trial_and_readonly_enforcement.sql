-- =====================================================================
-- Fase 4 (#19/#20) — Suscripción/trial en el alta + expiración server-side.
-- Decisión de producto: trial 14 días; al expirar → SOLO LECTURA + banner.
-- =====================================================================

-- ── Backfill: toda company SIN suscripción queda 'active' (grandfather de los
--    tenants existentes del piloto) para NO bloquearlos con la lectura-única.
INSERT INTO public.subscriptions (company_id, plan_id, status, billing_cycle,
                                   current_period_start, current_period_end)
SELECT c.id,
       (SELECT id FROM public.billing_plans WHERE code = 'bundle' LIMIT 1),
       'active', 'monthly', now(), now() + interval '100 years'
FROM public.companies c
WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = c.id);

-- ── #19: nuevas empresas → trial 'trialing' de 14 días (cubre TODOS los flujos
--    de alta porque es un trigger sobre companies, no solo signup-company).
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.company_id = NEW.id) THEN
    INSERT INTO public.subscriptions (company_id, plan_id, status, billing_cycle,
                                      current_period_start, current_period_end, trial_end)
    VALUES (
      NEW.id,
      (SELECT id FROM public.billing_plans WHERE code = 'bundle' LIMIT 1),
      'trialing', 'monthly', now(), now() + interval '14 days', now() + interval '14 days'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_trial_subscription ON public.companies;
CREATE TRIGGER trg_create_trial_subscription
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

-- ── #20: la escritura está habilitada solo si hay suscripción activa O un trial
--    NO expirado (compara trial_end con now() — el hueco que el review reportó).
CREATE OR REPLACE FUNCTION public.company_write_enabled(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.company_id = p_company_id
      AND (
        s.status IN ('active', 'past_due', 'incomplete')
        OR (s.status = 'trialing' AND (s.trial_end IS NULL OR s.trial_end > now()))
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.company_write_enabled(uuid) TO authenticated;

-- ── Enforcement SOLO LECTURA al expirar: bloquea escrituras operativas de
--    usuarios finales (no service_role ni super_admin). Los pagos NO se tocan
--    (deben poder pagar para reactivar). Tablas núcleo: cuotas_condominio
--    (company_id directo) y registros (company vía project).
CREATE OR REPLACE FUNCTION public.enforce_company_write_active()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) = 'authenticated'
     AND NOT public.is_super_admin()
     AND NOT public.company_write_enabled(NEW.company_id) THEN
    RAISE EXCEPTION 'TRIAL_EXPIRED: suscripción no activa — modo solo lectura. Reactiva el plan para registrar cambios.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_registros_write_active()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_company uuid;
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT public.is_super_admin() THEN
    SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = NEW.project_id;
    IF v_company IS NOT NULL AND NOT public.company_write_enabled(v_company) THEN
      RAISE EXCEPTION 'TRIAL_EXPIRED: suscripción no activa — modo solo lectura. Reactiva el plan para registrar lecturas.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_write_active_cuotas ON public.cuotas_condominio;
CREATE TRIGGER trg_enforce_write_active_cuotas
  BEFORE INSERT OR UPDATE ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_write_active();

DROP TRIGGER IF EXISTS trg_enforce_write_active_registros ON public.registros;
CREATE TRIGGER trg_enforce_write_active_registros
  BEFORE INSERT OR UPDATE ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.enforce_registros_write_active();
