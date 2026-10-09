\set ON_ERROR_STOP on
-- ============================================================================
-- EV-09 · Los triggers SECURITY DEFINER BEFORE corren ANTES de la RLS de INSERT/UPDATE y
--         devuelven en el error datos de documentos de OTRA empresa.
--
-- CAUSA RAÍZ
--   PostgreSQL evalúa el WITH CHECK de las políticas de INSERT/UPDATE DESPUÉS de los triggers
--   BEFORE ROW. Los triggers de 20261027000000/0100/0400 (y los preexistentes del circuito)
--   leen con privilegios de dueño, sin filtrar por empresa, y ponen en el mensaje número,
--   fecha, importe, saldo y estado de facturas, nombre y código de proveedores, número y total
--   de contraseñas… de la empresa D. Un usuario de C (o el rol `anon`) que conoce los UUID
--   de empresa/proveedor/factura de D los lee. Antes del PR el mismo INSERT moría en la RLS.
--
-- COMPORTAMIENTO ESPERADO
--   a. Una fila con la empresa de OTRO (INSERT, o UPDATE que la mueve) muere con EL MISMO
--      error de la RLS —42501 «new row violates row-level security policy for table "x"»—
--      sin que ningún trigger lea nada ajeno. También para `anon`.
--   b. Una fila de C que REFERENCIA un documento de D (contraseña, factura) se rechaza con el
--      código genérico `…_AJENA`, sin número, total ni estado del documento de D.
--   c. proveedor_habilitado() no responde por proveedores de otra empresa.
--   d. recepcion_respaldos: la recepción de otra empresa no se sondea (estado, tipo, ruta), y el
--      INSERT directo de un respaldo de una recepción PROPIA (sin company_id: lo deriva el
--      servidor) sigue llegando a su propia validación.
--   e. Dentro de la MISMA empresa, el mensaje no nombra número/importe/saldo/estado de un
--      documento de un proyecto que la persona no ve; quien sí lo ve sigue recibiendo el
--      mensaje completo.
--   f. El guardián es el PRIMER trigger BEFORE de cada tabla (orden alfabético).
--   g. LEGÍTIMO (no se prohíbe nada válido): las filas de la propia empresa, super_admin, el
--      rol de servicio y una RPC SECURITY DEFINER siguen escribiendo; el ciclo de pago de una
--      factura propia sigue funcionando; el administrador de D ve el detalle de SUS documentos.
--
-- Ids propios: fa709000-0000-0000-0000-0000000000XX
-- ============================================================================
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set D   '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set D1  '''d1d1d1d1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UD  '''d0d0d0d0-0000-0000-0000-00000000000d'''
\set P1  '''e3000000-0000-0000-0000-000000000001'''
\set PD  '''e3000000-0000-0000-0000-0000000000d1'''
\set PS  '''fa709000-0000-0000-0000-0000000000a1'''
\set PX  '''fa709000-0000-0000-0000-0000000000a2'''
\set UX  '''fa709000-0000-0000-0000-0000000000f1'''
\set USA '''fa709000-0000-0000-0000-0000000000f2'''

-- ── Ayuda local: el SQL debe FALLAR con ese SQLSTATE y ese mensaje, y el mensaje no puede
--    nombrar ningún dato «secreto» (a menos que se pida: lo ve su propio dueño).
CREATE OR REPLACE FUNCTION public.h7_falla(p_sql text, p_estado text, p_patron text, p_msg text, p_ve_secretos boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_estado AND SQLERRM ~ p_patron
       AND (p_ve_secretos OR SQLERRM !~* '(SEC-|Secreto|7777|4321|OCULTA|5555)') THEN
      RAISE NOTICE '✓ % (%)', p_msg, left(SQLERRM, 90);
      RETURN;
    END IF;
    RAISE EXCEPTION '% — falló con % «%», y se esperaba % «%» sin datos ajenos', p_msg, SQLSTATE, left(SQLERRM, 260), p_estado, p_patron;
  END;
  RAISE EXCEPTION '% — NO falló, y tenía que fallar', p_msg;
END;
$$;

-- ── Datos (superusuario, sin disparar triggers) ─────────────────────────────
SET session_replication_role = replica;
-- Empresa D: documentos con datos «secretos» que un usuario de C no debe poder leer.
INSERT INTO proveedores (id,company_id,nombre,nit,pais,alcance,estado,codigo) VALUES
  ('fa709000-0000-0000-0000-0000000000a1', :D, 'Secreto Autorizado 7', '7777777-7', 'GT', 'empresa', 'autorizado', 'SEC-PRV-7'),
  ('fa709000-0000-0000-0000-0000000000a2', :D, 'Secreto Suspendido 7', '7777778-8', 'GT', 'empresa', 'suspendido', 'SEC-PRV-8');
INSERT INTO ordenes_compra (id,company_id,project_id,proveedor_id,proveedor_nombre,concepto,estado,numero,correlativo) VALUES
  ('fa709000-0000-0000-0000-0000000000b1', :D, :D1, :PS, 'Secreto Autorizado 7', 'OC secreta 7777', 'emitida', 'OC-SEC-7777', 7777);
INSERT INTO orden_compra_lineas (id,company_id,orden_compra_id,linea,descripcion,destino_tipo,categoria,cantidad,unidad,precio_unitario) VALUES
  ('fa709000-0000-0000-0000-0000000000b2', :D, 'fa709000-0000-0000-0000-0000000000b1', 1, 'l', 'gasto', 'otros', 1, 'unidad', 7777.77);
INSERT INTO facturas_proveedor (id,company_id,project_id,proveedor_id,numero_factura,concepto,monto_total,monto_pagado,estado) VALUES
  ('fa709000-0000-0000-0000-0000000000c1', :D, :D1, :PS, 'FAC-SEC-7777',     'secreta', 7777.77, 0, 'aprobada'),
  ('fa709000-0000-0000-0000-0000000000c2', :D, :D1, :PS, 'FAC-SEC-REG-7',    'secreta', 4321.00, 0, 'registrada'),
  -- Empresa C: una factura de un proyecto (C2) que el usuario limitado NO ve, y una del C1 que sí ve.
  ('fa709000-0000-0000-0000-0000000000c3', :C, :C2, :P1, 'FAC-OCULTA-7002',  'oculta',  5555.55, 0, 'aprobada'),
  ('fa709000-0000-0000-0000-0000000000c4', :C, :C1, :P1, 'FAC-VISIBLE-7003', 'visible',  300.00, 0, 'aprobada');
INSERT INTO contrasenas_pago (id,company_id,project_id,proveedor_id,numero,fecha_pago_programada,total,estado) VALUES
  ('fa709000-0000-0000-0000-0000000000d1', :D, :D1, :PS, 'CP-SEC-7777',    CURRENT_DATE, 7777.77, 'emitida'),
  ('fa709000-0000-0000-0000-0000000000d2', :D, :D1, :PS, 'CP-SEC-PAG-7',   CURRENT_DATE, 4321.00, 'pagada');
INSERT INTO contrasena_pago_facturas (company_id,contrasena_id,factura_id,monto) VALUES
  (:D, 'fa709000-0000-0000-0000-0000000000d1', 'fa709000-0000-0000-0000-0000000000c1', 7777.77);
INSERT INTO recepciones (id,company_id,project_id,orden_compra_id,estado,numero) VALUES
  ('fa709000-0000-0000-0000-0000000000e1', :D, :D1, 'fa709000-0000-0000-0000-0000000000b1', 'anulada', 'REC-SEC-7777');
-- Una recepción PROPIA (C1, borrador) para el INSERT directo legítimo de un respaldo.
INSERT INTO ordenes_compra (id,company_id,project_id,proveedor_id,proveedor_nombre,concepto,estado) VALUES
  ('fa709000-0000-0000-0000-0000000000b3', :C, :C1, :P1, 'x', 'EV09 orden propia', 'borrador');
INSERT INTO recepciones (id,company_id,project_id,orden_compra_id,estado) VALUES
  ('fa709000-0000-0000-0000-0000000000e2', :C, :C1, 'fa709000-0000-0000-0000-0000000000b3', 'borrador');
-- Personas de C: un operador con ver+crear Contabilidad pero SOLO con el proyecto C1, y un super_admin.
INSERT INTO auth.users (id) VALUES ('fa709000-0000-0000-0000-0000000000f1'), ('fa709000-0000-0000-0000-0000000000f2');
INSERT INTO app_users (id,company_id,full_name,role) VALUES
  ('fa709000-0000-0000-0000-0000000000f1', :C, 'EV09 operador solo C1', 'operator'),
  ('fa709000-0000-0000-0000-0000000000f2', :C, 'EV09 super admin',      'super_admin');
INSERT INTO user_project_assignments (user_id,project_id,permission_type) VALUES
  ('fa709000-0000-0000-0000-0000000000f1', :C1, 'total');
INSERT INTO roles (id,company_id,name) VALUES ('fa709000-0000-0000-0000-0000000000f3', :C, 'EV09 ver y crear');
INSERT INTO role_permissions (role_id,permission_key,effect) VALUES
  ('fa709000-0000-0000-0000-0000000000f3', 'platform.contabilidad.view',   'allow'),
  ('fa709000-0000-0000-0000-0000000000f3', 'platform.contabilidad.create', 'allow'),
  ('fa709000-0000-0000-0000-0000000000f3', 'platform.contabilidad.edit',   'allow');
INSERT INTO user_roles (user_id,role_id) VALUES ('fa709000-0000-0000-0000-0000000000f1', 'fa709000-0000-0000-0000-0000000000f3');
RESET session_replication_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- a · Fila con la empresa de OTRO: el mismo error de la RLS, sin leer nada
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h7_falla($$ INSERT INTO public.facturas_proveedor (company_id,project_id,proveedor_id,numero_factura,concepto,monto_total)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd',NULL,'fa709000-0000-0000-0000-0000000000a1','fac sec 7777','x',1) $$,
  '42501', '^new row violates row-level security policy for table "facturas_proveedor"$',
  '[EV-09a1] factura de D con número equivalente: la RLS, no «ya hay una factura FAC-SEC-7777 por 7777.77»');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000a1','fa709000-0000-0000-0000-0000000000c1',99999) $$,
  '42501', '^new row violates row-level security policy for table "ordenes_pago"$',
  '[EV-09a2] orden de pago de D por más del saldo: la RLS, sin saldo ni número de factura');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000a1','fa709000-0000-0000-0000-0000000000c2',1) $$,
  '42501', '^new row violates row-level security policy for table "ordenes_pago"$',
  '[EV-09a3] orden de pago de D sobre una factura registrada: la RLS, sin número ni estado');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,contrasena_pago_id,monto)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000a1','fa709000-0000-0000-0000-0000000000d1',5) $$,
  '42501', '^new row violates row-level security policy for table "ordenes_pago"$',
  '[EV-09a4] orden de pago de D contra su contraseña con otro monto: la RLS, sin número ni total de la contraseña');
SELECT public.h7_falla($$ INSERT INTO public.proveedores (company_id,nombre,nit,pais) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','Otro','7777777-7','GT') $$,
  '42501', '^new row violates row-level security policy for table "proveedores"$',
  '[EV-09a5] proveedor de D con el NIT de uno de D: la RLS, sin nombre ni código del proveedor de D');
SELECT public.h7_falla($$ INSERT INTO public.suministros_condominio (company_id,project_id,nombre,proveedor_id)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','x','fa709000-0000-0000-0000-0000000000a2') $$,
  '42501', '^new row violates row-level security policy for table "suministros_condominio"$',
  '[EV-09a6] suministro de D con un proveedor suspendido de D: la RLS, sin el nombre del proveedor');
SELECT public.h7_falla($$ INSERT INTO public.orden_compra_lineas (company_id,orden_compra_id,linea,descripcion,destino_tipo,categoria,cantidad,unidad,precio_unitario)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','fa709000-0000-0000-0000-0000000000b1',2,'x','gasto','otros',1,'unidad',1) $$,
  '42501', '^new row violates row-level security policy for table "orden_compra_lineas"$',
  '[EV-09a7] renglón de D en una orden emitida de D: la RLS, sin el estado de la orden');
SELECT public.h7_falla($$ INSERT INTO public.contrasena_pago_facturas (company_id,contrasena_id,factura_id,monto)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','fa709000-0000-0000-0000-0000000000d1','fa709000-0000-0000-0000-0000000000c2',70) $$,
  '42501', '^new row violates row-level security policy for table "contrasena_pago_facturas"$',
  '[EV-09a8] partida de D con una factura registrada de D: la RLS');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_compra (company_id,project_id,proveedor_id,proveedor_nombre,concepto)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','c1c1c1c1-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000a1','x','x') $$,
  '42501', '^new row violates row-level security policy for table "ordenes_compra"$',
  '[EV-09a9] orden de D con un proyecto de C: la RLS, no «COMPRAS_ALCANCE_PROYECTO» (pertenencia del proyecto a D)');
SELECT public.h7_falla($$ INSERT INTO public.recepciones (company_id,project_id,orden_compra_id)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000b1') $$,
  '42501', '^new row violates row-level security policy for table "recepciones"$',
  '[EV-09a10] recepción de D: la RLS');
SELECT public.h7_falla($$ INSERT INTO public.recepcion_respaldos (company_id,recepcion_id,ruta,nombre,mime,bytes,sha256)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','fa709000-0000-0000-0000-0000000000e1','x/y/z/a.pdf','a.pdf','application/pdf',1,'abc') $$,
  '42501', '^new row violates row-level security policy for table "recepcion_respaldos"$',
  '[EV-09a11] respaldo de D sobre una recepción anulada de D: la RLS, sin «está anulada»');
SELECT public.h7_falla($$ INSERT INTO public.contratos_proveedores (company_id,project_id,proveedor_id,proveedor_nombre,fecha_inicio,modalidad)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','x',CURRENT_DATE,'recurrente') $$,
  '42501', '^new row violates row-level security policy for table "contratos_proveedores"$',
  '[EV-09a12] contrato de D con un proveedor de C: la RLS, no «CONTRATO_PROVEEDOR_AJENO»');

-- Un UPDATE de una fila PROPIA que la mueve a la empresa D tampoco pasa por los triggers: la RLS.
SELECT public.h7_falla($$ UPDATE public.facturas_proveedor SET company_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  proveedor_id = 'fa709000-0000-0000-0000-0000000000a1' WHERE id = 'fa709000-0000-0000-0000-0000000000c4' $$,
  '42501', '^new row violates row-level security policy for table "facturas_proveedor"$',
  '[EV-09a13] UPDATE que mueve una factura propia a la empresa D: la RLS, no el trigger de alcance');
RESET ROLE;

-- anon (la llave pública de la aplicación, sin sesión): tampoco lee nada ajeno
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE anon;
SELECT public.h7_falla($$ INSERT INTO public.proveedores (company_id,nombre,nit,pais) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','Otro','7777777-7','GT') $$,
  '42501', '^(new row violates row-level security policy for table|permission denied for table) ',
  '[EV-09b1] anon: el NIT de un proveedor de D no devuelve su nombre ni su código');
SELECT public.h7_falla($$ INSERT INTO public.suministros_condominio (company_id,project_id,nombre,proveedor_id)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','x','fa709000-0000-0000-0000-0000000000a2') $$,
  '42501', '^(new row violates row-level security policy for table|permission denied for table) ',
  '[EV-09b2] anon: un proveedor suspendido de D no devuelve su nombre');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- c · Fila de C que REFERENCIA un documento de D: código genérico, sin sus datos
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,contrasena_pago_id,monto)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000d1',5) $$,
  '23514', '^COMPRAS_PAGO_CONTRASENA_AJENA: ',
  '[EV-09c1] orden de C contra la contraseña de D con otro monto: «ajena», sin número ni total («CP-SEC-7777 es por 7777.77»)');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,contrasena_pago_id,monto)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000d2',4321) $$,
  '23514', '^COMPRAS_PAGO_CONTRASENA_AJENA: ',
  '[EV-09c2] orden de C contra una contraseña PAGADA de D: «ajena», sin su número ni su estado');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000c1',7777.77) $$,
  '23514', '^COMPRAS_PAGO_FACTURA_AJENA: ',
  '[EV-09c3] orden de C contra la factura aprobada de D: «ajena»');
SELECT public.h7_falla($$ INSERT INTO public.recepcion_respaldos (company_id,recepcion_id,ruta,nombre,mime,bytes,sha256)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','fa709000-0000-0000-0000-0000000000e1','x/y/z/a.pdf','a.pdf','application/pdf',1,'abc') $$,
  '42501', '^new row violates row-level security policy for table "recepcion_respaldos"$',
  '[EV-09c4] respaldo de C sobre una recepción de D: la RLS, no «la recepción está anulada»');

-- UPDATE: una orden de pago PROPIA en borrador no puede apuntar después a la contraseña de D.
INSERT INTO public.ordenes_pago (id,company_id,project_id,proveedor_id,factura_id,monto)
VALUES ('fa709000-0000-0000-0000-0000000000b9', :C, :C1, :P1, 'fa709000-0000-0000-0000-0000000000c4', 100);
SELECT public.h7_falla($$ UPDATE public.ordenes_pago SET factura_id = NULL, contrasena_pago_id = 'fa709000-0000-0000-0000-0000000000d1', monto = 5
  WHERE id = 'fa709000-0000-0000-0000-0000000000b9' $$,
  '23514', '^COMPRAS_PAGO_CONTRASENA_AJENA: ',
  '[EV-09c5] UPDATE de una orden propia hacia la contraseña de D: «ajena», sin datos de D');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- d · proveedor_habilitado no es un oráculo de autorización ajena
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.proveedor_habilitado(:PS::uuid), false, '[EV-09d1] un usuario de C no averigua si un proveedor de D está autorizado');
SELECT public.chk_bool(public.proveedor_habilitado(:P1::uuid), true,  '[EV-09d2] un proveedor autorizado de la propia empresa sigue contestando true');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_bool(public.proveedor_habilitado(:PS::uuid), true, '[EV-09d3] sin sesión de usuario (servicio, triggers de sistema) contesta como siempre');

-- ═══════════════════════════════════════════════════════════════════════════
-- e · Dentro de la misma empresa: sin datos de documentos que la persona no ve
-- ═══════════════════════════════════════════════════════════════════════════
-- UX: operador de C con ver+crear Contabilidad pero sin el proyecto C2. FAC-OCULTA-7002 es de C2.
SELECT public.como(:UX::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa709000-0000-0000-0000-0000000000c3'), 0, '[EV-09e0] preparación: UX no ve la factura de C2');
SELECT public.h7_falla($$ INSERT INTO public.facturas_proveedor (company_id,project_id,proveedor_id,numero_factura,concepto,monto_total)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fac ocu lta 7002','x',1) $$,
  '23505', '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente\.',
  '[EV-09e1] UX: el duplicado de una factura de un proyecto que no ve se avisa, pero sin su número, fecha, importe ni estado');
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c2c2c2c2-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000c3',99999) $$,
  '23514', '^COMPRAS_PAGO_EXCEDE_SALDO: ',
  '[EV-09e2] UX: pagar de más una factura de un proyecto que no ve se rechaza, sin su número ni su saldo');
RESET ROLE;
-- Quien SÍ ve el documento recibe el mensaje completo (la corrección no empobrece el mensaje legítimo).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h7_falla($$ INSERT INTO public.facturas_proveedor (company_id,project_id,proveedor_id,numero_factura,concepto,monto_total)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fac ocu lta 7002','x',1) $$,
  '23505', '«FAC-OCULTA-7002», .* por 5555\.55, aprobada',
  '[EV-09e3] UA (ve C2): el duplicado trae el número, el importe y el estado', true);
SELECT public.h7_falla($$ INSERT INTO public.ordenes_pago (company_id,project_id,proveedor_id,factura_id,monto)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','e3000000-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000c4',301) $$,
  '23514', '^COMPRAS_PAGO_EXCEDE_SALDO: la factura FAC-VISIBLE-7003 tiene un saldo de 300\.00 y la orden de pago es por 301\.00',
  '[EV-09e4] UA: el exceso de una factura que ve trae número, saldo y monto', true);
RESET ROLE;
-- El administrador de D ve el detalle de SUS documentos (no se le oculta lo propio).
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
SELECT public.h7_falla($$ INSERT INTO public.facturas_proveedor (company_id,project_id,proveedor_id,numero_factura,concepto,monto_total)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','d1d1d1d1-0000-0000-0000-000000000001','fa709000-0000-0000-0000-0000000000a1','fac sec 7777','x',1) $$,
  '23505', '«FAC-SEC-7777», .* por 7777\.77, aprobada',
  '[EV-09e5] UD (administrador de D): el duplicado de SU factura trae el detalle', true);
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- g · LEGÍTIMO: lo que no debe romperse
-- ═══════════════════════════════════════════════════════════════════════════
-- g1 · el ciclo de pago de una factura propia (crear → aprobar → pagar) y sus sellos
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.ordenes_pago SET monto = 100 WHERE id = 'fa709000-0000-0000-0000-0000000000b9';
UPDATE public.ordenes_pago SET estado = 'aprobada' WHERE id = 'fa709000-0000-0000-0000-0000000000b9';
UPDATE public.ordenes_pago SET estado = 'pagada'   WHERE id = 'fa709000-0000-0000-0000-0000000000b9';
RESET ROLE;
SELECT public.chk_txt((SELECT estado FROM public.ordenes_pago WHERE id = 'fa709000-0000-0000-0000-0000000000b9'), 'pagada', '[EV-09g1] la orden de pago de una factura propia se crea, se aprueba y se paga');
SELECT public.chk_num((SELECT monto_pagado FROM public.facturas_proveedor WHERE id = 'fa709000-0000-0000-0000-0000000000c4'), 100, '[EV-09g1b] y la factura propia queda con lo pagado');
-- g2 · una factura nueva de la propia empresa, y un proveedor nuevo
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id,company_id,project_id,proveedor_id,numero_factura,concepto,monto_total)
VALUES ('fa709000-0000-0000-0000-0000000000c5', :C, :C1, :P1, 'EV09-NUEVA-1', 'legítima', 10);
INSERT INTO public.proveedores (id,company_id,nombre,nit,pais) VALUES ('fa709000-0000-0000-0000-0000000000a3', :C, 'EV09 proveedor propio', '7900001-1', 'GT');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa709000-0000-0000-0000-0000000000c5'), 1, '[EV-09g2] la empresa C crea sus facturas');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id = 'fa709000-0000-0000-0000-0000000000a3'), 1, '[EV-09g3] la empresa C crea sus proveedores');
-- g3 · el administrador de D escribe en D
SELECT public.como(:UD::uuid);
SET ROLE authenticated;
INSERT INTO public.facturas_proveedor (id,company_id,project_id,proveedor_id,numero_factura,concepto,monto_total)
VALUES ('fa709000-0000-0000-0000-0000000000c6', :D, :D1, :PS, 'EV09-D-1', 'legítima de D', 10);
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = 'fa709000-0000-0000-0000-0000000000c6'), 1, '[EV-09g4] la empresa D crea sus facturas');
-- g4 · super_admin: la misma condición de las políticas lo deja escribir en otra empresa
SELECT public.como(:USA::uuid);
SET ROLE authenticated;
INSERT INTO public.proveedores (id,company_id,nombre,nit,pais) VALUES ('fa709000-0000-0000-0000-0000000000a4', :D, 'EV09 alta por super admin', '7900002-2', 'GT');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id = 'fa709000-0000-0000-0000-0000000000a4'), 1, '[EV-09g5] super_admin sigue escribiendo en cualquier empresa');
-- g5 · rol de servicio (BYPASSRLS) y sesión sin usuario: no pasan por el guardián
SELECT set_config('request.jwt.claim.sub', '', false);
SET ROLE service_role;
INSERT INTO public.proveedores (id,company_id,nombre,nit,pais) VALUES ('fa709000-0000-0000-0000-0000000000a5', :D, 'EV09 alta de servicio', '7900003-3', 'GT');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id = 'fa709000-0000-0000-0000-0000000000a5'), 1, '[EV-09g6] service_role sigue escribiendo (la RLS no le aplica)');
-- g6 · una RPC SECURITY DEFINER escribe con permiso de dueño (la RLS no aplica): el guardián no la toca
CREATE OR REPLACE FUNCTION public.h7_rpc_alta_en_d() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  INSERT INTO public.proveedores (id,company_id,nombre,nit,pais) VALUES ('fa709000-0000-0000-0000-0000000000a6', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'EV09 alta por RPC definer', '7900004-4', 'GT');
END $$;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h7_rpc_alta_en_d();
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id = 'fa709000-0000-0000-0000-0000000000a6'), 1, '[EV-09g7] una RPC SECURITY DEFINER sigue escribiendo con permiso de dueño');

-- g7 · el INSERT directo de un respaldo (sin company_id: lo deriva el servidor) de una recepción PROPIA
--      sigue llegando a la validación propia del respaldo (aquí: el archivo no está en Storage)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.h7_falla($$ INSERT INTO public.recepcion_respaldos (recepcion_id,ruta,nombre,tipo,mime,bytes,sha256)
  VALUES ('fa709000-0000-0000-0000-0000000000e2','cccccccc-cccc-cccc-cccc-cccccccccccc/c1c1c1c1-0000-0000-0000-000000000001/fa709000-0000-0000-0000-0000000000e2/fantasma.pdf',
          'fantasma.pdf','entrega','application/pdf',100,repeat('a',64)) $$,
  '23514', '^COMPRAS_RESPALDO_OBJETO: ', '[EV-09g8] LEGÍTIMO: el respaldo directo de una recepción propia llega a su validación (no lo frena el guardián)', true);
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- f · El guardián es el PRIMER trigger BEFORE de cada tabla protegida
--     (los triggers disparan por orden alfabético de nombre: si alguien añade uno que se
--      llame «antes», la protección deja de ser «RLS primero» y esta aserción lo dice)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_bool(
  (SELECT bool_and(
            (SELECT t.tgname FROM pg_trigger t
              WHERE t.tgrelid = ('public.' || x)::regclass AND NOT t.tgisinternal
                AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4          -- BEFORE ... INSERT
              ORDER BY t.tgname COLLATE "C" LIMIT 1) = 'trg_00_compras_rls_empresa'
        AND (SELECT t.tgname FROM pg_trigger t
              WHERE t.tgrelid = ('public.' || x)::regclass AND NOT t.tgisinternal
                AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16        -- BEFORE ... UPDATE
              ORDER BY t.tgname COLLATE "C" LIMIT 1) = 'trg_00_compras_rls_empresa')
     FROM unnest(ARRAY['ordenes_compra','orden_compra_lineas','recepciones','recepcion_lineas','facturas_proveedor',
                       'factura_proveedor_lineas','ordenes_pago','contrasenas_pago','contrasena_pago_facturas',
                       'proveedores','contratos_proveedores','suministros_condominio','proformas_condominio',
                       'evaluaciones_proveedor','proveedor_proyectos','proveedor_contactos',
                       'activos_fijos','gastos_condominio']) AS x),
  true, '[EV-09f1] el guardián de empresa es el primer BEFORE (INSERT y UPDATE) de las 18 tablas protegidas');
-- recepcion_respaldos: su guardián (por recepción) es el primer BEFORE, antes del trigger que deriva la empresa y lee la recepción.
SELECT public.chk_txt(
  (SELECT t.tgname FROM pg_trigger t
    WHERE t.tgrelid = 'public.recepcion_respaldos'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4
    ORDER BY t.tgname COLLATE "C" LIMIT 1),
  'trg_00_compras_rls_respaldo_recepcion', '[EV-09f4] en recepcion_respaldos el guardián por recepción va antes del trigger de alta');
-- En ordenes_pago la comprobación de empresa de la factura/contraseña va antes del trigger que las lee.
SELECT public.chk_txt(
  (SELECT t.tgname FROM pg_trigger t
    WHERE t.tgrelid = 'public.ordenes_pago'::regclass AND t.tgname IN ('trg_compras_alcance_orden_pago_ref', 'trg_compras_orden_contrasena')
    ORDER BY t.tgname COLLATE "C" LIMIT 1),
  'trg_compras_alcance_orden_pago_ref', '[EV-09f2] en ordenes_pago la empresa de la factura/contraseña se comprueba antes de que otro trigger las lea');
-- Los triggers del guardián no son invocables como funciones por la API (solo los dispara la tabla).
SELECT public.chk_bool(
  NOT has_function_privilege('authenticated', 'public.compras_tg_rls_empresa()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.compras_tg_rls_empresa()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.compras_puede_ver_documento(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.compras_tg_alcance_orden_pago_ref()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.compras_tg_rls_respaldo_recepcion()', 'EXECUTE'),
  true, '[EV-09f3] las funciones nuevas no se exponen a authenticated ni anon');

DROP FUNCTION public.h7_rpc_alta_en_d();
SELECT 'EV-09 · todas las aserciones pasaron' AS resultado;
