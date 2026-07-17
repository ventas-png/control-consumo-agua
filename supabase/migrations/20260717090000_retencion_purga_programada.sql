-- ============================================================================
-- Retención de datos y purga programada (auditoría 2026-07-16, E3 / D8, S10)
-- ============================================================================
-- Las tablas de alto churn crecen sin límite (bloat + superficie de datos
-- personales retenidos sin política, el señalamiento S10). Política:
--
--   audit_log            18 meses   (occurred_at)
--   notification_events   6 meses   (created_at)
--   email_send_queue      3 meses   (solo terminales: sent / failed_permanent;
--                                    las pending/sending JAMÁS se tocan)
--   soft-deleted         90 días    (pagos, cuotas_condominio, registros,
--                                    fondo_reserva_condominio,
--                                    tickets_mantenimiento — lo que el usuario
--                                    borró y nadie restauró en 90 días)
--
-- Guards de integridad (los soft-deleted se HARD-deletean, así que las FKs
-- importan):
--   · registros: NO se purga si tiene pagos (pagos.registro_id, SET NULL:
--     perdería el vínculo del dinero) ni documentos fiscales
--     (documentos_fiscales.registro_id es ON DELETE RESTRICT: fallaría).
--   · cuotas_condominio: NO se purga si tiene pagos (pagos.cuota_id).
--   · Cada paso corre en su propio bloque con EXCEPTION: si una FK futura no
--     contemplada bloquea una tabla, esa tabla se salta ESE mes (se reporta en
--     el jsonb) y el resto de la purga continúa — el cron nunca muere entero.
--
-- La función devuelve jsonb con el conteo por tabla; pg_cron guarda el output
-- en cron.job_run_details (trazabilidad de cada corrida). SECURITY DEFINER:
-- la invoca pg_cron sin sesión; REVOKE a roles de cliente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.purgar_datos_expirados(
  p_meses_audit    int DEFAULT 18,
  p_meses_notif    int DEFAULT 6,
  p_meses_email    int DEFAULT 3,
  p_dias_soft_del  int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resultado jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  -- ── audit_log > p_meses_audit ──────────────────────────────────────────
  BEGIN
    DELETE FROM public.audit_log
    WHERE occurred_at < now() - make_interval(months => p_meses_audit);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('audit_log', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('audit_log_error', SQLERRM);
  END;

  -- ── notification_events > p_meses_notif ───────────────────────────────
  BEGIN
    DELETE FROM public.notification_events
    WHERE created_at < now() - make_interval(months => p_meses_notif);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('notification_events', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('notification_events_error', SQLERRM);
  END;

  -- ── email_send_queue: SOLO estados terminales > p_meses_email ─────────
  BEGIN
    DELETE FROM public.email_send_queue
    WHERE status IN ('sent', 'failed_permanent')
      AND updated_at < now() - make_interval(months => p_meses_email);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('email_send_queue', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('email_send_queue_error', SQLERRM);
  END;

  -- ── soft-deleted > p_dias_soft_del ─────────────────────────────────────
  -- registros: sin pagos vinculados ni documento fiscal (RESTRICT).
  BEGIN
    DELETE FROM public.registros r
    WHERE r.deleted_at < now() - make_interval(days => p_dias_soft_del)
      AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.registro_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM public.documentos_fiscales df WHERE df.registro_id = r.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('registros', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('registros_error', SQLERRM);
  END;

  -- cuotas_condominio: sin pagos vinculados.
  BEGIN
    DELETE FROM public.cuotas_condominio c
    WHERE c.deleted_at < now() - make_interval(days => p_dias_soft_del)
      AND NOT EXISTS (SELECT 1 FROM public.pagos p WHERE p.cuota_id = c.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('cuotas_condominio', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('cuotas_condominio_error', SQLERRM);
  END;

  -- pagos soft-deleted (el usuario los anuló hace >90 días; el libro contable
  -- referencia por origen_tabla/origen_id SIN FK dura — el asiento persiste).
  BEGIN
    DELETE FROM public.pagos p
    WHERE p.deleted_at < now() - make_interval(days => p_dias_soft_del);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('pagos', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('pagos_error', SQLERRM);
  END;

  BEGIN
    DELETE FROM public.fondo_reserva_condominio f
    WHERE f.deleted_at < now() - make_interval(days => p_dias_soft_del);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('fondo_reserva_condominio', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('fondo_reserva_condominio_error', SQLERRM);
  END;

  BEGIN
    DELETE FROM public.tickets_mantenimiento t
    WHERE t.deleted_at < now() - make_interval(days => p_dias_soft_del);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('tickets_mantenimiento', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('tickets_mantenimiento_error', SQLERRM);
  END;

  v_resultado := v_resultado || jsonb_build_object('ejecutado_en', now());
  RETURN v_resultado;
END;
$$;

COMMENT ON FUNCTION public.purgar_datos_expirados(int, int, int, int) IS
  'Purga programada por política de retención (audit 18m, notif 6m, email terminal 3m, soft-deleted 90d con guards de FK). Cada paso aislado con EXCEPTION; devuelve jsonb con conteos/errores por tabla. Auditoría 2026-07-16, E3.';

-- Solo el cron (service context) la ejecuta — jamás un cliente.
REVOKE EXECUTE ON FUNCTION public.purgar_datos_expirados(int, int, int, int) FROM PUBLIC, anon, authenticated;

-- ── Cron mensual (día 1, 03:00 UTC — fuera de horario LATAM) ────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'purgar_datos_expirados';
EXCEPTION WHEN OTHERS THEN
  NULL; -- primera vez: no existe
END;
$$;

SELECT cron.schedule(
  'purgar_datos_expirados',
  '0 3 1 * *',
  $$SELECT public.purgar_datos_expirados()$$
);
