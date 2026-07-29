-- ============================================================================
-- Ambiente de cobro (sandbox/prod) configurable por tenant + sello por cobro
-- ============================================================================
-- Por qué: los cobros en línea (create-charge) siempre salían al ambiente
-- SANDBOX del payfac — el portal no envía `ambiente` y el edge hacía default a
-- 'sandbox' — así que un tenant con QPayPro de producción conectado nunca podía
-- cobrar dinero real. El ambiente es una decisión del TENANT (no del pagador),
-- así que se persiste como config, espejando exactamente proveedor_pago:
--
--   • companies.ambiente_pago  — base de la empresa (NOT NULL, default 'sandbox':
--     ninguna empresa existente cambia de comportamiento con este deploy).
--   • projects.ambiente_pago   — override por locación (NULL = hereda), p. ej.
--     pilotear producción en una sola locación.
--   • payment_requests.ambiente — SELLO del ambiente con el que se creó cada
--     cobro: confirm-charge debe confirmar contra el MISMO ambiente aunque el
--     tenant cambie la config entre el checkout y el retorno (y el backfill
--     'sandbox' es correcto: todo cobro histórico fue sandbox).
--
-- La resolución efectiva (locación ?? empresa ?? 'sandbox') vive en
-- resolverConfigPagoEfectiva (espejos Vite/Deno), igual que el payfac.
--
-- Impacto en datos productivos: ADD COLUMN con DEFAULT estático (PG lo aplica
-- sin reescribir la tabla). Revert:
--   ALTER TABLE public.companies DROP COLUMN IF EXISTS ambiente_pago;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS ambiente_pago;
--   ALTER TABLE public.payment_requests DROP COLUMN IF EXISTS ambiente;
--
-- Idempotencia: ADD COLUMN IF NOT EXISTS.
-- ============================================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ambiente_pago text NOT NULL DEFAULT 'sandbox'
    CHECK (ambiente_pago IN ('sandbox', 'prod'));

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ambiente_pago text
    CHECK (ambiente_pago IN ('sandbox', 'prod'));

ALTER TABLE public.payment_requests
  ADD COLUMN IF NOT EXISTS ambiente text NOT NULL DEFAULT 'sandbox'
    CHECK (ambiente IN ('sandbox', 'prod'));

COMMENT ON COLUMN public.companies.ambiente_pago IS
  'Ambiente de cobro del payfac a nivel empresa: sandbox (pruebas, default) o prod (cobros REALES). Las locaciones lo heredan salvo override en projects.ambiente_pago.';
COMMENT ON COLUMN public.projects.ambiente_pago IS
  'Override del ambiente de cobro de la locación. NULL = hereda companies.ambiente_pago.';
COMMENT ON COLUMN public.payment_requests.ambiente IS
  'Ambiente del payfac con el que se CREÓ este cobro (sello): confirm-charge confirma contra este ambiente, no contra la config vigente del tenant.';
