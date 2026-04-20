-- Condominios Fase 6
-- Tablas: bodegas_condominio, onboarding_residentes, propuestas_inversion, memoria_labores

-- ── bodegas_condominio ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bodegas_condominio (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  numero           text        NOT NULL,
  piso             text,
  area_m2          numeric(8,2),
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  estado           text        NOT NULL DEFAULT 'disponible',
  -- estado: 'disponible' | 'asignada' | 'bloqueada'
  monto_renta      numeric(10,2),
  fecha_asignacion date,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bodegas_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bodegas_select" ON public.bodegas_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bodegas_insert" ON public.bodegas_condominio
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bodegas_update" ON public.bodegas_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bodegas_delete" ON public.bodegas_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_bodegas_project ON public.bodegas_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_bodegas_unidad  ON public.bodegas_condominio(unidad_id);
CREATE INDEX IF NOT EXISTS idx_bodegas_estado  ON public.bodegas_condominio(estado);

-- ── onboarding_residentes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_residentes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id            uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  nombre_residente     text        NOT NULL,
  fecha_ingreso        date        NOT NULL,
  tipo                 text        NOT NULL DEFAULT 'propietario',
  -- tipo: 'propietario' | 'arrendatario'
  estado               text        NOT NULL DEFAULT 'en_proceso',
  -- estado: 'en_proceso' | 'completado' | 'cancelado'
  llaves_entregadas    boolean     NOT NULL DEFAULT false,
  reglamento_firmado   boolean     NOT NULL DEFAULT false,
  deposito_pagado      boolean     NOT NULL DEFAULT false,
  datos_registrados    boolean     NOT NULL DEFAULT false,
  accesos_configurados boolean     NOT NULL DEFAULT false,
  inspeccion_unidad    boolean     NOT NULL DEFAULT false,
  bienvenida_enviada   boolean     NOT NULL DEFAULT false,
  notas                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_residentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "onboarding_select" ON public.onboarding_residentes
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "onboarding_insert" ON public.onboarding_residentes
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "onboarding_update" ON public.onboarding_residentes
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "onboarding_delete" ON public.onboarding_residentes
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_onboarding_project ON public.onboarding_residentes(project_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_unidad  ON public.onboarding_residentes(unidad_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_estado  ON public.onboarding_residentes(estado);

-- ── propuestas_inversion ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.propuestas_inversion (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo           text        NOT NULL,
  descripcion      text,
  categoria        text        NOT NULL DEFAULT 'mejora',
  -- categoria: 'mejora' | 'reparacion' | 'expansion' | 'tecnologia' | 'seguridad' | 'otro'
  monto_estimado   numeric(14,2),
  prioridad        text        NOT NULL DEFAULT 'media',
  -- prioridad: 'baja' | 'media' | 'alta'
  estado           text        NOT NULL DEFAULT 'propuesta',
  -- estado: 'propuesta' | 'en_evaluacion' | 'aprobada' | 'rechazada' | 'en_ejecucion' | 'completada'
  votos_favor      int         NOT NULL DEFAULT 0,
  votos_contra     int         NOT NULL DEFAULT 0,
  fecha_propuesta  date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_aprobacion date,
  fecha_ejecucion  date,
  propuesto_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.propuestas_inversion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "propuestas_select" ON public.propuestas_inversion
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "propuestas_insert" ON public.propuestas_inversion
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "propuestas_update" ON public.propuestas_inversion
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "propuestas_delete" ON public.propuestas_inversion
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_propuestas_project  ON public.propuestas_inversion(project_id);
CREATE INDEX IF NOT EXISTS idx_propuestas_estado   ON public.propuestas_inversion(estado);
CREATE INDEX IF NOT EXISTS idx_propuestas_prioridad ON public.propuestas_inversion(prioridad);

-- ── memoria_labores ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.memoria_labores (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id              uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo                  text        NOT NULL,
  periodo                 text        NOT NULL,
  tipo_periodo            text        NOT NULL DEFAULT 'mensual',
  -- tipo_periodo: 'mensual' | 'trimestral' | 'anual'
  resumen                 text,
  logros                  text,
  pendientes              text,
  tickets_resueltos       int,
  visitantes_registrados  int,
  cuotas_cobradas         int,
  incidencias_atendidas   int,
  estado                  text        NOT NULL DEFAULT 'borrador',
  -- estado: 'borrador' | 'publicado'
  publicado_por           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.memoria_labores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memoria_select" ON public.memoria_labores
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "memoria_insert" ON public.memoria_labores
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "memoria_update" ON public.memoria_labores
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "memoria_delete" ON public.memoria_labores
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_memoria_project ON public.memoria_labores(project_id);
CREATE INDEX IF NOT EXISTS idx_memoria_periodo  ON public.memoria_labores(periodo DESC);
