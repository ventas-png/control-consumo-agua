-- ============================================================================
-- CIERRE DEL BLOQUE 3 (20261012000000) · invariantes de UNA sesión
--   11 · superficie nueva
--   12 · anular cuota: atajos cerrados
--   13 · anular cuota: permisos, aislamiento y dependencias sin cascada
--   14 · anular cuota: ejecución, reverso vinculado, evidencia, efectos
--   15 · anular cuota: fallo sin efectos parciales, período cerrado, reintento
--   16 · anular cuota: cuatro ojos y autoaprobación del dueño
--   17 · respaldo documental
--   18 · reembolsos parciales: duplicados, acumulados, fuera de orden
--   19 · el estado de cuenta sigue cuadrando
--   20 · confirmación tardía de un cobro sobre una cuota anulada o eliminada
--   21 · reembolso total antes de aprobar; respuesta = estado persistido
--   22 · E6: rebaja de importe (nota de crédito)
--   23 · E7: cancelar la reserva anula su tarifa
--   24 · E8: cobros abandonados (cron) y resolución manual con respaldo
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
\set UNO  '''e0000000-0000-0000-0000-00000000a001'''
\set QA   '''c9a00000-0000-0000-0000-00000000000a'''
\set QB   '''c9a00000-0000-0000-0000-00000000000b'''
\set QC   '''c9a00000-0000-0000-0000-00000000000c'''
\set QD   '''c9a00000-0000-0000-0000-00000000000d'''
\set QE   '''c9a00000-0000-0000-0000-00000000000e'''
\set QF   '''c9a00000-0000-0000-0000-00000000000f'''
\set QG   '''c9a00000-0000-0000-0000-000000000010'''
\set QH   '''c9a00000-0000-0000-0000-000000000011'''
\set QI   '''c9a00000-0000-0000-0000-000000000012'''
\set QJ   '''c9a00000-0000-0000-0000-000000000013'''
\set QK   '''c9a00000-0000-0000-0000-000000000014'''
\set QZ   '''c9a00000-0000-0000-0000-0000000000b1'''
\set TA   '''5e0b0000-0000-0000-0000-00000000000a'''
\set TC   '''5e0b0000-0000-0000-0000-00000000000c'''
\set TD   '''5e0b0000-0000-0000-0000-00000000000d'''
\set TH   '''5e0b0000-0000-0000-0000-000000000011'''
\set TI   '''5e0b0000-0000-0000-0000-000000000012'''
\set TJ   '''5e0b0000-0000-0000-0000-000000000013'''
\set TK   '''5e0b0000-0000-0000-0000-000000000014'''
\set KB   '''cc0b0000-0000-0000-0000-00000000000b'''
\set KD   '''cc0b0000-0000-0000-0000-00000000000d'''
\set KG   '''cc0b0000-0000-0000-0000-000000000010'''
\set KA   '''cc0b0000-0000-0000-0000-00000000000a'''
\set RJ1  '''4e0b0000-0000-0000-0000-000000000001'''
\set RJ2  '''4e0b0000-0000-0000-0000-000000000002'''
\set RK1  '''4e0b0000-0000-0000-0000-000000000003'''
\set PP1  '''ad900000-0000-0000-0000-000000000041'''
\set PP2  '''ad900000-0000-0000-0000-000000000042'''
\set ANTC '''9f5f0000-0000-0000-0000-00000000c0c0'''
\set QL   '''c9a00000-0000-0000-0000-000000000017'''
\set TL   '''5e0b0000-0000-0000-0000-000000000017'''
\set PQ1  '''ad900000-0000-0000-0000-0000000000a1'''
\set PQ5  '''ad900000-0000-0000-0000-0000000000a5'''
\set QR   '''c9a00000-0000-0000-0000-000000000023'''
\set QS   '''c9a00000-0000-0000-0000-000000000024'''
\set PR6  '''ad900000-0000-0000-0000-0000000000a6'''
\set PR7  '''ad900000-0000-0000-0000-0000000000a7'''
\set QW1  '''c9a00000-0000-0000-0000-000000000031'''
\set QW2  '''c9a00000-0000-0000-0000-000000000032'''
\set QW4  '''c9a00000-0000-0000-0000-000000000034'''
\set QW5  '''c9a00000-0000-0000-0000-000000000035'''
\set CW   '''ad000000-0000-0000-0000-000000000051'''
\set TW1  '''5e0b0000-0000-0000-0000-000000000031'''
\set TW2  '''5e0b0000-0000-0000-0000-000000000032'''
\set TW4  '''5e0b0000-0000-0000-0000-000000000034'''
\set TW5  '''5e0b0000-0000-0000-0000-000000000035'''
\set TC1  '''5e0b0000-0000-0000-0000-000000000051'''
\set TC2  '''5e0b0000-0000-0000-0000-000000000052'''
\set KW1  '''cc0b0000-0000-0000-0000-000000000031'''
\set AJB  '''11000000-0000-0000-0000-00000000a1b0'''
\set RV1  '''a3e00000-0000-0000-0000-000000000101'''
\set RV2  '''a3e00000-0000-0000-0000-000000000102'''
\set RV3  '''a3e00000-0000-0000-0000-000000000103'''
\set RV4  '''a3e00000-0000-0000-0000-000000000104'''
\set RV5  '''a3e00000-0000-0000-0000-000000000105'''
\set QR1  '''c9a00000-0000-0000-0000-000000000041'''
\set QR2  '''c9a00000-0000-0000-0000-000000000042'''
\set QR3  '''c9a00000-0000-0000-0000-000000000043'''
\set QR5  '''c9a00000-0000-0000-0000-000000000045'''

-- ── 11 · superficie nueva ──────────────────────────────────────────────────
SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     ('public.conta_ajuste_aprobar(uuid,text,boolean,uuid[])'),
     ('public.conta_ajuste_dependencias(text,uuid)'),
     ('public.conta_ajuste_adjuntar_respaldo(uuid,uuid,text,text,text)')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
      AND NOT has_function_privilege('anon', f.s, 'EXECUTE')), 3,
  '11 · aprobar (con respaldos), dependencias y adjuntar: authenticated sí, anon no');
SELECT public.chk(
  (SELECT count(*) FROM pg_proc p WHERE p.oid = to_regprocedure('public.conta_ajuste_aprobar(uuid,text,boolean)')), 0,
  '11 · no queda la firma anterior de aprobar (sin respaldos)');
SELECT public.chk(
  (SELECT count(*) FROM (VALUES
     ('public.pasarela_registrar_reembolso_parcial(uuid,text,text,numeric,text,timestamptz,text,text,jsonb)'),
     ('public.conta_cuota_dependencias(uuid,boolean)'),
     ('public.conta_cuota_exigir_sin_dependencias(uuid,boolean,text)'),
     ('public.conta_ajuste_respaldos_foto(uuid)')) f(s)
    WHERE has_function_privilege('authenticated', f.s, 'EXECUTE')
       OR has_function_privilege('anon', f.s, 'EXECUTE')), 0,
  '11 · el reembolso parcial y las funciones internas no son invocables por la aplicación');
SELECT public.chk(
  (SELECT count(*) FROM (VALUES ('public.conta_cuota_anulaciones'), ('public.pasarela_reembolsos'),
                                ('public.conta_ajustes_respaldos')) t(n)
    WHERE has_table_privilege('authenticated', t.n, 'INSERT') OR has_table_privilege('authenticated', t.n, 'UPDATE')
       OR has_table_privilege('authenticated', t.n, 'DELETE')), 0,
  '11 · la aplicación no escribe evidencia, reembolsos ni respaldos: sólo las RPC');
SELECT public.chk(
  (SELECT count(*) FROM storage.buckets b WHERE b.id = 'ajustes-respaldos' AND NOT b.public), 1,
  '11 · el bucket de respaldos es privado');
SELECT public.chk(
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname LIKE 'ajustes_respaldos%'
      AND p.cmd IN ('UPDATE','DELETE','ALL')), 0,
  '11 · sin políticas de UPDATE/DELETE: un respaldo no se reemplaza ni se borra');

-- Mora de QA: tiene devengo propio.
UPDATE public.cuotas_condominio SET mora_monto = 5 WHERE id = :QA;
SELECT public.chk_txt(public.aj_cuota(:QA), 'emitida/2/0/-', '11 · QA emitida con devengo y mora vivos');

-- ── 12 · anular cuota: atajos cerrados ─────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET cuota_estado = 'anulada', anulada_at = now() WHERE id = 'c9a00000-0000-0000-0000-00000000000e'$$,
  'CUOTA_ANULACION_SOLO_POR_SOLICITUD', '12 · anular una cuota por UPDATE (la ruta anterior de la pantalla): rechazado');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-00000000000e'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · eliminar (suave) una cuota emitida: rechazado');
RESET ROLE;
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET cuota_estado = 'anulada' WHERE id = 'c9a00000-0000-0000-0000-00000000000e'$$,
  'CUOTA_ANULACION_SOLO_POR_SOLICITUD', '12 · …ni siquiera sin la RLS: el guard está en la tabla');
SELECT public.chk_falla($$DELETE FROM public.cuotas_condominio WHERE id = 'c9a00000-0000-0000-0000-00000000000e'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · borrar (duro) una cuota emitida: rechazado');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET anulada_at = now() WHERE id = 'c9a00000-0000-0000-0000-00000000000e'$$,
  'CUOTA_FECHA_ANULACION_FIJA', '12 · poner una fecha de anulación a mano: rechazado');
SELECT public.chk_txt(public.aj_cuota(:QE), 'emitida/1/0/-', '12 · QE intacta');
-- E7 (20261014000000): 'pendiente' NO es «sin emitir». QF2 está 'pendiente'
-- y ya es una cuenta por cobrar: devengo vivo, el residente la ve como deuda
-- y figura en el estado de cuenta.
SELECT public.chk_txt(public.aj_cuota('c9a00000-0000-0000-0000-000000000015'), 'pendiente/1/0/-',
  '12 · QF2 (pendiente, sin reserva) tiene su devengo contabilizado');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk(
  (SELECT count(*) FROM public.portal_documentos_con_saldo() d WHERE d.documento_id = 'c9a00000-0000-0000-0000-000000000015'), 1,
  '12 · …el residente la ve como deuda en el portal');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.sf_cxc_doc('cuotas_condominio', 'c9a00000-0000-0000-0000-000000000015')::text, '30.00',
  '12 · …y está en la cuenta por cobrar del libro (30)');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-000000000015'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · por eso eliminarla exige solicitud, aunque esté «pendiente» y sin dependencias');
RESET ROLE;
SELECT public.chk_falla($$DELETE FROM public.cuotas_condominio WHERE id = 'c9a00000-0000-0000-0000-000000000015'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · …tampoco con DELETE');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-000000000016'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · la tarifa de una reserva CONFIRMADA tampoco');
SELECT public.chk_txt(public.aj_cuota('c9a00000-0000-0000-0000-000000000015'), 'pendiente/1/0/-', '12 · QF2 intacta');
-- E7 (20261018000000): tampoco la tarifa de una reserva CANCELADA se borra;
-- se anula al cancelar la reserva (§23).
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-00000000000f'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · la tarifa de una reserva cancelada tampoco se elimina (E7: se anula)');
-- Una cuota eliminada ANTES de 20261018000000 (herencia), para §20: se
-- simula con el guard apagado explícitamente, sólo aquí.
ALTER TABLE public.cuotas_condominio DISABLE TRIGGER trg_cuota_solo_por_solicitud;
UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = :QF;
ALTER TABLE public.cuotas_condominio ENABLE TRIGGER trg_cuota_solo_por_solicitud;
SELECT public.chk_txt(public.aj_cuota(:QF), 'pendiente/0/0/eliminada', '12 · (herencia) QF eliminada antes de E7: su devengo se reversó');
-- Con un cobro vivo: tampoco, y nada en cascada.
SELECT public.chk_uuid(public.aj_cobro_cuota(:QG, 10, :KG), :KG, '12 · QG (sin emitir) recibe un cobro');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-000000000010'$$,
  'CUOTA_ELIMINACION_SOLO_POR_SOLICITUD', '12 · eliminar una cuota con un cobro vivo: rechazado, sin cascada');
SELECT public.chk_txt((SELECT p.estado FROM public.pagos p WHERE p.id = :KG), 'pendiente', '12 · el cobro sigue vivo');

-- ── 13 · permisos, aislamiento y dependencias ──────────────────────────────
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000ff', 'anular_cuota', 'cuotas_condominio', 'c9a00000-0000-0000-0000-00000000000a', 'SINT visor')$$,
  'No autorizado', '13 · el visor contable no solicita anular una cuota');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000fe', 'anular_cuota', 'cuotas_condominio', 'c9a00000-0000-0000-0000-00000000000a', 'SINT intruso')$$,
  'no está en tu ámbito', '13 · el admin de otra empresa: la cuota no existe para él');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_dependencias('anular_cuota', 'c9a00000-0000-0000-0000-00000000000a')$$,
  'no está en tu ámbito', '13 · …ni sus dependencias');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000fd', 'anular_cuota', 'cuotas_condominio', 'c9a00000-0000-0000-0000-0000000000b1', 'SINT ajena')$$,
  'no está en tu ámbito', '13 · la cuota de la otra empresa no existe para A');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000fc', 'anular_cuota', 'cargos_adicionales_unidad', 'ad000000-0000-0000-0000-000000000006', 'SINT tabla')$$,
  'no está en tu ámbito', '13 · anular_cuota sólo sobre cuotas');
-- QB con un cobro vivo: se informa al pedirlo.
SELECT public.chk_uuid(public.aj_cobro_cuota(:QB, 10, :KB), :KB, '13 · QB recibe un cobro');
SELECT public.chk_txt(
  (SELECT string_agg(d.dependencia || ':' || d.id, ',') FROM public.conta_ajuste_dependencias('anular_cuota', :QB) d),
  'cobro:' || 'cc0b0000-0000-0000-0000-00000000000b', '13 · dependencias de QB: su cobro');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-00000000000b', 'anular_cuota', 'cuotas_condominio', 'c9a00000-0000-0000-0000-00000000000b', 'SINT QB con cobro')$$,
  'AJUSTE_DEPENDENCIAS', '13 · pedir anular QB informa la dependencia y no crea la solicitud');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_ajustes_solicitudes s WHERE s.documento_id = :QB), 0,
  '13 · sin solicitud de QB');
SELECT public.chk_txt((SELECT p.estado FROM public.pagos p WHERE p.id = :KB), 'pendiente', '13 · el cobro no se anuló en cascada');
-- QC con una aplicación de saldo a favor viva.
SELECT public.sf_anticipo('f0000000-0000-0000-0000-00000000a001', :UNO, 20, :ANTC);
SELECT public.chk_txt(
  (SELECT r ->> 'estado_documento' FROM public.tst_ajuste('aplicar_saldo_favor', 'cuotas_condominio', :QC,
     'SINT aplicar a QC', public.sf_origen_id(:ANTC), 10) r),
  'emitida', '13 · se aplica saldo a favor a QC');
SELECT public.chk_txt(
  (SELECT string_agg(d.dependencia, ',') FROM public.conta_ajuste_dependencias('anular_cuota', :QC) d),
  'aplicacion_saldo_favor', '13 · dependencias de QC: la aplicación');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-00000000000c', 'anular_cuota', 'cuotas_condominio', 'c9a00000-0000-0000-0000-00000000000c', 'SINT QC con saldo')$$,
  'Solicita revertir la aplicación', '13 · pedir anular QC dice cómo resolverlo');
-- El contador (crea en contabilidad) sí solicita.
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TA, 'anular_cuota', 'cuotas_condominio', :QA, 'SINT QA emitida por error') r),
  'pendiente', '13 · el contador solicita anular QA');
SELECT public.chk_txt(public.aj_cuota(:QA), 'emitida/2/0/-', '13 · solicitar no cambia la cuota');

-- ── 14 · ejecución ─────────────────────────────────────────────────────────
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-00000000000a')$$,
  'No autorizado', '14 · el contador no aprueba');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-00000000000a')$$,
  'no está en tu ámbito', '14 · el admin de otra empresa no la ve');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TA), 'ejecutada', '14 · el aprobador aprueba y se ejecuta');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TA), 'ejecutada/repetida', '14 · aprobar otra vez no ejecuta de nuevo');
SELECT public.chk_txt(public.aj_cuota(:QA), 'anulada/0/1/hoy', '14 · QA anulada hoy, devengo y mora reversados, con evidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos r
     JOIN public.conta_asientos o ON o.id = r.reversa_de_id AND o.anulado_por_id = r.id
    WHERE r.origen_tabla = 'cuotas_condominio' AND r.origen_id = :QA
      AND r.origen_evento IN ('cuota_emitida_revertido','cuota_mora_revertido') AND r.estado = 'publicado'), 2,
  '14 · dos reversos VINCULADOS a sus originales (que siguen publicados, sin sobrescribir)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_cuota_anulaciones an
    WHERE an.cuota_id = :QA AND an.solicitud_id = :TA AND an.anulado_por = :APR AND an.tenia_asiento
      AND an.reverso_emision_id IS NOT NULL AND an.reverso_mora_id IS NOT NULL
      AND an.motivo = 'SINT QA emitida por error'), 1,
  '14 · evidencia: solicitud, aprobador, motivo y reversos');
SELECT public.chk_txt(public.aj_eventos(:TA), 'solicitada,aprobada,ejecutada', '14 · bitácora');
-- Efectos: estado de cuenta al corte, portal, saldo.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL, CURRENT_DATE - 1, 500, 0) f
    WHERE f.origen_id = :QA AND f.evento = 'cuota_emitida'), 1,
  '14 · al corte de ayer QA sigue figurando (corte histórico conservado)');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :UNO, NULL, CURRENT_DATE, 500, 0) f WHERE f.origen_id = :QA), 0,
  '14 · hoy QA ya no es un pendiente');
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk(
  (SELECT count(*) FROM public.portal_documentos_con_saldo() d WHERE d.documento_id = :QA), 0,
  '14 · el portal ya no la ofrece para pagar');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
-- Después de anulada: definitiva, sin cobros nuevos, fecha fija.
RESET ROLE;
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET cuota_estado = 'emitida' WHERE id = 'c9a00000-0000-0000-0000-00000000000a'$$,
  'CUOTA_ANULADA_DEFINITIVA', '14 · una cuota anulada no se reactiva');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET anulada_at = now() - interval '30 days' WHERE id = 'c9a00000-0000-0000-0000-00000000000a'$$,
  'CUOTA_FECHA_ANULACION_FIJA', '14 · la fecha de anulación no se mueve (cortes históricos)');
SELECT public.chk_falla($$SELECT public.aj_cobro_cuota('c9a00000-0000-0000-0000-00000000000a', 5, 'cc0b0000-0000-0000-0000-00000000000a')$$,
  'COBRO_CUOTA_ANULADA', '14 · una cuota anulada no admite cobros');
SELECT public.chk_falla($$UPDATE public.conta_cuota_anulaciones SET motivo = 'otro' WHERE cuota_id = 'c9a00000-0000-0000-0000-00000000000a'$$,
  '', '14 · la evidencia es inmutable');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000aa', 'anular_cuota', 'cuotas_condominio', 'c9a00000-0000-0000-0000-00000000000a', 'SINT otra vez')$$,
  'ya está anulada', '14 · pedir anular una cuota ya anulada: rechazado');

-- ── 15 · fallo sin efectos parciales; período cerrado; reintento ──────────
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TD, 'anular_cuota', 'cuotas_condominio', :QD, 'SINT QD sin cobros al pedir') r),
  'pendiente', '15 · QD sin dependencias al pedirla');
RESET ROLE;
SELECT public.chk_uuid(public.aj_cobro_cuota(:QD, 10, :KD), :KD, '15 · …y un cobro llega antes de aprobar');
SET ROLE authenticated;
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TD), 'fallida/AJUSTE_DEPENDENCIAS', '15 · la aprobación revalida y falla');
SELECT public.chk_txt(public.aj_cuota(:QD), 'emitida/1/0/-', '15 · nada parcial: cuota viva, devengo vivo, sin evidencia');
SELECT public.chk_txt((SELECT p.estado FROM public.pagos p WHERE p.id = :KD), 'pendiente', '15 · el cobro no se tocó');
SELECT public.chk_txt(public.aj_rechazar_cobro(:KD), 'rechazado', '15 · se resuelve la dependencia por su camino');
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt((SELECT r.estado FROM public.conta_ajuste_reintentar(:TD) r), 'ejecutada', '15 · el reintento ejecuta');
SELECT public.chk_txt(public.aj_cuota(:QD), 'anulada/0/1/hoy', '15 · QD anulada');
-- Período de hoy cerrado.
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TH, 'anular_cuota', 'cuotas_condominio', :QH, 'SINT QH periodo') r),
  'pendiente', '15 · solicitud sobre QH');
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado)
VALUES (:A, :A1, to_char(CURRENT_DATE, 'YYYY-MM'), 'cerrado');
SET ROLE authenticated;
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TH), 'fallida/AJUSTE_PERIODO_CERRADO', '15 · período cerrado: fallida');
SELECT public.chk_txt(public.aj_cuota(:QH), 'emitida/1/0/-', '15 · nada escrito');
RESET ROLE;
DELETE FROM public.cierres_mensuales WHERE project_id = :A1 AND periodo = to_char(CURRENT_DATE, 'YYYY-MM');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt((SELECT r.estado FROM public.conta_ajuste_reintentar(:TH) r), 'ejecutada', '15 · reabierto, el reintento ejecuta');
SELECT public.chk_txt(public.aj_cuota(:QH), 'anulada/0/1/hoy', '15 · QH anulada');

-- ── 16 · cuatro ojos y autoaprobación ──────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000e0', 'anular_cuota', 'cuotas_condominio', :QE, 'SINT QE por el admin') r),
  'pendiente', '16 · el admin solicita anular QE');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-0000000000e0', NULL, true)$$,
  'AJUSTE_AUTOAPROBACION_NO_PERMITIDA', '16 · el admin no se autoaprueba ni confirmándolo');
SELECT set_config('request.jwt.claim.sub', :OWN, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TI, 'anular_cuota', 'cuotas_condominio', :QI, 'SINT QI por el dueño') r),
  'pendiente', '16 · el dueño solicita anular QI');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-000000000012')$$,
  'AJUSTE_AUTOAPROBACION_SIN_CONFIRMAR', '16 · el dueño sin confirmar: no');
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.autoaprobada FROM public.conta_ajuste_aprobar(:TI, NULL, true) r),
  'ejecutada/true', '16 · el dueño confirmándolo: ejecutada y marcada');
SELECT public.chk_txt(public.aj_eventos(:TI), 'solicitada,autoaprobada,ejecutada', '16 · bitácora: autoaprobada');

-- ── 17 · respaldo documental ───────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TJ, 'anular_cuota', 'cuotas_condominio', :QJ, 'SINT QJ con respaldo') r),
  'pendiente', '17 · solicitud de QJ');
SELECT public.chk_txt(public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/acta.pdf'),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/acta.pdf', '17 · quien solicitó sube el archivo');
SELECT public.chk_falla($$SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000ee/otro.pdf')$$,
  'row-level security', '17 · no se sube a una solicitud inexistente');
SELECT public.chk_falla($$SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/acta.pdf')$$,
  'row-level security', '17 · no se sube fuera de la carpeta de una solicitud');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/intruso.pdf')$$,
  'row-level security', '17 · otra empresa no sube a la solicitud de A');
SELECT public.chk(
  (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'ajustes-respaldos'), 0,
  '17 · otra empresa no ve los archivos de A');
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk(
  (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'ajustes-respaldos'), 0,
  '17 · un residente no ve los respaldos de contabilidad');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-0000000000f1', '5e0b0000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/no-subido.pdf')$$,
  'AJUSTE_RESPALDO_SIN_ARCHIVO', '17 · registrar un archivo que no está en storage: no');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-0000000000f2', '5e0b0000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-00000000000a/acta.pdf')$$,
  'AJUSTE_RESPALDO_RUTA', '17 · un archivo de otra solicitud no es respaldo de ésta');
SELECT public.chk_txt(
  (SELECT r.repetida::text FROM public.conta_ajuste_adjuntar_respaldo(:RJ1, :TJ,
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/acta.pdf', 'Acta de la asamblea',
     repeat('ab', 32)) r),
  'false', '17 · se registra el respaldo');
SELECT public.chk_txt(
  (SELECT r.repetida::text FROM public.conta_ajuste_adjuntar_respaldo(:RJ1, :TJ,
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/acta.pdf', 'Acta de la asamblea',
     repeat('ab', 32)) r),
  'true', '17 · registrarlo otra vez (reintento) devuelve el mismo');
SELECT public.chk_txt(
  (SELECT r.mime || '|' || r.tamano || '|' || r.etag || '|' || r.nombre_archivo FROM public.conta_ajustes_respaldos r WHERE r.id = :RJ1),
  'application/pdf|1234|etag-1|acta.pdf', '17 · metadatos tomados de storage');
SELECT public.chk_txt(public.aj_eventos(:TJ), 'solicitada,respaldo_adjuntado', '17 · la bitácora registra el adjunto (distinto del motivo)');
SELECT public.chk(public.filas_afectadas($$UPDATE storage.objects SET metadata = metadata || '{"eTag":"x"}' WHERE bucket_id = 'ajustes-respaldos'$$), 0,
  '17 · el archivo no se reemplaza (sin política de UPDATE)');
SELECT public.chk(public.filas_afectadas($$DELETE FROM storage.objects WHERE bucket_id = 'ajustes-respaldos'$$), 0,
  '17 · …ni se borra');
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk(
  (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'ajustes-respaldos'), 1,
  '17 · quien ve la solicitud en la empresa ve el archivo');
-- Aprobar: quien aprueba declara lo que revisó.
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-000000000013')$$,
  'AJUSTE_RESPALDOS_SIN_REVISAR', '17 · con respaldo, aprobar sin decir qué se revisó: no');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-000000000013', NULL, false, '{}')$$,
  'AJUSTE_RESPALDOS_CAMBIARON', '17 · revisó otra cosa (ninguno): no');
-- Llega un segundo archivo después de que el aprobador abrió la solicitud.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/anexo.pdf');
SELECT public.chk_txt(
  (SELECT r.repetida::text FROM public.conta_ajuste_adjuntar_respaldo(:RJ2, :TJ,
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/anexo.pdf') r),
  'false', '17 · un segundo respaldo');
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-000000000013', NULL, false, '{4e0b0000-0000-0000-0000-000000000001}')$$,
  'AJUSTE_RESPALDOS_CAMBIARON', '17 · aprobar con lo visto antes del segundo archivo: no');
-- Un archivo alterado en storage (por fuera de la aplicación).
RESET ROLE;
UPDATE storage.objects SET metadata = metadata || '{"eTag":"etag-alterado"}'
 WHERE name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/anexo.pdf';
SET ROLE authenticated;
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_aprobar('5e0b0000-0000-0000-0000-000000000013', NULL, false, '{4e0b0000-0000-0000-0000-000000000001,4e0b0000-0000-0000-0000-000000000002}')$$,
  'AJUSTE_RESPALDO_ALTERADO', '17 · un respaldo que cambió en storage: no se aprueba');
SELECT public.chk_txt(public.aj_cuota(:QJ), 'emitida/1/0/-', '17 · nada ejecutado');
RESET ROLE;
UPDATE storage.objects SET metadata = metadata || '{"eTag":"etag-1"}'
 WHERE name = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/anexo.pdf';
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_aprobar(:TJ, 'SINT visto el acta y el anexo', false,
     ARRAY['4e0b0000-0000-0000-0000-000000000002','4e0b0000-0000-0000-0000-000000000001']::uuid[]) r),
  'ejecutada', '17 · con los dos revisados (en cualquier orden): ejecutada');
SELECT public.chk_txt(
  (SELECT string_agg(e ->> 'id', ',' ORDER BY e ->> 'id') || '|' || count(*) FILTER (WHERE e ->> 'etag' = 'etag-1')
     FROM public.conta_ajustes_solicitudes s, jsonb_array_elements(s.respaldos_revisados) e WHERE s.id = :TJ),
  '4e0b0000-0000-0000-0000-000000000001,4e0b0000-0000-0000-0000-000000000002|2', '17 · queda la fotografía de lo revisado');
-- Después de aprobar no se agrega ni se cambia nada.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/tarde.pdf')$$,
  'row-level security', '17 · ya revisada: no se suben archivos');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-0000000000f3', '5e0b0000-0000-0000-0000-000000000013', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000013/acta.pdf')$$,
  'AJUSTE_RESPALDO_CERRADO', '17 · ya revisada: no se registran respaldos');
RESET ROLE;
SELECT public.chk_falla($$UPDATE public.conta_ajustes_respaldos SET descripcion = 'otra' WHERE id = '4e0b0000-0000-0000-0000-000000000001'$$,
  '', '17 · el registro del respaldo es inmutable');
SET ROLE authenticated;
-- Rechazar también deja la fotografía.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TK, 'anular_cuota', 'cuotas_condominio', :QK, 'SINT QK con respaldo') r),
  'pendiente', '17 · solicitud de QK');
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000014/soporte.pdf');
SELECT public.chk_txt(
  (SELECT r.repetida::text FROM public.conta_ajuste_adjuntar_respaldo(:RK1, :TK,
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-000000000014/soporte.pdf') r),
  'false', '17 · respaldo de QK');
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt((SELECT r.estado FROM public.conta_ajuste_rechazar(:TK, 'SINT el soporte no justifica') r),
  'rechazada', '17 · rechazada');
SELECT public.chk(
  (SELECT jsonb_array_length(s.respaldos_revisados) FROM public.conta_ajustes_solicitudes s WHERE s.id = :TK), 1,
  '17 · el rechazo deja la fotografía del respaldo revisado');
SELECT public.chk_txt(public.aj_cuota(:QK), 'emitida/1/0/-', '17 · QK sin cambios');

-- ── 18 · reembolsos parciales ──────────────────────────────────────────────
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.aj_aviso(:PP1, 'aprobado', 'webhook', 'evt-pp1-ok') ->> 'accion', 'conciliado',
  '18 · PP1 cobrado en línea (60)');
SELECT public.chk_txt(public.aj_reembolso(:PP1, 'evt-r1', 10) ->> 'accion', 'reembolso_parcial_registrado',
  '18 · primer reembolso parcial (acumulado 10)');
SELECT public.chk_txt(public.aj_reembolsos(:PP1), '1/10.00/10.00/1', '18 · un reembolso de 10 y su incidencia');
SELECT public.chk_txt(public.aj_pr(:PP1), 'succeeded/1/aplicado',
  '18 · la solicitud sigue cobrada y el cobro NO se rechazó');
SELECT public.chk_txt(public.aj_reembolso(:PP1, 'evt-r1', 10) ->> 'accion', 'duplicado', '18 · el mismo aviso otra vez: duplicado');
SELECT public.chk_txt(public.aj_reembolsos(:PP1), '1/10.00/10.00/1', '18 · …no suma nada');
SELECT public.chk_txt(public.aj_reembolso(:PP1, 'evt-r3', 25) ->> 'importe', '15.00',
  '18 · segundo reembolso: acumulado 25 → reembolso nuevo de 15');
SELECT public.chk_txt(public.aj_reembolso(:PP1, 'evt-r2', 18) ->> 'accion', 'reembolso_ya_contado',
  '18 · FUERA DE ORDEN: llega el acumulado 18 después del 25 → ya contado');
SELECT public.chk_txt(public.aj_reembolso(:PP1, 'evt-r3-reenvio', 25) ->> 'accion', 'reembolso_ya_contado',
  '18 · el mismo acumulado con otra clave: ya contado');
SELECT public.chk_txt(public.aj_reembolsos(:PP1), '2/25.00/25.00/2', '18 · dos reembolsos que suman el acumulado, dos incidencias');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e WHERE e.payment_request_id = :PP1 AND e.estado_informado = 'reembolso_parcial'), 4,
  '18 · los cuatro avisos distintos quedan como evidencia');
SELECT public.chk_txt(
  (SELECT r.moneda || '|' || r.fecha_proveedor || '|' || r.referencia_pago || '|' || r.reembolso_ref || '|' || r.clave_evento
     FROM public.pasarela_reembolsos r WHERE r.payment_request_id = :PP1 AND r.acumulado = 10),
  'GTQ|2026-09-20 10:00:00+00|ch_ad900000|re_evt-r1|evt-r1', '18 · se conserva lo informado por el proveedor');
SELECT public.chk_txt(
  (SELECT i.estado || '|' || i.monto || '|' || (i.pago_id IS NOT NULL) || '|' || (i.project_id = :A1)
     FROM public.conta_incidencias_conciliacion i JOIN public.pasarela_reembolsos r ON r.id = i.reembolso_id
    WHERE r.payment_request_id = :PP1 AND r.acumulado = 25),
  'abierta|15.00|true|true', '18 · incidencia abierta con el importe, el cobro y el proyecto');
SELECT public.chk_txt(public.aj_pr(:PP1), 'succeeded/1/aplicado', '18 · tras los parciales, el cobro sigue aplicado');
-- El total llega después: ése sí rechaza; un parcial tardío no abre otra.
SELECT public.chk_txt(public.aj_aviso(:PP1, 'reembolsado', 'webhook', 'evt-total') ->> 'accion', 'cobro_rechazado',
  '18 · el reembolso TOTAL rechaza el cobro');
SELECT public.chk_txt(public.aj_reembolso(:PP1, 'evt-r4', 40) ->> 'accion', 'reembolso_parcial_tras_total',
  '18 · un parcial que llega tras el total se conserva');
SELECT public.chk_txt(public.aj_reembolsos(:PP1), '3/40.00/40.00/2', '18 · …sin otra incidencia');
-- Reembolso parcial ANTES de la confirmación del cobro.
SELECT public.chk_txt(public.aj_reembolso(:PP2, 'evt-pp2-r', 5) ->> 'accion', 'reembolso_parcial_registrado',
  '18 · parcial de una solicitud todavía pendiente: se conserva');
SELECT public.chk_txt(
  (SELECT i.detalle LIKE '%está pending%' FROM public.conta_incidencias_conciliacion i
     WHERE i.payment_request_id = :PP2 AND i.tipo = 'reembolso_parcial')::text,
  'true', '18 · la incidencia dice que llegó antes de la confirmación');
SELECT public.chk_txt(public.aj_aviso(:PP2, 'aprobado', 'webhook', 'evt-pp2-ok') ->> 'accion', 'conciliado',
  '18 · la confirmación posterior concilia normalmente');
SELECT public.chk_txt(public.aj_reembolso(:PP2, 'evt-pp2-r2', 55) ->> 'accion', 'reembolso_parcial_registrado',
  '18 · un acumulado mayor que lo cobrado se registra…');
SELECT public.chk_txt(
  (SELECT (i.detalle LIKE '%SUPERA EL IMPORTE COBRADO%')::text FROM public.conta_incidencias_conciliacion i
     JOIN public.pasarela_reembolsos r ON r.id = i.reembolso_id WHERE r.payment_request_id = :PP2 AND r.acumulado = 55),
  'true', '18 · …y la incidencia lo advierte');
SELECT public.chk_falla($$SELECT public.pasarela_registrar_reembolso_parcial('ad900000-0000-0000-0000-000000000041', 'webhook', 'evt-x', 5, 'GTQ', now(), 'ch')$$,
  'permission denied', '18 · la aplicación no registra reembolsos');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_reembolsos r WHERE r.company_id = :A), 0,
  '18 · la otra empresa no ve los reembolsos de A');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_reembolsos r WHERE r.payment_request_id = :PP1), 3,
  '18 · contabilidad de A sí los ve');

-- ── 19 · el estado de cuenta sigue cuadrando ───────────────────────────────
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') || '|' || (c->'saldo_a_favor'->>'cuadra')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true|true', '19 · conciliación de Uno tras anular cuotas y reembolsos');
RESET ROLE;

-- ── 20 · confirmación tardía de un cobro sobre una cuota anulada ──────────
-- El cobro en línea de QL quedó 'failed' (no bloquea la anulación) y QL se
-- anula. Después el proveedor confirma que SÍ cobró.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar(:TL, 'anular_cuota', 'cuotas_condominio', :QL, 'SINT QL emitida por error') r),
  'pendiente', '20 · con el cobro en línea fallido, QL se puede solicitar anular');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TL), 'ejecutada', '20 · QL anulada');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.aj_aviso(:PQ1, 'aprobado', 'webhook', 'evt-ql1') ->> 'accion', 'cobro_sobre_documento_anulado',
  '20 · la confirmación tardía NO falla: se registra');
SELECT public.chk_txt(public.aj_pr(:PQ1), 'pending_verification/0/-',
  '20 · sin pago ni acreditación; la solicitud queda en verificación (no se pierde)');
SELECT public.chk_txt(public.aj_cuota(:QL), 'anulada/0/1/hoy', '20 · la cuota sigue anulada, sin devengo vivo');
SELECT public.chk_txt(public.aj_incidencias(:PQ1), 'cobro_sobre_documento_anulado:abierta', '20 · UNA incidencia abierta');
SELECT public.chk_txt(
  (SELECT (i.detalle LIKE '%ANULADA%') || '|' || i.monto || '|' || (i.project_id = :A1) || '|' || (i.pago_id IS NULL)
          || '|' || (i.evento_id = e.id)
     FROM public.conta_incidencias_conciliacion i
     JOIN public.pasarela_eventos e ON e.payment_request_id = i.payment_request_id AND e.clave_evento = 'evt-ql1'
    WHERE i.payment_request_id = :PQ1),
  'true|30.00|true|true|true', '20 · la incidencia dice qué pasó, cuánto, dónde y enlaza el aviso');
SELECT public.chk_txt(
  (SELECT e.estado_previo || '>' || e.estado_resultante || '|' || e.resultado
     FROM public.pasarela_eventos e WHERE e.payment_request_id = :PQ1 AND e.clave_evento = 'evt-ql1'),
  'failed>pending_verification|cobro_sobre_documento_anulado', '20 · el aviso del proveedor se conserva');
-- Duplicados: la misma clave, otra clave, la consulta del servidor.
SELECT public.chk_txt(public.aj_aviso(:PQ1, 'aprobado', 'webhook', 'evt-ql1') ->> 'accion', 'duplicado',
  '20 · el mismo aviso otra vez: duplicado');
SELECT public.chk_txt(public.aj_aviso(:PQ1, 'aprobado', 'webhook', 'evt-ql1-reenvio') ->> 'accion', 'cobro_retenido_ya_registrado',
  '20 · otro aviso «aprobado» con otra clave: sólo su evento');
SELECT public.chk_txt(public.aj_aviso(:PQ1, 'aprobado', 'consulta', NULL) ->> 'accion', 'cobro_retenido_ya_registrado',
  '20 · la consulta del servidor: igual');
SELECT public.chk_txt(public.aj_pr(:PQ1) || '|' || public.aj_incidencias(:PQ1), 'pending_verification/0/-|cobro_sobre_documento_anulado:abierta',
  '20 · …sin pago y sin otra incidencia');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e WHERE e.payment_request_id = :PQ1), 3,
  '20 · tres avisos distintos, tres eventos');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cuota_id = :QL OR p.payment_request_id = :PQ1), 0,
  '20 · ningún pago: ni sobre la cuota ni convertido a otra cosa');
-- Un «rechazado» fuera de orden no esconde el dinero cobrado.
SELECT public.chk_txt(public.aj_aviso(:PQ1, 'rechazado', 'webhook', 'evt-ql1-rech') ->> 'accion', 'ignorado_fuera_de_orden',
  '20 · un rechazo posterior no la pasa a failed');
SELECT public.chk_txt(public.aj_pr(:PQ1), 'pending_verification/0/-', '20 · …sigue en verificación');
-- La aplicación no puede tocar la incidencia ni el evento.
SELECT public.chk_falla($$DELETE FROM public.conta_incidencias_conciliacion WHERE payment_request_id = 'ad900000-0000-0000-0000-0000000000a1'$$,
  'permission denied', '20 · la incidencia no se borra desde la aplicación');
SELECT public.chk_falla($$SELECT public.pasarela_registrar_estado('ad900000-0000-0000-0000-0000000000a1', 'aprobado', 'webhook', 'x2', NULL, NULL, NULL)$$,
  'permission denied', '20 · la aplicación no registra avisos');
-- Visible para contabilidad de A, invisible para otra empresa.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_incidencias_conciliacion i
    WHERE i.payment_request_id = :PQ1 AND i.tipo = 'cobro_sobre_documento_anulado'), 1,
  '20 · contabilidad de A la ve');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk(
  (SELECT count(*) FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = :PQ1), 0,
  '20 · la otra empresa no');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
-- El proveedor devuelve el dinero (lo decidió una persona): sin contabilidad que revertir.
SELECT public.chk_txt(public.aj_aviso(:PQ1, 'reembolsado', 'webhook', 'evt-ql1-ref') ->> 'accion', 'reembolso_de_cobro_retenido',
  '20 · reembolso del cobro retenido');
SELECT public.chk_txt(public.aj_pr(:PQ1) || '|' || public.aj_incidencias(:PQ1), 'refunded/0/-|cobro_sobre_documento_anulado:abierta',
  '20 · reembolsada, sin pago, la incidencia sigue abierta hasta que alguien la resuelva');
-- Cuota ELIMINADA (QF, tarifa de reserva cancelada, §12) con un cobro fallido.
SELECT public.chk_txt(public.aj_aviso(:PQ5, 'aprobado', 'webhook', 'evt-qf') ->> 'accion', 'cobro_sobre_documento_anulado',
  '20 · confirmación tardía sobre una cuota eliminada: tampoco falla');
SELECT public.chk_txt(public.aj_pr(:PQ5) || '|' ||
  (SELECT (i.detalle LIKE '%ELIMINADA%')::text FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = :PQ5),
  'pending_verification/0/-|true', '20 · …sin pago, con la incidencia que lo dice');
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') || '|' || (c->'saldo_a_favor'->>'cuadra')
     FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true|true', '20 · el estado de cuenta sigue cuadrando');
RESET ROLE;

-- ── 21 · reembolso total antes de aprobar; respuesta = estado persistido ───
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
-- Reembolso total de una solicitud PENDIENTE, y después la aprobación atrasada.
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'estado') || '|' || (r ->> 'conciliado') || '|' || (r ->> 'reembolsado')
     FROM public.aj_aviso(:PR6, 'reembolsado', 'webhook', 'evt-qr-ref') r),
  'reembolso_antes_de_aprobar|refunded|false|true', '21 · reembolso total de una pendiente: queda reembolsada');
SELECT public.chk_txt(public.aj_pr(:PR6) || '|' || public.aj_incidencias(:PR6), 'refunded/0/-|reembolso_sin_cobro:abierta',
  '21 · sin pago que reversar; el rastro queda en la incidencia');
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'conciliado') || '|' || (r ? 'pago_id') || '|' || (r ? 'saldo_restante')
     FROM public.aj_aviso(:PR6, 'aprobado', 'webhook', 'evt-qr-ok') r),
  'ignorado_reembolsado|false|false|false', '21 · la aprobación atrasada no concilia, sin pago ni saldo en la respuesta');
SELECT public.chk_txt(public.aj_pr(:PR6), 'refunded/0/-', '21 · ningún pago creado');
SELECT public.chk_txt(public.aj_cuota(:QR), 'emitida/1/0/-', '21 · la cuota no recibió ningún abono');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.cuota_id = :QR), 0, '21 · …ni sobre la cuota');
-- Duplicados: el mismo aviso, otra clave, la consulta.
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'conciliado') || '|' || (r ->> 'reembolsado')
     FROM public.aj_aviso(:PR6, 'aprobado', 'webhook', 'evt-qr-ok') r),
  'duplicado|false|true', '21 · el mismo «aprobado» otra vez: duplicado, sigue reembolsada');
SELECT public.chk_txt(public.aj_aviso(:PR6, 'aprobado', 'consulta', NULL) ->> 'accion', 'ignorado_reembolsado',
  '21 · otra clave (consulta): tampoco concilia…');
SELECT public.chk_txt(public.aj_aviso(:PR6, 'reembolsado', 'webhook', 'evt-qr-ref-2') ->> 'accion', 'sin_cambio',
  '21 · otro aviso de reembolso: sin cambio');
SELECT public.chk_txt(public.aj_pr(:PR6) || '|' || public.aj_incidencias(:PR6),
  'refunded/0/-|reembolso_sin_cobro:abierta,aprobado_tras_reembolso:abierta',
  '21 · …y UNA sola incidencia «aprobado tras reembolso»');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e WHERE e.payment_request_id = :PR6), 4,
  '21 · cada aviso distinto queda como evento (4; el duplicado no)');
SELECT public.chk_falla($$SELECT public.aj_pr_conciliar('ad900000-0000-0000-0000-0000000000a6')$$,
  'PAGO_REEMBOLSADO', '21 · conciliar directo también la rechaza');
-- Lo mismo desde FALLIDA.
SELECT public.chk_txt(public.aj_aviso(:PR7, 'reembolsado', 'webhook', 'evt-qs-ref') ->> 'accion', 'reembolso_antes_de_aprobar',
  '21 · reembolso total de una fallida');
SELECT public.chk_txt(public.aj_aviso(:PR7, 'aprobado', 'webhook', 'evt-qs-ok') ->> 'conciliado', 'false',
  '21 · su aprobación atrasada tampoco concilia');
SELECT public.chk_txt(public.aj_pr(:PR7) || '|' || public.aj_cuota(:QS), 'refunded/0/-|emitida/1/0/-',
  '21 · sin pago ni abono');
-- Dos consultas consecutivas de un cobro retenido (QF eliminada, §20): ambas en revisión.
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'en_revision') || '|' || (r ->> 'conciliado') || '|' || (r ? 'saldo_restante')
     FROM public.aj_aviso(:PQ5, 'aprobado', 'consulta', NULL) r),
  'cobro_retenido_ya_registrado|true|false|false', '21 · 1.ª consulta del cobro retenido: en revisión');
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'en_revision') || '|' || (r ->> 'conciliado') || '|' || (r ? 'saldo_restante') || '|' || (r ? 'pago_id')
     FROM public.aj_aviso(:PQ5, 'aprobado', 'consulta', NULL) r),
  'duplicado|true|false|false|false', '21 · 2.ª consulta (duplicada): sigue en revisión, sin saldo ni pago');
SELECT public.chk_txt(public.aj_pr(:PQ5), 'pending_verification/0/-', '21 · …y sin pago');
-- Un cobro válido sigue conciliando y su duplicado lo informa como conciliado.
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'conciliado') || '|' || (r ->> 'estado')
     FROM public.aj_aviso(:PP1, 'aprobado', 'webhook', 'evt-pp1-ok') r),
  'duplicado|false|refunded', '21 · PP1 (reembolsado total en §18): su duplicado no se presenta como conciliado');
SELECT public.chk_txt(
  (SELECT (r ->> 'accion') || '|' || (r ->> 'conciliado') || '|' || (r ? 'pago_id') || '|' || (r ? 'saldo_restante')
     FROM public.aj_aviso(:PP2, 'aprobado', 'webhook', 'evt-pp2-ok') r),
  'duplicado|true|true|true', '21 · PP2 (cobrado, con reembolsos parciales): su duplicado sí es conciliado, con pago y saldo');
SELECT public.chk_txt(public.aj_pr(:PP2), 'succeeded/1/aplicado', '21 · el reembolso parcial no cambió el cobro');
RESET ROLE;

-- ── 22 · E6: rebaja de importe (nota de crédito) ───────────────────────────
SET ROLE authenticated;
-- Permisos y aislamiento.
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f1', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', 10, 'SINT visor')$$,
  'No autorizado', '22 · el visor contable no solicita rebajas');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f2', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', 10, 'SINT intruso')$$,
  'no está en tu ámbito', '22 · otra empresa: la cuota no existe para ella');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
-- Validaciones al solicitar: sólo rebajas, con tope.
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f3', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', -10, 'SINT aumento')$$,
  'AJUSTE_IMPORTE', '22 · (b) un aumento no se admite: sólo rebajas');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f4', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'cargo', 10, 'SINT componente')$$,
  'AJUSTE_COMPONENTE', '22 · una cuota se rebaja en principal o mora');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f5', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', 100.01, 'SINT excede')$$,
  'AJUSTE_REBAJA_EXCEDE_SALDO', '22 · (c) no más que el saldo pendiente');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f6', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'mora', 1, 'SINT sin mora')$$,
  'AJUSTE_DEVENGO_PENDIENTE', '22 · sin mora devengada no hay mora que rebajar');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar('5e0b0000-0000-0000-0000-0000000000f7', 'ajuste_importe', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'SINT por la otra vía')$$,
  'AJUSTE_TIPO', '22 · la rebaja sólo se pide por su RPC (con componente e importe)');
-- Solicitar: no cambia nada; idempotente; una abierta por documento.
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.repetida FROM public.conta_ajuste_solicitar_rebaja(:TW1, 'cuotas_condominio', :QW1, 'principal', 30, 'SINT QW1 descuento por obra') r),
  'pendiente/false', '22 · el contador solicita rebajar 30 de QW1');
SELECT public.chk_txt(
  (SELECT r.estado || '/' || r.repetida FROM public.conta_ajuste_solicitar_rebaja(:TW1, 'cuotas_condominio', :QW1, 'principal', 30, 'SINT QW1 descuento por obra') r),
  'pendiente/true', '22 · la misma clave y los mismos datos: la misma solicitud');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-000000000031', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', 31, 'SINT QW1 descuento por obra')$$,
  'AJUSTE_CLAVE_REUSADA', '22 · la misma clave con otro importe: rechazada');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f8', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', 5, 'SINT segunda abierta')$$,
  'AJUSTE_YA_SOLICITADO', '22 · una rebaja abierta por documento');
SELECT public.chk_txt(public.aj_rebaja_saldo('cuotas_condominio', :QW1, 'principal')::text, '100.00', '22 · solicitar no cambia el saldo');
-- Aprobar exige el permiso de autorizar (los cuatro ojos los prueba §16 para
-- todo tipo de solicitud).
SELECT public.chk_falla($$SELECT public.aj_aprobar_como('a0a0a0a0-0000-0000-0000-00000000000c', '5e0b0000-0000-0000-0000-000000000031')$$,
  'No autorizado', '22 · el contador que la pidió no puede aprobarla');
-- (a) Sin la cuenta especial no se ejecuta: fallida, nada escrito.
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TW1), 'fallida/CONTA_CONFIG_INCOMPLETA',
  '22 · sin cuenta de ajustes y bonificaciones: fallida');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_notas_credito n WHERE n.cuota_id = :QW1), 0, '22 · …sin nota');
SELECT public.chk_txt(public.aj_rebaja_saldo('cuotas_condominio', :QW1, 'principal')::text, '100.00', '22 · …ni saldo cambiado');
RESET ROLE;
INSERT INTO public.conta_mapeo_cuentas (company_id, project_id, evento, cuenta_id)
VALUES (:A, :A1, 'ajustes_bonificaciones', :AJB);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt((SELECT r.estado FROM public.conta_ajuste_reintentar(:TW1) r), 'ejecutada',
  '22 · configurada la cuenta, el reintento ejecuta');
SELECT public.chk_txt(public.aj_nota(:TW1), '30.00/100.00/principal/' || :APR,
  '22 · nota: importe, saldo antes, componente y quién aprobó');
SELECT public.chk_txt(public.aj_nota_lineas(:TW1),
  'publicado|' || CURRENT_DATE || '|AJ-BONIF:D30.00:x:u:-,1-CXC-RES:H30.00:x:u:mantenimiento',
  '22 · asiento de hoy: cargo a ajustes, abono a la CxC del devengo con su dimensión');
SELECT public.chk_txt(public.aj_rebaja_saldo('cuotas_condominio', :QW1, 'principal')::text, '70.00', '22 · saldo neto 70');
RESET ROLE;
SELECT public.chk_txt(public.aj_cuota(:QW1) || '|' || (SELECT c.monto FROM public.cuotas_condominio c WHERE c.id = :QW1),
  'emitida/1/0/-|100.00', '22 · el devengo y el importe del documento no se tocan');
SET ROLE authenticated;
SELECT public.chk_txt(public.aj_eventos(:TW1), 'solicitada,aprobada,fallida,reintento,ejecutada', '22 · bitácora completa');
SELECT public.chk_falla($$UPDATE public.conta_notas_credito SET monto = 1 WHERE cuota_id = 'c9a00000-0000-0000-0000-000000000031'$$,
  'permission denied', '22 · la aplicación no toca la nota');
RESET ROLE;
SELECT public.chk_falla($$UPDATE public.conta_notas_credito SET monto = 1 WHERE cuota_id = 'c9a00000-0000-0000-0000-000000000031'$$,
  '', '22 · la nota es inmutable');
SET ROLE authenticated;
-- Visible: estado de cuenta, conciliación, portal.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk(
  (SELECT count(*) FROM jsonb_array_elements(public.conta_estado_cuenta(:A1, :UNO, NULL, NULL, NULL, 500, 0) -> 'movimientos') m
    WHERE m ->> 'documento' LIKE 'Nota de crédito · cuota SINT QW1%' AND (m ->> 'abono')::numeric = 30
      AND m ->> 'componente' = 'principal' AND m ->> 'cuota_id' = 'c9a00000-0000-0000-0000-000000000031'), 1,
  '22 · el estado de cuenta muestra la nota como abono a la cuota');
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true', '22 · la conciliación cuadra con la nota');
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk_txt(
  (SELECT d.saldo::text FROM public.portal_documentos_con_saldo() d WHERE d.documento_id = :QW1), '70.00',
  '22 · el residente ve el saldo neto');
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_rebaja('5e0b0000-0000-0000-0000-0000000000f9', 'cuotas_condominio', 'c9a00000-0000-0000-0000-000000000031', 'principal', 70.01, 'SINT tope nuevo')$$,
  'AJUSTE_REBAJA_EXCEDE_SALDO', '22 · la siguiente rebaja ya topa en 70');
-- Una nota viva impide anular la cuota (sin cascada).
SELECT public.chk_txt(
  (SELECT string_agg(d.dependencia, ',') FROM public.conta_ajuste_dependencias('anular_cuota', :QW1) d),
  'nota_credito', '22 · dependencia: la nota de crédito');
-- Un cobro posterior: sólo 70 a la CxC, 30 a favor.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:KW1, :UNO, :A1, :QW1, 100, 'efectivo', 'verificado', now());
RESET ROLE;
SELECT public.chk_txt(
  (SELECT string_agg(ap.evento || ':' || ap.monto, ',') FROM public.conta_cobro_aplicaciones ap WHERE ap.pago_id = :KW1),
  'cuota_emitida:70.00', '22 · el cobro aplica a la CxC sólo el saldo neto');
SELECT public.chk_txt(public.sf_origen(:KW1), 'excedente:30.00:30.00', '22 · el resto queda como saldo a favor');
SELECT public.chk_txt(public.aj_cuota_neto(:QW1)::text, '0.00', '22 · la CxC de la cuota queda en 0, nunca negativa');
SELECT public.chk_txt((SELECT c.cuota_estado FROM public.cuotas_condominio c WHERE c.id = :QW1), 'pagada', '22 · cuota pagada');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true', '22 · la conciliación sigue cuadrando tras el cobro');
-- Mora: se rebaja la mora devengada.
RESET ROLE;
UPDATE public.cuotas_condominio SET mora_monto = 5 WHERE id = :QW2;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :CONT, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar_rebaja(:TW2, 'cuotas_condominio', :QW2, 'mora', 5, 'SINT QW2 condonar mora') r),
  'pendiente', '22 · solicitar condonar la mora de QW2');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TW2), 'ejecutada', '22 · aprobada');
SELECT public.chk_txt(public.aj_rebaja_saldo('cuotas_condominio', :QW2, 'mora') || '|' || public.aj_rebaja_saldo('cuotas_condominio', :QW2, 'principal'),
  '0.00|40.00', '22 · mora en 0, principal intacto');
-- Cargo adicional.
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar_rebaja(:TC1, 'cargos_adicionales_unidad', :CW, 'cargo', 20, 'SINT CW rebaja parcial') r),
  'pendiente', '22 · solicitar rebajar 20 del cargo');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TC1), 'ejecutada', '22 · aprobada');
SELECT public.chk_txt(public.aj_rebaja_saldo('cargos_adicionales_unidad', :CW, 'cargo')::text || '|' || public.aj_cargo(:CW),
  '30.00|pendiente/1/0', '22 · cargo: saldo 30, sigue pendiente, devengo intacto');
SELECT public.chk_txt(
  (SELECT string_agg(d.dependencia, ',') FROM public.conta_ajuste_dependencias('anular_cargo', :CW) d),
  'nota_credito', '22 · la nota impide anular el cargo');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar_rebaja(:TC2, 'cargos_adicionales_unidad', :CW, 'cargo', 30, 'SINT CW rebaja del resto') r),
  'pendiente', '22 · solicitar rebajar el resto');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TC2), 'ejecutada', '22 · aprobada');
SELECT public.chk_txt(public.aj_rebaja_saldo('cargos_adicionales_unidad', :CW, 'cargo')::text || '|' || public.aj_cargo(:CW),
  '0.00|pagado/1/0', '22 · cargo en 0: su estado derivado es pagado');
-- (d) La mora posterior se calcula sobre el NETO, en los dos modos.
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar_rebaja(:TW4, 'cuotas_condominio', :QW4, 'principal', 40, 'SINT QW4 rebaja antes de mora') r),
  'pendiente', '22 · QW4: rebaja 40');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TW4), 'ejecutada', '22 · aprobada');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar_rebaja(:TW5, 'cuotas_condominio', :QW5, 'principal', 40, 'SINT QW5 rebaja antes de mora') r),
  'pendiente', '22 · QW5: rebaja 40');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, :TW5), 'ejecutada', '22 · aprobada');
RESET ROLE;
UPDATE public.cuotas_condominio SET cuota_estado = 'vencida', emitida_at = now() - interval '40 days' WHERE id = :QW4;
INSERT INTO public.reglas_mora_config (company_id, project_id, nombre, dias_vencimiento, tipo, valor, aplicar_sobre, periodo_gracia, activa, created_at)
VALUES (:A, :A1, 'SINT 10% sobre el monto', 0, 'porcentaje', 10, 'monto_cuota', 0, true, now() - interval '1 minute');
SELECT public.conta_aplicar_mora_cuotas();
SELECT public.chk_txt((SELECT c.mora_monto::text FROM public.cuotas_condominio c WHERE c.id = :QW4), '6.00',
  '22 · (d) monto_cuota: 10% de 60 (100 − rebaja 40), no de 100');
-- saldo_vencido: QW5 vence ahora, con la regla nueva.
UPDATE public.reglas_mora_config SET activa = false WHERE project_id = :A1 AND nombre LIKE 'SINT %';
INSERT INTO public.reglas_mora_config (company_id, project_id, nombre, dias_vencimiento, tipo, valor, aplicar_sobre, periodo_gracia, activa)
VALUES (:A, :A1, 'SINT 10% sobre el saldo', 0, 'porcentaje', 10, 'saldo_vencido', 0, true);
UPDATE public.cuotas_condominio SET cuota_estado = 'vencida', emitida_at = now() - interval '40 days' WHERE id = :QW5;
SELECT public.conta_aplicar_mora_cuotas();
SELECT public.chk_txt((SELECT c.mora_monto::text FROM public.cuotas_condominio c WHERE c.id = :QW5), '6.00',
  '22 · (d) saldo_vencido: 10% de 60 (saldo neto de la rebaja)');
UPDATE public.reglas_mora_config SET activa = false WHERE project_id = :A1 AND nombre LIKE 'SINT %';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true', '22 · todo sigue cuadrando');
RESET ROLE;

-- ── 23 · E7: cancelar la reserva anula su tarifa ───────────────────────────
SET ROLE authenticated;
-- Permisos y aislamiento.
SELECT set_config('request.jwt.claim.sub', :RUNO, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_reserva_cancelar('a3e00000-0000-0000-0000-000000000101')$$,
  'No autorizado', '23 · un residente no cancela por esta vía');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_reserva_cancelar('a3e00000-0000-0000-0000-000000000101')$$,
  'no existe', '23 · otra empresa: la reserva no existe para ella');
-- Cancelar: reserva cancelada, tarifa ANULADA con reverso y evidencia.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.tarifa FROM public.conta_reserva_cancelar(:RV1, 'SINT el residente desistió') r),
  'anulada', '23 · cancelar la reserva anula su tarifa');
RESET ROLE;
SELECT public.chk_txt((SELECT r.estado FROM public.reservas_amenidades r WHERE r.id = :RV1), 'cancelada', '23 · la reserva quedó cancelada');
SELECT public.chk_txt(public.aj_cuota(:QR1), 'anulada/0/1/hoy', '23 · tarifa anulada hoy, devengo reversado, con evidencia (no se borró)');
SELECT public.chk_txt(
  (SELECT s.canal || '|' || s.estado || '|' || s.autoaprobada || '|' || (s.revisado_por = s.solicitado_por) || '|' || (s.reserva_id = :RV1)
     FROM public.conta_ajustes_solicitudes s WHERE s.documento_id = :QR1),
  'reserva_cancelada|ejecutada|false|true|true', '23 · solicitud del canal reserva_cancelada, ejecutada, sin marca de autoaprobación');
SELECT public.chk_txt(public.aj_eventos((SELECT s.id FROM public.conta_ajustes_solicitudes s WHERE s.documento_id = :QR1)),
  'solicitada,aprobada,ejecutada', '23 · bitácora: autorizada por la cancelación');
SELECT public.chk_txt(
  (SELECT (an.motivo LIKE 'Reserva cancelada (2026-10-20): SINT el residente desistió') || '|' || (an.reverso_emision_id IS NOT NULL)
     FROM public.conta_cuota_anulaciones an WHERE an.cuota_id = :QR1),
  'true|true', '23 · evidencia con la reserva, el motivo y el reverso');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt((SELECT r.tarifa FROM public.conta_reserva_cancelar(:RV1) r), 'ya_anulada', '23 · repetirlo no anula otra vez');
-- Con un cobro: la reserva se cancela, la tarifa NO (pasa por solicitud).
RESET ROLE;
SELECT public.chk_uuid(public.aj_cobro_cuota(:QR2, 25, 'cc0b0000-0000-0000-0000-000000000042'), 'cc0b0000-0000-0000-0000-000000000042', '23 · QR2 recibe un cobro');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.tarifa || '|' || (r.detalle LIKE '%Cobro%') FROM public.conta_reserva_cancelar(:RV2) r),
  'requiere_solicitud|true', '23 · con un cobro la tarifa queda vigente y se dice por qué');
RESET ROLE;
SELECT public.chk_txt((SELECT r.estado FROM public.reservas_amenidades r WHERE r.id = :RV2) || '|' || public.aj_cuota(:QR2),
  'cancelada|pendiente/1/0/-', '23 · reserva cancelada, tarifa intacta, sin cascada');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
-- Rechazo: exige motivo y lo guarda.
SELECT public.chk_falla($$SELECT * FROM public.conta_reserva_cancelar('a3e00000-0000-0000-0000-000000000103', NULL, true)$$,
  'RESERVA_MOTIVO', '23 · rechazar exige motivo');
SELECT public.chk_txt(
  (SELECT r.tarifa FROM public.conta_reserva_cancelar(:RV3, 'SINT salón ocupado', true) r),
  'anulada', '23 · rechazar también anula la tarifa (emitida)');
RESET ROLE;
SELECT public.chk_txt((SELECT r.estado || '|' || r.rechazada_motivo FROM public.reservas_amenidades r WHERE r.id = :RV3),
  'cancelada|SINT salón ocupado', '23 · reserva rechazada con su motivo');
SELECT public.chk_txt(public.aj_cuota(:QR3), 'anulada/0/1/hoy', '23 · tarifa emitida anulada con su reverso');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt((SELECT r.tarifa FROM public.conta_reserva_cancelar(:RV4) r), 'sin_tarifa', '23 · sin tarifa: sólo se cancela');
-- Período cerrado: reserva cancelada, solicitud fallida y reintentable.
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado)
VALUES (:A, :A1, to_char(CURRENT_DATE, 'YYYY-MM'), 'cerrado');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT r.tarifa || '|' || split_part(r.detalle, ':', 1) FROM public.conta_reserva_cancelar(:RV5) r),
  'fallida|AJUSTE_PERIODO_CERRADO', '23 · período cerrado: la anulación queda fallida');
RESET ROLE;
SELECT public.chk_txt((SELECT r.estado FROM public.reservas_amenidades r WHERE r.id = :RV5) || '|' || public.aj_cuota(:QR5),
  'cancelada|pendiente/1/0/-', '23 · la reserva sí se canceló; la tarifa sigue, sin efectos parciales');
DELETE FROM public.cierres_mensuales WHERE project_id = :A1 AND periodo = to_char(CURRENT_DATE, 'YYYY-MM');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :APR, false);
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_reintentar((SELECT s.id FROM public.conta_ajustes_solicitudes s WHERE s.documento_id = :QR5)) r),
  'ejecutada', '23 · reabierto, quien aprueba la reintenta');
RESET ROLE;
SELECT public.chk_txt(public.aj_cuota(:QR5), 'anulada/0/1/hoy', '23 · tarifa anulada');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(
  (SELECT (c->>'cuadra') FROM public.conta_estado_cuenta_conciliacion(:A1, :UNO, NULL, NULL) c),
  'true', '23 · el estado de cuenta sigue cuadrando');
RESET ROLE;

-- ── 24 · E8: cobros abandonados y resolución manual ────────────────────────
\set PB1 '''ad900000-0000-0000-0000-0000000000b1'''
\set PB2 '''ad900000-0000-0000-0000-0000000000b2'''
\set PB3 '''ad900000-0000-0000-0000-0000000000b3'''
\set PB4 '''ad900000-0000-0000-0000-0000000000b4'''
\set PB5 '''ad900000-0000-0000-0000-0000000000b5'''
\set PB6 '''ad900000-0000-0000-0000-0000000000b6'''
\set PB7 '''ad900000-0000-0000-0000-0000000000b7'''
\set QX1 '''c9a00000-0000-0000-0000-000000000051'''
\set QX2 '''c9a00000-0000-0000-0000-000000000052'''
\set QX3 '''c9a00000-0000-0000-0000-000000000053'''
\set QX4 '''c9a00000-0000-0000-0000-000000000054'''
\set SA1 '''5e0b0000-0000-0000-0000-0000000000a1'''
\set SA2 '''5e0b0000-0000-0000-0000-0000000000a2'''
\set SA3 '''5e0b0000-0000-0000-0000-0000000000a3'''
RESET ROLE;
SELECT public.chk(public.reconciliar_payment_requests_pendientes(), 2,
  '24 · el cron consulta PB2 (1 h) y PB3 (24 h); no a quienes ya llevan 2 consultas');
SELECT public.chk_txt(
  (SELECT pr.estado || '|' || pr.consultas_auto FROM public.payment_requests pr WHERE pr.id = :PB1),
  'failed|0', '24 · sin NINGUNA referencia tras 24 h: failed');
SELECT public.chk_txt(
  (SELECT pr.estado || '|' || pr.consultas_auto FROM public.payment_requests pr WHERE pr.id = :PB2),
  'pending|1', '24 · con referencia, 1.ª consulta: sigue pending');
SELECT public.chk_txt(
  (SELECT pr.estado || '|' || pr.consultas_auto FROM public.payment_requests pr WHERE pr.id = :PB3),
  'pending|2', '24 · con referencia, 2.ª consulta: sigue pending, NO se libera por antigüedad');
SELECT public.chk(
  (SELECT count(*) FROM public.payment_requests pr WHERE pr.id IN (:PB4, :PB5, :PB6, :PB7) AND pr.estado = 'pending'), 4,
  '24 · los de 26 h con 2 consultas siguen pending (nunca failed por edad)');
SELECT public.chk_txt(public.aj_incidencias(:PB4), 'cobro_sin_confirmar:abierta', '24 · incidencia visible tras las 2 consultas');
SELECT public.chk_txt(public.aj_incidencias(:PB2), '', '24 · sin incidencia mientras quedan consultas');
SELECT public.reconciliar_payment_requests_pendientes();
SELECT public.reconciliar_payment_requests_pendientes();
SELECT public.chk(
  (SELECT count(*) FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = :PB4 AND i.tipo = 'cobro_sin_confirmar'), 1,
  '24 · repetir el cron no duplica la incidencia');
SELECT public.chk_txt((SELECT pr.consultas_auto::text FROM public.payment_requests pr WHERE pr.id = :PB4), '2',
  '24 · el cron no vuelve a consultar al agotar las dos');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.aj_cuota(:QX1), 'emitida/1/0/-', '24 · QX1 sigue viva y su cobro la bloquea');
SELECT public.chk_falla($$SELECT public.aj_aviso('ad900000-0000-0000-0000-0000000000b4', 'aprobado', 'manual', 'manual:x')$$,
  '', '24 · origen manual rechazado fuera de la ejecución');
SELECT public.chk_txt(public.aj_pr(:PB4), 'pending/0/-', '24 · …y no hizo nada');
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000a1', 'ad900000-0000-0000-0000-0000000000b4', 'cobrado', 'SINT visitante')$$,
  'No autorizado', '24 · quien no puede solicitar ajustes, no solicita');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000a1', 'ad900000-0000-0000-0000-0000000000b4', 'cobrado', 'SINT otra empresa')$$,
  'no existe o no está en tu ámbito', '24 · otra empresa no ve el cobro');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000a1', 'ad900000-0000-0000-0000-0000000000b4', 'quizas', 'SINT resolución')$$,
  'AJUSTE_RESOLUCION', '24 · la resolución es cobrado o no_cobrado');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000a1', 'ad900000-0000-0000-0000-0000000000b4', 'cobrado', 'x')$$,
  'AJUSTE_MOTIVO', '24 · exige motivo');
SELECT public.chk_txt(
  (SELECT r.estado FROM public.conta_ajuste_solicitar_resolucion_cobro(:SA1, :PB4, 'cobrado', 'SINT el banco confirma el cargo') r),
  'pendiente', '24 · solicitud de resolución');
SELECT public.chk_txt(
  (SELECT r.repetida::text FROM public.conta_ajuste_solicitar_resolucion_cobro(:SA1, :PB4, 'cobrado', 'SINT el banco confirma el cargo') r),
  'true', '24 · idempotente por clave');
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000f9', 'ad900000-0000-0000-0000-0000000000b4', 'no_cobrado', 'SINT otra distinta')$$,
  'AJUSTE_YA_SOLICITADO', '24 · una sola solicitud abierta por cobro');
SELECT public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000a4', :PB7, 'no_cobrado', 'SINT sin respaldo');
SELECT public.chk_txt(public.aj_aprobar_como(:APR, '5e0b0000-0000-0000-0000-0000000000a4'), 'fallida/AJUSTE_RESPALDO_REQUERIDO', '24 · sin respaldo no se aprueba');
SELECT public.chk_txt(public.aj_pr(:PB7), 'pending/0/-', '24 · …y el cobro no cambió');
-- Con respaldo y por otra persona.
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000a1/estado-banco.pdf');
SELECT public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-0000000000a1', :SA1,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000a1/estado-banco.pdf', 'Estado del banco', repeat('cd', 32));
SELECT public.chk_falla($$SELECT public.aj_aprobar_con('a0a0a0a0-0000-0000-0000-00000000000a', '5e0b0000-0000-0000-0000-0000000000a1', '{4e0b0000-0000-0000-0000-0000000000a1}')$$,
  '', '24 · quien solicitó no aprueba (cuatro ojos)');
SELECT public.chk_txt(public.aj_aprobar_con(:APR, :SA1, '{4e0b0000-0000-0000-0000-0000000000a1}'), 'ejecutada', '24 · otra persona aprueba: se ejecuta');
RESET ROLE;
SELECT public.chk_txt(public.aj_pr(:PB4), 'succeeded/1/aplicado', '24 · «cobrado»: se acredita UN pago, como un aviso del proveedor');
SELECT public.chk_txt(public.aj_incidencias(:PB4), 'cobro_sin_confirmar:resuelta', '24 · la incidencia queda resuelta');
SELECT public.chk(
  (SELECT count(*) FROM public.pasarela_eventos e WHERE e.payment_request_id = :PB4 AND e.origen = 'manual'), 1,
  '24 · el aviso manual queda como evidencia (origen manual)');
-- No cobrado.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.conta_ajuste_solicitar_resolucion_cobro(:SA2, :PB5, 'no_cobrado', 'SINT el cliente canceló en el banco');
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000a2/carta.pdf');
SELECT public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-0000000000a2', :SA2,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000a2/carta.pdf', 'Carta del banco', repeat('ef', 32));
SELECT public.chk_falla(format($$SELECT * FROM public.conta_incidencia_resolver(%L, 'SINT descartar a mano')$$,
  (SELECT i.id FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = 'ad900000-0000-0000-0000-0000000000b5' AND i.tipo = 'cobro_sin_confirmar')),
  'INCIDENCIA_COBRO_PENDIENTE', '24 · la incidencia de un cobro pendiente no se descarta a mano');
SELECT public.chk_txt(public.aj_aprobar_con(:APR, :SA2, '{4e0b0000-0000-0000-0000-0000000000a2}'), 'ejecutada', '24 · «no cobrado»: se ejecuta');
RESET ROLE;
SELECT public.chk_txt(public.aj_pr(:PB5), 'failed/0/-', '24 · «no cobrado»: failed, sin pago');
SELECT public.chk_txt(public.aj_incidencias(:PB5), 'cobro_sin_confirmar:resuelta', '24 · incidencia resuelta');
-- Cobrado sobre una cuota anulada: se retiene, no se acredita.
-- Anulación del fixture sin pasar por el flujo (sólo para preparar el caso).
SET session_replication_role = replica;
UPDATE public.cuotas_condominio SET cuota_estado = 'anulada', anulada_at = now() WHERE id = :QX3;
SET session_replication_role = origin;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.conta_ajuste_solicitar_resolucion_cobro(:SA3, :PB6, 'cobrado', 'SINT cobrado tras anular');
SELECT public.aj_subir('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000a3/e.pdf');
SELECT public.conta_ajuste_adjuntar_respaldo('4e0b0000-0000-0000-0000-0000000000a3', :SA3,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/5e0b0000-0000-0000-0000-0000000000a3/e.pdf', 'Estado', repeat('12', 32));
SELECT public.chk_txt(public.aj_aprobar_con(:APR, :SA3, '{4e0b0000-0000-0000-0000-0000000000a3}'), 'ejecutada', '24 · cobrado sobre anulada: se ejecuta');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p WHERE p.payment_request_id = :PB6), 0,
  '24 · cobrado sobre una cuota anulada: ningún pago');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_incidencias_conciliacion i WHERE i.payment_request_id = :PB6 AND i.tipo = 'cobro_sobre_documento_anulado'), 1,
  '24 · …con su incidencia de cobro sobre documento anulado');
-- Un cobro ya resuelto por el proveedor no admite resolución manual.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_ajuste_solicitar_resolucion_cobro('5e0b0000-0000-0000-0000-0000000000f8', 'ad900000-0000-0000-0000-0000000000b4', 'cobrado', 'SINT ya cobrado')$$,
  'AJUSTE_DOCUMENTO_CAMBIO', '24 · un cobro ya resuelto no admite otra resolución');
RESET ROLE;
