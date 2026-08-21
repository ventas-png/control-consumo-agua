-- Fixture mínimo para EJECUTAR las migraciones 20260828000000/200 contra un
-- Postgres de verdad. Reproduce solo lo que la solicitud de renta toca.
--
-- `auth.uid()` es de Supabase; aquí se emula leyendo un GUC de sesión
-- (`app.uid`), que es lo que Supabase hace por debajo con el claim del JWT: así
-- el test puede "cambiar de usuario" con un SET (mismo patrón que
-- supabase/tests/personal_usuario).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

-- ── Esquema tocado ──────────────────────────────────────────────────────────
CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE TABLE public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);

CREATE TABLE public.clientes (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE TABLE public.unidades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  nombre     text NOT NULL
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  role       text NOT NULL DEFAULT 'admin',
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL
);

-- Copia literal de 20260420000002:298 (la tabla que el RPC alimenta).
CREATE TABLE public.contratos_arrendamiento (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id                  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id                   uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  arrendatario_nombre         text        NOT NULL,
  arrendatario_identificacion text,
  arrendatario_telefono       text,
  arrendatario_email          text,
  monto_renta                 numeric(12,2) NOT NULL,
  dia_pago                    int         NOT NULL DEFAULT 1,
  fecha_inicio                date        NOT NULL,
  fecha_fin                   date,
  deposito                    numeric(12,2),
  estado                      text        NOT NULL DEFAULT 'activo',
  notas                       text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- Copia de 20260513000001 + el estado 'baja' de 20260827000000.
CREATE TABLE public.solicitud_renta_unidad (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL,
  project_id       uuid        NOT NULL,
  unidad_id        uuid        NOT NULL,
  cliente_id       uuid,
  tipo_renta       text        NOT NULL DEFAULT 'arrendamiento'
                               CHECK (tipo_renta IN ('arrendamiento','str','ambas')),
  motivo           text,
  estado           text        NOT NULL DEFAULT 'pendiente'
                               CHECK (estado IN ('pendiente','aprobada','rechazada','baja')),
  tipo_aprobado    text        CHECK (tipo_aprobado IN ('arrendamiento','str','ambas')),
  comentario_admin text,
  aprobado_por     text,
  fecha_resolucion timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_solicitud_renta_unidad_activa
  ON public.solicitud_renta_unidad (unidad_id)
  WHERE estado IN ('pendiente', 'aprobada');

ALTER TABLE public.solicitud_renta_unidad ENABLE ROW LEVEL SECURITY;

-- ── Helpers de identidad (stubs con la MISMA semántica que producción) ──────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_cliente_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT cliente_id FROM public.app_users WHERE id = auth.uid()
$$;

-- El permiso RBAC se reduce a una tabla de pares (como en personal_usuario).
CREATE TABLE public.test_permisos (
  user_id        uuid NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

CREATE OR REPLACE FUNCTION public.user_has_permission(p_key text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.test_permisos WHERE user_id = auth.uid() AND permission_key = p_key
  )
$$;

-- Policy del cliente vigente ANTES de 20260828000000 (20260518000012): la
-- migración la recrea, y el test comprueba que el término nuevo entró.
CREATE POLICY "solicitud_renta_cliente_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'cliente'
    AND EXISTS (
      SELECT 1 FROM public.unidades u
      WHERE u.id = solicitud_renta_unidad.unidad_id
        AND u.cliente_id = public.get_my_cliente_id()
    )
    AND estado = 'pendiente'
  );

-- ── Datos ───────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('aaaaaaaa-0000-0000-0000-00000000000b');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a');

INSERT INTO public.clientes (id) VALUES
  ('c11e0000-0000-0000-0000-000000000001');

INSERT INTO public.unidades (id, company_id, project_id, cliente_id, nombre) VALUES
  ('11d10000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 1D'),
  ('11d10000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 2D'),
  ('11d10000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 3D');

INSERT INTO public.app_users (id, role, company_id, cliente_id) VALUES
  -- Evalúa autorizaciones de renta, pero NO administra contratos.
  ('e0000000-0000-0000-0000-00000000000a', 'admin',  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- Admin de OTRA empresa.
  ('e0000000-0000-0000-0000-00000000000b', 'admin',  'aaaaaaaa-0000-0000-0000-00000000000b', NULL),
  -- El propietario.
  ('e0000000-0000-0000-0000-00000000000c', 'cliente', NULL, 'c11e0000-0000-0000-0000-000000000001');

INSERT INTO public.test_permisos (user_id, permission_key) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'condominios.tab.solicitudes_renta'),
  ('e0000000-0000-0000-0000-00000000000b', 'condominios.tab.solicitudes_renta');
