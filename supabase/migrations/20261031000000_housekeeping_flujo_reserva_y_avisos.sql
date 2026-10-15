-- ════════════════════════════════════════════════════════════════════════════
-- Housekeeping · flujo por pasos, reserva STR vinculada, avisos al responsable
-- e informe al cerrar
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ CAMBIA
--   · El servicio puede VINCULARSE a una reserva de corto plazo (`reserva_str_id`)
--     del mismo proyecto; la base guarda un RESUMEN sellado de la reserva
--     (`reserva_str_resumen`) para que la tarjeta, el PDF y el correo del informe
--     funcionen aunque quien mira no tenga el permiso de STR y aunque la reserva
--     se borre después (ON DELETE SET NULL conserva el resumen como historial).
--   · Las TRANSICIONES de estado se validan en la base: pendiente → en_proceso
--     (Iniciar servicio) → completado (Finalizar), y cancelado desde las dos
--     primeras. Saltar de pendiente a completado, o reabrir un completado, queda
--     reservado a company_owner/admin (y super_admin). service_role/cron no se
--     restringe. Sin «en_proceso» no hay `iniciado_en` ni horas dedicadas.
--   · Fase de fotos nueva `inconvenientes` (estado al ingresar / inconvenientes
--     encontrados / resultado), 20 por fase; el cupo de objetos por servicio en
--     Storage pasa de 60 a 90. Texto `inconvenientes` junto a `hallazgos_ingreso`.
--   · AVISOS al responsable: al asignar, reasignar o reprogramar un servicio
--     pendiente, campana (in_app) + correo (outbox → Gmail del tenant, si lo hay);
--     y un RECORDATORIO 60 min antes de la hora tentativa de ingreso, en la zona
--     horaria del tenant (companies.timezone vía presencia_zona_horaria), por
--     pg_cron cada 15 min. Idempotencia en hk_recordatorios_log.
--   · INFORME al cerrar: hk_notificar_informe(servicio, a_administradores,
--     email_extra) encola correos (SIN adjunto: resumen + enlace a la app) a
--     company_owner/admin con acceso al proyecto y/o a un correo tecleado, y
--     sella informe_enviado_en/por. WhatsApp se comparte desde el dispositivo.
--
-- HORAS
--   `hora_inicio` es la hora TENTATIVA de ingreso (base del recordatorio) y
--   `hora_fin` la estimada de fin. Las reales son `iniciado_en` / `completado_en`
--   (trg_hk_sellar_ejecucion, 20261028000000), que esta migración no toca.
--
-- QUÉ NO CAMBIA
--   hk_acceso, las policies de servicios_housekeeping, trg_hk_sellar_ejecucion,
--   trg_hk_responsable (20261030000100) ni los sellos de autoría. Asignar o
--   vincular no concede acceso a nada: ninguna policy mira estas columnas.
--   Esta migración no escribe ninguna fila de datos.
--
-- COMPATIBILIDAD
--   Las columnas nuevas admiten NULL; los servicios existentes quedan como están.
--   Un UPDATE que no cambia `estado` no pasa por la validación de transición.
--
-- REVERSIÓN: scripts/reversion-housekeeping-flujo.sql
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER/POLICY
-- IF EXISTS, ON CONFLICT DO NOTHING en plantillas, unschedule antes de schedule.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Columnas ──────────────────────────────────────────────────────────────
ALTER TABLE public.servicios_housekeeping
  ADD COLUMN IF NOT EXISTS reserva_str_id      uuid REFERENCES public.reservas_str(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reserva_str_resumen jsonb,
  ADD COLUMN IF NOT EXISTS inconvenientes      text,
  ADD COLUMN IF NOT EXISTS informe_enviado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS informe_enviado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_hk_reserva_str
  ON public.servicios_housekeeping(reserva_str_id) WHERE reserva_str_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hk_pendientes_agenda
  ON public.servicios_housekeeping(fecha, hora_inicio)
  WHERE estado = 'pendiente' AND responsable_user_id IS NOT NULL;

COMMENT ON COLUMN public.servicios_housekeeping.hora_inicio IS
  'Hora TENTATIVA de ingreso (la real es iniciado_en). Base del recordatorio previo al responsable.';
COMMENT ON COLUMN public.servicios_housekeeping.hora_fin IS
  'Hora ESTIMADA de fin (la real es completado_en).';
COMMENT ON COLUMN public.servicios_housekeeping.reserva_str_id IS
  'Reserva STR vinculada (opcional), del mismo proyecto. Validada por trg_hk_reserva. Al borrar la reserva queda NULL y el resumen se conserva.';
COMMENT ON COLUMN public.servicios_housekeeping.reserva_str_resumen IS
  'Resumen de la reserva vinculada, sellado por la base al vincular (huésped, código, fechas, horas, estado, plataforma, unidad). Lo que mande el cliente se ignora.';
COMMENT ON COLUMN public.servicios_housekeeping.inconvenientes IS
  'Inconvenientes encontrados al ingresar (texto; fotos en la fase «inconvenientes»). Nunca se purga.';
COMMENT ON COLUMN public.servicios_housekeeping.informe_enviado_en IS
  'Última vez que se encoló el informe por correo (hk_notificar_informe). Sello de la base.';

-- ── 2) Reserva vinculada: validación y resumen sellado ──────────────────────
-- SECURITY DEFINER para leer reservas_str sin la RLS del usuario (que exige el
-- permiso de STR): un operador de housekeeping puede vincular una reserva que
-- no podría listar. Lo que se exige es que la reserva sea del MISMO proyecto
-- y empresa del servicio y no esté cancelada. El resumen lo escribe la base.
--   · Desvincular a mano (reserva_str_id → NULL con la reserva aún viva) borra
--     el resumen. Si la reserva se eliminó (ON DELETE SET NULL), el resumen se
--     conserva: es historial del servicio.
--   · Si el servicio no trae unidad, hereda la de la reserva; si trae otra
--     distinta de la de la reserva, se rechaza.
CREATE OR REPLACE FUNCTION public.hk_reserva_validar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r          public.reservas_str%ROWTYPE;
  v_cambia   boolean;
  v_unidad   boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_cambia := NEW.reserva_str_id IS NOT NULL;
    v_unidad := false;
    NEW.reserva_str_resumen := NULL;
  ELSE
    v_cambia := NEW.reserva_str_id IS DISTINCT FROM OLD.reserva_str_id
                OR (NEW.reserva_str_id IS NOT NULL
                    AND (NEW.company_id IS DISTINCT FROM OLD.company_id
                         OR NEW.project_id IS DISTINCT FROM OLD.project_id));
    v_unidad := NEW.reserva_str_id IS NOT NULL AND NOT v_cambia
                AND NEW.unidad_id IS DISTINCT FROM OLD.unidad_id;
    NEW.reserva_str_resumen := OLD.reserva_str_resumen;
  END IF;

  IF NEW.reserva_str_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.reserva_str_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.reservas_str x WHERE x.id = OLD.reserva_str_id) THEN
      NEW.reserva_str_resumen := NULL;      -- desvinculado a mano
    END IF;
    RETURN NEW;
  END IF;

  IF v_cambia OR v_unidad THEN
    SELECT * INTO r FROM public.reservas_str x WHERE x.id = NEW.reserva_str_id;
    IF NOT FOUND OR r.company_id IS DISTINCT FROM NEW.company_id OR r.project_id IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'HK_RESERVA_FUERA_DE_ALCANCE: la reserva debe existir y ser del mismo proyecto y empresa del servicio'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_cambia AND r.estado = 'cancelada' THEN
      RAISE EXCEPTION 'HK_RESERVA_CANCELADA: no se vincula una reserva cancelada'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.unidad_id IS NULL THEN
      NEW.unidad_id := r.unidad_id;
    ELSIF r.unidad_id IS NOT NULL AND r.unidad_id <> NEW.unidad_id THEN
      RAISE EXCEPTION 'HK_RESERVA_UNIDAD_DISTINTA: la unidad del servicio no coincide con la de la reserva'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_cambia THEN
      NEW.reserva_str_resumen := jsonb_build_object(
        'reserva_id',            r.id,
        'codigo_confirmacion',   r.codigo_confirmacion,
        'huesped_nombre',        r.huesped_nombre,
        'huesped_telefono',      r.huesped_telefono,
        'huesped_email',         r.huesped_email,
        'fecha_entrada',         r.fecha_entrada,
        'fecha_salida',          r.fecha_salida,
        'hora_llegada_estimada', r.hora_llegada_estimada,
        'hora_salida_estimada',  r.hora_salida_estimada,
        'estado',                r.estado,
        'plataforma',            r.plataforma,
        'unidad_id',             r.unidad_id,
        'vinculado_en',          now()
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_reserva_validar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_reserva ON public.servicios_housekeeping;
CREATE TRIGGER trg_hk_reserva
  BEFORE INSERT OR UPDATE OF reserva_str_id, reserva_str_resumen, unidad_id, company_id, project_id
  ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.hk_reserva_validar();

-- ── 3) Transiciones de estado ───────────────────────────────────────────────
-- Dispara ANTES que trg_hk_sellar_ejecucion (orden alfabético: «estado» <
-- «sellar»): un salto inválido nunca llega a sellar iniciado_*/completado_*.
CREATE OR REPLACE FUNCTION public.hk_transicion_estado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin boolean;
  v_ok    boolean;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN                      -- service_role, cron, migraciones
    RETURN NEW;
  END IF;
  v_admin := COALESCE(public.is_super_admin()
                      OR public.current_user_role() IN ('company_owner', 'admin'), false);
  v_ok := CASE
    WHEN OLD.estado = 'pendiente'  AND NEW.estado IN ('en_proceso', 'cancelado') THEN true
    WHEN OLD.estado = 'en_proceso' AND NEW.estado IN ('completado', 'cancelado') THEN true
    WHEN OLD.estado = 'pendiente'  AND NEW.estado = 'completado'                 THEN v_admin
    WHEN OLD.estado = 'completado' AND NEW.estado = 'en_proceso'                 THEN v_admin
    WHEN OLD.estado = 'cancelado'  AND NEW.estado = 'pendiente'                  THEN v_admin
    ELSE false
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'HK_TRANSICION_INVALIDA: de "%" a "%"', OLD.estado, NEW.estado
      USING ERRCODE = 'check_violation',
            HINT = 'Un servicio se inicia (pendiente → en_proceso) y después se finaliza (en_proceso → completado). Saltar o reabrir es solo para dueño/administrador.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_transicion_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_estado_transicion ON public.servicios_housekeeping;
CREATE TRIGGER trg_hk_estado_transicion
  BEFORE UPDATE OF estado ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.hk_transicion_estado();

-- ── 4) Fase «inconvenientes» y cupo de Storage ──────────────────────────────
-- El CHECK se localiza por su definición (no por nombre) y se reemplaza. El tope
-- por fase (20, hk_fotos_preparar) no cambia; el de objetos por servicio pasa a
-- 90 (3 fases × 20 + holgura para reintentos), recreando la policy íntegra.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%fase%'
  LOOP
    IF c.def NOT ILIKE '%inconvenientes%' THEN
      EXECUTE format('ALTER TABLE public.servicio_housekeeping_fotos DROP CONSTRAINT %I', c.conname);
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass
       AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%inconvenientes%'
  ) THEN
    ALTER TABLE public.servicio_housekeeping_fotos
      ADD CONSTRAINT servicio_housekeeping_fotos_fase_check
      CHECK (fase IN ('ingreso', 'inconvenientes', 'cierre'));
  END IF;
END $$;

COMMENT ON COLUMN public.servicio_housekeeping_fotos.fase IS
  'ingreso (estado al llegar) · inconvenientes (encontrados al llegar) · cierre (resultado). Máximo 20 por fase.';

DROP POLICY IF EXISTS "hk_evidencias_insert" ON storage.objects;
CREATE POLICY "hk_evidencias_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'housekeeping-evidencias'
    AND name ~ '^[^/]+/[^/]+/[^/]+$'
    AND EXISTS (
      SELECT 1 FROM public.servicios_housekeeping s
       WHERE s.id::text = (storage.foldername(name))[2]
         AND s.project_id::text = (storage.foldername(name))[1]
         AND public.hk_acceso(s.company_id, s.project_id)
    )
    AND public.hk_objetos_del_servicio((storage.foldername(name))[2]) < 90
  );

-- ── 5) Catálogo del selector: reservas vinculables del proyecto ─────────────
-- Misma guarda que hk_responsables_elegibles: el llamador necesita hk_acceso al
-- proyecto (lo mismo que para escribir el servicio). Devuelve las reservas en
-- curso y confirmadas (futuras o cargadas); la pantalla filtra por unidad.
CREATE OR REPLACE FUNCTION public.hk_reservas_vinculables(p_project_id uuid, p_unidad_id uuid DEFAULT NULL)
RETURNS TABLE (
  id                    uuid,
  codigo_confirmacion   text,
  huesped_nombre        text,
  fecha_entrada         date,
  fecha_salida          date,
  hora_llegada_estimada time,
  hora_salida_estimada  time,
  estado                text,
  unidad_id             uuid,
  unidad_nombre         text,
  plataforma            text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  -- COALESCE: una sesión sin perfil no pasa por NULL (regla de 20261029000000).
  IF NOT COALESCE(public.is_super_admin() OR v_company = public.get_my_company_id(), false) THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(public.hk_acceso(v_company, p_project_id), false) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.id, r.codigo_confirmacion, r.huesped_nombre, r.fecha_entrada, r.fecha_salida,
         r.hora_llegada_estimada, r.hora_salida_estimada, r.estado, r.unidad_id, u.nombre, r.plataforma
    FROM public.reservas_str r
    LEFT JOIN public.unidades u ON u.id = r.unidad_id
   WHERE r.project_id = p_project_id
     AND r.company_id = v_company
     AND r.estado IN ('confirmada', 'en_curso')
   ORDER BY COALESCE(p_unidad_id IS NOT NULL AND r.unidad_id = p_unidad_id, false) DESC,  -- sin unidad ≠ primero
            (r.estado = 'en_curso') DESC,
            r.fecha_entrada ASC, r.id ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_reservas_vinculables(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_reservas_vinculables(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.hk_reservas_vinculables(uuid, uuid) IS
  'Reservas STR en curso o confirmadas de un proyecto, para vincular un servicio de housekeeping. Exige hk_acceso al llamador (42501 si no). La unidad pedida va primero; la pantalla filtra.';

-- ── 6) Avisos al responsable ────────────────────────────────────────────────
-- 6.1 Log de idempotencia. `clave` distingue reprogramaciones (fecha|hora) para
-- `asignacion` y el día para `previo`. Solo escribe la base (DEFINER); nadie
-- lo lee por la API (policy USING false), igual que hk_limpieza_storage.
CREATE TABLE IF NOT EXISTS public.hk_recordatorios_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  servicio_id uuid NOT NULL REFERENCES public.servicios_housekeeping(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  hito        text NOT NULL CHECK (hito IN ('asignacion', 'previo')),
  clave       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (servicio_id, user_id, hito, clave)
);
ALTER TABLE public.hk_recordatorios_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hk_recordatorios_log FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "hk_recordatorios_log_nadie" ON public.hk_recordatorios_log;
CREATE POLICY "hk_recordatorios_log_nadie" ON public.hk_recordatorios_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
COMMENT ON TABLE public.hk_recordatorios_log IS
  'Avisos ya encolados al responsable de un servicio de housekeeping (idempotencia). Lo escribe hk_encolar_aviso_responsable; nadie lo toca por la API.';

-- 6.2 Etiqueta del tipo de servicio (misma tabla que TIPO_CONFIG en la pantalla).
CREATE OR REPLACE FUNCTION public.hk_tipo_etiqueta(p_tipo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_tipo
    WHEN 'limpieza_estandar'   THEN 'Limpieza estándar'
    WHEN 'limpieza_profunda'   THEN 'Limpieza profunda'
    WHEN 'lavanderia'          THEN 'Lavandería'
    WHEN 'mantenimiento_menor' THEN 'Mantenimiento menor'
    ELSE COALESCE(p_tipo, 'Servicio')
  END
$$;

-- 6.3 Escape mínimo para HTML en los correos (los textos los escribe el usuario).
CREATE OR REPLACE FUNCTION public.hk_html(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT replace(replace(replace(replace(COALESCE(p_texto, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- 6.4 Plantillas globales de correo (el tenant puede sobreescribirlas por
-- company_id). Si faltan, el dispatcher usa subject/body del payload TAL CUAL
-- (sin sustituir {{variables}}): por eso el enlace a la aplicación vive en la
-- plantilla y los cuerpos del payload no llevan marcadores.
INSERT INTO public.notification_templates (company_id, key, channel, subject, body, locale, is_active) VALUES
  (NULL, 'housekeeping_asignado', 'email',
   'Servicio asignado: {{servicio_tipo}} · {{unidad}} · {{fecha}}',
   '<p>Tienes asignado un servicio de housekeeping.</p><p><b>{{servicio_tipo}}</b> · Unidad {{unidad}}<br/>Fecha {{fecha}} · ingreso tentativo {{hora}}<br/>Asignado por {{asignado_por}}<br/>{{reserva}}</p><p>{{notas}}</p><p><a href="{{app_url}}/condominios">Abrir en la aplicación</a></p>',
   'es', true),
  (NULL, 'housekeeping_recordatorio', 'email',
   'Hoy a las {{hora}}: {{servicio_tipo}} en {{unidad}}',
   '<p>Recordatorio de tu servicio de housekeeping de hoy.</p><p><b>{{servicio_tipo}}</b> · Unidad {{unidad}}<br/>Ingreso tentativo a las {{hora}}<br/>{{reserva}}</p><p>{{notas}}</p><p><a href="{{app_url}}/condominios">Abrir en la aplicación</a></p>',
   'es', true),
  (NULL, 'housekeeping_informe', 'email',
   'Informe de housekeeping: {{servicio_tipo}} · {{unidad}} · {{fecha}}',
   '{{informe_html}}<p><a href="{{app_url}}/condominios">Abrir en la aplicación</a></p>',
   'es', true)
ON CONFLICT DO NOTHING;

-- 6.5 Encolar un aviso (campana + correo) al responsable, una sola vez por clave.
CREATE OR REPLACE FUNCTION public.hk_encolar_aviso_responsable(
  p_servicio public.servicios_housekeeping,
  p_hito     text,
  p_clave    text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n          integer := 0;
  v_insertado  boolean;
  v_email      text;
  v_unidad     text;
  v_asignador  text;
  v_tipo       text;
  v_fecha      text;
  v_hora       text;
  v_reserva    text;
  v_titulo     text;
  v_cuerpo     text;
  v_key        text;
BEGIN
  IF p_servicio.responsable_user_id IS NULL OR p_hito NOT IN ('asignacion', 'previo') THEN
    RETURN 0;
  END IF;

  INSERT INTO public.hk_recordatorios_log (servicio_id, company_id, user_id, hito, clave)
  VALUES (p_servicio.id, p_servicio.company_id, p_servicio.responsable_user_id, p_hito, p_clave)
  ON CONFLICT (servicio_id, user_id, hito, clave) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_insertado := v_n > 0;
  IF NOT v_insertado THEN
    RETURN 0;
  END IF;

  SELECT u.nombre INTO v_unidad FROM public.unidades u WHERE u.id = p_servicio.unidad_id;
  SELECT a.full_name INTO v_asignador FROM public.app_users a WHERE a.id = p_servicio.responsable_asignado_por;
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = p_servicio.responsable_user_id;
  v_tipo  := public.hk_tipo_etiqueta(p_servicio.tipo);
  v_fecha := to_char(p_servicio.fecha, 'DD/MM/YYYY');
  -- Sin hora tentativa, el recordatorio previo se calcula a las 08:00 (hk_recordatorios_previos).
  v_hora  := COALESCE(to_char(p_servicio.hora_inicio, 'HH24:MI'),
                      CASE WHEN p_hito = 'previo' THEN '08:00' ELSE 'sin hora' END);
  v_reserva := CASE WHEN p_servicio.reserva_str_resumen IS NOT NULL THEN
      'Reserva ' || COALESCE(p_servicio.reserva_str_resumen->>'codigo_confirmacion', '') || ' · '
      || COALESCE(p_servicio.reserva_str_resumen->>'huesped_nombre', '')
      || ' (' || COALESCE(p_servicio.reserva_str_resumen->>'fecha_entrada', '?') || ' → '
      || COALESCE(p_servicio.reserva_str_resumen->>'fecha_salida', '?') || ')'
    ELSE '' END;

  IF p_hito = 'asignacion' THEN
    v_key    := 'housekeeping_asignado';
    v_titulo := 'Servicio de housekeeping asignado';
    v_cuerpo := concat_ws(' · ', v_tipo,
                  CASE WHEN v_unidad IS NOT NULL THEN 'Unidad ' || v_unidad END,
                  v_fecha || ' ' || v_hora,
                  CASE WHEN v_asignador IS NOT NULL THEN 'asignado por ' || v_asignador END,
                  NULLIF(v_reserva, ''));
  ELSE
    v_key    := 'housekeeping_recordatorio';
    v_titulo := 'Hoy a las ' || v_hora || ': ' || v_tipo || COALESCE(' en ' || v_unidad, '');
    v_cuerpo := concat_ws(' · ', 'Ingreso tentativo a las ' || v_hora, NULLIF(v_reserva, ''),
                  NULLIF(p_servicio.notas, ''));
  END IF;

  v_n := public.notif_encolar_in_app(
    p_servicio.company_id,
    ARRAY[p_servicio.responsable_user_id],
    v_key,
    v_titulo,
    v_cuerpo,
    'condominios',
    jsonb_build_object('servicio_id', p_servicio.id, 'project_id', p_servicio.project_id,
                       'unidad_id', p_servicio.unidad_id, 'fecha', p_servicio.fecha, 'hito', p_hito)
  );

  IF v_email IS NOT NULL AND v_email <> '' THEN
    PERFORM public.enqueue_notification(
      'email',
      v_email,
      jsonb_build_object(
        'to_email',      v_email,
        'user_id',       p_servicio.responsable_user_id,   -- activa el opt-out por canal
        'tipo',          v_key,
        'subject',       v_titulo,
        'body',          '<p>' || public.hk_html(v_cuerpo) || '</p>',   -- respaldo si no hay plantilla
        'servicio_id',   p_servicio.id,
        'servicio_tipo', v_tipo,
        'unidad',        COALESCE(v_unidad, '—'),
        'fecha',         v_fecha,
        'hora',          v_hora,
        'asignado_por',  COALESCE(v_asignador, '—'),
        'reserva',       v_reserva,
        'notas',         public.hk_html(COALESCE(p_servicio.notas, ''))
      ),
      p_servicio.company_id,
      v_key,
      now()
    );
    v_n := v_n + 1;
  END IF;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_encolar_aviso_responsable(public.servicios_housekeeping, text, text) FROM PUBLIC, anon, authenticated;

-- 6.6 Al asignar, reasignar o reprogramar un servicio pendiente. No se avisa a
-- quien se asigna a sí mismo. El aviso jamás tumba el guardado.
CREATE OR REPLACE FUNCTION public.hk_notificar_asignacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cambio boolean;
BEGIN
  IF NEW.estado <> 'pendiente' OR NEW.responsable_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.responsable_user_id IS NOT DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;
  v_cambio := TG_OP = 'INSERT'
              OR NEW.responsable_user_id IS DISTINCT FROM OLD.responsable_user_id
              OR NEW.fecha IS DISTINCT FROM OLD.fecha
              OR NEW.hora_inicio IS DISTINCT FROM OLD.hora_inicio
              OR (OLD.estado <> 'pendiente');
  IF NOT v_cambio THEN
    RETURN NEW;
  END IF;
  BEGIN
    PERFORM public.hk_encolar_aviso_responsable(
      NEW, 'asignacion', NEW.fecha::text || '|' || COALESCE(NEW.hora_inicio::text, ''));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'hk_notificar_asignacion(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_notificar_asignacion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_notificar_asignacion ON public.servicios_housekeeping;
CREATE TRIGGER trg_hk_notificar_asignacion
  AFTER INSERT OR UPDATE OF responsable_user_id, fecha, hora_inicio, estado ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.hk_notificar_asignacion();

-- 6.7 Recordatorio previo: 60 min antes de la hora tentativa, en la zona del
-- tenant. `p_ahora` es inyectable para las pruebas. El previo sí se manda aunque
-- el responsable sea quien creó el servicio. Devuelve cuántas notificaciones
-- encoló (campana + correo cuentan por separado).
CREATE OR REPLACE FUNCTION public.hk_recordatorios_previos(
  p_ventana interval DEFAULT interval '60 minutes',
  p_ahora   timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s        public.servicios_housekeeping%ROWTYPE;
  v_tz     text;
  v_inicio timestamptz;
  v_n      integer := 0;
BEGIN
  FOR s IN
    SELECT x.* FROM public.servicios_housekeeping x
     WHERE x.estado = 'pendiente' AND x.responsable_user_id IS NOT NULL
       AND x.fecha BETWEEN (p_ahora::date - 1) AND (p_ahora::date + 1)
  LOOP
    v_tz := public.presencia_zona_horaria(s.company_id);
    v_inicio := (s.fecha + COALESCE(s.hora_inicio, time '08:00')) AT TIME ZONE v_tz;
    IF p_ahora >= v_inicio - p_ventana AND p_ahora < v_inicio THEN
      v_n := v_n + public.hk_encolar_aviso_responsable(s, 'previo', s.fecha::text);
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_recordatorios_previos(interval, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hk_recordatorios_previos(interval, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.run_hk_recordatorios_previos()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT public.hk_recordatorios_previos(); $$;
REVOKE EXECUTE ON FUNCTION public.run_hk_recordatorios_previos() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hk_recordatorios_previos';
    PERFORM cron.schedule('hk_recordatorios_previos', '*/15 * * * *', 'SELECT public.run_hk_recordatorios_previos();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'hk_recordatorios_previos no se programó: %', SQLERRM;
END;
$$;

-- ── 7) Informe al cerrar: correo a administradores y/o a un destinatario ────
-- Sin adjunto: el PDF con fotos se comparte desde la aplicación. Destinatarios:
-- company_owner/admin con acceso al proyecto (notif_staff_de_proyecto filtrado
-- por usuario_acceso_a_proyecto, 20260906000400) con correo, y/o un correo
-- tecleado (sin opt-out: es externo). Exige hk_acceso al llamador. Se puede
-- repetir (reenviar); cada llamada vuelve a encolar y actualiza el sello.
CREATE OR REPLACE FUNCTION public.hk_notificar_informe(
  p_servicio_id       uuid,
  p_a_administradores boolean DEFAULT true,
  p_email_extra       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s           public.servicios_housekeeping%ROWTYPE;
  v_uid       uuid := auth.uid();
  v_unidad    text;
  v_resp      text;
  v_inicio    text;
  v_compl     text;
  v_tipo      text;
  v_fecha     text;
  v_horas     text;
  v_fotos     text;
  v_reserva   text;
  v_html      text;
  v_subject   text;
  v_extra     text := NULLIF(btrim(COALESCE(p_email_extra, '')), '');
  v_dest      text[] := ARRAY[]::text[];
  d           record;
  v_n         integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT x.* INTO s FROM public.servicios_housekeeping x WHERE x.id = p_servicio_id;
  IF NOT FOUND OR NOT COALESCE(public.hk_acceso(s.company_id, s.project_id), false) THEN
    RAISE EXCEPTION 'Servicio inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF s.estado <> 'completado' THEN
    RAISE EXCEPTION 'HK_INFORME_NO_COMPLETADO: el informe se envía al finalizar el servicio'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_extra IS NOT NULL AND v_extra !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'HK_EMAIL_INVALIDO: el correo del destinatario no es válido'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT COALESCE(p_a_administradores, false) AND v_extra IS NULL THEN
    RAISE EXCEPTION 'HK_SIN_DESTINATARIOS: elige administradores o escribe un correo'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT u.nombre INTO v_unidad FROM public.unidades u WHERE u.id = s.unidad_id;
  SELECT a.full_name INTO v_resp FROM public.app_users a WHERE a.id = s.responsable_user_id;
  v_tipo  := public.hk_tipo_etiqueta(s.tipo);
  v_fecha := to_char(s.fecha, 'DD/MM/YYYY');
  v_inicio := COALESCE(to_char(s.iniciado_en, 'DD/MM/YYYY HH24:MI'), '—');
  v_compl  := COALESCE(to_char(s.completado_en, 'DD/MM/YYYY HH24:MI'), '—');
  v_horas := CASE WHEN s.iniciado_en IS NOT NULL AND s.completado_en IS NOT NULL AND s.completado_en >= s.iniciado_en
                  THEN to_char(s.completado_en - s.iniciado_en, 'HH24:MI') || ' h'
                  ELSE 'no calculable' END;
  SELECT 'ingreso ' || count(*) FILTER (WHERE f.fase = 'ingreso')
      || ' · inconvenientes ' || count(*) FILTER (WHERE f.fase = 'inconvenientes')
      || ' · resultado ' || count(*) FILTER (WHERE f.fase = 'cierre')
    INTO v_fotos
    FROM public.servicio_housekeeping_fotos f WHERE f.servicio_id = s.id;
  v_reserva := CASE WHEN s.reserva_str_resumen IS NOT NULL THEN
      '<tr><td><b>Reserva</b></td><td>' || public.hk_html(COALESCE(s.reserva_str_resumen->>'codigo_confirmacion', '—'))
      || ' · ' || public.hk_html(COALESCE(s.reserva_str_resumen->>'huesped_nombre', ''))
      || ' · ' || COALESCE(s.reserva_str_resumen->>'fecha_entrada', '?') || ' → '
      || COALESCE(s.reserva_str_resumen->>'fecha_salida', '?')
      || ' (' || public.hk_html(COALESCE(s.reserva_str_resumen->>'plataforma', '')) || ')</td></tr>'
    ELSE '' END;

  v_subject := 'Informe de housekeeping: ' || v_tipo || ' · ' || COALESCE(v_unidad, 'sin unidad') || ' · ' || v_fecha;
  v_html :=
    '<h2>Informe de housekeeping</h2>'
    || '<table>'
    || '<tr><td><b>Servicio</b></td><td>' || public.hk_html(v_tipo) || '</td></tr>'
    || '<tr><td><b>Unidad</b></td><td>' || public.hk_html(COALESCE(v_unidad, 'sin unidad')) || '</td></tr>'
    || '<tr><td><b>Fecha</b></td><td>' || v_fecha || ' · ingreso tentativo ' || COALESCE(to_char(s.hora_inicio, 'HH24:MI'), '—') || '</td></tr>'
    || '<tr><td><b>Responsable</b></td><td>' || public.hk_html(COALESCE(v_resp, '—')) || '</td></tr>'
    || '<tr><td><b>Inicio real</b></td><td>' || v_inicio || '</td></tr>'
    || '<tr><td><b>Fin real</b></td><td>' || v_compl || '</td></tr>'
    || '<tr><td><b>Horas dedicadas</b></td><td>' || v_horas || '</td></tr>'
    || v_reserva
    || '<tr><td><b>Fotos</b></td><td>' || v_fotos || '</td></tr>'
    || '</table>'
    || '<h3>Estado al ingresar</h3><p>' || public.hk_html(COALESCE(NULLIF(s.hallazgos_ingreso, ''), 'Sin observaciones.')) || '</p>'
    || '<h3>Inconvenientes encontrados</h3><p>' || public.hk_html(COALESCE(NULLIF(s.inconvenientes, ''), 'Ninguno.')) || '</p>'
    || '<h3>Resultado</h3><p>' || public.hk_html(COALESCE(NULLIF(s.observaciones_cierre, ''), 'Sin observaciones.')) || '</p>'
    || '<p>El PDF con las fotografías se comparte desde la aplicación.</p>';
    -- El enlace a la aplicación lo pone la plantilla housekeeping_informe ({{app_url}}).

  IF COALESCE(p_a_administradores, false) THEN
    FOR d IN
      SELECT au.id AS user_id, u.email
        FROM public.notif_staff_de_proyecto(s.company_id, s.project_id) st
        JOIN public.app_users au ON au.id = st.user_id
        JOIN auth.users u ON u.id = au.id
       WHERE au.role IN ('company_owner', 'admin') AND au.activo
         AND public.usuario_acceso_a_proyecto(au.id, s.project_id)   -- un admin acotado a otro proyecto no recibe
         AND u.email IS NOT NULL AND u.email <> ''
       ORDER BY u.email
    LOOP
      PERFORM public.enqueue_notification('email', d.email,
        jsonb_build_object('to_email', d.email, 'user_id', d.user_id, 'tipo', 'housekeeping_informe',
                           'subject', v_subject, 'body', v_html, 'informe_html', v_html,
                           'servicio_id', s.id, 'servicio_tipo', v_tipo, 'unidad', COALESCE(v_unidad, '—'), 'fecha', v_fecha),
        s.company_id, 'housekeeping_informe', now());
      v_dest := v_dest || d.email;
      v_n := v_n + 1;
    END LOOP;
  END IF;

  IF v_extra IS NOT NULL AND NOT (v_extra = ANY (v_dest)) THEN
    PERFORM public.enqueue_notification('email', v_extra,
      jsonb_build_object('to_email', v_extra, 'tipo', 'housekeeping_informe',
                         'subject', v_subject, 'body', v_html, 'informe_html', v_html,
                         'servicio_id', s.id, 'servicio_tipo', v_tipo, 'unidad', COALESCE(v_unidad, '—'), 'fecha', v_fecha),
      s.company_id, 'housekeeping_informe', now());
    v_dest := v_dest || v_extra;
    v_n := v_n + 1;
  END IF;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'HK_SIN_DESTINATARIOS: ningún administrador del proyecto tiene correo'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.servicios_housekeeping
     SET informe_enviado_en = now(), informe_enviado_por = v_uid
   WHERE id = s.id;

  RETURN jsonb_build_object('encolados', v_n, 'destinatarios', to_jsonb(v_dest), 'extra', v_extra IS NOT NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_notificar_informe(uuid, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_notificar_informe(uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.hk_notificar_informe(uuid, boolean, text) IS
  'Encola por correo (sin adjunto) el informe de un servicio de housekeeping completado a company_owner/admin con acceso al proyecto y/o a un correo tecleado. Exige hk_acceso al llamador; sella informe_enviado_en/por.';
