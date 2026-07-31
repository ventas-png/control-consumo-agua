-- ============================================================================
-- Retención de `bitacora_acciones` (24 meses)
-- ============================================================================
-- La migración 20260731000100 puso triggers que escriben en bitacora_acciones
-- en ~39 tablas de hechos. Sin política de retención esa tabla crece sin límite
-- (hallazgo D8 de AUDITORIA_LOGICA_SAAS_2026-07-16) y además retendría datos
-- personales —el nombre del usuario— indefinidamente. Por eso la retención va
-- en la misma entrega que el trigger, no después.
--
-- POR QUÉ SE REESCRIBE LA FUNCIÓN ENTERA. Postgres identifica las funciones por
-- (nombre, tipos de argumentos) y CREATE OR REPLACE no permite RENOMBRAR un
-- parámetro existente: agregar `p_meses_bitacora` como 5º daría
-- «cannot change name of input parameter "p_dias_fotos"» (42P13), que es
-- exactamente lo que falló en el preview de este PR. El 6º parámetro se agrega
-- AL FINAL y `p_dias_fotos` conserva su nombre y su posición.
--
-- El cuerpo se reproduce COMPLETO desde 20260723000000 —incluido el paso de
-- fotos base64— porque un CREATE OR REPLACE parcial borraría los pasos que no
-- se repitan. El resto queda idéntico: solo se suma el bloque de bitácora.
-- ============================================================================

-- La firma vigente es la de 5 args (20260723000000). Se DROPea para poder
-- cambiarla: dos funciones homónimas con todos los parámetros por defecto
-- harían ambigua la llamada sin argumentos que hace el cron.
DROP FUNCTION IF EXISTS public.purgar_datos_expirados(int, int, int, int, int);

CREATE OR REPLACE FUNCTION public.purgar_datos_expirados(
  p_meses_audit    int DEFAULT 18,
  p_meses_notif    int DEFAULT 6,
  p_meses_email    int DEFAULT 3,
  p_dias_soft_del  int DEFAULT 90,
  p_dias_fotos     int DEFAULT 90,
  p_meses_bitacora int DEFAULT 24
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

  -- ── bitacora_acciones > p_meses_bitacora ───────────────────────────────
  -- La alimenta trg_bitacora (20260731000100) desde ~39 tablas de hechos. Sin
  -- esto crecería sin límite y retendría el nombre del usuario para siempre:
  -- es el hallazgo D8 de AUDITORIA_LOGICA_SAAS_2026-07-16. 24 meses (más que
  -- audit_log) porque es la vista que consulta el administrador para revisar el
  -- ejercicio anterior completo, y pesa mucho menos por fila.
  BEGIN
    DELETE FROM public.bitacora_acciones
    WHERE created_at < now() - make_interval(months => p_meses_bitacora);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('bitacora_acciones', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('bitacora_acciones_error', SQLERRM);
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

  -- ── fotos base64 de lecturas > p_dias_fotos: liberar el bloat inline ──────
  -- Solo el formato base64 (data-URI en la columna). Se pasa a NULL: se conserva
  -- TODO el dato de la lectura, solo se descarta la imagen. Los objetos de
  -- Storage (formato path) los limpia la Edge Function purgar-fotos-registros.
  -- No se filtra por estado (política: todas) ni por deleted_at (también las
  -- soft-deleted que sobreviven por guards de FK).
  BEGIN
    UPDATE public.registros
    SET foto = NULL
    WHERE foto LIKE 'data:%'
      AND fecha < now() - make_interval(days => p_dias_fotos);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resultado := v_resultado || jsonb_build_object('fotos_base64', v_n);
  EXCEPTION WHEN OTHERS THEN
    v_resultado := v_resultado || jsonb_build_object('fotos_base64_error', SQLERRM);
  END;

  v_resultado := v_resultado || jsonb_build_object('ejecutado_en', now());
  RETURN v_resultado;
END;
$$;

COMMENT ON FUNCTION public.purgar_datos_expirados(int, int, int, int, int, int) IS
  'Purga programada por política de retención (audit 18m, bitácora 24m, notif 6m, email terminal 3m, soft-deleted 90d con guards de FK, fotos base64 de lecturas >90d). Cada paso aislado con EXCEPTION; devuelve jsonb con conteos/errores por tabla. Auditoría 2026-07-16 E3 + fotos 2026-07-23 + trazabilidad 2026-07-31.';

-- Solo el cron (service context) la ejecuta — jamás un cliente.
REVOKE EXECUTE ON FUNCTION public.purgar_datos_expirados(int, int, int, int, int, int)
  FROM PUBLIC, anon, authenticated;

-- El cron mensual `purgar_datos_expirados` ('0 3 1 * *') llama la función SIN
-- argumentos, así que resuelve por defaults a esta versión. No se reprograma:
-- tocar el schedule aquí duplicaría el job si el unschedule fallara.
