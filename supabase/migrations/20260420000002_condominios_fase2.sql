-- Condominios Fase 2
-- Tablas: parqueos_condominio, mascotas, paquetes_recibidos,
--         infracciones_condominio, rondas_seguridad, novedades_seguridad,
--         contratos_arrendamiento

-- ── parqueos_condominio ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parqueos_condominio (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  numero           text        NOT NULL,          -- 'P-01', 'P-02'
  tipo             text        NOT NULL DEFAULT 'asignado',
  -- tipo: 'asignado' | 'visita' | 'discapacitado'
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  placa_vehiculo   text,
  marca_vehiculo   text,
  color_vehiculo   text,
  activo           boolean     NOT NULL DEFAULT true,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.parqueos_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parqueos_select" ON public.parqueos_condominio
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "parqueos_insert" ON public.parqueos_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "parqueos_update" ON public.parqueos_condominio
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "parqueos_delete" ON public.parqueos_condominio
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_parqueos_project ON public.parqueos_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_parqueos_unidad  ON public.parqueos_condominio(unidad_id);

-- ── mascotas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mascotas (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id             uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  nombre                text        NOT NULL,
  especie               text        NOT NULL DEFAULT 'perro',
  -- especie: 'perro' | 'gato' | 'ave' | 'otro'
  raza                  text,
  color                 text,
  fecha_nacimiento      date,
  fecha_ultima_vacuna   date,
  activo                boolean     NOT NULL DEFAULT true,
  foto_url              text,
  notas                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mascotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mascotas_select" ON public.mascotas
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "mascotas_insert" ON public.mascotas
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "mascotas_update" ON public.mascotas
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "mascotas_delete" ON public.mascotas
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_mascotas_project ON public.mascotas(project_id);
CREATE INDEX IF NOT EXISTS idx_mascotas_unidad  ON public.mascotas(unidad_id);

-- ── paquetes_recibidos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.paquetes_recibidos (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id            uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  remitente            text,
  descripcion          text        NOT NULL,
  num_guia             text,
  empresa_mensajeria   text,
  estado               text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'entregado' | 'devuelto'
  hora_recepcion       timestamptz NOT NULL DEFAULT now(),
  hora_entrega         timestamptz,
  recibido_por         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  entregado_por        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  notas                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paquetes_recibidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paquetes_select" ON public.paquetes_recibidos
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "paquetes_insert" ON public.paquetes_recibidos
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "paquetes_update" ON public.paquetes_recibidos
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "paquetes_delete" ON public.paquetes_recibidos
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_paquetes_project  ON public.paquetes_recibidos(project_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_unidad   ON public.paquetes_recibidos(unidad_id);
CREATE INDEX IF NOT EXISTS idx_paquetes_estado   ON public.paquetes_recibidos(estado);
CREATE INDEX IF NOT EXISTS idx_paquetes_recepcion ON public.paquetes_recibidos(hora_recepcion DESC);

-- ── infracciones_condominio ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.infracciones_condominio (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id              uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id               uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  tipo                    text        NOT NULL DEFAULT 'otro',
  -- tipo: 'ruido' | 'basura' | 'estacionamiento' | 'mascota' | 'daños' | 'otro'
  descripcion             text        NOT NULL,
  monto_multa             numeric(10,2),
  estado                  text        NOT NULL DEFAULT 'emitida',
  -- estado: 'emitida' | 'notificada' | 'en_descargo' | 'resuelta' | 'anulada'
  reportado_por           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  fecha_infraccion        date        NOT NULL DEFAULT CURRENT_DATE,
  fecha_limite_descargo   date,
  descargo                text,
  resolucion              text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.infracciones_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "infracciones_select" ON public.infracciones_condominio
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "infracciones_insert" ON public.infracciones_condominio
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "infracciones_update" ON public.infracciones_condominio
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "infracciones_delete" ON public.infracciones_condominio
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_infracciones_project ON public.infracciones_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_infracciones_unidad  ON public.infracciones_condominio(unidad_id);
CREATE INDEX IF NOT EXISTS idx_infracciones_estado  ON public.infracciones_condominio(estado);

-- ── rondas_seguridad ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rondas_seguridad (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  guardia_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  inicio      timestamptz NOT NULL DEFAULT now(),
  fin         timestamptz,
  estado      text        NOT NULL DEFAULT 'en_curso',
  -- estado: 'en_curso' | 'completada' | 'incompleta'
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rondas_seguridad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rondas_select" ON public.rondas_seguridad
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "rondas_insert" ON public.rondas_seguridad
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "rondas_update" ON public.rondas_seguridad
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "rondas_delete" ON public.rondas_seguridad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_rondas_project ON public.rondas_seguridad(project_id);
CREATE INDEX IF NOT EXISTS idx_rondas_inicio  ON public.rondas_seguridad(inicio DESC);

-- ── novedades_seguridad ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.novedades_seguridad (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  ronda_id       uuid        REFERENCES public.rondas_seguridad(id) ON DELETE SET NULL,
  tipo           text        NOT NULL DEFAULT 'observacion',
  -- tipo: 'incidente' | 'observacion' | 'alarma' | 'acceso' | 'otro'
  descripcion    text        NOT NULL,
  ubicacion      text,
  prioridad      text        NOT NULL DEFAULT 'normal',
  -- prioridad: 'normal' | 'alta' | 'critica'
  reportado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  foto_url       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.novedades_seguridad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "novedades_select" ON public.novedades_seguridad
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "novedades_insert" ON public.novedades_seguridad
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "novedades_update" ON public.novedades_seguridad
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "novedades_delete" ON public.novedades_seguridad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_novedades_project  ON public.novedades_seguridad(project_id);
CREATE INDEX IF NOT EXISTS idx_novedades_prioridad ON public.novedades_seguridad(prioridad);
CREATE INDEX IF NOT EXISTS idx_novedades_created  ON public.novedades_seguridad(created_at DESC);

-- ── contratos_arrendamiento ──────────────────────────────────────────────────
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
  -- estado: 'activo' | 'vencido' | 'terminado'
  notas                       text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contratos_arrendamiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contratos_arr_select" ON public.contratos_arrendamiento
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "contratos_arr_insert" ON public.contratos_arrendamiento
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "contratos_arr_update" ON public.contratos_arrendamiento
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "contratos_arr_delete" ON public.contratos_arrendamiento
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_contratos_arr_project ON public.contratos_arrendamiento(project_id);
CREATE INDEX IF NOT EXISTS idx_contratos_arr_unidad  ON public.contratos_arrendamiento(unidad_id);
CREATE INDEX IF NOT EXISTS idx_contratos_arr_estado  ON public.contratos_arrendamiento(estado);
