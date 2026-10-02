\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · APROBACIÓN DE FACTURAS ENDURECIDA (migración 20261021000700)
--   · una factura CON orden y SIN renglones no se aprueba, ni con justificación;
--   · el autorizador y el aprobador los pone el servidor (auth.uid()), no el cliente;
--   · la excepción por justificación solo cubre PRECIO e IVA; no cubre lo que dejaría
--     la cuenta puente (2105), las cantidades o el seguimiento descuadrados.
-- Cada escenario usa su propia orden: 1 unidad × 100 (IVA 12), emitida.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UK  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

-- Orden de 1 unidad (recibida o no) y factura por la función de servidor.
CREATE FUNCTION pg_temp.nueva_orden(p_n int, p_recibir numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_o uuid := ('0f500000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_l uuid := ('0f510000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_r uuid := ('0f520000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (v_o, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Ferretería Bloque B', 'Aprobación endurecida ' || p_n);
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
  VALUES (v_l, 'cccccccc-cccc-cccc-cccc-cccccccccccc', v_o, 1, 'Material', 'gasto', 'mantenimiento', 1, 'u', 100, 12);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_o;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = v_o;
  IF p_recibir > 0 THEN
    INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
    VALUES (v_r, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', v_o, 'bienes');
    INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', v_r, v_l, p_recibir);
    UPDATE public.recepciones SET estado = 'registrada' WHERE id = v_r;
  END IF;
END $$;

CREATE FUNCTION pg_temp.facturar(p_n int, p_cant numeric, p_precio numeric, p_iva numeric) RETURNS uuid LANGUAGE sql AS $$
  SELECT ((public.compras_factura_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
    jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001',
                       'orden_compra_id', '0f500000-0000-0000-0000-' || lpad(p_n::text, 12, '0'),
                       'numero_factura', 'AP-' || lpad(p_n::text, 4, '0'), 'concepto', 'Factura de la orden ' || p_n,
                       'clave_idempotencia', 'clave-aprob-' || lpad(p_n::text, 4, '0')),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', '0f510000-0000-0000-0000-' || lpad(p_n::text, 12, '0'),
                                         'cantidad', p_cant, 'precio_unitario', p_precio, 'iva_monto', p_iva))
  ))->'factura'->>'id')::uuid
$$;

CREATE FUNCTION pg_temp.f2105(p_ids uuid[]) RETURNS numeric LANGUAGE sql AS $$
  SELECT COALESCE(SUM(al.haber - al.debe), 0)
    FROM public.conta_asiento_lineas al
    JOIN public.conta_cuentas cu ON cu.id = al.cuenta_id
    JOIN public.conta_asientos a ON a.id = al.asiento_id
   WHERE cu.codigo = '2105' AND a.company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND a.estado <> 'anulado' AND a.origen_id = ANY(p_ids)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.nueva_orden(int, numeric), pg_temp.facturar(int, numeric, numeric, numeric), pg_temp.f2105(uuid[]) TO authenticated;
CREATE TEMP TABLE ap (k text PRIMARY KEY, id uuid);
GRANT ALL ON ap TO authenticated;

-- ── Órdenes: 1 recibida por escenario; la 6 sin recibir (factura anticipada) ─
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT pg_temp.nueva_orden(n, CASE WHEN n = 6 THEN 0 ELSE 1 END) FROM generate_series(1, 12) n;
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id::text LIKE '0f500000-%' AND estado IN ('recibida', 'emitida')), 12, '0 · doce órdenes de prueba emitidas (11 recibidas)');

-- ── 1. CON orden y SIN renglones: nunca se aprueba, ni con justificación ─────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f530000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, '0f500000-0000-0000-0000-000000000001', 'AP-0001', 'Con orden y sin renglones', 'mantenimiento', 112);
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = '0f530000-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_SIN_RENGLONES', '1 · sin renglones NO se aprueba');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'Factura global del proveedor, se concilia aparte.' WHERE id = '0f530000-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_SIN_RENGLONES', '1 · ni con justificación escrita');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000a', match_justificacion = 'Autorizado por mí mismo.' WHERE id = '0f530000-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_SIN_RENGLONES', '1 · ni declarándose autorizador');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = '0f530000-0000-0000-0000-000000000001'), 'registrada', '1 · la factura queda registrada (el documento no se pierde)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_tabla = 'facturas_proveedor' AND origen_id = '0f530000-0000-0000-0000-000000000001'), 0, '1 · y no genera asiento');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = '0f510000-0000-0000-0000-000000000001'), 0, '1 · ni mueve lo facturado de la orden');

-- ── 2. El AUTORIZADOR y el APROBADOR los pone el servidor ────────────────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f2', pg_temp.facturar(2, 1, 120, 12));      -- precio +20 %: fuera de tolerancia
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = (SELECT id FROM ap WHERE k = 'f2') $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '2 · el precio fuera de tolerancia no se aprueba en silencio');
-- UA ejecuta pero declara que autorizó UB y que aprobó UB
UPDATE public.facturas_proveedor SET estado = 'aprobada', aprobada_por = :UB::uuid, match_forzado_por = :UB::uuid,
       match_justificacion = 'Alza pactada por escrito con el proveedor.' WHERE id = (SELECT id FROM ap WHERE k = 'f2');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f2')), 'aprobada', '2 · con justificación se aprueba');
SELECT public.chk_uuid((SELECT match_forzado_por FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f2')), :UA::uuid, '2 · el autorizador es QUIEN EJECUTA (UA), no el que declaró el cliente (UB)');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f2')), :UA::uuid, '2 · y el aprobador también sale del servidor');
SELECT public.chk_txt((SELECT match_justificacion FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f2')), 'Alza pactada por escrito con el proveedor.', '2 · la justificación queda escrita');

-- ── 3. Sin justificación válida no hay excepción ────────────────────────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f3', pg_temp.facturar(3, 1, 120, 12));
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'ok' WHERE id = (SELECT id FROM ap WHERE k = 'f3') $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '3 · una justificación de 2 caracteres no vale');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000b' WHERE id = (SELECT id FROM ap WHERE k = 'f3') $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '3 · declararse autorizador sin justificación tampoco');
-- Dejar el autorizador escrito ANTES (en un UPDATE aparte) no sirve: se vuelve a sellar al aprobar
UPDATE public.facturas_proveedor SET match_forzado_por = :UB::uuid, match_justificacion = 'Alza pactada por escrito.' WHERE id = (SELECT id FROM ap WHERE k = 'f3');
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = (SELECT id FROM ap WHERE k = 'f3');
RESET ROLE;
SELECT public.chk_uuid((SELECT match_forzado_por FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f3')), :UA::uuid, '3 · un autorizador dejado de antemano a nombre de otro se sobrescribe con quien aprueba');

-- ── 4. Si la factura CUADRA no hay excepción: los campos se limpian ─────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f4', pg_temp.facturar(4, 1, 100, 12));
SELECT public.como(:UA::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UB::uuid, match_justificacion = 'No hacía falta.' WHERE id = (SELECT id FROM ap WHERE k = 'f4');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f4')), 'aprobada', '4 · la factura que cuadra se aprueba');
SELECT public.chk_bool((SELECT match_forzado_por IS NULL AND match_justificacion IS NULL FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f4')), true, '4 · sin diferencias no queda ninguna «excepción» escrita (el registro dice la verdad)');

-- ── 5. Gasto directo (sin orden): no hay excepción posible; el aprobador se sella ─
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap SELECT 'f5', ((public.compras_factura_crear(:C::uuid, :C1::uuid,
  '{"proveedor_id":"e3000000-0000-0000-0000-000000000001","numero_factura":"AP-GD","concepto":"Gasto directo","monto_total":80,"iva_monto":9.6,"clave_idempotencia":"clave-aprob-gd1"}'::jsonb, NULL))->'factura'->>'id')::uuid;
SELECT public.como(:UA::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada', aprobada_por = :UB::uuid, match_forzado_por = :UB::uuid, match_justificacion = 'Texto sobrante' WHERE id = (SELECT id FROM ap WHERE k = 'f5');
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f5')), :UA::uuid, '5 · gasto directo: el aprobador es quien ejecuta');
SELECT public.chk_bool((SELECT match_forzado_por IS NULL AND match_justificacion IS NULL FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f5')), true, '5 · gasto directo: sin cuadre, sin excepción escrita');

-- ── 6. Facturar ANTES de recibir: no se autoriza; con la recepción, se aprueba y la cuenta puente queda en cero ─
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f6', pg_temp.facturar(6, 1, 100, 12));
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'Anticipo autorizado por gerencia.' WHERE id = (SELECT id FROM ap WHERE k = 'f6') $$,
  'COMPRAS_MATCH_NO_FORZABLE', '6 · facturar antes de recibir NO se autoriza ni con justificación');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f6')), 'registrada', '6 · la factura queda registrada (esperando la recepción)');
-- llega la recepción
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0f520000-0000-0000-0000-000000000006', :C::uuid, :C1::uuid, '0f500000-0000-0000-0000-000000000006', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
VALUES (:C::uuid, '0f520000-0000-0000-0000-000000000006', '0f510000-0000-0000-0000-000000000006', 1);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f520000-0000-0000-0000-000000000006';
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = (SELECT id FROM ap WHERE k = 'f6');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f6')), 'aprobada', '6 · con la recepción registrada la factura se aprueba sin excepción');
SELECT public.chk_num(pg_temp.f2105(ARRAY['0f520000-0000-0000-0000-000000000006', (SELECT id FROM ap WHERE k = 'f6')]::uuid[]), 0, '6 · la cuenta puente «por facturar» (2105) queda en CERO');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0f500000-0000-0000-0000-000000000006'), 'cerrada', '6 · la orden se cierra: recibida y facturada');

-- ── 7. Moneda distinta a la de la orden: no se autoriza (el devengo mezclaría monedas) ─
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, moneda, monto_total)
VALUES ('0f530000-0000-0000-0000-000000000007', :C::uuid, :C1::uuid, :P1::uuid, '0f500000-0000-0000-0000-000000000007', 'AP-0007', 'En dólares', 'mantenimiento', 'USD', 112);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
VALUES (:C::uuid, '0f530000-0000-0000-0000-000000000007', '0f510000-0000-0000-0000-000000000007', 1, 'Material', 1, 100, 12);
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'Nos facturaron en dólares.' WHERE id = '0f530000-0000-0000-0000-000000000007' $$,
  'COMPRAS_MATCH_NO_FORZABLE', '7 · una moneda distinta a la de la orden no se autoriza');
RESET ROLE;

-- ── 8. Más de lo recibido / más de lo ordenado: no se autoriza ──────────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f8', pg_temp.facturar(8, 2, 100, 24));     -- orden de 1, recibido 1: se factura 2
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'Nos mandaron una unidad de más.' WHERE id = (SELECT id FROM ap WHERE k = 'f8') $$,
  'COMPRAS_MATCH_NO_FORZABLE', '8 · facturar más de lo ordenado y recibido no se autoriza');
RESET ROLE;

-- ── 9. Un renglón de la factura que no es de la orden: no se autoriza ───────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, orden_compra_id, numero_factura, concepto, categoria, monto_total)
VALUES ('0f530000-0000-0000-0000-000000000009', :C::uuid, :C1::uuid, :P1::uuid, '0f500000-0000-0000-0000-000000000009', 'AP-0009', 'Renglón suelto', 'mantenimiento', 100);
INSERT INTO public.factura_proveedor_lineas (company_id, factura_id, orden_compra_linea_id, linea, descripcion, cantidad, precio_unitario, iva_monto)
VALUES (:C::uuid, '0f530000-0000-0000-0000-000000000009', NULL, 1, 'Algo que no está en la orden', 1, 100, 0);
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'Es un servicio adicional.' WHERE id = '0f530000-0000-0000-0000-000000000009' $$,
  'COMPRAS_MATCH_NO_FORZABLE', '9 · un renglón sin renglón de orden no se autoriza');
RESET ROLE;

-- ── 10. Precio e IVA SÍ se autorizan con justificación y la contabilidad queda consistente ─
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f10', pg_temp.facturar(10, 1, 120, 0));    -- precio +20 % e IVA 0 contra 12
SELECT public.como(:UA::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_justificacion = 'Alza de precio e IVA exento autorizados.' WHERE id = (SELECT id FROM ap WHERE k = 'f10');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f10')), 'aprobada', '10 · precio e IVA distintos se aprueban con justificación');
SELECT public.chk_num(pg_temp.f2105(ARRAY['0f520000-0000-0000-0000-000000000010', (SELECT id FROM ap WHERE k = 'f10')]::uuid[]), 0, '10 · y la cuenta puente (2105) queda en cero: la diferencia va a gasto, no se queda colgada');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = '0f510000-0000-0000-0000-000000000010'), 1, '10 · lo facturado de la orden es 1');

-- ── 11. Sin sesión (sin auth.uid()) no hay quien firme la excepción ─────────
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO ap VALUES ('f11', pg_temp.facturar(11, 1, 120, 12));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = 'c0c0c0c0-0000-0000-0000-00000000000a', match_justificacion = 'Firmado a nombre de un admin.' WHERE id = (SELECT id FROM ap WHERE k = 'f11') $$,
  'COMPRAS_MATCH_FUERA_DE_TOLERANCIA', '11 · sin sesión nadie puede firmar una excepción a nombre de otro');
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = (SELECT id FROM ap WHERE k = 'f11')), 'registrada', '11 · la factura sigue registrada');
