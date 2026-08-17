-- ════════════════════════════════════════════════════════════════════════════
-- El correo del anuncio que no tenía plantilla, y un vigilante para el outbox
--
-- Las dos mitades salen del mismo incidente (2026-08-17): el dispatcher llevaba
-- 2½ meses sin correr y nadie se enteró. Al destaparlo aparecieron 277 correos
-- represados, y de los que se intentaron enviar, cuatro fallaron con
-- `email sin body ni plantilla resoluble`.
--
-- ── 1. LA PLANTILLA ─────────────────────────────────────────────────────────
-- `anuncios_comunidad` (20260801000500) encola su correo con
-- template_key = 'anuncio_condominio', pero esa plantilla NUNCA se sembró. La
-- cascada de resolveEmailContent es: notification_templates → email_templates →
-- payload.html_body|body. El payload del anuncio trae `message`/`cuerpo`, que no
-- son ninguna de esas dos claves, así que la cascada termina sin cuerpo y el
-- dispatcher marca la fila como fallo terminal.
--
-- Es decir: desde que existe el aviso por correo de los anuncios del tablón,
-- NINGUNO ha podido salir. No era el dispatcher — con él arreglado seguirían
-- fallando igual.
--
-- Se siembra sólo el canal `email`, que es el que falta. El `in_app` funciona ya
-- sin plantilla (dispatchInApp cae a payload.titulo/cuerpo, que sí vienen), y
-- además la red de seguridad SQL (20260824000000) no resuelve plantillas: darle
-- una al in_app haría que el texto cambiara según quién despache. Mejor uno solo
-- y consistente.
--
-- ── 2. EL VIGILANTE ─────────────────────────────────────────────────────────
-- La causa raíz del incidente no fue el cron caído: fue que pudo estarlo
-- durante meses SIN QUE NADIE LO NOTARA. `run_notifications_dispatcher()` hace
-- `RETURN` en silencio si le faltan sus claves del Vault, y el outbox se llena
-- sin un solo error a la vista.
--
-- `chequear_salud_notificaciones()` corre cada hora y avisa a los admins cuando
-- el outbox se atasca. Dos señales distintas, a propósito:
--   · `queued` + attempts = 0 + vieja  → nadie la tocó JAMÁS: el despachador no
--     está corriendo. Es exactamente la firma del incidente.
--   · `sending` sin moverse            → alguien la reclamó y murió a medias.
-- Una fila con attempts > 0 NO alarma: está en reintento con backoff, que es el
-- comportamiento correcto, y acaba en `failed` si se agota.
--
-- EL AVISO NO PASA POR EL OUTBOX. Escribe directo en `user_notifications`, como
-- route-reminders y paquetería. Anunciar por el outbox que el outbox está
-- atascado es una trampa circular: el aviso se quedaría en la misma cola que
-- intenta denunciar. (La red de seguridad SQL lo entregaría igual, pero
-- depender de eso para el aviso del fallo es exactamente el error que este
-- vigilante existe para no repetir.)
--
-- CÓMO REVERTIR
--   SELECT cron.unschedule('salud_notificaciones');
--   DROP FUNCTION public.run_chequear_salud_notificaciones();
--   DROP FUNCTION public.chequear_salud_notificaciones(interval, interval, interval);
--   DELETE FROM public.notification_templates
--    WHERE company_id IS NULL AND key = 'anuncio_condominio' AND channel = 'email';
--
-- Idempotente: ON CONFLICT DO NOTHING, CREATE OR REPLACE, unschedule defensivo.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Plantilla global del correo de anuncios
-- ─────────────────────────────────────────────────────────────────────────────
-- Variables disponibles en el payload (20260801000500): to_name, titulo, cuerpo,
-- subject, message, empresa_nombre, anuncio_id, cliente_id, user_id.
-- El body va en texto plano: resolveEmailContent lo envuelve en `emailLayout`
-- (la tarjeta con la cabecera de la empresa) al ver que no es HTML completo.
-- company_id NULL = global; cada empresa puede sobrescribirla desde su catálogo.
INSERT INTO public.notification_templates (company_id, key, channel, subject, body, locale, is_active)
VALUES
  (NULL, 'anuncio_condominio', 'email', '{{titulo}}',
   'Hola {{to_name}},

Hay un anuncio nuevo en el tablón de su condominio:

{{titulo}}

{{cuerpo}}

Puede consultarlo también desde su portal de residente.

— {{empresa_nombre}}',
   'es', true)
ON CONFLICT (company_id, key, channel, locale) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Vigilante del outbox
-- ─────────────────────────────────────────────────────────────────────────────
-- Devuelve cuántos avisos emitió (0 = todo sano). Los tests lo usan como
-- aserción; el cron lo ignora.
CREATE OR REPLACE FUNCTION public.chequear_salud_notificaciones(
  p_umbral_queued  interval DEFAULT interval '1 hour',
  p_umbral_sending interval DEFAULT interval '30 minutes',
  -- Ventana de silencio por destinatario: un atasco dura hasta que alguien lo
  -- arregla, y repetir la campanada cada hora sólo enseña a ignorarla.
  p_silencio       interval DEFAULT interval '12 hours'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grupo   record;
  v_destino record;
  v_cuerpo  text;
  v_n       integer := 0;
BEGIN
  FOR v_grupo IN
    SELECT
      o.company_id,
      count(*) FILTER (WHERE o.status = 'queued')  AS atascadas,
      count(*) FILTER (WHERE o.status = 'sending') AS clavadas,
      min(o.scheduled_at)                          AS mas_vieja
    FROM public.notifications_outbox o
    WHERE (o.status = 'queued'  AND o.attempts = 0 AND o.scheduled_at <= now() - p_umbral_queued)
       OR (o.status = 'sending' AND o.updated_at  <= now() - p_umbral_sending)
    GROUP BY o.company_id
  LOOP
    v_cuerpo :=
      CASE WHEN v_grupo.atascadas > 0
        THEN v_grupo.atascadas || ' notificacion(es) llevan en cola sin que nadie las despache'
        ELSE '' END
      || CASE WHEN v_grupo.atascadas > 0 AND v_grupo.clavadas > 0 THEN '; ' ELSE '' END
      || CASE WHEN v_grupo.clavadas > 0
        THEN v_grupo.clavadas || ' quedaron a medio enviar'
        ELSE '' END
      || '. La más antigua espera desde el '
      || to_char(v_grupo.mas_vieja, 'DD/MM/YYYY HH24:MI')
      || '. Revisar que el cron notifications_dispatcher esté activo y que sus claves del Vault estén puestas.';

    FOR v_destino IN
      SELECT au.id
      FROM public.app_users au
      WHERE coalesce(au.activo, true)
        -- `cliente_id IS NULL` separa staff de cuentas de residente (20260801000400).
        AND au.cliente_id IS NULL
        AND (
          -- Atasco de una empresa → sus responsables.
          (v_grupo.company_id IS NOT NULL
             AND au.company_id = v_grupo.company_id
             AND au.role IN ('company_owner', 'admin'))
          -- Atasco sin empresa (plataforma) → super admins.
          OR (v_grupo.company_id IS NULL AND au.role = 'super_admin')
        )
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.user_notifications n
        WHERE n.user_id = v_destino.id
          AND n.tipo = 'alerta_notificaciones'
          AND n.created_at > now() - p_silencio
      ) THEN
        CONTINUE;
      END IF;

      -- `seccion` NULL a propósito: no hay pantalla de salud del outbox a la que
      -- llevar al usuario, y la campana sólo navega cuando hay destino.
      INSERT INTO public.user_notifications (user_id, company_id, tipo, titulo, cuerpo, seccion)
      VALUES (
        v_destino.id, v_grupo.company_id, 'alerta_notificaciones',
        'Notificaciones sin despachar', v_cuerpo, NULL
      );
      v_n := v_n + 1;
    END LOOP;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.chequear_salud_notificaciones(interval, interval, interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chequear_salud_notificaciones(interval, interval, interval) TO service_role;

COMMENT ON FUNCTION public.chequear_salud_notificaciones(interval, interval, interval) IS
  'Avisa a los admins (in_app directo, sin pasar por el outbox) cuando notifications_outbox acumula filas nunca despachadas o clavadas en sending. Silencio de 12h por destinatario. Devuelve cuántos avisos emitió.';

CREATE OR REPLACE FUNCTION public.run_chequear_salud_notificaciones()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.chequear_salud_notificaciones(); $$;

REVOKE ALL ON FUNCTION public.run_chequear_salud_notificaciones() FROM public, anon, authenticated;

-- Cada hora. Reschedule idempotente, igual que los demás crons del proyecto.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'salud_notificaciones';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'salud_notificaciones',
    '0 * * * *',
    $cron$SELECT public.run_chequear_salud_notificaciones();$cron$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron no disponible: salud_notificaciones sin programar (%)', SQLERRM;
END $$;
