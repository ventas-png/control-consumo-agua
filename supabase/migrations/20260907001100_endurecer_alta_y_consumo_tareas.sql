-- ════════════════════════════════════════════════════════════════════════════
-- El contrato del alta no tiene rangos, y el consumo no acepta lo omitido
-- ════════════════════════════════════════════════════════════════════════════
--
-- LOS AGUJEROS QUE CIERRA (seguimiento de 20260907000900 y 20260907001000,
-- que quedan INTACTAS: esto es append-only)
--
-- 1 · SUPER_ADMIN FUERA DEL CONTRATO. El WITH CHECK de 20260907000900 era
--     `is_super_admin() OR (contrato…)`: el contrato del alta —nacer
--     'pendiente' y sin sellos— aplicaba a todos MENOS al super_admin, que
--     seguía pudiendo insertar la tarea pre-cerrada, con fecha inventada y el
--     cierre atribuido a otra persona. El propio 000900 había argumentado que
--     «el contrato no distingue rangos dentro de la empresa»… y dejó el rango
--     de plataforma exento. La evidencia no admite excepciones por rol: si un
--     super_admin necesita corregir un histórico, lo hace por UPDATE, donde
--     el gate de evidencia y el sellado de actor SÍ corren.
--
-- 2 · LO OMITIDO CONSUMÍA. `consumir_insumos_tarea` aceptaba 'omitida' como
--     estado final consumible. Pero omitida significa que la tarea NO SE HIZO:
--     descontar inventario de trabajo no realizado es exactamente el descuadre
--     que 20260907000500 vino a evitar. `con_observacion` sí se conserva: en
--     este sistema es TRABAJO REALIZADO con un hallazgo (la UI captura
--     novedad/prioridad/requiere_mantenimiento al marcarla, sella
--     completada_en, y la tarjeta la administra junto a las novedades de
--     limpieza) — el insumo se gastó haciendo la tarea que reveló el problema.
--
-- 3 · DECIMALES FANTASMA Y UUIDs DISFRAZADOS. La cantidad validada como
--     «número JSON ≥ 0» aceptaba 0.001: `movimientos_suministro.cantidad` es
--     numeric(10,2), así que el INSERT lo REDONDEABA a 0.00 — un movimiento de
--     cero que reclama la fila sin descontar nada (ni terminal ni consumo:
--     lo peor de ambos). Y el chequeo de duplicados agrupaba por el TEXTO del
--     suministro_id: el mismo UUID en mayúsculas y minúsculas pasaba como dos
--     entradas distintas, y el LATERAL (LIMIT 1) elegía una al azar.
--
-- QUÉ HACE
--
-- · `tareas_bloque_insert` se re-declara con el contrato PRIMERO y el origen
--   después:
--
--     estado = 'pendiente' AND … IS NULL …
--     AND ( is_super_admin() OR EXISTS (empresa + permisos) )
--
--   Mismas tres familias y misma forma envuelta (#799). service_role conserva
--   su bypass: en Supabase ese rol tiene BYPASSRLS y no pasa por policies —
--   los seeds internos no cambian.
--
-- · `consumir_insumos_tarea` rechaza 'pendiente' (sin cierre no hay consumo,
--   como en 20260907001000) y ahora también 'omitida' y cualquier estado que
--   no sea 'completada' o 'con_observacion' — ANTES de tocar movimiento o
--   stock alguno.
--
-- · El motor `tarea_bloque_consumir_reclamado` exige, tras el cast numérico,
--   cantidad exacta a DOS decimales (v_cant IS DISTINCT FROM round(v_cant, 2)
--   — nada que numeric(10,2) redondearía en silencio), y agrupa los duplicados
--   por el UUID NORMALIZADO (cast a uuid, no texto): dos representaciones del
--   mismo suministro se rechazan con 22023 sin escribir nada.
--
-- LO QUE NO HACE: no toca `cerrar_tarea_y_consumir_insumos` (ya solo cierra
-- en 'completada' y reintenta sobre 'completada'), ni el reclamo FOR UPDATE,
-- ni el cero terminal, ni el gate de evidencia, ni las funciones de
-- 20260907000800.
--
-- IDEMPOTENTE: DROP POLICY IF EXISTS → CREATE POLICY; CREATE OR REPLACE de
-- las dos funciones; REVOKE/GRANT re-declarados (no-op si ya están).
--
-- REVERSA: recrear la policy con el cuerpo de 20260907000900 y las dos
-- funciones con sus cuerpos de 20260907001000 (que son los permisivos).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. El contrato del alta aplica a TODOS los autenticados
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "tareas_bloque_insert" ON public.tareas_bloque;
CREATE POLICY "tareas_bloque_insert" ON public.tareas_bloque
  FOR INSERT TO authenticated
  WITH CHECK (
    estado = 'pendiente'
    AND completada_en IS NULL
    AND completado_por IS NULL
    AND anulada_en IS NULL
    AND anulada_por IS NULL
    AND motivo_anulacion IS NULL
    AND motivo_sin_evidencia IS NULL
    AND (
      (SELECT public.is_super_admin())
      OR EXISTS (
        SELECT 1 FROM public.bloques_turno b
        WHERE b.id = tareas_bloque.bloque_id
          AND b.company_id = (SELECT public.get_my_company_id())
          AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
               OR public.user_has_permission('condominios.tab.turnos')
               OR public.user_has_permission('condominios.tab.prog_limpieza'))
      )
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2. El motor: dos decimales exactos y duplicados por UUID normalizado
-- ────────────────────────────────────────────────────────────────────────────
-- Mismo cuerpo que 20260907001000 salvo las dos validaciones nuevas (marcadas
-- «20260907001100»). Sigue sin SECURITY DEFINER a propósito: solo lo invocan
-- las dos RPC, que ya autorizaron, y el REVOKE lo deja fuera del alcance del
-- cliente.
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
      -- 20260907001100 · La columna es numeric(10,2): un tercer decimal no se
      -- guardaría, se REDONDEARÍA en silencio — 0.001 se volvía un movimiento
      -- de 0.00 que reclama la fila sin descontar nada. Lo que no cabe exacto
      -- en dos decimales se rechaza, no se acomoda.
      IF v_cant IS DISTINCT FROM round(v_cant, 2) THEN
        RAISE EXCEPTION 'CONSUMO: la cantidad de % tiene más de dos decimales (%)', v_uuid, v_cant
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      IF v_cant > 99999999.99 THEN
        RAISE EXCEPTION 'CONSUMO: la cantidad de % excede numeric(10,2)', v_uuid
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;
  END LOOP;

  -- 20260907001100 · Por el UUID NORMALIZADO, no por el texto: 'ABC…' y
  -- 'abc…' son EL MISMO suministro, y agrupar por texto dejaba pasar el par
  -- para que el LATERAL (LIMIT 1) eligiera uno al azar. El cast es seguro:
  -- el loop de arriba ya garantizó que todos castean.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_consumos) AS j(item)
    GROUP BY ((j.item ->> 'suministro_id')::uuid) HAVING count(*) > 1
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
  'Motor compartido del consumo: valida el JSON (tipos, dos decimales exactos, duplicados por uuid normalizado, pertenencia al plan), RECLAMA cada fila del plan con FOR UPDATE re-comprobando movimiento_id/no_usado_en, sella el «no usado» como terminal y crea exactamente una salida por fila. Solo lo invocan cerrar_tarea_y_consumir_insumos y consumir_insumos_tarea, que ya autorizaron.';

REVOKE EXECUTE ON FUNCTION public.tarea_bloque_consumir_reclamado(uuid, jsonb, uuid, uuid, text, date)
  FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Consumir exige trabajo REALIZADO: completada o con_observacion
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma que 20260907000500/001000 (los llamadores no se rompen), mismo
-- motor con lock. 'con_observacion' se conserva PORQUE es trabajo realizado
-- con un hallazgo — la pantalla la marca capturando novedad/prioridad y sella
-- completada_en; el insumo se gastó haciendo la tarea que reveló el problema.
-- 'omitida' es que NO se hizo: lo no realizado no gasta insumos, nunca.
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

  -- Los rechazos van ANTES de cualquier movimiento o cambio de stock.
  IF v_estado = 'pendiente' THEN
    RAISE EXCEPTION 'CONSUMO: la tarea sigue en pendiente — el consumo se declara junto al cierre (cerrar_tarea_y_consumir_insumos)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_estado NOT IN ('completada', 'con_observacion') THEN
    -- 'omitida' incluida: la tarea NO se realizó, y lo que no se hizo no
    -- gasta insumos. Cualquier otro valor cae aquí también.
    RAISE EXCEPTION 'CONSUMO: la tarea quedó en % — solo el trabajo realizado (completada o con_observacion) consume insumos', v_estado
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
  SELECT * FROM public.tarea_bloque_consumir_reclamado(
    p_tarea_id, p_consumos, v_company, v_project, v_titulo, v_fecha);
END;
$$;

COMMENT ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) IS
  'Declara el consumo de insumos de una tarea con TRABAJO REALIZADO: completada, o con_observacion (hecha con un hallazgo). Rechaza pendiente (el consumo va junto al cierre) y omitida (lo no realizado no gasta insumos), antes de tocar movimiento o stock. Mismo motor con reclamo FOR UPDATE que cerrar_tarea_y_consumir_insumos.';

REVOKE EXECUTE ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.consumir_insumos_tarea(uuid, jsonb) TO authenticated, service_role;
