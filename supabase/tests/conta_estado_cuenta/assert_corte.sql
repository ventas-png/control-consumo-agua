-- ============================================================================
-- ESTADO DE CUENTA · corte histórico (20261003000200)
--
-- Corre DESPUÉS de assert.sql, sobre la misma base, con un sujeto propio:
-- el auxiliar Tres (C3), pagador de la unidad U3 creada aquí. Nada de lo de
-- C1/C2 lo toca.
--
-- Lo que se prueba: el resumen (conta_estado_cuenta) y la lista de fuera del
-- saldo (conta_estado_cuenta_pendientes) evaluados AL CORTE, antes y después
-- de cada contabilización y de cada reverso; sin estados de hoy presentados
-- como históricos, y con las limitaciones dichas.
--
-- Como superusuario sólo se prepara: la unidad, los cierres de mes, el
-- devengo que el sistema dejó en borrador y la fecha real de un intento.
-- Todo lo demás lo hace el admin de la empresa (SET ROLE authenticated).
--
-- Línea de tiempo (T = hoy):
--   01-20  K20 cuota extra 100, sin configuración → pendiente; su devengo
--          queda en BORRADOR con fecha 02-03 y se publica: asiento de febrero
--   01-25  K21 cuota extra 40 con ENERO CERRADO → asiento con fecha T
--   02-10  P20 cobro 30 a K20 → asiento 02-10; se RECHAZA con febrero
--          cerrado → reverso con fecha T
--   02-20  P21 cobro 20 a K20 con FEBRERO CERRADO → asiento con fecha T
--   03-05  K22 cuota 100 → asiento 03-05; se reversa con marzo cerrado → T
--   05-05  K23 cuota 60 → asiento 05-05; se reversa con mayo abierto → 05-05
--   06-10  K24 cuota extra 70, sin configuración → pendiente; se anula hoy
--   07-10  K25 cuota 45 → asiento 07-10; se anula hoy → reverso 07-10
--   08-05  K26 cuota 50;  08-06 P22 cobro 80 excede → pendiente; se rechaza
--   08-07  CA20 cargo 15 sin configuración → pendiente; se anula
--   08-08  CA21 cargo 12 → asiento 08-08; hoy figura «pagado»
-- ============================================================================

\set A   '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set A1  '''a1a1a1a1-0000-0000-0000-000000000001'''
\set C3  '''e0000000-0000-0000-0000-00000000a003'''
\set U3  '''f0000000-0000-0000-0000-00000000a003'''
\set ADM '''a0a0a0a0-0000-0000-0000-00000000000a'''

-- ── Preparación (superusuario) ───────────────────────────────────────────────
RESET ROLE;
INSERT INTO public.unidades (id, company_id, project_id, nombre) VALUES
  (:U3, :A, :A1, 'SINT-AUX Apto 103');
INSERT INTO public.unidad_residentes
  (id, unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  ('ec0e0000-0000-0000-0000-000000000003', :U3, :C3, :A, :A1, 'propietario', true, true);

-- «pendientes» al corte como «clase:origen:monto», y el resumen al corte.
CREATE OR REPLACE FUNCTION public.ecc_fuera(p_hasta date) RETURNS text LANGUAGE sql AS $$
  SELECT public.ec_fuera('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a003', NULL, p_hasta)
$$;
CREATE OR REPLACE FUNCTION public.ecc(p_hasta date) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ec('a1a1a1a1-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-00000000a003', NULL, NULL, p_hasta)
$$;
CREATE OR REPLACE FUNCTION public.ecc_resumen_fuera(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((f->>'clase') || ':' || (f->>'naturaleza') || ':' || (f->>'documentos') || ':' || (f->>'monto'), ','
                             ORDER BY f->>'clase', f->>'naturaleza'), '')
    FROM jsonb_array_elements(j->'fuera_de_saldo') f
$$;
CREATE OR REPLACE FUNCTION public.ecc_limitaciones(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg((l->>'codigo') || ':' || (l->>'documentos') || ':' || (l->>'monto'), ',' ORDER BY l->>'codigo'), '')
    FROM jsonb_array_elements(j->'limitaciones') l
$$;
CREATE OR REPLACE FUNCTION public.ecc_fila(p_hasta date, p_origen uuid, p_campos text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(
           CASE p_campos
             WHEN 'codigo'  THEN f.codigo
             WHEN 'fecha'   THEN f.asiento_fecha::text
             WHEN 'motivo'  THEN f.motivo
             WHEN 'estado'  THEN f.estado_actual
             WHEN 'limite'  THEN COALESCE(f.limitacion, '-')
           END, ',')
    FROM public.conta_estado_cuenta_pendientes('a1a1a1a1-0000-0000-0000-000000000001',
           'e0000000-0000-0000-0000-00000000a003', NULL, p_hasta, 500, 0) f
   WHERE f.origen_id = p_origen
$$;
GRANT EXECUTE ON FUNCTION public.ecc_fuera(date), public.ecc(date), public.ecc_resumen_fuera(jsonb),
  public.ecc_limitaciones(jsonb), public.ecc_fila(date, uuid, text) TO authenticated;

SELECT set_config('request.jwt.claim.sub', :ADM, false);
SET ROLE authenticated;

-- ── K20: emitida en enero, su asiento se publica con fecha de FEBRERO ────────
DELETE FROM public.conta_config_tipo_cargo WHERE project_id = :A1 AND tipo_cargo = 'cuota_extraordinaria';
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000020', :A, :A1, :U3, 'SINT-AUX K20', 100, '2026-01', 'pendiente', 'cuota_extraordinaria', '2026-01-20 12:00+00');
SELECT public.chk_txt(public.ecc_fuera('2026-01-31'), 'pendiente:cuotas_condominio:100.00',
  'C0 · K20 sin configuración: pendiente en enero');

RESET ROLE;
-- El sistema dejó su devengo en BORRADOR con fecha 3 de febrero (como K6 en
-- assert.sql: p. ej. sin tipo de cambio); lo publica el admin.
SELECT set_config('conta.allow_system_write', 'on', false);
INSERT INTO public.conta_asientos
  (id, company_id, project_id, fecha, tipo, concepto, estado, origen, origen_tabla, origen_id, origen_evento, moneda_base)
VALUES ('ec400000-0000-0000-0000-000000000020', :A, :A1, '2026-02-03', 'diario', 'SINT-AUX devengo K20', 'borrador',
        'automatico', 'cuotas_condominio', 'ec500000-0000-0000-0000-000000000020', 'cuota_emitida',
        public.conta_moneda_base(:A, :A1));
INSERT INTO public.conta_asiento_lineas
  (asiento_id, company_id, cuenta_id, orden, descripcion, debe, haber, auxiliar_cliente_id, unidad_id, tipo_cargo) VALUES
  ('ec400000-0000-0000-0000-000000000020', :A, '11000000-0000-0000-0000-00000000a101', 1, 'SINT-AUX', 100, 0, :C3, :U3, 'cuota_extraordinaria'),
  ('ec400000-0000-0000-0000-000000000020', :A, '11000000-0000-0000-0000-00000000a103', 2, 'SINT-AUX', 0, 100, :C3, :U3, 'cuota_extraordinaria');
SELECT set_config('conta.allow_system_write', 'off', false);
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :A1, 'cuota_extraordinaria', '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');

SELECT public.chk_txt(public.ecc_fuera(NULL) || ' / ' || public.ecc_fuera('2026-01-31'),
  'borrador:cuotas_condominio:100.00 / pendiente:cuotas_condominio:100.00',
  'C1 · antes de publicarse: hoy en borrador; al corte de enero el borrador (creado hoy) no existía: pendiente');
SELECT public.conta_publicar_asiento('ec400000-0000-0000-0000-000000000020');

SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-01-31')), '0.00|0.00|0.00|0.00|0',
  'C1 · corte de ENERO: el asiento de febrero no está en el saldo');
SELECT public.chk_txt(public.ecc_fuera('2026-01-31'), 'contabilizado_despues:cuotas_condominio:100.00',
  'C1 · …y la cuota figura FUERA del saldo, contabilizada después del corte');
SELECT public.chk_txt(
  public.ecc_fila('2026-01-31', 'ec500000-0000-0000-0000-000000000020', 'codigo') || '|' ||
  public.ecc_fila('2026-01-31', 'ec500000-0000-0000-0000-000000000020', 'fecha'),
  'contabilizado_despues_del_corte|2026-02-03', 'C1 · …con la fecha del asiento que la contabilizó');
SELECT public.chk_txt(public.ecc_resumen_fuera(public.ecc('2026-01-31')), 'contabilizado_despues:cargo:1:100.00',
  'C1 · el RESUMEN de enero la cuenta aparte, igual que la lista');
SELECT public.chk_txt(public.ecc_fuera('2026-02-02'), 'contabilizado_despues:cuotas_condominio:100.00',
  'C1 · corte del día anterior al asiento: todavía fuera');
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-02-03')), '0.00|100.00|0.00|100.00|1',
  'C1 · corte del día del asiento: entra al saldo…');
SELECT public.chk_txt(public.ecc_fuera('2026-02-03'), '',
  'C1 · …y deja de figurar como pendiente');
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-02-28')), '0.00|100.00|0.00|100.00|1',
  'C1 · corte de FEBRERO: en el saldo');
SELECT public.chk_txt(public.ecc_resumen_fuera(public.ecc('2026-02-28')), '',
  'C1 · …y el resumen de febrero ya no la cuenta fuera');
SELECT public.chk_txt(public.ec_fuera(:A1, NULL, :U3, '2026-01-31') || ' / ' || public.ec_fuera(:A1, NULL, :U3, '2026-02-28'),
  'contabilizado_despues:cuotas_condominio:100.00 / ', 'C1 · por UNIDAD, el mismo criterio');

-- ── K21: emitida en enero con ENERO CERRADO → el sistema la fecha hoy ───────
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES (:A, :A1, '2026-01', 'cerrado');
SET ROLE authenticated;
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000021', :A, :A1, :U3, 'SINT-AUX K21', 40, '2026-01', 'pendiente', 'cuota_extraordinaria', '2026-01-25 12:00+00');
SELECT public.chk_txt(public.ecc_fila('2026-01-31', 'ec500000-0000-0000-0000-000000000021', 'fecha'), CURRENT_DATE::text,
  'C2 · enero cerrado: su asiento lleva la fecha de hoy');
SELECT public.chk_txt(public.ecc_fuera('2026-01-31'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:cuotas_condominio:100.00',
  'C2 · corte de enero: las dos cuotas de enero fuera del saldo');
SELECT public.chk_txt(public.ecc_fuera(CURRENT_DATE - 1), 'contabilizado_despues:cuotas_condominio:40.00',
  'C2 · corte de AYER: K21 todavía fuera');
SELECT public.chk_txt(public.ecc_fuera(CURRENT_DATE), '',
  'C2 · corte de HOY: dentro');

-- ── Cobros: uno contabilizado en su fecha, otro con el mes cerrado ──────────
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec600000-0000-0000-0000-000000000020', :C3, :A1, 'ec500000-0000-0000-0000-000000000020', 30, 'efectivo', 'verificado', '2026-02-10 12:00+00');
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES (:A, :A1, '2026-02', 'cerrado');
SET ROLE authenticated;
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec600000-0000-0000-0000-000000000021', :C3, :A1, 'ec500000-0000-0000-0000-000000000020', 20, 'efectivo', 'verificado', '2026-02-20 12:00+00');
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-02-28')), '0.00|100.00|30.00|70.00|2',
  'C3 · corte de febrero: el cobro del 10 reduce el saldo…');
SELECT public.chk_txt(public.ecc_fuera('2026-02-28'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00',
  'C3 · …el del 20, contabilizado hoy (febrero cerrado), figura fuera del saldo');
SELECT public.chk_txt(public.ecc_fila('2026-02-28', 'ec600000-0000-0000-0000-000000000021', 'estado'), 'verificado',
  'C3 · su estado se rotula como el de HOY (estado_actual)');
SELECT public.chk_txt(public.ecc_resumen_fuera(public.ecc('2026-02-28')),
  'contabilizado_despues:abono:1:20.00,contabilizado_despues:cargo:1:40.00',
  'C3 · el resumen de febrero separa el cobro (abono) de la cuota (cargo)');
SELECT public.chk_txt(public.ec_resumen(public.ecc(CURRENT_DATE)), '0.00|140.00|50.00|90.00|4',
  'C3 · corte de hoy: los dos cobros y las dos cuotas en el saldo');

-- ── Reverso de un cobro con el mes cerrado (reverso con fecha de hoy) ───────
UPDATE public.pagos SET estado = 'rechazado' WHERE id = 'ec600000-0000-0000-0000-000000000020';
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-02-28')), '0.00|100.00|30.00|70.00|2',
  'C4 · corte ANTERIOR al reverso: el cobro rechazado hoy seguía aplicado');
SELECT public.chk_txt(public.ecc_fuera('2026-02-28'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00',
  'C4 · …y no se lista como reversado ni como pendiente');
SELECT public.chk_txt(
  (SELECT concat_ws('|', m->>'reversado_por_id', m->>'reversado_despues_del_corte', m->>'reversado_despues_fecha')
     FROM jsonb_array_elements(public.ecc('2026-02-28')->'movimientos') m
    WHERE m->>'documento_id' = 'ec600000-0000-0000-0000-000000000020'),
  'true|' || CURRENT_DATE::text,
  'C4 · la fila del cobro NO se presenta como reversada al corte: se avisa que el reverso es posterior');
SELECT public.chk_txt(public.ec_resumen(public.ecc(CURRENT_DATE)), '0.00|170.00|50.00|120.00|5',
  'C4 · corte POSTERIOR: el reverso devuelve la deuda, sin descontar dos veces');
SELECT public.chk_txt(public.ecc_fuera(CURRENT_DATE), '',
  'C4 · …y el cobro rechazado ya no está vigente: nada fuera');
SELECT public.chk(
  (SELECT count(*) FROM jsonb_array_elements(public.ecc(CURRENT_DATE)->'movimientos') m
    WHERE m->>'documento_id' = 'ec600000-0000-0000-0000-000000000020' AND m->>'reversado_por_id' IS NOT NULL), 1,
  'C4 · a hoy, la fila del cobro sí muestra su reverso');

-- ── Reverso de un devengo con el documento VIGENTE: mes cerrado y abierto ───
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000022', :A, :A1, :U3, 'SINT-AUX K22', 100, '2026-03', 'pendiente', 'mantenimiento', '2026-03-05 12:00+00');
RESET ROLE;
INSERT INTO public.cierres_mensuales (company_id, project_id, periodo, estado) VALUES (:A, :A1, '2026-03', 'cerrado');
SET ROLE authenticated;
SELECT public.conta_anular_asiento(
  (SELECT id FROM public.conta_asientos WHERE origen_tabla = 'cuotas_condominio'
      AND origen_id = 'ec500000-0000-0000-0000-000000000022' AND origen_evento = 'cuota_emitida'),
  'SINT-AUX prueba de corte');
SELECT public.chk_txt(public.ecc_fuera('2026-03-31'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00',
  'C5 · marzo cerrado, reverso hoy: al corte de marzo K22 está en el saldo, no en la lista');
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-03-31')), '0.00|200.00|30.00|170.00|3',
  'C5 · …y suma al saldo de marzo');
SELECT public.chk_txt(
  public.ecc_fila(CURRENT_DATE, 'ec500000-0000-0000-0000-000000000022', 'codigo') || '|' ||
  public.ecc_fila(CURRENT_DATE, 'ec500000-0000-0000-0000-000000000022', 'fecha'),
  'asiento_reversado|2026-03-05',
  'C5 · a hoy, fuera del saldo: asiento reversado con el documento vigente, con su póliza original');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, CURRENT_DATE, 500, 0)
    WHERE origen_id = 'ec500000-0000-0000-0000-000000000022' AND motivo LIKE '%reversado con fecha ' || CURRENT_DATE::text || '%'), 1,
  'C5 · …y el motivo da la fecha del reverso');

INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000023', :A, :A1, :U3, 'SINT-AUX K23', 60, '2026-05', 'pendiente', 'mantenimiento', '2026-05-05 12:00+00');
SELECT public.conta_anular_asiento(
  (SELECT id FROM public.conta_asientos WHERE origen_tabla = 'cuotas_condominio'
      AND origen_id = 'ec500000-0000-0000-0000-000000000023' AND origen_evento = 'cuota_emitida'),
  'SINT-AUX prueba de corte');
SELECT public.chk_txt(public.ecc_fuera('2026-05-04'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00',
  'C6 · corte ANTERIOR a la cuota: ni la cuota ni su reverso existen');
SELECT public.chk_txt(public.ecc_fuera('2026-05-31'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00,pendiente:cuotas_condominio:60.00',
  'C6 · mayo abierto: el reverso lleva la fecha del original; al corte de mayo, fuera del saldo');
SELECT public.chk_txt(public.ecc_fila('2026-05-31', 'ec500000-0000-0000-0000-000000000023', 'codigo'), 'asiento_reversado',
  'C6 · …como asiento reversado');
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-05-31')), '0.00|260.00|90.00|170.00|5',
  'C6 · el saldo muestra cargo y reverso: historia completa, efecto neto cero');

-- ── Documentos anulados DESPUÉS del corte ────────────────────────────────────
-- K24, sin asiento: al corte estaba vigente y pendiente.
DELETE FROM public.conta_config_tipo_cargo WHERE project_id = :A1 AND tipo_cargo = 'cuota_extraordinaria';
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000024', :A, :A1, :U3, 'SINT-AUX K24', 70, '2026-06', 'pendiente', 'cuota_extraordinaria', '2026-06-10 12:00+00');
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :A1, 'cuota_extraordinaria', '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
SELECT public.chk_txt(public.ecc_fila('2026-06-30', 'ec500000-0000-0000-0000-000000000024', 'codigo'), 'sin_intento_al_corte',
  'C7 · sin intento registrado a la fecha de corte: se dice, no se usa el de hoy como si fuera de entonces');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, '2026-06-30', 500, 0)
    WHERE origen_id = 'ec500000-0000-0000-0000-000000000024' AND motivo LIKE '%Motivo de hoy:%'), 1,
  'C7 · …y el motivo de hoy va rotulado como tal');
RESET ROLE;
-- El intento se registra al emitir; aquí la cuota se fechó hacia atrás, así
-- que se le da al intento la fecha real de la emisión.
UPDATE public.conta_intentos_contabilizacion SET created_at = '2026-06-10 12:00+00'
 WHERE origen_tabla = 'cuotas_condominio' AND origen_id = 'ec500000-0000-0000-0000-000000000024';
SET ROLE authenticated;
UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'ec500000-0000-0000-0000-000000000024';
SELECT public.chk_txt(public.ecc_fila('2026-06-30', 'ec500000-0000-0000-0000-000000000024', 'codigo'), 'sin_configuracion',
  'C7 · anulada HOY, al corte de junio seguía vigente y pendiente, con el motivo de ese momento');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, '2026-06-30', 500, 0)
    WHERE origen_id = 'ec500000-0000-0000-0000-000000000024' AND motivo LIKE '%se anuló después del corte%'), 1,
  'C7 · …y el motivo dice que se anuló después del corte');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, NULL, 500, 0)
    WHERE origen_id = 'ec500000-0000-0000-0000-000000000024'), 0,
  'C7 · sin corte (hoy), anulada: no se lista');

-- K25, con asiento: se anula hoy, el reverso (julio abierto) lleva 07-10.
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000025', :A, :A1, :U3, 'SINT-AUX K25', 45, '2026-07', 'pendiente', 'mantenimiento', '2026-07-10 12:00+00');
UPDATE public.cuotas_condominio SET deleted_at = now() WHERE id = 'ec500000-0000-0000-0000-000000000025';
SELECT public.chk_txt(
  public.ecc_fila('2026-07-31', 'ec500000-0000-0000-0000-000000000025', 'codigo') || '|' ||
  public.ecc_fila('2026-07-31', 'ec500000-0000-0000-0000-000000000025', 'fecha'),
  'asiento_reversado|2026-07-10',
  'C8 · anulada hoy con el mes abierto: al corte de julio estaba vigente y su reverso (fecha contable 07-10) ya la sacó del saldo');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, '2026-07-31', 500, 0)
    WHERE origen_id = 'ec500000-0000-0000-0000-000000000025' AND motivo LIKE 'Al corte seguía vigente; se anuló el %'), 1,
  'C8 · …y el motivo lo explica');
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-07-31')), '0.00|305.00|135.00|170.00|7',
  'C8 · el saldo de julio muestra el cargo y su reverso');
SELECT public.chk_txt(public.ecc_fuera('2026-07-31'),
  'contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00,pendiente:cuotas_condominio:45.00,pendiente:cuotas_condominio:60.00,pendiente:cuotas_condominio:70.00',
  'C8 · lista de julio completa');

-- ── Limitaciones: estados que no se pueden reconstruir al corte ─────────────
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, created_at) VALUES
  ('ec500000-0000-0000-0000-000000000026', :A, :A1, :U3, 'SINT-AUX K26', 50, '2026-08', 'pendiente', 'mantenimiento', '2026-08-05 12:00+00');
INSERT INTO public.pagos (id, cliente_id, project_id, cuota_id, monto, metodo, estado, verified_at) VALUES
  ('ec600000-0000-0000-0000-000000000022', :C3, :A1, 'ec500000-0000-0000-0000-000000000026', 80, 'efectivo', 'verificado', '2026-08-06 12:00+00');
SELECT public.chk_txt(public.ecc_fila(NULL, 'ec600000-0000-0000-0000-000000000022', 'codigo'), 'excede_saldo',
  'C9 · el cobro que excede está pendiente');
UPDATE public.pagos SET estado = 'rechazado' WHERE id = 'ec600000-0000-0000-0000-000000000022';

DELETE FROM public.conta_config_tipo_cargo WHERE project_id = :A1 AND tipo_cargo = 'adicional_reparacion';
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ec700000-0000-0000-0000-000000000020', :A, :A1, :U3, 'SINT-AUX CA20', 'reparacion', 15, '2026-08-07', 'pendiente');
UPDATE public.cargos_adicionales_unidad SET estado = 'anulado' WHERE id = 'ec700000-0000-0000-0000-000000000020';
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :A1, 'adicional_reparacion', '11000000-0000-0000-0000-00000000a101', '11000000-0000-0000-0000-00000000a103');
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado) VALUES
  ('ec700000-0000-0000-0000-000000000021', :A, :A1, :U3, 'SINT-AUX CA21', 'reparacion', 12, '2026-08-08', 'pendiente');
-- «pagado» marcado a mano ANTES de los cobros por cargo (20261004000000):
-- hoy el estado de un cargo por tipo se deriva de sus cobros y el guard
-- rechaza marcarlo a mano; el dato heredado se simula sin el guard.
RESET ROLE;
ALTER TABLE public.cargos_adicionales_unidad DISABLE TRIGGER trg_cargo_cobros_guard;
UPDATE public.cargos_adicionales_unidad SET estado = 'pagado' WHERE id = 'ec700000-0000-0000-0000-000000000021';
ALTER TABLE public.cargos_adicionales_unidad ENABLE TRIGGER trg_cargo_cobros_guard;
SET ROLE authenticated;

-- Desde 20261005000000 el rechazo de P22 (hoy, sin asiento) queda FECHADO por
-- el servidor: ya no es limitación, y al corte de agosto —anterior al
-- rechazo— el cobro figura como estaba. La anulación del cargo sin asiento y
-- el «pagado» de hoy siguen sin fecha. (El rechazo SIN evidencia, anterior a
-- la migración, se prueba en supabase/tests/conta_rechazo_cobros.)
SELECT public.chk_txt(public.ecc_limitaciones(public.ecc('2026-08-31')),
  'anulacion_sin_fecha:1:15.00,estado_actual_sin_fecha:1:12.00',
  'C9 · corte de agosto: la anulación sin fecha y el «pagado» de hoy se declaran como limitación; el rechazo fechado, no');
SELECT public.chk_txt(public.ecc_fila('2026-08-31', 'ec700000-0000-0000-0000-000000000021', 'limite'), 'estado_actual_sin_fecha',
  'C9 · …y la fila del cargo «pagado» dice que su estado es el de hoy');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, '2026-08-31', 500, 0)
    WHERE origen_id = 'ec700000-0000-0000-0000-000000000020'), 0,
  'C9 · lo que no se puede situar no se lista como pendiente');
SELECT public.chk_txt(
  public.ecc_fila('2026-08-31', 'ec600000-0000-0000-0000-000000000022', 'codigo') || '|' ||
  public.ecc_fila('2026-08-31', 'ec600000-0000-0000-0000-000000000022', 'estado'),
  -- P22 se inserta hoy con verified_at de agosto: su intento de
  -- contabilización (excede_saldo) es de HOY, así que al corte de agosto no
  -- había intento todavía.
  'sin_intento_al_corte|rechazado',
  'C9 · el cobro rechazado HOY estaba pendiente al corte de agosto, y se dice su estado de hoy');
SELECT public.chk(
  (SELECT count(*) FROM (SELECT public.ecc_fila('2026-08-31', 'ec600000-0000-0000-0000-000000000022', 'motivo') AS m) x
    WHERE m LIKE '%El cobro se rechazó después del corte, el ' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '.'), 1,
  'C9 · …con la fecha de su rechazo');
SELECT public.chk_txt(public.ecc_limitaciones(public.ecc(NULL)) || '|' || public.ecc_limitaciones(public.ecc(CURRENT_DATE)), '|',
  'C9 · sin corte o al corte de hoy, el estado de hoy es el pedido: sin limitaciones');
SELECT public.chk_txt(public.ecc_fila(NULL, 'ec700000-0000-0000-0000-000000000021', 'limite'), '-',
  'C9 · …ni marca en la fila');

-- ── Saldos y lista al corte de agosto, de ayer y de hoy ──────────────────────
SELECT public.chk_txt(public.ec_resumen(public.ecc('2026-08-31')), '0.00|367.00|135.00|232.00|9',
  'C10 · corte de agosto');
SELECT public.chk_txt(public.ec_resumen(public.ecc(CURRENT_DATE - 1)), '0.00|367.00|135.00|232.00|9',
  'C10 · corte de ayer: nada de lo fechado hoy');
-- «pendiente:pagos:80.00» es P22: rechazado HOY sin asiento; desde
-- 20261005000000 su rechazo está fechado y ayer seguía vigente (antes no se
-- podía situar y faltaba en todos los cortes).
SELECT public.chk_txt(public.ecc_fuera(CURRENT_DATE - 1),
  'cobro_sin_vinculo:cargos_adicionales_unidad:12.00,contabilizado_despues:cuotas_condominio:40.00,contabilizado_despues:pagos:20.00,pendiente:cuotas_condominio:45.00,pendiente:cuotas_condominio:60.00,pendiente:cuotas_condominio:70.00,pendiente:pagos:80.00',
  'C10 · lista de ayer: lo contabilizado hoy, fuera; lo anulado o rechazado hoy, vigente');
SELECT public.chk_txt(public.ec_resumen(public.ecc(CURRENT_DATE)), '0.00|437.00|255.00|182.00|13',
  'C10 · corte de hoy');
SELECT public.chk_txt(public.ecc_fuera(CURRENT_DATE),
  'cobro_sin_vinculo:cargos_adicionales_unidad:12.00,pendiente:cuotas_condominio:60.00,pendiente:cuotas_condominio:100.00',
  'C10 · lista de hoy: sólo lo que hoy sigue fuera');
SELECT public.chk_txt(public.ecc_fuera(NULL), public.ecc_fuera(CURRENT_DATE),
  'C10 · sin corte = corte de hoy');
SELECT public.chk_txt(public.ec_resumen(public.ec(:A1, NULL, :U3, NULL, '2026-01-31')) || ' / ' ||
                      public.ec_resumen(public.ec(:A1, NULL, :U3, NULL, CURRENT_DATE)),
  '0.00|0.00|0.00|0.00|0 / 0.00|437.00|255.00|182.00|13', 'C10 · por unidad, mismos saldos al corte');
SELECT public.chk(
  (SELECT count(DISTINCT total_filas) FROM generate_series(0, 4) o,
     public.conta_estado_cuenta_pendientes(:A1, :C3, NULL, '2026-07-31', 1, o)), 1,
  'C10 · la lista al corte cuenta el total en el servidor, igual en cada página');
SELECT public.chk(
  (SELECT count(DISTINCT public.ec(:A1, :C3, NULL, NULL, '2026-07-31', 2, o)->'resumen') FROM generate_series(0, 6, 2) o), 1,
  'C10 · el resumen al corte es idéntico en todas las páginas');

-- ── La conciliación cuadra en cada corte ─────────────────────────────────────
SELECT public.chk_txt(
  (SELECT string_agg(concat_ws(':', c.corte, j->>'saldo_contable', j->>'saldo_documentos', j->>'cuadra'), ',' ORDER BY c.corte)
     FROM (VALUES (DATE '2026-01-31'), (DATE '2026-02-28'), (DATE '2026-05-31'), (DATE '2026-07-31'),
                  (CURRENT_DATE - 1), (CURRENT_DATE)) c(corte),
          LATERAL (SELECT public.conta_estado_cuenta_conciliacion(:A1, :C3, NULL, c.corte) j) x),
  '2026-01-31:0.00:0.00:true,2026-02-28:70.00:70.00:true,2026-05-31:170.00:170.00:true,2026-07-31:170.00:170.00:true,'
    || (CURRENT_DATE - 1)::text || ':232.00:232.00:true,' || CURRENT_DATE::text || ':182.00:182.00:true',
  'C11 · el saldo al corte concilia con documentos y aplicaciones en cada corte');

RESET ROLE;
