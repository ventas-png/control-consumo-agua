-- Condominios Fase 10
-- Tablas: eventos_calendario, configuracion_condominio

-- ── eventos_calendario ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eventos_calendario (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo       text        NOT NULL,
  descripcion  text,
  tipo         text        NOT NULL DEFAULT 'evento',
  -- 'evento' | 'mantenimiento' | 'asamblea' | 'vencimiento' | 'recordatorio'
  fecha_inicio date        NOT NULL,
  hora_inicio  time,
  fecha_fin    date,
  hora_fin     time,
  recurrente   boolean     NOT NULL DEFAULT false,
  frecuencia   text,
  -- 'diario' | 'semanal' | 'mensual' | 'anual'
  color        text        NOT NULL DEFAULT '#0ea5e9',
  todo_el_dia  boolean     NOT NULL DEFAULT true,
  created_by   uuid        REFERENCES public.app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.eventos_calendario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eventos_cal_select" ON public.eventos_calendario
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eventos_cal_insert" ON public.eventos_calendario
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eventos_cal_update" ON public.eventos_calendario
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eventos_cal_delete" ON public.eventos_calendario
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_eventos_cal_project ON public.eventos_calendario(project_id);
CREATE INDEX IF NOT EXISTS idx_eventos_cal_fecha   ON public.eventos_calendario(fecha_inicio);

-- ── configuracion_condominio ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.configuracion_condominio (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  clave       text        NOT NULL,
  valor       text,
  tipo        text        NOT NULL DEFAULT 'texto',
  -- 'texto' | 'numero' | 'booleano' | 'json' | 'texto_largo'
  descripcion text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, clave)
);

ALTER TABLE public.configuracion_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_select" ON public.configuracion_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "config_insert" ON public.configuracion_condominio
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "config_update" ON public.configuracion_condominio
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "config_delete" ON public.configuracion_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_config_project ON public.configuracion_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_config_clave   ON public.configuracion_condominio(clave);
