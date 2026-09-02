-- ════════════════════════════════════════════════════════════════════════════
-- Escenarios: qué tiene que pasar DESPUÉS de aplicar 20260907001300
-- ════════════════════════════════════════════════════════════════════════════
--
-- Se corre dos veces desde el .sh:
--   · MODO=antes  → con el estado inseguro. Exige que anon SÍ pueda leer. Si no
--     puede, el fixture no reproduce producción y todo lo demás no prueba nada.
--   · MODO=despues → tras aplicar la migración real. Exige el cierre completo.
--
-- El id 00000000-0000-0000-0000-00000000a001 se usa a propósito: conocer el
-- UUID no debe cambiar el resultado.

\set ON_ERROR_STOP on
\set QUIET on

CREATE OR REPLACE FUNCTION pg_temp.como(rol text, uid text DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql AS
$$ BEGIN
     EXECUTE format('SET LOCAL ROLE %I', rol);
     IF uid IS NULL THEN
       PERFORM set_config('request.jwt.claim.sub', '', true);
     ELSE
       PERFORM set_config('request.jwt.claim.sub', uid, true);
     END IF;
   END $$;

/* Cuenta filas visibles para un rol, o -1 si el SELECT es denegado por
   privilegio (42501). Las dos cosas son "no puede leer", pero distinguirlas
   dice CÓMO se cerró: -1 es el REVOKE, 0 es la ausencia de policy. */
CREATE OR REPLACE FUNCTION pg_temp.visibles(rol text, uid text DEFAULT NULL, filtro text DEFAULT 'true')
  RETURNS integer LANGUAGE plpgsql AS
$$ DECLARE n integer; BEGIN
     PERFORM pg_temp.como(rol, uid);
     EXECUTE 'SELECT count(*) FROM public.payment_requests WHERE ' || filtro INTO n;
     RESET ROLE;
     RETURN n;
   EXCEPTION WHEN insufficient_privilege THEN
     RESET ROLE; RETURN -1;
   END $$;

CREATE OR REPLACE FUNCTION pg_temp.exigir(cond boolean, etiqueta text)
  RETURNS void LANGUAGE plpgsql AS
$$ BEGIN
     IF cond THEN RAISE NOTICE '✅ %', etiqueta;
     ELSE RAISE EXCEPTION 'FALLO: %', etiqueta;
     END IF;
   END $$;

\if :{?antes}
-- ══ MODO «antes»: el fixture TIENE que ser vulnerable ══════════════════════
DO $$
BEGIN
  RAISE NOTICE '── Estado inseguro de producción (control del fixture) ──';
  PERFORM pg_temp.exigir(pg_temp.visibles('anon') = 2,
    'anon LEE las 2 filas de todos los tenants (la vulnerabilidad existe)');
  PERFORM pg_temp.exigir(
    pg_temp.visibles('authenticated','00000000-0000-0000-0000-0000000000a1') = 2,
    'un usuario de la compañía A LEE también la fila de la compañía B');
  PERFORM pg_temp.exigir(has_table_privilege('anon','public.payment_requests','SELECT'),
    'anon tiene el GRANT de SELECT');
  PERFORM pg_temp.exigir(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='payment_requests' AND cmd='SELECT') = 1,
    'existe la policy payment_requests_select');
END $$;
\endif

\if :{?despues}
-- ══ MODO «despues»: la exposición tiene que estar cerrada ══════════════════
DO $$
DECLARE
  n_antes bigint;
  n_despues bigint;
  estado_antes text;
BEGIN
  RAISE NOTICE '── Tras aplicar 20260907001300 ──';

  -- 1 · anon no lee nada, ni siquiera un UUID conocido.
  PERFORM pg_temp.exigir(pg_temp.visibles('anon') = -1,
    'anon NO puede leer la tabla (denegado por privilegio)');
  PERFORM pg_temp.exigir(
    pg_temp.visibles('anon', NULL,
      'id = ''00000000-0000-0000-0000-00000000a001''::uuid') = -1,
    'conocer el UUID no cambia el resultado para anon');

  -- 2 · authenticated tampoco: ni filas propias ni ajenas.
  PERFORM pg_temp.exigir(
    pg_temp.visibles('authenticated','00000000-0000-0000-0000-0000000000a1') = -1,
    'authenticated NO lee ni sus propias filas (la tabla es server-side)');
  PERFORM pg_temp.exigir(
    pg_temp.visibles('authenticated','00000000-0000-0000-0000-0000000000a1',
      'company_id = ''00000000-0000-0000-0000-0000000000bb''::uuid') = -1,
    'un usuario de la compañía A no obtiene registros de la compañía B');
  PERFORM pg_temp.exigir(
    pg_temp.visibles('authenticated','00000000-0000-0000-0000-0000000000a1',
      'id = ''00000000-0000-0000-0000-00000000b001''::uuid') = -1,
    'conocer el UUID de otra compañía tampoco sirve');

  -- 3 · Privilegios: la comprobación directa que pidió la auditoría.
  PERFORM pg_temp.exigir(NOT has_table_privilege('anon','public.payment_requests','SELECT'),
    'has_table_privilege(anon, SELECT) = false');
  PERFORM pg_temp.exigir(NOT has_table_privilege('authenticated','public.payment_requests','SELECT'),
    'has_table_privilege(authenticated, SELECT) = false');
  PERFORM pg_temp.exigir(NOT has_table_privilege('public','public.payment_requests','SELECT'),
    'has_table_privilege(PUBLIC, SELECT) = false');

  -- 4 · No queda ninguna policy de SELECT aplicable a esos roles.
  PERFORM pg_temp.exigir(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='payment_requests'
        AND cmd IN ('SELECT','ALL')) = 0,
    'no queda ninguna policy SELECT (ni ALL) que pueda combinarse por OR');

  -- 5 · service_role sigue funcionando: es quien hace el trabajo real.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO n_despues FROM public.payment_requests;
  RESET ROLE;
  PERFORM pg_temp.exigir(n_despues = 2, 'service_role SIGUE leyendo las 2 filas');

  -- 6 · El flujo legítimo de la edge function (service_role) no se rompe:
  --     leer la solicitud, actualizar su estado y volver a leerla.
  SET LOCAL ROLE service_role;
  UPDATE public.payment_requests SET estado = 'succeeded'
   WHERE id = '00000000-0000-0000-0000-00000000a001';
  SELECT estado INTO estado_antes FROM public.payment_requests
   WHERE id = '00000000-0000-0000-0000-00000000a001';
  RESET ROLE;
  PERFORM pg_temp.exigir(estado_antes = 'succeeded',
    'el flujo de confirm-charge (service_role: leer + actualizar) sigue igual');

  -- 7 · Las policies de escritura acotadas por compañía quedan intactas.
  PERFORM pg_temp.exigir(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='payment_requests'
        AND policyname IN ('payment_requests_insert','payment_requests_update')) = 2,
    'payment_requests_insert y _update siguen existiendo (fuera de alcance)');

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1', true);
  INSERT INTO public.payment_requests (cliente_id, company_id, monto, provider)
  VALUES ('00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000aa', 99.00, 'stripe');
  RESET ROLE;
  RAISE NOTICE '✅ el alta autorizada de la compañía A sigue permitida (INSERT intacto)';

  -- 8 · Un intento fallido de lectura no modifica datos.
  SELECT count(*) INTO n_antes FROM public.payment_requests;
  PERFORM pg_temp.visibles('anon');
  PERFORM pg_temp.visibles('authenticated','00000000-0000-0000-0000-0000000000a1');
  SELECT count(*) INTO n_despues FROM public.payment_requests;
  PERFORM pg_temp.exigir(n_antes = n_despues,
    'los intentos fallidos no modificaron datos');

  -- 9 · La RPC de reconciliación deja de ser disparable por authenticated.
  PERFORM pg_temp.exigir(
    NOT has_function_privilege('authenticated',
      'public.reconciliar_payment_requests_pendientes()','EXECUTE'),
    'authenticated ya no puede ejecutar reconciliar_payment_requests_pendientes()');
  PERFORM pg_temp.exigir(
    has_function_privilege('service_role',
      'public.reconciliar_payment_requests_pendientes()','EXECUTE'),
    'service_role SÍ puede: el cron sigue funcionando');

  RAISE NOTICE '── Todos los escenarios pasaron ──';
END $$;
\endif
