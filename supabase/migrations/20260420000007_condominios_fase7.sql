-- Condominios Fase 7
-- Tablas: reservas_str, locales_comerciales, servicios_housekeeping

-- ── reservas_str ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reservas_str (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  huesped_nombre   text        NOT NULL,
  huesped_email    text,
  huesped_telefono text,
  fecha_entrada    date        NOT NULL,
  fecha_salida     date        NOT NULL,
  num_adultos      int         NOT NULL DEFAULT 1,
  num_ninos        int         NOT NULL DEFAULT 0,
  plataforma       text        NOT NULL DEFAULT 'directo',
  -- plataforma: 'airbnb' | 'booking' | 'vrbo' | 'directo' | 'otro'
  monto_noche      numeric(10,2),
  monto_total      numeric(12,2),
  estado           text        NOT NULL DEFAULT 'confirmada',
  -- estado: 'confirmada' | 'en_curso' | 'completada' | 'cancelada'
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reservas_str ENABLE ROW LEVEL SECURITY;

CREATE POLICY "str_select" ON public.reservas_str
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "str_insert" ON public.reservas_str
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "str_update" ON public.reservas_str
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "str_delete" ON public.reservas_str
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_str_project      ON public.reservas_str(project_id);
CREATE INDEX IF NOT EXISTS idx_str_unidad       ON public.reservas_str(unidad_id);
CREATE INDEX IF NOT EXISTS idx_str_entrada      ON public.reservas_str(fecha_entrada);
CREATE INDEX IF NOT EXISTS idx_str_estado       ON public.reservas_str(estado);

-- ── locales_comerciales ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.locales_comerciales (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id         uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  numero_local       text        NOT NULL,
  piso               text,
  area_m2            numeric(8,2),
  giro               text        NOT NULL DEFAULT 'comercio',
  -- giro: 'restaurante' | 'oficina' | 'comercio' | 'servicio' | 'otro'
  inquilino_nombre   text,
  inquilino_telefono text,
  fecha_inicio       date,
  fecha_fin          date,
  renta_base         numeric(12,2),
  porcentaje_cam     numeric(5,2)  DEFAULT 0,
  cuota_cam          numeric(10,2),
  estado             text        NOT NULL DEFAULT 'disponible',
  -- estado: 'disponible' | 'ocupado' | 'en_remodelacion'
  notas              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locales_comerciales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locales_select" ON public.locales_comerciales
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "locales_insert" ON public.locales_comerciales
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "locales_update" ON public.locales_comerciales
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "locales_delete" ON public.locales_comerciales
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_locales_project ON public.locales_comerciales(project_id);
CREATE INDEX IF NOT EXISTS idx_locales_estado  ON public.locales_comerciales(estado);

-- ── servicios_housekeeping ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.servicios_housekeeping (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id    uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo         text        NOT NULL DEFAULT 'limpieza_estandar',
  -- tipo: 'limpieza_estandar' | 'limpieza_profunda' | 'lavanderia' | 'mantenimiento_menor' | 'otro'
  fecha        date        NOT NULL,
  hora_inicio  time,
  hora_fin     time,
  responsable  text,
  estado       text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'en_proceso' | 'completado' | 'cancelado'
  costo        numeric(10,2),
  notas        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.servicios_housekeeping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hk_select" ON public.servicios_housekeeping
  FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "hk_insert" ON public.servicios_housekeeping
  FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "hk_update" ON public.servicios_housekeeping
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "hk_delete" ON public.servicios_housekeeping
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_hk_project ON public.servicios_housekeeping(project_id);
CREATE INDEX IF NOT EXISTS idx_hk_unidad  ON public.servicios_housekeeping(unidad_id);
CREATE INDEX IF NOT EXISTS idx_hk_fecha   ON public.servicios_housekeeping(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_hk_estado  ON public.servicios_housekeeping(estado);
