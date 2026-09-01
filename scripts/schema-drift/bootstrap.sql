-- ════════════════════════════════════════════════════════════════════════════
-- Andamiaje de plataforma para reconstruir el esquema desde supabase/migrations
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES ESTO. Las migraciones del repo dan por dado todo lo que Supabase monta
-- de fábrica: los roles `anon`/`authenticated`/`service_role`, los esquemas
-- `auth`/`storage`/`vault`/`net`/`cron`, `auth.uid()`, `auth.users`,
-- `storage.objects`, la publicación `supabase_realtime`… Un Postgres recién
-- inicializado no tiene nada de eso, así que sin este archivo el 6 % de las
-- migraciones falla y la reconstrucción no sirve para comparar.
--
-- QUÉ *NO* ES. No es una reimplementación de Supabase ni pretende serlo. Es el
-- mínimo para que el DDL de `public` se ejecute. Nada de aquí se compara: la
-- huella (fingerprint.sql) sólo mira el esquema `public`.
--
-- POR QUÉ LAS FORMAS SON LAS QUE SON. Las columnas de `auth.users`,
-- `auth.sessions`, `auth.identities`, `storage.objects`, `storage.buckets`,
-- `vault.decrypted_secrets`, `cron.job` y `cron.job_run_details` se copiaron del
-- catálogo REAL de producción (leído con SELECT sobre information_schema el
-- 2026-09-01). Si un stub tuviera otra forma, una FK del repo hacia
-- `auth.users(id)` podría fallar —o peor, pasar con otra semántica— y la
-- diferencia aparecería como drift falso.
--
-- LOS PRIVILEGIOS POR DEFECTO IMPORTAN. Supabase configura
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
-- authenticated, service_role`. Eso NO es cosmético: es la razón por la que en
-- producción `anon` tiene INSERT/SELECT sobre casi todo y la RLS es el único
-- control. Reproducirlo aquí es obligatorio, porque la huella compara grants y
-- sin esto saldrían 260 diferencias falsas —y, peor, se perdería justo la
-- señal que hace peligrosa a una policy permisiva.

-- ── roles ───────────────────────────────────────────────────────────────────
CREATE ROLE anon                    NOLOGIN NOINHERIT;
CREATE ROLE authenticated           NOLOGIN NOINHERIT;
CREATE ROLE service_role            NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator           NOLOGIN NOINHERIT;
CREATE ROLE supabase_admin          NOLOGIN NOINHERIT;
CREATE ROLE supabase_auth_admin     NOLOGIN NOINHERIT;
CREATE ROLE supabase_storage_admin  NOLOGIN NOINHERIT;
CREATE ROLE dashboard_user          NOLOGIN NOINHERIT;
CREATE ROLE pgbouncer               NOLOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;

-- ── esquemas ────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth               AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage            AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS supabase_functions;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE EXTENSION IF NOT EXISTS pgcrypto    WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS citext      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm     WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist  WITH SCHEMA extensions;
-- `pg_net` y `pg_cron` no existen fuera de Supabase; reconstruir.mjs instala un
-- shim vacío para que `CREATE EXTENSION` tenga éxito, y los objetos que las
-- migraciones usan de verdad (net.http_post, cron.schedule, cron.job) se
-- definen más abajo.

-- ── auth ────────────────────────────────────────────────────────────────────
CREATE TYPE auth.aal_level AS ENUM ('aal1','aal2','aal3');

CREATE TABLE auth.users (
  instance_id uuid, id uuid PRIMARY KEY, aud varchar, role varchar, email varchar,
  encrypted_password varchar, email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar, confirmation_sent_at timestamptz, recovery_token varchar,
  recovery_sent_at timestamptz, email_change_token_new varchar, email_change varchar,
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text UNIQUE DEFAULT NULL, phone_confirmed_at timestamptz, phone_change text,
  phone_change_token varchar, phone_change_sent_at timestamptz, confirmed_at timestamptz,
  email_change_token_current varchar, email_change_confirm_status smallint,
  banned_until timestamptz, reauthentication_token varchar, reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false, deleted_at timestamptz,
  is_anonymous boolean NOT NULL DEFAULT false
);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz, updated_at timestamptz, factor_id uuid, aal auth.aal_level,
  not_after timestamptz, refreshed_at timestamp, user_agent text, ip inet, tag text,
  oauth_client_id uuid, refresh_token_hmac_key text, refresh_token_counter bigint, scopes text
);
CREATE TABLE auth.identities (
  provider_id text NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL, provider text NOT NULL, last_sign_in_at timestamptz,
  created_at timestamptz, updated_at timestamptz, email text,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- Los claims salen de `current_setting`, igual que en Supabase. En la
-- reconstrucción nadie los fija, así que devuelven NULL — que es exactamente lo
-- que se necesita para que el DDL compile.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.email', true), '')::text $$;

-- ── storage ─────────────────────────────────────────────────────────────────
CREATE TYPE storage.buckettype AS ENUM ('STANDARD','ANALYTICS');
CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text NOT NULL, owner uuid, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false, file_size_limit bigint,
  allowed_mime_types text[], owner_id text,
  type storage.buckettype NOT NULL DEFAULT 'STANDARD', versioning_status text
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(), metadata jsonb, path_tokens text[],
  version text, owner_id text, user_metadata jsonb, archived_at timestamptz,
  is_delete_marker boolean, is_versioned boolean
);
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS
$$ DECLARE _p text[]; BEGIN SELECT string_to_array(name,'/') INTO _p;
   RETURN _p[1:array_length(_p,1)-1]; END $$;
CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$ DECLARE _p text[]; BEGIN SELECT string_to_array(name,'/') INTO _p;
   RETURN _p[array_length(_p,1)]; END $$;
CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$ BEGIN RETURN split_part(name,'.',2); END $$;

-- ── vault ───────────────────────────────────────────────────────────────────
-- Stub SIN cifrado y SIN ningún secreto: la reconstrucción nunca escribe aquí.
CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, description text DEFAULT '',
  secret text NOT NULL, key_id uuid, nonce bytea,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, key_id, nonce,
         created_at, updated_at
  FROM vault.secrets;
CREATE OR REPLACE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL,
  new_description text DEFAULT '', new_key_id uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS
$$ DECLARE _id uuid; BEGIN
     INSERT INTO vault.secrets(secret,name,description,key_id)
     VALUES (new_secret,new_name,new_description,new_key_id) RETURNING id INTO _id;
     RETURN _id; END $$;

-- ── net (pg_net) ────────────────────────────────────────────────────────────
CREATE TABLE net._http_response (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, status_code integer, content_type text,
  headers jsonb, content text, timed_out boolean, error_msg text, created timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE OR REPLACE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;

-- ── cron (pg_cron) ──────────────────────────────────────────────────────────
CREATE TABLE cron.job (
  jobid bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, schedule text, command text,
  nodename text DEFAULT 'localhost', nodeport integer DEFAULT 5432,
  database text DEFAULT current_database(), username text DEFAULT CURRENT_USER,
  active boolean DEFAULT true, jobname text
);
CREATE TABLE cron.job_run_details (
  jobid bigint, runid bigint, job_pid integer, database text, username text, command text,
  status text, return_message text, start_time timestamptz, end_time timestamptz
);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text)
RETURNS bigint LANGUAGE plpgsql AS
$$ DECLARE _id bigint; BEGIN
     DELETE FROM cron.job WHERE jobname = job_name;
     INSERT INTO cron.job(schedule,command,jobname) VALUES (schedule,command,job_name)
     RETURNING jobid INTO _id; RETURN _id; END $$;
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
RETURNS bigint LANGUAGE plpgsql AS
$$ DECLARE _id bigint; BEGIN
     INSERT INTO cron.job(schedule,command) VALUES (schedule,command) RETURNING jobid INTO _id;
     RETURN _id; END $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE plpgsql AS
$$ BEGIN DELETE FROM cron.job WHERE jobname = job_name; RETURN true; END $$;
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE plpgsql AS
$$ BEGIN DELETE FROM cron.job WHERE jobid = job_id; RETURN true; END $$;

-- ── supabase_functions / realtime / historial ───────────────────────────────
CREATE OR REPLACE FUNCTION supabase_functions.http_request() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RETURN NEW; END $$;

CREATE PUBLICATION supabase_realtime;

CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY, statements text[], name text,
  created_by text, idempotency_key text, rollback text[]
);

-- ── privilegios por defecto, como los deja Supabase ──────────────────────────
GRANT USAGE ON SCHEMA public, extensions, auth, storage, vault, net, cron, graphql_public
  TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

ALTER DATABASE postgres SET search_path TO "\$user", public, extensions;
