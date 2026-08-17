-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260824010000.
--   1-4    la plantilla del correo de anuncios.
--   5-15   el vigilante del outbox: qué alarma, qué no, y a quién avisa.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ─────────────────────────────────────────────────────────────────────────────
-- LA PLANTILLA
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.notification_templates
    WHERE company_id IS NULL AND key = 'anuncio_condominio'
      AND channel = 'email' AND locale = 'es' AND is_active), 1,
  '1 existe la plantilla global de email que faltaba');

SELECT public.chk(
  (SELECT count(*) FROM public.notification_templates
    WHERE key = 'anuncio_condominio' AND channel = 'in_app'), 0,
  '2 el in_app NO se siembra (ya funciona con el payload, y la red SQL no resuelve plantillas)');

-- El fallo real era que la cascada terminaba sin cuerpo; lo que la salva es que
-- el body renderice las variables que el productor sí manda.
SELECT public.chk_bool(
  (SELECT body LIKE '%{{titulo}}%' AND body LIKE '%{{cuerpo}}%'
       AND body LIKE '%{{to_name}}%' AND body LIKE '%{{empresa_nombre}}%'
     FROM public.notification_templates
    WHERE company_id IS NULL AND key = 'anuncio_condominio' AND channel = 'email'),
  '3 el cuerpo usa las variables que el productor de anuncios sí pone en el payload');

SELECT public.chk_txt(
  (SELECT subject FROM public.notification_templates
    WHERE company_id IS NULL AND key = 'anuncio_condominio' AND channel = 'email'),
  '{{titulo}}',
  '4 el asunto es el título del anuncio');

-- ─────────────────────────────────────────────────────────────────────────────
-- EL VIGILANTE
-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · outbox sano → nadie molesta a nadie.
SELECT public.chk(
  public.chequear_salud_notificaciones()::bigint, 0,
  '5 con el outbox vacío no avisa a nadie');

-- Filas RECIENTES (lo normal: encoladas hace un momento) y una en reintento.
INSERT INTO public.notifications_outbox (company_id, channel, payload, status, attempts, scheduled_at, updated_at)
VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'email', '{}', 'queued', 0, now(), now()),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'email', '{}', 'queued', 0, now() - interval '5 minutes', now()),
  -- attempts > 0 = el despachador SÍ la tocó y está reintentando con backoff.
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'email', '{}', 'queued', 3, now() - interval '3 days', now()),
  -- sending recién reclamada: en curso, no clavada.
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'email', '{}', 'sending', 1, now() - interval '2 days', now());

SELECT public.chk(
  public.chequear_salud_notificaciones()::bigint, 0,
  '6 lo reciente, lo que está en reintento y lo recién reclamado NO son atascos');

-- 7 · la firma del incidente: encoladas hace días y jamás tocadas (attempts=0).
INSERT INTO public.notifications_outbox (company_id, channel, payload, status, attempts, scheduled_at, updated_at)
SELECT 'aaaaaaaa-0000-0000-0000-00000000000a', 'email', '{}', 'queued', 0,
       now() - interval '3 days', now() - interval '3 days'
FROM generate_series(1, 5);

SELECT public.chk(
  public.chequear_salud_notificaciones()::bigint, 2,
  '7 el atasco avisa al owner y al admin de esa empresa (2)');

SELECT public.chk(
  (SELECT count(*) FROM public.user_notifications n
    WHERE n.tipo = 'alerta_notificaciones'
      AND n.user_id IN ('50000000-0000-0000-0000-0000000000a3',   -- operador
                        '50000000-0000-0000-0000-0000000000a4',   -- admin inactivo
                        '50000000-0000-0000-0000-0000000000a5',   -- residente
                        '50000000-0000-0000-0000-0000000000b1',   -- owner de OTRA empresa
                        '50000000-0000-0000-0000-0000000000f1')), 0,
  '8 no se avisa al operador, ni al inactivo, ni al residente, ni a la empresa ajena, ni al super admin');

SELECT public.chk_bool(
  (SELECT cuerpo LIKE '5 notificacion(es)%' AND cuerpo LIKE '%notifications_dispatcher%'
     FROM public.user_notifications
    WHERE tipo = 'alerta_notificaciones' LIMIT 1),
  '9 el cuerpo dice cuántas son y dónde mirar');

SELECT public.chk_bool(
  (SELECT seccion IS NULL FROM public.user_notifications
    WHERE tipo = 'alerta_notificaciones' LIMIT 1),
  '10 sin sección: no hay pantalla a la que navegar, y la campana no debe llevar a la nada');

-- 11 · el aviso NO se encola: si el outbox está atascado, anunciarlo por el
--      outbox sería dejar el aviso en la misma cola que denuncia.
SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'tipo' = 'alerta_notificaciones'), 0,
  '11 el aviso va directo a la campana, nunca por el outbox');

-- 12 · el atasco sigue ahí, pero no se repite la campanada.
SELECT public.chk(
  public.chequear_salud_notificaciones()::bigint, 0,
  '12 la hora siguiente no vuelve a avisar (ventana de silencio)');

-- 13 · pasado el silencio, si el problema persiste, insiste.
UPDATE public.user_notifications
SET created_at = now() - interval '13 hours'
WHERE tipo = 'alerta_notificaciones';

SELECT public.chk(
  public.chequear_salud_notificaciones()::bigint, 2,
  '13 pasada la ventana de silencio vuelve a avisar');

-- 14 · filas clavadas en sending (alguien las reclamó y murió a medias).
DELETE FROM public.user_notifications;
DELETE FROM public.notifications_outbox;

INSERT INTO public.notifications_outbox (company_id, channel, payload, status, attempts, scheduled_at, updated_at)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', 'in_app', '{}', 'sending', 1,
        now() - interval '2 hours', now() - interval '2 hours');

SELECT public.chk(
  public.chequear_salud_notificaciones()::bigint, 2,
  '14 una fila clavada en sending también alarma');

-- 15 · atasco de plataforma (sin empresa) → super admin.
DELETE FROM public.user_notifications;
DELETE FROM public.notifications_outbox;

INSERT INTO public.notifications_outbox (company_id, channel, payload, status, attempts, scheduled_at, updated_at)
VALUES (NULL, 'email', '{}', 'queued', 0, now() - interval '2 days', now() - interval '2 days');

SELECT public.chequear_salud_notificaciones();

SELECT public.chk(
  (SELECT count(*) FROM public.user_notifications
    WHERE user_id = '50000000-0000-0000-0000-0000000000f1'
      AND tipo = 'alerta_notificaciones'), 1,
  '15 un atasco sin empresa se le avisa al super admin');

SELECT public.chk(
  (SELECT count(*) FROM public.user_notifications
    WHERE tipo = 'alerta_notificaciones'
      AND user_id <> '50000000-0000-0000-0000-0000000000f1'), 0,
  '16 y a nadie más: no es problema de ninguna empresa en particular');
