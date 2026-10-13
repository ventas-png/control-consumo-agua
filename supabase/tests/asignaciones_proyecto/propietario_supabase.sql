-- ============================================================================
-- PROPIETARIO «COMO SUPABASE»: el rol postgres de Supabase NO es superusuario (tiene BYPASSRLS, CREATEROLE y CREATEDB). En el clúster
-- desechable el único superusuario es el arranque, así que aquí se crea sb_postgres con esos atributos y se le pasa la propiedad de todo lo
-- de public (tablas, vistas, secuencias, funciones, tipos) y de la base. Las migraciones se aplican luego CONECTADOS COMO sb_postgres:
-- así se prueba que la migración funciona sin ser superusuario y que las funciones SECURITY DEFINER (cuyo dueño es sb_postgres) leen
-- tablas protegidas por RLS gracias a BYPASSRLS, como en producción. También se le da USAGE sobre los esquemas de la plataforma (auth.uid()
-- se usa en el cuerpo de funciones SQL de public y se valida al crearlas). Lo corre el superusuario sobre una COPIA desechable de la base.
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sb_postgres') THEN
    CREATE ROLE sb_postgres LOGIN NOSUPERUSER BYPASSRLS CREATEROLE CREATEDB;
  END IF;
  FOR r IN SELECT c.oid::regclass::text AS obj, CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END AS kind
             FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','S','f') AND pg_get_userbyid(c.relowner) = 'postgres'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a') LOOP
    EXECUTE format('ALTER %s %s OWNER TO sb_postgres', r.kind, r.obj);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure::text AS obj, CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END AS kind
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND pg_get_userbyid(p.proowner) = 'postgres'
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') LOOP
    EXECUTE format('ALTER %s %s OWNER TO sb_postgres', r.kind, r.obj);
  END LOOP;
  FOR r IN SELECT t.oid::regtype::text AS obj FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','d') AND pg_get_userbyid(t.typowner) = 'postgres' LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO sb_postgres', r.obj);
  END LOOP;
  EXECUTE format('ALTER DATABASE %I OWNER TO sb_postgres', current_database());
END $$;
-- el rol postgres de Supabase tiene USAGE sobre los esquemas de la plataforma (auth.uid() se usa en el cuerpo de funciones SQL de public)
GRANT USAGE ON SCHEMA auth, storage, extensions, vault, net, cron, graphql_public, supabase_functions TO sb_postgres;
