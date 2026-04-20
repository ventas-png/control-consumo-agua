-- Condominios Fase 3
-- Tablas: asambleas, puntos_asamblea, votos_asamblea,
--         contratos_proveedores, objetos_perdidos, agenda_operativa

-- ── asambleas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asambleas (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo            text        NOT NULL,
  tipo              text        NOT NULL DEFAULT 'ordinaria',
  -- tipo: 'ordinaria' | 'extraordinaria'
  fecha             date        NOT NULL,
  hora_inicio       time        NOT NULL,
  hora_fin          time,
  lugar             text,
  estado            text        NOT NULL DEFAULT 'programada',
  -- estado: 'programada' | 'en_curso' | 'finalizada' | 'cancelada'
  quorum_requerido  int         NOT NULL DEFAULT 50,
  quorum_alcanzado  int,
  acta              text,
  convocado_por     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.asambleas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asambleas_select" ON public.asambleas
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "asambleas_insert" ON public.asambleas
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = ANY(ARRAY['company_owner','admin'])
        AND company_id = get_my_company_id())
  );

CREATE POLICY "asambleas_update" ON public.asambleas
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE POLICY "asambleas_delete" ON public.asambleas
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_asambleas_project ON public.asambleas(project_id);
CREATE INDEX IF NOT EXISTS idx_asambleas_fecha   ON public.asambleas(fecha DESC);

-- ── puntos_asamblea ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.puntos_asamblea (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asamblea_id  uuid        NOT NULL REFERENCES public.asambleas(id) ON DELETE CASCADE,
  orden        int         NOT NULL DEFAULT 1,
  titulo       text        NOT NULL,
  descripcion  text,
  tipo         text        NOT NULL DEFAULT 'informativo',
  -- tipo: 'informativo' | 'votacion' | 'debate'
  resultado    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.puntos_asamblea ENABLE ROW LEVEL SECURITY;

CREATE POLICY "puntos_select" ON public.puntos_asamblea
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asambleas a
    WHERE a.id = asamblea_id AND (a.company_id = get_my_company_id() OR is_super_admin())
  ));

CREATE POLICY "puntos_insert" ON public.puntos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.asambleas a
    WHERE a.id = asamblea_id
      AND (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND a.company_id = get_my_company_id()))
  ));

CREATE POLICY "puntos_update" ON public.puntos_asamblea
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asambleas a
    WHERE a.id = asamblea_id AND (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND a.company_id = get_my_company_id()))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.asambleas a
    WHERE a.id = asamblea_id AND (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND a.company_id = get_my_company_id()))
  ));

CREATE POLICY "puntos_delete" ON public.puntos_asamblea
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.asambleas a
    WHERE a.id = asamblea_id AND (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND a.company_id = get_my_company_id()))
  ));

CREATE INDEX IF NOT EXISTS idx_puntos_asamblea ON public.puntos_asamblea(asamblea_id, orden);

-- ── votos_asamblea ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.votos_asamblea (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  punto_id        uuid        NOT NULL REFERENCES public.puntos_asamblea(id) ON DELETE CASCADE,
  unidad_id       uuid        NOT NULL REFERENCES public.unidades(id) ON DELETE CASCADE,
  voto            text        NOT NULL,
  -- voto: 'a_favor' | 'en_contra' | 'abstencion'
  registrado_por  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (punto_id, unidad_id)
);

ALTER TABLE public.votos_asamblea ENABLE ROW LEVEL SECURITY;

CREATE POLICY "votos_select" ON public.votos_asamblea
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    WHERE p.id = punto_id AND (a.company_id = get_my_company_id() OR is_super_admin())
  ));

CREATE POLICY "votos_insert" ON public.votos_asamblea
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    WHERE p.id = punto_id AND (a.company_id = get_my_company_id() OR is_super_admin())
  ));

CREATE POLICY "votos_update" ON public.votos_asamblea
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    WHERE p.id = punto_id AND (a.company_id = get_my_company_id() OR is_super_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    WHERE p.id = punto_id AND (a.company_id = get_my_company_id() OR is_super_admin())
  ));

CREATE POLICY "votos_delete" ON public.votos_asamblea
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND EXISTS (
    SELECT 1 FROM public.puntos_asamblea p
    JOIN public.asambleas a ON a.id = p.asamblea_id
    WHERE p.id = punto_id AND a.company_id = get_my_company_id()
  )));

CREATE INDEX IF NOT EXISTS idx_votos_punto  ON public.votos_asamblea(punto_id);
CREATE INDEX IF NOT EXISTS idx_votos_unidad ON public.votos_asamblea(unidad_id);

-- ── contratos_proveedores ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contratos_proveedores (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  proveedor_nombre    text        NOT NULL,
  proveedor_contacto  text,
  proveedor_telefono  text,
  proveedor_email     text,
  servicio            text        NOT NULL DEFAULT 'otro',
  -- servicio: 'limpieza' | 'jardineria' | 'seguridad' | 'mantenimiento' | 'elevadores' | 'piscina' | 'otro'
  descripcion         text,
  monto_mensual       numeric(12,2),
  fecha_inicio        date        NOT NULL,
  fecha_fin           date,
  estado              text        NOT NULL DEFAULT 'activo',
  -- estado: 'activo' | 'vencido' | 'terminado'
  documento_url       text,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contratos_proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contratos_prov_select" ON public.contratos_proveedores
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "contratos_prov_insert" ON public.contratos_proveedores
  FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE POLICY "contratos_prov_update" ON public.contratos_proveedores
  FOR UPDATE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()))
  WITH CHECK (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE POLICY "contratos_prov_delete" ON public.contratos_proveedores
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_contratos_prov_project ON public.contratos_proveedores(project_id);
CREATE INDEX IF NOT EXISTS idx_contratos_prov_estado  ON public.contratos_proveedores(estado);

-- ── objetos_perdidos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.objetos_perdidos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  descripcion      text        NOT NULL,
  lugar_encontrado text,
  fecha_encontrado date        NOT NULL DEFAULT CURRENT_DATE,
  estado           text        NOT NULL DEFAULT 'en_custodia',
  -- estado: 'en_custodia' | 'reclamado' | 'donado' | 'descartado'
  reclamado_por    text,
  fecha_reclamo    date,
  foto_url         text,
  registrado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  notas            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.objetos_perdidos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "objetos_select" ON public.objetos_perdidos
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "objetos_insert" ON public.objetos_perdidos
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "objetos_update" ON public.objetos_perdidos
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "objetos_delete" ON public.objetos_perdidos
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_objetos_project ON public.objetos_perdidos(project_id);
CREATE INDEX IF NOT EXISTS idx_objetos_estado  ON public.objetos_perdidos(estado);

-- ── agenda_operativa ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agenda_operativa (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  titulo       text        NOT NULL,
  descripcion  text,
  tipo         text        NOT NULL DEFAULT 'tarea',
  -- tipo: 'tarea' | 'evento' | 'mantenimiento' | 'reunion' | 'otro'
  fecha        date        NOT NULL,
  hora_inicio  time,
  hora_fin     time,
  estado       text        NOT NULL DEFAULT 'pendiente',
  -- estado: 'pendiente' | 'en_curso' | 'completado' | 'cancelado'
  asignado_a   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  recurrente   boolean     NOT NULL DEFAULT false,
  notas        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agenda_operativa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agenda_select" ON public.agenda_operativa
  FOR SELECT TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "agenda_insert" ON public.agenda_operativa
  FOR INSERT TO authenticated
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "agenda_update" ON public.agenda_operativa
  FOR UPDATE TO authenticated
  USING (company_id = get_my_company_id() OR is_super_admin())
  WITH CHECK (company_id = get_my_company_id() OR is_super_admin());

CREATE POLICY "agenda_delete" ON public.agenda_operativa
  FOR DELETE TO authenticated
  USING (is_super_admin() OR (current_user_role() = ANY(ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

CREATE INDEX IF NOT EXISTS idx_agenda_project ON public.agenda_operativa(project_id);
CREATE INDEX IF NOT EXISTS idx_agenda_fecha   ON public.agenda_operativa(fecha);
CREATE INDEX IF NOT EXISTS idx_agenda_estado  ON public.agenda_operativa(estado);
