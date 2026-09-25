-- ============================================================================
-- PANTALLA DE COBROS DE AGUA · el mismo predicado que fetchPagosYConvenios
--
-- src/domain/cobros/queries.ts lee `pagos` con `deleted_at IS NULL AND
-- cargo_adicional_id IS NULL`, sin filtro de empresa ni de proyecto: el
-- aislamiento es el de la RLS. Aquí se ejecuta ESE predicado como la
-- aplicación (SET ROLE authenticated + request.jwt.claim.sub) sobre la base
-- que dejaron assert.sql y assert_coherencia.sql, que ya tiene cobros de
-- cargos en las dos empresas.
-- ============================================================================
\set ON_ERROR_STOP 1
\set A1   '''a1a1a1a1-0000-0000-0000-000000000001'''
\set B1   '''b1b1b1b1-0000-0000-0000-000000000001'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set ADB  '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set PB   '''cb000000-0000-0000-0000-0000000000b1'''
\set WA   '''cf000000-0000-0000-0000-0000000000a1'''
\set WB   '''cf000000-0000-0000-0000-0000000000b1'''

-- Andamiaje: un pago corriente (sin cargo) en cada empresa. No es un cobro de
-- cargo, así que la validación de conta_tg_pagos no interviene.
RESET ROLE;
INSERT INTO public.pagos (id, cliente_id, project_id, monto, metodo, estado, verification_status)
SELECT :WA, c.cliente_id, :A1, 11, 'efectivo', 'pendiente', 'pendiente'
  FROM public.company_clientes c WHERE c.company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' LIMIT 1;
INSERT INTO public.pagos (id, cliente_id, project_id, monto, metodo, estado, verification_status)
SELECT :WB, c.cliente_id, :B1, 13, 'efectivo', 'pendiente', 'pendiente'
  FROM public.company_clientes c WHERE c.company_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' LIMIT 1;
SELECT public.chk((SELECT count(*) FROM public.pagos WHERE id IN (:WA, :WB)), 2,
  'V · andamiaje: un pago corriente por empresa');

-- ── empresa A ───────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT (count(*) > 0)::int FROM public.pagos WHERE deleted_at IS NULL AND cargo_adicional_id IS NOT NULL), 1,
  'V · A: sin el filtro, la tabla trae cobros de cargos (el filtro no es decorativo)');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos WHERE deleted_at IS NULL AND cargo_adicional_id IS NULL AND id = :WA), 1,
  'V · A: el pago corriente de A sigue en la vista');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos WHERE deleted_at IS NULL AND cargo_adicional_id IS NULL AND id IN (:WB, :PB)), 0,
  'V · A: nada de la empresa B, ni corriente ni de cargo');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.deleted_at IS NULL AND p.cargo_adicional_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p.project_id
                        AND pr.company_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), 0,
  'V · A: todo lo que ve pertenece a proyectos de A');
-- El total de la pantalla se calcula sobre ese mismo conjunto: la partición
-- agua / cargos es exacta.
SELECT public.chk_txt(
  (SELECT to_char(COALESCE(sum(monto) FILTER (WHERE cargo_adicional_id IS NULL), 0)
                + COALESCE(sum(monto) FILTER (WHERE cargo_adicional_id IS NOT NULL), 0), 'FM999990.00')
     FROM public.pagos WHERE deleted_at IS NULL),
  (SELECT to_char(COALESCE(sum(monto), 0), 'FM999990.00') FROM public.pagos WHERE deleted_at IS NULL),
  'V · A: agua + cargos = todo lo visible (ningún pago cae en los dos ni en ninguno)');
RESET ROLE;

-- ── empresa B ───────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.pagos WHERE deleted_at IS NULL AND id = :PB), 1,
  'V · B: su cobro de cargo existe y lo ve sin el filtro');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos WHERE deleted_at IS NULL AND cargo_adicional_id IS NULL AND id = :PB), 0,
  'V · B: …pero no en la vista de agua');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos WHERE deleted_at IS NULL AND cargo_adicional_id IS NULL AND id = :WB), 1,
  'V · B: su pago corriente sí');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos WHERE deleted_at IS NULL AND cargo_adicional_id IS NULL AND id = :WA), 0,
  'V · B: nada de la empresa A');
RESET ROLE;

-- Andamiaje fuera: no queda nada de este paso.
DELETE FROM public.pagos WHERE id IN (:WA, :WB);
SELECT public.chk((SELECT count(*) FROM public.pagos WHERE id IN (:WA, :WB)), 0,
  'V · andamiaje retirado');
