-- ════════════════════════════════════════════════════════════════════════════
-- RG-4 · el diagnóstico de conflictos (diagnostico_conflictos.sql) es de SOLO LECTURA, no depende de las funciones
--        nuevas y clasifica cada par EXACTAMENTE como lo hará la regla (compras_numeros_equivalentes).
--
-- POR QUÉ. El diagnóstico se corre en producción ANTES de aplicar la migración: ahí no existen compras_normalizar_numero
--   ni compras_numeros_equivalentes, así que lleva en línea su propia copia de la normalización y del perfil de
--   separadores. Esta prueba demuestra que la copia no se desvía de las funciones: mismos grupos, mismos pares, misma
--   clasificación, sobre una población con cientos de pares equivalentes y cientos de pares distintos.
--   Y que es de solo lectura: (1) el archivo no trae palabras de escritura, (2) se ejecuta dentro de una función STABLE
--   —el motor rechaza ahí cualquier INSERT/UPDATE/DELETE, también dentro de un WITH— y (3) las tablas que lee quedan
--   byte a byte iguales. Un control positivo demuestra que (2) sí rechaza una escritura.
--
-- Se ejecuta con:
--     psql -X -v ON_ERROR_STOP=1 -d <BD> -f RG-4.diagnostico.sql          (desde cualquier carpeta del repositorio: lee
--                                              scripts/diagnostico-numeros-factura.sql; otra ruta: DIAG=/ruta/al.sql psql …)
--   (superusuario; requiere pieza.sql aplicada, para tener las funciones contra las que se compara). Toda su escritura
--   va dentro de BEGIN … ROLLBACK: no deja residuo. IDs: fb6NNNNN-0000-0000-0000-0000000000XX.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
\set C   '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set C1  '''c1c1c1c1-0000-0000-0000-000000000001'''
\set C2  '''c2c2c2c2-0000-0000-0000-000000000001'''
\set existe `[ -s "${DIAG:-$(git rev-parse --show-toplevel 2>/dev/null)/scripts/diagnostico-numeros-factura.sql}" ] && echo 1 || echo 0`
\set diag `cat "${DIAG:-$(git rev-parse --show-toplevel 2>/dev/null)/scripts/diagnostico-numeros-factura.sql}"`
\set empieza `grep -v '^[[:space:]]*--' "${DIAG:-$(git rev-parse --show-toplevel 2>/dev/null)/scripts/diagnostico-numeros-factura.sql}" | grep -v '^[[:space:]]*$' | head -1 | cut -c1-4 | tr a-z A-Z`
\set n_escritura `grep -v '^[[:space:]]*--' "${DIAG:-$(git rev-parse --show-toplevel 2>/dev/null)/scripts/diagnostico-numeros-factura.sql}" | grep -ciE '\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|call|do|merge|vacuum|analyze|set|reset|lock|listen|notify|refresh|comment|security|execute|perform)\b' || true`
\set n_funciones `grep -v '^[[:space:]]*--' "${DIAG:-$(git rev-parse --show-toplevel 2>/dev/null)/scripts/diagnostico-numeros-factura.sql}" | grep -ciE 'compras_[a-z_]+' || true`
\set n_sentencias `grep -v '^[[:space:]]*--' "${DIAG:-$(git rev-parse --show-toplevel 2>/dev/null)/scripts/diagnostico-numeros-factura.sql}" | grep -c ';[[:space:]]*$' || true`

BEGIN;

-- ── Lo que el archivo ES: un solo SELECT, sin palabras de escritura y sin las funciones nuevas ─────────────
SELECT public.chk(:existe, 1, '[RG-4·diag] el archivo del diagnóstico existe y no está vacío (scripts/diagnostico-numeros-factura.sql, o la ruta de DIAG)');
SELECT public.chk(:n_escritura, 0,
  '[RG-4·diag] el archivo no contiene ninguna palabra de escritura o de DDL (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, GRANT, SET, DO…) fuera de los comentarios');
SELECT public.chk(:n_funciones, 0,
  '[RG-4·diag] no nombra ninguna función compras_*: funciona donde todavía no existen (producción)');
SELECT public.chk(:n_sentencias, 1, '[RG-4·diag] es UNA sola sentencia (un punto y coma final)');
SELECT public.chk_txt(:'empieza', 'WITH', '[RG-4·diag] la primera palabra fuera de los comentarios es WITH: una consulta, no un guion');

-- ── Montaje: población con la misma clave en muchos números; vivos, anulados, sin número y sin clave ────────
INSERT INTO public.proveedores (id, company_id, nombre, nit, pais, alcance)
SELECT ('fb600000-0000-0000-0000-0000000000' || lpad(to_hex(k), 2, '0'))::uuid, :C::uuid, 'Proveedor diag RG-4 ' || k, '998' || k || '-1', 'GT', 'empresa'
  FROM generate_series(1, 6) k;
SELECT setseed(0.2626);
SET LOCAL session_replication_role = replica;
INSERT INTO public.facturas_proveedor (id, company_id, project_id, proveedor_id, numero_factura, concepto, monto_total, estado, fecha_emision)
SELECT ('fb6' || lpad(to_hex(g), 5, '0') || '-0000-0000-0000-0000000000f1')::uuid, :C::uuid,
       (ARRAY[:C1::uuid, :C2::uuid, NULL])[1 + g % 3],
       ('fb600000-0000-0000-0000-0000000000' || lpad(to_hex(1 + g % 6), 2, '0'))::uuid,
       CASE WHEN g % 40 = 0 THEN NULL
            WHEN g % 41 = 0 THEN (ARRAY['---', '...', ' '])[1 + g % 3]
            ELSE (SELECT CASE WHEN q.r < 0.35 THEN lower(q.x) WHEN q.r < 0.6 THEN upper(q.x) ELSE q.x END           -- mayúsculas y minúsculas: la clave las unifica
                    FROM (SELECT (SELECT string_agg(CASE WHEN random() < 0.35 THEN (ARRAY['-', '.', ' ', '/', '_', '--'])[1 + floor(random() * 6)::int] ELSE '' END || t.ch, '' ORDER BY t.i)
                                    FROM unnest(ARRAY['A', 'b', '1', 'C', '2']) WITH ORDINALITY AS t(ch, i) WHERE g > 0) AS x,
                                 random() AS r) q)
                 || CASE WHEN random() < 0.2 THEN '.' ELSE '' END END,
       'población diag', 10 + g % 90,
       CASE WHEN g % 9 = 0 THEN 'anulada' WHEN g % 5 = 0 THEN 'aprobada' ELSE 'registrada' END,
       DATE '2026-01-01' + g % 200
  FROM generate_series(1, 330) g
ON CONFLICT DO NOTHING;                                 -- el índice único exacto sigue vigente en carga masiva: los números idénticos de un proveedor no entran
SET LOCAL session_replication_role = origin;
SELECT public.chk_bool((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fb6%') BETWEEN 250 AND 330, true, '[RG-4·diag·montaje] unas 300 facturas de prueba (sin números idénticos del mismo proveedor)');

-- huella de lo que el diagnóstico lee: no debe cambiar
CREATE TEMP TABLE hx6_huella0 AS
SELECT (SELECT md5(string_agg(f::text, '|' ORDER BY f.id)) FROM public.facturas_proveedor f) AS facturas,
       (SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM public.proveedores p)       AS proveedores,
       (SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) FROM public.companies c)         AS empresas,
       (SELECT md5(string_agg(j::text, '|' ORDER BY j.id)) FROM public.projects j)          AS proyectos;

-- ── El diagnóstico dentro de una función STABLE: el motor no deja escribir ahí ─────────────────────────────
SELECT format($f$CREATE FUNCTION public.hx6_diag_fn() RETURNS TABLE (apartado text, concepto text, n bigint, empresa text, proveedor text, clave text,
                                                                factura_a text, factura_b text, id_a text, id_b text, nota text)
                 LANGUAGE plpgsql STABLE AS %L$f$, E'#variable_conflict use_column\nBEGIN\nRETURN QUERY\n' || rtrim(:'diag', E'; \n\t\r') || E';\nEND') \gexec
CREATE TEMP TABLE hx6_diag AS SELECT * FROM public.hx6_diag_fn();
SELECT public.chk_bool((SELECT count(*) FROM hx6_diag) > 20, true, '[RG-4·diag] el diagnóstico se ejecuta dentro de una función STABLE (solo lectura) y devuelve filas');
-- control positivo: la misma envoltura SÍ rechaza una escritura escondida en un WITH
SELECT public.chk_falla($f$ CREATE FUNCTION public.hx6_escribe() RETURNS SETOF bigint LANGUAGE plpgsql STABLE AS
    'BEGIN RETURN QUERY WITH x AS (UPDATE public.facturas_proveedor SET concepto = concepto WHERE false RETURNING 1) SELECT count(*) FROM x; END';
    SELECT * FROM public.hx6_escribe() $f$,
  'is not allowed in a non-volatile function', '[RG-4·diag] control positivo: la envoltura STABLE rechaza un UPDATE escondido en un WITH (así que el diagnóstico no puede escribir)');
SELECT public.chk_bool(
  (SELECT h.facturas = (SELECT md5(string_agg(f::text, '|' ORDER BY f.id)) FROM public.facturas_proveedor f)
      AND h.proveedores = (SELECT md5(string_agg(p::text, '|' ORDER BY p.id)) FROM public.proveedores p)
      AND h.empresas = (SELECT md5(string_agg(c::text, '|' ORDER BY c.id)) FROM public.companies c)
      AND h.proyectos = (SELECT md5(string_agg(j::text, '|' ORDER BY j.id)) FROM public.projects j)
     FROM hx6_huella0 h), true,
  '[RG-4·diag] tras ejecutarlo, facturas, proveedores, empresas y proyectos están byte a byte iguales');

-- ── La clasificación coincide con la regla (las funciones), par por par ──────────────────────────────────────
CREATE TEMP TABLE hx6_ref AS
SELECT a.company_id, a.proveedor_id, public.compras_normalizar_numero(a.numero_factura) AS clave, a.id AS id_a, b.id AS id_b,
       public.compras_numeros_equivalentes(a.numero_factura, b.numero_factura) AS equiv,
       public.compras_numero_separadores(a.numero_factura) <> public.compras_numero_separadores(b.numero_factura) AS perfiles_distintos
  FROM public.facturas_proveedor a
  JOIN public.facturas_proveedor b ON b.company_id = a.company_id AND b.proveedor_id = a.proveedor_id AND b.id <> a.id
                                  AND public.compras_normalizar_numero(b.numero_factura) = public.compras_normalizar_numero(a.numero_factura)
 WHERE a.estado <> 'anulada' AND b.estado <> 'anulada' AND a.numero_factura IS NOT NULL AND b.numero_factura IS NOT NULL
   AND a.id < b.id;
SELECT public.chk_bool((SELECT count(*) FILTER (WHERE equiv) > 150 AND count(*) FILTER (WHERE NOT equiv) > 150 FROM hx6_ref), true,
  '[RG-4·diag·montaje] la población tiene cientos de pares equivalentes y cientos de pares distintos');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'facturas_proveedor (todas%'), (SELECT count(*) FROM public.facturas_proveedor),
  '[RG-4·diag] resumen: total de facturas');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'facturas vivas (no anuladas) con número%'),
                  (SELECT count(*) FROM public.facturas_proveedor WHERE estado <> 'anulada' AND numero_factura IS NOT NULL),
  '[RG-4·diag] resumen: facturas vivas con número');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'facturas vivas con clave alfanumérica%'),
                  (SELECT count(*) FROM public.facturas_proveedor WHERE estado <> 'anulada' AND public.compras_normalizar_numero(numero_factura) IS NOT NULL),
  '[RG-4·diag] resumen: facturas vivas con clave (la clave del diagnóstico es compras_normalizar_numero)');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'grupos (empresa%'),
                  (SELECT count(*) FROM (SELECT DISTINCT company_id, proveedor_id, clave FROM hx6_ref) g),
  '[RG-4·diag] resumen: grupos (empresa, proveedor, clave) con más de una factura viva');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'facturas implicadas%'),
                  (SELECT count(*) FROM (SELECT id_a FROM hx6_ref UNION SELECT id_b FROM hx6_ref) z),
  '[RG-4·diag] resumen: facturas implicadas en algún grupo');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'pares equivalente (duplicado probable)%'),
                  (SELECT count(*) FROM hx6_ref WHERE equiv),
  '[RG-4·diag] resumen: pares equivalentes = los que compras_numeros_equivalentes da por equivalentes');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'pares distinto legítimo%'),
                  (SELECT count(*) FROM hx6_ref WHERE NOT equiv),
  '[RG-4·diag] resumen: pares distintos legítimos = los que compras_numeros_equivalentes da por distintos');
SELECT public.chk((SELECT n FROM hx6_diag WHERE apartado = 'resumen' AND concepto LIKE 'pares equivalentes «ambiguos»%'),
                  (SELECT count(*) FROM hx6_ref WHERE equiv AND perfiles_distintos),
  '[RG-4·diag] resumen: pares equivalentes «ambiguos» (perfiles distintos pero uno incluido en el otro)');
SELECT public.chk((SELECT count(*) FROM hx6_diag d JOIN hx6_ref r ON r.id_a = least(d.id_a::uuid, d.id_b::uuid) AND r.id_b = greatest(d.id_a::uuid, d.id_b::uuid)
                    WHERE d.apartado = 'ejemplo' AND (d.concepto = 'equivalente (duplicado probable)') IS DISTINCT FROM r.equiv), 0,
  '[RG-4·diag] cada ejemplo está clasificado como lo clasifica la regla (compras_numeros_equivalentes), sin una discrepancia');
SELECT public.chk((SELECT count(*) FROM hx6_diag d WHERE d.apartado = 'ejemplo' AND NOT EXISTS (SELECT 1 FROM hx6_ref r WHERE r.id_a = least(d.id_a::uuid, d.id_b::uuid) AND r.id_b = greatest(d.id_a::uuid, d.id_b::uuid))), 0,
  '[RG-4·diag] y todo ejemplo es un par real de la población (misma empresa, proveedor y clave)');
SELECT public.chk((SELECT count(*) FROM hx6_diag WHERE apartado = 'ejemplo' AND concepto = 'equivalente (duplicado probable)'), 20,
  '[RG-4·diag] hasta 20 ejemplos de pares equivalentes (hay cientos)');
SELECT public.chk((SELECT count(*) FROM hx6_diag WHERE apartado = 'ejemplo' AND concepto LIKE 'distinto legítimo%'), 20,
  '[RG-4·diag] hasta 20 ejemplos de pares distintos legítimos (hay cientos)');
SELECT public.chk_bool((SELECT bool_and(d.factura_a ~ '^«.*» · \d{4}-\d\d-\d\d · .* · (?!anulada)[a-z_]+ · proyecto ' AND d.factura_b ~ '^«.*» · \d{4}-\d\d-\d\d · .* · (?!anulada)[a-z_]+ · proyecto ')
                           FROM hx6_diag d WHERE d.apartado = 'ejemplo'), true,
  '[RG-4·diag] cada ejemplo muestra número, fecha, monto, estado y proyecto de las dos facturas, y ninguna es anulada');
-- Una anulada no cuenta, como en el trigger: anularla saca el par del diagnóstico
SELECT public.chk((SELECT count(*) FROM hx6_ref r JOIN public.facturas_proveedor f ON f.id IN (r.id_a, r.id_b) WHERE f.estado = 'anulada'), 0,
  '[RG-4·diag] ningún par de la referencia contiene una factura anulada');

ROLLBACK;

SELECT public.chk((SELECT count(*) FROM public.facturas_proveedor WHERE id::text LIKE 'fb6%') + (SELECT count(*) FROM public.proveedores WHERE id::text LIKE 'fb6%'), 0,
  '[RG-4·limpieza] la prueba no deja residuo (facturas ni proveedores)');
SELECT public.chk((SELECT count(*) FROM pg_proc WHERE proname IN ('hx6_diag_fn', 'hx6_escribe')), 0, '[RG-4·limpieza] ni funciones de ayuda');
