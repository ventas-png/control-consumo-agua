\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · ACUMULACIÓN DE LO FACTURADO (compras_tg_factura_acumular)
-- (migración 20261026000400)
--
--   1 · aprobar suma y anular resta, con cierre y reapertura de la orden
--   2 · facturas parciales y recepciones parciales
--   3 · reintentos: aprobar de nuevo no suma otra vez; un fallo se reintenta y suma UNA vez
--   4 · un error REAL (inyectado) aborta TODO: la factura sigue registrada, sin asiento y sin suma
--   5 · un acumulado descuadrado se muestra, no se recorta a cero
--   6 · los estados de la orden se mueven con guarda
--   7 · lo ESPERADO no bloquea: gasto directo y transiciones ajenas
--
-- La concurrencia con sesiones reales está en run.sh (escenarios V–Z).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UK  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set OA  '''0af00000-0000-0000-0000-000000000001'''
\set A1  '''0af10000-0000-0000-0000-000000000001'''
\set OB  '''0af00000-0000-0000-0000-000000000002'''
\set B1  '''0af10000-0000-0000-0000-000000000002'''
\set B2  '''0af10000-0000-0000-0000-000000000003'''
\set OE  '''0af00000-0000-0000-0000-000000000003'''
\set E1  '''0af10000-0000-0000-0000-000000000004'''
\set OF  '''0af00000-0000-0000-0000-000000000004'''
\set F1  '''0af10000-0000-0000-0000-000000000005'''
\set OG  '''0af00000-0000-0000-0000-000000000005'''
\set G1  '''0af10000-0000-0000-0000-000000000006'''

CREATE TEMP TABLE res_af (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_af TO authenticated;

-- Estado de lo acumulado, para leerlo SIN pasar por la RLS (el dueño de las tablas).
CREATE FUNCTION public.af_fact(p uuid) RETURNS numeric LANGUAGE sql AS $$ SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = p $$;
CREATE FUNCTION public.af_oc(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT estado FROM public.ordenes_compra WHERE id = p $$;
CREATE FUNCTION public.af_est(p text) RETURNS text LANGUAGE sql AS $$ SELECT estado FROM public.facturas_proveedor WHERE clave_idempotencia = p $$;
CREATE FUNCTION public.af_asientos(p text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.conta_asientos a JOIN public.facturas_proveedor f ON f.id = a.origen_id
   WHERE a.origen_tabla = 'facturas_proveedor' AND f.clave_idempotencia = p AND a.estado <> 'anulado' AND a.reversa_de_id IS NULL AND a.anulado_por_id IS NULL $$;

-- Prepara una orden emitida con N renglones y la recibe (registrada) en las cantidades indicadas.
--   p_lineas: [{id, linea, cant, precio, recibir}]
CREATE FUNCTION public.af_orden(p_orden uuid, p_rec uuid, p_lineas jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l jsonb;
BEGIN
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (p_orden, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Ferretería Bloque B', 'Orden de acumulación ' || p_orden);
  FOR l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
    VALUES ((l->>'id')::uuid, 'cccccccc-cccc-cccc-cccc-cccccccccccc', p_orden, (l->>'linea')::int, 'Renglón ' || (l->>'linea'), 'gasto', 'mantenimiento',
            (l->>'cant')::numeric, 'u', (l->>'precio')::numeric);
  END LOOP;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = p_orden;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = p_orden;
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
  VALUES (p_rec, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', p_orden, 'bienes');
  FOR l IN SELECT * FROM jsonb_array_elements(p_lineas) WHERE (value->>'recibir')::numeric > 0 LOOP
    INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', p_rec, (l->>'id')::uuid, (l->>'recibir')::numeric);
  END LOOP;
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = p_rec;
END $$;
GRANT EXECUTE ON FUNCTION public.af_fact(uuid), public.af_oc(uuid), public.af_est(text), public.af_asientos(text), public.af_orden(uuid, uuid, jsonb) TO authenticated;

-- Crea una factura por la RPC (el contador captura) y devuelve su clave.
CREATE FUNCTION public.af_factura(p_clave text, p_numero text, p_orden uuid, p_lineas jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001', 'orden_compra_id', p_orden, 'numero_factura', p_numero,
                       'concepto', 'Factura ' || p_numero, 'fecha_emision', CURRENT_DATE, 'clave_idempotencia', p_clave),
    p_lineas);
END $$;
GRANT EXECUTE ON FUNCTION public.af_factura(text, text, uuid, jsonb) TO authenticated;

-- ═════════ 1 · APROBAR SUMA, ANULAR RESTA; LA ORDEN SE CIERRA Y SE REABRE ═════════
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.af_orden(:OA::uuid, '0af20000-0000-0000-0000-000000000001', '[{"id":"0af10000-0000-0000-0000-000000000001","linea":1,"cant":10,"precio":10,"recibir":10}]');
RESET ROLE;
SELECT public.chk_txt(public.af_oc(:OA::uuid), 'recibida', '1 · la orden recibida completa está «recibida»');
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-a1', 'AF-A1', :OA::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000001","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.chk_num(public.af_fact(:A1::uuid), 0, '1 · una factura REGISTRADA todavía no suma');
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-a1';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:A1::uuid), 10, '1 · aprobar SUMA lo facturado (10)');
SELECT public.chk_txt(public.af_oc(:OA::uuid), 'cerrada', '1 · recibida y facturada del todo → la orden se cierra sola');
SELECT public.chk(public.af_asientos('af-clave-a1'), 1, '1 · y la aprobación generó UN asiento');
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-a1';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:A1::uuid), 0, '1 · anular RESTA (vuelve a 0)');
SELECT public.chk_txt(public.af_oc(:OA::uuid), 'recibida', '1 · y reabre la orden: «recibida», porque todo sigue recibido');
SELECT public.chk(public.af_asientos('af-clave-a1'), 0, '1 · el asiento de la factura quedó anulado (con su reverso)');
-- Una factura nueva por lo mismo vuelve a cerrarla.
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-a2', 'AF-A2', :OA::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000001","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-a2';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:A1::uuid), 10, '1 · una factura nueva por lo mismo vuelve a sumar 10');
SELECT public.chk_txt(public.af_oc(:OA::uuid), 'cerrada', '1 · y vuelve a cerrar la orden');

-- ═════════ 2 · PARCIALES (recepción parcial y facturas parciales) ═════════════
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.af_orden(:OB::uuid, '0af20000-0000-0000-0000-000000000002',
  '[{"id":"0af10000-0000-0000-0000-000000000002","linea":1,"cant":10,"precio":10,"recibir":6},{"id":"0af10000-0000-0000-0000-000000000003","linea":2,"cant":5,"precio":20,"recibir":5}]');
RESET ROLE;
SELECT public.chk_txt(public.af_oc(:OB::uuid), 'recibida_parcial', '2 · recepción parcial: la orden está «recibida parcial»');
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-b1', 'AF-B1', :OB::uuid,
  '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000002","cantidad":6,"precio_unitario":10,"iva_monto":0},{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000003","cantidad":5,"precio_unitario":20,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-b1';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:B1::uuid), 6, '2 · factura parcial: renglón 1 facturado 6 de 10');
SELECT public.chk_num(public.af_fact(:B2::uuid), 5, '2 · renglón 2 facturado 5 de 5');
SELECT public.chk_txt(public.af_oc(:OB::uuid), 'recibida_parcial', '2 · lo recibido ya está facturado pero falta recibir: NO se cierra');
-- Se recibe el resto del renglón 1 y se factura lo que falta: ahora sí cierra.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES ('0af20000-0000-0000-0000-000000000012', :C::uuid, :C1::uuid, :OB::uuid, 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES (:C::uuid, '0af20000-0000-0000-0000-000000000012', :B1::uuid, 4);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0af20000-0000-0000-0000-000000000012';
RESET ROLE;
SELECT public.chk_txt(public.af_oc(:OB::uuid), 'recibida', '2 · se recibe el resto: «recibida» (falta facturar 4)');
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-b2', 'AF-B2', :OB::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000002","cantidad":4,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-b2';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:B1::uuid), 10, '2 · la segunda factura parcial completa el renglón 1 (10 de 10)');
SELECT public.chk_txt(public.af_oc(:OB::uuid), 'cerrada', '2 · y entonces la orden se cierra');
-- Anular la PRIMERA parcial: resta solo lo suyo y reabre la orden.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-b1';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:B1::uuid), 4, '2 · anular la 1.ª parcial resta solo su 6 (queda 4 de la 2.ª)');
SELECT public.chk_num(public.af_fact(:B2::uuid), 0, '2 · y su 5 del renglón 2');
SELECT public.chk_txt(public.af_oc(:OB::uuid), 'recibida', '2 · la orden se reabre (todo recibido, falta facturar)');
-- Anular la segunda: resta lo suyo; la orden, que ya estaba reabierta, no cambia de estado.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-b2';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:B1::uuid), 0, '2 · anular la 2.ª parcial deja el renglón 1 en 0');
SELECT public.chk_txt(public.af_oc(:OB::uuid), 'recibida', '2 · y la orden sigue «recibida»');

-- ═════════ 3 · REINTENTOS ═════════════════════════════════════════════════════
-- Aprobar de nuevo una factura ya aprobada (doble clic, respuesta perdida): NO suma otra vez.
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-b3', 'AF-B3', :OB::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000002","cantidad":3,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-b3';
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-b3';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:B1::uuid), 3, '3 · aprobar dos veces suma UNA vez (3, no 6)');
SELECT public.chk(public.af_asientos('af-clave-b3'), 1, '3 · y deja UN asiento');

-- ═════════ 4 · UN ERROR REAL ABORTA TODO (falla inyectada en los renglones de la orden) ═════════
-- El trigger de prueba simula cualquier error real al escribir lo acumulado (un interbloqueo, una restricción,
-- el trigger de un renglón). Solo actúa cuando la sesión lo pide con el parámetro zz.falla.
CREATE FUNCTION public.zz_falla_acumulacion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('zz.falla', true), 'off') = 'on' AND NEW.cantidad_facturada IS DISTINCT FROM OLD.cantidad_facturada THEN
    RAISE EXCEPTION 'ZZ_FALLA_ACUMULACION: error simulado al escribir lo facturado';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_falla_acumulacion BEFORE UPDATE ON public.orden_compra_lineas FOR EACH ROW EXECUTE FUNCTION public.zz_falla_acumulacion();

SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.af_orden(:OE::uuid, '0af20000-0000-0000-0000-000000000003', '[{"id":"0af10000-0000-0000-0000-000000000004","linea":1,"cant":10,"precio":10,"recibir":10}]');
RESET ROLE;
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-e1', 'AF-E1', :OE::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000004","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT set_config('zz.falla', 'on', false);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-e1' $$,
  'ZZ_FALLA_ACUMULACION', '4 · un error real al acumular ABORTA la aprobación (antes: aviso en el log y la factura se aprobaba igual)');
SELECT set_config('zz.falla', 'off', false);
RESET ROLE;
SELECT public.chk_txt(public.af_est('af-clave-e1'), 'registrada', '4 · la factura CONSERVA su estado: sigue registrada');
SELECT public.chk_num(public.af_fact(:E1::uuid), 0, '4 · lo facturado no se tocó');
SELECT public.chk_txt(public.af_oc(:OE::uuid), 'recibida', '4 · la orden no cambió de estado');
SELECT public.chk(public.af_asientos('af-clave-e1'), 0, '4 · y no se generó asiento (no hay gasto devengado sin acumular)');
SELECT public.chk_bool(COALESCE(current_setting('conta.allow_system_write', true), 'off') IN ('off', ''), true, '4 · el permiso de sistema NO quedó activo tras el fallo');
-- Reintento tras corregir la causa: aprueba y suma UNA vez.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-e1';
RESET ROLE;
SELECT public.chk_txt(public.af_est('af-clave-e1'), 'aprobada', '4 · el reintento aprueba');
SELECT public.chk_num(public.af_fact(:E1::uuid), 10, '4 · y suma exactamente UNA vez (10)');
SELECT public.chk_txt(public.af_oc(:OE::uuid), 'cerrada', '4 · y cierra la orden');
SELECT public.chk(public.af_asientos('af-clave-e1'), 1, '4 · con su asiento');
-- La anulación también: un error real la aborta entera.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT set_config('zz.falla', 'on', false);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-e1' $$,
  'ZZ_FALLA_ACUMULACION', '4 · un error real al acumular ABORTA también la anulación');
SELECT set_config('zz.falla', 'off', false);
RESET ROLE;
SELECT public.chk_txt(public.af_est('af-clave-e1'), 'aprobada', '4 · la factura sigue aprobada (la anulación se deshizo completa)');
SELECT public.chk_num(public.af_fact(:E1::uuid), 10, '4 · y lo facturado sigue en 10');
SELECT public.chk_txt(public.af_oc(:OE::uuid), 'cerrada', '4 · y la orden sigue cerrada');
SELECT public.chk(public.af_asientos('af-clave-e1'), 1, '4 · y el asiento sigue vigente (no se reversó a medias)');
DROP TRIGGER zz_falla_acumulacion ON public.orden_compra_lineas;
DROP FUNCTION public.zz_falla_acumulacion();

-- ═════════ 5 · UN ACUMULADO DESCUADRADO SE MUESTRA, NO SE RECORTA ═════════════
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.af_orden(:OF::uuid, '0af20000-0000-0000-0000-000000000004', '[{"id":"0af10000-0000-0000-0000-000000000005","linea":1,"cant":10,"precio":10,"recibir":10}]');
RESET ROLE;
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-f1', 'AF-F1', :OF::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000005","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-f1';
RESET ROLE;
-- Se descuadra a propósito (como lo dejaría una acumulación que antes falló en silencio): la factura aportó 10 pero lo acumulado es 2.
SET conta.allow_system_write = 'on';
UPDATE public.orden_compra_lineas SET cantidad_facturada = 2 WHERE id = :F1::uuid;
SET conta.allow_system_write = 'off';
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-f1' $$,
  'COMPRAS_ACUMULACION_INCONSISTENTE', '5 · anular con el acumulado descuadrado FALLA con un código propio (antes: recortaba a 0 sin avisar)');
RESET ROLE;
SELECT public.chk_num(public.af_fact(:F1::uuid), 2, '5 · lo acumulado queda como estaba (2): no se recortó ni se tocó');
SELECT public.chk_txt(public.af_est('af-clave-f1'), 'aprobada', '5 · y la factura sigue aprobada');
SELECT public.chk(public.af_asientos('af-clave-f1'), 1, '5 · con su asiento vigente');

-- ═════════ 6 · LOS ESTADOS DE LA ORDEN SE MUEVEN CON GUARDA ═════════════════════
-- Orden cerrada A MANO con una recepción parcial: anular una de sus facturas NO la «reabre» como recibida.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.af_orden(:OG::uuid, '0af20000-0000-0000-0000-000000000005', '[{"id":"0af10000-0000-0000-0000-000000000006","linea":1,"cant":10,"precio":10,"recibir":4}]');
RESET ROLE;
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-g1', 'AF-G1', :OG::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000006","cantidad":4,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-g1';
UPDATE public.ordenes_compra SET estado = 'cerrada' WHERE id = :OG::uuid;      -- el cierre manual que el ciclo permite desde «recibida parcial»
RESET ROLE;
SELECT public.chk_txt(public.af_oc(:OG::uuid), 'cerrada', '6 · la orden se cerró a mano con una recepción parcial (4 de 10)');
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-g1';
RESET ROLE;
SELECT public.chk_num(public.af_fact(:G1::uuid), 0, '6 · anular resta lo facturado (4 → 0)');
SELECT public.chk_txt(public.af_oc(:OG::uuid), 'cerrada', '6 · y la orden cerrada a mano NO se reabre como «recibida» (no lo está: 4 de 10; antes sí)');

-- ═════════ 7 · LO ESPERADO NO BLOQUEA ═════════════════════════════════════════
-- Gasto directo (sin orden): aprobar y anular no tocan ninguna orden y no fallan.
SELECT public.como(:UK::uuid); SET ROLE authenticated;
INSERT INTO res_af SELECT 'gd', public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","numero_factura":"AF-DIRECTA","concepto":"Gasto directo","monto_total":112,"iva_monto":12,"clave_idempotencia":"af-clave-dir1"}'::jsonb, '[]'::jsonb);
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia = 'af-clave-dir1';
RESET ROLE;
SELECT public.chk_txt(public.af_est('af-clave-dir1'), 'aprobada', '7 · un gasto directo se aprueba sin acumular nada (esperado, no un error)');
SELECT public.chk(public.af_asientos('af-clave-dir1'), 1, '7 · con su asiento');
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-dir1';
RESET ROLE;
SELECT public.chk_txt(public.af_est('af-clave-dir1'), 'anulada', '7 · y se anula igual');
-- Una factura registrada que se anula sin haberse aprobado nunca no resta nada (transición ajena a lo acumulado).
SELECT public.chk_num(public.af_fact(:B1::uuid), 3, '7 · (antes) el renglón 1 de OB tiene 3 facturados');
SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('af-clave-b4', 'AF-B4', :OB::uuid, '[{"orden_compra_linea_id":"0af10000-0000-0000-0000-000000000002","cantidad":1,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE clave_idempotencia = 'af-clave-b4';
RESET ROLE;
SELECT public.chk_txt(public.af_est('af-clave-b4'), 'anulada', '7 · anular una factura que nunca se aprobó funciona');
SELECT public.chk_num(public.af_fact(:B1::uuid), 3, '7 · y no resta nada (transición ajena a lo acumulado): sigue en 3');
