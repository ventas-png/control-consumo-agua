-- company_email_configs: Google OAuth credentials for email sending per company
CREATE TABLE IF NOT EXISTS company_email_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  is_superadmin boolean NOT NULL DEFAULT false,
  provider text NOT NULL DEFAULT 'google',
  email text,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One config per company
CREATE UNIQUE INDEX IF NOT EXISTS company_email_configs_company_unique
  ON company_email_configs(company_id)
  WHERE company_id IS NOT NULL;

-- One superadmin config
CREATE UNIQUE INDEX IF NOT EXISTS company_email_configs_superadmin_unique
  ON company_email_configs(is_superadmin)
  WHERE is_superadmin = true;

ALTER TABLE company_email_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_email_configs_select" ON company_email_configs
  FOR SELECT USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

CREATE POLICY "company_email_configs_insert" ON company_email_configs
  FOR INSERT WITH CHECK (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

CREATE POLICY "company_email_configs_update" ON company_email_configs
  FOR UPDATE USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

CREATE POLICY "company_email_configs_delete" ON company_email_configs
  FOR DELETE USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

-- email_templates: custom HTML templates per company
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  is_superadmin boolean NOT NULL DEFAULT false,
  template_key text NOT NULL,
  subject text NOT NULL,
  html_body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_templates_company_template_key UNIQUE (company_id, template_key)
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_templates_select" ON email_templates
  FOR SELECT USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

CREATE POLICY "email_templates_insert" ON email_templates
  FOR INSERT WITH CHECK (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

CREATE POLICY "email_templates_update" ON email_templates
  FOR UPDATE USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

CREATE POLICY "email_templates_delete" ON email_templates
  FOR DELETE USING (
    (company_id IS NOT NULL AND company_id = (
      SELECT company_id FROM app_users WHERE id = auth.uid() LIMIT 1
    ))
    OR
    (is_superadmin = true AND EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid() AND role = 'super_admin' LIMIT 1
    ))
  );

-- Trigger: keep updated_at current
CREATE OR REPLACE FUNCTION update_email_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_company_email_configs_updated_at
  BEFORE UPDATE ON company_email_configs
  FOR EACH ROW EXECUTE FUNCTION update_email_config_updated_at();

CREATE TRIGGER trg_email_templates_updated_at
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_email_config_updated_at();

-- Service role bypass policies for Edge Functions
CREATE POLICY "service_role_company_email_configs" ON company_email_configs
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_email_templates" ON email_templates
  TO service_role USING (true) WITH CHECK (true);
