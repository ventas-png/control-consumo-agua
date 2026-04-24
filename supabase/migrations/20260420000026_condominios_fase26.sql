-- Condominios Fase 26
-- Tablas: parqueos_condominio, mascotas, paquetes_recibidos

-- ── parqueos_condominio ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parqueos_condominio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  numero          text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'asignado',
  -- 'asignado' | 'visita' | 'discapacitado'
  unidad_id       uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  placa_vehiculo  text,
  marca_vehiculo  text,
  color_vehiculo  text,
  activo          boolean     NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parqueos_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parqueos_select" ON public.parqueos_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "parqueos_insert" ON public.parqueos_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "parqueos_update" ON public.parqueos_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "parqueos_delete" ON public.parqueos_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_parqueos_project ON public.parqueos_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_parqueos_unidad  ON public.parqueos_condominio(unidad_id);

-- ── mascotas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mascotas (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id            uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  nombre               text        NOT NULL,
  especie              text        NOT NULL DEFAULT 'perro',
  -- 'perro' | 'gato' | 'ave' | 'otro'
  raza                 text,
  color                text,
  fecha_nacimiento     date,
  fecha_ultima_vacuna  date,
  activo               boolean     NOT NULL DEFAULT true,
  foto_url             text,
  notas                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mascotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mascotas_select" ON public.mascotas FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "mascotas_insert" ON public.mascotas FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "mascotas_update" ON public.mascotas FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "mascotas_delete" ON public.mascotas FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_mascotas_project ON public.mascotas(project_id);
CREATE INDEX IF NOT EXISTS idx_mascotas_unidad  ON public.mascotas(unidad_id);

-- ── paquetes_recibidos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.paquetes_recibidos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id           uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  remitente           text,
  descripcion         text        NOT NULL,
  num_guia            text,
  empresa_mensajeria  text,
  estado              text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'entregado' | 'devuelto'
  hora_recepcion      timestamptz NOT NULL DEFAULT now(),
  hora_entrega        timestamptz,
  recibido_por        text,
  entregado_por       text,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paquetes_recibidos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "paquetes_select" ON public.paquetes_recibidos FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "paquetes_insert" ON public.paquetes_recibidos FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "paquetes_update" ON public.paquetes_recibidos FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "paquetes_delete" ON public.paquetes_recibidos FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_paquetes_project  ON public.paquetes_recibidos(project_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_unidad   ON public.paquetes_recibidos(unidad_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_estado   ON public.paquetes_recibidos(estado);
