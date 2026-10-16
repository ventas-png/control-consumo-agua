-- Fixture adicional de rrhh_catalogos: lo que 20261031000300 necesita y los fixtures de
-- housekeeping (evidencias + RBAC real) y plantillas_importacion no traen. Todo son COPIAS
-- de las definiciones vigentes de las migraciones indicadas.
--
-- · `permissions` (20260518000004): PK por clave; `role_permissions.permission_key` con FK
--   (la que impediría sembrar un grant para una clave que no existe).
-- · `touch_updated_at()` (20260528000030).
-- · `personal_condominio` (20260420000004) con sus policies VIGENTES (nadie las redefinió:
--   lectura por empresa, escritura por company_owner/admin) y SIN validación de cargo/turno.
-- · `programacion_limpieza` (20260420000019 + 20260807130000) CON los dos CHECK literales
--   y `ejecuciones_limpieza` (20260807130000) CON su CHECK literal: la migración bajo prueba
--   los retira DESPUÉS de instalar los triggers.
-- · El rol Administrador General con el id fijo de 20260518000006 (destino del grant).

CREATE TABLE public.permissions (
  key         text PRIMARY KEY,
  category    text NOT NULL,
  label       text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_permission_key_fkey
  FOREIGN KEY (permission_key) REFERENCES public.permissions(key) ON DELETE CASCADE;
-- Claves que las policies de los fixtures y los roles de datos.sql referencian.
INSERT INTO public.permissions (key, category, label) VALUES
  ('condominios.tab.housekeeping',            'especiales',        'Housekeeping'),
  ('condominios.tab.plantillas_cargo',        'recursos_humanos',  'Actividades'),
  ('condominios.tab.plantillas_cargo.create', 'recursos_humanos',  'Crear — Actividades'),
  ('condominios.tab.plantillas_cargo.edit',   'recursos_humanos',  'Editar — Actividades'),
  ('condominios.tab.suministros',             'operaciones',       'Suministros'),
  ('condominios.tab.inventario',              'operaciones',       'Inventario'),
  ('condominios.tab.prog_limpieza',           'recursos_humanos',  'Programación de limpieza'),
  ('condominios.tab.personal',                'recursos_humanos',  'Personal'),
  ('condominios.tab.personal.create',         'recursos_humanos',  'Crear — Personal'),
  ('condominios.tab.personal.edit',           'recursos_humanos',  'Editar — Personal'),
  ('condominios.tab.personal.change_status',  'recursos_humanos',  'Cambiar estado — Personal'),
  ('condominios.tab.personal.approve',        'recursos_humanos',  'Autorizar / Denegar — Personal'),
  ('condominios.tab.personal.delete',         'recursos_humanos',  'Eliminar — Personal');
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.permissions TO anon, authenticated, service_role;

INSERT INTO public.roles (id, company_id, name, is_system) VALUES
  ('00000000-0000-0000-0000-000000000001', NULL, 'Administrador General', true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── personal_condominio (20260420000004; user_id de 20260826000000; ancla de 20260916171325) ──
CREATE TABLE public.personal_condominio (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre         text        NOT NULL,
  cargo          text        NOT NULL DEFAULT 'conserje',
  telefono       text,
  email          text,
  fecha_ingreso  date,
  turno          text        NOT NULL DEFAULT 'diurno',
  estado         text        NOT NULL DEFAULT 'activo',
  salario        numeric(12,2),
  dpi            text,
  foto_url       text,
  notas          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  user_id        uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT personal_condominio_id_tenant_uq UNIQUE (id, company_id, project_id)
);
ALTER TABLE public.personal_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_select" ON public.personal_condominio
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "personal_insert" ON public.personal_condominio
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "personal_update" ON public.personal_condominio
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "personal_delete" ON public.personal_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX idx_personal_project ON public.personal_condominio(project_id);
CREATE INDEX idx_personal_cargo   ON public.personal_condominio(cargo);

-- ── programacion_limpieza (20260420000019 + 20260807130000, CON los CHECK) ──
CREATE TABLE public.programacion_limpieza (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  area              text NOT NULL,
  area_id           uuid REFERENCES public.areas_condominio(id) ON DELETE RESTRICT,
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
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prog_limpieza_turno_check
    CHECK (turno IS NULL OR turno IN ('diurno', 'nocturno', 'rotativo')),
  CONSTRAINT prog_limpieza_cargo_check
    CHECK (cargo IS NULL OR cargo IN ('conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'))
);
ALTER TABLE public.programacion_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "programacion_limpieza_select" ON public.programacion_limpieza FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')));
CREATE POLICY "programacion_limpieza_insert" ON public.programacion_limpieza FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')));
CREATE POLICY "programacion_limpieza_update" ON public.programacion_limpieza FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')))
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')));
CREATE POLICY "programacion_limpieza_delete" ON public.programacion_limpieza FOR DELETE TO authenticated
  USING (public.is_super_admin() OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin']) AND company_id = public.get_my_company_id()));

-- ── ejecuciones_limpieza (20260807130000, CON el CHECK del turno) ──
CREATE TABLE public.ejecuciones_limpieza (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  programacion_id        uuid        NOT NULL REFERENCES public.programacion_limpieza(id) ON DELETE RESTRICT,
  personal_id            uuid        REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  fecha                  date        NOT NULL,
  turno                  text,
  orden                  int         NOT NULL DEFAULT 0,
  estado                 text        NOT NULL DEFAULT 'pendiente',
  completada_en          timestamptz,
  foto_urls              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  observacion            text,
  novedad                text,
  requiere_mantenimiento boolean     NOT NULL DEFAULT false,
  prioridad              text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ejec_limpieza_estado_check
    CHECK (estado IN ('pendiente', 'completada', 'con_novedad', 'omitida')),
  CONSTRAINT ejec_limpieza_prioridad_check
    CHECK (prioridad IS NULL OR prioridad IN ('baja', 'media', 'alta')),
  CONSTRAINT ejec_limpieza_turno_check
    CHECK (turno IS NULL OR turno IN ('diurno', 'nocturno', 'rotativo'))
);
ALTER TABLE public.ejecuciones_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ejecuciones_limpieza_select" ON public.ejecuciones_limpieza FOR SELECT TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')));
CREATE POLICY "ejecuciones_limpieza_insert" ON public.ejecuciones_limpieza FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')));
CREATE POLICY "ejecuciones_limpieza_update" ON public.ejecuciones_limpieza FOR UPDATE TO authenticated
  USING (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')))
  WITH CHECK (public.is_super_admin() OR (company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.prog_limpieza')));

GRANT ALL ON public.personal_condominio, public.programacion_limpieza, public.ejecuciones_limpieza TO authenticated, service_role;
