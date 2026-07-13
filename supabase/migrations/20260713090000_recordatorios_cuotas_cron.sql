-- Recordatorios automáticos de cobranza role-aware (P1 · condominios).
--
-- Un cron diario encola un recordatorio in-app al RESIDENTE RESPONSABLE de cada
-- cuota impaga (próxima a vencer o vencida), usando el outbox multi-canal existente
-- (notifications_outbox → notifications-dispatcher). Canal 'in_app': la campana del
-- portal, SIEMPRE entregable y SIN credenciales/servicios externos → seguro de
-- activar (email/WhatsApp quedan como follow-up cuando el operador configure canal).
--
-- ROLE-AWARE: el destinatario es quien responde por la cuota (mismo dominio que la
-- RLS de cuotas diferenciadas): rol_responsable NULL → el dueño (unidades.cliente_id);
-- 'propietario' → dueño + residentes propietarios; 'arrendatario'/'familiar'/'otro' →
-- los residentes de unidad_residentes con ese tipo. Solo se notifica a residentes con
-- login de portal activo (app_users.activo).
--
-- IDEMPOTENTE: cuota_recordatorios_log con UNIQUE(cuota_id, user_id, hito) → cada
-- cuota genera a lo sumo un recordatorio 'proximo' y uno 'vencida' por residente. El
-- INSERT ... ON CONFLICT DO NOTHING RETURNING solo encola los recordatorios nuevos.
--
-- Validado contra prod (BEGIN…ROLLBACK): la resolución de destinatarios devuelve los
-- 4 recordatorios esperados hoy (4 cuotas vencidas, todas sin diferenciar → al dueño;
-- 0 cuotas etiquetadas aún), sin flood. El apply a prod pasa por el gate P0 #9.

-- ── Log de recordatorios enviados (idempotencia + auditoría) ────────────────
CREATE TABLE IF NOT EXISTS public.cuota_recordatorios_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuota_id   uuid NOT NULL REFERENCES public.cuotas_condominio(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,          -- destinatario (app_users.id)
  hito       text NOT NULL CHECK (hito IN ('proximo','vencida')),
  company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cuota_recordatorio_unico UNIQUE (cuota_id, user_id, hito)
);
CREATE INDEX IF NOT EXISTS idx_cuota_recordatorios_cuota ON public.cuota_recordatorios_log(cuota_id);

ALTER TABLE public.cuota_recordatorios_log ENABLE ROW LEVEL SECURITY;

-- Solo lectura para staff del tenant (auditoría); escribe el cron (service_role,
-- bypassa RLS). Mismo patrón que notifications_outbox.
DROP POLICY IF EXISTS "cuota_recordatorios_log_select" ON public.cuota_recordatorios_log;
CREATE POLICY "cuota_recordatorios_log_select" ON public.cuota_recordatorios_log
  FOR SELECT TO authenticated
  USING (
    is_super_admin()
    OR (company_id = get_my_company_id() AND user_has_permission('condominios.tab.cuotas'))
  );

-- ── Función: encola recordatorios de las cuotas impagas ─────────────────────
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
    -- Cuotas impagas con vencimiento: vencidas o por vencer dentro de 3 días.
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
    -- Dueño legacy como 'propietario' + residentes explícitos con su tipo.
    SELECT ca.cuota_id, u.cliente_id AS cliente_id, 'propietario'::text AS rol
    FROM candidatas ca JOIN public.unidades u ON u.id = ca.unidad_id
    WHERE u.cliente_id IS NOT NULL
    UNION
    SELECT ca.cuota_id, ur.cliente_id, ur.tipo
    FROM candidatas ca JOIN public.unidad_residentes ur ON ur.unidad_id = ca.unidad_id
    WHERE ur.activo = true
  ),
  responsables AS (
    -- Destinatarios: residente responsable (por rol) con login de portal activo.
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
      'ruta_id', r.cuota_id,
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

REVOKE EXECUTE ON FUNCTION public.enqueue_recordatorios_cuotas() FROM PUBLIC;

COMMENT ON FUNCTION public.enqueue_recordatorios_cuotas IS
  'Encola recordatorios in-app (outbox) a los residentes responsables de las cuotas impagas (próximas o vencidas). Role-aware + idempotente (cuota_recordatorios_log). Devuelve cuántos encoló.';

-- ── pg_cron: diario 13:30 UTC (07:30 GT) ────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'recordatorios_cuotas_daily';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'recordatorios_cuotas_daily',
  '30 13 * * *',
  $$SELECT public.enqueue_recordatorios_cuotas();$$
);
