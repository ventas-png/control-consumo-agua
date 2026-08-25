-- Fixture mínimo para EJECUTAR las migraciones 20260826000000 / 20260904000000 /
-- 20260905000000 contra un Postgres de verdad. Reproduce solo lo que tocan los
-- dos selectores que preguntan «¿quién puede hacerse cargo de esto AQUÍ?»: el
-- usuario de ingreso del tab Personal y el operador de una ruta.
--
-- `auth.uid()` es una función de Supabase; aquí se emula leyendo un GUC de
-- sesión (`app.uid`), que es lo que Supabase hace por debajo con el claim del
-- JWT. Así el test puede "cambiar de usuario" con un SET (mismo patrón que
-- supabase/tests/trazabilidad).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

-- El RPC saca el correo de aquí: es "el usuario de ingreso" tal como lo teclea
-- la persona al entrar, y lo único que distingue a dos homónimos.
CREATE TABLE auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email character varying(255)
);

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

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text,
  role       text NOT NULL DEFAULT 'operator',
  activo     boolean NOT NULL DEFAULT true,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Columna legacy: acceso a UN proyecto sin pasar por user_project_assignments.
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL
);

CREATE TABLE public.user_project_assignments (
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE public.personal_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  cargo      text NOT NULL DEFAULT 'conserje',
  estado     text NOT NULL DEFAULT 'activo',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Helpers de identidad (stubs con la MISMA semántica que producción) ──────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = auth.uid() AND role = ANY (ARRAY['super_admin', 'superadmin'])
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

-- Espeja 20260518000008: los tiers exentos tienen TODOS los permisos; el resto
-- los recibe por rol RBAC, que aquí se reduce a una tabla de pares.
-- `can_access_project()` (20260815000000) para el LLAMADOR: el RPC de rutas la
-- consulta y no vive en las migraciones que este harness aplica. Se reproduce
-- con la MISMA semántica: exento por tier, project_id legacy o asignación.
CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    p_project_id IS NULL
    OR (
      SELECT
        u.role = ANY (ARRAY['super_admin', 'superadmin', 'company_owner'])
        OR (u.role = 'admin' AND NOT EXISTS (
              SELECT 1 FROM public.user_project_assignments upa WHERE upa.user_id = u.id))
        OR u.project_id = p_project_id
        OR EXISTS (
             SELECT 1 FROM public.user_project_assignments upa
             WHERE upa.user_id = u.id AND upa.project_id = p_project_id)
      FROM public.app_users u
      WHERE u.id = auth.uid()
    ),
    false
  )
$$;

CREATE TABLE public.test_permisos (
  user_id        uuid NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN false
      WHEN (SELECT role FROM public.app_users WHERE id = auth.uid())
           IN ('super_admin', 'superadmin', 'company_owner', 'admin') THEN true
      ELSE EXISTS (
        SELECT 1 FROM public.test_permisos
        WHERE user_id = auth.uid() AND permission_key = perm_key
      )
    END
$$;

-- ── Datos ───────────────────────────────────────────────────────────────────
-- Empresa A con dos condominios; empresa B para probar el corte multi-tenant.
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('aaaaaaaa-0000-0000-0000-00000000000b');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),  -- P1
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a'),  -- P2
  ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000b');  -- P3 (empresa B)

INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-00000000000f', 'owner@empresa-a.com'),
  ('e0000000-0000-0000-0000-00000000000d', 'admin.libre@empresa-a.com'),
  ('e0000000-0000-0000-0000-00000000000e', 'admin.acotado@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000001', 'dina@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000002', 'marco@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000003', 'sin.acceso@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000004', 'residente@correo.com'),
  ('e0000000-0000-0000-0000-000000000005', 'blanco@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000009', 'ajeno@empresa-b.com');

INSERT INTO public.app_users (id, full_name, role, activo, company_id, project_id) VALUES
  -- Exento por tier: ve todos los proyectos de su empresa.
  ('e0000000-0000-0000-0000-00000000000f', 'Olga Owner',     'company_owner', true,  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- admin SIN asignaciones → exento.
  ('e0000000-0000-0000-0000-00000000000d', 'Ada Admin',      'admin',         true,  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- admin CON asignación (a P2) → deja de ser exento y NO ve P1.
  ('e0000000-0000-0000-0000-00000000000e', 'Aldo Acotado',   'admin',         true,  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- Operativa con asignación explícita a P1.
  ('e0000000-0000-0000-0000-000000000001', 'Dina Villatoro', 'operator',      true,  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- Acceso por la columna legacy app_users.project_id.
  ('e0000000-0000-0000-0000-000000000002', 'Marco Guardia',  'operator',      false, 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001'),
  -- Sin asignación ni project_id → no ve P1.
  ('e0000000-0000-0000-0000-000000000003', 'Sara Sin Acceso','operator',      true,  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- full_name en blanco: el selector no debe mostrar una opción vacía.
  ('e0000000-0000-0000-0000-000000000005', '   ',              'operator',      true,  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- Residente: company_id NULL por invariante (20260801000400).
  ('e0000000-0000-0000-0000-000000000004', 'Rita Residente', 'cliente',       true,  NULL,                                   NULL),
  -- Staff de OTRA empresa.
  ('e0000000-0000-0000-0000-000000000009', 'Aj Eno',         'operator',      true,  'aaaaaaaa-0000-0000-0000-00000000000b', NULL);

INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000e', '11111111-0000-0000-0000-000000000002');

-- Dina tiene los permisos por rol RBAC; Sara no tiene ninguno.
INSERT INTO public.test_permisos (user_id, permission_key) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'condominios.tab.personal'),
  ('e0000000-0000-0000-0000-000000000001', 'agua.rutas.view');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo) VALUES
  ('9e000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Dina Lucrecia Villatoro', 'conserje'),
  ('9e000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Marco Antonio Guardia',   'guardia'),
  ('9e000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000002', 'Dina en la torre 2',      'conserje'),
  ('9e000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000003', 'Empleado de otra empresa','conserje');
