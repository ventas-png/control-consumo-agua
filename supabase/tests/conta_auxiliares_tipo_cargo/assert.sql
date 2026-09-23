\set ON_ERROR_STOP on

-- ============================================================================
-- INVARIANTES
--
-- Cada bloque prueba UNA cosa y dice cuál. Los rechazos usan `chk_falla`, que
-- exige que falle POR LA RAZÓN ESPERADA. Todo corre como `authenticated` con
-- un usuario de la aplicación; el superusuario sólo lee resultados.
-- ============================================================================

\set A      '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set B      '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set PA1    '''a1a1a1a1-0000-0000-0000-000000000001'''
\set PA2    '''a2a2a2a2-0000-0000-0000-000000000001'''
\set PB1    '''b1b1b1b1-0000-0000-0000-000000000001'''
\set ADMIN_A    'a0a0a0a0-0000-0000-0000-00000000000a'
\set CONTADOR_A 'a0a0a0a0-0000-0000-0000-00000000000c'
\set OPERADOR_A 'a0a0a0a0-0000-0000-0000-00000000000d'
\set VISOR_A    'a0a0a0a0-0000-0000-0000-00000000000e'
\set ADMIN_B    'b0b0b0b0-0000-0000-0000-00000000000b'
\set C1 '''e0000000-0000-0000-0000-00000000a001'''
\set C2 '''e0000000-0000-0000-0000-00000000a002'''
\set C3 '''e0000000-0000-0000-0000-00000000a003'''
\set CB '''e0000000-0000-0000-0000-00000000b001'''
\set U1 '''f0000000-0000-0000-0000-00000000a001'''
\set U2 '''f0000000-0000-0000-0000-00000000a002'''
\set U3 '''f0000000-0000-0000-0000-00000000a201'''
\set UB '''f0000000-0000-0000-0000-00000000b001'''
\set CXC     '''11000000-0000-0000-0000-00000000a101'''
\set CXC_OFF '''11000000-0000-0000-0000-00000000a107'''
\set AGRUP   '''11000000-0000-0000-0000-00000000a106'''
\set ING_M   '''11000000-0000-0000-0000-00000000a102'''
\set ING_E   '''11000000-0000-0000-0000-00000000a103'''
\set ING_A   '''11000000-0000-0000-0000-00000000a104'''
\set IVA     '''11000000-0000-0000-0000-00000000a105'''
\set GTO     '''11000000-0000-0000-0000-00000000a108'''
\set CXC_EMP '''11000000-0000-0000-0000-00000000a001'''
\set Z_CXC   '''11000000-0000-0000-0000-00000000a201'''
\set Z_ING   '''11000000-0000-0000-0000-00000000a202'''
\set CXC_B   '''11000000-0000-0000-0000-00000000b101'''
\set ING_B   '''11000000-0000-0000-0000-00000000b102'''

-- ── 0. Punto de partida ─────────────────────────────────────────────────────
SELECT public.chk((SELECT count(*) FROM public.conta_tipos_cargo()), 10,
  '0 · el catálogo declara 10 tipos de cargo');
SELECT public.chk((SELECT count(*) FROM public.conta_tipos_cargo()
                    WHERE tipo_cargo ~ '(deposito|anticipo)'), 0,
  '0 · sin depósitos ni anticipos en el catálogo');
SELECT public.chk((SELECT count(*) FROM public.conta_tipos_cargo() WHERE admite_impuesto), 1,
  '0 · sólo un tipo (agua) admite impuesto');
SELECT public.chk((SELECT count(*) FROM public.conta_config_tipo_cargo), 0,
  '0 · la configuración nace vacía (sin backfill)');
SELECT public.chk((SELECT count(*) FROM public.conta_auxiliares), 0,
  '0 · la nomenclatura de auxiliares nace vacía');

-- ════════════════════════════════════════════════════════════════════════════
-- Admin A, como usuario de la aplicación
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub', :'ADMIN_A', false);
SET ROLE authenticated;

-- ── 1. Dos clientes comparten la cuenta por cobrar sin compartir movimientos ─
-- Una póliza manual del ledger A1 con dos cargos a la MISMA cuenta de CxC, uno
-- por auxiliar. El saldo por auxiliar los separa; el saldo de la cuenta los
-- suma. Nadie necesitó una cuenta por cliente.
INSERT INTO public.conta_asientos (id, company_id, project_id, concepto)
VALUES ('5a000000-0000-0000-0000-000000000001', :A, :PA1, 'SINT-AUX póliza de auxiliares');

INSERT INTO public.conta_asiento_lineas
  (asiento_id, company_id, cuenta_id, orden, debe, haber, auxiliar_cliente_id, unidad_id, tipo_cargo) VALUES
  ('5a000000-0000-0000-0000-000000000001', :A, :CXC,   1, 100, 0,   :C1,  :U1,  'mantenimiento'),
  ('5a000000-0000-0000-0000-000000000001', :A, :CXC,   2, 250, 0,   :C2,  :U2,  'mantenimiento'),
  ('5a000000-0000-0000-0000-000000000001', :A, :ING_M, 3, 0,   350, NULL, NULL, 'mantenimiento');

SELECT public.chk(
  (SELECT sum(debe - haber)::bigint FROM public.conta_asiento_lineas
    WHERE cuenta_id = :CXC AND auxiliar_cliente_id = :C1), 100,
  '1 · el auxiliar Uno ve sólo sus 100 en la CxC compartida');
SELECT public.chk(
  (SELECT sum(debe - haber)::bigint FROM public.conta_asiento_lineas
    WHERE cuenta_id = :CXC AND auxiliar_cliente_id = :C2), 250,
  '1 · el auxiliar Dos ve sólo sus 250 en la misma cuenta');
SELECT public.chk(
  (SELECT sum(debe - haber)::bigint FROM public.conta_asiento_lineas WHERE cuenta_id = :CXC), 350,
  '1 · la cuenta acumula los dos auxiliares');
SELECT public.chk(
  (SELECT count(DISTINCT cuenta_id) FROM public.conta_asiento_lineas
    WHERE auxiliar_cliente_id IN (:C1, :C2)), 1,
  '1 · los dos auxiliares comparten UNA cuenta, no una por cliente');

-- Las dimensiones no admiten referencias cruzadas.
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber, auxiliar_cliente_id)
  VALUES ('5a000000-0000-0000-0000-000000000001', %L, %L, 9, 1, 0, %L)$q$, :A, :CXC, :CB),
  'CONTA_AUXILIAR_AJENO', '1 · un cliente de la empresa B no puede ser auxiliar en A');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber, unidad_id)
  VALUES ('5a000000-0000-0000-0000-000000000001', %L, %L, 9, 1, 0, %L)$q$, :A, :CXC, :U3),
  'CONTA_UNIDAD_AJENA', '1 · una unidad del proyecto A2 no entra en la póliza del ledger A1');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber, unidad_id)
  VALUES ('5a000000-0000-0000-0000-000000000001', %L, %L, 9, 1, 0, %L)$q$, :A, :CXC, :UB),
  'CONTA_UNIDAD_AJENA', '1 · una unidad de la empresa B tampoco');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_asiento_lineas (asiento_id, company_id, cuenta_id, orden, debe, haber, tipo_cargo)
  VALUES ('5a000000-0000-0000-0000-000000000001', %L, %L, 9, 1, 0, 'deposito')$q$, :A, :CXC),
  'CONTA_TIPO_CARGO_DESCONOCIDO', '1 · un tipo de cargo fuera del catálogo se rechaza');

-- ── 2. Un cliente con varias unidades ───────────────────────────────────────
-- Uno es propietario de 101 y 102; Dos es arrendatario de 101.
INSERT INTO public.unidad_residentes (unidad_id, cliente_id, company_id, project_id, tipo, activo, responsable_pago) VALUES
  (:U1, :C1, :A, :PA1, 'propietario',  true, true),
  (:U2, :C1, :A, :PA1, 'propietario',  true, true),
  (:U1, :C2, :A, :PA1, 'arrendatario', true, false);

SELECT public.chk(
  (SELECT count(*) FROM public.unidad_residentes WHERE cliente_id = :C1 AND activo), 2,
  '2 · el cliente Uno está relacionado con dos unidades');

-- Una cuota en cada unidad: las dos se le atribuyen a Uno, que es el pagador
-- designado de ambas.
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c0000000-0000-0000-0000-0000000000a1', :A, :PA1, :U1, 'SINT-AUX mant 101', 50, '2026-10', 'pendiente', 'mantenimiento'),
  ('c0000000-0000-0000-0000-0000000000a2', :A, :PA1, :U2, 'SINT-AUX mant 102', 60, '2026-10', 'pendiente', 'mantenimiento');

SELECT public.chk(
  (SELECT count(*) FROM public.cuotas_condominio
    WHERE id IN ('c0000000-0000-0000-0000-0000000000a1','c0000000-0000-0000-0000-0000000000a2')
      AND responsable_cliente_id = :C1 AND responsable_origen = 'designado'), 2,
  '2 · las cuotas de sus dos unidades quedan a nombre de Uno (pagador designado)');

-- Un pagador designado por unidad, y activo.
SELECT public.chk_falla(format($q$
  UPDATE public.unidad_residentes SET responsable_pago = true
   WHERE unidad_id = %L AND cliente_id = %L$q$, :U1, :C2),
  'uq_unidad_residentes_responsable_pago', '2 · no puede haber dos pagadores designados en la misma unidad');
SELECT public.chk_falla(format($q$
  UPDATE public.unidad_residentes SET activo = false
   WHERE unidad_id = %L AND cliente_id = %L$q$, :U2, :C1),
  'unidad_residentes_responsable_activo', '2 · un pagador designado no puede quedar inactivo');

-- ── 3. El cambio de titular no toca el responsable de cargos anteriores ─────
-- 101 cambia de manos: Uno deja de ser pagador y lo pasa a ser Dos.
UPDATE public.unidad_residentes SET responsable_pago = false WHERE unidad_id = :U1 AND cliente_id = :C1;
UPDATE public.unidad_residentes SET responsable_pago = true  WHERE unidad_id = :U1 AND cliente_id = :C2;

SELECT public.chk_uuid(
  (SELECT responsable_cliente_id FROM public.cuotas_condominio WHERE id = 'c0000000-0000-0000-0000-0000000000a1'),
  :C1::uuid, '3 · la cuota emitida antes del cambio sigue a nombre de Uno');

INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo) VALUES
  ('c0000000-0000-0000-0000-0000000000a3', :A, :PA1, :U1, 'SINT-AUX mant 101 nov', 50, '2026-11', 'pendiente', 'mantenimiento');
SELECT public.chk_uuid(
  (SELECT responsable_cliente_id FROM public.cuotas_condominio WHERE id = 'c0000000-0000-0000-0000-0000000000a3'),
  :C2::uuid, '3 · la cuota emitida después va al nuevo pagador, Dos');

SELECT public.chk_falla(format($q$
  UPDATE public.cuotas_condominio SET responsable_cliente_id = %L
   WHERE id = 'c0000000-0000-0000-0000-0000000000a1'$q$, :C2),
  'RESPONSABLE_INMUTABLE', '3 · el responsable histórico no se reasigna a mano');

-- El rol del cargo manda sobre el pagador: una extraordinaria para el
-- propietario de 101 va a Uno aunque el pagador designado sea Dos.
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, tipo_cargo, rol_responsable) VALUES
  ('c0000000-0000-0000-0000-0000000000a4', :A, :PA1, :U1, 'SINT-AUX extra 101', 500, '2026-11', 'pendiente', 'cuota_extraordinaria', 'propietario');
SELECT public.chk_txt(
  (SELECT responsable_cliente_id::text || '/' || responsable_origen FROM public.cuotas_condominio
    WHERE id = 'c0000000-0000-0000-0000-0000000000a4'),
  'e0000000-0000-0000-0000-00000000a001/rol', '3 · con rol propietario el cargo va al propietario, no al pagador');

-- Sin candidato único: no se adivina. Nadie tiene rol «familiar» en 101.
INSERT INTO public.cuotas_condominio (id, company_id, project_id, unidad_id, concepto, monto, periodo, estado, rol_responsable) VALUES
  ('c0000000-0000-0000-0000-0000000000a5', :A, :PA1, :U1, 'SINT-AUX sin candidato', 10, '2026-11', 'pendiente', 'familiar');
SELECT public.chk_txt(
  (SELECT coalesce(responsable_cliente_id::text, 'NULL') || '/' || responsable_origen FROM public.cuotas_condominio
    WHERE id = 'c0000000-0000-0000-0000-0000000000a5'),
  'NULL/sin_candidato', '3 · sin candidato único queda sin responsable, y se dice');

-- …y se puede asignar UNA vez, a alguien relacionado con la unidad.
SELECT public.chk_falla(format($q$
  UPDATE public.cuotas_condominio SET responsable_cliente_id = %L
   WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$q$, :C3),
  'RESPONSABLE_AJENO', '3 · no se puede asignar a un cliente sin relación con la unidad');
UPDATE public.cuotas_condominio SET responsable_cliente_id = :C1
 WHERE id = 'c0000000-0000-0000-0000-0000000000a5';
SELECT public.chk_txt(
  (SELECT responsable_origen FROM public.cuotas_condominio WHERE id = 'c0000000-0000-0000-0000-0000000000a5'),
  'explicito', '3 · la asignación posterior queda marcada como explícita');
SELECT public.chk_falla(format($q$
  UPDATE public.cuotas_condominio SET responsable_cliente_id = %L
   WHERE id = 'c0000000-0000-0000-0000-0000000000a5'$q$, :C2),
  'RESPONSABLE_INMUTABLE', '3 · y ya no cambia');

-- Cargos adicionales: van al pagador designado.
INSERT INTO public.cargos_adicionales_unidad (id, company_id, project_id, unidad_id, concepto, categoria, monto, fecha_cargo, estado)
VALUES ('ca000000-0000-0000-0000-000000000001', :A, :PA1, :U2, 'SINT-AUX reparación', 'reparacion', 80, CURRENT_DATE, 'pendiente');
SELECT public.chk_txt(
  (SELECT responsable_cliente_id::text || '/' || responsable_origen FROM public.cargos_adicionales_unidad
    WHERE id = 'ca000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-00000000a001/designado', '3 · un cargo adicional va al pagador designado de su unidad');

-- Un responsable explícito de otra empresa se rechaza al emitir.
SELECT public.chk_falla(format($q$
  INSERT INTO public.cuotas_condominio (company_id, project_id, unidad_id, concepto, monto, periodo, estado, responsable_cliente_id)
  VALUES (%L, %L, %L, 'SINT-AUX ajeno', 5, '2026-11', 'pendiente', %L)$q$, :A, :PA1, :U1, :CB),
  'RESPONSABLE_AJENO', '3 · un responsable de otra empresa se rechaza');

-- ── 4. Dos tipos de cargo con configuraciones distintas ─────────────────────
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id) VALUES
  (:A, :PA1, 'mantenimiento',        :CXC, :ING_M),
  (:A, :PA1, 'cuota_extraordinaria', :CXC, :ING_E);
SELECT public.chk(
  (SELECT count(DISTINCT cuenta_ingreso_id) FROM public.conta_config_tipo_cargo
    WHERE company_id = :A AND project_id = :PA1), 2,
  '4 · mantenimiento y extraordinaria tienen ingresos distintos');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_config_tipos_cargo_estado(:PA1) WHERE estado = 'ok'), 2,
  '4 · y el estado los reporta servibles');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_config_tipos_cargo_estado(:PA1) WHERE estado = 'sin_configurar'), 8,
  '4 · los demás tipos aparecen como sin configurar');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'mantenimiento', %L, %L)$q$, :A, :PA1, :CXC, :ING_E),
  'uq_conta_config_tipo_cargo_ledger', '4 · un tipo tiene UNA configuración por contabilidad');
SELECT public.chk_falla(format($q$
  UPDATE public.conta_config_tipo_cargo SET tipo_cargo = 'agua'
   WHERE company_id = %L AND project_id = %L AND tipo_cargo = 'mantenimiento'$q$, :A, :PA1),
  'CONFIG_IDENTIDAD_INMUTABLE', '4 · el tipo de una configuración no se cambia');

-- Agua es el único con impuesto; los demás lo rechazan.
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id, cuenta_impuesto_id)
VALUES (:A, :PA1, 'agua', :CXC, :ING_A, :IVA);
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id, cuenta_impuesto_id)
  VALUES (%L, %L, 'adicional_multa', %L, %L, %L)$q$, :A, :PA1, :CXC, :ING_M, :IVA),
  'CONFIG_IMPUESTO_NO_SOPORTADO', '4 · un tipo sin tratamiento de impuesto no acepta cuenta de impuesto');

-- ── 5. Un catálogo personalizado funciona sin códigos predeterminados ───────
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
VALUES (:A, :PA2, 'mantenimiento', :Z_CXC, :Z_ING);
SELECT public.chk(
  (SELECT count(*) FROM public.conta_config_tipos_cargo_estado(:PA2)
    WHERE tipo_cargo = 'mantenimiento' AND estado = 'ok'), 1,
  '5 · Z-COBRAR / Z-VENTAS sirven: nada depende de un código fijo');

-- ── 6. Cuentas que no sirven ────────────────────────────────────────────────
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_dano', %L, %L)$q$, :A, :PA1, :CXC_OFF, :ING_M),
  'CONFIG_CUENTA_INACTIVA', '6 · cuenta inactiva rechazada');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_dano', %L, %L)$q$, :A, :PA1, :AGRUP, :ING_M),
  'CONFIG_CUENTA_AGRUPADORA', '6 · cuenta agrupadora rechazada');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_dano', %L, %L)$q$, :A, :PA1, :CXC_EMP, :ING_M),
  'CONFIG_LEDGER', '6 · cuenta del ledger de EMPRESA en la configuración del proyecto: rechazada');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_dano', %L, %L)$q$, :A, :PA1, :Z_CXC, :ING_M),
  'CONFIG_LEDGER', '6 · cuenta de otro proyecto de la misma empresa: rechazada');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_dano', %L, %L)$q$, :A, :PA1, :ING_M, :ING_E),
  'CONFIG_TIPO_CUENTA', '6 · un ingreso como cuenta por cobrar: rechazado');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_dano', %L, %L)$q$, :A, :PA1, :CXC, :GTO),
  'CONFIG_TIPO_CUENTA', '6 · un gasto como cuenta de ingreso: rechazado');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'deposito_garantia', %L, %L)$q$, :A, :PA1, :CXC, :ING_M),
  'CONFIG_TIPO_DESCONOCIDO', '6 · un tipo fuera del catálogo (depósito) se rechaza');

RESET ROLE;
-- La cuenta se desactiva DESPUÉS de configurada: el estado tiene que verlo.
UPDATE public.conta_cuentas SET activa = false WHERE id = :ING_E;
SET ROLE authenticated;
SELECT public.chk_txt(
  (SELECT estado FROM public.conta_config_tipos_cargo_estado(:PA1) WHERE tipo_cargo = 'cuota_extraordinaria'),
  'cuenta_invalida', '6 · una cuenta desactivada después de configurar se reporta');
RESET ROLE;
UPDATE public.conta_cuentas SET activa = true WHERE id = :ING_E;
SET ROLE authenticated;

-- ── Nomenclatura de auxiliares ──────────────────────────────────────────────
INSERT INTO public.conta_auxiliares (company_id, cliente_id) VALUES (:A, :C1);
INSERT INTO public.conta_auxiliares (company_id, cliente_id) VALUES (:A, :C2);
SELECT public.chk_txt(
  (SELECT string_agg(codigo, ',' ORDER BY codigo) FROM public.conta_auxiliares WHERE company_id = :A),
  'AUX-00001,AUX-00002', 'aux · código automático independiente del catálogo');
UPDATE public.conta_auxiliares SET codigo = 'TORRE1-101' WHERE cliente_id = :C1 AND company_id = :A;
SELECT public.chk_falla(format($q$
  UPDATE public.conta_auxiliares SET codigo = 'torre1-101' WHERE cliente_id = %L AND company_id = %L$q$, :C2, :A),
  'uq_conta_auxiliares_codigo', 'aux · el código es único por empresa, sin distinguir mayúsculas');
SELECT public.chk_falla(format($q$
  UPDATE public.conta_auxiliares SET cliente_id = %L WHERE cliente_id = %L AND company_id = %L$q$, :C3, :C1, :A),
  'AUXILIAR_IDENTIDAD_INMUTABLE', 'aux · el cliente de un auxiliar no cambia');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_auxiliares (company_id, cliente_id) VALUES (%L, %L)$q$, :A, :CB),
  'conta_auxiliares_cliente_de_la_empresa', 'aux · no se nombra en A a un cliente que sólo es de B');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asiento_lineas l
     JOIN public.conta_auxiliares x ON x.cliente_id = l.auxiliar_cliente_id AND x.company_id = l.company_id
    WHERE x.codigo = 'TORRE1-101'), 1,
  'aux · renombrar el código no toca los movimientos (se enlazan por id)');

RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Usuarios sin permiso no cambian configuración
-- ════════════════════════════════════════════════════════════════════════════
-- Contador: operador con permiso RBAC → sí puede.
SELECT set_config('request.jwt.claim.sub', :'CONTADOR_A', false);
SET ROLE authenticated;
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
VALUES (:A, :PA1, 'recargo_mora', :CXC, :ING_M);
SELECT public.chk(
  (SELECT count(*) FROM public.conta_config_tipo_cargo WHERE tipo_cargo = 'recargo_mora' AND project_id = :PA1), 1,
  '7 · el contador con permiso platform.contabilidad.create configura');
SELECT public.chk(
  public.filas_afectadas(format($q$UPDATE public.conta_config_tipo_cargo SET notas = 'SINT-AUX contador'
    WHERE tipo_cargo = 'recargo_mora' AND project_id = %L$q$, :PA1)), 1,
  '7 · y edita (platform.contabilidad.edit)');
RESET ROLE;

-- Visor contable: ve, no escribe.
SELECT set_config('request.jwt.claim.sub', :'VISOR_A', false);
SET ROLE authenticated;
SELECT public.chk(
  (SELECT count(*) FROM public.conta_config_tipo_cargo WHERE company_id = :A), 5,
  '7 · el visor contable ve la configuración de su empresa');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_otro', %L, %L)$q$, :A, :PA1, :CXC, :ING_M),
  'row-level security', '7 · el visor contable NO inserta configuración');
SELECT public.chk(
  public.filas_afectadas(format($q$UPDATE public.conta_config_tipo_cargo SET cuenta_ingreso_id = %L
    WHERE tipo_cargo = 'mantenimiento' AND project_id = %L$q$, :ING_E, :PA1)), 0,
  '7 · el visor contable NO edita configuración (0 filas)');
SELECT public.chk(
  public.filas_afectadas(format($q$DELETE FROM public.conta_config_tipo_cargo WHERE company_id = %L$q$, :A)), 0,
  '7 · el visor contable NO borra configuración (0 filas)');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_auxiliares (company_id, cliente_id) VALUES (%L, %L)$q$, :A, :C3),
  'row-level security', '7 · el visor contable NO asigna nomenclatura');
RESET ROLE;

-- Operador sin permiso contable.
SELECT set_config('request.jwt.claim.sub', :'OPERADOR_A', false);
SET ROLE authenticated;
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_otro', %L, %L)$q$, :A, :PA1, :CXC, :ING_M),
  'row-level security', '7 · el operador sin permiso contable NO configura');
SELECT public.chk(
  public.filas_afectadas(format($q$UPDATE public.conta_auxiliares SET codigo = 'HACK' WHERE company_id = %L$q$, :A)), 0,
  '7 · ni cambia la nomenclatura de auxiliares (0 filas)');
-- Las funciones internas no son invocables desde la aplicación.
SELECT public.chk_falla(format($q$SELECT * FROM public.responsable_resolver_de_unidad(%L, NULL)$q$, :U1),
  'permission denied', '7 · el resolutor de responsable es interno');
SELECT public.chk_falla(format($q$SELECT public.responsable_valido_para_unidad(%L, %L, %L)$q$, :A, :U1, :C1),
  'permission denied', '7 · el validador de responsable es interno');
RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Aislamiento entre empresas
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub', :'ADMIN_B', false);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.conta_config_tipo_cargo), 0,
  '8 · el admin de B no ve la configuración de A');
SELECT public.chk((SELECT count(*) FROM public.conta_auxiliares), 0,
  '8 · ni la nomenclatura de A');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'adicional_otro', %L, %L)$q$, :A, :PA1, :CXC, :ING_M),
  'row-level security', '8 · el admin de B no escribe configuración en A');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'mantenimiento', %L, %L)$q$, :B, :PB1, :CXC, :ING_B),
  'CONFIG_LEDGER', '8 · ni apunta su configuración a una cuenta de A');
SELECT public.chk_falla(format($q$
  INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
  VALUES (%L, %L, 'mantenimiento', %L, %L)$q$, :B, :PA1, :CXC_B, :ING_B),
  'CONFIG_PROYECTO_AJENO', '8 · ni declara un proyecto de A como su ledger');
SELECT public.chk_falla(format($q$SELECT * FROM public.conta_config_tipos_cargo_estado(%L)$q$, :PA1),
  'no pertenece a la empresa activa', '8 · ni consulta el estado de un ledger de A');
SELECT public.chk(
  public.filas_afectadas(format($q$UPDATE public.conta_config_tipo_cargo SET activa = false WHERE company_id = %L$q$, :A)), 0,
  '8 · ni desactiva la configuración de A (0 filas)');
-- Su propia configuración, en su ledger, sí.
INSERT INTO public.conta_config_tipo_cargo (company_id, project_id, tipo_cargo, cuenta_cxc_id, cuenta_ingreso_id)
VALUES (:B, :PB1, 'mantenimiento', :CXC_B, :ING_B);
SELECT public.chk((SELECT count(*) FROM public.conta_config_tipo_cargo), 1,
  '8 · y configura su propio ledger, que es lo único que ve');
RESET ROLE;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Auditoría y comportamiento existente intacto
-- ════════════════════════════════════════════════════════════════════════════
SELECT public.chk(
  (SELECT count(*) FROM public.audit_log WHERE table_name = 'conta_config_tipo_cargo'), 7,
  '9 · cada alta y edición de configuración queda auditada');
SELECT public.chk(
  (SELECT count(*) FROM public.audit_log WHERE table_name = 'unidad_residentes'
      AND action = 'UPDATE' AND (after->>'responsable_pago') IS DISTINCT FROM (before->>'responsable_pago')), 2,
  '9 · el cambio de pagador designado queda auditado');
SELECT public.chk(
  (SELECT count(*) FROM public.conta_reglas_cargo), 0,
  '9 · conta_reglas_cargo sigue sin filas ni consumidor: no hay precedencia implícita');
-- Las cuotas ya disparaban su trigger contable y lo siguen haciendo igual: sin
-- mapeo de cxc_cuotas no se asienta nada, exactamente como antes.
SELECT public.chk(
  (SELECT count(*) FROM public.conta_asientos
    WHERE origen_tabla = 'cuotas_condominio'
      AND origen_id IN (SELECT id FROM public.cuotas_condominio WHERE concepto LIKE 'SINT-AUX%')), 0,
  '9 · sin mapeo de eventos, las cuotas no generan asiento (comportamiento previo)');
