-- Aviso de emisión de cuota TAMBIÉN por email (extensión de condominios_cerrar_ciclo).
--
-- CONTEXTO: 20260713110000 introdujo el cierre de ciclo set-based y un aviso
-- in-app (canal 'in_app' del outbox) al residente responsable. El in-app siempre
-- llega (la campana), pero el residente puede no entrar al portal. Este PR agrega
-- un SEGUNDO aviso por el canal 'email' del MISMO outbox, al correo del residente
-- responsable (clientes.email), sin credenciales nuevas:
--   • Lo entrega notifications-dispatcher SOLO si el tenant tiene Gmail conectado
--     (company_email_configs activo). Si no, la fila email se marca `failed`
--     no-retriable y NO afecta al in-app ni al resto del lote — inerte por diseño.
--   • Respeta la preferencia de canal: el payload declara `user_id` (= app_users.id
--     = auth.users.id), así el dispatcher consulta notification_channel_enabled(
--     user_id,'email') y SUPRIME si el residente desactivó el email (modelo opt-out;
--     'in_app' nunca se suprime). Sin user_id no habría opt-out posible.
--   • Autocontenida: usa subject/html_body directos en el payload (el dispatcher
--     cae a `resolveEmailContent` con esos campos cuando no hay template_key). No
--     siembra notification_templates.
--
-- PARIDAD DEL IN-APP: el CTE `responsables` gana un LEFT JOIN a clientes para
-- traer el email. `clientes.id` es PK ⇒ el LEFT JOIN aporta ≤1 fila y `email` queda
-- funcionalmente determinado por user_id (via cliente_id), de modo que ni el
-- conteo de filas ni el DISTINCT del aviso in-app cambian: el enqueue 'in_app'
-- queda BYTE-IDÉNTICO. El email es un statement adicional, filtrado a correos no
-- vacíos.
--
-- Todo lo demás (guard de autorización IS NOT TRUE fail-closed, emisión set-based,
-- grants) es idéntico a 20260713110000; esto es un CREATE OR REPLACE del cuerpo.
--
-- Validado contra prod vía BEGIN…ROLLBACK (claims simulados de company_owner):
-- emite las candidatas del período y encola in_app + email por responsable con
-- correo; el llamante sin JWT recibe 42501. Apply por el gate humano P0 #9.

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
  -- IS NOT TRUE (no `NOT (...)`): con auth.uid() NULL el guard evalúa a NULL y
  -- `NOT NULL` no lanza (lógica trivaluada) — fail-closed también sin JWT.
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

  -- Días de vencimiento: regla de mora ACTIVA del proyecto (igual que la UI) ?? 30.
  SELECT rmc.dias_vencimiento INTO v_dias
  FROM public.reglas_mora_config rmc
  WHERE rmc.project_id = p_project_id AND rmc.activa = true
  ORDER BY rmc.created_at DESC
  LIMIT 1;
  v_dias := COALESCE(v_dias, 30);

  -- Emisión set-based de todas las emitibles del período (una sola pasada).
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

  -- Aviso al residente responsable (outbox). Identificamos lo recién emitido por
  -- emitida_at = v_now (misma transacción). Sin dedup extra: la máquina de estados
  -- garantiza que cada cuota se emite una sola vez.
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
      -- LEFT JOIN a clientes: `email` queda funcionalmente determinado por user_id
      -- (via cliente_id) y clientes.id es PK ⇒ el conteo/DISTINCT del in_app no cambia.
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
    -- (a) in_app — BYTE-IDÉNTICO a 20260713110000 (la campana siempre recibe).
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
        'ruta_id', r.cuota_id,
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

    -- (b) email — al correo del responsable, si lo tiene. `user_id` en el payload
    -- habilita el opt-out del canal (notification_channel_enabled). Inerte si el
    -- tenant no tiene Gmail (el dispatcher marca la fila failed no-retriable).
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
  'Cierra el ciclo de cuotas de un proyecto/período: emite en un solo statement todas las cuotas emitibles (paridad con buildEmitirCuotaPatch: emitida + vencimiento por regla de mora + snapshot de total) y opcionalmente avisa al residente responsable vía el outbox por DOS canales — in_app (siempre) y email (si el tenant tiene Gmail conectado; respeta el opt-out por notification_preferences). Staff gated: super admin o empresa del proyecto + permiso condominios.tab.cuotas.';
