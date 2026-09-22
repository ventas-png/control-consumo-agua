\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- EL AGUJERO, DEMOSTRADO. Corre ANTES de 20260923000000, sobre el esquema que
-- PRODUCCIÓN tiene hoy: las cinco policies y los grants por defecto.
--
-- Si esta parte pasara en verde con la migración ya aplicada, la prueba no
-- estaría probando nada — por eso el runner la corre primero y exige que el
-- agujero ESTÉ ahí.

-- ════════════════════════════════════════════════════════════════════════════
-- A · EL CONTROL: un autenticado que NO es admin no escribe
--
-- Va primero a propósito. Si el operativo también pudiera, el predicado
-- `current_user_role() = 'admin'` no estaría haciendo nada y lo de abajo no
-- probaría una puerta que no comprueba la empresa, sino una tabla sin puerta.
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT set_config('app.uid', 'cccccccc-0000-0000-0000-00000000000c', false);  -- operator, empresa A

DO $$
DECLARE n int;
BEGIN
  UPDATE public.empresa SET nombre = 'tocado por un operativo'
   WHERE id = 'e0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'A0: el operativo escribió; el predicado de rol no filtra nada y la prueba no distinguiría el agujero';
  END IF;
  RAISE NOTICE 'CTRL   el operativo NO escribe: el predicado de rol sí filtra';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- B · EL AGUJERO: el admin de la empresa B manda sobre lo que lee la A
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('app.uid', 'bbbbbbbb-0000-0000-0000-00000000000b', false);  -- admin, empresa B

DO $$
DECLARE n int; v_nombre text;
BEGIN
  -- 1 · MODIFICA la fila que la empresa A lee. No hay ninguna relación entre
  --     este usuario y esta fila salvo que su rol se llama 'admin'.
  UPDATE public.empresa
     SET nombre = 'reescrita por el admin de OTRA empresa', nit = '0000000-0'
   WHERE id = 'e0000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'A1: se esperaba el agujero (UPDATE cruzado) y no está'; END IF;
  RAISE NOTICE 'BUG 1  MODIFICA la identidad que lee OTRA empresa';

  -- 2 · BORRA una fila entera.
  DELETE FROM public.empresa WHERE id = 'e0000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'A2: se esperaba el agujero (DELETE cruzado) y no está'; END IF;
  RAISE NOTICE 'BUG 2  BORRA una fila de la tabla que todos comparten';

  -- 3 · Y da de alta una nueva.
  INSERT INTO public.empresa (id, nombre)
  VALUES ('e0000000-0000-0000-0000-000000000003', 'insertada por el admin de B');
  RAISE NOTICE 'BUG 3  INSERTA una fila nueva sin ser de esa empresa';

  -- 4 · El daño es visible desde la otra empresa: no es un cambio aislado en
  --     una fila «suya», es LA fila que la otra lee.
  SELECT nombre INTO v_nombre FROM public.empresa
   WHERE id = 'e0000000-0000-0000-0000-000000000001';
  IF v_nombre <> 'reescrita por el admin de OTRA empresa' THEN
    RAISE EXCEPTION 'A4: el cambio no quedó; la demostración no sería concluyente'; END IF;
  RAISE NOTICE 'BUG 4  el cambio queda: % ', v_nombre;
END;
$$;

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- C · EL ARMA CARGADA: los grants de escritura están concedidos
--
-- Hoy sólo la RLS los contiene. Es UNA capa, y es la que falló: la policy de
-- arriba sólo llega a ser algo porque el grant existe. Si mañana alguien agrega
-- otra policy permisiva a mano, el grant ya está puesto.
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_rol text; v_priv text; v_faltan text := '';
BEGIN
  FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT has_table_privilege(v_rol, 'public.empresa', v_priv) THEN
        v_faltan := v_faltan || v_rol || '/' || v_priv || ' ';
      END IF;
    END LOOP;
  END LOOP;

  IF v_faltan <> '' THEN
    RAISE EXCEPTION 'A5: se esperaban los grants por defecto de Supabase y faltan: %', v_faltan
      USING HINT = 'Sin ellos el fixture no reproduce producción y la segunda capa no se estaría probando.';
  END IF;

  RAISE NOTICE 'BUG 5  anon y authenticated conservan INSERT/UPDATE/DELETE de tabla';
END;
$$;
