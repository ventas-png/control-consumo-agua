\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Invariantes de 20260905000500 (consumo de insumos), verificadas EJECUTANDO
-- contra Postgres. Nada de esto se comprueba leyendo el SQL: que el stock baje,
-- que baje UNA sola vez, y que un conserje sin permiso de almacén pueda hacerlo
-- por la RPC pero no a mano, son hechos del motor.
--
-- OJO CON LA IDENTIDAD: `set_config(…, true)` es LOCAL A LA TRANSACCIÓN y cada
-- bloque DO de psql es su propia transacción. Todo bloque que invoque la RPC
-- vuelve a declarar `app.uid`.

-- ════════════════════════════════════════════════════════════════════════════
-- A · LA COPIA DEL PLAN
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE v_n int; v_nombre text; v_unidad text; v_cant numeric;
BEGIN
  -- 1 · La receta se copió a la tarea, con nombre y unidad CONGELADOS.
  SELECT count(*) INTO v_n FROM public.tarea_bloque_suministros
   WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '1a: se copiaron % insumos, se esperaban 2 (los activos)', v_n; END IF;

  SELECT nombre_suministro, unidad_medida, cantidad_planificada
    INTO v_nombre, v_unidad, v_cant
  FROM public.tarea_bloque_suministros
   WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001'
     AND suministro_id = '50000000-0000-0000-0000-000000000001';
  IF v_nombre <> 'Cloro' OR v_unidad <> 'litro' OR v_cant <> 2 THEN
    RAISE EXCEPTION '1b: el snapshot no coincide (%, %, %)', v_nombre, v_unidad, v_cant; END IF;

  -- Renombrar el catálogo NO reescribe lo ya copiado: es todo el punto de
  -- «copia, no join».
  PERFORM set_config('conta.allow_system_write', 'on', true);
  UPDATE public.suministros_condominio SET nombre = 'Cloro granulado'
   WHERE id = '50000000-0000-0000-0000-000000000001';
  PERFORM set_config('conta.allow_system_write', 'off', true);

  IF (SELECT nombre_suministro FROM public.tarea_bloque_suministros
       WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001'
         AND suministro_id = '50000000-0000-0000-0000-000000000001') <> 'Cloro' THEN
    RAISE EXCEPTION '1c: renombrar el catálogo reescribió la orden de aquel día'; END IF;

  RAISE NOTICE 'OK 1  el plan se copia a la tarea y queda congelado';
END;
$$;

DO $$
BEGIN
  -- 2 · El insumo dado de baja no se arrastra: la receta quedó vieja, y
  -- descontar de un insumo inactivo sólo ensucia el almacén.
  IF EXISTS (SELECT 1 FROM public.tarea_bloque_suministros
              WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001'
                AND suministro_id = '50000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION '2: se copió un insumo dado de baja'; END IF;

  RAISE NOTICE 'OK 2  el insumo inactivo no se copia a tareas nuevas';
END;
$$;

DO $$
BEGIN
  -- 3 · Sin receta no hay copia, y no es un error: ni la plantilla sin insumos
  -- ni la tarea ad-hoc (plantilla_id NULL) deben reventar el alta del turno.
  IF EXISTS (SELECT 1 FROM public.tarea_bloque_suministros
              WHERE tarea_id = 'a1000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION '3a: una plantilla sin insumos generó filas'; END IF;
  IF EXISTS (SELECT 1 FROM public.tarea_bloque_suministros
              WHERE tarea_id = 'a1000000-0000-0000-0000-000000000004') THEN
    RAISE EXCEPTION '3b: una tarea ad-hoc generó filas'; END IF;

  RAISE NOTICE 'OK 3  sin receta no hay copia, y crear la tarea no falla';
END;
$$;

DO $$
DECLARE v_tarea uuid; v_n int;
BEGIN
  -- 4 · La ruta de materialización también copia. Es el INSERT masivo de
  -- 20260905000300: si el trigger sólo cubriera el alta manual, el camino por
  -- el que entran casi todas las tareas quedaría sin insumos.
  -- Carla y no Ana: `materializar_rutinas_turno` exige `prog_limpieza` o
  -- `turnos`, y Ana sólo tiene `tareas_personal` — que es justo lo que hace
  -- honesto al invariante 5.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000c', true);
  PERFORM public.materializar_rutinas_turno(
    '11111111-0000-0000-0000-000000000001', '2026-09-20', '2026-09-20');

  SELECT id INTO v_tarea FROM public.tareas_bloque
   WHERE bloque_id = '70000000-0000-0000-0000-000000000003';
  IF v_tarea IS NULL THEN
    RAISE EXCEPTION '4a: la materialización no generó la tarea'; END IF;

  SELECT count(*) INTO v_n FROM public.tarea_bloque_suministros WHERE tarea_id = v_tarea;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '4b: la tarea materializada trae % insumos, se esperaban 2', v_n; END IF;

  RAISE NOTICE 'OK 4  materializar rutinas también copia el plan';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · EL CONSUMO
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE r record; v_stock numeric;
BEGIN
  -- 5 · Descuenta de verdad, y la salida queda trazada al origen.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000001',
    '[{"suministro_id": "50000000-0000-0000-0000-000000000001", "cantidad": 2}]'::jsonb);

  IF r.consumidos <> 1 THEN
    RAISE EXCEPTION '5a: consumidos = %, se esperaba 1', r.consumidos; END IF;

  SELECT stock_actual INTO v_stock FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_stock <> 8 THEN
    RAISE EXCEPTION '5b: el stock quedó en % y debía quedar en 8', v_stock; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.movimientos_suministro
     WHERE origen_tabla = 'tareas_bloque'
       AND origen_id = 'a1000000-0000-0000-0000-000000000001'
       AND tipo = 'salida' AND cantidad = 2) THEN
    RAISE EXCEPTION '5c: la salida no quedó trazada al origen'; END IF;

  -- El puntero de vuelta: es lo que hace idempotente a la RPC.
  IF (SELECT movimiento_id FROM public.tarea_bloque_suministros
       WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001'
         AND suministro_id = '50000000-0000-0000-0000-000000000001') IS NULL THEN
    RAISE EXCEPTION '5d: no se apuntó el movimiento en el plan'; END IF;

  RAISE NOTICE 'OK 5  consumir descuenta el stock y deja la salida trazada';
END;
$$;

DO $$
DECLARE r record; v_stock numeric;
BEGIN
  -- 6 · Volver a llamarla NO vuelve a descontar. Reintentar un cierre, o dos
  -- pestañas abiertas, no puede vaciar el almacén.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000001',
    '[{"suministro_id": "50000000-0000-0000-0000-000000000001", "cantidad": 2}]'::jsonb);

  IF r.consumidos <> 0 THEN
    RAISE EXCEPTION '6a: la segunda llamada consumió % filas', r.consumidos; END IF;

  SELECT stock_actual INTO v_stock FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_stock <> 8 THEN
    RAISE EXCEPTION '6b: el stock bajó dos veces (quedó en %)', v_stock; END IF;

  IF (SELECT count(*) FROM public.movimientos_suministro
       WHERE origen_id = 'a1000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION '6c: se duplicó el movimiento'; END IF;

  RAISE NOTICE 'OK 6  volver a consumir la misma tarea no descuenta dos veces';
END;
$$;

DO $$
DECLARE r record; v_stock numeric;
BEGIN
  -- 7 · La cantidad DECLARADA manda sobre la planificada, y `0` significa «no
  -- lo necesité»: no genera movimiento, pero sí deja constancia.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000002',
    '[{"suministro_id": "50000000-0000-0000-0000-000000000001", "cantidad": 5},
      {"suministro_id": "50000000-0000-0000-0000-000000000002", "cantidad": 0}]'::jsonb);

  IF r.consumidos <> 1 OR r.no_usados <> 1 THEN
    RAISE EXCEPTION '7a: consumidos=% no_usados=%, se esperaba 1 y 1',
      r.consumidos, r.no_usados; END IF;

  -- Planificaba 2, se declararon 5: manda lo declarado (8 - 5 = 3).
  SELECT stock_actual INTO v_stock FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000001';
  IF v_stock <> 3 THEN
    RAISE EXCEPTION '7b: se descontó lo planificado y no lo declarado (stock %)', v_stock; END IF;

  IF (SELECT motivo_no_usado FROM public.tarea_bloque_suministros
       WHERE tarea_id = 'a1000000-0000-0000-0000-000000000002'
         AND suministro_id = '50000000-0000-0000-0000-000000000002') IS NULL THEN
    RAISE EXCEPTION '7c: el «no lo usé» no dejó constancia'; END IF;

  IF (SELECT stock_actual FROM public.suministros_condominio
       WHERE id = '50000000-0000-0000-0000-000000000002') <> 1 THEN
    RAISE EXCEPTION '7d: la cantidad 0 movió el stock'; END IF;

  RAISE NOTICE 'OK 7  manda la cantidad declarada, y 0 es «no lo necesité»';
END;
$$;

DO $$
DECLARE r record; v_stock numeric;
BEGIN
  -- 8 · Sin stock se REGISTRA igual y se avisa. El insumo se gastó de verdad:
  -- negar el registro haría que el histórico mienta sin reponer nada.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000002',
    '[{"suministro_id": "50000000-0000-0000-0000-000000000002", "cantidad": 4}]'::jsonb);

  -- Ya se había marcado como no usado, pero sin movimiento: sigue pendiente.
  IF r.consumidos <> 1 THEN
    RAISE EXCEPTION '8a: consumidos = %, se esperaba 1', r.consumidos; END IF;

  IF jsonb_array_length(r.sin_stock) <> 1 THEN
    RAISE EXCEPTION '8b: el faltante no se reportó (sin_stock = %)', r.sin_stock; END IF;
  IF (r.sin_stock -> 0 ->> 'nombre') <> 'Bolsas de basura' THEN
    RAISE EXCEPTION '8c: el faltante reportado es otro: %', r.sin_stock; END IF;

  -- Piso en 0: el motor ya lo garantiza, y esto lo deja escrito.
  SELECT stock_actual INTO v_stock FROM public.suministros_condominio
   WHERE id = '50000000-0000-0000-0000-000000000002';
  IF v_stock <> 0 THEN
    RAISE EXCEPTION '8d: el stock se fue a % en vez de quedar en 0', v_stock; END IF;

  RAISE NOTICE 'OK 8  sin stock se registra igual, se avisa, y el piso es 0';
END;
$$;

DO $$
DECLARE r record;
BEGIN
  -- 9 · Lo que no viene en el arreglo no se toca. Cerrar una tarea sin declarar
  -- insumos no puede descontar por su cuenta.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SELECT * INTO r FROM public.consumir_insumos_tarea(
    'a1000000-0000-0000-0000-000000000003', '[]'::jsonb);

  IF r.consumidos <> 0 OR r.no_usados <> 0 THEN
    RAISE EXCEPTION '9: una tarea sin receta consumió algo (% / %)',
      r.consumidos, r.no_usados; END IF;

  RAISE NOTICE 'OK 9  lo no declarado no se descuenta';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- C · LA AUTORIZACIÓN
-- ════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 10 · Bruno administra el almacén y NO ejecuta tareas: la RPC lo rechaza.
  -- Si esto se afloja, cualquiera con acceso al inventario podría fabricar
  -- consumos a nombre de tareas ajenas.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  BEGIN
    PERFORM public.consumir_insumos_tarea(
      'a1000000-0000-0000-0000-000000000001',
      '[{"suministro_id": "50000000-0000-0000-0000-000000000001", "cantidad": 1}]'::jsonb);
    RAISE EXCEPTION '10: el de almacén pudo consumir por una tarea';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RAISE NOTICE 'OK 10 sin permiso de tareas la RPC no consume';
END;
$$;

DO $$
DECLARE v_n int;
BEGIN
  -- 11 · El reverso, que es la razón de que la RPC exista: Ana SÍ consumió por
  -- la RPC (invariante 5) y NO puede insertar un movimiento a mano, porque no
  -- tiene `condominios.tab.suministros`. Consumir haciendo el trabajo y
  -- administrar el almacén son permisos distintos.
  --
  -- Lo que hace HONESTO a 11a son los GRANT de tabla del fixture. Sin ellos el
  -- rechazo podía venir del privilegio faltante y no de la política: el mismo
  -- SQLSTATE, la misma prueba en verde, la RLS sin ejercitarse. Si alguien los
  -- quita, esto vuelve a pasar por el motivo equivocado.
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    INSERT INTO public.movimientos_suministro
      (company_id, project_id, suministro_id, tipo, cantidad)
    VALUES ('c0000000-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001', 'salida', 1);
    RAISE EXCEPTION '11a: el conserje insertó un movimiento a mano';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Y sí ve el plan de su propia tarea: sin eso la pantalla no puede pedirle
  -- que confirme cantidades.
  SELECT count(*) INTO v_n FROM public.tarea_bloque_suministros
   WHERE tarea_id = 'a1000000-0000-0000-0000-000000000001';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '11b: el conserje no ve el plan de su tarea (% filas)', v_n; END IF;

  RESET ROLE;
  RAISE NOTICE 'OK 11 el conserje consume por la RPC pero no toca el almacén';
END;
$$;
