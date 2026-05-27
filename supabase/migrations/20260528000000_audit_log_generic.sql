-- ============================================================================
-- Audit log genérico trigger-based (cond:C9, F2.7)
-- ============================================================================
-- Tabla genérica que captura cada INSERT/UPDATE/DELETE en tablas críticas:
-- finanzas (pagos, cuotas, fondo de reserva, gastos) y soporte (tickets).
-- Complementa las bitácoras especializadas que ya existen (permission_audit_log,
-- generacion_cuotas_log, conciliacion_cobros_log) — no las reemplaza.
--
-- Diseño:
--   - Triggers AFTER en cada tabla → audit_trigger_func() SECURITY DEFINER.
--   - audit_log.before / .after guardan el row completo en jsonb. Permite
--     reconstruir el diff cuando se investigue un incidente.
--   - company_id y project_id se extraen del row (si existen) para que la
--     policy SELECT pueda filtrar por tenant sin joinear cada vez.
--   - actor_id = auth.uid() del JWT activo al momento del cambio. NULL si la
--     mutación vino de un proceso server-side (edge function con service role).
--
-- RLS:
--   - SELECT: super_admin ve todo; admin/company_owner ve su company.
--   - Sin INSERT/UPDATE/DELETE policies → ningún cliente puede escribir
--     directamente. El trigger es SECURITY DEFINER y bypassea RLS.
--
-- Performance:
--   - Indices por (table_name, record_id, occurred_at) para "historia de
--     este row", (actor_id, occurred_at) para "qué hizo este usuario",
--     (company_id, occurred_at) para feeds por tenant.
--
-- Tablas incluidas en este lote (5 críticas financieras + operativas):
--   pagos, cuotas_condominio, fondo_reserva_condominio, gastos_condominio,
--   tickets_mantenimiento.
-- Próximas (PRs siguientes): visitantes, paquetes_recibidos, mascotas, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          bigserial   PRIMARY KEY,
  table_name  text        NOT NULL,
  record_id   uuid,
  action      text        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  before      jsonb,
  after       jsonb,
  company_id  uuid,
  project_id  uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record
  ON public.audit_log(table_name, record_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON public.audit_log(actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_company
  ON public.audit_log(company_id, occurred_at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_recent
  ON public.audit_log(occurred_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND current_user_role() = ANY(ARRAY['company_owner', 'admin'])
    )
  );

COMMENT ON TABLE public.audit_log IS
  'Bitácora genérica de cambios en tablas críticas. Escrita por audit_trigger_func() SECURITY DEFINER. Solo lectura para admin/owner del tenant.';

-- ────────────────────────────────────────────────────────────────────────────
-- audit_trigger_func — función única reutilizada por todos los triggers.
-- ────────────────────────────────────────────────────────────────────────────
-- Extrae company_id / project_id del row para scoping. Si la tabla solo trae
-- project_id (caso: pagos), resuelve company_id via projects. Si tampoco hay
-- project_id ni company_id (entidad cross-tenant rara), deja NULL — esa fila
-- solo será visible para super_admin.
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_before     jsonb;
  v_after      jsonb;
  v_record_id  uuid;
  v_company_id uuid;
  v_project_id uuid;
  v_actor_id   uuid := auth.uid();
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_before := to_jsonb(OLD);
    v_after := NULL;
    v_record_id := NULLIF(v_before->>'id', '')::uuid;
  ELSIF (TG_OP = 'INSERT') THEN
    v_before := NULL;
    v_after := to_jsonb(NEW);
    v_record_id := NULLIF(v_after->>'id', '')::uuid;
  ELSE
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    v_record_id := NULLIF(v_after->>'id', '')::uuid;
  END IF;

  v_company_id := NULLIF(COALESCE(v_after->>'company_id', v_before->>'company_id'), '')::uuid;
  v_project_id := NULLIF(COALESCE(v_after->>'project_id', v_before->>'project_id'), '')::uuid;

  IF v_company_id IS NULL AND v_project_id IS NOT NULL THEN
    SELECT p.company_id INTO v_company_id
    FROM public.projects p
    WHERE p.id = v_project_id;
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, before, after, company_id, project_id)
  VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_actor_id, v_before, v_after, v_company_id, v_project_id);

  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Triggers en tablas críticas
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_pagos ON public.pagos;
CREATE TRIGGER audit_pagos
  AFTER INSERT OR UPDATE OR DELETE ON public.pagos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_cuotas_condominio ON public.cuotas_condominio;
CREATE TRIGGER audit_cuotas_condominio
  AFTER INSERT OR UPDATE OR DELETE ON public.cuotas_condominio
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_fondo_reserva_condominio ON public.fondo_reserva_condominio;
CREATE TRIGGER audit_fondo_reserva_condominio
  AFTER INSERT OR UPDATE OR DELETE ON public.fondo_reserva_condominio
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_gastos_condominio ON public.gastos_condominio;
CREATE TRIGGER audit_gastos_condominio
  AFTER INSERT OR UPDATE OR DELETE ON public.gastos_condominio
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

DROP TRIGGER IF EXISTS audit_tickets_mantenimiento ON public.tickets_mantenimiento;
CREATE TRIGGER audit_tickets_mantenimiento
  AFTER INSERT OR UPDATE OR DELETE ON public.tickets_mantenimiento
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
