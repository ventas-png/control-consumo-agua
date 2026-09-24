-- ============================================================================
-- COBROS · BLOQUEO Y REVALIDACIÓN DEL PAGO (20261002000100 → 20261002000200)
-- Invariantes de UNA sesión. La concurrencia real va en run.sh (paso 6) con
-- una compuerta que fija el orden: no depende de tiempos.
--
-- Invariante central: al terminar, ningún pago rechazado o eliminado conserva
-- un asiento de cobro VIVO ni una aplicación que descuente saldo.
-- ============================================================================

SELECT set_config('request.jwt.claim.sub', 'a0a0a0a0-0000-0000-0000-00000000000a', false);

-- ── 1 · rechazado / eliminado ANTES del reproceso de su cuota ────────────────
-- Tres cuotas de mantenimiento sin configuración (pendientes), cada una con un
-- cobro verificado que queda pendiente de su devengo.
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c3000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX bloqueo 1', 40, '2026-10', 'pendiente', 'mantenimiento'),
  ('c3000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX bloqueo 2', 40, '2026-10', 'pendiente', 'mantenimiento'),
  ('c3000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX bloqueo 3', 40, '2026-10', 'pendiente', 'mantenimiento');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9c000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000001', 40, 'efectivo', 'verificado', now()),
  ('9c000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000002', 40, 'efectivo', 'verificado', now()),
  ('9c000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000003', 40, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_intentos_contabilizacion
    WHERE origen_id IN ('9c000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000002',
                        '9c000000-0000-0000-0000-000000000003') AND codigo = 'devengo_pendiente'), 3,
  '1 · tres cobros pendientes de su devengo');
SET ROLE authenticated;
UPDATE public.pagos SET estado = 'rechazado' WHERE id = '9c000000-0000-0000-0000-000000000001';
UPDATE public.pagos SET deleted_at = now() WHERE id = '9c000000-0000-0000-0000-000000000002';
RESET ROLE;
DELETE FROM public.pagos WHERE id = '9c000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'mantenimiento',
   '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a102');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c3000000-0000-0000-0000-000000000001')),
  'cuota_emitida:contabilizada', '1 · reprocesar la cuota con su cobro RECHAZADO: sólo el devengo');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c3000000-0000-0000-0000-000000000002')),
  'cuota_emitida:contabilizada', '1 · …con su cobro BORRADO (suave): sólo el devengo');
SELECT public.chk_txt(
  (SELECT string_agg(evento || ':' || resultado, ',') FROM public.conta_reprocesar_cargo('cuotas_condominio', 'c3000000-0000-0000-0000-000000000003')),
  'cuota_emitida:contabilizada', '1 · …con su cobro ELIMINADO: sólo el devengo');
SELECT public.chk_txt(
  (SELECT string_agg(resultado || '/' || codigo, ',') FROM public.conta_reprocesar_cargo('pagos', '9c000000-0000-0000-0000-000000000001')),
  'bloqueada/documento_anulado', '1 · reprocesar el cobro rechazado lo bloquea');
SELECT public.chk_txt(
  (SELECT string_agg(resultado || '/' || codigo, ',') FROM public.conta_reprocesar_cargo('pagos', '9c000000-0000-0000-0000-000000000003')),
  'bloqueada/documento_inexistente', '1 · y el eliminado ya no existe');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_tabla = 'pagos' AND a.origen_id IN ('9c000000-0000-0000-0000-000000000001',
          '9c000000-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-000000000003')), 0,
  '1 · ningún asiento de cobro para pagos rechazados o eliminados');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id IN ('9c000000-0000-0000-0000-000000000001',
          '9c000000-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-000000000003')), 0,
  '1 · ni aplicaciones');

-- ── 2 · contabilizado y DESPUÉS rechazado / borrado / eliminado ─────────────
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c3000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX bloqueo 4', 40, '2026-10', 'pendiente', 'mantenimiento'),
  ('c3000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX bloqueo 5', 40, '2026-10', 'pendiente', 'mantenimiento'),
  ('c3000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-00000000a001', 'SINT-AUX bloqueo 6', 40, '2026-10', 'pendiente', 'mantenimiento');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9c000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000004', 40, 'efectivo', 'verificado', now()),
  ('9c000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000005', 40, 'efectivo', 'verificado', now()),
  ('9c000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-000000000006', 40, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones WHERE pago_id IN ('9c000000-0000-0000-0000-000000000004',
          '9c000000-0000-0000-0000-000000000005', '9c000000-0000-0000-0000-000000000006')), 3,
  '2 · tres cobros contabilizados al verificarse, con su aplicación');
SET ROLE authenticated;
UPDATE public.pagos SET estado = 'rechazado' WHERE id = '9c000000-0000-0000-0000-000000000004';
UPDATE public.pagos SET deleted_at = now() WHERE id = '9c000000-0000-0000-0000-000000000005';
RESET ROLE;
DELETE FROM public.pagos WHERE id = '9c000000-0000-0000-0000-000000000006';
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a
    WHERE a.origen_tabla = 'pagos' AND a.origen_evento = 'pago_contabilizado' AND a.anulado_por_id IS NULL
      AND a.origen_id IN ('9c000000-0000-0000-0000-000000000004', '9c000000-0000-0000-0000-000000000005',
                          '9c000000-0000-0000-0000-000000000006')), 0,
  '2 · rechazar, borrar o eliminar un cobro contabilizado reversa su asiento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cobro_aplicaciones ap JOIN public.conta_asientos a ON a.id = ap.asiento_id
    WHERE a.anulado_por_id IS NULL AND a.estado <> 'anulado'
      AND ap.pago_id IN ('9c000000-0000-0000-0000-000000000004', '9c000000-0000-0000-0000-000000000005',
                         '9c000000-0000-0000-0000-000000000006')), 0,
  '2 · y ninguna aplicación suya sigue descontando saldo');
SELECT public.chk(
  (SELECT COALESCE(sum(l.debe - l.haber), 0)::bigint FROM public.conta_asiento_lineas l
     JOIN public.conta_asientos a ON a.id = l.asiento_id
    WHERE a.estado = 'publicado' AND l.cuenta_id = '11000000-0000-0000-0000-00000000a101'
      AND a.origen_id IN ('c3000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000005',
                          'c3000000-0000-0000-0000-000000000006', '9c000000-0000-0000-0000-000000000004',
                          '9c000000-0000-0000-0000-000000000005', '9c000000-0000-0000-0000-000000000006')), 120,
  '2 · las tres cuotas vuelven a deber sus 40');

-- ── 3 · preparación de la concurrencia (run.sh, paso 6) ─────────────────────
-- K1..K6: cuotas extraordinarias SIN configuración, cada una con un cobro
-- verificado pendiente de su devengo. K7: una cuota con DOS cobros pendientes
-- para el escenario de orden de bloqueos.
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo)
SELECT ('c3000000-0000-0000-0000-0000000000c' || n)::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
       'a1a1a1a1-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000a001',
       'SINT-AUX concurrencia K' || n, 50, '2026-10', 'pendiente', 'cuota_extraordinaria'
  FROM generate_series(1, 7) n;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at)
SELECT ('9c000000-0000-0000-0000-0000000000c' || n)::uuid, 'e0000000-0000-0000-0000-00000000a001',
       'a1a1a1a1-0000-0000-0000-000000000001', ('c3000000-0000-0000-0000-0000000000c' || n)::uuid,
       CASE WHEN n = 7 THEN 20 ELSE 50 END, 'efectivo', 'verificado', now()
  FROM generate_series(1, 7) n;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('9c000000-0000-0000-0000-0000000000d7', 'e0000000-0000-0000-0000-00000000a001', 'a1a1a1a1-0000-0000-0000-000000000001',
   'c3000000-0000-0000-0000-0000000000c7', 30, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk(
  (SELECT count(DISTINCT origen_id) FROM public.conta_intentos_contabilizacion
    WHERE origen_tabla = 'pagos' AND resultado = 'pendiente'
      AND origen_id IN (SELECT p.id FROM public.pagos p
                         WHERE p.cuota_id::text LIKE 'c3000000-0000-0000-0000-0000000000c_')), 8,
  '3 · ocho cobros pendientes para la concurrencia');
