-- Stubs mínimos del esquema existente para validar las migraciones conta_*
-- en un Postgres local (sin Supabase). Solo columnas que tocan los triggers.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;

CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text,
  default_currency varchar(3) NOT NULL DEFAULT 'usd'
);
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id),
  nombre text,
  moneda text NOT NULL DEFAULT 'Q',
  moneda_condominios text
);
CREATE TABLE IF NOT EXISTS public.clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id)
);
CREATE TABLE IF NOT EXISTS public.registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid,
  cliente_nombre text,
  project_id uuid REFERENCES public.projects(id),
  factura_estado text DEFAULT 'pendiente',
  monto_calculado numeric,
  iva_monto numeric(12,2),
  mora_monto numeric(12,2),
  total_a_pagar numeric(12,2)
);
CREATE TABLE IF NOT EXISTS public.pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id uuid,
  cliente_id uuid NOT NULL,
  project_id uuid,
  monto numeric(10,2) NOT NULL,
  metodo text NOT NULL,
  referencia text,
  estado text NOT NULL DEFAULT 'pendiente',
  verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cuotas_condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  project_id uuid,
  unidad_id uuid,
  concepto text NOT NULL DEFAULT 'mantenimiento',
  monto numeric(12,2) NOT NULL,
  periodo text NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  pago_id uuid,
  mora_monto numeric(12,2),
  deleted_at timestamptz
);
-- `comprobante_num` y `notas` no las toca ningún trigger contable, pero SÍ el
-- cruce de duplicados de la Fase 7 (el número de comprobante contra el de la
-- factura es la evidencia más fuerte de que son el mismo desembolso). El stub
-- se mantiene fiel a la tabla real de 20260420000009 para que un harness no
-- falle por una columna que en producción existe.
CREATE TABLE IF NOT EXISTS public.gastos_condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  concepto text NOT NULL,
  categoria text NOT NULL DEFAULT 'otros',
  monto numeric(12,2) NOT NULL,
  fecha date NOT NULL,
  proveedor_nombre text,
  estado text NOT NULL DEFAULT 'pagado',
  metodo_pago text,
  comprobante_num text,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.cierres_mensuales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid,
  periodo text,
  estado text DEFAULT 'borrador'
);

CREATE OR REPLACE FUNCTION public.get_my_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'company_owner'::text $$;

-- ── Stubs añadidos durante la serie ledger ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY, company_id uuid, role text, activo boolean DEFAULT true
);
CREATE TABLE IF NOT EXISTS public.notifications_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid, channel text NOT NULL, template_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, recipient text,
  status text NOT NULL DEFAULT 'queued', created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid, key text NOT NULL, channel text NOT NULL,
  subject text, body text, locale text DEFAULT 'es', is_active boolean DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (company_id, key, channel, locale)
);
