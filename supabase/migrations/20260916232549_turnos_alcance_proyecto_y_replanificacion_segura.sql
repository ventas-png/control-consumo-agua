-- ════════════════════════════════════════════════════════════════════════════
-- Turnos · el alcance por PROYECTO en la escritura de bloques, y la
--          re-planificación de un día sujeta a las mismas invariantes que el
--          borrado — desde la base, no desde el navegador
-- ════════════════════════════════════════════════════════════════════════════
--
-- DOS AGUJEROS QUE DEJÓ 20260916221839, LOS DOS DEL MISMO TIPO: una condición
-- que la UI respeta y la base no exigía.
--
-- 1 · LA EMPRESA NO ES EL INQUILINO. `bloques_turno_insert` y
--     `bloques_turno_update` comprobaban `company_id` y el permiso de acción,
--     pero NO `can_access_project`. Una empresa puede tener varios condominios
--     y el acceso se concede por PROYECTO: quien administra el condominio A
--     podía escribirle la agenda al personal del condominio B de la misma
--     empresa. El SELECT y el DELETE sí lo comprobaban; el alta y el cambio,
--     no. Y en el UPDATE hace falta en los DOS lados: el `USING` decide qué
--     filas puede tocar, y el `WITH CHECK` impide MOVER una fila al proyecto
--     de al lado, que es la misma fuga por la puerta de atrás.
--
-- 2 · «LA UI NO ES UNA FRONTERA DE SEGURIDAD». `turnos_guardar_dia` dejaba
--     cambiarle la jornada a un bloque PASADO, INICIADO, CERRADO, no pendiente,
--     o con checklist, revisiones o marcajes. El calendario no ofrece el botón
--     —`celdaEditable` lo esconde— pero la RPC estaba publicada a
--     `authenticated` y una llamada directa se saltaba el filtro entero.
--
--     El borrado ya tenía su barrera (`trg_turnos_bloque_borrable`,
--     20260916171325) y la re-planificación es el mismo daño por otra puerta:
--     cambiarle la jornada a un turno ya trabajado reescribe contra qué se
--     midió. Ahora comparten las SEIS condiciones, en una sola función, para
--     que no puedan divergir.
--
-- LO QUE NO SE ROMPE. El trigger nuevo mira SÓLO las columnas de
-- PLANIFICACIÓN. Iniciar, cerrar, puntuar o anotar un bloque siguen siendo
-- UPDATE libres: son el ciclo de vida del turno, no su re-planificación. Y
-- tampoco se rompe el `ON DELETE SET NULL` de `plantilla_horario_id` y
-- `asignacion_id`: desvincular (pasar a NULL) al borrar una jornada o una regla
-- CONSERVA la historia y no es re-planificar, así que no se bloquea.
--
-- SIN BYPASS. Ni owner, ni admin, ni super_admin, ni service_role: un trigger
-- dispara por su condición, no por quién ejecuta.
--
-- IDEMPOTENTE: CREATE OR REPLACE y DROP … IF EXISTS antes de cada CREATE.
-- FAIL-CLOSED: la sección 6 aborta la migración si algo quedó a medias.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · bloques_turno: escribir exige alcanzar el PROYECTO, no sólo la empresa
-- ════════════════════════════════════════════════════════════════════════════
-- Se conservan los mismos tabs y las mismas acciones que fijó 20260916221839;
-- lo único que se añade es `can_access_project(project_id)`. El bypass de
-- `is_super_admin()` se mantiene explícito y por delante, como en el resto del
-- repo: soporte conserva su llave.
DROP POLICY IF EXISTS "bloques_turno_insert" ON public.bloques_turno;
CREATE POLICY "bloques_turno_insert" ON public.bloques_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.can_access_project(project_id))
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'create')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')
             OR public.condominios_puede_actuar('prog_limpieza', 'create')
             OR public.condominios_puede_actuar('prog_limpieza', 'edit')))
  );

-- USING  → qué filas puede tocar (las de SU proyecto).
-- CHECK  → cómo pueden quedar. Evalúa el project_id de la fila NUEVA, así que
--          mover un bloque al condominio de al lado se rechaza aunque el de
--          origen sí fuera suyo. Sin esta mitad, el UPDATE sería una vía de
--          escritura en un proyecto ajeno con dos pasos en vez de uno.
DROP POLICY IF EXISTS "bloques_turno_update" ON public.bloques_turno;
CREATE POLICY "bloques_turno_update" ON public.bloques_turno
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.can_access_project(project_id))
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')
             OR public.condominios_puede_actuar('prog_limpieza', 'edit')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.can_access_project(project_id))
        AND (SELECT public.condominios_puede_actuar('turnos', 'edit')
             OR public.condominios_puede_actuar('tareas_personal', 'edit')
             OR public.condominios_puede_actuar('prog_limpieza', 'edit')))
  );

COMMENT ON POLICY "bloques_turno_insert" ON public.bloques_turno IS
  'Alta de un bloque: empresa, PROYECTO alcanzable y permiso de acción del tab que escribe. El proyecto importa porque una empresa puede tener varios condominios y el acceso se concede por proyecto.';
COMMENT ON POLICY "bloques_turno_update" ON public.bloques_turno IS
  'Cambio de un bloque: empresa, PROYECTO alcanzable y permiso de EDITAR. El WITH CHECK evalúa el project_id de la fila nueva, así que también impide mover un bloque a otro condominio. Las invariantes de re-planificación (futuro, pendiente, sin dependencias) las impone trg_turnos_bloque_replanificable.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Las seis condiciones, en UN solo sitio
-- ════════════════════════════════════════════════════════════════════════════
-- Borrar un bloque y cambiarle la jornada son el mismo daño por dos puertas: en
-- los dos casos se reescribe un turno que ya ocurrió o que ya arrastra trabajo.
-- Tenerlas duplicadas garantizaba que un día divergieran y que la puerta menos
-- mirada se quedara abierta, que es exactamente lo que acaba de pasar.
--
-- `p_accion` completa la frase «no se puede ___ un bloque …», así que los
-- mensajes del borrado siguen siendo BYTE A BYTE los de 20260916171325 — el
-- arnés afirma sobre ellos y la UI los muestra tal cual.
CREATE OR REPLACE FUNCTION public.turnos_asegurar_bloque_libre(
  p_bloque_id   uuid,
  p_company_id  uuid,
  p_fecha       date,
  p_estado      text,
  p_iniciado_en timestamptz,
  p_cerrado_en  timestamptz,
  p_accion      text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hoy    date;
  v_cuenta bigint;
BEGIN
  IF p_estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'no se puede % un bloque en estado %: solo los pendientes', p_accion, p_estado
      USING ERRCODE = '23001',
            HINT = 'Corregí el turno desde Presencia, que deja rastro de quién cambió qué.';
  END IF;

  IF p_iniciado_en IS NOT NULL THEN
    RAISE EXCEPTION 'no se puede % un bloque ya iniciado (iniciado_en = %)', p_accion, p_iniciado_en
      USING ERRCODE = '23001';
  END IF;

  IF p_cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'no se puede % un bloque ya cerrado (cerrado_en = %)', p_accion, p_cerrado_en
      USING ERRCODE = '23001';
  END IF;

  -- «Hoy» es el de la EMPRESA. CURRENT_DATE es UTC y a las 18:00 de Guatemala
  -- ya sería mañana: el turno de hoy dejaría de poder tocarse seis horas antes
  -- de tiempo.
  v_hoy := (now() AT TIME ZONE public.presencia_zona_horaria(p_company_id))::date;
  IF p_fecha < v_hoy THEN
    RAISE EXCEPTION 'no se puede % un bloque de una fecha pasada (% < % en la zona de la empresa)',
      p_accion, p_fecha, v_hoy
      USING ERRCODE = '23001';
  END IF;

  -- tareas_bloque cuelga con ON DELETE CASCADE: sin esta comprobación, borrar
  -- el bloque se lleva el checklist entero y nadie se entera. Y cambiarle la
  -- jornada deja el checklist colgando de un turno que ya no es el que se hizo.
  SELECT count(*) INTO v_cuenta FROM public.tareas_bloque t WHERE t.bloque_id = p_bloque_id;
  IF v_cuenta > 0 THEN
    RAISE EXCEPTION 'no se puede % un bloque con % tarea(s) asociada(s)', p_accion, v_cuenta
      USING ERRCODE = '23001',
            HINT = 'Quitá primero las tareas del bloque si de verdad hay que eliminarlo.';
  END IF;

  SELECT count(*) INTO v_cuenta FROM public.revisiones_tarea r WHERE r.bloque_id = p_bloque_id;
  IF v_cuenta > 0 THEN
    RAISE EXCEPTION 'no se puede % un bloque con % revisión(es) asociada(s)', p_accion, v_cuenta
      USING ERRCODE = '23001';
  END IF;

  -- presencia_personal.bloque_id es ON DELETE SET NULL: el marcaje sobreviviría
  -- pero perdería contra qué turno se comparaba, y el balance de jornada
  -- (20260913040400) pasaría a contarlo como cobertura no planificada.
  SELECT count(*) INTO v_cuenta FROM public.presencia_personal p WHERE p.bloque_id = p_bloque_id;
  IF v_cuenta > 0 THEN
    RAISE EXCEPTION 'no se puede % un bloque con % marcaje(s) de presencia asociado(s)', p_accion, v_cuenta
      USING ERRCODE = '23001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.turnos_asegurar_bloque_libre(uuid, uuid, date, text, timestamptz, timestamptz, text) IS
  'Las SEIS condiciones que hacen intocable un bloque de turno: pendiente, sin iniciar, sin cerrar, de hoy en adelante en la zona de la empresa, y sin tareas, revisiones ni marcajes. Compartida por el borrado (trg_turnos_bloque_borrable) y la re-planificación (trg_turnos_bloque_replanificable) para que no puedan divergir. `p_accion` completa «no se puede ___ un bloque …». Lanza 23001.';

REVOKE EXECUTE ON FUNCTION public.turnos_asegurar_bloque_libre(uuid, uuid, date, text, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.turnos_asegurar_bloque_libre(uuid, uuid, date, text, timestamptz, timestamptz, text) TO service_role;

-- ── 2b · El trigger de BORRADO pasa a delegar ──────────────────────────────
-- Mismo comportamiento y mismos mensajes que 20260916171325; lo que cambia es
-- que ya no lleva su propia copia de las condiciones.
CREATE OR REPLACE FUNCTION public.turnos_bloque_borrable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.turnos_asegurar_bloque_libre(
    OLD.id, OLD.company_id, OLD.fecha, OLD.estado, OLD.iniciado_en, OLD.cerrado_en, 'borrar');
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.turnos_bloque_borrable() IS
  'Trigger BEFORE DELETE de bloques_turno: delega en turnos_asegurar_bloque_libre. Corre para TODOS los roles —incluido service_role, que salta la RLS pero no los triggers— y no tiene bypass por rol.';

REVOKE EXECUTE ON FUNCTION public.turnos_bloque_borrable() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Re-planificar un día: las mismas seis condiciones
-- ════════════════════════════════════════════════════════════════════════════
--
-- QUÉ CUENTA COMO RE-PLANIFICAR. Cambiar QUIÉN trabaja, QUÉ DÍA, o CON QUÉ
-- HORARIO. Eso es rehacer el turno, y sobre uno ya trabajado equivale a
-- reescribir contra qué se midió.
--
-- QUÉ NO. El ciclo de vida: iniciar, cerrar, puntuar, anotar, cambiar de
-- estado. Son UPDATE legítimos sobre bloques pasados y en curso —es justo lo
-- que hace «Tareas por turno» todos los días— y el trigger no los mira.
--
-- EL CASO NULL. `plantilla_horario_id` y `asignacion_id` cuelgan con
-- ON DELETE SET NULL: borrar una jornada o una regla pone NULL en los bloques
-- históricos. Eso es DESVINCULAR, no re-planificar —la foto de `politica`
-- sobrevive a propósito (20260913040300)— así que pasar a NULL no se bloquea.
-- Bloquearlo haría imposible borrar una jornada en cuanto tuviera un solo día
-- pasado, que es siempre.
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
  'Trigger BEFORE UPDATE de bloques_turno: si cambian las columnas de PLANIFICACIÓN (quién, qué día, con qué horario, de qué inquilino) exige las mismas seis condiciones que el borrado. El ciclo de vida —iniciar, cerrar, puntuar, anotar— no se mira. Desvincular la jornada o la regla (pasar a NULL, que es lo que hace ON DELETE SET NULL) tampoco. Sin bypass por rol.';

REVOKE EXECUTE ON FUNCTION public.turnos_bloque_replanificable() FROM PUBLIC, anon, authenticated;

-- El nombre importa: los triggers del mismo evento disparan en orden
-- alfabético, y `trg_turnos_sellar_*` sólo tocan columnas derivadas
-- (horas_planificadas, politica) que este trigger no mira. Sea cual sea el
-- orden, el resultado es el mismo.
DROP TRIGGER IF EXISTS trg_turnos_bloque_replanificable ON public.bloques_turno;
CREATE TRIGGER trg_turnos_bloque_replanificable
  BEFORE UPDATE ON public.bloques_turno
  FOR EACH ROW EXECUTE FUNCTION public.turnos_bloque_replanificable();

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · Las RPC del día rechazan las fechas pasadas, las tres
-- ════════════════════════════════════════════════════════════════════════════
-- El trigger de arriba cubre lo que toca `bloques_turno`, pero «quitar» sobre
-- un día SIN bloque y «restaurar» sólo escriben en `excepciones_turno`, donde
-- no hay bloque que mirar. Hace falta comprobar la fecha aparte.
--
-- POR QUÉ UNA FUNCIÓN NUEVA Y NO UN PARÁMETRO MÁS EN EL GUARD. Añadirle
-- `p_fecha` a `turnos_asegurar_edicion_dia` obliga a DROPear su firma de tres
-- argumentos, y entonces reaplicar la secuencia entera de migraciones deja de
-- funcionar: 20260916221839 vuelve a crear la de tres, quedan dos sobrecargas
-- y su propia autoverificación —que cuenta funciones por nombre— aborta a mitad
-- del replay. Una migración no puede romper la re-aplicación de las anteriores;
-- el arnés lo comprueba en su paso 4 y así es como salió esto.
CREATE OR REPLACE FUNCTION public.turnos_asegurar_dia_futuro(
  p_company_id uuid,
  p_fecha      date
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoy date;
BEGIN
  -- «Hoy» es el de la EMPRESA. CURRENT_DATE es UTC y a las 18:00 de Guatemala
  -- ya sería mañana: el día de hoy dejaría de poder editarse seis horas antes
  -- de tiempo.
  v_hoy := (now() AT TIME ZONE public.presencia_zona_horaria(p_company_id))::date;
  IF p_fecha < v_hoy THEN
    RAISE EXCEPTION 'no se puede editar un día pasado (% < % en la zona de la empresa)', p_fecha, v_hoy
      USING ERRCODE = '23001',
            HINT = 'El calendario solo programa de hoy en adelante; lo que ya ocurrió se corrige desde Presencia.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.turnos_asegurar_dia_futuro(uuid, date) IS
  'El calendario solo programa de hoy en adelante, en la zona horaria de la empresa. Lo usan las tres RPC del día, incluidas las que sólo tocan excepciones_turno y por tanto no pasan por el trigger de bloques. Lanza 23001.';

REVOKE EXECUTE ON FUNCTION public.turnos_asegurar_dia_futuro(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.turnos_asegurar_dia_futuro(uuid, date) TO service_role;

-- Las tres RPC se recrean íntegras: sólo se les añade la llamada de arriba,
-- pero recrearlas enteras mantiene UNA definición legible por función —la
-- última migración que la nombra dice qué hace hoy— en vez de un parche que
-- obliga a reconstruirla leyendo tres archivos.

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
  PERFORM public.turnos_asegurar_dia_futuro(v_company, p_fecha);

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
REVOKE EXECUTE ON FUNCTION public.turnos_guardar_dia(uuid, uuid, date, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_guardar_dia(uuid, uuid, date, uuid, uuid) TO authenticated, service_role;

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
  PERFORM public.turnos_asegurar_dia_futuro(v_company, p_fecha);

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
REVOKE EXECUTE ON FUNCTION public.turnos_quitar_dia(uuid, uuid, date, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_quitar_dia(uuid, uuid, date, uuid, text) TO authenticated, service_role;

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
  PERFORM public.turnos_asegurar_dia_futuro(v_company, p_fecha);

  DELETE FROM public.excepciones_turno ex
   WHERE ex.personal_id = p_personal_id AND ex.fecha = p_fecha
     AND ex.company_id = v_company AND ex.project_id = p_project_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.turnos_restaurar_dia(uuid, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_restaurar_dia(uuid, uuid, date) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · Autoverificación — fail-closed
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n int;
  v_nombres text;
BEGIN
  -- 5.1 · Las tres mitades del UPDATE/INSERT nombran can_access_project. Es el
  --       hallazgo entero: sin esto, el condominio de al lado queda escribible.
  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.bloques_turno'::regclass
         AND polname  = 'bloques_turno_insert'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%can_access_project%') <> 1 THEN
    RAISE EXCEPTION 'bloques_turno_insert debe comprobar can_access_project en su WITH CHECK';
  END IF;

  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.bloques_turno'::regclass
         AND polname  = 'bloques_turno_update'
         AND pg_get_expr(polqual, polrelid)      LIKE '%can_access_project%'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%can_access_project%') <> 1 THEN
    RAISE EXCEPTION 'bloques_turno_update debe comprobar can_access_project en USING Y en WITH CHECK';
  END IF;

  -- 5.2 · Y ninguna policy de escritura perdió su gate de acción por el camino.
  SELECT count(*), string_agg(polname, ', ') INTO v_n, v_nombres
  FROM pg_policy
  WHERE polrelid IN ('public.bloques_turno'::regclass, 'public.excepciones_turno'::regclass)
    AND polcmd IN ('a', 'w', 'd')
    AND coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
        LIKE '%condominios_puede_actuar%';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'se esperaban 6 policies de escritura con condominios_puede_actuar, hay % (%)', v_n, v_nombres;
  END IF;

  -- 5.3 · Los dos triggers existen, en su evento, y delegan en la MISMA función.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bloques_turno'::regclass AND tgname = 'trg_turnos_bloque_borrable'
      AND NOT tgisinternal AND (tgtype & 2) = 2 AND (tgtype & 8) = 8 AND (tgtype & 1) = 1
  ) THEN
    RAISE EXCEPTION 'falta el trigger BEFORE DELETE FOR EACH ROW trg_turnos_bloque_borrable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bloques_turno'::regclass AND tgname = 'trg_turnos_bloque_replanificable'
      AND NOT tgisinternal AND (tgtype & 2) = 2 AND (tgtype & 16) = 16 AND (tgtype & 1) = 1
  ) THEN
    RAISE EXCEPTION 'falta el trigger BEFORE UPDATE FOR EACH ROW trg_turnos_bloque_replanificable';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('turnos_bloque_borrable', 'turnos_bloque_replanificable')
         AND p.prosrc LIKE '%turnos_asegurar_bloque_libre%') <> 2 THEN
    RAISE EXCEPTION 'los dos triggers deben delegar en turnos_asegurar_bloque_libre, para no divergir';
  END IF;

  -- 5.4 · Las TRES RPC del día comprueban la fecha. Las que sólo tocan
  --       excepciones_turno no pasan por el trigger de bloques, así que sin
  --       esta llamada «quitar» y «restaurar» aceptarían días pasados.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('turnos_guardar_dia', 'turnos_quitar_dia', 'turnos_restaurar_dia')
         AND p.prosrc LIKE '%turnos_asegurar_dia_futuro(v_company, p_fecha)%') <> 3 THEN
    RAISE EXCEPTION 'las tres RPC del día deben comprobar que la fecha no es pasada';
  END IF;

  -- 5.5 · Y siguen comprobando permiso, proyecto y empleado.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('turnos_guardar_dia', 'turnos_quitar_dia', 'turnos_restaurar_dia')
         AND p.prosrc LIKE '%turnos_asegurar_edicion_dia(v_company, p_project_id, p_personal_id)%') <> 3 THEN
    RAISE EXCEPTION 'las tres RPC del día deben pasar por el guard de autorización';
  END IF;

  -- 5.6 · Nada de lo nuevo es invocable por anon ni por authenticated: son
  --       piezas internas, no superficie.
  IF has_function_privilege('anon', 'public.turnos_asegurar_bloque_libre(uuid,uuid,date,text,timestamptz,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.turnos_asegurar_bloque_libre(uuid,uuid,date,text,timestamptz,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.turnos_asegurar_dia_futuro(uuid,date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.turnos_asegurar_dia_futuro(uuid,date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'los guards internos no deben ser invocables desde la aplicación';
  END IF;

  IF NOT (has_function_privilege('authenticated', 'public.turnos_guardar_dia(uuid,uuid,date,uuid,uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.turnos_quitar_dia(uuid,uuid,date,uuid,text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.turnos_restaurar_dia(uuid,uuid,date)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'authenticated necesita EXECUTE sobre las tres RPC del día';
  END IF;

  RAISE NOTICE 'turnos: alcance por proyecto y re-planificación segura — autoverificación OK';
END;
$$;
