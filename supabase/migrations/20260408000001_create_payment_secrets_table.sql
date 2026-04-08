-- ============================================================
-- Mover secretos de pago a tabla separada con RLS restrictivo
-- ============================================================
-- Problema: La tabla companies tiene RLS que permite SELECT en
-- todas las columnas, exponiendo stripe_secret_key,
-- stripe_webhook_secret y paypal_client_secret a usuarios
-- autenticados. PostgreSQL no soporta RLS a nivel de columna,
-- así que la solución es una tabla separada sin políticas
-- (solo service_role puede acceder).
-- ============================================================

-- 1. Crear tabla separada para secretos de pago
CREATE TABLE IF NOT EXISTS public.company_payment_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  stripe_secret_key text,
  stripe_webhook_secret text,
  paypal_client_secret text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Habilitar RLS sin políticas = solo service_role puede acceder
ALTER TABLE public.company_payment_secrets ENABLE ROW LEVEL SECURITY;

-- 3. Índice en company_id para lookups rápidos (ya es UNIQUE, pero explícito)
CREATE INDEX IF NOT EXISTS idx_payment_secrets_company_id
  ON public.company_payment_secrets(company_id);

-- 4. Migrar datos existentes desde companies
INSERT INTO public.company_payment_secrets (company_id, stripe_secret_key, stripe_webhook_secret, paypal_client_secret)
SELECT id, stripe_secret_key, stripe_webhook_secret, paypal_client_secret
FROM public.companies
WHERE stripe_secret_key IS NOT NULL
   OR stripe_webhook_secret IS NOT NULL
   OR paypal_client_secret IS NOT NULL
ON CONFLICT (company_id) DO NOTHING;

-- 5. Eliminar columnas secretas de companies
ALTER TABLE public.companies DROP COLUMN IF EXISTS stripe_secret_key;
ALTER TABLE public.companies DROP COLUMN IF EXISTS stripe_webhook_secret;
ALTER TABLE public.companies DROP COLUMN IF EXISTS paypal_client_secret;

-- 6. Actualizar vista companies_safe (ya no necesita excluir secretos,
--    pero la mantenemos por compatibilidad con cualquier código que la use)
CREATE OR REPLACE VIEW companies_safe AS
SELECT id, nombre, nit, email, telefono, plan, activa, created_at,
       max_projects, logo_url, max_units,
       stripe_public_key, stripe_configured, stripe_activo,
       paypal_client_id, paypal_configured, paypal_activo
FROM companies;
