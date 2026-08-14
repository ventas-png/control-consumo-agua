-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de la Fase 7 (migraciones 20260823*): un hecho económico, un
-- solo asiento.
--
--    1-3   el histórico: backfill de proveedor_id y el doble conteo REAL
--    4-7   enlazar corta el duplicado, y exige anular si ya estaba contabilizado
--    8-11  el gasto que nace enlazado nunca asienta; desenlazar lo asienta
--   12-15  coherencia: otro ledger, otro proveedor, factura anulada
--   16-21  detección: encuentra el duplicado y NO marca los falsos positivos
--   22-24  el descarte se recuerda
--   25-27  el aviso de captura
--   28-32  no-regresión: el gasto sin factura se comporta igual que siempre
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

\set CO '11111111-1111-1111-1111-111111111111'
\set PR '22222222-2222-2222-2222-222222222222'
\set P1 'aaaaaaaa-0000-0000-0000-000000000001'
\set P2 'aaaaaaaa-0000-0000-0000-000000000002'
\set G1 '9a5a0000-0000-0000-0000-000000000001'
\set G2 '9a5a0000-0000-0000-0000-000000000002'
\set G3 '9a5a0000-0000-0000-0000-000000000003'
\set G4 '9a5a0000-0000-0000-0000-000000000004'
\set F1 'fac00000-0000-0000-0000-000000000001'

-- Cuántos pares propone el reporte para un gasto. Se define aquí porque
-- `conta_gastos_duplicados` la crean las migraciones que corren después del
-- fixture.
CREATE OR REPLACE FUNCTION public.pares_de(p_gasto uuid)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.conta_gastos_duplicados(
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid) d
  WHERE d.gasto_id = p_gasto
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1-3 · El histórico tal como está: el doble conteo ya ocurrió
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.gastos_condominio
   WHERE proveedor_id IS NULL AND NULLIF(btrim(proveedor_nombre), '') IS NOT NULL), 0,
  '1 el backfill no dejó ningún gasto con proveedor en texto y la FK vacía');

SELECT public.chk_txt(
  (SELECT proveedor_id::text FROM public.gastos_condominio WHERE id = :'G1'), :'P1',
  '2 el gasto histórico quedó enganchado al proveedor del catálogo, por nombre');

-- LA PRUEBA DEL PROBLEMA. 1500 del gasto + 1500 de la factura = 3000 debitados
-- a la misma cuenta, por UN desembolso de 1500. Si esta aserción empezara a dar
-- 1500, el escenario dejó de reproducir el bug y las siguientes no prueban nada.
SELECT public.chk(
  public.saldo_de('5101', 'gastos_condominio', :'G1')
  + public.saldo_de('5101', 'facturas_proveedor', :'F1'), 3000.00,
  '3 el mismo desembolso está DOS veces en los libros (1500 del gasto + 1500 de la factura)');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4-7 · Enlazar corta el duplicado
-- ─────────────────────────────────────────────────────────────────────────────
-- Un gasto con asiento vivo no se puede enlazar «y ya»: su asiento tendría que
-- desaparecer, y el único camino limpio es anularlo (un asiento reversado sigue
-- ocupando su clave única y no se puede re-emitir).
SELECT public.chk_falla(
  format($$UPDATE public.gastos_condominio SET factura_id = %L WHERE id = %L$$, :'F1', :'G1'),
  'GASTO_ENLACE_REQUIERE_ANULAR',
  '4 enlazar un gasto YA contabilizado sin anularlo se rechaza');

SELECT public.chk(
  public.saldo_de('5101', 'gastos_condominio', :'G1')
  + public.saldo_de('5101', 'facturas_proveedor', :'F1'), 3000.00,
  '5 y el rechazo no dejó nada a medias: el libro sigue igual');

UPDATE public.gastos_condominio
   SET factura_id = :'F1', estado = 'anulado'
 WHERE id = :'G1';

SELECT public.chk(
  public.saldo_de('5101', 'gastos_condominio', :'G1')
  + public.saldo_de('5101', 'facturas_proveedor', :'F1'), 1500.00,
  '6 enlazado y anulado, el asiento del gasto se reversó: queda UNA vez el desembolso');

SELECT public.chk(
  public.asientos_vivos('gastos_condominio', :'G1'), 0,
  '7 el gasto ya no tiene asiento vivo; el de la factura sigue en pie');

-- ─────────────────────────────────────────────────────────────────────────────
-- 8-11 · El gasto que nace enlazado, y el desenlace
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, numero_factura, fecha_emision,
   concepto, categoria, monto_total, estado)
VALUES ('fac00000-0000-0000-0000-000000000002', :'CO', :'PR', :'P2', 'B-0900',
        DATE '2026-07-20', 'Luminarias LED del parqueo', 'mantenimiento', 800.00, 'registrada');
UPDATE public.facturas_proveedor SET estado = 'aprobada'
 WHERE id = 'fac00000-0000-0000-0000-000000000002';

SELECT public.chk(
  public.saldo_de('5101', 'facturas_proveedor', 'fac00000-0000-0000-0000-000000000002'), 800.00,
  '8 la segunda factura devengó normalmente');

-- Nace 'pagado' Y enlazado: el trigger NO debe asentar.
INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha, estado, metodo_pago, factura_id)
VALUES ('9a5a0000-0000-0000-0000-000000000005', :'CO', :'PR',
        'Luminarias del parqueo', 'mantenimiento', 800.00, DATE '2026-07-20',
        'pagado', 'efectivo', 'fac00000-0000-0000-0000-000000000002');

SELECT public.chk(
  public.saldo_de('5101', 'gastos_condominio', '9a5a0000-0000-0000-0000-000000000005'), 0.00,
  '9 un gasto que NACE enlazado no genera asiento: la factura ya contabilizó');

SELECT public.chk_txt(
  (SELECT proveedor_id::text FROM public.gastos_condominio
   WHERE id = '9a5a0000-0000-0000-0000-000000000005'), :'P2',
  '10 y hereda el proveedor de la factura, porque enlazar es afirmar que son lo mismo');

-- Desenlazar. El estado no cambia (sigue 'pagado'), así que sin la condición
-- `OLD.factura_id IS NOT NULL` este gasto no se asentaría NUNCA.
UPDATE public.gastos_condominio SET factura_id = NULL
 WHERE id = '9a5a0000-0000-0000-0000-000000000005';

SELECT public.chk(
  public.saldo_de('5101', 'gastos_condominio', '9a5a0000-0000-0000-0000-000000000005'), 800.00,
  '11 desenlazar vuelve a contabilizar: el enlace no es de un solo sentido');

-- ─────────────────────────────────────────────────────────────────────────────
-- 12-15 · Coherencia del enlace
-- ─────────────────────────────────────────────────────────────────────────────
-- Los tres rechazos se prueban sobre el MISMO gasto (G2, del proveedor P1, en
-- el ledger del proyecto) cambiando una sola variable cada vez: así el error
-- que salta identifica sin ambigüedad qué guard actuó.
--
-- Otra contabilidad: el gasto vive en el ledger del proyecto y la factura en el
-- de la empresa. Sin este guard el doble conteo seguiría, solo que repartido
-- entre dos libros — que es peor, porque ninguno de los dos cuadra mal.
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, numero_factura, fecha_emision,
   concepto, categoria, monto_total, estado)
VALUES ('fac00000-0000-0000-0000-000000000003', :'CO', NULL, :'P1', 'C-0001',
        DATE '2026-07-22', 'Servicio contable de la administradora', 'administrativo', 900.00, 'registrada');

SELECT public.chk_falla(
  format($$UPDATE public.gastos_condominio SET factura_id = %L WHERE id = %L$$,
         'fac00000-0000-0000-0000-000000000003', :'G2'),
  'GASTO_FACTURA_OTRA_CONTABILIDAD',
  '12 enlazar a una factura de OTRA contabilidad se rechaza');

SELECT public.chk_falla(
  format($$UPDATE public.gastos_condominio SET factura_id = %L WHERE id = %L$$,
         'fac00000-0000-0000-0000-000000000002', :'G2'),
  'GASTO_FACTURA_OTRO_PROVEEDOR',
  '13 enlazar a la factura de OTRO proveedor se rechaza');

UPDATE public.facturas_proveedor SET estado = 'anulada'
 WHERE id = 'fac00000-0000-0000-0000-000000000003';

SELECT public.chk_falla(
  format($$INSERT INTO public.gastos_condominio
             (company_id, project_id, concepto, categoria, monto, fecha, estado, factura_id)
           VALUES (%L, NULL, 'Contabilidad externa', 'administrativo', 900, DATE '2026-07-22',
                   'pagado', %L)$$,
         :'CO', 'fac00000-0000-0000-0000-000000000003'),
  'GASTO_FACTURA_ANULADA',
  '14 enlazar a una factura ANULADA se rechaza: no contabilizó nada que absorber');

SELECT public.chk_falla(
  format($$UPDATE public.gastos_condominio SET factura_id = %L WHERE id = %L$$,
         '00000000-dead-0000-0000-000000000000', :'G2'),
  'GASTO_FACTURA_INEXISTENTE',
  '15 enlazar a una factura que no existe se rechaza');

-- ─────────────────────────────────────────────────────────────────────────────
-- 16-21 · Detección: encuentra el duplicado y NO marca los legítimos
-- ─────────────────────────────────────────────────────────────────────────────
-- Se re-crea un duplicado histórico, ahora que las migraciones ya corrieron,
-- para consultarlo con el reporte. Mismo comprobante, mismo monto, misma fecha.
INSERT INTO public.facturas_proveedor
  (id, company_id, project_id, proveedor_id, numero_factura, fecha_emision,
   concepto, categoria, monto_total, estado)
VALUES ('fac00000-0000-0000-0000-000000000004', :'CO', :'PR', :'P1', 'A-5000',
        DATE '2026-09-05', 'Reparación del portón', 'mantenimiento', 2400.00, 'registrada');
UPDATE public.facturas_proveedor SET estado = 'aprobada'
 WHERE id = 'fac00000-0000-0000-0000-000000000004';

INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha,
   proveedor_id, proveedor_nombre, comprobante_num, estado, metodo_pago)
VALUES ('9a5a0000-0000-0000-0000-000000000006', :'CO', :'PR',
        'Reparación del portón principal', 'mantenimiento', 2400.00, DATE '2026-09-05',
        :'P1', 'Ferretería El Tornillo', 'A-5000', 'pagado', 'efectivo');

SELECT public.chk(
  public.pares_de('9a5a0000-0000-0000-0000-000000000006'), 1,
  '16 el reporte propone el par gasto ↔ factura del mismo desembolso');

SELECT public.chk_txt(
  (SELECT d.razones FROM public.conta_gastos_duplicados(:'CO', :'PR') d
   WHERE d.gasto_id = '9a5a0000-0000-0000-0000-000000000006'),
  'mismo comprobante · mismo proveedor · mismo monto · misma fecha',
  '17 y dice POR QUÉ sospecha, en palabras que se leen sin manual');

SELECT public.chk(
  (SELECT d.puntaje FROM public.conta_gastos_duplicados(:'CO', :'PR') d
   WHERE d.gasto_id = '9a5a0000-0000-0000-0000-000000000006'), 100,
  '18 con la evidencia completa el puntaje llega al tope');

SELECT public.chk(
  (SELECT d.gasto_contabilizado::int FROM public.conta_gastos_duplicados(:'CO', :'PR') d
   WHERE d.gasto_id = '9a5a0000-0000-0000-0000-000000000006'), 1,
  '19 y avisa que el gasto ya está contabilizado, que es lo que cambia el botón');

-- LOS FALSOS POSITIVOS. Un reporte que marca compras legítimas se ignora
-- entero, y el día del duplicado real también se ignora.
SELECT public.chk(
  public.pares_de(:'G2'), 0,
  '20 dos compras al MISMO proveedor por el MISMO monto, 40 días aparte, NO son duplicado');

SELECT public.chk(
  public.pares_de(:'G3'), 0,
  '21 mismo monto y misma fecha, pero OTRO proveedor: tampoco');

SELECT public.chk(
  public.pares_de(:'G1'), 0,
  '22 y un par ya enlazado deja de proponerse: está resuelto');

-- ─────────────────────────────────────────────────────────────────────────────
-- 23-24 · La memoria de lo revisado
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.conta_duplicados_descartados (company_id, gasto_id, factura_id, motivo)
VALUES (:'CO', '9a5a0000-0000-0000-0000-000000000006', 'fac00000-0000-0000-0000-000000000004',
        'Son dos portones distintos; el proveedor repitió el número de comprobante.');

SELECT public.chk(
  public.pares_de('9a5a0000-0000-0000-0000-000000000006'), 0,
  '23 un par descartado NO reaparece: sin esto el reporte se vuelve ruido que nadie mira');

SELECT public.chk_falla(
  format($$INSERT INTO public.conta_duplicados_descartados (company_id, gasto_id, factura_id, motivo)
           VALUES (%L, %L, %L, 'otra vez')$$,
         :'CO', '9a5a0000-0000-0000-0000-000000000006', 'fac00000-0000-0000-0000-000000000004'),
  'conta_duplicado_descartado_unico',
  '24 y el descarte es uno por par, no una bitácora que crece sola');

-- ─────────────────────────────────────────────────────────────────────────────
-- 25-27 · El aviso al capturar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_gasto_duplicado_probable(
     :'CO', :'PR', :'P1', 2400.00, DATE '2026-09-05', 'A-5000')), 1,
  '25 al capturar un gasto que ya está facturado, el aviso encuentra la factura');

SELECT public.chk_txt(
  (SELECT r.factura_numero FROM public.conta_gasto_duplicado_probable(
     :'CO', :'PR', :'P1', 2400.00, DATE '2026-09-05', 'A-5000') r), 'A-5000',
  '26 y la nombra, para poder decir «esto ya está como factura A-5000»');

SELECT public.chk(
  (SELECT count(*) FROM public.conta_gasto_duplicado_probable(
     :'CO', :'PR', :'P2', 2400.00, DATE '2026-09-05', 'A-5000')), 0,
  '27 el aviso no cruza proveedores: solo mira las facturas del que se eligió');

-- ─────────────────────────────────────────────────────────────────────────────
-- 28-32 · No-regresión: el gasto SIN factura se comporta igual que siempre
-- ─────────────────────────────────────────────────────────────────────────────
-- Esta fase toca `conta_tg_gastos`, que llevaba intacta desde junio y por la que
-- pasan TODOS los gastos del sistema. Que el 99 % sin factura siga funcionando
-- importa más que la funcionalidad nueva.
SELECT public.chk(
  public.asientos_vivos('gastos_condominio', :'G4'), 1,
  '28 el gasto de caja chica del fixture asentó, como siempre');

INSERT INTO public.gastos_condominio
  (id, company_id, project_id, concepto, categoria, monto, fecha, estado, metodo_pago)
VALUES ('9a5a0000-0000-0000-0000-000000000007', :'CO', :'PR',
        'Reposición de focos', 'administrativo', 130.00, DATE '2026-09-10', 'pendiente', 'efectivo');

SELECT public.chk(
  public.asientos_vivos('gastos_condominio', '9a5a0000-0000-0000-0000-000000000007'), 0,
  '29 un gasto PENDIENTE no asienta: nada cambió ahí');

UPDATE public.gastos_condominio SET estado = 'pagado'
 WHERE id = '9a5a0000-0000-0000-0000-000000000007';
SELECT public.chk(
  public.asientos_vivos('gastos_condominio', '9a5a0000-0000-0000-0000-000000000007'), 1,
  '30 pasar a pagado lo asienta');

UPDATE public.gastos_condominio SET estado = 'anulado'
 WHERE id = '9a5a0000-0000-0000-0000-000000000007';
SELECT public.chk(
  public.asientos_vivos('gastos_condominio', '9a5a0000-0000-0000-0000-000000000007'), 0,
  '31 anularlo lo reversa');

-- Borrar también reversa. Se usa el de caja chica, que nunca tuvo factura.
DELETE FROM public.gastos_condominio WHERE id = :'G4';
SELECT public.chk(
  public.asientos_vivos('gastos_condominio', :'G4'), 0,
  '32 borrarlo también reversa, exactamente como antes de esta fase');

-- ─────────────────────────────────────────────────────────────────────────────
-- Cuadre final: todo asiento generado en el camino cuadra
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM (
     SELECT asiento_id FROM public.conta_asiento_lineas
     GROUP BY asiento_id HAVING SUM(debe) <> SUM(haber)) x), 0,
  '33 ningún asiento quedó descuadrado en todo el recorrido');
