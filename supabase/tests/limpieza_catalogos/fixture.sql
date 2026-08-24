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

-- ── Tablas del módulo TAL COMO ESTÁN EN PROD hoy ────────────────────────────

-- personal_condominio: solo lo que programacion_limpieza referencia.
CREATE TABLE public.personal_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  cargo      text NOT NULL DEFAULT 'conserje',
  turno      text NOT NULL DEFAULT 'diurno',
  estado     text NOT NULL DEFAULT 'activo',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- areas_condominio: 20260424000059, con la policy legacy `company_rw_areas`
-- QUE SIGUE VIVA en prod y las cuatro RBAC de 20260519000002 (escritura gateada
-- por checklist_areas). La migración bajo prueba retira la legacy y ensancha
-- la escritura.
CREATE TABLE public.areas_condominio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id),
  project_id  uuid NOT NULL REFERENCES public.projects(id),
  nombre      text NOT NULL,
  descripcion text,
  icono       text NOT NULL DEFAULT '📍',
  orden       int  NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE public.areas_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_rw_areas" ON public.areas_condominio
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());
CREATE POLICY "areas_condominio_select" ON public.areas_condominio
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR company_id = public.get_my_company_id());
CREATE POLICY "areas_condominio_insert" ON public.areas_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.checklist_areas'))
  );
CREATE POLICY "areas_condominio_update" ON public.areas_condominio
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.checklist_areas'))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.checklist_areas'))
  );
CREATE POLICY "areas_condominio_delete" ON public.areas_condominio
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

-- plantillas_tarea_cargo: 20260424000060, con su legacy viva y las RBAC de
-- 20260519000002. SIN las columnas que añade 20260904000100 — eso es lo que se
-- prueba.
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
CREATE POLICY "plantillas_tarea_cargo_select" ON public.plantillas_tarea_cargo
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.plantillas_cargo'))
  );
CREATE POLICY "plantillas_tarea_cargo_insert" ON public.plantillas_tarea_cargo
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.plantillas_cargo'))
  );
CREATE POLICY "plantillas_tarea_cargo_update" ON public.plantillas_tarea_cargo
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.plantillas_cargo'))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.plantillas_cargo'))
  );
CREATE POLICY "plantillas_tarea_cargo_delete" ON public.plantillas_tarea_cargo
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

-- programacion_limpieza: 20260420000019 + 20260807130000. `area` texto libre,
-- SIN area_id — lo añade la migración bajo prueba.
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

-- ejecuciones_limpieza: 20260807130000, CON la FK CASCADE original — la
-- migración bajo prueba la convierte en RESTRICT — y CON sus policies de
-- origen (delete por owner/admin, que la migración reduce a super_admin).
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
CREATE POLICY "ejecuciones_limpieza_select" ON public.ejecuciones_limpieza
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  );
CREATE POLICY "ejecuciones_limpieza_insert" ON public.ejecuciones_limpieza
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  );
CREATE POLICY "ejecuciones_limpieza_update" ON public.ejecuciones_limpieza
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.prog_limpieza'))
  );
CREATE POLICY "ejecuciones_limpieza_delete" ON public.ejecuciones_limpieza
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

-- suministros_condominio (20260420000021) e inventario_condominio
-- (20260420000004): lo que las tablas puente y su trigger consultan.
CREATE TABLE public.suministros_condominio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre        text NOT NULL,
  unidad_medida text NOT NULL DEFAULT 'unidad',
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.inventario_condominio (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre        text NOT NULL,
  estado        text NOT NULL DEFAULT 'disponible',
  cantidad      int  NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Datos base ──────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000002');   -- empresa vecina (aislamiento)

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001'),  -- 2º proyecto de A (cross-proyecto)
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-00000000000a'),   -- admin de A
  ('e0000000-0000-0000-0000-00000000000b'),   -- operador de A: solo rutas_ronda
  ('e0000000-0000-0000-0000-00000000000d'),   -- operador de A: solo plantillas_cargo
  ('e0000000-0000-0000-0000-00000000000e'),   -- operador de A: sin permisos
  ('e0000000-0000-0000-0000-00000000000f'),   -- operador de A: rutas_ronda + areas.manage
  ('e0000000-0000-0000-0000-000000000010'),   -- operador de A: solo prog_limpieza
  ('e0000000-0000-0000-0000-00000000000c');   -- admin de la empresa vecina

INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'Ana Administradora', 'aaaaaaaa-0000-0000-0000-000000000001', 'admin'),
  ('e0000000-0000-0000-0000-00000000000b', 'Beto Rondas',        'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000d', 'Diana Plantillas',   'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000e', 'Elio Sin Permisos',  'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000f', 'Gina Gestora Areas', 'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-000000000010', 'Hugo Limpieza',      'aaaaaaaa-0000-0000-0000-000000000001', 'operator'),
  ('e0000000-0000-0000-0000-00000000000c', 'Caro Vecina',        'aaaaaaaa-0000-0000-0000-000000000002', 'admin');

-- Roles RBAC acotados. El de Gina simula lo que la migración concede a los
-- roles de sistema Seguridad/Operaciones: el permiso específico del catálogo.
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'condominios.tab.rutas_ronda',      'allow'),
  ('cccccccc-0000-0000-0000-000000000002', 'condominios.tab.plantillas_cargo', 'allow'),
  ('cccccccc-0000-0000-0000-000000000003', 'condominios.tab.rutas_ronda',      'allow'),
  ('cccccccc-0000-0000-0000-000000000003', 'condominios.areas.manage',         'allow'),
  ('cccccccc-0000-0000-0000-000000000004', 'condominios.tab.prog_limpieza',    'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('e0000000-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000d', 'cccccccc-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-00000000000f', 'cccccccc-0000-0000-0000-000000000003'),
  ('e0000000-0000-0000-0000-000000000010', 'cccccccc-0000-0000-0000-000000000004');

-- Catálogo de áreas ANTES del backfill.
--   P1 de A: 'Piscina' (match único), 'Jardín' (match único con acento),
--            'Lobby' + ' lobby ' (AMBIGUAS: mismo nombre normalizado).
--   P2 de B: su propia 'Piscina' (el backfill debe vincular DENTRO del tenant).
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Piscina'),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Jardín'),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Lobby'),
  ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', ' lobby '),
  ('a0000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Piscina');

-- Programaciones de limpieza legadas (area = texto libre).
INSERT INTO public.programacion_limpieza (id, company_id, project_id, area) VALUES
  -- match único con espacios/mayúsculas:
  ('b0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '  PISCINA '),
  -- match único con acento (jardin → Jardín):
  ('b0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'jardin'),
  -- match único con acento EN MAYÚSCULA (JARDÍN → Jardín): con lc_ctype=C,
  -- lower() no minusculiza la Í; el mapa de translate debe cubrirla.
  ('b0000000-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'JARDÍN'),
  -- ambigua (dos áreas normalizan a lobby):
  ('b0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Lobby'),
  -- inexistente, dos variantes del mismo nombre → UNA sola área nueva:
  ('b0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Terraza BBQ'),
  ('b0000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', ' terraza bbq'),
  -- en blanco → se salta, no crea área:
  ('b0000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '   '),
  -- la vecina: debe vincular a SU Piscina, no a la de A:
  ('b0000000-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', ' piscina');

-- Historial: la programación de la Piscina de A tiene UNA ejecución con foto.
-- Tras la migración, borrarla debe FALLAR (RESTRICT). La de 'jardin' queda sin
-- historial: borrarla debe seguir siendo posible.
INSERT INTO public.ejecuciones_limpieza (id, company_id, project_id, programacion_id, fecha, estado, foto_urls) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', DATE '2026-08-01', 'completada', '["p1/limpieza/foto1.jpg"]'::jsonb);

-- Plantillas legadas: cargos inequívocos (backfill de servicio) y uno ambiguo.
INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Limpieza',    'Limpiar lobby'),
  ('d0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Jardinería',  'Podar setos'),
  ('d0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Polivalente', 'Apoyo general'),
  ('d0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Limpieza',    'Plantilla de la vecina');

-- Recursos: S1/H1 en P1 de A (válidos), S3 en el 2º proyecto de A
-- (cross-proyecto, misma empresa), S2/H2 en la vecina (cross-empresa).
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Cloro',       'litro'),
  ('f0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003', 'Desengrasante', 'litro'),
  ('f0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Cloro vecino', 'litro');
INSERT INTO public.inventario_condominio (id, company_id, project_id, nombre) VALUES
  ('f1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Hidrolavadora'),
  ('f1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'Hidrolavadora vecina');
