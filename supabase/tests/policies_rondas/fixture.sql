-- Fixture para DEMOSTRAR el bypass que 20260922000000 cierra, y su cierre.
--
-- Reproduce el estado que el REPOSITORIO describía antes de esa migración: las
-- cuatro policies de RBAC de 20260519000002 conviviendo con las dos legadas de
-- 20260424000059, que ninguna migración había borrado. Las legadas se declaran
-- IGUAL que en su migración original —sin `FOR`, sin `TO`, permisivas— porque
-- es justamente esa forma la que produce el agujero.
--
-- El padrón tiene DOS usuarios de la misma empresa, y la diferencia entre ellos
-- es el punto entero de la prueba:
--   · `operativo`  — SIN `condominios.tab.rutas_ronda`. No debería poder nada.
--   · `encargado`  — CON el permiso. Debe poder leer y escribir, pero no borrar.
--   · `duena`      — company_owner. Es la única que debe poder borrar.
--
-- `auth.uid()` se emula con un GUC de sesión, igual que en los otros arneses.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);
CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'operador'
);

-- ── Helpers de identidad y RLS ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_user_role() IN ('super_admin', 'superadmin'), false)
$$;

CREATE TABLE public.role_permissions (
  role_id        uuid NOT NULL,
  permission_key text NOT NULL,
  effect         text NOT NULL DEFAULT 'allow',
  PRIMARY KEY (role_id, permission_key)
);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

-- OJO: a diferencia de otros fixtures, aquí `company_owner`/`admin` NO recibe
-- todos los permisos por su rol. Si lo hiciera, la dueña pasaría cualquier gate
-- por ser dueña y la prueba no podría distinguir "pasó por el permiso" de
-- "pasó por el rol" — que es exactamente lo que hay que separar.
CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND rp.permission_key = perm_key
      AND rp.effect = 'allow'
  )
$$;

-- ── Las tablas, tal como las dejó 20260424000059 ───────────────────────────
CREATE TABLE public.areas_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre     text NOT NULL
);

CREATE TABLE public.rutas_ronda (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre     text NOT NULL
);

CREATE TABLE public.rondas_seguridad (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  estado     text NOT NULL DEFAULT 'en_curso'
);

CREATE TABLE public.puntos_control_ruta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id       uuid NOT NULL REFERENCES public.rutas_ronda(id) ON DELETE CASCADE,
  area_id       uuid NOT NULL REFERENCES public.areas_condominio(id) ON DELETE CASCADE,
  orden         int  NOT NULL DEFAULT 0,
  instrucciones text
);

CREATE TABLE public.visitas_control (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ronda_id uuid NOT NULL REFERENCES public.rondas_seguridad(id) ON DELETE CASCADE,
  punto_id uuid NOT NULL REFERENCES public.puntos_control_ruta(id) ON DELETE CASCADE,
  estado   text NOT NULL DEFAULT 'pendiente',
  notas    text
);

ALTER TABLE public.puntos_control_ruta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitas_control     ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.puntos_control_ruta, public.visitas_control TO authenticated;

-- Las policies consultan las tablas PADRE para derivar el inquilino, así que
-- quien las evalúa necesita leerlas. En Supabase `authenticated` ya las tiene
-- por los privilegios por defecto; acá se conceden explícitamente para que el
-- arné mida la RLS y no un GRANT faltante.
GRANT SELECT ON public.rutas_ronda, public.rondas_seguridad, public.areas_condominio
  TO authenticated;

-- ── Las DOS policies legadas, copia literal de 20260424000059 ──────────────
-- Sin `FOR` (⇒ FOR ALL), sin `TO` (⇒ TO PUBLIC), permisivas. Ésta es la forma
-- que produce el agujero, y por eso se reproduce exacta en vez de aproximarla.
CREATE POLICY "company_rw_puntos_control" ON public.puntos_control_ruta
  USING  (EXISTS (SELECT 1 FROM public.rutas_ronda r WHERE r.id = ruta_id AND r.company_id = public.get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rutas_ronda r WHERE r.id = ruta_id AND r.company_id = public.get_my_company_id()));

CREATE POLICY "company_rw_visitas_control" ON public.visitas_control
  USING  (EXISTS (SELECT 1 FROM public.rondas_seguridad rs WHERE rs.id = ronda_id AND rs.company_id = public.get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rondas_seguridad rs WHERE rs.id = ronda_id AND rs.company_id = public.get_my_company_id()));

-- ── Las CUATRO de RBAC, copia literal de 20260519000002 ────────────────────
CREATE POLICY "puntos_control_ruta_select" ON public.puntos_control_ruta
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rutas_ronda r
    WHERE r.id = puntos_control_ruta.ruta_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')));

CREATE POLICY "puntos_control_ruta_insert" ON public.puntos_control_ruta
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rutas_ronda r
    WHERE r.id = puntos_control_ruta.ruta_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')));

CREATE POLICY "puntos_control_ruta_update" ON public.puntos_control_ruta
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rutas_ronda r
    WHERE r.id = puntos_control_ruta.ruta_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')))
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rutas_ronda r
    WHERE r.id = puntos_control_ruta.ruta_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')));

CREATE POLICY "puntos_control_ruta_delete" ON public.puntos_control_ruta
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rutas_ronda r
    WHERE r.id = puntos_control_ruta.ruta_id
      AND r.company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner','admin')));

CREATE POLICY "visitas_control_select" ON public.visitas_control
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rondas_seguridad r
    WHERE r.id = visitas_control.ronda_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')));

CREATE POLICY "visitas_control_insert" ON public.visitas_control
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rondas_seguridad r
    WHERE r.id = visitas_control.ronda_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')));

CREATE POLICY "visitas_control_update" ON public.visitas_control
  FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rondas_seguridad r
    WHERE r.id = visitas_control.ronda_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')))
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rondas_seguridad r
    WHERE r.id = visitas_control.ronda_id
      AND r.company_id = public.get_my_company_id()
      AND public.user_has_permission('condominios.tab.rutas_ronda')));

CREATE POLICY "visitas_control_delete" ON public.visitas_control
  FOR DELETE TO authenticated
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.rondas_seguridad r
    WHERE r.id = visitas_control.ronda_id
      AND r.company_id = public.get_my_company_id()
      AND public.current_user_role() IN ('company_owner','admin')));

-- ── Padrón y datos ─────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO public.projects (id, company_id) VALUES
  ('a1111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');

INSERT INTO auth.users (id) VALUES
  ('11111111-0000-0000-0000-000000000001'),  -- operativo (sin permiso)
  ('22222222-0000-0000-0000-000000000002'),  -- encargado (con permiso)
  ('33333333-0000-0000-0000-000000000003');  -- dueña

INSERT INTO public.app_users (id, company_id, role) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'operador'),
  ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'operador'),
  ('33333333-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'company_owner');

-- El permiso del tab lo tienen el encargado y la dueña; el operativo NO. Así la
-- matriz separa las dos puertas por separado: el permiso (operativo vs los
-- otros dos) y el rol para borrar (encargado vs dueña).
INSERT INTO public.role_permissions (role_id, permission_key) VALUES
  ('99999999-0000-0000-0000-000000000009', 'condominios.tab.rutas_ronda');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('22222222-0000-0000-0000-000000000002', '99999999-0000-0000-0000-000000000009'),
  ('33333333-0000-0000-0000-000000000003', '99999999-0000-0000-0000-000000000009');

INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'a1111111-0000-0000-0000-000000000001', 'Estacionamiento B2');

INSERT INTO public.rutas_ronda (id, company_id, project_id, nombre) VALUES
  ('e0000000-0000-0000-0000-000000000011', 'aaaaaaaa-0000-0000-0000-000000000001',
   'a1111111-0000-0000-0000-000000000001', 'Ronda nocturna');

INSERT INTO public.rondas_seguridad (id, company_id, project_id) VALUES
  ('90000000-0000-0000-0000-000000000031', 'aaaaaaaa-0000-0000-0000-000000000001',
   'a1111111-0000-0000-0000-000000000001');

INSERT INTO public.puntos_control_ruta (id, ruta_id, area_id, orden, instrucciones) VALUES
  ('f0000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000011',
   'c0000000-0000-0000-0000-0000000000a1', 0, 'Verificar candado'),
  ('f0000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000011',
   'c0000000-0000-0000-0000-0000000000a1', 1, 'Revisar cámara');

INSERT INTO public.visitas_control (id, ronda_id, punto_id) VALUES
  ('a0000000-0000-0000-0000-000000000041', '90000000-0000-0000-0000-000000000031',
   'f0000000-0000-0000-0000-000000000021'),
  ('a0000000-0000-0000-0000-000000000042', '90000000-0000-0000-0000-000000000031',
   'f0000000-0000-0000-0000-000000000022');
