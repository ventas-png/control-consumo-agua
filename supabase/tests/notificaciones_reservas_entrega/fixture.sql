-- ════════════════════════════════════════════════════════════════════════════
-- Fixture del test de 20260824000000 (reservas que avisan + entrega in_app).
--
-- Se apoya en el fixture de `notificaciones_actividad` (padrón de usuarios,
-- proyectos, unidades, outbox y el helper `chk`), que run.sh carga antes que
-- éste: lo que 20260824000000 necesita es exactamente lo que aquélla dejó
-- montado más tres cosas que no existían allí —las amenidades, las reservas y
-- la tabla `user_notifications`, que es donde ahora aterriza la entrega.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Columnas del outbox que el fixture base no necesitaba ───────────────────
-- La parte 2 de la migración es un despachador: reclama por `scheduled_at`,
-- lleva la cuenta de intentos y sella el resultado. El fixture base sólo
-- modelaba el encolado, así que aquí se completa la tabla real
-- (20260604100000 + provider_message_id de 20260709100000).
ALTER TABLE public.notifications_outbox
  ADD COLUMN IF NOT EXISTS scheduled_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempts            integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts        integer     NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS last_error          text,
  ADD COLUMN IF NOT EXISTS sent_at             timestamptz,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

-- ── La campana ──────────────────────────────────────────────────────────────
-- El FK de `user_id` NO es decorativo en este test: es lo que provoca el fallo
-- del caso "destinatario que ya no existe", con el que se comprueba que una
-- fila torcida no se queda clavada en 'sending'.
CREATE TABLE public.user_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  company_id    uuid,
  tipo          text NOT NULL,
  titulo        text NOT NULL,
  cuerpo        text,
  seccion       text,
  ruta_id       uuid,
  ocurrencia_id uuid,
  leido         boolean NOT NULL DEFAULT false,
  leido_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Amenidades y reservas ───────────────────────────────────────────────────
CREATE TABLE public.amenidades (
  id         uuid PRIMARY KEY,
  nombre     text NOT NULL,
  project_id uuid NOT NULL,
  company_id uuid NOT NULL
);

CREATE TABLE public.reservas_amenidades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  project_id  uuid NOT NULL,
  amenidad_id uuid NOT NULL,
  unidad_id   uuid NOT NULL,
  cliente_id  uuid,
  fecha       date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin    time NOT NULL,
  estado      text NOT NULL DEFAULT 'confirmada',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.amenidades (id, nombre, project_id, company_id) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'Salón de eventos',
   '11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000000a'),
  -- Amenidad del OTRO proyecto: sirve para comprobar el alcance del fan-out.
  ('eeeeeeee-0000-0000-0000-000000000002', 'Piscina',
   '11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a');

-- Unidad del proyecto 2 (el fixture base sólo trae la del proyecto 1).
INSERT INTO public.unidades (id, nombre, project_id, company_id, cliente_id, activo) VALUES
  ('dddddddd-0000-0000-0000-000000000002', 'Casa 2',
   '11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-00000000000a',
   'cccccccc-0000-0000-0000-000000000002', true);
