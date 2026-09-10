-- Fixture mínimo para EJECUTAR 20260910000001 + 20260910000101 contra un
-- Postgres de verdad. Reproduce sólo lo que la captura autoritativa de lecturas
-- toca: dos empresas, dos proyectos, tarifas (plana, escalonada y dada de
-- baja), contadores, y la RLS real de `registros` para el INSERT.
--
-- `auth.uid()` es de Supabase; aquí se emula leyendo un GUC de sesión
-- (`app.uid`), que es lo que Supabase hace por debajo con el claim del JWT. Así
-- el test puede "cambiar de usuario" con un SET (mismo patrón que
-- supabase/tests/presencia_marcaje y supabase/tests/personal_usuario).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

-- ── Tenancy ─────────────────────────────────────────────────────────────────
CREATE TABLE public.companies (
  id       uuid PRIMARY KEY,
  nombre   text,
  timezone text
);

CREATE TABLE public.projects (
  id         uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  nombre     text
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  company_id uuid REFERENCES public.companies(id),
  role       text NOT NULL DEFAULT 'viewer'
);

CREATE TABLE public.user_project_assignments (
  user_id    uuid NOT NULL,
  project_id uuid NOT NULL
);

CREATE TABLE public.test_permisos (
  user_id uuid NOT NULL,
  permiso text NOT NULL
);

-- ── Padrón de agua ──────────────────────────────────────────────────────────
CREATE TABLE public.clientes (
  id     uuid PRIMARY KEY,
  nombre text
);

CREATE TABLE public.unidades (
  id         uuid PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id),
  cliente_id uuid REFERENCES public.clientes(id),
  nombre     text,
  activo     boolean NOT NULL DEFAULT true
);

CREATE TABLE public.tarifas (
  id               uuid PRIMARY KEY,
  project_id       uuid REFERENCES public.projects(id),
  company_id       uuid REFERENCES public.companies(id),
  nombre           text,
  precio_m3        numeric NOT NULL DEFAULT 0,
  precio_m3_exceso numeric NOT NULL DEFAULT 0,
  canon_fijo       numeric NOT NULL DEFAULT 0,
  consumo_minimo   numeric NOT NULL DEFAULT 0,
  tramos           jsonb,
  activa           boolean NOT NULL DEFAULT true
);

CREATE TABLE public.contadores (
  id                           uuid PRIMARY KEY,
  project_id                   uuid NOT NULL REFERENCES public.projects(id),
  company_id                   uuid REFERENCES public.companies(id),
  unidad_id                    uuid REFERENCES public.unidades(id),
  tarifa_id                    uuid REFERENCES public.tarifas(id),
  numero_serie                 text,
  lectura_inicial              numeric NOT NULL DEFAULT 0,
  fecha_instalacion            date,
  cantidad_derecho_servicio_m3 numeric,
  activo                       boolean NOT NULL DEFAULT true
);

-- `registros` con las columnas que toca la captura y la factura. Los tipos son
-- los de producción (numeric SIN escala en el dinero: por eso el redondeo del
-- contrato tiene que hacerlo el cálculo y no la columna).
CREATE TABLE public.registros (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id             uuid,
  cliente_nombre         text,
  contador_id            uuid REFERENCES public.contadores(id),
  project_id             uuid,
  fecha                  timestamptz NOT NULL,
  lectura_anterior       numeric,
  lectura_actual         numeric,
  consumo                numeric,
  tarifa_aplicada        numeric,
  tarifa_exceso_aplicada numeric,
  canon_aplicado         numeric,
  monto_calculado        numeric,
  tipo_cobro             text,
  estado                 text DEFAULT 'pendiente',
  monto_pagado           numeric,
  fecha_pago             timestamptz,
  mes                    text,
  fecha_lectura_anterior timestamptz,
  dias_servicio          integer,
  notas                  text,
  gps                    jsonb,
  foto                   text,
  factura_estado         text,
  fecha_vencimiento      date,
  iva_tasa               numeric,
  iva_monto              numeric,
  monto_con_iva          numeric,
  total_a_pagar          numeric,
  mora_monto             numeric,
  mora_aplicada_at       timestamptz,
  regla_mora_id          uuid,
  emitida_at             timestamptz,
  pagada_at              timestamptz,
  vencida_at             timestamptz,
  anulada_at             timestamptz,
  created_at             timestamptz DEFAULT now(),
  creado_por             uuid,
  deleted_at             timestamptz,
  deleted_by             uuid,
  CONSTRAINT registros_consumo_no_negativo CHECK (consumo IS NULL OR consumo >= 0)
);

-- La llave natural anti-duplicado de 20260717080000, tal cual.
CREATE UNIQUE INDEX uq_registros_llave_natural
  ON public.registros (contador_id, lectura_actual, fecha)
  WHERE deleted_at IS NULL AND contador_id IS NOT NULL;

-- El sellado de `creado_por` de 20260731000000 (modo 'forzar'), que es de lo
-- que cuelga la búsqueda del reintento idempotente.
CREATE OR REPLACE FUNCTION public.sellar_actor_test() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.creado_por := auth.uid(); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_sellar_creado_por BEFORE INSERT OR UPDATE ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor_test();

-- ── Helpers de RLS (los reales, reducidos a lo que la prueba ejerce) ────────
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.role FROM public.app_users u WHERE u.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT u.company_id FROM public.app_users u WHERE u.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(public.current_user_role() = 'super_admin', false)
$$;

CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_project_assignments a
     WHERE a.user_id = auth.uid() AND a.project_id = p_project_id
  )
$$;

CREATE OR REPLACE FUNCTION public.user_is_project_exempt() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.current_user_role() = ANY (ARRAY['super_admin', 'company_owner'])
      OR (public.current_user_role() = 'admin'
          AND NOT EXISTS (SELECT 1 FROM public.user_project_assignments a
                           WHERE a.user_id = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT p_project_id IS NULL
      OR public.user_is_project_exempt()
      OR public.user_has_project_access(p_project_id)
$$;

CREATE OR REPLACE FUNCTION public.user_has_permission(p_permiso text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.current_user_role() = ANY (ARRAY['super_admin', 'company_owner', 'admin'])
      OR EXISTS (SELECT 1 FROM public.test_permisos t
                  WHERE t.user_id = auth.uid() AND t.permiso = p_permiso)
$$;

-- ── La policy real de INSERT sobre registros (20260610000808) ───────────────
ALTER TABLE public.registros ENABLE ROW LEVEL SECURITY;

CREATE POLICY registros_insert ON public.registros
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
               WHERE upa.user_id = (SELECT auth.uid()) AND upa.project_id = registros.project_id)
    OR (
      project_id IN (SELECT p.id FROM public.projects p WHERE p.company_id = (SELECT public.get_my_company_id()))
      AND (
        public.current_user_role() = ANY (ARRAY['admin','company_owner','operator','operador'])
        OR (SELECT public.user_has_permission('agua.lecturas.create'))
      )
    )
  );

CREATE POLICY registros_select ON public.registros
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (
      (SELECT public.user_has_permission('agua.lecturas.view'))
      AND project_id IN (SELECT p.id FROM public.projects p
                          WHERE p.company_id = (SELECT public.get_my_company_id()))
      AND public.can_access_project(project_id)
    )
  );

-- ── Datos ───────────────────────────────────────────────────────────────────
-- Dos empresas: la de la prueba (ACME) y la vecina (OTRA), para el cruce.
INSERT INTO public.companies (id, nombre, timezone) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'ACME', 'America/Guatemala'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'OTRA', 'America/Guatemala');

INSERT INTO public.projects (id, company_id, nombre) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Condominio Uno'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Condominio Dos'),
  ('22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Ajeno');

INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-00000000000d'),  -- Ada   · company_owner de ACME
  ('e0000000-0000-0000-0000-000000000001'),  -- Lucía · operadora, sólo Condominio Uno
  ('e0000000-0000-0000-0000-000000000002'),  -- Beto  · captura pero NO ve lecturas
  ('e0000000-0000-0000-0000-000000000003'),  -- Nadia · de la empresa vecina
  ('e0000000-0000-0000-0000-000000000004');  -- Curro · de ACME, sin asignaciones ni permisos

INSERT INTO public.app_users (id, company_id, role) VALUES
  ('e0000000-0000-0000-0000-00000000000d', 'aaaaaaaa-0000-0000-0000-00000000000a', 'company_owner'),
  ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'viewer'),
  ('e0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'viewer'),
  ('e0000000-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-00000000000b', 'company_owner'),
  ('e0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a', 'viewer');

-- Lucía y Beto son "Operador Agua": role viewer, permiso RBAC de captura.
INSERT INTO public.user_project_assignments (user_id, project_id) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001');

INSERT INTO public.test_permisos (user_id, permiso) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'agua.lecturas.create'),
  ('e0000000-0000-0000-0000-000000000001', 'agua.lecturas.view'),
  -- Beto captura y NO puede leer la tabla: es el caso que rompería la lectura
  -- vigente si agua_lectura_contexto fuese SECURITY INVOKER.
  ('e0000000-0000-0000-0000-000000000002', 'agua.lecturas.create');

INSERT INTO public.clientes (id, nombre) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'Familia Pérez'),
  ('c1000000-0000-0000-0000-000000000002', 'Familia López');

INSERT INTO public.unidades (id, project_id, cliente_id, nombre) VALUES
  ('d1000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Casa 1'),
  ('d1000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'Casa 2'),
  ('d2000000-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', NULL, 'Casa ajena');

-- Tarifa PLANA con mínimo, exceso y canon; tarifa ESCALONADA; tarifa DE BAJA.
INSERT INTO public.tarifas (id, project_id, company_id, nombre, precio_m3, precio_m3_exceso, canon_fijo, consumo_minimo, tramos, activa) VALUES
  ('7a000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Plana',      3.75, 6.50, 20.00, 5, NULL, true),
  ('7a000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Escalonada', 0,    0,    15.00, 3,
     '[{"desde_m3":0,"hasta_m3":10,"precio_m3":2.5},{"desde_m3":10,"hasta_m3":30,"precio_m3":4.25},{"desde_m3":30,"hasta_m3":null,"precio_m3":9}]'::jsonb, true),
  ('7a000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'De baja',    5.00, 0,    0,     0, NULL, false),
  ('7a000000-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Ajena',      1.00, 0,    0,     0, NULL, true);

INSERT INTO public.contadores (id, project_id, company_id, unidad_id, tarifa_id, numero_serie, lectura_inicial, fecha_instalacion, cantidad_derecho_servicio_m3, activo) VALUES
  -- M-1 · el contador de trabajo: tarifa plana, derecho de servicio 20 m³.
  ('c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'M-1', 100, '2026-01-15', 20, true),
  -- M-2 · escalonada, sin lecturas: la PRIMERA lectura y su carrera.
  ('c0000000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', '7a000000-0000-0000-0000-000000000002', 'M-2', 0,   '2026-02-01', NULL, true),
  -- M-3 · con la tarifa dada de baja.
  ('c0000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000003', 'M-3', 0,   '2026-01-01', NULL, true),
  -- M-4 · sin tarifa asignada.
  ('c0000000-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', NULL, 'M-4', 0, '2026-01-01', NULL, true),
  -- M-5 · del proyecto Dos, al que Lucía NO está asignada.
  ('c0000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', NULL, '7a000000-0000-0000-0000-000000000001', 'M-5', 0, '2026-01-01', NULL, true),
  -- M-9 · de la empresa vecina.
  ('c0000000-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'd2000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000009', 'M-9', 0, '2026-01-01', NULL, true),
  -- M-0 · inactivo.
  ('c0000000-0000-0000-0000-000000000000', '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001', 'M-0', 0, '2026-01-01', NULL, false);
