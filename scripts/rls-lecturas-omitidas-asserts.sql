-- Escenarios del sandbox de lecturas omitidas (ver rls-lecturas-omitidas-sandbox.sql).
--
-- Cada bloque corre en su propia transacción con ROLLBACK, así que el fixture
-- queda intacto y el orden no importa. `SET LOCAL ROLE authenticated` (la RLS
-- no aplica al dueño de la tabla) + el «sub» del JWT decide quién pregunta.

\set ON_ERROR_STOP on
\set QUIET on

\set OWNER_A   '''a0000000-0000-0000-0000-000000000001'''
\set LECTOR    '''a0000000-0000-0000-0000-000000000002'''
\set LECTOR_P2 '''a0000000-0000-0000-0000-000000000003'''
\set VISOR     '''a0000000-0000-0000-0000-000000000004'''
\set SUPERV    '''a0000000-0000-0000-0000-000000000005'''
\set OWNER_B   '''b0000000-0000-0000-0000-000000000001'''

\echo '── 0 · Precondiciones ──'
BEGIN;
DO $$
BEGIN
  PERFORM public.assert_true(
    NOT (SELECT public FROM storage.buckets WHERE id = 'lecturas-omitidas'),
    'el bucket lecturas-omitidas existe y es PRIVADO');
  PERFORM public.assert_true(
    NOT has_table_privilege('authenticated', 'public.lecturas_omitidas', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.lecturas_omitidas', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.lecturas_omitidas', 'DELETE'),
    'authenticated NO puede escribir la tabla directamente (sólo por RPC)');
  PERFORM public.assert_true(
    NOT has_table_privilege('anon', 'public.lecturas_omitidas', 'SELECT'),
    'anon no lee la tabla');
  PERFORM public.assert_true(
    NOT has_function_privilege('anon', 'public.omitir_lectura(uuid, uuid[], uuid, text, text, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.descartar_lectura_omitida(uuid, text)', 'EXECUTE'),
    'anon no ejecuta las RPC');
END $$;
ROLLBACK;

\echo ''
\echo '── 1 · El lector omite una unidad con dos contadores ──'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :LECTOR, true) \gset
DO $$
DECLARE n bigint; v record;
BEGIN
  SELECT count(*) INTO n FROM public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001',
    ARRAY['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],
    '40000000-0000-0000-0000-000000000001', 'acceso_obstruido', '  Carro encima  ',
    '10000000-0000-0000-0000-000000000001/foto.jpg', '{"lat":14.5,"lng":-90.4}');
  PERFORM public.assert_eq(n, 2, 'una fila por contador');

  SELECT * INTO v FROM public.lecturas_omitidas WHERE contador_id = '30000000-0000-0000-0000-000000000001';
  PERFORM public.assert_true(
    v.company_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    AND v.project_id = '10000000-0000-0000-0000-000000000001',
    'empresa y proyecto los resuelve el servidor desde la unidad');
  PERFORM public.assert_true(
    v.omitida_por = 'a0000000-0000-0000-0000-000000000002' AND v.omitida_por_nombre = 'Lector Uno',
    'quién la omitió sale de la sesión, con su nombre');
  PERFORM public.assert_true(v.detalle = 'Carro encima' AND v.estado = 'pendiente',
    'el detalle se guarda recortado y la omisión nace pendiente');

  -- La segunda vuelta de la ruta tampoco pudo: actualiza, no duplica.
  PERFORM public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001',
    ARRAY['30000000-0000-0000-0000-000000000001']::uuid[], NULL,
    'propiedad_cerrada', NULL, NULL, NULL);
  SELECT count(*) INTO n FROM public.lecturas_omitidas
   WHERE contador_id = '30000000-0000-0000-0000-000000000001' AND estado = 'pendiente';
  PERFORM public.assert_eq(n, 1, 'omitir otra vez el mismo contador no duplica el pendiente');
  SELECT motivo INTO v FROM public.lecturas_omitidas WHERE contador_id = '30000000-0000-0000-0000-000000000001';
  PERFORM public.assert_true(v.motivo = 'propiedad_cerrada', '…y deja el motivo más reciente');

  -- Unidad sin contadores: una sola fila por la unidad, también sin duplicar.
  PERFORM public.omitir_lectura('20000000-0000-0000-0000-000000000000', '{}', NULL, 'riesgo_seguridad', NULL, NULL, NULL);
  PERFORM public.omitir_lectura('20000000-0000-0000-0000-000000000000', NULL, NULL, 'riesgo_seguridad', NULL, NULL, NULL);
  SELECT count(*) INTO n FROM public.lecturas_omitidas
   WHERE unidad_id = '20000000-0000-0000-0000-000000000000' AND contador_id IS NULL;
  PERFORM public.assert_eq(n, 1, 'unidad sin contadores: una fila, sin duplicar');
END $$;
ROLLBACK;

\echo ''
\echo '── 2 · Lo que el servidor rechaza ──'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :LECTOR, true) \gset
DO $$
BEGIN
  PERFORM public.assert_falla_con($q$ SELECT public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001', ARRAY['30000000-0000-0000-0000-000000000003']::uuid[],
    NULL, 'acceso_obstruido', NULL, NULL, NULL) $q$, '22023',
    'un contador de OTRA unidad');
  PERFORM public.assert_falla_con($q$ SELECT public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001', NULL, NULL, 'acceso_obstruido', NULL,
    '10000000-0000-0000-0000-000000000002/foto.jpg', NULL) $q$, '22023',
    'una foto en la carpeta de OTRO proyecto');
  PERFORM public.assert_falla_con($q$ SELECT public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001', NULL, NULL, 'acceso_obstruido', NULL,
    '10000000-0000-0000-0000-000000000001/../x.jpg', NULL) $q$, '22023',
    'una foto con «..» en la ruta');
  PERFORM public.assert_falla_con($q$ SELECT public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001', NULL, '40000000-0000-0000-0000-000000000003',
    'acceso_obstruido', NULL, NULL, NULL) $q$, '22023',
    'una ruta de OTRA empresa');
  PERFORM public.assert_falla_con($q$ SELECT public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001', NULL, NULL, 'otro', '  ', NULL, NULL) $q$, '23514',
    '«otro» sin explicar por qué');
  PERFORM public.assert_falla_con($q$ SELECT public.omitir_lectura(
    '20000000-0000-0000-0000-000000000001', NULL, NULL, 'me_dio_pereza', NULL, NULL, NULL) $q$, '23514',
    'un motivo fuera de la lista');
  PERFORM public.assert_falla_con($q$ INSERT INTO public.lecturas_omitidas
    (company_id, project_id, unidad_id, motivo)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001',
            '20000000-0000-0000-0000-000000000001', 'acceso_obstruido') $q$, '42501',
    'INSERT directo a la tabla, sin la RPC');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :LECTOR_P2, true) \gset
SELECT public.assert_falla_con($q$ SELECT public.omitir_lectura(
  '20000000-0000-0000-0000-000000000001', NULL, NULL, 'acceso_obstruido', NULL, NULL, NULL) $q$, '42501',
  'un lector SIN acceso al proyecto de la unidad');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :VISOR, true) \gset
SELECT public.assert_falla_con($q$ SELECT public.omitir_lectura(
  '20000000-0000-0000-0000-000000000001', NULL, NULL, 'acceso_obstruido', NULL, NULL, NULL) $q$, '42501',
  'quien sólo ve rutas (sin agua.lecturas.create)');
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :OWNER_B, true) \gset
SELECT public.assert_falla_con($q$ SELECT public.omitir_lectura(
  '20000000-0000-0000-0000-000000000001', NULL, NULL, 'acceso_obstruido', NULL, NULL, NULL) $q$, '42501',
  'la dueña de OTRA empresa');
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
SELECT public.assert_falla_con($q$ SELECT public.omitir_lectura(
  '20000000-0000-0000-0000-000000000001', NULL, NULL, 'acceso_obstruido', NULL, NULL, NULL) $q$, '42501',
  'anon');
ROLLBACK;

\echo ''
\echo '── 3 · Quién ve las omisiones ──'
BEGIN;
-- Como dueño de la tabla: una omisión en P1 y otra en P2.
SELECT set_config('request.jwt.claim.sub', :OWNER_A, true) \gset
SELECT count(*) FROM public.omitir_lectura('20000000-0000-0000-0000-000000000001',
  ARRAY['30000000-0000-0000-0000-000000000001']::uuid[], NULL, 'acceso_obstruido', NULL, NULL, NULL);
SELECT count(*) FROM public.omitir_lectura('20000000-0000-0000-0000-000000000002',
  ARRAY['30000000-0000-0000-0000-000000000003']::uuid[], NULL, 'acceso_obstruido', NULL, NULL, NULL);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :LECTOR, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas), 1, 'el lector de P1 ve sólo la de P1');
SELECT set_config('request.jwt.claim.sub', :LECTOR_P2, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas), 1, 'el lector de P2 ve sólo la de P2');
SELECT set_config('request.jwt.claim.sub', :VISOR, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas), 1, 'con agua.rutas.view también la ve (su proyecto)');
SELECT set_config('request.jwt.claim.sub', :OWNER_A, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas), 2, 'la dueña ve las de toda su empresa');
SELECT set_config('request.jwt.claim.sub', :OWNER_B, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas), 0, 'la dueña de OTRA empresa no ve ninguna');
ROLLBACK;

\echo ''
\echo '── 4 · Una lectura nueva del contador la resuelve sola ──'
BEGIN;
SELECT set_config('request.jwt.claim.sub', :LECTOR, true) \gset
SELECT count(*) FROM public.omitir_lectura('20000000-0000-0000-0000-000000000001',
  ARRAY['30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002']::uuid[],
  NULL, 'acceso_obstruido', NULL, NULL, NULL);
-- Una lectura BORRADA no cuenta.
INSERT INTO public.registros (contador_id, lectura_actual, deleted_at)
VALUES ('30000000-0000-0000-0000-000000000001', 100, now());
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas WHERE estado = 'pendiente'), 2,
  'una lectura ya borrada no resuelve nada');
INSERT INTO public.registros (id, contador_id, lectura_actual)
VALUES ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 100);
SELECT public.assert_true(
  (SELECT estado = 'resuelta' AND registro_id = '50000000-0000-0000-0000-000000000001'
          AND cerrada_at IS NOT NULL AND cerrada_por = 'a0000000-0000-0000-0000-000000000002'
     FROM public.lecturas_omitidas WHERE contador_id = '30000000-0000-0000-0000-000000000001'),
  'la del contador leído queda resuelta, apuntando a la lectura y a quien la tomó');
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas
   WHERE contador_id = '30000000-0000-0000-0000-000000000002' AND estado = 'pendiente'), 1,
  'la del otro contador de la unidad sigue pendiente');
-- Ya resuelta, si vuelve a faltar se abre un pendiente NUEVO (el índice es parcial).
SELECT count(*) FROM public.omitir_lectura('20000000-0000-0000-0000-000000000001',
  ARRAY['30000000-0000-0000-0000-000000000001']::uuid[], NULL, 'contador_ilegible', NULL, NULL, NULL);
SELECT public.assert_eq((SELECT count(*) FROM public.lecturas_omitidas
   WHERE contador_id = '30000000-0000-0000-0000-000000000001'), 2,
  'una omisión nueva tras resolver la anterior abre otro pendiente');
ROLLBACK;

\echo ''
\echo '── 5 · Descartar una omisión ──'
BEGIN;
SELECT set_config('request.jwt.claim.sub', :LECTOR, true) \gset
SELECT id AS omision FROM public.omitir_lectura('20000000-0000-0000-0000-000000000001',
  ARRAY['30000000-0000-0000-0000-000000000001']::uuid[], NULL, 'contador_no_encontrado', NULL, NULL, NULL) \gset
SET LOCAL ROLE authenticated;
SELECT public.assert_falla_con(format($q$ SELECT public.descartar_lectura_omitida(%L, 'Contador retirado') $q$, :'omision'),
  '42501', 'el lector (sin agua.rutas.edit) no descarta');
SELECT set_config('request.jwt.claim.sub', :OWNER_B, true) \gset
SELECT public.assert_falla_con(format($q$ SELECT public.descartar_lectura_omitida(%L, 'Contador retirado') $q$, :'omision'),
  '22023', 'otra empresa: «inexistente», sin confirmar que existe');
SELECT set_config('request.jwt.claim.sub', :SUPERV, true) \gset
SELECT public.assert_falla_con(format($q$ SELECT public.descartar_lectura_omitida(%L, ' no ') $q$, :'omision'),
  '22023', 'sin una nota que explique el descarte');
SELECT public.assert_true(
  (SELECT estado = 'descartada' AND nota_cierre = 'Contador retirado'
          AND cerrada_por = 'a0000000-0000-0000-0000-000000000005'
     FROM public.descartar_lectura_omitida(:'omision', ' Contador retirado ')),
  'el supervisor (agua.rutas.edit) la descarta con su nota');
SELECT public.assert_falla_con(format($q$ SELECT public.descartar_lectura_omitida(%L, 'Otra vez') $q$, :'omision'),
  '22023', 'una omisión ya cerrada no se vuelve a descartar');
ROLLBACK;

\echo ''
\echo '── 6 · Fotos en el bucket ──'
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :LECTOR, true) \gset
INSERT INTO storage.objects (bucket_id, name) VALUES ('lecturas-omitidas', '10000000-0000-0000-0000-000000000001/a.jpg');
SELECT public.assert_true(true, 'el lector sube a la carpeta de SU proyecto');
SELECT public.assert_falla_con($q$ INSERT INTO storage.objects (bucket_id, name)
  VALUES ('lecturas-omitidas', '10000000-0000-0000-0000-000000000002/b.jpg') $q$, '42501',
  'el lector no sube a un proyecto al que no tiene acceso');
SELECT public.assert_falla_con($q$ INSERT INTO storage.objects (bucket_id, name)
  VALUES ('lecturas-omitidas', 'sin-carpeta.jpg') $q$, '42501',
  'ni fuera de una carpeta de proyecto');
SELECT set_config('request.jwt.claim.sub', :VISOR, true) \gset
SELECT public.assert_falla_con($q$ INSERT INTO storage.objects (bucket_id, name)
  VALUES ('lecturas-omitidas', '10000000-0000-0000-0000-000000000001/c.jpg') $q$, '42501',
  'quien no registra lecturas no sube evidencias');
SELECT public.assert_eq((SELECT count(*) FROM storage.objects WHERE bucket_id = 'lecturas-omitidas'), 1,
  '…pero ve la evidencia de su proyecto');
SELECT set_config('request.jwt.claim.sub', :LECTOR_P2, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM storage.objects WHERE bucket_id = 'lecturas-omitidas'), 0,
  'el lector de otro proyecto no la ve');
SELECT set_config('request.jwt.claim.sub', :OWNER_B, true) \gset
SELECT public.assert_eq((SELECT count(*) FROM storage.objects WHERE bucket_id = 'lecturas-omitidas'), 0,
  'otra empresa no la ve');
ROLLBACK;
