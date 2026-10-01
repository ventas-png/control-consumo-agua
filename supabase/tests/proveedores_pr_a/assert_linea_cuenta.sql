\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES · LA CUENTA DE LA LÍNEA DE COMPRA LA RESUELVE EL SERVIDOR AL GUARDAR
-- Ledger A2 (sin mapeos ni reglas previas con estas categorías):
--   a201 gasto general · a202 gasto limpieza.   Ledger A1: a101 (de otro ledger),
--   a104 (inventario: tipo activo), a108 (agrupadora).
-- ============================================================================
\set A     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set A2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set UA    '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set UC    '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set L1    '''e2000000-0000-0000-0000-0000000000a1'''
\set L2    '''e2000000-0000-0000-0000-0000000000a2'''
\set G201  '''c1000000-0000-0000-0000-00000000a201'''
\set G202  '''c1000000-0000-0000-0000-00000000a202'''
\set G101  '''c1000000-0000-0000-0000-00000000a101'''
\set I104  '''c1000000-0000-0000-0000-00000000a104'''
\set R108  '''c1000000-0000-0000-0000-00000000a108'''
\set O1    '''0f000000-0000-0000-0000-000000000001'''
\set O2    '''0f000000-0000-0000-0000-000000000002'''

SELECT public.como(:UA::uuid);
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  (:L1::uuid, :A::uuid, 'Línea Uno', '7030001-1', 'GT', 'empresa'),
  (:L2::uuid, :A::uuid, 'Línea Dos', '7030002-2', 'GT', 'empresa');

-- Reglas de compra en A2: obras → a201 (cualquier proveedor), seguridad → a202,
-- y obras + proveedor L2 → a202 (más específica).
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.conta_reglas_compra (id, company_id, project_id, destino, categoria, proveedor_id, cuenta_id) VALUES
  ('a0000000-0000-0000-0000-0000000000e1', :A::uuid, :A2::uuid, 'gasto', 'obras',     NULL,     :G201::uuid),
  ('a0000000-0000-0000-0000-0000000000e2', :A::uuid, :A2::uuid, 'gasto', 'seguridad', NULL,     :G202::uuid),
  ('a0000000-0000-0000-0000-0000000000e3', :A::uuid, :A2::uuid, 'gasto', 'obras',     :L2::uuid, :G202::uuid);
-- Orden en borrador del proveedor L1.
SELECT public.como(:UA::uuid);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES (:O1::uuid, :A::uuid, :A2::uuid, :L1::uuid, 'Línea Uno', 'Orden de líneas', 'borrador');
RESET ROLE;

-- ── 1. Sin cuenta en la línea: la resuelve el servidor al guardar ───────────
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario) VALUES
  ('0f100000-0000-0000-0000-000000000001', :A::uuid, :O1::uuid, 1, 'Cemento',  'gasto', 'obras',   1, 10),
  ('0f100000-0000-0000-0000-000000000002', :A::uuid, :O1::uuid, 2, 'Cemento (misma entrada)', 'gasto', 'obras', 1, 10),
  ('0f100000-0000-0000-0000-000000000003', :A::uuid, :O1::uuid, 3, 'Sin regla', 'gasto', 'limpieza', 1, 10);
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000001'),
  :G201::uuid, '1 · la línea sin cuenta recibe la de la regla de compra, resuelta por el SERVIDOR');
SELECT public.chk_txt((SELECT cuenta_origen FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000001'),
  'regla_compra', '1 · y queda registrado que vino de una regla de compra');
SELECT public.chk_uuid((SELECT cuenta_regla_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000001'),
  'a0000000-0000-0000-0000-0000000000e1'::uuid, '1 · con la regla que la fijó (trazabilidad)');
SELECT public.chk_bool(
  (SELECT a.cuenta_id IS NOT DISTINCT FROM b.cuenta_id AND a.cuenta_origen IS NOT DISTINCT FROM b.cuenta_origen
     FROM public.orden_compra_lineas a, public.orden_compra_lineas b
    WHERE a.id = '0f100000-0000-0000-0000-000000000001' AND b.id = '0f100000-0000-0000-0000-000000000002'),
  true, '1 · DETERMINISTA: la misma entrada produce la misma cuenta (sin depender de ninguna latencia del cliente)');
SELECT public.chk_bool(
  (SELECT cuenta_id IS NULL AND cuenta_origen IS NULL FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000003'),
  true, '1 · SIN regla aplicable: la línea queda sin cuenta y SIN error (rige el mapeo al contabilizar)');

-- ── 2. Cuenta elegida: validada y prevalece ─────────────────────────────────
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cuenta_id, cantidad, precio_unitario)
VALUES ('0f100000-0000-0000-0000-000000000004', :A::uuid, :O1::uuid, 4, 'Elegida a mano', 'gasto', 'obras', :G202::uuid, 1, 10);
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000004'),
  :G202::uuid, '2 · la cuenta elegida en la línea prevalece sobre la regla');
SELECT public.chk_txt((SELECT cuenta_origen FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000004'),
  'linea_explicita', '2 · y queda como elegida explícitamente');

SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cuenta_id, cantidad, precio_unitario)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0f000000-0000-0000-0000-000000000001', 10, 'x', 'gasto', 'obras',
          'c1000000-0000-0000-0000-00000000a101', 1, 1) $$,
  'COMPRAS_LINEA_CUENTA_INVALIDA', '2 · una cuenta de OTRO ledger se rechaza en el servidor');
SELECT public.chk_falla($$
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cuenta_id, cantidad, precio_unitario)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0f000000-0000-0000-0000-000000000001', 10, 'x', 'gasto', 'obras',
          'c1000000-0000-0000-0000-00000000a108', 1, 1) $$,
  'COMPRAS_LINEA_CUENTA_INVALIDA', '2 · una cuenta agrupadora se rechaza');
SELECT public.chk_falla($$
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cuenta_id, cantidad, precio_unitario)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0f000000-0000-0000-0000-000000000001', 10, 'x', 'gasto', 'obras',
          'c1000000-0000-0000-0000-00000000a104', 1, 1) $$,
  'COMPRAS_LINEA_CUENTA_INVALIDA', '2 · una cuenta de tipo no apto para el destino (activo en un gasto) se rechaza');
RESET ROLE;

-- ── 3. Cambiar la clasificación de una línea AUTOMÁTICA la re-resuelve ──────
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET categoria = 'seguridad' WHERE id = '0f100000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000001'),
  :G202::uuid, '3 · obras → seguridad: la línea automática toma la cuenta de la NUEVA categoría (nunca la anterior)');
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET categoria = 'limpieza' WHERE id = '0f100000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT public.chk_bool((SELECT cuenta_id IS NULL AND cuenta_origen IS NULL FROM public.orden_compra_lineas
                         WHERE id = '0f100000-0000-0000-0000-000000000001'),
  true, '3 · a una categoría SIN regla: se limpia la cuenta (no queda una cuenta desactualizada)');
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET categoria = 'seguridad' WHERE id = '0f100000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000004'),
  :G202::uuid, '3 · una línea elegida a mano NO se re-resuelve al cambiar la categoría');
SELECT public.chk_txt((SELECT cuenta_origen FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000004'),
  'linea_explicita', '3 · y sigue marcada como elegida');
-- Quitar la elección (cuenta → NULL) devuelve la línea a la resolución automática.
SET ROLE authenticated;
UPDATE public.orden_compra_lineas SET cuenta_id = NULL, categoria = 'obras' WHERE id = '0f100000-0000-0000-0000-000000000004';
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000004'),
  :G201::uuid, '3 · quitar la cuenta elegida devuelve la línea a la regla vigente de su categoría');

-- ── 4. Cambiar el proveedor de la orden (borrador) re-resuelve las automáticas ─
SET ROLE authenticated;
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario) VALUES
  ('0f100000-0000-0000-0000-000000000005', :A::uuid, :O1::uuid, 5, 'Auto obras', 'gasto', 'obras', 1, 10);
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cuenta_id, cantidad, precio_unitario) VALUES
  ('0f100000-0000-0000-0000-000000000006', :A::uuid, :O1::uuid, 6, 'Elegida obras', 'gasto', 'obras', :G201::uuid, 1, 10);
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000005'),
  :G201::uuid, '4 · con el proveedor L1, obras → a201 (regla sin proveedor)');
SET ROLE authenticated;
UPDATE public.ordenes_compra SET proveedor_id = :L2::uuid, proveedor_nombre = 'Línea Dos' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000005'),
  :G202::uuid, '4 · al cambiar a L2 la línea automática pasa a la regla ESPECÍFICA de ese proveedor');
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000006'),
  :G201::uuid, '4 · y la línea elegida a mano no se toca');
SET ROLE authenticated;
UPDATE public.ordenes_compra SET proveedor_id = :L1::uuid, proveedor_nombre = 'Línea Uno' WHERE id = :O1::uuid;
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000005'),
  :G201::uuid, '4 · volver a L1 devuelve la cuenta general: sin arrastrar la de la entrada anterior');

-- ── 5. Una regla con la cuenta rota NO se esconde ───────────────────────────
-- (la regla se crea válida y la cuenta se desactiva después)
INSERT INTO public.conta_cuentas (id, company_id, project_id, codigo, nombre, tipo, naturaleza, nivel, es_detalle, activa) VALUES
  ('c1000000-0000-0000-0000-00000000a2f1', :A::uuid, :A2::uuid, '5990', 'Gasto temporal A2', 'gasto', 'deudora', 3, true, true);
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.conta_reglas_compra (company_id, project_id, destino, categoria, cuenta_id)
VALUES (:A::uuid, :A2::uuid, 'gasto', 'mantenimiento', 'c1000000-0000-0000-0000-00000000a2f1');
RESET ROLE;
UPDATE public.conta_cuentas SET activa = false WHERE id = 'c1000000-0000-0000-0000-00000000a2f1';
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, precio_unitario)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0f000000-0000-0000-0000-000000000001', 11, 'x', 'gasto', 'mantenimiento', 1, 1) $$,
  'COMPRAS_LINEA_REGLA_ROTA', '5 · regla cuya cuenta ya no sirve: el guardado se rechaza con el motivo, no se guarda una cuenta nula «por si acaso»');
RESET ROLE;

-- ── 6. Cambiar un predeterminado no altera lo ya guardado ───────────────────
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.compras_reemplazar_regla_cuenta('a0000000-0000-0000-0000-0000000000e1', :G202::uuid, CURRENT_DATE + 30);
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000005'),
  :G201::uuid, '6 · reemplazar la regla (rige a futuro) NO reescribe la cuenta ya guardada en la línea');

-- ── 7. Aprobada, la línea es historia ───────────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :L1::uuid;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = :O1::uuid;
SELECT public.chk_falla($$ UPDATE public.orden_compra_lineas SET categoria = 'seguridad' WHERE id = '0f100000-0000-0000-0000-000000000005' $$,
  'COMPRAS_OC_INMUTABLE', '7 · con la orden aprobada la línea (y su cuenta) ya no se edita');
RESET ROLE;
SELECT public.chk_uuid((SELECT cuenta_id FROM public.orden_compra_lineas WHERE id = '0f100000-0000-0000-0000-000000000005'),
  :G201::uuid, '7 · y conserva la cuenta con la que se aprobó');

-- ── 8. La función interna no es invocable por la aplicación ─────────────────
SET ROLE authenticated;
SELECT public.chk_falla($$ SELECT * FROM public.compras_resolver_cuenta_linea_interno(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a2a2a2a2-0000-0000-0000-000000000001', 'gasto') $$,
  'permission denied', '8 · compras_resolver_cuenta_linea_interno no es ejecutable por authenticated');
SELECT public.chk_txt((SELECT origen FROM public.compras_resolver_cuenta_linea(:A2::uuid, 'gasto', 'seguridad')),
  'regla_compra', '8 · y la función pública sigue resolviendo (misma lógica, con guard de sesión)');
RESET ROLE;
