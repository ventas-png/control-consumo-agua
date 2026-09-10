-- ════════════════════════════════════════════════════════════════════════════
-- La lectura de agua deja de ser un dato que el navegador declara
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. Hoy una lectura de agua es un INSERT directo desde el navegador a
-- `registros`, y el navegador manda TODAS las columnas del cargo:
--
--     lectura_anterior, consumo, tarifa_aplicada, tarifa_exceso_aplicada,
--     canon_aplicado, monto_calculado, tipo_cobro, project_id, cliente_id,
--     estado
--
-- La RLS (`registros_insert`, 20260610000808) contesta una sola pregunta:
-- «¿puede este usuario escribir en ESTE proyecto?». No mira ni un valor. Un
-- operador legítimo —o cualquiera con su sesión— puede POSTear a
-- /rest/v1/registros con `consumo: 0`, `monto_calculado: 0` y `estado:
-- 'pagado'` y la fila entra: es un recibo de agua en cero, firmado por la base.
-- El cálculo real (`calcularCostoTarifa`, src/lib/business.ts) corre en el
-- cliente y su resultado es una SUGERENCIA que el servidor acepta sin mirar.
--
-- Y aun sin mala fe el dato sale mal, porque `lectura_anterior` la elige el
-- navegador con los registros que tiene EN MEMORIA:
--
--   · `getUltimaLectura` ordena por `new Date(fecha)` y nada más. Dos lecturas
--     del mismo día tienen la MISMA `fecha` (ambas al mediodía local): el
--     desempate es el que quiera el motor de JS. La segunda lectura del día
--     puede encadenarse contra sí misma.
--   · La lista en memoria está recortada (`limit(5000)`, RLS del rol, filtros
--     de proyecto). Si la última lectura del contador no bajó, el cliente cree
--     que es la PRIMERA y factura contra `contadores.lectura_inicial`.
--   · Dos lecturistas capturando el mismo contador a la vez leen los dos el
--     mismo «anterior» y ninguno ve al otro: no hay bloqueo en ninguna parte.
--
-- QUÉ HACE ESTA MIGRACIÓN. Mueve la decisión entera al servidor, dentro de UNA
-- transacción, y deja al cliente sólo lo que únicamente él sabe: qué contador
-- leyó, qué número marcaba, qué día, la foto, el GPS y la nota.
--
--   1. Columnas de operación: `idempotency_key` (la llave del reintento del
--      outbox), `origen` (por qué camino entró la fila), `es_reset` y
--      `lectura_final_retirada` (el cambio físico de medidor, auditable).
--   2. `agua_lectura_contexto(contador)` — el estado autoritativo del contador:
--      proyecto, empresa, cliente, tarifa VIGENTE y lectura vigente con orden
--      TOTAL y determinista, ignorando soft-deleted.
--   3. `agua_costo_tarifa(...)` — el cálculo del importe en NUMERIC, espejo
--      exacto de `calcularCostoTarifa` (plano de 3 tramos + escalonado).
--   4. `agua_lectura_resolver(...)` — toma el bloqueo por contador, aplica las
--      reglas de negocio y devuelve la fila que corresponde insertar.
--   5. `registrar_lectura(...)` — la RPC. SECURITY INVOKER: la autorización de
--      escritura sigue siendo la policy `registros_insert`, no un guard
--      copiado dentro del cuerpo.
--   6. `trg_agua_lectura_autoritativa` — el INSERT directo que quede vivo (la
--      app nativa ya publicada) pasa por el MISMO motor: sus valores se
--      RECALCULAN, no se aceptan. Es la transición, y tiene fecha de cierre.
--
-- LAS TRES REGLAS DE NEGOCIO, DECIDIDAS Y ESCRITAS (no inferidas del código):
--
--   · VARIAS LECTURAS EL MISMO DÍA → se permiten y se ENCADENAN. El orden
--     vigente es total: (fecha, created_at, id). La segunda lectura del día
--     toma como anterior a la primera. El índice único natural
--     (contador, lectura, fecha) sigue rechazando el reenvío idéntico.
--   · LECTURA RETROACTIVA → se RECHAZA (22023). La fecha no puede ser anterior
--     al día de la lectura vigente. Corregir el histórico es un flujo aparte,
--     con revisión: esta RPC no reescribe importes ya calculados.
--   · RESET / CAMBIO FÍSICO DE MEDIDOR → el operador captura la lectura FINAL
--     del medidor retirado y el consumo es el REAL:
--         consumo = (final_retirado − anterior) + lectura_actual
--     El motivo en notas pasa a OBLIGATORIO y la fila queda marcada
--     (`es_reset`, `lectura_final_retirada`). Antes se guardaba consumo 0, que
--     regalaba el agua consumida por el medidor viejo desde su última lectura.
--
-- LO QUE ESTA MIGRACIÓN NO HACE. No toca ninguna fila existente, no reescribe
-- importes históricos y no cambia las policies de `registros`. El inventario de
-- lo que ya está mal se publica como REPORTE de sólo lectura en la migración
-- siguiente (20260910000100), para que la corrección sea una decisión humana.
--
-- REVERSIÓN
--   DROP TRIGGER   IF EXISTS trg_agua_lectura_autoritativa ON public.registros;
--   DROP FUNCTION  IF EXISTS public.agua_tg_lectura_autoritativa();
--   DROP FUNCTION  IF EXISTS public.registrar_lectura(uuid, numeric, date, text, text, text, jsonb, boolean, numeric, date);
--   DROP FUNCTION  IF EXISTS public.agua_lectura_resolver(uuid, numeric, date, text, boolean, numeric, date);
--   DROP FUNCTION  IF EXISTS public.agua_costo_tarifa(numeric, numeric, numeric, numeric, numeric, jsonb, numeric);
--   DROP FUNCTION  IF EXISTS public.agua_lectura_contexto(uuid);
--   DROP INDEX     IF EXISTS public.uq_registros_idempotencia;
--   ALTER TABLE public.registros
--     DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS origen,
--     DROP COLUMN IF EXISTS es_reset, DROP COLUMN IF EXISTS lectura_final_retirada;
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS antes de CREATE TRIGGER.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Las columnas de la operación ─────────────────────────────────────────
-- Todas nullable o con default: las 
-- filas históricas y el INSERT directo que siga vivo no tienen ninguna.
ALTER TABLE public.registros
  ADD COLUMN IF NOT EXISTS idempotency_key        text,
  ADD COLUMN IF NOT EXISTS origen                 text NOT NULL DEFAULT 'directo',
  ADD COLUMN IF NOT EXISTS es_reset               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lectura_final_retirada numeric,
  ADD COLUMN IF NOT EXISTS secuencia              bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registros_origen_check' AND conrelid = 'public.registros'::regclass
  ) THEN
    ALTER TABLE public.registros
      ADD CONSTRAINT registros_origen_check CHECK (origen IN ('directo', 'rpc'));
  END IF;
END $$;

COMMENT ON COLUMN public.registros.idempotency_key IS
  'Llave de la OPERACIÓN de captura, generada por el cliente al guardar y conservada en el outbox offline. Es lo que distingue un reintento de una captura nueva: (contador, lectura, fecha) no puede — dos lecturas legítimas del mismo día con el mismo valor son indistinguibles de un reenvío. Única en toda la tabla.';
COMMENT ON COLUMN public.registros.origen IS
  '"rpc" = la fila la calculó registrar_lectura; "directo" = entró por INSERT y sus valores los RECALCULÓ trg_agua_lectura_autoritativa. Es la métrica que dice cuándo se puede cerrar el INSERT directo.';
COMMENT ON COLUMN public.registros.es_reset IS
  'La lectura corresponde a un cambio físico / reset del medidor: lectura_actual arranca por debajo de la anterior y el consumo se compone con lectura_final_retirada.';
COMMENT ON COLUMN public.registros.lectura_final_retirada IS
  'Última lectura del medidor RETIRADO, capturada por el operador en un reset. consumo = (lectura_final_retirada − lectura_anterior) + lectura_actual.';
COMMENT ON COLUMN public.registros.secuencia IS
  'Posición de la lectura en la cadena de SU contador, asignada bajo el bloqueo. Es el orden total de verdad: `fecha` empata (dos lecturas del mismo día caen ambas al mediodía) y `created_at` también, porque es now() y vale lo mismo para todo lo que entre en la misma transacción. NULL en las filas anteriores a 20260910000000, que se ordenan como se pueda (por eso existe el reporte de inconsistencias).';

-- Dos lecturas no pueden ocupar el mismo lugar de la cadena. El bloqueo por
-- contador ya lo impide; este índice es la red por debajo, la que sigue puesta
-- si alguien escribe por una vía que no lo tome. Parcial por deleted_at: al
-- anular la última lectura, la siguiente vuelve a ocupar ese lugar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_registros_secuencia_contador
  ON public.registros (contador_id, secuencia)
  WHERE deleted_at IS NULL AND contador_id IS NOT NULL AND secuencia IS NOT NULL;

-- Única en TODA la tabla, no sólo entre las vivas: si la lectura se borró
-- (soft delete), el reintento del outbox NO debe resucitarla — es el mismo
-- acto, y ya tuvo su desenlace. Es la diferencia con uq_registros_llave_natural
-- (20260717080000), que sí es parcial porque re-capturar a mano es legítimo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_registros_idempotencia
  ON public.registros (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON INDEX public.uq_registros_idempotencia IS
  'Idempotencia por operación del outbox offline. NO parcial por deleted_at: un reintento de una lectura ya borrada no la resucita.';

-- El índice que hace barato «la lectura vigente de este contador» con el orden
-- total (fecha, created_at, id) que usa agua_lectura_contexto.
CREATE INDEX IF NOT EXISTS idx_registros_contador_orden_total
  ON public.registros (contador_id, secuencia DESC, fecha DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL AND contador_id IS NOT NULL;

-- ── 2. El estado autoritativo del contador ──────────────────────────────────
-- SECURITY DEFINER por una razón concreta: `registrar_lectura` es SECURITY
-- INVOKER, y un operador de campo puede tener `agua.lecturas.create` SIN
-- `agua.lecturas.view`. Con los privilegios del invocante, la consulta de la
-- lectura vigente devolvería CERO filas para justo esas cuentas, el servidor
-- concluiría «es la primera lectura» y facturaría contra
-- `contadores.lectura_inicial`. El fallo sería silencioso y a favor de quien
-- captura. La función tiene su propio guard de alcance (empresa + proyecto),
-- así que no es un oráculo: contesta sólo por contadores que el caller ya ve.
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
    COALESCE(vig.fecha, v_contador.fecha_instalacion::timestamptz),
    COALESCE(vig.secuencia, 0)::bigint,
    (vig.id IS NULL)
  FROM (SELECT 1) dummy
  LEFT JOIN vigente vig ON true
  LEFT JOIN public.unidades u ON u.id = v_contador.unidad_id
  LEFT JOIN public.clientes cl ON cl.id = u.cliente_id
  -- La tarifa se resuelve DESDE LA BASE por el contador, nunca por un id que
  -- mande el cliente: es la única forma de que el precio del recibo no sea un
  -- parámetro de la petición.
  LEFT JOIN public.tarifas t ON t.id = v_contador.tarifa_id;
END;
$$;

COMMENT ON FUNCTION public.agua_lectura_contexto(uuid) IS
  'Estado autoritativo de un contador para calcular una lectura: proyecto/empresa/cliente, zona horaria del tenant, tarifa VIGENTE tomada de la base, y lectura vigente resuelta con orden TOTAL (fecha, created_at, id) ignorando soft-deleted. SECURITY DEFINER con guard propio (empresa + can_access_project) porque un operador con agua.lecturas.create puede no tener agua.lecturas.view y leería cero filas — concluyendo "primera lectura" y facturando de menos.';

REVOKE EXECUTE ON FUNCTION public.agua_lectura_contexto(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lectura_contexto(uuid) TO authenticated;

-- ── 3. El importe, en NUMERIC ───────────────────────────────────────────────
-- Espejo EXACTO de calcularCostoTarifa / calcularTotalPagar /
-- calcularTotalPagarEscalonado (src/lib/business.ts). La paridad se prueba
-- caso por caso en supabase/tests/registrar_lectura/ contra los mismos números
-- que verifica el test de vitest, y por eso el orden de las ramas está copiado
-- literalmente: quien cambie una de las dos implementaciones tiene que cambiar
-- la otra o el test lo caza.
--
-- El redondeo es el del contrato: `round(numeric, 2)` de Postgres es
-- «half away from zero», que es exactamente lo que hace `redondear2()` en TS.
-- La columna `monto_calculado` es `numeric` SIN escala, así que no redondea
-- sola: si esto no redondeara, el importe guardaría los 14 decimales del
-- flotante y el recibo no cuadraría con el desglose por un céntimo.
CREATE OR REPLACE FUNCTION public.agua_costo_tarifa(
  p_consumo          numeric,
  p_precio_m3        numeric,
  p_precio_m3_exceso numeric,
  p_canon_fijo       numeric,
  p_consumo_minimo   numeric,
  p_tramos           jsonb,
  p_derecho_m3       numeric
)
RETURNS TABLE (total numeric, tipo_cobro text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_consumo  numeric := COALESCE(p_consumo, 0);
  v_precio   numeric := COALESCE(p_precio_m3, 0);
  v_exceso   numeric := COALESCE(p_precio_m3_exceso, 0);
  v_canon    numeric := COALESCE(p_canon_fijo, 0);
  v_minimo   numeric := COALESCE(p_consumo_minimo, 0);
  v_derecho  numeric := COALESCE(p_derecho_m3, 0);
  v_total    numeric := 0;
  v_tramo    jsonb;
  v_desde    numeric;
  v_hasta    numeric;
  v_m3       numeric;
BEGIN
  -- Tarifa ESCALONADA: la presencia de bloques decide el modelo (igual que
  -- `Array.isArray(tarifa.tramos) && tarifa.tramos.length > 0`).
  IF jsonb_typeof(p_tramos) = 'array' AND jsonb_array_length(p_tramos) > 0 THEN
    IF v_consumo >= 0 AND v_consumo <= v_minimo THEN
      RETURN QUERY SELECT round(v_canon, 2), 'Canon Fijo'::text; RETURN;
    END IF;
    FOR v_tramo IN
      SELECT value FROM jsonb_array_elements(p_tramos)
       ORDER BY COALESCE(NULLIF(value ->> 'desde_m3', '')::numeric, 0)
    LOOP
      v_desde := COALESCE(NULLIF(v_tramo ->> 'desde_m3', '')::numeric, 0);
      v_hasta := NULLIF(v_tramo ->> 'hasta_m3', '')::numeric;  -- NULL = ∞
      v_m3    := GREATEST(0, LEAST(v_consumo, COALESCE(v_hasta, v_consumo)) - v_desde);
      IF v_m3 <= 0 THEN CONTINUE; END IF;
      v_total := v_total + v_m3 * COALESCE(NULLIF(v_tramo ->> 'precio_m3', '')::numeric, 0);
    END LOOP;
    RETURN QUERY SELECT round(v_total, 2), 'Consumo Escalonado'::text; RETURN;
  END IF;

  -- Tramo 1 · consumo dentro del mínimo → sólo canon fijo.
  IF v_consumo >= 0 AND v_consumo <= v_minimo THEN
    RETURN QUERY SELECT round(v_canon, 2), 'Canon Fijo'::text; RETURN;
  END IF;

  -- Tramo 3 · por encima del derecho de servicio → base + exceso.
  IF v_derecho > 0 AND v_exceso > 0 AND v_consumo > v_derecho THEN
    RETURN QUERY SELECT
      round(v_derecho * v_precio + (v_consumo - v_derecho) * v_exceso, 2),
      'Consumo con Exceso'::text;
    RETURN;
  END IF;

  -- Tramo 2 · consumo normal.
  RETURN QUERY SELECT round(v_consumo * v_precio, 2), 'Consumo Normal'::text;
END;
$$;

COMMENT ON FUNCTION public.agua_costo_tarifa(numeric, numeric, numeric, numeric, numeric, jsonb, numeric) IS
  'Importe de una lectura en NUMERIC: espejo exacto de calcularCostoTarifa() de src/lib/business.ts (plano de 3 tramos + escalonado por bloques), redondeado a 2 con el redondeo del contrato (half away from zero, = redondear2). Pura: ni lee tablas ni mira al caller.';

REVOKE EXECUTE ON FUNCTION public.agua_costo_tarifa(numeric, numeric, numeric, numeric, numeric, jsonb, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_costo_tarifa(numeric, numeric, numeric, numeric, numeric, jsonb, numeric) TO authenticated;

-- ── 4. Las reglas de negocio, en un solo sitio ──────────────────────────────
-- Devuelve la fila que corresponde insertar. NO inserta: así el mismo motor
-- sirve a la RPC y al trigger que sanea el INSERT directo, y no hay dos juegos
-- de reglas conviviendo.
--
-- EL BLOQUEO. `pg_advisory_xact_lock` por CONTADOR, no por fila. Un lock de
-- fila (SELECT … FOR UPDATE sobre la lectura vigente) no existe cuando la
-- lectura vigente no existe — que es exactamente el caso de la PRIMERA lectura,
-- donde dos capturas simultáneas producirían dos «primeras» encadenadas ambas
-- contra `lectura_inicial`. El advisory lock cuelga del id del contador, así
-- que también cubre ese hueco. Es `_xact_`: se suelta con la transacción, sin
-- posibilidad de fuga.
CREATE OR REPLACE FUNCTION public.agua_lectura_resolver(
  p_contador_id            uuid,
  p_lectura_actual         numeric,
  p_fecha                  date,
  p_notas                  text,
  p_reset_medidor          boolean,
  p_lectura_final_retirada numeric,
  p_fecha_inicio_servicio  date
)
RETURNS TABLE (
  project_id             uuid,
  cliente_id             uuid,
  cliente_nombre         text,
  fecha                  timestamptz,
  lectura_anterior       numeric,
  consumo                numeric,
  tarifa_aplicada        numeric,
  tarifa_exceso_aplicada numeric,
  canon_aplicado         numeric,
  monto_calculado        numeric,
  tipo_cobro             text,
  fecha_lectura_anterior timestamptz,
  dias_servicio          integer,
  es_reset               boolean,
  lectura_final_retirada numeric,
  secuencia              bigint
)
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  ctx        record;
  v_costo    record;
  v_fecha    timestamptz;
  v_anterior timestamptz;
  v_consumo  numeric;
  v_hoy      date;
BEGIN
  IF p_contador_id IS NULL THEN
    RAISE EXCEPTION 'la lectura necesita un contador' USING ERRCODE = '22023';
  END IF;
  IF p_lectura_actual IS NULL OR p_lectura_actual < 0 THEN
    RAISE EXCEPTION 'la lectura actual debe ser un número ≥ 0' USING ERRCODE = '22023';
  END IF;
  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'la lectura necesita una fecha' USING ERRCODE = '22023';
  END IF;

  -- El bloqueo ANTES de mirar nada: lo que se lee a continuación tiene que
  -- seguir siendo cierto en el momento del INSERT. hashtextextended con un
  -- espacio de nombres propio evita colisionar con otros advisory locks.
  PERFORM pg_advisory_xact_lock(
    hashtext('agua.registrar_lectura'),
    hashtext(p_contador_id::text)
  );

  SELECT * INTO ctx FROM public.agua_lectura_contexto(p_contador_id);

  -- La tarifa sale de la base y tiene que estar VIGENTE. Sin esto, un contador
  -- con la tarifa dada de baja factura a precio 0 sin que nadie se entere.
  IF ctx.tarifa_id IS NULL THEN
    RAISE EXCEPTION 'el contador no tiene tarifa asignada' USING ERRCODE = '22023';
  END IF;
  IF ctx.tarifa_activa IS NOT TRUE THEN
    RAISE EXCEPTION 'la tarifa del contador no está vigente' USING ERRCODE = '22023';
  END IF;

  -- La fecha se ancla al MEDIODÍA de la zona del tenant. Al mediodía y no a
  -- medianoche porque una lectura de un tenant en GMT-6 guardada a las 00:00
  -- locales cae en el día anterior en UTC y se factura en el ciclo equivocado
  -- (E4/D5). Es el mismo `+T12:00:00` que hacía el cliente, con la diferencia
  -- de que la zona ya no es la del teléfono del lecturista.
  v_hoy   := (now() AT TIME ZONE ctx.zona_horaria)::date;
  v_fecha := (p_fecha + time '12:00') AT TIME ZONE ctx.zona_horaria;

  -- Una lectura del futuro no existe. Se tolera un día: el teléfono puede ir
  -- adelantado respecto de la zona del tenant y eso no es un fraude.
  IF p_fecha > v_hoy + 1 THEN
    RAISE EXCEPTION 'la fecha de la lectura está en el futuro' USING ERRCODE = '22023';
  END IF;

  IF ctx.base_es_primera THEN
    -- Primera lectura del contador: la base es `lectura_inicial` y el inicio de
    -- servicio lo puede fijar el operador (es el único dato que la base no
    -- tiene). Sin él, la fecha de instalación.
    v_anterior := COALESCE(
      (p_fecha_inicio_servicio + time '12:00') AT TIME ZONE ctx.zona_horaria,
      ctx.base_fecha
    );
  ELSE
    v_anterior := ctx.base_fecha;

    -- REGLA · RETROACTIVA. Se compara por DÍA en la zona del tenant, no por
    -- timestamp: las filas viejas vienen del mediodía de la zona del TELÉFONO
    -- y una diferencia de husos no puede leerse como «va hacia atrás».
    IF p_fecha < (ctx.base_fecha AT TIME ZONE ctx.zona_horaria)::date THEN
      RAISE EXCEPTION
        'lectura retroactiva: la última lectura vigente de este contador es del %, y corregir el histórico requiere revisión aparte',
        to_char((ctx.base_fecha AT TIME ZONE ctx.zona_horaria)::date, 'YYYY-MM-DD')
        USING ERRCODE = '22023';
    END IF;

    -- REGLA · VARIAS EL MISMO DÍA. Se permiten y se encadenan. Lo que hace
    -- que la TERCERA lectura del día encadene contra la segunda y no contra la
    -- primera NO es la fecha —las tres valen lo mismo— sino `secuencia`, que
    -- se asigna unas líneas más abajo, bajo el bloqueo. `fecha` se queda en el
    -- mediodía exacto del día capturado: es su significado, y además es parte
    -- de la llave natural anti-duplicado (contador, lectura, fecha).
  END IF;

  IF COALESCE(p_reset_medidor, false) THEN
    -- REGLA · RESET / CAMBIO FÍSICO DE MEDIDOR.
    IF p_lectura_final_retirada IS NULL THEN
      RAISE EXCEPTION 'un reset de medidor exige la lectura final del medidor retirado'
        USING ERRCODE = '22023';
    END IF;
    IF p_lectura_final_retirada < ctx.base_lectura THEN
      RAISE EXCEPTION 'la lectura final del medidor retirado (%) no puede ser menor que su lectura anterior (%)',
        p_lectura_final_retirada, ctx.base_lectura USING ERRCODE = '22023';
    END IF;
    -- El motivo deja de ser «recomendable». Un reset mueve dinero y es la única
    -- vía por la que una lectura puede BAJAR: sin motivo escrito no hay
    -- auditoría posible.
    IF length(COALESCE(btrim(p_notas), '')) < 10 THEN
      RAISE EXCEPTION 'un reset de medidor exige una nota que explique el cambio (mínimo 10 caracteres)'
        USING ERRCODE = '22023';
    END IF;
    v_consumo := (p_lectura_final_retirada - ctx.base_lectura) + p_lectura_actual;
  ELSE
    IF p_lectura_actual < ctx.base_lectura THEN
      RAISE EXCEPTION
        'la lectura actual (%) es menor que la anterior (%); si el medidor fue reemplazado, registre el reset con la lectura final del medidor retirado',
        p_lectura_actual, ctx.base_lectura USING ERRCODE = '22023';
    END IF;
    v_consumo := p_lectura_actual - ctx.base_lectura;
  END IF;

  SELECT c.total, c.tipo_cobro INTO v_costo
    FROM public.agua_costo_tarifa(
      v_consumo, ctx.precio_m3, ctx.precio_m3_exceso, ctx.canon_fijo,
      ctx.consumo_minimo, ctx.tramos, ctx.derecho_servicio_m3
    ) c;

  RETURN QUERY SELECT
    ctx.project_id,
    ctx.cliente_id,
    ctx.cliente_nombre,
    v_fecha,
    ctx.base_lectura,
    v_consumo,
    ctx.precio_m3,
    ctx.precio_m3_exceso,
    ctx.canon_fijo,
    v_costo.total,
    v_costo.tipo_cobro,
    v_anterior,
    CASE
      WHEN v_anterior IS NULL THEN NULL
      ELSE GREATEST(0, round(EXTRACT(epoch FROM (v_fecha - v_anterior)) / 86400))::integer
    END,
    COALESCE(p_reset_medidor, false),
    CASE WHEN COALESCE(p_reset_medidor, false) THEN p_lectura_final_retirada ELSE NULL END,
    ctx.base_secuencia + 1;
END;
$$;

COMMENT ON FUNCTION public.agua_lectura_resolver(uuid, numeric, date, text, boolean, numeric, date) IS
  'Motor ÚNICO de la lectura de agua: toma el bloqueo por contador, resuelve la lectura vigente con orden total, exige tarifa vigente de la base, aplica las tres reglas (varias el mismo día = encadenan; retroactiva = 22023; reset = consumo real con la lectura final del medidor retirado y motivo obligatorio) y devuelve la fila a insertar. No inserta: lo comparten registrar_lectura y el trigger que sanea el INSERT directo.';

REVOKE EXECUTE ON FUNCTION public.agua_lectura_resolver(uuid, numeric, date, text, boolean, numeric, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lectura_resolver(uuid, numeric, date, text, boolean, numeric, date) TO authenticated;

-- ── 5. El reintento del outbox ──────────────────────────────────────────────
-- SECURITY DEFINER y acotada a `creado_por = auth.uid()`: quien reintenta busca
-- SU propia operación. Así no es un oráculo (no contesta por llaves ajenas) y
-- funciona para el operador de campo, que puede tener `agua.lecturas.create`
-- sin `agua.lecturas.view` y por tanto no poder SELECTear ni la fila que
-- acaba de crear.
CREATE OR REPLACE FUNCTION public.agua_lectura_por_idempotencia(p_key text)
RETURNS public.registros
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.* FROM public.registros r
   WHERE r.idempotency_key = p_key
     AND r.creado_por = (SELECT auth.uid())
   LIMIT 1
$$;

COMMENT ON FUNCTION public.agua_lectura_por_idempotencia(text) IS
  'La lectura que YA creó esta misma cuenta con esa llave de idempotencia, o NULL. Acotada a creado_por = auth.uid(): no contesta por operaciones ajenas.';

REVOKE EXECUTE ON FUNCTION public.agua_lectura_por_idempotencia(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.agua_lectura_por_idempotencia(text) TO authenticated;

-- ── 6. La RPC ───────────────────────────────────────────────────────────────
-- SECURITY INVOKER A PROPÓSITO. La pregunta «¿puede esta cuenta registrar una
-- lectura en este proyecto?» ya la contesta la policy `registros_insert`
-- (20260610000808), y es la respuesta que audita el resto del sistema. Con
-- SECURITY DEFINER habría que copiar esa lógica dentro del cuerpo, donde un
-- `CREATE OR REPLACE` futuro puede perderla sin que nadie lo note — que es
-- exactamente el incidente que documenta 20260729000200. Aquí el INSERT lo
-- ejecuta el usuario y la policy lo juzga a él.
--
-- LOS PARÁMETROS SON SÓLO LO QUE EL OPERADOR SABE. No hay `p_consumo`, ni
-- `p_monto`, ni `p_tarifa`, ni `p_project_id`, ni `p_cliente_id`, ni `p_estado`:
-- no es que se ignoren, es que no se pueden expresar. Un cliente malicioso no
-- tiene dónde escribir el importe.
CREATE OR REPLACE FUNCTION public.registrar_lectura(
  p_contador_id            uuid,
  p_lectura_actual         numeric,
  p_fecha                  date,
  p_idempotency_key        text,
  p_notas                  text    DEFAULT NULL,
  p_foto                   text    DEFAULT NULL,
  p_gps                    jsonb   DEFAULT NULL,
  p_reset_medidor          boolean DEFAULT false,
  p_lectura_final_retirada numeric DEFAULT NULL,
  p_fecha_inicio_servicio  date    DEFAULT NULL
)
RETURNS public.registros
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  res     record;
  v_prev  public.registros;
  v_fila  public.registros;
  v_gps   jsonb;
  v_lat   numeric;
  v_lng   numeric;
BEGIN
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'la captura necesita una llave de idempotencia de al menos 8 caracteres'
      USING ERRCODE = '22023';
  END IF;
  IF length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'llave de idempotencia demasiado larga' USING ERRCODE = '22023';
  END IF;

  -- Reintento ANTES de tocar nada: el outbox reenvía la misma operación cuando
  -- la red se cortó DESPUÉS del INSERT y la respuesta no llegó. Se devuelve la
  -- fila que ya existe, sin duplicar y sin error.
  v_prev := public.agua_lectura_por_idempotencia(p_idempotency_key);
  IF v_prev.id IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO res FROM public.agua_lectura_resolver(
    p_contador_id, p_lectura_actual, p_fecha, p_notas,
    p_reset_medidor, p_lectura_final_retirada, p_fecha_inicio_servicio
  );

  -- El bloqueo ya está tomado dentro del resolver; volver a mirar la llave
  -- cierra la carrera de dos dispositivos reenviando la MISMA operación a la vez.
  v_prev := public.agua_lectura_por_idempotencia(p_idempotency_key);
  IF v_prev.id IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- GPS: se acepta {lat, lng} numéricos y en rango, y se guarda normalizado.
  -- Cualquier otra cosa (basura, coordenadas imposibles, un objeto con más
  -- campos) NO invalida la lectura: se guarda sin ubicación. Perder la lectura
  -- del lecturista por un GPS raro sería peor que perder el GPS.
  v_gps := NULL;
  IF jsonb_typeof(p_gps) = 'object' THEN
    BEGIN
      v_lat := (p_gps ->> 'lat')::numeric;
      v_lng := (p_gps ->> 'lng')::numeric;
      IF v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180 THEN
        v_gps := jsonb_build_object('lat', v_lat, 'lng', v_lng);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_gps := NULL;
    END;
  END IF;

  -- La foto es un PATH del bucket `registro-fotos`, y la RLS de ese bucket
  -- scopea por carpeta-de-cliente (infra:I14). Se exige que el path esté bajo
  -- la carpeta del cliente que el SERVIDOR resolvió, no bajo la que diga el
  -- cliente: si no, la evidencia podría colgarse del expediente de otro.
  IF p_foto IS NOT NULL THEN
    IF res.cliente_id IS NULL OR p_foto NOT LIKE res.cliente_id::text || '/%' THEN
      RAISE EXCEPTION 'la foto no pertenece a la carpeta del cliente de esta lectura'
        USING ERRCODE = '22023';
    END IF;
    IF length(p_foto) > 400 THEN
      RAISE EXCEPTION 'ruta de foto inválida' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- La marca que le dice al trigger «esta fila ya viene resuelta». Es local a
  -- la transacción: no sobrevive a la petición.
  --
  -- POR QUÉ ESTO NO ES UNA PUERTA TRASERA. Un cliente no puede encenderla: la
  -- Data API sólo expone funciones del esquema `public`, y `set_config` vive en
  -- `pg_catalog`. Sin SQL arbitrario no hay forma de tocar un GUC de sesión, y
  -- el JWT sólo alimenta `request.*`. Es el mismo mecanismo —y el mismo
  -- razonamiento— que `conta.allow_system_write` (20260611000100), donde los
  -- asientos automáticos se distinguen de los tecleados exactamente así.
  PERFORM set_config('agua.lectura_autoritativa', 'on', true);

  BEGIN
    INSERT INTO public.registros (
      contador_id, project_id, cliente_id, cliente_nombre,
      fecha, lectura_anterior, lectura_actual, consumo,
      tarifa_aplicada, tarifa_exceso_aplicada, canon_aplicado,
      monto_calculado, tipo_cobro, estado,
      fecha_lectura_anterior, dias_servicio,
      notas, gps, foto,
      es_reset, lectura_final_retirada, secuencia, idempotency_key, origen, creado_por
    ) VALUES (
      p_contador_id, res.project_id, res.cliente_id, res.cliente_nombre,
      res.fecha, res.lectura_anterior, p_lectura_actual, res.consumo,
      res.tarifa_aplicada, res.tarifa_exceso_aplicada, res.canon_aplicado,
      res.monto_calculado, res.tipo_cobro,
      -- El estado inicial NO es del cliente. Una lectura nace como cargo
      -- PENDIENTE; cobrarla es otro acto, con su propio permiso y su rastro.
      'pendiente',
      res.fecha_lectura_anterior, res.dias_servicio,
      NULLIF(btrim(COALESCE(p_notas, '')), ''), v_gps, p_foto,
      res.es_reset, res.lectura_final_retirada, res.secuencia,
      btrim(p_idempotency_key), 'rpc',
      -- Redundante con trg_sellar_creado_por (20260731000000, modo 'forzar'),
      -- que lo volvería a sellar igual. Se escribe explícito porque la llave de
      -- idempotencia se busca por (llave, creado_por): dejar ese campo a cargo
      -- de un trigger de otra migración ataría el reintento a que ese trigger
      -- siga existiendo.
      (SELECT auth.uid())
    )
    RETURNING * INTO v_fila;
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('agua.lectura_autoritativa', 'off', true);
    -- Llave natural (contador, lectura, fecha) ya usada por otra operación:
    -- esta captura NO es la misma operación (la llave de idempotencia era
    -- distinta), así que es un duplicado real y se reporta como tal.
    RAISE EXCEPTION 'esta lectura ya está registrada (mismo contador, lectura y fecha)'
      USING ERRCODE = '23505';
  END;

  PERFORM set_config('agua.lectura_autoritativa', 'off', true);
  RETURN v_fila;
END;
$$;

COMMENT ON FUNCTION public.registrar_lectura(uuid, numeric, date, text, text, text, jsonb, boolean, numeric, date) IS
  'Registra una lectura de agua de forma AUTORITATIVA y en una sola transacción. Recibe sólo lo que el operador captura (contador, lectura, fecha, llave de idempotencia, notas, foto, GPS y los datos del reset); resuelve en el servidor lectura_anterior, consumo, tarifa/canon/exceso, monto, tipo_cobro, project_id, cliente_id y el estado inicial. SECURITY INVOKER: la autorización es la policy registros_insert, no un guard copiado. Reintento idempotente por p_idempotency_key.';

REVOKE EXECUTE ON FUNCTION public.registrar_lectura(uuid, numeric, date, text, text, text, jsonb, boolean, numeric, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_lectura(uuid, numeric, date, text, text, text, jsonb, boolean, numeric, date) TO authenticated;

-- ── 7. La transición del INSERT directo ─────────────────────────────────────
-- POR QUÉ NO SE REVOCA HOY MISMO. El INSERT directo no lo hace sólo el
-- navegador: la app nativa (Capacitor, iOS/Android) ya está publicada con el
-- bundle viejo y puede llevar lecturas en su cola local durante semanas.
-- Revocar el INSERT hoy no cierra un agujero, tira lecturas de campo que ya se
-- capturaron y que nadie puede volver a tomar (el medidor ya marca otra cosa).
--
-- LO QUE SÍ SE CIERRA HOY, QUE ES EL AGUJERO. Los valores que manda ese cliente
-- dejan de creerse: el trigger los RECALCULA con el MISMO motor que la RPC. A
-- partir de esta migración no hay dos juegos de reglas — hay dos puertas al
-- mismo cálculo, y una de ellas tiene fecha de cierre:
--
--     A PARTIR DEL 2026-12-01 EL INSERT DIRECTO LANZA 42501.
--
-- La fecha no es un deseo, está en el cuerpo. `origen = 'directo'` es la
-- métrica para confirmar que la cola se vació antes de que llegue.
--
-- `service_role` queda FUERA del trigger a propósito: es el sembrado de E2E,
-- los backfills y las edge functions —no el navegador, que es el sujeto del
-- problema— y varias de esas escrituras son históricas por definición (una
-- migración de datos inserta lecturas del año pasado, que la regla de
-- retroactividad rechazaría). Lo que escriba por ahí no queda sin vigilancia:
-- el reporte de 20260910000100 lo audita igual, sin importar el origen.
CREATE OR REPLACE FUNCTION public.agua_tg_lectura_autoritativa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ctx   record;
  res   record;
  v_rol text;
BEGIN
  -- La fila viene de registrar_lectura: ya está resuelta por este mismo motor.
  IF COALESCE(current_setting('agua.lectura_autoritativa', true), 'off') = 'on' THEN
    NEW.origen := 'rpc';
    RETURN NEW;
  END IF;

  BEGIN
    v_rol := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  EXCEPTION WHEN OTHERS THEN
    v_rol := '';
  END;
  IF v_rol = 'service_role' OR current_user = 'service_role' THEN
    NEW.origen := 'directo';
    RETURN NEW;
  END IF;

  IF now() >= timestamptz '2026-12-01 00:00:00+00' THEN
    RAISE EXCEPTION 'el INSERT directo en registros está cerrado desde 2026-12-01: usá registrar_lectura()'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.contador_id IS NULL THEN
    RAISE EXCEPTION 'una lectura sin contador no tiene base contra la cual calcularse; usá registrar_lectura()'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO ctx FROM public.agua_lectura_contexto(NEW.contador_id);
  SELECT * INTO res FROM public.agua_lectura_resolver(
    NEW.contador_id,
    NEW.lectura_actual,
    (COALESCE(NEW.fecha, now()) AT TIME ZONE ctx.zona_horaria)::date,
    NEW.notas,
    -- El cliente viejo no sabe expresar un reset con la lectura final del
    -- medidor retirado (mandaba consumo 0 y ya). Por eso el camino viejo NO
    -- puede registrar resets: una lectura que baja se rechaza y hay que
    -- capturarla por la vía nueva. Es el único caso en que el cliente viejo
    -- pierde una capacidad, y es justo el caso en que su número estaba mal.
    false, NULL, NULL
  );

  NEW.project_id             := res.project_id;
  NEW.cliente_id             := res.cliente_id;
  NEW.cliente_nombre         := COALESCE(res.cliente_nombre, NEW.cliente_nombre);
  NEW.fecha                  := res.fecha;
  NEW.lectura_anterior       := res.lectura_anterior;
  NEW.consumo                := res.consumo;
  NEW.tarifa_aplicada        := res.tarifa_aplicada;
  NEW.tarifa_exceso_aplicada := res.tarifa_exceso_aplicada;
  NEW.canon_aplicado         := res.canon_aplicado;
  NEW.monto_calculado        := res.monto_calculado;
  NEW.tipo_cobro             := res.tipo_cobro;
  NEW.fecha_lectura_anterior := res.fecha_lectura_anterior;
  NEW.dias_servicio          := res.dias_servicio;
  NEW.es_reset               := false;
  NEW.lectura_final_retirada := NULL;
  NEW.secuencia              := res.secuencia;
  NEW.origen                 := 'directo';

  -- Una lectura NACE como cargo pendiente. El estado de cobro y todo el
  -- desglose de la factura (IVA, mora, totales, sellos de emisión/pago) son
  -- actos posteriores con su propio permiso; que vengan en el INSERT es
  -- exactamente la forma de fabricarse un recibo pagado.
  NEW.estado           := 'pendiente';
  NEW.monto_pagado     := NULL;  NEW.fecha_pago       := NULL;
  NEW.factura_estado   := NULL;  NEW.fecha_vencimiento := NULL;
  NEW.iva_tasa         := NULL;  NEW.iva_monto        := NULL;
  NEW.monto_con_iva    := NULL;  NEW.total_a_pagar    := NULL;
  NEW.mora_monto       := NULL;  NEW.mora_aplicada_at := NULL;
  NEW.regla_mora_id    := NULL;
  NEW.emitida_at       := NULL;  NEW.pagada_at        := NULL;
  NEW.vencida_at       := NULL;  NEW.anulada_at       := NULL;
  NEW.deleted_at       := NULL;  NEW.deleted_by       := NULL;

  -- La foto es evidencia: o cuelga de la carpeta del cliente que resolvió el
  -- servidor, o no cuelga de ninguna. Se descarta la ruta en vez de rechazar la
  -- fila: perder la lectura del lecturista sería peor que perder la foto.
  IF NEW.foto IS NOT NULL
     AND (res.cliente_id IS NULL OR NEW.foto NOT LIKE res.cliente_id::text || '/%') THEN
    NEW.foto := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agua_tg_lectura_autoritativa() IS
  'BEFORE INSERT en registros: la fila que NO viene de registrar_lectura se RECALCULA con el mismo motor (agua_lectura_resolver) en vez de creerse. Cierra la transición del cliente viejo (app nativa publicada) sin tirar lecturas de campo. Desde 2026-12-01 el INSERT directo lanza 42501. service_role queda fuera (sembrado, backfills, edge functions).';

REVOKE EXECUTE ON FUNCTION public.agua_tg_lectura_autoritativa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_agua_lectura_autoritativa ON public.registros;
CREATE TRIGGER trg_agua_lectura_autoritativa
  BEFORE INSERT ON public.registros
  FOR EACH ROW EXECUTE FUNCTION public.agua_tg_lectura_autoritativa();
