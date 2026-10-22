-- ════════════════════════════════════════════════════════════════════════════
-- Estado previo a 20261104090000: las dos tablas que toca, con sus columnas
-- reales, y una factura por cada caso que la corrección tiene que distinguir.
-- ════════════════════════════════════════════════════════════════════════════
-- Columnas copiadas de 20260414000001_create_servicios_energia.sql (montos
-- numeric(12,2) NOT NULL DEFAULT 0) y de 20260528000000_audit_log_generic.sql.
-- Sin FKs ni RLS: la migración corre como dueño de las tablas y no las usa.

CREATE TABLE public.facturas_energia (
  id                        uuid          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id                uuid          NOT NULL,
  company_id                uuid          NOT NULL,
  fuente_energia_id         uuid          NOT NULL,
  numero_factura            text,
  periodo_inicio            date          NOT NULL,
  periodo_fin               date          NOT NULL,
  kwh_consumidos            numeric(12,3) NOT NULL DEFAULT 0,
  kwh_generados             numeric(12,3) NOT NULL DEFAULT 0,
  kwh_exportados            numeric(12,3) NOT NULL DEFAULT 0,
  kw_demanda_max            numeric(10,2),
  monto_energia             numeric(12,2) NOT NULL DEFAULT 0,
  monto_potencia            numeric(12,2) NOT NULL DEFAULT 0,
  monto_cargo_fijo          numeric(12,2) NOT NULL DEFAULT 0,
  monto_alumbrado           numeric(12,2) NOT NULL DEFAULT 0,
  monto_iva                 numeric(12,2) NOT NULL DEFAULT 0,
  monto_credito_exportacion numeric(12,2) NOT NULL DEFAULT 0,
  monto_otros               numeric(12,2) NOT NULL DEFAULT 0,
  monto_total               numeric(12,2) NOT NULL DEFAULT 0,
  moneda                    text          NOT NULL DEFAULT 'Q',
  estado                    text          NOT NULL DEFAULT 'pendiente',
  notas                     text,
  created_at                timestamptz   DEFAULT now(),
  updated_at                timestamptz   DEFAULT now()
);

CREATE TABLE public.audit_log (
  id          bigserial   PRIMARY KEY,
  table_name  text        NOT NULL,
  record_id   uuid,
  action      text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id    uuid,
  before      jsonb,
  after       jsonb,
  company_id  uuid,
  project_id  uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Una fila de otra tabla, para comprobar que la reversión no la toca.
INSERT INTO public.audit_log (table_name, record_id, action, before, after)
VALUES ('pagos', '00000000-0000-0000-0000-0000000000aa', 'UPDATE',
        '{"monto_total": 1}', '{"monto_total": 2}');

-- Caso → montos (energía, potencia, cargo, alumbrado, IVA, crédito, otros) y total guardado.
--   A  capturada a mano                       250 + 30            total 0       → 280
--   B  crédito escrito en positivo            100 + 12 − 20       total 0       → 92, crédito −20
--   C  calculada con «otros» (no lo sumaba)   ver abajo           total 163.11  → 164.61
--   D  calculada y ajustada a mano            energía 130         total 163.11  → 169.65
--   E  ya correcta                            100 + 12            total 112     → sin cambio
--   F  solo total, desglose en cero           —                   total 1500    → sin cambio
--   G  todo en cero                           —                   total 0       → sin cambio
--   H  crédito mayor que los cargos           10 − 50             total 0       → −40
--   I  centavos                               0.10 + 0.20         total 0       → 0.30
--   J  crédito en negativo y total correcto   100 + 12 − 8        total 104     → sin cambio
INSERT INTO public.facturas_energia
  (id, company_id, project_id, fuente_energia_id, numero_factura, periodo_inicio, periodo_fin,
   monto_energia, monto_potencia, monto_cargo_fijo, monto_alumbrado, monto_iva,
   monto_credito_exportacion, monto_otros, monto_total, updated_at)
VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'A', '2026-01-01', '2026-01-31',
   250, 0, 0, 0, 30, 0, 0, 0, '2026-02-01 10:00+00'),
  ('a0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'B', '2026-02-01', '2026-02-28',
   100, 0, 0, 0, 12, 20, 0, 0, '2026-03-01 10:00+00'),
  ('a0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'C', '2026-01-01', '2026-01-31',
   123.46, 0, 12.50, 17.67, 17.48, -8, 1.50, 163.11, '2026-02-01 10:00+00'),
  ('a0000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'D', '2026-02-01', '2026-02-28',
   130.00, 0, 12.50, 17.67, 17.48, -8, 0, 163.11, '2026-03-01 10:00+00'),
  ('a0000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'E', '2026-01-01', '2026-01-31',
   100, 0, 0, 0, 12, 0, 0, 112, '2026-02-01 10:00+00'),
  ('a0000000-0000-0000-0000-00000000000f', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'F', '2026-02-01', '2026-02-28',
   0, 0, 0, 0, 0, 0, 0, 1500, '2026-03-01 10:00+00'),
  ('a0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000003', 'G', '2026-03-01', '2026-03-31',
   0, 0, 0, 0, 0, 0, 0, 0, '2026-04-01 10:00+00'),
  ('a0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004', 'H', '2026-01-01', '2026-01-31',
   10, 0, 0, 0, 0, -50, 0, 0, '2026-02-01 10:00+00'),
  ('a0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004', 'I', '2026-02-01', '2026-02-28',
   0.10, 0, 0, 0, 0.20, 0, 0, 0, '2026-03-01 10:00+00'),
  ('a0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004', 'J', '2026-03-01', '2026-03-31',
   100, 0, 0, 0, 12, -8, 0, 104, '2026-04-01 10:00+00');

-- Foto del estado previo, para comparar después de corregir y de revertir.
CREATE SCHEMA sandbox;
CREATE TABLE sandbox.antes AS TABLE public.facturas_energia;
