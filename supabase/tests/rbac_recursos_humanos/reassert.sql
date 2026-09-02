-- ════════════════════════════════════════════════════════════════════════════
-- Idempotencia: tras re-aplicar 20260907001200 el estado tiene que ser el
-- MISMO. Lo que se vigila no es que "no truene": es que la segunda corrida no
-- duplique grants ni ensanche la categoría.
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.permissions WHERE category = 'recursos_humanos';
  IF n <> 84 THEN
    RAISE EXCEPTION 'R1: tras re-aplicar hay % claves en recursos_humanos, no 84', n;
  END IF;
  RAISE NOTICE 'R1  OK  la categoría sigue teniendo 84 claves';
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a1'
    AND (permission_key = 'condominios.tab.actividad_equipo'
      OR permission_key LIKE 'condominios.tab.actividad\_equipo.%');
  IF n <> 6 THEN
    RAISE EXCEPTION 'R2: la re-aplicación dejó % grants de actividad_equipo en el rol completo, no 6', n;
  END IF;
  RAISE NOTICE 'R2  OK  la herencia no se duplicó';
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a4';
  IF n <> 5 THEN
    RAISE EXCEPTION 'R3: la re-aplicación cambió los grants de operaciones (% en vez de 5)', n;
  END IF;
  RAISE NOTICE 'R3  OK  operaciones sigue intacto';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- El deny no se volvió allow en la segunda pasada (un ON CONFLICT DO UPDATE
  -- mal puesto lo haría).
  SELECT count(*) INTO n FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a3'
    AND permission_key LIKE 'condominios.tab.actividad\_equipo%'
    AND effect = 'deny';
  IF n <> 2 THEN
    RAISE EXCEPTION 'R4: tras re-aplicar quedan % deny heredados, no 2', n;
  END IF;
  RAISE NOTICE 'R4  OK  los deny siguen siendo deny';
END $$;

DO $$
DECLARE sobra int;
BEGIN
  -- La temporal de la migración no puede sobrevivir: si quedara, la segunda
  -- corrida en la misma sesión fallaría al recrearla.
  SELECT count(*) INTO sobra
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname IN ('_rrhh_claves', '_rrhh_jornada') AND n.nspname LIKE 'pg_temp%';
  IF sobra <> 0 THEN
    RAISE EXCEPTION 'R5: una tabla temporal de las migraciones sobrevivió';
  END IF;
  RAISE NOTICE 'R5  OK  la temporal se limpia sola';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- La segunda tanda tampoco toca autorización al re-aplicarse.
  SELECT count(*) INTO n FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a6';
  IF n <> 6 THEN
    RAISE EXCEPTION 'R6: la re-aplicación cambió los grants del rol de seguridad (% en vez de 6)', n;
  END IF;
  RAISE NOTICE 'R6  OK  el rol de seguridad sigue intacto';
END $$;
