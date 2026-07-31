-- Fixture mínimo para EJECUTAR la migración 20260731000000 contra un Postgres
-- de verdad. Reproduce solo las columnas que el sellado toca.
--
-- `auth.uid()` es una función de Supabase; aquí se emula leyendo un GUC de
-- sesión (`app.uid`), que es exactamente lo que hace Supabase por debajo con el
-- claim del JWT. Así el test puede "cambiar de usuario" con SET.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

CREATE TABLE public.companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);
CREATE TABLE public.app_users (
  id        uuid PRIMARY KEY,
  full_name text,
  role      text NOT NULL DEFAULT 'operador',
  activo    boolean NOT NULL DEFAULT true
);

-- ── Tablas del catálogo de trazabilidad (subconjunto representativo) ────────
-- registros: el núcleo (lecturas de agua). Sin company_id, como en prod.
CREATE TABLE public.registros (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  cliente_nombre text,
  fecha          timestamptz NOT NULL DEFAULT now(),
  consumo        numeric,
  notas          text,
  deleted_at     timestamptz,
  created_at     timestamptz DEFAULT now()
);

-- programacion_limpieza: hito `ultima_ejecucion` → sello de cierre.
CREATE TABLE public.programacion_limpieza (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  area             text,
  frecuencia       text,
  responsable      text,
  ultima_ejecucion date,
  created_at       timestamptz DEFAULT now()
);

-- checklist_areas: el caso "inspector text" escrito a mano.
CREATE TABLE public.checklist_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  area       text,
  inspector  text,
  notas      text,
  fecha      date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- rondas_seguridad + visitas_control: el par padre/hija sin scope propio.
CREATE TABLE public.rondas_seguridad (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  guardia_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  estado     text NOT NULL DEFAULT 'abierta',
  inicio     timestamptz NOT NULL DEFAULT now(),
  notas      text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.visitas_control (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ronda_id    uuid NOT NULL REFERENCES public.rondas_seguridad(id) ON DELETE CASCADE,
  punto_id    uuid,
  estado      text NOT NULL DEFAULT 'pendiente',
  visitado_en timestamptz,
  notas       text,
  created_at  timestamptz DEFAULT now()
);

-- visitantes: ya trae registrado_por → se sella en modo 'si_nulo'.
CREATE TABLE public.visitantes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  motivo         text,
  registrado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  hora_entrada   timestamptz NOT NULL DEFAULT now(),
  hora_salida    timestamptz,
  created_at     timestamptz DEFAULT now()
);

-- registros_calidad: ya trae created_by → se sella ESA, sin duplicar.
CREATE TABLE public.registros_calidad (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  observaciones text,
  fecha         date DEFAULT CURRENT_DATE,
  created_at    timestamptz DEFAULT now()
);

-- tareas_condominio: hito `fecha_cierre` → cerrado_por.
CREATE TABLE public.tareas_condominio (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  titulo       text,
  descripcion  text,
  estado       text NOT NULL DEFAULT 'abierta',
  fecha_cierre date,
  created_at   timestamptz DEFAULT now()
);

-- Bitácora: la tabla que hoy existe y nadie escribe.
CREATE TABLE public.bitacora_acciones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  usuario_id     uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  usuario_nombre text NOT NULL,
  accion         text NOT NULL,
  modulo         text NOT NULL,
  entidad_id     uuid,
  entidad_desc   text,
  detalles       jsonb,
  ip_address     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- audit_log: la migración lo lee para el backfill.
CREATE TABLE public.audit_log (
  id          bigserial PRIMARY KEY,
  table_name  text NOT NULL,
  record_id   uuid,
  action      text NOT NULL,
  actor_id    uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Tablas del catálogo que la migración espera pero que este fixture no usa en
-- los asserts: se crean mínimas para que el DO loop no las omita en silencio y
-- el test de cobertura (invariante 9) sea significativo.
CREATE TABLE public.gastos_condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE
);
CREATE TABLE public.tickets_mantenimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  reportado_por uuid,
  titulo text
);

-- ── Datos base ─────────────────────────────────────────────────────────────
INSERT INTO public.companies (id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001');

INSERT INTO auth.users (id) VALUES
  ('e0000000-0000-0000-0000-00000000000a'),   -- usuario A (lecturista)
  ('e0000000-0000-0000-0000-00000000000b');   -- usuario B (supervisor)

INSERT INTO public.app_users (id, full_name, role) VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'Ana Lecturista', 'operador'),
  ('e0000000-0000-0000-0000-00000000000b', 'Beto Supervisor', 'admin');
