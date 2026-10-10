\set ON_ERROR_STOP on
-- ============================================================================
-- VER-01 · El cuadre de tres vías no se evade: lo recibido de un renglón no lo fija el cliente
--          y no se aprueba ni contabiliza una factura sin recepción registrada.
--
-- CAUSA RAÍZ (misma que EV-04; aquí con la reproducción del revisor de veracidad)
--   Como ADMINISTRADOR (o con solo «crear»), el INSERT del renglón de una orden en borrador acepta
--   cantidad_recibida = cantidad: compras_tg_oc_linea_total (última definición en
--   20261020000700) solo bloquea cambios cuando la orden NO es borrador y ningún trigger reinicia
--   ni congela cantidad_recibida / cantidad_facturada. Se aprueba y emite la orden, se registra la
--   factura (ce_factura) y su aprobación pasa el cuadre: recepciones = 0 y factura «aprobada».
--   Eso contradice docs/COMPRAS_CONTROLES_SERVIDOR.md §2 (fila «Cantidades e importes excedidos»:
--   «Factura contra recepción/orden: bloqueado (COMPRAS_MATCH_NO_FORZABLE)»; «Conformidad de
--   servicio» e «Inventario solo por recepción aceptada»).
--
-- COMPORTAMIENTO ESPERADO
--   · el renglón nace con 0 recibido y 0 facturado y una sesión de usuario no lo cambia
--     (COMPRAS_ACUMULADO_SOLO_SISTEMA), sea servicio, bien de inventario o activo;
--   · la factura solo se aprueba hasta lo RECIBIDO por recepciones registradas (parcial incluido) y
--     lo recibido solo lo mueve el sistema al registrar / anular la recepción.
--
-- Prefijo de ids de este grupo: fa5HHKKK-… (HH = 01 para VER-01).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set S1  '''50000000-0000-0000-0000-0000000000c1'''

-- ═══ A. La reproducción del revisor: el administrador, de punta a punta ═══════════
--   UA siembra cantidad_recibida = 10 en el INSERT del renglón; aprueba y emite la orden;
--   registra la factura contra el renglón (ce_factura) y, como UQ («autorizar»), la aprueba.
CREATE OR REPLACE FUNCTION public.fa5_ver01_cadena(p_n int) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_msg text;
  v_oc  uuid := ('fa501100-0000-0000-0000-0000000000f' || p_n)::uuid;
  v_li  uuid := ('fa501110-0000-0000-0000-0000000000f' || p_n)::uuid;
  v_fa  uuid := ('fa501300-0000-0000-0000-0000000000f' || p_n)::uuid;
BEGIN
  BEGIN
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000000a'::uuid);
    INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
    VALUES (v_oc, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
            'e3000000-0000-0000-0000-000000000001', 'Proveedor VER-01', 'VER-01 factura sin recepción');
    INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto, cantidad_recibida)
    VALUES (v_li, 'cccccccc-cccc-cccc-cccc-cccccccccccc', v_oc, 1, 'Servicio VER-01', 'servicio', 'servicios', 10, 'servicio', 100, 0, 10);
    UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_oc;
    UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = v_oc;
    PERFORM public.ce_factura(v_fa, v_oc, v_li, 'e3000000-0000-0000-0000-000000000001'::uuid, 'VER01-' || p_n, 10, 100, 0);
    PERFORM public.como('c0c0c0c0-0000-0000-0000-00000000001a'::uuid);
    UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = v_fa;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  RETURN COALESCE(v_msg, 'COMPLETÓ: factura aprobada sin recepción');
END;
$$;

SET ROLE authenticated;
SELECT public.fa5_ver01_cadena(1) AS cadena \gset
RESET ROLE;
SELECT public.chk_txt(left(:'cadena', 30), 'COMPRAS_ACUMULADO_SOLO_SISTEMA',
  '[VER-01a] la cadena del revisor (INSERT con cantidad_recibida = 10 → aprobar → emitir → facturar → aprobar la factura) se corta en el primer paso');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa501300-0000-0000-0000-0000000000f1' AND estado = 'aprobada'), 0,
  '[VER-01b] no queda ninguna factura aprobada sin recepción');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE orden_compra_id = 'fa501100-0000-0000-0000-0000000000f1'), 0,
  '[VER-01c] (recepciones de la orden = 0, como en la reproducción)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa501300-0000-0000-0000-0000000000f1'), 0,
  '[VER-01d] y ningún asiento de devengo de lo no recibido');
DROP FUNCTION public.fa5_ver01_cadena(int);

-- ═══ B. Un bien de inventario o un activo tampoco nace «recibido» ═════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa501100-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'Proveedor VER-01', 'VER-01 inventario');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, suministro_id, categoria, cantidad, unidad, precio_unitario, cantidad_recibida)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa501100-0000-0000-0000-000000000002', 1, 'Cloro', 'inventario', '50000000-0000-0000-0000-0000000000c1', 'limpieza', 10, 'litro', 50, 10) $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[VER-01e] un renglón de INVENTARIO no nace «recibido» (la existencia solo entra por recepción aceptada)');
SELECT public.chk_falla($$ INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, cantidad_facturada)
                           VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fa501100-0000-0000-0000-000000000002', 1, 'Activo', 'activo_fijo', 'otros', 1, 'unidad', 900, 1) $$,
  'COMPRAS_ACUMULADO_SOLO_SISTEMA', '[VER-01f] ni un activo fijo nace «facturado»');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = 'fa501100-0000-0000-0000-000000000002'), 0,
  '[VER-01g] no se coló ningún renglón sembrado');

-- ═══ C. Lo legítimo: el cuadre sigue la recepción REAL, parcial incluida ═══════════
--   Orden de 10 × 100 · UA la crea · US registra recepciones · UQ aprueba facturas.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa501100-0000-0000-0000-000000000003', 'fa501110-0000-0000-0000-000000000003', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa501200-0000-0000-0000-000000000031', 'fa501100-0000-0000-0000-000000000003', 'fa501110-0000-0000-0000-000000000003', 4, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa501200-0000-0000-0000-000000000031';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa501110-0000-0000-0000-000000000003'), 4,
  '[VER-01h] la recepción registrada mueve lo recibido (4 de 10)');
-- Facturar más de lo recibido sigue bloqueado.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_factura('fa501300-0000-0000-0000-000000000031', 'fa501100-0000-0000-0000-000000000003', 'fa501110-0000-0000-0000-000000000003', :P1::uuid, 'VER01-31', 10, 100, 0);
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa501300-0000-0000-0000-000000000031' $$,
  'COMPRAS_MATCH_NO_FORZABLE', '[VER-01i] facturar 10 con 4 recibidos sigue bloqueado');
RESET ROLE;
-- Facturar lo recibido (4) se aprueba y se contabiliza.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_factura('fa501300-0000-0000-0000-000000000032', 'fa501100-0000-0000-0000-000000000003', 'fa501110-0000-0000-0000-000000000003', :P1::uuid, 'VER01-32', 4, 100, 0);
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa501300-0000-0000-0000-000000000032';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa501110-0000-0000-0000-000000000003'), 4,
  '[VER-01j] la factura de lo recibido (4) se aprueba y mueve lo facturado');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa501300-0000-0000-0000-000000000032' AND estado = 'publicado'), 1,
  '[VER-01k] y se contabiliza');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa501100-0000-0000-0000-000000000003'), 'recibida_parcial',
  '[VER-01l] la orden queda recibida_parcial (falta recibir y facturar 6)');
-- La segunda entrega (6) y su factura cierran la orden.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('fa501200-0000-0000-0000-000000000033', 'fa501100-0000-0000-0000-000000000003', 'fa501110-0000-0000-0000-000000000003', 6, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa501200-0000-0000-0000-000000000033';
SELECT public.como(:UA::uuid);
SELECT public.ce_factura('fa501300-0000-0000-0000-000000000034', 'fa501100-0000-0000-0000-000000000003', 'fa501110-0000-0000-0000-000000000003', :P1::uuid, 'VER01-34', 6, 100, 0);
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa501300-0000-0000-0000-000000000034';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida  FROM public.orden_compra_lineas WHERE id = 'fa501110-0000-0000-0000-000000000003'), 10, '[VER-01m] recibido total = 10');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa501110-0000-0000-0000-000000000003'), 10, '[VER-01n] facturado total = 10');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa501100-0000-0000-0000-000000000003'), 'cerrada', '[VER-01o] recibida y facturada del todo, la orden se cierra');

-- ═══ D. Inventario: la existencia entra por la recepción, y solo por ella ═════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa501100-0000-0000-0000-000000000004', 'fa501110-0000-0000-0000-000000000004', :P1::uuid, 'inventario', 10, 50, 0, :S1::uuid);
RESET ROLE;
CREATE TEMP TABLE fa5_ver01_stock AS SELECT stock_actual AS antes FROM public.suministros_condominio WHERE id = :S1::uuid;
SET ROLE authenticated;
SELECT public.ce_recepcion('fa501200-0000-0000-0000-000000000041', 'fa501100-0000-0000-0000-000000000004', 'fa501110-0000-0000-0000-000000000004', 10, 'bienes');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa501200-0000-0000-0000-000000000041';
RESET ROLE;
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa501110-0000-0000-0000-000000000004'), 10, '[VER-01p] la recepción de bienes mueve lo recibido');
SELECT public.chk_num((SELECT stock_actual FROM public.suministros_condominio WHERE id = :S1::uuid), (SELECT antes FROM fa5_ver01_stock) + 10,
  '[VER-01q] y entra la existencia al almacén (+10)');
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE origen_tabla = 'recepcion_lineas'
                    AND origen_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = 'fa501200-0000-0000-0000-000000000041')), 1,
  '[VER-01r] con una sola entrada al kardex, de la recepción');
DROP TABLE fa5_ver01_stock;
