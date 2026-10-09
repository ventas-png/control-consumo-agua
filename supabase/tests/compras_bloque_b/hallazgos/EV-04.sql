\set ON_ERROR_STOP on
-- ============================================================================
-- EV-04 · Lo recibido y lo facturado de un renglón de orden NO los fija el cliente:
--         solo los mueven las recepciones registradas y las facturas aprobadas.
--
-- CAUSA RAÍZ
--   orden_compra_lineas.cantidad_recibida y cantidad_facturada son los acumulados del cuadre de
--   tres vías. Los mueven los triggers de recepción y de factura con el permiso de sistema
--   (conta.allow_system_write = 'on'), pero ningún trigger impedía que la SESIÓN DE UN USUARIO
--   los fijara: mientras la orden es borrador, compras_tg_oc_linea_total deja pasar cualquier
--   INSERT/UPDATE. Con solo «crear»:
--     · INSERT del renglón con cantidad_recibida = cantidad → se aprueba y emite la orden, se
--       registra la factura y se APRUEBA y CONTABILIZA sin que exista recepción alguna;
--     · cantidad_facturada sembrada → el renglón queda «ya facturado» y no se puede facturar.
--
-- COMPORTAMIENTO ESPERADO (servidor, para sesiones de usuario)
--   · INSERT del renglón: nace con 0 recibido y 0 facturado (un valor distinto se rechaza,
--     COMPRAS_ACUMULADO_SOLO_SISTEMA, también al administrador);
--   · UPDATE del renglón: ninguno de los dos cambia (reescribir el mismo valor es inocuo);
--   · lo siguen moviendo las recepciones registradas / anuladas y las facturas aprobadas / anuladas;
--   · un proceso sin sesión (service_role, migración, importación) sí puede fijarlos;
--   · la edición legítima del borrador (cantidad, precio, descripción) sigue funcionando.
--
-- Prefijo de ids de este grupo: fa5HHKKK-… (HH = hallazgo: 04 = EV-04, 01 = VER-01, 08 = EV-08;
-- KKK = clase: 100 orden, 110 renglón, 200 recepción, 300 factura, 500 contraseña).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- ═══ A0. La cadena del hallazgo, de punta a punta, como PostgREST ═════════════
--   UC («crear») captura la orden con un renglón que YA trae lo recibido · UQ («autorizar») aprueba ·
--   US («cambiar estado») emite · UC registra la factura contra el renglón · UQ aprueba la factura.
--   Hoy la cadena completa tiene éxito: factura APROBADA y CONTABILIZADA con CERO recepciones.
--   Debe cortarse en el primer paso (el renglón sembrado), y no dejar nada a medias.
CREATE OR REPLACE FUNCTION public.fa5_ev04_cadena(p_siembra text, p_n int) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
  v_oc  uuid := ('fa504100-0000-0000-0000-0000000000e' || p_n)::uuid;
  v_li  uuid := ('fa504110-0000-0000-0000-0000000000e' || p_n)::uuid;
  v_fa  uuid := ('fa504300-0000-0000-0000-0000000000e' || p_n)::uuid;
BEGIN
  BEGIN
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000000c'::uuid);
    INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
    VALUES (v_oc, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
            'e3000000-0000-0000-0000-000000000001', 'Proveedor EV-04', 'EV-04 cadena de punta a punta');
    IF p_siembra = 'recibida' THEN
      INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_recibida)
      VALUES (v_li, 'cccccccc-cccc-cccc-cccc-cccccccccccc', v_oc, 1, 'Servicio sin recibir', 'servicio', 'servicios', 10, 'servicio', 100, 10);
    ELSE
      INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
      VALUES (v_li, 'cccccccc-cccc-cccc-cccc-cccccccccccc', v_oc, 1, 'Servicio sin recibir', 'servicio', 'servicios', 10, 'servicio', 100);
      UPDATE public.orden_compra_lineas SET cantidad_recibida = 10 WHERE id = v_li;
    END IF;
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000001a'::uuid);
    UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_oc;
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000001b'::uuid);
    UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = v_oc;
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000000c'::uuid);
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total)
    VALUES (v_fa, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
            'e3000000-0000-0000-0000-000000000001', v_oc, 'EV04-E' || p_n, 'EV-04 sin recepción', 1);
    INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', v_fa, v_li, 1, 'Servicio sin recibir', 10, 100);
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000001a'::uuid);
    UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = v_fa;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  RETURN COALESCE(v_msg, 'COMPLETÓ: factura aprobada sin recepción');
END;
$$;

SET ROLE authenticated;
SELECT public.fa5_ev04_cadena('recibida', 1) AS cadena1 \gset
RESET ROLE;
SELECT public.chk_txt(left(:'cadena1', 30), 'COMPRAS_ACUMULADO_SOLO_SISTEMA',
  '[EV-04A] la cadena con el renglón SEMBRADO se corta en el primer paso (no llega a aprobar la factura)');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa504300-0000-0000-0000-0000000000e1'), 0,
  '[EV-04B] y no queda ni la orden ni la factura de la cadena (todo o nada)');
SET ROLE authenticated;
SELECT public.fa5_ev04_cadena('update', 2) AS cadena2 \gset
RESET ROLE;
SELECT public.chk_txt(left(:'cadena2', 30), 'COMPRAS_ACUMULADO_SOLO_SISTEMA',
  '[EV-04C] la cadena con el acumulado reescrito por UPDATE también se corta');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id IN ('fa504300-0000-0000-0000-0000000000e1', 'fa504300-0000-0000-0000-0000000000e2')), 0,
  '[EV-04D] no hay asiento de devengo de algo que nadie recibió');
DROP FUNCTION public.fa5_ev04_cadena(text, int);

-- ═══ A. La vía del hallazgo, con los actores reales ═══════════════════════════
--   UC («crear») captura · UQ («autorizar») aprueba · US («cambiar estado») emite y registra.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
-- Borrador legítimo (se usa abajo para el resto de los intentos).
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa504100-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-04', 'EV-04 sin recepción');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario)
VALUES ('fa504110-0000-0000-0000-000000000001', :C::uuid, 'fa504100-0000-0000-0000-000000000001', 1, 'Servicio EV-04', 'servicio', 'servicios', 10, 'servicio', 100);

-- A1 · Sembrar lo recibido al CREAR el renglón (el camino del hallazgo).
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_recibida)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa504100-0000-0000-0000-000000000001', 2, 'sembrado', 'servicio', 'servicios', 10, 'servicio', 100, 10) $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04a] un renglón no nace con lo recibido sembrado por el cliente');
-- A2 · Sembrar lo facturado al crear.
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_facturada)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa504100-0000-0000-0000-000000000001', 2, 'sembrado', 'servicio', 'servicios', 10, 'servicio', 100, 10) $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04b] un renglón no nace con lo facturado sembrado por el cliente (lo dejaría no facturable)');
-- A3 · Reescribirlos en el borrador.
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET cantidad_recibida = 10 WHERE id = 'fa504110-0000-0000-0000-000000000001' $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04c] el UPDATE de un renglón en borrador no cambia lo recibido');
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET cantidad_facturada = 10 WHERE id = 'fa504110-0000-0000-0000-000000000001' $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04d] el UPDATE de un renglón en borrador no cambia lo facturado');
-- A4 · Ni siquiera el administrador.
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET cantidad_recibida = 10, cantidad_facturada = 10 WHERE id = 'fa504110-0000-0000-0000-000000000001' $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04e] ni el administrador reescribe lo recibido / facturado de un renglón');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_recibida)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa504100-0000-0000-0000-000000000001', 3, 'sembrado admin', 'servicio', 'servicios', 10, 'servicio', 100, 10) $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04f] ni el administrador siembra lo recibido al crear el renglón');
-- A5 · Un UPSERT (INSERT … ON CONFLICT DO UPDATE) tampoco lo cambia.
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_recibida)
                           VALUES ('fa504110-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa504100-0000-0000-0000-000000000001', 1, 'Servicio EV-04', 'servicio', 'servicios', 10, 'servicio', 100, 0)
                           ON CONFLICT (id) DO UPDATE SET cantidad_recibida = 10 $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04g] el UPSERT tampoco cambia lo recibido');
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida  FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000001'), 0, '[EV-04h] tras los intentos, lo recibido sigue en 0');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000001'), 0, '[EV-04i] tras los intentos, lo facturado sigue en 0');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = 'fa504100-0000-0000-0000-000000000001'), 1, '[EV-04j] y no se coló ningún renglón sembrado');

-- A6 · La cadena completa del hallazgo ya no llega a contabilizar: la orden se aprueba y se emite, se
--      registra la factura contra el renglón y su APROBACIÓN se rechaza (no hay nada recibido).
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa504100-0000-0000-0000-000000000001';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'fa504100-0000-0000-0000-000000000001';
SELECT public.como(:UC::uuid);
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, monto_total)
VALUES ('fa504300-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'fa504100-0000-0000-0000-000000000001', 'EV04-1', 'EV-04 sin recepción', 1);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario)
VALUES (:C::uuid, 'fa504300-0000-0000-0000-000000000001', 'fa504110-0000-0000-0000-000000000001', 1, 'Servicio EV-04', 10, 100);
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa504300-0000-0000-0000-000000000001' $$,
  'COMPRAS_MATCH_NO_FORZABLE', '[EV-04k] sin recepción registrada, la factura no se aprueba ni con la cantidad sembrada ni sin ella');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa504300-0000-0000-0000-000000000001'), 'registrada', '[EV-04l] la factura sigue registrada');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa504300-0000-0000-0000-000000000001' AND estado = 'publicado'), 0, '[EV-04m] y no hay devengo contabilizado de lo que nadie recibió');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE orden_compra_id = 'fa504100-0000-0000-0000-000000000001'), 0, '[EV-04n] (no existe recepción alguna)');

-- ═══ B. Lo legítimo sigue funcionando ═════════════════════════════════════════
-- B1 · La edición normal del borrador (cantidad, precio, descripción) recalcula el total.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa504100-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-04', 'EV-04 edición legítima');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_recibida, cantidad_facturada)
VALUES ('fa504110-0000-0000-0000-000000000002', :C::uuid, 'fa504100-0000-0000-0000-000000000002', 1, 'Servicio', 'servicio', 'servicios', 10, 'servicio', 100, 0, 0);
UPDATE public.orden_compra_lineas SET cantidad = 12, precio_unitario = 110, descripcion = 'Servicio corregido' WHERE id = 'fa504110-0000-0000-0000-000000000002';
-- B2 · Reescribir los mismos valores (un cliente que reenvía la fila completa) es inocuo.
UPDATE public.orden_compra_lineas SET cantidad_recibida = cantidad_recibida, cantidad_facturada = cantidad_facturada, notas = 'reenvío' WHERE id = 'fa504110-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_num((SELECT total FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000002'), 1320, '[EV-04o] editar el borrador recalcula el total del renglón (12 × 110)');
SELECT public.chk_txt((SELECT notas FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000002'), 'reenvío', '[EV-04p] reenviar la fila completa (mismos acumulados) se acepta');

-- B3 · La RPC transaccional de captura sigue creando la orden con sus renglones en 0.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT (public.compras_orden_crear(:C::uuid, :C1::uuid,
  jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001', 'concepto', 'EV-04 por RPC', 'clave_idempotencia', 'ev04-clave-rpc-0001'),
  jsonb_build_array(jsonb_build_object('descripcion', 'Servicio por RPC', 'destino_tipo', 'servicio', 'categoria', 'servicios', 'cantidad', 4, 'unidad', 'servicio', 'precio_unitario', 25))))->'orden'->>'id' AS ev04_oc \gset
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = :'ev04_oc'::uuid AND cantidad_recibida = 0 AND cantidad_facturada = 0), 1,
  '[EV-04q] la RPC de captura crea el renglón con 0 recibido y 0 facturado');

-- B4 · El circuito legítimo mueve los acumulados (los mueve el SISTEMA, con los permisos reales):
--      recibir (US) → facturar y aprobar (UQ) → anular la factura (US) → anular la recepción (US).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa504100-0000-0000-0000-000000000003', 'fa504110-0000-0000-0000-000000000003', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa504200-0000-0000-0000-000000000003', 'fa504100-0000-0000-0000-000000000003', 'fa504110-0000-0000-0000-000000000003', 10, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa504200-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000003'), 10, '[EV-04r] registrar la recepción mueve lo recibido (lo hace el sistema)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_factura('fa504300-0000-0000-0000-000000000003', 'fa504100-0000-0000-0000-000000000003', 'fa504110-0000-0000-0000-000000000003', :P1::uuid, 'EV04-3', 10, 100, 0);
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa504300-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000003'), 10, '[EV-04s] aprobar la factura mueve lo facturado');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa504100-0000-0000-0000-000000000003'), 'cerrada', '[EV-04t] recibida y facturada del todo, la orden se cierra sola');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa504300-0000-0000-0000-000000000003' AND estado = 'publicado'), 1, '[EV-04u] la factura con recepción sí se contabiliza');
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = 'fa504300-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000003'), 0, '[EV-04v] anular la factura devuelve lo facturado a 0 (lo hace el sistema)');
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'anulada', motivo_anulacion = 'EV-04' WHERE id = 'fa504200-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000003'), 0, '[EV-04w] anular la recepción devuelve lo recibido a 0 (lo hace el sistema)');

-- B5 · Un proceso SIN sesión (service_role, migración, importación de histórico) sí puede fijarlos.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa504100-0000-0000-0000-000000000004', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor EV-04', 'EV-04 histórico importado');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_recibida, cantidad_facturada)
VALUES ('fa504110-0000-0000-0000-000000000004', :C::uuid, 'fa504100-0000-0000-0000-000000000004', 1, 'Histórico', 'servicio', 'servicios', 10, 'servicio', 100, 6, 2);
UPDATE public.orden_compra_lineas SET cantidad_recibida = 7, cantidad_facturada = 3 WHERE id = 'fa504110-0000-0000-0000-000000000004';
SELECT public.chk_num((SELECT cantidad_recibida  FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000004'), 7, '[EV-04x] sin sesión de usuario (importación) se puede fijar lo recibido');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa504110-0000-0000-0000-000000000004'), 3, '[EV-04y] sin sesión de usuario (importación) se puede fijar lo facturado');
-- …y, vuelta la sesión de un usuario, ya no lo cambia.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET cantidad_recibida = 0 WHERE id = 'fa504110-0000-0000-0000-000000000004' $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[EV-04z] con sesión de usuario, lo importado tampoco se reescribe');
RESET ROLE;
