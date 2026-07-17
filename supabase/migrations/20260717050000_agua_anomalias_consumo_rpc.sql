-- ============================================================================
-- Detección de anomalías de consumo de agua (auditoría 2026-07-16, O1)
-- ============================================================================
-- El diferenciador "IoT-lite sin hardware": con la historia de lecturas que YA
-- está en la BD, detecta retrospectivamente dos patrones por medidor:
--   · FUGA PROBABLE   — el último consumo se dispara respecto al histórico del
--                       propio medidor (z-score > 3 y un piso absoluto para no
--                       marcar ruido en consumos chicos).
--   · MEDIDOR PARADO  — N lecturas consecutivas en cero (medidor trabado/bypass).
-- Complementa validarLectura() (que valida EN captura); esto es el análisis
-- retrospectivo sobre todo el histórico.
--
-- SECURITY DEFINER con scope explícito por tenant (projects.company_id =
-- get_my_company_id()): registros no expone company_id y su RLS es por rol, así
-- que el definer con scope garantiza el aislamiento sin depender de esa RLS.
-- Solo LECTURA/cómputo — no escribe ni encola avisos (el aviso por outbox +
-- cron queda como follow-up).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.agua_anomalias_consumo(p_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  contador_id        uuid,
  cliente_id         uuid,
  cliente_nombre     text,
  project_id         uuid,
  ultima_fecha       timestamptz,
  ultimo_consumo     numeric,
  promedio           numeric,
  desviacion         numeric,
  z_score            numeric,
  ceros_consecutivos int,
  n_lecturas         int,
  tipo_anomalia      text,
  severidad          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH r AS (
    SELECT
      reg.contador_id,
      reg.cliente_id,
      reg.cliente_nombre,
      reg.project_id,
      reg.fecha,
      COALESCE(reg.consumo, 0) AS consumo,
      row_number() OVER (PARTITION BY reg.contador_id ORDER BY reg.fecha DESC) AS rn_desc
    FROM public.registros reg
    JOIN public.projects p ON p.id = reg.project_id
    WHERE reg.deleted_at IS NULL
      AND reg.contador_id IS NOT NULL
      AND p.company_id = public.get_my_company_id()
      AND (p_project_id IS NULL OR reg.project_id = p_project_id)
  ),
  stats AS (
    SELECT
      contador_id,
      -- Media/desv del histórico EXCLUYENDO la última lectura (rn_desc > 1).
      avg(consumo) FILTER (WHERE rn_desc > 1)         AS media,
      stddev_pop(consumo) FILTER (WHERE rn_desc > 1)  AS desv,
      count(*)::int                                   AS n_lecturas,
      -- Ceros consecutivos desde la lectura más reciente.
      (COALESCE(min(rn_desc) FILTER (WHERE consumo <> 0), max(rn_desc) + 1) - 1)::int AS ceros_consecutivos
    FROM r
    GROUP BY contador_id
  ),
  ult AS (
    SELECT contador_id, cliente_id, cliente_nombre, project_id, fecha, consumo
    FROM r WHERE rn_desc = 1
  ),
  eval AS (
    SELECT
      u.contador_id, u.cliente_id, u.cliente_nombre, u.project_id,
      u.fecha AS ultima_fecha, u.consumo AS ultimo_consumo,
      s.media, s.desv, s.n_lecturas, s.ceros_consecutivos,
      CASE WHEN s.desv IS NOT NULL AND s.desv > 0
           THEN (u.consumo - s.media) / s.desv
           ELSE NULL END AS z_score
    FROM ult u
    JOIN stats s ON s.contador_id = u.contador_id
    WHERE s.n_lecturas >= 3  -- se necesita algo de historia para tener señal
  )
  SELECT
    e.contador_id, e.cliente_id, e.cliente_nombre, e.project_id,
    e.ultima_fecha,
    e.ultimo_consumo::numeric(14,2),
    round(e.media, 2),
    round(e.desv, 2),
    round(e.z_score, 2),
    e.ceros_consecutivos,
    e.n_lecturas,
    tipo,
    CASE
      WHEN tipo = 'medidor_parado' AND e.ceros_consecutivos >= 3 THEN 'alta'
      WHEN tipo = 'fuga_probable'  AND e.z_score >= 5           THEN 'alta'
      ELSE 'media'
    END AS severidad
  FROM eval e
  CROSS JOIN LATERAL (
    SELECT CASE
      -- Medidor parado: 2+ lecturas consecutivas en cero.
      WHEN e.ceros_consecutivos >= 2 THEN 'medidor_parado'
      -- Fuga probable: pico atípico (z>3) con piso absoluto para evitar ruido.
      WHEN e.z_score >= 3 AND e.ultimo_consumo >= 5 AND e.ultimo_consumo >= e.media * 1.5 THEN 'fuga_probable'
      ELSE NULL
    END AS tipo
  ) t
  WHERE tipo IS NOT NULL
  ORDER BY (tipo = 'fuga_probable') DESC, e.z_score DESC NULLS LAST, e.ceros_consecutivos DESC
$$;

COMMENT ON FUNCTION public.agua_anomalias_consumo(uuid) IS
  'Anomalías retrospectivas de consumo de agua por medidor (fuga_probable por z-score>3 con piso absoluto; medidor_parado por 2+ ceros consecutivos). SECURITY DEFINER con scope por tenant. Auditoría 2026-07-16, O1.';

REVOKE EXECUTE ON FUNCTION public.agua_anomalias_consumo(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_anomalias_consumo(uuid) TO authenticated;
