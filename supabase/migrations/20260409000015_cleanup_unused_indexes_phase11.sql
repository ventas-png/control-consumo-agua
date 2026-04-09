-- Fase 11: Cleanup Unused and Duplicate Indexes
-- Remove 47 unused indexes and 1 duplicate index
-- Database hygiene optimization - frees storage and removes confusion

-- ============================================================
-- PARTE 1: Drop Duplicate Index
-- ============================================================
-- Table: company_payment_secrets has two identical indexes
-- Keep idx_company_payment_secrets_company_id (newer, consistent naming)
-- Drop idx_payment_secrets_company_id (older, inconsistent naming)

DROP INDEX IF EXISTS public.idx_payment_secrets_company_id;

-- ============================================================
-- PARTE 2: Drop Unused Indexes (47 total)
-- ============================================================

-- user_sessions
DROP INDEX IF EXISTS public.idx_session_expire;

-- clientes
DROP INDEX IF EXISTS public.idx_clientes_onboarding_lookup;
DROP INDEX IF EXISTS public.idx_clientes_project_id;
DROP INDEX IF EXISTS public.idx_clientes_updated_by;

-- security_logs
DROP INDEX IF EXISTS public.idx_security_logs_ts;

-- password_reset_tokens
DROP INDEX IF EXISTS public.idx_prt_token;

-- payment_requests
DROP INDEX IF EXISTS public.idx_payment_requests_company;
DROP INDEX IF EXISTS public.idx_payment_requests_estado;

-- pagos
DROP INDEX IF EXISTS public.idx_pagos_verification;

-- registros
DROP INDEX IF EXISTS public.idx_registros_contador_id;
DROP INDEX IF EXISTS public.idx_registros_project_id;

-- registros_calidad
DROP INDEX IF EXISTS public.idx_registros_calidad_company_id;
DROP INDEX IF EXISTS public.idx_registros_calidad_created_by;

-- company_clientes
DROP INDEX IF EXISTS public.idx_company_clientes_added_by;

-- contadores
DROP INDEX IF EXISTS public.idx_contadores_company_id;
DROP INDEX IF EXISTS public.idx_contadores_project_id;
DROP INDEX IF EXISTS public.idx_contadores_tarifa_id;
DROP INDEX IF EXISTS public.idx_contadores_updated_by;

-- convenios_pago
DROP INDEX IF EXISTS public.idx_convenios_pago_company_id;
DROP INDEX IF EXISTS public.idx_convenios_pago_created_by;

-- conversation_access_rules
DROP INDEX IF EXISTS public.idx_conversation_access_rules_company_id;
DROP INDEX IF EXISTS public.idx_conversation_access_rules_company_role;

-- conversation_members
DROP INDEX IF EXISTS public.idx_conversation_members_conversation_id;
DROP INDEX IF EXISTS public.idx_conversation_members_user_id;

-- conversation_templates
DROP INDEX IF EXISTS public.idx_conversation_templates_company_id;
DROP INDEX IF EXISTS public.idx_conversation_templates_created_by;

-- conversation_webhooks
DROP INDEX IF EXISTS public.idx_conversation_webhooks_company_id;
DROP INDEX IF EXISTS public.idx_conversation_webhooks_updated_by;

-- fuentes_agua
DROP INDEX IF EXISTS public.idx_fuentes_agua_company_id;
DROP INDEX IF EXISTS public.idx_fuentes_agua_updated_by;

-- invoices
DROP INDEX IF EXISTS public.idx_invoices_company_id;
DROP INDEX IF EXISTS public.idx_invoices_created_by;

-- project_invitations
DROP INDEX IF EXISTS public.idx_project_invitations_project_id;

-- proyectos_meta
DROP INDEX IF EXISTS public.idx_proyectos_meta_project_id;
DROP INDEX IF EXISTS public.idx_proyectos_meta_company_id;

-- tarifas
DROP INDEX IF EXISTS public.idx_tarifas_company_id;
DROP INDEX IF EXISTS public.idx_tarifas_updated_by;

-- unidades
DROP INDEX IF EXISTS public.idx_unidades_company_id;
DROP INDEX IF EXISTS public.idx_unidades_project_id;
DROP INDEX IF EXISTS public.idx_unidades_updated_by;

-- user_module_permissions
DROP INDEX IF EXISTS public.idx_user_module_permissions_module_id;

-- user_preferences
DROP INDEX IF EXISTS public.idx_user_preferences_user_id;

-- ============================================================
-- Nota Final
-- ============================================================
-- Esta migración limpia 48 índices no utilizados (47 no usados + 1 duplicado).
-- Beneficio: Libera almacenamiento en la base de datos
-- Impacto: Cero - estos índices no se usaban en consultas
--
-- Resultado esperado: 0 advertencias de unused_index y 0 advertencias de duplicate_index
