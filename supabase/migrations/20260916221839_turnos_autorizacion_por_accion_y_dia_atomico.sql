-- ════════════════════════════════════════════════════════════════════════════
-- Turnos · la autorización deja de apoyarse en la visibilidad, y editar un día
--          deja de ser dos escrituras que pueden quedar a medias
-- ════════════════════════════════════════════════════════════════════════════
--
-- DOS PROBLEMAS DISTINTOS, UNA MIGRACIÓN, PORQUE SE TOCAN LOS MISMOS OBJETOS.
--
-- 1 · `condominios.tab.turnos` NO ES UN PERMISO DE ESCRITURA. Por la convención
--     de 20260518000005 y 20260703000000, la clave de TRES segmentos
--     —`condominios.tab.<tab>`— es la VISIBILIDAD del tab («Ver»), y las de
--     CUATRO —`condominios.tab.<tab>.<accion>`— son las acciones. Las policies
--     y la RPC de 20260916171325 usaban la de tres para autorizar INSERT,
--     UPDATE, DELETE y la generación del mes: cualquiera que pudiera MIRAR el
--     calendario podía llenarle la agenda al personal o quitarle turnos.
--
--     La UI nunca lo permitió: `canActInCondominiosTab` (src/lib/permissions.ts)
--     exige visibilidad Y acción. La base era más laxa que el botón, que es la
--     forma cara de equivocarse: el botón se esconde y la API sigue abierta.
--
-- 2 · EDITAR UN DÍA ERAN DOS ESCRITURAS SUELTAS. Quitar un día = crear la
--     excepción + borrar el bloque; reasignarlo = escribir el bloque + retirar
--     la excepción. La UI las encadenaba y deshacía a mano la primera si fallaba
--     la segunda, pero ese «deshacer» es otra llamada de red que también puede
--     fallar, y entre medias la base queda contradiciéndose: un día quitado con
--     su turno vivo, o un turno vivo marcado como quitado. Ahora cada operación
--     es UNA función, y una función es UNA transacción.
--
-- LO QUE NO CAMBIA
--   · El trigger `trg_turnos_bloque_borrable` (20260916171325) sigue siendo la
--     autoridad de integridad y sigue corriendo para todos los roles. Las RPC de
--     abajo NO lo esquivan —un trigger dispara por su condición, no por quién
--     ejecuta— y dejan subir su mensaje tal cual, que es el que dice CUÁL de las
--     condiciones falló.
--   · La LECTURA se sigue autorizando con la clave de visibilidad. Ver el
--     calendario es justo lo que `condominios.tab.turnos` significa.
--
-- IDEMPOTENTE: CREATE OR REPLACE, DROP POLICY IF EXISTS antes de cada CREATE.
-- FAIL-CLOSED: la sección 6 aborta la migración si algo quedó a medias.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · El helper: la misma regla que `canActInCondominiosTab`, en la base
-- ════════════════════════════════════════════════════════════════════════════
-- Réplica exacta de src/lib/permissions.ts:60. Se copia la regla, no se inventa
-- otra, porque dos criterios distintos para la misma pregunta divergen y el día
-- que diverjan gana el más laxo, que es siempre el de la base.
--
--   1. Sin sesión → false.                         (user_has_permission lo hace)
--   2. super_admin / company_owner / admin → true. (user_has_permission lo hace)
--   3. Hace falta la VISIBILIDAD del tab.
--   4. Y encima, o la acción por tab, o el par legado de módulo completo
--      platform.condominios.view + platform.condominios.<accion>, que es lo que
--      sostiene a los roles creados antes de que existiera la granularidad.
--
-- SECURITY INVOKER a propósito: no necesita privilegios que el invocante no
-- tenga. Quien mira las tablas de RBAC es `user_has_permission`, que ya es
-- DEFINER y está concedida a authenticated.
CREATE OR REPLACE FUNCTION public.condominios_puede_actuar(p_tab text, p_accion text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.user_has_permission('condominios.tab.' || p_tab)
     AND (
       public.user_has_permission('condominios.tab.' || p_tab || '.' || p_accion)
       OR (public.user_has_permission('platform.condominios.view')
           AND public.user_has_permission('platform.condominios.' || p_accion))
     )
$$;

COMMENT ON FUNCTION public.condominios_puede_actuar(text, text) IS
  'Réplica en la base de canActInCondominiosTab (src/lib/permissions.ts): exige la clave de VISIBILIDAD del tab (3 segmentos) y además la de ACCIÓN (4 segmentos) o el par legado platform.condominios.view + .<accion>. Los roles exentos (super_admin, company_owner, admin) pasan porque user_has_permission ya los trata como omnipotentes. Usarla —y no la clave de 3 segmentos a secas— es lo que impide que ver un tab autorice a escribir en él.';

REVOKE EXECUTE ON FUNCTION public.condominios_puede_actuar(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.condominios_puede_actuar(text, text) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · excepciones_turno: leer con visibilidad, escribir con «editar» en Turnos
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT se queda como estaba: la excepción se pinta en el calendario y en la
-- bandeja de Tareas por turno, y para eso basta con poder ver el tab.
--
-- Las tres de escritura pasan a exigir `turnos.edit`. Quitar un día y
-- restaurarlo son ediciones del calendario, no consultas.
DROP POLICY IF EXISTS "excepciones_turno_insert" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_insert" ON public.excepciones_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.condominios_puede_actuar('turnos', 'edit'))
  );

DROP POLICY IF EXISTS "excepciones_turno_update" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_update" ON public.excepciones_turno
  FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.condominios_puede_actuar('turnos', 'edit'))
  )
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.condominios_puede_actuar('turnos', 'edit'))
  );

DROP POLICY IF EXISTS "excepciones_turno_delete" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_delete" ON public.excepciones_turno
  FOR DELETE TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.condominios_puede_actuar('turnos', 'edit'))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · bloques_turno: cada DML exige una acción, no la visibilidad
-- ════════════════════════════════════════════════════════════════════════════
-- SELECT no se toca (20260907000100): ver el bloque es lo que habilita a los
-- cinco tabs que lo muestran, y ésa sí es una pregunta de visibilidad.
--
-- Las de escritura venían aceptando la clave de 3 segmentos de tres tabs. Se
-- mantienen los MISMOS TRES TABS —romper a Limpieza o a Tareas por turno no es
-- el objetivo— pero cada uno con la acción que le corresponde:
--
--   · turnos.edit           — asignar, cambiar o quitar un día del calendario.
--                             Es edición del calendario aunque materialmente
--                             cree la fila: el día ya estaba previsto por la
--                             regla, se le está fijando la jornada.
--   · tareas_personal.create/edit — el alta y el ciclo (iniciar, cerrar) de un
--                             bloque desde la bandeja de Tareas por turno.
--   · prog_limpieza.create/edit  — la materialización de rutinas.
--
-- Y el DELETE, per la revisión: sólo `turnos.edit` (quitar un día) o
-- `tareas_personal.edit` (eliminar desde la bandeja). Sigue siendo UNA sola
-- policy permisiva; la aserción de la sección 6 lo comprueba, porque dos se
-- combinarían con OR y la más laxa mandaría.
DROP POLICY IF EXISTS "bloques_turno_insert" ON public.bloques_turno;
CREATE POLICY "bloques_turno_insert" ON public.bloques_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'create')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')
             OR public.condominios_puede_actuar('prog_limpieza', 'create')
             OR public.condominios_puede_actuar('prog_limpieza', 'edit')))
  );

DROP POLICY IF EXISTS "bloques_turno_update" ON public.bloques_turno;
CREATE POLICY "bloques_turno_update" ON public.bloques_turno
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')
             OR public.condominios_puede_actuar('prog_limpieza', 'edit')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')
             OR public.condominios_puede_actuar('prog_limpieza', 'edit')))
  );

DROP POLICY IF EXISTS "bloques_turno_delete" ON public.bloques_turno;
CREATE POLICY "bloques_turno_delete" ON public.bloques_turno
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.can_access_project(project_id))
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')))
  );

COMMENT ON POLICY "bloques_turno_delete" ON public.bloques_turno IS
  'AUTORIZACIÓN del borrado: empresa, proyecto y permiso de EDITAR en Turnos o en Tareas por turno — nunca la clave de visibilidad a secas. La INTEGRIDAD —futuro, pendiente, sin iniciar, sin cerrar, sin tareas, revisiones ni marcajes— la impone trg_turnos_bloque_borrable, que corre para todos los roles, incluido service_role.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · generar_bloques_turno: generar el mes es «crear» en Turnos
-- ════════════════════════════════════════════════════════════════════════════
-- Se recrea COMPLETA y verbatim respecto de 20260916171325 salvo el guard de
-- permiso. Recrearla entera y no parchearla es lo que mantiene una sola
-- definición legible: la última migración que la nombra dice qué hace hoy.
-- Conserva lenguaje, volatilidad, SECURITY DEFINER, search_path, argumentos,
-- retorno y grants.
CREATE OR REPLACE FUNCTION public.generar_bloques_turno(
  p_project_id uuid,
  p_desde      date DEFAULT NULL,
  p_hasta      date DEFAULT NULL
)
RETURNS TABLE (
  generados             int,
  omitidos_ausencia     int,
  omitidos_no_laborable int,
  omitidos_existente    int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_desde   date := COALESCE(p_desde, CURRENT_DATE);
  v_hasta   date;
BEGIN
  v_hasta := COALESCE(p_hasta, v_desde + 60);

  IF v_hasta < v_desde THEN
    RAISE EXCEPTION 'el rango termina antes de empezar' USING ERRCODE = '22007';
  END IF;

  -- Techo duro: una regla diaria sobre 20 empleados a 5 años son 36.500 filas en
  -- una sola llamada. El tab genera de mes en mes o de año en año.
  IF v_hasta - v_desde > 400 THEN
    RAISE EXCEPTION 'el rango no puede exceder 400 días' USING ERRCODE = '22003';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  -- Guard de scope (20260729000200): super_admin, la propia empresa, o
  -- service_role. Todo lo demás sale con 42501.
  PERFORM public.assert_company_scope(v_company);

  -- Y además el permiso de ACCIÓN del tab. `condominios.tab.turnos` a secas es
  -- visibilidad: dice que ves el calendario, no que puedas llenarle la agenda a
  -- veinte personas por un año. Generar es «crear» en Turnos, con el mismo
  -- criterio —y el mismo fallback legado— que `canActInCondominiosTab` aplica
  -- en la UI, para que el botón y la base no discrepen.
  IF NOT public.condominios_puede_actuar('turnos', 'create') THEN
    RAISE EXCEPTION 'no autorizado: se necesita permiso de crear en Asignación de turnos'
      USING ERRCODE = '42501';
  END IF;

  WITH candidatos AS (
    SELECT
      a.id            AS asignacion_id,
      a.company_id,
      a.project_id,
      a.personal_id,
      a.plantilla_horario_id,
      a.cubre_dias_no_laborables,
      ph.turno,
      ph.hora_inicio,
      ph.hora_fin,
      ph.cruza_medianoche,
      d::date         AS fecha
    FROM public.asignaciones_turno a
    JOIN public.plantillas_horario   ph ON ph.id = a.plantilla_horario_id
    JOIN public.personal_condominio  pc ON pc.id = a.personal_id
    -- Cast explícito a timestamp: con `date` los dos overloads de
    -- generate_series (timestamp / timestamptz) compiten y la resolución
    -- depende del planner.
    CROSS JOIN LATERAL generate_series(
      GREATEST(v_desde, a.fecha_inicio)::timestamp,
      LEAST(v_hasta, COALESCE(a.fecha_fin, v_hasta))::timestamp,
      INTERVAL '1 day'
    ) AS d
    WHERE a.project_id = p_project_id
      AND a.company_id = v_company
      AND a.activa
      AND ph.activo
      -- Un empleado dado de baja no recibe turnos nuevos. 'vacaciones' e
      -- 'incapacidad' NO se filtran aquí: los cubre el chequeo de ausencia por
      -- fecha, que es el que sabe cuándo vuelve.
      AND pc.estado <> 'inactivo'
      AND public.turnos_regla_aplica(
            a.frecuencia, a.fecha_inicio, a.dias_semana, a.intervalo_dias,
            a.dia_mes, a.mes_ancla, a.fechas_especificas, d::date, a.dias_mes)
      -- El día que un administrador quitó a mano no vuelve. Sin esto, «quitar el
      -- turno del jueves» dura hasta la siguiente generación. Es un NOT EXISTS
      -- sobre una clave única (personal_id, fecha), así que re-generar N veces
      -- da exactamente el mismo resultado que generar una.
      AND NOT EXISTS (
        SELECT 1 FROM public.excepciones_turno ex
        WHERE ex.personal_id = a.personal_id
          AND ex.fecha       = d::date
      )
  ),
  clasificados AS (
    SELECT
      c.*,
      EXISTS (
        SELECT 1 FROM public.ausencias_personal au
        WHERE au.personal_id = c.personal_id
          AND au.estado = 'aprobada'
          AND c.fecha BETWEEN au.fecha_inicio AND au.fecha_fin
      ) AS hay_ausencia,
      EXISTS (
        SELECT 1 FROM public.dias_no_laborables dnl
        WHERE dnl.project_id = c.project_id
          AND dnl.fecha = c.fecha
      ) AS hay_no_laborable,
      -- Ya existe = esta misma regla ya lo generó, O alguien puso a mano un
      -- bloque de ese turno ese día. Lo segundo es lo que impide que generar
      -- pise una decisión humana.
      EXISTS (
        SELECT 1 FROM public.bloques_turno b
        WHERE b.personal_id = c.personal_id
          AND b.fecha = c.fecha
          AND (b.asignacion_id = c.asignacion_id OR b.turno = c.turno)
      ) AS ya_existe
    FROM candidatos c
  ),
  insertados AS (
    INSERT INTO public.bloques_turno (
      company_id, project_id, personal_id, asignacion_id, plantilla_horario_id,
      turno, fecha, hora_inicio, hora_fin, cruza_medianoche, origen, estado
    )
    SELECT
      company_id, project_id, personal_id, asignacion_id, plantilla_horario_id,
      turno, fecha, hora_inicio, hora_fin, cruza_medianoche, 'recurrencia', 'pendiente'
    FROM clasificados
    WHERE NOT hay_ausencia
      AND NOT ya_existe
      AND (cubre_dias_no_laborables OR NOT hay_no_laborable)
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM insertados)::int,
    (SELECT count(*) FROM clasificados WHERE hay_ausencia)::int,
    (SELECT count(*) FROM clasificados
      WHERE hay_no_laborable AND NOT cubre_dias_no_laborables AND NOT hay_ausencia)::int,
    (SELECT count(*) FROM clasificados WHERE ya_existe AND NOT hay_ausencia)::int
  INTO generados, omitidos_ausencia, omitidos_no_laborable, omitidos_existente;

  RETURN NEXT;
END;
$$;
COMMENT ON FUNCTION public.generar_bloques_turno(uuid, date, date) IS
  'Materializa las reglas activas de un proyecto en bloques_turno para el rango dado (por defecto, 60 días desde hoy). Exige permiso de CREAR en Asignación de turnos (condominios_puede_actuar), no sólo ver el tab. Se salta ausencias aprobadas, días no laborables, excepciones_turno y lo ya existente. Nunca borra ni sobrescribe. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Un día del calendario, en una sola transacción
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ NO BASTA CON ENCADENAR DOS LLAMADAS DESDE LA UI. Quitar un día son
-- dos escrituras —crear la excepción, borrar el bloque— y el orden importa: al
-- revés, el siguiente «Generar» resucita el día. Pero encadenarlas desde el
-- navegador deja una ventana en la que la base se contradice, y el «deshacer»
-- de la primera cuando falla la segunda es otra petición de red que también
-- puede perderse. Una función plpgsql es una transacción: o las dos, o ninguna,
-- sin ventana y sin compensación manual.
--
-- GUARD COMPARTIDO. Las tres son SECURITY DEFINER —tienen que poder leer
-- `projects` y `personal_condominio` para validar el inquilino aunque la RLS
-- del invocante recorte— así que cada una comprueba explícitamente, en este
-- orden: el proyecto existe, es de la empresa del invocante (assert_company_scope),
-- el invocante alcanza ese proyecto (can_access_project) y tiene `turnos.edit`.
-- Sin eso, un SECURITY DEFINER con p_project_id es exactamente el agujero que
-- migrations-guard busca.
--
-- EL TRIGGER SIGUE MANDANDO. Ninguna borra bloques_turno «por dentro»: el
-- DELETE dispara `trg_turnos_bloque_borrable` igual que desde PostgREST, y su
-- excepción sube sin capturar para que el cliente reciba el mensaje exacto —el
-- que dice si el turno ya arrancó, ya se cerró, o tiene checklist.

-- ── 5a · El resto del guard, una sola vez ──────────────────────────────────
-- La resolución de la empresa y `assert_company_scope` NO viven aquí: van en el
-- cuerpo de cada RPC. Podrían delegarse —el efecto sería idéntico— pero entonces
-- `scripts/migrations-guard.mjs` dejaría de verlas, y ese guard existe justo
-- para cazar SECURITY DEFINER con `p_project_id` y sin comprobación de empresa.
-- Enseñarle a mirar hacia otro lado con una allowlist es peor que repetir dos
-- líneas: la próxima RPC que de verdad olvide el scope pasaría igual de
-- inadvertida.
CREATE OR REPLACE FUNCTION public.turnos_asegurar_edicion_dia(
  p_company_id  uuid,
  p_project_id  uuid,
  p_personal_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- El proyecto, además de la empresa: una empresa puede tener varios
  -- condominios y el acceso se concede por proyecto.
  IF NOT (public.is_super_admin() OR public.can_access_project(p_project_id)) THEN
    RAISE EXCEPTION 'no autorizado: el proyecto no está asignado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.condominios_puede_actuar('turnos', 'edit') THEN
    RAISE EXCEPTION 'no autorizado: se necesita permiso de editar en Asignación de turnos'
      USING ERRCODE = '42501';
  END IF;

  -- El empleado tiene que ser de ESE proyecto de ESA empresa. Conocer un UUID
  -- ajeno no puede alcanzar para escribirle la agenda a nadie.
  IF NOT EXISTS (
    SELECT 1 FROM public.personal_condominio pc
    WHERE pc.id = p_personal_id
      AND pc.company_id = p_company_id
      AND pc.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'el empleado no pertenece a este condominio' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.turnos_asegurar_edicion_dia(uuid, uuid, uuid) IS
  'Segunda mitad del guard de las RPC de edición de un día: el invocante alcanza el proyecto, tiene permiso de EDITAR en Turnos, y el empleado pertenece a ese condominio. La primera mitad —resolver la empresa y assert_company_scope— va en el cuerpo de cada RPC, para que migrations-guard la vea. Lanza 42501.';

REVOKE EXECUTE ON FUNCTION public.turnos_asegurar_edicion_dia(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.turnos_asegurar_edicion_dia(uuid, uuid, uuid) TO service_role;

-- ── 5b · Asignar o cambiar la jornada de un día ────────────────────────────
-- Escribe el bloque Y retira la excepción que hubiera. Las dos o ninguna: dejar
-- la excepción encima de un bloque vivo sería decir «este día no va» mientras
-- el día va, y es justo el estado contradictorio que la revisión señala.
CREATE OR REPLACE FUNCTION public.turnos_guardar_dia(
  p_project_id           uuid,
  p_personal_id          uuid,
  p_fecha                date,
  p_plantilla_horario_id uuid,
  p_asignacion_id        uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company  uuid;
  v_bloque   uuid;
  v_plant    public.plantillas_horario%ROWTYPE;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  PERFORM public.turnos_asegurar_edicion_dia(v_company, p_project_id, p_personal_id);

  SELECT * INTO v_plant FROM public.plantillas_horario ph
   WHERE ph.id = p_plantilla_horario_id
     AND ph.company_id = v_company
     AND ph.project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la jornada no existe en este condominio' USING ERRCODE = '42501';
  END IF;

  -- La regla, si se manda, también tiene que ser del mismo inquilino.
  IF p_asignacion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.asignaciones_turno a
    WHERE a.id = p_asignacion_id AND a.company_id = v_company AND a.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'la regla no existe en este condominio' USING ERRCODE = '42501';
  END IF;

  SELECT b.id INTO v_bloque FROM public.bloques_turno b
   WHERE b.personal_id = p_personal_id AND b.fecha = p_fecha
     AND b.company_id = v_company AND b.project_id = p_project_id
   ORDER BY b.created_at
   LIMIT 1;

  IF v_bloque IS NULL THEN
    -- `horas_planificadas` y `politica` NO se escriben: las sellan sus triggers
    -- (trg_turnos_sellar_horas, trg_turnos_sellar_politica). Mandarlas sería
    -- inventar contra qué se va a medir el turno.
    INSERT INTO public.bloques_turno (
      company_id, project_id, personal_id, asignacion_id, plantilla_horario_id,
      turno, fecha, hora_inicio, hora_fin, cruza_medianoche, origen, estado
    ) VALUES (
      v_company, p_project_id, p_personal_id, p_asignacion_id, v_plant.id,
      v_plant.turno, p_fecha, v_plant.hora_inicio, v_plant.hora_fin,
      v_plant.cruza_medianoche, 'manual', 'pendiente'
    )
    RETURNING id INTO v_bloque;
  ELSE
    UPDATE public.bloques_turno b
       SET plantilla_horario_id = v_plant.id,
           turno                = v_plant.turno,
           hora_inicio          = v_plant.hora_inicio,
           hora_fin             = v_plant.hora_fin,
           cruza_medianoche     = v_plant.cruza_medianoche
     WHERE b.id = v_bloque;
  END IF;

  -- Mismo commit: el día deja de estar quitado.
  DELETE FROM public.excepciones_turno ex
   WHERE ex.personal_id = p_personal_id AND ex.fecha = p_fecha
     AND ex.company_id = v_company AND ex.project_id = p_project_id;

  RETURN v_bloque;
END;
$$;

COMMENT ON FUNCTION public.turnos_guardar_dia(uuid, uuid, date, uuid, uuid) IS
  'Asigna o cambia la jornada de UN día y retira en el mismo commit la excepción que lo quitaba. Exige permiso de EDITAR en Turnos. Devuelve el id del bloque.';

REVOKE EXECUTE ON FUNCTION public.turnos_guardar_dia(uuid, uuid, date, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_guardar_dia(uuid, uuid, date, uuid, uuid) TO authenticated, service_role;

-- ── 5c · Quitar un día ─────────────────────────────────────────────────────
-- Crea la excepción Y borra el bloque, en ese orden y en el mismo commit. El
-- orden importa aunque ahora sea atómico: si el trigger rechaza el borrado, la
-- transacción entera se va —incluida la excepción— y el día queda EXACTAMENTE
-- como estaba. Nada de bloques resucitados ni de días marcados como quitados
-- que siguen teniendo turno.
CREATE OR REPLACE FUNCTION public.turnos_quitar_dia(
  p_project_id    uuid,
  p_personal_id   uuid,
  p_fecha         date,
  p_asignacion_id uuid DEFAULT NULL,
  p_motivo        text DEFAULT NULL
)
RETURNS uuid                       -- id de la excepción vigente
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company   uuid;
  v_excepcion uuid;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  PERFORM public.turnos_asegurar_edicion_dia(v_company, p_project_id, p_personal_id);

  IF p_asignacion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.asignaciones_turno a
    WHERE a.id = p_asignacion_id AND a.company_id = v_company AND a.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'la regla no existe en este condominio' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: quitar dos veces el mismo día no es un error, es el mismo día
  -- quitado. `creado_por` lo sella trg_sellar_creado_por y no se manda.
  SELECT ex.id INTO v_excepcion FROM public.excepciones_turno ex
   WHERE ex.personal_id = p_personal_id AND ex.fecha = p_fecha
     AND ex.company_id = v_company AND ex.project_id = p_project_id
   LIMIT 1;

  IF v_excepcion IS NULL THEN
    INSERT INTO public.excepciones_turno (
      company_id, project_id, personal_id, asignacion_id, fecha, motivo
    ) VALUES (
      v_company, p_project_id, p_personal_id, p_asignacion_id, p_fecha,
      COALESCE(p_motivo, 'Quitado desde el calendario')
    )
    RETURNING id INTO v_excepcion;
  END IF;

  -- Y ahora el bloque. Si `trg_turnos_bloque_borrable` lo rechaza, su excepción
  -- sube SIN capturar: revierte también la fila de arriba y el cliente recibe
  -- el motivo exacto. Capturarla aquí para «seguir» sería dejar el día quitado
  -- con su turno intacto, que es el estado que esto viene a evitar.
  DELETE FROM public.bloques_turno b
   WHERE b.personal_id = p_personal_id AND b.fecha = p_fecha
     AND b.company_id = v_company AND b.project_id = p_project_id;

  RETURN v_excepcion;
END;
$$;

COMMENT ON FUNCTION public.turnos_quitar_dia(uuid, uuid, date, uuid, text) IS
  'Quita UN día: crea la excepción y borra su bloque en el mismo commit. Si trg_turnos_bloque_borrable rechaza el borrado, la excepción se revierte con él y sube el mensaje real del trigger. Idempotente. Exige permiso de EDITAR en Turnos.';

REVOKE EXECUTE ON FUNCTION public.turnos_quitar_dia(uuid, uuid, date, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_quitar_dia(uuid, uuid, date, uuid, text) TO authenticated, service_role;

-- ── 5d · Restaurar un día ──────────────────────────────────────────────────
-- Una sola escritura, pero pasa por el mismo guard: restaurar es editar el
-- calendario, y hacerlo por PostgREST directo se apoyaría en la policy, que ya
-- exige lo mismo. Tenerla aquí mantiene UNA llamada por operación en la UI.
CREATE OR REPLACE FUNCTION public.turnos_restaurar_dia(
  p_project_id  uuid,
  p_personal_id uuid,
  p_fecha       date
)
RETURNS integer                    -- excepciones retiradas (0 si no había)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_n       integer;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;
  PERFORM public.assert_company_scope(v_company);
  PERFORM public.turnos_asegurar_edicion_dia(v_company, p_project_id, p_personal_id);

  DELETE FROM public.excepciones_turno ex
   WHERE ex.personal_id = p_personal_id AND ex.fecha = p_fecha
     AND ex.company_id = v_company AND ex.project_id = p_project_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.turnos_restaurar_dia(uuid, uuid, date) IS
  'Devuelve UN día a su regla retirando la excepción que lo quitaba. Idempotente: 0 si no había. Exige permiso de EDITAR en Turnos.';

REVOKE EXECUTE ON FUNCTION public.turnos_restaurar_dia(uuid, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_restaurar_dia(uuid, uuid, date) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · Autoverificación — fail-closed
-- ════════════════════════════════════════════════════════════════════════════
-- Si algo de lo de arriba quedó a medias, esta migración NO se da por aplicada.
DO $$
DECLARE
  v_n       int;
  v_nombres text;
BEGIN
  -- 6.1 · Ninguna policy de ESCRITURA de estas dos tablas puede seguir
  --       apoyándose en la clave de visibilidad de 3 segmentos. Es el hallazgo
  --       entero: si alguna vuelve a colarse, la migración se cae.
  SELECT count(*), string_agg(polname, ', ')
    INTO v_n, v_nombres
  FROM pg_policy
  WHERE polrelid IN ('public.bloques_turno'::regclass, 'public.excepciones_turno'::regclass)
    AND polcmd IN ('a', 'w', 'd')          -- INSERT, UPDATE, DELETE
    AND (
      pg_get_expr(polqual, polrelid)      ~ 'user_has_permission\(''condominios\.tab\.[a-z_]+''\)'
      OR pg_get_expr(polwithcheck, polrelid) ~ 'user_has_permission\(''condominios\.tab\.[a-z_]+''\)'
    );
  IF v_n > 0 THEN
    RAISE EXCEPTION 'quedan % policies de escritura autorizando por visibilidad: %', v_n, v_nombres;
  END IF;

  -- 6.2 · Y las de escritura sí nombran el helper de acción.
  SELECT count(*) INTO v_n
  FROM pg_policy
  WHERE polrelid IN ('public.bloques_turno'::regclass, 'public.excepciones_turno'::regclass)
    AND polcmd IN ('a', 'w', 'd')
    AND coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
        LIKE '%condominios_puede_actuar%';
  IF v_n <> 6 THEN     -- excepciones: insert/update/delete · bloques: insert/update/delete
    RAISE EXCEPTION 'se esperaban 6 policies de escritura con condominios_puede_actuar, hay %', v_n;
  END IF;

  -- 6.3 · La LECTURA sigue siendo por visibilidad: un rol con sólo el permiso
  --       base tiene que poder abrir el calendario.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.excepciones_turno'::regclass
      AND polname  = 'excepciones_turno_select'
      AND pg_get_expr(polqual, polrelid) LIKE '%condominios.tab.turnos%'
      AND pg_get_expr(polqual, polrelid) NOT LIKE '%condominios_puede_actuar%'
  ) THEN
    RAISE EXCEPTION 'excepciones_turno_select debe seguir autorizando por visibilidad';
  END IF;

  -- 6.4 · Sigue habiendo UNA sola policy permisiva que autorice DELETE sobre
  --       bloques_turno. Dos se combinarían con OR y la laxa mandaría.
  SELECT count(*), string_agg(polname, ', ') INTO v_n, v_nombres
  FROM pg_policy
  WHERE polrelid = 'public.bloques_turno'::regclass
    AND polcmd IN ('d', '*') AND polpermissive;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'bloques_turno debe tener EXACTAMENTE una policy permisiva que autorice DELETE; hay % (%)', v_n, v_nombres;
  END IF;

  -- 6.5 · El trigger de integridad sigue en pie y sigue siendo la autoridad.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bloques_turno'::regclass
      AND tgname  = 'trg_turnos_bloque_borrable'
      AND NOT tgisinternal
      AND (tgtype & 2) = 2 AND (tgtype & 8) = 8 AND (tgtype & 1) = 1
  ) THEN
    RAISE EXCEPTION 'falta el trigger BEFORE DELETE FOR EACH ROW trg_turnos_bloque_borrable';
  END IF;

  -- 6.6 · Las cuatro funciones nuevas existen, son DEFINER donde toca y no las
  --       puede llamar anon. El guard interno NO es invocable por authenticated:
  --       no tiene por qué existir como superficie.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('condominios_puede_actuar','turnos_asegurar_edicion_dia',
                           'turnos_guardar_dia','turnos_quitar_dia','turnos_restaurar_dia')) <> 5 THEN
    RAISE EXCEPTION 'falta alguna de las cinco funciones nuevas';
  END IF;

  IF has_function_privilege('anon', 'public.turnos_guardar_dia(uuid,uuid,date,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.turnos_quitar_dia(uuid,uuid,date,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.turnos_restaurar_dia(uuid,uuid,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.condominios_puede_actuar(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon no debe poder ejecutar ninguna de las funciones nuevas';
  END IF;

  IF has_function_privilege('authenticated', 'public.turnos_asegurar_edicion_dia(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'el guard interno no debe ser invocable por authenticated';
  END IF;

  IF NOT (has_function_privilege('authenticated', 'public.turnos_guardar_dia(uuid,uuid,date,uuid,uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.turnos_quitar_dia(uuid,uuid,date,uuid,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.turnos_restaurar_dia(uuid,uuid,date)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'authenticated necesita EXECUTE sobre las tres RPC del día';
  END IF;

  -- 6.7 · Y las tres RPC del día son SECURITY DEFINER con search_path fijado.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('turnos_guardar_dia','turnos_quitar_dia','turnos_restaurar_dia',
                        'turnos_asegurar_edicion_dia','generar_bloques_turno')
      AND (NOT p.prosecdef OR p.proconfig IS NULL)
  ) THEN
    RAISE EXCEPTION 'las RPC de turnos deben ser SECURITY DEFINER con search_path fijado';
  END IF;

  RAISE NOTICE 'turnos: autorización por acción y edición atómica del día — autoverificación OK';
END;
$$;
