-- ── Fase 37: Órdenes de compra, asambleas digitales, QR access ────────────────

-- Órdenes de compra
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  correlativo   serial,
  proveedor_nombre text NOT NULL,
  concepto      text NOT NULL,
  descripcion   text,
  monto_estimado numeric(12,2),
  monto_real    numeric(12,2),
  fecha_entrega_esperada date,
  estado        text NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador','aprobada','emitida','recibida','cancelada')),
  notas         text,
  created_by    uuid REFERENCES app_users(id),
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE ordenes_compra ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ordenes_compra_select" ON ordenes_compra
  FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "ordenes_compra_insert" ON ordenes_compra
  FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "ordenes_compra_update" ON ordenes_compra
  FOR UPDATE USING (company_id = get_my_company_id());

CREATE POLICY "ordenes_compra_delete" ON ordenes_compra
  FOR DELETE USING (company_id = get_my_company_id() AND current_user_role() IN ('admin','superadmin'));

-- Asambleas digitales
CREATE TABLE IF NOT EXISTS asambleas_digital (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  titulo            text NOT NULL,
  descripcion       text,
  fecha_hora        timestamptz NOT NULL,
  modalidad         text NOT NULL DEFAULT 'presencial'
                      CHECK (modalidad IN ('presencial','virtual','hibrida')),
  link_reunion      text,
  quorum_requerido  int NOT NULL DEFAULT 50,
  estado            text NOT NULL DEFAULT 'programada'
                      CHECK (estado IN ('programada','en_curso','finalizada','cancelada')),
  acta_url          text,
  created_by        uuid REFERENCES app_users(id),
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE asambleas_digital ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asambleas_digital_select" ON asambleas_digital
  FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "asambleas_digital_insert" ON asambleas_digital
  FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "asambleas_digital_update" ON asambleas_digital
  FOR UPDATE USING (company_id = get_my_company_id());

CREATE POLICY "asambleas_digital_delete" ON asambleas_digital
  FOR DELETE USING (company_id = get_my_company_id() AND current_user_role() IN ('admin','superadmin'));

-- Extend visitantes with QR fields
ALTER TABLE visitantes
  ADD COLUMN IF NOT EXISTS qr_token    text,
  ADD COLUMN IF NOT EXISTS valido_hasta timestamptz;

CREATE INDEX IF NOT EXISTS idx_visitantes_qr_token ON visitantes(qr_token) WHERE qr_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_project ON ordenes_compra(project_id, estado);
CREATE INDEX IF NOT EXISTS idx_asambleas_digital_project ON asambleas_digital(project_id, estado);
