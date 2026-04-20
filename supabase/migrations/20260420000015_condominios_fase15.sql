-- Condominios Fase 15
-- Tablas: vehiculos_residentes, eventos_comunidad, registro_asistentes_evento,
--         caja_chica, movimientos_caja, obras_mejoras

-- ── vehiculos_residentes ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehiculos_residentes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id   uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  placa       text        NOT NULL,
  marca       text,
  modelo      text,
  color       text,
  anio        int,
  tipo        text        NOT NULL DEFAULT 'auto',
  -- 'auto' | 'moto' | 'camion' | 'otro'
  activo      boolean     NOT NULL DEFAULT true,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vehiculos_residentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehiculos_select" ON public.vehiculos_residentes FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "vehiculos_insert" ON public.vehiculos_residentes FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "vehiculos_update" ON public.vehiculos_residentes FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "vehiculos_delete" ON public.vehiculos_residentes FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_vehiculos_project ON public.vehiculos_residentes(project_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_unidad  ON public.vehiculos_residentes(unidad_id);

-- ── eventos_comunidad ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eventos_comunidad (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo                text        NOT NULL,
  descripcion           text,
  tipo                  text        NOT NULL DEFAULT 'social',
  -- 'cultural' | 'deportivo' | 'social' | 'informativo' | 'otro'
  fecha                 date        NOT NULL,
  hora_inicio           time,
  hora_fin              time,
  lugar                 text,
  capacidad_max         int,
  estado                text        NOT NULL DEFAULT 'programado',
  -- 'programado' | 'en_curso' | 'realizado' | 'cancelado'
  asistentes_real       int,
  costo_estimado        numeric(10,2),
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.eventos_comunidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eventos_com_select" ON public.eventos_comunidad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eventos_com_insert" ON public.eventos_comunidad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eventos_com_update" ON public.eventos_comunidad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eventos_com_delete" ON public.eventos_comunidad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_eventos_com_project ON public.eventos_comunidad(project_id);
CREATE INDEX IF NOT EXISTS idx_eventos_com_fecha   ON public.eventos_comunidad(fecha DESC);

-- ── registro_asistentes_evento ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registro_asistentes_evento (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evento_id   uuid        NOT NULL REFERENCES public.eventos_comunidad(id) ON DELETE CASCADE,
  unidad_id   uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  nombre      text        NOT NULL,
  num_personas int        NOT NULL DEFAULT 1,
  confirmado  boolean     NOT NULL DEFAULT true,
  asistio     boolean,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evento_id, unidad_id)
);
ALTER TABLE public.registro_asistentes_evento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asistentes_select" ON public.registro_asistentes_evento FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "asistentes_insert" ON public.registro_asistentes_evento FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "asistentes_update" ON public.registro_asistentes_evento FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "asistentes_delete" ON public.registro_asistentes_evento FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_asistentes_evento ON public.registro_asistentes_evento(evento_id);

-- ── caja_chica ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.caja_chica (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha_apertura  date        NOT NULL DEFAULT CURRENT_DATE,
  monto_inicial   numeric(12,2) NOT NULL DEFAULT 0,
  responsable     text        NOT NULL,
  estado          text        NOT NULL DEFAULT 'abierta',
  -- 'abierta' | 'cerrada'
  fecha_cierre    date,
  cerrado_por     text,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.caja_chica ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caja_select" ON public.caja_chica FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "caja_insert" ON public.caja_chica FOR INSERT TO authenticated WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "caja_update" ON public.caja_chica FOR UPDATE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id())) WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE POLICY "caja_delete" ON public.caja_chica FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_caja_project ON public.caja_chica(project_id);

-- ── movimientos_caja ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movimientos_caja (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  caja_id         uuid        NOT NULL REFERENCES public.caja_chica(id) ON DELETE CASCADE,
  tipo            text        NOT NULL,
  -- 'ingreso' | 'egreso'
  concepto        text        NOT NULL,
  monto           numeric(12,2) NOT NULL,
  comprobante     text,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  registrado_por  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimientos_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movimientos_select" ON public.movimientos_caja FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "movimientos_insert" ON public.movimientos_caja FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "movimientos_delete" ON public.movimientos_caja FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_movimientos_caja ON public.movimientos_caja(caja_id);

-- ── obras_mejoras ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.obras_mejoras (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo              text        NOT NULL,
  descripcion         text,
  area                text,
  contratista         text,
  monto_contrato      numeric(12,2),
  fecha_inicio        date,
  fecha_fin_estimada  date,
  fecha_fin_real      date,
  estado              text        NOT NULL DEFAULT 'planificada',
  -- 'planificada' | 'en_ejecucion' | 'completada' | 'pausada' | 'cancelada'
  progreso            int         NOT NULL DEFAULT 0,
  -- 0–100
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.obras_mejoras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "obras_select" ON public.obras_mejoras FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "obras_insert" ON public.obras_mejoras FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "obras_update" ON public.obras_mejoras FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "obras_delete" ON public.obras_mejoras FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_obras_project ON public.obras_mejoras(project_id);
