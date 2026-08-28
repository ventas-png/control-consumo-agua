-- ════════════════════════════════════════════════════════════════════════════
-- Cierre y consumo son UNA transacción — y el reclamo del insumo, un lock
-- ════════════════════════════════════════════════════════════════════════════
--
-- LOS AGUJEROS QUE CIERRA (seguimiento de 20260907000500 / #809)
--
-- 1 · DOS OPERACIONES. La pantalla cerraba la tarea con un UPDATE y DESPUÉS
--     llamaba `consumir_insumos_tarea`. Si la segunda fallaba —o la respuesta
--     se perdía— la tarea quedaba cerrada con el almacén intacto, y nada
--     volvía a intentarlo: el descuadre exacto que 20260907000500 vino a
--     evitar, ahora entre dos requests en vez de entre dos columnas.
--
-- 2 · IDEMPOTENCIA SOLO SECUENCIAL. «La RPC sólo toca filas con movimiento_id
--     IS NULL» es cierto… por llamada. Dos llamadas CONCURRENTES leen las
--     mismas filas como pendientes antes de que ninguna escriba, y cada una
--     inserta su salida: doble movimiento y doble descuento. El SELECT del
--     plan iba sin FOR UPDATE.
--
-- 3 · CONSUMO SIN CIERRE. La RPC no miraba el estado de la tarea: se podía
--     descontar inventario de una tarea PENDIENTE — o de cualquiera — sin
--     cerrarla jamás.
--
-- 4 · EL CERO NO ERA TERMINAL. «No lo necesité» escribía motivo_no_usado pero
--     dejaba movimiento_id IS NULL: la fila seguía siendo reclamable y una
--     llamada posterior (con otro payload, o sin payload: COALESCE al plan)
--     la consumía por accidente.
--
-- 5 · JSON SIN VALIDAR. `(item->>'cantidad')::numeric` acepta '"NaN"' — y NaN
--     no es `<= 0`, así que generaba un movimiento con cantidad NaN que
--     envenena el stock. Un suministro ajeno al plan se ignoraba en silencio;
--     un duplicado en el arreglo elegía uno al azar (LIMIT 1).
--
-- QUÉ HACE
--
-- · `cerrar_tarea_y_consumir_insumos(p_tarea_id, p_estado, p_motivo_sin_
--   evidencia, p_consumos)`: UNA función = UNA transacción. Bloquea la fila de
--   la tarea (FOR UPDATE), autoriza (assert_company_scope + las mismas
--   familias que el UPDATE de 20260907000100), valida la transición
--   (pendiente → completada; los otros finales no consumen y conservan su
--   camino), valida el JSON ANTES de escribir nada, cierra la tarea — el
--   UPDATE dispara trg_exigir_evidencia (la evidencia se exige DENTRO de la
--   transacción) y trg_sellar_cierre (el actor lo sella la BD) — y consume.
--   Cualquier fallo revierte TODO: la tarea sigue pendiente y el stock no
--   cambió. Reintento tras respuesta perdida: la tarea ya está completada →
--   se re-corre solo el motor de consumo, que no encuentra filas reclamables
--   y devuelve 0 — como máximo un movimiento y un descuento por fila.
--
-- · EL RECLAMO ES UN LOCK. El motor compartido recorre el plan con
--   `FOR UPDATE OF tbs`: bajo READ COMMITTED, una fila que otro proceso ya
--   reclamó y COMMITEÓ se re-evalúa al soltarse el lock (EvalPlanQual) y el
--   `movimiento_id IS NULL AND no_usado_en IS NULL` se RE-COMPRUEBA sobre la
--   versión nueva — la fila desaparece del loop. Y el claim mismo re-verifica
--   (`WHERE ... AND movimiento_id IS NULL`) con GET DIAGNOSTICS: si alguna
--   vez tocara 0 filas, se aborta en vez de dejar un movimiento huérfano.
--
-- · EL CERO ES TERMINAL. Columna nueva `no_usado_en`: «no lo necesité» sella
--   fecha y motivo, y la fila deja de ser reclamable (el filtro y el índice
--   parcial la excluyen). Deshacerlo es una corrección explícita del admin
--   (la policy de UPDATE ya lo permite), no un accidente de reintento. CHECK:
--   consumida y descartada a la vez es un estado imposible. Se backfillea el
--   legado: lo que el RPC viejo marcó como no usado pasa a ser terminal.
--
-- · JSON ESTRICTO: arreglo de objetos; suministro_id uuid válido; cantidad —
--   si viene — número JSON (JSON no admite NaN/Infinity: el tipo ya es la
--   prueba de finitud), no negativa y dentro de numeric(10,2); sin
--   duplicados; y TODO suministro debe pertenecer al plan de la tarea. Lo
--   inválido aborta con 22023 antes de escribir nada.
--
-- · `consumir_insumos_tarea` SE ENDURECE, no se borra: misma firma, mismo
--   motor con lock, y ahora EXIGE que la tarea ya esté cerrada en un estado
--   canónico final — consumir sobre una pendiente se rechaza. Sigue siendo el
--   camino para declarar consumo DESPUÉS de un cierre (tareas cerradas antes
--   de esta migración, correcciones del admin tras borrar un movimiento).
--
-- LO QUE NO HACE: no toca el motor de stock (20260821000200 sigue siendo la
-- única fuente), ni el gate de evidencia, ni la política de «sin stock no se
-- bloquea» (se registra y se avisa; el piso en 0 es del motor).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP INDEX/
-- CONSTRAINT guardados, y el backfill sólo toca filas sin sellar.
--
-- REVERSA: recrear consumir_insumos_tarea con su cuerpo de 20260907000500
-- (que es el vulnerable); DROP FUNCTION cerrar_tarea_y_consumir_insumos y
-- tarea_bloque_consumir_reclamado; el índice parcial vuelve a su predicado
-- viejo; la columna no_usado_en puede quedarse (es un sello informativo).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. El estado terminal del «no lo necesité»
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tarea_bloque_suministros
  ADD COLUMN IF NOT EXISTS no_usado_en timestamptz;

COMMENT ON COLUMN public.tarea_bloque_suministros.no_usado_en IS
  'Sello del «no lo necesité»: junto a motivo_no_usado, saca la fila del conjunto reclamable — un reintento posterior ya no puede consumirla por accidente. NULL + movimiento_id NULL = todavía pendiente. Deshacerlo es una corrección explícita (UPDATE del admin), no un efecto de reintento.';

-- Consumida Y descartada a la vez es un estado imposible.
DO $CHK$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.tarea_bloque_suministros'::regclass
                   AND conname = 'tbs_consumo_o_descarte_check') THEN
    ALTER TABLE public.tarea_bloque_suministros
      ADD CONSTRAINT tbs_consumo_o_descarte_check
      CHECK (movimiento_id IS NULL OR no_usado_en IS NULL);
  END IF;
END;
$CHK$;

-- Backfill del legado: lo que el RPC viejo declaró como no usado quedaba
-- reclamable; con la semántica nueva pasa a ser terminal, que es lo que el
-- operativo quiso decir.
UPDATE public.tarea_bloque_suministros
   SET no_usado_en = now()
 WHERE motivo_no_usado IS NOT NULL
   AND movimiento_id IS NULL
   AND no_usado_en IS NULL;

-- El conjunto reclamable ahora excluye también los descartados.
DROP INDEX IF EXISTS idx_tbs_pendientes;
CREATE INDEX IF NOT EXISTS idx_tbs_pendientes
  ON public.tarea_bloque_suministros(tarea_id)
  WHERE movimiento_id IS NULL AND no_usado_en IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. El motor compartido: validar, RECLAMAR con lock, mover
-- ────────────────────────────────────────────────────────────────────────────
-- Sin SECURITY DEFINER a propósito: sólo lo invocan las dos RPC de abajo, que
-- ya corren como el dueño — heredar ese contexto basta y es menos superficie.
-- El REVOKE de abajo deja la llamada directa fuera del alcance de los roles
-- del cliente.
CREATE OR REPLACE FUNCTION public.tarea_bloque_consumir_reclamado(
  p_tarea_id uuid,
  p_consumos jsonb,
  p_company  uuid,
  p_project  uuid,
  p_titulo   text,
  p_fecha    date
)
RETURNS TABLE (
  consumidos int,
  no_usados  int,
  sin_stock  jsonb
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  item       jsonb;
  v_uuid     uuid;
  v_cant     numeric;
  fila       record;
  v_mov      uuid;
  v_stock    numeric(10,2);
  v_tocadas  int;
  v_faltante jsonb := '[]'::jsonb;
BEGIN
  consumidos := 0;
  no_usados  := 0;
  p_consumos := COALESCE(p_consumos, '[]'::jsonb);

  -- ── Validación ANTES de escribir nada ────────────────────────────────────
  IF jsonb_typeof(p_consumos) <> 'array' THEN
    RAISE EXCEPTION 'CONSUMO: p_consumos debe ser un arreglo JSON (llegó %)', jsonb_typeof(p_consumos)
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_consumos) LOOP
    IF jsonb_typeof(item) <> 'object' THEN
      RAISE EXCEPTION 'CONSUMO: cada consumo debe ser un objeto {suministro_id, cantidad} (llegó %)', jsonb_typeof(item)
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    BEGIN
      v_uuid := (item ->> 'suministro_id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR not_null_violation THEN
      v_uuid := NULL;
    END;
    IF v_uuid IS NULL THEN
      RAISE EXCEPTION 'CONSUMO: suministro_id ausente o no es un uuid válido'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF item ? 'cantidad' THEN
      -- Número JSON o nada: JSON no representa NaN ni Infinity, así que exigir
      -- el TIPO es la prueba de finitud — y mata el '"NaN"'::numeric que el
      -- cast desde texto aceptaba.
      IF jsonb_typeof(item -> 'cantidad') <> 'number' THEN
        RAISE EXCEPTION 'CONSUMO: la cantidad de % debe ser un número JSON (llegó %)',
          v_uuid, jsonb_typeof(item -> 'cantidad')
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_cant := (item ->> 'cantidad')::numeric;
      IF v_cant < 0 THEN
        RAISE EXCEPTION 'CONSUMO: la cantidad de % no puede ser negativa (%)', v_uuid, v_cant
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF v_cant > 99999999.99 THEN
        RAISE EXCEPTION 'CONSUMO: la cantidad de % excede numeric(10,2)', v_uuid
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_consumos) AS j(item)
    GROUP BY j.item ->> 'suministro_id' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CONSUMO: hay suministros repetidos en el arreglo'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT (j.item ->> 'suministro_id')::uuid INTO v_uuid
  FROM jsonb_array_elements(p_consumos) AS j(item)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tarea_bloque_suministros tbs
    WHERE tbs.tarea_id = p_tarea_id
      AND tbs.suministro_id = (j.item ->> 'suministro_id')::uuid
  )
  LIMIT 1;
  IF v_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'CONSUMO: el suministro % no pertenece al plan de esta tarea', v_uuid
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── El reclamo: FOR UPDATE y re-chequeo, no idempotencia de fe ───────────
  -- Bajo READ COMMITTED, una fila que otro proceso reclamó y commiteó se
  -- re-evalúa al soltarse su lock y el predicado se RE-COMPRUEBA sobre la
  -- versión nueva: desaparece de este loop. Dos cierres concurrentes producen
  -- como máximo un movimiento por fila — el segundo lee un plan ya reclamado.
  FOR fila IN
    SELECT tbs.id,
           tbs.suministro_id,
           tbs.nombre_suministro,
           tbs.unidad_medida,
           COALESCE(c.cantidad, tbs.cantidad_planificada) AS cantidad
    FROM public.tarea_bloque_suministros tbs
    LEFT JOIN LATERAL (
      SELECT (j.item ->> 'cantidad')::numeric AS cantidad
      FROM jsonb_array_elements(p_consumos) AS j(item)
      WHERE (j.item ->> 'suministro_id')::uuid = tbs.suministro_id
        AND j.item ? 'cantidad'
      LIMIT 1
    ) c ON true
    WHERE tbs.tarea_id = p_tarea_id
      AND tbs.movimiento_id IS NULL
      AND tbs.no_usado_en IS NULL
    FOR UPDATE OF tbs
  LOOP
    IF fila.cantidad = 0 THEN
      -- Terminal: la fila sale del conjunto reclamable. Un reintento posterior
      -- ya no puede consumirla por accidente.
      UPDATE public.tarea_bloque_suministros
         SET no_usado_en    = now(),
             motivo_no_usado = COALESCE(motivo_no_usado, 'Declarado como no usado al cerrar la tarea')
       WHERE id = fila.id
         AND movimiento_id IS NULL AND no_usado_en IS NULL;
      GET DIAGNOSTICS v_tocadas = ROW_COUNT;
      IF v_tocadas <> 1 THEN
        RAISE EXCEPTION 'CONSUMO: la fila % cambió bajo el lock (descarte)', fila.id;
      END IF;
      no_usados := no_usados + 1;
      CONTINUE;
    END IF;

    SELECT s.stock_actual INTO v_stock
    FROM public.suministros_condominio s WHERE s.id = fila.suministro_id;

    -- Se REGISTRA igual: el insumo se gastó de verdad y el piso en 0 lo pone
    -- suministros_tg_stock. Esto es el aviso, no un bloqueo (20260907000500).
    IF COALESCE(v_stock, 0) < fila.cantidad THEN
      v_faltante := v_faltante || jsonb_build_object(
        'suministro_id', fila.suministro_id,
        'nombre',        fila.nombre_suministro,
        'unidad',        fila.unidad_medida,
        'pedido',        fila.cantidad,
        'disponible',    COALESCE(v_stock, 0));
    END IF;

    INSERT INTO public.movimientos_suministro
      (company_id, project_id, suministro_id, tipo, cantidad, motivo, fecha,
       origen_tabla, origen_id)
    VALUES
      (p_company, p_project, fila.suministro_id, 'salida', fila.cantidad,
       'Tarea de turno: ' || COALESCE(p_titulo, '(sin título)'),
       COALESCE(p_fecha, CURRENT_DATE),
       'tareas_bloque', p_tarea_id)
    RETURNING id INTO v_mov;

    -- Bajo el FOR UPDATE esto no puede tocar 0 filas; si alguna vez lo hiciera,
    -- abortar revierte también el movimiento — jamás una salida huérfana.
    UPDATE public.tarea_bloque_suministros
       SET movimiento_id = v_mov, motivo_no_usado = NULL, no_usado_en = NULL
     WHERE id = fila.id
       AND movimiento_id IS NULL AND no_usado_en IS NULL;
    GET DIAGNOSTICS v_tocadas = ROW_COUNT;
    IF v_tocadas <> 1 THEN
      RAISE EXCEPTION 'CONSUMO: la fila % cambió bajo el lock (reclamo)', fila.id;
    END IF;

    consumidos := consumidos + 1;
  END LOOP;

  sin_stock := v_faltante;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.tarea_bloque_consumir_reclamado(uuid, jsonb, uuid, uuid, text, date) IS
  'Motor compartido del consumo: valida el JSON (tipos, duplicados, pertenencia al plan), RECLAMA cada fila del plan con FOR UPDATE re-comprobando movimiento_id/no_usado_en, sella el «no usado» como terminal y crea exactamente una salida por fila. Solo lo invocan cerrar_tarea_y_consumir_insumos y consumir_insumos_tarea, que ya autorizaron.';

REVOKE EXECUTE ON FUNCTION public.tarea_bloque_consumir_reclamado(uuid, jsonb, uuid, uuid, text, date)
  FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. La RPC nueva: cerrar Y consumir, o nada
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cerrar_tarea_y_consumir_insumos(
  p_tarea_id            uuid,
  p_estado              text,
  p_motivo_sin_evidencia text  DEFAULT NULL,
  p_consumos            jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  consumidos int,
  no_usados  int,
  sin_stock  jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  v_titulo  text;
  v_fecha   date;
  v_estado  text;
BEGIN
  -- Solo el cierre por 'completada' consume: 'omitida' es que NO se hizo y
  -- 'con_observacion' captura su hallazgo por su propio camino. Aceptar aquí
  -- otros finales solo daría una segunda puerta que mantener.
  IF p_estado IS DISTINCT FROM 'completada' THEN
    RAISE EXCEPTION 'CIERRE: esta RPC cierra en ''completada'' (llegó %); los otros estados no consumen insumos', p_estado
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- La fila de la tarea SE BLOQUEA: dos cierres concurrentes se serializan
  -- aquí, y el segundo ya ve el estado que dejó el primero.
  SELECT b.company_id, b.project_id, t.titulo, b.fecha, t.estado
    INTO v_company, v_project, v_titulo, v_fecha, v_estado
  FROM public.tareas_bloque t
  JOIN public.bloques_turno b ON b.id = t.bloque_id
  WHERE t.id = p_tarea_id
  FOR UPDATE OF t;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = '42704';
  END IF;

  -- La SECURITY DEFINER se salta la RLS: este control ES el control. Mismo
  -- scope y mismas familias que el UPDATE de tareas_bloque (20260907000100).
  PERFORM public.assert_company_scope(v_company);
  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.tareas_personal')
          OR public.user_has_permission('condominios.tab.turnos')
          OR public.user_has_permission('condominios.tab.revision_tareas')
          OR public.user_has_permission('condominios.tab.prog_limpieza')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_estado = 'pendiente' THEN
    -- El cierre. El UPDATE dispara trg_exigir_evidencia (la evidencia se exige
    -- DENTRO de esta transacción: si falta, TODO revierte y el stock no se
    -- tocó) y trg_sellar_cierre (completado_por lo sella la BD con el actor
    -- real). El CHECK de 20260907000700 vigila el dominio.
    UPDATE public.tareas_bloque
       SET estado = 'completada',
           completada_en = now(),
           motivo_sin_evidencia = COALESCE(p_motivo_sin_evidencia, motivo_sin_evidencia)
     WHERE id = p_tarea_id;
  ELSIF v_estado = 'completada' THEN
    -- Reintento tras respuesta perdida, o tarea cerrada antes de esta
    -- migración: no hay nada que cerrar — se re-corre solo el motor, que es
    -- idempotente por el reclamo (a lo sumo termina lo que quede pendiente).
    NULL;
  ELSE
    RAISE EXCEPTION 'CIERRE: la tarea ya se cerró como %', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT * FROM public.tarea_bloque_consumir_reclamado(
    p_tarea_id, p_consumos, v_company, v_project, v_titulo, v_fecha);
END;
$$;

COMMENT ON FUNCTION public.cerrar_tarea_y_consumir_insumos(uuid, text, text, jsonb) IS
  'Cierra una tarea de turno en completada Y consume sus insumos en LA MISMA transacción: si la evidencia falta o el consumo es inválido, todo revierte — la tarea sigue pendiente y el stock no cambia. Reintento seguro: sobre una tarea ya completada solo corre el motor de consumo, que no re-reclama filas. Bloquea la tarea y cada fila del plan (FOR UPDATE).';

REVOKE EXECUTE ON FUNCTION public.cerrar_tarea_y_consumir_insumos(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cerrar_tarea_y_consumir_insumos(uuid, text, text, jsonb) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. La RPC vieja se endurece: consumir exige una tarea YA CERRADA
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma (los llamadores no se rompen), mismo motor con lock. Sigue
-- siendo el camino para declarar consumo DESPUÉS de un cierre: tareas cerradas
-- antes de esta migración, o correcciones del admin tras borrar un movimiento.
-- Lo que ya no puede: consumir de una tarea pendiente.
CREATE OR REPLACE FUNCTION public.consumir_insumos_tarea(
  p_tarea_id uuid,
  p_consumos jsonb DEFAULT '[]'::jsonb
)
RETURNS TABLE (
  consumidos int,
  no_usados  int,
  sin_stock  jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  v_titulo  text;
  v_fecha   date;
  v_estado  text;
BEGIN
  SELECT b.company_id, b.project_id, t.titulo, b.fecha, t.estado
    INTO v_company, v_project, v_titulo, v_fecha, v_estado
  FROM public.tareas_bloque t
  JOIN public.bloques_turno b ON b.id = t.bloque_id
  WHERE t.id = p_tarea_id
  FOR UPDATE OF t;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = '42704';
  END IF;

  PERFORM public.assert_company_scope(v_company);
  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.tareas_personal')
          OR public.user_has_permission('condominios.tab.turnos')
          OR public.user_has_permission('condominios.tab.revision_tareas')
          OR public.user_has_permission('condominios.tab.prog_limpieza')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  -- El inventario se consume HACIENDO la tarea: sobre una pendiente no hay
  -- consumo que declarar. El cierre con consumo va junto, en
  -- cerrar_tarea_y_consumir_insumos.
  IF v_estado NOT IN ('completada', 'con_observacion', 'omitida') THEN
    RAISE EXCEPTION 'CONSUMO: la tarea sigue en % — el consumo se declara junto al cierre (cerrar_tarea_y_consumir_insumos)', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT * FROM public.tarea_bloque_consumir_reclamado(
    p_tarea_id, p_consumos, v_company, v_project, v_titulo, v_fecha);
END;
$$;

COMMENT ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) IS
  'Declara el consumo de insumos de una tarea YA CERRADA (estado canónico final): tareas cerradas antes de 20260907001000 o correcciones tras borrar un movimiento. Rechaza tareas pendientes. Mismo motor con reclamo FOR UPDATE que cerrar_tarea_y_consumir_insumos: nunca más de una salida por fila del plan.';

REVOKE EXECUTE ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) TO authenticated, service_role;
