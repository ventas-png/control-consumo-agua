-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de acl_definer_expuestas_anon.
--
-- Reproduce el PUNTO DE PARTIDA que tuvo la Preview limpia de #856
-- (couybkchcfsqmymlildc): las siete funciones creadas en una Supabase NUEVA,
-- donde el esquema `public` trae
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
--
-- Por eso la primera sentencia de este archivo es ese mismo ALTER: sin él, un
-- Postgres pelado daría EXECUTE sólo por el grant implícito a PUBLIC y la
-- prueba mediría un estado inicial que en Supabase no existe.
--
-- Las siete se crean como STUBS con sus FIRMAS REALES —que es lo único que la
-- ACL mira— y con el cableado mínimo (tablas y triggers) que hace falta para
-- poder invocarlas de verdad y ver disparar los triggers. Aplicar sus
-- migraciones reales arrastraría media docena de módulos sin relación entre sí
-- (comunicación, clientes, SSO, agua, legado de auth) y aquí sólo se prueban
-- ACL e invocación. Mismo patrón que security_definer_anon/fixture.sql.
--
-- DIFERENCIAS DELIBERADAS CON LAS FUNCIONES REALES, todas fuera de lo que se
-- mide: `sso_lookup_domain` compara con `lower()` en vez de `extensions.citext`
-- (la extensión no está en un Postgres pelado) y los cuerpos se recortan a lo
-- que la prueba observa. Las FIRMAS son idénticas: si una cambiara, la
-- migración fallaría ruidosamente al aplicarse (REVOKE sobre firma inexistente
-- es ERROR, no no-op), no en silencio.
-- ════════════════════════════════════════════════════════════════════════════

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- `auth.uid()` como en Supabase: sale de un GUC de la petición. En la
-- reconstrucción nadie lo fija y devuelve NULL, que es cuanto hace falta.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- ── (1) sso_lookup_domain — la excepción anón deliberada ────────────────────
CREATE TABLE public.company_sso_domains (
  domain          text PRIMARY KEY,
  enforced        boolean NOT NULL DEFAULT false,
  sso_provider_id text,
  verified        boolean NOT NULL DEFAULT false,
  -- Presente A PROPÓSITO: es el campo del tenant que la RPC NO debe devolver.
  company_id      uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO public.company_sso_domains (domain, enforced, sso_provider_id, verified)
VALUES ('acme.test', true, 'okta-acme', true),
       ('sinverificar.test', true, 'okta-otro', false);

CREATE FUNCTION public.sso_lookup_domain(p_domain text)
RETURNS TABLE (
  sso_available boolean,
  enforced      boolean,
  provider_id   text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_domain text;
BEGIN
  v_domain := NULLIF(btrim(coalesce(p_domain, '')), '');
  IF v_domain IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT true, d.enforced, d.sso_provider_id
    FROM public.company_sso_domains d
   WHERE lower(d.domain) = lower(v_domain)
     AND d.verified = true
   LIMIT 1;
END $$;

-- ── (2) buscar_cliente_para_onboarding — authenticated sí, anon no ──────────
CREATE TABLE public.clientes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             text,
  cui_dui            text,
  fecha_nacimiento   date,
  email              text,
  puede_crear_cuenta boolean
);
INSERT INTO public.clientes (nombre, cui_dui, fecha_nacimiento, email, puede_crear_cuenta)
VALUES ('Caso Seguro de Prueba', '1234567890101', '1990-01-01', 'caso.seguro@ejemplo.test', true);

CREATE FUNCTION public.buscar_cliente_para_onboarding(p_cui_dui text, p_fecha_nac date, p_email text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_client record;
BEGIN
  IF p_cui_dui IS NULL OR p_fecha_nac IS NULL OR p_email IS NULL
     OR btrim(p_cui_dui) = '' OR btrim(p_email) = '' THEN
    RETURN jsonb_build_object('match_count', 0, 'cliente_id', NULL);
  END IF;

  SELECT id, nombre INTO v_client
    FROM clientes
   WHERE cui_dui = p_cui_dui
     AND fecha_nacimiento = p_fecha_nac
     AND lower(email) = lower(p_email)
   ORDER BY puede_crear_cuenta DESC NULLS LAST
   LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('match_count', 3, 'cliente_id', v_client.id, 'cliente_nombre', v_client.nombre);
  END IF;
  RETURN jsonb_build_object('match_count', 0, 'cliente_id', NULL);
END $$;

-- ── (3) Las cinco de sólo backend ───────────────────────────────────────────
CREATE FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RETURN jsonb_build_object('migrated_count', 0, 'error_count', 0);
END $$;

CREATE TABLE public.conversation_access_rules (
  company_id   uuid,
  role         text,
  can_view_all boolean,
  can_respond  boolean,
  can_assign   boolean,
  categories   text[],
  updated_at   timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z',
  PRIMARY KEY (company_id, role)
);

CREATE FUNCTION public.create_default_conversation_access_rules(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.conversation_access_rules (company_id, role, can_view_all, can_respond, can_assign, categories)
  VALUES
    (p_company_id, 'admin',     true,  true,  true,  NULL),
    (p_company_id, 'collector', false, true,  false, ARRAY['pagos', 'general']),
    (p_company_id, 'operator',  false, true,  false, ARRAY['tecnico', 'calidad', 'general']),
    (p_company_id, 'viewer',    true,  false, false, NULL)
  ON CONFLICT (company_id, role) DO NOTHING;
END $$;

CREATE FUNCTION public.fill_company_id_from_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := (SELECT company_id FROM public.app_users WHERE id = auth.uid());
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fn_set_recipient_company_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id
      FROM public.broadcasts WHERE id = NEW.broadcast_id;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ── Cableado de los triggers, con los MISMOS nombres que producción ─────────
-- (pg_trigger de nnsqmeigtgewatameexo, 2026-09-11). Es lo que permite probar
-- que la revocación NO los apaga.
CREATE TABLE public.app_users (id uuid PRIMARY KEY, company_id uuid);

CREATE TABLE public.fuentes_agua (id int PRIMARY KEY, company_id uuid);
CREATE TRIGGER fuentes_agua_fill_company_id
  BEFORE INSERT ON public.fuentes_agua
  FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();

CREATE TABLE public.registros_calidad (id int PRIMARY KEY, company_id uuid);
CREATE TRIGGER registros_calidad_fill_company_id
  BEFORE INSERT ON public.registros_calidad
  FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();

CREATE TABLE public.broadcasts (id int PRIMARY KEY, company_id uuid);
CREATE TABLE public.broadcast_recipients (id int PRIMARY KEY, broadcast_id int, company_id uuid);
CREATE TRIGGER trg_recipient_company_id
  BEFORE INSERT ON public.broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_recipient_company_id();

CREATE TABLE public.conversations (
  id int PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z'
);
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_conv_access_rules_updated_at
  BEFORE UPDATE ON public.conversation_access_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Las tablas que los roles de API tocan en la prueba de triggers. El permiso
-- de TABLA es lo único que se les da: ninguno recibe EXECUTE sobre la función
-- de trigger, que es justo lo que la prueba quiere demostrar.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT INSERT, SELECT, UPDATE ON public.fuentes_agua, public.registros_calidad,
      public.broadcasts, public.broadcast_recipients, public.conversations,
      public.conversation_access_rules TO authenticated;

INSERT INTO public.broadcasts (id, company_id) VALUES (1, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.conversations (id) VALUES (1);

-- ── Helper de aserción (patrón de la casa) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;
