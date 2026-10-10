\set ON_ERROR_STOP on
-- ============================================================================
-- DEP-1 · Una orden de compra no puede NACER «aprobada»/«emitida» por INSERT con la separación
--         solicitante/aprobador activada (compras_config.aprobacion_separada).
--
-- CAUSA RAÍZ
--   La separación solo vive en compras_tg_oc_ciclo (trg_compras_oc_ciclo_a), que es BEFORE UPDATE y
--   solo mira «borrador → aprobada». 20261027000700 abrió el camino INSERT «aprobada»/«emitida»
--   (exige `approve`, y `change_status` para emitida) pero compras_tg_permiso_orden no consulta
--   compras_config: quien solicita (created_by = auth.uid(), lo sella el servidor) es, en ese mismo
--   acto, quien aprueba (aprobada_por = auth.uid(), también lo sella el servidor). Con 0300 todo
--   INSERT no-borrador se rechazaba para una sesión de usuario y la única vía era el UPDATE, donde
--   sí rige la separación; 0700 reabrió el hueco.
--
-- COMPORTAMIENTO ESPERADO
--   · Separación ENCENDIDA en la empresa: ninguna sesión de usuario inserta una orden ya «aprobada»
--     ni «emitida» (COMPRAS_OC_AUTOAPROBACION, el mismo código que el UPDATE), ni siquiera el
--     administrador; no queda orden, número ni evento.
--   · Separación apagada o sin fila de configuración: el comportamiento de 0700 NO cambia (el camino
--     que usa PR A / proveedores_pr_a §8 sigue valiendo): se exige el permiso del paso, el aprobador
--     lo sella el servidor, y recibida/cerrada/cancelada siguen siendo COMPRAS_ESTADO_INICIAL.
--   · La configuración es POR EMPRESA: encender la de D no afecta a C ni al revés.
--   · Los caminos del sistema (sin sesión de usuario, o con conta.allow_system_write) no se tocan.
--   · Lo legítimo bajo separación sigue funcionando: A solicita (borrador), B aprueba, C emite.
--
-- Ids propios: fa601NNN-0000-0000-0000-0000000000XX (grupo 6, hallazgo 01).
-- Deja la configuración de compras como la encontró.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set UX  '''fa601000-0000-0000-0000-0000000000a1'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''

-- ── Preparación: estado previo de la configuración (se restaura al final) ────
CREATE TEMP TABLE fa6_dep1_previa AS
SELECT c.* FROM public.compras_config c
 WHERE c.company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- UX: usuario NO administrador con «Autorizar» Y «Cambiar estado» (puede nacer una orden «emitida»).
INSERT INTO auth.users (id) VALUES ('fa601000-0000-0000-0000-0000000000a1');
INSERT INTO public.app_users (id, company_id, full_name, role)
VALUES ('fa601000-0000-0000-0000-0000000000a1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'DEP-1 Autoriza y cambia estado', 'operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type)
SELECT 'fa601000-0000-0000-0000-0000000000a1'::uuid, p, 'total'
  FROM unnest(ARRAY['c1c1c1c1-0000-0000-0000-000000000001', 'c2c2c2c2-0000-0000-0000-000000000001']::uuid[]) p;
INSERT INTO public.roles (id, company_id, name)
VALUES ('fa601000-0000-0000-0000-0000000000b1', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'DEP-1 Autoriza y cambia estado');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('fa601000-0000-0000-0000-0000000000b1', 'platform.contabilidad.view',          'allow'),
  ('fa601000-0000-0000-0000-0000000000b1', 'platform.contabilidad.create',        'allow'),
  ('fa601000-0000-0000-0000-0000000000b1', 'platform.contabilidad.edit',          'allow'),
  ('fa601000-0000-0000-0000-0000000000b1', 'platform.contabilidad.approve',       'allow'),
  ('fa601000-0000-0000-0000-0000000000b1', 'platform.contabilidad.change_status', 'allow'),
  -- PERMISOS POR ACCIÓN (20261027000900): nacer una orden «aprobada»/«emitida» exige la llave de la pestaña, no `approve` genérico.
  ('fa601000-0000-0000-0000-0000000000b1', 'condominios.tab.ordenes_compra.approve', 'allow');
INSERT INTO public.user_roles (user_id, role_id)
VALUES ('fa601000-0000-0000-0000-0000000000a1', 'fa601000-0000-0000-0000-0000000000b1');

-- ═══════════════════════════════════════════════════════════════════════════
-- A · Separación ENCENDIDA en C: el camino INSERT ya no deja autoaprobar
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;

SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
-- Control existente (verde también hoy): por UPDATE sí rige la separación.
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa601001-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 borrador de UQ');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa601001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1a] (control existente) borrador → aprobada por UPDATE: el solicitante no se aprueba a sí mismo');

-- EL HALLAZGO: lo mismo por el camino INSERT.
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, total, subtotal)
                           VALUES ('fa601001-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 aprobada directa de UQ', 'aprobada', 250000, 250000) $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1b] con la separación activada, quien tiene «Autorizar» NO inserta una orden ya «aprobada» (solicita y aprueba a la vez)');

SELECT public.como(:UX::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 emitida directa de UX', 'emitida') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1c] ni «emitida»: quien tiene «Autorizar» y «Cambiar estado» tampoco nace una orden emitida por sí mismo');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000004', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 aprobada directa de UX', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1d] ni «aprobada» quien además puede cambiar estado');

SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000005', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 aprobada directa del administrador', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1e] el administrador tampoco: el UPDATE no le da excepción y el INSERT no debe dársela');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000006', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 emitida directa del administrador', 'emitida') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1f] ni «emitida» el administrador');

-- Permisos primero: quien carece del permiso del paso recibe el MISMO rechazo de permiso de siempre (la separación solo
-- añade un rechazo a quien ya pasó el permiso; ningún código de error existente cambia).
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000007', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 aprobada directa de UC', 'aprobada') $$,
  'COMPRAS_PERMISO_ACCION', '[DEP-1g] separación encendida: quien solo crea recibe el rechazo de PERMISO (no el de separación) al insertar una orden aprobada');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000008', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 emitida directa de US', 'emitida') $$,
  'COMPRAS_PERMISO_ACCION', '[DEP-1g] separación encendida: quien solo cambia estado recibe el rechazo de PERMISO al insertar una orden emitida');
RESET ROLE;

SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id::text LIKE 'fa601001-0000-0000-0000-00000000000%' AND id <> 'fa601001-0000-0000-0000-000000000001'), 0,
  '[DEP-1h] los INSERT rechazados no dejaron orden alguna (ni numerada ni comprometida)');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id::text LIKE 'fa601001-0000-0000-0000-00000000000%' AND orden_compra_id <> 'fa601001-0000-0000-0000-000000000001'), 0,
  '[DEP-1h] ni evento en el historial');

-- ── Lo legítimo bajo separación: A solicita, B aprueba, C emite ──────────────
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa601001-0000-0000-0000-000000000011', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 flujo legítimo');
INSERT INTO public.orden_compra_lineas (id, company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
VALUES ('fa601002-0000-0000-0000-000000000011', :C::uuid, 'fa601001-0000-0000-0000-000000000011', 1, 'Servicio', 'servicio', 'servicios', 2, 'servicio', 100, 0);
SELECT public.como(:UB::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa601001-0000-0000-0000-000000000011';
SELECT public.como(:US::uuid);
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'fa601001-0000-0000-0000-000000000011';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000011'), 'emitida',
  '[DEP-1i] con la separación activada, el flujo de tres personas (solicita UQ, aprueba UB, emite US) funciona');
SELECT public.chk_uuid((SELECT created_by FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000011'), :UQ::uuid, '[DEP-1i] el solicitante es UQ');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000011'), :UB::uuid, '[DEP-1i] el aprobador es UB (otra persona)');

-- Un borrador por INSERT sigue naciendo (la separación no impide solicitar).
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa601001-0000-0000-0000-000000000012', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 borrador de UC con separación');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000012'), 'borrador',
  '[DEP-1j] con la separación activada, solicitar (nacer en borrador) sigue funcionando');

-- ── Los caminos del sistema no se tocan ──────────────────────────────────────
-- (1) sin sesión de usuario (service_role / mantenimiento / importación)
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000013', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 proceso sin sesión', 'aprobada');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000013'), 'aprobada',
  '[DEP-1k] un proceso sin sesión de usuario (mantenimiento) inserta una orden aprobada aun con la separación activada');
-- (2) con el permiso de sistema (un trigger de sistema, no una persona)
SELECT public.como(:UQ::uuid);
SET conta.allow_system_write = 'on';
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000014', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 camino de sistema', 'aprobada');
RESET conta.allow_system_write;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000014'), 'aprobada',
  '[DEP-1l] el camino de sistema (conta.allow_system_write) no se bloquea');

-- ═══════════════════════════════════════════════════════════════════════════
-- B · Separación APAGADA (fila en false): el comportamiento de 0700 no cambia
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como_sistema($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$);

SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000021', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 aprobada directa, separación apagada', 'aprobada');
SELECT public.como(:UX::uuid);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000022', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 emitida directa, separación apagada', 'emitida');
SELECT public.como(:UC::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000023', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 UC aprobada', 'aprobada') $$,
  'COMPRAS_PERMISO_ACCION', '[DEP-1m] separación apagada: quien solo crea sigue sin poder insertar una orden aprobada (permiso del paso)');
SELECT public.como(:US::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000024', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 US emitida', 'emitida') $$,
  'COMPRAS_PERMISO_ACCION', '[DEP-1m] ni «emitida» quien solo cambia estado (le falta aprobar)');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000025', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 recibida', 'recibida') $$,
  'COMPRAS_ESTADO_INICIAL', '[DEP-1m] una orden no nace «recibida» (ni el administrador)');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000021'), 'aprobada', '[DEP-1n] separación apagada: UQ nace una orden aprobada (comportamiento de 0700)');
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000021'), :UQ::uuid, '[DEP-1n] y el aprobador lo sella el servidor');
SELECT public.chk_bool((SELECT numero IS NOT NULL FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000021'), true, '[DEP-1n] y queda numerada');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000022'), 'emitida', '[DEP-1n] separación apagada: quien autoriza y cambia estado nace una orden emitida');

-- Sin fila de configuración (el estado por defecto de una empresa que nunca tocó el interruptor) = apagada.
DELETE FROM public.compras_config WHERE company_id = :C::uuid;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000026', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 aprobada directa, sin fila de configuración', 'aprobada');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000026'), 'aprobada', '[DEP-1o] sin fila en compras_config (por defecto) el INSERT aprobado de 0700 sigue valiendo');

-- ═══════════════════════════════════════════════════════════════════════════
-- C · La configuración es POR EMPRESA
-- ═══════════════════════════════════════════════════════════════════════════
-- D enciende la separación; C no la tiene: UQ (C) sigue pudiendo; el administrador de D no.
SELECT public.como_sistema($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true $$);
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000031', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'DEP-1 C apagada mientras D encendida', 'aprobada');
SELECT public.como(:UD::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000032', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1d1d1d1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-0000000000d1', 'x', 'DEP-1 D encendida', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1p] la empresa D tiene la separación encendida: su administrador no nace una orden aprobada');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000031'), 'aprobada', '[DEP-1p] y la empresa C (apagada) no se ve afectada por la de D');

-- C enciende y D apaga: el administrador de D vuelve a poder, el de C no.
SELECT public.como_sistema($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' $$);
SELECT public.como_sistema($$ INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true $$);
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa601001-0000-0000-0000-000000000033', :D::uuid, :D1::uuid, :PD::uuid, 'x', 'DEP-1 D apagada mientras C encendida', 'aprobada');
SELECT public.como(:UA::uuid);
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('fa601001-0000-0000-0000-000000000034', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'DEP-1 C encendida', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[DEP-1q] la empresa C vuelve a tener la separación encendida: su administrador no nace una orden aprobada');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa601001-0000-0000-0000-000000000033'), 'aprobada', '[DEP-1q] y la empresa D (apagada) no se ve afectada por la de C');

-- ── Invariante final ─────────────────────────────────────────────────────────
-- Ninguna orden de esta prueba, creada por una sesión de usuario con la separación encendida, tiene
-- solicitante = aprobador. (Las 021, 022, 026, 031, 033 se crearon con la separación apagada; 013 y 014 son de sistema.)
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra
                    WHERE id::text LIKE 'fa601001-%' AND created_by IS NOT NULL AND created_by = aprobada_por
                      AND id NOT IN ('fa601001-0000-0000-0000-000000000021', 'fa601001-0000-0000-0000-000000000022', 'fa601001-0000-0000-0000-000000000026',
                                     'fa601001-0000-0000-0000-000000000031', 'fa601001-0000-0000-0000-000000000033', 'fa601001-0000-0000-0000-000000000014')), 0,
  '[DEP-1r] invariante: bajo separación encendida no existe orden con solicitante = aprobador');

-- ── Se deja la configuración como estaba ─────────────────────────────────────
SELECT public.como_sistema($$ DELETE FROM public.compras_config WHERE company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $$);
SELECT public.como_sistema($$ INSERT INTO public.compras_config SELECT * FROM fa6_dep1_previa $$);
DROP TABLE fa6_dep1_previa;
