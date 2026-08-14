-- ════════════════════════════════════════════════════════════════════════════
-- Fixture del test de 20260819000000 (avisos de mensaje / difusión / solicitud).
--
-- Reconstruye en un Postgres pelado el MÍNIMO que tocan los triggers: las
-- tablas de origen (conversaciones, difusión, solicitudes, portal), el outbox
-- donde encolan y el padrón de usuarios con el que se decide a quién avisar.
-- Mismas columnas y tipos que las migraciones reales; sin RLS, porque lo que se
-- prueba aquí es el fan-out, no las policies.
--
-- Padrón (una empresa, dos proyectos):
--   OWNER  company_owner        → ve TODA la empresa
--   ADMIN  admin                → ve TODA la empresa
--   OP1    operator, P1         → sólo proyecto 1 (por user_project_assignments)
--   OP2    operator, P2         → sólo proyecto 2 (por app_users.project_id)
--   INACT  operator, P1, activo=false → nunca recibe nada
--   RES1   cuenta del cliente C1 (residente) → no es staff
--   RES2   cuenta del cliente C2 (otro proyecto)
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.companies (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL
);

CREATE TABLE public.projects (
  id         uuid PRIMARY KEY,
  company_id uuid NOT NULL
);

CREATE TABLE public.clientes (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL,
  email  text
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  role       text NOT NULL,
  company_id uuid,
  project_id uuid,
  cliente_id uuid,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.user_project_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  project_id      uuid NOT NULL,
  permission_type text NOT NULL DEFAULT 'read_write'
);

CREATE TABLE public.unidades (
  id         uuid PRIMARY KEY,
  nombre     text NOT NULL,
  project_id uuid NOT NULL,
  company_id uuid NOT NULL,
  cliente_id uuid,
  activo     boolean NOT NULL DEFAULT true
);

-- Outbox del orquestador (subconjunto que tocan los triggers).
CREATE TABLE public.notifications_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid,
  channel      text NOT NULL CHECK (channel IN ('in_app','email','whatsapp','push')),
  template_key text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient    text,
  status       text NOT NULL DEFAULT 'queued',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  project_id     uuid,
  cliente_id     uuid,
  cliente_nombre text,
  subject        text NOT NULL,
  category       text NOT NULL DEFAULT 'general',
  priority       text NOT NULL DEFAULT 'media',
  status         text NOT NULL DEFAULT 'abierta',
  assigned_to    uuid,
  is_internal    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL,
  sender_type      text NOT NULL,
  sender_name      text,
  body             text NOT NULL,
  is_internal_note boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  sent_by_id      uuid NOT NULL,
  sent_by_name    text NOT NULL,
  target_type     text NOT NULL DEFAULT 'todos',
  target_ids      text[] NOT NULL DEFAULT '{}',
  recipient_count integer NOT NULL DEFAULT 0,
  send_email      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.broadcast_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  cliente_id   uuid NOT NULL,
  company_id   uuid,
  email_sent   boolean DEFAULT false,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.mensajes_portal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  project_id    uuid NOT NULL,
  unidad_id     uuid NOT NULL,
  asunto        text NOT NULL,
  cuerpo        text NOT NULL,
  tipo          text NOT NULL DEFAULT 'consulta',
  estado        text NOT NULL DEFAULT 'nuevo',
  created_at    timestamptz DEFAULT now()
);

-- Las cinco tablas de solicitud, con las columnas de detalle que las distinguen
-- (`descripcion` en unas, `motivo` en otras, ninguna en la de renta): el trigger
-- genérico las lee por to_jsonb y debe aguantar las tres formas.
CREATE TABLE public.solicitudes_residente (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  project_id  uuid NOT NULL,
  unidad_id   uuid,
  tipo        text NOT NULL DEFAULT 'otro',
  descripcion text NOT NULL,
  estado      text NOT NULL DEFAULT 'pendiente',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.solicitudes_concierge (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  project_id      uuid NOT NULL,
  unidad_id       uuid,
  tipo            text NOT NULL DEFAULT 'otro',
  descripcion     text NOT NULL,
  fecha_solicitud date NOT NULL DEFAULT CURRENT_DATE,
  estado          text NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE public.solicitudes_certificado (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  project_id      uuid NOT NULL,
  unidad_id       uuid,
  tipo            text NOT NULL DEFAULT 'solvencia',
  solicitante     text NOT NULL,
  motivo          text,
  observaciones   text,
  fecha_solicitud date NOT NULL DEFAULT CURRENT_DATE,
  estado          text NOT NULL DEFAULT 'pendiente'
);

CREATE TABLE public.solicitud_mudanza_unidad (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL,
  project_id   uuid NOT NULL,
  unidad_id    uuid NOT NULL,
  cliente_id   uuid,
  tipo_mudanza text NOT NULL DEFAULT 'entrada',
  descripcion  text,
  estado       text NOT NULL DEFAULT 'pendiente',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.solicitud_renta_unidad (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  unidad_id  uuid NOT NULL,
  cliente_id uuid,
  tipo_renta text NOT NULL DEFAULT 'corta',
  motivo     text,
  estado     text NOT NULL DEFAULT 'pendiente',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Datos ───────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Empresa A');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a');

INSERT INTO public.clientes (id, nombre, email) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'Cliente Uno', 'c1@example.com'),
  ('cccccccc-0000-0000-0000-000000000002', 'Cliente Dos', NULL);

INSERT INTO public.app_users (id, full_name, role, company_id, project_id, cliente_id, activo) VALUES
  ('50000000-0000-0000-0000-0000000000a1', 'Owner',     'company_owner', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, true),
  ('50000000-0000-0000-0000-0000000000a2', 'Admin',     'admin',         'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, true),
  ('50000000-0000-0000-0000-0000000000a3', 'Op P1',     'operator',      'aaaaaaaa-0000-0000-0000-00000000000a', NULL, NULL, true),
  ('50000000-0000-0000-0000-0000000000a4', 'Op P2',     'operator',      'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000002', NULL, true),
  ('50000000-0000-0000-0000-0000000000a5', 'Op baja',   'operator',      'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', NULL, false),
  ('50000000-0000-0000-0000-0000000000b1', 'Residente 1', 'cliente',     NULL, NULL, 'cccccccc-0000-0000-0000-000000000001', true),
  ('50000000-0000-0000-0000-0000000000b2', 'Residente 2', 'cliente',     NULL, NULL, 'cccccccc-0000-0000-0000-000000000002', true);

INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  ('50000000-0000-0000-0000-0000000000a3', '11111111-0000-0000-0000-000000000001');

INSERT INTO public.unidades (id, nombre, project_id, company_id, cliente_id, activo) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'Casa 1', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', true);

-- ── Helper de aserción ──────────────────────────────────────────────────────
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
