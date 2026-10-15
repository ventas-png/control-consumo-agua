-- Fixture adicional de housekeeping_flujo: lo que 20261031000000 necesita y el fixture de
-- evidencias no trae. Se carga DESPUÉS de housekeeping_evidencias/fixture.sql y de
-- housekeeping_responsable/fixture_rbac.sql.
--
-- · `companies.timezone` (20260717110000) y `app_users.cliente_id` (20260801000400).
-- · `unidades` (20260324000003, columnas mínimas) y `reservas_str` (20260420000007 +
--   20260514000001 + 20260522000007) con la RLS VIGENTE de 20260519000003: exige el permiso
--   `condominios.tab.str`, que es justo lo que un operador de housekeeping no tiene.
-- · `notifications_outbox` (20260604100000) y `notification_templates` (20260604110000)
--   reducidas a lo que lee el dispatcher, con su índice único NULLS NOT DISTINCT.
-- · COPIAS literales de `enqueue_notification` (20260604100000), `notif_staff_de_proyecto` y
--   `notif_encolar_in_app` (20260819000000) y `presencia_zona_horaria` (20260908000000).
-- · Un `cron` de mentira (tabla `cron.job` + schedule/unschedule) para comprobar que la
--   migración programa el recordatorio UNA vez aunque se aplique dos veces.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS timezone text;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS cliente_id uuid;

-- ── unidades ────────────────────────────────────────────────────────────────
CREATE TABLE public.unidades (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nombre     text NOT NULL,
  tipo       text NOT NULL DEFAULT 'otro',
  activo     boolean NOT NULL DEFAULT true
);
ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
CREATE POLICY unidades_select ON public.unidades FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

-- ── reservas_str ────────────────────────────────────────────────────────────
CREATE TABLE public.reservas_str (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  unidad_id             uuid        REFERENCES public.unidades(id) ON DELETE SET NULL,
  huesped_nombre        text        NOT NULL,
  huesped_email         text,
  huesped_telefono      text,
  fecha_entrada         date        NOT NULL,
  fecha_salida          date        NOT NULL,
  num_adultos           int         NOT NULL DEFAULT 1,
  num_ninos             int         NOT NULL DEFAULT 0,
  num_bebes             int         NOT NULL DEFAULT 0,
  plataforma            text        NOT NULL DEFAULT 'directo',
  monto_noche           numeric(10,2),
  monto_total           numeric(12,2),
  estado                text        NOT NULL DEFAULT 'confirmada',
  notas                 text,
  codigo_confirmacion   text,
  fecha_reservacion     date,
  hora_llegada_estimada time,
  hora_salida_estimada  time,
  politica_cancelacion  text,
  mascotas              boolean,
  foto_url              text,
  foto_documento_url    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  creado_por            uuid
);
ALTER TABLE public.reservas_str ENABLE ROW LEVEL SECURITY;
-- Policies vigentes (20260519000003_perf_rls_consolidate_policies.sql:404-460), resumidas:
CREATE POLICY str_select ON public.reservas_str FOR SELECT TO authenticated USING (
  is_super_admin() OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.str')));
CREATE POLICY str_insert ON public.reservas_str FOR INSERT TO authenticated WITH CHECK (
  is_super_admin() OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.str')));
CREATE POLICY str_update ON public.reservas_str FOR UPDATE TO authenticated USING (
  is_super_admin() OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.str')))
  WITH CHECK (is_super_admin() OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.str')));
CREATE POLICY str_delete ON public.reservas_str FOR DELETE TO authenticated USING (
  is_super_admin() OR (current_user_role() = ANY (ARRAY['company_owner','admin']) AND company_id = get_my_company_id()));

-- ── notifications_outbox (reducida) ─────────────────────────────────────────
CREATE TABLE public.notifications_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'push')),
  template_key  text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient     text,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'bounced')),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  last_error    text,
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;
-- Como en producción: ningún cliente escribe el outbox directamente.
REVOKE ALL ON public.notifications_outbox FROM anon, authenticated;

CREATE TABLE public.notification_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  key         text NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'push')),
  subject     text,
  body        text NOT NULL,
  locale      text NOT NULL DEFAULT 'es',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_notif_templates_key
  ON public.notification_templates (company_id, key, channel, locale) NULLS NOT DISTINCT;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_templates FROM anon, authenticated;

-- ── enqueue_notification: COPIA de 20260604100000 ───────────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_channel       text,
  p_recipient     text,
  p_payload       jsonb DEFAULT '{}'::jsonb,
  p_company_id    uuid DEFAULT NULL,
  p_template_key  text DEFAULT NULL,
  p_scheduled_at  timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_channel NOT IN ('in_app', 'email', 'whatsapp', 'push') THEN
    RAISE EXCEPTION 'canal invalido: %', p_channel;
  END IF;
  INSERT INTO public.notifications_outbox (
    company_id, channel, template_key, payload, recipient, scheduled_at
  ) VALUES (
    p_company_id, p_channel, p_template_key, COALESCE(p_payload, '{}'::jsonb),
    p_recipient, COALESCE(p_scheduled_at, now())
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(text, text, jsonb, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(text, text, jsonb, uuid, text, timestamptz) TO service_role;

-- ── notif_staff_de_proyecto / notif_encolar_in_app: COPIA de 20260819000000 ─
CREATE OR REPLACE FUNCTION public.notif_staff_de_proyecto(p_company_id uuid, p_project_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT au.id
  FROM public.app_users au
  WHERE au.company_id = p_company_id
    AND coalesce(au.activo, true)
    AND au.cliente_id IS NULL
    AND (
      au.role IN ('company_owner', 'admin')
      OR p_project_id IS NULL
      OR au.project_id = p_project_id
      OR EXISTS (SELECT 1 FROM public.user_project_assignments upa
                  WHERE upa.user_id = au.id AND upa.project_id = p_project_id)
    );
$$;
REVOKE ALL ON FUNCTION public.notif_staff_de_proyecto(uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notif_encolar_in_app(
  p_company_id uuid, p_user_ids uuid[], p_tipo text, p_titulo text, p_cuerpo text, p_seccion text,
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN 0;
  END IF;
  WITH insertadas AS (
    INSERT INTO public.notifications_outbox (company_id, channel, payload, recipient)
    SELECT
      p_company_id, 'in_app',
      coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
        'user_id', destinatario, 'tipo', p_tipo, 'titulo', p_titulo, 'cuerpo', p_cuerpo, 'seccion', p_seccion),
      destinatario::text
    FROM unnest(p_user_ids) AS destinatario
    WHERE destinatario IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_n FROM insertadas;
  RETURN coalesce(v_n, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.notif_encolar_in_app(uuid, uuid[], text, text, text, text, jsonb) FROM public, anon, authenticated;

-- ── presencia_zona_horaria: COPIA de 20260908000000 ─────────────────────────
CREATE OR REPLACE FUNCTION public.presencia_zona_horaria(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT COALESCE(c.timezone, 'America/Guatemala') INTO v_tz
  FROM public.companies c WHERE c.id = p_company_id;
  v_tz := COALESCE(v_tz, 'America/Guatemala');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Guatemala';
  END;
  RETURN v_tz;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.presencia_zona_horaria(uuid) FROM PUBLIC, anon, authenticated;

-- ── cron de mentira ─────────────────────────────────────────────────────────
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean
LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;
