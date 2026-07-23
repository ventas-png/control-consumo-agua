-- ============================================================================
-- Purga automática de fotos de lectura a los 90 días (retención de fotos)
-- ============================================================================
-- Las fotos de las lecturas viven en registros.foto (text, nullable) en DOS
-- formatos:
--   · base64 heredado  → data-URI INLINE en la columna (hasta ~15 MB/fila;
--                        ~526 MB acumulados). Es el peso real de la BD.
--   · path de Storage  → ruta ${cliente_id}/${id} al bucket privado
--                        `registro-fotos` (lecturas nuevas). El archivo vive en
--                        object storage, no en la fila.
--
-- Política: la foto de TODA lectura con más de 90 días se elimina, sin importar
-- el estado de pago. Los datos de la lectura (consumo, lectura, monto, estado)
-- SIEMPRE se conservan — solo se descarta la imagen. La antigüedad se mide con
-- registros.fecha (timestamptz NOT NULL, fecha de negocio).
--
-- Dos mecánicas, por formato:
--   A) base64 → SQL puro (UPDATE ... SET foto = NULL), aquí, dentro de la purga
--      de retención mensual existente `purgar_datos_expirados`. Libera el bloat
--      de la BD sin egress ni infraestructura extra.
--   B) path de Storage → Edge Function `purgar-fotos-registros` (service-role)
--      invocada por pg_cron → pg_net vía run_purga_fotos_storage() más abajo:
--      borra el objeto del bucket y luego anula la columna.
--
-- La UI ya tolera una foto ausente (PhotoLightbox / RegistroFotoThumb muestran
-- un placeholder), así que purgar no rompe nada.
-- ============================================================================

-- ── Parte A · paso base64 dentro de purgar_datos_expirados ──────────────────
-- Cambia la firma (se agrega p_dias_fotos), por lo que hay que DROP + CREATE:
-- Postgres identifica funciones por (nombre, tipos de argumentos). El job de
-- cron llama `SELECT public.purgar_datos_expirados()` (sin args) → resuelve por
-- defaults a la nueva versión; no hace falta reprogramarlo.
DROP FUNCTION IF EXISTS public.purgar_datos_expirados(int, int, int, int);

CREATE OR REPLACE FUNCTION public.purgar_datos_expirados(
  p_meses_audit    int DEFAULT 18,
  p_meses_notif    int DEFAULT 6,
  p_meses_email    int DEFAULT 3,
  p_dias_soft_del  int DEFAULT 90,
  p_dias_fotos     int DEFAULT 90
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

COMMENT ON FUNCTION public.purgar_datos_expirados(int, int, int, int, int) IS
  'Purga programada por política de retención (audit 18m, notif 6m, email terminal 3m, soft-deleted 90d con guards de FK, fotos base64 de lecturas >90d). Cada paso aislado con EXCEPTION; devuelve jsonb con conteos/errores por tabla. Auditoría 2026-07-16 E3 + retención de fotos 2026-07-23.';

-- Solo el cron (service context) la ejecuta — jamás un cliente.
REVOKE EXECUTE ON FUNCTION public.purgar_datos_expirados(int, int, int, int, int) FROM PUBLIC, anon, authenticated;

-- El cron mensual `purgar_datos_expirados` ('0 3 1 * *') ya existe y llama la
-- función sin argumentos → toma la nueva versión por defaults. No se reprograma.

-- ── Parte B · purga de objetos de Storage vía Edge Function (pg_cron+pg_net) ─
-- Borrar un objeto del bucket requiere la Storage API con service-role (SQL solo
-- no reap-ea el archivo en S3), así que se delega a la Edge Function
-- `purgar-fotos-registros`. Mismo patrón que run_route_reminders: dos secretos
-- en Vault; si faltan, es un no-op seguro (esta migración se puede aplicar antes
-- de configurarlos).
--   - purga_fotos_url          = https://<ref>.supabase.co/functions/v1/purgar-fotos-registros
--   - purga_fotos_service_key  = SERVICE_ROLE_KEY del proyecto
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.run_purga_fotos_storage()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'purga_fotos_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'purga_fotos_service_key';

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('mode', 'batch')
    );
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.run_purga_fotos_storage() FROM PUBLIC, anon, authenticated;

-- Cron mensual, desfasado 30 min del de retención para no chocar (día 1, 03:30 UTC).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'purgar_fotos_storage_monthly';
EXCEPTION WHEN OTHERS THEN
  NULL; -- primera vez: no existe
END;
$$;

SELECT cron.schedule(
  'purgar_fotos_storage_monthly',
  '30 3 1 * *',
  $$SELECT public.run_purga_fotos_storage();$$
);
