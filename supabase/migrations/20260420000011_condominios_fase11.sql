-- Condominios Fase 11
-- Tablas: solicitudes_residente, junta_directiva, prestamos_equipo, comunicados_condominio

-- ── solicitudes_residente ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.solicitudes_residente (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id    uuid        REFERENCES public.unidades(id),
  tipo         text        NOT NULL DEFAULT 'otro',
  -- 'solvencia' | 'permiso_mudanza' | 'permiso_obra' | 'reclamo' | 'sugerencia' | 'certificado' | 'otro'
  descripcion  text        NOT NULL,
  estado       text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado'
  respuesta    text,
  prioridad    text        NOT NULL DEFAULT 'normal',
  -- 'baja' | 'normal' | 'alta' | 'urgente'
  atendido_por text,
  fecha_limite date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitudes_residente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "solicitudes_select" ON public.solicitudes_residente
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "solicitudes_insert" ON public.solicitudes_residente
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "solicitudes_update" ON public.solicitudes_residente
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "solicitudes_delete" ON public.solicitudes_residente
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_solicitudes_project ON public.solicitudes_residente(project_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado  ON public.solicitudes_residente(estado);
CREATE INDEX IF NOT EXISTS idx_solicitudes_unidad  ON public.solicitudes_residente(unidad_id);

-- ── junta_directiva ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.junta_directiva (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  cargo           text        NOT NULL,
  -- 'presidente' | 'vicepresidente' | 'tesorero' | 'secretario' | 'vocal' | 'fiscal' | 'otro'
  nombre          text        NOT NULL,
  unidad_id       uuid        REFERENCES public.unidades(id),
  telefono        text,
  email           text,
  periodo_inicio  date        NOT NULL,
  periodo_fin     date,
  activo          boolean     NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.junta_directiva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "junta_select" ON public.junta_directiva
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "junta_insert" ON public.junta_directiva
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "junta_update" ON public.junta_directiva
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "junta_delete" ON public.junta_directiva
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_junta_project ON public.junta_directiva(project_id);
CREATE INDEX IF NOT EXISTS idx_junta_activo  ON public.junta_directiva(activo);

-- ── prestamos_equipo ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prestamos_equipo (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id         uuid        REFERENCES public.unidades(id),
  equipo_nombre     text        NOT NULL,
  cantidad          int         NOT NULL DEFAULT 1,
  fecha_prestamo    date        NOT NULL DEFAULT CURRENT_DATE,
  hora_prestamo     time,
  fecha_devolucion  date,
  hora_devolucion   time,
  estado            text        NOT NULL DEFAULT 'prestado',
  -- 'prestado' | 'devuelto' | 'dañado' | 'perdido'
  deposito          numeric(10,2),
  deposito_pagado   boolean     NOT NULL DEFAULT false,
  observaciones     text,
  entregado_por     text,
  recibido_por      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prestamos_equipo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prestamos_select" ON public.prestamos_equipo
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prestamos_insert" ON public.prestamos_equipo
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prestamos_update" ON public.prestamos_equipo
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "prestamos_delete" ON public.prestamos_equipo
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_prestamos_project ON public.prestamos_equipo(project_id);
CREATE INDEX IF NOT EXISTS idx_prestamos_estado  ON public.prestamos_equipo(estado);

-- ── comunicados_condominio ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comunicados_condominio (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo       text        NOT NULL,
  contenido    text        NOT NULL,
  tipo         text        NOT NULL DEFAULT 'circular',
  -- 'carta' | 'circular' | 'aviso' | 'certificado' | 'acta'
  destinatario text        NOT NULL DEFAULT 'todos',
  -- 'todos' | 'propietarios' | 'arrendatarios' | 'junta' | 'especifico'
  unidad_id    uuid        REFERENCES public.unidades(id),
  enviado_por  text,
  fecha_envio  date        NOT NULL DEFAULT CURRENT_DATE,
  firmado      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.comunicados_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "comunicados_select" ON public.comunicados_condominio
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "comunicados_insert" ON public.comunicados_condominio
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "comunicados_update" ON public.comunicados_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "comunicados_delete" ON public.comunicados_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_comunicados_project ON public.comunicados_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_comunicados_fecha   ON public.comunicados_condominio(fecha_envio DESC);
CREATE INDEX IF NOT EXISTS idx_comunicados_tipo    ON public.comunicados_condominio(tipo);
