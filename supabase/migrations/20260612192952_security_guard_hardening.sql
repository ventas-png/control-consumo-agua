-- =====================================================================
-- Security guard hardening — cierra los hallazgos del run post-merge #522.
-- Idempotente; YA APLICADA a prod vía MCP con esta misma versión (db push la verá aplicada) para que la
-- corrida nocturna del guard (07:00 UTC) pase sin esperar el siguiente deploy.
--
-- (a) SECURITY DEFINER anon-ejecutables (guard T8, clase #378/#380):
--     · 14 funciones TRIGGER del módulo contabilidad/ledger (bandas
--       20260611–20260612) que heredaron el EXECUTE de PUBLIC por default.
--       Las funciones que devuelven `trigger` jamás se invocan vía PostgREST
--       y su privilegio EXECUTE no se verifica al disparar el trigger →
--       revocar a PUBLIC/anon/authenticated es seguro (precedente:
--       20260520233407_security_harden_trigger_functions).
--     · company_is_active(uuid) (20260612180000): los triggers de enforcement
--       NO son SECURITY DEFINER y corren como el usuario que escribe, así que
--       authenticated SÍ necesita EXECUTE — se revoca solo PUBLIC/anon.
-- (c) Tablas de public con RLS sin policy: conta_folios (ledger) y
--     platform_metrics_daily (20260612180100). Ambas son internas (las
--     escriben funciones definer / se leen vía RPC definer); se agrega una
--     policy SELECT solo-superadmin que mantiene el deny para usuarios
--     normales y deja el allowlist del guard vacío.
-- =====================================================================

-- ── (a) Funciones trigger del ledger: nadie las ejecuta directo ──
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'banco_tg_cuenta_mismo_ledger()',
    'conta_seed_on_company()',
    'conta_seed_on_project()',
    'conta_tg_cuotas()',
    'conta_tg_facturas_prov()',
    'conta_tg_gastos()',
    'conta_tg_mapeo_mismo_ledger()',
    'conta_tg_ordenes_pago()',
    'conta_tg_pagos()',
    'conta_tg_registros()',
    'cxp_tg_orden_saldo()',
    'presupuesto_archivar_anterior()',
    'presupuesto_tg_alerta_gasto()',
    'presupuesto_tg_partida_mismo_ledger()'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- ── (a) company_is_active: el chequeo de suspensión corre como el usuario
--        autenticado (triggers no-definer) — solo se cierra PUBLIC/anon ──
REVOKE EXECUTE ON FUNCTION public.company_is_active(uuid) FROM PUBLIC, anon;

-- ── (c) Policies mínimas (solo superadmin) para tablas internas ──
DROP POLICY IF EXISTS platform_metrics_daily_select ON public.platform_metrics_daily;
CREATE POLICY platform_metrics_daily_select ON public.platform_metrics_daily
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS conta_folios_select ON public.conta_folios;
CREATE POLICY conta_folios_select ON public.conta_folios
  FOR SELECT TO authenticated
  USING (public.is_super_admin());
