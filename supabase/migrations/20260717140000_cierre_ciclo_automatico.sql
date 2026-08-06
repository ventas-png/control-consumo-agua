-- ============================================================================
-- Cierre de ciclo automático programable por proyecto (F3)
-- ============================================================================
-- El cierre de ciclo (agua_cerrar_ciclo 20260714010000/20260717110000 y
-- condominios_cerrar_ciclo 20260713110000) es manual: el operador debe
-- acordarse cada mes de "Emitir período" por cada proyecto. Este PR lo hace
-- programable:
--
--   1. cierre_ciclo_config — por proyecto+módulo: "cerrar el ciclo del MES
--      ANTERIOR a partir del día D" (D en 1–28, medido en la zona horaria del
--      tenant — companies.timezone, E4), con notificación opcional al
--      cliente/residente. Guarda además el último período cerrado y su
--      resultado (idempotencia + auditoría visible en la UI).
--
--   2. Split núcleo/guard de ambos RPCs de cierre: el cuerpo pasa ÍNTEGRO a
--      *_nucleo() SIN el guard de autorización (y revocada de los roles de
--      API), y el RPC user-facing conserva EXACTAMENTE el mismo guard
--      fail-closed y delega. Necesario porque pg_cron corre sin JWT
--      (auth.uid() NULL) y el guard lanzaría 42501 al dispatcher.
--
--   3. run_cierres_ciclo_automaticos() — dispatcher diario (pg_cron): para
--      cada config activa cuyo "hoy local" >= dia_cierre y cuyo período
--      anterior siga sin cerrar, invoca el núcleo, persiste el resultado en
--      la config y avisa in_app al staff admin del tenant vía el outbox.
--      Semántica "a partir del día D": si el cron no corrió (o el cierre
--      falló) el día D, se reintenta los días siguientes hasta cerrar; un
--      fallo NO marca el período y deja el error auditable en la config.
--      El cierre en sí es naturalmente idempotente (la máquina de estados
--      solo emite filas 'pendiente'), así que un doble disparo no duplica.
-- ============================================================================

-- ─── 1. Configuración por proyecto+módulo ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cierre_ciclo_config (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id              uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  modulo                  text        NOT NULL CHECK (modulo IN ('agua', 'condominios')),
  activo                  boolean     NOT NULL DEFAULT true,
  -- Día del mes (local del tenant) A PARTIR del cual se cierra el período del
  -- mes anterior. Tope 28: existe en todos los meses, sin casuística de 29-31.
  dia_cierre              smallint    NOT NULL DEFAULT 1 CHECK (dia_cierre BETWEEN 1 AND 28),
  -- Pasa como p_notificar al RPC: avisar al cliente/residente al emitir.
  notificar               boolean     NOT NULL DEFAULT true,
  ultimo_periodo_cerrado  text,
  ultimo_resultado        jsonb,
  ultimo_run_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cierre_ciclo_config_unico UNIQUE (project_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_cierre_ciclo_config_company
  ON public.cierre_ciclo_config(company_id);

COMMENT ON TABLE public.cierre_ciclo_config IS
  'Programación del cierre de ciclo automático por proyecto+módulo (F3): a partir del día D (hora local del tenant) el cron cierra el período del mes anterior vía agua/condominios_cerrar_ciclo_nucleo. ultimo_periodo_cerrado da la idempotencia mensual; ultimo_resultado audita el último run (o su error).';

ALTER TABLE public.cierre_ciclo_config ENABLE ROW LEVEL SECURITY;

-- Lectura: staff del tenant. Escritura: quien puede cerrar el ciclo manualmente
-- puede programarlo (mismos permisos que el guard de los RPCs de cierre). El
-- WITH CHECK exige además que el proyecto pertenezca a la empresa declarada
-- (projects es visible por RLS para el propio tenant).
DROP POLICY IF EXISTS "cierre_ciclo_config_sel" ON public.cierre_ciclo_config;
CREATE POLICY "cierre_ciclo_config_sel" ON public.cierre_ciclo_config
  FOR SELECT TO authenticated
  USING (is_super_admin() OR company_id = get_my_company_id());

DROP POLICY IF EXISTS "cierre_ciclo_config_ins" ON public.cierre_ciclo_config;
CREATE POLICY "cierre_ciclo_config_ins" ON public.cierre_ciclo_config
  FOR INSERT TO authenticated
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = project_id AND p.company_id = cierre_ciclo_config.company_id)
      AND user_has_permission(CASE modulo WHEN 'agua' THEN 'agua.cobros.change_status'
                                          ELSE 'condominios.tab.cuotas' END)
    )
  );

DROP POLICY IF EXISTS "cierre_ciclo_config_upd" ON public.cierre_ciclo_config;
CREATE POLICY "cierre_ciclo_config_upd" ON public.cierre_ciclo_config
  FOR UPDATE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id()
        AND user_has_permission(CASE modulo WHEN 'agua' THEN 'agua.cobros.change_status'
                                            ELSE 'condominios.tab.cuotas' END))
  )
  WITH CHECK (
    is_super_admin()
    OR (
      company_id = get_my_company_id()
      AND EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = project_id AND p.company_id = cierre_ciclo_config.company_id)
      AND user_has_permission(CASE modulo WHEN 'agua' THEN 'agua.cobros.change_status'
                                          ELSE 'condominios.tab.cuotas' END)
    )
  );

DROP POLICY IF EXISTS "cierre_ciclo_config_del" ON public.cierre_ciclo_config;
CREATE POLICY "cierre_ciclo_config_del" ON public.cierre_ciclo_config
  FOR DELETE TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id()
        AND user_has_permission(CASE modulo WHEN 'agua' THEN 'agua.cobros.change_status'
                                            ELSE 'condominios.tab.cuotas' END))
  );

-- ─── 2a. Núcleo AGUA (cuerpo ÍNTEGRO de 20260717110000, sin el guard) ────────

CREATE OR REPLACE FUNCTION public.agua_cerrar_ciclo_nucleo(
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
  IF p_periodo IS NULL OR p_periodo !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'periodo inválido (esperado YYYY-MM)' USING ERRCODE = '22023';
  END IF;

  -- E4/D5: ventana del período a MEDIANOCHE LOCAL del tenant. Zona inválida →
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
           (CASE WHEN COALESCE(r.monto_calculado, 0) > 0
                 THEN round(r.monto_calculado::numeric, 2) ELSE 0 END) AS base,
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
  -- emitida_at = v_now (misma transacción).
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

-- Núcleo SIN guard: jamás expuesto a la API (lo llaman el wrapper y el cron).
REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo_nucleo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo_nucleo(uuid, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo_nucleo(uuid, text, boolean) FROM authenticated;

COMMENT ON FUNCTION public.agua_cerrar_ciclo_nucleo IS
  'Cuerpo del cierre de ciclo de agua SIN guard de autorización (F3). Lo invocan agua_cerrar_ciclo (guard staff) y run_cierres_ciclo_automaticos (pg_cron, sin JWT). Revocada de los roles de API.';

-- ─── 2b. Wrapper AGUA: mismo guard fail-closed, delega en el núcleo ──────────

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
  v_company uuid;
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
  RETURN public.agua_cerrar_ciclo_nucleo(p_project_id, p_periodo, p_notificar);
END
$fn$;

REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agua_cerrar_ciclo(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.agua_cerrar_ciclo(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.agua_cerrar_ciclo IS
  'Cierra el ciclo de facturación de agua de un proyecto/período (guard staff: super admin o empresa del proyecto + agua.cobros.change_status; fail-closed sin JWT). Desde F3 delega el cuerpo en agua_cerrar_ciclo_nucleo — misma semántica que antes.';

-- ─── 2c. Núcleo CONDOMINIOS (cuerpo ÍNTEGRO de 20260713110000, sin el guard) ─

CREATE OR REPLACE FUNCTION public.condominios_cerrar_ciclo_nucleo(
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
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto no encontrado' USING ERRCODE = 'P0002';
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

  -- Aviso in-app al residente responsable (outbox), igual que 20260713110000.
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
             r.fecha_vencimiento, r.monto, r.moneda, au.id AS user_id
      FROM recien r
      JOIN roles_unidad ru ON ru.cuota_id = r.id
        AND ((r.rol_responsable IS NULL AND ru.rol = 'propietario')
             OR r.rol_responsable = ru.rol)
      JOIN public.app_users au ON au.cliente_id = ru.cliente_id AND au.activo = true
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
  END IF;

  RETURN jsonb_build_object(
    'emitidas', v_emitidas,
    'avisos', COALESCE(v_avisos, 0),
    'dias_vencimiento', v_dias
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo_nucleo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo_nucleo(uuid, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo_nucleo(uuid, text, boolean) FROM authenticated;

COMMENT ON FUNCTION public.condominios_cerrar_ciclo_nucleo IS
  'Cuerpo del cierre de ciclo de cuotas SIN guard de autorización (F3). Lo invocan condominios_cerrar_ciclo (guard staff) y run_cierres_ciclo_automaticos (pg_cron, sin JWT). Revocada de los roles de API.';

-- ─── 2d. Wrapper CONDOMINIOS: mismo guard fail-closed, delega en el núcleo ───

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
  v_company uuid;
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
  RETURN public.condominios_cerrar_ciclo_nucleo(p_project_id, p_periodo, p_notificar);
END
$fn$;

REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.condominios_cerrar_ciclo IS
  'Cierra el ciclo de cuotas de un proyecto/período (guard staff: super admin o empresa del proyecto + condominios.tab.cuotas; fail-closed sin JWT). Desde F3 delega el cuerpo en condominios_cerrar_ciclo_nucleo — misma semántica que antes.';

-- ─── 3. Dispatcher diario ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_cierres_ciclo_automaticos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  r          record;
  v_tz       text;
  v_hoy      date;
  v_periodo  text;
  v_res      jsonb;
  v_avisos   integer;
  v_cerrados integer := 0;
BEGIN
  FOR r IN
    SELECT cc.id, cc.project_id, cc.modulo, cc.dia_cierre, cc.notificar,
           cc.ultimo_periodo_cerrado,
           p.company_id, p.nombre AS proyecto_nombre,
           COALESCE(c.timezone, 'America/Guatemala') AS tz
    FROM public.cierre_ciclo_config cc
    -- El JOIN exige que el proyecto pertenezca a la empresa declarada: una
    -- config con company_id ajeno (no debería existir por RLS) queda inerte.
    JOIN public.projects  p ON p.id = cc.project_id AND p.company_id = cc.company_id
    JOIN public.companies c ON c.id = p.company_id
    WHERE cc.activo = true
      AND c.activa = true
    ORDER BY cc.created_at
  LOOP
    v_tz := r.tz;
    BEGIN
      PERFORM now() AT TIME ZONE v_tz;
    EXCEPTION WHEN OTHERS THEN
      v_tz := 'America/Guatemala';
    END;
    v_hoy := (now() AT TIME ZONE v_tz)::date;

    -- "A partir del día D" (no "solo el día D"): si el cron no corrió o el
    -- cierre falló, se reintenta los días siguientes hasta cerrar el período.
    CONTINUE WHEN extract(day FROM v_hoy)::int < r.dia_cierre;

    -- Se cierra el período del MES ANTERIOR al "hoy" local del tenant.
    v_periodo := to_char(v_hoy - interval '1 month', 'YYYY-MM');
    CONTINUE WHEN r.ultimo_periodo_cerrado IS NOT DISTINCT FROM v_periodo;

    BEGIN
      IF r.modulo = 'agua' THEN
        v_res := public.agua_cerrar_ciclo_nucleo(r.project_id, v_periodo, r.notificar);
      ELSE
        v_res := public.condominios_cerrar_ciclo_nucleo(r.project_id, v_periodo, r.notificar);
      END IF;

      UPDATE public.cierre_ciclo_config
         SET ultimo_periodo_cerrado = v_periodo,
             ultimo_resultado       = v_res,
             ultimo_run_at          = now(),
             updated_at             = now()
       WHERE id = r.id;

      -- Resultado al staff admin del tenant (campana). Los avisos al
      -- cliente/residente ya los encoló el núcleo si notificar=true.
      SELECT count(public.enqueue_notification(
        'in_app',
        au.id::text,
        jsonb_build_object(
          'tipo', 'cierre_ciclo_automatico',
          'titulo', 'Cierre de ciclo automático',
          'cuerpo',
            'Proyecto «' || r.proyecto_nombre || '» — ciclo de '
            || (CASE r.modulo WHEN 'agua' THEN 'agua' ELSE 'cuotas' END)
            || ' del período ' || v_periodo || ' cerrado: '
            || COALESCE(v_res->>'emitidas', '0') || ' emisión(es), '
            || COALESCE(v_res->>'avisos', '0') || ' aviso(s).',
          'seccion', CASE r.modulo WHEN 'agua' THEN 'cobros' ELSE 'condominios' END,
          'periodo', v_periodo,
          'hito', 'cierre_automatico'
        ),
        r.company_id,
        NULL::text,
        now()
      ))::integer
      INTO v_avisos
      FROM public.app_users au
      WHERE au.company_id = r.company_id
        AND au.activo = true
        AND au.role IN ('company_owner', 'admin');

      v_cerrados := v_cerrados + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Un fallo NO marca el período (reintenta mañana) y queda auditable.
      UPDATE public.cierre_ciclo_config
         SET ultimo_resultado = jsonb_build_object('error', SQLERRM, 'periodo', v_periodo),
             ultimo_run_at    = now(),
             updated_at       = now()
       WHERE id = r.id;
    END;
  END LOOP;

  RETURN v_cerrados;
END
$fn$;

REVOKE ALL ON FUNCTION public.run_cierres_ciclo_automaticos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.run_cierres_ciclo_automaticos() FROM anon;
REVOKE ALL ON FUNCTION public.run_cierres_ciclo_automaticos() FROM authenticated;

COMMENT ON FUNCTION public.run_cierres_ciclo_automaticos IS
  'Dispatcher diario (pg_cron) del cierre de ciclo automático (F3): por cada cierre_ciclo_config activa con "hoy local" >= dia_cierre y el período del mes anterior sin cerrar, invoca el núcleo del módulo, persiste el resultado y avisa in_app al staff admin (company_owner/admin). Fallos no marcan el período → reintento diario.';

-- ─── 4. pg_cron: diario 08:00 UTC (02:00 GT) ─────────────────────────────────
-- Cualquier hora fija sirve: la condición "día local >= D" se evalúa en la zona
-- del tenant y reintenta a diario, así que a lo sumo el cierre se corre unas
-- horas dentro del día D. Reschedule idempotente (mismo patrón que el resto).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cierres_ciclo_automaticos_daily';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cierres_ciclo_automaticos_daily',
  '0 8 * * *',
  $$SELECT public.run_cierres_ciclo_automaticos()$$
);
