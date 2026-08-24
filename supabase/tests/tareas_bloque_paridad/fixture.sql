-- Fixture mínimo para EJECUTAR las migraciones 20260904000000 · 000100 · 000200
-- contra un Postgres de verdad. Reproduce el estado ANTERIOR a la serie: el
-- padrón multi-tenant, los helpers de RLS/trazabilidad, y las tablas del módulo
-- tal como están en prod hoy — incluidas las policies legacy `company_rw_*` que
-- la serie viene a retirar y la FK CASCADE de ejecuciones_limpieza que viene a
-- corregir. Los datos semilla montan los tres escenarios del backfill de áreas
-- (única / inexistente / ambigua) en dos empresas.
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

-- Versión reducida de la real: auto-concede a los roles de empresa y, para el
-- resto, mira el catálogo.
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


-- ── Tablas del módulo de turnos TAL COMO ESTÁN EN PROD hoy ──────────────────

CREATE TABLE public.personal_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  cargo      text NOT NULL DEFAULT 'conserje',
  estado     text NOT NULL DEFAULT 'activo',
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

CREATE TABLE public.plantillas_tarea_cargo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  cargo         text NOT NULL,
  titulo        text NOT NULL,
  descripcion   text,
  area_id       uuid REFERENCES public.areas_condominio(id),
  orden         int  NOT NULL DEFAULT 0,
  requiere_foto boolean NOT NULL DEFAULT false,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);

-- bloques_turno: 20260424000060 + las columnas de 20260820000000, con sus
-- policies vigentes (la legada company_rw_bloques_turno SÍ se dropeó allí).
CREATE TABLE public.bloques_turno (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  personal_id uuid NOT NULL REFERENCES public.personal_condominio(id),
  turno       text NOT NULL DEFAULT 'manana',
  fecha       date NOT NULL,
  estado      text NOT NULL DEFAULT 'pendiente',
  origen      text NOT NULL DEFAULT 'manual',
  creado_por  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.bloques_turno ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bloques_turno_select" ON public.bloques_turno
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

-- tareas_bloque TAL CUAL 20260424000060: sin CHECK de estado, sin unicidad,
-- SIN completado_por (el typo de 20260731000000 impidió crearla), y CON la
-- policy legada company_rw_tareas_bloque viva junto a las RBAC gateadas por
-- panel_turno — que es justo lo que esta migración viene a corregir.
CREATE TABLE public.tareas_bloque (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id       uuid NOT NULL REFERENCES public.bloques_turno(id) ON DELETE CASCADE,
  plantilla_id    uuid REFERENCES public.plantillas_tarea_cargo(id),
  titulo          text NOT NULL,
  descripcion     text,
  area_id         uuid REFERENCES public.areas_condominio(id),
  orden           int  NOT NULL DEFAULT 0,
  requiere_foto   boolean NOT NULL DEFAULT false,
  estado          text NOT NULL DEFAULT 'pendiente',
  completada_en   timestamptz,
  evidencia_texto text,
  foto_urls       jsonb NOT NULL DEFAULT '[]',
  notas_operativo text,
  creado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE public.tareas_bloque ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_rw_tareas_bloque" ON public.tareas_bloque
  USING (EXISTS (SELECT 1 FROM public.bloques_turno b WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bloques_turno b WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()));
CREATE POLICY "tareas_bloque_select" ON public.tareas_bloque
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  );
CREATE POLICY "tareas_bloque_insert" ON public.tareas_bloque
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  );
CREATE POLICY "tareas_bloque_update" ON public.tareas_bloque
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.panel_turno')
    )
  );
CREATE POLICY "tareas_bloque_delete" ON public.tareas_bloque
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin() OR EXISTS (
      SELECT 1 FROM public.bloques_turno b
      WHERE b.id = tareas_bloque.bloque_id
        AND b.company_id = public.get_my_company_id()
        AND public.current_user_role() IN ('company_owner','admin')
    )
  );

-- revisiones_tarea: SOLO la policy legada, sin RBAC (20260424000060:82-84).
CREATE TABLE public.revisiones_tarea (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id     uuid NOT NULL REFERENCES public.tareas_bloque(id) ON DELETE CASCADE,
  bloque_id    uuid NOT NULL REFERENCES public.bloques_turno(id),
  revisado_por uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  estado       text NOT NULL DEFAULT 'pendiente',
  comentario   text,
  revisado_en  timestamptz DEFAULT now(),
  created_at   timestamptz DEFAULT now()
);
ALTER TABLE public.revisiones_tarea ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_rw_revisiones_tarea" ON public.revisiones_tarea
  USING (EXISTS (SELECT 1 FROM public.bloques_turno b WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bloques_turno b WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()));

-- ── Datos base ──────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002');
INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-00000000000a'),   -- admin de A
  ('e0000000-0000-0000-0000-00000000000b'),   -- operador: solo tareas_personal
  ('e0000000-0000-0000-0000-00000000000c'),   -- admin de la empresa vecina
  ('e0000000-0000-0000-0000-00000000000d'),   -- operador: solo prog_limpieza
  ('e0000000-0000-0000-0000-00000000000e');   -- operador: sin permisos

INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'Ana Administradora', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('e0000000-0000-0000-0000-00000000000b', 'Beto Turnos',        'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000c', 'Caro Vecina',        'aaaaaaaa-0000-0000-0000-000000000002', 'admin'),
  ('e0000000-0000-0000-0000-00000000000d', 'Hugo Limpieza',      'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000e', 'Elio Sin Permisos',  'aaaaaaaa-0000-0000-0000-000000000001', 'operator');

INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'condominios.tab.tareas_personal', 'allow'),
  ('cccccccc-0000-0000-0000-000000000002', 'condominios.tab.prog_limpieza',   'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('e0000000-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000d', 'cccccccc-0000-0000-0000-000000000002');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('50000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Lucía Conserje');

INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'conserje', 'Limpiar lobby');

INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, fecha) VALUES
  ('e3000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', DATE '2026-08-01');
-- Bloque de la empresa vecina (aislamiento).
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('50000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000002', 'Vecino Conserje');
INSERT INTO public.bloques_turno (id, company_id, project_id, personal_id, fecha) VALUES
  ('e3000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', DATE '2026-08-01');

-- Una tarea desde plantilla (para probar el UNIQUE) y una CERRADA (para probar
-- que el DELETE ya no la alcanza).
INSERT INTO public.tareas_bloque (id, bloque_id, plantilla_id, titulo, estado) VALUES
  ('e4000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001', 'Limpiar lobby', 'pendiente');
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, estado, completada_en) VALUES
  ('e4000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001',
   'Tarea ya cerrada', 'completada', '2026-08-01T10:00:00Z');
INSERT INTO public.tareas_bloque (id, bloque_id, titulo) VALUES
  ('e4000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000002', 'Tarea de la vecina');
