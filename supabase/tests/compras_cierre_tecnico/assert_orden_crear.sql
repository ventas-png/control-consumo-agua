\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · CREACIÓN TRANSACCIONAL E IDEMPOTENTE DE LA ORDEN DE COMPRA
-- (migración 20261026000300: compras_orden_crear)
--
--   1 · cabecera y renglones juntos desde Contabilidad y desde Operaciones
--   2 · idempotencia: doble clic / reintento = la MISMA orden; misma clave con otro contenido = conflicto
--   3 · todo o nada: cualquier renglón o dato inválido deja CERO filas (ni cabecera ni renglones)
--   4 · las validaciones de siempre siguen mandando (proveedor, contrato, cuentas, inventario)
--   5 · permisos y alcance (empresa, proyecto, rol); anon sin acceso
--   6 · el ciclo posterior (aprobar, emitir) y la importación de renglones no cambian
--
-- Se monta sobre el fixture del bloque B y fixture_lectura.sql (perfiles UV, UK1, UOS…).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UK  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set UV  '''f1000000-0000-0000-0000-0000000000a1'''
\set UOS '''f1000000-0000-0000-0000-0000000000a8'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set P2  '''e3000000-0000-0000-0000-000000000002'''
\set P3  '''e3000000-0000-0000-0000-000000000003'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''
\set IN1 '''0ee20000-0000-0000-0000-000000000001'''
\set IN2 '''0ee20000-0000-0000-0000-000000000002'''
\set K1  '''0ee30000-0000-0000-0000-000000000001'''
\set K2  '''0ee30000-0000-0000-0000-000000000002'''

-- ── Ayudas de la prueba ─────────────────────────────────────────────────────
CREATE FUNCTION public.oc_cab(p_clave text, p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001', 'proveedor_nombre', 'NOMBRE FALSO DEL CLIENTE',
                            'concepto', 'Orden LF transaccional', 'clave_idempotencia', p_clave) || p_extra
$$;
CREATE FUNCTION public.oc_lin(p_desc text, p_cant numeric, p_precio numeric, p_extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('descripcion', p_desc, 'destino_tipo', 'gasto', 'categoria', 'mantenimiento', 'cantidad', p_cant,
                            'unidad', 'u', 'precio_unitario', p_precio, 'iva_monto', 0) || p_extra
$$;
-- Cuenta filas sin pasar por la RLS (cualquier perfil puede preguntarla): órdenes × 1 000 000 + renglones.
CREATE FUNCTION public.zz_total_oc() RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT (SELECT count(*) FROM public.ordenes_compra) * 1000000 + (SELECT count(*) FROM public.orden_compra_lineas)
$$;
GRANT EXECUTE ON FUNCTION public.zz_total_oc() TO authenticated;
-- Exige que la creación FALLE por lo esperado Y que no deje NADA (ni cabecera ni renglones).
CREATE FUNCTION public.chk_oc_nada(p_company uuid, p_proj uuid, p_cab jsonb, p_lin jsonb, p_patron text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_antes bigint := public.zz_total_oc();
BEGIN
  BEGIN
    PERFORM public.compras_orden_crear(p_company, p_proj, p_cab, p_lin);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ p_patron THEN
      RAISE EXCEPTION '% — falló, pero por otra cosa: %', p_msg, SQLERRM;
    END IF;
    IF public.zz_total_oc() <> v_antes THEN
      RAISE EXCEPTION '% — falló, pero DEJÓ DATOS A MEDIAS (antes %, después %)', p_msg, v_antes, public.zz_total_oc();
    END IF;
    RAISE NOTICE '✓ % (%)', p_msg, left(SQLERRM, 90);
    RETURN;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', p_msg;
END $$;

CREATE TEMP TABLE res_oc (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_oc TO authenticated;

-- ── Padrón propio: insumos de C1 y C2, contratos de P1 y de P2 en C1, P3 suspendido en C1 ──
INSERT INTO public.suministros_condominio (id, company_id, project_id, nombre, unidad_medida) VALUES
  (:IN1::uuid, :C::uuid, :C1::uuid, 'Cloro LF',      'litro'),
  (:IN2::uuid, :C::uuid, :C2::uuid, 'Insumo LF de C2', 'litro');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores
  (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda,
   importe_periodico, monto_maximo, responsable_id) VALUES
  (:K1::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'x', 'LF-K1', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, NULL, :UA::uuid),
  (:K2::uuid, :C::uuid, :C1::uuid, :P2::uuid, 'x', 'LF-K2', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, NULL, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id IN (:K1::uuid, :K2::uuid);
RESET ROLE;
INSERT INTO public.proveedor_proyectos (proveedor_id, project_id, company_id, estado, motivo_estado)
VALUES (:P3::uuid, :C1::uuid, :C::uuid, 'suspendido', 'Incumplimiento en el proyecto')
ON CONFLICT (proveedor_id, project_id) DO UPDATE SET estado = 'suspendido', motivo_estado = 'Incumplimiento en el proyecto';
SELECT id AS cuenta_ajena FROM public.conta_cuentas WHERE company_id = :D::uuid AND es_detalle LIMIT 1 \gset
SELECT id AS cuenta_valida FROM public.conta_cuentas WHERE company_id = :C::uuid AND project_id = :C1::uuid AND codigo = '5199' \gset

-- ═════════ 1 · CABECERA Y RENGLONES JUNTOS, DESDE CONTABILIDAD Y DESDE OPERACIONES ═════════
SELECT public.como(:UK::uuid);                       -- Contabilidad
SET ROLE authenticated;
INSERT INTO res_oc SELECT 'a', public.compras_orden_crear(:C::uuid, :C1::uuid,
  public.oc_cab('lf-orden-0001', '{"descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega"}'),
  jsonb_build_array(public.oc_lin('Material', 10, 10, '{"iva_monto":12}'), public.oc_lin('Insumo', 5, 20, '{"iva_monto":12}')));
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_oc WHERE k = 'a'), false, '1 · creación nueva (no reutilizada)');
SELECT public.chk_txt((SELECT j->'orden'->>'estado' FROM res_oc WHERE k = 'a'), 'borrador', '1 · nace en borrador');
SELECT public.chk((SELECT jsonb_array_length(j->'lineas') FROM res_oc WHERE k = 'a'), 2, '1 · con sus dos renglones en la respuesta');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), 2, '1 · y en la tabla');
SELECT public.chk_txt((SELECT string_agg(linea::text || ':' || descripcion, ',' ORDER BY linea) FROM public.orden_compra_lineas WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')),
  '1:Material,2:Insumo', '1 · renglones numerados en el orden en que se enviaron');
SELECT public.chk_txt((SELECT j->'orden'->>'proveedor_nombre' FROM res_oc WHERE k = 'a'), 'Ferretería Bloque B', '1 · el nombre del proveedor sale del catálogo, no de lo que mandó el cliente');
SELECT public.chk_uuid((SELECT (j->'orden'->>'created_by')::uuid FROM res_oc WHERE k = 'a'), :UK::uuid, '1 · quién la capturó lo pone el servidor');
SELECT public.chk_num((SELECT (j->'orden'->>'subtotal')::numeric FROM res_oc WHERE k = 'a'), 200, '1 · el subtotal sale de los renglones (200)');
SELECT public.chk_num((SELECT (j->'orden'->>'iva_monto')::numeric FROM res_oc WHERE k = 'a'), 24, '1 · el IVA sale de los renglones (24)');
SELECT public.chk_num((SELECT (j->'orden'->>'total')::numeric FROM res_oc WHERE k = 'a'), 224, '1 · el total sale de los renglones (224)');
SELECT public.chk_txt((SELECT j->'orden'->>'numero' FROM res_oc WHERE k = 'a'), NULL, '1 · sin número hasta aprobarse (como siempre)');
SELECT public.chk_txt((SELECT j->'orden'->>'clave_idempotencia' FROM res_oc WHERE k = 'a'), 'lf-orden-0001', '1 · la clave queda registrada');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), 1, '1 · y el historial de la orden registra su creación (trigger de siempre)');

SELECT public.como(:UO::uuid);                       -- Operaciones: con renglones…
SET ROLE authenticated;
INSERT INTO res_oc SELECT 'o1', public.compras_orden_crear(:C::uuid, :C1::uuid,
  public.oc_cab('lf-orden-ops-01', '{"concepto":"Orden de Operaciones con renglones","monto_estimado":500}'),
  jsonb_build_array(public.oc_lin('Cloro', 4, 25), public.oc_lin('Guantes', 2, 10)));
-- …y solo la cabecera (la importación de renglones sigue siendo el camino para cargarlos después).
INSERT INTO res_oc SELECT 'o2', public.compras_orden_crear(:C::uuid, :C1::uuid,
  public.oc_cab('lf-orden-ops-02', '{"concepto":"Orden de Operaciones solo cabecera"}'), '[]'::jsonb);
INSERT INTO res_oc SELECT 'o3', public.compras_orden_crear(:C::uuid, :C1::uuid,
  public.oc_cab('lf-orden-ops-03', '{"concepto":"Orden de Operaciones sin lista de renglones"}'), NULL);
RESET ROLE;
SELECT public.chk((SELECT jsonb_array_length(j->'lineas') FROM res_oc WHERE k = 'o1'), 2, '1 · Operaciones: cabecera y 2 renglones en una sola operación');
SELECT public.chk_uuid((SELECT (j->'orden'->>'created_by')::uuid FROM res_oc WHERE k = 'o1'), :UO::uuid, '1 · Operaciones: el solicitante es quien llamó');
SELECT public.chk_num((SELECT (j->'orden'->>'monto_estimado')::numeric FROM res_oc WHERE k = 'o1'), 500, '1 · Operaciones: conserva el monto estimado de su formulario');
SELECT public.chk((SELECT jsonb_array_length(j->'lineas') FROM res_oc WHERE k = 'o2'), 0, '1 · Operaciones: solo cabecera es válido (0 renglones)');
SELECT public.chk_txt((SELECT j->'orden'->>'estado' FROM res_oc WHERE k = 'o3'), 'borrador', '1 · Operaciones: renglones NULL equivale a ninguno');

-- ═════════ 2 · IDEMPOTENCIA: doble clic y reintento ═════════════════════════
-- Mismo contenido escrito DISTINTO (10 / 10.0, 12 / 12.00) y misma clave → la MISMA orden.
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
INSERT INTO res_oc SELECT 'a2', public.compras_orden_crear(:C::uuid, :C1::uuid,
  public.oc_cab('lf-orden-0001', '{"descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega","proveedor_nombre":"OTRO NOMBRE"}'),
  '[{"descripcion":"Material","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":10.0,"unidad":"u","precio_unitario":10.00,"iva_monto":12.00},
    {"descripcion":"Insumo","destino_tipo":"gasto","categoria":"mantenimiento","cantidad":5,"unidad":"u","precio_unitario":20,"iva_monto":12}]'::jsonb);
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizada')::boolean FROM res_oc WHERE k = 'a2'), true, '2 · el reintento (cifras escritas distinto) se reconoce como el mismo');
SELECT public.chk_txt((SELECT j->'orden'->>'id' FROM res_oc WHERE k = 'a2'), (SELECT j->'orden'->>'id' FROM res_oc WHERE k = 'a'), '2 · devuelve la MISMA orden');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'lf-orden-0001'), 1, '2 · una sola orden');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), 2, '2 · y dos renglones, no cuatro');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), 1, '2 · y un solo evento de creación');

-- Un dato distinto (cantidad, concepto, un renglón de más o de menos, otro orden) con la MISMA clave: rechazo explícito.
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-0001', '{"descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega"}'),
  jsonb_build_array(public.oc_lin('Material', 9, 10, '{"iva_monto":12}'), public.oc_lin('Insumo', 5, 20, '{"iva_monto":12}')),
  'COMPRAS_ORDEN_CLAVE_CONFLICTO', '2 · misma clave con OTRA cantidad');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-0001', '{"concepto":"OTRO concepto","descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega"}'),
  jsonb_build_array(public.oc_lin('Material', 10, 10, '{"iva_monto":12}'), public.oc_lin('Insumo', 5, 20, '{"iva_monto":12}')),
  'COMPRAS_ORDEN_CLAVE_CONFLICTO', '2 · misma clave con OTRO concepto en la cabecera');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-0001', '{"descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega"}'),
  jsonb_build_array(public.oc_lin('Material', 10, 10, '{"iva_monto":12}')),
  'COMPRAS_ORDEN_CLAVE_CONFLICTO', '2 · misma clave con un renglón de menos');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-0001', '{"descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega"}'),
  jsonb_build_array(public.oc_lin('Insumo', 5, 20, '{"iva_monto":12}'), public.oc_lin('Material', 10, 10, '{"iva_monto":12}')),
  'COMPRAS_ORDEN_CLAVE_CONFLICTO', '2 · misma clave con los renglones en OTRO orden (el orden es parte del contenido)');
SELECT public.chk_oc_nada(:C::uuid, :C2::uuid, public.oc_cab('lf-orden-0001', '{"descripcion":"Mantenimiento mensual","dias_credito":30,"notas":"Entregar en bodega"}'),
  jsonb_build_array(public.oc_lin('Material', 10, 10, '{"iva_monto":12}'), public.oc_lin('Insumo', 5, 20, '{"iva_monto":12}')),
  'COMPRAS_ORDEN_CLAVE_CONFLICTO', '2 · misma clave en OTRO proyecto');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'lf-orden-0001'), 1, '2 · los rechazos no crearon nada');

-- La clave es de UN intento: no se edita después (ni por la API).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET clave_idempotencia = 'otra-clave-0002' WHERE clave_idempotencia = 'lf-orden-0001' $$,
  'COMPRAS_ORDEN_CLAVE_INMUTABLE', '2 · la clave de idempotencia no se modifica');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET hash_contenido = 'x' WHERE clave_idempotencia = 'lf-orden-0001' $$,
  'COMPRAS_ORDEN_CLAVE_INMUTABLE', '2 · ni la huella');
RESET ROLE;

-- ═════════ 3 · TODO O NADA: cualquier fallo deja cero filas ═════════════════
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
-- Renglón 2 con un insumo de OTRO proyecto: falla en el trigger de inventario, DESPUÉS de insertar la cabecera y el renglón 1.
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-1'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Cloro', 2, 5, '{"destino_tipo":"inventario","suministro_id":"0ee20000-0000-0000-0000-000000000002","unidad":"litro"}')),
  'COMPRAS_LINEA_INSUMO_ALCANCE', '3 · un insumo de otro proyecto en el 2.º renglón: no queda ni cabecera ni renglón 1');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-2'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Cloro', 2, 5, '{"destino_tipo":"inventario","suministro_id":"0ee20000-0000-0000-0000-000000000001","unidad":"galón"}')),
  'COMPRAS_LINEA_INSUMO_UNIDAD', '3 · la unidad no es la del insumo');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-3'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Un gasto con insumo', 2, 5, '{"suministro_id":"0ee20000-0000-0000-0000-000000000001","unidad":"litro"}')),
  'COMPRAS_LINEA_INSUMO_DESTINO', '3 · un insumo en un renglón que no es de inventario');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-4'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Con cuenta ajena', 2, 5, jsonb_build_object('cuenta_id', :'cuenta_ajena'))),
  'COMPRAS_LINEA_CUENTA_INVALIDA', '3 · una cuenta explícita de otra empresa');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-5'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Cantidad cero', 0, 5)),
  'COMPRAS_ORDEN_LINEA_INVALIDA', '3 · cantidad cero');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-6'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Precio negativo', 1, -5)),
  'COMPRAS_ORDEN_LINEA_INVALIDA', '3 · precio negativo');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-7'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Destino raro', 1, 5, '{"destino_tipo":"otro"}')),
  'COMPRAS_ORDEN_LINEA_INVALIDA', '3 · destino que no existe');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-8'),
  '[{"descripcion":"Material","cantidad":"abc","precio_unitario":10}]'::jsonb,
  'COMPRAS_ORDEN_LINEA_INVALIDA', '3 · una cantidad «abc» sale con código propio, no con el error crudo');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-9'),
  '"no es una lista"'::jsonb, 'COMPRAS_ORDEN_LINEA_INVALIDA', '3 · los renglones deben venir como lista');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-10'),
  '[1, 2]'::jsonb, 'COMPRAS_ORDEN_LINEA_INVALIDA', '3 · cada renglón debe ser un objeto');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-11'),
  (SELECT jsonb_agg(public.oc_lin('Renglón ' || g, 1, 1)) FROM generate_series(1, 501) g),
  'COMPRAS_ORDEN_LINEA_LIMITE', '3 · más de 500 renglones');
-- El reintento CORREGIDO con la misma clave crea exactamente UNA orden (el fallo no dejó la clave ocupada).
INSERT INTO res_oc SELECT 'fix', public.compras_orden_crear(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-fallo-1'),
  jsonb_build_array(public.oc_lin('Material', 1, 10), public.oc_lin('Cloro', 2, 5, '{"destino_tipo":"inventario","suministro_id":"0ee20000-0000-0000-0000-000000000001","unidad":"litro"}')));
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE clave_idempotencia = 'lf-orden-fallo-1'), 1, '3 · el reintento corregido con la misma clave crea UNA orden');
SELECT public.chk((SELECT jsonb_array_length(j->'lineas') FROM res_oc WHERE k = 'fix'), 2, '3 · con sus dos renglones (el de inventario con su insumo válido)');

-- ═════════ 4 · LAS VALIDACIONES DE SIEMPRE SIGUEN MANDANDO ══════════════════
SELECT public.como(:UK::uuid);
SET ROLE authenticated;
-- Cabecera.
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-01', '{"proveedor_id":"e3000000-0000-0000-0000-0000000000d1"}'), '[]'::jsonb,
  'COMPRAS_ORDEN_PROVEEDOR', '4 · un proveedor de OTRA empresa');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-02', '{"proveedor_id":null}'), '[]'::jsonb,
  'COMPRAS_ORDEN_PROVEEDOR', '4 · sin proveedor');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-03', '{"concepto":"ab"}'), '[]'::jsonb,
  'COMPRAS_ORDEN_CONCEPTO', '4 · concepto demasiado corto');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-04', '{"fecha_requerida":"31/12/2026"}'), '[]'::jsonb,
  'COMPRAS_ORDEN_CABECERA', '4 · una fecha mal escrita sale con código propio');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-05', '{"dias_credito":400}'), '[]'::jsonb,
  'COMPRAS_ORDEN_CABECERA', '4 · días de crédito fuera de rango');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab(''), '[]'::jsonb, 'COMPRAS_ORDEN_CLAVE_REQUERIDA', '4 · sin clave de idempotencia');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('corta'), '[]'::jsonb, 'COMPRAS_ORDEN_CLAVE_REQUERIDA', '4 · clave demasiado corta (menos de 8)');
SELECT public.chk_oc_nada(:C::uuid, 'ffffffff-ffff-ffff-ffff-ffffffffffff', public.oc_cab('lf-orden-val-06'), '[]'::jsonb,
  'COMPRAS_ORDEN_PROYECTO', '4 · un proyecto que no existe');
SELECT public.chk_oc_nada(:C::uuid, :D1::uuid, public.oc_cab('lf-orden-val-07'), '[]'::jsonb,
  'COMPRAS_ORDEN_PROYECTO', '4 · un proyecto de OTRA empresa');
SELECT public.chk_oc_nada(:D::uuid, :D1::uuid, public.oc_cab('lf-orden-val-08', '{"proveedor_id":"e3000000-0000-0000-0000-0000000000d1"}'), '[]'::jsonb,
  'COMPRAS_ORDEN_EMPRESA', '4 · crear en una empresa distinta de la tuya');
-- Triggers de siempre (la función no los esquiva): proveedor habilitado en el proyecto y contrato coherente.
-- Capturar el borrador NO se bloquea por un proveedor suspendido en el proyecto (regla de siempre: se puede
-- preparar la orden mientras se regulariza); lo que se bloquea es APROBAR y EMITIR. La función no cambia eso.
INSERT INTO res_oc SELECT 'susp', public.compras_orden_crear(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-09', '{"proveedor_id":"e3000000-0000-0000-0000-000000000003"}'),
  jsonb_build_array(public.oc_lin('Material', 1, 10)));
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-10', '{"contrato_id":"0ee30000-0000-0000-0000-000000000002"}'),
  jsonb_build_array(public.oc_lin('Material', 1, 10)),
  'COMPRAS_CONTRATO_PROVEEDOR', '4 · un contrato de OTRO proveedor (trigger de siempre)');
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-11', '{"contrato_id":"0ee30000-0000-0000-0000-0000000000ff"}'),
  jsonb_build_array(public.oc_lin('Material', 1, 10)),
  'COMPRAS_CONTRATO_|foreign key|violates', '4 · un contrato que no existe');
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE clave_idempotencia = 'lf-orden-val-09' $$,
  'COMPRAS_PROVEEDOR_PROYECTO_NO_HABILITADO|COMPRAS_PROVEEDOR_NO_AUTORIZADO', '4 · …pero ese borrador no se aprueba: el candado del proveedor sigue en el trigger de siempre');
RESET ROLE;
SELECT public.como(:UK::uuid); SET ROLE authenticated;
-- Y lo válido pasa: un contrato del proveedor, vigente, y un renglón de inventario con su insumo.
INSERT INTO res_oc SELECT 'k', public.compras_orden_crear(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-val-12', jsonb_build_object('contrato_id', :K1)),
  jsonb_build_array(public.oc_lin('Cloro al amparo del contrato', 3, 5, '{"destino_tipo":"inventario","suministro_id":"0ee20000-0000-0000-0000-000000000001","unidad":"litro"}')));
RESET ROLE;
SELECT public.chk_txt((SELECT j->'orden'->>'contrato_id' FROM res_oc WHERE k = 'k'), '0ee30000-0000-0000-0000-000000000001', '4 · una orden al amparo de un contrato vigente se crea, ligada a él');
SELECT public.chk_txt((SELECT j->'lineas'->0->>'suministro_id' FROM res_oc WHERE k = 'k'), '0ee20000-0000-0000-0000-000000000001', '4 · y el renglón de inventario guarda su insumo');
-- Cuentas: sin cuenta explícita el renglón queda sin cuenta (la resuelve el servidor al contabilizar, como siempre: la función
-- no la inventa ni la exige); con una cuenta explícita VÁLIDA la guarda y la marca como elegida a mano.
SELECT public.chk_bool((SELECT (j->'lineas'->0->>'cuenta_id') IS NULL FROM res_oc WHERE k = 'a'), true, '4 · sin cuenta explícita el renglón queda sin cuenta (se resuelve al contabilizar, como siempre)');
SELECT public.como(:UK::uuid); SET ROLE authenticated;
INSERT INTO res_oc SELECT 'cta', public.compras_orden_crear(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-cta-001'),
  jsonb_build_array(public.oc_lin('Con cuenta explícita', 1, 10, jsonb_build_object('cuenta_id', :'cuenta_valida'))));
RESET ROLE;
SELECT public.chk_txt((SELECT j->'lineas'->0->>'cuenta_origen' FROM res_oc WHERE k = 'cta'), 'linea_explicita', '4 · una cuenta explícita válida se guarda y queda marcada como elegida a mano');

-- ═════════ 5 · PERMISOS Y ALCANCE ═══════════════════════════════════════════
SELECT public.como(:UOS::uuid); SET ROLE authenticated;
SELECT public.chk_oc_nada(:C::uuid, :C2::uuid, public.oc_cab('lf-orden-perm-01'), '[]'::jsonb,
  'COMPRAS_ORDEN_PROYECTO', '5 · Operaciones asignado SOLO a C1 no crea en C2');
INSERT INTO res_oc SELECT 'os', public.compras_orden_crear(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-perm-02'), jsonb_build_array(public.oc_lin('Material', 1, 1)));
RESET ROLE;
SELECT public.chk_txt((SELECT j->'orden'->>'project_id' FROM res_oc WHERE k = 'os'), 'c1c1c1c1-0000-0000-0000-000000000001', '5 · …y sí en C1');

SELECT public.como(:UV::uuid); SET ROLE authenticated;
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-perm-03'), '[]'::jsonb,
  'row-level security', '5 · un viewer no crea órdenes (la política de escritura de siempre)');
RESET ROLE;

SELECT public.como(:UD::uuid); SET ROLE authenticated;
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-perm-04'), '[]'::jsonb,
  'COMPRAS_ORDEN_EMPRESA', '5 · el admin de otra empresa no crea en la nuestra');
RESET ROLE;

SELECT public.como(NULL::uuid);
SET ROLE anon;
SELECT public.chk_falla($$ SELECT public.compras_orden_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', NULL, '{}'::jsonb, '[]'::jsonb) $$,
  'permission denied', '5 · anon no ejecuta la función');
RESET ROLE;

-- Misma clave desde otro alcance: no se revela la orden ajena. UOS no ve (C2 queda fuera) → «en uso», no la devuelve.
SELECT public.como(:UK::uuid); SET ROLE authenticated;
INSERT INTO res_oc SELECT 'c2', public.compras_orden_crear(:C::uuid, :C2::uuid, public.oc_cab('lf-orden-c2-0001'), '[]'::jsonb);
RESET ROLE;
SELECT public.como(:UOS::uuid); SET ROLE authenticated;
SELECT public.chk_oc_nada(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-c2-0001'), '[]'::jsonb,
  'COMPRAS_ORDEN_CLAVE_EN_USO', '5 · la clave de una orden que no ves (otro proyecto) no la revela: sale «en uso»');
RESET ROLE;

-- ═════════ 6 · EL CICLO POSTERIOR Y LA IMPORTACIÓN NO CAMBIAN ═══════════════
-- Aprobar y emitir una orden creada por la función: numeración, sellos e historial de siempre.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a');
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a');
RESET ROLE;
SELECT public.chk_bool((SELECT numero LIKE 'OC-%' FROM public.ordenes_compra WHERE id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), true, '6 · aprobada: recibe su número OC-…');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), 'emitida', '6 · y se emite');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'a')), 3, '6 · con su historial: creada, aprobada, emitida');
-- Una orden con un renglón de inventario SIN insumo se puede capturar en borrador (como siempre) y NO se aprueba.
SELECT public.como(:UK::uuid); SET ROLE authenticated;
INSERT INTO res_oc SELECT 'inv', public.compras_orden_crear(:C::uuid, :C1::uuid, public.oc_cab('lf-orden-inv-001'),
  jsonb_build_array(public.oc_lin('Inventario sin insumo', 2, 5, '{"destino_tipo":"inventario"}')));
RESET ROLE;
SELECT public.como(:UA::uuid); SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE clave_idempotencia = 'lf-orden-inv-001' $$,
  'COMPRAS_ORDEN_INVENTARIO_SIN_INSUMO', '6 · inventario sin insumo: se captura, pero no se aprueba (regla de siempre)');
-- La importación de renglones (compras_lineas_importar_*) sobre una orden creada por la función: igual que antes.
INSERT INTO res_oc SELECT 'imp', public.compras_lineas_importar_previsualizar((SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'o2'),
  '[{"descripcion":"Cloro importado","destino":"gasto","categoria":"limpieza","cantidad":"10","unidad":"litro","precio_unitario":"12.50","iva":"15"},
    {"descripcion":"Servicio importado","destino":"servicio","categoria":"mantenimiento","cantidad":"1","precio_unitario":"300","iva":"36"}]'::jsonb, 'lf.csv');
INSERT INTO res_oc SELECT 'imp2', public.compras_lineas_importar_aplicar((SELECT (j->>'lote_id')::uuid FROM res_oc WHERE k = 'imp'));
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_lineas WHERE orden_compra_id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'o2')), 2, '6 · la importación agrega sus renglones a la orden creada solo con cabecera');
SELECT public.chk_num((SELECT total FROM public.ordenes_compra WHERE id = (SELECT (j->'orden'->>'id')::uuid FROM res_oc WHERE k = 'o2')), 476, '6 · y el total de la orden se recalcula (10 × 12.50 + 15 de IVA = 140, más 300 + 36 = 336)');
