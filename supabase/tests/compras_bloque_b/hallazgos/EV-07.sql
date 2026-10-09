\set ON_ERROR_STOP on
-- ============================================================================
-- EV-07 · Evasión de la separación solicitante/aprobador creando la orden YA «aprobada» por INSERT
--         (misma causa raíz que DEP-1; esta prueba la ataca desde el lado del adversario y afirma
--         el INVARIANTE sobre lo que queda guardado, no solo el código de error).
--
-- CAUSA RAÍZ
--   La separación (compras_config.aprobacion_separada) solo vive en compras_tg_oc_ciclo (BEFORE UPDATE,
--   borrador → aprobada). El camino INSERT «aprobada»/«emitida» de 20261027000700 exige el permiso del
--   paso pero no consulta la configuración: created_by = aprobada_por = auth.uid().
--
-- COMPORTAMIENTO ESPERADO (invariante)
--   Con la separación encendida en una empresa, NINGUNA orden creada por una sesión de usuario llega a
--   existir con solicitante = aprobador, sea cual sea el camino: INSERT aprobada, INSERT emitida,
--   INSERT con created_by/aprobada_por falsificados, ON CONFLICT DO NOTHING / DO UPDATE, otra
--   contabilidad (proyecto) de la misma empresa, super administrador, o dar vueltas con la devolución.
--   Los intentos rechazados no dejan orden, evento ni número quemado. La configuración de OTRA empresa
--   no sirve de coartada, y lo ya aprobado antes de encender la separación no se toca.
--
-- Ids propios: fa607NNN-0000-0000-0000-0000000000XX (grupo 6, hallazgo 07).
-- Deja la configuración de compras como la encontró.
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set US  '''c0c0c0c0-0000-0000-0000-00000000001b'''
\set UR  '''fa607000-0000-0000-0000-0000000000a2'''
\set UR2 '''fa607000-0000-0000-0000-0000000000a3'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''

-- ── Preparación ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE fa6_ev07_previa AS
SELECT c.* FROM public.compras_config c
 WHERE c.company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- Ejecuta un SQL y devuelve 'OK' o el mensaje de error (sin abortar), CONSERVANDO sus efectos si pasó.
CREATE OR REPLACE FUNCTION public.fa6_intentar(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$;
CREATE TEMP TABLE fa6_ev07_res (k text PRIMARY KEY, r text);
GRANT ALL ON fa6_ev07_res TO authenticated;

-- UR: super administrador (propio de esta prueba).
INSERT INTO auth.users (id) VALUES ('fa607000-0000-0000-0000-0000000000a2');
INSERT INTO public.app_users (id, company_id, full_name, role)
VALUES ('fa607000-0000-0000-0000-0000000000a2', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'EV-07 Super administrador', 'super_admin');
-- UR2: super administrador cuya empresa es OTRA (D): la configuración que cuenta es la de la empresa de la ORDEN.
INSERT INTO auth.users (id) VALUES ('fa607000-0000-0000-0000-0000000000a3');
INSERT INTO public.app_users (id, company_id, full_name, role)
VALUES ('fa607000-0000-0000-0000-0000000000a3', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'EV-07 Super administrador de D', 'super_admin');

-- Un borrador de UQ en cada contabilidad, y un borrador de UQ para los ON CONFLICT.
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto) VALUES
  ('fa607001-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'EV-07 borrador base de UQ'),
  ('fa607001-0000-0000-0000-000000000002', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'EV-07 borrador para el upsert de UQ');
RESET ROLE;

-- Una orden ya aprobada ANTES de encender la separación (no debe tocarse al encenderla).
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa607001-0000-0000-0000-000000000003', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'EV-07 aprobada antes de la separación', 'aprobada');
RESET ROLE;

SELECT numero IS NOT NULL AS tiene_numero FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000003' \gset
SELECT public.chk_bool(:'tiene_numero'::boolean, true, '[EV-07a] preparación: la orden aprobada antes de la separación existe y está numerada');

-- Último número de OC en C1 (para probar que un rechazo no quema número).
SELECT ultimo AS ultimo_antes FROM public.compras_correlativos
 WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001' AND documento = 'orden_compra' \gset

-- ═══════════════════════════════════════════════════════════════════════════
-- Se enciende la separación en C. Ahora el adversario (UQ: ver/crear/editar/autorizar) intenta TODO.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO public.compras_config (company_id, aprobacion_separada) VALUES (:C::uuid, true)
  ON CONFLICT (company_id) DO UPDATE SET aprobacion_separada = true;

SELECT public.como(:UQ::uuid);
SET ROLE authenticated;

-- 1 · La reproducción del revisor, tal cual.
INSERT INTO fa6_ev07_res SELECT 'upd_borrador', public.fa6_intentar($q$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa607001-0000-0000-0000-000000000001' $q$);
INSERT INTO fa6_ev07_res SELECT 'ins_aprobada', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000010', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada directa de UQ', 'aprobada') $q$);

-- 2 · INSERT con el solicitante y el aprobador FALSIFICADOS a nombre de otra persona.
INSERT INTO fa6_ev07_res SELECT 'ins_falsificado', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado, created_by, aprobada_por, aprobada_at)
  VALUES ('fa607001-0000-0000-0000-000000000011', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada con firmas falsas', 'aprobada',
          'c0c0c0c0-0000-0000-0000-00000000000b', 'c0c0c0c0-0000-0000-0000-00000000000b', now()) $q$);

-- 3 · ON CONFLICT DO NOTHING / DO UPDATE (el upsert de PostgREST).
INSERT INTO fa6_ev07_res SELECT 'ins_nothing', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000012', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada con ON CONFLICT DO NOTHING', 'aprobada')
  ON CONFLICT (id) DO NOTHING $q$);
INSERT INTO fa6_ev07_res SELECT 'ins_upsert_aprobada', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 upsert hacia aprobada', 'aprobada')
  ON CONFLICT (id) DO UPDATE SET estado = EXCLUDED.estado $q$);
INSERT INTO fa6_ev07_res SELECT 'ins_upsert_borrador', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 upsert con fila borrador y DO UPDATE a aprobada', 'borrador')
  ON CONFLICT (id) DO UPDATE SET estado = 'aprobada' $q$);

-- 4 · «Emitida» (necesita autorizar Y cambiar estado: el administrador sí lo tiene) y otra contabilidad de la empresa.
SELECT public.como(:UA::uuid);
INSERT INTO fa6_ev07_res SELECT 'ins_emitida_admin', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000013', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 emitida directa del administrador', 'emitida') $q$);
INSERT INTO fa6_ev07_res SELECT 'ins_aprobada_c2', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000014', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c2c2c2c2-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada directa en C2', 'aprobada') $q$);
INSERT INTO fa6_ev07_res SELECT 'ins_aprobada_sin_proyecto', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000015', 'cccccccc-cccc-cccc-cccc-cccccccccccc', NULL,
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada directa de la empresa (sin proyecto)', 'aprobada') $q$);

-- 5 · El super administrador tampoco.
SELECT public.como(:UR::uuid);
INSERT INTO fa6_ev07_res SELECT 'ins_aprobada_super', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000016', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada directa del super administrador', 'aprobada') $q$);

SELECT public.como(:UR2::uuid);
INSERT INTO fa6_ev07_res SELECT 'ins_aprobada_super_otra', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000018', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-000000000001', 'x', 'EV-07 aprobada directa del super administrador de D en C', 'aprobada') $q$);

-- 6 · Coartada de otra empresa: UQ (de C) intenta nacer la orden como de D, donde la separación está apagada.
SELECT public.como(:UQ::uuid);
INSERT INTO fa6_ev07_res SELECT 'ins_otra_empresa', public.fa6_intentar($q$
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
  VALUES ('fa607001-0000-0000-0000-000000000017', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd1d1d1d1-0000-0000-0000-000000000001',
          'e3000000-0000-0000-0000-0000000000d1', 'x', 'EV-07 aprobada directa fingiendo ser de D', 'aprobada') $q$);

-- 7 · La función de servidor `compras_orden_crear` no deja colar el estado en la cabecera.
INSERT INTO fa6_ev07_res SELECT 'rpc_estado', public.fa6_intentar($q$
  SELECT public.compras_orden_crear('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
    jsonb_build_object('proveedor_id', 'e3000000-0000-0000-0000-000000000001', 'concepto', 'EV-07 por la función de servidor',
                       'clave_idempotencia', 'EV07-clave-0001', 'estado', 'aprobada', 'aprobada_por', 'c0c0c0c0-0000-0000-0000-00000000000b'),
    '[]'::jsonb) $q$);
RESET ROLE;

-- ── Resultados de cada intento ───────────────────────────────────────────────
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: quien solicita%' FROM fa6_ev07_res WHERE k = 'upd_borrador'), true,
  '[EV-07b] (control existente) borrador → aprobada por UPDATE: rechazado como autoaprobación');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_aprobada'), true,
  '[EV-07c] INSERT directo «aprobada» (la reproducción del revisor) se rechaza como autoaprobación');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_falsificado'), true,
  '[EV-07d] con created_by / aprobada_por falsificados a nombre de otra persona: también rechazado');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_nothing'), true,
  '[EV-07e] INSERT … ON CONFLICT DO NOTHING con estado «aprobada»: rechazado (los triggers BEFORE INSERT corren antes del conflicto)');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION%' FROM fa6_ev07_res WHERE k = 'ins_upsert_aprobada'), true,
  '[EV-07f] upsert con la fila propuesta «aprobada»: rechazado');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION%' FROM fa6_ev07_res WHERE k = 'ins_upsert_borrador'), true,
  '[EV-07f] upsert con fila «borrador» y DO UPDATE SET estado = aprobada: rechazado por el camino de UPDATE');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_emitida_admin'), true,
  '[EV-07g] INSERT «emitida» del administrador (tiene autorizar y cambiar estado): rechazado');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_aprobada_c2'), true,
  '[EV-07h] en otra contabilidad (proyecto C2) de la misma empresa: rechazado');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_aprobada_sin_proyecto'), true,
  '[EV-07h] en la contabilidad de la empresa (sin proyecto): rechazado');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_aprobada_super'), true,
  '[EV-07i] el super administrador tampoco nace una orden aprobada con la separación encendida');
SELECT public.chk_bool((SELECT r LIKE 'COMPRAS_OC_AUTOAPROBACION: la empresa exige%' FROM fa6_ev07_res WHERE k = 'ins_aprobada_super_otra'), true,
  '[EV-07i] un super administrador de OTRA empresa (D) tampoco nace una orden aprobada en C: cuenta la configuración de la empresa de la orden');
SELECT public.chk_bool((SELECT r <> 'OK' FROM fa6_ev07_res WHERE k = 'ins_otra_empresa'), true,
  '[EV-07j] fingir que la orden es de D (separación apagada) no sirve de coartada: el aislamiento por empresa lo rechaza');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000017'), 0,
  '[EV-07j] y no queda orden alguna');
SELECT public.chk_txt((SELECT r FROM fa6_ev07_res WHERE k = 'rpc_estado'), 'OK',
  '[EV-07k] la función de servidor crea la orden (en borrador) aunque la cabecera traiga un estado y un aprobador');

-- La función de servidor crea SIEMPRE en borrador, diga lo que diga la cabecera.
SELECT public.chk_txt((SELECT o.estado FROM public.ordenes_compra o WHERE o.company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND o.clave_idempotencia = 'EV07-clave-0001'), 'borrador',
  '[EV-07k] compras_orden_crear ignora un estado/aprobador en la cabecera: la orden nace «borrador»');
SELECT public.chk_bool((SELECT o.aprobada_por IS NULL FROM public.ordenes_compra o WHERE o.company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND o.clave_idempotencia = 'EV07-clave-0001'), true,
  '[EV-07k] y sin aprobador');

-- ── INVARIANTES sobre lo que quedó GUARDADO ──────────────────────────────────
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id::text LIKE 'fa607001-%' AND created_by IS NOT NULL AND created_by = aprobada_por
                      AND id <> 'fa607001-0000-0000-0000-000000000003'), 0,
  '[EV-07l] INVARIANTE: con la separación encendida no existe ninguna orden con solicitante = aprobador (creada después de encenderla)');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id::text LIKE 'fa607001-%' AND estado IN ('aprobada', 'emitida')
                      AND id <> 'fa607001-0000-0000-0000-000000000003'), 0,
  '[EV-07l] y ninguna de las órdenes del ataque quedó aprobada ni emitida');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_eventos WHERE orden_compra_id::text LIKE 'fa607001-%' AND estado_nuevo IN ('aprobada', 'emitida')
                      AND orden_compra_id <> 'fa607001-0000-0000-0000-000000000003'), 0,
  '[EV-07m] el historial no registra ninguna aprobación/emisión de esas órdenes');
SELECT ultimo AS ultimo_despues FROM public.compras_correlativos
 WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND project_id = 'c1c1c1c1-0000-0000-0000-000000000001' AND documento = 'orden_compra' \gset
SELECT public.chk(:ultimo_despues::bigint, :ultimo_antes::bigint, '[EV-07n] los intentos rechazados no quemaron ni un número de orden (el correlativo no avanzó)');

-- ── Dar vueltas con la devolución tampoco abre el hueco ──────────────────────
-- UB aprueba el borrador de UQ; UB lo devuelve; UQ no puede reaprobarlo ni cambiar quién lo solicitó.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa607001-0000-0000-0000-000000000001';
UPDATE public.ordenes_compra SET estado = 'borrador', motivo_devolucion = 'EV-07 devuelta para revisar condiciones' WHERE id = 'fa607001-0000-0000-0000-000000000001';
SELECT public.como(:UQ::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa607001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[EV-07o] devuelta a borrador, el solicitante original sigue sin poder reaprobarla');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET created_by = 'c0c0c0c0-0000-0000-0000-00000000000b' WHERE id = 'fa607001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_SOLICITANTE_INMUTABLE', '[EV-07o] reescribir created_by (hacerse pasar por otro solicitante) se rechaza: el solicitante es inmutable');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET created_by = 'c0c0c0c0-0000-0000-0000-00000000000b', estado = 'aprobada' WHERE id = 'fa607001-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_SOLICITANTE_INMUTABLE', '[EV-07o] y cambiar el solicitante Y aprobar en la misma operación tampoco');
RESET ROLE;
SELECT public.chk_uuid((SELECT created_by FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000001'), :UQ::uuid,
  '[EV-07o] el solicitante sigue siendo UQ');

-- ── Lo legítimo sigue funcionando con la separación encendida ────────────────
-- (1) Lo aprobado ANTES de encender la separación no se toca: otra persona lo emite.
SELECT public.como(:US::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'emitida' WHERE id = 'fa607001-0000-0000-0000-000000000003';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000003'), 'emitida',
  '[EV-07p] lo aprobado antes de encender la separación se emite con normalidad (la regla no es retroactiva)');
-- (2) El flujo de dos personas: UQ solicita, UB aprueba.
SELECT public.como(:UB::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa607001-0000-0000-0000-000000000002';
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000002'), :UB::uuid,
  '[EV-07p] solicita UQ, aprueba UB: funciona y el aprobador es UB');
-- (3) Un borrador nuevo por INSERT, y UB lo aprueba.
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto)
VALUES ('fa607001-0000-0000-0000-000000000020', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'EV-07 borrador de UC');
SELECT public.como(:UB::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = 'fa607001-0000-0000-0000-000000000020';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000020'), 'aprobada',
  '[EV-07p] solicita UC, aprueba UB: funciona');
-- (4) Un proceso sin sesión de usuario sigue pudiendo cargar una orden aprobada (importación / mantenimiento).
SELECT set_config('request.jwt.claim.sub', '', false);
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa607001-0000-0000-0000-000000000021', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'EV-07 carga del sistema', 'aprobada');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000021'), 'aprobada',
  '[EV-07q] un proceso sin sesión de usuario sigue pudiendo cargar una orden aprobada');

-- ── Con la separación apagada, el INSERT aprobado de 0700 NO cambia ──────────
UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = :C::uuid;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('fa607001-0000-0000-0000-000000000030', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'EV-07 aprobada directa, separación apagada', 'aprobada');
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = 'fa607001-0000-0000-0000-000000000030'), :UQ::uuid,
  '[EV-07r] separación apagada: el INSERT aprobado de 0700 sigue funcionando (aprobador sellado por el servidor)');

-- ── Se deja la configuración como estaba ─────────────────────────────────────
DELETE FROM public.compras_config WHERE company_id IN (:C::uuid, :D::uuid);
INSERT INTO public.compras_config SELECT * FROM fa6_ev07_previa;
DROP TABLE fa6_ev07_previa;
DROP FUNCTION public.fa6_intentar(text);
