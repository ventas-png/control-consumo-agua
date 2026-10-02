\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · RESPALDOS DE RECEPCIÓN (migración 20261022000200)
-- Bucket privado, acceso por empresa/proyecto/permiso, límites, trazabilidad y
-- congelamiento del respaldo principal al salir de borrador.
--
-- Orden OR (C1, P1): renglón de gasto 5 × 10 → recepción de BIENES RB (borrador).
-- Orden OV (C1, P1): renglón de servicio 1 × 300 → CONFORMIDAD RV (borrador).
-- Usuarios: UO operador con permiso de órdenes · UC contador · UN operador SIN permisos ·
-- UA admin · UD admin de OTRA empresa.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UO  '''c0c0c0c0-0000-0000-0000-00000000000d'''
\set UN  '''c0c0c0c0-0000-0000-0000-00000000000e'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set OR  '''0c800000-0000-0000-0000-000000000001'''
\set LR  '''0c810000-0000-0000-0000-000000000001'''
\set RB  '''0c820000-0000-0000-0000-000000000001'''
\set OV  '''0c800000-0000-0000-0000-000000000002'''
\set LV  '''0c810000-0000-0000-0000-000000000002'''
\set RV  '''0c820000-0000-0000-0000-000000000002'''

-- En Supabase real storage.objects tiene RLS; el esquema de pruebas no, así que se habilita aquí.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;

-- ── 0. El bucket es privado y con límites ───────────────────────────────────
SELECT public.chk_bool((SELECT public FROM storage.buckets WHERE id = 'recepciones-respaldo'), false, '0 · el bucket NO es público');
SELECT public.chk_num((SELECT file_size_limit FROM storage.buckets WHERE id = 'recepciones-respaldo'), 10485760, '0 · límite de 10 MB por archivo');
SELECT public.chk_txt((SELECT array_to_string(allowed_mime_types, ',') FROM storage.buckets WHERE id = 'recepciones-respaldo'),
  'application/pdf,image/jpeg,image/png,image/webp', '0 · solo PDF, JPG, PNG y WEBP');

-- ── Preparación: dos órdenes emitidas y dos recepciones en borrador ─────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  (:OR::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Bienes con evidencia'),
  (:OV::uuid, :C::uuid, :C1::uuid, :P1::uuid, 'Ferretería Bloque B', 'Servicio con conformidad');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario) VALUES
  (:LR::uuid, :C::uuid, :OR::uuid, 1, 'Material', 'gasto', 'mantenimiento', 5, 'unidad', 10),
  (:LV::uuid, :C::uuid, :OV::uuid, 1, 'Mantenimiento', 'servicio', 'mantenimiento', 1, 'servicio', 300);
SELECT public.como(:UA::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN (:OR::uuid, :OV::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida'  WHERE id IN (:OR::uuid, :OV::uuid);
SELECT public.como(:UO::uuid);
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo) VALUES (:RB::uuid, :C::uuid, :C1::uuid, :OR::uuid, 'bienes');
INSERT INTO public.recepciones (id, company_id, project_id, orden_compra_id, tipo, recibido_por) VALUES (:RV::uuid, :C::uuid, :C1::uuid, :OV::uuid, 'servicio', :UC::uuid);
INSERT INTO public.recepcion_lineas (company_id, recepcion_id, orden_compra_linea_id, cantidad) VALUES
  (:C::uuid, :RB::uuid, :LR::uuid, 5), (:C::uuid, :RV::uuid, :LV::uuid, 1);
RESET ROLE;

-- ── 1. Almacenamiento: quién sube y quién ve (policies de storage.objects) ──
-- Subir: quien captura y ve las órdenes, a la carpeta de SU recepción.
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('recepciones-respaldo', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf'),
  ('recepciones-respaldo', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/foto.png'),
  ('recepciones-respaldo', 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000002/acta.pdf');
SELECT public.chk_falla($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-0000000000ff/inexistente.pdf') $$,
  'row-level security', '1 · no se sube a la carpeta de una recepción que no existe');
SELECT public.chk_falla($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c2c2c2c2-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/otro-proyecto.pdf') $$,
  'row-level security', '1 · la carpeta del proyecto debe ser el de la recepción');
RESET ROLE;

SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/sin-permiso.pdf') $$,
  'row-level security', '1 · un operador SIN permisos no sube evidencia');
SELECT public.chk((SELECT count(*) FROM storage.objects WHERE bucket_id = 'recepciones-respaldo'), 0, '1 · ni la ve (sin permiso de órdenes ni de contabilidad)');
RESET ROLE;

SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/de-otra-empresa.pdf') $$,
  'row-level security', '1 · el admin de OTRA empresa no sube a una recepción ajena');
SELECT public.chk((SELECT count(*) FROM storage.objects WHERE bucket_id = 'recepciones-respaldo'), 0, '1 · ni ve los archivos de la empresa C');
RESET ROLE;

SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM storage.objects WHERE bucket_id = 'recepciones-respaldo'), 3, '1 · el contador (permiso de contabilidad) sí ve la evidencia');
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM storage.objects WHERE bucket_id = 'recepciones-respaldo'), 3, '1 · el operador de compras ve la evidencia de su empresa');
RESET ROLE;

-- ── 2. Adjuntar: validaciones ───────────────────────────────────────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'remision.pdf', 'application/zip', 1000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_TIPO', '2 · un .zip no es evidencia');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'remision.pdf', 'application/pdf', 20000000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_TAMANO', '2 · más de 10 MB');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  '../../etc/passwd', 'x.pdf', 'application/pdf', 1000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_RUTA', '2 · una ruta con ../ se rechaza');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/no-subido.pdf',
  'no-subido.pdf', 'application/pdf', 1000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_OBJETO', '2 · el archivo debe estar ya en el almacenamiento');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'remision.pdf', 'application/pdf', 1000, repeat('a', 64), 'conformidad') $$, 'COMPRAS_RESPALDO_TIPO', '2 · «conformidad» es solo para servicios');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000002',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000002/acta.pdf',
  'acta.pdf', 'application/pdf', 1000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_TIPO', '2 · y un servicio no lleva «entrega»');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos), 0, '2 · ninguna validación fallida dejó registro');

SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'remision.pdf', 'application/pdf', 1000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_RECEPCION', '2 · otra empresa no adjunta a la recepción');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'remision.pdf', 'application/pdf', 1000, repeat('a', 64), 'entrega') $$, 'COMPRAS_RESPALDO_PERMISO', '2 · un operador sin permisos no adjunta');
RESET ROLE;

-- ── 3. Adjuntar: trazabilidad, respaldo principal e idempotencia ────────────
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE res_resp (k text PRIMARY KEY, j jsonb);
GRANT ALL ON res_resp TO authenticated;
INSERT INTO res_resp SELECT 'a1', public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'Remisión 123.pdf', 'application/pdf', 52000, repeat('a', 64), 'entrega', 'Firmada por bodega');
INSERT INTO res_resp SELECT 'a1b', public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'Remisión 123.pdf', 'application/pdf', 52000, repeat('A', 64), 'entrega', 'Firmada por bodega');
INSERT INTO res_resp SELECT 'a2', public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/foto.png',
  'foto.png', 'image/png', 180000, repeat('b', 64), 'otro');
SELECT public.chk_falla($$ SELECT public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  'Remisión 123.pdf', 'application/pdf', 52000, repeat('c', 64), 'entrega') $$, 'COMPRAS_RESPALDO_CONFLICTO', '3 · la misma ruta con OTRO contenido se rechaza');
RESET ROLE;
SELECT public.chk_bool((SELECT (j->>'reutilizado')::boolean FROM res_resp WHERE k = 'a1b'), true, '3 · adjuntar dos veces lo mismo (doble clic) devuelve el registro existente');
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB::uuid), 2, '3 · dos archivos registrados (no tres)');
SELECT public.chk_uuid((SELECT created_by FROM public.recepcion_respaldos WHERE nombre = 'Remisión 123.pdf'), :UO::uuid, '3 · trazabilidad: quién lo subió');
SELECT public.chk_txt((SELECT sha256 FROM public.recepcion_respaldos WHERE nombre = 'Remisión 123.pdf'), repeat('a', 64), '3 · y su SHA-256');
SELECT public.chk_bool((SELECT created_at IS NOT NULL FROM public.recepcion_respaldos WHERE nombre = 'Remisión 123.pdf'), true, '3 · y cuándo');
SELECT public.chk_txt((SELECT respaldo_path FROM public.recepciones WHERE id = :RB::uuid),
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/remision.pdf',
  '3 · el PRIMER archivo es el respaldo principal de la recepción');

-- Conformidad del servicio
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO res_resp SELECT 'v1', public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000002',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000002/acta.pdf',
  'Acta de conformidad.pdf', 'application/pdf', 30000, repeat('d', 64), 'conformidad');
RESET ROLE;
SELECT public.chk_txt((SELECT tipo FROM public.recepcion_respaldos WHERE recepcion_id = :RV::uuid), 'conformidad', '3 · la conformidad de servicio queda tipificada');

-- Retirar un archivo subido por error: se puede mientras la recepción es borrador
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
DELETE FROM public.recepcion_respaldos WHERE recepcion_id = :RB::uuid AND nombre = 'foto.png';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB::uuid), 1, '3 · en borrador se puede retirar un archivo');

-- ── 4. Registrar la recepción y comprobar que la evidencia no la altera ─────
CREATE TEMP TABLE antes_resp AS SELECT
  (SELECT count(*) FROM public.conta_asientos WHERE company_id = :C::uuid) AS asientos,
  (SELECT count(*) FROM public.conta_asiento_lineas al JOIN public.conta_asientos a ON a.id = al.asiento_id WHERE a.company_id = :C::uuid) AS lineas;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = :RB::uuid;
UPDATE public.recepciones SET estado = 'registrada' WHERE id = :RV::uuid;
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = :RB::uuid), 'registrada', '4 · la recepción de bienes quedó registrada');
SELECT public.chk_txt((SELECT estado FROM public.recepciones WHERE id = :RV::uuid), 'registrada', '4 · y la conformidad de servicio también');
CREATE TEMP TABLE foto_rec AS SELECT id, to_jsonb(r) AS fila FROM public.recepciones r WHERE id IN (:RB::uuid, :RV::uuid);
CREATE TEMP TABLE conta_rec AS SELECT
  (SELECT count(*) FROM public.conta_asientos WHERE company_id = :C::uuid) AS asientos,
  (SELECT count(*) FROM public.conta_asiento_lineas al JOIN public.conta_asientos a ON a.id = al.asiento_id WHERE a.company_id = :C::uuid) AS lineas,
  (SELECT sum(total_debe) FROM public.conta_asientos WHERE company_id = :C::uuid) AS debe;

-- Cambiar el respaldo principal de una recepción registrada: no
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.recepciones SET respaldo_path = 'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/otro.pdf'
  WHERE id = '0c820000-0000-0000-0000-000000000001' $$, 'COMPRAS_RECEPCION_RESPALDO_CONGELADO', '4 · el respaldo de una recepción registrada no se cambia');
SELECT public.chk_falla($$ UPDATE public.recepciones SET respaldo_path = NULL WHERE id = '0c820000-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_RESPALDO_CONGELADO', '4 · ni se borra');
RESET ROLE;

-- Agregar evidencia ADICIONAL sí: suma filas y no toca la recepción ni la contabilidad
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/factura-flete.pdf');
INSERT INTO res_resp SELECT 'a3', public.compras_recepcion_adjuntar('0c820000-0000-0000-0000-000000000001',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000001/factura-flete.pdf',
  'flete.pdf', 'application/pdf', 41000, repeat('e', 64), 'otro');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB::uuid), 2, '4 · se añadió evidencia después de registrar');
SELECT public.chk_bool((SELECT to_jsonb(r) = f.fila FROM public.recepciones r JOIN foto_rec f ON f.id = r.id WHERE r.id = :RB::uuid), true, '4 · la fila de la recepción registrada NO cambió (ni respaldo ni updated_at)');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE company_id = :C::uuid), (SELECT asientos FROM conta_rec)::int, '4 · ningún asiento nuevo');
SELECT public.chk((SELECT count(*) FROM public.conta_asiento_lineas al JOIN public.conta_asientos a ON a.id = al.asiento_id WHERE a.company_id = :C::uuid), (SELECT lineas FROM conta_rec)::int, '4 · ninguna línea de asiento nueva');
SELECT public.chk_num((SELECT sum(total_debe) FROM public.conta_asientos WHERE company_id = :C::uuid), (SELECT debe FROM conta_rec), '4 · los importes contabilizados no cambiaron');

-- La evidencia de una recepción registrada no se retira ni se edita
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
DELETE FROM public.recepcion_respaldos WHERE recepcion_id = :RB::uuid;
SELECT public.chk_falla($$ UPDATE public.recepcion_respaldos SET nombre = 'otro nombre' WHERE recepcion_id = '0c820000-0000-0000-0000-000000000001' $$,
  'permission denied', '4 · la evidencia no se edita (no hay privilegio de UPDATE)');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos WHERE recepcion_id = :RB::uuid), 2, '4 · ni siquiera el admin retira evidencia de una recepción registrada');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
DELETE FROM storage.objects WHERE bucket_id = 'recepciones-respaldo' AND name LIKE '%/0c820000-0000-0000-0000-000000000001/%';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM storage.objects WHERE bucket_id = 'recepciones-respaldo' AND name LIKE '%/0c820000-0000-0000-0000-000000000001/%'), 3, '4 · y los archivos del bucket de una recepción registrada tampoco se borran');

-- ── 5. Aislamiento de la lista de evidencias ────────────────────────────────
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos), 0, '5 · otra empresa no ve los registros de evidencia');
RESET ROLE;
SELECT public.como(:UN::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos), 0, '5 · un operador sin permisos tampoco');
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.recepcion_respaldos), 3, '5 · el contador ve la evidencia (3 archivos)');
RESET ROLE;

-- ── 6. Una recepción anulada no admite más evidencia ────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.recepciones SET estado = 'anulada' WHERE id = :RV::uuid;
RESET ROLE;
SELECT public.como(:UO::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO storage.objects (bucket_id, name) VALUES ('recepciones-respaldo',
  'cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/0c820000-0000-0000-0000-000000000002/tarde.pdf') $$,
  'row-level security', '6 · una recepción anulada no admite más archivos');
RESET ROLE;
