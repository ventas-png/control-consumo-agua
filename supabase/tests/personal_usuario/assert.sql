\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes del vínculo empleado ↔ usuario de ingreso (20260826000000).
--
--    1-3   la columna: opcional, FK a app_users, ON DELETE SET NULL
--    4-7   una cuenta, un expediente POR CONDOMINIO (y varios NULL conviven)
--    8-9   el vínculo no cruza empresas
--   10-20  el catálogo: a quién lista (empresa, acceso al proyecto), qué
--          reporta y a quién le contesta
--   21-24  la ACL: anon no ejecuta nada; el trigger no es invocable
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  CO_A  uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  P2    uuid := '11111111-0000-0000-0000-000000000002';
  OWNER uuid := 'e0000000-0000-0000-0000-00000000000f';
  ADM_L uuid := 'e0000000-0000-0000-0000-00000000000d';  -- admin sin asignaciones
  ADM_A uuid := 'e0000000-0000-0000-0000-00000000000e';  -- admin acotado a P2
  DINA  uuid := 'e0000000-0000-0000-0000-000000000001';
  MARCO uuid := 'e0000000-0000-0000-0000-000000000002';
  SARA  uuid := 'e0000000-0000-0000-0000-000000000003';
  RITA  uuid := 'e0000000-0000-0000-0000-000000000004';
  AJENO uuid := 'e0000000-0000-0000-0000-000000000009';
  EMP1  uuid := '9e000000-0000-0000-0000-000000000001';
  EMP2  uuid := '9e000000-0000-0000-0000-000000000002';
  EMP_T2 uuid := '9e000000-0000-0000-0000-000000000003';
  v      uuid;
  t      text;
  b      boolean;
  n      bigint;
  nuevo  uuid;
BEGIN
  -- ── 1-3 · La columna ─────────────────────────────────────────────────────
  SELECT is_nullable INTO t
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'personal_condominio'
     AND column_name = 'user_id';
  IF t IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '1: personal_condominio.user_id no existe o no es opcional (is_nullable=%)', t; END IF;
  RAISE NOTICE 'OK 1  user_id existe y es opcional (la mayoría del personal no tiene cuenta)';

  SELECT confdeltype INTO t
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.conrelid = 'public.personal_condominio'::regclass
     AND c.contype = 'f' AND a.attname = 'user_id';
  IF t IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION '2: la FK de user_id no es ON DELETE SET NULL (confdeltype=%)', t; END IF;
  RAISE NOTICE 'OK 2  la FK apunta a app_users con ON DELETE SET NULL';

  UPDATE public.personal_condominio SET user_id = DINA WHERE id = EMP1;
  SELECT user_id INTO v FROM public.personal_condominio WHERE id = EMP1;
  IF v IS DISTINCT FROM DINA THEN
    RAISE EXCEPTION '3: no se pudo vincular (user_id=%)', v; END IF;
  RAISE NOTICE 'OK 3  vincular una cuenta de la misma empresa funciona';

  -- ── 4-7 · Una cuenta, un expediente por condominio ───────────────────────
  BEGIN
    UPDATE public.personal_condominio SET user_id = DINA WHERE id = EMP2;
    RAISE EXCEPTION '4: dos empleados del MISMO proyecto comparten la cuenta';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK 4  el índice único rechaza la cuenta ya tomada en el proyecto';
  END;

  -- La misma persona puede tener ficha en dos condominios de la empresa: es el
  -- caso del supervisor que cubre dos torres, y por eso el único es por
  -- proyecto y no por empresa.
  UPDATE public.personal_condominio SET user_id = DINA WHERE id = EMP_T2;
  SELECT count(*) INTO n FROM public.personal_condominio WHERE user_id = DINA;
  IF n <> 2 THEN
    RAISE EXCEPTION '5: la cuenta no pudo tener ficha en dos condominios (n=%)', n; END IF;
  RAISE NOTICE 'OK 5  la misma cuenta sí puede tener expediente en OTRO condominio';

  -- Varios sin cuenta conviven: es el estado normal del personal operativo.
  INSERT INTO public.personal_condominio (company_id, project_id, nombre)
    VALUES (CO_A, P1, 'Sin cuenta 1'), (CO_A, P1, 'Sin cuenta 2');
  SELECT count(*) INTO n FROM public.personal_condominio WHERE project_id = P1 AND user_id IS NULL;
  IF n < 3 THEN
    RAISE EXCEPTION '6: los empleados sin cuenta chocaron entre sí (n=%)', n; END IF;
  RAISE NOTICE 'OK 6  varios empleados sin cuenta conviven en el mismo proyecto';

  -- Dar de baja la cuenta NO borra el expediente laboral.
  UPDATE public.personal_condominio SET user_id = MARCO WHERE id = EMP2;
  DELETE FROM public.app_users WHERE id = MARCO;
  SELECT user_id INTO v FROM public.personal_condominio WHERE id = EMP2;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '7: al borrar la cuenta el vínculo quedó colgado (user_id=%)', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.personal_condominio WHERE id = EMP2) THEN
    RAISE EXCEPTION '7: borrar la cuenta se llevó el expediente del empleado'; END IF;
  RAISE NOTICE 'OK 7  borrar la cuenta deja el expediente vivo y sin vínculo';

  -- ── 8-9 · El vínculo no cruza empresas ───────────────────────────────────
  BEGIN
    UPDATE public.personal_condominio SET user_id = AJENO WHERE id = EMP2;
    RAISE EXCEPTION '8: se vinculó una cuenta de OTRA empresa';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK 8  el trigger rechaza una cuenta de otra empresa en UPDATE';
  END;

  BEGIN
    INSERT INTO public.personal_condominio (company_id, project_id, nombre, user_id)
      VALUES (CO_A, P1, 'Alta cruzada', AJENO);
    RAISE EXCEPTION '9: se dio de alta un empleado con cuenta de OTRA empresa';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK 9  el trigger rechaza una cuenta de otra empresa en INSERT';
  END;

  -- ── 10-18 · El catálogo de cuentas asignables ────────────────────────────
  PERFORM set_config('app.uid', OWNER::text, false);

  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = RITA;
  IF n <> 0 THEN
    RAISE EXCEPTION '10: el catálogo lista cuentas de residente'; END IF;
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = AJENO;
  IF n <> 0 THEN
    RAISE EXCEPTION '10: el catálogo lista cuentas de otra empresa'; END IF;
  RAISE NOTICE 'OK 10 el catálogo excluye residentes y cuentas de otra empresa';

  SELECT personal_id, personal_nombre INTO v, t
    FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = DINA;
  IF v IS DISTINCT FROM EMP1 THEN
    RAISE EXCEPTION '11: la cuenta tomada no reporta su empleado (personal_id=%)', v; END IF;
  IF t IS DISTINCT FROM 'Dina Lucrecia Villatoro' THEN
    RAISE EXCEPTION '11: la cuenta tomada no reporta el nombre del empleado (%)', t; END IF;
  RAISE NOTICE 'OK 11 la cuenta tomada dice a qué empleado de ESTE proyecto pertenece';

  -- Tomada en P1 no es tomada en P2: el selector de cada condominio decide solo.
  -- Se mira ADM_A —asignado a P2— y no una cuenta sin acceso: desde
  -- 20260904000000 una cuenta ajena al proyecto no sale en su catálogo, y
  -- "libre" se confundiría con "ausente".
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P2) WHERE usuario_id = ADM_A;
  IF n <> 1 THEN
    RAISE EXCEPTION '12: la cuenta asignada a P2 no aparece en el catálogo de P2 (n=%)', n; END IF;
  SELECT personal_id INTO v FROM public.personal_usuarios_asignables(P2) WHERE usuario_id = ADM_A;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '12: una cuenta libre aparece como tomada (personal_id=%)', v; END IF;
  RAISE NOTICE 'OK 12 una cuenta sin expediente en el proyecto aparece libre';

  SELECT email INTO t FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = DINA;
  IF t IS DISTINCT FROM 'dina@empresa-a.com' THEN
    RAISE EXCEPTION '13: el catálogo no trae el correo de ingreso (%)', t; END IF;
  RAISE NOTICE 'OK 13 el catálogo trae el correo con el que la persona entra';

  -- El acceso al proyecto se evalúa para la cuenta LISTADA, no para el llamador.
  SELECT tiene_acceso_proyecto INTO b FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = OWNER;
  IF b IS NOT true THEN RAISE EXCEPTION '14: company_owner debería ver todo el proyecto'; END IF;
  SELECT tiene_acceso_proyecto INTO b FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = ADM_L;
  IF b IS NOT true THEN RAISE EXCEPTION '14: admin sin asignaciones es exento y debería tener acceso'; END IF;
  SELECT tiene_acceso_proyecto INTO b FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = DINA;
  IF b IS NOT true THEN RAISE EXCEPTION '14: la asignación explícita a P1 no se vio'; END IF;
  RAISE NOTICE 'OK 14 tiene_acceso_proyecto espeja can_access_project para CADA cuenta';

  -- ── 15-16 · El catálogo se acota al proyecto (20260904000000) ────────────
  -- Lo que el selector no debe ofrecer: la cuenta de la empresa que NO ve este
  -- condominio. Ofrecerla invita a sellar el expediente de un empleado con la
  -- cuenta de alguien de otro proyecto —el aviso explicaba, pero no impedía
  -- guardar— y de paso exhibe la plantilla entera de la empresa a quien
  -- administra un solo condominio.
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = SARA;
  IF n <> 0 THEN
    RAISE EXCEPTION '15: el catálogo lista una cuenta sin acceso al proyecto'; END IF;
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = ADM_A;
  IF n <> 0 THEN
    RAISE EXCEPTION '15: el catálogo lista al admin acotado a OTRO proyecto'; END IF;
  RAISE NOTICE 'OK 15 el catálogo no lista cuentas sin acceso a ESTE condominio';

  -- La excepción: la cuenta que ya está vinculada a un empleado de aquí sigue
  -- listada aunque hoy no tenga acceso. Con ella el tab nombra al vinculado en
  -- la tarjeta y explica el «ya es Fulano»; sin ella, el empleado se vería
  -- suelto y su cuenta se ofrecería a otro.
  UPDATE public.personal_condominio SET user_id = SARA WHERE id = EMP2;
  SELECT tiene_acceso_proyecto, personal_id INTO b, v
    FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = SARA;
  IF v IS DISTINCT FROM EMP2 THEN
    RAISE EXCEPTION '16: la cuenta ya vinculada aquí desapareció del catálogo (personal_id=%)', v; END IF;
  IF b IS NOT false THEN
    RAISE EXCEPTION '16: la cuenta vinculada sin acceso no reporta la falta de acceso'; END IF;
  RAISE NOTICE 'OK 16 la cuenta ya vinculada en el proyecto se lista aunque no tenga acceso';

  -- El operador con el permiso del tab puede abrir el selector; sin él, no.
  PERFORM set_config('app.uid', DINA::text, false);
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1);
  IF n = 0 THEN RAISE EXCEPTION '17: el operador con permiso no obtuvo catálogo'; END IF;
  RAISE NOTICE 'OK 17 un operador con condominios.tab.personal obtiene el catálogo';

  PERFORM set_config('app.uid', SARA::text, false);
  BEGIN
    PERFORM count(*) FROM public.personal_usuarios_asignables(P1);
    RAISE EXCEPTION '18: una cuenta SIN el permiso del tab obtuvo el catálogo';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 18 sin condominios.tab.personal el catálogo no se entrega';
  END;

  PERFORM set_config('app.uid', AJENO::text, false);
  BEGIN
    PERFORM count(*) FROM public.personal_usuarios_asignables(P1);
    RAISE EXCEPTION '19: otra empresa enumeró las cuentas de este proyecto';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 19 un proyecto de otra empresa no se puede enumerar';
  END;

  PERFORM set_config('app.uid', OWNER::text, false);
  BEGIN
    PERFORM count(*) FROM public.personal_usuarios_asignables('00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION '20: un proyecto inexistente devolvió catálogo';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 20 un proyecto inexistente no devuelve nada, falla';
  END;

  -- Deja la sesión limpia para lo que siga.
  PERFORM set_config('app.uid', '', false);
END $$;

-- ── 21-23 · ACL: la clase #378/#380 no vuelve por esta puerta ───────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.personal_usuarios_asignables(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '21: anon puede ejecutar personal_usuarios_asignables'; END IF;
  RAISE NOTICE 'OK 21 anon NO puede ejecutar el catálogo';

  IF NOT has_function_privilege('authenticated', 'public.personal_usuarios_asignables(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '22: authenticated no puede ejecutar el catálogo que el tab llama'; END IF;
  RAISE NOTICE 'OK 22 authenticated SÍ puede ejecutarlo (es quien lo llama)';

  IF has_function_privilege('anon', 'public.personal_validar_usuario()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.personal_validar_usuario()', 'EXECUTE') THEN
    RAISE EXCEPTION '23: la función trigger es invocable directamente'; END IF;
  RAISE NOTICE 'OK 23 la función trigger no es invocable por nadie vía API';
END $$;

-- ── 24 · El trigger sigue disparando pese a no tener EXECUTE ───────────────
-- Postgres verifica el EXECUTE en CREATE TRIGGER, no en cada disparo. Sin esta
-- comprobación, el REVOKE de arriba podría estar rompiendo la escritura entera
-- de la tabla y el resto del assert (que corre como superusuario) no lo vería.
CREATE ROLE app_sin_execute LOGIN;
GRANT USAGE ON SCHEMA public TO app_sin_execute;
GRANT SELECT, INSERT ON public.personal_condominio TO app_sin_execute;
GRANT SELECT ON public.app_users TO app_sin_execute;
SET ROLE app_sin_execute;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.personal_condominio (company_id, project_id, nombre, user_id)
      VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-000000000001',
              'Alta cruzada sin execute', 'e0000000-0000-0000-0000-000000000009');
    RAISE EXCEPTION '24: el trigger NO disparó para un rol sin EXECUTE';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'OK 24 el trigger dispara aunque el rol no tenga EXECUTE sobre él';
  END;
END $$;
RESET ROLE;
