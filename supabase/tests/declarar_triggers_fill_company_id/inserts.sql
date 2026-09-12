-- ════════════════════════════════════════════════════════════════════════════
-- Inserciones REALES y TRANSACCIONALES como `authenticated`.
--
-- El rol NO tiene EXECUTE sobre fill_company_id_from_user() (lo comprueba
-- primero: si lo tuviera, el trigger «vivo» no probaría nada). Inserta en las
-- dos tablas sin company_id y exige que la fila salga con el company_id del
-- usuario de la sesión. Postgres verifica el EXECUTE de la función de trigger
-- en el CREATE TRIGGER, no en cada disparo: por eso funciona.
--
-- Todo dentro de una transacción que se REVIERTE: la base queda como estaba,
-- y la última aserción lo comprueba.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_fn      oid := to_regprocedure('public.fill_company_id_from_user()')::oid;
  v_company uuid;
  v_fuente  uuid;
BEGIN
  PERFORM public.chk(has_function_privilege('authenticated', v_fn, 'EXECUTE'), false,
    'authenticated NO tiene EXECUTE sobre fill_company_id_from_user() antes de insertar');

  PERFORM set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.fuentes_agua (identificador, nombre, tipo_agua)
  VALUES ('F-1', 'Pozo 1', 'pozo')
  RETURNING id, company_id INTO v_fuente, v_company;
  PERFORM public.chk_txt(v_company::text, '44444444-4444-4444-4444-444444444444',
    'authenticated inserta en fuentes_agua sin company_id y el trigger lo rellena');

  INSERT INTO public.registros_calidad (fuente_id, parametros)
  VALUES (v_fuente, '{"ph": 7.1}'::jsonb)
  RETURNING company_id INTO v_company;
  PERFORM public.chk_txt(v_company::text, '44444444-4444-4444-4444-444444444444',
    'authenticated inserta en registros_calidad sin company_id y el trigger lo rellena');

  -- Un company_id EXPLÍCITO se respeta (el trigger sólo rellena el NULL)…
  -- y como no es el del usuario, el WITH CHECK lo rechaza: el trigger no abre
  -- la puerta a escribir en otro tenant.
  BEGIN
    INSERT INTO public.fuentes_agua (identificador, nombre, tipo_agua, company_id)
    VALUES ('F-2', 'Pozo ajeno', 'pozo', '99999999-9999-9999-9999-999999999999');
    RAISE EXCEPTION '❌ un company_id ajeno explícito NO debía pasar el WITH CHECK';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK    un company_id ajeno explícito sigue rechazado por RLS: el trigger sólo rellena el NULL';
  END;

  RESET ROLE;
END $$;

ROLLBACK;

SELECT public.chk(
  (SELECT count(*) FROM public.fuentes_agua) + (SELECT count(*) FROM public.registros_calidad),
  0, 'la transacción se revirtió: las dos tablas quedan vacías');
