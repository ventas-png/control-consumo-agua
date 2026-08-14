-- Fixture mínimo para EJECUTAR las migraciones 20260820000000 … 000300 contra un
-- Postgres de verdad. Reproduce solo lo que esas migraciones tocan: el padrón
-- multi-tenant, los helpers de RLS/trazabilidad y las tres tablas de personal
-- que ya existían en prod (personal_condominio, bloques_turno,
-- presencia_personal), con las columnas que tienen hoy — sin las que añaden las
-- migraciones bajo prueba, que es justamente lo que se quiere verificar.
--
-- `auth.uid()` se emula leyendo un GUC de sesión (`app.uid`), igual que en
-- supabase/tests/trazabilidad/fixture.sql: es lo que hace Supabase por debajo
-- con el claim del JWT, y permite "cambiar de usuario" con SET.

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

-- ── Helpers de identidad que las policies y las RPC invocan ─────────────────
-- SECURITY DEFINER como en prod (20260518000008): si no, el rol del test —que
-- no es dueño de nada— no puede leer `auth` ni `app_users` desde dentro de una
-- policy, y la RLS devolvería 0 filas por falta de permisos en vez de por la
-- regla que se quiere probar. El test diría "aislado" cuando en realidad está
-- roto.
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

-- Versión reducida de la real (20260518000008): auto-concede a los roles de
-- empresa y, para el resto, mira el catálogo. Suficiente para lo que las
-- migraciones bajo prueba consultan.
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

CREATE OR REPLACE FUNCTION public.assert_company_scope(p_company_id uuid) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF NOT (public.is_super_admin() OR p_company_id = public.get_my_company_id()) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ── Trazabilidad y bitácora (copia literal de 20260731000000/000100) ────────
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

-- La bitácora real resuelve company/project y escribe en bitacora_acciones; aquí
-- basta con que exista y no reviente, porque lo que se prueba es el turno, no
-- el log. Se conserva el registro para poder afirmar que la regla deja rastro.
CREATE TABLE public.bitacora_acciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid,
  project_id     uuid,
  usuario_id     uuid,
  usuario_nombre text,
  accion         text NOT NULL,
  modulo         text NOT NULL,
  entidad_id     uuid,
  entidad_desc   text,
  detalles       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.registrar_bitacora()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row  jsonb := to_jsonb(COALESCE(NEW, OLD));
  v_cols text[] := string_to_array(COALESCE(TG_ARGV[1], ''), ',');
  v_desc text;
  v_col  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  FOREACH v_col IN ARRAY v_cols LOOP
    v_desc := COALESCE(v_desc, v_row->>btrim(v_col));
  END LOOP;
  INSERT INTO public.bitacora_acciones (
    company_id, project_id, usuario_id, usuario_nombre, accion, modulo,
    entidad_id, entidad_desc
  ) VALUES (
    (v_row->>'company_id')::uuid, (v_row->>'project_id')::uuid, auth.uid(),
    (SELECT full_name FROM public.app_users WHERE id = auth.uid()),
    lower(TG_OP), TG_ARGV[0], (v_row->>'id')::uuid, v_desc
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Tablas de personal TAL COMO ESTÁN EN PROD hoy ──────────────────────────
-- personal_condominio: 20260420000004:144 (+ campos de 20260520000001, que no
-- intervienen aquí).
CREATE TABLE public.personal_condominio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre        text NOT NULL,
  cargo         text NOT NULL DEFAULT 'conserje',
  telefono      text,
  fecha_ingreso date,
  turno         text NOT NULL DEFAULT 'diurno',
  estado        text NOT NULL DEFAULT 'activo',
  salario       numeric(12,2),
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- bloques_turno: 20260424000060:18. SIN las columnas de horas — las añade la
-- migración bajo prueba.
CREATE TABLE public.bloques_turno (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id),
  project_id          uuid NOT NULL REFERENCES public.projects(id),
  personal_id         uuid NOT NULL REFERENCES public.personal_condominio(id),
  turno               text NOT NULL DEFAULT 'manana',
  fecha               date NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente',
  iniciado_en         timestamptz,
  cerrado_en          timestamptz,
  puntaje_completitud int,
  creado_por          uuid REFERENCES public.app_users(id),
  notas               text,
  created_at          timestamptz DEFAULT now()
);
ALTER TABLE public.bloques_turno ENABLE ROW LEVEL SECURITY;
-- La policy permisiva original, la que la migración viene a reemplazar.
CREATE POLICY "company_rw_bloques_turno" ON public.bloques_turno
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- presencia_personal: 20260420000020:85. SIN personal_id ni bloque_id.
CREATE TABLE public.presencia_personal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre        text NOT NULL,
  cargo         text,
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada  time,
  hora_salida   time,
  estado        text NOT NULL DEFAULT 'presente',
  observaciones text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Datos base ─────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002');   -- empresa vecina (aislamiento)

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-00000000000a'),   -- admin del condominio
  ('e0000000-0000-0000-0000-00000000000b'),   -- guardia con rol RBAC acotado
  ('e0000000-0000-0000-0000-00000000000c');   -- admin de la empresa vecina

INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'Ana Administradora', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('e0000000-0000-0000-0000-00000000000b', 'Beto Guardia',       'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000c', 'Caro Vecina',        'aaaaaaaa-0000-0000-0000-000000000002', 'admin');

-- Empleados del condominio 1.
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo, turno) VALUES
  ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Pedro Guardia',   'guardia',  'nocturno'),
  ('50000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Lucía Conserje',  'conserje', 'diurno'),
  ('50000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Mario Jardinero', 'jardinero','diurno');

-- Marcaje histórico SIN personal_id: alimenta el backfill por nombre.
-- "Pedro Guardia" casa exacto; "Empleado Externo" no está en plantilla y debe
-- quedarse en NULL.
INSERT INTO public.presencia_personal (company_id, project_id, nombre, cargo, fecha, hora_entrada, hora_salida, estado) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Pedro Guardia',    'guardia', DATE '2026-07-01', TIME '22:00', TIME '06:00', 'presente'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '  pedro guardia ', 'guardia', DATE '2026-07-02', TIME '22:00', TIME '06:00', 'presente'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Empleado Externo', NULL,      DATE '2026-07-01', TIME '08:00', TIME '12:00', 'presente');
