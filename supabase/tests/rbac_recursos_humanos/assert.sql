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
  -- Sólo la PRIMERA tanda (20260907001200). El total de la sección lo vigila D1,
  -- que es de la segunda: si A1 contara el total, cada tanda nueva lo rompería
  -- y se acabaría relajando el assert en vez de leerlo.
  SELECT count(*) INTO n
  FROM public.permissions
  WHERE category = 'recursos_humanos'
    AND (
         split_part(key, '.', 3) IN ('personal', 'capacitacion_personal',
                                     'tareas_cond', 'prog_limpieza', 'actividad_equipo')
    );

  IF n <> 30 THEN
    RAISE EXCEPTION 'A1: se esperaban 30 claves de la primera tanda (5 tabs × base + 5 acciones), hay %', n;
  END IF;
  RAISE NOTICE 'A1  OK  30 claves exactas de la primera tanda en recursos_humanos';
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

  -- El vecino que comparte prefijo con `tareas_cond` es `tareas_personal`, pero
  -- la segunda tanda lo muda legítimamente, así que ese control vive ahora en
  -- entre_tandas.sql, que mira el estado intermedio — la única ventana donde el
  -- arrastre de la PRIMERA sería visible. Aquí quedan los que se quedan en
  -- Seguridad para siempre.
  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.bitacora_guardia';
  IF cat <> 'seguridad' THEN
    RAISE EXCEPTION 'A4: bitacora_guardia se movió a % — la reclasificación arrastró de más', cat;
  END IF;

  RAISE NOTICE 'A4  OK  los vecinos (documentos, inventario, bitacora_guardia) no se movieron';
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

-- ── D · SEGUNDA TANDA: la jornada que venía de Seguridad (20260907001400) ───

DO $$
DECLARE n int;
BEGIN
  -- 9 tabs × (base + 5 acciones) = 54, más las 30 de la primera tanda = 84.
  SELECT count(*) INTO n FROM public.permissions WHERE category = 'recursos_humanos';
  IF n <> 84 THEN
    RAISE EXCEPTION 'D1: se esperaban 84 claves en recursos_humanos (30 + 54 de la jornada), hay %', n;
  END IF;
  RAISE NOTICE 'D1  OK  84 claves: la sección absorbió la jornada completa';
END $$;

DO $$
DECLARE falta text;
BEGIN
  FOREACH falta IN ARRAY ARRAY[
    'condominios.tab.turnos',
    'condominios.tab.plantillas_cargo',
    'condominios.tab.ausencias',
    'condominios.tab.horas_extra',
    'condominios.tab.presencia',
    'condominios.tab.panel_turno',
    'condominios.tab.tareas_personal',
    'condominios.tab.rutas_ronda',
    'condominios.tab.desempeno_personal'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.permissions
      WHERE key = falta AND category = 'recursos_humanos'
    ) THEN
      RAISE EXCEPTION 'D2: % no llegó a recursos_humanos (o dejó de existir)', falta;
    END IF;
  END LOOP;
  RAISE NOTICE 'D2  OK  los nueve tabs de la jornada están en la sección, con su nombre intacto';
END $$;

DO $$
DECLARE cat text;
BEGIN
  -- Control negativo de la segunda tanda: lo que se queda en Seguridad.
  -- `revision_tareas` es la contraparte de `tareas_personal`; que NO se haya
  -- mudado es deliberado, y si algún día se muda, este assert lo dirá.
  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.revision_tareas';
  IF cat <> 'seguridad' THEN
    RAISE EXCEPTION 'D3: revision_tareas se movió a % — no estaba en la petición', cat;
  END IF;

  SELECT category INTO cat FROM public.permissions WHERE key = 'condominios.tab.bitacora_guardia';
  IF cat <> 'seguridad' THEN
    RAISE EXCEPTION 'D3: bitacora_guardia se movió a % — la reclasificación arrastró de más', cat;
  END IF;
  RAISE NOTICE 'D3  OK  revision_tareas y bitacora_guardia siguen en Seguridad';
END $$;

DO $$
DECLARE n int;
BEGIN
  -- Lo que esta migración NO debe hacer: tocar autorización. El rol de
  -- seguridad con jornada a cargo conserva sus seis grants, con sus effects.
  SELECT count(*) INTO n FROM public.role_permissions
  WHERE role_id = '00000000-0000-0000-0000-0000000000a6';
  IF n <> 6 THEN
    RAISE EXCEPTION 'D4: el rol de seguridad tenía 6 grants y ahora tiene % — la mudanza tocó autorización', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = '00000000-0000-0000-0000-0000000000a6'
      AND permission_key = 'condominios.tab.turnos' AND effect = 'allow'
  ) THEN
    RAISE EXCEPTION 'D4: el rol de seguridad perdió turnos al mudarse de sección';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_id = '00000000-0000-0000-0000-0000000000a6'
      AND permission_key = 'condominios.tab.revision_tareas' AND effect = 'deny'
  ) THEN
    RAISE EXCEPTION 'D4: el deny de revision_tareas se convirtió en allow';
  END IF;
  RAISE NOTICE 'D4  OK  el rol de seguridad conserva sus grants y sus deny';
END $$;
