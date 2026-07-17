-- ============================================================================
-- Cortes de período en la zona horaria del tenant (E4 / cierra D5)
-- ============================================================================
-- La BD corre en UTC y `registros.fecha` es timestamptz. El cierre de ciclo de
-- agua (agua_cerrar_ciclo, 20260714010000) cortaba el mes con fechas `date`
-- (cast implícito a MEDIANOCHE UTC): en operación GMT-6, una lectura estampada
-- después de las 18:00 locales del último día del mes caía al ciclo del mes
-- SIGUIENTE. Este PR:
--   1. companies.timezone (IANA, default 'America/Guatemala') — la zona del
--      tenant, editable por empresa (MX: America/Mexico_City, etc.).
--   2. agua_cerrar_ciclo recreada: la ventana del período se construye a
--      MEDIANOCHE LOCAL del tenant ((p_periodo||'-01')::timestamp AT TIME ZONE
--      tz). Zona inválida → fallback a America/Guatemala (nunca rompe el cierre).
--      El resto del cuerpo es IDÉNTICO a 20260714010000 (paridad verificada).
--
-- Nota: condominios_cerrar_ciclo NO necesita esto — corta por la columna
-- `periodo` (text YYYY-MM), sin anclaje a timestamps.
--
-- El frontend complementa con hoyLocalISO() (lib/format): los defaults de fecha
-- de captura/pago dejan de usar la fecha UTC (que de noche ya es "mañana").
-- ============================================================================

-- ─── 1. Zona horaria del tenant ──────────────────────────────────────────────

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Guatemala';

COMMENT ON COLUMN public.companies.timezone IS
  'Zona horaria IANA del tenant (cortes de período de facturación, E4/D5). No hay CHECK contra pg_timezone_names (no es inmutable); las funciones validan con fallback a America/Guatemala.';

-- ─── 2. agua_cerrar_ciclo con corte en zona local ────────────────────────────

CREATE OR REPLACE FUNCTION public.agua_cerrar_ciclo(
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
  v_iva_tasa numeric;
  v_tz       text;
  v_desde    timestamptz;
  v_hasta    timestamptz;
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
        AND public.user_has_permission('agua.cobros.change_status'))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_periodo IS NULL OR p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'periodo inválido (esperado YYYY-MM)' USING ERRCODE = '22023';
  END IF;

  -- E4/D5: ventana del período a MEDIANOCHE LOCAL del tenant (antes: date →
  -- cast a medianoche UTC = 18:00 del día anterior en GMT-6, y las lecturas
  -- vespertinas de fin de mes caían al ciclo siguiente). Zona inválida →
  -- fallback (el cierre jamás debe morir por un typo en configuración).
  SELECT COALESCE(c.timezone, 'America/Guatemala') INTO v_tz
  FROM public.companies c WHERE c.id = v_company;
  BEGIN
    PERFORM v_now AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Guatemala';
  END;
  v_desde := ((p_periodo || '-01')::timestamp) AT TIME ZONE v_tz;
  v_hasta := (((p_periodo || '-01')::date + interval '1 month')::timestamp) AT TIME ZONE v_tz;

  -- Días de vencimiento: regla de mora ACTIVA del proyecto (igual que la UI) ?? 30.
  SELECT rmc.dias_vencimiento INTO v_dias
  FROM public.reglas_mora_config rmc
  WHERE rmc.project_id = p_project_id AND rmc.activa = true
  ORDER BY rmc.created_at DESC
  LIMIT 1;
  v_dias := COALESCE(v_dias, 30);

  -- Tasa de IVA del tenant (companies.iva_tasa_default), acotada a [0,1] igual que
  -- calcularIVA: NULL → 0.12 (GT); negativa → 0; > 1 → 1; un 0 explícito es exento.
  SELECT c.iva_tasa_default INTO v_iva_tasa FROM public.companies c WHERE c.id = v_company;
  v_iva_tasa := CASE
                  WHEN v_iva_tasa IS NULL THEN 0.12
                  WHEN v_iva_tasa < 0     THEN 0
                  WHEN v_iva_tasa > 1     THEN 1
                  ELSE v_iva_tasa
                END;

  -- Emisión set-based de todas las emitibles del período (una sola pasada).
  WITH emitibles AS (
    SELECT r.id,
           -- base imponible: monto_calculado redondeado (0 si <= 0), como calcularIVA.
           (CASE WHEN COALESCE(r.monto_calculado, 0) > 0
                 THEN round(r.monto_calculado::numeric, 2) ELSE 0 END) AS base,
           -- mora ya calculada (0 al emitir salvo que venga dada), como calcularTotalFactura.
           (CASE WHEN COALESCE(r.mora_monto, 0) > 0
                 THEN round(r.mora_monto::numeric, 2) ELSE 0 END)      AS mora
    FROM public.registros r
    WHERE r.project_id = p_project_id
      AND r.deleted_at IS NULL
      AND r.fecha >= v_desde
      AND r.fecha <  v_hasta
      AND (CASE
             WHEN COALESCE(r.factura_estado, r.estado) IN ('pendiente','emitida','pagada','vencida','anulada')
               THEN COALESCE(r.factura_estado, r.estado)
             WHEN COALESCE(r.factura_estado, r.estado) = 'pagado' THEN 'pagada'
             WHEN COALESCE(r.factura_estado, r.estado) = 'mora'   THEN 'vencida'
             ELSE 'pendiente'
           END) = 'pendiente'
    FOR UPDATE
  ),
  calc AS (
    SELECT e.id, e.mora,
           round(e.base * v_iva_tasa, 2)                        AS iva_monto,
           round(e.base + round(e.base * v_iva_tasa, 2), 2)     AS monto_con_iva
    FROM emitibles e
  ),
  upd AS (
    UPDATE public.registros cu
    SET factura_estado    = 'emitida',
        emitida_at        = v_now,
        fecha_vencimiento = (v_now + make_interval(days => v_dias))::date,
        iva_tasa          = v_iva_tasa,
        iva_monto         = c.iva_monto,
        monto_con_iva     = c.monto_con_iva,
        total_a_pagar     = round(c.monto_con_iva + c.mora, 2)
    FROM calc c
    WHERE cu.id = c.id
    RETURNING cu.id
  )
  SELECT count(*) INTO v_emitidas FROM upd;

  -- Aviso al cliente del recibo (outbox). Identificamos lo recién emitido por
  -- emitida_at = v_now (misma transacción). La máquina de estados garantiza que
  -- cada registro se emite una sola vez (sin dedup extra).
  IF p_notificar AND v_emitidas > 0 THEN
    -- (a) in_app — la campana siempre recibe. Sin ruta_id (registro no es ruta).
    WITH recien AS (
      SELECT r.id AS registro_id, r.cliente_id, r.fecha_vencimiento,
             COALESCE(r.total_a_pagar, r.monto_calculado) AS monto,
             COALESCE(p.moneda, '') AS moneda
      FROM public.registros r
      LEFT JOIN public.projects p ON p.id = r.project_id
      WHERE r.project_id = p_project_id
        AND r.emitida_at = v_now
        AND r.cliente_id IS NOT NULL
    ),
    destinatarios AS (
      SELECT DISTINCT r.registro_id, r.fecha_vencimiento, r.monto, r.moneda,
             au.id AS user_id, cli.email AS email
      FROM recien r
      JOIN public.app_users au ON au.cliente_id = r.cliente_id AND au.activo = true
      LEFT JOIN public.clientes cli ON cli.id = r.cliente_id
    )
    SELECT count(public.enqueue_notification(
      'in_app',
      d.user_id::text,
      jsonb_build_object(
        'tipo', 'recibo_agua_emitido',
        'titulo', 'Nuevo recibo de agua',
        'cuerpo',
          'Se emitió tu recibo de agua del período ' || p_periodo || ' por '
          || (CASE WHEN d.moneda <> '' THEN d.moneda || ' ' ELSE '' END)
          || to_char(d.monto, 'FM999999990.00')
          || ' — vence el ' || to_char(d.fecha_vencimiento, 'DD/MM/YYYY') || '.',
        'seccion', 'cobros',
        'registro_id', d.registro_id,
        'periodo', p_periodo,
        'hito', 'emitida'
      ),
      v_company,
      NULL::text,
      v_now
    ))::integer
    INTO v_avisos
    FROM destinatarios d;

    -- (b) email — al correo del cliente, si lo tiene. `user_id` habilita el opt-out
    -- del canal (notification_channel_enabled). Inerte si el tenant no tiene Gmail.
    WITH recien AS (
      SELECT r.id AS registro_id, r.cliente_id, r.fecha_vencimiento,
             COALESCE(r.total_a_pagar, r.monto_calculado) AS monto,
             COALESCE(p.moneda, '') AS moneda
      FROM public.registros r
      LEFT JOIN public.projects p ON p.id = r.project_id
      WHERE r.project_id = p_project_id
        AND r.emitida_at = v_now
        AND r.cliente_id IS NOT NULL
    ),
    destinatarios AS (
      SELECT DISTINCT r.registro_id, r.fecha_vencimiento, r.monto, r.moneda,
             au.id AS user_id, cli.email AS email
      FROM recien r
      JOIN public.app_users au ON au.cliente_id = r.cliente_id AND au.activo = true
      LEFT JOIN public.clientes cli ON cli.id = r.cliente_id
    )
    SELECT count(public.enqueue_notification(
      'email',
      d.email,
      jsonb_build_object(
        'to_email', d.email,
        'user_id', d.user_id,
        'tipo', 'recibo_agua_emitido',
        'subject', 'Nuevo recibo de agua — período ' || p_periodo,
        'html_body',
          '<p>Se emitió tu recibo de agua del período <strong>' || p_periodo
          || '</strong> por '
          || (CASE WHEN d.moneda <> '' THEN d.moneda || ' ' ELSE '' END)
          || to_char(d.monto, 'FM999999990.00')
          || '.</p><p>Vence el <strong>'
          || to_char(d.fecha_vencimiento, 'DD/MM/YYYY') || '</strong>.</p>',
        'seccion', 'cobros',
        'registro_id', d.registro_id,
        'periodo', p_periodo,
        'hito', 'emitida'
      ),
      v_company,
      NULL::text,
      v_now
    ))::integer
    INTO v_emails
    FROM destinatarios d
    WHERE d.email IS NOT NULL AND d.email <> '';
  END IF;

  RETURN jsonb_build_object(
    'emitidas', v_emitidas,
    'avisos', COALESCE(v_avisos, 0),
    'emails', COALESCE(v_emails, 0),
    'dias_vencimiento', v_dias,
    'iva_tasa', v_iva_tasa,
    'timezone', v_tz
  );
END
$fn$;

-- Grants por nombre (lección 20260604210000): revocar default y otorgar explícito.
REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.agua_cerrar_ciclo(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.agua_cerrar_ciclo IS
  'Cierra el ciclo de facturación de agua de un proyecto/período: emite en un solo statement todos los registros emitibles del mes (paridad con buildEmitirFacturaPatch) y opcionalmente avisa al cliente vía outbox. E4/D5: la ventana del período corta a MEDIANOCHE LOCAL del tenant (companies.timezone, fallback America/Guatemala). Staff gated.';
