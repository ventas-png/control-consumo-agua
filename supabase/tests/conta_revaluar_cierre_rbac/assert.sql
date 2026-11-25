\set ON_ERROR_STOP on
-- Invariantes de 20261220000000. Corre DOS veces: con `rbac.fase = antes` (control
-- negativo: el contador es rechazado) y con `rbac.fase = despues`.
-- Padrón: el de fail_open_sin_perfil (empresa D: OWN_D propietario, OPE_D operador,
-- VIS_D visor; OP_C operador de OTRA empresa). OPE_D lleva el rol plantilla
-- «Finanzas / Contador» (todas las platform.contabilidad.*); VIS_D no lleva rol.

CREATE OR REPLACE FUNCTION fos.estado_de(p_actor text, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text := 'ok';
BEGIN
  PERFORM fos.poner_actor(p_actor);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v := SQLSTATE;
  END;
  PERFORM fos.poner_actor('SISTEMA');
  RETURN v;
END $$;

DO $$
DECLARE
  fase   text := current_setting('rbac.fase');
  anio   int  := extract(year FROM CURRENT_DATE)::int - 1;
  reval  text := 'SELECT count(*) FROM public.conta_revaluar_fx(CURRENT_DATE, false, NULL)';
  cierre text := format('SELECT public.conta_cierre_anual(%s, NULL)', anio);
  s      text;
  n      int;
BEGIN
  -- Quien ya podía, sigue pudiendo pasar la guarda (el cierre falla DESPUÉS, por negocio: nunca 42501).
  s := fos.estado_de('OWN_D', reval);
  IF s = '42501' THEN RAISE EXCEPTION '[%] el propietario debe pasar la guarda de revaluar (dio %)', fase, s; END IF;
  s := fos.estado_de('OWN_D', cierre);
  IF s = '42501' THEN RAISE EXCEPTION '[%] el propietario debe pasar la guarda del cierre (dio %)', fase, s; END IF;
  RAISE NOTICE '✓ [%] el propietario pasa las dos guardas', fase;

  -- Quien no tiene el permiso, sigue fuera.
  FOREACH s IN ARRAY ARRAY['VIS_D'] LOOP
    IF fos.estado_de(s, reval) <> '42501' OR fos.estado_de(s, cierre) <> '42501' THEN
      RAISE EXCEPTION '[%] % no tiene permiso y debía recibir 42501', fase, s;
    END IF;
  END LOOP;
  RAISE NOTICE '✓ [%] un usuario de la empresa sin el permiso recibe «no autorizado»', fase;

  IF fase = 'antes' THEN
    IF fos.estado_de('OPE_D', reval) <> '42501' OR fos.estado_de('OPE_D', cierre) <> '42501' THEN
      RAISE EXCEPTION '[antes] control negativo: el contador debía estar rechazado antes de la migración';
    END IF;
    RAISE NOTICE '✓ [antes] CONTROL NEGATIVO: el contador con todas las claves recibe «no autorizado»';
  ELSE
    s := fos.estado_de('OPE_D', reval);
    IF s = '42501' THEN RAISE EXCEPTION '[despues] el contador (create) debe pasar la guarda de revaluar'; END IF;
    s := fos.estado_de('OPE_D', cierre);
    IF s = '42501' THEN RAISE EXCEPTION '[despues] el contador (change_status) debe pasar la guarda del cierre'; END IF;
    RAISE NOTICE '✓ [despues] el contador pasa las dos guardas (cierre: %)', s;

    -- Cada acción con SU clave: sin `create` no revalúa aunque conserve change_status, y al revés.
    INSERT INTO public.role_permissions (role_id, permission_key, effect)
      VALUES ('f0520000-0000-0000-0000-000000000001', 'platform.contabilidad.create', 'deny');
    IF fos.estado_de('OPE_D', reval) <> '42501' THEN RAISE EXCEPTION '[despues] sin «create» no debe revaluar'; END IF;
    IF fos.estado_de('OPE_D', cierre) = '42501' THEN RAISE EXCEPTION '[despues] sin «create» el cierre (change_status) sigue permitido'; END IF;
    UPDATE public.role_permissions SET permission_key = 'platform.contabilidad.change_status'
     WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
    IF fos.estado_de('OPE_D', cierre) <> '42501' THEN RAISE EXCEPTION '[despues] sin «change_status» no debe cerrar'; END IF;
    IF fos.estado_de('OPE_D', reval) = '42501' THEN RAISE EXCEPTION '[despues] sin «change_status» revaluar (create) sigue permitido'; END IF;
    DELETE FROM public.role_permissions WHERE role_id = 'f0520000-0000-0000-0000-000000000001';
    RAISE NOTICE '✓ [despues] cada RPC exige SU clave (create ≠ change_status)';

    -- La definición lleva la clave UNA vez (aplicar dos veces no anida el guard).
    SELECT count(*) INTO n FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('conta_revaluar_fx', 'conta_cierre_anual')
       AND (length(p.prosrc) - length(replace(p.prosrc, 'user_has_permission', ''))) / length('user_has_permission') = 1;
    IF n <> 2 THEN RAISE EXCEPTION '[despues] se esperaban 2 definiciones con la clave una sola vez; hay %', n; END IF;
    RAISE NOTICE '✓ [despues] idempotente: la clave aparece una sola vez por función';
  END IF;

  -- La ACL no cambió: anon sin EXECUTE, authenticated con EXECUTE.
  IF has_function_privilege('anon', 'public.conta_revaluar_fx(date,boolean,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.conta_cierre_anual(integer,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_revaluar_fx(date,boolean,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.conta_cierre_anual(integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[%] la ACL de las RPC cambió', fase;
  END IF;
  RAISE NOTICE '✓ [%] ACL intacta: anon sin EXECUTE, authenticated con EXECUTE', fase;
END $$;
