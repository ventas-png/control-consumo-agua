-- ════════════════════════════════════════════════════════════════════════════
-- Andamiaje: reproduce el estado INSEGURO de producción de payment_requests
-- ════════════════════════════════════════════════════════════════════════════
--
-- El fixture no parte del repositorio: parte de PRODUCCIÓN, tal como estaba el
-- 2026-09-01. Eso es lo que hace que la prueba signifique algo. Si montáramos
-- el esquema que declara el repo, la tabla ya sería segura y la migración no
-- tendría nada que arreglar: el test pasaría sin probar nada.
--
-- Todo lo de aquí se leyó del catálogo real con SELECT:
--   · las 21 columnas con sus tipos, NOT NULL y defaults;
--   · el ACL anon=arwdDxtm/postgres (privilegios por defecto de Supabase);
--   · las tres policies, incluida `payment_requests_select TO public
--     USING (true)`, que ninguna migración del repositorio declara.

-- ── Roles de Supabase ───────────────────────────────────────────────────────
CREATE ROLE anon          NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS;

-- ── Claims del JWT, como los expone Supabase ────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- ── Tabla de perfiles, mínima: sólo lo que necesita get_my_company_id ───────
CREATE TABLE public.app_users (
  id uuid PRIMARY KEY,
  company_id uuid,
  role text
);

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT company_id FROM public.app_users WHERE id = auth.uid() $$;

-- ── payment_requests, con el esquema REAL de producción ─────────────────────
CREATE TABLE public.payment_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id            uuid NOT NULL,
  registro_id           uuid,
  company_id            uuid NOT NULL,
  monto                 numeric NOT NULL,
  provider              text NOT NULL,
  estado                text DEFAULT 'pending',
  stripe_payment_intent text,
  paypal_order_id       text,
  numero_comprobante    text,
  referencia            text,
  notas                 text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  provider_ref          text,
  cuota_id              uuid,
  ambiente              text NOT NULL DEFAULT 'sandbox',
  comision              numeric(12,2),
  comision_detalle      jsonb,
  recargo               numeric(12,2),
  recargo_detalle       jsonb
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

-- ── La RPC de reconciliación, con su exposición real ────────────────────────
-- Cuerpo reducido: lo que se prueba es QUIÉN puede ejecutarla, no qué hace.
CREATE OR REPLACE FUNCTION public.reconciliar_payment_requests_pendientes()
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$ BEGIN
     UPDATE public.payment_requests SET estado = 'failed'
      WHERE estado = 'pending' AND created_at < now() - interval '30 days';
     RETURN 0;
   END $$;
REVOKE EXECUTE ON FUNCTION public.reconciliar_payment_requests_pendientes() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reconciliar_payment_requests_pendientes() TO authenticated, service_role;

-- ── Privilegios por defecto de Supabase: la RLS es el ÚNICO control ─────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.payment_requests TO anon, authenticated, service_role;
GRANT ALL ON public.app_users        TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- ── Las TRES policies de producción ─────────────────────────────────────────
-- Las dos acotadas por company_id son las que el repositorio sí declara.
CREATE POLICY payment_requests_insert ON public.payment_requests
  FOR INSERT TO authenticated WITH CHECK (company_id = public.get_my_company_id());
CREATE POLICY payment_requests_update ON public.payment_requests
  FOR UPDATE TO authenticated USING (company_id = public.get_my_company_id());
-- ↓ LA VULNERABILIDAD. Ninguna migración la declara.
CREATE POLICY payment_requests_select ON public.payment_requests
  FOR SELECT TO public USING (true);

-- ── Datos: dos compañías, para poder probar el cruce entre tenants ─────────
INSERT INTO public.app_users (id, company_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000aa', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000bb', 'admin');

INSERT INTO public.payment_requests
  (id, cliente_id, company_id, monto, provider, estado, stripe_payment_intent, referencia)
VALUES
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000aa', 1500.00, 'stripe', 'succeeded', 'pi_A_secreto', 'REF-A'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000c2',
   '00000000-0000-0000-0000-0000000000bb', 2500.00, 'paypal', 'succeeded', NULL, 'REF-B');
