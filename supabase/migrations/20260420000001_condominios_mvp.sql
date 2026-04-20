-- MVP Módulo Condominios
-- Tablas: cuotas_condominio, visitantes, amenidades, reservas_amenidades,
--         tickets_mantenimiento, anuncios_comunidad
-- Extensión de projects con tipo y segmento

-- ── Extensión de projects ────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS tipo     text NOT NULL DEFAULT 'agua',
  ADD COLUMN IF NOT EXISTS segmento text;
-- tipo: 'agua' | 'condominio' | 'mixto'
-- segmento: 'residencial' | 'comercial' | 'mixto' | 'hotelero' | 'vacacional' | 'industrial'

-- ── cuotas_condominio ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cuotas_condominio (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id     uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  concepto      text        NOT NULL DEFAULT 'mantenimiento',
  -- concepto: 'mantenimiento' | 'extraordinaria' | 'CAM' | 'otro'
  monto         numeric(12,2) NOT NULL,
  periodo       text        NOT NULL,  -- 'YYYY-MM'
  fecha_vencimiento date,
  estado        text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'pagado' | 'moroso'
  pago_id       uuid        REFERENCES public.pagos(id) ON DELETE SET NULL,
  notas         text,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cuotas_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cuotas_condominio_select" ON public.cuotas_condominio
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "cuotas_condominio_insert" ON public.cuotas_condominio
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "cuotas_condominio_update" ON public.cuotas_condominio
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "cuotas_condominio_delete" ON public.cuotas_condominio
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_project  ON public.cuotas_condominio(project_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_unidad   ON public.cuotas_condominio(unidad_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_periodo  ON public.cuotas_condominio(periodo);
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_estado   ON public.cuotas_condominio(estado);

-- ── visitantes ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visitantes (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id            uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  nombre               text        NOT NULL,
  identificacion       text,
  placa_vehiculo       text,
  motivo               text,
  pre_autorizado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  hora_entrada         timestamptz NOT NULL DEFAULT now(),
  hora_salida          timestamptz,
  foto_url             text,
  registrado_por       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  notas                text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.visitantes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visitantes_select" ON public.visitantes
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "visitantes_insert" ON public.visitantes
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "visitantes_update" ON public.visitantes
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "visitantes_delete" ON public.visitantes
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_visitantes_project  ON public.visitantes(project_id);
CREATE INDEX IF NOT EXISTS idx_visitantes_unidad   ON public.visitantes(unidad_id);
CREATE INDEX IF NOT EXISTS idx_visitantes_entrada  ON public.visitantes(hora_entrada DESC);

-- ── amenidades ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.amenidades (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre           text        NOT NULL,
  descripcion      text,
  capacidad_max    int,
  horario_inicio   time,
  horario_fin      time,
  requiere_deposito boolean    NOT NULL DEFAULT false,
  monto_deposito   numeric(10,2),
  activo           boolean     NOT NULL DEFAULT true,
  foto_url         text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.amenidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "amenidades_select" ON public.amenidades
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "amenidades_insert" ON public.amenidades
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "amenidades_update" ON public.amenidades
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

CREATE POLICY "amenidades_delete" ON public.amenidades
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_amenidades_project ON public.amenidades(project_id);

-- ── reservas_amenidades ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reservas_amenidades (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  amenidad_id     uuid        NOT NULL REFERENCES public.amenidades(id) ON DELETE CASCADE,
  unidad_id       uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  cliente_id      uuid        REFERENCES public.clientes(id) ON DELETE SET NULL,
  fecha           date        NOT NULL,
  hora_inicio     time        NOT NULL,
  hora_fin        time        NOT NULL,
  num_invitados   int         NOT NULL DEFAULT 0,
  estado          text        NOT NULL DEFAULT 'confirmada',
  -- estado: 'confirmada' | 'cancelada' | 'pendiente'
  deposito_pagado boolean     NOT NULL DEFAULT false,
  notas           text,
  created_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reservas_amenidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reservas_amenidades_select" ON public.reservas_amenidades
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "reservas_amenidades_insert" ON public.reservas_amenidades
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "reservas_amenidades_update" ON public.reservas_amenidades
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "reservas_amenidades_delete" ON public.reservas_amenidades
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_reservas_amenidad ON public.reservas_amenidades(amenidad_id);
CREATE INDEX IF NOT EXISTS idx_reservas_unidad   ON public.reservas_amenidades(unidad_id);
CREATE INDEX IF NOT EXISTS idx_reservas_fecha    ON public.reservas_amenidades(fecha);

-- ── tickets_mantenimiento ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tickets_mantenimiento (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id        uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  tipo             text        NOT NULL DEFAULT 'correctivo',
  -- tipo: 'preventivo' | 'correctivo'
  titulo           text        NOT NULL,
  descripcion      text,
  prioridad        text        NOT NULL DEFAULT 'media',
  -- prioridad: 'baja' | 'media' | 'alta' | 'urgente'
  estado           text        NOT NULL DEFAULT 'abierto',
  -- estado: 'abierto' | 'en_proceso' | 'resuelto' | 'cerrado'
  asignado_a       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reportado_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  cliente_id       uuid        REFERENCES public.clientes(id) ON DELETE SET NULL,
  foto_urls        jsonb       NOT NULL DEFAULT '[]',
  costo_estimado   numeric(10,2),
  costo_real       numeric(10,2),
  fecha_limite     date,
  fecha_cierre     timestamptz,
  notas_cierre     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tickets_mantenimiento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tickets_mantenimiento_select" ON public.tickets_mantenimiento
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "tickets_mantenimiento_insert" ON public.tickets_mantenimiento
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "tickets_mantenimiento_update" ON public.tickets_mantenimiento
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "tickets_mantenimiento_delete" ON public.tickets_mantenimiento
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_tickets_mant_project  ON public.tickets_mantenimiento(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_mant_estado   ON public.tickets_mantenimiento(estado);
CREATE INDEX IF NOT EXISTS idx_tickets_mant_prioridad ON public.tickets_mantenimiento(prioridad);
CREATE INDEX IF NOT EXISTS idx_tickets_mant_unidad   ON public.tickets_mantenimiento(unidad_id);

-- ── anuncios_comunidad ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.anuncios_comunidad (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo          text        NOT NULL,
  contenido       text        NOT NULL,
  tipo            text        NOT NULL DEFAULT 'aviso',
  -- tipo: 'aviso' | 'urgente' | 'evento' | 'mantenimiento'
  publicado_por   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha_evento    date,
  activo          boolean     NOT NULL DEFAULT true,
  foto_url        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.anuncios_comunidad ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anuncios_comunidad_select" ON public.anuncios_comunidad
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "anuncios_comunidad_insert" ON public.anuncios_comunidad
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin','operator'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "anuncios_comunidad_update" ON public.anuncios_comunidad
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
    OR publicado_por = (SELECT auth.uid())
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
    OR publicado_por = (SELECT auth.uid())
  );

CREATE POLICY "anuncios_comunidad_delete" ON public.anuncios_comunidad
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_anuncios_project ON public.anuncios_comunidad(project_id);
CREATE INDEX IF NOT EXISTS idx_anuncios_tipo    ON public.anuncios_comunidad(tipo);
CREATE INDEX IF NOT EXISTS idx_anuncios_activo  ON public.anuncios_comunidad(activo);
