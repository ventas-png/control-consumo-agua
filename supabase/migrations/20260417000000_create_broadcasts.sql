-- Tabla principal de comunicados masivos
CREATE TABLE broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  title           text NOT NULL,
  body            text NOT NULL,
  sent_by_id      uuid NOT NULL,
  sent_by_name    text NOT NULL,
  target_type     text NOT NULL CHECK (target_type IN ('todos', 'proyecto', 'unidades', 'clientes')),
  target_ids      text[] NOT NULL DEFAULT '{}',
  recipient_count integer NOT NULL DEFAULT 0,
  send_email      boolean NOT NULL DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

-- Destinatarios individuales con tracking de lectura y email
CREATE TABLE broadcast_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  cliente_id   uuid NOT NULL,
  read_at      timestamptz,
  email_sent   boolean DEFAULT false,
  email_error  text,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (broadcast_id, cliente_id)
);

-- Índices para consultas frecuentes
CREATE INDEX ON broadcasts (company_id, created_at DESC);
CREATE INDEX ON broadcast_recipients (broadcast_id);
CREATE INDEX ON broadcast_recipients (cliente_id);

-- RLS
ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Staff (company_owner, admin, operator, etc.): acceso total sobre su empresa
CREATE POLICY "staff_broadcasts_all" ON broadcasts
  FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM app_users WHERE id = auth.uid()
    )
  );

-- Recipients: staff puede ver todos los de su empresa
CREATE POLICY "staff_recipients_select" ON broadcast_recipients
  FOR SELECT
  USING (
    broadcast_id IN (
      SELECT id FROM broadcasts
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- Staff puede insertar recipients
CREATE POLICY "staff_recipients_insert" ON broadcast_recipients
  FOR INSERT
  WITH CHECK (
    broadcast_id IN (
      SELECT id FROM broadcasts
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- Staff puede actualizar recipients (email_sent, email_error)
CREATE POLICY "staff_recipients_update" ON broadcast_recipients
  FOR UPDATE
  USING (
    broadcast_id IN (
      SELECT id FROM broadcasts
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- Cliente: solo ve sus propios recipients
CREATE POLICY "cliente_recipients_select" ON broadcast_recipients
  FOR SELECT
  USING (
    cliente_id IN (
      SELECT cliente_id FROM company_clientes
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- Cliente: puede actualizar read_at en sus propios recipients
CREATE POLICY "cliente_recipients_read" ON broadcast_recipients
  FOR UPDATE
  USING (
    cliente_id IN (
      SELECT cliente_id FROM company_clientes
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- Cliente: puede leer broadcasts asociados a sus recipients
CREATE POLICY "cliente_broadcasts_select" ON broadcasts
  FOR SELECT
  USING (
    id IN (
      SELECT broadcast_id FROM broadcast_recipients
      WHERE cliente_id IN (
        SELECT cliente_id FROM company_clientes
        WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
      )
    )
  );
