-- ════════════════════════════════════════════════════════════════════════════
-- Fixture de declarar_triggers_fill_company_id.
--
-- Reproduce el PUNTO DE PARTIDA de una reconstrucción desde cero ANTES de
-- 20260912015504: la función fill_company_id_from_user() existe, con la ACL
-- que le fijó 20260911223000 (sólo service_role), las dos tablas existen con
-- sus policies de INSERT exigiendo `company_id = get_my_company_id()`… y los
-- dos triggers NO están. Es exactamente lo que tenía la Preview de #858 (3 de
-- los 5 triggers) y lo que el auditor de drift declaraba desde el 2026-09-01.
--
-- Las tablas son STUBS con las columnas que la prueba observa y los nombres
-- reales (el nombre de la tabla y del trigger es lo que la migración mira).
-- Aplicar las migraciones reales arrastraría el módulo de agua entero; eso lo
-- hace replay.mjs sobre la cadena completa. Mismo patrón que
-- acl_definer_expuestas_anon/fixture.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- `auth.uid()` como en Supabase: sale de un GUC de la petición.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.app_users (
  id         uuid PRIMARY KEY,
  role       text NOT NULL,
  company_id uuid
);

-- El helper que usan las policies reales (20260320000003 / 20260729000500).
CREATE FUNCTION public.get_my_company_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT company_id FROM public.app_users WHERE id = auth.uid() LIMIT 1 $$;

-- La función de trigger, con el cuerpo de 20260407000002.
CREATE FUNCTION public.fill_company_id_from_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    NEW.company_id := (
      SELECT company_id FROM public.app_users WHERE id = auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

-- La ACL de producción, tal como la dejó 20260911223000: sólo service_role.
-- Es la celda que hace interesante la prueba de inserción: `authenticated`
-- NO puede invocar la función y, aun así, el trigger tiene que rellenar.
REVOKE EXECUTE ON FUNCTION public.fill_company_id_from_user()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.fill_company_id_from_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_company_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated, service_role;

-- Las dos tablas, con las columnas de 20260317000001 que la prueba usa.
CREATE TABLE public.fuentes_agua (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador text NOT NULL,
  nombre        text NOT NULL,
  tipo_agua     text NOT NULL,
  company_id    uuid
);

CREATE TABLE public.registros_calidad (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuente_id  uuid REFERENCES public.fuentes_agua(id) ON DELETE CASCADE,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  company_id uuid
);

-- Una tabla que NO es de las dos: para el escenario «homónimo en otra tabla».
CREATE TABLE public.otra_tabla (id int PRIMARY KEY, company_id uuid);

-- Otra función de trigger: para el escenario «mismo nombre, otra función».
CREATE FUNCTION public.otra_fn() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RETURN NEW; END $$;

-- RLS con la forma de las policies reales de INSERT (20260521000003): el
-- WITH CHECK exige que la fila traiga el company_id del usuario. Como el
-- BEFORE INSERT corre antes del WITH CHECK, con el trigger una inserción sin
-- company_id pasa; sin el trigger, falla por RLS. Ésa es la diferencia de
-- comportamiento entre producción y una reconstrucción sin 20260912015504.
ALTER TABLE public.fuentes_agua      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registros_calidad ENABLE ROW LEVEL SECURITY;
CREATE POLICY fuentes_agua_insert ON public.fuentes_agua
  FOR INSERT TO authenticated WITH CHECK (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY fuentes_agua_select ON public.fuentes_agua
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY registros_calidad_insert ON public.registros_calidad
  FOR INSERT TO authenticated WITH CHECK (company_id = (SELECT public.get_my_company_id()));
CREATE POLICY registros_calidad_select ON public.registros_calidad
  FOR SELECT TO authenticated USING (company_id = (SELECT public.get_my_company_id()));

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT INSERT, SELECT ON public.fuentes_agua, public.registros_calidad TO authenticated;

-- El usuario de la sesión: admin de la empresa 4444….
INSERT INTO public.app_users (id, role, company_id)
VALUES ('33333333-3333-3333-3333-333333333333', 'admin', '44444444-4444-4444-4444-444444444444');

-- ── Helper de aserción (patrón de la casa) ──────────────────────────────────
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
