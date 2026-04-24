-- Condominios Fase 29
-- Tablas: recargos_mora, convenios_cuota_cond, historial_saldos_unidad, notificaciones_enviadas

-- ── recargos_mora ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recargos_mora (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  cuota_id         uuid        REFERENCES public.cuotas_condominio(id) ON DELETE SET NULL,
  tipo             text        NOT NULL DEFAULT 'porcentaje',
  -- 'porcentaje' | 'monto_fijo'
  valor            numeric(8,4) NOT NULL,
  -- % o monto según tipo
  monto_calculado  numeric(12,2) NOT NULL,
  fecha_aplicacion date        NOT NULL DEFAULT CURRENT_DATE,
  estado           text        NOT NULL DEFAULT 'pendiente',
  -- 'pendiente' | 'aplicado' | 'anulado'
  motivo           text,
  anulado_por      text,
  fecha_anulacion  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recargos_mora ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recargos_select" ON public.recargos_mora FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recargos_insert" ON public.recargos_mora FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recargos_update" ON public.recargos_mora FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "recargos_delete" ON public.recargos_mora FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_recargos_project  ON public.recargos_mora(project_id);
CREATE INDEX IF NOT EXISTS idx_recargos_unidad   ON public.recargos_mora(unidad_id);
CREATE INDEX IF NOT EXISTS idx_recargos_estado   ON public.recargos_mora(estado);

-- ── convenios_cuota_cond ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.convenios_cuota_cond (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id       uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  descripcion     text        NOT NULL,
  monto_total     numeric(12,2) NOT NULL,
  num_cuotas      int         NOT NULL DEFAULT 3,
  monto_cuota     numeric(12,2) NOT NULL,
  dia_pago        int         NOT NULL DEFAULT 5,
  fecha_inicio    date        NOT NULL,
  fecha_fin       date,
  cuotas_pagadas  int         NOT NULL DEFAULT 0,
  estado          text        NOT NULL DEFAULT 'activo',
  -- 'activo' | 'cumplido' | 'incumplido' | 'anulado'
  aprobado_por    text,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.convenios_cuota_cond ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conv_cuota_select" ON public.convenios_cuota_cond FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "conv_cuota_insert" ON public.convenios_cuota_cond FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "conv_cuota_update" ON public.convenios_cuota_cond FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "conv_cuota_delete" ON public.convenios_cuota_cond FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_conv_cuota_project ON public.convenios_cuota_cond(project_id);
CREATE INDEX IF NOT EXISTS idx_conv_cuota_unidad  ON public.convenios_cuota_cond(unidad_id);

-- ── historial_saldos_unidad ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.historial_saldos_unidad (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id            uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  periodo              text        NOT NULL,
  -- '2026-04'
  saldo_anterior       numeric(12,2) NOT NULL DEFAULT 0,
  cargos_periodo       numeric(12,2) NOT NULL DEFAULT 0,
  pagos_periodo        numeric(12,2) NOT NULL DEFAULT 0,
  saldo_final          numeric(12,2) NOT NULL DEFAULT 0,
  num_cuotas_vencidas  int         NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, unidad_id, periodo)
);
ALTER TABLE public.historial_saldos_unidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hist_saldos_select" ON public.historial_saldos_unidad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "hist_saldos_insert" ON public.historial_saldos_unidad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "hist_saldos_update" ON public.historial_saldos_unidad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "hist_saldos_delete" ON public.historial_saldos_unidad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_hist_saldos_project ON public.historial_saldos_unidad(project_id);
CREATE INDEX IF NOT EXISTS idx_hist_saldos_unidad  ON public.historial_saldos_unidad(unidad_id);
CREATE INDEX IF NOT EXISTS idx_hist_saldos_periodo ON public.historial_saldos_unidad(periodo DESC);

-- ── notificaciones_enviadas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notificaciones_enviadas (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        REFERENCES public.projects(id) ON DELETE SET NULL,
  unidad_id       uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  cliente_id      uuid        REFERENCES public.clientes(id) ON DELETE SET NULL,
  canal           text        NOT NULL DEFAULT 'whatsapp',
  -- 'whatsapp' | 'email' | 'sms' | 'push'
  destinatario    text        NOT NULL,
  asunto          text,
  contenido       text        NOT NULL,
  estado          text        NOT NULL DEFAULT 'pendiente',
  -- 'enviado' | 'fallido' | 'pendiente' | 'leido'
  error_detalle   text,
  enviado_por     text,
  fecha_envio     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notificaciones_enviadas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_env_select" ON public.notificaciones_enviadas FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "notif_env_insert" ON public.notificaciones_enviadas FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "notif_env_update" ON public.notificaciones_enviadas FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "notif_env_delete" ON public.notificaciones_enviadas FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_notif_env_project ON public.notificaciones_enviadas(project_id);
CREATE INDEX IF NOT EXISTS idx_notif_env_unidad  ON public.notificaciones_enviadas(unidad_id);
CREATE INDEX IF NOT EXISTS idx_notif_env_canal   ON public.notificaciones_enviadas(canal);
CREATE INDEX IF NOT EXISTS idx_notif_env_fecha   ON public.notificaciones_enviadas(fecha_envio DESC);
