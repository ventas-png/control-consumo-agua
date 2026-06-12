-- =====================================================================
-- Ciclo de vida de empresas — suspensión real + eliminación solo super admin.
-- Idempotente (CREATE OR REPLACE / DROP IF EXISTS) para reaplicarse sin daño.
--
-- CONTEXTO
--   `companies.activa` era decorativo: ningún punto del backend lo aplicaba
--   (el login solo valida app_users.activo y los triggers de solo-lectura
--   solo miran la suscripción). Este PR lo convierte en una suspensión real:
--     · suspended_at / suspended_reason para trazabilidad y período de gracia
--       previo a la purga definitiva (edge delete-company).
--     · Los triggers de escritura (cuotas/registros) rechazan empresas
--       suspendidas con prefijo COMPANY_SUSPENDED (distinto de TRIAL_EXPIRED
--       para que la UI pueda diferenciar el mensaje).
--     · companies_delete queda acotada a super_admin: el DELETE en cascada
--       destruye ~100 tablas dependientes y no es decisión del company_owner.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columnas de suspensión + sello automático al alternar `activa`.
-- ---------------------------------------------------------------------
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS suspended_at     timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

COMMENT ON COLUMN public.companies.suspended_at IS
  'Sellado por trigger al pasar activa=false. Gate del período de gracia (90 días) antes de permitir la purga vía edge delete-company.';
COMMENT ON COLUMN public.companies.suspended_reason IS
  'Motivo de la suspensión capturado en el panel superadmin. Se limpia al reactivar.';

CREATE OR REPLACE FUNCTION public.stamp_company_suspension()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.activa AND NOT NEW.activa THEN
    NEW.suspended_at := COALESCE(NEW.suspended_at, now());
  ELSIF NOT OLD.activa AND NEW.activa THEN
    NEW.suspended_at     := NULL;
    NEW.suspended_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Orden de triggers BEFORE UPDATE (alfabético): trg_lock_... corre ANTES que
-- trg_stamp_..., así un intento de no-superadmin de tocar `activa` se revierte
-- primero y el sello solo ocurre en flips reales.
DROP TRIGGER IF EXISTS trg_stamp_company_suspension ON public.companies;
CREATE TRIGGER trg_stamp_company_suspension
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.stamp_company_suspension();

-- ---------------------------------------------------------------------
-- 2. lock_companies_billing_columns: congelar también las columnas de
--    suspensión y dejar de congelar `plan` (columna legacy que se elimina
--    en la migración 20260612180200 — el modelo comercial vive en
--    billing_plans + subscriptions desde 20260528000030).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_companies_billing_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT public.is_super_admin() THEN
    NEW.max_projects     := OLD.max_projects;
    NEW.max_units        := OLD.max_units;
    NEW.activa           := OLD.activa;
    NEW.signup_source    := OLD.signup_source;
    NEW.suspended_at     := OLD.suspended_at;
    NEW.suspended_reason := OLD.suspended_reason;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Enforcement de suspensión en las escrituras operativas. Reusa los
--    triggers de solo-lectura de 20260610053543: la suspensión se chequea
--    ANTES que la suscripción, con su propio prefijo de error.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_is_active(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT c.activa FROM public.companies c WHERE c.id = p_company_id), false);
$$;
GRANT EXECUTE ON FUNCTION public.company_is_active(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_company_write_active()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) = 'authenticated' AND NOT public.is_super_admin() THEN
    IF NOT public.company_is_active(NEW.company_id) THEN
      RAISE EXCEPTION 'COMPANY_SUSPENDED: empresa suspendida — comuníquese con soporte de AdministraTodo.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT public.company_write_enabled(NEW.company_id) THEN
      RAISE EXCEPTION 'TRIAL_EXPIRED: suscripción no activa — modo solo lectura. Reactiva el plan para registrar cambios.'
        USING ERRCODE = 'check_violation';
    END IF;
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
    IF v_company IS NOT NULL THEN
      IF NOT public.company_is_active(v_company) THEN
        RAISE EXCEPTION 'COMPANY_SUSPENDED: empresa suspendida — comuníquese con soporte de AdministraTodo.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT public.company_write_enabled(v_company) THEN
        RAISE EXCEPTION 'TRIAL_EXPIRED: suscripción no activa — modo solo lectura. Reactiva el plan para registrar lecturas.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. DELETE de companies: solo super_admin. La política previa
--    (20260417000012) también permitía al company_owner borrar su propia
--    empresa — cascada destructiva sin confirmación ni auditoría.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS companies_delete ON public.companies;
CREATE POLICY companies_delete ON public.companies
  FOR DELETE TO authenticated
  USING (public.is_super_admin());
