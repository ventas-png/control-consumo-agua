\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes del selector «Asignar Operador» de Rutas (20260906000400).
--
--    1-5   usuario_acceso_a_proyecto: el espejo de can_access_project para una
--          cuenta cualquiera (exento, legacy project_id, asignación, ninguna)
--    6-11  el catálogo: a quién lista y a quién no (otro proyecto, inactivo,
--          residente, otra empresa) y cómo nombra a quien no tiene nombre
--   12-15  a quién le contesta: permiso de rutas, empresa, alcance del
--          llamador, proyecto inexistente
--   16-18  la ACL: anon no ejecuta el catálogo; el helper no lo ejecuta nadie
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  P1     uuid := '11111111-0000-0000-0000-000000000001';
  P2     uuid := '11111111-0000-0000-0000-000000000002';
  OWNER  uuid := 'e0000000-0000-0000-0000-00000000000f';
  ADM_L  uuid := 'e0000000-0000-0000-0000-00000000000d';  -- admin sin asignaciones
  ADM_A  uuid := 'e0000000-0000-0000-0000-00000000000e';  -- admin acotado a P2
  DINA   uuid := 'e0000000-0000-0000-0000-000000000001';  -- asignada a P1
  MARCO  uuid := 'e0000000-0000-0000-0000-000000000002';  -- project_id legacy P1, INACTIVO
  SARA   uuid := 'e0000000-0000-0000-0000-000000000003';  -- sin acceso a nada
  RITA   uuid := 'e0000000-0000-0000-0000-000000000004';  -- residente
  BLANCO uuid := 'e0000000-0000-0000-0000-000000000005';  -- asignado a P1, sin full_name
  AJENO  uuid := 'e0000000-0000-0000-0000-000000000009';  -- otra empresa
  b      boolean;
  t      text;
  n      bigint;
BEGIN
  -- ── 1-5 · El acceso de UNA cuenta cualquiera ─────────────────────────────
  -- La regla es la de can_access_project, pero evaluada sobre la cuenta que se
  -- va a ofrecer y no sobre quien pregunta: es lo único que distingue "puedo
  -- ver este proyecto" de "esta persona podría trabajar en él".
  SELECT public.usuario_acceso_a_proyecto(OWNER, P1) INTO b;
  IF b IS NOT true THEN RAISE EXCEPTION '1: company_owner debería ver todo proyecto de su empresa'; END IF;
  RAISE NOTICE 'OK 1  el rol exento de empresa ve el proyecto';

  SELECT public.usuario_acceso_a_proyecto(ADM_L, P1) INTO b;
  IF b IS NOT true THEN RAISE EXCEPTION '2: admin SIN asignaciones es exento y debería tener acceso'; END IF;
  SELECT public.usuario_acceso_a_proyecto(ADM_A, P1) INTO b;
  IF b IS NOT false THEN RAISE EXCEPTION '3: admin acotado a P2 no debería tener acceso a P1'; END IF;
  RAISE NOTICE 'OK 2  admin sin asignaciones es exento';
  RAISE NOTICE 'OK 3  admin CON asignaciones deja de serlo y no ve el proyecto ajeno';

  SELECT public.usuario_acceso_a_proyecto(MARCO, P1) INTO b;
  IF b IS NOT true THEN RAISE EXCEPTION '4: la columna legacy app_users.project_id no se vio'; END IF;
  SELECT public.usuario_acceso_a_proyecto(DINA, P1) INTO b;
  IF b IS NOT true THEN RAISE EXCEPTION '4: la asignación explícita a P1 no se vio'; END IF;
  RAISE NOTICE 'OK 4  el acceso llega por project_id legacy y por asignación explícita';

  -- Una cuenta inexistente NO puede devolver NULL: la función es boolean y su
  -- resultado se usa en un WHERE, donde NULL escondería o colaría filas según
  -- el lado del OR en que caiga.
  SELECT public.usuario_acceso_a_proyecto(SARA, P1) INTO b;
  IF b IS NOT false THEN RAISE EXCEPTION '5: una cuenta sin acceso figura con acceso'; END IF;
  SELECT public.usuario_acceso_a_proyecto('00000000-0000-0000-0000-000000000000', P1) INTO b;
  IF b IS NOT false THEN RAISE EXCEPTION '5: una cuenta inexistente devolvió % en vez de false', b; END IF;
  RAISE NOTICE 'OK 5  sin acceso (o sin cuenta) es false, nunca NULL';

  -- ── 6-11 · A quién lista el catálogo ─────────────────────────────────────
  PERFORM set_config('app.uid', OWNER::text, false);

  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id = DINA;
  IF n <> 1 THEN RAISE EXCEPTION '6: el operador asignado al proyecto no aparece (n=%)', n; END IF;
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id IN (OWNER, ADM_L);
  IF n <> 2 THEN RAISE EXCEPTION '6: los roles exentos no aparecen (n=%)', n; END IF;
  RAISE NOTICE 'OK 6  lista a quien tiene acceso al proyecto (asignado y exentos)';

  -- El caso que motivó la migración: el personal de OTRO condominio de la misma
  -- empresa. Asignarle la ruta le dejaría ver la ruta (rutas_select lo permite
  -- por ser el asignado) pero no los contadores que debe leer.
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id = ADM_A;
  IF n <> 0 THEN RAISE EXCEPTION '7: lista al admin acotado a OTRO proyecto'; END IF;
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id = SARA;
  IF n <> 0 THEN RAISE EXCEPTION '7: lista una cuenta sin acceso al proyecto'; END IF;
  RAISE NOTICE 'OK 7  NO lista a quien no tiene acceso a ESTE proyecto';

  -- Inactivo: programarle trabajo a quien ya no entra al sistema.
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id = MARCO;
  IF n <> 0 THEN RAISE EXCEPTION '8: lista una cuenta dada de baja (activo=false)'; END IF;
  RAISE NOTICE 'OK 8  NO lista cuentas inactivas, aunque tengan acceso';

  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id = RITA;
  IF n <> 0 THEN RAISE EXCEPTION '9: lista una cuenta de residente'; END IF;
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1) WHERE id = AJENO;
  IF n <> 0 THEN RAISE EXCEPTION '9: lista una cuenta de otra empresa'; END IF;
  RAISE NOTICE 'OK 9  NO lista residentes ni cuentas de otra empresa';

  -- Cada proyecto decide solo: ADM_A no sale en P1 pero sí en P2.
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P2) WHERE id = ADM_A;
  IF n <> 1 THEN RAISE EXCEPTION '10: el admin asignado a P2 no aparece en el catálogo de P2 (n=%)', n; END IF;
  RAISE NOTICE 'OK 10 el catálogo de cada proyecto se calcula por separado';

  -- Sin nombre no puede salir una opción en blanco: el correo la identifica.
  SELECT full_name INTO t FROM public.rutas_operadores_asignables(P1) WHERE id = BLANCO;
  IF t IS DISTINCT FROM 'blanco' THEN
    RAISE EXCEPTION '11: la cuenta sin full_name no cayó al correo (nombre=%)', t; END IF;
  RAISE NOTICE 'OK 11 una cuenta sin nombre se muestra por su correo, no en blanco';

  -- ── 12-15 · A quién le contesta ──────────────────────────────────────────
  -- El operador con el permiso de rutas Y acceso al proyecto sí obtiene lista.
  PERFORM set_config('app.uid', DINA::text, false);
  SELECT count(*) INTO n FROM public.rutas_operadores_asignables(P1);
  IF n = 0 THEN RAISE EXCEPTION '12: el operador con agua.rutas.view no obtuvo catálogo'; END IF;
  RAISE NOTICE 'OK 12 un operador con agua.rutas.view y acceso obtiene el catálogo';

  -- Mismo usuario, proyecto al que NO tiene acceso: enumeraría al personal de
  -- otro condominio con solo cambiar el uuid del argumento.
  BEGIN
    PERFORM count(*) FROM public.rutas_operadores_asignables(P2);
    RAISE EXCEPTION '13: enumeró los operadores de un proyecto fuera de su alcance';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 13 el llamador no enumera proyectos fuera de su alcance';
  END;

  PERFORM set_config('app.uid', SARA::text, false);
  BEGIN
    PERFORM count(*) FROM public.rutas_operadores_asignables(P1);
    RAISE EXCEPTION '14: una cuenta SIN agua.rutas.view obtuvo el catálogo';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 14 sin agua.rutas.view el catálogo no se entrega';
  END;

  PERFORM set_config('app.uid', AJENO::text, false);
  BEGIN
    PERFORM count(*) FROM public.rutas_operadores_asignables(P1);
    RAISE EXCEPTION '15: otra empresa enumeró los operadores de este proyecto';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 15 un proyecto de otra empresa no se puede enumerar';
  END;

  PERFORM set_config('app.uid', OWNER::text, false);
  BEGIN
    PERFORM count(*) FROM public.rutas_operadores_asignables('00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION '16: un proyecto inexistente devolvió catálogo';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'OK 16 un proyecto inexistente no devuelve nada, falla';
  END;

  PERFORM set_config('app.uid', '', false);
END $$;

-- ── 17-18 · ACL: la clase #378/#380 no vuelve por esta puerta ──────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.rutas_operadores_asignables(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '17: anon puede ejecutar rutas_operadores_asignables'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.rutas_operadores_asignables(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '17: authenticated no puede ejecutar el catálogo que el editor llama'; END IF;
  RAISE NOTICE 'OK 17 solo authenticated ejecuta el catálogo de operadores';

  -- El helper es un oráculo de "¿a qué proyectos entra fulano?": lo llaman los
  -- catálogos (SECURITY DEFINER, se ejecutan como su dueño), nadie por la API.
  IF has_function_privilege('anon', 'public.usuario_acceso_a_proyecto(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.usuario_acceso_a_proyecto(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '18: el helper de acceso es invocable desde la API'; END IF;
  RAISE NOTICE 'OK 18 el helper de acceso no lo invoca nadie vía API';
END $$;

-- ── 19 · El catálogo del tab Personal sigue en pie tras el refactor ────────
-- 20260906000400 reemplaza personal_usuarios_asignables para que use el helper
-- en vez de su copia inline de la regla. Si el reemplazo se equivocara de
-- firma o de filtro, el tab Personal se rompería sin que este harness —que va
-- de rutas— se enterara. El detalle lo cubre supabase/tests/personal_usuario,
-- que aplica las tres migraciones; aquí basta el control de humo.
DO $$
DECLARE
  P1    uuid := '11111111-0000-0000-0000-000000000001';
  OWNER uuid := 'e0000000-0000-0000-0000-00000000000f';
  DINA  uuid := 'e0000000-0000-0000-0000-000000000001';
  SARA  uuid := 'e0000000-0000-0000-0000-000000000003';
  n     bigint;
BEGIN
  PERFORM set_config('app.uid', OWNER::text, false);
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = DINA;
  IF n <> 1 THEN RAISE EXCEPTION '19: el catálogo de Personal perdió a una cuenta con acceso'; END IF;
  SELECT count(*) INTO n FROM public.personal_usuarios_asignables(P1) WHERE usuario_id = SARA;
  IF n <> 0 THEN RAISE EXCEPTION '19: el catálogo de Personal volvió a listar cuentas sin acceso'; END IF;
  PERFORM set_config('app.uid', '', false);
  RAISE NOTICE 'OK 19 el catálogo del tab Personal conserva su filtro con el helper compartido';
END $$;
