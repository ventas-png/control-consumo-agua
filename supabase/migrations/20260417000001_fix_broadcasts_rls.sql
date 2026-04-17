-- Fix: infinite recursion in broadcasts RLS policies.
-- Root cause: broadcasts policy queried broadcast_recipients, whose policy
-- queried back broadcasts → circular reference. Solution: add company_id to
-- broadcast_recipients so staff policies never need to reference broadcasts.

-- 1. Drop all existing policies
DROP POLICY IF EXISTS "staff_broadcasts_all"        ON broadcasts;
DROP POLICY IF EXISTS "staff_recipients_select"     ON broadcast_recipients;
DROP POLICY IF EXISTS "staff_recipients_insert"     ON broadcast_recipients;
DROP POLICY IF EXISTS "staff_recipients_update"     ON broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_select"   ON broadcast_recipients;
DROP POLICY IF EXISTS "cliente_recipients_read"     ON broadcast_recipients;
DROP POLICY IF EXISTS "cliente_broadcasts_select"   ON broadcasts;

-- 2. Add company_id to broadcast_recipients (avoids cross-table RLS lookup)
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE broadcast_recipients br
SET company_id = b.company_id
FROM broadcasts b
WHERE br.broadcast_id = b.id;

CREATE INDEX IF NOT EXISTS broadcast_recipients_company_id_idx
  ON broadcast_recipients (company_id);

-- 3. Recreate policies — zero circular references

-- Staff: full CRUD on broadcasts of their company
CREATE POLICY "staff_broadcasts_all" ON broadcasts
  FOR ALL
  USING (company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid()));

-- Staff: full CRUD on recipients — uses company_id directly, no broadcasts join
CREATE POLICY "staff_recipients_all" ON broadcast_recipients
  FOR ALL
  USING (company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid()));

-- Client: read broadcasts of their company (no broadcast_recipients join → no recursion)
CREATE POLICY "cliente_broadcasts_select" ON broadcasts
  FOR SELECT
  USING (company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid()));

-- Client: read their own recipients (no broadcasts join → no recursion)
CREATE POLICY "cliente_recipients_select" ON broadcast_recipients
  FOR SELECT
  USING (
    cliente_id IN (
      SELECT cliente_id FROM company_clientes
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- Client: update read_at on their own recipients
CREATE POLICY "cliente_recipients_update" ON broadcast_recipients
  FOR UPDATE
  USING (
    cliente_id IN (
      SELECT cliente_id FROM company_clientes
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );
