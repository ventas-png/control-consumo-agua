-- ════════════════════════════════════════════════════════════════════════════
-- PRESUPUESTO · Control presupuestario y alertas de desviación
-- (pendientes declarados de la Fase 3 del roadmap ERP)
--
--   presupuesto_estado_partida — RPC para el alta de gastos: estado de la
--     partida (presupuestado/ejecutado/disponible) de la cuenta mapeada a la
--     categoría del gasto en el mes de la fecha. La UI ADVIERTE si el gasto
--     nuevo excede la partida (no bloquea: decisión operativa del admin).
--
--   presupuesto_tg_alerta_gasto — trigger sobre gastos_condominio: cuando un
--     gasto queda pagado (contabilizado) y la partida del mes termina
--     EXCEDIDA, encola una notificación in-app a los admin/owner de la
--     empresa vía notifications_outbox. Dedupe por (cuenta, periodo): una
--     alerta por partida excedida, no por cada gasto. NUNCA aborta la
--     operación de negocio (patrón de los triggers conta).
--
-- El "ejecutado" sale de la balanza (asientos publicados), igual que
-- presupuesto_vs_real — no de tablas operativas.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Helper interno: estado de una partida (cuenta, periodo) ──────────────
-- Resuelve el presupuesto APROBADO vigente: primero el del proyecto, si no hay
-- cae al de empresa (project_id NULL). El ejecutado respeta el scope del
-- presupuesto que aplicó (proyecto vs empresa), espejo de presupuesto_vs_real.
CREATE OR REPLACE FUNCTION public.presupuesto_partida_estado(
  p_company_id uuid,
  p_project_id uuid,
  p_cuenta_id  uuid,
  p_periodo    text
)
RETURNS TABLE (
  presupuesto_id uuid,
  presupuestado  numeric(14,2),
  ejecutado      numeric(14,2)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pres public.presupuestos;
BEGIN
  SELECT p.* INTO v_pres
  FROM public.presupuestos p
  WHERE p.company_id = p_company_id
    AND p.estado = 'aprobado'
    AND p.anio = substring(p_periodo, 1, 4)::int
    AND (p.project_id = p_project_id OR p.project_id IS NULL)
  ORDER BY (p.project_id IS NOT NULL) DESC   -- proyecto primero, empresa después
  LIMIT 1;

  IF v_pres.id IS NULL THEN
    RETURN; -- sin presupuesto aprobado para ese año
  END IF;

  RETURN QUERY
  SELECT
    v_pres.id,
    COALESCE((SELECT pp.monto FROM public.presupuesto_partidas pp
              WHERE pp.presupuesto_id = v_pres.id
                AND pp.cuenta_id = p_cuenta_id AND pp.periodo = p_periodo), 0)::numeric(14,2),
    COALESCE((SELECT SUM(CASE WHEN c.naturaleza = 'deudora' THEN l.debe - l.haber
                              ELSE l.haber - l.debe END)
              FROM public.conta_asiento_lineas l
              JOIN public.conta_asientos a ON a.id = l.asiento_id
              JOIN public.conta_cuentas  c ON c.id = l.cuenta_id
              WHERE l.company_id = p_company_id
                AND l.cuenta_id = p_cuenta_id
                AND a.estado = 'publicado'
                AND a.periodo = p_periodo
                AND (v_pres.project_id IS NULL OR a.project_id = v_pres.project_id)), 0)::numeric(14,2);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presupuesto_partida_estado(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 2. RPC para la UI del alta de gastos ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_estado_partida(
  p_project_id uuid,
  p_categoria  text,
  p_fecha      date
)
RETURNS TABLE (
  cuenta_id     uuid,
  cuenta_codigo text,
  cuenta_nombre text,
  periodo       text,
  presupuestado numeric(14,2),
  ejecutado     numeric(14,2),
  disponible    numeric(14,2)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_company uuid;
  v_evento  text;
  v_cuenta  uuid;
  v_periodo text;
  v_estado  record;
BEGIN
  v_company := public.get_my_company_id();
  IF v_company IS NULL THEN
    RETURN; -- sin tenant (p. ej. super_admin fuera de empresa): sin control
  END IF;

  -- Misma resolución categoría → evento que el trigger contable de gastos.
  v_evento := CASE WHEN p_categoria IN ('mantenimiento','servicios','administrativo',
                                        'seguridad','limpieza','obras')
                   THEN 'gasto_' || p_categoria ELSE 'gasto_otros' END;
  v_cuenta := public.conta_cuenta_para(v_company, p_project_id, v_evento);
  IF v_cuenta IS NULL THEN
    RETURN; -- sin mapeo contable: no hay partida que controlar
  END IF;

  v_periodo := to_char(COALESCE(p_fecha, CURRENT_DATE), 'YYYY-MM');

  SELECT * INTO v_estado
  FROM public.presupuesto_partida_estado(v_company, p_project_id, v_cuenta, v_periodo);
  IF v_estado.presupuesto_id IS NULL THEN
    RETURN; -- sin presupuesto aprobado del año
  END IF;

  RETURN QUERY
  SELECT c.id, c.codigo, c.nombre, v_periodo,
         v_estado.presupuestado, v_estado.ejecutado,
         (v_estado.presupuestado - v_estado.ejecutado)::numeric(14,2)
  FROM public.conta_cuentas c WHERE c.id = v_cuenta;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presupuesto_estado_partida(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presupuesto_estado_partida(uuid, text, date) TO authenticated;

-- ── 3. Alerta de desviación al contabilizar un gasto ────────────────────────
CREATE OR REPLACE FUNCTION public.presupuesto_tg_alerta_gasto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_evento  text;
  v_cuenta  uuid;
  v_periodo text;
  v_estado  record;
  v_cta     record;
  v_admin   record;
  v_payload jsonb;
BEGIN
  -- Misma condición de contabilización que conta_tg_gastos.
  IF NOT (NEW.estado = 'pagado'
          AND (TG_OP = 'INSERT' OR OLD.estado <> 'pagado')
          AND COALESCE(NEW.monto, 0) > 0) THEN
    RETURN NEW;
  END IF;

  v_evento := CASE WHEN NEW.categoria IN ('mantenimiento','servicios','administrativo',
                                          'seguridad','limpieza','obras')
                   THEN 'gasto_' || NEW.categoria ELSE 'gasto_otros' END;
  v_cuenta := public.conta_cuenta_para(NEW.company_id, NEW.project_id, v_evento);
  IF v_cuenta IS NULL THEN RETURN NEW; END IF;

  v_periodo := to_char(COALESCE(NEW.fecha, CURRENT_DATE), 'YYYY-MM');

  SELECT * INTO v_estado
  FROM public.presupuesto_partida_estado(NEW.company_id, NEW.project_id, v_cuenta, v_periodo);

  -- Solo alerta si hay partida presupuestada y quedó excedida.
  IF v_estado.presupuesto_id IS NULL
     OR v_estado.presupuestado <= 0
     OR v_estado.ejecutado <= v_estado.presupuestado THEN
    RETURN NEW;
  END IF;

  -- Dedupe: una alerta por (cuenta, periodo) — no por cada gasto del mes.
  IF EXISTS (
    SELECT 1 FROM public.notifications_outbox n
    WHERE n.company_id = NEW.company_id
      AND n.template_key = 'presupuesto_partida_excedida'
      AND n.payload->>'cuenta_id' = v_cuenta::text
      AND n.payload->>'periodo' = v_periodo
  ) THEN
    RETURN NEW;
  END IF;

  SELECT c.codigo, c.nombre INTO v_cta FROM public.conta_cuentas c WHERE c.id = v_cuenta;

  v_payload := jsonb_build_object(
    'cuenta_id', v_cuenta,
    'cuenta', v_cta.codigo || ' ' || v_cta.nombre,
    'periodo', v_periodo,
    'presupuestado', v_estado.presupuestado,
    'ejecutado', v_estado.ejecutado,
    'seccion', 'contabilidad'
  );

  FOR v_admin IN
    SELECT au.id FROM public.app_users au
    WHERE au.company_id = NEW.company_id
      AND au.role IN ('admin', 'company_owner')
      AND COALESCE(au.activo, true)
  LOOP
    INSERT INTO public.notifications_outbox (company_id, channel, template_key, payload, recipient)
    VALUES (NEW.company_id, 'in_app', 'presupuesto_partida_excedida', v_payload, v_admin.id::text);
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- La alerta nunca rompe el alta/edición del gasto.
  RAISE WARNING 'presupuesto_tg_alerta_gasto(%): %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_presupuesto_alerta_gasto ON public.gastos_condominio;
CREATE TRIGGER trg_presupuesto_alerta_gasto
  AFTER INSERT OR UPDATE ON public.gastos_condominio
  FOR EACH ROW EXECUTE FUNCTION public.presupuesto_tg_alerta_gasto();

-- ── 4. Plantilla in-app (global, company_id NULL) ───────────────────────────
INSERT INTO public.notification_templates (company_id, key, channel, subject, body, locale, is_active)
VALUES
  (NULL, 'presupuesto_partida_excedida', 'in_app', 'Partida presupuestaria excedida',
   'La partida {{cuenta}} del periodo {{periodo}} quedó excedida: presupuestado {{presupuestado}}, ejecutado {{ejecutado}}. Revisa el comparativo en Contabilidad → Presupuesto.',
   'es', true)
ON CONFLICT DO NOTHING;

COMMENT ON FUNCTION public.presupuesto_estado_partida(uuid, text, date) IS
  'Control presupuestario en el alta de gastos: estado (presupuestado/ejecutado/disponible) de la partida de la cuenta mapeada a la categoría, en el mes de la fecha. Vacío si no hay mapeo o presupuesto aprobado.';
