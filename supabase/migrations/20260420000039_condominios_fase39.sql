-- ── Fase 39: Kanban Tickets, Conciliación de Cobros ─────────────────────────

-- Conciliación de cobros (log de pagos conciliados contra cuotas)
CREATE TABLE IF NOT EXISTS conciliacion_cobros_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cuota_id       uuid NOT NULL REFERENCES cuotas_condominio(id) ON DELETE CASCADE,
  unidad_id      uuid NOT NULL REFERENCES unidades(id),
  monto_cuota    numeric(12,2) NOT NULL,
  monto_recibido numeric(12,2) NOT NULL,
  diferencia     numeric(12,2) NOT NULL GENERATED ALWAYS AS (monto_recibido - monto_cuota) STORED,
  referencia_pago text,
  fecha_pago     date NOT NULL DEFAULT CURRENT_DATE,
  metodo_pago    text NOT NULL DEFAULT 'efectivo',
  notas          text,
  estado         text NOT NULL DEFAULT 'conciliado'
                   CHECK (estado IN ('conciliado', 'diferencia')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conciliacion_cobros_project  ON conciliacion_cobros_log(project_id);
CREATE INDEX IF NOT EXISTS idx_conciliacion_cobros_cuota    ON conciliacion_cobros_log(cuota_id);
CREATE INDEX IF NOT EXISTS idx_conciliacion_cobros_unidad   ON conciliacion_cobros_log(unidad_id);
CREATE INDEX IF NOT EXISTS idx_conciliacion_cobros_created  ON conciliacion_cobros_log(created_at DESC);

-- RLS
ALTER TABLE conciliacion_cobros_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conciliacion_cobros_select" ON conciliacion_cobros_log
  FOR SELECT USING (company_id = get_my_company_id());

CREATE POLICY "conciliacion_cobros_insert" ON conciliacion_cobros_log
  FOR INSERT WITH CHECK (company_id = get_my_company_id());

CREATE POLICY "conciliacion_cobros_update" ON conciliacion_cobros_log
  FOR UPDATE USING (company_id = get_my_company_id());

CREATE POLICY "conciliacion_cobros_delete" ON conciliacion_cobros_log
  FOR DELETE USING (
    company_id = get_my_company_id()
    AND current_user_role() IN ('admin', 'superadmin')
  );
