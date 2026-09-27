-- ============================================================================
-- BLOQUE 3 (20261011000000) · invariantes de UNA sesión
--
-- Como en la aplicación: SET ROLE authenticated + request.jwt.claim.sub.
-- RESET ROLE sólo para preparar datos o para probar que un guard rechaza una
-- escritura directa incluso sin la RLS de por medio.
-- ============================================================================
\set ON_ERROR_STOP 1
\set A    '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1   '''a1a1a1a1-0000-0000-0000-000000000001'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set CONT '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set VIS  '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set ADB  '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set OWN  '''a0a0a0a0-0000-0000-0000-0000000000f0'''
\set APR  '''a0a0a0a0-0000-0000-0000-0000000000f1'''
\set RUNO '''a0a0a0a0-0000-0000-0000-0000000000e1'''
\set RDOS '''a0a0a0a0-0000-0000-0000-0000000000e2'''
\set UNO  '''e0000000-0000-0000-0000-00000000a001'''
\set U1   '''f0000000-0000-0000-0000-00000000a001'''
\set J1   '''ad000000-0000-0000-0000-000000000001'''
\set J2   '''ad000000-0000-0000-0000-000000000002'''
\set J3   '''ad000000-0000-0000-0000-000000000003'''
\set J4   '''ad000000-0000-0000-0000-000000000004'''
\set J5   '''ad000000-0000-0000-0000-000000000005'''
\set J6   '''ad000000-0000-0000-0000-000000000006'''
\set J7   '''ad000000-0000-0000-0000-000000000007'''
\set JB   '''ad000000-0000-0000-0000-0000000000b1'''
\set P1   '''ad000000-0000-0000-0000-000000000011'''
\set P2   '''ad000000-0000-0000-0000-000000000012'''
\set P4   '''ad000000-0000-0000-0000-000000000014'''
\set R1   '''ad000000-0000-0000-0000-000000000021'''
\set QP   '''ad500000-0000-0000-0000-000000000001'''
\set PR1  '''ad900000-0000-0000-0000-000000000011'''
\set PR2  '''ad900000-0000-0000-0000-000000000012'''
\set PRT  '''ad900000-0000-0000-0000-000000000014'''
\set PRQ  '''ad900000-0000-0000-0000-000000000021'''
\set S1   '''5e000000-0000-0000-0000-000000000001'''
\set S1B  '''5e000000-0000-0000-0000-0000000001b0'''
\set S2   '''5e000000-0000-0000-0000-000000000002'''
\set S2C  '''5e000000-0000-0000-0000-0000000002c0'''
\set S3   '''5e000000-0000-0000-0000-000000000003'''
\set S4   '''5e000000-0000-0000-0000-000000000004'''
\set S5   '''5e000000-0000-0000-0000-000000000005'''
\set S6   '''5e000000-0000-0000-0000-000000000006'''
\set SB   '''5e000000-0000-0000-0000-0000000000b1'''
\set SP1  '''5e000000-0000-0000-0000-0000000000e1'''
\set SP2  '''5e000000-0000-0000-0000-0000000000e2'''
\set CB3  '''cb000000-0000-0000-0000-0000000000a3'''
\set ANT  '''9f5f0000-0000-0000-0000-0000000000e0'''

-- ── 0 · superficie ──────────────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     ('public.conta_ajuste_solicitar(uuid,text,text,uuid,text,uuid,numeric)'),
     ('public.conta_ajuste_aprobar(uuid,text,boolean)'),
     ('public.conta_ajuste_rechazar(uuid,text)'),
     ('public.conta_ajuste_cancelar(uuid,text)'),
     ('public.conta_ajuste_reintentar(uuid)'),
     ('public.conta_incidencia_resolver(uuid,text)'),
     ('public.portal_saldos_favor()'),
     ('public.portal_documentos_con_saldo()'),
     ('public.portal_solicitar_aplicacion_saldo_favor(uuid,uuid,text,uuid,numeric,text)'),
     ('public.portal_mis_solicitudes()')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
      AND NOT has_function_privilege('anon', f.s, 'EXECUTE')), 10,
  '0 · las RPC del flujo y del portal: authenticated sí, anon no');
SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     ('public.conta_ajuste_ejecutar(public.conta_ajustes_solicitudes,text)'),
     ('public.conta_ajuste_alta(uuid,uuid,text,text,uuid,uuid,numeric,text,text,uuid)'),
     ('public.conta_ajuste_en_ejecucion(text,uuid)'),
     ('public.conta_ajuste_exigir(text,uuid)'),
     ('public.conta_ajuste_revalidar(public.conta_ajustes_solicitudes)'),
     ('public.pasarela_registrar_estado(uuid,text,text,text,jsonb,text,timestamptz)'),
     ('public.conciliar_pago_externo(uuid,text,timestamptz)'),
     ('public.conta_cargo_saldo_pagable(uuid)'),
     ('public.conta_rechazar_cobro_por_reembolso(uuid,text)')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
       OR has_function_privilege('anon', f.s, 'EXECUTE')), 0,
  '0 · las funciones internas y las de la pasarela no son invocables por la aplicación');
SELECT public.chk(
  (SELECT count(*) FROM (VALUES ('public.conta_ajustes_solicitudes'), ('public.conta_ajustes_eventos'),
                                ('public.conta_cargo_anulaciones'), ('public.pasarela_eventos'),
                                ('public.conta_incidencias_conciliacion')) t(n)
    WHERE has_table_privilege('authenticated', t.n, 'INSERT') OR has_table_privilege('authenticated', t.n, 'UPDATE')
       OR has_table_privilege('authenticated', t.n, 'DELETE')), 0,
  '0 · la aplicación no escribe las tablas del flujo: sólo las RPC');

-- ── 1 · sin atajos: escrituras y llamadas directas ─────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ad000000-0000-0000-0000-000000000001'$$,
  'CARGO_ANULACION_SOLO_POR_SOLICITUD', '1 · anular un cargo por UPDATE directo: rechazado');
SELECT public.chk_falla($$SELECT * FROM public.conta_anular_cobro_cargo('cb000000-0000-0000-0000-0000000000a3', 'SINT atajo')$$,
  'AJUSTE_REQUIERE_SOLICITUD', '1 · anular un cobro de cargo llamando a la RPC: exige solicitud');
SELECT public.chk_falla($$SELECT * FROM public.conta_anular_anticipo('9f5f0000-0000-0000-0000-0000000000e0', 'SINT atajo')$$,
  'AJUSTE_REQUIERE_SOLICITUD', '1 · anular un anticipo llamando a la RPC: exige solicitud');
SELECT public.chk_falla($$SELECT * FROM public.conta_revertir_aplicacion_saldo_favor('5a000000-0000-0000-0000-000000000001', 'SINT atajo')$$,
  'AJUSTE_REQUIERE_SOLICITUD', '1 · revertir una aplicación llamando a la RPC: exige solicitud');
SELECT public.chk_falla($$INSERT INTO public.conta_ajustes_solicitudes (id, company_id, project_id, tipo, documento_tabla, documento_id, motivo, canal, solicitado_por)
  VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'anular_cargo', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000001', 'SINT atajo', 'backoffice', 'a0a0a0a0-0000-0000-0000-00000000000a')$$,
  'permission denied', '1 · insertar una solicitud a mano: sin permiso');
RESET ROLE;
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ad000000-0000-0000-0000-000000000001'$$,
  'CARGO_ANULACION_SOLO_POR_SOLICITUD', '1 · …ni siquiera sin la RLS: el guard está en la tabla');
SELECT public.chk_falla($$DELETE FROM public.cargos_adicionales_unidad WHERE id = 'ad000000-0000-0000-0000-000000000001'$$,
  'CARGO_NO_SE_BORRA', '1 · un cargo no se borra (se anula por solicitud)');
SELECT public.chk_falla($$UPDATE public.cargos_adicionales_unidad SET estado = 'pendiente' WHERE id = 'ad000000-0000-0000-0000-000000000007'$$,
  'CARGO_ANULADO_DEFINITIVO', '1 · un cargo anulado no se reactiva');
SELECT public.chk_txt(public.aj_cargo(:J1), 'pendiente/1/0', '1 · J1 sigue vivo con su devengo');

-- ── 2 · solicitar ───────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SET ROLE authenticated;
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e000000-0000-0000-0000-0000000000ff', 'anular_cargo', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000001', 'SINT visor')$$,
  'No autorizado', '2 · el visor contable no solicita');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e000000-0000-0000-0000-0000000000fe', 'anular_cargo', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000001', 'SINT intruso')$$,
  'no está en tu ámbito', '2 · el admin de otra empresa: el cargo no existe para él');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e000000-0000-0000-0000-0000000000fd', 'anular_cargo', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000001', 'x')$$,
  'AJUSTE_MOTIVO', '2 · sin motivo no hay solicitud');
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.repetida FROM public.conta_ajuste_solicitar(:S1, 'anular_cargo', 'cargos_adicionales_unidad', :J1, 'SINT se cobró por error') r),
  'pendiente/false', '2 · el admin solicita anular J1');
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.repetida FROM public.conta_ajuste_solicitar(:S1, 'anular_cargo', 'cargos_adicionales_unidad', :J1, 'SINT se cobró por error') r),
  'pendiente/true', '2 · repetir la misma solicitud (doble envío) devuelve la existente');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e000000-0000-0000-0000-000000000001', 'anular_cargo', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000001', 'SINT otro motivo')$$,
  'AJUSTE_CLAVE_REUSADA', '2 · la misma clave con otros datos se rechaza');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e000000-0000-0000-0000-0000000001b0', 'anular_cargo', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000001', 'SINT duplicada')$$,
  'AJUSTE_YA_SOLICITADO', '2 · una sola solicitud abierta por documento');
SELECT public.chk_txt(public.aj_cargo(:J1), 'pendiente/1/0', '2 · solicitar no cambia el documento');
SELECT public.chk_txt(public.aj_eventos(:S1), 'solicitada', '2 · bitácora: solicitada (una vez)');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk(
  (SELECT count(*) FROM public.conta_ajustes_solicitudes s WHERE s.id = :S1), 0,
  '2 · la otra empresa no ve la solicitud (RLS)');

-- ── 3 · aprobar: cuatro ojos (E1) ───────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-000000000001')$$,
  'AJUSTE_AUTOAPROBACION_NO_PERMITIDA', '3 · quien solicita no aprueba (aunque sea admin)');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-000000000001', NULL, true)$$,
  'AJUSTE_AUTOAPROBACION_NO_PERMITIDA', '3 · …ni confirmándolo: la excepción es sólo del company_owner');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-000000000001')$$,
  'No autorizado', '3 · crear/editar en contabilidad no alcanza para aprobar');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-000000000001')$$,
  'no está en tu ámbito', '3 · el admin de otra empresa no la ve');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.aj_sol(:S1), 'pendiente/0/false', '3 · los intentos rechazados no la tocaron');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :S1), 'ejecutada', '3 · el aprobador (RBAC approve) aprueba y se ejecuta');
SELECT public.chk_txt(public.aj_cargo(:J1), 'anulado/0/1', '3 · J1 anulado, su devengo reversado, con evidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargo_anulaciones an
    WHERE an.cargo_id = :J1 AND an.solicitud_id = :S1 AND an.anulado_por = :APR
      AND an.motivo = 'SINT se cobró por error' AND an.tenia_asiento AND an.reverso_id IS NOT NULL), 1,
  '3 · evidencia: solicitud, quien ejecutó, motivo, que tenía asiento y su reverso');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :S1), 'ejecutada/repetida', '3 · aprobar otra vez (doble clic): no se ejecuta de nuevo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos a WHERE a.origen_tabla = 'cargos_adicionales_unidad' AND a.origen_id = :J1
      AND a.origen_evento = 'cargo_adicional_emitido_revertido'), 1,
  '3 · un solo reverso');
SELECT public.chk_txt(public.aj_eventos(:S1), 'solicitada,aprobada,ejecutada', '3 · bitácora completa, sin duplicados');
SELECT public.chk_txt(public.aj_sol(:S1), 'ejecutada/1/false', '3 · una ejecución, no autoaprobada');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_cancelar('5e000000-0000-0000-0000-000000000001')$$,
  'AJUSTE_ESTADO', '3 · una ejecutada ya no se cancela');

-- ── 4 · autoaprobación: sólo el company_owner, confirmada y marcada ─────────
SELECT set_config('request.jwt.claim.sub', :OWN, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:S6, 'anular_cargo', 'cargos_adicionales_unidad', :J6, 'SINT el dueño lo pide') r),
  'pendiente', '4 · el dueño solicita');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-000000000006')$$,
  'AJUSTE_AUTOAPROBACION_SIN_CONFIRMAR', '4 · el dueño no se autoaprueba sin confirmarlo');
SELECT public.chk_txt(public.aj_sol(:S6), 'pendiente/0/false', '4 · …y no cambió nada');
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.autoaprobada FROM public.conta_ajuste_aprobar(:S6, 'SINT asumo la revisión', true) r),
  'ejecutada/true', '4 · confirmándolo sí, y queda marcada como autoaprobación');
SELECT public.chk_txt(public.aj_eventos(:S6), 'solicitada,autoaprobada,ejecutada', '4 · la bitácora dice «autoaprobada»');
SELECT public.chk_txt(public.aj_cargo(:J6), 'anulado/0/1', '4 · J6 anulado');
-- Sin excepción por «único aprobador»: en B el admin es el único que aprueba.
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:SB, 'anular_cargo', 'cargos_adicionales_unidad', :JB, 'SINT único aprobador') r),
  'pendiente', '4 · B: su único aprobador solicita');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-0000000000b1', NULL, true)$$,
  'AJUSTE_AUTOAPROBACION_NO_PERMITIDA', '4 · ser el único aprobador no habilita la autoaprobación');

-- ── 5 · documento cambiado, rechazo y cancelación ──────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:S2, 'anular_cargo', 'cargos_adicionales_unidad', :J2, 'SINT anular J2') r),
  'pendiente', '5 · solicitud sobre J2 (45)');
RESET ROLE;
UPDATE public.cargos_adicionales_unidad SET monto = 46 WHERE id = :J2;
SET ROLE authenticated;
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :S2), 'fallida/AJUSTE_DOCUMENTO_CAMBIO',
  '5 · J2 cambió de importe después de la solicitud: la aprobación no lo anula');
SELECT public.chk_txt(public.aj_cargo(:J2), 'pendiente/1/0', '5 · …y no quedó nada escrito');
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_rechazar('5e000000-0000-0000-0000-000000000002', 'no')$$,
  'AJUSTE_MOTIVO', '5 · rechazar exige motivo');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_rechazar(:S2, 'SINT el importe cambió; pedir de nuevo') r),
  'rechazada', '5 · el aprobador rechaza la fallida');
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.repetida FROM public.conta_ajuste_rechazar(:S2, 'SINT el importe cambió; pedir de nuevo') r),
  'rechazada/true', '5 · rechazar otra vez es idempotente');
SELECT public.chk_txt(public.aj_eventos(:S2), 'solicitada,aprobada,fallida,rechazada', '5 · bitácora de S2');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:S2C, 'anular_cargo', 'cargos_adicionales_unidad', :J2, 'SINT anular J2 otra vez') r),
  'pendiente', '5 · rechazada la anterior, se puede pedir otra');
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_cancelar('5e000000-0000-0000-0000-0000000002c0')$$,
  'no es tuya', '5 · sólo quien la pidió la cancela');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_cancelar(:S2C, 'SINT ya no hace falta') r),
  'cancelada', '5 · quien la pidió la cancela');
SELECT public.chk_falla($$SELECT public.aj_aprobar_como('a0a0a0a0-0000-0000-0000-0000000000f1', '5e000000-0000-0000-0000-0000000002c0')$$,
  'AJUSTE_ESTADO', '5 · una cancelada no se aprueba');
SELECT public.chk_txt(public.aj_cargo(:J2), 'pendiente/1/0', '5 · J2 intacto tras rechazo y cancelación');
-- Se restablece el importe de J2 (lo que indica la coherencia cargo↔devengo):
-- la conciliación del final lo detectaría como discrepancia, con razón.
RESET ROLE;
UPDATE public.cargos_adicionales_unidad SET monto = 45 WHERE id = :J2;
SET ROLE authenticated;

-- ── 6 · fallo de la ejecución y reintento ──────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM public.conta_registrar_cobro_cargo(:J3, 10, 'efectivo', CURRENT_DATE, 'SINT', NULL, :CB3)), 1,
  '6 · J3 recibe un cobro');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:S3, 'anular_cargo', 'cargos_adicionales_unidad', :J3, 'SINT anular J3') r),
  'pendiente', '6 · solicitud de anular J3 (con un cobro vivo)');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :S3), 'fallida/CARGO_CON_COBROS',
  '6 · la ejecución falla por el cobro vivo');
SELECT public.chk_txt(public.aj_cargo(:J3), 'pendiente/1/0', '6 · nada parcial: cargo vivo, devengo vivo, sin evidencia');
SELECT public.chk_txt(public.aj_sol(:S3), 'fallida/1/false', '6 · fallida con un intento');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_reintentar('5e000000-0000-0000-0000-000000000003')$$,
  'AJUSTE_AUTOAPROBACION_NO_PERMITIDA', '6 · quien la solicitó no ejecuta el reintento');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_reintentar('5e000000-0000-0000-0000-000000000003')$$,
  'No autorizado', '6 · reintentar exige permiso de aprobar');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.resultado FROM public.tst_anular_cobro_cargo(:CB3, 'SINT anular el cobro primero') r),
  'anulado', '6 · se anula el cobro (por su propia solicitud)');
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_reintentar(:S3) r),
  'ejecutada', '6 · el reintento ejecuta');
SELECT public.chk_txt(public.aj_sol(:S3), 'ejecutada/2/false', '6 · dos intentos');
SELECT public.chk_txt(public.aj_cargo(:J3), 'anulado/0/1', '6 · J3 anulado');
SELECT public.chk_txt(public.aj_eventos(:S3), 'solicitada,aprobada,fallida,reintento,ejecutada', '6 · bitácora del reintento');

-- Período de hoy cerrado: falla; reabierto: el reintento ejecuta.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:S5, 'anular_cargo', 'cargos_adicionales_unidad', :J5, 'SINT anular J5') r),
  'pendiente', '6 · solicitud sobre J5');
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado)
VALUES (:A, :A1, to_char(CURRENT_DATE, 'YYYY-MM'), 'cerrado');
SET ROLE authenticated;
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :S5), 'fallida/AJUSTE_PERIODO_CERRADO',
  '6 · con el período de hoy cerrado no hay fecha para el reverso');
SELECT public.chk_txt(public.aj_cargo(:J5), 'pendiente/1/0', '6 · nada escrito');
RESET ROLE;
DELETE FROM public.cierres_mensuales WHERE project_id = :A1 AND periodo = to_char(CURRENT_DATE, 'YYYY-MM');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt((SELECT r.estado FROM public.conta_ajuste_reintentar(:S5) r), 'ejecutada',
  '6 · reabierto el período, el reintento ejecuta');
SELECT public.chk_txt(public.aj_cargo(:J5), 'anulado/0/1', '6 · J5 anulado');

-- ── 7 · anulación SIN asiento: evidencia y estado de cuenta al corte ────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.aj_cargo(:J4), 'pendiente/0/0', '7 · J4 vivo y sin asiento (su tipo no estaba configurado)');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:S4, 'anular_cargo', 'cargos_adicionales_unidad', :J4, 'SINT J4 no correspondía') r),
  'pendiente', '7 · solicitud sobre J4');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :S4), 'ejecutada', '7 · aprobada y ejecutada');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cargo_anulaciones an
    WHERE an.cargo_id = :J4 AND NOT an.tenia_asiento AND an.reverso_id IS NULL
      AND an.anulado_at::date = CURRENT_DATE AND an.anulado_por = :APR), 1,
  '7 · la anulación sin asiento deja fecha del servidor, actor y motivo');
SELECT public.chk_txt(
  (SELECT f.clase || '|' || (f.motivo LIKE '%se anuló después del corte, el ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '%')
     FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL, CURRENT_DATE - 1, 500, 0) f WHERE f.origen_id = :J4),
  'pendiente|true', '7 · al corte de ayer J4 estaba vigente y se dice cuándo se anuló');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL, CURRENT_DATE, 500, 0) f WHERE f.origen_id = :J4), 0,
  '7 · al corte de hoy ya no figura');
SELECT public.chk_txt(
  (SELECT (l->>'documentos') || ':' || (l->>'monto')
     FROM jsonb_array_elements((SELECT e->'limitaciones' FROM public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, CURRENT_DATE - 1, 500, 0) e)) l
    WHERE l->>'codigo' = 'anulacion_sin_fecha'),
  '1:9.00', '7 · la limitación anulacion_sin_fecha sólo cuenta el heredado J7 (9), no J4');

-- ── 8 · portal: el residente CONSULTA y SOLICITA; contabilidad aplica (E4) ──
SELECT public.chk_txt(public.sf_anticipo(:U1, :UNO, 40, :ANT), 'contabilizada/-/40.00',
  '8 · Uno tiene un anticipo de 40 (saldo a favor)');
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk_txt(
  (SELECT string_agg(s.tipo || ':' || s.disponible, ',') FROM public.portal_saldos_favor() s
    WHERE s.origen_id = public.sf_origen_id(:ANT)),
  'anticipo:40.00', '8 · el residente ve su saldo a favor');
SELECT public.chk_txt(
  (SELECT d.saldo::text FROM public.portal_documentos_con_saldo() d WHERE d.documento_id = :R1),
  '30.00', '8 · …y su cargo R1 con saldo 30');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e000000-0000-0000-0000-0000000000e9', 'aplicar_saldo_favor', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000021', 'SINT atajo', public.sf_origen_id('9f5f0000-0000-0000-0000-0000000000e0'), 30)$$,
  'No autorizado', '8 · el residente no usa la RPC de back-office');
SELECT public.chk_falla(format($$SELECT * FROM public.portal_solicitar_aplicacion_saldo_favor('5e000000-0000-0000-0000-0000000000e8', %L, 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000021', 50)$$,
    public.sf_origen_id(:ANT)),
  'AJUSTE_IMPORTE', '8 · no pide más que su disponible');
SELECT public.chk_falla(format($$SELECT * FROM public.portal_solicitar_aplicacion_saldo_favor('5e000000-0000-0000-0000-0000000000e7', %L, 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-0000000000b1', 10)$$,
    public.sf_origen_id(:ANT)),
  'El documento no existe', '8 · ni a un documento que no es suyo');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.portal_solicitar_aplicacion_saldo_favor(:SP1, public.sf_origen_id(:ANT),
     'cargos_adicionales_unidad', :R1, 30, 'SINT aplíquenlo a mi cargo') r),
  'pendiente', '8 · el residente solicita aplicar 30 a R1');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_saldo_favor_aplicaciones x WHERE x.cargo_adicional_id = :R1), 0,
  '8 · solicitar NO aplica nada');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e000000-0000-0000-0000-0000000000e1')$$,
  'No autorizado', '8 · el residente no aprueba');
SELECT set_config('request.jwt.claim.sub', :RDOS, false);
SELECT public.chk(
  (SELECT count(*) FROM public.portal_saldos_favor() s WHERE s.origen_id = public.sf_origen_id(:ANT)), 0,
  '8 · otro residente no ve ese saldo');
SELECT public.chk(
  (SELECT count(*) FROM public.portal_mis_solicitudes()), 0, '8 · …ni la solicitud');
SELECT public.chk_falla(format($$SELECT * FROM public.portal_solicitar_aplicacion_saldo_favor('5e000000-0000-0000-0000-0000000000e6', %L, 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000021', 10)$$,
    public.sf_origen_id(:ANT)),
  'El saldo a favor no existe', '8 · ni lo puede pedir para sí');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :SP1), 'ejecutada', '8 · contabilidad aprueba y se aplica');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_saldo_favor_aplicaciones x
    WHERE x.id = :SP1 AND x.cargo_adicional_id = :R1 AND x.monto = 30 AND x.revertida_at IS NULL), 1,
  '8 · la aplicación usa la clave de la solicitud');
SELECT public.chk_txt(public.sf_estado_cargo(:R1), 'pagado', '8 · R1 queda saldado');
SELECT public.chk_txt(public.sf_origen(:ANT), 'anticipo:40.00:10.00', '8 · quedan 10 disponibles');
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk_txt(
  (SELECT string_agg(s.estado || ':' || s.importe, ',') FROM public.portal_mis_solicitudes() s),
  'ejecutada:30.00', '8 · el residente ve su solicitud ejecutada');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.portal_solicitar_aplicacion_saldo_favor(:SP2, public.sf_origen_id(:ANT),
     'cargos_adicionales_unidad', :P4, 5) r),
  'pendiente', '8 · otra solicitud');
SELECT public.chk_txt((SELECT r.estado FROM public.conta_ajuste_cancelar(:SP2) r), 'cancelada',
  '8 · el residente cancela su solicitud pendiente');
SELECT set_config('request.jwt.claim.sub', :ADM, false);

-- ── 9 · pasarela: cargos en línea, duplicados, orden y reembolsos ──────────
SELECT public.chk_falla($$SELECT public.pasarela_registrar_estado('ad900000-0000-0000-0000-000000000011', 'aprobado', 'webhook', 'x', NULL, NULL, NULL)$$,
  'permission denied', '9 · la aplicación no registra avisos del proveedor');
SELECT public.chk_txt(public.aj_aviso(:PR1, 'aprobado', 'webhook', 'evt-p1-ok') ->> 'accion', 'conciliado',
  '9 · aviso «aprobado» del cargo P1: se concilia');
SELECT public.chk_txt(public.aj_pr(:PR1), 'succeeded/1/aplicado', '9 · un pago aplicado');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.payment_request_id = :PR1 AND p.cargo_adicional_id = :P1
      AND p.cliente_id = :UNO AND p.metodo = 'tarjeta_credito'), 1,
  '9 · el pago va por el camino del cargo (vínculo, responsable y método)');
SELECT public.chk_txt(public.sf_intento((SELECT p.id FROM public.pagos p WHERE p.payment_request_id = :PR1)),
  'contabilizada/-', '9 · contabilizado contra la CxC de su devengo');
SELECT public.chk_txt(public.sf_estado_cargo(:P1), 'pagado', '9 · P1 queda pagado (estado derivado de sus cobros)');
SELECT public.chk_txt(
  (SELECT (r ->> 'duplicado') || '/' || (r ->> 'accion') FROM public.aj_aviso(:PR1, 'aprobado', 'webhook', 'evt-p1-ok') r),
  'true/duplicado', '9 · el MISMO aviso repetido no hace nada');
SELECT public.chk_txt(public.aj_aviso(:PR1, 'aprobado', 'consulta', NULL) ->> 'accion', 'ya_conciliado',
  '9 · la confirmación del servidor después del webhook: ya conciliado');
SELECT public.chk_txt(public.aj_pr(:PR1), 'succeeded/1/aplicado', '9 · sigue habiendo UN pago');
SELECT public.chk_txt(public.aj_aviso(:PR1, 'rechazado', 'webhook', 'evt-p1-rech') ->> 'accion', 'ignorado_fuera_de_orden',
  '9 · un «rechazado» que llega después no revierte el cobro');
SELECT public.chk_txt(public.aj_aviso(:PR1, 'pendiente', 'consulta', NULL) ->> 'accion', 'sin_cambio',
  '9 · un «pendiente» tampoco lo hace retroceder');
SELECT public.chk_txt(public.aj_pr(:PR1), 'succeeded/1/aplicado', '9 · …sigue acreditado');
SELECT public.chk_txt(public.aj_incidencias(:PR1), 'rechazo_tras_aprobacion:abierta',
  '9 · el aviso contradictorio abre UNA incidencia visible');
-- Aprobación tardía: primero rechazado, después aprobado.
SELECT public.chk_txt(public.aj_aviso(:PRT, 'rechazado', 'consulta', NULL) ->> 'estado', 'failed', '9 · P3 rechazado');
SELECT public.chk_txt(public.aj_aviso(:PRT, 'aprobado', 'webhook', 'evt-p3-ok') ->> 'estado', 'succeeded',
  '9 · el proveedor lo aprueba después: se acredita');
SELECT public.chk_txt(public.aj_pr(:PRT), 'succeeded/1/aplicado', '9 · con UN pago');

-- Reembolso de un cobro de cargo sin saldo aplicado: se rechaza el cobro.
SELECT public.chk_txt(public.aj_aviso(:PR2, 'aprobado', 'webhook', 'evt-p2-ok') ->> 'estado', 'succeeded', '9 · P2 pagado en línea');
SELECT public.chk_txt(public.sf_estado_cargo(:P2), 'pagado', '9 · P2 pagado');
SELECT public.chk_txt(public.aj_aviso(:PR2, 'reembolsado', 'webhook', 'evt-p2-refund') ->> 'accion', 'cobro_rechazado',
  '9 · reembolso confirmado: el cobro se rechaza');
SELECT public.chk_txt(public.aj_pr(:PR2), 'refunded/1/rechazado', '9 · la solicitud queda reembolsada y el pago rechazado');
SELECT public.chk_txt(public.sf_estado_cargo(:P2), 'pendiente', '9 · P2 vuelve a deber');
SELECT public.chk_txt(public.aj_incidencias(:PR2), 'reembolso_aplicado:abierta', '9 · incidencia para revisar');

-- Reembolso de un cobro cuyo saldo YA se aplicó: el rechazo se bloquea (E5)
-- y el reembolso NO se descarta.
SELECT public.chk_txt(public.aj_aviso(:PRQ, 'aprobado', 'webhook', 'evt-qp-ok') ->> 'estado', 'succeeded',
  '9 · la cuota QP (50) se paga en línea con 80');
SELECT public.chk_txt(public.sf_origen((SELECT p.id FROM public.pagos p WHERE p.payment_request_id = :PRQ)),
  'excedente:30.00:30.00', '9 · el excedente de 30 queda como saldo a favor');
SELECT public.chk_txt(
  public.sf_aplicar(public.sf_origen_id((SELECT p.id FROM public.pagos p WHERE p.payment_request_id = :PRQ)),
                    'cargos_adicionales_unidad', :P4, 10, '5a000000-0000-0000-0000-0000000000a9'),
  '10.00/0.00/10.00/20.00/0.00/pagado', '9 · contabilidad aplica 10 de ese saldo a P4');
SELECT public.chk_txt(public.aj_aviso(:PRQ, 'reembolsado', 'webhook', 'evt-qp-refund') ->> 'accion', 'rechazo_bloqueado',
  '9 · reembolso confirmado de un cobro con saldo aplicado: el rechazo se bloquea');
SELECT public.chk_txt(public.aj_pr(:PRQ), 'refunded/1/aplicado', '9 · …la solicitud SÍ queda reembolsada; el cobro sigue (sin cascada)');
SELECT public.chk_txt(public.aj_incidencias(:PRQ), 'reembolso_bloqueado:abierta', '9 · y se abre una incidencia visible');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_incidencias_conciliacion i
    WHERE i.payment_request_id = :PRQ AND i.detalle LIKE '%COBRO_SALDO_FAVOR_APLICADO%'), 1,
  '9 · con el motivo del bloqueo');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e
    WHERE e.payment_request_id = :PRQ AND e.estado_informado = 'reembolsado' AND e.resultado = 'rechazo_bloqueado'), 1,
  '9 · el evento del reembolso se conserva');
SELECT public.chk_txt(
  (SELECT (r ->> 'duplicado') FROM public.aj_aviso(:PRQ, 'reembolsado', 'webhook', 'evt-qp-refund') r),
  'true', '9 · el mismo reembolso repetido no duplica la incidencia');
SELECT public.chk_txt(public.aj_aviso(:PRQ, 'aprobado', 'webhook', 'evt-qp-ok-2') ->> 'accion', 'ignorado_reembolsado',
  '9 · un «aprobado» después del reembolso no vuelve a acreditar');
SELECT public.chk_txt(public.aj_incidencias(:PRQ), 'reembolso_bloqueado:abierta,aprobado_tras_reembolso:abierta',
  '9 · …y también queda a la vista');
RESET ROLE;
SELECT public.chk_falla($$SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true), public.conciliar_pago_externo('ad900000-0000-0000-0000-000000000021', NULL, NULL)$$,
  'PAGO_REEMBOLSADO', '9 · conciliar una solicitud reembolsada se rechaza');
SET ROLE authenticated;

-- Resolver incidencias.
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla(format($$SELECT * FROM public.conta_incidencia_resolver(%L, 'SINT visto')$$,
    (SELECT i.id FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = 'ad900000-0000-0000-0000-000000000012')),
  'No autorizado', '9 · el visor no resuelve incidencias');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk(
  (SELECT count(*) FROM public.conta_incidencias_conciliacion i WHERE i.company_id = :A), 0,
  '9 · la otra empresa no ve las incidencias');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_incidencia_resolver(
     (SELECT i.id FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = :PR2), 'SINT revisado: P2 vuelve a deber') r),
  'resuelta', '9 · contabilidad resuelve con nota');
SELECT public.chk_txt(public.aj_incidencias(:PR2), 'reembolso_aplicado:resuelta', '9 · resuelta');

-- ── 10 · el estado de cuenta sigue cuadrando ───────────────────────────────
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') || '|' || (c->'saldo_a_favor'->>'cuadra')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true|true', '10 · conciliación de Uno: CxC contra documentos y saldo a favor contra orígenes');
RESET ROLE;
