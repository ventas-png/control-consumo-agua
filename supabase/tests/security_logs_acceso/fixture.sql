-- ════════════════════════════════════════════════════════════════════════════
-- Fixture: `security_logs` CON LA FORMA REAL DE PRODUCCIÓN
-- ════════════════════════════════════════════════════════════════════════════
--
-- Reproduce el hallazgo del auditor de drift: la tabla tal como está en el
-- repositorio (RLS + la policy de super_admin + los grants por defecto de
-- Supabase) MÁS las tres policies que sólo existen en producción y que
-- `drift-conocido.json` describe desde el 2026-09-01.
--
-- Se stubbean `is_super_admin()` y `current_user_role()` con sus firmas reales
-- en vez de aplicar las migraciones que las crean: esas arrastran el modelo de
-- usuarios entero (app_users, companies, memberships…) y lo que se prueba acá
-- es SÓLO el acceso a esta tabla. El rol efectivo se elige con un GUC, así que
-- la prueba puede ponerse en la piel de cada actor sin inventar sesiones.

\set ON_ERROR_STOP on

-- ── Roles, como los tiene Supabase ─────────────────────────────────────────
-- `service_role` con BYPASSRLS: es lo que hace que las edge functions escriban
-- sin que la RLS opine. Sin ese atributo la prueba mediría otra cosa.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── La tabla, con las 7 columnas de producción ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  event_type  text NOT NULL,
  ip_address  text,
  user_agent  text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;

-- Los grants POR DEFECTO de Supabase sobre `public`: los siete privilegios a
-- los tres roles. Es lo que hay hoy en producción y en la reconstrucción
-- (grupo `tabla:security_logs/grants` = f96a9d92…:28, idéntico en ambos lados).
GRANT ALL ON public.security_logs TO anon, authenticated, service_role;

-- ── Los helpers de rol, stubbeados por GUC ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT coalesce(current_setting('prueba.rol', true), 'viewer') $$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT coalesce(current_setting('prueba.rol', true), 'viewer') = 'super_admin' $$;

GRANT EXECUTE ON FUNCTION public.current_user_role(), public.is_super_admin()
  TO anon, authenticated, service_role;

-- ── La policy que SÍ declara el repositorio (20260729000300) ───────────────
DROP POLICY IF EXISTS "security_logs_select_superadmin" ON public.security_logs;
CREATE POLICY "security_logs_select_superadmin" ON public.security_logs
  FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- ── Las TRES que sólo existen en producción ────────────────────────────────
-- Copiadas de la descripción del auditor en drift-conocido.json.
CREATE POLICY "security_logs_insert_anon" ON public.security_logs
  FOR INSERT
  TO anon
  WITH CHECK (user_id IS NULL);

CREATE POLICY "security_logs_insert_authenticated" ON public.security_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "security_logs_select_by_role" ON public.security_logs
  FOR SELECT
  TO public
  USING (current_user_role() = 'admin');

-- ── Dos filas de otro tenant, para que «leer de más» sea observable ────────
INSERT INTO public.security_logs (user_id, event_type, metadata) VALUES
  (gen_random_uuid(), 'login_failed',      '{"tenant":"empresa-A"}'::jsonb),
  (gen_random_uuid(), 'password_changed',  '{"tenant":"empresa-B"}'::jsonb);

-- ── El comprobador ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

-- ¿Puede este rol hacer esta operación DE VERDAD? No se pregunta por el
-- catálogo: se INTENTA, con el rol puesto, y se mira si sale o si la deniegan.
-- Un grant sin policy —o una policy sin grant— dan resultados distintos, y esa
-- diferencia es justo lo que esta prueba existe para medir.
-- El INSERT de prueba SE DESHACE SIEMPRE. El bloque BEGIN…EXCEPTION es una
-- subtransacción: al levantar el centinela, la fila se revierte. Sin esto, cada
-- intento exitoso dejaba una fila y los conteos de las aserciones siguientes
-- dependían del ORDEN en que se hubieran corrido — una prueba que se mide a sí
-- misma en vez de medir la migración.
CREATE OR REPLACE FUNCTION public.puede_insertar(p_rol text, p_como text DEFAULT 'viewer')
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_rol);
    PERFORM set_config('prueba.rol', p_como, true);
    INSERT INTO public.security_logs (event_type, metadata)
      VALUES ('prueba_' || p_rol, '{"origen":"prueba"}'::jsonb);
    -- Si se llegó hasta acá, el INSERT entró: se deshace y se responde «sí».
    RAISE EXCEPTION 'DESHACER_PRUEBA' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RETURN false;
    WHEN raise_exception THEN
      IF SQLERRM <> 'DESHACER_PRUEBA' THEN
        RESET ROLE;
        RAISE;
      END IF;
      RESET ROLE;
      RETURN true;
  END;
END $$;

CREATE OR REPLACE FUNCTION public.filas_visibles(p_rol text, p_como text DEFAULT 'viewer')
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_rol);
  PERFORM set_config('prueba.rol', p_como, true);
  SELECT count(*) INTO n FROM public.security_logs;
  RESET ROLE;
  RETURN n;
EXCEPTION WHEN insufficient_privilege OR sqlstate '42501' THEN
  RESET ROLE;
  RETURN -1;   -- -1 = la denegó el GRANT; 0 = la denegó la RLS
END $$;
