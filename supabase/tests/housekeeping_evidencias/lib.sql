-- Ayudas de la prueba (esquema `hkt`, no pg_temp: el rol `authenticated` tiene que poder
-- llamarlas después de un SET ROLE).
CREATE SCHEMA IF NOT EXISTS hkt;
GRANT USAGE ON SCHEMA hkt TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION hkt.uid(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('c0000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.sv(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT ('5e000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
CREATE OR REPLACE FUNCTION hkt.ca() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a0000000-0000-0000-0000-00000000000a'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.cb() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b0000000-0000-0000-0000-00000000000b'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pa1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a1000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pa2() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'a1000000-0000-0000-0000-000000000002'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.pb1() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'b1000000-0000-0000-0000-000000000001'::uuid $$;
CREATE OR REPLACE FUNCTION hkt.u1()  RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'd1000000-0000-0000-0000-000000000001'::uuid $$;
-- Ruta correcta de un objeto del servicio n (proyecto, servicio, archivo).
CREATE OR REPLACE FUNCTION hkt.ruta(p_proyecto uuid, n int, p_archivo text) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT p_proyecto::text || '/' || hkt.sv(n)::text || '/' || p_archivo $$;

CREATE OR REPLACE FUNCTION hkt.ok(p_lbl text, p_cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(p_cond, false) THEN RAISE NOTICE 'OK    %', p_lbl;
  ELSE RAISE EXCEPTION 'FALLO %', p_lbl; END IF;
END $$;

-- Cambia de persona: JWT (GUC) + rol de Supabase.
CREATE OR REPLACE FUNCTION hkt.como(p_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RESET ROLE;
  PERFORM set_config('app.uid', coalesce(p_uid::text, ''), false);
  EXECUTE 'SET ROLE authenticated';
END $$;
CREATE OR REPLACE FUNCTION hkt.como_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN RESET ROLE; PERFORM set_config('app.uid', '', false); EXECUTE 'SET ROLE anon'; END $$;
CREATE OR REPLACE FUNCTION hkt.como_servicio() RETURNS void LANGUAGE plpgsql AS $$
BEGIN RESET ROLE; PERFORM set_config('app.uid', '', false); EXECUTE 'SET ROLE service_role'; END $$;
CREATE OR REPLACE FUNCTION hkt.root() RETURNS void LANGUAGE plpgsql AS $$
BEGIN RESET ROLE; PERFORM set_config('app.uid', '', false); END $$;

-- SQLSTATE con el que falla una sentencia ('SIN_ERROR' si no falla). Si no falla, deshace el efecto.
CREATE OR REPLACE FUNCTION hkt.estado_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'SIN_ERROR_REVERTIDO' THEN RETURN 'SIN_ERROR'; END IF;
  RETURN SQLSTATE;
END $$;
-- Mensaje de error de una sentencia.
CREATE OR REPLACE FUNCTION hkt.mensaje_de(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'SIN_ERROR_REVERTIDO';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM;
END $$;
-- Filas afectadas por una sentencia DML.
CREATE OR REPLACE FUNCTION hkt.afectadas(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hkt TO anon, authenticated, service_role;
