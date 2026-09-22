-- Fixture para DEMOSTRAR la escritura cruzada que 20260923000000 cierra.
--
-- Reproduce el estado REAL DE PRODUCCIÓN que #826 §3.3 documentó: las cinco
-- policies de `empresa` —la única que el repositorio declara más las cuatro que
-- sólo existen allá— y los grants por defecto de Supabase, que dan a `anon` y a
-- `authenticated` los siete privilegios sobre todo `public`.
--
-- Las cuatro legadas se declaran con su forma exacta (`TO public`, guardadas
-- sólo por `current_user_role() = 'admin'`) porque es esa forma la que produce
-- el agujero: el predicado mira el ROL y no mira de qué empresa es.
--
-- EL PADRÓN. Dos empresas distintas, y la diferencia entre sus usuarios es el
-- punto entero de la prueba:
--   · `admin_a`     — role 'admin' en la empresa A.
--   · `admin_b`     — role 'admin' en la empresa B. NO debería poder tocar
--                     nada que la empresa A lea, y hoy puede todo.
--   · `operativo_a` — role 'operator' en la empresa A. Es el control: si él
--                     tampoco pudiera escribir ANTES, el predicado no estaría
--                     haciendo nada y la prueba no distinguiría el agujero de
--                     una tabla simplemente cerrada.
--
-- `auth.uid()` se emula con un GUC de sesión, igual que en los otros arneses.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.uid', true), '')::uuid
  $$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  role       text NOT NULL
);

-- Copia literal de 20260320000003: mira el rol y NO mira la empresa. Ésa es la
-- causa de todo lo que sigue.
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role FROM public.app_users WHERE id = auth.uid()
  $$;

-- ── La tabla, tal como la creó 20260317000001 ──────────────────────────────
-- SIN COLUMNA DE TENANT. No es un olvido del fixture: es el hecho central del
-- caso. No hay por dónde acotar una policy por empresa.
CREATE TABLE public.empresa (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  direccion  text,
  telefono   text,
  nit        text,
  logo_url   text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.empresa ENABLE ROW LEVEL SECURITY;

-- Los grants por DEFECTO de Supabase sobre `public`: los siete privilegios a
-- `anon` y a `authenticated`. Producción y el repositorio coinciden en esto
-- —por eso `tabla:empresa/grants` no está en la baseline— y es la capa que
-- convierte a `empresa_insert_by_role` en algo más que una declaración.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.empresa TO anon, authenticated, service_role;

-- ── La policy que SÍ declara el repositorio (20260729000000) ───────────────
CREATE POLICY "empresa_select_authenticated" ON public.empresa
  FOR SELECT TO authenticated
  USING (true);

-- ── Las CUATRO que sólo existen en producción (#826 §3.3) ──────────────────
CREATE POLICY "empresa_insert_by_role" ON public.empresa
  FOR INSERT TO public
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "empresa_update_by_role" ON public.empresa
  FOR UPDATE TO public
  USING (current_user_role() = 'admin');

CREATE POLICY "empresa_delete_by_role" ON public.empresa
  FOR DELETE TO public
  USING (current_user_role() = 'admin');

-- Redundante con `empresa_select_authenticated`: dos permisivas se unen con OR,
-- así que la lista de roles no acota nada. Se reproduce igual porque forma
-- parte de las cinco que hay que dejar en una.
CREATE POLICY "empresa_select_by_role" ON public.empresa
  FOR SELECT TO authenticated
  USING (current_user_role() = ANY (ARRAY[
    'admin','super_admin','superadmin','company_owner','operator',
    'viewer','collector','tecnico','residente','concierge'
  ]));

-- ── Padrón ─────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES
  ('11111111-1111-1111-1111-111111111111'),   -- empresa A
  ('22222222-2222-2222-2222-222222222222');   -- empresa B

INSERT INTO auth.users (id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('bbbbbbbb-0000-0000-0000-00000000000b'),
  ('cccccccc-0000-0000-0000-00000000000c');

INSERT INTO public.app_users (id, company_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'admin'),
  ('cccccccc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'operator');

-- Dos filas, para que borrar una sea observable y para que el `limit(1)` sin
-- filtro de `useEmpresaQuery` tenga de dónde elegir.
INSERT INTO public.empresa (id, nombre, direccion, nit) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'Mayan Residenciales', 'Km 15 CA-9', '1234567-8'),
  ('e0000000-0000-0000-0000-000000000002', 'Segunda razón social',  'Zona 10',    '8765432-1');
