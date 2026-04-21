-- Condominios Fase 28
-- Tablas: comentarios_ticket, recordatorios_condominio, plantillas_cuota, bitacora_acciones

-- ── comentarios_ticket ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comentarios_ticket (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ticket_id       uuid        NOT NULL REFERENCES public.tickets_mantenimiento(id) ON DELETE CASCADE,
  autor_id        uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  autor_nombre    text        NOT NULL,
  contenido       text        NOT NULL,
  estado_nuevo    text,
  -- estado al que se cambió el ticket con este comentario (nullable si solo es comentario)
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.comentarios_ticket ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coment_ticket_select" ON public.comentarios_ticket FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "coment_ticket_insert" ON public.comentarios_ticket FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "coment_ticket_delete" ON public.comentarios_ticket FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_coment_ticket_ticket ON public.comentarios_ticket(ticket_id);
CREATE INDEX IF NOT EXISTS idx_coment_ticket_created ON public.comentarios_ticket(created_at DESC);

-- ── recordatorios_condominio ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recordatorios_condominio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo          text        NOT NULL,
  descripcion     text,
  fecha_limite    date        NOT NULL,
  tipo_entidad    text,
  -- 'cuota' | 'contrato' | 'inspeccion' | 'mantenimiento' | 'general'
  entidad_id      uuid,
  -- FK genérico al registro relacionado
  asignado_a      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  asignado_nombre text,
  prioridad       text        NOT NULL DEFAULT 'normal',
  -- 'normal' | 'alta' | 'critica'
  completado      boolean     NOT NULL DEFAULT false,
  fecha_completado timestamptz,
  created_by      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recordatorios_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recordatorios_select" ON public.recordatorios_condominio FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recordatorios_insert" ON public.recordatorios_condominio FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recordatorios_update" ON public.recordatorios_condominio FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recordatorios_delete" ON public.recordatorios_condominio FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_recordatorios_project ON public.recordatorios_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_recordatorios_fecha   ON public.recordatorios_condominio(fecha_limite);

-- ── plantillas_cuota ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plantillas_cuota (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre          text        NOT NULL,
  concepto        text        NOT NULL,
  -- 'mantenimiento' | 'agua' | 'seguridad' | 'amenidades' | 'extraordinaria' | 'otro'
  monto           numeric(12,2) NOT NULL,
  dia_vencimiento int         NOT NULL DEFAULT 5,
  -- día del mes en que vence (1-28)
  periodicidad    text        NOT NULL DEFAULT 'mensual',
  -- 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'única'
  aplica_a        text        NOT NULL DEFAULT 'todas',
  -- 'todas' | 'residencial' | 'comercial'
  activa          boolean     NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plantillas_cuota ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plantillas_select" ON public.plantillas_cuota FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plantillas_insert" ON public.plantillas_cuota FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plantillas_update" ON public.plantillas_cuota FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "plantillas_delete" ON public.plantillas_cuota FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_plantillas_project ON public.plantillas_cuota(project_id);

-- ── bitacora_acciones ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bitacora_acciones (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  usuario_id      uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  usuario_nombre  text        NOT NULL,
  accion          text        NOT NULL,
  -- 'crear' | 'editar' | 'eliminar' | 'aprobar' | 'rechazar' | 'pagar' | 'cerrar'
  modulo          text        NOT NULL,
  -- 'cuotas' | 'tickets' | 'visitantes' | 'pagos' | etc.
  entidad_id      uuid,
  entidad_desc    text,
  -- descripción legible del registro afectado
  detalles        jsonb,
  -- cambios antes/después en formato { before: {}, after: {} }
  ip_address      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bitacora_acciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bitacora_select" ON public.bitacora_acciones FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "bitacora_insert" ON public.bitacora_acciones FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE INDEX IF NOT EXISTS idx_bitacora_company  ON public.bitacora_acciones(company_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_project  ON public.bitacora_acciones(project_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_created  ON public.bitacora_acciones(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bitacora_usuario  ON public.bitacora_acciones(usuario_id);
