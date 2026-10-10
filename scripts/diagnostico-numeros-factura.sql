-- ════════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO PREVIO A LA REGLA DE NÚMEROS DE FACTURA (RG-4, alternativa A)
-- SOLO LECTURA: un único SELECT (WITH … SELECT), sin escribir nada. Funciona igual en producción,
-- en el sandbox y en una base local; se puede pegar en el SQL Editor del proyecto ANTES de aplicar.
--
-- POR QUÉ NO USA LAS FUNCIONES NUEVAS. En producción todavía no existen compras_normalizar_numero
-- (0400) ni compras_numeros_equivalentes (0900): este diagnóstico lleva EN LÍNEA la misma
-- normalización —upper() y borrar todo lo que no sea A-Z0-9— y el mismo perfil de separadores que
-- esas funciones (la prueba pruebas/RG-4.diagnostico.sql lo contrasta con ellas, par por par).
-- El perfil ignora, igual que la función, los 27 caracteres INVISIBLES de la lista de más abajo (CTE `invisibles`: espacio de ancho
-- cero, guion blando, BOM…): dos números que solo difieren en uno de ellos salen como «equivalente», porque la regla los rechazaría.
-- La prueba exige que esta lista y la de compras_numero_separadores sean la misma.
--
-- QUÉ RESPONDE
-- La regla nueva solo se evalúa cuando una factura NACE o cambia de número o de proveedor: no
-- revalida, no repara ni borra nada de lo que ya existe. Este diagnóstico lista, por (empresa,
-- proveedor, clave normalizada), las facturas NO anuladas que comparten clave y clasifica cada PAR:
--   · «equivalente (duplicado probable)»        la clave es la misma y los separadores son
--       compatibles (uno incluido en el otro): «FAC-001» / «fac 001» / «FAC001». La regla nueva
--       habría rechazado la segunda, igual que la de 0400. Quien administra decide si es la misma
--       factura (anular una) o no.
--   · «distinto legítimo (serie/correlativo diferente)»  misma clave pero los separadores caen en
--       posiciones distintas y ninguno incluye al otro: «1-23» / «12-3». La regla de 0400/0800
--       los habría rechazado como duplicado; la nueva los acepta: estos son los pares que
--       CAMBIAN DE TRATO.
-- El detalle de cada par equivalente dice si solo difiere el tipo de separador/mayúsculas
-- («mismos separadores») o si uno trae menos separadores o ninguno («ambiguo»: se sigue tratando
-- como duplicado, del lado seguro).
--
-- CÓMO LEERLO — una fila por línea; `apartado`:
--   · `resumen`  conteos (columna `n`).
--   · `ejemplo`  hasta 20 pares por clasificación (número, fecha, monto, estado y proyecto de cada factura).
-- Cero pares = nada que decidir. Las facturas anuladas, las sin número y las que no tienen ni
-- una letra ni un dígito (clave vacía) no se comparan, igual que el trigger.
-- ════════════════════════════════════════════════════════════════════════════
WITH
-- LA LISTA de caracteres invisibles (UTF-8 en hexadecimal, cada uno seguido de 7c = «|»), la misma de compras_numero_separadores: una sola cadena partida
-- en líneas (literales continuados), que convert_from convierte igual en bases SQL_ASCII y UTF8; sirve de alternación en un regexp_replace.
invisibles AS (
  SELECT convert_from(decode(
    'c2ad7c'   -- U+00AD  guion blando
    'd89c7c'   -- U+061C  marca de letra árabe
    'e1859f7c' -- U+115F  relleno de Hangul (choseong)
    'e185a07c' -- U+1160  relleno de Hangul (jungseong)
    'e1a08e7c' -- U+180E  separador vocálico mongol
    'e2808b7c' -- U+200B  espacio de ancho cero
    'e2808c7c' -- U+200C  no unión de ancho cero
    'e2808d7c' -- U+200D  unión de ancho cero
    'e2808e7c' -- U+200E  marca de izquierda a derecha
    'e2808f7c' -- U+200F  marca de derecha a izquierda
    'e280aa7c' -- U+202A  incrustación de izquierda a derecha
    'e280ab7c' -- U+202B  incrustación de derecha a izquierda
    'e280ac7c' -- U+202C  fin de formato direccional
    'e280ad7c' -- U+202D  forzar izquierda a derecha
    'e280ae7c' -- U+202E  forzar derecha a izquierda
    'e281a07c' -- U+2060  unión de palabras
    'e281a17c' -- U+2061  aplicación de función
    'e281a27c' -- U+2062  multiplicación invisible
    'e281a37c' -- U+2063  separador invisible
    'e281a47c' -- U+2064  suma invisible
    'e281a67c' -- U+2066  aislamiento de izquierda a derecha
    'e281a77c' -- U+2067  aislamiento de derecha a izquierda
    'e281a87c' -- U+2068  aislamiento de primer fuerte
    'e281a97c' -- U+2069  fin de aislamiento
    'e385a47c' -- U+3164  relleno de Hangul
    'efbbbf7c' -- U+FEFF  espacio de no separación de ancho cero (BOM)
    'efbea0'   -- U+FFA0  relleno de Hangul de ancho medio
    , 'hex'), 'UTF8') AS patron
),
vivas AS (
  SELECT f.id, f.company_id, f.proveedor_id, f.project_id, f.numero_factura, f.estado,
         f.fecha_emision, f.monto_total, f.moneda, f.created_at,
         NULLIF(regexp_replace(upper(f.numero_factura), '[^A-Z0-9]', '', 'g'), '') AS clave
    FROM public.facturas_proveedor f
   WHERE f.estado <> 'anulada' AND f.numero_factura IS NOT NULL
),
con_clave AS (
  SELECT * FROM vivas WHERE clave IS NOT NULL
),
grupos AS (
  SELECT company_id, proveedor_id, clave
    FROM con_clave
   GROUP BY company_id, proveedor_id, clave
  HAVING count(*) > 1
),
-- Perfil de separadores: posiciones, sobre la clave, donde hay un separador ENTRE dos caracteres
-- alfanuméricos (los de los extremos y el tipo de separador no cuentan). «1-23» → {1}; «12-3» → {2}.
-- Los caracteres invisibles de la lista se quitan antes de calcularlo (no son separadores).
miembros AS (
  SELECT c.*,
         (SELECT COALESCE(array_agg(s.pos ORDER BY s.n), ARRAY[]::integer[])
            FROM (SELECT t.n,
                         (sum(length(t.p)) OVER (ORDER BY t.n))::integer AS pos,
                         count(*) OVER ()                                AS total
                    FROM regexp_split_to_table(
                           regexp_replace(
                             regexp_replace(upper(c.numero_factura), (SELECT patron FROM invisibles), '', 'g'),
                             '^[^A-Z0-9]+|[^A-Z0-9]+$', '', 'g'),
                           '[^A-Z0-9]+') WITH ORDINALITY AS t(p, n)) s
           WHERE s.n < s.total) AS perfil
    FROM con_clave c
    JOIN grupos g USING (company_id, proveedor_id, clave)
),
pares AS (
  SELECT a.company_id, a.proveedor_id, a.clave,
         a.id AS id_a, a.numero_factura AS num_a, a.fecha_emision AS fecha_a, a.monto_total AS monto_a,
         a.moneda AS moneda_a, a.estado AS estado_a, a.project_id AS proyecto_a, a.perfil AS perfil_a, a.created_at AS creada_a,
         b.id AS id_b, b.numero_factura AS num_b, b.fecha_emision AS fecha_b, b.monto_total AS monto_b,
         b.moneda AS moneda_b, b.estado AS estado_b, b.project_id AS proyecto_b, b.perfil AS perfil_b,
         CASE WHEN a.perfil <@ b.perfil OR b.perfil <@ a.perfil
              THEN 'equivalente (duplicado probable)'
              ELSE 'distinto legítimo (serie/correlativo diferente)' END AS clasificacion,
         CASE WHEN a.perfil = b.perfil
              THEN 'mismos separadores: solo difiere el tipo de separador, las mayúsculas, los espacios o algún carácter invisible'
              WHEN a.perfil <@ b.perfil OR b.perfil <@ a.perfil
              THEN 'uno trae menos separadores (o ninguno): ambiguo, se trata como duplicado'
              ELSE 'separadores en posiciones distintas (' || a.perfil::text || ' frente a ' || b.perfil::text || ')' END AS detalle
    FROM miembros a
    JOIN miembros b ON b.company_id = a.company_id AND b.proveedor_id = a.proveedor_id AND b.clave = a.clave
                   AND (a.created_at, a.id) < (b.created_at, b.id)
),
numeradas AS (
  SELECT p.*, row_number() OVER (PARTITION BY p.clasificacion ORDER BY p.company_id, p.proveedor_id, p.clave, p.creada_a, p.id_a, p.id_b) AS rn
    FROM pares p
),
resumen(orden, concepto, n) AS (
  SELECT 1, 'facturas_proveedor (todas, también anuladas)', count(*) FROM public.facturas_proveedor
  UNION ALL SELECT 2, 'facturas vivas (no anuladas) con número', count(*) FROM vivas
  UNION ALL SELECT 3, 'facturas vivas con clave alfanumérica (las que se comparan)', count(*) FROM con_clave
  UNION ALL SELECT 4, 'grupos (empresa, proveedor, clave) con más de una factura viva', count(*) FROM grupos
  UNION ALL SELECT 5, 'facturas implicadas en algún grupo', count(*) FROM miembros
  UNION ALL SELECT 6, 'pares equivalente (duplicado probable)', count(*) FROM pares WHERE clasificacion = 'equivalente (duplicado probable)'
  UNION ALL SELECT 7, 'pares distinto legítimo (serie/correlativo diferente) — cambian de trato: antes se rechazaban, ahora se aceptan', count(*) FROM pares WHERE clasificacion <> 'equivalente (duplicado probable)'
  UNION ALL SELECT 8, 'pares equivalentes «ambiguos» (uno con separador y otro sin él, o con separadores de más)', count(*) FROM pares WHERE clasificacion = 'equivalente (duplicado probable)' AND perfil_a <> perfil_b
)
SELECT apartado, concepto, n, empresa, proveedor, clave, factura_a, factura_b, id_a, id_b, nota
  FROM (
    SELECT 'resumen' AS apartado, r.concepto, r.n, NULL::text AS empresa, NULL::text AS proveedor, NULL::text AS clave,
           NULL::text AS factura_a, NULL::text AS factura_b, NULL::text AS id_a, NULL::text AS id_b, NULL::text AS nota,
           r.orden AS o1, NULL::text AS o2, NULL::bigint AS o3
      FROM resumen r
    UNION ALL
    SELECT 'ejemplo', e.clasificacion, NULL::bigint, c.nombre, pr.nombre, e.clave,
           format('«%s» · %s · %s %s · %s · proyecto %s', e.num_a, e.fecha_a, COALESCE(e.moneda_a, '—'), e.monto_a, e.estado_a, COALESCE(pa.nombre, '(sin proyecto)')),
           format('«%s» · %s · %s %s · %s · proyecto %s', e.num_b, e.fecha_b, COALESCE(e.moneda_b, '—'), e.monto_b, e.estado_b, COALESCE(pb.nombre, '(sin proyecto)')),
           e.id_a::text, e.id_b::text, e.detalle,
           CASE e.clasificacion WHEN 'equivalente (duplicado probable)' THEN 10 ELSE 11 END, e.clave || e.id_a::text, e.rn
      FROM numeradas e
      LEFT JOIN public.companies c   ON c.id  = e.company_id
      LEFT JOIN public.proveedores pr ON pr.id = e.proveedor_id
      LEFT JOIN public.projects pa   ON pa.id = e.proyecto_a
      LEFT JOIN public.projects pb   ON pb.id = e.proyecto_b
     WHERE e.rn <= 20
  ) z
 ORDER BY o1, o3, o2;
