-- Condominios Fase 27
-- Tablas: infracciones_condominio, rondas_seguridad, novedades_seguridad, contratos_arrendamiento

-- ── infracciones_condominio ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.infracciones_condominio (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id             uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  tipo                  text        NOT NULL DEFAULT 'otro',
  -- 'ruido' | 'basura' | 'estacionamiento' | 'mascota' | 'daños' | 'otro'
  descripcion           text        NOT NULL,
  monto_multa           numeric(10,2),
  estado                text        NOT NULL DEFAULT 'emitida',
  -- 'emitida' | 'notificada' | 'en_descargo' | 'resuelta' | 'anulada'
  reportado_por         text,
  fecha_infraccion      date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_limite_descargo date,
  descargo              text,
  resolucion            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.infracciones_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infracciones_select" ON public.infracciones_condominio FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "infracciones_insert" ON public.infracciones_condominio FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "infracciones_update" ON public.infracciones_condominio FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "infracciones_delete" ON public.infracciones_condominio FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_infracciones_project ON public.infracciones_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_infracciones_unidad  ON public.infracciones_condominio(unidad_id);
CREATE INDEX IF NOT EXISTS idx_infracciones_estado  ON public.infracciones_condominio(estado);

-- ── rondas_seguridad ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rondas_seguridad (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  guardia_id  uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  inicio      timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz,
  estado      text        NOT NULL DEFAULT 'en_curso',
  -- 'en_curso' | 'completada' | 'incompleta'
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rondas_seguridad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rondas_select" ON public.rondas_seguridad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "rondas_insert" ON public.rondas_seguridad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "rondas_update" ON public.rondas_seguridad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "rondas_delete" ON public.rondas_seguridad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_rondas_project ON public.rondas_seguridad(project_id);
CREATE INDEX IF NOT EXISTS idx_rondas_inicio  ON public.rondas_seguridad(inicio DESC);

-- ── novedades_seguridad ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.novedades_seguridad (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  ronda_id      uuid        REFERENCES public.rondas_seguridad(id) ON DELETE SET NULL,
  tipo          text        NOT NULL DEFAULT 'observacion',
  -- 'incidente' | 'observacion' | 'alarma' | 'acceso' | 'otro'
  descripcion   text        NOT NULL,
  ubicacion     text,
  prioridad     text        NOT NULL DEFAULT 'normal',
  -- 'normal' | 'alta' | 'critica'
  reportado_por text,
  foto_url      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.novedades_seguridad ENABLE ROW LEVEL SECURITY;
CREATE POLICY "novedades_select" ON public.novedades_seguridad FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "novedades_insert" ON public.novedades_seguridad FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "novedades_update" ON public.novedades_seguridad FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "novedades_delete" ON public.novedades_seguridad FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_novedades_project  ON public.novedades_seguridad(project_id);
CREATE INDEX IF NOT EXISTS idx_novedades_ronda    ON public.novedades_seguridad(ronda_id);
CREATE INDEX IF NOT EXISTS idx_novedades_prioridad ON public.novedades_seguridad(prioridad);

-- ── contratos_arrendamiento ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contratos_arrendamiento (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id                  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id                   uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  arrendatario_nombre         text        NOT NULL,
  arrendatario_identificacion text,
  arrendatario_telefono       text,
  arrendatario_email          text,
  monto_renta                 numeric(12,2) NOT NULL,
  dia_pago                    int         NOT NULL DEFAULT 1,
  fecha_inicio                date        NOT NULL,
  fecha_fin                   date,
  deposito                    numeric(12,2),
  estado                      text        NOT NULL DEFAULT 'activo',
  -- 'activo' | 'vencido' | 'terminado'
  notas                       text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contratos_arrendamiento ENABLE ROW LEVEL SECURITY;
CREATE POLICY "arrend_select" ON public.contratos_arrendamiento FOR SELECT TO authenticated USING (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "arrend_insert" ON public.contratos_arrendamiento FOR INSERT TO authenticated WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "arrend_update" ON public.contratos_arrendamiento FOR UPDATE TO authenticated USING (company_id = get_my_company_id() OR is_super_admin()) WITH CHECK (company_id = get_my_company_id() OR is_super_admin());
CREATE POLICY "arrend_delete" ON public.contratos_arrendamiento FOR DELETE TO authenticated USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));
CREATE INDEX IF NOT EXISTS idx_arrend_project ON public.contratos_arrendamiento(project_id);
CREATE INDEX IF NOT EXISTS idx_arrend_unidad  ON public.contratos_arrendamiento(unidad_id);
CREATE INDEX IF NOT EXISTS idx_arrend_estado  ON public.contratos_arrendamiento(estado);
