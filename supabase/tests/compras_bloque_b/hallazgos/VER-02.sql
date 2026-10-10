\set ON_ERROR_STOP on
-- ============================================================================
-- VER-02 · El no-borrado de 20261027000200 NO se evade: basta con retroceder el estado y
--          limpiar el sello (solo editar + eliminar) y el documento con efecto desaparece.
--
-- CAUSA RAÍZ
--   compras_tg_no_borrar_documento decide por columnas que el propio usuario reescribe:
--   estado, aprobada_at, registrada_at. UC (ver/crear/editar/eliminar, sin approve ni change_status):
--     UPDATE facturas_proveedor SET estado='registrada', aprobada_at=NULL, aprobada_por=NULL;
--     UPDATE recepciones        SET estado='borrador',   registrada_at=NULL;
--     DELETE FROM facturas_proveedor …; DELETE FROM recepciones …;
--   → los cuatro comandos pasan; lo facturado (10) y lo recibido (10) siguen acumulados en la orden,
--   el asiento de la recepción sigue publicado sin documento y la evidencia desaparece.
--
-- COMPORTAMIENTO ESPERADO
--   · El retroceso de estado se rechaza (EV-03) y los sellos de aprobación / registro no se reescriben
--     una vez fijados (sesiones de usuario), incluido el administrador.
--   · Aunque algún camino (mantenimiento, un dato histórico) dejara el estado y los sellos limpios, el
--     DELETE se rechaza mientras exista EVIDENCIA que el usuario no edita: asiento contable, intento de
--     contabilización, movimiento de inventario o activos fijos de la recepción.
--   · Lo que nunca tuvo efecto (recepción en borrador, factura registrada jamás aprobada) sigue borrándose;
--     la purga en cascada de una empresa o proyecto y la limpieza de un usuario eliminado no se bloquean.
--
-- Prefijo de ids de este grupo: fa3HHKKK-… (HH = hallazgo, KKK = clase).
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set S1  '''50000000-0000-0000-0000-0000000000c1'''

-- ═══ Preparación con los actores REALES: UA orden y factura · US recibe · UQ aprueba ═══
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa302100-0000-0000-0000-000000000001', 'fa302110-0000-0000-0000-000000000001', :P1::uuid, 'servicio', 10, 100, 0);
SELECT public.ce_recepcion('fa302200-0000-0000-0000-000000000001', 'fa302100-0000-0000-0000-000000000001', 'fa302110-0000-0000-0000-000000000001', 10, 'servicio');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id = 'fa302200-0000-0000-0000-000000000001';
SELECT public.como(:UA::uuid);
SELECT public.ce_factura('fa302300-0000-0000-0000-000000000001', 'fa302100-0000-0000-0000-000000000001', 'fa302110-0000-0000-0000-000000000001', :P1::uuid, 'FA3-VER02-1', 10, 100, 0);
SELECT public.como(:UQ::uuid);
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = 'fa302300-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001'), 'aprobada',
  '[VER-02a] preparación: factura aprobada y recepción registrada');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa302110-0000-0000-0000-000000000001'), 10,
  '[VER-02a] preparación: lo facturado de la línea es 10');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa302110-0000-0000-0000-000000000001'), 10,
  '[VER-02a] preparación: lo recibido de la línea es 10');

-- ═══ (a) La cadena del revisor, tal cual, como UC (solo editar + eliminar) y como administrador ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada', aprobada_at = NULL, aprobada_por = NULL WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION|COMPRAS_SELLO_FIJO', '[VER-02a] UC no devuelve a «registrada» la factura aprobada limpiando sus sellos');
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador', registrada_at = NULL WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_TRANSICION|COMPRAS_SELLO_FIJO', '[VER-02a] UC no devuelve a borrador la recepción registrada limpiando su sello');
SELECT public.chk_falla($$ DELETE FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02a] y la factura aprobada no se borra');
SELECT public.chk_falla($$ DELETE FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02a] ni la recepción registrada');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada', aprobada_at = NULL, aprobada_por = NULL WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_FACTURA_TRANSICION|COMPRAS_SELLO_FIJO', '[VER-02a] ni el ADMINISTRADOR devuelve la factura aprobada a «registrada»');
SELECT public.chk_falla($$ UPDATE public.recepciones SET estado = 'borrador', registrada_at = NULL WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_RECEPCION_TRANSICION|COMPRAS_SELLO_FIJO', '[VER-02a] ni el ADMINISTRADOR la recepción registrada a borrador');
RESET ROLE;

-- ═══ (b) Nada se perdió ═════════════════════════════════════════════════════════
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001' AND estado = 'aprobada' AND aprobada_at IS NOT NULL), 1,
  '[VER-02b] la factura sigue ahí, aprobada y con su sello');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000001' AND estado = 'registrada' AND registrada_at IS NOT NULL), 1,
  '[VER-02b] la recepción sigue ahí, registrada y con su sello');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa302110-0000-0000-0000-000000000001'), 10,
  '[VER-02b] lo facturado de la línea sigue en 10');
SELECT public.chk_num((SELECT cantidad_recibida FROM public.orden_compra_lineas WHERE id = 'fa302110-0000-0000-0000-000000000001'), 10,
  '[VER-02b] lo recibido de la línea sigue en 10');
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id IN ('fa302300-0000-0000-0000-000000000001', 'fa302200-0000-0000-0000-000000000001') AND estado = 'publicado'), 2,
  '[VER-02b] los dos asientos siguen publicados, sin reverso');

-- ═══ (c) Los sellos no se reescriben una vez fijados (aunque no cambie el estado) ═══
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_at = NULL WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] la fecha de aprobación de la factura no se limpia');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_at = '2001-01-01' WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] ni se reescribe con otra fecha');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_por = 'c0c0c0c0-0000-0000-0000-00000000001b' WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] ni quién aprobó (UQ) se cambia por otra persona');
SELECT public.chk_falla($$ UPDATE public.recepciones SET registrada_at = NULL WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] la fecha de registro de la recepción no se limpia');
SELECT public.chk_falla($$ UPDATE public.recepciones SET registrada_at = '2001-01-01' WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] ni se reescribe');
SELECT public.chk_falla($$ UPDATE public.recepciones SET recibido_por = 'c0c0c0c0-0000-0000-0000-00000000001a' WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] ni quién recibió se cambia por otra persona');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET aprobada_por = NULL WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_SELLO_FIJO', '[VER-02c] tampoco el administrador borra a quien aprobó');
-- Lo que SÍ sigue editable en una factura aprobada y en una recepción registrada: datos descriptivos.
SELECT public.como(:UC::uuid);
UPDATE public.facturas_proveedor SET notas = 'nota posterior a la aprobación' WHERE id = 'fa302300-0000-0000-0000-000000000001';
UPDATE public.recepciones SET notas = 'observación posterior al registro', documento_referencia = 'GUÍA-77' WHERE id = 'fa302200-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_txt((SELECT notas FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001'), 'nota posterior a la aprobación',
  '[VER-02c] LEGÍTIMO: las notas de una factura aprobada siguen siendo editables');
SELECT public.chk_txt((SELECT documento_referencia FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000001'), 'GUÍA-77',
  '[VER-02c] LEGÍTIMO: la guía de remisión de una recepción registrada sigue siendo editable');
-- En borrador, el responsable de la recepción sí se captura y se cambia (la conformidad lo exige).
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.ce_recepcion('fa302200-0000-0000-0000-000000000002', 'fa302100-0000-0000-0000-000000000001', 'fa302110-0000-0000-0000-000000000001', 1, 'servicio');
UPDATE public.recepciones SET recibido_por = 'c0c0c0c0-0000-0000-0000-00000000001b' WHERE id = 'fa302200-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_uuid((SELECT recibido_por FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000002'), :US::uuid,
  '[VER-02c] LEGÍTIMO: mientras es borrador, el responsable de la recepción se cambia');

-- ═══ (d) Evidencia NO editable: aunque el estado y los sellos queden limpios por un camino de sistema ═══
--   Mantenimiento (sin sesión de usuario) deja la factura en «registrada» y la recepción en «borrador» con los
--   sellos limpios. La guarda de 0200 (que mira esas marcas) ya no ve nada; el borrado debe seguir
--   rechazado por la evidencia (el asiento publicado). Todo dentro de una transacción que se revierte.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.facturas_proveedor SET estado = 'registrada', aprobada_at = NULL, aprobada_por = NULL WHERE id = 'fa302300-0000-0000-0000-000000000001';
UPDATE public.recepciones SET estado = 'borrador', registrada_at = NULL WHERE id = 'fa302200-0000-0000-0000-000000000001';
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02d] con las marcas limpias, la factura con asiento publicado NO se borra (evidencia)');
SELECT public.chk_falla($$ DELETE FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000001' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02d] con las marcas limpias, la recepción con asiento publicado NO se borra (evidencia)');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ DELETE FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02d] ni el ADMINISTRADOR borra la factura con asiento');
RESET ROLE;
ROLLBACK;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001' AND estado = 'aprobada'), 1,
  '[VER-02d] (la simulación de mantenimiento se revirtió: la factura sigue aprobada)');

-- ── (e) Cada pata de la evidencia, AISLADA ───────────────────────────────────
--   Se prepara una recepción de bienes de inventario (kardex), una de activos fijos (activos) y una factura
--   con un intento de contabilización pendiente; en cada caso se quita el resto de la evidencia (asiento) con
--   el motor de réplica y se dejan las marcas limpias: solo queda la pata que se prueba.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.ce_oc('fa302100-0000-0000-0000-000000000003', 'fa302110-0000-0000-0000-000000000003', :P1::uuid, 'inventario', 5, 10, 0, :S1::uuid);
SELECT public.ce_recepcion('fa302200-0000-0000-0000-000000000003', 'fa302100-0000-0000-0000-000000000003', 'fa302110-0000-0000-0000-000000000003', 5, 'bienes');
SELECT public.ce_oc('fa302100-0000-0000-0000-000000000004', 'fa302110-0000-0000-0000-000000000004', :P1::uuid, 'activo_fijo', 2, 500, 0);
SELECT public.ce_recepcion('fa302200-0000-0000-0000-000000000004', 'fa302100-0000-0000-0000-000000000004', 'fa302110-0000-0000-0000-000000000004', 2, 'bienes');
SELECT public.como(:US::uuid);
UPDATE public.recepciones SET estado = 'registrada' WHERE id IN ('fa302200-0000-0000-0000-000000000003', 'fa302200-0000-0000-0000-000000000004');
SELECT public.como(:UA::uuid);
SELECT public.ce_oc('fa302100-0000-0000-0000-000000000005', 'fa302110-0000-0000-0000-000000000005', :P1::uuid, 'servicio', 1, 100, 0);
SELECT public.ce_factura('fa302300-0000-0000-0000-000000000005', 'fa302100-0000-0000-0000-000000000005', 'fa302110-0000-0000-0000-000000000005', :P1::uuid, 'FA3-VER02-5', 1, 100, 0);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.movimientos_suministro WHERE origen_tabla = 'recepcion_lineas'
                    AND origen_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = 'fa302200-0000-0000-0000-000000000003')), 1,
  '[VER-02e] preparación: la recepción de bienes de inventario dejó su entrada en el kardex');
SELECT public.chk((SELECT count(*) FROM public.activos_fijos WHERE recepcion_linea_id IN (SELECT id FROM public.recepcion_lineas WHERE recepcion_id = 'fa302200-0000-0000-0000-000000000004')), 2,
  '[VER-02e] preparación: la recepción de activos dio de alta 2 activos');

-- e1 · solo el movimiento de inventario
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = 'fa302200-0000-0000-0000-000000000003';
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.recepciones SET estado = 'borrador', registrada_at = NULL WHERE id = 'fa302200-0000-0000-0000-000000000003';
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000003' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02e] sin asiento y con marcas limpias, la recepción que movió el KARDEX no se borra');
RESET ROLE;
ROLLBACK;
-- e2 · solo los activos fijos
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.conta_asientos WHERE origen_tabla = 'recepciones' AND origen_id = 'fa302200-0000-0000-0000-000000000004';
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.recepciones SET estado = 'borrador', registrada_at = NULL WHERE id = 'fa302200-0000-0000-0000-000000000004';
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000004' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02e] sin asiento y con marcas limpias, la recepción que dio de alta ACTIVOS no se borra');
RESET ROLE;
ROLLBACK;
-- e3 · solo el intento de contabilización (factura registrada con un intento pendiente: se intentó contabilizar)
BEGIN;
INSERT INTO public.conta_intentos_contabilizacion (company_id, project_id, origen_tabla, origen_id, disparo, resultado, codigo, motivo)
VALUES (:C::uuid, :C1::uuid, 'facturas_proveedor', 'fa302300-0000-0000-0000-000000000005', 'aprobacion', 'pendiente', 'sin_cuenta', 'prueba: falta la cuenta de gasto');
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ DELETE FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000005' $$,
  'COMPRAS_DOCUMENTO_NO_SE_BORRA', '[VER-02e] una factura con un intento de contabilización pendiente no se borra (evidencia)');
RESET ROLE;
ROLLBACK;

-- ═══ (f) LO QUE NUNCA TUVO EFECTO SE SIGUE BORRANDO ═══════════════════════════════
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
-- recepción en borrador con su línea (jamás registrada), y la factura registrada jamás aprobada
DELETE FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000002';
DELETE FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000005';
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000002'), 0,
  '[VER-02f] LEGÍTIMO: la recepción en borrador, jamás registrada, se borra');
SELECT public.chk((SELECT count(*) FROM public.recepcion_lineas WHERE recepcion_id = 'fa302200-0000-0000-0000-000000000002'), 0,
  '[VER-02f] LEGÍTIMO: y sus líneas con ella');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000005'), 0,
  '[VER-02f] LEGÍTIMO: la factura registrada, jamás aprobada y sin intentos, se borra');
SELECT public.chk_num((SELECT cantidad_facturada FROM public.orden_compra_lineas WHERE id = 'fa302110-0000-0000-0000-000000000005'), 0,
  '[VER-02f] LEGÍTIMO: borrarla no dejó nada acumulado');

-- ═══ (g) La purga en CASCADA y la limpieza de un USUARIO eliminado no se bloquean ═══
--   Una sesión con usuario (UA, auth.uid() no nulo) elimina un proyecto: la FK deja project_id en NULL en una
--   factura ya aprobada (aún sin asiento: contabilización pendiente). Y la purga definitiva de una empresa
--   (con el permiso de sistema) se lleva en cascada una factura con asiento publicado.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.companies (id, nombre, default_currency) VALUES ('fa302900-0000-0000-0000-000000000001', 'Empresa FA3-02 efímera', 'gtq');
INSERT INTO public.projects (id, company_id, nombre) VALUES ('fa302910-0000-0000-0000-000000000001', 'fa302900-0000-0000-0000-000000000001', 'Proyecto FA3-02 efímero');
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  ('fa302920-0000-0000-0000-000000000001', 'fa302900-0000-0000-0000-000000000001', 'Proveedor efímero', '8302001-1', 'GT', 'empresa');
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado, aprobada_at)
VALUES ('fa302300-0000-0000-0000-000000000009', 'fa302900-0000-0000-0000-000000000001', 'fa302910-0000-0000-0000-000000000001', 'fa302920-0000-0000-0000-000000000001',
        'FA3-02-EFIMERA', 'factura aprobada con contabilización pendiente', 100, 'aprobada', now());
SELECT public.como(:UA::uuid);
DELETE FROM public.projects WHERE id = 'fa302910-0000-0000-0000-000000000001';
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000009' AND project_id IS NULL), 1,
  '[VER-02g] LEGÍTIMO: eliminar el proyecto deja la factura aprobada sin proyecto (ON DELETE SET NULL) sin chocar con los controles');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT set_config('conta.allow_system_write', 'on', false);
INSERT INTO public.conta_asientos (company_id, project_id, tipo, concepto, estado, origen, origen_tabla, origen_id, origen_evento, publicado_at)
VALUES ('fa302900-0000-0000-0000-000000000001', NULL, 'diario', 'asiento de la factura efímera', 'publicado', 'automatico',
        'facturas_proveedor', 'fa302300-0000-0000-0000-000000000009', 'factura_prov_aprobada', now());
SELECT public.chk((SELECT count(*) FROM public.conta_asientos WHERE origen_id = 'fa302300-0000-0000-0000-000000000009'), 1,
  '[VER-02g] preparación: la factura efímera tiene ahora su asiento publicado (evidencia)');
SELECT public.como(:UA::uuid);
DELETE FROM public.companies WHERE id = 'fa302900-0000-0000-0000-000000000001';
SELECT set_config('conta.allow_system_write', 'off', false);
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000009'), 0,
  '[VER-02g] LEGÍTIMO: la purga de la empresa se lleva en cascada su factura aprobada con asiento (la guarda de evidencia no la bloquea)');

-- Un usuario eliminado: sus sellos quedan en NULL por la FK, aunque la factura y la recepción ya estén selladas.
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO auth.users (id) VALUES ('fa302900-0000-0000-0000-0000000000a1');
UPDATE public.facturas_proveedor SET aprobada_por = 'fa302900-0000-0000-0000-0000000000a1' WHERE id = 'fa302300-0000-0000-0000-000000000001';
UPDATE public.recepciones SET recibido_por = 'fa302900-0000-0000-0000-0000000000a1' WHERE id = 'fa302200-0000-0000-0000-000000000001';
SELECT public.chk_uuid((SELECT aprobada_por FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001'), 'fa302900-0000-0000-0000-0000000000a1'::uuid,
  '[VER-02g] preparación: la factura aprobada y la recepción registrada apuntan al usuario efímero');
SELECT public.como(:UA::uuid);
DELETE FROM auth.users WHERE id = 'fa302900-0000-0000-0000-0000000000a1';
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa302300-0000-0000-0000-000000000001' AND aprobada_por IS NULL), 1,
  '[VER-02g] LEGÍTIMO: eliminar a un usuario deja en NULL quién aprobó (FK SET NULL) aunque el sello esté fijado');
SELECT public.chk((SELECT count(*) FROM public.recepciones WHERE id = 'fa302200-0000-0000-0000-000000000001' AND recibido_por IS NULL), 1,
  '[VER-02g] LEGÍTIMO: y quién recibió');
