-- Fixture para EJECUTAR 20260905000300 (materializar rutinas) contra un
-- Postgres de verdad. Reproduce el estado anterior a la serie 20260904*, y el
-- run.sh aplica encima las migraciones REALES 20260904000000, 000100 y
-- 20260905000200 — de ahí salen el catálogo extendido, las anclas de tenant y
-- las propias rutinas, en vez de copiarlas a mano aquí (que es como los
-- fixtures se desincronizan del repo).
--
-- `bloques_turno` y `tareas_bloque` se declaran YA con lo que les dejó
-- 20260905000100 (paridad): aplicar esa migración exigiría media serie de
-- turnos y lo que aquí importa es el esquema resultante, no volver a probarla —
-- eso ya lo hace supabase/tests/tareas_bloque_paridad.
--
-- `plantillas_horario` se declara aquí, literal de 20260820000000: ninguna de
-- las migraciones que aplica el run.sh la crea, y la FK compuesta de
-- rutinas_limpieza apunta a ella.
--
-- Dos empresas y tres proyectos: el aislamiento cross-tenant y el cross-project
-- dentro de la MISMA empresa se prueban por separado — son fallos distintos y
-- el segundo es el que una RLS por empresa no ve.
--
-- `auth.uid()` se emula leyendo un GUC de sesión (`app.uid`), igual que en
-- supabase/tests/turnos/fixture.sql.

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
  id         uuid PRIMARY KEY,
  full_name  text,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'operador',
  activo     boolean NOT NULL DEFAULT true
);

-- ── Helpers de identidad (SECURITY DEFINER como en prod, 20260518000008) ─────
GRANT USAGE ON SCHEMA auth TO PUBLIC;

CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.app_users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.current_user_role() IN ('super_admin', 'superadmin'), false)
$$;

CREATE TABLE public.permissions (
  key         text PRIMARY KEY,
  category    text,
  label       text,
  description text
);
CREATE TABLE public.role_permissions (
  role_id        uuid NOT NULL,
  permission_key text NOT NULL,
  effect         text NOT NULL DEFAULT 'allow',
  PRIMARY KEY (role_id, permission_key)
);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(public.current_user_role() IN
      ('super_admin', 'superadmin', 'company_owner', 'admin'), false)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      WHERE ur.user_id = auth.uid()
        AND rp.permission_key = perm_key
        AND rp.effect = 'allow'
    )
$$;

-- ── Trazabilidad (copia literal de 20260731000000) ──────────────────────────
CREATE OR REPLACE FUNCTION public.sellar_actor()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_modo text := COALESCE(TG_ARGV[1], 'forzar');
  v_uid  uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_uid IS NOT NULL AND (v_modo = 'forzar' OR to_jsonb(NEW)->>v_col IS NULL) THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, v_uid));
    END IF;
  ELSE
    IF to_jsonb(NEW)->>v_col IS DISTINCT FROM to_jsonb(OLD)->>v_col THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, to_jsonb(OLD)->>v_col));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sellar_cierre()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_hito  text := TG_ARGV[0];
  v_actor text := TG_ARGV[1];
  v_uid   uuid := auth.uid();
  v_old   text := to_jsonb(OLD)->>v_hito;
  v_new   text := to_jsonb(NEW)->>v_hito;
BEGIN
  IF v_uid IS NOT NULL
     AND COALESCE(v_old, 'false') IN ('', 'false')
     AND COALESCE(v_new, 'false') NOT IN ('', 'false') THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(v_actor, v_uid));
  END IF;
  RETURN NEW;
END;
$$;

-- ── Tablas del módulo, en su estado ANTERIOR a la serie 20260904* ───────────

CREATE TABLE public.personal_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre     text NOT NULL,
  cargo      text NOT NULL DEFAULT 'conserje',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.areas_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  nombre     text NOT NULL,
  icono      text NOT NULL DEFAULT '📍',
  orden      int  NOT NULL DEFAULT 0,
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.areas_condominio ENABLE ROW LEVEL SECURITY;
-- La legada que 20260904000000 viene a retirar.
CREATE POLICY "company_rw_areas" ON public.areas_condominio
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE TABLE public.plantillas_tarea_cargo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id),
  project_id    uuid NOT NULL REFERENCES public.projects(id),
  cargo         text NOT NULL,
  titulo        text NOT NULL,
  descripcion   text,
  icono         text NOT NULL DEFAULT '✅',
  orden         int  NOT NULL DEFAULT 0,
  area_id       uuid REFERENCES public.areas_condominio(id),
  requiere_foto boolean NOT NULL DEFAULT false,
  activo        boolean NOT NULL DEFAULT true,
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.plantillas_tarea_cargo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_rw_plantillas_cargo" ON public.plantillas_tarea_cargo
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- Las dos que 20260904000000 necesita para su backfill y su cambio de FK.
CREATE TABLE public.programacion_limpieza (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  area              text NOT NULL,
  frecuencia        text NOT NULL DEFAULT 'semanal',
  responsable       text,
  ultima_ejecucion  date,
  proxima_ejecucion date,
  estado            text NOT NULL DEFAULT 'pendiente',
  activo            boolean NOT NULL DEFAULT true,
  notas             text,
  personal_id       uuid REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  turno             text,
  cargo             text,
  orden             int NOT NULL DEFAULT 0,
  requiere_foto     boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.programacion_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prog_limpieza_rw" ON public.programacion_limpieza
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE TABLE public.ejecuciones_limpieza (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  programacion_id uuid NOT NULL REFERENCES public.programacion_limpieza(id) ON DELETE CASCADE,
  fecha           date NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente',
  foto_urls       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ejecuciones_limpieza ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ejec_limpieza_rw" ON public.ejecuciones_limpieza
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- plantillas_horario, literal de 20260820000000: ninguna migración de las que
-- aplica el run.sh la crea, y la FK compuesta de rutinas_limpieza la necesita.
CREATE TABLE public.plantillas_horario (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre                 text        NOT NULL,
  codigo                 text,
  turno                  text        NOT NULL DEFAULT 'manana',
  hora_inicio            time        NOT NULL,
  hora_fin               time        NOT NULL,
  cruza_medianoche       boolean     NOT NULL DEFAULT false,
  minutos_descanso       int         NOT NULL DEFAULT 0,
  horas_jornada          numeric(5,2),
  tolerancia_entrada_min int         NOT NULL DEFAULT 10,
  color                  text,
  activo                 boolean     NOT NULL DEFAULT true,
  notas                  text,
  creado_por             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plantillas_horario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plantillas_horario_rw" ON public.plantillas_horario
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());


-- ── assert_company_scope, literal de 20260729000200 ─────────────────────────
-- La RPC es SECURITY DEFINER y se salta la RLS: este guard ES el control.
CREATE OR REPLACE FUNCTION public.assert_company_scope(p_company_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (
    public.is_super_admin()
    OR p_company_id = public.get_my_company_id()
    OR COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ── bloques_turno y tareas_bloque, con lo que les dejó 20260905000100 ───────
CREATE TABLE public.bloques_turno (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id),
  project_id           uuid NOT NULL REFERENCES public.projects(id),
  personal_id          uuid NOT NULL REFERENCES public.personal_condominio(id),
  plantilla_horario_id uuid REFERENCES public.plantillas_horario(id) ON DELETE SET NULL,
  turno                text NOT NULL DEFAULT 'manana',
  fecha                date NOT NULL,
  estado               text NOT NULL DEFAULT 'pendiente',
  iniciado_en          timestamptz,
  cerrado_en           timestamptz,
  origen               text NOT NULL DEFAULT 'manual',
  created_at           timestamptz DEFAULT now()
);
ALTER TABLE public.bloques_turno ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bloques_turno_rw" ON public.bloques_turno
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE TABLE public.tareas_bloque (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bloque_id        uuid NOT NULL REFERENCES public.bloques_turno(id) ON DELETE CASCADE,
  plantilla_id     uuid REFERENCES public.plantillas_tarea_cargo(id),
  titulo           text NOT NULL,
  descripcion      text,
  area_id          uuid REFERENCES public.areas_condominio(id),
  orden            int  NOT NULL DEFAULT 0,
  requiere_foto    boolean NOT NULL DEFAULT false,
  estado           text NOT NULL DEFAULT 'pendiente',
  completada_en    timestamptz,
  completado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  evidencia_texto  text,
  foto_urls        jsonb NOT NULL DEFAULT '[]',
  notas_operativo  text,
  novedad          text,
  prioridad        text,
  requiere_mantenimiento boolean NOT NULL DEFAULT false,
  anulada_en       timestamptz,
  anulada_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  motivo_anulacion text,
  created_at       timestamptz DEFAULT now()
);
-- El índice de 20260905000100 que hace idempotente la materialización.
CREATE UNIQUE INDEX uq_tareas_bloque_plantilla
  ON public.tareas_bloque(bloque_id, plantilla_id) WHERE plantilla_id IS NOT NULL;
ALTER TABLE public.tareas_bloque ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tareas_bloque_rw" ON public.tareas_bloque
  USING (EXISTS (SELECT 1 FROM public.bloques_turno b
                 WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bloques_turno b
                      WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()));
-- ── Datos base ──────────────────────────────────────────────────────────────
-- Empresa 1 con DOS proyectos (P1, P1B) para separar el aislamiento por
-- proyecto del aislamiento por empresa; empresa 2 con uno (P2).
INSERT INTO public.companies (id) VALUES
  ('c0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002');

INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');

INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-0000-0000-00000000000a'),   -- limpieza  (empresa 1)
  ('a0000000-0000-0000-0000-00000000000b'),   -- sin permiso (empresa 1)
  ('a0000000-0000-0000-0000-00000000000c'),   -- limpieza  (empresa 2)
  ('a0000000-0000-0000-0000-00000000000d');   -- owner     (empresa 1)

INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Operador limpieza E1', 'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000b', 'Sin permiso E1',       'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000c', 'Operador limpieza E2', 'c0000000-0000-0000-0000-000000000002', 'operador'),
  ('a0000000-0000-0000-0000-00000000000d', 'Dueña E1',             'c0000000-0000-0000-0000-000000000001', 'company_owner');

-- Rol «Operaciones» con el permiso del tab Limpieza y NADA del módulo Seguridad.
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('40000000-0000-0000-0000-000000000004', 'condominios.tab.prog_limpieza', 'allow');

INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-000000000004');
-- El usuario ...000b queda SIN rol a propósito: es el control negativo.

-- Áreas. La de P1B es homónima de la de P1: sirve para probar que el UNIQUE de
-- rutinas es por proyecto y que la FK compuesta no deja cruzarlas.
INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Piscina'),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Lobby'),
  ('e0000000-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000001b', 'Piscina'),
  ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'Piscina');

-- Actividades del catálogo. `cargo` = 'limpieza' para que el backfill de
-- servicio de 20260904000100 las clasifique sin ambigüedad.
INSERT INTO public.plantillas_tarea_cargo (id, company_id, project_id, cargo, titulo) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'limpieza', 'Barrer el borde'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'limpieza', 'Recoger hojas'),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'limpieza', 'Revisar cloro'),
  -- MISMA empresa, OTRO proyecto: el caso que una RLS por empresa no distingue.
  ('d0000000-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000001b', 'limpieza', 'Barrer el borde (P1B)'),
  -- Otra empresa.
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000002', 'limpieza', 'Barrer el borde (E2)');

-- Jornadas.
INSERT INTO public.plantillas_horario (id, company_id, project_id, nombre, hora_inicio, hora_fin) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Matutina', '06:00', '14:00'),
  ('f0000000-0000-0000-0000-00000000001b', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-00000000001b', 'Matutina P1B', '06:00', '14:00');

-- Una programación histórica cualquiera: 20260904000000 corre su backfill sobre
-- esta tabla y el fixture no debe dejarla vacía (un backfill sobre cero filas
-- no demuestra nada, y aquí solo necesitamos que la migración aplique limpia).
INSERT INTO public.programacion_limpieza (id, company_id, project_id, area) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Piscina');

-- Bloques de turno. El de la jornada matutina es el que debe recibir la rutina;
-- el cerrado y el completado son los controles de "no se toca lo terminado".
INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'Ana');

INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, plantilla_horario_id, fecha, estado) VALUES
  -- En rango y abierto: recibe.
  ('70000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', '2026-09-10', 'pendiente'),
  -- En rango pero YA COMPLETADO: no recibe.
  ('70000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', '2026-09-11', 'completado'),
  -- FUERA de rango: no recibe.
  ('70000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', '2026-12-01', 'pendiente'),
  -- SIN jornada: no empareja con ninguna rutina.
  ('70000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   NULL, '2026-09-10', 'pendiente');

-- Bloque cerrado por `cerrado_en` aunque su estado siga 'en_curso': el cierre
-- manda sobre el estado.
INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, plantilla_horario_id, fecha, estado, cerrado_en) VALUES
  ('70000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', '2026-09-12', 'en_curso', now());

-- Una tarea puesta A MANO en el bloque abierto: la materialización entra
-- DETRÁS de ella y no la reordena.
INSERT INTO public.tareas_bloque (id, bloque_id, titulo, orden) VALUES
  ('80000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001',
   'Tarea puesta a mano', 7);
