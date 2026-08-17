-- ════════════════════════════════════════════════════════════════════════════
-- Fixture del test de 20260824010000 (plantilla de anuncios + vigilante del
-- outbox).
--
-- Autocontenido a propósito: esta migración no depende de los helpers de
-- 20260819000000, así que el test no necesita arrastrar las siete tablas de
-- origen de aquélla. Sólo el mínimo que toca: el padrón, el outbox, la campana
-- y el catálogo de plantillas.
--
-- Padrón (dos empresas):
--   A-OWNER  company_owner de la empresa A   → debe recibir el aviso
--   A-ADMIN  admin de la empresa A           → debe recibir el aviso
--   A-OP     operator de la empresa A        → NO (no es responsable)
--   A-BAJA   admin de la empresa A, inactivo → NO
--   A-RES    cuenta de residente (cliente_id) → NO (no es staff)
--   B-OWNER  company_owner de la empresa B   → NO (atasco ajeno)
--   SUPER    super_admin sin empresa         → sólo para atascos de plataforma
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.companies (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL
);

CREATE TABLE public.clientes (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  role       text NOT NULL,
  company_id uuid,
  cliente_id uuid,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.notifications_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid,
  channel      text NOT NULL CHECK (channel IN ('in_app','email','whatsapp','push')),
  template_key text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient    text,
  status       text NOT NULL DEFAULT 'queued',
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  company_id uuid,
  tipo       text NOT NULL,
  titulo     text NOT NULL,
  cuerpo     text,
  seccion    text,
  leido      boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Catálogo de plantillas, con el índice único real: la parte 1 de la migración
-- siembra con ON CONFLICT sobre esas cuatro columnas, así que sin NULLS NOT
-- DISTINCT el test no probaría la idempotencia de verdad.
CREATE TABLE public.notification_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  key        text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('in_app','email','whatsapp','push')),
  subject    text,
  body       text NOT NULL,
  locale     text NOT NULL DEFAULT 'es',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_notif_templates_key
  ON public.notification_templates (company_id, key, channel, locale)
  NULLS NOT DISTINCT;

-- ── Datos ───────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Empresa A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Empresa B');

INSERT INTO public.clientes (id, nombre) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'Residente Uno');

INSERT INTO public.app_users (id, full_name, role, company_id, cliente_id, activo) VALUES
  ('50000000-0000-0000-0000-0000000000a1', 'A Owner', 'company_owner', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, true),
  ('50000000-0000-0000-0000-0000000000a2', 'A Admin', 'admin',         'aaaaaaaa-0000-0000-0000-00000000000a', NULL, true),
  ('50000000-0000-0000-0000-0000000000a3', 'A Op',    'operator',      'aaaaaaaa-0000-0000-0000-00000000000a', NULL, true),
  ('50000000-0000-0000-0000-0000000000a4', 'A Baja',  'admin',         'aaaaaaaa-0000-0000-0000-00000000000a', NULL, false),
  ('50000000-0000-0000-0000-0000000000a5', 'A Res',   'cliente',       'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', true),
  ('50000000-0000-0000-0000-0000000000b1', 'B Owner', 'company_owner', 'bbbbbbbb-0000-0000-0000-00000000000b', NULL, true),
  ('50000000-0000-0000-0000-0000000000f1', 'Super',   'super_admin',   NULL, NULL, true);

-- ── Helpers de aserción ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

CREATE OR REPLACE FUNCTION public.chk_txt(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido "%", esperado "%"', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

CREATE OR REPLACE FUNCTION public.chk_bool(actual boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(actual, false) THEN
    RAISE EXCEPTION '❌ %', msg;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;
