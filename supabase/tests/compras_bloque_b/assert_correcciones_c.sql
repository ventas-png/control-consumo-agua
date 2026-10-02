\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CORRECCIONES DEL BLOQUE C (migraciones 20261023000000, …0100 y …0200)
--   A. pendientes por recibir / por facturar POR RENGLÓN, en cantidades y al precio de la orden;
--      la diferencia de precio va aparte (descuento, sobreprecio autorizado, facturación parcial);
--   B. respaldos: la validación es del SERVIDOR (INSERT directo y RPC): objeto, bucket, recepción,
--      alcance y metadatos; la referencia principal; el retiro del principal en borrador; inmutable
--      con la recepción registrada;
--   (C. el índice único de inventario se prueba aparte, con duplicados reales: indice_obligatorio.sh.)
-- Usuarios: UO operador con permiso de órdenes · UK contador · UN operador SIN permisos ·
-- UA admin · UD admin de OTRA empresa.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UK  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- A · PENDIENTES POR RENGLÓN
-- ════════════════════════════════════════════════════════════════════════════
-- Orden con n renglones de gasto, todos 10 × 100 (IVA 0): emitida y recibida por completo.
CREATE FUNCTION pg_temp.orden_recibida(p_n int, p_lineas int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_o uuid := ('0f700000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_r uuid := ('0f720000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  i int;
BEGIN
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (v_o, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Ferretería Bloque B', 'Pendientes por renglón ' || p_n);
  FOR i IN 1..p_lineas LOOP
    INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
    VALUES (('0f710000-0000-0000-' || lpad(p_n::text, 4, '0') || '-' || lpad(i::text, 12, '0'))::uuid,
            'cccccccc-cccc-cccc-cccc-cccccccccccc', v_o, i, 'Renglón ' || i, 'gasto', 'mantenimiento', 10, 'u', 100, 0);
  END LOOP;
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_o;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = v_o;
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
  VALUES (v_r, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', v_o, 'bienes');
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
  SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc', v_r, l.id, 10 FROM public.orden_compra_lineas l WHERE l.orden_compra_id = v_o;
  UPDATE public.recepciones SET estado = 'registrada' WHERE id = v_r;
END $$;

-- Factura de UN renglón (n, i) por la función de servidor.
CREATE FUNCTION pg_temp.facturar_linea(p_n int, p_i int, p_cant numeric, p_precio numeric, p_num text) RETURNS uuid LANGUAGE sql AS $$
  SELECT ((public.compras_factura_crear(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
    jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001',
                       'orden_compra_id', '0f700000-0000-0000-0000-' || lpad(p_n::text, 12, '0'),
                       'numero_factura', p_num, 'concepto', 'Factura ' || p_num, 'clave_idempotencia', 'k-' || p_num),
    jsonb_build_array(jsonb_build_object('orden_compra_linea_id', '0f710000-0000-0000-' || lpad(p_n::text, 4, '0') || '-' || lpad(p_i::text, 12, '0'),
                                         'cantidad', p_cant, 'precio_unitario', p_precio, 'iva_monto', 0))
  ))->'factura'->>'id')::uuid
$$;
CREATE FUNCTION pg_temp.ind(p_n int, p_campo text) RETURNS numeric LANGUAGE sql AS $$
  SELECT (public.compras_seguimiento_orden(('0f700000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid)->'indicadores'->>p_campo)::numeric
$$;
CREATE FUNCTION pg_temp.lista(p_n int, p_campo text) RETURNS numeric LANGUAGE sql AS $$
  SELECT CASE p_campo WHEN 'pendiente_por_facturar' THEN s.pendiente_por_facturar
                      WHEN 'pendiente_por_recibir' THEN s.pendiente_por_recibir
                      WHEN 'diferencia_precio_facturada' THEN s.diferencia_precio_facturada END
    FROM public.compras_seguimiento_lista(NULL, NULL, NULL, NULL, NULL, false) s
   WHERE s.orden_id = ('0f700000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.orden_recibida(int, int), pg_temp.facturar_linea(int, int, numeric, numeric, text),
  pg_temp.ind(int, text), pg_temp.lista(int, text) TO authenticated;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT pg_temp.orden_recibida(1, 3);   -- 3 renglones de 10 × 100, todo recibido (3 000)
SELECT pg_temp.orden_recibida(2, 1);   -- solo descuento
RESET ROLE;

-- Todo recibido y nada facturado: el pendiente son las TRES líneas completas.
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_facturar'), 3000, 'A1 · recibido y sin facturar: pendiente = 3 renglones × 10 × 100');
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_recibir'), 0, 'A1 · todo recibido: pendiente por recibir = 0');
SELECT public.chk_num(pg_temp.ind(1, 'diferencia_precio_facturada'), 0, 'A1 · sin facturas: sin diferencia de precio');

-- DESCUENTO: se factura TODO el renglón 1 a 90 (10 % menos). Antes quedaba un pendiente fantasma de 100.
SELECT pg_temp.facturar_linea(1, 1, 10, 90, 'ZZ-A-1');
SELECT pg_temp.facturar_linea(2, 1, 10, 90, 'ZZ-A-2');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UB::uuid, match_justificacion = 'Descuento por pronto pago pactado.'
 WHERE numero_factura IN ('ZZ-A-1', 'ZZ-A-2');
RESET ROLE;
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_num(pg_temp.ind(2, 'pendiente_por_facturar'), 0, 'A2 · DESCUENTO con todas las cantidades facturadas: pendiente = 0 (antes quedaba 100)');
SELECT public.chk_num(pg_temp.ind(2, 'diferencia_precio_facturada'), -100, 'A2 · el descuento se informa APARTE: (90 − 100) × 10 = −100');
SELECT public.chk_num(pg_temp.lista(2, 'pendiente_por_facturar'), 0, 'A2 · la lista dice lo mismo que el detalle');
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_facturar'), 2000, 'A2 · en la otra orden, un renglón facturado: quedan 2 × 10 × 100 = 2 000');

-- SOBREPRECIO AUTORIZADO en el renglón 2: 10 × 120. No se «come» el pendiente del renglón 3.
SELECT pg_temp.facturar_linea(1, 2, 10, 120, 'ZZ-A-3');
RESET ROLE;
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada', match_forzado_por = :UB::uuid, match_justificacion = 'Alza pactada por escrito con el proveedor.'
 WHERE numero_factura = 'ZZ-A-3';
RESET ROLE;
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_facturar'), 1000, 'A3 · SOBREPRECIO autorizado: el renglón 3 (sin facturar) sigue pendiente completo = 1 000, no se compensa');
SELECT public.chk_num(pg_temp.ind(1, 'diferencia_precio_facturada'), 100, 'A3 · diferencia de precio aparte: −100 (renglón 1) + 200 (renglón 2) = 100');

-- FACTURACIÓN PARCIAL del renglón 3: 4 de 10 al precio de la orden.
SELECT pg_temp.facturar_linea(1, 3, 4, 100, 'ZZ-A-4');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura = 'ZZ-A-4';
RESET ROLE;
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_facturar'), 600, 'A4 · FACTURACIÓN PARCIAL: faltan 6 × 100 = 600');
SELECT public.chk_num(pg_temp.lista(1, 'pendiente_por_facturar'), 600, 'A4 · la lista coincide con el detalle (600)');
SELECT public.chk_num((SELECT (x->>'pendiente_por_facturar')::numeric FROM jsonb_array_elements(
   public.compras_seguimiento_orden('0f700000-0000-0000-0000-000000000001')->'lineas') x WHERE (x->>'linea')::int = 3), 600,
  'A4 · el detalle por renglón también: el renglón 3 debe 600');
SELECT public.chk_num((SELECT (x->>'pendiente_por_facturar')::numeric FROM jsonb_array_elements(
   public.compras_seguimiento_orden('0f700000-0000-0000-0000-000000000001')->'lineas') x WHERE (x->>'linea')::int = 1), 0,
  'A4 · y los renglones 1 y 2, ya facturados completos, deben 0 aunque se facturaran a otro precio');

-- Se factura el resto: TODAS las cantidades facturadas → pendiente CERO.
SELECT pg_temp.facturar_linea(1, 3, 6, 100, 'ZZ-A-5');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE numero_factura = 'ZZ-A-5';
RESET ROLE;
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_facturar'), 0, 'A5 · todas las cantidades facturadas: pendiente = 0 (con descuento y sobreprecio mezclados)');
SELECT public.chk_num(pg_temp.lista(1, 'pendiente_por_facturar'), 0, 'A5 · la lista también');
SELECT public.chk_num(pg_temp.ind(1, 'diferencia_precio_facturada'), 100, 'A5 · la diferencia de precio se conserva aparte (100)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '0f700000-0000-0000-0000-000000000001'), 'cerrada', 'A5 · la orden recibida y facturada del todo se cierra sola');

-- Operaciones: no recibe nada financiero (ni por la lista ni por el detalle) pero sí lo pendiente por recibir.
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(pg_temp.ind(1, 'pendiente_por_facturar') IS NULL AND pg_temp.ind(1, 'diferencia_precio_facturada') IS NULL, true,
  'A6 · Operaciones: pendiente por facturar y diferencia de precio = NULL (detalle)');
SELECT public.chk_bool(pg_temp.lista(1, 'pendiente_por_facturar') IS NULL AND pg_temp.lista(1, 'diferencia_precio_facturada') IS NULL, true,
  'A6 · Operaciones: lo mismo en la lista');
SELECT public.chk_num(pg_temp.ind(1, 'pendiente_por_recibir'), 0, 'A6 · Operaciones sí ve lo pendiente por recibir');
SELECT public.chk_bool((SELECT bool_and((x->'pendiente_por_facturar') = 'null'::jsonb AND (x->'diferencia_precio') = 'null'::jsonb)
   FROM jsonb_array_elements(public.compras_seguimiento_orden('0f700000-0000-0000-0000-000000000001')->'lineas') x), true,
  'A6 · Operaciones: ningún renglón trae importes de facturación');
RESET ROLE;

-- Pendiente por RECIBIR a media recepción, a precio de la orden (no al costo de recepción).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('0f700000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Recepción a otro costo');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
VALUES ('0f710000-0000-0000-0003-000000000001', :C::uuid, '0f700000-0000-0000-0000-000000000003', 1, 'Renglón 1', 'gasto', 'mantenimiento', 10, 'u', 100, 0);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '0f700000-0000-0000-0000-000000000003';
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = '0f700000-0000-0000-0000-000000000003';
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo)
VALUES ('0f720000-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, '0f700000-0000-0000-0000-000000000003', 'bienes');
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad, costo_unitario)
VALUES (:C::uuid, '0f720000-0000-0000-0000-000000000003', '0f710000-0000-0000-0003-000000000001', 4, 80);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = '0f720000-0000-0000-0000-000000000003';
SELECT public.chk_num(pg_temp.ind(3, 'pendiente_por_recibir'), 600, 'A7 · recibidas 4 de 10 (costo de recepción 80): faltan 6 × precio de la orden 100 = 600');
SELECT public.chk_num(pg_temp.ind(3, 'pendiente_por_facturar'), 400, 'A7 · y lo recibido sin facturar vale 4 × 100 = 400, no 4 × 80');
RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- B · RESPALDOS: VALIDACIÓN EN SERVIDOR
-- ════════════════════════════════════════════════════════════════════════════
CREATE FUNCTION pg_temp.recepcion_borrador(p_n int, p_tipo text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_o uuid := ('0f800000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
  v_l uuid := ('0f810000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
BEGIN
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
  VALUES (v_o, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'Ferretería Bloque B', 'Respaldos ' || p_n);
  INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
  VALUES (v_l, 'cccccccc-cccc-cccc-cccc-cccccccccccc', v_o, 1, 'Renglón', CASE WHEN p_tipo = 'servicio' THEN 'servicio' ELSE 'gasto' END, 'mantenimiento', 5, 'u', 10, 0);
  UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = v_o;
  UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = v_o;
  INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por)
  VALUES (('0f820000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', v_o, p_tipo,
          CASE WHEN p_tipo = 'servicio' THEN 'c0c0c0c0-0000-0000-0000-00000000000c'::uuid END);
  INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', ('0f820000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid, v_l, 1);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.recepcion_borrador(int, text) TO authenticated;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT pg_temp.recepcion_borrador(1, 'bienes');     -- RB1: la que más se manipula
SELECT pg_temp.recepcion_borrador(2, 'servicio');   -- RS2: conformidad
SELECT pg_temp.recepcion_borrador(3, 'bienes');     -- RB3: se registrará (inmutable)
RESET ROLE;

\set RB1 '''0f820000-0000-0000-0000-000000000001'''
\set RS2 '''0f820000-0000-0000-0000-000000000002'''
\set RB3 '''0f820000-0000-0000-0000-000000000003'''
\set RUTA '''cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/'''
\set RUTA2 '''cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000002/'''
\set RUTA3 '''cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000003/'''

-- Objetos subidos con metadatos reales (como los guarda Storage).
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
  ('recepciones-respaldo', :RUTA || 'ok-1.pdf',  '{"size": 52000, "mimetype": "application/pdf"}'::jsonb),
  ('recepciones-respaldo', :RUTA || 'ok-2.png',  '{"size": 80000, "mimetype": "image/png"}'::jsonb),
  ('recepciones-respaldo', :RUTA || 'ok-3.pdf',  '{"size": 1000, "mimetype": "application/pdf"}'::jsonb),
  ('recepciones-respaldo', :RUTA2 || 'acta.pdf', '{"size": 30000, "mimetype": "application/pdf"}'::jsonb),
  ('recepciones-respaldo', :RUTA3 || 'rem.pdf',  '{"size": 20000, "mimetype": "application/pdf"}'::jsonb),
  ('recepciones-respaldo', :RUTA3 || 'rem-2.pdf',  '{"size": 20001, "mimetype": "application/pdf"}'::jsonb);

-- B1 · INSERT directo (la tabla tiene GRANT INSERT): evidencia inexistente, rechazada.
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/fantasma.pdf',
          'fantasma.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_OBJETO', 'B1 · INSERT directo de un archivo que NO existe en el almacenamiento');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0f820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/fantasma.pdf',
  'fantasma.pdf', 'application/pdf', 100, repeat('a', 64), 'entrega') $$,
  'COMPRAS_RESPALDO_OBJETO', 'B1 · la RPC: el mismo rechazo');

-- B2 · el objeto está en OTRO bucket (mismo nombre): no cuenta.
RESET ROLE;
INSERT INTO storage.buckets (id, name, public) VALUES ('otro-bucket-zz', 'otro-bucket-zz', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('otro-bucket-zz', :RUTA || 'solo-en-otro-bucket.pdf', '{"size": 100, "mimetype": "application/pdf"}'::jsonb);
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/solo-en-otro-bucket.pdf',
          'x.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_OBJETO', 'B2 · un objeto que está en OTRO bucket no sirve como evidencia');

-- B3 · metadatos: tamaño y tipo MIME deben coincidir con lo que Storage guardó.
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-1.pdf',
          'ok-1.pdf', 'entrega', 'application/pdf', 99999, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_METADATOS', 'B3 · tamaño declarado distinto del almacenado');
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-1.pdf',
          'ok-1.pdf', 'entrega', 'image/png', 52000, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_METADATOS', 'B3 · tipo MIME declarado distinto del almacenado');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0f820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-1.pdf',
  'ok-1.pdf', 'application/pdf', 99999, repeat('a', 64), 'entrega') $$,
  'COMPRAS_RESPALDO_METADATOS', 'B3 · la RPC: el mismo contraste de metadatos');

-- B4 · ruta: de otra recepción, de otro proyecto, con recorrido de directorios.
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000003/rem.pdf',
          'rem.pdf', 'entrega', 'application/pdf', 20000, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_RUTA', 'B4 · la ruta pertenece a OTRA recepción (aunque el objeto exista)');
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c2c2c2c2-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/x.pdf',
          'x.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_RUTA', 'B4 · la carpeta de proyecto no es la de la recepción');
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/../0f820000-0000-0000-0000-000000000003/rem.pdf',
          'x.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_RUTA', 'B4 · recorrido de directorios (..) rechazado');
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'sin-forma-de-ruta.pdf', 'x.pdf', 'entrega', 'application/pdf', 100, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_RUTA', 'B4 · una ruta sin la forma <empresa>/<proyecto>/<recepción>/<archivo>');

-- B5 · tipo de evidencia: conformidad solo en servicios; entrega solo en bienes (también por INSERT directo).
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-1.pdf',
          'ok-1.pdf', 'conformidad', 'application/pdf', 52000, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_TIPO', 'B5 · «conformidad» en una recepción de BIENES, por INSERT directo');
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000002/acta.pdf',
          'acta.pdf', 'entrega', 'application/pdf', 30000, repeat('a', 64)) $$,
  'COMPRAS_RESPALDO_TIPO', 'B5 · «entrega» en un SERVICIO, por INSERT directo');

-- B6 · el camino feliz: objeto real, metadatos coherentes → se registra; quién y cuándo los pone el servidor.
INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256, created_by, company_id)
VALUES ('0f820000-0000-0000-0000-000000000001', :RUTA || 'ok-1.pdf', 'Remisión 1.pdf', 'entrega', 'application/pdf', 52000, repeat('a', 64),
        :UB::uuid, 'dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid), 1, 'B6 · INSERT directo con objeto real y metadatos coherentes: se registra');
RESET ROLE;
SELECT public.chk_uuid((SELECT created_by FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid), :UO::uuid, 'B6 · quién lo subió lo pone el servidor (no el que declaró el cliente)');
SELECT public.chk_uuid((SELECT company_id FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid), :C::uuid, 'B6 · la empresa sale de la recepción (no la que declaró el cliente)');
SELECT public.chk_txt((SELECT respaldo_path FROM public.recepciones WHERE id = :RB1::uuid), :RUTA || 'ok-1.pdf', 'B6 · el primer archivo pasa a ser el respaldo principal');

-- B7 · alcance: otra empresa y un operador sin permiso no registran evidencia de esta recepción.
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-2.png',
          'ok-2.png', 'entrega', 'image/png', 80000, repeat('b', 64)) $$,
  'row-level security|COMPRAS_RESPALDO', 'B7 · el admin de OTRA empresa no registra evidencia de mi recepción (INSERT directo)');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0f820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-2.png',
  'ok-2.png', 'image/png', 80000, repeat('b', 64), 'entrega') $$,
  'COMPRAS_RESPALDO', 'B7 · ni por la RPC');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id, ruta, nombre, tipo, mime, bytes, sha256)
  VALUES ('0f820000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000001/ok-2.png',
          'ok-2.png', 'entrega', 'image/png', 80000, repeat('b', 64)) $$,
  'row-level security|COMPRAS_RESPALDO', 'B7 · un operador SIN permiso de órdenes tampoco');
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos), 0, 'B7 · y no ve la evidencia que no le corresponde');
RESET ROLE;

-- B8 · la referencia principal: solo a un archivo REGISTRADO de esa recepción.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
  jsonb_build_object('orden_compra_id', '0f800000-0000-0000-0000-000000000001', 'tipo', 'bienes', 'clave_idempotencia', 'zz-ref-fantasma',
                     'respaldo_path', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/inexistente/x.pdf'),
  jsonb_build_array(jsonb_build_object('orden_compra_linea_id', '0f810000-0000-0000-0000-000000000001', 'cantidad', 1))) $$,
  'COMPRAS_RESPALDO_REFERENCIA', 'B8 · crear una recepción con respaldo_path (RPC) es rechazado: la evidencia se adjunta después');
SELECT public.chk_num((SELECT count(*) FROM public.recepciones WHERE clave_idempotencia = 'zz-ref-fantasma'), 0, 'B8 · y no queda cabecera huérfana');
SELECT public.chk_falla($$ INSERT INTO public.recepciones (company_id, project_id, orden_compra_id, tipo, respaldo_path)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', '0f800000-0000-0000-0000-000000000001', 'bienes', 'cualquier/cosa.pdf') $$,
  'COMPRAS_RESPALDO_REFERENCIA', 'B8 · INSERT directo de una recepción con respaldo_path inventado');
RESET ROLE;
-- El UPDATE de una recepción lo hace quien administra (el operador captura; sus UPDATE no alcanzan filas).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET respaldo_path = 'cualquier/cosa.pdf' WHERE id = '0f820000-0000-0000-0000-000000000001' $$,
  'COMPRAS_RESPALDO_REFERENCIA', 'B8 · UPDATE del borrador hacia una ruta que no está registrada');
SELECT public.chk_falla($$ UPDATE public.recepciones SET respaldo_path = 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000003/rem.pdf' WHERE id = '0f820000-0000-0000-0000-000000000001' $$,
  'COMPRAS_RESPALDO_REFERENCIA', 'B8 · ni hacia el archivo registrado de OTRA recepción');
RESET ROLE;

-- B9 · retiro del principal en borrador: se sustituye por el siguiente; al quedar sin archivos, NULL.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.compras_recepcion_adjuntar(:RB1::uuid, :RUTA || 'ok-2.png', 'Foto.png', 'image/png', 80000, repeat('b', 64), 'entrega');
SELECT public.compras_recepcion_adjuntar(:RB1::uuid, :RUTA || 'ok-3.pdf', 'Otra.pdf', 'application/pdf', 1000, repeat('c', 64), 'entrega');
RESET ROLE;
SELECT public.chk_txt((SELECT respaldo_path FROM public.recepciones WHERE id = :RB1::uuid), :RUTA || 'ok-1.pdf', 'B9 · con tres archivos, el principal sigue siendo el primero');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
DELETE FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid AND ruta = :RUTA || 'ok-1.pdf';
RESET ROLE;
SELECT public.chk_txt((SELECT respaldo_path FROM public.recepciones WHERE id = :RB1::uuid), :RUTA || 'ok-2.png',
  'B9 · retirar el principal en borrador: la referencia pasa al siguiente archivo (no queda apuntando al retirado)');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
DELETE FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid AND ruta = :RUTA || 'ok-3.pdf';   -- no era el principal
RESET ROLE;
SELECT public.chk_txt((SELECT respaldo_path FROM public.recepciones WHERE id = :RB1::uuid), :RUTA || 'ok-2.png', 'B9 · retirar uno que NO es el principal no cambia la referencia');
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
DELETE FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid AND ruta = :RUTA || 'ok-2.png';
RESET ROLE;
SELECT public.chk_bool((SELECT respaldo_path IS NULL FROM public.recepciones WHERE id = :RB1::uuid), true, 'B9 · sin archivos registrados, la referencia principal queda vacía');
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB1::uuid), 0, 'B9 · y no queda ningún registro');
-- El mismo archivo puede volver a registrarse tras retirarlo y fija de nuevo el principal.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.compras_recepcion_adjuntar(:RB1::uuid, :RUTA || 'ok-3.pdf', 'Otra.pdf', 'application/pdf', 1000, repeat('c', 64), 'entrega');
RESET ROLE;
SELECT public.chk_txt((SELECT respaldo_path FROM public.recepciones WHERE id = :RB1::uuid), :RUTA || 'ok-3.pdf', 'B9 · al volver a adjuntar, el principal se fija de nuevo');

-- B10 · la evidencia de una recepción REGISTRADA no se modifica: ni editar, ni retirar, ni cambiar la referencia.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.compras_recepcion_adjuntar(:RB3::uuid, :RUTA3 || 'rem.pdf', 'Rem.pdf', 'application/pdf', 20000, repeat('d', 64), 'entrega');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = :RB3::uuid;
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
-- Evidencia ADICIONAL sí; modificar o retirar la existente, no.
SELECT public.compras_recepcion_adjuntar(:RB3::uuid, :RUTA3 || 'rem-2.pdf', 'Rem 2.pdf', 'application/pdf', 20001, repeat('e', 64), 'entrega');
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB3::uuid), 2, 'B10 · con la recepción registrada se puede AÑADIR evidencia');
SELECT public.chk_falla($$ UPDATE public.recepcion_respaldos SET nombre = 'cambiado', sha256 = repeat('f', 64) WHERE recepcion_id = '0f820000-0000-0000-0000-000000000003' $$,
  'permission denied', 'B10 · editar una evidencia: sin privilegio de UPDATE');
DELETE FROM public.recepcion_respaldos WHERE recepcion_id = :RB3::uuid;   -- la policy lo filtra: 0 filas
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB3::uuid), 2, 'B10 · retirar evidencia de una recepción registrada no borra nada (policy)');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET respaldo_path = NULL WHERE id = '0f820000-0000-0000-0000-000000000003' $$,
  'COMPRAS_RECEPCION_RESPALDO_CONGELADO', 'B10 · limpiar la referencia principal de una recepción registrada');
SELECT public.chk_falla($$ UPDATE public.recepciones SET respaldo_path = 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000003/rem-2.pdf' WHERE id = '0f820000-0000-0000-0000-000000000003' $$,
  'COMPRAS_RECEPCION_RESPALDO_CONGELADO', 'B10 · sustituirla por otro archivo registrado');
RESET ROLE;
-- Aunque alguien con privilegios amplios intente el DELETE, el trigger lo impide con el motivo claro.
SELECT public.chk_falla($$ DELETE FROM public.recepcion_respaldos WHERE recepcion_id = '0f820000-0000-0000-0000-000000000003' $$,
  'COMPRAS_RESPALDO_INMUTABLE', 'B10 · DELETE con privilegios amplios: el trigger lo rechaza (recepción registrada)');
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB3::uuid), 2, 'B10 · la evidencia sigue íntegra');

-- B11 · idempotencia y reintento de la RPC (mismo archivo: mismo registro; otro contenido: conflicto).
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_bool((public.compras_recepcion_adjuntar(:RB3::uuid, :RUTA3 || 'rem.pdf', 'Rem.pdf', 'application/pdf', 20000, repeat('d', 64), 'entrega')->>'reutilizado')::boolean, true,
  'B11 · reintentar el mismo archivo devuelve el registro existente');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0f820000-0000-0000-0000-000000000003',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0f820000-0000-0000-0000-000000000003/rem.pdf',
  'Rem.pdf', 'application/pdf', 20000, repeat('9', 64), 'entrega') $$,
  'COMPRAS_RESPALDO_CONFLICTO', 'B11 · la misma ruta con otro contenido es un conflicto');
SELECT public.chk_num((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB3::uuid), 2, 'B11 · los reintentos no duplican registros');
RESET ROLE;

-- B12 · conformidad de servicio: se registra y la recepción anulada no admite más.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.compras_recepcion_adjuntar(:RS2::uuid, :RUTA2 || 'acta.pdf', 'Acta.pdf', 'application/pdf', 30000, repeat('a', 64), 'conformidad')->'respaldo'->>'tipo',
  'conformidad', 'B12 · la conformidad de un servicio se registra con su tipo');
RESET ROLE;
