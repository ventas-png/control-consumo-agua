-- ── Fase 43: Fondo de Reserva, Configuración del Condominio ─────────────────

CREATE TABLE IF NOT EXISTS fondo_reserva (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tipo        text NOT NULL CHECK (tipo IN ('aportacion', 'retiro', 'rendimiento', 'ajuste')),
  concepto    text NOT NULL,
  monto       numeric(12,2) NOT NULL CHECK (monto > 0),
  fecha       date NOT NULL DEFAULT CURRENT_DATE,
  referencia  text,
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fondo_reserva_project  ON fondo_reserva(project_id);
CREATE INDEX IF NOT EXISTS idx_fondo_reserva_fecha    ON fondo_reserva(fecha DESC);

ALTER TABLE fondo_reserva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fondo_reserva_select" ON fondo_reserva
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "fondo_reserva_insert" ON fondo_reserva
  FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "fondo_reserva_update" ON fondo_reserva
  FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "fondo_reserva_delete" ON fondo_reserva
  FOR DELETE USING (company_id = get_my_company_id() AND current_user_role() IN ('admin','superadmin'));

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS config_condominio (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id                      uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  cuota_base                      numeric(10,2),
  dias_gracia                     int NOT NULL DEFAULT 5,
  tasa_mora_mensual               numeric(5,2) NOT NULL DEFAULT 2.0,
  metodos_pago                    text[] NOT NULL DEFAULT ARRAY['efectivo','transferencia'],
  nombre_administrador            text,
  telefono_admin                  text,
  email_admin                     text,
  reglamento_url                  text,
  notif_dias_antes_vencimiento    int NOT NULL DEFAULT 3,
  permitir_reservas_online        boolean NOT NULL DEFAULT true,
  max_reservas_por_unidad_mes     int NOT NULL DEFAULT 3,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_config_cond_project ON config_condominio(project_id);

ALTER TABLE config_condominio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "config_cond_select" ON config_condominio
  FOR SELECT USING (company_id = get_my_company_id());
CREATE POLICY "config_cond_insert" ON config_condominio
  FOR INSERT WITH CHECK (company_id = get_my_company_id());
CREATE POLICY "config_cond_update" ON config_condominio
  FOR UPDATE USING (company_id = get_my_company_id());
CREATE POLICY "config_cond_delete" ON config_condominio
  FOR DELETE USING (company_id = get_my_company_id() AND current_user_role() IN ('admin','superadmin'));
