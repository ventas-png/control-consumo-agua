\set ON_ERROR_STOP on
-- ============================================================================
-- SEP-3 · La separación solicitante/aprobador FUNCIONA con el interruptor protegido, y no se inventa nada.
--
-- Los tres lectores del interruptor —compras_tg_oc_ciclo (UPDATE borrador → aprobada), compras_tg_permiso_orden_separada (INSERT ya
-- «aprobada»/«emitida») y compras_oc_excepcion_contrato (autorizar la propia excepción)— leen la MISMA fila (compras_config.aprobacion_separada),
-- sin cambios y sin una segunda fuente (la bitácora es memoria, no un interruptor). Aquí se comprueba con el interruptor puesto por la
-- RPC, de punta a punta:
--   · ENCENDIDA: solicitar y aprobar la misma persona se rechaza —por UPDATE (COMPRAS_OC_AUTOAPROBACION), por INSERT de una orden ya
--     «aprobada» y ya «emitida» (COMPRAS_OC_AUTOAPROBACION), y la propia excepción de contrato (COMPRAS_EXCEPCION_AUTOAUTORIZACION)—;
--     el administrador tampoco se aprueba lo suyo; OTRA persona sí aprueba.
--   · APAGADA por la RPC, SIN FILA de configuración o en una empresa que NUNCA la configuró: nada de eso se bloquea (no se activa globalmente,
--     no se inventan prohibiciones entre personas).
--   · Volver a encenderla vuelve a bloquear al instante (los lectores ven la fila en vivo).
--
-- Ids propios: órdenes 5e930…, contrato 5e931…; personas 5e90… (SEP-0). Deja la configuración de compras como la encontró.
-- ============================================================================
\ir SEP-0.padron.sql
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UB  '''c0c0c0c0-0000-0000-0000-00000000000b'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set SE  '''5e900000-0000-0000-0000-0000000000e1'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''

-- Una orden en borrador con su renglón, a nombre de quien llame (created_by lo sella el servidor).
CREATE OR REPLACE FUNCTION public.sep3_oc(p_id uuid, p_empresa uuid, p_proyecto uuid, p_proveedor uuid, p_precio numeric DEFAULT 100, p_contrato uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, contrato_id)
  VALUES (p_id, p_empresa, p_proyecto, p_proveedor, 'x', 'SEP-3 ' || p_id, p_contrato);
  INSERT INTO public.orden_compra_lineas (company_id, orden_compra_id, linea, descripcion, destino_tipo, categoria, cantidad, unidad, precio_unitario, iva_monto)
  VALUES (p_empresa, p_id, 1, 'Servicio', 'servicio', 'servicios', 1, 'servicio', p_precio, 0);
END;
$$;

CREATE TEMP TABLE sep3_previa AS
SELECT c.* FROM public.compras_config c WHERE c.company_id IN ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- A · Las fuentes: un solo interruptor, leído por los tres lectores de siempre
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_txt((SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.prosrc ILIKE '%aprobacion_separada%'
                          AND p.proname NOT LIKE 'compras\_separacion\_%' AND p.proname NOT LIKE 'compras\_tg\_config\_separacion%'
                          AND p.proname NOT LIKE 'sep\_%'),
  'compras_oc_excepcion_contrato,compras_tg_oc_ciclo,compras_tg_permiso_orden_separada',
  '[SEP-3a] las únicas funciones (fuera de la pieza) que consultan aprobacion_separada son los tres lectores de siempre: si aparece otra, hay que revisar que lea la misma fila');
SELECT public.chk_bool((SELECT bool_and(p.prosrc ~* 'FROM public\.compras_config c\s+WHERE c\.company_id' AND p.prosrc NOT ILIKE '%compras_config_separacion_bitacora%'
                                         AND p.prosrc NOT ILIKE '%compras_separacion_memoria%') AND count(*) = 3
                          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                         WHERE n.nspname = 'public' AND p.proname IN ('compras_oc_excepcion_contrato', 'compras_tg_oc_ciclo', 'compras_tg_permiso_orden_separada')), true,
  '[SEP-3b] cada lector lee la fila de compras_config de la empresa de la orden y NINGUNO consulta la bitácora ni su memoria (no hay segunda fuente que diverja)');
SELECT public.chk((SELECT count(*) FROM pg_policies WHERE qual ILIKE '%compras_config_separacion_bitacora%' OR with_check ILIKE '%compras_config_separacion_bitacora%'), 0,
  '[SEP-3c] y ninguna política consulta la bitácora para decidir un acceso');
SELECT public.chk_txt((SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.prosrc ILIKE '%compras_config_separacion_bitacora%'
                          AND p.proname NOT LIKE 'sep\_%' AND p.proname NOT LIKE 'chk%'),
  'compras_separacion_configurar,compras_separacion_memoria,compras_separacion_registrar,compras_tg_config_separacion_truncate',
  '[SEP-3d] y solo la pieza escribe y consulta la bitácora (la RPC, su memoria, el registro y el trigger de TRUNCATE; el trigger de fila escribe por el registro)');

-- ═══════════════════════════════════════════════════════════════════════════
-- B0 · Los lectores no cambiaron: con el interruptor puesto POR EL SISTEMA (la vía de siempre) rechazan igual. Esto es regresión pura:
--      es verde con y sin la pieza (la sección B, que lo enciende por la RPC, solo existe con la pieza).
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.sep_preparar(:C::uuid, true);
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-0000000000a1'::uuid, :C::uuid, :C1::uuid, :P1::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-0000000000a1' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3aa] (regresión) interruptor sembrado por el sistema: solicitar y aprobar la misma persona, rechazada por UPDATE');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('5e930000-0000-0000-0000-0000000000a2', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'SEP-3 nace aprobada (sistema)', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3ab] (regresión) y por INSERT ya «aprobada»');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('5e930000-0000-0000-0000-0000000000a3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'SEP-3 nace emitida (sistema)', 'emitida') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3ac] (regresión) y por INSERT ya «emitida»');
SELECT public.como(:UB::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-0000000000a1';
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-0000000000a1'), :UB::uuid,
  '[SEP-3ad] (regresión) otra persona la aprueba: pasa');
SELECT public.sep_preparar(:C::uuid, NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- B · ENCENDIDA por la RPC: nadie aprueba lo que solicitó
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.compras_separacion_configurar(:C::uuid, true, 'Control interno: quien solicita no aprueba la orden');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'true', '[SEP-3e] la RPC dejó la separación ENCENDIDA en C');

SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000001'::uuid, :C::uuid, :C1::uuid, :P1::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000001' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3f] solicitar y aprobar la misma persona: rechazada por UPDATE (compras_tg_oc_ciclo)');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('5e930000-0000-0000-0000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'SEP-3 nace aprobada', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3g] y por INSERT de una orden que ya nace «aprobada» (compras_tg_permiso_orden_separada)');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('5e930000-0000-0000-0000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'SEP-3 nace emitida', 'emitida') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3h] y de una que ya nace «emitida»');
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000001'), 'borrador', '[SEP-3i] la orden de SE sigue en borrador (nadie la aprobó)');
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra WHERE id IN ('5e930000-0000-0000-0000-000000000002', '5e930000-0000-0000-0000-000000000003')), 0,
  '[SEP-3i] y los INSERT rechazados no dejaron orden alguna');

-- El administrador tampoco se aprueba lo suyo.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000004'::uuid, :C::uuid, :C1::uuid, :P1::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000004' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3j] el administrador que solicitó la orden tampoco la aprueba');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('5e930000-0000-0000-0000-000000000005', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'SEP-3 admin nace aprobada', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3k] ni nace una orden «aprobada» por INSERT');
-- OTRA persona sí aprueba: UB aprueba la de SE y la de UA.
SELECT public.como(:UB::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id IN ('5e930000-0000-0000-0000-000000000001', '5e930000-0000-0000-0000-000000000004');
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000001'), :UB::uuid,
  '[SEP-3l] otra persona (UB) aprueba la orden de SE: pasa, y queda como aprobador');
SELECT public.chk_uuid((SELECT created_by FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000001'), :SE::uuid, '[SEP-3l] y SE sigue siendo el solicitante');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000004'), 'aprobada', '[SEP-3l] y UB aprueba la de UA');

-- La excepción de contrato (tercer lector): la autoriza otra persona, no quien solicitó la orden.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.contratos_proveedores (id, company_id, project_id, proveedor_id, proveedor_nombre, referencia, fecha_inicio, fecha_fin, modalidad, periodicidad, moneda,
                                          importe_periodico, monto_maximo, responsable_id)
VALUES ('5e931000-0000-0000-0000-000000000001', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'SEP-K1', CURRENT_DATE - 30, CURRENT_DATE + 300, 'por_demanda', NULL, 'GTQ', NULL, 100, :UA::uuid);
UPDATE public.contratos_proveedores SET estado = 'activo' WHERE id = '5e931000-0000-0000-0000-000000000001';
SELECT public.como(:SE::uuid);
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000011'::uuid, :C::uuid, :C1::uuid, :P1::uuid, 500, '5e931000-0000-0000-0000-000000000001'::uuid);
SELECT public.chk_falla($$ SELECT public.compras_oc_excepcion_contrato('5e930000-0000-0000-0000-000000000011', 'aprobar', 'Quien solicitó la orden autoriza su excepción') $$,
  'COMPRAS_EXCEPCION_AUTOAUTORIZACION', '[SEP-3m] con la separación encendida, quien solicitó la orden no autoriza su propia excepción de contrato');
SELECT public.como(:UB::uuid);
SELECT public.compras_oc_excepcion_contrato('5e930000-0000-0000-0000-000000000011', 'aprobar', 'El contrato se amplía en el próximo trimestre; el servicio no puede parar');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.orden_compra_excepciones WHERE orden_compra_id = '5e930000-0000-0000-0000-000000000011'), 1,
  '[SEP-3n] otra persona (UB) sí la autoriza: una excepción registrada');

-- ═══════════════════════════════════════════════════════════════════════════
-- C · APAGADA por la RPC: nada se bloquea (no se inventan prohibiciones entre personas)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.compras_separacion_configurar(:C::uuid, false, 'Se suspende el control mientras dura el cierre contable');
RESET ROLE;
SELECT public.chk_txt(public.sep_valor(:C::uuid), 'false', '[SEP-3o] la RPC apagó la separación');
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000021'::uuid, :C::uuid, :C1::uuid, :P1::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000021';
INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
VALUES ('5e930000-0000-0000-0000-000000000022', :C::uuid, :C1::uuid, :P1::uuid, 'x', 'SEP-3 nace aprobada, separación apagada', 'aprobada');
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000023'::uuid, :C::uuid, :C1::uuid, :P1::uuid, 500, '5e931000-0000-0000-0000-000000000001'::uuid);
SELECT public.compras_oc_excepcion_contrato('5e930000-0000-0000-0000-000000000023', 'aprobar', 'Con la separación apagada, quien solicitó la excepción la autoriza');
RESET ROLE;
SELECT public.chk_uuid((SELECT aprobada_por FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000021'), :SE::uuid,
  '[SEP-3p] con la separación APAGADA, quien solicita aprueba lo suyo por UPDATE (como siempre)');
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000022'), 'aprobada', '[SEP-3q] y nace una orden aprobada por INSERT (comportamiento de 0700)');
SELECT public.chk((SELECT count(*) FROM public.orden_compra_excepciones WHERE orden_compra_id = '5e930000-0000-0000-0000-000000000023'), 1,
  '[SEP-3r] y autoriza su propia excepción de contrato');

-- Sin fila de configuración (el sistema la borra: queda anotado como apagada): tampoco se bloquea nada.
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000031'::uuid, :C::uuid, :C1::uuid, :P1::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000031';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000031'), 'aprobada',
  '[SEP-3s] SIN fila en compras_config, quien solicita aprueba lo suyo: la ausencia de configuración no inventa una prohibición');

-- Una empresa que NUNCA la configuró: su administrador solicita y aprueba como siempre (la separación de C no la toca).
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000041'::uuid, :D::uuid, :D1::uuid, :PD::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000041';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000041'), 'aprobada',
  '[SEP-3t] una empresa que nunca la configuró (D) no se bloquea: la migración no activó la separación globalmente');

-- ═══════════════════════════════════════════════════════════════════════════
-- D · Volver a ENCENDER bloquea al instante; la de una empresa no afecta a la otra
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.compras_separacion_configurar(:C::uuid, true, 'Termina el cierre contable: se restablece el control');
RESET ROLE;
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000051'::uuid, :C::uuid, :C1::uuid, :P1::uuid);
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000051' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3u] al volver a encenderla por la RPC, la autoaprobación vuelve a rechazarse (los lectores ven la fila en vivo)');
SELECT public.chk_falla($$ INSERT INTO public.ordenes_compra (id, company_id, project_id, proveedor_id, proveedor_nombre, concepto, estado)
                           VALUES ('5e930000-0000-0000-0000-000000000052', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'e3000000-0000-0000-0000-000000000001', 'x', 'SEP-3 nace aprobada otra vez', 'aprobada') $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3v] y el INSERT ya aprobado también');
SELECT public.como(:UD::uuid);
SELECT public.sep3_oc('5e930000-0000-0000-0000-000000000042'::uuid, :D::uuid, :D1::uuid, :PD::uuid);
UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000042';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_compra WHERE id = '5e930000-0000-0000-0000-000000000042'), 'aprobada',
  '[SEP-3w] mientras tanto D (que no la encendió) sigue sin bloqueo: la separación es POR EMPRESA');

-- Un editor que intenta apagarla para aprobar lo suyo no lo logra por ninguna vía (el ataque original).
SELECT public.como(:SE::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ UPDATE public.compras_config SET aprobacion_separada = false WHERE company_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' $$,
  'COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN', '[SEP-3x] el ataque original (apagar → aprobar lo propio → volver a encender): el primer paso ya no existe');
SELECT public.chk_falla($$ UPDATE public.ordenes_compra SET estado = 'aprobada' WHERE id = '5e930000-0000-0000-0000-000000000051' $$,
  'COMPRAS_OC_AUTOAPROBACION', '[SEP-3y] y su orden sigue sin poder aprobarla él');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.ordenes_compra o WHERE o.id::text LIKE '5e930000-%' AND o.created_by = o.aprobada_por
                      AND o.id NOT IN ('5e930000-0000-0000-0000-000000000021', '5e930000-0000-0000-0000-000000000022', '5e930000-0000-0000-0000-000000000031',
                                       '5e930000-0000-0000-0000-000000000041', '5e930000-0000-0000-0000-000000000042')), 0,
  '[SEP-3z] invariante: ninguna orden creada con la separación encendida tiene solicitante = aprobador (las únicas autoaprobadas nacieron con ella apagada o sin fila)');

-- ── Se deja la configuración como estaba ─────────────────────────────────────
SELECT public.sep_preparar(:C::uuid, NULL);
SELECT public.sep_preparar(:D::uuid, NULL);
SELECT public.como_sistema($$ INSERT INTO public.compras_config SELECT * FROM sep3_previa $$);
DROP TABLE sep3_previa;
SELECT set_config('request.jwt.claim.sub', '', false);
