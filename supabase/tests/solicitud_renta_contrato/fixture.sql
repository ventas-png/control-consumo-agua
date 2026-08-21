-- Fixture para EJECUTAR las migraciones de la solicitud de renta contra un
-- Postgres real. Reproduce solo lo que la feature toca.
--
-- DIFERENCIA CLAVE CON LA VERSIÓN ANTERIOR: las policies de
-- `solicitud_renta_unidad` se copian VERBATIM de la última definición vigente
-- (20260713100000_solicitudes_enforce_rbac_gate.sql), no una aproximación
-- escrita a mano. Ese atajo fue justamente lo que ocultó que el portal podía
-- insertar estado='aprobada' y autoaprobarse: el test comprobaba una policy que
-- en producción no era la efectiva.
--
-- `auth.uid()` es de Supabase; aquí se emula leyendo un GUC de sesión
-- (`app.uid`), que es lo que Supabase hace por debajo con el claim del JWT: así
-- el test puede "cambiar de usuario" con un SET.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

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
  nombre     text NOT NULL,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  role       text NOT NULL DEFAULT 'admin',
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL
);

-- Modelo dual (20260712020000/20260822000000): el rol por unidad puede venir de
-- unidades.cliente_id (legacy) o de esta tabla.
CREATE TABLE public.unidad_residentes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidad_id         uuid NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  cliente_id        uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo              text NOT NULL,
  nucleo_cliente_id uuid,
  activo            boolean NOT NULL DEFAULT true
);

-- Copia literal de 20260420000002:298.
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

-- Copia de 20260513000001 + el estado 'baja' de 20260827000000. Las columnas de
-- contrato y `documentos` las agrega 20260828000000, que este harness aplica.
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
ALTER TABLE public.unidades              ENABLE ROW LEVEL SECURITY;

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

-- Devuelve los segmentos de carpeta (todo menos el nombre del archivo), igual
-- que la función real de Supabase.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- ── Helpers de identidad (stubs con la MISMA semántica que producción) ──────
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

-- Espeja mis_unidades_propietario_ids (20260822000000): rol 'propietario' por
-- unidades.cliente_id legacy UNION unidad_residentes.
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

-- La función del trigger de notificación (20260819000000). Aquí solo cuenta
-- disparos: lo que se verifica es CUÁNDO se dispara, no qué encola.
CREATE TABLE public.test_notificaciones (
  solicitud_id uuid,
  estado       text,
  creado       timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_notificar_solicitud_nueva() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.test_notificaciones (solicitud_id, estado) VALUES (NEW.id, NEW.estado);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notif_solicitud_renta ON public.solicitud_renta_unidad;
CREATE TRIGGER trg_notif_solicitud_renta
  AFTER INSERT ON public.solicitud_renta_unidad
  FOR EACH ROW EXECUTE FUNCTION public.fn_notificar_solicitud_nueva('renta', 'condominios');

-- ── Policies VIGENTES, copiadas de 20260713100000 ───────────────────────────
-- Se reproducen tal cual para que el test parta del estado real de producción:
-- la rama de cliente del INSERT es la que permite autoaprobarse.
CREATE POLICY "solicitud_renta_unidad_select" ON public.solicitud_renta_unidad
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR EXISTS (
          SELECT 1 FROM public.unidades u
          WHERE u.id = solicitud_renta_unidad.unidad_id
            AND u.cliente_id = public.get_my_cliente_id()
        )
      )
    )
  );

CREATE POLICY "solicitud_renta_unidad_insert" ON public.solicitud_renta_unidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
    OR (
      current_user_role() = 'cliente'
      AND (
        cliente_id = get_my_cliente_id()
        OR (
          estado = 'pendiente'
          AND EXISTS (
            SELECT 1 FROM public.unidades u
            WHERE u.id = solicitud_renta_unidad.unidad_id
              AND u.cliente_id = public.get_my_cliente_id()
          )
        )
      )
    )
  );

CREATE POLICY "solicitud_renta_unidad_update" ON public.solicitud_renta_unidad
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
  )
  WITH CHECK (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.solicitudes_renta'))
  );

-- `unidades_select` reducido a lo que estas policies necesitan: staff de la
-- empresa y residente (propietario O inquilino) de la unidad.
CREATE POLICY "unidades_select" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR company_id = get_my_company_id()
    OR (current_user_role() = 'cliente' AND id IN (SELECT public.mis_unidades_ids()))
  );

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
  ('c11e0000-0000-0000-0000-000000000001'),   -- propietario
  ('c11e0000-0000-0000-0000-000000000002');   -- inquilino

INSERT INTO public.unidades (id, company_id, project_id, cliente_id, nombre) VALUES
  ('11d10000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 1D'),
  ('11d10000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 2D'),
  ('11d10000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000001', 'Apto. 3D');

-- El inquilino ve la unidad 1D (por eso podía borrar sus documentos antes).
INSERT INTO public.unidad_residentes (unidad_id, cliente_id, tipo) VALUES
  ('11d10000-0000-0000-0000-000000000001', 'c11e0000-0000-0000-0000-000000000002', 'arrendatario');

INSERT INTO public.app_users (id, full_name, role, company_id, cliente_id) VALUES
  -- Evalúa autorizaciones de renta, pero NO administra contratos.
  ('e0000000-0000-0000-0000-00000000000a', 'Admin Uno', 'admin',  'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  -- Admin de OTRA empresa.
  ('e0000000-0000-0000-0000-00000000000b', 'Admin Ajeno', 'admin', 'aaaaaaaa-0000-0000-0000-00000000000b', NULL),
  -- El propietario.
  ('e0000000-0000-0000-0000-00000000000c', 'Marco Santos', 'cliente', NULL, 'c11e0000-0000-0000-0000-000000000001'),
  -- El inquilino con acceso al portal.
  ('e0000000-0000-0000-0000-00000000000d', 'Luis de la Roca', 'cliente', NULL, 'c11e0000-0000-0000-0000-000000000002');

INSERT INTO public.test_permisos (user_id, permission_key) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'condominios.tab.solicitudes_renta'),
  ('e0000000-0000-0000-0000-00000000000b', 'condominios.tab.solicitudes_renta');
