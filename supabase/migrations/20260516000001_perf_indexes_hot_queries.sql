-- Performance indexes for hot read paths identified by the 2026-05-16 audit.
-- All indexes are CREATE INDEX IF NOT EXISTS so re-running the migration is safe.

-- ── registros: portal cliente filters by cliente_id and orders by fecha ──
-- CustomerPortal queries: .eq('cliente_id', X).order('fecha', { ascending: false })
-- A composite (cliente_id, fecha DESC) index lets the planner satisfy both
-- the WHERE and the ORDER BY without an extra sort step.
CREATE INDEX IF NOT EXISTS idx_registros_cliente_fecha_desc
  ON public.registros (cliente_id, fecha DESC);

-- ── registros: fallback query in CustomerPortal by contador_id ──
CREATE INDEX IF NOT EXISTS idx_registros_contador_fecha_desc
  ON public.registros (contador_id, fecha DESC);

-- ── conversations: App.tsx polls company_id + status, useConversations subscribes by company_id ──
CREATE INDEX IF NOT EXISTS idx_conversations_company_status
  ON public.conversations (company_id, status);

-- Service-type filter (agua / condominios / interna) is also common in the
-- conversation list; together with the existing index this lets us skip
-- service routing in JS.
CREATE INDEX IF NOT EXISTS idx_conversations_company_service_status
  ON public.conversations (company_id, service_type, status);

-- ── cuotas_condominio: CondominiosSection orders by created_at DESC, filtered by project ──
CREATE INDEX IF NOT EXISTS idx_cuotas_condominio_project_created
  ON public.cuotas_condominio (project_id, created_at DESC);

-- ── gastos_condominio: ordered by fecha DESC per project ──
CREATE INDEX IF NOT EXISTS idx_gastos_condominio_project_fecha
  ON public.gastos_condominio (project_id, fecha DESC);

-- ── tickets_mantenimiento: ordered by created_at DESC per project ──
CREATE INDEX IF NOT EXISTS idx_tickets_mant_project_created
  ON public.tickets_mantenimiento (project_id, created_at DESC);

-- ── avisos_cobro: ordered by fecha_emision DESC per project ──
CREATE INDEX IF NOT EXISTS idx_avisos_cobro_project_fecha
  ON public.avisos_cobro (project_id, fecha_emision DESC);

-- ── bitacora_acciones: filtered by company, ordered by created_at DESC ──
CREATE INDEX IF NOT EXISTS idx_bitacora_acciones_company_created
  ON public.bitacora_acciones (company_id, created_at DESC);

-- ── unidades: CustomerPortal filters by cliente_id + activo ──
CREATE INDEX IF NOT EXISTS idx_unidades_cliente_activo
  ON public.unidades (cliente_id, activo)
  WHERE cliente_id IS NOT NULL;

-- (company_clientes.cliente_id already indexed by
--  20260407000002_fix_security_warnings_and_add_fk_indexes.sql)

-- ── contadores: CustomerPortal queries IN (unidad_ids) + activo ──
CREATE INDEX IF NOT EXISTS idx_contadores_unidad_activo
  ON public.contadores (unidad_id, activo)
  WHERE unidad_id IS NOT NULL;
