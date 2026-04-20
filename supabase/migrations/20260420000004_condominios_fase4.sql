-- Condominios Fase 4
-- Tablas: inventario_condominio, polizas_seguro, inspecciones_normativas, personal_condominio

-- ── inventario_condominio ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventario_condominio (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre            text        NOT NULL,
  categoria         text        NOT NULL DEFAULT 'herramienta',
  -- categoria: 'herramienta' | 'equipo' | 'material' | 'mobiliario' | 'vehiculo' | 'otro'
  descripcion       text,
  numero_serie      text,
  ubicacion         text,
  estado            text        NOT NULL DEFAULT 'disponible',
  -- estado: 'disponible' | 'en_uso' | 'en_reparacion' | 'dado_de_baja'
  cantidad          int         NOT NULL DEFAULT 1,
  cantidad_minima   int         NOT NULL DEFAULT 0,
  unidad_medida     text        NOT NULL DEFAULT 'unidad',
  -- unidad: 'unidad' | 'kg' | 'litro' | 'metro' | 'caja'
  costo_unitario    numeric(12,2),
  proveedor         text,
  fecha_adquisicion date,
  fecha_vencimiento date,
  foto_url          text,
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventario_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventario_select" ON public.inventario_condominio
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "inventario_insert" ON public.inventario_condominio
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "inventario_update" ON public.inventario_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "inventario_delete" ON public.inventario_condominio
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_inventario_project  ON public.inventario_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_inventario_categoria ON public.inventario_condominio(categoria);
CREATE INDEX IF NOT EXISTS idx_inventario_estado    ON public.inventario_condominio(estado);

-- ── polizas_seguro ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.polizas_seguro (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  numero_poliza      text        NOT NULL,
  aseguradora        text        NOT NULL,
  tipo               text        NOT NULL DEFAULT 'incendio',
  -- tipo: 'incendio' | 'responsabilidad_civil' | 'terremoto' | 'inundacion' | 'robo' | 'vida' | 'otro'
  descripcion        text,
  suma_asegurada     numeric(14,2),
  prima_anual        numeric(12,2),
  fecha_inicio       date        NOT NULL,
  fecha_vencimiento  date        NOT NULL,
  estado             text        NOT NULL DEFAULT 'vigente',
  -- estado: 'vigente' | 'vencida' | 'cancelada'
  agente_nombre      text,
  agente_telefono    text,
  agente_email       text,
  documento_url      text,
  notas              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.polizas_seguro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "polizas_select" ON public.polizas_seguro
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "polizas_insert" ON public.polizas_seguro
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE POLICY "polizas_update" ON public.polizas_seguro
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE POLICY "polizas_delete" ON public.polizas_seguro
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_polizas_project     ON public.polizas_seguro(project_id);
CREATE INDEX IF NOT EXISTS idx_polizas_vencimiento ON public.polizas_seguro(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_polizas_estado      ON public.polizas_seguro(estado);

-- ── inspecciones_normativas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inspecciones_normativas (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  tipo                  text        NOT NULL DEFAULT 'bomberos',
  -- tipo: 'bomberos' | 'igss' | 'municipalidad' | 'electrica' | 'sanitaria' | 'elevadores' | 'otro'
  entidad_inspectora    text,
  fecha                 date        NOT NULL,
  resultado             text        NOT NULL DEFAULT 'aprobado',
  -- resultado: 'aprobado' | 'aprobado_con_observaciones' | 'reprobado' | 'pendiente'
  hallazgos             text,
  acciones_correctivas  text,
  fecha_proxima         date,
  inspector_nombre      text,
  certificado_url       text,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inspecciones_normativas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inspecciones_select" ON public.inspecciones_normativas
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "inspecciones_insert" ON public.inspecciones_normativas
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "inspecciones_update" ON public.inspecciones_normativas
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "inspecciones_delete" ON public.inspecciones_normativas
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_inspecciones_project  ON public.inspecciones_normativas(project_id);
CREATE INDEX IF NOT EXISTS idx_inspecciones_fecha     ON public.inspecciones_normativas(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_inspecciones_proxima   ON public.inspecciones_normativas(fecha_proxima);

-- ── personal_condominio ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_condominio (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre         text        NOT NULL,
  cargo          text        NOT NULL DEFAULT 'conserje',
  -- cargo: 'conserje' | 'guardia' | 'jardinero' | 'mantenimiento' | 'administrador' | 'otro'
  telefono       text,
  email          text,
  fecha_ingreso  date,
  turno          text        NOT NULL DEFAULT 'diurno',
  -- turno: 'diurno' | 'nocturno' | 'rotativo'
  estado         text        NOT NULL DEFAULT 'activo',
  -- estado: 'activo' | 'inactivo' | 'vacaciones' | 'incapacidad'
  salario        numeric(12,2),
  dpi            text,
  foto_url       text,
  notas          text,
  created_at     timestamptz NOT NULL DEFAULT now()
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

CREATE INDEX IF NOT EXISTS idx_personal_project ON public.personal_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_personal_cargo   ON public.personal_condominio(cargo);
CREATE INDEX IF NOT EXISTS idx_personal_estado  ON public.personal_condominio(estado);
