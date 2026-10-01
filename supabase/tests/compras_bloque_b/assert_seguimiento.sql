\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · SEGUIMIENTO COMPARTIDO (migración 20261021000300).
-- Corre DESPUÉS de assert_factura.sql: reutiliza la orden OF (recibida y
-- facturada en dos facturas) y la orden de 0f100…05 (con una factura forzada).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set OF  '''0f100000-0000-0000-0000-000000000001'''

-- ── 1. Quien ve Contabilidad: los cuatro indicadores, por separado ──────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE seg AS SELECT public.compras_seguimiento_orden(:OF::uuid) AS j;
GRANT ALL ON seg TO authenticated;
RESET ROLE;
SELECT public.chk_num((SELECT (j->'indicadores'->>'comprometido')::numeric FROM seg), 2576, '1 · comprometido = lo autorizado (2576)');
SELECT public.chk_num((SELECT (j->'indicadores'->>'comprometido_neto')::numeric FROM seg), 2300, '1 · comprometido sin IVA (2300) + 276 de IVA');
SELECT public.chk_num((SELECT (j->'indicadores'->>'recibido')::numeric FROM seg), 2300, '1 · recibido = lo aceptado a precio de orden, sin IVA');
SELECT public.chk_num((SELECT (j->'indicadores'->>'facturado')::numeric FROM seg), 2576, '1 · facturado = facturas aprobadas (con IVA)');
SELECT public.chk_num((SELECT (j->'indicadores'->>'facturado_neto')::numeric FROM seg), 2300, '1 · y su neto, comparable con lo recibido');
SELECT public.chk_num((SELECT (j->'indicadores'->>'pendiente_por_facturar')::numeric FROM seg), 0, '1 · nada pendiente por facturar');
SELECT public.chk_num((SELECT (j->'indicadores'->>'pagado')::numeric FROM seg), 0, '1 · pagado es otro indicador (0): no se confunde con facturado');
SELECT public.chk_num((SELECT (j->'indicadores'->>'pendiente_por_recibir')::numeric FROM seg), 0, '1 · nada pendiente por recibir');
SELECT public.chk((SELECT jsonb_array_length(j->'facturas') FROM seg), 2, '1 · las dos facturas ligadas a la orden');
SELECT public.chk((SELECT jsonb_array_length(j->'recepciones') FROM seg), 3, '1 · las tres recepciones (bienes, bienes, servicio)');
SELECT public.chk((SELECT jsonb_array_length(j->'activos') FROM seg), 2, '1 · los dos activos dados de alta por la orden');
SELECT public.chk((SELECT jsonb_array_length(j->'movimientos_inventario') FROM seg), 2, '1 · las dos entradas de inventario');
SELECT public.chk_bool((SELECT bool_and((f->>'contabilizada')::boolean) FROM seg, jsonb_array_elements(j->'facturas') f), true, '1 · ambas facturas contabilizadas');
SELECT public.chk_bool((SELECT j->'orden'->>'estado' = 'cerrada' FROM seg), true, '1 · estado de la orden');
SELECT public.chk((SELECT jsonb_array_length(j->'eventos') FROM seg), 6, '1 · historial: borrador→aprobada→emitida, recibida parcial, recibida, cerrada');

-- ── 2. Diferencias a la vista en la orden con factura forzada ───────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE seg2 AS SELECT public.compras_seguimiento_orden('0f100000-0000-0000-0000-000000000002') AS j;
GRANT ALL ON seg2 TO authenticated;
RESET ROLE;
SELECT public.chk_bool((SELECT (j->'facturas'->0->>'match_forzado')::boolean AND jsonb_array_length(j->'facturas'->0->'diferencias') >= 0 AND j->'facturas'->0->>'justificacion' IS NOT NULL FROM seg2), true,
  '2 · la factura forzada muestra que fue forzada y su justificación');

-- ── 3. Operaciones: ve cantidades, NO importes de facturación ni pagos ──────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE seg3 AS SELECT public.compras_seguimiento_orden(:OF::uuid) AS j;
GRANT ALL ON seg3 TO authenticated;
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'contabilidad_visible')::boolean FROM seg3), false, '3 · el operador no ve Contabilidad');
SELECT public.chk_bool((SELECT NOT (j ? 'facturas') AND j->'indicadores'->'facturado' = 'null'::jsonb AND j->'indicadores'->'pagado' = 'null'::jsonb FROM seg3), true,
  '3 · sin facturas, facturado ni pagado');
SELECT public.chk_num((SELECT (j->'indicadores'->>'recibido')::numeric FROM seg3), 2300, '3 · pero sí lo recibido');

-- ── 4. Otra empresa: no ve nada (ni sabe que existe) ────────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE seg4 AS SELECT public.compras_seguimiento_orden(:OF::uuid) AS j;
GRANT ALL ON seg4 TO authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.compras_seguimiento_lista('c1c1c1c1-0000-0000-0000-000000000001') $$,
  'no pertenece', '4 · listar el proyecto de otra empresa se rechaza');
CREATE TEMP TABLE lst4 AS SELECT * FROM public.compras_seguimiento_lista();
RESET ROLE;
SELECT public.chk_bool((SELECT j IS NULL FROM seg4), true, '4 · otra empresa: NULL');
SELECT public.chk((SELECT count(*) FROM lst4), 0, '4 · y su lista no incluye órdenes ajenas');

-- ── 5. Lista con filtros ────────────────────────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE lst5 AS SELECT * FROM public.compras_seguimiento_lista(:C1::uuid, 'e3000000-0000-0000-0000-000000000001'::uuid, 'cerrada');
GRANT ALL ON lst5 TO authenticated;
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM lst5), 1, '5 · filtro proyecto + proveedor + estado → la orden cerrada');
SELECT public.chk_num((SELECT facturado FROM lst5), 2576, '5 · con su facturado');
