-- ════════════════════════════════════════════════════════════════════════════
-- Recuperación tras desplegar 20261031000000 (housekeeping: flujo por pasos,
-- reserva STR vinculada, avisos al responsable e informe al cerrar)
-- ════════════════════════════════════════════════════════════════════════════
-- NO se ejecuta sola ni en CI. Leer antes de correr. Regla general: ante un problema,
-- preferir AVANZAR con una migración nueva; estas secciones contienen un incidente sin
-- perder datos. Ninguna toca los sellos de autoría (creado_por, iniciado_*,
-- completado_*, responsable_asignado_*) ni las fotos ya subidas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A) Silenciar los avisos (campana + correo) sin tocar nada más ─────────────────
-- Si el outbox se llena de ruido o el tenant se queja de correos. El guardado del
-- servicio nunca dependió de esto (el trigger atrapa su propio error), así que
-- quitarlo no cambia la pantalla. Reversible: re-aplicar 20261031000000.
BEGIN;
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hk_recordatorios_previos';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_hk_notificar_asignacion ON public.servicios_housekeeping;
COMMIT;
-- Lo ya encolado y aún no despachado se puede retener así (no borra historial):
--   UPDATE public.notifications_outbox SET status = 'failed', last_error = 'retenido: reversión housekeeping'
--    WHERE status = 'queued' AND template_key IN ('housekeeping_asignado', 'housekeeping_recordatorio', 'housekeeping_informe');

-- ── B) Dejar de validar transiciones y reservas (conservando columnas y datos) ────
-- Vuelve al comportamiento anterior: cualquier cambio de estado se acepta y el
-- vínculo a la reserva no se valida ni se resume. Las columnas y sus valores quedan.
-- BEGIN;
-- DROP TRIGGER IF EXISTS trg_hk_estado_transicion ON public.servicios_housekeeping;
-- DROP TRIGGER IF EXISTS trg_hk_reserva            ON public.servicios_housekeeping;
-- DROP FUNCTION IF EXISTS public.hk_transicion_estado();
-- DROP FUNCTION IF EXISTS public.hk_reserva_validar();
-- COMMIT;

-- ── C) Cerrar las RPC nuevas a la API (la base sigue validando) ──────────────────
--   REVOKE EXECUTE ON FUNCTION public.hk_reservas_vinculables(uuid, uuid) FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION public.hk_notificar_informe(uuid, boolean, text) FROM authenticated;
-- Para reanudar: GRANT EXECUTE ... TO authenticated (las dos).

-- ── D) Volver la fase de fotos a dos valores y el cupo de Storage a 60 ──────────
-- Solo si NO hay fotos en la fase «inconvenientes» (si las hay, el CHECK fallaría:
-- conservarlas y no correr esta sección). El cupo vuelve a 60 recreando la policy
-- EXACTA de 20261028000000.
-- BEGIN;
-- DO $$ BEGIN
--   IF EXISTS (SELECT 1 FROM public.servicio_housekeeping_fotos WHERE fase = 'inconvenientes') THEN
--     RAISE EXCEPTION 'hay fotos en la fase inconvenientes: no se revierte el CHECK';
--   END IF;
-- END $$;
-- ALTER TABLE public.servicio_housekeeping_fotos DROP CONSTRAINT IF EXISTS servicio_housekeeping_fotos_fase_check;
-- ALTER TABLE public.servicio_housekeeping_fotos ADD CONSTRAINT servicio_housekeeping_fotos_fase_check CHECK (fase IN ('ingreso', 'cierre'));
-- DROP POLICY IF EXISTS "hk_evidencias_insert" ON storage.objects;
-- CREATE POLICY "hk_evidencias_insert" ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (
--     bucket_id = 'housekeeping-evidencias'
--     AND name ~ '^[^/]+/[^/]+/[^/]+$'
--     AND EXISTS (SELECT 1 FROM public.servicios_housekeeping s
--                  WHERE s.id::text = (storage.foldername(name))[2]
--                    AND s.project_id::text = (storage.foldername(name))[1]
--                    AND public.hk_acceso(s.company_id, s.project_id))
--     AND public.hk_objetos_del_servicio((storage.foldername(name))[2]) < 60
--   );
-- COMMIT;

-- ── E) Revertir EXACTAMENTE el esquema (pierde vínculos, inconvenientes y sellos de informe)
-- Solo si hay que volver al esquema anterior. Antes, guardar una copia:
--   CREATE TABLE public.zz_respaldo_hk_flujo AS
--     SELECT id, reserva_str_id, reserva_str_resumen, inconvenientes, informe_enviado_en, informe_enviado_por
--       FROM public.servicios_housekeeping
--      WHERE reserva_str_id IS NOT NULL OR reserva_str_resumen IS NOT NULL OR inconvenientes IS NOT NULL OR informe_enviado_en IS NOT NULL;
-- Luego, A), B) y D) y además:
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.hk_notificar_informe(uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.run_hk_recordatorios_previos();
-- DROP FUNCTION IF EXISTS public.hk_recordatorios_previos(interval, timestamptz);
-- DROP FUNCTION IF EXISTS public.hk_notificar_asignacion();
-- DROP FUNCTION IF EXISTS public.hk_encolar_aviso_responsable(public.servicios_housekeeping, text, text);
-- DROP FUNCTION IF EXISTS public.hk_reservas_vinculables(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.hk_html(text);
-- DROP FUNCTION IF EXISTS public.hk_tipo_etiqueta(text);
-- DROP TABLE IF EXISTS public.hk_recordatorios_log;
-- DELETE FROM public.notification_templates WHERE company_id IS NULL
--   AND key IN ('housekeeping_asignado', 'housekeeping_recordatorio', 'housekeeping_informe');
-- DROP INDEX IF EXISTS public.idx_hk_reserva_str;
-- DROP INDEX IF EXISTS public.idx_hk_pendientes_agenda;
-- ALTER TABLE public.servicios_housekeeping
--   DROP COLUMN IF EXISTS reserva_str_id,
--   DROP COLUMN IF EXISTS reserva_str_resumen,
--   DROP COLUMN IF EXISTS inconvenientes,
--   DROP COLUMN IF EXISTS informe_enviado_en,
--   DROP COLUMN IF EXISTS informe_enviado_por;
-- COMMENT ON COLUMN public.servicios_housekeeping.hora_inicio IS NULL;
-- COMMENT ON COLUMN public.servicios_housekeeping.hora_fin IS NULL;
-- COMMIT;

-- ── F) Comprobaciones posteriores (solo lectura) ────────────────────────────────
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.servicios_housekeeping'::regclass AND NOT tgisinternal ORDER BY 1;
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'hk_recordatorios_previos';
-- SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'hk\_%' ORDER BY 1;
-- SELECT template_key, status, count(*) FROM public.notifications_outbox
--   WHERE template_key LIKE 'housekeeping\_%' GROUP BY 1, 2 ORDER BY 1, 2;
-- SELECT count(*) FILTER (WHERE reserva_str_id IS NOT NULL) AS vinculados,
--        count(*) FILTER (WHERE reserva_str_resumen IS NOT NULL) AS con_resumen,
--        count(*) FILTER (WHERE informe_enviado_en IS NOT NULL) AS informes
--   FROM public.servicios_housekeeping;
