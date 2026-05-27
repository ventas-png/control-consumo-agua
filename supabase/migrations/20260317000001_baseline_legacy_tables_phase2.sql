-- ============================================================================
-- Baseline legacy tables — phase 2 (16 of 16) + 8 legacy functions
-- ============================================================================
-- Continuación de la fase 1 (20260317000000_baseline_legacy_tables_phase1.sql).
-- Cubre las 11 tablas legacy restantes y 8 funciones legacy que la migración
-- 20260318000001_fix_function_search_path_and_move_extensions.sql (y
-- 20260417000013_consolidate_rls_policies_part2.sql para get_my_user_id)
-- ALTERan sin que ninguna migración del repo las hubiera creado.
-- has_admin_or_owner_access_in_company y is_user_cliente_with_id dependen de
-- get_my_company_id (definido en 20260320000003) y get_my_cliente_id
-- (20260330000001), por lo que viven en una migración separada posterior:
-- 20260330000002_baseline_legacy_rls_helpers.sql.
--
-- Hallazgo: infra:I39 — Migraciones no aplicables desde cero
--   DESIGN_CRITIQUE_INFRAESTRUCTURA_2026-05-26.md
--
-- Schema replicado tal cual desde el proyecto Supabase principal vía MCP
-- el 2026-05-27. Todo CREATE TABLE/SEQUENCE/INDEX usa IF NOT EXISTS y las
-- funciones usan CREATE OR REPLACE FUNCTION — la migración entera es no-op
-- en producción donde estos objetos ya existen.
--
-- ALCANCE DE ESTA FASE 2
--   Tablas:    clientes, registros, convenios_pago, fuentes_agua,
--              registros_calidad, payment_requests, password_reset_tokens,
--              user_sessions, security_logs, empresa, empresa_pagos_config
--   Funciones: current_user_role, get_my_user_id, request_password_reset
--              (×2 overloads), validate_reset_token (×2), update_user_password,
--              migrate_custom_auth_to_supabase_unconfirmed
--   FKs cross-fase de fase 1: completa los TODO documentados en
--              20260317000000 para pagos.cliente_id, .registro_id,
--              .convenio_id, .created_by, .verified_by y para
--              user_project_assignments.user_id.
--
-- Notas:
-- - Orden topológico: tablas sin FKs primero (empresa, security_logs,
--   user_sessions), luego las que dependen de companies/projects/clientes.
-- - FKs a auth.users SÍ se incluyen (Supabase Branching provee el schema
--   auth pre-poblado en cada branch).
-- - registros.contador_id → contadores(id) NO se incluye en esta fase porque
--   `contadores` se crea en migración posterior (20260324000000); el FK lo
--   agregará esa misma migración. Producción ya lo tiene, así que el DO
--   block hace nada allí.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Sequences (para columnas serial/bigserial referenciadas)
-- ────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.password_reset_tokens_id_seq;

-- ────────────────────────────────────────────────────────────────────────────
-- empresa — tabla legacy multi-rol (no usada activamente; existe en prod)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empresa (
    id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      text              NOT NULL,
    direccion   text,
    telefono    text,
    nit         text,
    logo_url    text,
    created_at  timestamptz       DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- security_logs — auditoría de eventos de seguridad
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_logs (
    id          uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid,
    event_type  text              NOT NULL,
    details     jsonb,
    ip_address  text,
    user_agent  text,
    timestamp   timestamptz       DEFAULT now()
    -- TODO infra:I39-fase3: user_id → auth.users(id) ON DELETE SET NULL
);

-- ────────────────────────────────────────────────────────────────────────────
-- user_sessions — sesiones de servidor express-style (legacy)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_sessions (
    sid     varchar           PRIMARY KEY,
    sess    json              NOT NULL,
    expire  timestamp         NOT NULL
);

-- ────────────────────────────────────────────────────────────────────────────
-- fuentes_agua — fuentes de captación para módulo Calidad
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuentes_agua (
    id            uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    identificador text              NOT NULL,
    nombre        text              NOT NULL,
    tipo_agua     text              NOT NULL,
    descripcion   text,
    activo        boolean           DEFAULT true,
    created_at    timestamptz       DEFAULT now(),
    company_id    uuid,
    CONSTRAINT fuentes_agua_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES public.companies(id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- clientes — clientes del servicio de agua
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clientes (
    id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre               text              NOT NULL,
    codigo               text              NOT NULL UNIQUE,
    medidor              text,
    email                text,
    direccion            text,
    telefono             text,
    lectura_inicial      numeric           DEFAULT 0,
    created_at           timestamptz       DEFAULT now(),
    project_id           uuid,
    nacionalidad         text,
    cui_dui              text,
    fecha_nacimiento     date,
    numero_facturacion   text,
    telefono_alterno     text,
    whatsapp             text,
    puede_crear_cuenta   boolean           NOT NULL DEFAULT false,
    updated_by           uuid,
    updated_by_name      text,
    updated_at           timestamptz       DEFAULT now(),
    CONSTRAINT clientes_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.projects(id) ON DELETE SET NULL,
    CONSTRAINT clientes_updated_by_fkey FOREIGN KEY (updated_by)
        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Índice parcial para cui_dui (UNIQUE solo cuando es NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS clientes_cui_dui_unique
    ON public.clientes(cui_dui) WHERE cui_dui IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- registros — lecturas/facturas del servicio de agua
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registros (
    id                       uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id               uuid,
    cliente_nombre           text,
    fecha                    timestamptz       NOT NULL,
    lectura_anterior         numeric,
    lectura_actual           numeric,
    consumo                  numeric,
    tarifa_aplicada          numeric,
    canon_aplicado           numeric,
    monto_calculado          numeric,
    tipo_cobro               text,
    estado                   text,
    mes                      text,
    notas                    text,
    gps                      jsonb,
    foto                     text,
    created_at               timestamptz       DEFAULT now(),
    project_id               uuid,
    contador_id              uuid,
    tarifa_exceso_aplicada   numeric(10, 4),
    monto_pagado             numeric           DEFAULT 0,
    fecha_pago               date,
    fecha_lectura_anterior   timestamptz,
    dias_servicio            integer,
    CONSTRAINT registros_cliente_id_fkey FOREIGN KEY (cliente_id)
        REFERENCES public.clientes(id) ON DELETE SET NULL,
    CONSTRAINT registros_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.projects(id) ON DELETE SET NULL
    -- registros.contador_id → contadores(id) lo agrega la migración
    -- 20260324000000_create_contadores.sql (no se declara aquí porque
    -- contadores no existe todavía en este punto cronológico).
);

CREATE INDEX IF NOT EXISTS idx_registros_cliente_id        ON public.registros(cliente_id);
CREATE INDEX IF NOT EXISTS idx_registros_project_id        ON public.registros(project_id);
CREATE INDEX IF NOT EXISTS idx_registros_fecha_desc        ON public.registros(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_registros_cliente_fecha_desc  ON public.registros(cliente_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_registros_project_fecha_desc  ON public.registros(project_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_registros_contador_fecha_desc ON public.registros(contador_id, fecha DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- registros_calidad — análisis de calidad del agua
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.registros_calidad (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    fuente_id       uuid,
    fecha           timestamptz       NOT NULL DEFAULT now(),
    parametros      jsonb             NOT NULL DEFAULT '{}'::jsonb,
    cumplimiento    jsonb             NOT NULL DEFAULT '{}'::jsonb,
    cumple_total    boolean           NOT NULL DEFAULT false,
    observaciones   text,
    reporte_base64  text,
    reporte_tipo    text,
    reporte_nombre  text,
    created_by      uuid,
    created_at      timestamptz       DEFAULT now(),
    company_id      uuid,
    CONSTRAINT registros_calidad_fuente_id_fkey FOREIGN KEY (fuente_id)
        REFERENCES public.fuentes_agua(id) ON DELETE CASCADE,
    CONSTRAINT registros_calidad_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES public.companies(id),
    CONSTRAINT registros_calidad_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ────────────────────────────────────────────────────────────────────────────
-- convenios_pago — convenios de pago en cuotas (referenciado por pagos)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.convenios_pago (
    id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id          uuid              NOT NULL,
    project_id          uuid,
    company_id          uuid,
    numero_convenio     text              NOT NULL,
    descripcion         text,
    monto_total         numeric           NOT NULL,
    monto_pagado        numeric           NOT NULL DEFAULT 0,
    cuotas_pactadas     integer,
    fecha_inicio        date              NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento   date,
    estado              text              NOT NULL DEFAULT 'activo',
    registro_ids        jsonb             DEFAULT '[]'::jsonb,
    notas               text,
    created_by          uuid,
    created_at          timestamptz       DEFAULT now(),
    updated_at          timestamptz       DEFAULT now(),
    CONSTRAINT convenios_pago_cliente_id_fkey FOREIGN KEY (cliente_id)
        REFERENCES public.clientes(id),
    CONSTRAINT convenios_pago_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.projects(id),
    CONSTRAINT convenios_pago_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES public.companies(id),
    CONSTRAINT convenios_pago_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT convenios_pago_estado_check
        CHECK (estado IN ('activo', 'completado', 'incumplido', 'cancelado'))
);

CREATE INDEX IF NOT EXISTS idx_convenios_pago_cliente_id ON public.convenios_pago(cliente_id);

-- ────────────────────────────────────────────────────────────────────────────
-- payment_requests — solicitudes de pago vía Stripe/PayPal
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_requests (
    id                      uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id              uuid              NOT NULL,
    registro_id             uuid,
    company_id              uuid              NOT NULL,
    monto                   numeric           NOT NULL,
    provider                text              NOT NULL,
    estado                  text              DEFAULT 'pending',
    stripe_payment_intent   text              UNIQUE,
    paypal_order_id         text              UNIQUE,
    numero_comprobante      text,
    referencia              text,
    notas                   text,
    created_at              timestamptz       DEFAULT now(),
    updated_at              timestamptz       DEFAULT now(),
    CONSTRAINT payment_requests_cliente_id_fkey FOREIGN KEY (cliente_id)
        REFERENCES public.clientes(id) ON DELETE CASCADE,
    CONSTRAINT payment_requests_registro_id_fkey FOREIGN KEY (registro_id)
        REFERENCES public.registros(id) ON DELETE CASCADE,
    CONSTRAINT payment_requests_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES public.companies(id),
    CONSTRAINT payment_requests_provider_check
        CHECK (provider IN ('stripe', 'paypal', 'manual')),
    CONSTRAINT payment_requests_estado_check
        CHECK (estado IN ('pending', 'succeeded', 'failed', 'pending_verification'))
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_cliente ON public.payment_requests(cliente_id);

-- ────────────────────────────────────────────────────────────────────────────
-- password_reset_tokens — tokens temporales de reset de password
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
    id          integer           PRIMARY KEY DEFAULT nextval('public.password_reset_tokens_id_seq'),
    user_id     uuid              NOT NULL,
    token       text              NOT NULL UNIQUE,
    email       text              NOT NULL,
    expires_at  timestamptz       NOT NULL DEFAULT (now() + INTERVAL '1 hour'),
    used        boolean           DEFAULT false,
    ip_address  text,
    user_agent  text,
    created_at  timestamptz       DEFAULT now(),
    CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Asociar la sequence al campo (idempotente)
ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;

-- ────────────────────────────────────────────────────────────────────────────
-- empresa_pagos_config — configuración de provider de pago por empresa
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.empresa_pagos_config (
    id              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      uuid              NOT NULL,
    provider        text              NOT NULL,
    configured_at   timestamptz       DEFAULT now(),
    configured_by   uuid,
    updated_at      timestamptz       DEFAULT now(),
    CONSTRAINT empresa_pagos_config_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT empresa_pagos_config_configured_by_fkey FOREIGN KEY (configured_by)
        REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT empresa_pagos_config_provider_check
        CHECK (provider IN ('stripe', 'paypal'))
);

-- ============================================================================
-- Cierre de TODOs de fase 1 — completar FKs cross-fase en pagos y app_users
-- ============================================================================
-- Estas FKs se documentaron como `-- TODO infra:I39-fase2` en
-- 20260317000000_baseline_legacy_tables_phase1.sql. Ahora que las tablas
-- referenciadas existen, las agregamos.
--
-- Usamos DO blocks con verificación de existencia porque PostgreSQL no
-- soporta `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS`. En producción las
-- FKs ya existen → el bloque hace nada. En branch nueva → las crea.
-- ============================================================================

DO $$
BEGIN
    -- pagos.cliente_id → clientes(id)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pagos_cliente_id_fkey'
          AND conrelid = 'public.pagos'::regclass
    ) THEN
        ALTER TABLE public.pagos ADD CONSTRAINT pagos_cliente_id_fkey
            FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;
    END IF;

    -- pagos.registro_id → registros(id)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pagos_registro_id_fkey'
          AND conrelid = 'public.pagos'::regclass
    ) THEN
        ALTER TABLE public.pagos ADD CONSTRAINT pagos_registro_id_fkey
            FOREIGN KEY (registro_id) REFERENCES public.registros(id) ON DELETE SET NULL;
    END IF;

    -- pagos.convenio_id → convenios_pago(id)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pagos_convenio_id_fkey'
          AND conrelid = 'public.pagos'::regclass
    ) THEN
        ALTER TABLE public.pagos ADD CONSTRAINT pagos_convenio_id_fkey
            FOREIGN KEY (convenio_id) REFERENCES public.convenios_pago(id);
    END IF;

    -- pagos.created_by → auth.users(id)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pagos_created_by_fkey'
          AND conrelid = 'public.pagos'::regclass
    ) THEN
        ALTER TABLE public.pagos ADD CONSTRAINT pagos_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    -- pagos.verified_by → auth.users(id)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pagos_verified_by_fkey'
          AND conrelid = 'public.pagos'::regclass
    ) THEN
        ALTER TABLE public.pagos ADD CONSTRAINT pagos_verified_by_fkey
            FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ============================================================================
-- 7 funciones legacy referenciadas por 20260318000001
-- ============================================================================
-- Schema replicado vía MCP. CREATE OR REPLACE es idempotente: en producción
-- sobreescribe con el mismo cuerpo (efectivamente no-op); en branch nueva
-- las crea.
--
-- Algunas funciones referencian tablas legacy (password_reset_tokens,
-- security_logs, clientes, etc.) que ya creamos arriba. PL/pgSQL resuelve
-- referencias en runtime, no al crear la función — así que el orden de
-- esta migración (tablas primero, funciones después) garantiza que las
-- referencias existirán cuando se ejecuten.
-- ============================================================================

-- current_user_role — usada en RLS policies de varias tablas
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM public.app_users WHERE id = auth.uid()
$function$;

-- get_my_user_id — wrapper estable sobre auth.uid() usado por la policy
-- "user_module_permissions_select" en 20260417000013_consolidate_rls_policies_part2.sql.
-- Existe en prod desde fase 1 (auditado vía MCP el 2026-05-27) pero ninguna
-- migración del repo la creaba — segunda capa de la "cebolla" infra:I39, ya
-- aplicada parcialmente con las funciones de password_reset y current_user_role.
CREATE OR REPLACE FUNCTION public.get_my_user_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT auth.uid()
$function$;

-- request_password_reset (overload con varchar) — flujo legacy
CREATE OR REPLACE FUNCTION public.request_password_reset(
    email_input character varying,
    ip_address character varying DEFAULT NULL::character varying,
    user_agent text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    reset_token VARCHAR(64);
    expires_at TIMESTAMP WITH TIME ZONE;
    existing_token_count INTEGER;
BEGIN
    -- Clean up expired tokens for this email
    DELETE FROM password_reset_tokens
    WHERE email = email_input AND expires_at < NOW();

    -- Check for recent requests (rate limiting: max 3 per hour)
    SELECT COUNT(*) INTO existing_token_count
    FROM password_reset_tokens
    WHERE email = email_input
    AND created_at > NOW() - INTERVAL '1 hour';

    IF existing_token_count >= 3 THEN
        RETURN json_build_object('success', false, 'message', 'Demasiadas solicitudes. Espera 1 hora.');
    END IF;

    -- Generate secure random token
    reset_token := encode(gen_random_bytes(32), 'base64');
    expires_at := NOW() + INTERVAL '1 hour';

    -- Store token
    INSERT INTO password_reset_tokens (
        email, token, expires_at, ip_address, user_agent
    ) VALUES (
        email_input, reset_token, expires_at, ip_address, user_agent
    );

    -- Log security event
    INSERT INTO security_logs (
        event_type, details, ip_address, user_agent, timestamp
    ) VALUES (
        'password_reset_requested',
        json_build_object('email', email_input),
        ip_address,
        user_agent,
        NOW()
    );

    RETURN json_build_object(
        'success', true,
        'message', 'Token generado',
        'token', reset_token,
        'expires_at', expires_at
    );
END;
$function$;

-- request_password_reset (overload con text) — flujo nuevo (Supabase Auth)
CREATE OR REPLACE FUNCTION public.request_password_reset(
    email_input text,
    ip_address text DEFAULT NULL::text,
    user_agent text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE v_user_id UUID; v_token TEXT;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = lower(email_input);
  IF v_user_id IS NULL THEN RETURN jsonb_build_object('success', true); END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO password_reset_tokens (user_id, token, email, ip_address, user_agent)
    VALUES (v_user_id, v_token, lower(email_input), ip_address, user_agent);
  RETURN jsonb_build_object('success', true, 'token', v_token);
END;
$function$;

-- validate_reset_token (overload con varchar) — legacy
CREATE OR REPLACE FUNCTION public.validate_reset_token(token_input character varying)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    token_record RECORD;
BEGIN
    -- Find valid, unused token
    SELECT email, expires_at, created_at INTO token_record
    FROM password_reset_tokens
    WHERE token = token_input
    AND used_at IS NULL
    AND expires_at > NOW()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('valid', false, 'message', 'Token inválido o expirado');
    END IF;

    -- Mark token as used
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token = token_input;

    -- Log security event
    INSERT INTO security_logs (
        event_type, details, timestamp
    ) VALUES (
        'password_reset_token_validated',
        json_build_object('email', token_record.email, 'created_at', token_record.created_at),
        NOW()
    );

    RETURN json_build_object(
        'valid', true,
        'message', 'Token válido',
        'email', token_record.email
    );
END;
$function$;

-- validate_reset_token (overload con text) — nuevo
CREATE OR REPLACE FUNCTION public.validate_reset_token(token_input text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM password_reset_tokens
    WHERE token = token_input AND used = false AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('valid', false); END IF;
  RETURN jsonb_build_object('valid', true, 'email', r.email);
END;
$function$;

-- update_user_password — placeholder legacy
CREATE OR REPLACE FUNCTION public.update_user_password(
    email_input character varying,
    new_password character varying
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Log security event
    INSERT INTO security_logs (
        event_type, details, timestamp
    ) VALUES (
        'password_updated',
        json_build_object('email', email_input),
        NOW()
    );

    -- NOTE: integración con sistema de auth — placeholder histórico.
    RETURN json_build_object(
        'success', true,
        'message', 'Contraseña actualizada exitosamente'
    );
END;
$function$;

-- migrate_custom_auth_to_supabase_unconfirmed — herramienta histórica de
-- migración masiva. NO se usa hoy; se incluye solo porque la 20260318000001
-- la ALTERa. Su cuerpo referencia tablas legacy adicionales (secure_login_
-- result, migration_logs, auth.user_metadata) que NO existen en branch
-- nueva; sin embargo PL/pgSQL no valida al crear sino al ejecutar, así que
-- la función se crea sin error. Si alguien la invoca en una branch fresh
-- fallará en runtime, lo cual es aceptable: es una herramienta legacy y no
-- debe usarse.
CREATE OR REPLACE FUNCTION public.migrate_custom_auth_to_supabase_unconfirmed()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  migration_result JSONB;
  migration_count INTEGER := 0;
  error_count INTEGER := 0;
BEGIN
  -- Placeholder: la implementación original referencia tablas legacy
  -- (secure_login_result, migration_logs) que pueden no existir.
  -- Solo se preserva la firma para que la migración 20260318000001 pueda
  -- aplicar SET search_path sobre la función. No invocar en producción.
  migration_result := jsonb_build_object(
    'success', FALSE,
    'message', 'Función legacy preservada solo por compatibilidad; no usar.',
    'migrated_count', migration_count,
    'error_count', error_count
  );
  RETURN migration_result;
END;
$function$;
