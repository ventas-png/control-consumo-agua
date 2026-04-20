-- Condominios Fase 21
-- Tablas: suministros_condominio, movimientos_suministro, tareas_condominio, gestion_cobranza

-- ── suministros_condominio ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suministros_condominio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre          text        NOT NULL,
  categoria       text        NOT NULL DEFAULT 'limpieza',
  -- 'limpieza' | 'herramienta' | 'material' | 'oficina' | 'seguridad' | 'otro'
  unidad_medida   text        NOT NULL DEFAULT 'unidad',
  -- 'unidad' | 'litro' | 'kg' | 'metro' | 'caja' | 'rollo' | 'otro'
  stock_actual    numeric(10,2) NOT NULL DEFAULT 0,
  stock_minimo    numeric(10,2) NOT NULL DEFAULT 0,
  ubicacion       text,
  proveedor       text,
  costo_unitario  numeric(10,4),
  notas           text,
  activo          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suministros_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suministros_select" ON public.suministros_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "suministros_insert" ON public.suministros_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "suministros_update" ON public.suministros_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "suministros_delete" ON public.suministros_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_suministros_project ON public.suministros_condominio(project_id);

-- ── movimientos_suministro ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.movimientos_suministro (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  suministro_id   uuid        NOT NULL REFERENCES public.suministros_condominio(id) ON DELETE CASCADE,
  tipo            text        NOT NULL DEFAULT 'salida',
  -- 'entrada' | 'salida' | 'ajuste'
  cantidad        numeric(10,2) NOT NULL,
  motivo          text,
  area_destino    text,
  realizado_por   text,
  fecha           date        NOT NULL DEFAULT CURRENT_DATE,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimientos_suministro ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movimientos_sum_select" ON public.movimientos_suministro FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "movimientos_sum_insert" ON public.movimientos_suministro FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "movimientos_sum_update" ON public.movimientos_suministro FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "movimientos_sum_delete" ON public.movimientos_suministro FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_movimientos_sum_suministro ON public.movimientos_suministro(suministro_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_sum_fecha      ON public.movimientos_suministro(fecha DESC);

-- ── tareas_condominio ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tareas_condominio (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo          text        NOT NULL,
  descripcion     text,
  categoria       text        NOT NULL DEFAULT 'operativa',
  -- 'operativa' | 'mantenimiento' | 'administrativa' | 'seguridad' | 'limpieza' | 'otro'
  prioridad       text        NOT NULL DEFAULT 'media',
  -- 'baja' | 'media' | 'alta' | 'urgente'
  estado          text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'en_proceso' | 'completada' | 'cancelada'
  asignado_a      text,
  reportado_por   text,
  area            text,
  fecha_limite    date,
  fecha_inicio    date,
  fecha_cierre    date,
  costo_estimado  numeric(10,2),
  costo_real      numeric(10,2),
  comentarios     jsonb       NOT NULL DEFAULT '[]',
  -- [{fecha: string, autor: string, texto: string}]
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tareas_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tareas_cond_select" ON public.tareas_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "tareas_cond_insert" ON public.tareas_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "tareas_cond_update" ON public.tareas_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "tareas_cond_delete" ON public.tareas_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_tareas_cond_project  ON public.tareas_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_tareas_cond_estado   ON public.tareas_condominio(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_cond_limite   ON public.tareas_condominio(fecha_limite);

-- ── gestion_cobranza ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gestion_cobranza (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id       uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  responsable     text        NOT NULL,
  monto_adeudado  numeric(12,2) NOT NULL DEFAULT 0,
  monto_pagado    numeric(12,2) NOT NULL DEFAULT 0,
  etapa           text        NOT NULL DEFAULT 'aviso_amistoso',
  -- 'aviso_amistoso' | 'recordatorio' | 'carta_formal' | 'suspension_servicios' | 'cobro_juridico' | 'acuerdo_pago' | 'resuelto'
  fecha_inicio    date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_resolucion date,
  contactos       jsonb       NOT NULL DEFAULT '[]',
  -- [{fecha: string, tipo: 'llamada'|'email'|'visita'|'mensaje', resultado: string, siguiente_accion: string}]
  observaciones   text,
  estado          text        NOT NULL DEFAULT 'activo',
  -- 'activo' | 'resuelto' | 'cancelado'
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gestion_cobranza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cobranza_select" ON public.gestion_cobranza FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cobranza_insert" ON public.gestion_cobranza FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cobranza_update" ON public.gestion_cobranza FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "cobranza_delete" ON public.gestion_cobranza FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_cobranza_project ON public.gestion_cobranza(project_id);
CREATE INDEX IF NOT EXISTS idx_cobranza_unidad  ON public.gestion_cobranza(unidad_id);
CREATE INDEX IF NOT EXISTS idx_cobranza_estado  ON public.gestion_cobranza(estado);
