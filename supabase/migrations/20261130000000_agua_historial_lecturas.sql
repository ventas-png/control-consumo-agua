-- ════════════════════════════════════════════════════════════════════════════
-- Agua · historial de lecturas por contador (referencia, sin cobro)
--
-- POR QUÉ. Muchas empresas llevaban las lecturas de sus contadores a mano
-- (cuaderno, Excel) antes de usar la plataforma. Sin ese pasado, las
-- comparaciones que ya existen —el aviso de «consumo X veces mayor que su
-- promedio» al capturar, las alertas de fuga o medidor parado— arrancan en
-- cero y tardan meses en servir.
--
-- POR QUÉ NO EN `registros`. Cada fila de `registros` ES un cobro: nace
-- 'pendiente', el cierre de ciclo la factura y notifica al cliente, entra a la
-- contabilidad, aparece como deuda en el portal y suma en los totales del
-- Historial, del Dashboard y de Cobros. Además el motor de captura
-- (20260910000200) rechaza a propósito una lectura anterior a la vigente. Meter
-- años de historial ahí habría cobrado meses ya cobrados.
--
-- QUÉ AGREGA
--   1. `agua_historial_lecturas`: una fila por contador y fecha con la lectura
--      y/o el consumo de ese periodo. Sin monto, sin estado, sin factura. El
--      proyecto y la empresa NO los manda el cliente: salen del contador.
--   2. RLS espejo de `registros`: lo ve quien ve lecturas de agua del proyecto;
--      lo escribe quien captura lecturas en el proyecto (rol de operación o
--      `agua.lecturas.create`), siempre dentro de su empresa y de los
--      proyectos que tiene asignados.
--   3. `agua_historial_lecturas_importar(proyecto, filas)`: la carga masiva.
--      Busca cada contador por su número de serie DENTRO del proyecto elegido,
--      valida todo el lote antes de escribir (todo o nada), y re-importar la
--      misma fecha reemplaza la fila en vez de duplicarla.
--      Después, para los contadores SIN lecturas en el sistema, deja la última
--      lectura del historial como `lectura_inicial`: es la base contra la que
--      el motor de captura calcula el consumo de la PRIMERA lectura nueva.
--      Sólo la sube, y sólo si esa lectura no es anterior a la fecha de
--      instalación (un medidor nuevo que reemplazó al viejo no hereda su
--      número). Corre con los permisos de quien importa: si no puede editar
--      contadores, la base no se toca y el resumen lo dice.
--
-- LO QUE **NO** HACE: no crea ni modifica `registros`; no cobra; no toca
-- facturas, contabilidad ni el portal del residente; no cambia el cálculo de
-- ninguna lectura que ya exista.
--
-- Idempotente: se puede aplicar dos veces.
-- IMPACTO EN DATOS: ninguno al aplicar (tabla nueva, vacía).
-- REVERSA: scripts/reversion-historial-lecturas.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tabla
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agua_historial_lecturas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contador_id uuid NOT NULL REFERENCES public.contadores(id) ON DELETE CASCADE,
  fecha       date NOT NULL,
  lectura     numeric(12,4),
  consumo     numeric(12,4),
  notas       text,
  creado_por  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agua_historial_lecturas_dato_check CHECK (lectura IS NOT NULL OR consumo IS NOT NULL),
  CONSTRAINT agua_historial_lecturas_lectura_check CHECK (lectura IS NULL OR lectura >= 0),
  CONSTRAINT agua_historial_lecturas_consumo_check CHECK (consumo IS NULL OR consumo >= 0),
  -- Una fila por contador y fecha: re-importar la misma fecha la reemplaza.
  CONSTRAINT agua_historial_lecturas_contador_fecha_uq UNIQUE (contador_id, fecha)
);

-- La consulta típica: el historial de UN contador, del más reciente hacia atrás
-- (la cubre el índice de la UNIQUE). Esta, la del proyecto por fecha.
CREATE INDEX IF NOT EXISTS idx_agua_historial_lecturas_project
  ON public.agua_historial_lecturas (project_id, fecha DESC);

COMMENT ON TABLE public.agua_historial_lecturas IS
  'Agua: historial de lecturas de un contador anterior a la plataforma (carga manual o importada). Sólo referencia para promedios, tendencias y alertas: no es un cobro, no se factura y no entra en los totales de registros.';
COMMENT ON COLUMN public.agua_historial_lecturas.consumo IS
  'Consumo del periodo tal como venía en el archivo. NULL = se deduce de la lectura anterior del mismo contador al mostrarlo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Coherencia: proyecto y empresa salen del contador
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER sólo para LEER el proyecto y la empresa del contador aunque
-- quien escribe no pueda leer `contadores`. No concede nada: la RLS de esta
-- tabla se evalúa después sobre el proyecto y la empresa así resueltos.
CREATE OR REPLACE FUNCTION public.agua_historial_lecturas_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project uuid;
  v_company uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contador_id IS DISTINCT FROM OLD.contador_id THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_INMUTABLE: una fila del historial no cambia de contador'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.project_id, c.company_id INTO v_project, v_company
    FROM public.contadores c WHERE c.id = NEW.contador_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_CONTADOR: el contador no existe'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.project_id := v_project;
  NEW.company_id := v_company;

  -- Historial = pasado. Se tolera un día por la diferencia de zona horaria.
  IF NEW.fecha > current_date + 1 THEN
    RAISE EXCEPTION 'AGUA_HISTORIAL_FUTURO: la fecha % está en el futuro', NEW.fecha
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.notas := NULLIF(btrim(NEW.notas), '');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.agua_historial_lecturas_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_agua_historial_lecturas_coherente ON public.agua_historial_lecturas;
CREATE TRIGGER trg_agua_historial_lecturas_coherente
  BEFORE INSERT OR UPDATE ON public.agua_historial_lecturas
  FOR EACH ROW EXECUTE FUNCTION public.agua_historial_lecturas_coherente();
DROP TRIGGER IF EXISTS trg_agua_historial_lecturas_sello ON public.agua_historial_lecturas;
CREATE TRIGGER trg_agua_historial_lecturas_sello
  BEFORE INSERT OR UPDATE ON public.agua_historial_lecturas
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_agua_historial_lecturas_updated_at ON public.agua_historial_lecturas;
CREATE TRIGGER trg_agua_historial_lecturas_updated_at
  BEFORE UPDATE ON public.agua_historial_lecturas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agua_historial_lecturas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agua_historial_lecturas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agua_historial_lecturas TO authenticated;

-- Quién ESCRIBE: lo mismo que puede capturar lecturas (registros_insert), pero
-- siempre dentro de su empresa y de los proyectos que tiene a su alcance.
-- Quién LEE: quien ve lecturas de agua del proyecto, y también quien escribe
-- (un INSERT … RETURNING o un ON CONFLICT DO UPDATE tienen que poder ver la
-- fila que escriben).
DROP POLICY IF EXISTS agua_historial_lecturas_select ON public.agua_historial_lecturas;
CREATE POLICY agua_historial_lecturas_select ON public.agua_historial_lecturas
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
      AND (
        (SELECT public.user_has_permission('agua.lecturas.view'))
        OR (SELECT public.user_has_permission('agua.tabla.view'))
        OR (SELECT public.user_has_permission('agua.dashboard.view'))
        OR (SELECT public.user_has_permission('agua.contadores.view'))
        OR (SELECT public.user_has_permission('agua.lecturas.create'))
        OR (SELECT public.current_user_role()) = ANY (ARRAY['admin','company_owner','operator','operador'])
      )
    )
  );

DROP POLICY IF EXISTS agua_historial_lecturas_insert ON public.agua_historial_lecturas;
CREATE POLICY agua_historial_lecturas_insert ON public.agua_historial_lecturas
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
      AND (
        (SELECT public.user_has_permission('agua.lecturas.create'))
        OR (SELECT public.current_user_role()) = ANY (ARRAY['admin','company_owner','operator','operador'])
      )
    )
  );

DROP POLICY IF EXISTS agua_historial_lecturas_update ON public.agua_historial_lecturas;
CREATE POLICY agua_historial_lecturas_update ON public.agua_historial_lecturas
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
      AND (
        (SELECT public.user_has_permission('agua.lecturas.create'))
        OR (SELECT public.current_user_role()) = ANY (ARRAY['admin','company_owner','operator','operador'])
      )
    )
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
    )
  );

DROP POLICY IF EXISTS agua_historial_lecturas_delete ON public.agua_historial_lecturas;
CREATE POLICY agua_historial_lecturas_delete ON public.agua_historial_lecturas
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
      AND (
        (SELECT public.user_has_permission('agua.lecturas.create'))
        OR (SELECT public.current_user_role()) = ANY (ARRAY['admin','company_owner','operator','operador'])
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Importación masiva
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER a propósito: escribe con los permisos de quien importa, así
-- que la RLS de esta tabla (y la de `contadores` para la lectura inicial) es la
-- que decide. La función sólo agrega lo que la RLS no hace: buscar el contador
-- por número de serie en el proyecto elegido y validar el lote entero antes de
-- escribir la primera fila.
--
-- p_filas: [{ "fila": 2, "contador": "M-1", "fecha": "2025-03-31",
--             "lectura": 1520.5, "consumo": null, "notas": "…" }, …]
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
  ), resuelta AS (
    SELECT t.*, m.n AS coincidencias, CASE WHEN m.n = 1 THEN m.id END AS contador_id
      FROM tipada t
      LEFT JOIN LATERAL (
        SELECT count(c.id)::integer AS n, (array_agg(c.id))[1] AS id
          FROM public.contadores c
         WHERE c.project_id = p_project_id
           AND lower(btrim(c.numero_serie)) = lower(t.serie)
      ) m ON true
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
  ), base AS (
    SELECT c.id AS contador_id, u.lectura, u.fecha,
           COALESCE(c.lectura_inicial, 0) AS inicial,
           c.fecha_instalacion AS instalacion,
           EXISTS (SELECT 1 FROM public.registros r
                    WHERE r.contador_id = c.id AND r.deleted_at IS NULL) AS tiene_lecturas
      FROM public.contadores c
      JOIN afectados a ON a.contador_id = c.id
      JOIN LATERAL (
        SELECT h.lectura, h.fecha
          FROM public.agua_historial_lecturas h
         WHERE h.contador_id = c.id AND h.lectura IS NOT NULL
         ORDER BY h.fecha DESC
         LIMIT 1
      ) u ON true
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

COMMENT ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) IS
  'Carga masiva del historial de lecturas de agua en un proyecto. Todo o nada; re-importar la misma fecha reemplaza. Para contadores sin lecturas, sube lectura_inicial a la última del historial (si no es anterior a la instalación). SECURITY INVOKER: la RLS de quien importa decide.';

REVOKE EXECUTE ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_historial_lecturas_importar(uuid, jsonb) TO authenticated;
