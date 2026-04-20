-- Condominios Fase 17
-- Tablas: avisos_cobro, bitacora_manto, evaluaciones_proveedor, reclamos_condominio

-- ── avisos_cobro ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.avisos_cobro (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id     uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  tipo          text        NOT NULL DEFAULT 'primer_aviso',
  -- 'primer_aviso' | 'segundo_aviso' | 'ultimo_aviso' | 'notificacion_legal'
  monto_total   numeric(12,2) NOT NULL,
  detalle       jsonb       NOT NULL DEFAULT '[]',
  -- [{concepto: string, monto: number, periodo: string}]
  fecha_emision date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_limite  date,
  estado        text        NOT NULL DEFAULT 'emitido',
  -- 'emitido' | 'entregado' | 'pagado' | 'anulado'
  enviado_por   text,
  notas         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.avisos_cobro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avisos_cobro_select" ON public.avisos_cobro FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "avisos_cobro_insert" ON public.avisos_cobro FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "avisos_cobro_update" ON public.avisos_cobro FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "avisos_cobro_delete" ON public.avisos_cobro FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_avisos_cobro_project  ON public.avisos_cobro(project_id);
CREATE INDEX IF NOT EXISTS idx_avisos_cobro_unidad   ON public.avisos_cobro(unidad_id);
CREATE INDEX IF NOT EXISTS idx_avisos_cobro_fecha    ON public.avisos_cobro(fecha_emision DESC);

-- ── bitacora_manto ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bitacora_manto (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha         date        NOT NULL DEFAULT CURRENT_DATE,
  turno         text        NOT NULL DEFAULT 'mañana',
  -- 'mañana' | 'tarde' | 'noche'
  responsable   text        NOT NULL,
  area          text,
  tareas        jsonb       NOT NULL DEFAULT '[]',
  -- [{tarea: string, completado: boolean, observaciones: string}]
  observaciones text,
  firmado       boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bitacora_manto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bitacora_manto_select" ON public.bitacora_manto FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_manto_insert" ON public.bitacora_manto FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_manto_update" ON public.bitacora_manto FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_manto_delete" ON public.bitacora_manto FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_bitacora_manto_project ON public.bitacora_manto(project_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_manto_fecha   ON public.bitacora_manto(fecha DESC);

-- ── evaluaciones_proveedor ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluaciones_proveedor (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  proveedor_id      uuid        REFERENCES public.contratos_proveedor(id) ON DELETE SET NULL,
  nombre_proveedor  text        NOT NULL,
  calificacion      int         NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
  puntualidad       int         CHECK (puntualidad BETWEEN 1 AND 5),
  calidad           int         CHECK (calidad BETWEEN 1 AND 5),
  precio            int         CHECK (precio BETWEEN 1 AND 5),
  comentarios       text,
  evaluado_por      text,
  fecha             date        NOT NULL DEFAULT CURRENT_DATE,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.evaluaciones_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eval_prov_select" ON public.evaluaciones_proveedor FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eval_prov_insert" ON public.evaluaciones_proveedor FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eval_prov_update" ON public.evaluaciones_proveedor FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "eval_prov_delete" ON public.evaluaciones_proveedor FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_eval_prov_project  ON public.evaluaciones_proveedor(project_id);
CREATE INDEX IF NOT EXISTS idx_eval_prov_proveedor ON public.evaluaciones_proveedor(proveedor_id);

-- ── reclamos_condominio ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reclamos_condominio (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id         uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo              text        NOT NULL DEFAULT 'queja',
  -- 'queja' | 'sugerencia' | 'reclamo_formal' | 'apelacion'
  asunto            text        NOT NULL,
  descripcion       text,
  prioridad         text        NOT NULL DEFAULT 'normal',
  -- 'baja' | 'normal' | 'alta' | 'urgente'
  estado            text        NOT NULL DEFAULT 'recibido',
  -- 'recibido' | 'en_revision' | 'respondido' | 'cerrado' | 'escalado'
  respuesta_admin   text,
  respondido_por    text,
  fecha_respuesta   date,
  plazo_respuesta   date,
  anonimo           boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reclamos_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reclamos_select" ON public.reclamos_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reclamos_insert" ON public.reclamos_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reclamos_update" ON public.reclamos_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "reclamos_delete" ON public.reclamos_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_reclamos_project ON public.reclamos_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_reclamos_unidad  ON public.reclamos_condominio(unidad_id);
