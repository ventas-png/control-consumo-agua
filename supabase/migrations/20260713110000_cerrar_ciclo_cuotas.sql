-- Facturación masiva por ciclo (P1 · condominios) + hardening de grants.
--
-- (1) HARDENING (hallazgo del recon): enqueue_recordatorios_cuotas() (migración
-- 20260713090000) solo hizo REVOKE FROM PUBLIC. Por los DEFAULT PRIVILEGES de
-- Supabase (lección documentada en 20260604210000), `authenticated` conservó
-- EXECUTE — verificado en prod: proacl = {postgres, authenticated, service_role}.
-- Cualquier usuario logueado podía invocarla vía /rest/v1/rpc (impacto acotado:
-- contenido enlatado + idempotente, pero viola el patrón). Se revoca POR NOMBRE;
-- el cron pg_cron corre como owner y no necesita grant.
--
-- (2) CERRAR CICLO: la emisión de cuotas era SOLO por fila (useEmitirCuotaMutation);
-- no existía "cerrar el mes". Nuevo RPC condominios_cerrar_ciclo(project, periodo):
-- emite EN UN SOLO STATEMENT todas las cuotas emitibles del período y (opcional)
-- avisa in-app al residente responsable vía el outbox — el único pipeline de
-- entrega real (los tabs de "envío" solo escriben logs). Sin credenciales externas.
--
-- PARIDAD EXACTA con el flujo por fila (buildEmitirCuotaPatch + CuotasTab):
--   • emitible = normalizar(cuota_estado ?? estado) = 'pendiente'
--     (normalizar: legacy 'pagado'→pagada, 'moroso'→vencida, NULL→pendiente).
--   • patch: cuota_estado='emitida', emitida_at=now, fecha_vencimiento =
--     (now + días)::date con días = reglas_mora_config activa del proyecto ?? 30,
--     total_a_pagar = round(monto + mora_monto, 2)  (SIN IVA — cuota no gravada).
--   • Aviso role-aware (mismo dominio que #583/#589): rol_responsable NULL →
--     dueño; etiquetada → el residente de ese tipo con login activo.
--
-- AUTORIZACIÓN (patrón conta_publicar_asiento / paquete_firmar_recepcion):
-- SECURITY DEFINER con guard interno is_super_admin() OR (empresa del proyecto =
-- get_my_company_id() AND user_has_permission('condominios.tab.cuotas')), RAISE
-- 42501 si no. REVOKE por nombre de PUBLIC y anon; GRANT solo a authenticated.
--
-- Validado contra prod vía BEGIN…ROLLBACK (claims simulados de un company_owner):
-- emite las candidatas reales del período, encola los avisos, y el llamante sin
-- JWT recibe 42501. Apply por el gate humano P0 #9.

-- ── (1) Hardening: cerrar enqueue_recordatorios_cuotas a los roles de API ────
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_cuotas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_cuotas() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_recordatorios_cuotas() FROM authenticated;

-- ── (2) RPC: cerrar el ciclo de cuotas de un proyecto/período ────────────────
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

  -- Aviso in-app al residente responsable (outbox). Identificamos lo recién
  -- emitido por emitida_at = v_now (misma transacción). Sin dedup extra: la
  -- máquina de estados garantiza que cada cuota se emite una sola vez.
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

-- Grants por nombre (lección 20260604210000: default privileges dan EXECUTE a
-- anon/authenticated — hay que revocar explícito y otorgar solo lo deseado).
REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.condominios_cerrar_ciclo(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.condominios_cerrar_ciclo IS
  'Cierra el ciclo de cuotas de un proyecto/período: emite en un solo statement todas las cuotas emitibles (paridad con buildEmitirCuotaPatch: emitida + vencimiento por regla de mora + snapshot de total) y opcionalmente avisa in-app al residente responsable vía el outbox. Staff gated: super admin o empresa del proyecto + permiso condominios.tab.cuotas.';
