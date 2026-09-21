-- Fixture para EJECUTAR 20260921000100 (catálogo de puntos de verificación)
-- contra un Postgres de verdad. El run.sh aplica la migración REAL encima.
--
-- Aquí va SOLO lo que la migración presupone y no crea: el esquema del que
-- cuelga (`areas_condominio`, `rutas_ronda`, `puntos_control_ruta`,
-- `visitas_control`), los helpers de identidad y RLS, `sellar_actor` y
-- `areas_normalizar_nombre`. Las tablas se declaran con la forma que tienen
-- DESPUÉS de las migraciones que ya corrieron (incluida la columna `creado_por`
-- de 20260731000000): lo que aquí importa es el esquema resultante, no volver a
-- probar esas migraciones.
--
-- DOS EMPRESAS Y TRES PROYECTOS: el guard de tenant de esta migración vigila el
-- cruce entre proyectos de la MISMA empresa, que es el que una RLS por empresa
-- no ve. Separarlo del cruce entre empresas es el punto.
--
-- `auth.uid()` se emula leyendo un GUC de sesión (`app.uid`), igual que en
-- supabase/tests/evidencia_al_cerrar/fixture.sql.

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

-- ── Helpers de identidad y RLS (SECURITY DEFINER como en prod) ─────────────
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

CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(public.current_user_role() IN
      ('super_admin', 'superadmin', 'company_owner', 'admin'), false)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND rp.permission_key = perm_key
        AND rp.effect = 'allow'
    )
$$;

-- ── Trazabilidad (copia literal de 20260731000000) ─────────────────────────
CREATE OR REPLACE FUNCTION public.sellar_actor()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_modo text := COALESCE(TG_ARGV[1], 'forzar');
  v_uid  uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND (v_modo = 'forzar' OR to_jsonb(NEW)->>v_col IS NULL) THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_uid));
    END IF;
  ELSE
    IF to_jsonb(NEW)->>v_col IS DISTINCT FROM to_jsonb(OLD)->>v_col THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, to_jsonb(OLD)->>v_col));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Normalizador de nombres (copia literal de 20260904000100) ──────────────
-- La migración lo usa en el índice único del catálogo, y es el MISMO espejo que
-- domain/condominios/areas.ts implementa en cliente.
CREATE OR REPLACE FUNCTION public.areas_normalizar_nombre(p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(
    regexp_replace(
      translate(lower(btrim(coalesce(p_nombre, ''))),
                'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc'),
      '[^a-z0-9]+', '', 'g'),
    '')
$$;

-- ── El esquema del que cuelga el catálogo ──────────────────────────────────
CREATE TABLE public.areas_condominio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre      text NOT NULL,
  descripcion text,
  icono       text NOT NULL DEFAULT '📍',
  orden       int  NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  creado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rutas_ronda (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre              text NOT NULL,
  descripcion         text,
  tiempo_estimado_min int,
  activo              boolean NOT NULL DEFAULT true,
  creado_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.puntos_control_ruta (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruta_id             uuid NOT NULL REFERENCES public.rutas_ronda(id) ON DELETE CASCADE,
  area_id             uuid NOT NULL REFERENCES public.areas_condominio(id),
  orden               int  NOT NULL DEFAULT 0,
  instrucciones       text,
  tiempo_estimado_min int,
  creado_por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rondas_seguridad (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  estado     text NOT NULL DEFAULT 'en_curso',
  inicio     timestamptz NOT NULL DEFAULT now(),
  fin        timestamptz,
  creado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.visitas_control (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ronda_id     uuid NOT NULL REFERENCES public.rondas_seguridad(id) ON DELETE CASCADE,
  punto_id     uuid NOT NULL REFERENCES public.puntos_control_ruta(id) ON DELETE CASCADE,
  estado       text NOT NULL DEFAULT 'pendiente',
  notas        text,
  visitado_en  timestamptz,
  visitado_por uuid,
  creado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- El CHECK con el vocabulario VIEJO, tal como lo deja 20260919000000
  -- (convergencia): admite 'visitado'/'con_novedad' y NO lo que la aplicación
  -- escribe. Está aquí a propósito — 20260920000000 existe para arreglarlo, y
  -- sin este punto de partida el arnés no probaría nada.
  CONSTRAINT visitas_control_estado_check
    CHECK (estado IN ('pendiente', 'visitado', 'con_novedad', 'omitido'))
);

-- ── Padrón ─────────────────────────────────────────────────────────────────
-- Empresa A con DOS proyectos (el cruce que importa) y empresa B con uno.
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO public.projects (id, company_id) VALUES
  ('a1111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('a2222222-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('b1111111-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO auth.users (id) VALUES
  ('11111111-0000-0000-0000-000000000001');
INSERT INTO public.app_users (id, company_id, role) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin');
