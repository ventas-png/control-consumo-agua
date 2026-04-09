-- ── Tabla: conversation_assignments ──────────────────────────────────────────
-- Permite asignar una conversación a múltiples agentes del equipo.
-- seen_at = NULL  →  el agente aún no ha visto la asignación (indicador visual)
-- seen_at = timestamp → el agente ya abrió la conversación tras ser asignado

CREATE TABLE IF NOT EXISTS public.conversation_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  user_name         text NOT NULL,
  assigned_by_id    uuid NOT NULL,
  assigned_by_name  text NOT NULL,
  seen_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conv_assignments_conversation_idx ON public.conversation_assignments(conversation_id);
CREATE INDEX IF NOT EXISTS conv_assignments_user_idx        ON public.conversation_assignments(user_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;

-- super_admin: acceso total
CREATE POLICY "ca_super_admin_all"
  ON public.conversation_assignments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid() AND u.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = auth.uid() AND u.role = 'super_admin'
    )
  );

-- company_owner / admin: CRUD en asignaciones de su empresa
CREATE POLICY "ca_company_admin_all"
  ON public.conversation_assignments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = auth.uid()
        AND u.role IN ('company_owner', 'admin')
        AND u.company_id = c.company_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = auth.uid()
        AND u.role IN ('company_owner', 'admin')
        AND u.company_id = c.company_id
    )
  );

-- operator / collector con can_assign=true: pueden insertar y eliminar asignaciones
CREATE POLICY "ca_agent_can_assign_insert"
  ON public.conversation_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.conversations c ON c.id = conversation_assignments.conversation_id
      JOIN public.conversation_access_rules ar
        ON ar.company_id = c.company_id AND ar.role = u.role
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'collector')
        AND u.company_id = c.company_id
        AND ar.can_assign = true
    )
  );

CREATE POLICY "ca_agent_can_assign_delete"
  ON public.conversation_assignments
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.conversations c ON c.id = conversation_assignments.conversation_id
      JOIN public.conversation_access_rules ar
        ON ar.company_id = c.company_id AND ar.role = u.role
      WHERE u.id = auth.uid()
        AND u.role IN ('operator', 'collector')
        AND u.company_id = c.company_id
        AND ar.can_assign = true
    )
  );

-- Todos los agentes de la empresa pueden leer asignaciones de sus conversaciones
CREATE POLICY "ca_agent_select"
  ON public.conversation_assignments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      JOIN public.conversations c ON c.id = conversation_assignments.conversation_id
      WHERE u.id = auth.uid()
        AND u.role NOT IN ('super_admin', 'cliente')
        AND u.company_id = c.company_id
    )
  );

-- Cualquier agente puede actualizar su propio seen_at (marcar como visto)
CREATE POLICY "ca_agent_update_seen"
  ON public.conversation_assignments
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
