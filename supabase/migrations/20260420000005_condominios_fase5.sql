-- Condominios Fase 5
-- Tablas: contactos_emergencia, mudanzas, documentos_condominio, registros_residuos

-- ── contactos_emergencia ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contactos_emergencia (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre               text        NOT NULL,
  tipo                 text        NOT NULL DEFAULT 'general',
  -- tipo: 'bomberos' | 'policia' | 'ambulancia' | 'hospital' | 'electricidad' | 'agua' | 'gas' | 'administracion' | 'general'
  telefono             text        NOT NULL,
  telefono_alternativo text,
  descripcion          text,
  disponible_24h       boolean     NOT NULL DEFAULT true,
  orden                int         NOT NULL DEFAULT 0,
  activo               boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contactos_emergencia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contactos_emerg_select" ON public.contactos_emergencia
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "contactos_emerg_insert" ON public.contactos_emergencia
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "contactos_emerg_update" ON public.contactos_emergencia
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "contactos_emerg_delete" ON public.contactos_emergencia
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_contactos_emerg_project ON public.contactos_emergencia(project_id);
CREATE INDEX IF NOT EXISTS idx_contactos_emerg_orden   ON public.contactos_emergencia(project_id, orden);

-- ── mudanzas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mudanzas (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id          uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo               text        NOT NULL DEFAULT 'ingreso',
  -- tipo: 'ingreso' | 'salida'
  fecha              date        NOT NULL,
  hora_inicio        time,
  hora_fin           time,
  nombre_residente   text        NOT NULL,
  telefono           text,
  empresa_mudanza    text,
  estado             text        NOT NULL DEFAULT 'programada',
  -- estado: 'programada' | 'en_curso' | 'completada' | 'cancelada'
  deposito_requerido boolean     NOT NULL DEFAULT false,
  deposito_pagado    boolean     NOT NULL DEFAULT false,
  monto_deposito     numeric(10,2),
  ascensor_reservado boolean     NOT NULL DEFAULT false,
  notas              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mudanzas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mudanzas_select" ON public.mudanzas
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "mudanzas_insert" ON public.mudanzas
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "mudanzas_update" ON public.mudanzas
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "mudanzas_delete" ON public.mudanzas
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_mudanzas_project ON public.mudanzas(project_id);
CREATE INDEX IF NOT EXISTS idx_mudanzas_fecha   ON public.mudanzas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mudanzas_unidad  ON public.mudanzas(unidad_id);

-- ── documentos_condominio ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documentos_condominio (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo         text        NOT NULL,
  categoria      text        NOT NULL DEFAULT 'reglamento',
  -- categoria: 'reglamento' | 'circular' | 'manual' | 'acta' | 'contrato' | 'formulario' | 'otro'
  descripcion    text,
  url            text        NOT NULL,
  version        text,
  vigente        boolean     NOT NULL DEFAULT true,
  visibilidad    text        NOT NULL DEFAULT 'admin',
  -- visibilidad: 'admin' | 'residentes' | 'todos'
  subido_por     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.documentos_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documentos_select" ON public.documentos_condominio
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "documentos_insert" ON public.documentos_condominio
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "documentos_update" ON public.documentos_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "documentos_delete" ON public.documentos_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_documentos_project   ON public.documentos_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_documentos_categoria ON public.documentos_condominio(categoria);

-- ── registros_residuos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registros_residuos (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  tipo_residuo    text        NOT NULL DEFAULT 'general',
  -- tipo: 'general' | 'reciclable' | 'organico' | 'electronico' | 'peligroso' | 'escombros'
  cantidad_kg     numeric(8,2),
  punto_acopio    text,
  empresa_recolectora text,
  estado          text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'recolectado' | 'procesado'
  incidencia      boolean     NOT NULL DEFAULT false,
  descripcion_incidencia text,
  registrado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.registros_residuos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "residuos_select" ON public.registros_residuos
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "residuos_insert" ON public.registros_residuos
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "residuos_update" ON public.registros_residuos
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "residuos_delete" ON public.registros_residuos
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_residuos_project ON public.registros_residuos(project_id);
CREATE INDEX IF NOT EXISTS idx_residuos_fecha   ON public.registros_residuos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_residuos_tipo    ON public.registros_residuos(tipo_residuo);
