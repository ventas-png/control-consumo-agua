-- ============================================================================
-- Consumo comparado del residente vs la comunidad (auditoría 2026-07-16, O5/V6)
-- ============================================================================
-- El portal del residente hoy muestra SOLO su propio consumo. Esta RPC entrega
-- la referencia anónima de su comunidad (proyecto): mediana, cuartiles y
-- promedio del consumo mensual por residente, para que el residente sepa si su
-- consumo está por encima o por debajo del típico de sus vecinos.
--
-- PRIVACIDAD (crítico):
--   · Solo devuelve AGREGADOS (mediana/p25/p75/promedio) — jamás filas de otros
--     residentes ni sus consumos individuales.
--   · Piso de k-anonimato: no expone estadísticas de un mes con < MIN_RESIDENTES
--     residentes (HAVING count(*) >= 5). En comunidades chicas la "mediana"
--     podría acercarse demasiado al consumo de un vecino identificable.
--   · SECURITY DEFINER (registros no expone company_id y su RLS es por rol), pero
--     con AUTORIZACIÓN explícita: el llamador debe ser un residente que pertenece
--     al proyecto pedido (tiene lecturas o una unidad en él). Sin eso, retorna
--     vacío — no revela nada de proyectos ajenos.
--
-- Solo LECTURA/cómputo — no escribe. La proyección del próximo recibo se calcula
-- en el cliente con calcularCostoTarifa() (lib/business.ts), sin SQL.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.agua_consumo_comunidad(
  p_project_id uuid,
  p_meses      int DEFAULT 12
)
RETURNS TABLE (
  mes          date,
  n_residentes int,
  mediana_m3   numeric,
  p25_m3       numeric,
  p75_m3       numeric,
  promedio_m3  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH aut AS (
    -- El llamador (residente) debe pertenecer al proyecto: tener lecturas o una
    -- unidad en él. Si no, no se produce ninguna fila (no revela proyectos ajenos).
    SELECT 1
    WHERE public.get_my_cliente_id() IS NOT NULL
      AND p_project_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.registros r
          WHERE r.cliente_id = public.get_my_cliente_id()
            AND r.project_id = p_project_id
        )
        OR EXISTS (
          SELECT 1 FROM public.unidades u
          WHERE u.cliente_id = public.get_my_cliente_id()
            AND u.project_id = p_project_id
        )
      )
  ),
  por_cliente_mes AS (
    -- Consumo mensual por residente dentro del proyecto (base para la mediana).
    SELECT
      date_trunc('month', r.fecha::date)::date AS mes,
      r.cliente_id,
      SUM(COALESCE(r.consumo, 0)) AS consumo_m3
    FROM public.registros r
    WHERE EXISTS (SELECT 1 FROM aut)
      AND r.project_id = p_project_id
      AND r.cliente_id IS NOT NULL
      AND r.deleted_at IS NULL
      AND r.fecha::date >= (
        date_trunc('month', CURRENT_DATE)::date
        - ((GREATEST(p_meses, 1) - 1) || ' months')::interval
      )
    GROUP BY 1, 2
  )
  SELECT
    pcm.mes,
    COUNT(*)::int AS n_residentes,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY pcm.consumo_m3)::numeric, 2) AS mediana_m3,
    round(percentile_cont(0.25) WITHIN GROUP (ORDER BY pcm.consumo_m3)::numeric, 2) AS p25_m3,
    round(percentile_cont(0.75) WITHIN GROUP (ORDER BY pcm.consumo_m3)::numeric, 2) AS p75_m3,
    round(avg(pcm.consumo_m3)::numeric, 2) AS promedio_m3
  FROM por_cliente_mes pcm
  GROUP BY pcm.mes
  HAVING COUNT(*) >= 5  -- piso de privacidad (k-anonimato); nunca stats de < 5 residentes
  ORDER BY pcm.mes
$$;

COMMENT ON FUNCTION public.agua_consumo_comunidad(uuid, int) IS
  'Referencia anónima de consumo de la comunidad (mediana/cuartiles/promedio mensual por residente) para el portal. SECURITY DEFINER con autorización por pertenencia al proyecto y piso de k-anonimato (>=5 residentes). Solo agregados. Auditoría 2026-07-16, O5/V6.';

REVOKE EXECUTE ON FUNCTION public.agua_consumo_comunidad(uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_consumo_comunidad(uuid, int) TO authenticated;
