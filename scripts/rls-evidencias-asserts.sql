-- Escenarios del sandbox de evidencias y acuse (ver rls-evidencias-sandbox.sql).
--
-- Cada escenario corre en su propia transacción con ROLLBACK: las escrituras
-- que SÍ deben funcionar se ejecutan de verdad y luego se deshacen, así que el
-- fixture queda intacto y el orden no importa.
--
-- Convención: `SET LOCAL ROLE authenticated` (la RLS no aplica al dueño de la
-- tabla) + el "sub" del JWT decide quién pregunta.
--
-- Nombres de objeto: <project_id>/<pieza_id>/<archivo>.

\set ON_ERROR_STOP on
\set QUIET on

-- ── Semilla de objetos (como dueño de la tabla, sin RLS) ────────────────────
-- `owner` = el operador de correspondencia, que es quien los sube en la app.
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000a/firma.png',
   'a0000000-0000-0000-0000-000000000003'),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/sobre.jpg',
   'a0000000-0000-0000-0000-000000000003'),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000c/citacion.jpg',
   'a0000000-0000-0000-0000-000000000003'),
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000d/paquete.jpg',
   'a0000000-0000-0000-0000-000000000004'),
  -- Borrador: un formulario a medio llenar. La pieza aún no existe.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000e1/borrador.jpg',
   'a0000000-0000-0000-0000-000000000003'),
  -- Borrador de OTRO empleado (el de paquetería), para el control de dueño.
  ('recepcion-evidencias',
   '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000e2/ajeno.jpg',
   'a0000000-0000-0000-0000-000000000004');

\echo '── Precondiciones: sin esto, las negativas podrían pasar por otra razón ──'
BEGIN;
DO $$
DECLARE v_emp int; v_proy int; v_publico boolean;
BEGIN
  SELECT count(DISTINCT company_id) INTO v_emp FROM public.app_users
   WHERE id IN ('a0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000b',
                'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001',
                'a0000000-0000-0000-0000-000000000002');
  PERFORM public.assert_eq(v_emp, 1, 'residentes y personal son de la MISMA empresa');

  SELECT count(DISTINCT project_id) INTO v_proy FROM public.unidades
   WHERE id IN ('d0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000b');
  PERFORM public.assert_eq(v_proy, 1, 'las dos unidades son del MISMO proyecto (vecinas, no de otro condominio)');

  SELECT b.public INTO v_publico FROM storage.buckets b WHERE b.id = 'recepcion-evidencias';
  PERFORM public.assert_true(NOT v_publico, 'el bucket recepcion-evidencias es PRIVADO');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
DO $$ BEGIN
  PERFORM public.assert_true(
    ARRAY(SELECT public.mis_unidades_ids()) = ARRAY['d0000000-0000-0000-0000-00000000000a'::uuid],
    'el residente A-1 solo tiene su unidad (no la del vecino)');
END $$;
ROLLBACK;

\echo ''
\echo '── SELECT: quién puede LEER/LISTAR una evidencia ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';   -- residente A-1
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%';
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: el residente SÍ ve la evidencia de SU correspondencia');

  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000b/%';
  PERFORM public.assert_eq(n, 0, 'el residente A-1 NO ve la evidencia de la unidad vecina A-2');

  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000c/%';
  PERFORM public.assert_eq(n, 0, 'el residente NO ve la correspondencia dirigida a la ADMINISTRACIÓN');

  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000d/%';
  PERFORM public.assert_eq(n, 1, 'el residente sí ve la foto del paquete de su propia unidad');

  SELECT count(*) INTO n FROM storage.objects;
  PERFORM public.assert_eq(n, 2, 'listar el bucket entero le devuelve SOLO lo suyo (2 objetos)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000b';   -- residente A-2
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%';
  PERFORM public.assert_eq(n, 0, 'la negativa es simétrica: A-2 tampoco ve la firma de A-1');

  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000b/%';
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: A-2 ve la suya');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';   -- operador correspondencia
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000c/%';
  PERFORM public.assert_eq(n, 1, 'el personal de correspondencia SÍ ve la de administración');

  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000d/%';
  PERFORM public.assert_eq(n, 0, 'pero NO la de paquetería: el permiso es por clase');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';   -- operador paquetería
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000d/%';
  PERFORM public.assert_eq(n, 1, 'el de paquetería ve la del paquete');

  SELECT count(*) INTO n FROM storage.objects
   WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%';
  PERFORM public.assert_eq(n, 0, 'y NO la firma de una notificación legal');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000005';   -- correspondencia, OTRA torre
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects;
  PERFORM public.assert_eq(n, 0,
    'mismo permiso pero otro proyecto asignado: no ve nada (el alcance por proyecto también filtra)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000008';   -- admin de otra empresa
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects;
  PERFORM public.assert_eq(n, 0, 'el admin de OTRA empresa no ve ninguna evidencia');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';   -- soporte
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM storage.objects;
  PERFORM public.assert_eq(n, 6, 'super_admin conserva su llave (ve las 6)');
END $$;
ROLLBACK;

\echo ''
\echo '── INSERT: quién puede SUBIR una evidencia ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE n bigint;
BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES
    ('recepcion-evidencias',
     '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000f1/nueva.jpg',
     auth.uid());
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: el operador sube evidencia a su proyecto');

  -- Pieza YA existente y de otra empresa: la ruta no puede colgarse de ella.
  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000ff/robo.jpg',
       auth.uid())
  $sql$, 'no se puede colgar evidencia del id de una pieza de OTRA empresa');

  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-3333333333bb/c0000000-0000-0000-0000-0000000000f2/x.jpg',
       auth.uid())
  $sql$, 'no se puede subir a un PROYECTO de otra empresa');

  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-333333333333/suelta.jpg',
       auth.uid())
  $sql$, 'una ruta sin carpeta de pieza queda fuera (nadie podría decidir quién la lee)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';   -- residente
DO $$ BEGIN
  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000a/falsa.jpg',
       auth.uid())
  $sql$, 'un residente NO sube evidencias (ni a su propia pieza)');
END $$;
ROLLBACK;

\echo ''
\echo '── UPDATE: sustituir una prueba no es una operación que exista ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
DO $$
DECLARE n bigint;
BEGIN
  WITH u AS (
    UPDATE storage.objects SET name = name || '.hack'
     WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM u;
  PERFORM public.assert_eq(n, 0, 'el residente no puede SUSTITUIR la firma de su propia pieza');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';   -- company_owner
DO $$
DECLARE n bigint;
BEGIN
  WITH u AS (UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id = 'recepcion-evidencias' RETURNING 1)
  SELECT count(*) INTO n FROM u;
  PERFORM public.assert_eq(n, 0, 'ni siquiera el company_owner: el bucket no tiene policy de UPDATE');
END $$;
ROLLBACK;

\echo ''
\echo '── DELETE: borrador propio vs prueba de entrega ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';   -- operador correspondencia
DO $$
DECLARE n bigint;
BEGIN
  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-0000000000e1/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: retira su propio borrador (la pieza aún no existe)');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-0000000000e2/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'pero NO el borrador de otro empleado');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'y NO la firma de una pieza ya registrada: eso ya es prueba');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';   -- residente A-1
DO $$
DECLARE n bigint;
BEGIN
  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'el residente NO borra la firma de su propia entrega');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000b/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'ni la evidencia de la unidad vecina');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';   -- admin
DO $$
DECLARE n bigint;
BEGIN
  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'el admin NO borra evidencia de correspondencia (mismo reparto que la pieza)');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000d/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: el admin sí borra evidencia de paquetería');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';   -- company_owner
DO $$
DECLARE n bigint;
BEGIN
  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: el company_owner sí puede corregir un registro errado');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000008';   -- admin de otra empresa
DO $$
DECLARE n bigint;
BEGIN
  WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'recepcion-evidencias' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'el admin de otra empresa no borra nada');
END $$;
ROLLBACK;

\echo ''
\echo '── Acuse de entrega: correspondencia_registrar_acuse() ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse(
            'c0000000-0000-0000-0000-00000000000a'::uuid, '') $sql$,
    'nombre vacío: la entrega se rechaza');
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse(
            'c0000000-0000-0000-0000-00000000000a'::uuid, '    ') $sql$,
    'nombre de solo espacios: también');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE r public.paquetes_recibidos;
BEGIN
  -- Quien recibe NO es el destinatario impreso en el sobre ('Ana Pérez'):
  -- ese es justo el caso que la precarga automática falseaba.
  r := public.correspondencia_registrar_acuse(
         'c0000000-0000-0000-0000-00000000000a'::uuid, '  Marta Solís  ');
  PERFORM public.assert_true(r.estado = 'atendido', 'entrega SIN firma: la pieza queda atendida');
  PERFORM public.assert_true(r.entregado_a_nombre = 'Marta Solís',
    'guarda el nombre real de quien recibe, recortado');
  PERFORM public.assert_true(r.entregado_a_nombre IS DISTINCT FROM r.destinatario,
    'y puede ser distinto del destinatario del sobre');
  PERFORM public.assert_true(r.entregado_por = auth.uid(), 'sella al empleado que entregó');
  PERFORM public.assert_true(r.hora_entrega IS NOT NULL, 'y la hora');
  PERFORM public.assert_true(r.firma_path IS NULL, 'sin firma no inventa una');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse(
            'c0000000-0000-0000-0000-00000000000a'::uuid, 'Otro Nombre') $sql$,
    'DOBLE EJECUCIÓN: la segunda entrega de la misma pieza falla');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE r public.paquetes_recibidos;
BEGIN
  r := public.correspondencia_registrar_acuse(
         'c0000000-0000-0000-0000-00000000000b'::uuid, 'Bruno Díaz',
         '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma.png');
  PERFORM public.assert_true(
    r.firma_path = '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma.png',
    'entrega FIRMADA: guarda la ruta de la firma');
  PERFORM public.assert_true(r.entregado_via = 'porteria', 'con la vía por defecto');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';   -- operador de paquetería
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse(
            'c0000000-0000-0000-0000-00000000000a'::uuid, 'Quien sea') $sql$,
    'sin el permiso de correspondencia no se puede entregar');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000008';   -- otra empresa
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse(
            'c0000000-0000-0000-0000-00000000000a'::uuid, 'Quien sea') $sql$,
    'el admin de otra empresa tampoco');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse(
            'c0000000-0000-0000-0000-00000000000d'::uuid, 'Quien sea') $sql$,
    'un PAQUETE no se entrega por esta puerta (tiene la suya)');
END $$;
ROLLBACK;

\echo ''
\echo '── La constraint: no hay atajo por UPDATE directo ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';   -- company_owner
DO $$
DECLARE n bigint;
BEGIN
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET estado = 'atendido'
     WHERE id = 'c0000000-0000-0000-0000-00000000000a'
  $sql$, 'el "Atender" viejo (UPDATE pelado) ya no puede cerrar la custodia');

  WITH u AS (
    UPDATE public.paquetes_recibidos
       SET estado = 'atendido', entregado_a_nombre = 'Marta Solís', hora_entrega = now()
     WHERE id = 'c0000000-0000-0000-0000-00000000000a' RETURNING 1)
  SELECT count(*) INTO n FROM u;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: con acuse completo el UPDATE sí pasa');

  WITH u AS (
    UPDATE public.paquetes_recibidos SET estado = 'archivado'
     WHERE id = 'c0000000-0000-0000-0000-00000000000b' RETURNING 1)
  SELECT count(*) INTO n FROM u;
  PERFORM public.assert_eq(n, 1, 'y archivar sigue sin exigir acuse (archivar no es entregar)');
END $$;
ROLLBACK;
