-- Escenarios del sandbox de RLS (ver rls-recepcion-sandbox.sql).
--
-- Cada escenario corre en su propia transacción con ROLLBACK: los DELETE que
-- SÍ deben funcionar se prueban de verdad y luego se deshacen, así que el
-- fixture queda intacto y el orden de los escenarios no importa.
--
-- Convención: `SET LOCAL ROLE authenticated` (RLS solo aplica a roles sin
-- BYPASSRLS) + el "sub" del JWT decide quién es quien pregunta.

\set ON_ERROR_STOP on
\set QUIET on

\set emp   '''11111111-1111-1111-1111-111111111111'''
\set owner '''a0000000-0000-0000-0000-000000000001'''
\set admin '''a0000000-0000-0000-0000-000000000002'''
\set gpaq  '''a0000000-0000-0000-0000-000000000003'''
\set gcorr '''a0000000-0000-0000-0000-000000000004'''
\set super '''a0000000-0000-0000-0000-000000000005'''
\set ajeno '''a0000000-0000-0000-0000-000000000006'''
\set pieza_paq  '''c0000000-0000-0000-0000-000000000001'''
\set pieza_corr '''c0000000-0000-0000-0000-000000000002'''

\echo '── Precondiciones: si esto no se cumple, el resto no prueba lo que dice ──'
BEGIN;
DO $$
DECLARE v_companies int; v_roles text[];
BEGIN
  -- Los cuatro protagonistas comparten empresa: ninguna prueba puede pasar por
  -- aislamiento de tenant.
  SELECT count(DISTINCT company_id) INTO v_companies FROM public.app_users
   WHERE id IN ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
                'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004');
  PERFORM public.assert_eq(v_companies, 1, 'los cuatro usuarios son de la MISMA empresa');

  SELECT array_agg(role ORDER BY id) INTO v_roles FROM public.app_users
   WHERE id IN ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
                'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004');
  PERFORM public.assert_true(v_roles = ARRAY['company_owner','admin','operator','operator'],
    'los roles son los esperados (owner, admin y dos operadores granulares)');
END $$;
ROLLBACK;

\echo ''
\echo '── Permisos efectivos (lo que el helper realmente responde) ──'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  PERFORM public.assert_true(public.user_has_permission('condominios.tab.paqueteria'),
    'el operador de paquetería SÍ tiene su permiso');
  PERFORM public.assert_true(NOT public.user_has_permission('condominios.tab.correspondencia'),
    'el operador de paquetería NO tiene el de correspondencia');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
DO $$ BEGIN
  PERFORM public.assert_true(public.user_has_permission('condominios.tab.correspondencia'),
    'el operador de correspondencia SÍ tiene su permiso');
  PERFORM public.assert_true(NOT public.user_has_permission('condominios.tab.paqueteria'),
    'el operador de correspondencia NO tiene el de paquetería');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  -- ESTE es el hallazgo que obligó a rediseñar el DELETE: para un admin el
  -- helper dice true a CUALQUIER clave, así que un gate de permiso colocado
  -- detrás de un filtro de rol admin no filtra nada.
  PERFORM public.assert_true(public.user_has_permission('condominios.tab.correspondencia'),
    'un admin obtiene true del helper aunque nadie le concedió correspondencia');
  PERFORM public.assert_true(public.user_has_permission('permiso.que.no.existe'),
    'un admin obtiene true incluso para una clave inexistente');
END $$;
ROLLBACK;

\echo ''
\echo '── SELECT: cada clase solo para quien tiene su permiso ──'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE v_corr bigint; v_paq bigint;
BEGIN
  SELECT count(*) INTO v_corr FROM public.paquetes_recibidos WHERE clase = 'correspondencia';
  SELECT count(*) INTO v_paq  FROM public.paquetes_recibidos WHERE clase = 'paquete';
  PERFORM public.assert_eq(v_corr, 0, 'operador de paquetería NO ve correspondencia');
  PERFORM public.assert_eq(v_paq,  1, 'operador de paquetería SÍ ve paquetería (control positivo)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
DO $$
DECLARE v_corr bigint; v_paq bigint;
BEGIN
  SELECT count(*) INTO v_corr FROM public.paquetes_recibidos WHERE clase = 'correspondencia';
  SELECT count(*) INTO v_paq  FROM public.paquetes_recibidos WHERE clase = 'paquete';
  PERFORM public.assert_eq(v_paq,  0, 'operador de correspondencia NO ve paquetería');
  PERFORM public.assert_eq(v_corr, 1, 'operador de correspondencia SÍ ve correspondencia (control positivo)');
END $$;
ROLLBACK;

\echo ''
\echo '── INSERT: no se puede crear en la clase ajena ──'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.paquetes_recibidos (company_id, project_id, clase, destinatario_tipo, tipo, descripcion)
    VALUES ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333',
            'correspondencia','administracion','carta','intento');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_ok := true;
  END;
  PERFORM public.assert_true(v_ok, 'operador de paquetería NO puede crear correspondencia');
END $$;
ROLLBACK;

\echo ''
\echo '── UPDATE: reclasificar exige AMBOS permisos (las dos direcciones) ──'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE v_n bigint; v_ok boolean := true;
BEGIN
  BEGIN
    WITH u AS (
      UPDATE public.paquetes_recibidos SET clase = 'correspondencia'
       WHERE id = 'c0000000-0000-0000-0000-000000000001' RETURNING 1
    ) SELECT count(*) INTO v_n FROM u;
    v_ok := (v_n = 0);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_ok := true;
  END;
  PERFORM public.assert_true(v_ok, 'paquetería→correspondencia rechazado sin el permiso de destino');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000004';
DO $$
DECLARE v_n bigint; v_ok boolean := true;
BEGIN
  BEGIN
    WITH u AS (
      UPDATE public.paquetes_recibidos SET clase = 'paquete'
       WHERE id = 'c0000000-0000-0000-0000-000000000002' RETURNING 1
    ) SELECT count(*) INTO v_n FROM u;
    v_ok := (v_n = 0);
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN v_ok := true;
  END;
  PERFORM public.assert_true(v_ok, 'correspondencia→paquetería rechazado sin el permiso de destino');
END $$;
ROLLBACK;

\echo ''
\echo '── DELETE: quién puede destruir cada clase ──'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
DO $$
DECLARE v_n bigint;
BEGIN
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000001' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  PERFORM public.assert_eq(v_n, 1, 'admin SÍ borra paquetería (control positivo, sin cambios)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000002';
DO $$
DECLARE v_n bigint;
BEGIN
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000002' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  -- El caso central: un admin de la MISMA empresa, con el helper diciéndole
  -- true a todo, no puede destruir una notificación legal.
  PERFORM public.assert_eq(v_n, 0, 'admin NO borra correspondencia');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
DECLARE v_n bigint;
BEGIN
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000002' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  PERFORM public.assert_eq(v_n, 1, 'company_owner SÍ borra correspondencia (control positivo)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000001';
DO $$
DECLARE v_n bigint;
BEGIN
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000001' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  PERFORM public.assert_eq(v_n, 1, 'company_owner SÍ borra paquetería (control positivo)');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000003';
DO $$
DECLARE v_n bigint;
BEGIN
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000001' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  PERFORM public.assert_eq(v_n, 0, 'el operador granular no borra ni su propia clase (borrar es de rol)');
END $$;
ROLLBACK;

\echo ''
\echo '── Tenant: la empresa ajena no toca nada ──'
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000006';
DO $$
DECLARE v_n bigint; v_ve bigint;
BEGIN
  SELECT count(*) INTO v_ve FROM public.paquetes_recibidos;
  PERFORM public.assert_eq(v_ve, 0, 'admin de otra empresa no ve NADA');
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000001' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  PERFORM public.assert_eq(v_n, 0, 'admin de otra empresa no borra nada');
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000005';
DO $$
DECLARE v_n bigint;
BEGIN
  WITH d AS (DELETE FROM public.paquetes_recibidos
              WHERE id = 'c0000000-0000-0000-0000-000000000002' RETURNING 1)
  SELECT count(*) INTO v_n FROM d;
  PERFORM public.assert_eq(v_n, 1, 'super_admin sí puede (soporte conserva su llave)');
END $$;
ROLLBACK;

\echo ''
\echo '✅ Sandbox RLS: todos los escenarios pasaron.'
