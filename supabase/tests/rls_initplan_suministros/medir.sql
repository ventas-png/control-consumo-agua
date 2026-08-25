\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Mide SEIS accesos y los anota en `public.medicion` bajo la etapa recibida.
-- Se corre dos veces —antes y después de 20260906000000— y `assert.sql` exige
-- que las dos tandas coincidan caso por caso.
--
-- Los seis están elegidos para cubrir las dos direcciones del error posible:
-- que el cambio ABRA algo (un permiso mal tecleado, una política que no se
-- vuelve a crear) o que CIERRE algo (un predicado de más).
--
-- `:etapa` viaja por un GUC porque psql NO interpola variables dentro de un
-- literal con comillas de dólar, y todas las mediciones viven en bloques DO.
SELECT set_config('test.etapa', :'etapa', false);

-- Las escrituras se deshacen solas: el BEGIN/EXCEPTION interno es una
-- subtransacción, así que un RAISE propio revierte el INSERT y deja el bloque
-- vivo. Sin eso, la tanda "antes" ensuciaría el escenario de la tanda "después"
-- y la comparación mediría el residuo en vez de la política.
--
-- 1 · Bruno TIENE `condominios.tab.suministros`: ve el insumo de su empresa.
DO $medir$
DECLARE v_res text; v_n int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.suministros_condominio
   WHERE company_id = 'c0000000-0000-0000-0000-000000000001';
  v_res := v_n::text;
  RESET ROLE;
  INSERT INTO public.medicion VALUES (current_setting('test.etapa'), 'bruno_ve_su_insumo', v_res);
END;
$medir$;

-- 2 · …y puede registrar un movimiento.
DO $medir$
DECLARE v_res text;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.movimientos_suministro
      (company_id, project_id, suministro_id, tipo, cantidad)
    VALUES ('c0000000-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001', 'salida', 1);
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001'      THEN v_res := 'permitido';
    WHEN insufficient_privilege THEN v_res := 'rechazado';
  END;
  RESET ROLE;
  INSERT INTO public.medicion VALUES (current_setting('test.etapa'), 'bruno_registra_movimiento', v_res);
END;
$medir$;

-- 3 · Pero NO puede borrar el insumo: el DELETE pide company_owner o admin, y
-- Bruno es operador. Es el único de los seis que ejercita esa política, y la
-- que más fácil se rompe al re-escribirla (usa `current_user_role`, no el
-- permiso). El rechazo de un DELETE por RLS no es un error: son 0 filas.
DO $medir$
DECLARE v_res text; v_n int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000b', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    DELETE FROM public.suministros_condominio
     WHERE id = '50000000-0000-0000-0000-000000000001';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_res := v_n::text;
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001'      THEN NULL;
    WHEN insufficient_privilege THEN v_res := 'rechazado';
  END;
  RESET ROLE;
  INSERT INTO public.medicion VALUES (current_setting('test.etapa'), 'bruno_borra_insumo', v_res);
END;
$medir$;

-- 4 · Ana NO tiene el permiso: no ve nada, aunque sea de su empresa.
DO $medir$
DECLARE v_res text; v_n int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.suministros_condominio;
  v_res := v_n::text;
  RESET ROLE;
  INSERT INTO public.medicion VALUES (current_setting('test.etapa'), 'ana_ve_insumos', v_res);
END;
$medir$;

-- 5 · …y tampoco puede registrar un movimiento a mano.
DO $medir$
DECLARE v_res text;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000a', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.movimientos_suministro
      (company_id, project_id, suministro_id, tipo, cantidad)
    VALUES ('c0000000-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001',
            '50000000-0000-0000-0000-000000000001', 'salida', 1);
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'ZZ001';
  EXCEPTION
    WHEN SQLSTATE 'ZZ001'      THEN v_res := 'permitido';
    WHEN insufficient_privilege THEN v_res := 'rechazado';
  END;
  RESET ROLE;
  INSERT INTO public.medicion VALUES (current_setting('test.etapa'), 'ana_registra_movimiento', v_res);
END;
$medir$;

-- 6 · Dana SÍ tiene el permiso, pero en OTRA empresa: el permiso no cruza el
-- `company_id`. Si al re-escribir se cayera esa mitad del predicado, éste es el
-- caso que lo grita.
DO $medir$
DECLARE v_res text; v_n int;
BEGIN
  PERFORM set_config('app.uid', 'a0000000-0000-0000-0000-00000000000d', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.suministros_condominio
   WHERE company_id = 'c0000000-0000-0000-0000-000000000001';
  v_res := v_n::text;
  RESET ROLE;
  INSERT INTO public.medicion VALUES (current_setting('test.etapa'), 'dana_ve_ajenos', v_res);
END;
$medir$;
