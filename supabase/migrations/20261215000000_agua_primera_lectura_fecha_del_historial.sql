-- ============================================================================
-- Primera lectura con historial importado: la fecha anterior es la del historial
-- ============================================================================
-- POR QUÉ. Al importar el historial de un contador sin lecturas del sistema, la
-- importación (20261130000000) deja como `lectura_inicial` la última lectura del
-- historial: es la base contra la que se calcula el consumo de la primera
-- lectura nueva. El VALOR quedaba bien, pero la FECHA de esa base seguía siendo
-- la de instalación del contador. Caso real: contador «VSC1-1 98011083», última
-- lectura del historial 3 407 del 25-oct-2026; «Nueva Lectura» mostraba «Última
-- lectura 3 407 — 14/1/2024» y calculaba 1 045 días de servicio para un periodo
-- de un mes. Ese número se guarda en la lectura (`fecha_lectura_anterior`,
-- `dias_servicio`) y sale en el recibo.
--
-- QUÉ CAMBIA. Sólo `base_fecha` de `agua_lectura_contexto`, y sólo en la PRIMERA
-- lectura del sistema de un contador: si su `lectura_inicial` es exactamente la
-- última lectura de su historial importado (y esa lectura no es anterior a la
-- instalación), la fecha de la base es la de esa lectura, al mediodía de la zona
-- de la empresa, igual que toda fecha de lectura. `registrar_lectura` y el
-- trigger de `registros` leen el contexto de aquí, así que todas las vías de
-- captura (Nueva Lectura, carga masiva, rutas) quedan iguales.
--
-- QUÉ NO CAMBIA. El valor de la base, el consumo, la tarifa y el importe. Un
-- contador con lecturas del sistema (manda la última lectura vigente), un
-- contador sin historial, o uno cuya lectura inicial NO viene del historial
-- (historial anterior a la instalación, o menor que la inicial): siguen con la
-- fecha de instalación. El operador puede seguir fijando a mano el inicio de
-- servicio de la primera lectura (`p_fecha_inicio_servicio` manda).
--
-- El resto del cuerpo es COPIA LITERAL de 20260910000200. ACL sin cambios
-- (CREATE OR REPLACE la conserva); se repite por si se aplica sobre una base
-- donde la función no exista.
--
-- IMPACTO EN DATOS: ninguno (las lecturas ya guardadas no se recalculan).
-- CÓMO REVERTIR: re-aplicar `agua_lectura_contexto` de 20260910000200.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.agua_lectura_contexto(p_contador_id uuid)
RETURNS TABLE (
  project_id           uuid,
  company_id           uuid,
  zona_horaria         text,
  cliente_id           uuid,
  cliente_nombre       text,
  numero_serie         text,
  derecho_servicio_m3  numeric,
  lectura_inicial      numeric,
  fecha_instalacion    date,
  tarifa_id            uuid,
  tarifa_activa        boolean,
  precio_m3            numeric,
  precio_m3_exceso     numeric,
  canon_fijo           numeric,
  consumo_minimo       numeric,
  tramos               jsonb,
  base_registro_id     uuid,
  base_lectura         numeric,
  base_fecha           timestamptz,
  base_secuencia       bigint,
  base_es_primera      boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contador record;
  v_tz       text;
BEGIN
  SELECT c.project_id, c.unidad_id, c.tarifa_id, c.numero_serie,
         c.cantidad_derecho_servicio_m3, c.lectura_inicial, c.fecha_instalacion,
         c.activo, p.company_id
    INTO v_contador
    FROM public.contadores c
    JOIN public.projects p ON p.id = c.project_id
   WHERE c.id = p_contador_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contador no encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- El guard de alcance. `IS NOT TRUE` y no `NOT (...)`: sin JWT los helpers
  -- devuelven NULL y `NOT NULL` no lanza — fail-closed también sin sesión.
  IF (
    public.is_super_admin()
    OR (v_contador.company_id = public.get_my_company_id()
        AND public.can_access_project(v_contador.project_id))
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'no autorizado sobre este contador' USING ERRCODE = '42501';
  END IF;

  IF v_contador.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'el contador está inactivo' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(co.timezone, 'America/Guatemala') INTO v_tz
    FROM public.companies co WHERE co.id = v_contador.company_id;
  v_tz := COALESCE(v_tz, 'America/Guatemala');
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'America/Guatemala';
  END;

  RETURN QUERY
  WITH vigente AS (
    -- ORDEN TOTAL, y por eso `secuencia` va PRIMERO. Los tres criterios de
    -- abajo no bastan por sí solos y hay que decir por qué, porque el bug que
    -- trae al cliente hasta aquí es exactamente ese empate:
    --   · `fecha` empata siempre que hay dos lecturas el mismo día: las dos se
    --     anclan al mediodía, con el mismo valor al microsegundo.
    --   · `created_at` es `now()`, que en Postgres es la hora de INICIO DE LA
    --     TRANSACCIÓN: dos filas escritas en la misma transacción la tienen
    --     idéntica. No es una hipótesis — es lo que hacía fallar a esta misma
    --     prueba antes de existir `secuencia`.
    --   · `id` es un uuid aleatorio: desempata, pero al azar, que es el
    --     comportamiento del que veníamos.
    -- `secuencia` la asigna el servidor bajo el bloqueo, así que crece SIEMPRE.
    -- Los tres siguientes sólo actúan entre filas anteriores a esta migración
    -- (secuencia NULL), donde no hay nada mejor.
    -- `deleted_at IS NULL`: una lectura borrada no encadena (espeja E2 y el
    -- índice único parcial de 20260717080000).
    SELECT r.id, r.lectura_actual, r.fecha, r.secuencia
      FROM public.registros r
     WHERE r.contador_id = p_contador_id
       AND r.deleted_at IS NULL
     ORDER BY COALESCE(r.secuencia, 0) DESC, r.fecha DESC,
              r.created_at DESC NULLS LAST, r.id DESC
     LIMIT 1
  ), historico AS (
    -- La última lectura del historial importado (20261130000000). Sólo cuenta
    -- si es LA BASE: el contador no tiene lecturas del sistema y su
    -- `lectura_inicial` es exactamente esa lectura —que es lo que deja la
    -- importación cuando la hereda—. Entonces la fecha de la base es la de esa
    -- lectura, no la de instalación.
    SELECT h.lectura, h.fecha
      FROM public.agua_historial_lecturas h
     WHERE h.contador_id = p_contador_id
       AND h.lectura IS NOT NULL
     ORDER BY h.fecha DESC
     LIMIT 1
  )
  SELECT
    v_contador.project_id,
    v_contador.company_id,
    v_tz,
    u.cliente_id,
    COALESCE(cl.nombre, u.nombre),
    v_contador.numero_serie,
    v_contador.cantidad_derecho_servicio_m3,
    COALESCE(v_contador.lectura_inicial, 0)::numeric,
    v_contador.fecha_instalacion,
    t.id,
    COALESCE(t.activa, false),
    COALESCE(t.precio_m3, 0)::numeric,
    COALESCE(t.precio_m3_exceso, 0)::numeric,
    COALESCE(t.canon_fijo, 0)::numeric,
    COALESCE(t.consumo_minimo, 0)::numeric,
    CASE WHEN jsonb_typeof(t.tramos) = 'array' THEN t.tramos ELSE NULL END,
    vig.id,
    COALESCE(vig.lectura_actual, COALESCE(v_contador.lectura_inicial, 0))::numeric,
    COALESCE(
      vig.fecha,
      CASE WHEN his.lectura = COALESCE(v_contador.lectura_inicial, 0)
                AND (v_contador.fecha_instalacion IS NULL OR his.fecha >= v_contador.fecha_instalacion)
           THEN (his.fecha + time '12:00') AT TIME ZONE v_tz
      END,
      v_contador.fecha_instalacion::timestamptz
    ),
    COALESCE(vig.secuencia, 0)::bigint,
    (vig.id IS NULL)
  FROM (SELECT 1) dummy
  LEFT JOIN vigente vig ON true
  LEFT JOIN historico his ON true
  LEFT JOIN public.unidades u ON u.id = v_contador.unidad_id
  LEFT JOIN public.clientes cl ON cl.id = u.cliente_id
  -- La tarifa se resuelve DESDE LA BASE por el contador, nunca por un id que
  -- mande el cliente: es la única forma de que el precio del recibo no sea un
  -- parámetro de la petición.
  LEFT JOIN public.tarifas t ON t.id = v_contador.tarifa_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.agua_lectura_contexto(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lectura_contexto(uuid) TO authenticated;
