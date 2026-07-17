-- ============================================================================
-- Reportes guardados: whitelist ampliada (auditoría 2026-07-16, C4 / V5)
-- ============================================================================
-- Amplía el CHECK de report_templates.source_table con las dos fuentes más
-- pedidas del negocio de agua y del backoffice contable:
--   · registros      — lecturas/recibos de agua (el corazón del vertical agua)
--   · conta_asientos — asientos del libro diario (backoffice contable)
--
-- Notas de scoping que implementan el edge y runReportQuery (no esta migración):
--   · `registros` y `pagos` NO tienen company_id: su aislamiento de tenant va
--     por project_id ∈ (proyectos de la empresa). El filtro fijo por company_id
--     que usaba el runner rompía los reportes de `pagos` desde el día uno.
--   · `conta_asientos` y `gastos_condominio` NO tienen deleted_at: el filtro
--     fijo `.is('deleted_at', null)` rompía los reportes de `gastos_condominio`.
--   · `registros` NUNCA se consulta con select('*') en reportes: excluye `foto`
--     (data-URI base64 de hasta ~15 MB por fila) y `gps`.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.
-- ============================================================================

ALTER TABLE public.report_templates
  DROP CONSTRAINT IF EXISTS report_templates_source_table_check;

ALTER TABLE public.report_templates
  ADD CONSTRAINT report_templates_source_table_check CHECK (source_table IN (
    'cuotas_condominio',
    'pagos',
    'tickets_mantenimiento',
    'gastos_condominio',
    'fondo_reserva_condominio',
    'registros',
    'conta_asientos'
  ));

COMMENT ON CONSTRAINT report_templates_source_table_check ON public.report_templates IS
  'Whitelist de tablas fuente para reportes guardados (anti SQL injection). v2: + registros, conta_asientos. Auditoría 2026-07-16, C4.';
