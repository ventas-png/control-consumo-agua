-- ============================================================================
-- Carga masiva del historial: «¿tiene lecturas?» por índice, no por barrido
-- ============================================================================
-- POR QUÉ. Tras 20261205000000 la importación ya no caía en el primer lote,
-- pero seguía tardando ~4 s por lote y alguno superaba los 8 s del
-- `statement_timeout` de `authenticated`: en producción entraron 7 lotes de 500
-- filas y el octavo falló con «canceling statement due to statement timeout».
--
-- Medido en producción, como la dueña de la empresa, con un lote de 500 filas
-- (importación de prueba dentro de una transacción revertida):
--     validar el lote ............   88 ms
--     escribir las 500 filas .....  368 ms
--     decidir la lectura inicial . 3545 ms   ← aquí
-- El paso de la lectura inicial preguntaba `EXISTS (… FROM registros …)` por
-- cada contador del lote. El planificador lo resolvía recorriendo `registros`
-- ENTERA, y su RLS (`mfa_requirement_met()`, `is_super_admin()`… por fila)
-- cuesta ~0,5 ms por fila: ~3,5 s por 6 800 lecturas, crezca o no el lote.
--
-- QUÉ CAMBIA. Sólo cómo se pregunta: un LATERAL con LIMIT 1 por contador, que
-- no se puede convertir en un barrido y usa el índice de `registros` por
-- contador. La CTE `base` queda MATERIALIZED para que se calcule una sola vez.
-- Medido igual: 180 ms para 169 contadores (40 de ellos con lecturas).
--
-- QUÉ NO CAMBIA. El contrato y la regla: un contador con al menos una lectura
-- no borrada que quien importa puede ver «tiene lecturas» y su lectura inicial
-- no se toca. La suite supabase/tests/historial_lecturas la ejerce entera.
--
-- IMPACTO EN DATOS: ninguno. CÓMO REVERTIR: re-aplicar la función de
-- 20261205000000 (CREATE OR REPLACE). Idempotente.

CREATE OR REPLACE FUNCTION public.agua_historial_lecturas_importar(
  p_project_id uuid,
  p_filas      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_total        integer;
  v_lote         jsonb;
  v_errores      text[];
  v_insertadas   integer := 0;
  v_actualizadas integer := 0;
  v_contadores   integer := 0;
  v_candidatos   integer := 0;
  v_subidas      integer := 0;
  v_con_lecturas integer := 0;
  v_instalacion  integer := 0;
  v_menor        integer := 0;
  v_cambios      jsonb := '[]'::jsonb;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_PROYECTO: falta el proyecto destino' USING ERRCODE = '22023';
  END IF;
  IF p_filas IS NULL OR jsonb_typeof(p_filas) <> 'array' THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_FILAS: se esperaba una lista de filas' USING ERRCODE = '22023';
  END IF;
  v_total := jsonb_array_length(p_filas);
  IF v_total > 2000 THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_FILAS: a lo sumo 2000 filas por envío (llegaron %)', v_total
      USING ERRCODE = '22023';
  END IF;

  -- ── Lectura y validación del lote, sin escribir nada ────────────────────────
  -- Los valores se leen como texto: un número o una fecha mal escritos son un
  -- error de ESA fila, con su número, no un error genérico del lote.
  -- El contador se busca por número de serie, sin distinguir mayúsculas ni
  -- espacios, SÓLO en el proyecto elegido y entre los que quien importa ve.
  WITH entrada AS (
    SELECT COALESCE(NULLIF(e.value->>'fila', '')::integer, e.ordinality::integer) AS fila,
           btrim(e.value->>'contador')               AS serie,
           btrim(e.value->>'fecha')                  AS fecha_txt,
           NULLIF(btrim(e.value->>'lectura'), '')    AS lectura_txt,
           NULLIF(btrim(e.value->>'consumo'), '')    AS consumo_txt,
           NULLIF(btrim(e.value->>'notas'), '')      AS notas
      FROM jsonb_array_elements(p_filas) WITH ORDINALITY AS e(value, ordinality)
  ), tipada AS (
    SELECT en.*,
           CASE WHEN en.fecha_txt ~ '^\d{4}-\d{2}-\d{2}$' THEN en.fecha_txt::date END AS fecha,
           CASE WHEN en.lectura_txt ~ '^\d{1,8}(\.\d{1,4})?$' THEN en.lectura_txt::numeric END AS lectura,
           CASE WHEN en.consumo_txt ~ '^\d{1,8}(\.\d{1,4})?$' THEN en.consumo_txt::numeric END AS consumo
      FROM entrada en
  ), padron AS MATERIALIZED (
    -- Los contadores del proyecto se leen UNA vez por lote. Buscarlos fila por
    -- fila hacía evaluar la RLS de `contadores` (funciones por fila) sobre todo
    -- el proyecto en cada fila del archivo: ~70 ms por fila en producción.
    SELECT lower(btrim(c.numero_serie)) AS clave,
           count(c.id)::integer         AS n,
           (array_agg(c.id))[1]         AS id
      FROM public.contadores c
     WHERE c.project_id = p_project_id
     GROUP BY 1
  ), resuelta AS (
    SELECT t.*, COALESCE(m.n, 0) AS coincidencias, CASE WHEN m.n = 1 THEN m.id END AS contador_id
      FROM tipada t
      LEFT JOIN padron m ON m.clave = lower(t.serie)
  ), con_error AS (
    SELECT r.*,
           CASE
             WHEN COALESCE(r.serie, '') = '' THEN 'falta el número de contador'
             WHEN r.coincidencias = 0 THEN format('el contador «%s» no existe en el proyecto', r.serie)
             WHEN r.coincidencias > 1 THEN format('hay %s contadores «%s» en el proyecto', r.coincidencias, r.serie)
             WHEN r.fecha IS NULL THEN format('fecha inválida «%s» (use AAAA-MM-DD)', COALESCE(r.fecha_txt, ''))
             WHEN r.fecha > current_date + 1 THEN format('la fecha %s está en el futuro', r.fecha)
             WHEN r.lectura_txt IS NOT NULL AND r.lectura IS NULL THEN format('lectura inválida «%s»', r.lectura_txt)
             WHEN r.consumo_txt IS NOT NULL AND r.consumo IS NULL THEN format('consumo inválido «%s»', r.consumo_txt)
             WHEN r.lectura IS NULL AND r.consumo IS NULL THEN 'falta la lectura o el consumo'
           END AS error
      FROM resuelta r
  ), final AS (
    -- La misma fecha del mismo contador dos veces en el lote es ambigua: vale
    -- la primera y las demás son error.
    SELECT ce.*,
           CASE
             WHEN ce.error IS NOT NULL THEN ce.error
             WHEN ce.fila <> min(ce.fila) FILTER (WHERE ce.error IS NULL)
                                 OVER (PARTITION BY ce.contador_id, ce.fecha)
               THEN format('fecha %s repetida para el contador «%s»', ce.fecha, ce.serie)
           END AS motivo
      FROM con_error ce
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'fila', f.fila, 'contador_id', f.contador_id, 'fecha', f.fecha,
           'lectura', f.lectura, 'consumo', f.consumo, 'notas', f.notas, 'error', f.motivo)), '[]'::jsonb)
    INTO v_lote
    FROM final f;

  SELECT array_agg(format('fila %s: %s', x.fila, x.error) ORDER BY x.fila)
    INTO v_errores
    FROM jsonb_to_recordset(v_lote) AS x(fila integer, error text)
   WHERE x.error IS NOT NULL;
  IF v_errores IS NOT NULL THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_FILAS: % fila(s) con error. %', cardinality(v_errores),
      array_to_string(v_errores[1:10], '; ')
      USING ERRCODE = '22023';
  END IF;

  -- ── Escritura (la RLS decide) ───────────────────────────────────────────────
  -- El proyecto y la empresa los pone el trigger desde el contador; la RLS se
  -- evalúa después, sobre esos valores.
  WITH escritas AS (
    INSERT INTO public.agua_historial_lecturas (contador_id, fecha, lectura, consumo, notas)
    SELECT x.contador_id, x.fecha, x.lectura, x.consumo, x.notas
      FROM jsonb_to_recordset(v_lote) AS x(contador_id uuid, fecha date, lectura numeric, consumo numeric, notas text)
    ON CONFLICT (contador_id, fecha) DO UPDATE
       SET lectura = EXCLUDED.lectura,
           consumo = EXCLUDED.consumo,
           notas   = EXCLUDED.notas
    RETURNING (xmax = 0) AS nueva
  )
  SELECT count(*) FILTER (WHERE nueva), count(*) FILTER (WHERE NOT nueva)
    INTO v_insertadas, v_actualizadas
    FROM escritas;

  -- ── Lectura inicial de los contadores sin lecturas ──────────────────────────
  -- La última lectura del historial (de TODO el historial del contador, no sólo
  -- de este lote) pasa a ser la base de la primera captura nueva. Sólo sube, y
  -- no si es anterior a la instalación: un medidor que reemplazó al viejo no
  -- hereda su número.
  WITH afectados AS (
    SELECT DISTINCT x.contador_id
      FROM jsonb_to_recordset(v_lote) AS x(contador_id uuid)
  ), base AS MATERIALIZED (
    -- «¿Tiene lecturas?» se pregunta contador por contador, con LIMIT 1: así es
    -- siempre una búsqueda por índice de las lecturas de ESE contador. Como
    -- EXISTS, el planificador podía resolverlo recorriendo `registros` entera, y
    -- su RLS (funciones por fila) costaba ~3,5 s por lote en producción.
    SELECT c.id AS contador_id, u.lectura, u.fecha,
           COALESCE(c.lectura_inicial, 0) AS inicial,
           c.fecha_instalacion AS instalacion,
           (rl.hay IS TRUE) AS tiene_lecturas
      FROM public.contadores c
      JOIN afectados a ON a.contador_id = c.id
      JOIN LATERAL (
        SELECT h.lectura, h.fecha
          FROM public.agua_historial_lecturas h
         WHERE h.contador_id = c.id AND h.lectura IS NOT NULL
         ORDER BY h.fecha DESC
         LIMIT 1
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT true AS hay
          FROM public.registros r
         WHERE r.contador_id = c.id AND r.deleted_at IS NULL
         LIMIT 1
      ) rl ON true
  ), subidas AS (
    UPDATE public.contadores c
       SET lectura_inicial = b.lectura
      FROM base b
     WHERE c.id = b.contador_id
       AND NOT b.tiene_lecturas
       AND (b.instalacion IS NULL OR b.fecha >= b.instalacion)
       AND b.lectura > b.inicial
    RETURNING c.id, c.lectura_inicial
  )
  SELECT count(*) FILTER (WHERE b.tiene_lecturas),
         count(*) FILTER (WHERE NOT b.tiene_lecturas AND b.instalacion IS NOT NULL AND b.fecha < b.instalacion),
         count(*) FILTER (WHERE NOT b.tiene_lecturas AND (b.instalacion IS NULL OR b.fecha >= b.instalacion) AND b.lectura < b.inicial),
         count(*) FILTER (WHERE NOT b.tiene_lecturas AND (b.instalacion IS NULL OR b.fecha >= b.instalacion) AND b.lectura > b.inicial),
         (SELECT count(*) FROM subidas),
         (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'lectura_inicial', s.lectura_inicial)), '[]'::jsonb)
            FROM subidas s)
    INTO v_con_lecturas, v_instalacion, v_menor, v_candidatos, v_subidas, v_cambios
    FROM base b;

  SELECT count(DISTINCT x.contador_id) INTO v_contadores
    FROM jsonb_to_recordset(v_lote) AS x(contador_id uuid);

  RETURN jsonb_build_object(
    'filas',        v_total,
    'insertadas',   v_insertadas,
    'actualizadas', v_actualizadas,
    'contadores',   v_contadores,
    'lectura_inicial', jsonb_build_object(
      'actualizadas',             v_subidas,
      -- Debían subir y la RLS de `contadores` no se lo permitió a quien importa.
      'sin_permiso',              v_candidatos - v_subidas,
      'con_lecturas',             v_con_lecturas,
      'anteriores_a_instalacion', v_instalacion,
      'menores',                  v_menor,
      -- Para que la pantalla actualice su copia de esos contadores.
      'contadores',               v_cambios
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) TO authenticated;
