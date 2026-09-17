-- ════════════════════════════════════════════════════════════════════════════
-- Los triggers SIGUEN DISPARANDO después de la revocación.
--
-- Postgres verifica el EXECUTE sobre la función de trigger en el CREATE
-- TRIGGER, no en cada disparo: el trigger corre con los privilegios con los que
-- se creó. Ya estaba demostrado en 20260612192952, 20260729000700 y
-- security_definer_anon §4/4; aquí se vuelve a demostrar con las TRES de este
-- PR y con el rol que acaba de perder EXECUTE sobre ellas — `authenticated`,
-- que es quien escribe estas tablas por la Data API.
--
-- Se comprueba antes que el rol de verdad NO puede invocarlas sueltas: si
-- pudiera, el trigger «vivo» no probaría nada.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

DO $$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'fill_company_id_from_user()', 'fn_set_recipient_company_id()', 'set_updated_at()'
  ] LOOP
    PERFORM public.chk(
      has_function_privilege('authenticated', to_regprocedure('public.' || v_fn), 'EXECUTE')::int,
      0, format('authenticated NO tiene EXECUTE sobre %s antes de disparar el trigger', v_fn));
  END LOOP;
END $$;

-- ── fill_company_id_from_user, sobre sus dos tablas ─────────────────────────
DO $$
DECLARE v_company uuid;
BEGIN
  -- El usuario de la sesión, para que auth.uid() resuelva a algo.
  INSERT INTO public.app_users (id, company_id)
  VALUES ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444')
  ON CONFLICT (id) DO NOTHING;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  INSERT INTO public.fuentes_agua (id) VALUES (1);
  INSERT INTO public.registros_calidad (id) VALUES (1);
  RESET ROLE;

  SELECT company_id INTO v_company FROM public.fuentes_agua WHERE id = 1;
  IF v_company IS DISTINCT FROM '44444444-4444-4444-4444-444444444444' THEN
    RAISE EXCEPTION '❌ el trigger de fuentes_agua NO rellenó company_id (%)', v_company;
  END IF;
  SELECT company_id INTO v_company FROM public.registros_calidad WHERE id = 1;
  IF v_company IS DISTINCT FROM '44444444-4444-4444-4444-444444444444' THEN
    RAISE EXCEPTION '❌ el trigger de registros_calidad NO rellenó company_id (%)', v_company;
  END IF;
  RAISE NOTICE 'OK    fill_company_id_from_user sigue disparando en fuentes_agua y registros_calidad';
END $$;

-- ── fn_set_recipient_company_id ─────────────────────────────────────────────
DO $$
DECLARE v_company uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  INSERT INTO public.broadcast_recipients (id, broadcast_id) VALUES (1, 1);
  RESET ROLE;

  SELECT company_id INTO v_company FROM public.broadcast_recipients WHERE id = 1;
  IF v_company IS DISTINCT FROM '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION '❌ el trigger de broadcast_recipients NO heredó company_id (%)', v_company;
  END IF;
  RAISE NOTICE 'OK    fn_set_recipient_company_id sigue disparando en broadcast_recipients';
END $$;

-- ── set_updated_at, sobre sus dos tablas ────────────────────────────────────
DO $$
DECLARE v_antes timestamptz; v_despues timestamptz;
BEGIN
  INSERT INTO public.conversation_access_rules (company_id, role, can_view_all, can_respond, can_assign)
  VALUES ('55555555-5555-5555-5555-555555555555', 'admin', true, true, true)
  ON CONFLICT (company_id, role) DO NOTHING;

  SELECT updated_at INTO v_antes FROM public.conversations WHERE id = 1;
  SET LOCAL ROLE authenticated;
  UPDATE public.conversations SET id = 1 WHERE id = 1;
  UPDATE public.conversation_access_rules SET can_assign = false
   WHERE company_id = '55555555-5555-5555-5555-555555555555';
  RESET ROLE;

  SELECT updated_at INTO v_despues FROM public.conversations WHERE id = 1;
  IF v_despues <= v_antes THEN
    RAISE EXCEPTION '❌ el trigger de conversations NO selló updated_at (% → %)', v_antes, v_despues;
  END IF;
  SELECT updated_at INTO v_despues FROM public.conversation_access_rules
   WHERE company_id = '55555555-5555-5555-5555-555555555555';
  IF v_despues <= '2020-01-01T00:00:00Z'::timestamptz THEN
    RAISE EXCEPTION '❌ el trigger de conversation_access_rules NO selló updated_at (%)', v_despues;
  END IF;
  RAISE NOTICE 'OK    set_updated_at sigue disparando en conversations y conversation_access_rules';
END $$;
