-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de cumplimiento_calidad_firma_inequivoca — PARTE 1: el andamiaje.
--
-- Reproduce el punto de partida de una reconstrucción ANTES de 20260913032502
-- con las MISMAS migraciones que crearon el defecto: run.sh aplica, después de
-- este archivo, los archivos reales 20260603140000 (S22: función de dos
-- argumentos + trigger) y 20260605160000 (S23: catálogo calidad_tipologias +
-- sobrecarga de tres argumentos con DEFAULT + su ACL). Así el 42725 que mide
-- assert_pre.sql sale de las definiciones del repositorio, no de una copia.
--
-- Aquí va sólo lo que esas dos migraciones dan por existente: auth.uid(),
-- companies, app_users, los helpers de RLS, fill_company_id_from_user() con la
-- ACL de producción y sus dos triggers (20260912015504), y las dos tablas del
-- módulo con las columnas que la prueba observa. Las policies de las dos
-- tablas tienen la forma real (company_id = get_my_company_id()); las de
-- calidad_tipologias las crea la propia S23. Los datos van en semilla.sql.
-- Mismo patrón que declarar_triggers_fill_company_id/fixture.sql.
-- ════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.companies (
  id     uuid PRIMARY KEY,
  nombre text NOT NULL
);

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  role       text NOT NULL,
  company_id uuid REFERENCES public.companies(id)
);

-- Helpers reales de RLS (20260320000003 / 20260320000006).
CREATE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1 $$;

CREATE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT role FROM public.app_users WHERE id = auth.uid() $$;

REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

-- fill_company_id_from_user() (20260407000002) con la ACL de 20260911223000 y
-- los dos triggers de 20260912015504: la fila entra sin company_id y sale con
-- el del usuario. Sin esto, «insertar como authenticated» no pasaría la RLS.
CREATE FUNCTION public.fill_company_id_from_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := (SELECT company_id FROM public.app_users WHERE id = auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fill_company_id_from_user() FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fill_company_id_from_user() TO service_role;

-- Las dos tablas del módulo (20260317000001), con las columnas que se observan.
CREATE TABLE public.fuentes_agua (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador text NOT NULL,
  nombre        text NOT NULL,
  tipo_agua     text NOT NULL,
  company_id    uuid REFERENCES public.companies(id)
);

CREATE TABLE public.registros_calidad (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  fuente_id     uuid    REFERENCES public.fuentes_agua(id) ON DELETE CASCADE,
  parametros    jsonb   NOT NULL DEFAULT '{}'::jsonb,
  cumplimiento  jsonb   NOT NULL DEFAULT '{}'::jsonb,
  cumple_total  boolean NOT NULL DEFAULT false,
  observaciones text,
  company_id    uuid REFERENCES public.companies(id)
);

CREATE TRIGGER fuentes_agua_fill_company_id BEFORE INSERT ON public.fuentes_agua
  FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();
CREATE TRIGGER registros_calidad_fill_company_id BEFORE INSERT ON public.registros_calidad
  FOR EACH ROW EXECUTE FUNCTION public.fill_company_id_from_user();

-- RLS con la forma real de 20260521000003: cada fila es de la empresa del
-- usuario. Es lo que hace INVISIBLE la fuente de otra empresa, que es la base
-- del aislamiento que la función nueva respeta (y explota) al ser INVOKER.
ALTER TABLE public.fuentes_agua      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_calidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuentes_agua_select ON public.fuentes_agua
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY fuentes_agua_insert ON public.fuentes_agua
  FOR INSERT TO authenticated WITH CHECK (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY registros_calidad_select ON public.registros_calidad
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY registros_calidad_insert ON public.registros_calidad
  FOR INSERT TO authenticated WITH CHECK (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY registros_calidad_update ON public.registros_calidad
  FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()))
  WITH CHECK (company_id = (SELECT public.get_my_company_id()));

-- Grants de tabla como en producción (anon, authenticated y service_role
-- tienen TODO sobre las tablas de public; la RLS es lo que separa).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.fuentes_agua, public.registros_calidad, public.companies, public.app_users
  TO anon, authenticated, service_role;

-- ── Helpers de aserción (patrón de la casa) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.chk(actual bigint, esperado bigint, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

CREATE OR REPLACE FUNCTION public.chk(actual boolean, esperado boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido %, esperado %', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

CREATE OR REPLACE FUNCTION public.chk_txt(actual text, esperado text, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM esperado THEN
    RAISE EXCEPTION '❌ %  → obtenido «%», esperado «%»', msg, actual, esperado;
  END IF;
  RAISE NOTICE 'OK    %', msg;
END $$;

-- Ejecuta una sentencia y devuelve 'OK' o el SQLSTATE con que falló. Corre con
-- los privilegios de quien la llama (INVOKER): sirve para medir qué le pasa a
-- `authenticated` o a `anon` sin salir de la transacción.
CREATE OR REPLACE FUNCTION public.intentar(sentencia text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sentencia;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
