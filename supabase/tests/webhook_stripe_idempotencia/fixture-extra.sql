-- Lo que el padrón compartido no trae y este arnés necesita.
--
-- `stripe_webhook_events` nace en 20260528000040, que no está en la cadena de
-- este arnés: se reproduce aquí con su forma EXACTA de entonces —sin `estado`
-- ni `intentos`— para que 20260911201500 tenga que añadirlos de verdad. Copiar
-- aquí la tabla ya migrada haría que la prueba no probara la migración.
CREATE TABLE public.stripe_webhook_events (
  event_id      text        PRIMARY KEY,
  event_type    text        NOT NULL,
  livemode      boolean     NOT NULL DEFAULT false,
  payload       jsonb       NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  error_message text
);

-- `pagos` en producción tiene estas dos desde el baseline legacy; el fixture
-- compartido las omite porque ningún otro arnés las mira. Aquí son el objeto de
-- la prueba: son las que guardan QUIÉN verificó el cobro.
ALTER TABLE public.pagos
  ADD COLUMN IF NOT EXISTS verified_by text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

-- Una SECURITY DEFINER hostil, propiedad de `postgres` y ejecutable por
-- `authenticated`: la puerta de atrás que un GRANT descuidado abriría sobre las
-- RPC del webhook. Existe sólo para demostrar que NO se abre.
CREATE OR REPLACE FUNCTION public.test_definer_reclama_evento(p_event_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN public.stripe_webhook_evento_reclamar(p_event_id, 'payment_intent.succeeded', false, '{}'::jsonb);
END;
$$;
GRANT EXECUTE ON FUNCTION public.test_definer_reclama_evento(text) TO authenticated;
