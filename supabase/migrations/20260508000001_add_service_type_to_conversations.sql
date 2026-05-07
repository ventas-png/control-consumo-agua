-- Add service_type to conversations to separate agua vs condominios threads
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'agua'
    CHECK (service_type IN ('agua', 'condominios'));

CREATE INDEX IF NOT EXISTS conversations_service_type_idx
  ON public.conversations (service_type);

-- Add service_type to conversation_access_rules so each service has its own rule set
ALTER TABLE public.conversation_access_rules
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'agua'
    CHECK (service_type IN ('agua', 'condominios'));

-- Replace unique constraint to include service_type
ALTER TABLE public.conversation_access_rules
  DROP CONSTRAINT IF EXISTS conversation_access_rules_company_id_role_key;

ALTER TABLE public.conversation_access_rules
  ADD CONSTRAINT conversation_access_rules_company_id_role_service_type_key
    UNIQUE (company_id, role, service_type);

CREATE INDEX IF NOT EXISTS conv_access_rules_service_type_idx
  ON public.conversation_access_rules (service_type);
