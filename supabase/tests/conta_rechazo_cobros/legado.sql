-- ============================================================================
-- RECHAZO LEGADO · se aplica ANTES de 20261005000000
--
-- Reproduce lo que hoy existe en producción: un cobro de cuota verificado que
-- excede el saldo (queda pendiente, sin asiento) y se rechaza. Sin la
-- migración no queda ninguna evidencia de cuándo: el estado de cuenta con
-- corte debe seguir declarándolo como limitación, sin inventarle fecha.
--
-- Sujeto propio: el auxiliar Tres (C3), pagador de la unidad U3 creada aquí.
-- ============================================================================
\set ON_ERROR_STOP 1
\set A   '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1  '''a1a1a1a1-0000-0000-0000-000000000001'''
\set C3  '''e0000000-0000-0000-0000-00000000a003'''
\set U3  '''f0000000-0000-0000-0000-00000000a003'''
\set ADM '''a0a0a0a0-0000-0000-0000-00000000000a'''

RESET ROLE;
INSERT INTO public.unidades (id, company_id, project_id, nombre) VALUES
  (:U3, :A, :A1, 'SINT-RECH Apto 103');
INSERT INTO public.unidad_residentes
  (id, unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('d0e00000-0000-0000-0000-000000000003', :U3, :C3, :A, :A1, 'propietario', true, true);

SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;

-- L1: cuota de 50 (agosto) y un cobro de 80 que la excede → pendiente.
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('d0c00000-0000-0000-0000-000000000001', :A, :A1, :U3, 'SINT-RECH K-legado', 50, '2026-08', 'pendiente', 'mantenimiento', '2026-08-05 12:00+00');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('d0a00000-0000-0000-0000-000000000001', :C3, :A1, 'd0c00000-0000-0000-0000-000000000001', 80, 'efectivo', 'verificado', '2026-08-06 12:00+00');

-- El rechazo, como lo hacía la aplicación antes de la migración.
UPDATE public.pagos
   SET estado = 'rechazado', verification_status = 'rechazado',
       verification_notes = 'SINT-RECH rechazo legado'
 WHERE id = 'd0a00000-0000-0000-0000-000000000001';

-- L2: otro legado (P13, 60 sobre una cuota de 5) que después de la migración
-- se REACTIVA y se vuelve a rechazar (assert.sql, R14): el rechazo legado
-- sigue sin fecha aunque luego haya eventos registrados.
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('d0c00000-0000-0000-0000-000000000013', :A, :A1, :U3, 'SINT-RECH K13-legado', 5, '2026-08', 'pendiente', 'mantenimiento', '2026-08-05 12:00+00');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('d0a00000-0000-0000-0000-000000000013', :C3, :A1, 'd0c00000-0000-0000-0000-000000000013', 60, 'efectivo', 'verificado', '2026-08-07 12:00+00');
UPDATE public.pagos
   SET estado = 'rechazado', verification_status = 'rechazado',
       verification_notes = 'SINT-RECH rechazo legado 2'
 WHERE id = 'd0a00000-0000-0000-0000-000000000013';

RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_tabla = 'pagos' AND origen_id IN ('d0a00000-0000-0000-0000-000000000001',
                                                   'd0a00000-0000-0000-0000-000000000013')), 0,
  'legado · los cobros rechazados nunca tuvieron asiento');
SELECT public.chk(
  (SELECT count(*) FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'pagos_rechazo_eventos'), 0,
  'legado · todavía no existe dónde registrar la fecha del rechazo');
