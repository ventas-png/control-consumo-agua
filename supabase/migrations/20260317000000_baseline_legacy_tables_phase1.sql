-- ============================================================================
-- Baseline legacy tables — phase 1 (5 of 16)
-- ============================================================================
-- Tablas que existen en el proyecto Supabase principal pero nunca fueron
-- creadas vía migración versionada. Schema replicado tal cual desde
-- producción (catalogado vía MCP el 2026-05-27).
--
-- Hallazgo: infra:I39 — Migraciones no aplicables desde cero
--   DESIGN_CRITIQUE_INFRAESTRUCTURA_2026-05-26.md
--
-- Motivo: la siguiente migración cronológica
-- (20260318000000_enable_rls_public_schema.sql) ejecuta
--   ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.projects  ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
-- pero ninguna migración creaba esas tablas, por lo que Supabase Branching
-- (DB nueva por PR) explota con SQLSTATE 42P01 en el primer ALTER. Esta
-- migración remedia ese error específico aplicando CREATE TABLE IF NOT EXISTS
-- (idempotente: no afecta producción donde las tablas ya existen).
--
-- ALCANCE EXPLÍCITO DE ESTA FASE 1
--   Incluye:  app_users, companies, projects, user_project_assignments, pagos
--   Omite:    clientes, registros, convenios_pago, empresa,
--             empresa_pagos_config, fuentes_agua, password_reset_tokens,
--             payment_requests, registros_calidad, security_logs,
--             user_sessions
--
-- Las 11 tablas omitidas también son legacy (existen en prod sin migración)
-- y deben abordarse en una fase 2 separada para mantener cada PR contenido.
--
-- Las FOREIGN KEYS que apuntan a tablas fuera de esta fase (auth.users de
-- otro schema, y las tablas legacy de fase 2) quedan documentadas como
-- TODO infra:I39-fase2 y se agregarán en su PR correspondiente. Sin esas
-- FKs las tablas siguen siendo funcionales; solo pierden integridad
-- referencial declarativa en branches/staging/dev (en producción las FKs
-- siguen existiendo intactas porque IF NOT EXISTS no las recrea).
--
-- NOTA SOBRE app_users:
-- La migración 20260320000000_fix_superadmin_app_users_uuid.sql hace
-- DROP TABLE IF EXISTS app_users CASCADE + CREATE TABLE. En DB nueva, eso
-- borrará la tabla que crea este baseline y la recreará con el mismo schema
-- + INSERT del super_admin inicial. En producción, IF NOT EXISTS hace que
-- esta migración sea no-op y la cadena sigue como hasta ahora.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- app_users — usuarios de la app vinculados a auth.users (mismo id)
-- ────────────────────────────────────────────────────────────────────────────
-- Schema replica el de la migración 20260320000000 que DROP+CREATE esta tabla
-- (con role check más amplio). La migración 20260318000000 hace ENABLE RLS
-- sobre app_users antes de la 20260320, por lo que necesitamos crearla aquí.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_users (
    id              uuid              PRIMARY KEY,
    full_name       text,
    role            text              NOT NULL,
    created_at      timestamptz       DEFAULT now(),
    cliente_id      uuid,
    permission_type text,
    project_id      uuid,
    company_id      uuid,
    activo          boolean           NOT NULL DEFAULT true,
    CONSTRAINT app_users_role_check CHECK (role IN (
        'super_admin','superadmin','company_owner','admin','operator',
        'user','viewer','visor','operador','cliente'
    )),
    CONSTRAINT app_users_permission_type_check CHECK (permission_type IS NULL OR permission_type IN (
        'total','lectura','financiero','administrativo'
    ))
    -- TODO infra:I39-fase2:
    --   id → auth.users(id) ON DELETE CASCADE (cross-schema)
    --   company_id → companies(id) ON DELETE CASCADE (FK opcional)
    --   project_id → projects(id) ON DELETE SET NULL (FK opcional)
    --   cliente_id → clientes(id) ON DELETE SET NULL (cross-fase)
);

-- ────────────────────────────────────────────────────────────────────────────
-- companies — empresa/tenant operadora (raíz de la jerarquía multi-tenant)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
    id                      uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre                  text              NOT NULL,
    nit                     text,
    email                   text,
    telefono                text,
    plan                    text              NOT NULL DEFAULT 'basico',
    activa                  boolean           NOT NULL DEFAULT true,
    created_at              timestamptz       DEFAULT now(),
    max_projects            integer           NOT NULL DEFAULT 5,
    logo_url                text,
    max_units               integer           NOT NULL DEFAULT 50,
    stripe_public_key       text,
    stripe_configured       boolean           DEFAULT false,
    paypal_client_id        text,
    paypal_configured       boolean           DEFAULT false,
    stripe_activo           boolean           DEFAULT false,
    paypal_activo           boolean           DEFAULT false,
    default_currency        varchar(3)        NOT NULL DEFAULT 'usd',
    servicio_agua           boolean           NOT NULL DEFAULT true,
    servicio_condominios    boolean           NOT NULL DEFAULT true,
    paypal_currency_code    text              DEFAULT 'USD',
    CONSTRAINT companies_plan_check CHECK (plan IN ('basico', 'profesional', 'enterprise')),
    CONSTRAINT valid_currency CHECK (default_currency::text IN (
        'usd','eur','gbp','jpy','aud','cad','chf','cny','inr','mxn',
        'nzd','sgd','hkd','nok','sek','dkk','pln','czk','huf','ron',
        'bgn','hrk','rub','try','brl','ars','clp','cop','pen','uyu',
        'idr','myr','php','thb','vnd','zar','kes','egp','aed','qar'
    ))
);

-- ────────────────────────────────────────────────────────────────────────────
-- projects — proyecto (condominio o servicio de agua) dentro de una empresa
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
    id                              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id                      uuid              NOT NULL,
    nombre                          text              NOT NULL,
    descripcion                     text,
    activo                          boolean           NOT NULL DEFAULT true,
    created_at                      timestamptz       DEFAULT now(),
    logo_url                        text,
    direccion                       text,
    latitud                         double precision,
    longitud                        double precision,
    moneda                          text              NOT NULL DEFAULT 'Q',
    estado                          text              NOT NULL DEFAULT 'activo',
    max_unidades_apartamento        integer,
    max_unidades_casa               integer,
    max_unidades_bodega             integer,
    max_unidades_local_comercial    integer,
    max_unidades_oficina            integer,
    max_unidades_parqueadero        integer,
    max_unidades_otro               integer,
    tipo                            text              NOT NULL DEFAULT 'agua',
    segmento                        text,
    moneda_condominios              text,
    CONSTRAINT projects_company_id_fkey FOREIGN KEY (company_id)
        REFERENCES public.companies(id) ON DELETE CASCADE,
    CONSTRAINT projects_estado_check CHECK (estado IN ('activo', 'inactivo', 'suspendido'))
);

CREATE INDEX IF NOT EXISTS idx_projects_company_id ON public.projects(company_id);

-- ────────────────────────────────────────────────────────────────────────────
-- user_project_assignments — asignación de usuarios a proyectos con permiso
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_project_assignments (
    id                  uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid              NOT NULL,
    project_id          uuid              NOT NULL,
    permission_type     text              NOT NULL DEFAULT 'total',
    created_at          timestamptz       DEFAULT now(),
    CONSTRAINT user_project_assignments_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.projects(id) ON DELETE CASCADE,
    CONSTRAINT user_project_assignments_user_id_project_id_key UNIQUE (user_id, project_id),
    CONSTRAINT user_project_assignments_permission_type_check
        CHECK (permission_type IN ('total', 'lectura', 'financiero', 'administrativo'))
    -- TODO infra:I39-fase2: user_id → auth.users(id) ON DELETE CASCADE (cross-schema)
);

CREATE INDEX IF NOT EXISTS idx_user_project_assignments_user_id ON public.user_project_assignments(user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- pagos — pagos recibidos del cliente (agua y/o condominios)
-- ────────────────────────────────────────────────────────────────────────────
-- Nota: las FKs a clientes/registros/convenios_pago/auth.users quedan como
-- TODO infra:I39-fase2 porque esas tablas se baselinean en la próxima fase.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pagos (
    id                              uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    registro_id                     uuid,
    cliente_id                      uuid              NOT NULL,
    project_id                      uuid,
    monto                           numeric(10, 2)    NOT NULL,
    metodo                          text              NOT NULL,
    referencia                      text,
    boleta_url                      text,
    paypal_order_id                 text,
    estado                          text              NOT NULL DEFAULT 'pendiente',
    notas                           text,
    created_at                      timestamptz       DEFAULT now(),
    numero_documento                text,
    tipo_aplicacion                 text              DEFAULT 'pago_total',
    convenio_id                     uuid,
    created_by                      uuid,
    updated_at                      timestamptz       DEFAULT now(),
    comprobante_url                 text,
    comprobante_tipo                text,
    verification_status             text              DEFAULT 'pendiente',
    verification_notes              text,
    verified_by                     uuid,
    verified_at                     timestamptz,
    stripe_payment_intent_id        text              UNIQUE,
    paypal_transaction_id           text              UNIQUE,
    CONSTRAINT pagos_project_id_fkey FOREIGN KEY (project_id)
        REFERENCES public.projects(id) ON DELETE SET NULL,
    CONSTRAINT pagos_estado_check
        CHECK (estado IN ('pendiente', 'verificado', 'rechazado', 'aplicado')),
    CONSTRAINT pagos_metodo_check
        CHECK (metodo IN ('efectivo', 'transferencia', 'deposito', 'tarjeta_credito',
                          'tarjeta_debito', 'cheque', 'convenio_pago', 'paypal', 'otro')),
    CONSTRAINT pagos_tipo_aplicacion_check
        CHECK (tipo_aplicacion IN ('pago_total', 'abono', 'convenio')),
    CONSTRAINT pagos_verification_status_check
        CHECK (verification_status IN ('pendiente', 'verificado', 'rechazado', 'aplicado')),
    CONSTRAINT pagos_comprobante_tipo_check
        CHECK (comprobante_tipo IS NULL OR comprobante_tipo IN ('imagen', 'pdf'))
    -- TODO infra:I39-fase2:
    --   cliente_id   → clientes(id)         ON DELETE CASCADE
    --   registro_id  → registros(id)        ON DELETE SET NULL
    --   convenio_id  → convenios_pago(id)
    --   created_by   → auth.users(id)       ON DELETE SET NULL (cross-schema)
    --   verified_by  → auth.users(id)       ON DELETE SET NULL (cross-schema)
);

CREATE INDEX IF NOT EXISTS idx_pagos_cliente_id ON public.pagos(cliente_id);
