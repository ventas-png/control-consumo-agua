-- Fixture para EJECUTAR 20261031000500_padron_mascotas_vehiculos_autorizacion
-- contra un Postgres real. Reproduce solo lo que la feature toca.
--
-- Las tablas `mascotas` y `vehiculos_residentes` se copian de su DDL original
-- (20260420000002 / 20260420000015) y sus policies de la definición VIGENTE:
-- SELECT de 20260713030000 (staff con permiso + residentes vía
-- mis_unidades_ids()) y escritura de rbac_install_company_policies
-- (20260518000010: staff de la empresa con el permiso del tab). Así el test
-- parte del estado real: un `cliente` no puede escribir la tabla directo.
--
-- `auth.uid()` se emula con el GUC `app.uid` para poder cambiar de usuario.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

-- ── Esquema base ────────────────────────────────────────────────────────────
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
  nombre     text NOT NULL,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  role       text NOT NULL DEFAULT 'admin',
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  activo     boolean DEFAULT true
);

CREATE TABLE public.unidad_residentes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_id         uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  cliente_id        uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo              text NOT NULL,
  nucleo_cliente_id uuid,
  activo            boolean NOT NULL DEFAULT true
);

-- Copia de 20260420000002 (mascotas) y 20260420000015 (vehiculos_residentes).
CREATE TABLE public.mascotas (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id             uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  nombre                text        NOT NULL,
  especie               text        NOT NULL DEFAULT 'perro',
  raza                  text,
  color                 text,
  fecha_nacimiento      date,
  fecha_ultima_vacuna   date,
  activo                boolean     NOT NULL DEFAULT true,
  foto_url              text,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.vehiculos_residentes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id   uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  placa       text        NOT NULL,
  marca       text,
  modelo      text,
  color       text,
  anio        int,
  tipo        text        NOT NULL DEFAULT 'auto',
  activo      boolean     NOT NULL DEFAULT true,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mascotas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehiculos_residentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades             ENABLE ROW LEVEL SECURITY;

-- ── Storage (stubs con la semántica de Supabase) ────────────────────────────
CREATE TABLE storage.buckets (
  id                 text PRIMARY KEY,
  name               text,
  public             boolean,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

CREATE TABLE storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name      text NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- ── Helpers de identidad (misma semántica que producción) ───────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_cliente_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT cliente_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.mis_unidades_propietario_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id FROM public.unidades u
   WHERE u.cliente_id = public.get_my_cliente_id() AND public.get_my_cliente_id() IS NOT NULL
  UNION
  SELECT ur.unidad_id FROM public.unidad_residentes ur
   WHERE ur.cliente_id = public.get_my_cliente_id() AND ur.tipo = 'propietario' AND ur.activo
$$;

CREATE OR REPLACE FUNCTION public.mis_unidades_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.id FROM public.unidades u
   WHERE u.cliente_id = public.get_my_cliente_id() AND public.get_my_cliente_id() IS NOT NULL
  UNION
  SELECT ur.unidad_id FROM public.unidad_residentes ur
   WHERE ur.cliente_id = public.get_my_cliente_id() AND ur.activo
$$;

CREATE TABLE public.test_permisos (
  user_id        uuid NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

CREATE OR REPLACE FUNCTION public.user_has_permission(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.test_permisos WHERE user_id = auth.uid() AND permission_key = p_key
  )
$$;

-- ── Notificaciones (stubs que registran lo que se encola) ───────────────────
CREATE TABLE public.test_notificaciones (
  origen  text,
  fila_id uuid,
  estado  text
);

CREATE OR REPLACE FUNCTION public.fn_notificar_solicitud_nueva() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.test_notificaciones (origen, fila_id, estado) VALUES (TG_TABLE_NAME, NEW.id, NEW.estado);
  RETURN NEW;
END;
$$;

CREATE TABLE public.test_avisos (
  company_id uuid,
  user_ids   uuid[],
  titulo     text,
  cuerpo     text,
  seccion    text
);

CREATE OR REPLACE FUNCTION public.notif_encolar_in_app(
  p_company_id uuid, p_user_ids uuid[], p_tipo text, p_titulo text, p_cuerpo text,
  p_seccion text, p_extra jsonb DEFAULT '{}'::jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.test_avisos VALUES (p_company_id, p_user_ids, p_titulo, p_cuerpo, p_seccion);
  RETURN coalesce(cardinality(p_user_ids), 0);
END;
$$;

-- ── Policies VIGENTES ───────────────────────────────────────────────────────
CREATE POLICY mascotas_select ON public.mascotas FOR SELECT TO authenticated
  USING (is_super_admin()
         OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.mascotas'))
         OR (unidad_id IN (SELECT public.mis_unidades_ids())));
CREATE POLICY mascotas_insert ON public.mascotas FOR INSERT TO authenticated
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.mascotas')));
CREATE POLICY mascotas_update ON public.mascotas FOR UPDATE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.mascotas')))
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.mascotas')));
CREATE POLICY mascotas_delete ON public.mascotas FOR DELETE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.mascotas')));

CREATE POLICY vehiculos_residentes_select ON public.vehiculos_residentes FOR SELECT TO authenticated
  USING (is_super_admin()
         OR ((company_id = get_my_company_id()) AND user_has_permission('condominios.tab.vehiculos'))
         OR (unidad_id IN (SELECT public.mis_unidades_ids())));
CREATE POLICY vehiculos_residentes_insert ON public.vehiculos_residentes FOR INSERT TO authenticated
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.vehiculos')));
CREATE POLICY vehiculos_residentes_update ON public.vehiculos_residentes FOR UPDATE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.vehiculos')))
  WITH CHECK (is_super_admin()
              OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.vehiculos')));
CREATE POLICY vehiculos_residentes_delete ON public.vehiculos_residentes FOR DELETE TO authenticated
  USING (is_super_admin()
         OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.vehiculos')));

CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated
  USING (is_super_admin()
         OR company_id = get_my_company_id()
         OR (current_user_role() = 'cliente' AND id IN (SELECT public.mis_unidades_ids())));

-- ── Privilegios de tabla para el rol de la app ──────────────────────────────
GRANT USAGE ON SCHEMA public, storage, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA storage TO authenticated;

-- ── Datos ───────────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'),
  ('aaaaaaaa-0000-0000-0000-00000000000b');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a');

INSERT INTO public.clientes (id) VALUES
  ('c11e0000-0000-0000-0000-000000000001'),   -- propietario de 1D y 2D
  ('c11e0000-0000-0000-0000-000000000002'),   -- inquilino de 1D
  ('c11e0000-0000-0000-0000-000000000003');   -- propietario de 3D (vecino)

INSERT INTO public.unidades (id, company_id, project_id, cliente_id, nombre) VALUES
  ('11d10000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 1D'),
  ('11d10000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 2D'),
  ('11d10000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000003', 'Apto. 3D');

INSERT INTO public.unidad_residentes (unidad_id, cliente_id, tipo) VALUES
  ('11d10000-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000002', 'arrendatario');

INSERT INTO public.app_users (id, full_name, role, company_id, cliente_id) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'Admin Uno',       'admin',   'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  ('e0000000-0000-0000-0000-00000000000b', 'Admin Ajeno',     'admin',   'aaaaaaaa-0000-0000-0000-00000000000b', NULL),
  ('e0000000-0000-0000-0000-00000000000c', 'Marco Santos',    'cliente', NULL, 'c11e0000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000d', 'Luis de la Roca', 'cliente', NULL, 'c11e0000-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-00000000000e', 'Ana Vecina',      'cliente', NULL, 'c11e0000-0000-0000-0000-000000000003'),
  -- Staff de la empresa SIN permiso de mascotas ni vehículos.
  ('e0000000-0000-0000-0000-00000000000f', 'Guardia',         'admin',   'aaaaaaaa-0000-0000-0000-00000000000a', NULL);

INSERT INTO public.test_permisos (user_id, permission_key) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'condominios.tab.mascotas'),
  ('e0000000-0000-0000-0000-00000000000a', 'condominios.tab.vehiculos'),
  ('e0000000-0000-0000-0000-00000000000b', 'condominios.tab.mascotas'),
  ('e0000000-0000-0000-0000-00000000000b', 'condominios.tab.vehiculos');

-- Padrón previo: una mascota y un vehículo que el staff cargó antes de la
-- migración (deben quedar 'aprobada' y activos sin tocar nada).
INSERT INTO public.mascotas (id, company_id, project_id, unidad_id, nombre, especie)
VALUES ('aa000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', '11d10000-0000-0000-0000-000000000003', 'Firulais', 'perro');
INSERT INTO public.vehiculos_residentes (id, company_id, project_id, unidad_id, placa, tipo)
VALUES ('bb000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', '11d10000-0000-0000-0000-000000000003', 'P-777AAA', 'auto');
