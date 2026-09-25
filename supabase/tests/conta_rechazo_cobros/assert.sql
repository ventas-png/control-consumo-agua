-- ============================================================================
-- FECHA DE RECHAZO DE LOS COBROS (20261005000000) · invariantes
--
-- Todo como en la aplicación: SET ROLE authenticated + request.jwt.claim.sub.
-- Como superusuario sólo se prepara (configuración y, en R7, fijar el INSTANTE
-- de dos rechazos para probar los límites del día) y se inspecciona.
--
-- T = CURRENT_DATE. Los rechazos que se hacen aquí ocurren HOY; los cortes
-- «anterior», «del día» y «posterior» son T-1, T y T+1. La fecha de un
-- instante se toma en la zona de la sesión, que aquí se fija en UTC.
-- ============================================================================
\set ON_ERROR_STOP 1
\set A    '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1   '''a1a1a1a1-0000-0000-0000-000000000001'''
\set C3   '''e0000000-0000-0000-0000-00000000a003'''
\set U3   '''f0000000-0000-0000-0000-00000000a003'''
\set ADM  '''a0a0a0a0-0000-0000-0000-00000000000a'''
\set CON  '''a0a0a0a0-0000-0000-0000-00000000000c'''
\set OPE  '''a0a0a0a0-0000-0000-0000-00000000000d'''
\set VIS  '''a0a0a0a0-0000-0000-0000-00000000000e'''
\set ADB  '''b0b0b0b0-0000-0000-0000-00000000000b'''
\set P1   '''d0a00000-0000-0000-0000-000000000001'''
\set P2   '''d0a00000-0000-0000-0000-000000000002'''
\set P3   '''d0a00000-0000-0000-0000-000000000003'''
\set P4   '''d0a00000-0000-0000-0000-000000000004'''
\set P5   '''d0a00000-0000-0000-0000-000000000005'''
\set P6   '''d0a00000-0000-0000-0000-000000000006'''
\set P7   '''d0a00000-0000-0000-0000-000000000007'''
\set P8   '''d0a00000-0000-0000-0000-000000000008'''
\set P9   '''d0a00000-0000-0000-0000-000000000009'''
\set PC   '''d0a00000-0000-0000-0000-0000000000ca'''
\set CA   '''d0b00000-0000-0000-0000-0000000000ca'''

SET TIME ZONE 'UTC';

-- ── Ayudas de lectura (corren con el rol de la sesión) ───────────────────────
RESET ROLE;
-- Un campo de la fila de un documento en «fuera del saldo» al corte ('-' si no figura).
CREATE OR REPLACE FUNCTION public.rc_fila(p_hasta date, p_origen uuid, p_campo text) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE((
    SELECT CASE p_campo
             WHEN 'clase'  THEN f.clase
             WHEN 'codigo' THEN f.codigo
             WHEN 'motivo' THEN f.motivo
             WHEN 'estado' THEN f.estado_actual
             WHEN 'limite' THEN COALESCE(f.limitacion, '-')
           END
      FROM public.conta_estado_cuenta_pendientes('a1a1a1a1-0000-0000-0000-000000000001',
             'e0000000-0000-0000-0000-00000000a003', NULL, p_hasta, 500, 0) f
     WHERE f.origen_id = p_origen), '-')
$$;
CREATE OR REPLACE FUNCTION public.ecc_limitaciones_rc(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((l->>'codigo') || ':' || (l->>'documentos') || ':' || (l->>'monto'), ',' ORDER BY l->>'codigo'), '')
    FROM jsonb_array_elements(j->'limitaciones') l
$$;
-- Limitaciones al corte como «codigo:documentos:monto».
CREATE OR REPLACE FUNCTION public.rc_lim(p_hasta date) RETURNS text LANGUAGE sql AS $$
  SELECT public.ecc_limitaciones_rc(public.ec('a1a1a1a1-0000-0000-0000-000000000001',
           'e0000000-0000-0000-0000-00000000a003', NULL, NULL, p_hasta))
$$;
-- Resumen del saldo al corte: «saldo_inicial|cargos|abonos|saldo_final|movimientos».
CREATE OR REPLACE FUNCTION public.rc_resumen(p_hasta date) RETURNS text LANGUAGE sql AS $$
  SELECT public.ec_resumen(public.ec('a1a1a1a1-0000-0000-0000-000000000001',
           'e0000000-0000-0000-0000-00000000a003', NULL, NULL, p_hasta))
$$;
-- Evidencia de un cobro como «evento:estado_anterior:motivo:actor», en orden.
CREATE OR REPLACE FUNCTION public.rc_ev(p_pago uuid) RETURNS text LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(e.evento || ':' || e.estado_anterior || ':' || COALESCE(e.motivo, '-') || ':' ||
           CASE e.actor WHEN 'a0a0a0a0-0000-0000-0000-00000000000a' THEN 'adm'
                        WHEN 'a0a0a0a0-0000-0000-0000-00000000000c' THEN 'contador'
                        ELSE COALESCE(e.actor::text, 'nadie') END,
           ',' ORDER BY e.ocurrido_at, e.id), '')
    FROM public.pagos_rechazo_eventos e WHERE e.pago_id = p_pago
$$;
-- Asientos de cobro de un pago: «todos/vivos».
CREATE OR REPLACE FUNCTION public.rc_asientos(p_pago uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) || '/' || count(*) FILTER (WHERE a.estado = 'publicado' AND a.anulado_por_id IS NULL)
    FROM public.conta_asientos a
   WHERE a.origen = 'automatico' AND a.origen_tabla = 'pagos' AND a.origen_id = p_pago
     AND a.origen_evento = 'pago_contabilizado'
$$;
GRANT EXECUTE ON FUNCTION public.rc_fila(date, uuid, text), public.rc_lim(date), public.ecc_limitaciones_rc(jsonb),
  public.rc_resumen(date), public.rc_ev(uuid), public.rc_asientos(uuid) TO authenticated;

-- Preparación: la fecha REAL de los intentos de contabilización de los cobros
-- de este arnés es la de su verificación (se insertan hoy con verified_at
-- anterior). Mismo recurso que conta_estado_cuenta/assert_corte.sql.
CREATE OR REPLACE FUNCTION public.rc_fechar_intentos() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.conta_intentos_contabilizacion i
     SET created_at = p.verified_at
    FROM public.pagos p
   WHERE i.origen_tabla = 'pagos' AND i.origen_id = p.id
     AND p.id::text LIKE 'd0a00000-%' AND p.verified_at IS NOT NULL AND i.created_at > p.verified_at
$$;
GRANT EXECUTE ON FUNCTION public.rc_fechar_intentos() TO authenticated;

-- Preparación: el tipo «mantenimiento» configurado en A1, para que las
-- cuotas se devenguen y un cobro dentro del saldo se contabilice (R5).
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
SELECT :A, :A1, 'mantenimiento', '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103'
 WHERE NOT EXISTS (SELECT 1 FROM public.conta_config_tipo_cargo
                    WHERE company_id = :A AND project_id = :A1 AND tipo_cargo = 'mantenimiento');

-- Cuotas del sujeto: cada cobro que la excede queda PENDIENTE, sin asiento.
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('d0c00000-0000-0000-0000-000000000002', :A, :A1, :U3, 'SINT-RECH K2', 50, to_char(CURRENT_DATE, 'YYYY-MM'), 'pendiente', 'mantenimiento', now() - interval '10 days'),
  ('d0c00000-0000-0000-0000-000000000004', :A, :A1, :U3, 'SINT-RECH K4', 50, to_char(CURRENT_DATE, 'YYYY-MM'), 'pendiente', 'mantenimiento', now() - interval '8 days'),
  ('d0c00000-0000-0000-0000-000000000006', :A, :A1, :U3, 'SINT-RECH K6', 5,  '2026-08', 'pendiente', 'mantenimiento', '2026-08-14 12:00+00'),
  ('d0c00000-0000-0000-0000-000000000008', :A, :A1, :U3, 'SINT-RECH K8', 5,  to_char(CURRENT_DATE, 'YYYY-MM'), 'pendiente', 'mantenimiento', now() - interval '6 days');

-- ── R1 · rechazo desde Agua (UPDATE directo) de un cobro SIN asiento ─────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:P2, :C3, :A1, 'd0c00000-0000-0000-0000-000000000002', 80, 'efectivo', 'verificado', now() - interval '9 days');
SELECT public.rc_fechar_intentos();
SELECT public.chk_txt(public.rc_fila(CURRENT_DATE - 1, :P2, 'codigo'), 'excede_saldo',
  'R1 · antes del rechazo: el cobro que excede está pendiente, sin asiento');
SELECT public.rc_resumen(CURRENT_DATE - 1) AS res_antes \gset

-- Igual que rejectPago, y además con un revisor (el contador) y una fecha
-- FALSOS enviados por el cliente.
UPDATE public.pagos
   SET estado = 'rechazado', verification_status = 'rechazado',
       verified_by = :CON, verified_at = '2020-01-01 00:00+00',
       verification_notes = 'SINT-RECH cheque devuelto'
 WHERE id = :P2;

SELECT public.chk_txt(public.rc_ev(:P2), 'rechazo:verificado:SINT-RECH cheque devuelto:adm',
  'R1 · el rechazo deja evidencia con el motivo y el usuario de la SESIÓN, no el que manda el cliente');
SELECT public.chk(
  (SELECT count(*) FROM public.pagos_rechazo_eventos
    WHERE pago_id = :P2 AND ocurrido_at::date = CURRENT_DATE AND ocurrido_at <= now()), 1,
  'R1 · …y la hora del servidor, no la fecha falsa de 2020');
SELECT public.chk_txt(public.rc_asientos(:P2), '0/0',
  'R1 · un cobro sin asiento no gana asiento ni reverso por rechazarlo');

SELECT public.chk_txt(public.rc_fila(CURRENT_DATE - 1, :P2, 'clase') || '|' || public.rc_fila(CURRENT_DATE - 1, :P2, 'codigo')
                      || '|' || public.rc_fila(CURRENT_DATE - 1, :P2, 'estado'),
  'pendiente|excede_saldo|rechazado',
  'R3 · corte ANTERIOR al rechazo: figura como estaba, pendiente, con su estado de hoy');
SELECT public.chk(
  (SELECT count(*) FROM (SELECT public.rc_fila(CURRENT_DATE - 1, :P2, 'motivo') AS m) x
    WHERE m LIKE '%El cobro se rechazó después del corte, el ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '.'), 1,
  'R3 · …y dice que se rechazó después del corte, con la fecha del servidor');
SELECT public.chk_txt(public.rc_fila(CURRENT_DATE, :P2, 'clase') || '|' || public.rc_fila(CURRENT_DATE + 1, :P2, 'clase')
                      || '|' || public.rc_fila(NULL, :P2, 'clase'),
  '-|-|-',
  'R3 · corte del MISMO día, posterior y sin corte: ya estaba rechazado, no figura');
SELECT public.chk_txt(public.rc_resumen(CURRENT_DATE - 1), :'res_antes',
  'R3 · el saldo y los movimientos al corte anterior no cambian: no se vuelve movimiento');
SELECT public.chk_txt(public.rc_fila(CURRENT_DATE - 1, :P2, 'limite'), '-',
  'R3 · su fila no es una limitación');

-- ── R2 · rechazo repetido y evidencia inmutable ─────────────────────────────
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado' WHERE id = :P2;
SELECT public.chk_txt(public.rc_ev(:P2) || '|' || public.rc_asientos(:P2),
  'rechazo:verificado:SINT-RECH cheque devuelto:adm|0/0',
  'R2 · repetir el rechazo no deja otra evidencia ni otro efecto');
SELECT public.chk_falla($$UPDATE public.pagos SET verification_notes = 'SINT-RECH otro motivo' WHERE id = 'd0a00000-0000-0000-0000-000000000002'$$,
  'PAGO_RECHAZADO_INMUTABLE', 'R2 · el motivo de un cobro rechazado no se reescribe');
SELECT public.chk_falla($$UPDATE public.pagos SET verified_at = now() - interval '30 days', verified_by = 'a0a0a0a0-0000-0000-0000-00000000000a' WHERE id = 'd0a00000-0000-0000-0000-000000000002'$$,
  'PAGO_RECHAZADO_INMUTABLE', 'R2 · …ni su fecha ni su revisor');
SELECT public.chk_falla($$UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verified_by = 'a0a0a0a0-0000-0000-0000-00000000000a', verified_at = now(), verification_notes = 'SINT-RECH doble clic' WHERE id = 'd0a00000-0000-0000-0000-000000000002'$$,
  'PAGO_RECHAZADO_INMUTABLE', 'R2 · un segundo rechazo desde Agua (doble clic) no pisa el primero');
SELECT public.chk_txt(public.rc_ev(:P2), 'rechazo:verificado:SINT-RECH cheque devuelto:adm',
  'R2 · la evidencia original sigue intacta');

-- ── R8 · la aplicación no puede fabricar ni tocar la evidencia ───────────────
SELECT public.chk_falla($$INSERT INTO public.pagos_rechazo_eventos (pago_id, company_id, project_id, evento, estado_anterior, estado_nuevo, ocurrido_at)
  VALUES ('d0a00000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1a1a1a1-0000-0000-0000-000000000001', 'rechazo', 'verificado', 'rechazado', '2020-01-01')$$,
  'permission denied', 'R8 · no se inserta evidencia a mano');
SELECT public.chk_falla($$UPDATE public.pagos_rechazo_eventos SET ocurrido_at = '2020-01-01' WHERE pago_id = 'd0a00000-0000-0000-0000-000000000002'$$,
  'permission denied', 'R8 · ni se retrocede su fecha');
SELECT public.chk_falla($$DELETE FROM public.pagos_rechazo_eventos WHERE pago_id = 'd0a00000-0000-0000-0000-000000000002'$$,
  'permission denied', 'R8 · ni se borra');
-- Un cobro que NACE rechazado (con una fecha falsa) también queda fechado por el servidor.
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verification_status, verified_at, verification_notes) VALUES
  (:P9, :C3, :A1, 'd0c00000-0000-0000-0000-000000000002', 9, 'efectivo', 'rechazado', 'rechazado', '2020-01-01 00:00+00', 'SINT-RECH nace rechazado');
SELECT public.chk_txt(public.rc_ev(:P9) || '|' ||
  (SELECT (ocurrido_at::date = CURRENT_DATE)::text FROM public.pagos_rechazo_eventos WHERE pago_id = :P9),
  'rechazo:alta:SINT-RECH nace rechazado:adm|true',
  'R8 · un alta ya rechazada queda fechada por el servidor');

-- ── R4 · rechazo LEGADO sin evidencia: sigue declarado como limitación ───────
SELECT public.chk_txt(public.rc_ev(:P1), '', 'R4 · el rechazo legado no tiene evidencia (no se inventa)');
SELECT public.chk_txt(public.rc_lim('2026-08-31'), 'rechazo_sin_fecha:1:80.00',
  'R4 · corte de agosto: el legado sigue en rechazo_sin_fecha');
SELECT public.chk_txt(public.rc_fila('2026-08-31', :P1, 'clase'), '-',
  'R4 · …y no se lista como pendiente (no se puede situar)');
SELECT public.chk_txt(public.rc_lim(CURRENT_DATE - 1), 'rechazo_sin_fecha:1:80.00',
  'R4 · al corte de ayer sólo el legado es limitación; los rechazos fechados no');

-- ── R3b · un cobro rechazado ANTES de verificarse nunca estuvo vigente ───────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verification_status) VALUES
  (:P3, :C3, :A1, 'd0c00000-0000-0000-0000-000000000002', 20, 'transferencia', 'pendiente', 'pendiente');
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT-RECH sin comprobante'
 WHERE id = :P3;
SELECT public.chk_txt(public.rc_ev(:P3), 'rechazo:pendiente:SINT-RECH sin comprobante:adm',
  'R3b · se registra desde qué estado se rechazó');
SELECT public.chk_txt(public.rc_fila(CURRENT_DATE - 1, :P3, 'clase') || '|' || public.rc_lim(CURRENT_DATE - 1),
  '-|rechazo_sin_fecha:1:80.00',
  'R3b · al corte anterior no figura (estaba sin verificar) y no es limitación');

-- ── R5 · cobro CON asiento y reverso: el tratamiento no cambia ───────────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:P4, :C3, :A1, 'd0c00000-0000-0000-0000-000000000004', 30, 'efectivo', 'verificado', now() - interval '7 days');
SELECT public.chk_txt(public.rc_asientos(:P4), '1/1', 'R5 · el cobro se contabilizó');
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT-RECH con asiento'
 WHERE id = :P4;
SELECT public.chk_txt(public.rc_asientos(:P4) || '|' || public.rc_ev(:P4), '1/0|rechazo:verificado:SINT-RECH con asiento:adm',
  'R5 · el rechazo reversa su asiento (una vez) y deja evidencia');
-- Diferencial: lo que el estado de cuenta dice de P4 con y sin su evidencia
-- es lo mismo, en cada corte. (Se quita en una transacción que se deshace.)
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT string_agg(public.rc_fila(d, :P4, 'clase') || ':' || public.rc_fila(d, :P4, 'codigo') || ':' || public.rc_fila(d, :P4, 'motivo')
                  || ':' || public.rc_resumen(d), ' ‖ ' ORDER BY d) AS con_evidencia
  FROM (VALUES (CURRENT_DATE - 8), (CURRENT_DATE - 7), (CURRENT_DATE - 1), (CURRENT_DATE), (NULL::date)) v(d) \gset
RESET ROLE;
BEGIN;
DELETE FROM public.pagos_rechazo_eventos WHERE pago_id = :P4;
SET LOCAL ROLE authenticated;
SELECT public.chk_txt(
  (SELECT string_agg(public.rc_fila(d, :P4, 'clase') || ':' || public.rc_fila(d, :P4, 'codigo') || ':' || public.rc_fila(d, :P4, 'motivo')
                     || ':' || public.rc_resumen(d), ' ‖ ' ORDER BY d)
     FROM (VALUES (CURRENT_DATE - 8), (CURRENT_DATE - 7), (CURRENT_DATE - 1), (CURRENT_DATE), (NULL::date)) v(d)),
  :'con_evidencia',
  'R5 · con asiento y reverso, la evidencia no cambia nada del estado de cuenta en ningún corte');
ROLLBACK;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;

-- ── R6 · permisos y alcance: el rechazo sigue gobernado por la RLS ───────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:P5, :C3, :A1, 'd0c00000-0000-0000-0000-000000000008', 10, 'efectivo', 'verificado', now() - interval '5 days');
SELECT set_config('request.jwt.claim.sub', :OPE, false);
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado' WHERE id = :P5;
SELECT set_config('request.jwt.claim.sub', :CON, false);
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado' WHERE id = :P5;
SELECT set_config('request.jwt.claim.sub', :ADB, false);
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado' WHERE id = :P5;
SELECT public.chk(
  (SELECT count(*) FROM public.pagos_rechazo_eventos), 0,
  'R6 · la empresa B no ve la evidencia de A');
RESET ROLE;
SELECT public.chk_txt(
  (SELECT estado FROM public.pagos WHERE id = :P5) || '|' ||
  (SELECT count(*)::text FROM public.pagos_rechazo_eventos WHERE pago_id = :P5),
  'verificado|0',
  'R6 · operador, contador sin rol admin y admin de otra empresa no rechazan: ni estado ni evidencia');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;

-- ── R9 · cargo adicional: anulación de un cobro SIN asiento por la RPC ───────
RESET ROLE;
DELETE FROM public.conta_config_tipo_cargo WHERE project_id = :A1 AND tipo_cargo = 'adicional_reparacion';
SET ROLE authenticated;
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  (:CA, :A, :A1, :U3, 'SINT-RECH CA', 'reparacion', 40, CURRENT_DATE - 6, 'pendiente');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_registrar_cobro_cargo(:CA, 40, 'efectivo', CURRENT_DATE - 5, 'SINT-RECH ref', NULL, :PC)), 1,
  'R9 · el cobro del cargo se registra (su devengo está pendiente: sin asiento)');
SELECT public.rc_fechar_intentos();
SELECT public.chk_txt(public.rc_asientos(:PC) || '|' || public.rc_fila(CURRENT_DATE - 1, :PC, 'codigo'), '0/0|devengo_pendiente',
  'R9 · …pendiente por el devengo');
SELECT set_config('request.jwt.claim.sub', :VIS, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_anular_cobro_cargo('d0a00000-0000-0000-0000-0000000000ca', 'SINT-RECH visor')$$,
  'No autorizado', 'R6 · el visor contable no anula');
SELECT set_config('request.jwt.claim.sub', :ADB, false);
SELECT public.chk_falla($$SELECT * FROM public.conta_anular_cobro_cargo('d0a00000-0000-0000-0000-0000000000ca', 'SINT-RECH intruso')$$,
  'no está en tu ámbito', 'R6 · ni el admin de otra empresa');
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SELECT public.chk_txt(public.rc_ev(:PC), '', 'R6 · los intentos rechazados no dejan evidencia');
SELECT public.chk_txt((SELECT resultado FROM public.conta_anular_cobro_cargo(:PC, 'SINT-RECH cargo mal cobrado')), 'anulado',
  'R9 · el admin anula el cobro');
SELECT public.chk_txt(public.rc_ev(:PC), 'rechazo:verificado:SINT-RECH cargo mal cobrado:adm',
  'R9 · la anulación deja evidencia con su motivo y su actor');
SELECT public.chk_txt((SELECT resultado FROM public.conta_anular_cobro_cargo(:PC, 'SINT-RECH otra vez')) || '|' || public.rc_ev(:PC),
  'ya_anulado|rechazo:verificado:SINT-RECH cargo mal cobrado:adm',
  'R9 · repetirla no cambia nada');
SELECT public.chk_txt(public.rc_fila(CURRENT_DATE - 1, :PC, 'clase') || '|' || public.rc_fila(CURRENT_DATE, :PC, 'clase'),
  'pendiente|-',
  'R9 · al corte anterior seguía pendiente; al del día, ya anulado');

-- ── R7 · límites del día (instante fijado por el arnés, zona UTC) ────────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:P6, :C3, :A1, 'd0c00000-0000-0000-0000-000000000006', 11, 'efectivo', 'verificado', '2026-08-15 12:00+00'),
  (:P7, :C3, :A1, 'd0c00000-0000-0000-0000-000000000006', 12, 'efectivo', 'verificado', '2026-08-15 12:00+00');
SELECT public.rc_fechar_intentos();
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT-RECH borde'
 WHERE id IN (:P6, :P7);
RESET ROLE;
UPDATE public.pagos_rechazo_eventos SET ocurrido_at = '2026-08-20 23:59:59+00' WHERE pago_id = :P6;
UPDATE public.pagos_rechazo_eventos SET ocurrido_at = '2026-08-21 00:00:00+00' WHERE pago_id = :P7;
SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;
SELECT public.chk_txt(public.rc_fila('2026-08-19', :P6, 'clase') || '|' || public.rc_fila('2026-08-19', :P7, 'clase'),
  'pendiente|pendiente', 'R7 · corte 08-19: los dos seguían vigentes');
SELECT public.chk_txt(public.rc_fila('2026-08-20', :P6, 'clase') || '|' || public.rc_fila('2026-08-20', :P7, 'clase'),
  '-|pendiente', 'R7 · corte 08-20: el rechazado a las 23:59:59 ya no figura; el de las 00:00:00 del 21 sí');
SELECT public.chk(
  (SELECT count(*) FROM (SELECT public.rc_fila('2026-08-20', :P7, 'motivo') AS m) x
    WHERE m LIKE '%se rechazó después del corte, el 2026-08-21.'), 1,
  'R7 · …con la fecha del día siguiente');
SELECT public.chk_txt(public.rc_fila('2026-08-21', :P6, 'clase') || '|' || public.rc_fila('2026-08-21', :P7, 'clase'),
  '-|-', 'R7 · corte 08-21: ninguno');
SELECT public.chk_txt(public.rc_lim('2026-08-31'), 'rechazo_sin_fecha:1:80.00',
  'R7 · fechados, no son limitación: sólo el legado');

-- ── R10 · reactivación: se registra, no se reutiliza la fecha ────────────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  (:P8, :C3, :A1, 'd0c00000-0000-0000-0000-000000000008', 8, 'efectivo', 'verificado', now() - interval '4 days');
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT-RECH primero' WHERE id = :P8;
UPDATE public.pagos SET estado = 'verificado', verification_status = 'verificado' WHERE id = :P8;
UPDATE public.pagos SET estado = 'rechazado', verification_status = 'rechazado', verification_notes = 'SINT-RECH segundo' WHERE id = :P8;
SELECT public.chk_txt(public.rc_ev(:P8),
  'rechazo:verificado:SINT-RECH primero:adm,reactivacion:rechazado:-:adm,rechazo:verificado:SINT-RECH segundo:adm',
  'R10 · reactivar y volver a rechazar deja tres eventos, en orden: ninguna fecha se reutiliza');

RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM public.pagos p
    WHERE p.estado = 'rechazado' AND p.id::text LIKE 'd0a00000-%'
      AND p.id <> 'd0a00000-0000-0000-0000-000000000001'
      AND NOT EXISTS (SELECT 1 FROM public.pagos_rechazo_eventos e WHERE e.pago_id = p.id AND e.evento = 'rechazo')), 0,
  'global · todo cobro rechazado después de la migración tiene su evidencia');
