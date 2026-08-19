-- Escenarios del sandbox de recepción (ver rls-evidencias-sandbox.sql).
--
-- Cada escenario corre en su propia transacción con ROLLBACK: las escrituras
-- que SÍ deben funcionar se ejecutan de verdad y luego se deshacen, así que el
-- fixture queda intacto y el orden no importa.
--
-- Convención: `SET LOCAL ROLE authenticated` (la RLS no aplica al dueño de la
-- tabla) + el "sub" del JWT decide quién pregunta. El ROL importa el doble
-- aquí: es también lo que distingue una llamada del navegador de la RPC.
--
-- Nombres de objeto: <project_id>/<pieza_id>/<archivo>.

\set ON_ERROR_STOP on
\set QUIET on

\echo '── Precondiciones: sin esto, las negativas podrían pasar por otra razón ──'
BEGIN;
DO $$
DECLARE v_emp int; v_proy int; v_publico boolean; v_fk text;
BEGIN
  SELECT count(DISTINCT company_id) INTO v_emp FROM public.app_users
   WHERE id IN ('a0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000b',
                'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001',
                'a0000000-0000-0000-0000-000000000002');
  PERFORM public.assert_eq(v_emp, 1, 'residentes y personal son de la MISMA empresa');

  SELECT count(DISTINCT project_id) INTO v_proy FROM public.unidades
   WHERE id IN ('d0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000b');
  PERFORM public.assert_eq(v_proy, 1, 'las dos unidades son vecinas del MISMO proyecto');

  SELECT b.public INTO v_publico FROM storage.buckets b WHERE b.id = 'recepcion-evidencias';
  PERFORM public.assert_true(NOT v_publico, 'el bucket recepcion-evidencias es PRIVADO');

  -- La tabla la generalizaron las migraciones, no el andamiaje: si esto no se
  -- cumple, el sandbox estaría probando una tabla inventada.
  PERFORM public.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='paquetes_recibidos' AND column_name='clase'),
    'la columna `clase` la añadió la migración');
  PERFORM public.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paquetes_unidad_por_clase_chk')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paquetes_destinatario_unidad_chk'),
    'los dos CHECK que exigen unidad_id siguen puestos (no se relajaron)');

  SELECT confdeltype INTO v_fk FROM pg_constraint WHERE conname='paquetes_recibidos_unidad_id_fkey';
  PERFORM public.assert_true(v_fk = 'r', 'el FK de unidad quedó en RESTRICT, no en SET NULL');
END $$;
ROLLBACK;

\echo ''
\echo '── 1 · Borrar una unidad con historial de recepción ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';   -- company_owner
DO $$
DECLARE n bigint;
BEGIN
  -- Antes esto abortaba con un 23514 del CHECK (el SET NULL chocaba con
  -- "un paquete siempre tiene unidad"): un mensaje que no le decía nada a nadie.
  -- Ahora es un 23503 de FK, que la UI traduce a "tiene historial, desactívala".
  PERFORM public.assert_falla_con(
    $sql$ DELETE FROM public.unidades WHERE id = 'd0000000-0000-0000-0000-00000000000a' $sql$,
    '23503',
    'borrar una unidad con historial falla por FK, de forma controlada');

  SELECT count(*) INTO n FROM public.paquetes_recibidos
   WHERE unidad_id = 'd0000000-0000-0000-0000-00000000000a';
  PERFORM public.assert_eq(n, 2, 'y el historial de esa unidad sigue entero');

  -- La operación correcta.
  UPDATE public.unidades SET activo = false WHERE id = 'd0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: desactivarla sí funciona');

  SELECT count(*) INTO n FROM public.paquetes_recibidos
   WHERE unidad_id = 'd0000000-0000-0000-0000-00000000000a';
  PERFORM public.assert_eq(n, 2, 'desactivar no toca el historial');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
DECLARE n bigint;
BEGIN
  DELETE FROM public.unidades WHERE id = 'd0000000-0000-0000-0000-00000000000c';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: una unidad SIN historial sí se borra');
END $$;
ROLLBACK;

\echo ''
\echo '── 2 · SELECT: quién puede LEER/LISTAR una evidencia ──'

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
   WHERE name = '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/sobre.jpg';
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
  PERFORM public.assert_eq(n, 8, 'super_admin conserva su llave (ve las 8)');
END $$;
ROLLBACK;

\echo ''
\echo '── 3 · INSERT / UPDATE / DELETE de evidencias ──'

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

  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-0000000000ff/robo.jpg', auth.uid())
  $sql$, 'no se puede colgar evidencia del id de una pieza de OTRA empresa');

  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-3333333333bb/c0000000-0000-0000-0000-0000000000f2/x.jpg', auth.uid())
  $sql$, 'no se puede subir a un PROYECTO de otra empresa');

  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias', '33333333-3333-3333-3333-333333333333/suelta.jpg', auth.uid())
  $sql$, 'una ruta sin carpeta de pieza queda fuera');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';   -- residente
DO $$
DECLARE n bigint;
BEGIN
  PERFORM public.assert_falla($sql$
    INSERT INTO storage.objects (bucket_id, name, owner) VALUES
      ('recepcion-evidencias',
       '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000a/falsa.jpg', auth.uid())
  $sql$, 'un residente NO sube evidencias (ni a su propia pieza)');

  WITH u AS (
    UPDATE storage.objects SET name = name || '.hack'
     WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM u;
  PERFORM public.assert_eq(n, 0, 'el residente no puede SUSTITUIR la firma de su propia pieza');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'ni borrarla');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';   -- company_owner
DO $$
DECLARE n bigint;
BEGIN
  WITH u AS (UPDATE storage.objects SET owner = auth.uid() WHERE bucket_id='recepcion-evidencias' RETURNING 1)
  SELECT count(*) INTO n FROM u;
  PERFORM public.assert_eq(n, 0, 'ni siquiera el company_owner: el bucket no tiene policy de UPDATE');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: el company_owner sí puede corregir un registro errado');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';   -- operador correspondencia
DO $$
DECLARE n bigint;
BEGIN
  -- Huérfano propio: descarte de formulario, o firma cuya RPC falló después de
  -- subirla. Que se pueda retirar es lo que permite a la UI limpiar tras un
  -- fallo en vez de dejar basura imborrable en el bucket.
  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-0000000000e1/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: retira su propio huérfano');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-0000000000e2/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'pero NO el huérfano de otro empleado');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000a/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 0, 'y NO la firma que YA cuelga de una pieza: eso ya es prueba');
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
  PERFORM public.assert_eq(n, 0, 'el admin NO borra evidencia de correspondencia');

  WITH d AS (DELETE FROM storage.objects
              WHERE name LIKE '%/c0000000-0000-0000-0000-00000000000d/%' RETURNING 1)
  SELECT count(*) INTO n FROM d;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: el admin sí borra evidencia de paquetería');
END $$;
ROLLBACK;

\echo ''
\echo '── 4 · El acuse: la RPC es la ÚNICA puerta ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  -- El "Atender" viejo.
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET estado='atendido'
     WHERE id='c0000000-0000-0000-0000-00000000000a'
  $sql$, 'UPDATE directo INCOMPLETO: rechazado');

  -- Y el que parecía correcto: nombre, hora y empleado incluidos. Este es el
  -- que antes pasaba, saltándose la validación de firma, permiso y carrera.
  PERFORM public.assert_falla_con($sql$
    UPDATE public.paquetes_recibidos
       SET estado='atendido', entregado_a_nombre='Quien sea',
           entregado_por = auth.uid(), entregado_via='porteria', hora_entrega = now()
     WHERE id='c0000000-0000-0000-0000-00000000000a'
  $sql$, '42501', 'UPDATE directo COMPLETO: también rechazado (no es la puerta)');

  -- Ni rellenar los campos del acuse dejando la pieza abierta.
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET entregado_a_nombre='Colado'
     WHERE id='c0000000-0000-0000-0000-00000000000a'
  $sql$, 'ni escribir el nombre del acuse a mano en una pieza pendiente');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE n bigint;
BEGIN
  -- Los otros dos cierres siguen siendo UPDATE normal y no se rompen.
  UPDATE public.paquetes_recibidos
     SET estado='devuelto', hora_entrega=now(), entregado_por=auth.uid(), entregado_via='porteria'
   WHERE id='c0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: devolver al remitente sigue funcionando');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE n bigint;
BEGIN
  UPDATE public.paquetes_recibidos SET estado='archivado'
   WHERE id='c0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: archivar sigue funcionando');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';   -- paquetería
DO $$
DECLARE n bigint;
BEGIN
  UPDATE public.paquetes_recibidos
     SET estado='entregado', entregado_por=auth.uid(), entregado_via='porteria', hora_entrega=now()
   WHERE id='c0000000-0000-0000-0000-00000000000d';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: paquetería cierra por UPDATE, como siempre');
END $$;
ROLLBACK;

\echo ''
\echo '── 5 · La RPC: acuse, firma verificada y vía ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE r public.paquetes_recibidos;
BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000a'::uuid,'') $sql$,
    'nombre vacío: rechazado');

  -- Quien recibe NO es el destinatario impreso en el sobre ('Ana Pérez').
  r := public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000a'::uuid, '  Marta Solís  ');
  PERFORM public.assert_true(r.estado = 'atendido', 'SIN firma: la RPC sí cierra la custodia');
  PERFORM public.assert_true(r.entregado_a_nombre = 'Marta Solís', 'con el nombre real, recortado');
  PERFORM public.assert_true(r.entregado_a_nombre IS DISTINCT FROM r.destinatario,
    'que puede ser distinto del destinatario del sobre');
  PERFORM public.assert_true(r.entregado_por = auth.uid() AND r.hora_entrega IS NOT NULL,
    'sellando empleado y hora');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000a'::uuid,'Otro') $sql$,
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
         '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma-b.png');
  PERFORM public.assert_true(
    r.firma_path = '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma-b.png',
    'firma PROPIA y bien ubicada: aceptada');
  PERFORM public.assert_true(r.entregado_via = 'porteria', 'la vía la pone el servidor');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000b'::uuid,'Bruno',
      '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/no-existe.png') $sql$,
    'firma inexistente: rechazada');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000b'::uuid,'Bruno',
      '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000a/firma.png') $sql$,
    'firma de OTRA PIEZA: rechazada');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000b'::uuid,'Bruno',
      '33333333-3333-3333-3333-3333333333cc/c0000000-0000-0000-0000-00000000000b/firma-b.png') $sql$,
    'firma bajo OTRO PROYECTO: rechazada');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000b'::uuid,'Bruno',
      '33333333-3333-3333-3333-333333333333/c0000000-0000-0000-0000-00000000000b/firma-de-otro.png') $sql$,
    'firma subida por OTRO USUARIO: rechazada');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000b'::uuid,'Bruno',
      'c0000000-0000-0000-0000-00000000000b/firma-b.png') $sql$,
    'ruta sin las tres partes: rechazada');

  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000b'::uuid,'Bruno',
      NULL, 'portal') $sql$,
    'via=portal: la correspondencia no se entrega a distancia');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';   -- paquetería
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000a'::uuid,'Quien sea') $sql$,
    'sin el permiso de correspondencia no se puede entregar');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000008';   -- otra empresa
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000a'::uuid,'Quien sea') $sql$,
    'el admin de otra empresa tampoco');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000d'::uuid,'Quien sea') $sql$,
    'un PAQUETE no se entrega por esta puerta (tiene la suya)');
END $$;
ROLLBACK;

\echo ''
\echo '── 6 · Después del cierre, el acuse es inmutable ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE n bigint;
BEGIN
  PERFORM public.correspondencia_registrar_acuse('c0000000-0000-0000-0000-00000000000a'::uuid, 'Marta Solís');

  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET entregado_a_nombre='Otro nombre'
     WHERE id='c0000000-0000-0000-0000-00000000000a' $sql$,
    'cambiar el NOMBRE tras el cierre: rechazado');
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET firma_path='x/y/z.png'
     WHERE id='c0000000-0000-0000-0000-00000000000a' $sql$,
    'cambiar la FIRMA tras el cierre: rechazado');
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET entregado_por='a0000000-0000-0000-0000-000000000001'
     WHERE id='c0000000-0000-0000-0000-00000000000a' $sql$,
    'cambiar el ACTOR tras el cierre: rechazado');
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET hora_entrega = now() - interval '3 days'
     WHERE id='c0000000-0000-0000-0000-00000000000a' $sql$,
    'retrasar la HORA tras el cierre: rechazado');
  PERFORM public.assert_falla($sql$
    UPDATE public.paquetes_recibidos SET estado='pendiente'
     WHERE id='c0000000-0000-0000-0000-00000000000a' $sql$,
    'REABRIR una correspondencia entregada: rechazado');

  -- Lo que no es el acuse sí se puede seguir anotando.
  UPDATE public.paquetes_recibidos SET notas = 'Se entregó en mano'
   WHERE id='c0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.assert_eq(n, 1, 'CONTROL POSITIVO: anotar una observación sigue permitido');
END $$;
ROLLBACK;

\echo ''
\echo '── 7 · Aviso al residente: claim con lease ──'

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  PERFORM public.assert_falla(
    $sql$ SELECT public.paquete_reclamar_aviso('c0000000-0000-0000-0000-00000000000a'::uuid) $sql$,
    'el navegador NO puede reclamar el aviso (solo service_role)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE v_pieza uuid := 'c0000000-0000-0000-0000-00000000000a';
BEGIN
  PERFORM public.assert_true(public.paquete_reclamar_aviso(v_pieza),
    'la primera ejecución reclama el envío');
  PERFORM public.assert_true(NOT public.paquete_reclamar_aviso(v_pieza),
    'la segunda, simultánea, NO: el lease sigue vivo');
END $$;

-- Se envejece el claim como el dueño de la tabla para simular una ejecución que
-- murió a mitad. Es lo único que este sandbox no puede provocar de verdad: no
-- hay dos sesiones. La exclusión mutua sí es real — la da el row lock del
-- UPDATE, que serializa las dos llamadas de arriba.
UPDATE public.paquetes_recibidos
   SET notificacion_claim_at = now() - interval '10 minutes'
 WHERE id = 'c0000000-0000-0000-0000-00000000000a';

DO $$
DECLARE v_pieza uuid := 'c0000000-0000-0000-0000-00000000000a';
BEGIN
  PERFORM public.assert_true(public.paquete_reclamar_aviso(v_pieza),
    'un claim abandonado caduca: otra ejecución puede reintentar');

  -- Ningún canal entregó: se libera el claim y NO se sella nada.
  PERFORM public.assert_true(public.paquete_finalizar_aviso(v_pieza, false),
    'finalizar sin entrega devuelve true (la fila existe)');
  PERFORM public.assert_true(
    (SELECT notificado_at IS NULL AND notificacion_claim_at IS NULL
       FROM public.paquetes_recibidos WHERE id = v_pieza),
    'un fallo transitorio NO se sella como notificado');

  -- Ahora sí entregó.
  PERFORM public.assert_true(public.paquete_reclamar_aviso(v_pieza), 'se vuelve a reclamar');
  PERFORM public.assert_true(public.paquete_finalizar_aviso(v_pieza, true), 'y se sella');
  PERFORM public.assert_true(
    (SELECT notificado_at IS NOT NULL AND notificacion_claim_at IS NULL
       FROM public.paquetes_recibidos WHERE id = v_pieza),
    'notificado_at queda puesto y el claim liberado');
  PERFORM public.assert_true(NOT public.paquete_reclamar_aviso(v_pieza),
    'y ya no se puede reclamar: no se avisa dos veces');

  PERFORM public.assert_true(
    NOT public.paquete_finalizar_aviso('00000000-0000-0000-0000-000000000000'::uuid, true),
    'finalizar una pieza inexistente devuelve false, no un éxito silencioso');
END $$;
ROLLBACK;
