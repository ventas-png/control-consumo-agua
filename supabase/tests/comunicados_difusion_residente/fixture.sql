-- ════════════════════════════════════════════════════════════════════════════
-- Fixture del test de 20260801000300 (comunicados / difusión · residente).
--
-- Reconstruye en un Postgres pelado el MÍNIMO necesario para evaluar las
-- policies: los helpers de RLS de Supabase, las tablas implicadas y las
-- policies TAL COMO ESTÁN HOY EN PROD (pre-fix), para poder reproducir el bug
-- antes de aplicar la migración.
-- ════════════════════════════════════════════════════════════════════════════

-- ── auth.uid() simulado: lee el usuario "logueado" de una GUC de sesión ──────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.user_id', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

-- ── Tablas ──────────────────────────────────────────────────────────────────
CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  role       text NOT NULL,
  company_id uuid,
  cliente_id uuid,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.companies (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL
);

CREATE TABLE public.clientes (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL,
  email  text
);

-- Outbox del orquestador de notificaciones (subconjunto usado por el trigger).
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

CREATE TABLE public.company_clientes (
  company_id uuid NOT NULL,
  cliente_id uuid NOT NULL
);

CREATE TABLE public.unidades (
  id         uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  company_id uuid NOT NULL,
  cliente_id uuid,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.unidad_residentes (
  unidad_id  uuid NOT NULL,
  cliente_id uuid NOT NULL,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.anuncios_comunidad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  project_id    uuid NOT NULL,
  titulo        text NOT NULL,
  contenido     text NOT NULL,
  tipo          text NOT NULL DEFAULT 'aviso',
  publicado_por uuid,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
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
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE public.broadcast_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  cliente_id   uuid NOT NULL,
  company_id   uuid,
  read_at      timestamptz,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (broadcast_id, cliente_id)
);

-- ── Helpers de RLS (copias fieles de las de prod) ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_my_cliente_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cliente_id FROM public.app_users WHERE id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT role FROM public.app_users WHERE id = auth.uid())
                  IN ('super_admin','superadmin'), false)
$$;

-- Sin tablas RBAC: basta con la rama que importa aquí — los roles de plataforma
-- tienen todos los permisos y el rol `cliente` no tiene ninguno.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT role FROM public.app_users WHERE id = auth.uid())
                  IN ('super_admin','superadmin','company_owner','admin'), false)
$$;

-- Copia de 20260713050000_portal_residentes_fase3_helpers_dual.sql
CREATE OR REPLACE FUNCTION public.mis_proyectos_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT DISTINCT u.project_id FROM public.unidades u
  WHERE u.activo = true AND u.cliente_id = public.get_my_cliente_id()
  UNION
  SELECT DISTINCT u2.project_id FROM public.unidad_residentes ur
    JOIN public.unidades u2 ON u2.id = ur.unidad_id
  WHERE ur.activo = true AND u2.activo = true AND ur.cliente_id = public.get_my_cliente_id()
$fn$;

-- ── Policies PRE-FIX (estado actual de prod) ────────────────────────────────
-- anuncios_comunidad: variante RBAC de 20260518000010 — sin rama de residente.
ALTER TABLE public.anuncios_comunidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anuncios_comunidad_select" ON public.anuncios_comunidad
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR ((company_id = public.get_my_company_id())
        AND public.user_has_permission('condominios.tab.comunicados'))
  );

-- broadcasts / broadcast_recipients: variante consolidada de 20260417000012.
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcasts_all" ON public.broadcasts
  FOR ALL TO authenticated
  USING (company_id IN (
    SELECT app_users.company_id FROM public.app_users WHERE app_users.id = (SELECT auth.uid())
  ))
  WITH CHECK (company_id IN (
    SELECT app_users.company_id FROM public.app_users WHERE app_users.id = (SELECT auth.uid())
  ));

ALTER TABLE public.broadcast_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcast_recipients_select" ON public.broadcast_recipients
  FOR SELECT TO authenticated
  USING (
    company_id IN (SELECT app_users.company_id FROM public.app_users WHERE app_users.id = (SELECT auth.uid()))
    OR cliente_id IN (
      SELECT cc.cliente_id FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = (SELECT auth.uid()) WHERE u.company_id = cc.company_id
    )
  );

CREATE POLICY "broadcast_recipients_update" ON public.broadcast_recipients
  FOR UPDATE TO authenticated
  USING (
    company_id IN (SELECT app_users.company_id FROM public.app_users WHERE app_users.id = (SELECT auth.uid()))
    OR cliente_id IN (
      SELECT cc.cliente_id FROM public.company_clientes cc
      JOIN public.app_users u ON u.id = (SELECT auth.uid()) WHERE u.company_id = cc.company_id
    )
  );

-- ── Datos ───────────────────────────────────────────────────────────────────
-- Empresa A (el tenant bajo prueba) y empresa Z (aislamiento).
--   P1 = proyecto donde vive el residente R;  P2 = otro proyecto de la MISMA empresa.
--   R  = cuenta de residente tal como la crea create-cliente-account: company_id NULL.
--   R3 = cuenta de residente LEGACY con company_id — demuestra la fuga que se cierra.
INSERT INTO public.app_users (id, full_name, role, company_id, cliente_id) VALUES
  ('50000000-0000-0000-0000-000000000001', 'Staff A',      'company_owner', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  ('50000000-0000-0000-0000-000000000002', 'Residente R',  'cliente',        NULL,                                   'cccccccc-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', 'Residente R3', 'cliente',       'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000003'),
  ('50000000-0000-0000-0000-000000000004', 'Staff Z',      'company_owner', 'ffffffff-0000-0000-0000-00000000000f', NULL);

INSERT INTO public.companies (id, nombre) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Mayan Residenciales'),
  ('ffffffff-0000-0000-0000-00000000000f', 'Otra Empresa');

-- C1 tiene correo; C3 no (comprueba que el email se omite y el in_app no).
INSERT INTO public.clientes (id, nombre, email) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'Residente Uno',  'uno@example.com'),
  ('cccccccc-0000-0000-0000-000000000002', 'Residente Dos',  'dos@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'Residente Tres', NULL);

INSERT INTO public.company_clientes (company_id, cliente_id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000002'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000003');

INSERT INTO public.unidades (id, project_id, company_id, cliente_id, activo) VALUES
  ('d1111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000001', true),
  ('d2222222-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000002', true),
  ('d3333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-000000000003', true);

-- Anuncio en el proyecto del residente + otro en un proyecto ajeno.
INSERT INTO public.anuncios_comunidad (id, company_id, project_id, titulo, contenido, publicado_por) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Corte de agua', 'Mañana de 8 a 12', '50000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', '22222222-0000-0000-0000-000000000002', 'Otro proyecto',  'No me corresponde', '50000000-0000-0000-0000-000000000001');

-- Difusión de la empresa A a DOS clientes (R y otro), como la abanica create-broadcast.
INSERT INTO public.broadcasts (id, company_id, title, body, sent_by_id, sent_by_name, recipient_count) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Aviso general', 'Cuerpo', '50000000-0000-0000-0000-000000000001', 'Staff A', 3);

INSERT INTO public.broadcast_recipients (broadcast_id, cliente_id, company_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a');

-- ── Grants (en Supabase los da el rol `authenticated` por defecto) ───────────
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- ── Helper de aserciones ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;
