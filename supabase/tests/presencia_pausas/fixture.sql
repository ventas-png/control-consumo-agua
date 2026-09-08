-- Fixture para EJECUTAR 20260908000000 + 20260908000200 + 20260908000300 contra
-- un Postgres de verdad. Hereda el de `presencia_correccion` —mismas cuentas,
-- mismos expedientes, mismas funciones de aritmética de jornada REALES y no
-- stubs, porque lo que se comprueba son HORAS— y le agrega lo que necesitan las
-- pausas:
--
--   · `registrar_bitacora`, que la migración engancha a las dos tablas nuevas.
--     Aquí escribe en una tabla de traza para poder AFIRMAR que se disparó: un
--     stub mudo dejaría pasar que la bitácora se quedó sin inscribir.
--   · un turno NOCTURNO con su jornada abierta de ayer, que es el caso que
--     obliga a medir las pausas con instantes y no con `time`.
--
-- `auth.uid()` es una función de Supabase; aquí se emula leyendo un GUC de
-- sesión (`app.uid`), que es lo que Supabase hace por debajo con el claim del
-- JWT. Así el test puede "cambiar de usuario" con un SET.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email character varying(255)
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.uid', true), '')::uuid
$$;

-- ── Esquema tocado ──────────────────────────────────────────────────────────
-- `timezone` (20260717110000) es lo que decide EN QUÉ DÍA cae un marcaje.
CREATE TABLE public.companies (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timezone text NOT NULL DEFAULT 'America/Guatemala'
);

CREATE TABLE public.projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  text,
  role       text NOT NULL DEFAULT 'operator',
  activo     boolean NOT NULL DEFAULT true,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL
);

CREATE TABLE public.user_project_assignments (
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE public.personal_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  cargo      text NOT NULL DEFAULT 'conserje',
  estado     text NOT NULL DEFAULT 'activo',
  foto_url   text,
  user_id    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.plantillas_horario (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  nombre                 text NOT NULL,
  hora_inicio            time NOT NULL,
  hora_fin               time NOT NULL,
  tolerancia_entrada_min int  NOT NULL DEFAULT 10
);

CREATE TABLE public.bloques_turno (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  personal_id          uuid NOT NULL REFERENCES public.personal_condominio(id) ON DELETE CASCADE,
  turno                text NOT NULL DEFAULT 'manana',
  fecha                date NOT NULL,
  plantilla_horario_id uuid REFERENCES public.plantillas_horario(id) ON DELETE SET NULL,
  hora_inicio          time,
  hora_fin             time,
  horas_planificadas   numeric(5,2)
);

CREATE TABLE public.ausencias_personal (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_id  uuid NOT NULL REFERENCES public.personal_condominio(id) ON DELETE CASCADE,
  estado       text NOT NULL DEFAULT 'aprobada',
  fecha_inicio date NOT NULL,
  fecha_fin    date NOT NULL
);

CREATE TABLE public.dias_no_laborables (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  fecha          date NOT NULL,
  factor_recargo numeric(4,2),
  paga_recargo   boolean NOT NULL DEFAULT true
);

CREATE TABLE public.presencia_personal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  personal_id   uuid REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  bloque_id     uuid REFERENCES public.bloques_turno(id) ON DELETE SET NULL,
  nombre        text NOT NULL,
  cargo         text,
  fecha         date NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada  time,
  hora_salida   time,
  estado        text NOT NULL DEFAULT 'presente',
  observaciones text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Storage (lo justo para que las policies del bucket se puedan probar) ────
CREATE TABLE storage.buckets (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  public             boolean NOT NULL DEFAULT false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

CREATE TABLE storage.objects (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name      text NOT NULL,
  owner     uuid,
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Misma semántica que la de Supabase: los segmentos de la ruta SIN el archivo.
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- ── Helpers de identidad (stubs con la MISMA semántica que producción) ──────
-- SECURITY DEFINER como en producción (20260518000008 / 20260815000000): leen
-- app_users y el catálogo de permisos, que el rol `authenticated` no puede
-- leer por sí mismo. Sin esto, ejercer las policies como authenticated fallaría
-- por un detalle del fixture y no por la regla que se quiere probar.
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE id = auth.uid() AND role = ANY (ARRAY['super_admin', 'superadmin'])
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

-- Espeja 20260815000000: exento por tier, o proyecto asignado (por la columna
-- legacy o por user_project_assignments).
CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p_project_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid()
        AND (
          u.role = ANY (ARRAY['super_admin','superadmin','company_owner'])
          OR (u.role = 'admin' AND NOT EXISTS (
                SELECT 1 FROM public.user_project_assignments a WHERE a.user_id = u.id))
          OR u.project_id = p_project_id
          OR EXISTS (
                SELECT 1 FROM public.user_project_assignments a
                WHERE a.user_id = u.id AND a.project_id = p_project_id)
        )
    )
$$;

-- ── Aritmética de la jornada: las definiciones REALES ───────────────────────
-- Copiadas literales de 20260820000000 y 20260820000300. No son stubs: las
-- invariantes de este test comprueban HORAS, y un stub mediría el stub.
CREATE OR REPLACE FUNCTION public.turnos_horas_jornada(
  p_inicio time, p_fin time, p_cruza boolean, p_descanso int
) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_inicio IS NULL OR p_fin IS NULL THEN NULL
    ELSE GREATEST(
      ROUND(
        (
          EXTRACT(EPOCH FROM p_fin) - EXTRACT(EPOCH FROM p_inicio)
          + CASE WHEN COALESCE(p_cruza, false) OR p_fin <= p_inicio THEN 86400 ELSE 0 END
        ) / 3600.0
        - COALESCE(p_descanso, 0) / 60.0
      , 2),
      0
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.turnos_horas_nocturnas(
  p_inicio time, p_fin time, p_cruza boolean
) RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH jornada AS (
    SELECT
      EXTRACT(EPOCH FROM p_inicio) / 60.0 AS ini,
      EXTRACT(EPOCH FROM p_fin) / 60.0
        + CASE WHEN COALESCE(p_cruza, false) OR p_fin <= p_inicio THEN 1440 ELSE 0 END AS fin
  ),
  franja (desde, hasta) AS (
    VALUES (0::numeric, 360::numeric), (1200::numeric, 1800::numeric), (2640::numeric, 2880::numeric)
  )
  SELECT CASE
    WHEN p_inicio IS NULL OR p_fin IS NULL THEN NULL
    ELSE ROUND(
      COALESCE(SUM(GREATEST(0, LEAST(j.fin, f.hasta) - GREATEST(j.ini, f.desde))), 0) / 60.0,
      2)
  END
  FROM jornada j CROSS JOIN franja f
$$;

-- Guard de scope de las RPC con p_project_id (20260729000200).
CREATE OR REPLACE FUNCTION public.assert_company_scope(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.is_super_admin() OR p_company_id = public.get_my_company_id()) THEN
    RAISE EXCEPTION 'fuera de la empresa' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE TABLE public.test_permisos (
  user_id        uuid NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    CASE
      WHEN auth.uid() IS NULL THEN false
      WHEN (SELECT role FROM public.app_users WHERE id = auth.uid())
           IN ('super_admin', 'superadmin', 'company_owner', 'admin') THEN true
      ELSE EXISTS (
        SELECT 1 FROM public.test_permisos
        WHERE user_id = auth.uid() AND permission_key = perm_key
      )
    END
$$;

-- ── Bitácora (20260731000100), con traza para poder afirmarla ──────────────
-- La migración inscribe `presencia_pausas` y `presencia_tipos_pausa` con
-- `CREATE TRIGGER ... EXECUTE FUNCTION public.registrar_bitacora(modulo, desc,
-- padre, fk)`. Un stub que no guardara nada haría pasar el test aunque la
-- inscripción se hubiera perdido — y perderla es fácil: un trigger no se hereda
-- por FK, hay que declararlo tabla por tabla.
CREATE TABLE public.bitacora_acciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla      text NOT NULL,
  accion     text NOT NULL,
  modulo     text,
  registro_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.registrar_bitacora()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.bitacora_acciones (tabla, accion, modulo, registro_id)
  VALUES (TG_TABLE_NAME, TG_OP, TG_ARGV[0],
          CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
  RETURN NULL;
END;
$$;

-- ── Datos ───────────────────────────────────────────────────────────────────
-- Una empresa, dos condominios; MARCO es guardia con cuenta y turno de mañana;
-- DINA es conserje con cuenta pero SIN acceso al condominio donde tiene ficha;
-- ANA es personal sin cuenta (el caso mayoritario); ADA administra.
INSERT INTO public.companies (id, timezone) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'America/Guatemala');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a');

INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-00000000000d', 'ada@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000001', 'dina@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000002', 'marco@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000003', 'sin.ficha@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000004', 'nocturno@empresa-a.com'),
  ('e0000000-0000-0000-0000-000000000005', 'luz@empresa-a.com');

INSERT INTO public.app_users (id, full_name, role, activo, company_id, project_id) VALUES
  ('e0000000-0000-0000-0000-00000000000d', 'Ada Admin',      'admin',    true, 'aaaaaaaa-0000-0000-0000-00000000000a', NULL),
  ('e0000000-0000-0000-0000-000000000001', 'Dina Villatoro', 'operator', true, 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000002'),
  ('e0000000-0000-0000-0000-000000000002', 'Marco Sical',    'operator', true, 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000003', 'Sin Ficha',      'operator', true, 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000004', 'Noe Nocturno',   'operator', true, 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000005', 'Luz Jardinera',  'operator', true, 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre, cargo, estado, user_id) VALUES
  ('9e000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Marco Antonio Sical', 'guardia',  'activo',   'e0000000-0000-0000-0000-000000000002'),
  ('9e000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Noe Nocturno',        'guardia',  'activo',   'e0000000-0000-0000-0000-000000000004'),
  ('9e000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Dina Villatoro',      'conserje', 'inactivo', 'e0000000-0000-0000-0000-000000000001'),
  ('9e000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Ana sin cuenta',      'conserje', 'activo',   NULL),
  -- Luz existe solo para ejercer el camino real: marcar COMO `authenticated`.
  ('9e000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001', 'Luz Jardinera',       'jardinero','activo',   'e0000000-0000-0000-0000-000000000005');

-- Marco administra NADA: no tiene ni el permiso del tab. Es justo el caso que
-- el diseño tiene que cubrir.
INSERT INTO public.test_permisos (user_id, permission_key) VALUES
  -- «Sin Ficha» hace de supervisor: ve la asistencia y puede CORREGIR, pero no
  -- anular. Es el reparto que prueba que los dos actos son permisos distintos.
  ('e0000000-0000-0000-0000-000000000003', 'condominios.tab.presencia'),
  ('e0000000-0000-0000-0000-000000000003', 'condominios.tab.presencia.edit');
