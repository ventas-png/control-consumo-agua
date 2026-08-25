-- Fixture para EJECUTAR 20260907000200 (rutinas de limpieza) contra un Postgres
-- de verdad. Reproduce el estado ANTERIOR a la serie 20260904*: el padrón
-- multi-tenant, los helpers de RLS/trazabilidad y las tablas del módulo tal
-- como estaban. El run.sh aplica encima las migraciones REALES 20260904000100
-- y 000100 —de ahí salen `areas_normalizar_nombre` y el ancla
-- `plantillas_cargo_id_tenant_uq` que la migración de rutinas necesita— en vez
-- de copiarlas a mano aquí, que es como los fixtures se van desincronizando
-- del repo.
--
-- `plantillas_horario` sí se declara aquí, literal de 20260820000000: ninguna
-- de las migraciones que aplica el run.sh la crea, y la FK compuesta de
-- rutinas_limpieza apunta a ella.
--
-- Dos empresas y tres proyectos: el aislamiento cross-tenant y el cross-project
-- dentro de la MISMA empresa se prueban por separado — son fallos distintos y
-- el segundo es el que una RLS por empresa no ve.
--
-- `auth.uid()` se emula leyendo un GUC de sesión (`app.uid`), igual que en
-- supabase/tests/turnos/fixture.sql.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);
CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  full_name  text,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'operador',
  activo     boolean NOT NULL DEFAULT true
);

-- ── Helpers de identidad (SECURITY DEFINER como en prod, 20260518000008) ─────
GRANT USAGE ON SCHEMA auth TO PUBLIC;

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

CREATE TABLE public.permissions (
  key         text PRIMARY KEY,
  category    text,
  label       text,
  description text
);
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

-- ── Trazabilidad (copia literal de 20260731000000) ──────────────────────────
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

CREATE OR REPLACE FUNCTION public.sellar_cierre()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_hito  text := TG_ARGV[0];
  v_actor text := TG_ARGV[1];
  v_uid   uuid := auth.uid();
  v_old   text := to_jsonb(OLD)->>v_hito;
  v_new   text := to_jsonb(NEW)->>v_hito;
BEGIN
  IF v_uid IS NOT NULL
     AND COALESCE(v_old, 'false') IN ('', 'false')
     AND COALESCE(v_new, 'false') NOT IN ('', 'false') THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_actor, v_uid));
  END IF;
  RETURN NEW;
END;
$$;

-- ── Tablas del módulo, en su estado ANTERIOR a la serie 20260904* ───────────

CREATE TABLE public.personal_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre     text NOT NULL,
  cargo      text NOT NULL DEFAULT 'conserje',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.areas_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  nombre     text NOT NULL,
  icono      text NOT NULL DEFAULT '📍',
  orden      int  NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.areas_condominio ENABLE ROW LEVEL SECURITY;
-- La legada que 20260904000100 viene a retirar.
CREATE POLICY "company_rw_areas" ON public.areas_condominio
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE TABLE public.plantillas_tarea_cargo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  cargo         text NOT NULL,
  titulo        text NOT NULL,
  descripcion   text,
  icono         text NOT NULL DEFAULT '✅',
  orden         int  NOT NULL DEFAULT 0,
  area_id       uuid REFERENCES public.areas_condominio(id),
  requiere_foto boolean NOT NULL DEFAULT false,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.plantillas_tarea_cargo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_rw_plantillas_cargo" ON public.plantillas_tarea_cargo
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- Las dos que 20260904000100 necesita para su backfill y su cambio de FK.
CREATE TABLE public.programacion_limpieza (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  area              text NOT NULL,
  frecuencia        text NOT NULL DEFAULT 'semanal',
  responsable       text,
  ultima_ejecucion  date,
  proxima_ejecucion date,
  estado            text NOT NULL DEFAULT 'pendiente',
  activo            boolean NOT NULL DEFAULT true,
  notas             text,
  personal_id       uuid REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  turno             text,
  cargo             text,
  orden             int NOT NULL DEFAULT 0,
  requiere_foto     boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.programacion_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prog_limpieza_rw" ON public.programacion_limpieza
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE TABLE public.ejecuciones_limpieza (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  programacion_id uuid NOT NULL REFERENCES public.programacion_limpieza(id) ON DELETE CASCADE,
  fecha           date NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente',
  foto_urls       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ejecuciones_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ejec_limpieza_rw" ON public.ejecuciones_limpieza
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- plantillas_horario, literal de 20260820000000: ninguna migración de las que
-- aplica el run.sh la crea, y la FK compuesta de rutinas_limpieza la necesita.
CREATE TABLE public.plantillas_horario (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre                 text        NOT NULL,
  codigo                 text,
  turno                  text        NOT NULL DEFAULT 'manana',
  hora_inicio            time        NOT NULL,
  hora_fin               time        NOT NULL,
  cruza_medianoche       boolean     NOT NULL DEFAULT false,
  minutos_descanso       int         NOT NULL DEFAULT 0,
  horas_jornada          numeric(5,2),
  tolerancia_entrada_min int         NOT NULL DEFAULT 10,
  color                  text,
  activo                 boolean     NOT NULL DEFAULT true,
  notas                  text,
  creado_por             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plantillas_horario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plantillas_horario_rw" ON public.plantillas_horario
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- ── Datos base ──────────────────────────────────────────────────────────────
-- Empresa 1 con DOS proyectos (P1, P1B) para separar el aislamiento por
-- proyecto del aislamiento por empresa; empresa 2 con uno (P2).
INSERT INTO public.companies (id) VALUES
  ('c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-0000-0000-00000000000a'),   -- limpieza  (empresa 1)
  ('a0000000-0000-0000-0000-00000000000b'),   -- sin permiso (empresa 1)
  ('a0000000-0000-0000-0000-00000000000c'),   -- limpieza  (empresa 2)
  ('a0000000-0000-0000-0000-00000000000d');   -- owner     (empresa 1)

INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Operador limpieza E1', 'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000b', 'Sin permiso E1',       'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000c', 'Operador limpieza E2', 'c0000000-0000-0000-0000-000000000002', 'operador'),
  ('a0000000-0000-0000-0000-00000000000d', 'Dueña E1',             'c0000000-0000-0000-0000-000000000001', 'company_owner');

-- Rol «Operaciones» con el permiso del tab Limpieza y NADA del módulo Seguridad.
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('40000000-0000-0000-0000-000000000004', 'condominios.tab.prog_limpieza', 'allow');

INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-000000000004');
-- El usuario ...000b queda SIN rol a propósito: es el control negativo.

-- Áreas. La de P1B es homónima de la de P1: sirve para probar que el UNIQUE de
-- rutinas es por proyecto y que la FK compuesta no deja cruzarlas.
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Piscina'),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Lobby'),
  ('e0000000-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000001b', 'Piscina'),
  ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'Piscina');

-- Actividades del catálogo. `cargo` = 'limpieza' para que el backfill de
-- servicio de 20260904000200 las clasifique sin ambigüedad.
INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'limpieza', 'Barrer el borde'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'limpieza', 'Recoger hojas'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'limpieza', 'Revisar cloro'),
  -- MISMA empresa, OTRO proyecto: el caso que una RLS por empresa no distingue.
  ('d0000000-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000001b', 'limpieza', 'Barrer el borde (P1B)'),
  -- Otra empresa.
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'limpieza', 'Barrer el borde (E2)');

-- Jornadas.
INSERT INTO public.plantillas_horario (id, company_id, project_id, nombre, hora_inicio, hora_fin) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Matutina', '06:00', '14:00'),
  ('f0000000-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000001b', 'Matutina P1B', '06:00', '14:00');

-- Una programación histórica cualquiera: 20260904000100 corre su backfill sobre
-- esta tabla y el fixture no debe dejarla vacía (un backfill sobre cero filas
-- no demuestra nada, y aquí solo necesitamos que la migración aplique limpia).
INSERT INTO public.programacion_limpieza (id, company_id, project_id, area) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Piscina');
