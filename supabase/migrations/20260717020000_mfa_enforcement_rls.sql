-- ============================================================================
-- MFA exigible: enforcement SERVER-SIDE vía RLS (auditoría 2026-07-16, S2)
-- ============================================================================
-- companies.mfa_required + MfaGate (20260710020000) solo bloquean el SHELL del
-- cliente: ninguna política RLS ni edge consulta el AAL del JWT. Un atacante con
-- la contraseña de un usuario de una empresa con mfa_required=true ignora la UI
-- y llama PostgREST directo con su JWT AAL1 → lee y escribe todo. La propia
-- migración anterior lo admitía ("el enforcement vive en el cliente").
--
-- Este parche cierra el boquete: un helper server-side + políticas RESTRICTIVE
-- sobre las tablas de DATOS/DINERO núcleo que exigen AAL2 cuando la empresa del
-- usuario requiere MFA.
--
-- POR QUÉ ES SEGURO (no hay lockout):
--   · Inerte por default: mfa_required = false en toda empresa → el helper
--     devuelve true siempre → cero impacto hasta que un tenant lo active.
--   · Solo bloquea el estado AAL1-de-empresa-con-MFA, que es EXACTAMENTE cuando
--     MfaGate ya bloquea el shell y obliga a enrolar. El enrolamiento usa la API
--     auth.mfa (no tablas public) → el usuario SIEMPRE puede llegar a AAL2.
--   · NO se tocan las tablas de bootstrap (app_users, companies, projects,
--     notification_preferences, legal_acceptances): la sesión debe poder
--     resolverse y MfaGate renderizarse a AAL1.
--   · service_role (edges/cron) BYPASSA RLS → sin impacto en lo interno.
--   · RESTRICTIVE se combina con AND sobre las policies permissive existentes:
--     no abre nada; solo agrega la condición AAL2.
-- ============================================================================

-- Helper: ¿el requisito de MFA está satisfecho para el caller?
-- true si (a) el usuario no pertenece a una empresa con mfa_required=true
-- (clientes/residentes y tenants sin MFA), o (b) el JWT ya alcanzó AAL2.
CREATE OR REPLACE FUNCTION public.mfa_requirement_met()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.companies c ON c.id = u.company_id
      WHERE u.id = auth.uid()
        AND c.mfa_required = true
    )
    OR COALESCE(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

REVOKE EXECUTE ON FUNCTION public.mfa_requirement_met() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mfa_requirement_met() TO authenticated, service_role;

COMMENT ON FUNCTION public.mfa_requirement_met() IS
  'true si el caller no requiere MFA (empresa sin mfa_required, o sin empresa) o su JWT ya es AAL2. Base de las políticas RESTRICTIVE de MFA. Auditoría 2026-07-16, S2.';

-- Políticas RESTRICTIVE por tabla núcleo. Idempotentes (DROP IF EXISTS + CREATE).
-- Se aplican a `authenticated` (service_role bypassa RLS). FOR ALL cubre
-- SELECT/INSERT/UPDATE/DELETE; USING y WITH CHECK con el mismo predicado.
DO $$
DECLARE
  t text;
  tablas text[] := ARRAY[
    'registros',
    'cuotas_condominio',
    'pagos',
    'documentos_fiscales',
    'conta_asientos',
    'conta_asiento_lineas',
    'proveedores',
    'facturas_proveedor',
    'cuentas_bancarias',
    'banco_movimientos'
  ];
BEGIN
  FOREACH t IN ARRAY tablas LOOP
    -- Solo si la tabla existe (defensa ante entornos parciales).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS mfa_gate_aal2 ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY mfa_gate_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        || 'USING (public.mfa_requirement_met()) WITH CHECK (public.mfa_requirement_met())',
        t
      );
    END IF;
  END LOOP;
END $$;
