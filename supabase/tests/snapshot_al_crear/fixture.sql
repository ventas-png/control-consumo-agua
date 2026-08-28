-- Fixture para EJECUTAR 20260907000600 (snapshot al crear la tarea) contra un
-- Postgres de verdad. El run.sh aplica encima las migraciones REALES
-- 20260904000100, 000100, 000200, 20260907000200, 000300, 000400 y 000600.
--
-- ES EL MISMO FIXTURE QUE consumo_insumos, a propósito: ya declara el padrón con
-- permisos disjuntos (Ana conserje, Bruno almacén, Carla supervisora), el motor
-- de existencias y las tablas del módulo en su estado previo a la serie. Lo que
-- cambia es lo que se aplica encima y lo que se afirma.
--
-- Se aplica ADEMÁS 20260907000400 (evidencia al cerrar), que consumo_insumos no
-- necesitaba: el invariante que cierra el círculo de este PR es que, una vez
-- copiado el checklist, el gate de evidencia SÍ rechace el cierre de una tarea
-- manual que hoy pasa sin nada.
--
-- `auth.uid()` se emula leyendo un GUC de sesión (`app.uid`). OJO:
-- `set_config(…, true)` es LOCAL A LA TRANSACCIÓN y cada bloque DO de psql es su
-- propia transacción — la identidad se redeclara en cada bloque que la necesite.

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
-- La legada que 20260904000100 viene a retirar.
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

-- Las dos que 20260904000100 necesita para su backfill y su cambio de FK.
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

-- ── bloques_turno y tareas_bloque, con lo que les dejó 20260907000100 ───────
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
-- El índice de 20260907000100 que hace idempotente la materialización.
CREATE UNIQUE INDEX uq_tareas_bloque_plantilla
  ON public.tareas_bloque(bloque_id, plantilla_id) WHERE plantilla_id IS NOT NULL;
ALTER TABLE public.tareas_bloque ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tareas_bloque_rw" ON public.tareas_bloque
  USING (EXISTS (SELECT 1 FROM public.bloques_turno b
                 WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bloques_turno b
                      WHERE b.id = bloque_id AND b.company_id = public.get_my_company_id()));


-- ── El motor de existencias, literal de 20260821000200 ─────────────────────
-- (ver la nota de la cabecera sobre por qué se copia en vez de aplicarse)
CREATE TABLE public.suministros_condominio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre         text NOT NULL,
  categoria      text NOT NULL DEFAULT 'limpieza',
  unidad_medida  text NOT NULL DEFAULT 'unidad',
  stock_actual   numeric(10,2) NOT NULL DEFAULT 0,
  stock_minimo   numeric(10,2) NOT NULL DEFAULT 0,
  costo_unitario numeric(14,4),
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suministros_condominio ENABLE ROW LEVEL SECURITY;
-- Gateada por `condominios.tab.suministros`, como en 20260518000010. Es la
-- razón por la que el trigger de copia y la RPC son SECURITY DEFINER: el
-- conserje NO tiene este permiso.
CREATE POLICY "suministros_condominio_select" ON public.suministros_condominio
  FOR SELECT TO authenticated
  USING (public.is_super_admin()
         OR (company_id = public.get_my_company_id()
             AND public.user_has_permission('condominios.tab.suministros')));
CREATE POLICY "suministros_condominio_insert" ON public.suministros_condominio
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin()
              OR (company_id = public.get_my_company_id()
                  AND public.user_has_permission('condominios.tab.suministros')));
CREATE POLICY "suministros_condominio_update" ON public.suministros_condominio
  FOR UPDATE TO authenticated
  USING (public.is_super_admin()
         OR (company_id = public.get_my_company_id()
             AND public.user_has_permission('condominios.tab.suministros')))
  WITH CHECK (public.is_super_admin()
              OR (company_id = public.get_my_company_id()
                  AND public.user_has_permission('condominios.tab.suministros')));

CREATE TABLE public.inventario_condominio (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre     text NOT NULL,
  cantidad   int  NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventario_condominio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventario_rw" ON public.inventario_condominio
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

CREATE TABLE public.movimientos_suministro (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  suministro_id  uuid NOT NULL REFERENCES public.suministros_condominio(id) ON DELETE CASCADE,
  tipo           text NOT NULL DEFAULT 'salida',
  cantidad       numeric(10,2) NOT NULL,
  motivo         text,
  fecha          date NOT NULL DEFAULT CURRENT_DATE,
  costo_unitario numeric(14,4),
  origen_tabla   text,
  origen_id      uuid,
  creado_por     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.movimientos_suministro ENABLE ROW LEVEL SECURITY;
-- La misma gate que en prod: sin `condominios.tab.suministros` no se inserta.
-- Que la RPC SÍ pueda es exactamente lo que se prueba.
CREATE POLICY "movimientos_suministro_select" ON public.movimientos_suministro
  FOR SELECT TO authenticated
  USING (public.is_super_admin()
         OR (company_id = public.get_my_company_id()
             AND public.user_has_permission('condominios.tab.suministros')));
CREATE POLICY "movimientos_suministro_insert" ON public.movimientos_suministro
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin()
              OR (company_id = public.get_my_company_id()
                  AND public.user_has_permission('condominios.tab.suministros')));

CREATE OR REPLACE FUNCTION public.suministros_tg_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stock  numeric(14,4);
  v_costo  numeric(14,4);
  v_nuevo  numeric(14,4);
  v_ncosto numeric(14,4);
  v_prev   text := COALESCE(current_setting('conta.allow_system_write', true), 'off');
BEGIN
  SELECT stock_actual, costo_unitario INTO v_stock, v_costo
  FROM public.suministros_condominio WHERE id = NEW.suministro_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_nuevo := CASE NEW.tipo
               WHEN 'entrada' THEN v_stock + NEW.cantidad
               WHEN 'salida'  THEN GREATEST(0, v_stock - NEW.cantidad)
               ELSE NEW.cantidad
             END;

  v_ncosto := v_costo;
  IF NEW.tipo = 'entrada' AND COALESCE(NEW.costo_unitario, 0) > 0
     AND (GREATEST(v_stock, 0) + NEW.cantidad) > 0 THEN
    v_ncosto := round(
      (GREATEST(v_stock, 0) * COALESCE(v_costo, 0) + NEW.cantidad * NEW.costo_unitario)
      / (GREATEST(v_stock, 0) + NEW.cantidad), 4);
  END IF;

  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.suministros_condominio
     SET stock_actual = v_nuevo, costo_unitario = v_ncosto
   WHERE id = NEW.suministro_id;
  PERFORM set_config('conta.allow_system_write', v_prev, true);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_suministros_stock
  AFTER INSERT ON public.movimientos_suministro
  FOR EACH ROW EXECUTE FUNCTION public.suministros_tg_stock();

CREATE OR REPLACE FUNCTION public.suministros_tg_guard_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(current_setting('conta.allow_system_write', true), 'off') <> 'on'
     AND NEW.stock_actual IS DISTINCT FROM OLD.stock_actual THEN
    NEW.stock_actual := OLD.stock_actual;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_suministros_guard_stock
  BEFORE UPDATE ON public.suministros_condominio
  FOR EACH ROW EXECUTE FUNCTION public.suministros_tg_guard_stock();

-- set_project_id_desde_padre, literal de 20260729000600. No sólo sella: ABORTA
-- si el company_id de la hija no coincide con el del padre.
CREATE OR REPLACE FUNCTION public.set_project_id_desde_padre()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_padre   text := TG_ARGV[0];
  v_fk      text := TG_ARGV[1];
  v_fk_val  uuid;
  v_project uuid;
  v_company uuid;
BEGIN
  EXECUTE format('SELECT ($1).%I', v_fk) INTO v_fk_val USING NEW;
  IF v_fk_val IS NULL THEN
    RAISE EXCEPTION '%.% no puede ser NULL', TG_TABLE_NAME, v_fk
      USING ERRCODE = 'not_null_violation';
  END IF;
  EXECUTE format('SELECT project_id, company_id FROM public.%I WHERE id = $1', v_padre)
    INTO v_project, v_company USING v_fk_val;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'No se encontró % con id=% al derivar project_id para %',
      v_padre, v_fk_val, TG_TABLE_NAME USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION '%.company_id=% no coincide con %.company_id=% (id=%)',
      TG_TABLE_NAME, NEW.company_id, v_padre, v_company, v_fk_val
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.project_id := v_project;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_set_project_id
  BEFORE INSERT OR UPDATE OF suministro_id, project_id, company_id
  ON public.movimientos_suministro
  FOR EACH ROW EXECUTE FUNCTION public.set_project_id_desde_padre('suministros_condominio', 'suministro_id');

CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.movimientos_suministro
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- ── GRANTs de tabla, como en producción ─────────────────────────────────────
-- IMPORTANTE, y no es un detalle de arranque. Supabase otorga por defecto los
-- privilegios de tabla a `anon` y `authenticated` en el esquema public: lo que
-- realmente decide quién ve y escribe qué es la RLS, no el GRANT.
--
-- Sin esto, un rechazo en el sandbox podría venir del privilegio de tabla y no
-- de la política — y los dos levantan el MISMO SQLSTATE (42501), así que un
-- `EXCEPTION WHEN insufficient_privilege` no los distingue. Una prueba que
-- afirma «la RLS lo frenó» estaría pasando por el motivo equivocado.
--
-- Las migraciones que corren encima hacen su propio REVOKE donde corresponde
-- (`REVOKE ALL ... FROM PUBLIC, anon`), que es justo lo que pasa en producción.
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- ── Padrón mínimo ───────────────────────────────────────────────────────────
-- Dos usuarios con permisos DISJUNTOS, que es el punto entero de la RPC:
--   Ana   conserje  → `tareas_personal`, SIN `suministros`. Puede cerrar la
--                     tarea y NO puede tocar el almacén a mano.
--   Bruno almacén   → `suministros`, SIN nada de tareas. Ve los movimientos y
--                     no puede consumir por una tarea.
--   Carla supervisora → `prog_limpieza`. Existe sólo para poder invocar
--                     `materializar_rutinas_turno`, que exige `prog_limpieza` o
--                     `turnos` — ninguno de los cuales tiene Ana. Así el
--                     invariante del consumo sigue probando que basta con
--                     `tareas_personal`.
-- Los dos con rol 'operador': `user_has_permission` le dice true a TODO a
-- owner/admin, así que con esos roles la prueba no probaría nada.
INSERT INTO public.companies (id) VALUES ('c0000000-0000-0000-0000-000000000001');
INSERT INTO public.projects (id, company_id) VALUES
  ('11111111-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');

INSERT INTO auth.users (id) VALUES
  ('a0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b'),
  ('a0000000-0000-0000-0000-00000000000c');
INSERT INTO public.app_users (id, full_name, company_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'Ana (conserje)',
   'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000b', 'Bruno (almacén)',
   'c0000000-0000-0000-0000-000000000001', 'operador'),
  ('a0000000-0000-0000-0000-00000000000c', 'Carla (supervisora)',
   'c0000000-0000-0000-0000-000000000001', 'operador');

INSERT INTO public.user_roles (user_id, role_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b'),
  ('a0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000c');
INSERT INTO public.role_permissions (role_id, permission_key) VALUES
  ('d0000000-0000-0000-0000-00000000000a', 'condominios.tab.tareas_personal'),
  ('d0000000-0000-0000-0000-00000000000b', 'condominios.tab.suministros'),
  ('d0000000-0000-0000-0000-00000000000c', 'condominios.tab.prog_limpieza');

INSERT INTO public.personal_condominio (id, company_id, project_id, nombre) VALUES
  ('90000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Ana');

INSERT INTO public.bloques_turno
  (id, company_id, project_id, personal_id, fecha, estado) VALUES
  ('70000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001',
   '2026-09-10', 'en_curso');

-- Dos insumos: uno con stock de sobra y otro con MENOS del que la receta pide.
-- El segundo es el caso «sin stock», que se registra igual y avisa.
INSERT INTO public.suministros_condominio
  (id, company_id, project_id, nombre, unidad_medida, stock_actual) VALUES
  ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Cloro', 'litro', 10),
  ('50000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Bolsas de basura', 'unidad', 1),
  -- Dado de baja: la receta lo pide y la copia NO debe arrastrarlo.
  ('50000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Detergente retirado', 'litro', 99);
UPDATE public.suministros_condominio SET activo = false
 WHERE id = '50000000-0000-0000-0000-000000000003';

INSERT INTO public.areas_condominio (id, company_id, project_id, nombre) VALUES
  ('60000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'Piscina');

INSERT INTO public.plantillas_tarea_cargo
  (id, company_id, project_id, cargo, titulo, area_id) VALUES
  ('80000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'conserje', 'Limpiar la piscina',
   '60000000-0000-0000-0000-000000000001'),
  -- Sin insumos: cerrar una tarea sin receta no debe consumir nada.
  ('80000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001', 'conserje', 'Barrer el pasillo', NULL);
