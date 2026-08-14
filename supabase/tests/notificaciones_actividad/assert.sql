-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260819000000: qué se encola y a quién, por cada evento.
--   1-6   mensajes de conversación (cliente→staff, staff→cliente, nota interna,
--         hilo asignado, discusión interna, anti-ráfaga)
--   7-9   difusión
--   10-15 solicitudes (las cinco tablas + alcance por proyecto + textos)
--   16-18 mensajes del portal del residente
--   19-21 forma del payload (lo que el dispatcher necesita para funcionar)
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ─────────────────────────────────────────────────────────────────────────────
-- MENSAJES
-- ─────────────────────────────────────────────────────────────────────────────
-- Hilo del cliente C1 en el proyecto P1, sin agente asignado.
INSERT INTO public.conversations (id, company_id, project_id, cliente_id, cliente_nombre, subject)
VALUES ('c0ffee00-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'Cliente Uno', 'Fuga en el medidor');

-- 1 · escribe el cliente y no hay asignado → staff del proyecto P1.
INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body)
VALUES ('11110000-0000-0000-0000-000000000001', 'c0ffee00-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000b1', 'cliente', 'Cliente Uno', 'Sigue goteando');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000001'), 3,
  '1 mensaje del cliente sin asignar → owner + admin + operador de P1 (3)');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000001'
      AND recipient IN ('50000000-0000-0000-0000-0000000000a4',   -- operador de P2
                        '50000000-0000-0000-0000-0000000000a5',   -- operador dado de baja
                        '50000000-0000-0000-0000-0000000000b1')), 0,
  '2 no recibe el operador de otro proyecto, ni el inactivo, ni el propio autor');

-- 3 · responde un agente → la cuenta del cliente, no el staff.
INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body)
VALUES ('11110000-0000-0000-0000-000000000002', 'c0ffee00-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a2', 'agent', 'Admin', 'Vamos para allá');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000002'
      AND recipient = '50000000-0000-0000-0000-0000000000b1'), 1,
  '3 la respuesta del agente avisa a la cuenta del cliente del hilo');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000002'), 1,
  '4 y sólo a ella: el staff no se avisa de su propia respuesta');

-- 5 · nota interna: nunca sale al cliente.
INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body, is_internal_note)
VALUES ('11110000-0000-0000-0000-000000000003', 'c0ffee00-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000a1', 'agent', 'Owner', 'Ojo con la lectura', true);

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000003'
      AND recipient = '50000000-0000-0000-0000-0000000000b1'), 0,
  '5 la nota interna NO llega al cliente');

-- 6 · anti-ráfaga: segundo mensaje del cliente en el mismo hilo, dentro de la
--     ventana de 10 minutos → no vuelve a encolar.
INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body)
VALUES ('11110000-0000-0000-0000-000000000004', 'c0ffee00-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000b1', 'cliente', 'Cliente Uno', 'Y ahora peor');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000004'), 0,
  '6 una ráfaga en el mismo hilo no repite la campanada (ventana de 10 min)');

-- 6b · pasada la ventana, vuelve a avisar.
UPDATE public.notifications_outbox
   SET created_at = now() - interval '30 minutes'
 WHERE payload ? 'conversation_id';

INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body)
VALUES ('11110000-0000-0000-0000-000000000005', 'c0ffee00-0000-0000-0000-000000000001',
        '50000000-0000-0000-0000-0000000000b1', 'cliente', 'Cliente Uno', 'Hola de nuevo');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000005'), 3,
  '6b fuera de la ventana el aviso vuelve a salir');

-- 7 · hilo con agente asignado: sólo él, no toda la empresa.
INSERT INTO public.conversations (id, company_id, project_id, cliente_id, cliente_nombre, subject, assigned_to)
VALUES ('c0ffee00-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
        'Cliente Uno', 'Cobro duplicado', '50000000-0000-0000-0000-0000000000a3');

INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body)
VALUES ('11110000-0000-0000-0000-000000000006', 'c0ffee00-0000-0000-0000-000000000002',
        '50000000-0000-0000-0000-0000000000b1', 'cliente', 'Cliente Uno', 'Me cobraron dos veces');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000006'), 1,
  '7 con agente asignado el aviso va sólo a él');

SELECT public.chk_txt(
  (SELECT recipient FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000006'),
  '50000000-0000-0000-0000-0000000000a3',
  '8 y es exactamente el asignado');

-- 9 · discusión interna de equipo: al resto del staff del proyecto.
INSERT INTO public.conversations (id, company_id, project_id, cliente_id, subject, is_internal)
VALUES ('c0ffee00-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000002', NULL, 'Turnos de la semana', true);

INSERT INTO public.conversation_messages (id, conversation_id, sender_id, sender_type, sender_name, body)
VALUES ('11110000-0000-0000-0000-000000000007', 'c0ffee00-0000-0000-0000-000000000003',
        '50000000-0000-0000-0000-0000000000a4', 'agent', 'Op P2', '¿Quién cubre el sábado?');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000007'), 2,
  '9 la discusión interna de P2 avisa a owner + admin (el autor queda fuera)');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'message_id' = '11110000-0000-0000-0000-000000000007'
      AND recipient = '50000000-0000-0000-0000-0000000000a3'), 0,
  '10 el operador de P1 no se entera de la discusión de P2');

-- ─────────────────────────────────────────────────────────────────────────────
-- DIFUSIÓN
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.broadcasts (id, company_id, title, body, sent_by_id, sent_by_name, recipient_count)
VALUES ('b0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        'Corte de agua', 'El jueves de 8 a 12.', '50000000-0000-0000-0000-0000000000a2', 'Admin', 2);

-- Lote de destinatarios, como los inserta create-broadcast.
INSERT INTO public.broadcast_recipients (broadcast_id, cliente_id, company_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  ('b0000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'broadcast_id' = 'b0000000-0000-0000-0000-000000000001'), 2,
  '11 la difusión encola in_app para las cuentas de los DOS destinatarios');

-- El bug que arregla: create-broadcast sólo encolaba email, así que el cliente
-- sin correo (C2) no se enteraba de nada.
SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'broadcast_id' = 'b0000000-0000-0000-0000-000000000001'
      AND recipient = '50000000-0000-0000-0000-0000000000b2'), 1,
  '12 el destinatario SIN email también recibe el aviso in-app');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'broadcast_id' = 'b0000000-0000-0000-0000-000000000001'
      AND channel <> 'in_app'), 0,
  '13 la difusión no duplica el email que ya manda create-broadcast');

SELECT public.chk_txt(
  (SELECT payload->>'titulo' FROM public.notifications_outbox
    WHERE payload->>'broadcast_id' = 'b0000000-0000-0000-0000-000000000001' LIMIT 1),
  'Comunicado: Corte de agua',
  '14 el título del aviso identifica el comunicado');

-- ─────────────────────────────────────────────────────────────────────────────
-- SOLICITUDES
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.solicitudes_residente (id, company_id, project_id, unidad_id, tipo, descripcion)
VALUES ('50110000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        'permiso_obra', 'Cambio de ventanas');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'solicitud_id' = '50110000-0000-0000-0000-000000000001'), 3,
  '15 la solicitud de P1 avisa a owner + admin + operador de P1');

SELECT public.chk_txt(
  (SELECT payload->>'cuerpo' FROM public.notifications_outbox
    WHERE payload->>'solicitud_id' = '50110000-0000-0000-0000-000000000001' LIMIT 1),
  'Unidad Casa 1 — Cambio de ventanas',
  '16 el cuerpo nombra la unidad y el detalle');

-- Las otras cuatro tablas: mismo trigger genérico, columnas distintas. La de
-- renta no tiene `descripcion` (cae a `motivo`) y la de certificado tampoco
-- (cae a `motivo`/`observaciones`): que ninguna reviente es el punto.
INSERT INTO public.solicitudes_concierge (id, company_id, project_id, unidad_id, tipo, descripcion)
VALUES ('50220000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'taxi', 'Taxi al aeropuerto');

INSERT INTO public.solicitudes_certificado (id, company_id, project_id, unidad_id, tipo, solicitante, motivo)
VALUES ('50330000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        'solvencia', 'Cliente Uno', 'Trámite bancario');

INSERT INTO public.solicitud_mudanza_unidad (id, company_id, project_id, unidad_id, tipo_mudanza, descripcion)
VALUES ('50440000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'entrada', 'Camión el sábado');

INSERT INTO public.solicitud_renta_unidad (id, company_id, project_id, unidad_id, tipo_renta, motivo)
VALUES ('50550000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'corta', 'Airbnb temporada alta');

SELECT public.chk(
  (SELECT count(DISTINCT payload->>'origen') FROM public.notifications_outbox
    WHERE payload->>'tipo' = 'solicitud'), 5,
  '17 las CINCO tablas de solicitud avisan (concierge, certificado, mudanza, renta, residente)');

SELECT public.chk_txt(
  (SELECT payload->>'cuerpo' FROM public.notifications_outbox
    WHERE payload->>'solicitud_id' = '50550000-0000-0000-0000-000000000001' LIMIT 1),
  'Unidad Casa 1 — Airbnb temporada alta',
  '18 sin columna `descripcion` el detalle cae a `motivo`');

SELECT public.chk_txt(
  (SELECT payload->>'titulo' FROM public.notifications_outbox
    WHERE payload->>'solicitud_id' = '50440000-0000-0000-0000-000000000001' LIMIT 1),
  'Solicitud nueva: mudanza',
  '19 el título dice de qué solicitud se trata');

-- ─────────────────────────────────────────────────────────────────────────────
-- MENSAJES DEL PORTAL
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.mensajes_portal (id, company_id, project_id, unidad_id, asunto, cuerpo, tipo)
VALUES ('60000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
        'Se rompió una tubería', 'Está inundando el pasillo', 'emergencia');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'mensaje_portal_id' = '60000000-0000-0000-0000-000000000001'), 3,
  '20 el mensaje del portal avisa al staff del proyecto');

SELECT public.chk_txt(
  (SELECT payload->>'titulo' FROM public.notifications_outbox
    WHERE payload->>'mensaje_portal_id' = '60000000-0000-0000-0000-000000000001' LIMIT 1),
  'Emergencia reportada desde el portal',
  '21 una emergencia no se anuncia como una consulta cualquiera');

-- ─────────────────────────────────────────────────────────────────────────────
-- FORMA DEL PAYLOAD (lo que el dispatcher necesita)
-- ─────────────────────────────────────────────────────────────────────────────
-- dispatchInApp lee tipo/titulo/seccion del payload y notification_channel_enabled
-- necesita user_id. Una fila sin ellos se despacha rota o se salta la preferencia.
SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'in_app'
      AND (payload->>'user_id' IS NULL OR payload->>'tipo' IS NULL
           OR payload->>'titulo' IS NULL OR payload->>'seccion' IS NULL)), 0,
  '22 toda fila in_app lleva user_id, tipo, titulo y seccion');

SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE channel = 'in_app' AND payload->>'user_id' <> recipient), 0,
  '23 recipient y payload.user_id no se contradicen nunca');

-- Los `tipo` son la clave con la que la campana agrupa (notificationCatalog.ts):
-- si aquí sale uno que el catálogo no conoce, la UI lo manda a "otros".
SELECT public.chk(
  (SELECT count(*) FROM public.notifications_outbox
    WHERE payload->>'tipo' NOT IN ('mensaje', 'difusion', 'solicitud')), 0,
  '24 los tipos emitidos son los tres que el catálogo de la campana clasifica');
