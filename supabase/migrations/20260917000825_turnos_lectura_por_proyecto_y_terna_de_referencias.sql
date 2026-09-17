-- ════════════════════════════════════════════════════════════════════════════
-- Turnos · la LECTURA también es por proyecto, las referencias arrastran la
--          TERNA del inquilino, y re-apuntar la regla es re-planificar
-- ════════════════════════════════════════════════════════════════════════════
--
-- PRIMERO, UNA CORRECCIÓN. El encabezado de 20260916232549 afirma que «el
-- SELECT y el DELETE sí lo comprobaban [can_access_project]; el alta y el
-- cambio, no». Sobre el DELETE es cierto —20260916171325 se lo puso—. Sobre el
-- SELECT es FALSO: `bloques_turno_select` sigue siendo la de 20260907000100 y
-- sólo filtra por `company_id` + visibilidad del tab. Esa migración ya está
-- aplicada y no se edita (el histórico es append-only), así que la corrección
-- vive aquí, que es donde además se arregla.
--
-- El error de fondo es el mismo de las dos rondas anteriores: dar por hecho lo
-- que no se comprobó. La primera vez fue leer la UI y suponer la base; ésta fue
-- leer una policy hermana y suponer la vecina.
--
-- TRES AGUJEROS, LOS TRES DE ALCANCE.
--
-- 1 · LA LECTURA CRUZA EL CONDOMINIO. Con `condominios.tab.turnos` y el
--     `company_id` correcto se lee la agenda de TODOS los condominios de la
--     empresa. Y no sólo `bloques_turno`: `tareas_bloque_select` y
--     `revisiones_tarea_select` derivan su tenant con un EXISTS sobre el bloque
--     padre, y ese EXISTS pasa por la RLS de `bloques_turno` (20260907000100 lo
--     dice y por eso ensanchó el padre primero). Cerrar el padre cierra las
--     tres tablas de una vez; dejarlo abierto las dejaba abiertas las tres.
--
-- 2 · LA FILA PUEDE MENTIR SOBRE SU PROPIO INQUILINO. `personal_id` y
--     `asignacion_id` cuelgan con FKs SIMPLES: comprueban que la fila exista,
--     no de quién es. Un bloque con `project_id` del condominio A y
--     `personal_id` de un empleado del B es una fila que las policies aceptan
--     —su `project_id` es el correcto— y que corrompe todo lo que agrupe por
--     empleado: horas, nómina, cobertura. Es el mismo agujero que 20260913040300
--     cerró para `plantilla_horario_id` y 20260916171325 para `excepciones_turno`.
--
-- 3 · RE-APUNTAR LA REGLA ES RE-PLANIFICAR. El trigger de 20260916232549 mira
--     `plantilla_horario_id` pero NO `asignacion_id`. Cambiar de qué regla
--     cuelga un bloque ya trabajado reescribe por qué se planificó: X→Y tiene
--     que pasar por las seis condiciones. X→NULL no, porque eso es exactamente
--     lo que hace el ON DELETE SET NULL al borrar la regla.
--
-- SIN BORRAR NI REASIGNAR DATOS. La sección 2 comprueba las filas existentes
-- ANTES de tocar las FKs y ABORTA con los IDs exactos si encuentra una mezcla.
-- Arreglar a mano una fila mal atribuida es una decisión de negocio —¿de quién
-- era ese turno?— y una migración no puede tomarla.
--
-- IDEMPOTENTE: búsqueda por catálogo, `IF NOT EXISTS` y `CREATE OR REPLACE`.
-- FAIL-CLOSED: la sección 5 aborta si algo quedó a medias.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · Leer un bloque exige alcanzar su PROYECTO
-- ════════════════════════════════════════════════════════════════════════════
-- Los CINCO tabs que hoy dejan leer se conservan EXACTAMENTE: son los cinco
-- consumidores reales que 20260907000100 enumeró (Tareas por turno, Asignación
-- de turnos, Revisión de tareas, Desempeño y Programación de limpieza), y esta
-- migración no es el lugar para discutir cuáles. Lo único que se añade es
-- `can_access_project(project_id)`.
--
-- El bypass de `is_super_admin()` se mantiene explícito y por delante, igual
-- que en las otras tres policies de la tabla: soporte conserva su llave.
--
-- `can_access_project` no rompe a quien administra la empresa entera: es
-- `project_id IS NULL OR user_is_project_exempt() OR user_has_project_access()`,
-- y los roles con alcance de empresa son exentos. Lo que cierra es el caso del
-- usuario asignado a UNOS condominios que leía los de todos.
DROP POLICY IF EXISTS "bloques_turno_select" ON public.bloques_turno;
CREATE POLICY "bloques_turno_select" ON public.bloques_turno
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.can_access_project(project_id))
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')
             OR public.user_has_permission('condominios.tab.revision_tareas')
             OR public.user_has_permission('condominios.tab.desempeno_personal')
             OR public.user_has_permission('condominios.tab.prog_limpieza')))
  );

COMMENT ON POLICY "bloques_turno_select" ON public.bloques_turno IS
  'Leer la agenda exige empresa, PROYECTO y la visibilidad de alguno de los cinco tabs que la consumen. El proyecto entra en 20260917000825: hasta entonces se leía la agenda de todos los condominios de la empresa, y con ella —vía el EXISTS de sus policies— las tareas y revisiones de todos.';

-- Las policies permisivas se combinan con OR: una segunda que dejara leer sin
-- mirar el proyecto reabriría el agujero sin tocar ésta. Se cuentan las de
-- SELECT ('r') Y las de FOR ALL ('*'), porque una FOR ALL también deja leer y
-- es justo la forma que tenía la legada `company_rw_bloques_turno` —permisiva
-- por empresa, sin proyecto— que 20260820000000 vino a retirar. Contar sólo
-- 'r' la habría dado por ausente estando viva. Fail-closed.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
  FROM pg_policy
  WHERE polrelid = 'public.bloques_turno'::regclass
    AND polcmd IN ('r', '*')
    AND polpermissive;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno tiene % policies permisivas que dejan LEER (SELECT o FOR ALL); con OR entre ellas, el alcance por proyecto deja de valer', v_n;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Antes de cerrar la terna: ¿hay filas ya mezcladas?
-- ════════════════════════════════════════════════════════════════════════════
-- No se borra ni se reasigna nada. Si una fila dice que el turno del condominio
-- A lo cubre un empleado del B, sólo el negocio sabe cuál de los dos datos es
-- el bueno, y adivinar puede mover horas de una nómina a otra. Se aborta con
-- los IDs exactos para que se arreglen a mano y se vuelva a correr.
DO $$
DECLARE
  v_n     bigint;
  v_ids   text;
BEGIN
  SELECT count(*), string_agg(x.id::text, ', ' ORDER BY x.id)
    INTO v_n, v_ids
  FROM (
    SELECT b.id
    FROM public.bloques_turno b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.personal_condominio p
      WHERE p.id         = b.personal_id
        AND p.company_id = b.company_id
        AND p.project_id = b.project_id
    )
    LIMIT 50
  ) x;

  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: % bloque(s) de turno apuntan a personal de OTRO inquilino. '
      'No se reasignan automáticamente: revisarlos y decidir cuál dato es el bueno. '
      'IDs (hasta 50): %. Consulta completa: SELECT b.id, b.company_id, b.project_id, '
      'b.personal_id FROM public.bloques_turno b LEFT JOIN public.personal_condominio p '
      'ON p.id = b.personal_id AND p.company_id = b.company_id AND p.project_id = b.project_id '
      'WHERE p.id IS NULL;', v_n, v_ids;
  END IF;

  SELECT count(*), string_agg(x.id::text, ', ' ORDER BY x.id)
    INTO v_n, v_ids
  FROM (
    SELECT b.id
    FROM public.bloques_turno b
    WHERE b.asignacion_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.asignaciones_turno a
        WHERE a.id         = b.asignacion_id
          AND a.company_id = b.company_id
          AND a.project_id = b.project_id
      )
    LIMIT 50
  ) x;

  IF v_n > 0 THEN
    RAISE EXCEPTION
      'ABORTADO: % bloque(s) de turno cuelgan de una regla de OTRO inquilino. '
      'No se reasignan automáticamente. IDs (hasta 50): %. Consulta completa: '
      'SELECT b.id, b.company_id, b.project_id, b.asignacion_id FROM public.bloques_turno b '
      'LEFT JOIN public.asignaciones_turno a ON a.id = b.asignacion_id '
      'AND a.company_id = b.company_id AND a.project_id = b.project_id '
      'WHERE b.asignacion_id IS NOT NULL AND a.id IS NULL;', v_n, v_ids;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Las referencias arrastran (id, company_id, project_id)
-- ════════════════════════════════════════════════════════════════════════════
-- Las anclas UNIQUE contra las que apuntan ya existen: las creó 20260916171325
-- (`personal_condominio_id_tenant_uq`, `asignaciones_turno_id_tenant_uq`) para
-- las FKs de `excepciones_turno`. Aquí se reutilizan tal cual.
--
-- Las FKs simples se buscan POR CATÁLOGO y no por nombre: `bloques_turno` es
-- una de las tablas con drift declarado contra producción (#826) y allá sus
-- constraints pueden llamarse de otra forma. Mismo criterio que 20260913040300
-- usó para `plantilla_horario_id`.
DO $$
DECLARE
  v_simple text;
  v_attnum smallint;
BEGIN
  -- ── personal_id ─────────────────────────────────────────────────────────
  SELECT a.attnum INTO v_attnum FROM pg_attribute a
   WHERE a.attrelid = 'public.bloques_turno'::regclass AND a.attname = 'personal_id';

  FOR v_simple IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.contype   = 'f'
      AND c.conrelid  = 'public.bloques_turno'::regclass
      AND c.confrelid = 'public.personal_condominio'::regclass
      AND array_length(c.conkey, 1) = 1
      AND c.conkey[1] = v_attnum
  LOOP
    EXECUTE format('ALTER TABLE public.bloques_turno DROP CONSTRAINT %I', v_simple);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname  = 'bloques_turno_personal_fk'
                    AND conrelid = 'public.bloques_turno'::regclass) THEN
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_personal_fk
      FOREIGN KEY (personal_id, company_id, project_id)
      REFERENCES public.personal_condominio(id, company_id, project_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  -- ── asignacion_id ───────────────────────────────────────────────────────
  SELECT a.attnum INTO v_attnum FROM pg_attribute a
   WHERE a.attrelid = 'public.bloques_turno'::regclass AND a.attname = 'asignacion_id';

  FOR v_simple IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.contype   = 'f'
      AND c.conrelid  = 'public.bloques_turno'::regclass
      AND c.confrelid = 'public.asignaciones_turno'::regclass
      AND array_length(c.conkey, 1) = 1
      AND c.conkey[1] = v_attnum
  LOOP
    EXECUTE format('ALTER TABLE public.bloques_turno DROP CONSTRAINT %I', v_simple);
  END LOOP;

  -- ON DELETE SET NULL sólo sobre `asignacion_id`: borrar una regla DESVINCULA
  -- el histórico, no lo borra ni lo saca de su inquilino. Sin la lista de
  -- columnas, Postgres pondría NULL también en company_id y project_id, que son
  -- NOT NULL — el borrado de cualquier regla fallaría siempre.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname  = 'bloques_turno_asignacion_fk'
                    AND conrelid = 'public.bloques_turno'::regclass) THEN
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_asignacion_fk
      FOREIGN KEY (asignacion_id, company_id, project_id)
      REFERENCES public.asignaciones_turno(id, company_id, project_id)
      ON DELETE SET NULL (asignacion_id)
      NOT VALID;
  END IF;
END $$;

-- Fuera del DO: el lock fuerte del ADD se suelta antes del escaneo de VALIDATE.
ALTER TABLE public.bloques_turno VALIDATE CONSTRAINT bloques_turno_personal_fk;
ALTER TABLE public.bloques_turno VALIDATE CONSTRAINT bloques_turno_asignacion_fk;

COMMENT ON CONSTRAINT bloques_turno_personal_fk ON public.bloques_turno IS
  'Ancla el empleado del bloque a su TERNA: personal de otra empresa o de otro condominio no se puede nombrar aquí, ni con el company_id correcto en la fila. Sustituye a la FK simple, que comprobaba existencia pero no pertenencia. ON DELETE CASCADE se conserva: dar de baja a alguien se lleva sus turnos, y el trigger de borrado seguro sigue decidiendo cuáles.';
COMMENT ON CONSTRAINT bloques_turno_asignacion_fk ON public.bloques_turno IS
  'Ancla la regla del bloque a su TERNA. ON DELETE SET NULL sólo sobre asignacion_id: borrar una regla desvincula la historia y la deja con su empresa y su condominio intactos.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · `asignacion_id` también es planificación
-- ════════════════════════════════════════════════════════════════════════════
-- Idéntica a la de 20260916232549 salvo por la condición de `asignacion_id`,
-- con la misma forma que la de `plantilla_horario_id`: se mira el cambio a un
-- valor NO NULO. X→Y es re-planificar —el bloque pasa a justificarse por otra
-- regla— y pasa por las seis condiciones. X→NULL es desvincular, que es lo que
-- hace el ON DELETE SET NULL de la sección 3 al borrar la regla, y sigue libre.
-- Sin esa distinción, una regla con un solo día pasado sería imborrable.
CREATE OR REPLACE FUNCTION public.turnos_bloque_replanificable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- ¿Se está re-planificando, o sólo viviendo el turno?
  IF NOT (
       (NEW.plantilla_horario_id IS NOT NULL
        AND NEW.plantilla_horario_id IS DISTINCT FROM OLD.plantilla_horario_id)
    OR (NEW.asignacion_id IS NOT NULL
        AND NEW.asignacion_id IS DISTINCT FROM OLD.asignacion_id)
    OR NEW.fecha            IS DISTINCT FROM OLD.fecha
    OR NEW.personal_id      IS DISTINCT FROM OLD.personal_id
    OR NEW.turno            IS DISTINCT FROM OLD.turno
    OR NEW.hora_inicio      IS DISTINCT FROM OLD.hora_inicio
    OR NEW.hora_fin         IS DISTINCT FROM OLD.hora_fin
    OR NEW.cruza_medianoche IS DISTINCT FROM OLD.cruza_medianoche
    OR NEW.company_id       IS DISTINCT FROM OLD.company_id
    OR NEW.project_id       IS DISTINCT FROM OLD.project_id
  ) THEN
    RETURN NEW;
  END IF;

  -- El bloque tal como ESTABA tiene que ser tocable…
  PERFORM public.turnos_asegurar_bloque_libre(
    OLD.id, OLD.company_id, OLD.fecha, OLD.estado, OLD.iniciado_en, OLD.cerrado_en,
    'cambiar la jornada de');

  -- …y no se puede usar el cambio para mandarlo al pasado.
  IF NEW.fecha < (now() AT TIME ZONE public.presencia_zona_horaria(NEW.company_id))::date THEN
    RAISE EXCEPTION 'no se puede mover un bloque a una fecha pasada (%)', NEW.fecha
      USING ERRCODE = '23001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.turnos_bloque_replanificable() IS
  'Trigger BEFORE UPDATE de bloques_turno: si cambian las columnas de PLANIFICACIÓN (quién, qué día, con qué horario, bajo qué regla, de qué inquilino) exige las mismas seis condiciones que el borrado. El ciclo de vida —iniciar, cerrar, puntuar, anotar— no se mira. Desvincular la jornada o la regla (pasar a NULL, que es lo que hace ON DELETE SET NULL) tampoco. Sin bypass por rol.';

REVOKE EXECUTE ON FUNCTION public.turnos_bloque_replanificable() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Autoverificación fail-closed
-- ════════════════════════════════════════════════════════════════════════════
-- Si algo de lo de arriba no quedó como se esperaba, la migración NO se da por
-- aplicada. Un esquema a medias es peor que uno viejo: parece arreglado.
DO $$
DECLARE
  v_qual text;
  v_att  smallint;
  v_con  pg_constraint%ROWTYPE;
BEGIN
  -- ── 5.1 · la lectura mira el proyecto y conserva los cinco tabs ─────────
  SELECT pg_get_expr(polqual, polrelid) INTO v_qual
  FROM pg_policy
  WHERE polrelid = 'public.bloques_turno'::regclass AND polcmd IN ('r', '*');

  IF v_qual IS NULL OR v_qual NOT LIKE '%can_access_project%' THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_select no comprueba can_access_project';
  END IF;
  IF v_qual NOT LIKE '%is_super_admin%' THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_select perdió el bypass de super_admin';
  END IF;
  IF (SELECT count(*) FROM unnest(ARRAY[
        'condominios.tab.tareas_personal', 'condominios.tab.turnos',
        'condominios.tab.revision_tareas', 'condominios.tab.desempeno_personal',
        'condominios.tab.prog_limpieza']) t
      WHERE v_qual LIKE '%' || t || '%') <> 5 THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_select ya no nombra los cinco tabs de lectura: %', v_qual;
  END IF;

  -- ── 5.2 · no queda ninguna FK simple hacia las dos tablas ───────────────
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.contype  = 'f'
      AND c.conrelid = 'public.bloques_turno'::regclass
      AND c.confrelid IN ('public.personal_condominio'::regclass,
                          'public.asignaciones_turno'::regclass)
      AND array_length(c.conkey, 1) < 3
  ) THEN
    RAISE EXCEPTION 'ABORTADO: sobrevive una FK simple hacia personal_condominio o asignaciones_turno; la compuesta no sirve de nada si la simple sigue aceptando la fila';
  END IF;

  -- ── 5.3 · la de personal es compuesta y sigue en CASCADE ────────────────
  SELECT * INTO v_con FROM pg_constraint
   WHERE conname = 'bloques_turno_personal_fk'
     AND conrelid = 'public.bloques_turno'::regclass;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORTADO: falta bloques_turno_personal_fk';
  END IF;
  IF v_con.confrelid <> 'public.personal_condominio'::regclass
     OR array_length(v_con.conkey, 1) <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_personal_fk no es la terna contra personal_condominio';
  END IF;
  IF v_con.confdeltype <> 'c' THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_personal_fk perdió ON DELETE CASCADE (confdeltype=%)', v_con.confdeltype;
  END IF;
  IF NOT v_con.convalidated THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_personal_fk quedó sin validar';
  END IF;

  -- ── 5.4 · la de asignación es compuesta y pone NULL SÓLO en asignacion_id ─
  SELECT * INTO v_con FROM pg_constraint
   WHERE conname = 'bloques_turno_asignacion_fk'
     AND conrelid = 'public.bloques_turno'::regclass;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORTADO: falta bloques_turno_asignacion_fk';
  END IF;
  IF v_con.confrelid <> 'public.asignaciones_turno'::regclass
     OR array_length(v_con.conkey, 1) <> 3 THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_asignacion_fk no es la terna contra asignaciones_turno';
  END IF;
  IF v_con.confdeltype <> 'n' THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_asignacion_fk perdió ON DELETE SET NULL (confdeltype=%)', v_con.confdeltype;
  END IF;

  SELECT a.attnum INTO v_att FROM pg_attribute a
   WHERE a.attrelid = 'public.bloques_turno'::regclass AND a.attname = 'asignacion_id';
  -- Sin la lista de columnas `confdelsetcols` viene vacía y el SET NULL caería
  -- también sobre company_id y project_id, que son NOT NULL: borrar cualquier
  -- regla fallaría. Que sea EXACTAMENTE una columna, y que sea ésta.
  IF v_con.confdelsetcols IS NULL
     OR array_length(v_con.confdelsetcols::smallint[], 1) <> 1
     OR (v_con.confdelsetcols::smallint[])[1] <> v_att THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_asignacion_fk no limita el SET NULL a asignacion_id (confdelsetcols=%)', v_con.confdelsetcols;
  END IF;
  IF NOT v_con.convalidated THEN
    RAISE EXCEPTION 'ABORTADO: bloques_turno_asignacion_fk quedó sin validar';
  END IF;

  -- ── 5.5 · el trigger mira asignacion_id, y sólo hacia un valor no nulo ──
  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'turnos_bloque_replanificable')
     NOT LIKE '%NEW.asignacion_id IS NOT NULL%AND NEW.asignacion_id IS DISTINCT FROM OLD.asignacion_id%' THEN
    RAISE EXCEPTION 'ABORTADO: turnos_bloque_replanificable no somete asignacion_id a las invariantes';
  END IF;

  RAISE NOTICE '20260917000825 OK: lectura por proyecto, terna en las dos referencias y asignacion_id sujeta a re-planificación';
END $$;
