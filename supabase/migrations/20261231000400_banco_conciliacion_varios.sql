-- ════════════════════════════════════════════════════════════════════════════
-- BANCOS · CONCILIAR UN MOVIMIENTO CONTRA VARIOS DOCUMENTOS, ELEGIR EL
-- DOCUMENTO A MANO Y SALDO INICIAL DEL BANCO
--
-- POR QUÉ
-- La conciliación sólo sabía emparejar UN movimiento del extracto con UN
-- documento, y sólo de entre los que el sistema sugería. En un residencial eso
-- deja fuera lo de todos los días:
--   · el depósito del día que junta las cuotas de varias casas (un movimiento,
--     muchos cobros) — y, al revés, la transferencia que paga varias órdenes;
--   · el cobro que el sistema no sugiere (fecha lejana, referencia distinta);
--   · el banco que ya tenía saldo antes del primer extracto importado: el
--     «saldo según banco» arrancaba en cero y nunca cuadraba con libros.
--
-- QUÉ HACE
-- 1. cuentas_bancarias.saldo_inicial / saldo_inicial_fecha: el saldo del banco
--    a una fecha. banco_estado_conciliacion lo suma y, de ahí en adelante, sólo
--    cuenta los movimientos POSTERIORES a esa fecha (los anteriores ya están
--    dentro del saldo inicial).
-- 2. banco_conciliacion_partidas: los documentos de un movimiento conciliado
--    contra varios. Un documento está en una sola conciliación (índice único).
-- 3. banco_conciliar_varios(movimiento, documentos): un depósito contra varios
--    cobros o un retiro contra varias órdenes de pago; la suma debe ser el
--    importe del movimiento. Sirve también para elegir UN documento a mano.
-- 4. banco_candidatos_conciliacion(movimiento, buscar): los documentos sin
--    conciliar de esa contabilidad entre los que se puede elegir.
-- 5. banco_sugerencias_conciliacion deja de sugerir lo ya conciliado en grupo;
--    desconciliar el movimiento libera todos sus documentos (trigger); y la
--    conciliación uno-a-uno de siempre rechaza un documento ya usado en grupo.
--
-- CÓMO REVERTIR
--   Restaurar banco_sugerencias_conciliacion y banco_estado_conciliacion desde
--   20260813000000 / 20260612010200;
--   DROP FUNCTION public.banco_conciliar_varios(uuid, jsonb);
--   DROP FUNCTION public.banco_candidatos_conciliacion(uuid, text);
--   DROP TRIGGER trg_banco_partidas ON public.banco_movimientos;
--   DROP FUNCTION public.banco_tg_partidas();
--   DROP TABLE public.banco_conciliacion_partidas;
--   ALTER TABLE public.cuentas_bancarias DROP COLUMN saldo_inicial, DROP COLUMN saldo_inicial_fecha;
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Saldo inicial del banco ──────────────────────────────────────────────
ALTER TABLE public.cuentas_bancarias
  ADD COLUMN IF NOT EXISTS saldo_inicial numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saldo_inicial_fecha date;

COMMENT ON COLUMN public.cuentas_bancarias.saldo_inicial IS
  'Saldo según el banco a saldo_inicial_fecha, en la moneda de la cuenta. Punto de partida de la conciliación.';
COMMENT ON COLUMN public.cuentas_bancarias.saldo_inicial_fecha IS
  'Fecha del saldo inicial. Los movimientos del extracto con esa fecha o anterior ya están dentro de él y no se vuelven a sumar.';

-- Mismas columnas de salida de siempre: sólo cambia cómo se arma saldo_banco.
CREATE OR REPLACE FUNCTION public.banco_estado_conciliacion(p_cuenta_bancaria_id uuid, p_periodo text)
 RETURNS TABLE(saldo_libro numeric, saldo_libro_origen numeric, saldo_banco numeric, pendientes bigint, monto_pendiente numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cta AS (
    SELECT cb.*, COALESCE(cc.moneda IS NOT NULL, false) AS es_fx
    FROM public.cuentas_bancarias cb
    JOIN public.conta_cuentas cc ON cc.id = cb.cuenta_contable_id
    WHERE cb.id = p_cuenta_bancaria_id
  ),
  libro AS (
    SELECT
      COALESCE(SUM(l.debe - l.haber), 0)::numeric(14,2) AS saldo,
      COALESCE(SUM(CASE WHEN l.debe > 0 THEN COALESCE(l.monto_origen, l.debe)
                        ELSE -COALESCE(l.monto_origen, l.haber) END), 0)::numeric(14,2) AS saldo_origen
    FROM public.conta_asiento_lineas l
    JOIN public.conta_asientos a ON a.id = l.asiento_id
    JOIN cta ON l.cuenta_id = cta.cuenta_contable_id
    WHERE a.estado = 'publicado' AND a.periodo <= p_periodo
  ),
  banco AS (
    SELECT
      COALESCE(SUM(m.monto) FILTER (WHERE m.estado <> 'descartado'), 0)::numeric(14,2) AS saldo,
      COUNT(*) FILTER (WHERE m.estado = 'pendiente') AS pendientes,
      COALESCE(SUM(m.monto) FILTER (WHERE m.estado = 'pendiente'), 0)::numeric(14,2) AS monto_pendiente
    FROM public.banco_movimientos m
    WHERE m.cuenta_bancaria_id = p_cuenta_bancaria_id
      AND to_char(m.fecha, 'YYYY-MM') <= p_periodo
      -- Lo de la fecha del saldo inicial o anterior ya está dentro de él.
      AND ((SELECT saldo_inicial_fecha FROM cta) IS NULL OR m.fecha > (SELECT saldo_inicial_fecha FROM cta))
  )
  SELECT
    libro.saldo,
    CASE WHEN (SELECT es_fx FROM cta) THEN libro.saldo_origen END,
    (banco.saldo + COALESCE((
       SELECT c.saldo_inicial FROM cta c
        WHERE c.saldo_inicial_fecha IS NULL OR to_char(c.saldo_inicial_fecha, 'YYYY-MM') <= p_periodo), 0))::numeric(14,2),
    banco.pendientes,
    banco.monto_pendiente
  FROM libro, banco
$function$;

-- ── 2. Los documentos de una conciliación en grupo ──────────────────────────
CREATE TABLE IF NOT EXISTS public.banco_conciliacion_partidas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  movimiento_id uuid NOT NULL REFERENCES public.banco_movimientos(id) ON DELETE CASCADE,
  match_tipo    text NOT NULL CHECK (match_tipo IN ('pago', 'orden_pago')),
  match_id      uuid NOT NULL,
  monto         numeric(14,2) NOT NULL CHECK (monto > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_banco_partida_documento ON public.banco_conciliacion_partidas (match_tipo, match_id);
CREATE INDEX IF NOT EXISTS idx_banco_partida_movimiento ON public.banco_conciliacion_partidas (movimiento_id);
CREATE INDEX IF NOT EXISTS idx_banco_partida_company ON public.banco_conciliacion_partidas (company_id);
CREATE INDEX IF NOT EXISTS idx_banco_partida_project ON public.banco_conciliacion_partidas (project_id);

ALTER TABLE public.banco_conciliacion_partidas ENABLE ROW LEVEL SECURITY;

-- Se lee como los movimientos del banco; se escribe sólo desde banco_conciliar_varios.
DROP POLICY IF EXISTS "banco_conciliacion_partidas_select" ON public.banco_conciliacion_partidas;
CREATE POLICY "banco_conciliacion_partidas_select" ON public.banco_conciliacion_partidas
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()) OR company_id = (SELECT public.get_my_company_id()));
DROP POLICY IF EXISTS mfa_gate_aal2 ON public.banco_conciliacion_partidas;
CREATE POLICY mfa_gate_aal2 ON public.banco_conciliacion_partidas
  AS RESTRICTIVE TO authenticated
  USING (public.mfa_requirement_met())
  WITH CHECK (public.mfa_requirement_met());

REVOKE ALL ON public.banco_conciliacion_partidas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.banco_conciliacion_partidas TO authenticated;
GRANT SELECT ON public.banco_conciliacion_partidas TO service_role;

-- Coherencia entre la conciliación uno-a-uno y la de grupo:
--   · al dejar de estar conciliado, el movimiento suelta sus partidas;
--   · un documento que ya está en el grupo de OTRO movimiento no se concilia de nuevo.
CREATE OR REPLACE FUNCTION public.banco_tg_partidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.estado = 'conciliado' AND NEW.estado <> 'conciliado' THEN
    DELETE FROM public.banco_conciliacion_partidas p WHERE p.movimiento_id = NEW.id;
  END IF;
  IF NEW.estado = 'conciliado' AND NEW.match_tipo IN ('pago', 'orden_pago')
     AND (OLD.estado <> 'conciliado' OR NEW.match_id IS DISTINCT FROM OLD.match_id)
     AND EXISTS (SELECT 1 FROM public.banco_conciliacion_partidas p
                  WHERE p.match_tipo = NEW.match_tipo AND p.match_id = NEW.match_id AND p.movimiento_id <> NEW.id) THEN
    RAISE EXCEPTION 'Ese documento ya está conciliado dentro de otro movimiento del banco.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.banco_tg_partidas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_banco_partidas ON public.banco_movimientos;
CREATE TRIGGER trg_banco_partidas
  BEFORE UPDATE ON public.banco_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.banco_tg_partidas();

-- ── 3. Conciliar un movimiento contra varios documentos ─────────────────────
CREATE OR REPLACE FUNCTION public.banco_conciliar_varios(p_movimiento_id uuid, p_documentos jsonb)
RETURNS public.banco_movimientos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mov    public.banco_movimientos;
  v_cta    public.cuentas_bancarias;
  v_tipo   text;
  v_ids    uuid[];
  v_n      int;
  v_suma   numeric(14,2);
  v_primer uuid;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos m WHERE m.id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movimiento no encontrado.' USING ERRCODE = 'no_data_found';
  END IF;
  IF public.sesion_api_sin_empresa() OR NOT public.mfa_requirement_met() OR NOT (
    public.is_super_admin()
    OR (v_mov.company_id = public.get_my_company_id()
        AND (public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
             OR public.user_has_permission('platform.contabilidad.change_status')))
  ) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_mov.project_id IS NOT NULL AND NOT public.can_access_project(v_mov.project_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_mov.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'Solo un movimiento pendiente puede conciliarse (estado: %).', v_mov.estado
      USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    SELECT array_agg(DISTINCT (d ->> 'id')::uuid) INTO v_ids
      FROM jsonb_array_elements(COALESCE(p_documentos, '[]'::jsonb)) d;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'La lista de documentos no se puede leer.' USING ERRCODE = '22023';
  END;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Elige al menos un documento.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_ids) > 500 THEN
    RAISE EXCEPTION 'Demasiados documentos para un solo movimiento (máximo 500).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cta FROM public.cuentas_bancarias c WHERE c.id = v_mov.cuenta_bancaria_id;
  -- Un depósito se concilia contra cobros; un retiro, contra pagos a proveedores.
  v_tipo := CASE WHEN v_mov.monto > 0 THEN 'pago' ELSE 'orden_pago' END;

  -- Todos existen, son de la empresa y de la MISMA contabilidad que la cuenta, y están en firme.
  IF v_tipo = 'pago' THEN
    SELECT count(*), COALESCE(sum(p.monto), 0) INTO v_n, v_suma
      FROM public.pagos p
      JOIN public.projects pr ON pr.id = p.project_id
     WHERE p.id = ANY (v_ids) AND p.deleted_at IS NULL AND p.estado IN ('verificado', 'aplicado')
       AND pr.company_id = v_mov.company_id AND p.project_id IS NOT DISTINCT FROM v_cta.project_id;
  ELSE
    SELECT count(*), COALESCE(sum(o.monto), 0) INTO v_n, v_suma
      FROM public.ordenes_pago o
     WHERE o.id = ANY (v_ids) AND o.estado = 'pagada'
       AND o.company_id = v_mov.company_id AND o.project_id IS NOT DISTINCT FROM v_cta.project_id;
  END IF;
  IF v_n <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Alguno de los documentos no existe, no está en firme o pertenece a otra contabilidad que la cuenta bancaria.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.banco_movimientos x
              WHERE x.estado = 'conciliado' AND x.match_tipo = v_tipo AND x.match_id = ANY (v_ids))
     OR EXISTS (SELECT 1 FROM public.banco_conciliacion_partidas x
                 WHERE x.match_tipo = v_tipo AND x.match_id = ANY (v_ids)) THEN
    RAISE EXCEPTION 'Alguno de los documentos ya está conciliado con otro movimiento del banco.' USING ERRCODE = 'unique_violation';
  END IF;

  IF abs(v_suma - abs(v_mov.monto)) > 0.01 THEN
    RAISE EXCEPTION 'Los documentos suman % y el movimiento es de %: faltan o sobran %.',
      v_suma, abs(v_mov.monto), abs(v_suma - abs(v_mov.monto)) USING ERRCODE = 'check_violation';
  END IF;

  v_primer := v_ids[1];
  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.banco_movimientos m
     SET estado = 'conciliado', match_tipo = v_tipo, match_id = v_primer,
         conciliado_por = auth.uid(), conciliado_at = now()
   WHERE m.id = p_movimiento_id
  RETURNING * INTO v_mov;
  PERFORM set_config('conta.allow_system_write', 'off', true);

  IF v_tipo = 'pago' THEN
    INSERT INTO public.banco_conciliacion_partidas (company_id, project_id, movimiento_id, match_tipo, match_id, monto)
    SELECT v_mov.company_id, v_cta.project_id, v_mov.id, 'pago', p.id, p.monto
      FROM public.pagos p WHERE p.id = ANY (v_ids);
  ELSE
    INSERT INTO public.banco_conciliacion_partidas (company_id, project_id, movimiento_id, match_tipo, match_id, monto)
    SELECT v_mov.company_id, v_cta.project_id, v_mov.id, 'orden_pago', o.id, o.monto
      FROM public.ordenes_pago o WHERE o.id = ANY (v_ids);
  END IF;

  RETURN v_mov;
END;
$$;

REVOKE ALL ON FUNCTION public.banco_conciliar_varios(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_conciliar_varios(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.banco_conciliar_varios(uuid, jsonb) IS
  'Concilia un movimiento del banco contra uno o varios documentos (cobros si es depósito, órdenes de pago si es retiro) cuya suma es el importe del movimiento.';

-- ── 4. Entre qué documentos se puede elegir ─────────────────────────────────
-- SECURITY INVOKER: lo que cada quien puede ver de cobros y órdenes lo decide su RLS.
CREATE OR REPLACE FUNCTION public.banco_candidatos_conciliacion(p_movimiento_id uuid, p_buscar text DEFAULT NULL)
RETURNS TABLE (candidato_tipo text, candidato_id uuid, fecha date, monto numeric, descripcion text, referencia text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH mov AS (
    SELECT m.*, cb.project_id AS ledger
      FROM public.banco_movimientos m
      JOIN public.cuentas_bancarias cb ON cb.id = m.cuenta_bancaria_id
     WHERE m.id = p_movimiento_id
  ),
  q AS (SELECT NULLIF(btrim(p_buscar), '') AS txt)
  SELECT * FROM (
    SELECT 'pago'::text, p.id, COALESCE(p.verified_at, p.created_at)::date AS f, p.monto::numeric,
           concat_ws(' · ', cl.nombre, 'Pago ' || p.metodo) AS d, NULLIF(p.referencia, '') AS r
      FROM mov
      JOIN public.pagos p ON p.project_id IS NOT DISTINCT FROM mov.ledger
       AND p.deleted_at IS NULL AND p.estado IN ('verificado', 'aplicado')
      JOIN public.projects pr ON pr.id = p.project_id AND pr.company_id = mov.company_id
      LEFT JOIN public.clientes cl ON cl.id = p.cliente_id
     WHERE mov.monto > 0
       AND abs(COALESCE(p.verified_at, p.created_at)::date - mov.fecha) <= 90
       AND NOT EXISTS (SELECT 1 FROM public.banco_movimientos x
                        WHERE x.estado = 'conciliado' AND x.match_tipo = 'pago' AND x.match_id = p.id)
       AND NOT EXISTS (SELECT 1 FROM public.banco_conciliacion_partidas x
                        WHERE x.match_tipo = 'pago' AND x.match_id = p.id)
    UNION ALL
    SELECT 'orden_pago'::text, o.id, o.fecha_pago, o.monto::numeric,
           concat_ws(' · ', pv.nombre, 'Pago a proveedor'), NULLIF(o.referencia, '')
      FROM mov
      JOIN public.ordenes_pago o ON o.company_id = mov.company_id
       AND o.project_id IS NOT DISTINCT FROM mov.ledger AND o.estado = 'pagada' AND o.fecha_pago IS NOT NULL
      LEFT JOIN public.proveedores pv ON pv.id = o.proveedor_id
     WHERE mov.monto < 0
       AND abs(o.fecha_pago - mov.fecha) <= 90
       AND NOT EXISTS (SELECT 1 FROM public.banco_movimientos x
                        WHERE x.estado = 'conciliado' AND x.match_tipo = 'orden_pago' AND x.match_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM public.banco_conciliacion_partidas x
                        WHERE x.match_tipo = 'orden_pago' AND x.match_id = o.id)
  ) c(candidato_tipo, candidato_id, fecha, monto, descripcion, referencia)
  WHERE (SELECT txt FROM q) IS NULL
     OR c.descripcion ILIKE '%' || (SELECT txt FROM q) || '%'
     OR c.referencia ILIKE '%' || (SELECT txt FROM q) || '%'
     OR c.monto::text LIKE (SELECT txt FROM q) || '%'
  ORDER BY abs(c.fecha - (SELECT fecha FROM mov)), c.fecha, c.candidato_id
  LIMIT 300
$$;

REVOKE ALL ON FUNCTION public.banco_candidatos_conciliacion(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_candidatos_conciliacion(uuid, text) TO authenticated;

-- ── 5. Las sugerencias dejan de proponer lo ya conciliado en grupo ──────────
-- Mismo cuerpo de siempre más las dos exclusiones contra banco_conciliacion_partidas.
CREATE OR REPLACE FUNCTION public.banco_sugerencias_conciliacion(p_cuenta_bancaria_id uuid)
 RETURNS TABLE(movimiento_id uuid, candidato_tipo text, candidato_id uuid, candidato_fecha date, candidato_monto numeric, candidato_descripcion text, confianza text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cta AS (
    SELECT cb.* FROM public.cuentas_bancarias cb WHERE cb.id = p_cuenta_bancaria_id
  ),
  mov AS (
    SELECT m.* FROM public.banco_movimientos m
    WHERE m.cuenta_bancaria_id = p_cuenta_bancaria_id AND m.estado = 'pendiente'
  )
  SELECT
    mov.id, 'pago', p.id,
    COALESCE(p.verified_at::date, p.created_at::date),
    p.monto,
    'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), ''),
    CASE WHEN p.monto = mov.monto
              AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3
         THEN 'exacta' ELSE 'aproximada' END
  FROM mov
  CROSS JOIN cta
  JOIN public.pagos p
    ON p.estado IN ('verificado','aplicado')
   AND p.deleted_at IS NULL
   AND (
         (p.monto = mov.monto
          AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 7)
      OR (p.monto <> mov.monto
          AND abs(p.monto - mov.monto) <= GREATEST(1.00, abs(mov.monto) * 0.005)
          AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3)
       )
   AND p.project_id IS NOT DISTINCT FROM cta.project_id
  JOIN public.projects pr ON pr.id = p.project_id AND pr.company_id = mov.company_id
  WHERE mov.monto > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'pago' AND x.match_id = p.id AND x.estado = 'conciliado'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_conciliacion_partidas x
      WHERE x.match_tipo = 'pago' AND x.match_id = p.id
    )
  UNION ALL
  SELECT
    mov.id, 'orden_pago', o.id,
    o.fecha_pago,
    -o.monto,
    'Pago a proveedor' || COALESCE(' ref. ' || NULLIF(o.referencia, ''), ''),
    CASE WHEN o.monto = -mov.monto AND abs(o.fecha_pago - mov.fecha) <= 3
         THEN 'exacta' ELSE 'aproximada' END
  FROM mov
  CROSS JOIN cta
  JOIN public.ordenes_pago o
    ON o.estado = 'pagada'
   AND o.company_id = mov.company_id
   AND o.fecha_pago IS NOT NULL
   AND (
         (o.monto = -mov.monto AND abs(o.fecha_pago - mov.fecha) <= 7)
      OR (o.monto <> -mov.monto
          AND abs(o.monto - (-mov.monto)) <= GREATEST(1.00, abs(mov.monto) * 0.005)
          AND abs(o.fecha_pago - mov.fecha) <= 3)
       )
   AND o.project_id IS NOT DISTINCT FROM cta.project_id
  WHERE mov.monto < 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'orden_pago' AND x.match_id = o.id AND x.estado = 'conciliado'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_conciliacion_partidas x
      WHERE x.match_tipo = 'orden_pago' AND x.match_id = o.id
    )
  ORDER BY 1, 7 DESC, 4
$function$;
