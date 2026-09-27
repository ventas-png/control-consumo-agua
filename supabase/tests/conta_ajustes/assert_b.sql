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
-- Sin emitir y sin dependencias: se sigue eliminando (reserva cancelada).
SELECT public.chk(public.filas_afectadas($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-00000000000f'$$), 1,
  '12 · una cuota sin emitir y sin dependencias se elimina');
SELECT public.chk_txt(public.aj_cuota(:QF), 'pendiente/0/0/eliminada', '12 · …y su devengo se reversa');
-- Sin emitir con un cobro vivo: no, y no en cascada.
SELECT public.chk_uuid(public.aj_cobro_cuota(:QG, 10, :KG), :KG, '12 · QG (sin emitir) recibe un cobro');
SELECT public.chk_falla($$UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'c9a00000-0000-0000-0000-000000000010'$$,
  'CUOTA_CON_DEPENDENCIAS', '12 · eliminar una cuota con un cobro vivo: rechazado, sin cascada');
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
