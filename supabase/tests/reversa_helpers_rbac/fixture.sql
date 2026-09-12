-- Lo MÍNIMO para que la reversa se pueda ejecutar de verdad, y nada más.
--
-- No se reconstruyen las 460 migraciones a propósito: lo que se prueba es que
-- el archivo de reversa repone TRES funciones con la forma exacta que tienen en
-- producción, y para eso sólo hacen falta sus dependencias y los roles a los que
-- concede. Un sandbox más grande tardaría diez veces más y mediría lo mismo.

-- Los tres roles de Supabase. La reversa concede a dos de ellos y revoca a
-- PUBLIC; sin los roles, el GRANT falla y no se prueba el grants.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon          NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role  NOLOGIN NOINHERIT; END IF;
END $$;

-- Las dos dependencias que los cuerpos nombran. `check_function_bodies` está
-- activo por defecto, así que sin ellas el CREATE de la reversa falla — que es
-- justamente una de las cosas que este test comprueba: que la reversa no
-- depende de nada que no exista.
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
