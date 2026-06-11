-- ════════════════════════════════════════════════════════════════════════════
-- BANCOS · Matching difuso en sugerencias de conciliación
-- (pendiente declarado de la Fase 4 del roadmap ERP)
--
-- banco_sugerencias_conciliacion v2: además del match exacto (mismo monto,
-- ±3 días) sugiere candidatos APROXIMADOS, marcados con la columna nueva
-- `confianza` para que la UI los distinga:
--   · 'exacta'      — mismo monto, ±3 días (comportamiento original)
--   · 'aproximada'  — mismo monto a 4–7 días (depósitos que tardan en
--                     acreditarse), o monto con diferencia ≤ max(1.00, 0.5%)
--                     a ±3 días (comisiones descontadas en el abono)
--
-- banco_conciliar_movimiento no exige igualdad de monto, así que las
-- sugerencias aproximadas son conciliables tal cual; la diferencia de
-- comisión se registra después con banco_ajuste_conciliacion si se desea
-- cuadrar el saldo exacto.
--
-- El matching de depósitos AGRUPADOS (un abono = suma de varios pagos) queda
-- diferido: requiere relación movimiento↔documentos M:N (hoy match_id es
-- 1:1) y se hará cuando la operación lo pida.
--
-- Nota: cambiar las columnas de retorno exige DROP + CREATE (no basta
-- CREATE OR REPLACE).
-- ════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.banco_sugerencias_conciliacion(uuid);

CREATE FUNCTION public.banco_sugerencias_conciliacion(p_cuenta_bancaria_id uuid)
RETURNS TABLE (
  movimiento_id         uuid,
  candidato_tipo        text,
  candidato_id          uuid,
  candidato_fecha       date,
  candidato_monto       numeric,
  candidato_descripcion text,
  confianza             text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH mov AS (
    SELECT m.* FROM public.banco_movimientos m
    WHERE m.cuenta_bancaria_id = p_cuenta_bancaria_id AND m.estado = 'pendiente'
  )
  -- Ingresos ↔ pagos de clientes
  SELECT
    mov.id, 'pago', p.id,
    COALESCE(p.verified_at::date, p.created_at::date),
    p.monto,
    'Pago ' || p.metodo || COALESCE(' ref. ' || NULLIF(p.referencia, ''), ''),
    CASE WHEN p.monto = mov.monto
              AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3
         THEN 'exacta' ELSE 'aproximada' END
  FROM mov
  JOIN public.pagos p
    ON p.estado IN ('verificado','aplicado')
   AND p.deleted_at IS NULL
   AND (
         -- mismo monto hasta ±7 días
         (p.monto = mov.monto
          AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 7)
         -- monto cercano (comisión) a ±3 días
      OR (p.monto <> mov.monto
          AND abs(p.monto - mov.monto) <= GREATEST(1.00, abs(mov.monto) * 0.005)
          AND abs(COALESCE(p.verified_at::date, p.created_at::date) - mov.fecha) <= 3)
       )
  JOIN public.projects pr ON pr.id = p.project_id AND pr.company_id = mov.company_id
  WHERE mov.monto > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'pago' AND x.match_id = p.id AND x.estado = 'conciliado'
    )
  UNION ALL
  -- Egresos ↔ órdenes de pago a proveedores
  SELECT
    mov.id, 'orden_pago', o.id,
    o.fecha_pago,
    -o.monto,
    'Pago a proveedor' || COALESCE(' ref. ' || NULLIF(o.referencia, ''), ''),
    CASE WHEN o.monto = -mov.monto AND abs(o.fecha_pago - mov.fecha) <= 3
         THEN 'exacta' ELSE 'aproximada' END
  FROM mov
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
  WHERE mov.monto < 0
    AND NOT EXISTS (
      SELECT 1 FROM public.banco_movimientos x
      WHERE x.match_tipo = 'orden_pago' AND x.match_id = o.id AND x.estado = 'conciliado'
    )
  -- Exactas primero dentro de cada movimiento ('exacta' > 'aproximada').
  ORDER BY 1, 7 DESC, 4
$$;

REVOKE EXECUTE ON FUNCTION public.banco_sugerencias_conciliacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.banco_sugerencias_conciliacion(uuid) TO authenticated;

COMMENT ON FUNCTION public.banco_sugerencias_conciliacion(uuid) IS
  'Sugerencias de conciliación con confianza: exacta (mismo monto ±3d) o aproximada (mismo monto 4-7d, o diferencia ≤ max(1.00, 0.5%) ±3d, p. ej. comisiones).';
