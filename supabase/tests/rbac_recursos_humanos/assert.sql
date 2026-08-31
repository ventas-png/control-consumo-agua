-- ════════════════════════════════════════════════════════════════════════════
-- Invariantes de 20260907001200 (sección Recursos Humanos en el catálogo RBAC).
--
-- Cada bloque ABORTA con RAISE EXCEPTION si su invariante no se cumple; el
-- run.sh trata cualquier ERROR como fallo y cualquier WARNING como "algo se
-- tragó un error".
-- ════════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

-- ── A · CATÁLOGO ────────────────────────────────────────────────────────────

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.permissions
  WHERE category = 'recursos_humanos';

  IF n <> 30 THEN
    RAISE EXCEPTION 'A1: se esperaban 30 claves en recursos_humanos (5 tabs × base + 5 acciones), hay %', n;
  END IF;
  RAISE NOTICE 'A1  OK  30 claves exactas en la categoría recursos_humanos';
END $$;

DO $$
DECLARE falta text;
BEGIN
  -- Las claves NO se renombran: media docena de policies gatean sobre estos
  -- nombres exactos. Que la categoría cambie no las puede tocar.
  FOREACH falta IN ARRAY ARRAY[
    'condominios.tab.personal',
    'condominios.tab.capacitacion_personal',
    'condominios.tab.tareas_cond',
    'condominios.tab.prog_limpieza',
    'condominios.tab.actividad_equipo'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE key = falta) THEN
      RAISE EXCEPTION 'A2: la clave % dejó de existir — las policies que la gatean quedaron sin efecto', falta;
    END IF;
  END LOOP;
  RAISE NOTICE 'A2  OK  las cinco claves base conservan su nombre (policies intactas)';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- actividad_equipo nace con sus seis claves: sin ellas el tab es invisible
  -- para todo el que no sea rol exento.
  SELECT count(*) INTO n
  FROM public.permissions
  WHERE key = 'condominios.tab.actividad_equipo'
     OR key LIKE 'condominios.tab.actividad\_equipo.%';

  IF n <> 6 THEN
    RAISE EXCEPTION 'A3: actividad_equipo debería tener 6 claves (base + 5 acciones), tiene %', n;
  END IF;
  RAISE NOTICE 'A3  OK  actividad_equipo estrena sus 6 claves';
END $$;

DO $$
DECLARE cat text;
BEGIN
  -- Control negativo: los vecinos que NO se mudan conservan su categoría. Un
  -- LIKE mal escrito (o el guion bajo como comodín) se vería aquí.
  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.documentos';
  IF cat <> 'administracion' THEN
    RAISE EXCEPTION 'A4: documentos se movió a % — la reclasificación arrastró de más', cat;
  END IF;

  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.inventario';
  IF cat <> 'operaciones' THEN
    RAISE EXCEPTION 'A4: inventario se movió a % — la reclasificación arrastró de más', cat;
  END IF;

  -- `tareas_personal` (Seguridad) comparte prefijo con `tareas_cond` sólo hasta
  -- "tareas", pero es el vecino que un patrón laxo se llevaría por delante.
  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.tareas_personal';
  IF cat <> 'seguridad' THEN
    RAISE EXCEPTION 'A4: tareas_personal se movió a % — la reclasificación arrastró de más', cat;
  END IF;

  RAISE NOTICE 'A4  OK  los vecinos (documentos, inventario, tareas_personal) no se movieron';
END $$;

-- ── B · HERENCIA DE GRANTS ──────────────────────────────────────────────────

DO $$
DECLARE n int;
BEGIN
  -- El rol con las seis de personal estrena las seis de actividad_equipo.
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a1'
    AND effect = 'allow'
    AND (permission_key = 'condominios.tab.actividad_equipo'
      OR permission_key LIKE 'condominios.tab.actividad\_equipo.%');

  IF n <> 6 THEN
    RAISE EXCEPTION 'B1: el rol con personal completo debería heredar 6 claves de actividad_equipo, heredó %', n;
  END IF;
  RAISE NOTICE 'B1  OK  personal completo → actividad_equipo completo';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- El rol que sólo VE el expediente estrena sólo la visibilidad: heredar las
  -- acciones sería regalar permisos que nadie otorgó.
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a2'
    AND (permission_key = 'condominios.tab.actividad_equipo'
      OR permission_key LIKE 'condominios.tab.actividad\_equipo.%');

  IF n <> 1 THEN
    RAISE EXCEPTION 'B2: el rol de sólo lectura debería heredar 1 clave, heredó % (herencia demasiado generosa)', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = '00000000-0000-0000-0000-0000000000a2'
      AND permission_key = 'condominios.tab.actividad_equipo' AND effect = 'allow'
  ) THEN
    RAISE EXCEPTION 'B2: el rol de sólo lectura no heredó la visibilidad';
  END IF;
  RAISE NOTICE 'B2  OK  sólo visibilidad → sólo visibilidad (no se regalan acciones)';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- El deny explícito VIAJA: quien tiene negado el expediente nace con la
  -- actividad negada. Copiar sólo los allow abriría un permiso por la puerta
  -- de atrás.
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a3'
    AND effect = 'deny'
    AND permission_key IN ('condominios.tab.actividad_equipo',
                           'condominios.tab.actividad_equipo.edit');

  IF n <> 2 THEN
    RAISE EXCEPTION 'B3: el deny de personal no viajó a actividad_equipo (esperaba 2 deny, hay %)', n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = '00000000-0000-0000-0000-0000000000a3'
      AND permission_key LIKE 'condominios.tab.actividad\_equipo%'
      AND effect = 'allow'
  ) THEN
    RAISE EXCEPTION 'B3: un deny se convirtió en allow al heredar';
  END IF;
  RAISE NOTICE 'B3  OK  el deny explícito viaja como deny';
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-000000000001'
    AND effect = 'allow'
    AND (permission_key = 'condominios.tab.actividad_equipo'
      OR permission_key LIKE 'condominios.tab.actividad\_equipo.%');

  IF n <> 6 THEN
    RAISE EXCEPTION 'B4: Administrador General debería tener las 6 de actividad_equipo, tiene %', n;
  END IF;
  RAISE NOTICE 'B4  OK  Administrador General cubre el tab nuevo';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- Quien no tenía nada de personal no gana nada. Una herencia escrita con un
  -- JOIN de más repartiría el tab a todo el mundo.
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a5'
    AND permission_key LIKE 'condominios.tab.actividad\_equipo%';

  IF n <> 0 THEN
    RAISE EXCEPTION 'B5: un rol sin personal heredó % clave(s) de actividad_equipo', n;
  END IF;
  RAISE NOTICE 'B5  OK  quien no administra personal no estrena nada';
END $$;

-- ── C · EL ACCESO NO SE MUEVE CON LA SECCIÓN ────────────────────────────────

DO $$
DECLARE n int;
BEGIN
  -- Lo que esta migración NO debe hacer: tocar role_permissions de los tabs que
  -- sólo cambian de categoría. El rol de operaciones conserva sus cinco grants.
  SELECT count(*) INTO n
  FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a4';

  IF n <> 5 THEN
    RAISE EXCEPTION 'C1: el rol de operaciones tenía 5 grants y ahora tiene % — la mudanza tocó autorización', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = '00000000-0000-0000-0000-0000000000a4'
      AND permission_key = 'condominios.tab.tareas_cond' AND effect = 'allow'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = '00000000-0000-0000-0000-0000000000a4'
      AND permission_key = 'condominios.tab.prog_limpieza' AND effect = 'allow'
  ) THEN
    RAISE EXCEPTION 'C1: operaciones perdió tareas_cond o prog_limpieza al mudarse de sección';
  END IF;
  RAISE NOTICE 'C1  OK  operaciones conserva tareas y limpieza (agrupar ≠ autorizar)';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- Ningún grant huérfano: la FK lo impediría, pero un ON CONFLICT mal puesto
  -- podría dejar filas a medias en otra forma del esquema.
  SELECT count(*) INTO n
  FROM public.role_permissions rp
  LEFT JOIN public.permissions p ON p.key = rp.permission_key
  WHERE p.key IS NULL;

  IF n <> 0 THEN
    RAISE EXCEPTION 'C2: % grant(s) apuntan a claves inexistentes', n;
  END IF;
  RAISE NOTICE 'C2  OK  ningún grant apunta al vacío';
END $$;
