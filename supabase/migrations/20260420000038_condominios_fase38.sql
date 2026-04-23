-- ── Fase 38: Proformas / cotizaciones ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS proformas_condominio (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proveedor_nombre text NOT NULL,
  concepto         text NOT NULL,
  descripcion      text,
  monto            numeric(12,2),
  fecha_validez    date,
  estado           text NOT NULL DEFAULT 'borrador'
                     CHECK (estado IN ('borrador','enviada','aprobada','convertida_oc','rechazada')),
  notas            text,
  created_at       timestamptz DEFAULT now()
);

ALTER TABLE proformas_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "proformas_select" ON proformas_condominio
  FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "proformas_insert" ON proformas_condominio
  FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "proformas_update" ON proformas_condominio
  FOR UPDATE USING (company_id = get_my_company_id());

CREATE POLICY "proformas_delete" ON proformas_condominio
  FOR DELETE USING (company_id = get_my_company_id() AND current_user_role() IN ('admin','superadmin'));

CREATE INDEX IF NOT EXISTS idx_proformas_project ON proformas_condominio(project_id, estado);
