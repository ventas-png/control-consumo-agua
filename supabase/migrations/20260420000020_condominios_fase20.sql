-- Condominios Fase 20
-- Tablas: estacionamiento_visita, bitacora_guardia, equipos_comunes, presencia_personal

-- ── estacionamiento_visita ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.estacionamiento_visita (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  espacio         text        NOT NULL,
  unidad_visitada uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  placa           text        NOT NULL,
  tipo_vehiculo   text        NOT NULL DEFAULT 'auto',
  -- 'auto' | 'moto' | 'camion' | 'otro'
  visitante_nombre text,
  hora_entrada    timestamptz NOT NULL DEFAULT now(),
  hora_salida     timestamptz,
  autorizado_por  text,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.estacionamiento_visita ENABLE ROW LEVEL SECURITY;
CREATE POLICY "estac_visita_select" ON public.estacionamiento_visita FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "estac_visita_insert" ON public.estacionamiento_visita FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "estac_visita_update" ON public.estacionamiento_visita FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "estac_visita_delete" ON public.estacionamiento_visita FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_estac_visita_project ON public.estacionamiento_visita(project_id);
CREATE INDEX IF NOT EXISTS idx_estac_visita_entrada ON public.estacionamiento_visita(hora_entrada DESC);

-- ── bitacora_guardia ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bitacora_guardia (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha          date        NOT NULL DEFAULT CURRENT_DATE,
  turno          text        NOT NULL DEFAULT 'mañana',
  -- 'mañana' | 'tarde' | 'noche'
  guardia_nombre text        NOT NULL,
  hora_inicio    time,
  hora_fin       time,
  novedades      jsonb       NOT NULL DEFAULT '[]',
  -- [{hora: string, descripcion: string, tipo: 'normal'|'urgente'|'informativo'}]
  observaciones  text,
  estado         text        NOT NULL DEFAULT 'abierto',
  -- 'abierto' | 'cerrado'
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bitacora_guardia ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bitacora_guardia_select" ON public.bitacora_guardia FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_guardia_insert" ON public.bitacora_guardia FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_guardia_update" ON public.bitacora_guardia FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_guardia_delete" ON public.bitacora_guardia FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_bitacora_guardia_project ON public.bitacora_guardia(project_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_guardia_fecha   ON public.bitacora_guardia(fecha DESC);

-- ── equipos_comunes ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equipos_comunes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre                text        NOT NULL,
  categoria             text        NOT NULL DEFAULT 'otro',
  -- 'bomba' | 'ascensor' | 'generador' | 'camara' | 'extintor' | 'planta_electrica' | 'otro'
  marca                 text,
  modelo                text,
  serial                text,
  ubicacion             text,
  fecha_compra          date,
  valor_compra          numeric(12,2),
  vida_util_anios       int,
  estado                text        NOT NULL DEFAULT 'operativo',
  -- 'operativo' | 'mantenimiento' | 'fuera_servicio' | 'baja'
  ultimo_mantenimiento  date,
  proximo_mantenimiento date,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.equipos_comunes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "equipos_comunes_select" ON public.equipos_comunes FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "equipos_comunes_insert" ON public.equipos_comunes FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "equipos_comunes_update" ON public.equipos_comunes FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "equipos_comunes_delete" ON public.equipos_comunes FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_equipos_comunes_project ON public.equipos_comunes(project_id);

-- ── presencia_personal ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presencia_personal (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre       text        NOT NULL,
  cargo        text,
  fecha        date        NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada time,
  hora_salida  time,
  estado       text        NOT NULL DEFAULT 'presente',
  -- 'presente' | 'ausente' | 'tardanza' | 'permiso' | 'vacaciones'
  observaciones text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.presencia_personal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "presencia_personal_select" ON public.presencia_personal FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "presencia_personal_insert" ON public.presencia_personal FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "presencia_personal_update" ON public.presencia_personal FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "presencia_personal_delete" ON public.presencia_personal FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_presencia_personal_project ON public.presencia_personal(project_id);
CREATE INDEX IF NOT EXISTS idx_presencia_personal_fecha   ON public.presencia_personal(fecha DESC);
