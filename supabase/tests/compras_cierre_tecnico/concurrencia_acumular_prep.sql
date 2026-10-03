\set ON_ERROR_STOP on
-- Preparación de las pruebas con sesiones REALES simultáneas de la acumulación de lo facturado (run.sh, V–Z).
-- Usa las ayudas `af_orden` / `af_factura` que define assert_factura_acumular.sql (corre antes).
\set UA '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UK '''c0c0c0c0-0000-0000-0000-00000000000c'''

SELECT public.como(:UA::uuid); SET ROLE authenticated;
-- V · dos renglones de UNA orden, cada uno con su factura registrada (se aprueban a la vez).
SELECT public.af_orden('0c9a0000-0000-0000-0000-000000000001', '0c9b0000-0000-0000-0000-000000000001',
  '[{"id":"0c9c0000-0000-0000-0000-000000000001","linea":1,"cant":10,"precio":10,"recibir":10},{"id":"0c9c0000-0000-0000-0000-000000000002","linea":2,"cant":5,"precio":20,"recibir":5}]');
-- W · un renglón de 10 y DOS facturas por las mismas 10 unidades (solo una puede aprobarse).
SELECT public.af_orden('0c9a0000-0000-0000-0000-000000000002', '0c9b0000-0000-0000-0000-000000000002',
  '[{"id":"0c9c0000-0000-0000-0000-000000000003","linea":1,"cant":10,"precio":10,"recibir":10}]');
-- X · una factura aprobada de 6 y otra registrada de 4: se anula la primera MIENTRAS se aprueba la segunda.
SELECT public.af_orden('0c9a0000-0000-0000-0000-000000000003', '0c9b0000-0000-0000-0000-000000000003',
  '[{"id":"0c9c0000-0000-0000-0000-000000000004","linea":1,"cant":10,"precio":10,"recibir":10}]');
-- Y · dos facturas aprobadas que comparten renglones (la orden queda cerrada): se anulan a la vez.
SELECT public.af_orden('0c9a0000-0000-0000-0000-000000000004', '0c9b0000-0000-0000-0000-000000000004',
  '[{"id":"0c9c0000-0000-0000-0000-000000000005","linea":1,"cant":10,"precio":10,"recibir":10},{"id":"0c9c0000-0000-0000-0000-000000000006","linea":2,"cant":5,"precio":20,"recibir":5}]');
-- Z · una factura registrada que se aprobará en una sesión que se CORTA antes de confirmar.
SELECT public.af_orden('0c9a0000-0000-0000-0000-000000000005', '0c9b0000-0000-0000-0000-000000000005',
  '[{"id":"0c9c0000-0000-0000-0000-000000000007","linea":1,"cant":10,"precio":10,"recibir":10}]');
RESET ROLE;

SELECT public.como(:UK::uuid); SET ROLE authenticated;
SELECT public.af_factura('cc-clave-v1', 'CC-V1', '0c9a0000-0000-0000-0000-000000000001', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000001","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-v2', 'CC-V2', '0c9a0000-0000-0000-0000-000000000001', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000002","cantidad":5,"precio_unitario":20,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-w1', 'CC-W1', '0c9a0000-0000-0000-0000-000000000002', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000003","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-w2', 'CC-W2', '0c9a0000-0000-0000-0000-000000000002', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000003","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-x1', 'CC-X1', '0c9a0000-0000-0000-0000-000000000003', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000004","cantidad":6,"precio_unitario":10,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-x2', 'CC-X2', '0c9a0000-0000-0000-0000-000000000003', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000004","cantidad":4,"precio_unitario":10,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-y1', 'CC-Y1', '0c9a0000-0000-0000-0000-000000000004',
  '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000005","cantidad":6,"precio_unitario":10,"iva_monto":0},{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000006","cantidad":5,"precio_unitario":20,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-y2', 'CC-Y2', '0c9a0000-0000-0000-0000-000000000004', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000005","cantidad":4,"precio_unitario":10,"iva_monto":0}]');
SELECT public.af_factura('cc-clave-z1', 'CC-Z1', '0c9a0000-0000-0000-0000-000000000005', '[{"orden_compra_linea_id":"0c9c0000-0000-0000-0000-000000000007","cantidad":10,"precio_unitario":10,"iva_monto":0}]');
RESET ROLE;

-- Las del escenario X (la 1.ª) y Y (las dos) arrancan APROBADAS.
SELECT public.como(:UA::uuid); SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE clave_idempotencia IN ('cc-clave-x1', 'cc-clave-y1', 'cc-clave-y2');
RESET ROLE;
