-- Fix: INSERT into broadcast_recipients blocked by RLS because company_id
-- was NULL (old app code didn't set it). Split the FOR ALL policy into
-- separate per-operation policies so INSERT checks via broadcast_id instead
-- of requiring company_id on the new row. Add trigger to auto-populate it.

-- 1. Replace the combined policy with per-operation policies
DROP POLICY IF EXISTS "staff_recipients_all" ON broadcast_recipients;

-- SELECT / UPDATE / DELETE — use company_id directly (indexed, fast, no join)
CREATE POLICY "staff_recipients_select" ON broadcast_recipients
  FOR SELECT
  USING (company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid()));

CREATE POLICY "staff_recipients_update" ON broadcast_recipients
  FOR UPDATE
  USING (company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid()));

CREATE POLICY "staff_recipients_delete" ON broadcast_recipients
  FOR DELETE
  USING (company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid()));

-- INSERT — check via broadcast_id (broadcasts RLS no longer references
-- broadcast_recipients, so no recursion)
CREATE POLICY "staff_recipients_insert" ON broadcast_recipients
  FOR INSERT
  WITH CHECK (
    broadcast_id IN (
      SELECT id FROM broadcasts
      WHERE company_id IN (SELECT company_id FROM app_users WHERE id = auth.uid())
    )
  );

-- 2. Auto-populate company_id on insert so SELECT/UPDATE/DELETE policies
--    work even when the app doesn't set it explicitly
CREATE OR REPLACE FUNCTION fn_set_recipient_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id
    FROM broadcasts WHERE id = NEW.broadcast_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recipient_company_id ON broadcast_recipients;
CREATE TRIGGER trg_recipient_company_id
  BEFORE INSERT ON broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION fn_set_recipient_company_id();
