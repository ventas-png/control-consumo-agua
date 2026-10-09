-- ════════════════════════════════════════════════════════════════════════════
-- RG-4 · Números de factura DISTINTOS y válidos que normalizan igual («1-23» y
--        «12-3»; «A-12» y «A1-2») se rechazaban como duplicado, sin salida.
--
-- CAUSA RAÍZ. compras_normalizar_numero borra todo lo que no es A-Z0-9, así que «serie-
--   correlativo» distintos que concatenan igual chocan. El trigger compras_tg_factura_
--   numero_equivalente (20261027000400) rechaza el segundo con COMPRAS_FACTURA_NUMERO_
--   DUPLICADO y no hay forma de decir «es otra factura».
--
-- COMPORTAMIENTO ESPERADO (alternativa A, PENDIENTE DE DECISIÓN DEL DUEÑO: «equivalencia que
--   respeta el separador entre serie y correlativo»; ver el informe y la pieza RG-4 de la migración 20261027000800):
--   · «1-23»/«12-3», «A-12»/«A1-2», «001-1234»/«0011-234»: dos facturas distintas, se registran.
--   · Siguen rechazándose los verdaderos duplicados: «FAC-001» / «fac-001» / « FAC 001 » /
--     «FAC001» / «FAC.001» / «FAC/001» / «FAC_001», y también uno con separador frente a uno sin él
--     («A-12»/«A12»; «1-23»/«123»: ambiguo, se queda del lado seguro, como en 0400).
--   · Todo lo demás de 0400 igual: el número idéntico lo rechaza el índice único; otro proveedor,
--     una factura anulada y las sin número no cuentan; el cambio de número (UPDATE) se controla
--     igual; la RPC compras_factura_crear da el mismo error; un usuario con solo «crear» puede;
--     el camino del sistema (sin sesión) obedece la misma regla; aprobar ambas sigue funcionando.
--   Si el dueño elige otra alternativa (B: excepción con motivo auditado; C: avisar sin bloquear),
--   [RG-4a]–[RG-4c] cambian con esa decisión (ver RG-4_altB.sql para la B).
--
-- Se ejecuta con:  psql -X -v ON_ERROR_STOP=1 -d <BD> -f RG-4.sql  (superusuario, copia de hall_tpl).
-- Va entera dentro de BEGIN … ROLLBACK: no deja residuo. IDs: fa9f4NNN-0000-0000-0000-0000000000f1.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set UA  '''c0c0c0c0-0000-0000-0000-00000000000a'''
\set UC  '''c0c0c0c0-0000-0000-0000-00000000000c'''
\set UQ  '''c0c0c0c0-0000-0000-0000-00000000001a'''
\set PA  '''fa9f4000-0000-0000-0000-0000000000a1'''
\set PB  '''fa9f4000-0000-0000-0000-0000000000a2'''

BEGIN;

-- Ayudas (se pierden con el ROLLBACK). Se ejecutan con la sesión que las llama.
CREATE FUNCTION public.hx9_id(p_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('fa9f4' || lpad(to_hex(p_n), 3, '0') || '-0000-0000-0000-0000000000f1')::uuid $$;

CREATE FUNCTION public.hx9_alta(p_n int, p_prov uuid, p_num text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total)
  VALUES (public.hx9_id(p_n), 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001', p_prov, p_num, 'RG-4 ' || p_num, 100);
END $$;

-- Exige que `p_sql` se EJECUTE; si lo rechaza, dice cuál fue el rechazo (el falso positivo del hallazgo
-- es COMPRAS_FACTURA_NUMERO_DUPLICADO).
CREATE FUNCTION public.hx9_acepta(p_sql text, p_msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE '✓ %', p_msg;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '[RG-4%' THEN RAISE; END IF;
  RAISE EXCEPTION '% — se rechazó: %', p_msg, left(SQLERRM, 160);
END $$;

-- ── Montaje: dos proveedores propios de C, autorizados por el administrador ─────────────────
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance) VALUES
  (:PA, :C::uuid, 'Proveedor A RG-4', '9940001-1', 'GT', 'empresa'),
  (:PB, :C::uuid, 'Proveedor B RG-4', '9940002-2', 'GT', 'empresa');
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
UPDATE public.proveedores SET estado = 'autorizado' WHERE id IN (:PA::uuid, :PB::uuid);

-- ── a-c) Los dos números son DISTINTOS: se registran las dos facturas (administrador) ───────
SELECT public.hx9_alta(1, :PA::uuid, '1-23');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(2, 'fa9f4000-0000-0000-0000-0000000000a1', '12-3') $$,
  '[RG-4a] «12-3» se registra aunque exista «1-23» del mismo proveedor (serie 12, correlativo 3)');
SELECT public.hx9_alta(3, :PA::uuid, 'A-12');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(4, 'fa9f4000-0000-0000-0000-0000000000a1', 'A1-2') $$,
  '[RG-4b] «A1-2» se registra aunque exista «A-12» del mismo proveedor');
SELECT public.hx9_alta(5, :PA::uuid, '001-1234');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(6, 'fa9f4000-0000-0000-0000-0000000000a1', '0011-234') $$,
  '[RG-4c] «0011-234» se registra aunque exista «001-1234» del mismo proveedor');
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id IN (public.hx9_id(1), public.hx9_id(2), public.hx9_id(3), public.hx9_id(4), public.hx9_id(5), public.hx9_id(6))), 6,
  '[RG-4c] las seis facturas distintas quedaron registradas');

-- ── d) Los VERDADEROS duplicados se siguen rechazando ───────────────────────────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx9_alta(10, :PA::uuid, 'FAC-001');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'fac-001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «fac-001» es «FAC-001» (mayúsculas)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', ' FAC 001 ') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] « FAC 001 » es «FAC-001» (espacios en vez de guion)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'FAC001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC001» es «FAC-001» (sin separador)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'FAC.001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC.001» es «FAC-001» (punto)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'FAC/001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC/001» es «FAC-001» (barra)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'FAC_001') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4d] «FAC_001» es «FAC-001» (guion bajo)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'FAC-001') $$,
  'uq_facturas_prov_numero', '[RG-4d] el número idéntico lo sigue rechazando el índice único de siempre');
-- Con separador frente a sin separador: ambiguo, del lado seguro (igual que 0400).
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'A12') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «A12» (sin separador) frente a «A-12» y «A1-2» se sigue rechazando');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', '123') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «123» (sin separador) frente a «1-23» y «12-3» se sigue rechazando');
-- Un tercer número con la misma clave y el MISMO separador que uno existente: duplicado.
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', '12/3') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «12/3» es «12-3» (otro tipo de separador, misma posición)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(11, 'fa9f4000-0000-0000-0000-0000000000a1', 'a 1 2') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4e] «a 1 2» comparte clave con «A-12» y «A1-2» y es compatible con ambas: duplicado');

-- ── f) El cambio de número (UPDATE) se controla con la misma regla ──────────────────────────
SELECT public.hx9_alta(20, :PA::uuid, '77-5');
SELECT public.hx9_alta(21, :PA::uuid, 'T-1');
SELECT public.hx9_alta(22, :PA::uuid, 'U-1');
SELECT public.hx9_acepta($$ UPDATE public.facturas_proveedor SET numero_factura = '7-75' WHERE id = public.hx9_id(21) $$,
  '[RG-4f] cambiar el número a «7-75» (otra serie) frente a «77-5» se permite');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = '77.5' WHERE id = public.hx9_id(22) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4f] cambiar el número a «77.5» (mismo separador que «77-5») se rechaza');
SELECT public.chk_falla($$ UPDATE public.facturas_proveedor SET numero_factura = '775' WHERE id = public.hx9_id(22) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4f] cambiar el número a «775» (sin separador) se rechaza');

-- ── g) Otro proveedor: el mismo número no choca (como hoy); un usuario con solo «crear» puede ──
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(30, 'fa9f4000-0000-0000-0000-0000000000a2', '1-23') $$,
  '[RG-4g] el otro proveedor registra «1-23» sin problema');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(31, 'fa9f4000-0000-0000-0000-0000000000a2', '12-3') $$,
  '[RG-4g] …y también «12-3»');
RESET ROLE;
SELECT public.como(:UC::uuid);
SET ROLE authenticated;
SELECT public.hx9_alta(32, :PB::uuid, 'K-45');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(33, 'fa9f4000-0000-0000-0000-0000000000a2', 'K4-5') $$,
  '[RG-4g] un usuario con solo «crear» (sin aprobar ni cambiar estado) registra «K4-5» junto a «K-45»: no hace falta ningún permiso extra');
SELECT public.chk_falla($$ SELECT public.hx9_alta(34, 'fa9f4000-0000-0000-0000-0000000000a2', 'k 45') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4g] …y «k 45» sigue siendo duplicado de «K-45» para ese mismo usuario');
RESET ROLE;

-- ── h) La RPC transaccional da el mismo resultado y el mismo error de siempre ────────────────
SELECT public.como(:UA::uuid);
SET ROLE authenticated;
SELECT public.hx9_acepta($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fa9f4000-0000-0000-0000-0000000000a2","numero_factura":"9-80","concepto":"RPC primera","monto_total":100,"clave_idempotencia":"rg4-clave-0001"}'::jsonb, '[]'::jsonb) $$,
  '[RG-4h] compras_factura_crear registra «9-80»');
SELECT public.hx9_acepta($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fa9f4000-0000-0000-0000-0000000000a2","numero_factura":"98-0","concepto":"RPC otra","monto_total":100,"clave_idempotencia":"rg4-clave-0002"}'::jsonb, '[]'::jsonb) $$,
  '[RG-4h] compras_factura_crear registra «98-0» junto a «9-80» (otra factura)');
SELECT public.chk_falla($$ SELECT public.compras_factura_crear('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c1c1c1c1-0000-0000-0000-000000000001',
    '{"proveedor_id":"fa9f4000-0000-0000-0000-0000000000a2","numero_factura":"9/80","concepto":"RPC duplicada","monto_total":100,"clave_idempotencia":"rg4-clave-0003"}'::jsonb, '[]'::jsonb) $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4h] compras_factura_crear rechaza «9/80» (misma estructura que «9-80») con el error de siempre');

-- ── i) Anulada la primera, su número equivalente se puede reutilizar (como hoy) ──────────────
UPDATE public.facturas_proveedor SET estado = 'anulada' WHERE id = public.hx9_id(10);
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(40, 'fa9f4000-0000-0000-0000-0000000000a1', 'fac 001') $$,
  '[RG-4i] con «FAC-001» anulada, «fac 001» se puede volver a registrar');
RESET ROLE;

-- ── j) Camino del sistema (sin sesión de usuario): misma regla ───────────────────────────────
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT public.chk_bool(public.compras_sesion_usuario(), false, '[RG-4j·montaje] la sesión es de sistema (sin usuario)');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(50, 'fa9f4000-0000-0000-0000-0000000000a2', 'S1-23') $$,
  '[RG-4j] sin sesión: «S1-23» se registra');
SELECT public.hx9_acepta($$ SELECT public.hx9_alta(51, 'fa9f4000-0000-0000-0000-0000000000a2', 'S-123') $$,
  '[RG-4j] sin sesión: «S-123» se registra junto a «S1-23» (otra factura)');
SELECT public.chk_falla($$ SELECT public.hx9_alta(52, 'fa9f4000-0000-0000-0000-0000000000a2', 's1.23') $$,
  'COMPRAS_FACTURA_NUMERO_DUPLICADO', '[RG-4j] sin sesión: «s1.23» sigue siendo duplicado de «S1-23»');

-- ── k) Aprobar (contabilizar) las dos facturas «distintas» sigue funcionando ─────────────────
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id IN (public.hx9_id(1), public.hx9_id(2));
RESET ROLE;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id IN (public.hx9_id(1), public.hx9_id(2)) AND estado = 'aprobada'), 2,
  '[RG-4k] «1-23» y «12-3» se aprueban (contabilizan) las dos: el control de número no estorba después');

-- ── l) Un duplicado HISTÓRICO equivalente no bloquea sus cambios de estado ni sus ediciones ───
SET session_replication_role = replica;
SELECT public.hx9_alta(60, :PB::uuid, 'HIS-7');
SELECT public.hx9_alta(61, :PB::uuid, 'HIS7');
SET session_replication_role = origin;
SELECT public.como(:UQ::uuid);
SET ROLE authenticated;
SELECT public.hx9_acepta($$ UPDATE public.facturas_proveedor SET estado = 'aprobada' WHERE id = public.hx9_id(61) $$,
  '[RG-4l] aprobar un duplicado histórico equivalente no se bloquea (solo nace o cambia el número)');
RESET ROLE;

ROLLBACK;
SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fa9f4%'), 0,
  '[RG-4·limpieza] la prueba no deja residuo');
