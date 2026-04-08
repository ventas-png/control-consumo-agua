-- ─────────────────────────────────────────────────────────────────────────────
-- Centro de Comunicación Cliente ↔ Empresa
-- Tablas: conversations, conversation_messages, conversation_access_rules
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Tabla principal de conversaciones ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  project_id     uuid,                            -- opcional: liga a proyecto
  cliente_id     uuid NOT NULL,                   -- cliente que abre la conversación
  cliente_nombre text,                            -- desnormalizado para consultas rápidas
  subject        text NOT NULL,
  category       text NOT NULL DEFAULT 'general', -- general | pagos | tecnico | calidad
  priority       text NOT NULL DEFAULT 'media',   -- baja | media | alta | urgente
  status         text NOT NULL DEFAULT 'abierta', -- abierta | en_progreso | esperando_cliente | resuelta | cerrada
  assigned_to    uuid,                            -- user_id del agente asignado (app_users)
  assigned_name  text,                            -- desnormalizado
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_company_id_idx  ON public.conversations (company_id);
CREATE INDEX IF NOT EXISTS conversations_cliente_id_idx  ON public.conversations (cliente_id);
CREATE INDEX IF NOT EXISTS conversations_assigned_to_idx ON public.conversations (assigned_to);
CREATE INDEX IF NOT EXISTS conversations_status_idx      ON public.conversations (status);

-- ── 2. Mensajes dentro de una conversación ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL,             -- auth.uid() del remitente
  sender_type      text NOT NULL,             -- 'cliente' | 'agent'
  sender_name      text,                      -- desnormalizado
  body             text NOT NULL,
  is_internal_note boolean NOT NULL DEFAULT false, -- true = solo visible para agentes
  read_at          timestamptz,               -- cuándo lo leyó el destinatario
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conv_messages_conversation_id_idx ON public.conversation_messages (conversation_id);
CREATE INDEX IF NOT EXISTS conv_messages_sender_id_idx       ON public.conversation_messages (sender_id);

-- ── 3. Reglas de acceso por rol (configura la empresa) ──────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_access_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  role            text NOT NULL,              -- admin | operator | collector | viewer
  can_view_all    boolean NOT NULL DEFAULT false,
  can_respond     boolean NOT NULL DEFAULT false,
  can_assign      boolean NOT NULL DEFAULT false,
  categories      text[],                     -- null = todas; ['pagos','tecnico'] = solo esas
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, role)
);

CREATE INDEX IF NOT EXISTS conv_access_rules_company_id_idx ON public.conversation_access_rules (company_id);

-- ── 4. Trigger: updated_at automático ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_conversations_updated_at'
  ) THEN
    CREATE TRIGGER trg_conversations_updated_at
      BEFORE UPDATE ON public.conversations
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_conv_access_rules_updated_at'
  ) THEN
    CREATE TRIGGER trg_conv_access_rules_updated_at
      BEFORE UPDATE ON public.conversation_access_rules
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ── 5. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE public.conversations              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_access_rules  ENABLE ROW LEVEL SECURITY;

-- ── conversations ────────────────────────────────────────────────────────────

-- super_admin: acceso total
CREATE POLICY "super_admin full access on conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.app_users WHERE id = auth.uid() AND role = 'super_admin')
  );

-- company_owner: todas las de su empresa
CREATE POLICY "company_owner access on conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = conversations.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'company_owner' AND company_id = conversations.company_id
    )
  );

-- admin: todas las de su empresa
CREATE POLICY "admin access on conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND company_id = conversations.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'admin' AND company_id = conversations.company_id
    )
  );

-- operator / collector / viewer: solo las asignadas a ellos (o si tienen can_view_all)
CREATE POLICY "agent limited access on conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'collector', 'viewer')
        AND u.company_id = conversations.company_id
        AND (
          -- asignada a este agente
          conversations.assigned_to = auth.uid()
          OR
          -- tiene permiso de ver todas
          EXISTS (
            SELECT 1 FROM public.conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR conversations.category = ANY(r.categories))
          )
        )
    )
  );

-- cliente: solo sus propias conversaciones
CREATE POLICY "cliente access on own conversations" ON public.conversations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'cliente' AND cliente_id = conversations.cliente_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid() AND role = 'cliente' AND cliente_id = conversations.cliente_id
    )
  );

-- ── conversation_messages ────────────────────────────────────────────────────

-- super_admin / company_owner / admin: todos los mensajes de conversaciones a las que tienen acceso
CREATE POLICY "privileged access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND (
          u.role = 'super_admin'
          OR (u.role IN ('company_owner', 'admin') AND u.company_id = c.company_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND (
          u.role = 'super_admin'
          OR (u.role IN ('company_owner', 'admin') AND u.company_id = c.company_id)
        )
    )
  );

-- cliente: mensajes NO internos de sus propias conversaciones
CREATE POLICY "cliente access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role = 'cliente'
        AND u.cliente_id = c.cliente_id
        AND conversation_messages.is_internal_note = false
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role = 'cliente'
        AND u.cliente_id = c.cliente_id
        AND conversation_messages.is_internal_note = false
    )
  );

-- agentes (operator / collector): mensajes de conversaciones que pueden ver
CREATE POLICY "agent access on conversation_messages" ON public.conversation_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role IN ('operator', 'collector', 'viewer')
        AND u.company_id = c.company_id
        AND (
          c.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
              AND (r.categories IS NULL OR c.category = ANY(r.categories))
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      JOIN public.app_users u ON u.id = auth.uid()
      WHERE c.id = conversation_messages.conversation_id
        AND u.role IN ('operator', 'collector', 'viewer')
        AND u.company_id = c.company_id
        AND (
          c.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.conversation_access_rules r
            WHERE r.company_id = u.company_id
              AND r.role = u.role
              AND r.can_view_all = true
            AND (r.categories IS NULL OR c.category = ANY(r.categories))
          )
        )
    )
  );

-- ── conversation_access_rules ────────────────────────────────────────────────

CREATE POLICY "company_owner manages access rules" ON public.conversation_access_rules
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'company_owner')
        AND (role = 'super_admin' OR company_id = conversation_access_rules.company_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND role IN ('super_admin', 'company_owner')
        AND (role = 'super_admin' OR company_id = conversation_access_rules.company_id)
    )
  );

CREATE POLICY "agents can read own access rules" ON public.conversation_access_rules
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users
      WHERE id = auth.uid()
        AND company_id = conversation_access_rules.company_id
    )
  );

-- ── 6. Insertar reglas por defecto para company_owner (se ejecuta una sola vez como demo) ──
-- Las empresas reales configurarán sus propias reglas desde el panel.
-- Esta función puede llamarse desde el backend al crear una empresa.
CREATE OR REPLACE FUNCTION public.create_default_conversation_access_rules(p_company_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.conversation_access_rules (company_id, role, can_view_all, can_respond, can_assign, categories)
  VALUES
    (p_company_id, 'admin',     true,  true,  true,  NULL),
    (p_company_id, 'collector', false, true,  false, ARRAY['pagos', 'general']),
    (p_company_id, 'operator',  false, true,  false, ARRAY['tecnico', 'calidad', 'general']),
    (p_company_id, 'viewer',    true,  false, false, NULL)
  ON CONFLICT (company_id, role) DO NOTHING;
END;
$$;
