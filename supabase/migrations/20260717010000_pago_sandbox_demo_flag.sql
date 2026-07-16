-- ============================================================================
-- Pago en línea: el proveedor 'sandbox' deja de cobrar deuda real por defecto
-- (auditoría 2026-07-16, hallazgo C1 — verificado)
-- ============================================================================
-- companies.proveedor_pago es NOT NULL DEFAULT 'sandbox': out-of-the-box TODA
-- empresa tiene al SandboxPaymentProvider como payfac efectivo, el portal lo
-- consideraba un proveedor válido para ofrecer "Pagar en línea", y el sandbox
-- aprueba SIEMPRE → confirm-charge insertaba un pago real y liquidaba la
-- cuota/recibo. Un residente de cualquier tenant sin payfac configurado podía
-- autoliquidarse la deuda sin dinero real.
--
-- Fix en 3 capas (esta migración + create-charge + portal):
--   1. Flag EXPLÍCITO de demo: pago_sandbox_demo (default false). Como el
--      default de proveedor_pago es 'sandbox', no hay forma de distinguir
--      "eligió sandbox para demo" de "nunca configuró nada" — este flag es esa
--      distinción. create-charge rechaza cobros sandbox de no-internos sin el
--      flag; el portal no ofrece el botón.
--   2. Los pagos que SÍ se aprueban vía sandbox (demo) se sellan con
--      metodo='sandbox' (antes: 'tarjeta_credito', indistinguibles de dinero
--      real) → identificables y filtrables en conciliación/EEFF.
-- ============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pago_sandbox_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.pago_sandbox_demo IS
  'Permite cobros con el proveedor simulado ''sandbox'' (modo demo). Con false (default), create-charge rechaza el cobro y el portal no ofrece pago en línea cuando el payfac efectivo es sandbox. Solo el superadmin/onboarding debería activarlo, y nunca en un tenant productivo.';

-- Sello de método para pagos simulados: ampliar el CHECK de pagos.metodo.
-- Relajar un CHECK es seguro para las filas existentes (todas cumplen ya).
ALTER TABLE public.pagos DROP CONSTRAINT IF EXISTS pagos_metodo_check;
ALTER TABLE public.pagos ADD CONSTRAINT pagos_metodo_check
  CHECK (metodo IN ('efectivo', 'transferencia', 'deposito', 'tarjeta_credito',
                    'tarjeta_debito', 'cheque', 'convenio_pago', 'paypal', 'otro',
                    'sandbox'));

COMMENT ON CONSTRAINT pagos_metodo_check ON public.pagos IS
  'Incluye ''sandbox'' para sellar pagos aprobados por el proveedor simulado (demo): nunca deben contarse como dinero real en conciliación/EEFF.';
