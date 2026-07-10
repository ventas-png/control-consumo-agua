-- =====================================================================
-- P0 #2 (auditoría 2026-07-10) — Dunning ante pago fallido.
--
-- Antes: invoice.payment_failed solo marcaba la subscription 'past_due',
-- pero company_write_enabled trataba 'past_due' como habilitado
-- INDEFINIDAMENTE. Una empresa con la tarjeta rechazada podía seguir
-- operando para siempre sin pagar.
--
-- Ahora: se registra cuándo entró en past_due (past_due_since) y el
-- write-gate da una ventana de gracia (DUNNING_GRACE = 14 días, alineada
-- con el trial y con la ventana de reintentos de Stripe). Pasada la gracia,
-- la empresa cae a SOLO LECTURA por el MISMO enforcement que ya existe para
-- trials expirados (triggers enforce_company_write_active / _registros).
-- Los pagos NO se bloquean (deben poder reactivar).
-- =====================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz;

COMMENT ON COLUMN public.subscriptions.past_due_since IS
  'Momento del primer pago fallido que dejó la suscripción en past_due (NULL si no está en past_due). company_write_enabled da 14 días de gracia desde esta fecha antes de degradar la empresa a solo-lectura (P0 #2).';

-- Backfill defensivo: las subs YA en past_due obtienen la gracia completa
-- desde AHORA (no desde un pasado desconocido), para no bloquear a nadie de
-- golpe al desplegar. El webhook fija el valor real de aquí en adelante.
UPDATE public.subscriptions
SET past_due_since = now()
WHERE status = 'past_due' AND past_due_since IS NULL;

-- Write-gate con past_due acotado en el tiempo. active/incomplete y trial no
-- expirado se mantienen igual; past_due solo conserva escritura mientras esté
-- dentro de la ventana de gracia (o si past_due_since es NULL — dato legacy,
-- se trata con lenidad para no bloquear por falta de marca).
CREATE OR REPLACE FUNCTION public.company_write_enabled(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.company_id = p_company_id
      AND (
        s.status IN ('active', 'incomplete')
        OR (s.status = 'trialing' AND (s.trial_end IS NULL OR s.trial_end > now()))
        OR (
          s.status = 'past_due'
          AND (s.past_due_since IS NULL OR s.past_due_since > now() - interval '14 days')
        )
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.company_write_enabled(uuid) TO authenticated;

-- Índice parcial: el webhook y cualquier job de dunning consultan las subs en
-- past_due por antigüedad; mantenerlo chico (solo filas past_due).
CREATE INDEX IF NOT EXISTS idx_subscriptions_past_due_since
  ON public.subscriptions(past_due_since)
  WHERE status = 'past_due';
