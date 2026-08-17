-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260824000000.
--   1-8   RESERVAS: a quién avisa, con qué título y con qué cuerpo.
--   9-18  ENTREGA in_app: qué se despacha, qué se deja al edge y qué pasa
--         cuando una fila está torcida.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ─────────────────────────────────────────────────────────────────────────────
-- RESERVAS
-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · reserva que espera aprobación, hecha por el residente (created_by NULL).
INSERT INTO public.reservas_amenidades
  (id, company_id, project_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin, estado)
VALUES ('facade00-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', DATE '2026-09-14', TIME '14:00', TIME '18:00',
        'pendiente');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000001'), 3,
  '1 reserva en P1 → owner + admin + operador de P1 (3)');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000001'
      AND recipient IN ('50000000-0000-0000-0000-0000000000a4',   -- operador de P2
                        '50000000-0000-0000-0000-0000000000a5',   -- operador dado de baja
                        '50000000-0000-0000-0000-0000000000b1')), 0,
  '2 no recibe el operador de otro proyecto, ni el inactivo, ni el residente');

SELECT public.chk_txt(
  (SELECT DISTINCT payload->>'titulo' FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000001'),
  'Reserva pendiente de aprobación',
  '3 la que espera decisión del equipo lo dice en el título');

SELECT public.chk_txt(
  (SELECT DISTINCT payload->>'cuerpo' FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000001'),
  'Salón de eventos · Unidad Casa 1 · 14/09/2026 14:00–18:00',
  '4 el cuerpo trae amenidad, unidad y horario (sin abrir la reserva se sabe qué es)');

SELECT public.chk_txt(
  (SELECT DISTINCT payload->>'tipo' || '/' || (payload->>'seccion')
     FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000001'),
  'reserva/condominios',
  '5 tipo y sección son los que la campana sabe agrupar y navegar');

-- 6 · reserva ya confirmada (la amenidad no pide aprobación) creada por el admin.
INSERT INTO public.reservas_amenidades
  (id, company_id, project_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin, estado, created_by)
VALUES ('facade00-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', DATE '2026-09-15', TIME '09:00', TIME '11:00',
        'confirmada', '50000000-0000-0000-0000-0000000000a2');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000002'), 2,
  '6 el admin que la creó no se avisa a sí mismo (quedan 2)');

SELECT public.chk_txt(
  (SELECT DISTINCT payload->>'titulo' FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000002'),
  'Reserva nueva',
  '7 la confirmada se anuncia como novedad, no como pendiente');

-- 8 · una cancelada no es trabajo entrante.
INSERT INTO public.reservas_amenidades
  (id, company_id, project_id, amenidad_id, unidad_id, fecha, hora_inicio, hora_fin, estado)
VALUES ('facade00-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', DATE '2026-09-16', TIME '09:00', TIME '11:00',
        'cancelada');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000003'), 0,
  '8 una reserva cancelada no avisa a nadie');

-- ─────────────────────────────────────────────────────────────────────────────
-- ENTREGA in_app
-- ─────────────────────────────────────────────────────────────────────────────
-- Todo lo encolado hasta aquí lleva `scheduled_at = now()`: es lo que el edge
-- debería llevarse en su pasada. La red de seguridad no debe tocarlo.
SELECT public.chk(
  public.despachar_in_app_pendientes()::bigint, 0,
  '9 lo recién encolado se le deja al dispatcher (respeta el retraso)');

SELECT public.chk(
  (SELECT count(*) FROM public.user_notifications), 0,
  '10 y por tanto la campana sigue vacía');

-- Se envejecen las filas: esto es exactamente lo que pasa cuando el dispatcher
-- NO corre (secretos del Vault sin poner) — se quedan represadas.
UPDATE public.notifications_outbox
SET scheduled_at = now() - interval '10 minutes'
WHERE status = 'queued';

-- Ruido que NO le toca despachar: un email rezagado y un in_app sin título.
INSERT INTO public.notifications_outbox (company_id, channel, payload, recipient, status, scheduled_at)
VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'email',
   jsonb_build_object('titulo', 'Correo viejo', 'user_id', '50000000-0000-0000-0000-0000000000a1'),
   'owner@example.com', 'queued', now() - interval '10 minutes'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'in_app',
   jsonb_build_object('template_key_only', true),
   '50000000-0000-0000-0000-0000000000a1', 'queued', now() - interval '10 minutes'),
  -- Destinatario que ya no existe: el INSERT en la campana violará el FK.
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'in_app',
   jsonb_build_object('titulo', 'Para un fantasma', 'tipo', 'mensaje'),
   '50000000-0000-0000-0000-00000000dead', 'queued', now() - interval '10 minutes');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE status = 'queued' AND channel = 'in_app'
      AND coalesce(payload->>'titulo','') <> '')::bigint,
  6,
  '11 hay 6 in_app represadas (3+2 de reservas y 1 del fantasma)');

SELECT public.chk(
  public.despachar_in_app_pendientes()::bigint, 5,
  '12 la red de seguridad entrega las 5 buenas en una pasada');

SELECT public.chk(
  (SELECT count(*) FROM public.user_notifications), 5,
  '13 y aparecen en la campana');

SELECT public.chk_txt(
  (SELECT n.tipo || '/' || n.titulo || '/' || coalesce(n.seccion, '—')
     FROM public.user_notifications n
     JOIN public.notifications_outbox o ON o.provider_message_id = n.id::text
    WHERE o.payload->>'reserva_id' = 'facade00-0000-0000-0000-000000000001'
    LIMIT 1),
  'reserva/Reserva pendiente de aprobación/condominios',
  '14 la fila de la campana conserva tipo, título y destino del payload');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'in_app' AND status = 'sent'
      AND provider_message_id IS NOT NULL AND sent_at IS NOT NULL), 5,
  '15 el outbox queda sellado sent + provider_message_id (el "leído" se podrá correlacionar)');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'email' AND status = 'queued'), 1,
  '16 el email rezagado sigue esperando al edge (Gmail no se despacha desde SQL)');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'in_app' AND status = 'queued'
      AND coalesce(payload->>'titulo','') = ''), 1,
  '17 la in_app sin título se le deja al edge (es suya: sabe resolver la plantilla)');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE status = 'sending'), 0,
  '18 ninguna fila se queda clavada en sending');

SELECT public.chk_txt(
  (SELECT status || '/' || attempts::text FROM public.notifications_outbox
    WHERE payload->>'titulo' = 'Para un fantasma'),
  'queued/1',
  '19 la del destinatario inexistente vuelve a la cola con el intento contado');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'titulo' = 'Para un fantasma' AND last_error IS NOT NULL), 1,
  '20 y con el error a la vista para poder diagnosticarla');

-- 21 · segunda pasada: lo ya entregado no se duplica.
SELECT public.chk(
  public.despachar_in_app_pendientes()::bigint, 0,
  '21 volver a correr no entrega nada de nuevo');

SELECT public.chk(
  (SELECT count(*) FROM public.user_notifications), 5,
  '22 la campana no duplica avisos');
