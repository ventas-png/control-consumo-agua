-- ════════════════════════════════════════════════════════════════════════════
-- RG-4 · Números de factura DISTINTOS y válidos que normalizan igual («1-23» y «12-3»;
--        «A-12» y «A1-2») se rechazaban como duplicado, sin salida.
--
-- CAUSA RAÍZ. compras_normalizar_numero borra todo lo que no es A-Z0-9, así que «serie-
--   correlativo» distintos que concatenan igual chocan. El trigger compras_tg_factura_
--   numero_equivalente (20261027000400) rechaza el segundo con COMPRAS_FACTURA_NUMERO_
--   DUPLICADO y no hay forma de decir «es otra factura».
--
-- COMPORTAMIENTO ESPERADO (decisión D3, alternativa A: «equivalencia que respeta el separador
--   entre serie y correlativo»):
--   · «1-23»/«12-3», «A-12»/«A1-2», «001-1234»/«0011-234»…: dos facturas distintas, se registran.
--   · De los 20 pares de RG-4.comparacion.sql: los 10 duplicados reales se rechazan; los 5 distintos
--     legítimos se aceptan; de los 5 AMBIGUOS se rechazan 3 («1-23»/«123», «A-12»/«A-1-2», «1-2-3»/«12-3»:
--     un número con separador frente a uno sin él, o con uno incluido en el otro) y 2 pasan
--     («FAC-001»/«FA-C001», «1.234»/«12.34»): tienen EXACTAMENTE la forma de «B-100»/«B1-00» y de
--     «2-345»/«23-45» (un solo separador, en posición distinta), así que ninguna regla que mire solo la
--     estructura puede rechazarlas sin rechazar también a los distintos legítimos (ver [RG-4·forma]).
--   · El orden de inserción y la NO transitividad de la equivalencia («1-23» ~ «123» ~ «12-3», pero
--     «1-23» ≁ «12-3») no abren ningún hueco: la comprobación es contra TODAS las facturas vivas del
--     proveedor con la misma clave, no contra un representante (ver [RG-4·orden] y [RG-4·azar]).
--   · Todo lo demás de 0400/0800 igual: el número idéntico lo rechaza el índice único; otro proveedor,
--     una factura anulada y las sin número no cuentan; el cambio de número y de proveedor se controlan igual;
--     la RPC compras_factura_crear da el mismo error; un usuario con solo «crear» puede; el camino del
--     sistema (sin sesión) obedece la misma regla; el mensaje solo nombra lo que la persona ve (EV-09).
--   · La clave del candado consultivo, la del índice y la de la consulta salen de la MISMA llamada a
--     compras_normalizar_numero (introspección y comportamiento: [RG-4·una clave]).
--   · La consulta sigue resolviéndose por idx_facturas_prov_numero_norm con 20 000 facturas del proveedor y
--     el criterio de separadores solo se evalúa sobre los candidatos del índice ([RG-4·plan]); y, con 60 proveedores más
--     (no solo un proveedor enorme), la Index Cond del plan lleva EMPRESA, PROVEEDOR y CLAVE normalizada ([RG-4·plan·cond]).
--   · RONDA DE CORRECCIONES: (1) la sugerencia del aviso distingue tres casos según los separadores (la existente trae menos,
--     más o los mismos) y el aviso genérico —factura de un proyecto que la persona no ve— es UN texto constante que no depende
--     de la estructura de la oculta; SQLSTATE 23505 y la restricción uq_facturas_prov_numero intactos ([RG-4k·sugerencia]).
--     (2) Lo que NACE o QUEDA «anulada» no se compara con las vivas: INSERT de sistema y UPDATE que anula y cambia el número
--     ([RG-4g2]). Estas pruebas matan a los dos mutantes que sobrevivieron al escéptico (k_anulada, c_sin_empresa).
--
-- HOY (sin la pieza) debe FALLAR en [RG-4a]. Con la pieza RG-4 de la migración 20261027000900, pasar.
-- Se ejecuta con:  psql -X -v ON_ERROR_STOP=1 -d <BD> -f RG-4.sql   (superusuario, sobre la plantilla con
-- fixture.sql o con la suite ya corrida). No depende de usuarios de otras suites. Toda su escritura va dentro
-- de BEGIN … ROLLBACK: no deja residuo. IDs: fb4NNNNN-0000-0000-0000-0000000000XX.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UX  '''fb400000-0000-0000-0000-0000000000e1'''
\set PA  '''fb400000-0000-0000-0000-0000000000a1'''
\set PB  '''fb400000-0000-0000-0000-0000000000a2'''
\set PM  '''fb400000-0000-0000-0000-0000000000a3'''
\set PG  '''fb400000-0000-0000-0000-0000000000a4'''
\set PH  '''fb400000-0000-0000-0000-0000000000b1'''
\set PS  '''fb400000-0000-0000-0000-0000000000a5'''
\set PN  '''fb400000-0000-0000-0000-0000000000a6'''
\set PQ  '''fb4a0000-0000-0000-0000-000000000001'''
-- Aviso genérico (factura de un proyecto que la persona no ve): UN texto constante (ver pieza.sql, EV-09).
\set generico 'COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente. Si es la misma, no la registres otra vez. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo (p. ej. «A-123»); si ya lo escribiste así, pide a quien administra las facturas que corrija o anule primero la existente.'

BEGIN;
SET LOCAL track_functions = 'all';

-- Ayudas (se pierden con el ROLLBACK). Se ejecutan con la sesión que las llama.
CREATE FUNCTION public.hx4_id(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('fb400' || lpad(to_hex(p_n), 3, '0') || '-0000-0000-0000-0000000000f1')::uuid $$;

CREATE FUNCTION public.hx4_alta(p_n int, p_prov uuid, p_num text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
  VALUES (public.hx4_id(p_n), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', p_prov, p_num, 'RG-4 ' || p_num, 100);
END $$;

-- Resultado de una sentencia SIN dejar rastro si falla: PASA | BLOQUEA (el trigger de equivalencia) |
-- IDENTICO (el índice único exacto) | ERROR <texto>. La subtransacción solo se deshace al fallar.
CREATE FUNCTION public.hx4_intenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'PASA';
EXCEPTION WHEN OTHERS THEN
  RETURN CASE WHEN SQLERRM LIKE 'COMPRAS_FACTURA_NUMERO_DUPLICADO%' THEN 'BLOQUEA'
              WHEN SQLERRM LIKE 'duplicate key value violates unique constraint "uq_facturas_prov_numero"%' THEN 'IDENTICO'
              ELSE 'ERROR ' || left(SQLERRM, 160) END;
END $$;

-- SQLSTATE, restricción y mensaje de lo que RECHAZA una sentencia, sin dejar rastro: «PASA» o «<sqlstate>|<restricción>|<mensaje>».
CREATE FUNCTION public.hx4_error(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_c text; v_m text;
BEGIN
  EXECUTE p_sql;
  RETURN 'PASA';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME, v_m = MESSAGE_TEXT;
  RETURN SQLSTATE || '|' || COALESCE(v_c, '-') || '|' || v_m;
END $$;

-- Como hx4_intenta, pero con la escritura de SISTEMA habilitada (conta.allow_system_write = on) solo durante la sentencia.
CREATE FUNCTION public.hx4_sistema(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM set_config('conta.allow_system_write', 'on', true);
  r := public.hx4_intenta(p_sql);
  PERFORM set_config('conta.allow_system_write', 'off', true);
  RETURN r;
END $$;

-- Dos altas seguidas del par (a, b) para el proveedor PM, en una subtransacción que se DESHACE: lo que
-- pasó con la segunda.
CREATE FUNCTION public.hx4_par(p_a text, p_b text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  BEGIN
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (gen_random_uuid(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a3', p_a, 'matriz', 10);
    r := public.hx4_intenta(format('INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
                                    VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 10)',
                                   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
                                   'fb400000-0000-0000-0000-0000000000a3', p_b, 'matriz'));
    RAISE EXCEPTION 'deshacer' USING ERRCODE = 'XX999';
  EXCEPTION WHEN SQLSTATE 'XX999' THEN NULL;
  END;
  RETURN r;
END $$;

-- Exige que `p_sql` se EJECUTE; si lo rechaza, dice cuál fue el rechazo (el falso positivo del hallazgo
-- es COMPRAS_FACTURA_NUMERO_DUPLICADO).
CREATE FUNCTION public.hx4_acepta(p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE '✓ %', p_msg;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '[RG-4%' THEN RAISE; END IF;
  RAISE EXCEPTION '% — se rechazó: %', p_msg, left(SQLERRM, 160);
END $$;

-- Cuántos pares de facturas VIVAS del proveedor son «equivalentes» según la regla (invariante: cero).
-- plpgsql (enlace tardío) para que la prueba, sin la pieza, falle en sus aserciones y no al definir la ayuda.
-- SECURITY DEFINER: authenticated no ejecuta las funciones de equivalencia (solo las usa el trigger).
CREATE FUNCTION public.hx4_pares_equivalentes(p_prov uuid) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  RETURN (SELECT count(*) FROM public.facturas_proveedor a
            JOIN public.facturas_proveedor b ON b.proveedor_id = a.proveedor_id AND b.id > a.id
           WHERE a.proveedor_id = p_prov AND a.estado <> 'anulada' AND b.estado <> 'anulada'
             AND public.compras_numeros_equivalentes(a.numero_factura, b.numero_factura));
END $$;

-- ── Montaje: proveedores propios de C, autorizados por el administrador ─────────────────────
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  (:PA, :C::uuid, 'Proveedor A RG-4',       '9950001-1', 'GT', 'empresa'),
  (:PB, :C::uuid, 'Proveedor B RG-4',       '9950002-2', 'GT', 'empresa'),
  (:PM, :C::uuid, 'Proveedor matriz RG-4',  '9950003-3', 'GT', 'empresa'),
  (:PG, :C::uuid, 'Proveedor azar RG-4',    '9950004-4', 'GT', 'empresa'),
  (:PH, :C::uuid, 'Proveedor 20 mil RG-4',  '9950005-5', 'GT', 'empresa'),
  (:PS, :C::uuid, 'Proveedor sugerencia RG-4', '9950006-6', 'GT', 'empresa'),
  (:PN, :C::uuid, 'Proveedor anuladas RG-4',   '9950007-7', 'GT', 'empresa');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (:PA::uuid, :PB::uuid, :PM::uuid, :PG::uuid, :PH::uuid, :PS::uuid, :PN::uuid);
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- a · Los números son DISTINTOS: se registran las dos facturas (administrador, por la vía de la API)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(1, :PA::uuid, '1-23');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(2, 'fb400000-0000-0000-0000-0000000000a1', '12-3') $$,
  '[RG-4a] «12-3» se registra aunque exista «1-23» del mismo proveedor (serie 12, correlativo 3)');
SELECT public.hx4_alta(3, :PA::uuid, 'A-12');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(4, 'fb400000-0000-0000-0000-0000000000a1', 'A1-2') $$,
  '[RG-4b] «A1-2» se registra aunque exista «A-12» del mismo proveedor');
SELECT public.hx4_alta(5, :PA::uuid, '001-1234');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(6, 'fb400000-0000-0000-0000-0000000000a1', '0011-234') $$,
  '[RG-4c] «0011-234» se registra aunque exista «001-1234» del mismo proveedor');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id IN (public.hx4_id(1), public.hx4_id(2), public.hx4_id(3), public.hx4_id(4), public.hx4_id(5), public.hx4_id(6))), 6,
  '[RG-4c] las seis facturas distintas quedaron registradas');

-- ═══════════════════════════════════════════════════════════════════════════
-- b · La matriz de 20 pares (RG-4.comparacion.sql): 10 duplicados, 5 distintos legítimos, 5 ambiguos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE hx4_casos (id text, cat text, n1 text, n2 text, esperado text, nota text);
INSERT INTO hx4_casos VALUES
 ('D01','dup','FAC-001','fac-001',       'BLOQUEA','mayúsculas'),
 ('D02','dup','FAC-001',' FAC 001 ',     'BLOQUEA','espacios'),
 ('D03','dup','FAC-001','FAC001',        'BLOQUEA','sin separador'),
 ('D04','dup','FAC-001','FAC.001',       'BLOQUEA','punto'),
 ('D05','dup','FAC-001','FAC/001',       'BLOQUEA','barra'),
 ('D06','dup','FAC-001','FAC_001',       'BLOQUEA','guion bajo'),
 ('D07','dup','001-0000123','0010000123','BLOQUEA','sin separador, largo'),
 ('D08','dup','A-12','A12',              'BLOQUEA','sin separador, corto'),
 ('D09','dup','F-1234','f 1234',         'BLOQUEA','mayúsc.+espacio'),
 ('D10','dup','FAC-001','FAC–001',       'BLOQUEA','raya larga (pegado de PDF)'),
 ('L01','distinta','1-23','12-3',        'PASA','hallazgo'),
 ('L02','distinta','A-12','A1-2',        'PASA','hallazgo'),
 ('L03','distinta','001-1234','0011-234','PASA','serie de 3 vs 4'),
 ('L04','distinta','B-100','B1-00',      'PASA','serie B vs B1'),
 ('L05','distinta','2-345','23-45',      'PASA','serie 2 vs 23'),
 ('M01','ambiguo','1-23','123',          'BLOQUEA','con separador vs sin'),
 ('M02','ambiguo','A-12','A-1-2',        'BLOQUEA','un separador de más'),
 ('M03','ambiguo','1-2-3','12-3',        'BLOQUEA','dos separadores vs uno'),
 ('M04','ambiguo','FAC-001','FA-C001',   'PASA','separador corrido (misma forma que L04)'),
 ('M05','ambiguo','1.234','12.34',       'PASA','miles distintos (misma forma que L05)');
GRANT SELECT ON hx4_casos TO PUBLIC;
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
CREATE TEMP TABLE hx4_resultados AS SELECT c.*, public.hx4_par(c.n1, c.n2) AS obtenido FROM hx4_casos c;
RESET ROLE;
SELECT public.chk_txt(r.obtenido, r.esperado, format('[RG-4·matriz] %s «%s» / «%s» (%s) → %s', r.id, r.n1, r.n2, r.nota, r.esperado))
  FROM hx4_resultados r ORDER BY r.id;
SELECT public.chk((SELECT count(*) FROM hx4_resultados WHERE cat = 'dup' AND obtenido = 'BLOQUEA'), 10,
  '[RG-4·matriz] duplicados reales rechazados: 10 de 10');
SELECT public.chk((SELECT count(*) FROM hx4_resultados WHERE cat = 'distinta' AND obtenido = 'PASA'), 5,
  '[RG-4·matriz] distintos legítimos aceptados: 5 de 5');
SELECT public.chk((SELECT count(*) FROM hx4_resultados WHERE cat = 'ambiguo' AND obtenido = 'BLOQUEA'), 3,
  '[RG-4·matriz] ambiguos que se siguen rechazando: 3 de 5 (los otros 2 tienen la forma de un distinto legítimo)');

-- [RG-4·forma] Por qué 2 de los 5 ambiguos no pueden rechazarse: tienen la MISMA forma estructural (misma clave, un
-- solo separador por número, en posiciones distintas) que los distintos legítimos. Lo único que los separa es el
-- significado de las letras o del tipo de separador, que la regla no conoce.
SELECT public.chk_bool(
  (SELECT bool_and(public.compras_normalizar_numero(n1) = public.compras_normalizar_numero(n2)
                   AND cardinality(public.compras_numero_separadores(n1)) = 1
                   AND cardinality(public.compras_numero_separadores(n2)) = 1
                   AND public.compras_numero_separadores(n1) <> public.compras_numero_separadores(n2))
     FROM hx4_casos WHERE id IN ('L01','L02','L03','L04','L05','M04','M05')), true,
  '[RG-4·forma] L01…L05 y M04, M05 son pares de «un separador por número, en posición distinta»: indistinguibles por estructura');

-- ═══════════════════════════════════════════════════════════════════════════
-- c · Los VERDADEROS duplicados se siguen rechazando, por la API
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(10, :PA::uuid, 'FAC-001');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'fac-001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «fac-001» es «FAC-001» (mayúsculas)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', ' FAC 001 ') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] « FAC 001 » es «FAC-001» (espacios en vez de guion)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'FAC001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC001» es «FAC-001» (sin separador)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'FAC.001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC.001» es «FAC-001» (punto)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'FAC/001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC/001» es «FAC-001» (barra)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'FAC_001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC_001» es «FAC-001» (guion bajo)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'FAC-001') $$,
  'uq_facturas_prov_numero', '[RG-4d] el número idéntico lo sigue rechazando el índice único de siempre');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'FAC-001') $$), 'IDENTICO',
  '[RG-4d] …con el error NATIVO del índice (no con el del trigger): la clave idéntica no pasa por la regla de separadores');
-- Con separador frente a sin separador: ambiguo, del lado seguro (igual que 0400).
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'A12') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «A12» (sin separador) frente a «A-12» y «A1-2» se sigue rechazando');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', '123') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «123» (sin separador) frente a «1-23» y «12-3» se sigue rechazando');
-- Un tercer número con la misma clave y el MISMO separador que uno existente: duplicado.
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', '12/3') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «12/3» es «12-3» (otro tipo de separador, misma posición)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(11, 'fb400000-0000-0000-0000-0000000000a1', 'a 1 2') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «a 1 2» comparte clave con «A-12» y «A1-2» y es compatible con ambas: duplicado');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- d · ORDEN DE INSERCIÓN y NO TRANSITIVIDAD: «1-23» ~ «123» ~ «12-3», pero «1-23» ≁ «12-3»
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.chk_bool(public.compras_numeros_equivalentes('1-23', '123'), true,  '[RG-4·orden·montaje] «1-23» ~ «123»');
SELECT public.chk_bool(public.compras_numeros_equivalentes('123', '12-3'), true,  '[RG-4·orden·montaje] «123» ~ «12-3»');
SELECT public.chk_bool(public.compras_numeros_equivalentes('1-23', '12-3'), false, '[RG-4·orden·montaje] «1-23» ≁ «12-3»: NO es transitiva');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
-- 1) «1-23», «12-3» y DESPUÉS «123» (y todo lo compatible con alguna de las dos): se rechaza contra cualquiera de las vivas
SELECT public.hx4_alta(20, :PB::uuid, '1-23');
SELECT public.hx4_alta(21, :PB::uuid, '12-3');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(22, 'fb400000-0000-0000-0000-0000000000a2', '123') $$), 'BLOQUEA',
  '[RG-4·orden] alta de «123» tras «1-23» y «12-3»: se rechaza (es compatible con las dos)');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(22, 'fb400000-0000-0000-0000-0000000000a2', '1/23') $$), 'BLOQUEA',
  '[RG-4·orden] «1/23» (otro separador, misma posición que «1-23») se rechaza');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(22, 'fb400000-0000-0000-0000-0000000000a2', '12 3') $$), 'BLOQUEA',
  '[RG-4·orden] «12 3» (misma posición que «12-3») se rechaza');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(22, 'fb400000-0000-0000-0000-0000000000a2', '1-2-3') $$), 'BLOQUEA',
  '[RG-4·orden] «1-2-3» (perfil {1,2}, incluye al de las dos) se rechaza');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(22, 'fb400000-0000-0000-0000-0000000000a2', '1-23') $$), 'IDENTICO',
  '[RG-4·orden] «1-23» otra vez: el índice único exacto');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PB::uuid AND estado <> 'anulada'), 2,
  '[RG-4·orden] quedan exactamente «1-23» y «12-3»');
SELECT public.chk(public.hx4_pares_equivalentes(:PB::uuid), 0, '[RG-4·orden] invariante: ningún par de vivas del proveedor es equivalente');
-- 2) «123» PRIMERO: después ni «1-23» ni «12-3» entran
SELECT public.hx4_alta(30, :PM::uuid, '123');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(31, 'fb400000-0000-0000-0000-0000000000a3', '1-23') $$), 'BLOQUEA',
  '[RG-4·orden] con «123» registrada primero, «1-23» se rechaza');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(31, 'fb400000-0000-0000-0000-0000000000a3', '12-3') $$), 'BLOQUEA',
  '[RG-4·orden] …y «12-3» también');
SELECT public.chk(public.hx4_pares_equivalentes(:PM::uuid), 0, '[RG-4·orden] invariante tras «123» primero');
-- 3) «1-23», «123» (rechazada), «12-3» (aceptada): el rechazo de «123» no condiciona a «12-3»
SELECT public.hx4_alta(40, :PG::uuid, '1-23');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(41, 'fb400000-0000-0000-0000-0000000000a4', '123') $$), 'BLOQUEA',
  '[RG-4·orden] «123» tras «1-23»: se rechaza');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(42, 'fb400000-0000-0000-0000-0000000000a4', '12-3') $$), 'PASA',
  '[RG-4·orden] …y «12-3», que no es compatible con «1-23», entra después');
SELECT public.chk(public.hx4_pares_equivalentes(:PG::uuid), 0, '[RG-4·orden] invariante tras «1-23», «123»✗, «12-3»');
-- 4) Anulaciones: «123» sigue rechazada mientras viva ALGUNA de las dos; se acepta cuando no queda ninguna
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = public.hx4_id(20);
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(23, 'fb400000-0000-0000-0000-0000000000a2', '123') $$), 'BLOQUEA',
  '[RG-4·orden] anulada «1-23», «123» se sigue rechazando por «12-3»');
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = public.hx4_id(21);
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(23, 'fb400000-0000-0000-0000-0000000000a2', '123') $$,
  '[RG-4·orden] anuladas las dos, «123» se acepta');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(24, 'fb400000-0000-0000-0000-0000000000a2', '1-23') $$), 'BLOQUEA',
  '[RG-4·orden] …y ahora «1-23» (viva «123») se rechaza otra vez');
SELECT public.chk_txt(public.hx4_intenta($$ SELECT public.hx4_alta(24, 'fb400000-0000-0000-0000-0000000000a2', '12-3') $$), 'BLOQUEA',
  '[RG-4·orden] …y «12-3» también');
SELECT public.chk(public.hx4_pares_equivalentes(:PB::uuid), 0, '[RG-4·orden] invariante tras las anulaciones');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- e · AL AZAR contra un modelo independiente: altas, cambios de número y anulaciones, en cualquier orden
--     El modelo se construye POR GENERACIÓN (las posiciones de los separadores se eligen al azar y se usan
--     para escribir el número): no usa compras_numero_separadores ni compras_numeros_equivalentes.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.hx4_modelo (ronda int, id uuid, texto text, pos int[], vivo boolean);
CREATE TABLE public.hx4_pool   (texto text, pos int[]);
CREATE TABLE public.hx4_bitacora (ronda int, paso int, op text, texto text, esperado text, obtenido text);
GRANT ALL ON public.hx4_modelo, public.hx4_pool, public.hx4_bitacora TO PUBLIC;

-- Escribe la clave `p_key` insertando un separador (de `p_sep`) tras cada posición de `p_pos`; a veces con
-- minúsculas y un separador sobrante al principio o al final: nada de eso debe cambiar la equivalencia.
CREATE FUNCTION public.hx4_escribe(p_key text, p_pos int[], p_sep text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text := ''; i int;
BEGIN
  IF random() < 0.3 THEN p_key := lower(p_key); END IF;
  IF random() < 0.15 THEN r := ' '; END IF;
  FOR i IN 1 .. length(p_key) LOOP
    r := r || substr(p_key, i, 1);
    IF i = ANY (p_pos) THEN r := r || p_sep[1 + floor(random() * cardinality(p_sep))::int]; END IF;
  END LOOP;
  IF random() < 0.15 THEN r := r || '.'; END IF;
  RETURN r;
END $$;

SELECT public.como(:UA::uuid);
SET ROLE authenticated;
DO $$
DECLARE
  v_rondas constant int := 60;
  v_pasos  constant int := 25;
  v_prov   constant uuid := 'fb400000-0000-0000-0000-0000000000a4';
  v_clave  text;
  v_ronda  int; v_paso int; v_i int; v_k int;
  v_ids    int := 1000;
  v_n      int := 0;
  v_pos    int[];
  v_cand   public.hx4_pool;
  v_fila   public.hx4_modelo;
  v_op     text; v_r float; v_etq text;
  v_esp    text; v_obt text;
  v_cont   jsonb := '{}'::jsonb;
BEGIN
  PERFORM setseed(0.4242);
  FOR v_ronda IN 1 .. v_rondas LOOP
    DELETE FROM public.hx4_pool;
    -- clave de 6 caracteres única por ronda: las rondas no se ven entre sí
    v_clave := 'Q' || lpad(v_ronda::text, 2, '0') || 'XYZ';
    FOR v_i IN 1 .. 14 LOOP
      v_pos := ARRAY[]::int[];
      FOR v_k IN 1 .. 5 LOOP
        IF random() < 0.35 THEN v_pos := v_pos || v_k; END IF;
      END LOOP;
      INSERT INTO public.hx4_pool VALUES (public.hx4_escribe(v_clave, v_pos, ARRAY['-', '.', '/', ' ', '_']), v_pos);
    END LOOP;

    FOR v_paso IN 1 .. v_pasos LOOP
      v_r := random();
      v_op := CASE WHEN v_r < 0.60 THEN 'alta' WHEN v_r < 0.85 THEN 'cambio' ELSE 'anula' END;
      IF v_op <> 'alta' AND NOT EXISTS (SELECT 1 FROM public.hx4_modelo WHERE ronda = v_ronda AND vivo) THEN v_op := 'alta'; END IF;
      SELECT * INTO v_cand FROM public.hx4_pool ORDER BY random() LIMIT 1;           -- candidato (texto, posiciones)

      IF v_op = 'alta' THEN
        v_etq := v_cand.texto;
        v_esp := CASE
          WHEN EXISTS (SELECT 1 FROM public.hx4_modelo m WHERE m.ronda = v_ronda AND m.vivo AND m.texto = v_cand.texto) THEN 'IDENTICO'
          WHEN EXISTS (SELECT 1 FROM public.hx4_modelo m WHERE m.ronda = v_ronda AND m.vivo AND (m.pos <@ v_cand.pos OR v_cand.pos <@ m.pos)) THEN 'BLOQUEA'
          ELSE 'PASA' END;
        v_ids := v_ids + 1;
        v_obt := public.hx4_intenta(format('SELECT public.hx4_alta(%s, %L, %L)', v_ids, v_prov, v_cand.texto));
        IF v_obt = 'PASA' THEN
          INSERT INTO public.hx4_modelo VALUES (v_ronda, public.hx4_id(v_ids), v_cand.texto, v_cand.pos, true);
        END IF;
      ELSE
        SELECT * INTO v_fila FROM public.hx4_modelo WHERE ronda = v_ronda AND vivo ORDER BY random() LIMIT 1;
        IF v_op = 'cambio' THEN
          v_etq := v_fila.texto || ' → ' || v_cand.texto;
          v_esp := CASE
            WHEN v_fila.texto = v_cand.texto THEN 'PASA'                                  -- el mismo número: nada que revalidar
            WHEN EXISTS (SELECT 1 FROM public.hx4_modelo m WHERE m.ronda = v_ronda AND m.vivo AND m.id <> v_fila.id AND m.texto = v_cand.texto) THEN 'IDENTICO'
            WHEN EXISTS (SELECT 1 FROM public.hx4_modelo m WHERE m.ronda = v_ronda AND m.vivo AND m.id <> v_fila.id AND (m.pos <@ v_cand.pos OR v_cand.pos <@ m.pos)) THEN 'BLOQUEA'
            ELSE 'PASA' END;
          v_obt := public.hx4_intenta(format('UPDATE public.facturas_proveedor SET numero_factura = %L WHERE id = %L', v_cand.texto, v_fila.id));
          IF v_obt = 'PASA' THEN
            UPDATE public.hx4_modelo SET texto = v_cand.texto, pos = v_cand.pos WHERE id = v_fila.id AND ronda = v_ronda;
          END IF;
        ELSE
          v_etq := v_fila.texto;
          v_esp := 'PASA';
          v_obt := public.hx4_intenta(format('UPDATE public.facturas_proveedor SET estado = ''anulada'' WHERE id = %L', v_fila.id));
          IF v_obt = 'PASA' THEN UPDATE public.hx4_modelo SET vivo = false WHERE id = v_fila.id AND ronda = v_ronda; END IF;
        END IF;
      END IF;

      INSERT INTO public.hx4_bitacora VALUES (v_ronda, v_paso, v_op, v_etq, v_esp, v_obt);
      v_cont := jsonb_set(v_cont, ARRAY[v_op || ':' || v_esp], to_jsonb(COALESCE((v_cont ->> (v_op || ':' || v_esp))::int, 0) + 1));
      IF v_obt IS DISTINCT FROM v_esp THEN
        RAISE EXCEPTION '[RG-4·azar] ronda %, paso %, % «%»: el modelo esperaba %, la base respondió %', v_ronda, v_paso, v_op, v_etq, v_esp, v_obt;
      END IF;
      v_n := v_n + 1;
    END LOOP;
  END LOOP;
  PERFORM set_config('hx4.azar_n', v_n::text, true);
  RAISE NOTICE '  · % operaciones al azar; resultados por (operación:esperado): %', v_n, v_cont;
END $$;
RESET ROLE;
SELECT public.chk(current_setting('hx4.azar_n')::bigint, 1500,
  '[RG-4·azar] 1 500 operaciones (60 rondas × 25 pasos: altas, cambios de número y anulaciones) coinciden con el modelo, sin una discrepancia');
SELECT public.chk_bool((SELECT count(*) FILTER (WHERE op = 'alta' AND esperado = 'PASA') > 100
                          AND count(*) FILTER (WHERE op = 'alta' AND esperado = 'BLOQUEA') > 100
                          AND count(*) FILTER (WHERE op = 'alta' AND esperado = 'IDENTICO') > 0
                          AND count(*) FILTER (WHERE op = 'cambio' AND esperado = 'PASA') > 50
                          AND count(*) FILTER (WHERE op = 'cambio' AND esperado = 'BLOQUEA') > 50
                          AND count(*) FILTER (WHERE op = 'anula') > 50
                     FROM public.hx4_bitacora), true,
  '[RG-4·azar] la prueba no es vacía: hubo altas aceptadas y rechazadas, cambios aceptados y rechazados, anulaciones e idénticos');
SELECT public.chk(public.hx4_pares_equivalentes(:PG::uuid), 0,
  '[RG-4·azar] invariante final: ningún par de facturas VIVAS del proveedor es equivalente (tras 1 500 operaciones en orden arbitrario)');

-- ═══════════════════════════════════════════════════════════════════════════
-- f · El cambio de número (UPDATE) y el cambio de proveedor se controlan con la misma regla
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(50, :PA::uuid, '77-5');
SELECT public.hx4_alta(51, :PA::uuid, 'T-1');
SELECT public.hx4_alta(52, :PA::uuid, 'U-1');
SELECT public.hx4_acepta($$ UPDATE public.facturas_proveedor SET numero_factura = '7-75' WHERE id = public.hx4_id(51) $$,
  '[RG-4f] cambiar el número a «7-75» (otra serie) frente a «77-5» se permite');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = '77.5' WHERE id = public.hx4_id(52) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4f] cambiar el número a «77.5» (mismo separador que «77-5») se rechaza');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = '775' WHERE id = public.hx4_id(52) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4f] cambiar el número a «775» (sin separador) se rechaza');
SELECT public.hx4_acepta($$ UPDATE public.facturas_proveedor SET numero_factura = 'u-1.' WHERE id = public.hx4_id(52) $$,
  '[RG-4f] reescribir el número de la PROPIA factura con otro formato («U-1» → «u-1.») no choca consigo misma');
SELECT public.hx4_acepta($$ UPDATE public.facturas_proveedor SET concepto = 'solo el concepto' WHERE id = public.hx4_id(52) $$,
  '[RG-4f] editar otra columna no revalida el número');
-- Varias filas en UNA sentencia: la segunda ve a la primera
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (public.hx4_id(60), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', 'Z-12', 'x', 1),
           (public.hx4_id(61), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', 'z12', 'x', 1) $$), 'BLOQUEA',
  '[RG-4f] un solo INSERT con «Z-12» y «z12»: la segunda fila ve a la primera y se rechaza');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id IN (public.hx4_id(60), public.hx4_id(61))), 0,
  '[RG-4f] …y la sentencia entera se deshizo');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (public.hx4_id(60), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', 'Y-12', 'x', 1),
           (public.hx4_id(61), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', 'Y1-2', 'x', 1) $$), 'PASA',
  '[RG-4f] un solo INSERT con «Y-12» y «Y1-2» (distintas): las dos entran');
-- Cambio de PROVEEDOR: la factura llega a un proveedor que ya tiene un número equivalente / compatible
SELECT public.hx4_alta(70, :PB::uuid, 'M-45');
SELECT public.hx4_alta(71, :PA::uuid, 'M4-5');
SELECT public.hx4_alta(72, :PA::uuid, 'm 45');   -- perfil {1}: incomparable con el de «M4-5» ({2}), por eso entra en el proveedor A
SELECT public.chk_txt(public.hx4_intenta($$ UPDATE public.facturas_proveedor SET proveedor_id = 'fb400000-0000-0000-0000-0000000000a2' WHERE id = public.hx4_id(72) $$), 'BLOQUEA',
  '[RG-4f] mover «m 45» al proveedor B, que tiene «M-45»: se rechaza (la comprobación usa el proveedor NUEVO)');
SELECT public.chk_txt(public.hx4_intenta($$ UPDATE public.facturas_proveedor SET proveedor_id = 'fb400000-0000-0000-0000-0000000000a2' WHERE id = public.hx4_id(71) $$), 'PASA',
  '[RG-4f] mover «M4-5» al proveedor B, que tiene «M-45»: se acepta (distintas)');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- g · Otro proveedor, usuario con solo «crear», factura anulada, sin número, reactivación por la API
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(80, 'fb400000-0000-0000-0000-0000000000a2', 'F-901') $$,
  '[RG-4g] el proveedor B registra «F-901» sin problema');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(81, 'fb400000-0000-0000-0000-0000000000a1', 'F-901') $$,
  '[RG-4g] …y el proveedor A el mismo número (otro proveedor: no choca)');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(82, 'fb400000-0000-0000-0000-0000000000a2', 'F9-01') $$,
  '[RG-4g] …y «F9-01» junto a «F-901» en el mismo proveedor (distintas)');
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(83, :PB::uuid, 'K-45');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(84, 'fb400000-0000-0000-0000-0000000000a2', 'K4-5') $$,
  '[RG-4g] un usuario con solo «crear» (sin aprobar ni cambiar estado) registra «K4-5» junto a «K-45»: no hace falta ningún permiso extra');
SELECT public.chk_falla($$ SELECT public.hx4_alta(85, 'fb400000-0000-0000-0000-0000000000a2', 'k 45') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4g] …y «k 45» sigue siendo duplicado de «K-45» para ese mismo usuario');
RESET ROLE;
-- Anulada: su número equivalente (y el idéntico) se puede reutilizar; reactivarla por la API está cerrado
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = public.hx4_id(10);
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(86, 'fb400000-0000-0000-0000-0000000000a1', 'fac 001') $$,
  '[RG-4g] con «FAC-001» anulada, «fac 001» se puede volver a registrar');
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = public.hx4_id(86);
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(87, 'fb400000-0000-0000-0000-0000000000a1', 'FAC-001') $$,
  '[RG-4g] …y, anulada también esa, hasta el número idéntico «FAC-001» (el índice único excluye las anuladas)');
-- Reactivar una anulada reabriría el hueco (el trigger de números no se dispara al cambiar solo `estado`): lo cierra
-- cxp_proteger_factura («una factura anulada no se modifica», para cualquier sesión sin el GUC interno de sistema) y,
-- en segundo plano, la máquina de estados de 0300 (COMPRAS_FACTURA_TRANSICION, para sesiones de usuario).
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'registrada' WHERE id = public.hx4_id(10) $$,
  'CXP_INMUTABLE: una factura anulada no se modifica', '[RG-4g] reactivar la «FAC-001» anulada por la API: una factura anulada no se modifica (no reabre el hueco de la equivalencia)');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = public.hx4_id(10) $$,
  'CXP_INMUTABLE: una factura anulada no se modifica', '[RG-4g] …ni aprobarla directamente');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = 'FAC-002' WHERE id = public.hx4_id(10) $$,
  'CXP_INMUTABLE: una factura anulada no se modifica', '[RG-4g] …ni cambiarle el número a una anulada');
-- Sin número y solo-separadores: no se comparan
SELECT public.hx4_acepta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (public.hx4_id(88), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', NULL, 'sin número', 1),
           (public.hx4_id(89), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', NULL, 'otra sin número', 1) $$,
  '[RG-4g] dos facturas sin número conviven (no hay nada que comparar)');
SELECT public.hx4_acepta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (public.hx4_id(90), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', '---', 'solo guiones', 1),
           (public.hx4_id(91), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a1', '...', 'solo puntos', 1) $$,
  '[RG-4g] «---» y «...» (sin letras ni dígitos: sin clave) no se comparan entre sí');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- g2 · Lo que NACE o QUEDA «anulada» no se compara con las vivas (el índice único también excluye las anuladas)
-- ═══════════════════════════════════════════════════════════════════════════
-- Nacer «anulada» solo existe por el camino de SISTEMA (una sesión de usuario recibe COMPRAS_ESTADO_INICIAL); anular Y cambiar
-- el número en la MISMA sentencia sí lo puede hacer una sesión con change_status. En los dos casos el número equivalente de una
-- fila anulada no choca con la viva, mientras que el MISMO número en una factura viva sí se rechaza (controles positivos).
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(140, :PN::uuid, 'FAC-001');
SELECT public.hx4_alta(141, :PN::uuid, 'X-9');
SELECT public.hx4_alta(142, :PN::uuid, 'Y-9');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_bool(public.compras_sesion_usuario(), false, '[RG-4g2·montaje] la sesión es de sistema (sin usuario)');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
    VALUES (public.hx4_id(143), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a6', 'fac 001', 'anulada de sistema', 100, 'anulada') $$), 'PASA',
  '[RG-4g2] sistema: una factura que NACE «anulada» con el número «fac 001» se registra aunque «FAC-001» esté viva (lo anulado no se compara)');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
    VALUES (public.hx4_id(144), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a6', 'FAC001', 'otra anulada de sistema', 100, 'anulada') $$), 'PASA',
  '[RG-4g2] …y otra «anulada» «FAC001» (sin separador): las anuladas conviven con la viva y entre sí');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (public.hx4_id(145), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', 'fb400000-0000-0000-0000-0000000000a6', 'fac 001', 'viva de sistema', 100) $$), 'BLOQUEA',
  '[RG-4g2] control: el MISMO «fac 001» en una factura VIVA sí se rechaza (la diferencia es el estado «anulada», no el camino de sistema)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_txt(public.hx4_intenta($$ UPDATE public.facturas_proveedor SET estado = 'anulada', numero_factura = 'fac 001' WHERE id = public.hx4_id(141) $$), 'PASA',
  '[RG-4g2] usuario: UPDATE que ANULA y cambia el número a «fac 001» en la misma sentencia pasa (la fila queda anulada; «FAC-001» sigue viva)');
SELECT public.chk_txt(public.hx4_intenta($$ UPDATE public.facturas_proveedor SET numero_factura = 'fac 001' WHERE id = public.hx4_id(142) $$), 'BLOQUEA',
  '[RG-4g2] control: el mismo cambio de número SIN anular («Y-9» → «fac 001», sigue viva) se rechaza');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_txt(public.hx4_sistema($$ UPDATE public.facturas_proveedor SET numero_factura = 'fac.001' WHERE id = public.hx4_id(143) $$), 'PASA',
  '[RG-4g2] sistema: cambiar el número de una factura que YA está anulada («fac 001» → «fac.001») tampoco se compara con la viva');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PN::uuid AND estado <> 'anulada'), 2,
  '[RG-4g2] quedan vivas exactamente «FAC-001» y «Y-9» (las tres anuladas no cuentan)');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PN::uuid AND estado = 'anulada'), 3,
  '[RG-4g2] …y las tres anuladas siguen registradas');
SELECT public.chk(public.hx4_pares_equivalentes(:PN::uuid), 0, '[RG-4g2] invariante: ningún par de vivas del proveedor es equivalente');

-- ═══════════════════════════════════════════════════════════════════════════
-- h · La RPC transaccional da el mismo resultado y el mismo código de error
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_acepta($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fb400000-0000-0000-0000-0000000000a2","numero_factura":"9-80","concepto":"RPC primera","monto_total":100,"clave_idempotencia":"rg4-clave-0001"}'::jsonb, '[]'::jsonb) $$,
  '[RG-4h] compras_factura_crear registra «9-80»');
SELECT public.hx4_acepta($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fb400000-0000-0000-0000-0000000000a2","numero_factura":"98-0","concepto":"RPC otra","monto_total":100,"clave_idempotencia":"rg4-clave-0002"}'::jsonb, '[]'::jsonb) $$,
  '[RG-4h] compras_factura_crear registra «98-0» junto a «9-80» (otra factura)');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fb400000-0000-0000-0000-0000000000a2","numero_factura":"9/80","concepto":"RPC duplicada","monto_total":100,"clave_idempotencia":"rg4-clave-0003"}'::jsonb, '[]'::jsonb) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4h] compras_factura_crear rechaza «9/80» (misma estructura que «9-80») con el error de siempre');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fb400000-0000-0000-0000-0000000000a2","numero_factura":"980","concepto":"RPC ambigua","monto_total":100,"clave_idempotencia":"rg4-clave-0004"}'::jsonb, '[]'::jsonb) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4h] …y «980» (sin separador frente a «9-80» y «98-0») también');
-- Reintento idempotente: la misma clave y el mismo contenido devuelven la MISMA factura (no pasa por la regla de números)
SELECT public.chk_bool(
  (SELECT (r->>'reutilizada')::boolean AND (r->'factura'->>'numero_factura') = '9-80'
     FROM (SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
        '{"proveedor_id":"fb400000-0000-0000-0000-0000000000a2","numero_factura":"9-80","concepto":"RPC primera","monto_total":100,"clave_idempotencia":"rg4-clave-0001"}'::jsonb, '[]'::jsonb) AS r) z), true,
  '[RG-4h] el reintento con la misma clave y contenido recupera «9-80» (reutilizada) en vez de chocar con ella misma');
-- La clave de un intento RECHAZADO no queda gastada: reintentada con un número corregido se registra
SELECT public.hx4_acepta($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fb400000-0000-0000-0000-0000000000a2","numero_factura":"9-81","concepto":"RPC corregida","monto_total":100,"clave_idempotencia":"rg4-clave-0003"}'::jsonb, '[]'::jsonb) $$,
  '[RG-4h] la clave de «9/80» (rechazada) no queda gastada: con el número corregido «9-81» el mismo intento se registra');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- i · Camino del sistema (sin sesión de usuario): misma regla
-- ═══════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_bool(public.compras_sesion_usuario(), false, '[RG-4i·montaje] la sesión es de sistema (sin usuario)');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(100, 'fb400000-0000-0000-0000-0000000000a2', 'S1-23') $$,
  '[RG-4i] sin sesión: «S1-23» se registra');
SELECT public.hx4_acepta($$ SELECT public.hx4_alta(101, 'fb400000-0000-0000-0000-0000000000a2', 'S-123') $$,
  '[RG-4i] sin sesión: «S-123» se registra junto a «S1-23» (otra factura)');
SELECT public.chk_falla($$ SELECT public.hx4_alta(102, 'fb400000-0000-0000-0000-0000000000a2', 's1.23') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4i] sin sesión: «s1.23» sigue siendo duplicado de «S1-23»');

-- ═══════════════════════════════════════════════════════════════════════════
-- j · Aprobar (contabilizar) las dos facturas «distintas» sigue funcionando; un duplicado HISTÓRICO no estorba
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id IN (public.hx4_id(1), public.hx4_id(2));
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id IN (public.hx4_id(1), public.hx4_id(2)) AND estado = 'aprobada'), 2,
  '[RG-4j] «1-23» y «12-3» se aprueban (contabilizan) las dos: el control de número no estorba después');
SET session_replication_role = replica;
SELECT public.hx4_alta(110, :PB::uuid, 'HIS-7');
SELECT public.hx4_alta(111, :PB::uuid, 'HIS7');
SET session_replication_role = origin;
SELECT public.chk(public.hx4_pares_equivalentes(:PB::uuid), 1, '[RG-4j·montaje] el proveedor B tiene un par equivalente HISTÓRICO («HIS-7» / «HIS7»)');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_acepta($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = public.hx4_id(111) $$,
  '[RG-4j] aprobar un duplicado histórico equivalente no se bloquea (solo nace o cambia el número)');
SELECT public.hx4_acepta($$ UPDATE public.facturas_proveedor SET concepto = 'editada' WHERE id = public.hx4_id(110) $$,
  '[RG-4j] …ni editar su concepto');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- k · EV-09 intacto: el mensaje solo nombra lo que la persona ve
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO auth.users (id) VALUES (:UX);
INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (:UX, :C::uuid, 'RG-4 operador solo C1', 'operator');
INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (:UX, :C1::uuid, 'total');
INSERT INTO public.roles (id, company_id, name) VALUES ('fb400000-0000-0000-0000-0000000000f3', :C::uuid, 'RG-4 ver y crear');
INSERT INTO public.role_permissions (role_id, permission_key, effect) VALUES
  ('fb400000-0000-0000-0000-0000000000f3', 'platform.contabilidad.view',   'allow'),
  ('fb400000-0000-0000-0000-0000000000f3', 'platform.contabilidad.create', 'allow'),
  ('fb400000-0000-0000-0000-0000000000f3', 'platform.contabilidad.edit',   'allow');
INSERT INTO public.user_roles (user_id, role_id) VALUES (:UX, 'fb400000-0000-0000-0000-0000000000f3');
-- «OCU-7002» vive en C2 (el operador solo ve C1); «VIS9001» (C2) y «VIS-9001» (C1) son un par HISTÓRICO equivalente: la oculta
-- se inserta PRIMERO para que, sin el ORDER BY de EV-09, el motor la devolviera antes.
SET session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado) VALUES
  (public.hx4_id(120), :C::uuid, :C2::uuid, :PA::uuid, 'OCU-7002',  'oculta (C2)',  5555.55, 'aprobada'),
  (public.hx4_id(122), :C::uuid, :C2::uuid, :PA::uuid, 'VIS9001',   'oculta (C2)',  4444.44, 'aprobada'),
  (public.hx4_id(123), :C::uuid, :C1::uuid, :PA::uuid, 'VIS-9001',  'visible (C1)',  300.00, 'aprobada'),
  -- tres ocultas con estructuras de separadores distintas: el aviso genérico no debe delatarlas
  (public.hx4_id(125), :C::uuid, :C2::uuid, :PA::uuid, 'HID-A1',    'oculta (C2)',   701.01, 'aprobada'),
  (public.hx4_id(126), :C::uuid, :C2::uuid, :PA::uuid, 'HID-B2',    'oculta (C2)',   702.02, 'aprobada'),
  (public.hx4_id(127), :C::uuid, :C2::uuid, :PA::uuid, 'HIDC3',     'oculta (C2)',   703.03, 'aprobada');
SET session_replication_role = origin;
SELECT public.como(:UX::uuid);
SET ROLE authenticated;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id IN (public.hx4_id(120), public.hx4_id(122))), 0, '[RG-4k·montaje] el operador limitado no ve las facturas de C2');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id = public.hx4_id(123)), 1, '[RG-4k·montaje] …pero sí la de C1');
SELECT public.chk_falla($$ SELECT public.hx4_alta(121, 'fb400000-0000-0000-0000-0000000000a1', 'ocu 7002') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente\. Si es la misma, no la registres otra vez\.',
  '[RG-4k] el operador limitado recibe el aviso genérico del duplicado de una factura de un proyecto que no ve');
DO $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM public.hx4_alta(121, 'fb400000-0000-0000-0000-0000000000a1', 'ocu 7002');
  EXCEPTION WHEN OTHERS THEN v := SQLERRM; END;
  IF v IS NULL THEN RAISE EXCEPTION '[RG-4k] no falló'; END IF;
  IF v ~* '(OCU-7002|OCU7002|5555|aprobada|/20[0-9]{2})' THEN RAISE EXCEPTION '[RG-4k] el mensaje delata la factura oculta: %', v; END IF;
  RAISE NOTICE '✓ [RG-4k] el aviso genérico no dice número, fecha, importe ni estado de la factura de un proyecto que la persona no ve (%)', left(v, 90);
END $$;
-- Con DOS candidatas equivalentes, una oculta y otra visible, el mensaje nombra la VISIBLE (ORDER BY de EV-09 conservado)
SELECT public.chk_falla($$ SELECT public.hx4_alta(124, 'fb400000-0000-0000-0000-0000000000a1', 'vis 9001') $$,
  '«VIS-9001», .* por 300\.00, aprobada\)\.',
  '[RG-4k] con una candidata oculta y otra visible, el aviso nombra la visible');
DO $$
DECLARE v text;
BEGIN
  BEGIN PERFORM public.hx4_alta(124, 'fb400000-0000-0000-0000-0000000000a1', 'vis 9001'); EXCEPTION WHEN OTHERS THEN v := SQLERRM; END;
  IF v ~* '(VIS9001|4444)' THEN RAISE EXCEPTION '[RG-4k] el aviso delata la candidata oculta: %', v; END IF;
  RAISE NOTICE '✓ [RG-4k] …y no delata la oculta («VIS9001», 4444.44)';
END $$;
-- [RG-4k·sugerencia] EV-09: el aviso genérico es UN texto constante. La existente oculta puede traer MENOS separadores que el número
-- que se escribe («HIDC3»), MÁS («HID-A1» frente a «HIDA1») o los MISMOS («HID-B2» frente a «hid b2»): el texto es idéntico, con
-- SQLSTATE 23505 y la restricción uq_facturas_prov_numero (la RPC y el cliente dependen de ellos).
SELECT public.chk_txt(public.hx4_error($$ SELECT public.hx4_alta(150, 'fb400000-0000-0000-0000-0000000000a1', 'HIDA1') $$),
  '23505|uq_facturas_prov_numero|' || :'generico',
  '[RG-4k·sugerencia] oculta «HID-A1» (más separadores que «HIDA1»): el aviso es el genérico constante, SQLSTATE 23505 y restricción uq_facturas_prov_numero');
SELECT public.chk_txt(public.hx4_error($$ SELECT public.hx4_alta(151, 'fb400000-0000-0000-0000-0000000000a1', 'hid b2') $$),
  '23505|uq_facturas_prov_numero|' || :'generico',
  '[RG-4k·sugerencia] oculta «HID-B2» (los mismos separadores que «hid b2»): exactamente el mismo texto');
SELECT public.chk_txt(public.hx4_error($$ SELECT public.hx4_alta(152, 'fb400000-0000-0000-0000-0000000000a1', 'HID-C3') $$),
  '23505|uq_facturas_prov_numero|' || :'generico',
  '[RG-4k·sugerencia] oculta «HIDC3» (menos separadores que «HID-C3»): exactamente el mismo texto');
SELECT public.chk_bool(:'generico' !~ '(se registró con (más|menos) separadores|solo difiere|HID)', true,
  '[RG-4k·sugerencia] el texto genérico no contiene ninguna de las frases que describen la estructura de la factura existente');
RESET ROLE;
-- Quien SÍ ve la factura existente recibe la sugerencia que corresponde a cómo difieren los separadores.
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(160, :PS::uuid, 'MEN-007');
SELECT public.hx4_alta(161, :PS::uuid, 'MAS007');
SELECT public.hx4_alta(162, :PS::uuid, 'IGU-007');
SELECT public.hx4_alta(163, :PS::uuid, 'P-12');
SELECT public.hx4_alta(164, :PS::uuid, 'Q-1-2');
SELECT public.hx4_alta(165, :PS::uuid, '4-56');
SELECT public.hx4_alta(166, :PS::uuid, '45-6');
-- el que se escribe trae MENOS separadores que la existente → «escríbelo como viene impreso… si ya lo escribiste así, la existente trae más»
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', 'MEN007') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«MEN-007», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo \(p\. ej\. «A-123»\); si ya lo escribiste así, la existente se registró con más separadores: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «MEN007» frente a «MEN-007» (el nuevo trae menos separadores): escribirlo como viene impreso, o corregir la existente si ya es así');
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', 'Q-12') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«Q-1-2», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo \(p\. ej\. «A-123»\); si ya lo escribiste así, la existente se registró con más separadores: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «Q-12» ({1}) frente a «Q-1-2» ({1,2}): el nuevo trae menos separadores aunque no sea ninguno');
-- el que se escribe trae MÁS separadores que la existente → ya no manda a escribir el guion que la persona acaba de escribir
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', 'MAS-007') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«MAS007», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «MAS-007» frente a «MAS007» (el nuevo trae más separadores): la existente se registró con menos; corrige o anula esa primero');
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', 'P-1-2') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«P-12», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «P-1-2» ({1,2}) frente a «P-12» ({1}): el perfil de la existente está incluido en el del nuevo');
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', '4-5-6') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«(4-56|45-6)», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, la existente se registró con menos separadores que el número que escribiste: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «4-5-6» frente a «4-56» y «45-6» (incomparables entre sí): el nuevo incluye a las dos, que traen menos');
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', '456') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«(4-56|45-6)», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, escribe su número tal como viene impreso, con su guion o separador entre serie y correlativo \(p\. ej\. «A-123»\); si ya lo escribiste así, la existente se registró con más separadores: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «456» (sin separadores) frente a «4-56» y «45-6»: el nuevo trae menos que las dos');
-- los MISMOS separadores (solo cambian mayúsculas, espacios o el tipo de separador)
SELECT public.chk_falla($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', 'igu 007') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«IGU-007», \d\d/\d\d/\d{4} por 100\.00, registrada\)\. Si es la misma, no la registres otra vez\. Si es otra, revisa que su número esté escrito tal como viene impreso; si lo está, la existente solo difiere en mayúsculas, espacios o tipo de separador: corrige o anula esa primero\.$',
  '[RG-4k·sugerencia] «igu 007» frente a «IGU-007» (mismos separadores): solo difieren mayúsculas, espacios o tipo de separador');
-- SQLSTATE, restricción y prefijo intactos en el aviso con detalle (la RPC y el cliente dependen de ellos)
SELECT public.chk_bool(public.hx4_error($$ SELECT public.hx4_alta(170, 'fb400000-0000-0000-0000-0000000000a5', 'MAS-007') $$)
                       ~ '^23505\|uq_facturas_prov_numero\|COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«MAS007»', true,
  '[RG-4k·sugerencia] el aviso con detalle conserva SQLSTATE 23505, restricción uq_facturas_prov_numero y el prefijo COMPRAS_FACTURA_NUMERO_DUPLICADO');
SELECT public.chk_falla($$ SELECT public.hx4_alta(121, 'fb400000-0000-0000-0000-0000000000a1', 'ocu 7002') $$,
  '^COMPRAS_FACTURA_NUMERO_DUPLICADO: ya hay una factura de este proveedor con un número equivalente \(«OCU-7002», \d\d/\d\d/\d{4} por 5555\.55, aprobada\)\. Si es la misma, no la registres otra vez\. Si es otra, revisa que su número esté escrito tal como viene impreso; si lo está, la existente solo difiere en mayúsculas, espacios o tipo de separador: corrige o anula esa primero\.$',
  '[RG-4k] el administrador (ve C2) recibe el detalle completo de «OCU-7002» y la sugerencia que corresponde (mismos separadores)');
RESET ROLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- l · UNA SOLA CLAVE: introspección del índice, del trigger y del candado
-- ═══════════════════════════════════════════════════════════════════════════
-- (pg_get_indexdef / pg_get_expr califican con «public.» según el search_path de quien lo ejecuta: se compara sin el prefijo)
CREATE TEMP TABLE hx4_fuente AS
SELECT (SELECT prosrc FROM pg_proc WHERE oid = 'public.compras_tg_factura_numero_equivalente'::regproc) AS trigger_src,
       (SELECT prosrc FROM pg_proc WHERE oid = 'public.compras_numeros_equivalentes(text, text)'::regprocedure) AS equiv_src,
       (SELECT replace(pg_get_expr(i.indexprs, i.indrelid), 'public.', '') FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'idx_facturas_prov_numero_norm') AS indice_expr,
       (SELECT replace(pg_get_indexdef(c.oid), 'public.compras_normalizar_numero', 'compras_normalizar_numero') FROM pg_class c
         WHERE c.relname = 'idx_facturas_prov_numero_norm') AS indice_def;
-- l1 · el índice
SELECT public.chk_txt(indice_expr, 'compras_normalizar_numero(numero_factura)',
  '[RG-4·una clave] el índice indexa compras_normalizar_numero(numero_factura)') FROM hx4_fuente;
SELECT public.chk_txt(indice_def,
  'CREATE INDEX idx_facturas_prov_numero_norm ON public.facturas_proveedor USING btree (company_id, proveedor_id, compras_normalizar_numero(numero_factura)) WHERE ((numero_factura IS NOT NULL) AND (estado <> ''anulada''::text))',
  '[RG-4·una clave] …y es el MISMO índice de 0400 (mismas columnas, misma expresión, mismo predicado parcial; no se reconstruyó con otra clave)') FROM hx4_fuente;
-- l2 · el trigger calcula la clave UNA vez y la usa para el candado y para la consulta
SELECT public.chk_bool(trigger_src ~ 'v_norm\s+text\s*:=\s*public\.compras_normalizar_numero\(NEW\.numero_factura\)', true,
  '[RG-4·una clave] el trigger calcula v_norm = compras_normalizar_numero(NEW.numero_factura) una sola vez') FROM hx4_fuente;
SELECT public.chk((SELECT count(*) FROM hx4_fuente f, regexp_matches(f.trigger_src, 'compras_normalizar_numero\(', 'g')), 2,
  '[RG-4·una clave] y solo hay DOS llamadas en todo el cuerpo: la de v_norm y la de la expresión del índice sobre la fila candidata');
SELECT public.chk_bool((regexp_match(trigger_src, 'pg_advisory_xact_lock\((.*?)\);', 's'))[1] ~ '\|\| v_norm, 0\)'
                       AND (regexp_match(trigger_src, 'pg_advisory_xact_lock\((.*?)\);', 's'))[1] !~* '(normalizar|regexp|upper|lower|translate)', true,
  '[RG-4·una clave] el candado consultivo se calcula con v_norm (sin ninguna otra normalización)') FROM hx4_fuente;
SELECT public.chk_bool(position(('public.' || replace(indice_expr, 'numero_factura', 'f.numero_factura') || ' = v_norm') IN trigger_src) > 0, true,
  '[RG-4·una clave] la consulta compara v_norm contra la expresión del índice (alias f), carácter por carácter') FROM hx4_fuente;
SELECT public.chk_bool(trigger_src !~* '(regexp_replace|upper\(|lower\(|translate\(|unaccent|btrim|trim\()', true,
  '[RG-4·una clave] el trigger no contiene ninguna otra normalización (regexp_replace, upper, lower, translate, unaccent, trim)') FROM hx4_fuente;
SELECT public.chk_bool(trigger_src ~ 'compras_numeros_equivalentes\(f\.numero_factura, NEW\.numero_factura\)'
                       AND trigger_src ~ 'f\.numero_factura IS NOT NULL'
                       AND trigger_src ~ 'ORDER BY public\.compras_puede_ver_documento\(f\.company_id, f\.project_id\) DESC', true,
  '[RG-4·una clave] y conserva [DEP-2] (numero_factura IS NOT NULL), [EV-09] (ORDER BY compras_puede_ver_documento) y el criterio de separadores') FROM hx4_fuente;
-- l3 · las funciones nuevas no tienen su propia clave: usan la misma
SELECT public.chk_bool(equiv_src ~ 'public\.compras_normalizar_numero\(p_a\)\s*=\s*public\.compras_normalizar_numero\(p_b\)'
                       AND equiv_src !~* '(regexp|upper|lower|translate)', true,
  '[RG-4·una clave] compras_numeros_equivalentes compara la clave con compras_normalizar_numero (no tiene una propia)') FROM hx4_fuente;
-- l4 · atributos de las funciones y del trigger
SELECT public.chk_bool(
  (SELECT bool_and(p.provolatile = 'i' AND p.proisstrict AND p.proparallel = 's' AND NOT p.prosecdef
                   AND p.proconfig = ARRAY['search_path=pg_catalog'])
     FROM pg_proc p WHERE p.oid IN ('public.compras_numero_separadores(text)'::regprocedure, 'public.compras_numeros_equivalentes(text, text)'::regprocedure)), true,
  '[RG-4·una clave] las dos funciones nuevas son IMMUTABLE, STRICT, PARALLEL SAFE, SECURITY INVOKER y con search_path fijo');
SELECT public.chk_bool(
  (SELECT p.provolatile = 'i' AND p.proisstrict FROM pg_proc p WHERE p.oid = 'public.compras_normalizar_numero(text)'::regprocedure), true,
  '[RG-4·una clave] compras_normalizar_numero sigue IMMUTABLE y STRICT (0800): la pieza no la redefine');
SELECT public.chk_bool(
  (SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=public, pg_temp'] FROM pg_proc p WHERE p.oid = 'public.compras_tg_factura_numero_equivalente'::regproc), true,
  '[RG-4·una clave] el trigger sigue siendo SECURITY DEFINER con search_path fijo');
SELECT public.chk_bool(
  NOT has_function_privilege('authenticated', 'public.compras_numeros_equivalentes(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.compras_numeros_equivalentes(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.compras_numero_separadores(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.compras_numero_separadores(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.compras_numeros_equivalentes(text, text)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.compras_normalizar_numero(text)', 'EXECUTE'), true,
  '[RG-4·una clave] las funciones nuevas no se exponen a authenticated ni anon (solo el trigger las usa); la del índice sigue ejecutable por authenticated');
SELECT public.chk_bool(
  (SELECT t.tgenabled = 'O' AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16
          AND pg_get_triggerdef(t.oid) ~ 'UPDATE OF numero_factura, proveedor_id'
     FROM pg_trigger t WHERE t.tgrelid = 'public.facturas_proveedor'::regclass AND t.tgname = 'trg_compras_factura_numero_equivalente'), true,
  '[RG-4·una clave] el trigger sigue activo, BEFORE, por fila, en INSERT y en UPDATE OF numero_factura, proveedor_id');
-- l5 · COMPORTAMIENTO: el candado que toma el trigger es el de la clave normalizada (lo que ve pg_locks)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx4_alta(130, :PA::uuid, ' fac-777/9 ');
RESET ROLE;
SELECT public.chk(
  (SELECT count(*) FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND ((l.classid::text::bigint << 32) | l.objid::text::bigint)
          = hashtextextended('factura-numero:' || 'cccccccc-cccc-cccc-cccc-cccccccccccc' || ':' || 'fb400000-0000-0000-0000-0000000000a1' || ':' || public.compras_normalizar_numero(' fac-777/9 '), 0)), 1,
  '[RG-4·una clave] el alta de « fac-777/9 » retiene el candado consultivo de la clave FAC7779 (la misma que indexa el índice)');
SELECT public.chk(
  (SELECT count(*) FROM pg_locks l
    WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted AND l.objsubid = 1
      AND ((l.classid::text::bigint << 32) | l.objid::text::bigint)
          = hashtextextended('factura-numero:' || 'cccccccc-cccc-cccc-cccc-cccccccccccc' || ':' || 'fb400000-0000-0000-0000-0000000000a1' || ':' || ' fac-777/9 ', 0)), 0,
  '[RG-4·una clave] …y NO el de la cadena sin normalizar');
-- …y el índice guarda la misma clave: con el barrido secuencial apagado, la fila se encuentra por la expresión normalizada
SET LOCAL enable_seqscan = off;
SET LOCAL enable_bitmapscan = off;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor
                    WHERE company_id = :C::uuid AND proveedor_id = :PA::uuid AND estado <> 'anulada' AND numero_factura IS NOT NULL
                      AND public.compras_normalizar_numero(numero_factura) = 'FAC7779'), 1,
  '[RG-4·una clave] el índice encuentra « fac-777/9 » por la clave FAC7779');
RESET enable_seqscan;
RESET enable_bitmapscan;

-- ═══════════════════════════════════════════════════════════════════════════
-- m · El perfil de separadores y la equivalencia contra una implementación de REFERENCIA (carácter a carácter)
-- ═══════════════════════════════════════════════════════════════════════════
-- Referencia: recorre upper(texto) carácter a carácter con la misma clase que compras_normalizar_numero ([A-Z0-9]);
-- registra la cuenta de alfanuméricos cada vez que un grupo de separadores queda ENTRE dos alfanuméricos.
CREATE FUNCTION public.hx4_ref_perfil(p text) RETURNS int[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE u text := upper(p); i int; c text; n int := 0; r int[] := ARRAY[]::int[]; sep boolean := false;
BEGIN
  FOR i IN 1 .. length(u) LOOP
    c := substr(u, i, 1);
    IF c ~ '^[A-Z0-9]$' THEN
      IF sep AND n > 0 THEN r := r || n; END IF;
      n := n + 1; sep := false;
    ELSE
      sep := true;
    END IF;
  END LOOP;
  RETURN r;
END $$;
CREATE FUNCTION public.hx4_ref_clave(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE u text := upper(p); i int; c text; r text := '';
BEGIN
  FOR i IN 1 .. length(u) LOOP
    c := substr(u, i, 1);
    IF c ~ '^[A-Z0-9]$' THEN r := r || c; END IF;
  END LOOP;
  RETURN NULLIF(r, '');
END $$;

SELECT setseed(0.1717);
-- Población ANCHA (muchos caracteres, acentos, rayas, tabuladores) y población ESTRECHA (siempre la misma clave de
-- cinco caracteres, «Ab1C2», con separadores al azar entre ellos y en los extremos: muchos pares con la misma clave y
-- perfiles que se incluyen o no).
CREATE TEMP TABLE hx4_cadenas AS
SELECT g AS n, 'ancha' AS pob,
       COALESCE((SELECT string_agg((ARRAY['A','a','Z','0','9','7','-','.','/',' ','_','ñ','Á','–','#',',',E'\t'])[1 + floor(random() * 17)::int], '')
                   FROM generate_series(1, floor(random() * 15)::int + (g - g))), '') AS s
  FROM generate_series(1, 3000) g
UNION ALL
SELECT 10000 + g, 'estrecha',
       (SELECT string_agg(CASE WHEN random() < 0.4 THEN (ARRAY['-','.',' ','/','--'])[1 + floor(random() * 5)::int] ELSE '' END || t.ch, '' ORDER BY t.i)
          FROM unnest(ARRAY['A','b','1','C','2']) WITH ORDINALITY AS t(ch, i) WHERE g > 0)
       || CASE WHEN random() < 0.3 THEN '.' ELSE '' END
  FROM generate_series(1, 110) g;
INSERT INTO hx4_cadenas SELECT 20000 + row_number() OVER (), 'fija', x FROM unnest(ARRAY['', ' ', '-', '---', '1', '1-', '-1', '-1-', '1-2', '1--2', ' 1 - 2 ', 'A-B-C', 'AB-C', 'A-BC', '1.234', '12.34',
  'FAC–001', 'FAC-001', 'FAC001', 'ñ', 'Año-12', 'a1-b2-c3-', '--a--', 'A  B', E'A\nB', E'A\n']) x;
SELECT public.chk_bool((SELECT count(DISTINCT s) FROM hx4_cadenas WHERE pob = 'ancha') > 2500, true,
  '[RG-4·perfil·montaje] la población ancha es variada (más de 2 500 cadenas distintas de 3 000)');
SELECT public.chk((SELECT count(*) FROM hx4_cadenas WHERE public.compras_numero_separadores(s) IS DISTINCT FROM public.hx4_ref_perfil(s)), 0,
  '[RG-4·perfil] el perfil de separadores coincide con la implementación de referencia en 3 136 cadenas (acentos, rayas, tabuladores, saltos de línea, vacías)');
SELECT public.chk((SELECT count(*) FROM hx4_cadenas WHERE public.compras_normalizar_numero(s) IS DISTINCT FROM public.hx4_ref_clave(s)), 0,
  '[RG-4·perfil] y la referencia de la clave coincide con compras_normalizar_numero (la referencia usa la misma clase de caracteres)');
SELECT public.chk((SELECT count(*) FROM hx4_cadenas
                    WHERE EXISTS (SELECT 1 FROM unnest(public.compras_numero_separadores(s)) p
                                   WHERE p < 1 OR p >= length(COALESCE(public.compras_normalizar_numero(s), '')))), 0,
  '[RG-4·perfil] toda posición cae ENTRE dos caracteres de la clave (1 ≤ pos < longitud): los extremos nunca cuentan');
-- Pares con la MISMA clave (población estrecha): la función contra la definición de la regla escrita con la referencia
-- (la referencia se calcula una vez por cadena, no una vez por par)
ALTER TABLE hx4_cadenas ADD COLUMN rk text, ADD COLUMN rp int[];
UPDATE hx4_cadenas SET rk = public.hx4_ref_clave(s), rp = public.hx4_ref_perfil(s);
CREATE TEMP TABLE hx4_pares AS
SELECT public.compras_numeros_equivalentes(a.s, b.s) AS f_ab,
       public.compras_numeros_equivalentes(b.s, a.s) AS f_ba,
       (a.rk = b.rk AND (a.rp <@ b.rp OR b.rp <@ a.rp)) AS ref
  FROM hx4_cadenas a JOIN hx4_cadenas b ON a.rk = b.rk AND a.n < b.n
 WHERE a.pob = 'estrecha' AND b.pob = 'estrecha';
DO $$ BEGIN
  RAISE NOTICE '  · % pares con la misma clave: % equivalentes y % distintos', (SELECT count(*) FROM hx4_pares), (SELECT count(*) FROM hx4_pares WHERE ref), (SELECT count(*) FROM hx4_pares WHERE NOT ref);
END $$;
SELECT public.chk_bool((SELECT count(*) FROM hx4_pares) > 5000 AND (SELECT count(*) FROM hx4_pares WHERE ref) > 500 AND (SELECT count(*) FROM hx4_pares WHERE NOT ref) > 500, true,
  '[RG-4·perfil·montaje] hay miles de pares con la misma clave, con cientos de equivalentes y cientos de distintos');
SELECT public.chk((SELECT count(*) FROM hx4_pares WHERE f_ab IS DISTINCT FROM ref), 0,
  '[RG-4·perfil] la equivalencia coincide con la regla escrita con la referencia en todos esos pares');
SELECT public.chk((SELECT count(*) FROM hx4_pares WHERE f_ab IS DISTINCT FROM f_ba), 0,
  '[RG-4·perfil] la equivalencia es simétrica en todos esos pares');
SELECT public.chk((SELECT count(*) FROM hx4_cadenas WHERE public.compras_normalizar_numero(s) IS NOT NULL AND NOT public.compras_numeros_equivalentes(s, s)), 0,
  '[RG-4·perfil] y reflexiva para todo número con clave');
SELECT public.chk((SELECT count(*) FROM hx4_cadenas a JOIN hx4_cadenas b ON b.n BETWEEN a.n + 1 AND a.n + 3 AND a.pob = 'ancha' AND b.pob = 'ancha'
                    WHERE public.compras_numeros_equivalentes(a.s, b.s) AND public.compras_normalizar_numero(a.s) IS DISTINCT FROM public.compras_normalizar_numero(b.s)), 0,
  '[RG-4·perfil] equivalentes ⇒ misma clave normalizada: todo candidato lo devuelve el índice');
SELECT public.chk_bool(public.compras_numeros_equivalentes('---', '...'), false, '[RG-4·perfil] sin clave (solo separadores) no hay equivalencia');
SELECT public.chk_bool(public.compras_numeros_equivalentes(NULL, '1-23') IS NULL, true, '[RG-4·perfil] con NULL la función es estricta (NULL), como compras_normalizar_numero');

-- ═══════════════════════════════════════════════════════════════════════════
-- n · EL PLAN: con 20 000 facturas de un proveedor la consulta del trigger sigue resolviéndose por el índice
-- ═══════════════════════════════════════════════════════════════════════════
SET LOCAL session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
SELECT ('fb4' || lpad(to_hex(g), 5, '0') || '-0000-0000-0000-0000000000b1')::uuid,
       :C::uuid, :C1::uuid, :PH::uuid,
       (ARRAY['H-', 'H.', 'H/', 'H '])[1 + g % 4] || lpad(g::text, 7, '0'), 'histórica', 10 + (g % 100),
       CASE WHEN g % 50 = 0 THEN 'anulada' ELSE 'aprobada' END
  FROM generate_series(1, 20000) g;
-- Cinco candidatas con la MISMA clave y perfiles incomparables (separador en 1, 2, 3, 4 o 5): la clave ABCDEF.
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
SELECT ('fb4f000' || p || '-0000-0000-0000-0000000000b1')::uuid, :C::uuid, :C1::uuid, :PH::uuid,
       substr('ABCDEF', 1, p) || '-' || substr('ABCDEF', p + 1), 'candidata', 1
  FROM generate_series(1, 5) p;
-- Y 60 proveedores más, de varios cientos de facturas cada uno (18 000 en total): el plan no puede depender de que exista UN
-- proveedor enorme. El proveedor PQ (el primero) lleva además cinco candidatas con la clave QRSTUV.
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
SELECT ('fb4a0000-0000-0000-0000-' || lpad(to_hex(k), 12, '0'))::uuid, :C::uuid, 'Proveedor plan RG-4 ' || k, '9953' || lpad(k::text, 3, '0') || '-' || (k % 10), 'GT', 'empresa'
  FROM generate_series(1, 60) k;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado)
SELECT ('fb4a' || lpad(to_hex((k - 1) * 300 + g), 4, '0') || '-0000-0000-0000-0000000000b2')::uuid, :C::uuid, :C1::uuid,
       ('fb4a0000-0000-0000-0000-' || lpad(to_hex(k), 12, '0'))::uuid,
       (ARRAY['S-', 'S.', 'S/', 'S '])[1 + g % 4] || lpad((k * 1000 + g)::text, 7, '0'), 'histórica', 10 + (g % 100),
       CASE WHEN g % 50 = 0 THEN 'anulada' ELSE 'aprobada' END
  FROM generate_series(1, 60) k, generate_series(1, 300) g;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
SELECT ('fb4b000' || p || '-0000-0000-0000-0000000000b2')::uuid, :C::uuid, :C1::uuid, :PQ::uuid,
       substr('QRSTUV', 1, p) || '-' || substr('QRSTUV', p + 1), 'candidata', 1
  FROM generate_series(1, 5) p;
SET LOCAL session_replication_role = origin;
ANALYZE public.facturas_proveedor;
SELECT public.chk_bool((SELECT count(*) FROM (SELECT proveedor_id FROM public.facturas_proveedor
                                               WHERE proveedor_id::text LIKE 'fb4a0000%' GROUP BY proveedor_id HAVING count(*) >= 300) x) >= 50, true,
  '[RG-4·plan·montaje] hay al menos 50 proveedores con 300 facturas o más (el plan no depende de un solo proveedor grande)');
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE proveedor_id = :PH::uuid), 20005,
  '[RG-4·plan·montaje] el proveedor tiene 20 005 facturas (20 000 históricas con varios separadores + 5 candidatas con la clave ABCDEF)');

-- Extrae la consulta del cuerpo VIGENTE del trigger (si alguien la cambia, la prueba mira la nueva) y la explica.
--   'custom'  = valores literales · 'generic' = plan genérico con parámetros (lo que plpgsql usa desde la 6.ª ejecución)
CREATE FUNCTION public.hx4_plan(p_modo text, p_company uuid, p_prov uuid, p_nuevo text, p_analiza boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_src  text; v_m text[]; v_q text; v_plan jsonb;
  v_norm text := public.compras_normalizar_numero(p_nuevo);
  v_opc  text := CASE WHEN p_analiza THEN 'ANALYZE, FORMAT JSON' ELSE 'FORMAT JSON' END;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.compras_tg_factura_numero_equivalente'::regproc;
  v_m := regexp_match(v_src, '(?s)(SELECT\s.*?)\s+INTO\s+v_dup\s(.*?LIMIT\s+1)');
  IF v_m IS NULL THEN RAISE EXCEPTION '[RG-4·plan] no se pudo extraer la consulta del trigger de su cuerpo (cambió su forma): ajusta esta ayuda'; END IF;
  v_q := v_m[1] || ' ' || v_m[2];
  IF p_modo = 'custom' THEN
    v_q := replace(v_q, 'NEW.company_id',     quote_literal(p_company) || '::uuid');
    v_q := replace(v_q, 'NEW.proveedor_id',   quote_literal(p_prov)    || '::uuid');
    v_q := replace(v_q, 'NEW.id',              quote_literal(gen_random_uuid()) || '::uuid');
    v_q := replace(v_q, 'NEW.numero_factura',  quote_literal(p_nuevo));
    v_q := replace(v_q, 'v_norm',              quote_literal(v_norm));
    EXECUTE 'EXPLAIN (' || v_opc || ') ' || v_q INTO v_plan;
  ELSE
    v_q := replace(v_q, 'NEW.company_id',     '$1');
    v_q := replace(v_q, 'NEW.proveedor_id',   '$2');
    v_q := replace(v_q, 'NEW.id',              '$3');
    v_q := replace(v_q, 'NEW.numero_factura',  '$4');
    v_q := replace(v_q, 'v_norm',              '$5');
    EXECUTE 'PREPARE hx4_q(uuid, uuid, uuid, text, text) AS ' || v_q;
    SET LOCAL plan_cache_mode = force_generic_plan;
    EXECUTE format('EXPLAIN (%s) EXECUTE hx4_q(%L, %L, %L, %L, %L)', v_opc, p_company, p_prov, gen_random_uuid(), p_nuevo, v_norm) INTO v_plan;
    DEALLOCATE hx4_q;
    RESET plan_cache_mode;
  END IF;
  RETURN v_plan;
END $$;

CREATE TEMP TABLE hx4_planes AS
SELECT public.hx4_plan('custom',  :C::uuid, :PH::uuid, 'NUEVA-1')::text AS especifico,
       public.hx4_plan('generic', :C::uuid, :PH::uuid, 'NUEVA-1')::text AS generico,
       public.hx4_plan('custom',  :C::uuid, :PH::uuid, 'a-bcdef', true) AS analizado;
SELECT public.chk_bool(position('idx_facturas_prov_numero_norm' in especifico) > 0, true,
  '[RG-4·plan] la consulta del trigger (plan específico) usa idx_facturas_prov_numero_norm con 20 005 facturas del proveedor') FROM hx4_planes;
SELECT public.chk_bool(position('Seq Scan' in especifico) = 0 AND position('idx_facturas_prov_proveedor' in especifico) = 0, true,
  '[RG-4·plan] …y no recorre las facturas del proveedor (ni Seq Scan ni idx_facturas_prov_proveedor)') FROM hx4_planes;
SELECT public.chk_bool(position('idx_facturas_prov_numero_norm' in generico) > 0, true,
  '[RG-4·plan] la consulta del trigger (plan genérico) usa idx_facturas_prov_numero_norm') FROM hx4_planes;
SELECT public.chk_bool(position('Seq Scan' in generico) = 0 AND position('idx_facturas_prov_proveedor' in generico) = 0, true,
  '[RG-4·plan] …el plan genérico tampoco recorre las facturas del proveedor') FROM hx4_planes;
-- La condición del índice incluye la clave normalizada (no solo empresa y proveedor)
SELECT public.chk_bool(especifico ~ 'Index Cond[^]]*compras_normalizar_numero\(numero_factura\)' AND generico ~ 'Index Cond[^]]*compras_normalizar_numero\(numero_factura\)', true,
  '[RG-4·plan] la Index Cond del plan incluye compras_normalizar_numero(numero_factura): el índice acota por la clave, no solo por el proveedor') FROM hx4_planes;
-- El criterio de separadores va como FILTRO sobre los candidatos del índice
SELECT public.chk_bool(analizado::text ~ 'compras_numeros_equivalentes', true,
  '[RG-4·plan] compras_numeros_equivalentes aparece como filtro sobre lo que devuelve el índice') FROM hx4_planes;
-- EXPLAIN ANALYZE: filas que el índice entregó al filtro = filas que lo pasaron + filas descartadas = los 5 candidatos (no 20 005)
SELECT public.chk(
  (SELECT (n->>'Actual Rows')::bigint + COALESCE((n->>'Rows Removed by Filter')::bigint, 0)
     FROM (SELECT jsonb_path_query_first(analizado, '$[0].Plan.** ? (@."Index Name" == "idx_facturas_prov_numero_norm")') AS n FROM hx4_planes) x), 5,
  '[RG-4·plan] EXPLAIN ANALYZE: el índice entrega al filtro de separadores exactamente las 5 candidatas de la clave ABCDEF, no las 20 005 facturas del proveedor');

-- [RG-4·plan·cond] La Index Cond del nodo de idx_facturas_prov_numero_norm lleva las TRES condiciones —empresa, proveedor y clave
-- normalizada—, en el proveedor enorme y en uno de los 60 pequeños, con plan específico, genérico y EXPLAIN ANALYZE. Es una
-- afirmación sobre el TEXTO de la condición, no sobre qué índice eligió el planificador (que depende de cuántos datos haya).
CREATE FUNCTION public.hx4_index_cond(p_plan jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT jsonb_path_query_first(p_plan, '$[0].Plan.** ? (@."Index Name" == "idx_facturas_prov_numero_norm")') ->> 'Index Cond' $$;
CREATE TEMP TABLE hx4_conds AS
SELECT v.prov, v.modo, public.hx4_index_cond(v.plan) AS cond
  FROM (VALUES ('grande',   'específico', public.hx4_plan('custom',  :C::uuid, :PH::uuid, 'a-bcdef')),
               ('grande',   'genérico',   public.hx4_plan('generic', :C::uuid, :PH::uuid, 'a-bcdef')),
               ('grande',   'analizado',  public.hx4_plan('custom',  :C::uuid, :PH::uuid, 'a-bcdef', true)),
               ('pequeño',  'específico', public.hx4_plan('custom',  :C::uuid, :PQ::uuid, 'q-rstuv')),
               ('pequeño',  'genérico',   public.hx4_plan('generic', :C::uuid, :PQ::uuid, 'q-rstuv')),
               ('pequeño',  'analizado',  public.hx4_plan('custom',  :C::uuid, :PQ::uuid, 'q-rstuv', true))) v(prov, modo, plan);
SELECT public.chk((SELECT count(*) FROM hx4_conds WHERE cond IS NOT NULL), 6,
  '[RG-4·plan·cond] los 6 planes (proveedor grande y pequeño × específico, genérico y ANALYZE) usan idx_facturas_prov_numero_norm y traen su Index Cond');
SELECT public.chk((SELECT count(*) FROM hx4_conds WHERE cond ~ '\(company_id = '), 6,
  '[RG-4·plan·cond] la Index Cond incluye company_id = … en los 6 planes (el índice se acota por EMPRESA, no solo por proveedor y clave)');
SELECT public.chk((SELECT count(*) FROM hx4_conds WHERE cond ~ '\(proveedor_id = '), 6,
  '[RG-4·plan·cond] …incluye proveedor_id = … en los 6');
SELECT public.chk((SELECT count(*) FROM hx4_conds WHERE cond ~ '\(compras_normalizar_numero\(numero_factura\) = '), 6,
  '[RG-4·plan·cond] …e incluye compras_normalizar_numero(numero_factura) = … en los 6 (la clave normalizada, la misma del índice)');
-- Del proveedor pequeño: el índice entrega al filtro exactamente las 5 candidatas de QRSTUV
SELECT public.chk(
  (SELECT (n->>'Actual Rows')::bigint + COALESCE((n->>'Rows Removed by Filter')::bigint, 0)
     FROM (SELECT jsonb_path_query_first(public.hx4_plan('custom', :C::uuid, :PQ::uuid, 'q-rstuv', true), '$[0].Plan.** ? (@."Index Name" == "idx_facturas_prov_numero_norm")') AS n) x), 5,
  '[RG-4·plan·cond] EXPLAIN ANALYZE del proveedor pequeño: el índice entrega al filtro de separadores exactamente las 5 candidatas de la clave QRSTUV');

-- 100 altas por los triggers reales, con 20 005 facturas del proveedor, en menos de 1 s (con el defecto de DEP-2: ≈ 6 s)
SELECT pg_stat_get_xact_function_calls('public.compras_numeros_equivalentes(text, text)'::regprocedure) AS eq0,
       pg_stat_get_xact_numscans('public.idx_facturas_prov_numero_norm'::regclass) AS ix0 \gset
DO $$
DECLARE
  t0 timestamptz := clock_timestamp();
  v_ms numeric;
BEGIN
  FOR i IN 1..100 LOOP
    INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES (('fb4e' || lpad(to_hex(i), 4, '0') || '-0000-0000-0000-0000000000b1')::uuid,
            'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
            'fb400000-0000-0000-0000-0000000000b1', 'NUEVA-' || i, 'alta nueva', 10);
  END LOOP;
  v_ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000);
  PERFORM set_config('hx4.ms', v_ms::text, true);
  RAISE NOTICE '  · 100 altas con 20 005 facturas del proveedor: % ms (% ms por alta)', v_ms, round(v_ms / 100, 2);
END $$;
SELECT public.chk_bool(current_setting('hx4.ms')::numeric < 1000, true,
  '[RG-4·plan] 100 altas de factura con 20 005 del mismo proveedor tardan menos de 1 s (el criterio de separadores no devuelve el costo lineal de DEP-2)');
SELECT public.chk_bool(pg_stat_get_xact_numscans('public.idx_facturas_prov_numero_norm'::regclass) - :ix0 >= 100, true,
  '[RG-4·plan] esas altas LEYERON idx_facturas_prov_numero_norm (al menos una lectura del índice por alta)');
SELECT public.chk(pg_stat_get_xact_function_calls('public.compras_numeros_equivalentes(text, text)'::regprocedure) - :eq0, 0,
  '[RG-4·plan] y el criterio de separadores NO se evaluó ni una vez en esas 100 altas (ninguna tenía candidatas: el índice las descartó todas; el costo no crece con las 20 005)');
-- El control sigue funcionando a esta escala (administrador, como PostgREST)
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.chk_falla($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fb400000-0000-0000-0000-0000000000b1','h 0000004','misma',10) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4·plan] «h 0000004» equivale a «H-0000004»/«H.0000004» (histórica): se rechaza con 20 005 facturas');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fb400000-0000-0000-0000-0000000000b1','AB-CDEF','x',1) $$), 'IDENTICO',
  '[RG-4·plan] «AB-CDEF» ya existe (candidata idéntica): el índice único exacto');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fb400000-0000-0000-0000-0000000000b1','ab.cdef','x',1) $$), 'BLOQUEA',
  '[RG-4·plan] «ab.cdef» es «AB-CDEF» con otro separador: se rechaza');
SELECT public.chk_txt(public.hx4_intenta($$ INSERT INTO public.facturas_proveedor (company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
    VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','c1c1c1c1-0000-0000-0000-000000000001','fb400000-0000-0000-0000-0000000000b1','A-B-C-D-E-F','x',1) $$), 'BLOQUEA',
  '[RG-4·plan] «A-B-C-D-E-F» incluye todos los perfiles de las candidatas: se rechaza');
RESET ROLE;

ROLLBACK;

-- El montaje se revirtió entero.
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fb4%'), 0,
  '[RG-4·limpieza] la prueba no deja residuo (facturas)');
SELECT public.chk((SELECT count(*) FROM public.proveedores WHERE id::text LIKE 'fb4%') + (SELECT count(*) FROM public.app_users WHERE id::text LIKE 'fb4%')
                  + (SELECT count(*) FROM pg_class WHERE relname LIKE 'hx4\_%'), 0,
  '[RG-4·limpieza] ni proveedores, usuarios, tablas ni funciones de ayuda');
