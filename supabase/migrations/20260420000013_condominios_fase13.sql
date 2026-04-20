-- Condominios Fase 13
-- Tablas: votaciones, votos, sanciones_condominio, planes_mantenimiento, ejecuciones_mantenimiento

-- ── votaciones ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.votaciones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  asamblea_id     uuid        REFERENCES public.asambleas(id) ON DELETE SET NULL,
  titulo          text        NOT NULL,
  descripcion     text,
  tipo            text        NOT NULL DEFAULT 'simple',
  -- 'simple' | 'multiple' | 'ponderada'
  opciones        jsonb       NOT NULL DEFAULT '[]',
  -- [{id: text, texto: text}]
  estado          text        NOT NULL DEFAULT 'abierta',
  -- 'abierta' | 'cerrada' | 'anulada'
  quorum_requerido int,
  total_unidades  int,
  fecha_inicio    timestamptz NOT NULL DEFAULT now(),
  fecha_cierre    timestamptz,
  resultado       text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.votaciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "votaciones_select" ON public.votaciones
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "votaciones_insert" ON public.votaciones
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "votaciones_update" ON public.votaciones
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "votaciones_delete" ON public.votaciones
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_votaciones_project ON public.votaciones(project_id);

-- ── votos ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.votos (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  votacion_id   uuid        NOT NULL REFERENCES public.votaciones(id) ON DELETE CASCADE,
  unidad_id     uuid        NOT NULL REFERENCES public.unidades(id)   ON DELETE CASCADE,
  opcion_id     text        NOT NULL,
  comentario    text,
  registrado_por text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (votacion_id, unidad_id)
);

ALTER TABLE public.votos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "votos_select" ON public.votos
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "votos_insert" ON public.votos
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "votos_delete" ON public.votos
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_votos_votacion ON public.votos(votacion_id);

-- ── sanciones_condominio ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sanciones_condominio (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  infraccion_id    uuid        REFERENCES public.infracciones_condominio(id) ON DELETE SET NULL,
  concepto         text        NOT NULL,
  monto            numeric(12,2) NOT NULL DEFAULT 0,
  fecha_emision    date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento date,
  estado           text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'pagado' | 'anulado' | 'apelado'
  observaciones    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sanciones_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sanciones_select" ON public.sanciones_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "sanciones_insert" ON public.sanciones_condominio
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "sanciones_update" ON public.sanciones_condominio
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "sanciones_delete" ON public.sanciones_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_sanciones_project  ON public.sanciones_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_sanciones_unidad   ON public.sanciones_condominio(unidad_id);

-- ── planes_mantenimiento ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.planes_mantenimiento (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  equipo           text        NOT NULL,
  descripcion      text,
  frecuencia       text        NOT NULL DEFAULT 'mensual',
  -- 'semanal' | 'quincenal' | 'mensual' | 'trimestral' | 'semestral' | 'anual'
  responsable      text,
  ultima_ejecucion date,
  proxima_ejecucion date,
  costo_estimado   numeric(10,2),
  activo           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.planes_mantenimiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planes_select" ON public.planes_mantenimiento
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "planes_insert" ON public.planes_mantenimiento
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "planes_update" ON public.planes_mantenimiento
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "planes_delete" ON public.planes_mantenimiento
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_planes_project ON public.planes_mantenimiento(project_id);

-- ── ejecuciones_mantenimiento ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ejecuciones_mantenimiento (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_id       uuid        NOT NULL REFERENCES public.planes_mantenimiento(id) ON DELETE CASCADE,
  fecha         date        NOT NULL,
  realizado_por text,
  costo_real    numeric(10,2),
  observaciones text,
  estado        text        NOT NULL DEFAULT 'completado',
  -- 'completado' | 'parcial' | 'omitido'
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ejecuciones_mantenimiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ejecuciones_select" ON public.ejecuciones_mantenimiento
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ejecuciones_insert" ON public.ejecuciones_mantenimiento
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "ejecuciones_delete" ON public.ejecuciones_mantenimiento
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_ejecuciones_plan ON public.ejecuciones_mantenimiento(plan_id);
