-- ════════════════════════════════════════════════════════════════════════════
-- RG-4 · PARTE 2 · la RPC `compras_factura_crear` (el ÚNICO camino por el que la pantalla crea facturas)
--        conserva el mensaje del trigger de equivalencia.
--
-- CAUSA RAÍZ. El manejador de `unique_violation` de la RPC traducía TODO error de `uq_facturas_prov_numero` a
--   «…con el número "<lo que escribió la persona>"…», incluido el que levanta el TRIGGER de equivalencia (mismo
--   SQLSTATE y misma restricción a propósito). Con la alternativa A eso engaña —quien escribe «123» frente a una
--   «1-23» registrada lee «ya hay una factura con el número "123"»— y el mensaje del trigger, que nombra la factura
--   existente solo si la persona la ve (EV-09) y explica cómo registrar la otra, nunca llega a la pantalla.
--
-- COMPORTAMIENTO ESPERADO (pieza_factura_crear.sql):
--   · rechazo por NÚMERO EQUIVALENTE → la RPC deja pasar el mensaje del trigger tal cual (con el número de la factura
--     existente para quien la ve, genérico para quien no; con la sugerencia de escribir el número como viene impreso);
--   · rechazo por número IDÉNTICO (índice único exacto) → el mensaje de siempre, «con el número "X"»;
--   · mismo SQLSTATE (23505) en los dos; la clave de un intento rechazado no se gasta; el reintento idempotente
--     (misma clave y contenido) devuelve la misma factura sin pasar por la regla de números.
--
--   · RONDA DE CORRECCIONES: la sugerencia por caso del trigger (la existente trae menos separadores / más / los mismos) llega
--     entera por la RPC, y el aviso genérico (factura de un proyecto que la persona no ve) sale idéntico para cualquier estructura
--     de la oculta ([RG-4r4], [RG-4s]); SQLSTATE 23505 en todos.
--
--   · TANDA FINAL (segundo escéptico): la clave de idempotencia ya usada por una factura de un proyecto que la persona no ve responde
--     COMPRAS_FACTURA_CLAVE_EN_USO, no «número duplicado»; el candado de la RPC es el de (empresa, clave); anon no ejecuta la RPC; y un
--     duplicado con un carácter invisible (U+200B) llega a la pantalla con el aviso de siempre ([RG-4t]).
--
-- HOY (sin la parte 2) debe FALLAR en [RG-4r1]. Con ella, pasar.
-- Se ejecuta con:  psql -X -v ON_ERROR_STOP=1 -d <BD> -f RG-4.rpc.sql   (superusuario; requiere pieza.sql y
-- pieza_factura_crear.sql aplicadas). Toda su escritura va dentro de BEGIN … ROLLBACK: no deja residuo.
-- IDs: fb5NNNNN-0000-0000-0000-0000000000XX.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UX  '''fb500000-0000-0000-0000-0000000000e1'''
\set PA  '''fb500000-0000-0000-0000-0000000000a1'''
-- Aviso genérico (factura de un proyecto que la persona no ve): UN texto constante (ver pieza.sql, EV-09).
\set generico 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente. Si es la misma, no la registres otra vez. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»); si ya lo escribiste así, pide a quien administra las facturas que corrija o anule primero la existente.'

BEGIN;

-- Ayuda: llama a la RPC y devuelve «OK <numero>» o «ERR <sqlstate> <mensaje>». Se ejecuta con la sesión que la llama.
CREATE FUNCTION public.hx5_rpc(p_proyecto uuid, p_numero text, p_clave text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  r := public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', p_proyecto,
         jsonb_build_object('proveedor_id', 'fb500000-0000-0000-0000-0000000000a1', 'numero_factura', p_numero,
                            'concepto', 'RPC RG-4', 'monto_total', 100, 'clave_idempotencia', p_clave), '[]'::jsonb);
  RETURN 'OK ' || (r->'factura'->>'numero_factura') || CASE WHEN (r->>'reutilizada')::boolean THEN ' (reutilizada)' ELSE '' END;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || SQLSTATE || ' ' || SQLERRM;
END $$;

-- ── Montaje: un proveedor de C y un operador que solo ve el proyecto C1 ──────────────────────
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  (:PA, :C::uuid, 'Proveedor RPC RG-4', '9960001-1', 'GT', 'empresa');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id = :PA::uuid;
RESET ROLE;
INSERT INTO auth.users (id) VALUES (:UX);
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (:UX, :C::uuid, 'RG-4 operador solo C1', 'operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UX, :C1::uuid, 'total');
INSERT INTO public.roles (id, company_id, name) VALUES ('fb500000-0000-0000-0000-0000000000f3', :C::uuid, 'RG-4 rpc ver y crear');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('fb500000-0000-0000-0000-0000000000f3', 'platform.contabilidad.view',   'allow'),
  ('fb500000-0000-0000-0000-0000000000f3', 'platform.contabilidad.create', 'allow'),
  ('fb500000-0000-0000-0000-0000000000f3', 'platform.contabilidad.edit',   'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES (:UX, 'fb500000-0000-0000-0000-0000000000f3');
-- «OCU-7002» vive en C2 (el operador solo ve C1): carga histórica sin disparadores
SET session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
VALUES ('fb500001-0000-0000-0000-0000000000f1', :C::uuid, :C2::uuid, :PA::uuid, 'OCU-7002', 'oculta (C2)', 5555.55, 'aprobada'),
       ('fb500001-0000-0000-0000-0000000000f2', :C::uuid, :C2::uuid, :PA::uuid, 'HID-A1',   'oculta (C2)',  701.01, 'aprobada'),
       ('fb500001-0000-0000-0000-0000000000f3', :C::uuid, :C2::uuid, :PA::uuid, 'HIDC3',    'oculta (C2)',  703.03, 'aprobada');
SET session_replication_role = origin;

-- ═══════════════════════════════════════════════════════════════════════════
-- r · el administrador (ve todo) crea por la RPC
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, '1-23', 'rg5-clave-0001'), 'OK 1-23', '[RG-4r0] la RPC registra «1-23»');
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, '12-3', 'rg5-clave-0002'), 'OK 12-3', '[RG-4r0] …y «12-3» (otra factura) por la misma vía');

-- equivalente (no idéntico): el mensaje es el del trigger
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, '123', 'rg5-clave-0003') ~
  '^ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«(1-23|12-3)», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, escribe su número tal como viene impreso', true,
  '[RG-4r1] «123» frente a «1-23»/«12-3»: la RPC deja pasar el mensaje del trigger (nombra la factura existente y explica cómo registrar la otra), con SQLSTATE 23505');
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, '123', 'rg5-clave-0003') !~ 'con el número "123"', true,
  '[RG-4r1] …y NO dice «con el número "123"» (el que la persona acaba de escribir: no es el de la factura existente)');
-- idéntico: lo rechaza el índice único exacto y la RPC lo traduce como siempre
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, '1-23', 'rg5-clave-0004') ~
  '^ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con el número "1-23"\. Si es la misma, no la registres otra vez\.$', true,
  '[RG-4r2] el número IDÉNTICO «1-23» conserva el mensaje de siempre de la RPC (con el número escrito y SQLSTATE 23505)');
-- la clave de un intento rechazado no queda gastada; el reintento idempotente devuelve la MISMA factura
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, '12-30', 'rg5-clave-0003'), 'OK 12-30', '[RG-4r3] la clave del intento rechazado («123») no se gastó: con el número corregido «12-30» el mismo intento se registra');
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, '12-30', 'rg5-clave-0003'), 'OK 12-30 (reutilizada)', '[RG-4r3] el reintento con la misma clave y contenido devuelve la misma factura (reutilizada), sin pasar por la regla de números');
-- [RG-4r4] la sugerencia por CASO llega entera por la RPC (el camino de la pantalla), con SQLSTATE 23505
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'AB12', 'rg5-clave-0007'), 'OK AB12', '[RG-4r4·montaje] la RPC registra «AB12» (sin separador)');
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, 'AB-12', 'rg5-clave-0008') ~
  '^ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«AB12», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero\.$', true,
  '[RG-4r4] «AB-12» frente a «AB12» (el nuevo trae más separadores): la RPC deja pasar «la existente se registró con menos separadores…», no «escribe tu número con su guion»');
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'CD-34', 'rg5-clave-0009'), 'OK CD-34', '[RG-4r4·montaje] la RPC registra «CD-34»');
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, 'cd 34', 'rg5-clave-0010') ~
  '^ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«CD-34», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, revisa que su número esté escrito tal como viene impreso; si lo está, la existente solo difiere en mayúsculas, espacios o tipo de separador: corrige o anula esa primero\.$', true,
  '[RG-4r4] «cd 34» frente a «CD-34» (mismos separadores): la RPC deja pasar la sugerencia de los separadores iguales');
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'EF56', 'rg5-clave-0011'), 'OK EF56', '[RG-4r4·montaje] la RPC registra «EF56»');
SELECT public.chk_txt(regexp_replace(public.hx5_rpc(:C1::uuid, 'EF-5-6', 'rg5-clave-0012'), '\d\d/\d\d/\d{4}', 'DD/MM/AAAA'), 'ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («EF56», DD/MM/AAAA por 100.00, registrada). Si es la misma, no la registres otra vez. Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero.',
  '[RG-4r4] «EF-5-6» frente a «EF56»: el mensaje completo, carácter por carácter');
SELECT public.chk_txt(regexp_replace(public.hx5_rpc(:C1::uuid, 'EF5-6', 'rg5-clave-0013'), '\d\d/\d\d/\d{4}', 'DD/MM/AAAA'), 'ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («EF56», DD/MM/AAAA por 100.00, registrada). Si es la misma, no la registres otra vez. Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero.',
  '[RG-4r4] …y «EF5-6» (otro separador) frente a la misma «EF56»');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PA::uuid AND clave_idempotencia = 'rg5-clave-0003'), 1,
  '[RG-4r3] hay UNA sola factura con esa clave');

-- ═══════════════════════════════════════════════════════════════════════════
-- s · EV-09: quien no ve el proyecto de la factura existente recibe el aviso genérico
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UX::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, 'ocu 7002', 'rg5-clave-0005') ~
  '^ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente\. Si es la misma, no la registres otra vez\. Si es otra, escribe su número tal como viene impreso', true,
  '[RG-4s] el operador que no ve C2 recibe, por la RPC, el aviso genérico del duplicado (sin número, fecha, importe ni estado) y la sugerencia');
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, 'ocu 7002', 'rg5-clave-0005') !~* '(OCU-7002|OCU7002|5555|aprobada|/20[0-9]{2})', true,
  '[RG-4s] …y el mensaje no delata la factura oculta');
-- EV-09 y la sugerencia: la oculta puede traer más, menos o los mismos separadores que lo que se escribe; la RPC entrega el MISMO texto genérico
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'ocu 7002', 'rg5-clave-0014'), 'ERR 23505 ' || :'generico',
  '[RG-4s] oculta «OCU-7002» y «ocu 7002» (mismos separadores): por la RPC, exactamente el aviso genérico constante');
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'HIDA1', 'rg5-clave-0015'), 'ERR 23505 ' || :'generico',
  '[RG-4s] oculta «HID-A1» y «HIDA1» (el nuevo trae menos): el MISMO aviso genérico');
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'HID-C3', 'rg5-clave-0016'), 'ERR 23505 ' || :'generico',
  '[RG-4s] oculta «HIDC3» y «HID-C3» (el nuevo trae más): el MISMO aviso genérico');
RESET ROLE;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, 'ocu 7002', 'rg5-clave-0006') ~ '«OCU-7002», .* por 5555\.55, aprobada\)', true,
  '[RG-4s] el administrador (ve C2) recibe por la RPC el detalle completo de la factura existente');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- t · La clave de idempotencia ya usada por una factura que la persona no ve; el candado de la RPC; el ACL; un invisible por la RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- Si la clave la tiene una factura de otro alcance, la persona no la ve (el reintento no la recupera) y el INSERT choca con el índice de la
-- clave: la RPC debe responder CLAVE_EN_USO («usa otra clave»), NO «número duplicado», que sería falso (el número no existe). Eso depende
-- de que el manejador distinga la restricción del número (uq_facturas_prov_numero) de la de la clave.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.hx5_rpc(:C2::uuid, 'OCU-500', 'rg5-clave-0020'), 'OK OCU-500',
  '[RG-4t·montaje] el administrador registra «OCU-500» en C2 con la clave rg5-clave-0020');
RESET ROLE;
SELECT public.como(:UX::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'OTRO-777', 'rg5-clave-0020'),
  'ERR 23505 COMPRAS_FACTURA_CLAVE_EN_USO: la clave de idempotencia ya está en uso. Usa otra clave.',
  '[RG-4t] el operador que no ve C2 reutiliza esa clave con otro número («OTRO-777», que no existe): la RPC responde CLAVE_EN_USO, no «número duplicado»');
SELECT public.chk_bool(public.hx5_rpc(:C1::uuid, 'OTRO-777', 'rg5-clave-0020') !~* '(OCU-500|OCU500|NUMERO_DUPLICADO|OTRO-777)', true,
  '[RG-4t] …y el aviso no nombra la factura oculta ni afirma que «OTRO-777» esté duplicado');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PA::uuid AND numero_factura = 'OTRO-777'), 0,
  '[RG-4t] …y no se creó ninguna factura «OTRO-777»');
RESET ROLE;
-- el candado consultivo de la RPC es el de (empresa, clave de idempotencia): lo que retuvo la alta de la clave rg5-clave-0001 (la primera de este archivo)
SELECT public.chk(
  (SELECT count(*) FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND ((l.classid::text::bigint << 32) | l.objid::text::bigint)
          = hashtextextended('compras_factura:' || 'cccccccc-cccc-cccc-cccc-cccccccccccc' || ':' || 'rg5-clave-0001', 0)), 1,
  '[RG-4t] la RPC retuvo el candado consultivo de (empresa, clave de idempotencia): «compras_factura:<empresa>:<clave>»');
SELECT public.chk(
  (SELECT count(*) FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND ((l.classid::text::bigint << 32) | l.objid::text::bigint)
          = hashtextextended('compras_factura:' || 'rg5-clave-0001', 0)), 0,
  '[RG-4t] …y NO el de la clave sin la empresa (dos empresas con la misma clave no se bloquean entre sí)');
-- ACL: la RPC la ejecutan las sesiones de la API autenticadas y el servicio; anon no
SELECT public.chk_bool(has_function_privilege('authenticated', 'public.compras_factura_crear(uuid,uuid,jsonb,jsonb)', 'EXECUTE')
                       AND has_function_privilege('service_role', 'public.compras_factura_crear(uuid,uuid,jsonb,jsonb)', 'EXECUTE'), true,
  '[RG-4t] authenticated y service_role pueden ejecutar compras_factura_crear');
SELECT public.chk_bool(has_function_privilege('anon', 'public.compras_factura_crear(uuid,uuid,jsonb,jsonb)', 'EXECUTE'), false,
  '[RG-4t] anon NO puede ejecutar compras_factura_crear (sin sesión no se crean facturas)');
-- un duplicado escrito con un carácter invisible llega a la pantalla con el mismo aviso (tanda final: el espacio de ancho cero U+200B no es un separador)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.hx5_rpc(:C1::uuid, 'FAC-001', 'rg5-clave-0021'), 'OK FAC-001', '[RG-4t·montaje] la RPC registra «FAC-001»');
SELECT public.chk_txt(regexp_replace(public.hx5_rpc(:C1::uuid, 'F' || convert_from(decode('e2808b', 'hex'), 'UTF8') || 'AC001', 'rg5-clave-0022'), '\d\d/\d\d/\d{4}', 'DD/MM/AAAA'),
  'ERR 23505 COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente («FAC-001», DD/MM/AAAA por 100.00, registrada). Si es la misma, no la registres otra vez. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»); si ya lo escribiste así, la existente se registró con más separadores: corrige o anula esa primero.',
  '[RG-4t] «F<U+200B>AC001» frente a «FAC-001»: la RPC lo rechaza como duplicado, con el aviso de siempre (antes se registraba)');
RESET ROLE;

ROLLBACK;

SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fb5%') + (SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = 'fb500000-0000-0000-0000-0000000000a1')
                  + (SELECT count(*) FROM public.proveedores WHERE id::text LIKE 'fb5%') + (SELECT count(*) FROM public.app_users WHERE id::text LIKE 'fb5%')
                  + (SELECT count(*) FROM pg_class WHERE relname LIKE 'hx5\_%'), 0,
  '[RG-4·limpieza] la prueba no deja residuo');
