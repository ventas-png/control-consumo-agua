-- Fix: los avisos in_app de cuotas NO deben poner el cuota_id en `ruta_id`.
--
-- BUG (verificado contra prod): condominios_cerrar_ciclo y enqueue_recordatorios_
-- cuotas encolan el aviso in_app con jsonb `'ruta_id', cuota_id`. El dispatcher
-- (notifications-dispatcher.dispatchInApp) inserta ese valor en
-- public.user_notifications.ruta_id, que es FK a public.rutas(id). Un cuota_id NO
-- es un ruta_id ⇒ la inserción viola la FK (foreign_key_violation) ⇒ el aviso in_app
-- se marca failed y NUNCA llega a la campana del residente. Comprobado: insertar un
-- cuota_id en user_notifications.ruta_id es rechazado por la FK.
--
-- La campana (NotificationBell) navega SOLO por `seccion` (onNavigate(n.seccion));
-- nunca lee ruta_id para estos avisos, y `cuota_id` del payload no es columna de
-- user_notifications (el dispatcher solo persiste tipo/titulo/cuerpo/seccion/
-- ruta_id/ocurrencia_id). Por eso la corrección es quitar `ruta_id` del payload:
-- se conserva `seccion='portal'` (navegación intacta) y `cuota_id` como referencia
-- del payload (para auditoría/consumidores del outbox), y desaparece la violación.
--
-- Es un CREATE OR REPLACE de ambas funciones = versión actual MENOS la línea de
-- ruta_id. Todo lo demás (emisión, IVA/total, role-aware, idempotencia, guards,
-- grants) queda idéntico. El aviso por email (canal 'email') nunca tuvo ruta_id.
-- (agua_cerrar_ciclo ya nace sin ruta_id, así que no necesita corrección.)
--
-- Validado contra prod vía BEGIN…ROLLBACK: tras el reemplazo, el aviso in_app se
-- inserta en user_notifications sin violar la FK. Apply por el gate humano P0 #9.

-- ── (1) condominios_cerrar_ciclo — versión con email (20260714000000) sin ruta_id ──
CREATE OR REPLACE FUNCTION public.condominios_cerrar_ciclo(
  p_project_id uuid,
  p_periodo    text,
  p_notificar  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_now      timestamptz := now();
  v_company  uuid;
  v_dias     integer;
  v_emitidas integer := 0;
  v_avisos   integer := 0;
  v_emails   integer := 0;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF (
    public.is_super_admin()
    OR (v_company = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.cuotas'))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_periodo IS NULL OR p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'periodo inválido (esperado YYYY-MM)' USING ERRCODE = '22023';
  END IF;

  SELECT rmc.dias_vencimiento INTO v_dias
  FROM public.reglas_mora_config rmc
  WHERE rmc.project_id = p_project_id AND rmc.activa = true
  ORDER BY rmc.created_at DESC
  LIMIT 1;
  v_dias := COALESCE(v_dias, 30);

  WITH emitibles AS (
    SELECT c.id
    FROM public.cuotas_condominio c
    WHERE c.project_id = p_project_id
      AND c.company_id = v_company
      AND c.periodo = p_periodo
      AND c.deleted_at IS NULL
      AND (CASE
             WHEN c.cuota_estado IN ('pendiente','emitida','pagada','vencida','anulada') THEN c.cuota_estado
             WHEN c.cuota_estado = 'pagado' THEN 'pagada'
             WHEN c.cuota_estado = 'moroso' THEN 'vencida'
             WHEN c.cuota_estado IS NULL THEN
               (CASE COALESCE(c.estado, 'pendiente')
                  WHEN 'pagado' THEN 'pagada'
                  WHEN 'moroso' THEN 'vencida'
                  ELSE 'pendiente'
                END)
             ELSE 'pendiente'
           END) = 'pendiente'
    FOR UPDATE
  ),
  upd AS (
    UPDATE public.cuotas_condominio cu
    SET cuota_estado      = 'emitida',
        emitida_at        = v_now,
        fecha_vencimiento = (v_now + make_interval(days => v_dias))::date,
        total_a_pagar     = round((COALESCE(cu.monto, 0) + COALESCE(cu.mora_monto, 0))::numeric, 2)
    FROM emitibles e
    WHERE cu.id = e.id
    RETURNING cu.id
  )
  SELECT count(*) INTO v_emitidas FROM upd;

  IF p_notificar AND v_emitidas > 0 THEN
    WITH recien AS (
      SELECT c.id, c.company_id, c.unidad_id, c.rol_responsable, c.concepto,
             c.periodo, c.fecha_vencimiento,
             COALESCE(c.total_a_pagar, c.monto) AS monto,
             COALESCE(p.moneda_condominios, p.moneda, '') AS moneda
      FROM public.cuotas_condominio c
      LEFT JOIN public.projects p ON p.id = c.project_id
      WHERE c.project_id = p_project_id
        AND c.periodo = p_periodo
        AND c.emitida_at = v_now
        AND c.unidad_id IS NOT NULL
    ),
    roles_unidad AS (
      SELECT r.id AS cuota_id, u.cliente_id, 'propietario'::text AS rol
      FROM recien r JOIN public.unidades u ON u.id = r.unidad_id
      WHERE u.cliente_id IS NOT NULL
      UNION
      SELECT r.id, ur.cliente_id, ur.tipo
      FROM recien r JOIN public.unidad_residentes ur ON ur.unidad_id = r.unidad_id
      WHERE ur.activo = true
    ),
    responsables AS (
      SELECT DISTINCT r.id AS cuota_id, r.company_id, r.concepto, r.periodo,
             r.fecha_vencimiento, r.monto, r.moneda, au.id AS user_id,
             cli.email AS email
      FROM recien r
      JOIN roles_unidad ru ON ru.cuota_id = r.id
        AND ((r.rol_responsable IS NULL AND ru.rol = 'propietario')
             OR r.rol_responsable = ru.rol)
      JOIN public.app_users au ON au.cliente_id = ru.cliente_id AND au.activo = true
      LEFT JOIN public.clientes cli ON cli.id = ru.cliente_id
    )
    SELECT count(public.enqueue_notification(
      'in_app',
      r.user_id::text,
      jsonb_build_object(
        'tipo', 'cuota_emitida',
        'titulo', 'Nueva cuota emitida',
        'cuerpo',
          'Se emitió tu cuota de ' || r.concepto || ' (' || r.periodo || ') por '
          || (CASE WHEN r.moneda <> '' THEN r.moneda || ' ' ELSE '' END)
          || to_char(r.monto, 'FM999999990.00')
          || ' — vence el ' || to_char(r.fecha_vencimiento, 'DD/MM/YYYY') || '.',
        'seccion', 'portal',
        'cuota_id', r.cuota_id,
        'periodo', r.periodo,
        'hito', 'emitida'
      ),
      r.company_id,
      NULL::text,
      v_now
    ))::integer
    INTO v_avisos
    FROM responsables r;

    WITH recien AS (
      SELECT c.id, c.company_id, c.unidad_id, c.rol_responsable, c.concepto,
             c.periodo, c.fecha_vencimiento,
             COALESCE(c.total_a_pagar, c.monto) AS monto,
             COALESCE(p.moneda_condominios, p.moneda, '') AS moneda
      FROM public.cuotas_condominio c
      LEFT JOIN public.projects p ON p.id = c.project_id
      WHERE c.project_id = p_project_id
        AND c.periodo = p_periodo
        AND c.emitida_at = v_now
        AND c.unidad_id IS NOT NULL
    ),
    roles_unidad AS (
      SELECT r.id AS cuota_id, u.cliente_id, 'propietario'::text AS rol
      FROM recien r JOIN public.unidades u ON u.id = r.unidad_id
      WHERE u.cliente_id IS NOT NULL
      UNION
      SELECT r.id, ur.cliente_id, ur.tipo
      FROM recien r JOIN public.unidad_residentes ur ON ur.unidad_id = r.unidad_id
      WHERE ur.activo = true
    ),
    responsables AS (
      SELECT DISTINCT r.id AS cuota_id, r.company_id, r.concepto, r.periodo,
             r.fecha_vencimiento, r.monto, r.moneda, au.id AS user_id,
             cli.email AS email
      FROM recien r
      JOIN roles_unidad ru ON ru.cuota_id = r.id
        AND ((r.rol_responsable IS NULL AND ru.rol = 'propietario')
             OR r.rol_responsable = ru.rol)
      JOIN public.app_users au ON au.cliente_id = ru.cliente_id AND au.activo = true
      LEFT JOIN public.clientes cli ON cli.id = ru.cliente_id
    )
    SELECT count(public.enqueue_notification(
      'email',
      r.email,
      jsonb_build_object(
        'to_email', r.email,
        'user_id', r.user_id,
        'tipo', 'cuota_emitida',
        'subject',
          'Nueva cuota emitida — ' || r.concepto || ' (' || r.periodo || ')',
        'html_body',
          '<p>Se emitió tu cuota de <strong>' || r.concepto || '</strong> ('
          || r.periodo || ') por '
          || (CASE WHEN r.moneda <> '' THEN r.moneda || ' ' ELSE '' END)
          || to_char(r.monto, 'FM999999990.00')
          || '.</p><p>Vence el <strong>'
          || to_char(r.fecha_vencimiento, 'DD/MM/YYYY') || '</strong>.</p>',
        'seccion', 'portal',
        'cuota_id', r.cuota_id,
        'periodo', r.periodo,
        'hito', 'emitida'
      ),
      r.company_id,
      NULL::text,
      v_now
    ))::integer
    INTO v_emails
    FROM responsables r
    WHERE r.email IS NOT NULL AND r.email <> '';
  END IF;

  RETURN jsonb_build_object(
    'emitidas', v_emitidas,
    'avisos', COALESCE(v_avisos, 0),
    'emails', COALESCE(v_emails, 0),
    'dias_vencimiento', v_dias
  );
END
$fn$;

COMMENT ON FUNCTION public.condominios_cerrar_ciclo IS
  'Cierra el ciclo de cuotas de un proyecto/período: emite en un solo statement todas las cuotas emitibles y opcionalmente avisa al residente responsable vía el outbox por in_app (siempre) y email (si el tenant tiene Gmail; respeta opt-out). Staff gated: super admin o empresa del proyecto + permiso condominios.tab.cuotas. El aviso in_app no setea ruta_id (un cuota_id no es una ruta).';

-- ── (2) enqueue_recordatorios_cuotas — 20260713090000 sin ruta_id ──────────────
CREATE OR REPLACE FUNCTION public.enqueue_recordatorios_cuotas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidatas AS (
    SELECT c.id AS cuota_id, c.company_id, c.unidad_id, c.rol_responsable,
           c.concepto, c.periodo, c.fecha_vencimiento,
           COALESCE(c.total_a_pagar, c.monto) AS monto,
           COALESCE(p.moneda_condominios, p.moneda, '') AS moneda,
           CASE WHEN c.fecha_vencimiento < current_date THEN 'vencida' ELSE 'proximo' END AS hito
    FROM public.cuotas_condominio c
    LEFT JOIN public.projects p ON p.id = c.project_id
    WHERE c.deleted_at IS NULL
      AND c.estado <> 'pagado'
      AND (c.cuota_estado IS NULL OR c.cuota_estado NOT IN ('pagada','anulada'))
      AND c.fecha_vencimiento IS NOT NULL
      AND c.unidad_id IS NOT NULL
      AND c.fecha_vencimiento <= current_date + 3
  ),
  roles_unidad AS (
    SELECT ca.cuota_id, u.cliente_id AS cliente_id, 'propietario'::text AS rol
    FROM candidatas ca JOIN public.unidades u ON u.id = ca.unidad_id
    WHERE u.cliente_id IS NOT NULL
    UNION
    SELECT ca.cuota_id, ur.cliente_id, ur.tipo
    FROM candidatas ca JOIN public.unidad_residentes ur ON ur.unidad_id = ca.unidad_id
    WHERE ur.activo = true
  ),
  responsables AS (
    SELECT DISTINCT ca.cuota_id, ca.company_id, ca.hito, ca.concepto, ca.periodo,
           ca.fecha_vencimiento, ca.monto, ca.moneda, au.id AS user_id
    FROM candidatas ca
    JOIN roles_unidad ru ON ru.cuota_id = ca.cuota_id
      AND ((ca.rol_responsable IS NULL AND ru.rol = 'propietario')
           OR ca.rol_responsable = ru.rol)
    JOIN public.app_users au ON au.cliente_id = ru.cliente_id AND au.activo = true
  ),
  logged AS (
    INSERT INTO public.cuota_recordatorios_log (cuota_id, user_id, hito, company_id)
    SELECT cuota_id, user_id, hito, company_id FROM responsables
    ON CONFLICT (cuota_id, user_id, hito) DO NOTHING
    RETURNING cuota_id, user_id, hito
  )
  SELECT count(public.enqueue_notification(
    'in_app',
    r.user_id::text,
    jsonb_build_object(
      'tipo', 'cuota_recordatorio',
      'titulo', CASE WHEN r.hito = 'vencida' THEN 'Cuota vencida' ELSE 'Cuota por vencer' END,
      'cuerpo',
        'Cuota de ' || r.concepto || ' (' || r.periodo || ') por '
        || (CASE WHEN r.moneda <> '' THEN r.moneda || ' ' ELSE '' END)
        || to_char(r.monto, 'FM999999990.00')
        || CASE WHEN r.hito = 'vencida'
                THEN ' — vencida desde el ' || to_char(r.fecha_vencimiento, 'DD/MM/YYYY') || '. Regularizá tu pago.'
                ELSE ' — vence el ' || to_char(r.fecha_vencimiento, 'DD/MM/YYYY') || '.' END,
      'seccion', 'portal',
      'cuota_id', r.cuota_id,
      'periodo', r.periodo,
      'hito', r.hito
    ),
    r.company_id,
    NULL::text,
    now()
  ))::integer
  INTO v_count
  FROM responsables r
  JOIN logged l ON l.cuota_id = r.cuota_id AND l.user_id = r.user_id AND l.hito = r.hito;

  RETURN COALESCE(v_count, 0);
END
$fn$;

COMMENT ON FUNCTION public.enqueue_recordatorios_cuotas IS
  'Encola recordatorios in-app (outbox) a los residentes responsables de las cuotas impagas (próximas o vencidas). Role-aware + idempotente (cuota_recordatorios_log). El aviso in_app no setea ruta_id (un cuota_id no es una ruta). Devuelve cuántos encoló.';

-- ── (3) Reparación de datos: avisos ya encolados con el payload defectuoso ────
-- El cron de recordatorios ya corrió con la versión buggy: hay filas in_app en el
-- outbox cuyo payload trae `ruta_id` (verificado en prod: 4 'cuota_recordatorio'
-- en status queued). Al despacharse violarían la FK y esos avisos se perderían.
-- Se limpia el `ruta_id` SOLO de los tipos de cuotas (otros productores, p. ej.
-- rutas de ronda, usan ruta_id legítimamente) y solo de filas aún no enviadas.
-- Idempotente: re-ejecutar no cambia nada (payload ? 'ruta_id' ya es falso).
UPDATE public.notifications_outbox
SET payload = payload - 'ruta_id'
WHERE channel = 'in_app'
  AND payload->>'tipo' IN ('cuota_emitida', 'cuota_recordatorio')
  AND payload ? 'ruta_id'
  AND status <> 'sent';

-- Grants: CREATE OR REPLACE preserva los grants existentes; se re-afirman por
-- claridad y para no depender del estado previo.
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_cuotas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_cuotas() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_cuotas() FROM authenticated;

REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) TO authenticated;
