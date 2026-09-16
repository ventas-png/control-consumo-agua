-- ════════════════════════════════════════════════════════════════════════════
-- Asignación de turnos: días del mes, excepciones, y un borrado que no destruye
--
-- Sustituye a #850, que nació sobre `main` en 7d24cdb y quedó desfasado. El
-- comportamiento se porta POR SECCIONES sobre el esquema de hoy; nada de #844
-- (política de jornada), #852 (columnas de bloques_turno), #865/#868 (balance) ni
-- #869 (huella) se reescribe.
--
-- ── QUÉ RESUELVE ───────────────────────────────────────────────────────────
--
-- A · «LOS DÍAS DEL MES QUE ELIJAS». Las once periodicidades de
--     `asignaciones_turno` cubren «los días de la SEMANA que elijas» (semanal)
--     pero del lado mensual solo existe UN día fijo (`dia_mes`). Quien entra el
--     1, el 15 y el 30 necesita hoy tres reglas. Se añade `dias_mes` (jsonb) y
--     la periodicidad `mensual_dias`, gemela exacta de `dias_semana`/`semanal`.
--
-- B · EL DÍA QUE NO SE CUBRE. `generar_bloques_turno()` solo SUMA
--     (20260820000200:41-47): borrar el bloque del jueves dura hasta la
--     siguiente pasada, que lo vuelve a crear. Se añade `excepciones_turno`, el
--     negativo de la regla: una fila por (persona, fecha) que el generador
--     respeta. Es tabla propia y no un `estado='cancelado'` en `bloques_turno`
--     porque un bloque cancelado seguiría contando horas planificadas en el
--     balance de jornada (20260913040400) y arrastrando su checklist.
--
-- C · BORRAR UN BLOQUE YA NO PUEDE DESTRUIR HISTORIAL. Hoy la policy DELETE de
--     `bloques_turno` (20260820000000:492-498) deja a `company_owner`/`admin`
--     borrar CUALQUIER bloque, y `tareas_bloque.bloque_id` es ON DELETE CASCADE:
--     un clic se lleva el checklist completo sin preguntar. `revisiones_tarea`
--     apunta al bloque sin acción declarada y `presencia_personal.bloque_id` es
--     ON DELETE SET NULL, o sea que el marcaje queda huérfano en silencio.
--     Ese camino se cierra PARA TODOS LOS ROLES DE APLICACIÓN.
--
-- ── CÓMO SE CIERRA EL BORRADO (la parte delicada) ──────────────────────────
-- Dos capas con responsabilidades distintas, que es lo que permite que ninguna
-- tenga que hacer el trabajo de la otra:
--
--   AUTORIZACIÓN → la policy RLS. Responde «¿este usuario puede tocar bloques
--   de esta empresa y este proyecto?». Se reemplaza la policy vigente por UNA
--   sola; abajo hay una aserción que aborta la migración si quedara más de una
--   policy de DELETE, porque dos policies permisivas se combinan con OR y la
--   segunda anularía a la primera.
--
--   INTEGRIDAD → un trigger BEFORE DELETE. Responde «¿este bloque se puede
--   borrar sin destruir nada?». Va en trigger y no en la policy por dos razones
--   que no son de estilo:
--     · Un `NOT EXISTS (SELECT … FROM tareas_bloque …)` dentro de una policy se
--       evalúa CON LA RLS de la tabla hija puesta. A quien no puede ver esas
--       filas le da «no hay ninguna» y el borrado pasa: la comprobación se
--       falsea sola, y justo con el usuario menos privilegiado.
--     · El trigger corre para CUALQUIER borrado, venga del rol que venga —
--       incluido `service_role`, que salta la RLS pero no los triggers.
--
-- El trigger es SECURITY DEFINER para poder leer las tablas hijas sin la RLS
-- del invocante, con `search_path` fijado en vacío, todo referenciado por
-- esquema, y sin EXECUTE para PUBLIC, anon ni authenticated (un trigger dispara
-- por su condición, no por el privilegio de quien ejecuta). No tiene NINGÚN
-- bypass por rol: `company_owner`, `admin` y `super_admin` pasan por las mismas
-- seis condiciones que el resto.
--
-- FUERA DE ALCANCE, a propósito: no se añade ninguna vía de reparación
-- administrativa. Si alguna vez hace falta borrar un bloque con historial, eso
-- es una operación aparte, explícita y auditada, y se diseña por su cuenta.
--
-- «HOY» ES EL DE LA EMPRESA, NO EL DEL SERVIDOR. La fecha se compara contra
-- `presencia_zona_horaria(company_id)` (20260908000000), el mismo criterio con
-- el que se fecha un marcaje. `CURRENT_DATE` es UTC: a las 18:00 de Guatemala ya
-- es «mañana» en el servidor, y el turno de hoy habría dejado de poder editarse
-- seis horas antes de tiempo.
--
-- ── PROPIEDADES DE LAS FUNCIONES REEMPLAZADAS ──────────────────────────────
-- `turnos_regla_aplica` gana un noveno parámetro CON DEFAULT y conserva todo lo
-- demás: plpgsql, IMMUTABLE, `SET search_path = public`, RETURNS boolean, y el
-- mismo REVOKE/GRANT. La firma de 8 se DROPEA primero: con las dos vivas,
-- cualquier llamada de 8 argumentos sería ambigua (42725). Sus consumidores son
-- `generar_bloques_turno`, `supabase/tests/turnos/assert.sql` y el espejo
-- TypeScript; los tres siguen compilando porque el noveno tiene default.
--
-- `generar_bloques_turno` conserva firma (uuid, date, date), tipo de retorno,
-- SECURITY DEFINER, `SET search_path = public, pg_temp` y sus grants.
--
-- ── AISLAMIENTO ────────────────────────────────────────────────────────────
-- `excepciones_turno` no se conforma con guardar `company_id`/`project_id`: sus
-- FKs son COMPUESTAS contra `(id, company_id, project_id)` de
-- `personal_condominio` y `asignaciones_turno`, siguiendo el patrón que fijó
-- #844 para `plantilla_cupos_pausa`. Conocer el UUID de un empleado de otra
-- empresa no alcanza: la fila no entra. Las dos anclas `*_id_tenant_uq` se
-- crean aquí porque todavía no existían.
--
-- IMPACTO EN DATOS: ninguna fila cambia de valor. Se añade una columna con
-- DEFAULT, una tabla vacía, dos UNIQUE sobre columnas ya únicas, dos funciones
-- nuevas, y se reemplazan dos funciones y una policy.
--
-- CÓMO REVERTIR
--   DROP TRIGGER IF EXISTS trg_turnos_bloque_borrable ON public.bloques_turno;
--   DROP FUNCTION IF EXISTS public.turnos_bloque_borrable();
--   DROP TABLE IF EXISTS public.excepciones_turno;
--   ALTER TABLE public.asignaciones_turno DROP COLUMN IF EXISTS dias_mes;
--   DROP FUNCTION IF EXISTS public.turnos_dias_mes_validos(jsonb);
--   ALTER TABLE public.personal_condominio DROP CONSTRAINT IF EXISTS personal_condominio_id_tenant_uq;
--   ALTER TABLE public.asignaciones_turno  DROP CONSTRAINT IF EXISTS asignaciones_turno_id_tenant_uq;
--   -- y re-crear desde 20260820000000/20260820000200 el CHECK de frecuencia,
--   -- la policy bloques_turno_delete y las dos funciones con su firma vieja.
--
-- Idempotente: IF NOT EXISTS / IF EXISTS en todo, CREATE OR REPLACE en las
-- funciones, DROP POLICY antes de CREATE POLICY. Aplicarla dos veces seguidas
-- deja el mismo catálogo — lo comprueba supabase/tests/turnos/run.sh.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · «Los días del mes que elijas»
-- ════════════════════════════════════════════════════════════════════════════

-- Un CHECK no puede llevar subconsulta, así que la validación de la lista vive
-- en una función IMMUTABLE. No basta con `jsonb_typeof(...) = 'array'`: lo que
-- hay que impedir es un 0, un 32, un decimal, un texto o un nulo dentro de la
-- lista, porque cualquiera de esos produce una regla que no cae NUNCA y que
-- nadie va a poder explicar mirando el calendario.
CREATE OR REPLACE FUNCTION public.turnos_dias_mes_validos(p_dias jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_dias IS NULL
      OR (
        jsonb_typeof(p_dias) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_dias) AS e(v)
          WHERE jsonb_typeof(e.v) <> 'number'
             OR (e.v)::text ~ '[.eE]'                    -- 2.5, 1e2: no son días
             OR (e.v)::text::numeric < 1
             OR (e.v)::text::numeric > 31
        )
      )
$$;

COMMENT ON FUNCTION public.turnos_dias_mes_validos(jsonb) IS
  'true si el jsonb es un array de enteros 1..31 (o NULL). Respalda el CHECK de asignaciones_turno.dias_mes: un 0, un 32 o un decimal producen una regla que no cae nunca.';

REVOKE EXECUTE ON FUNCTION public.turnos_dias_mes_validos(jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_dias_mes_validos(jsonb) TO authenticated, service_role;

ALTER TABLE public.asignaciones_turno
  ADD COLUMN IF NOT EXISTS dias_mes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.asignaciones_turno.dias_mes IS
  'Días del mes 1..31 para frecuencia=mensual_dias, p. ej. [1,15,30]. Mismo formato que dias_semana. Un día que ese mes no tiene se recorta al último real (31 en febrero → 28/29) y varios que convergen en el mismo día producen UN turno, no varios.';

DO $$
BEGIN
  ALTER TABLE public.asignaciones_turno DROP CONSTRAINT IF EXISTS asignaciones_turno_frecuencia_chk;
  ALTER TABLE public.asignaciones_turno
    ADD CONSTRAINT asignaciones_turno_frecuencia_chk
    CHECK (frecuencia IN (
      'unica', 'diaria', 'semanal', 'quincenal', 'mensual', 'mensual_dias',
      'bimestral', 'trimestral', 'semestral', 'anual', 'fechas'
    ));

  ALTER TABLE public.asignaciones_turno DROP CONSTRAINT IF EXISTS asignaciones_turno_dias_mes_chk;
  ALTER TABLE public.asignaciones_turno
    ADD CONSTRAINT asignaciones_turno_dias_mes_chk
    CHECK (public.turnos_dias_mes_validos(dias_mes));
END;
$$;

COMMENT ON COLUMN public.asignaciones_turno.frecuencia IS
  'unica | diaria | semanal | quincenal | mensual | mensual_dias | bimestral | trimestral | semestral | anual | fechas. Extiende el vocabulario de rutas (20260522000008).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Anclas de inquilino para las FKs compuestas
-- ════════════════════════════════════════════════════════════════════════════
-- `id` ya es PRIMARY KEY en las dos tablas, así que estos UNIQUE no restringen
-- nada nuevo: existen para que una FK COMPUESTA pueda apuntar contra ellos y
-- arrastrar el par (company_id, project_id) en la comprobación. Es el patrón
-- que fijó 20260913040300 para `plantillas_horario`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_condominio_id_tenant_uq') THEN
    ALTER TABLE public.personal_condominio
      ADD CONSTRAINT personal_condominio_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asignaciones_turno_id_tenant_uq') THEN
    ALTER TABLE public.asignaciones_turno
      ADD CONSTRAINT asignaciones_turno_id_tenant_uq UNIQUE (id, company_id, project_id);
  END IF;
END;
$$;

COMMENT ON CONSTRAINT personal_condominio_id_tenant_uq ON public.personal_condominio IS
  'Ancla de las FKs compuestas por inquilino. id ya es PK: esto no restringe datos, habilita REFERENCES (id, company_id, project_id).';
COMMENT ON CONSTRAINT asignaciones_turno_id_tenant_uq ON public.asignaciones_turno IS
  'Ancla de las FKs compuestas por inquilino. id ya es PK: esto no restringe datos, habilita REFERENCES (id, company_id, project_id).';

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · excepciones_turno — el día que NO se cubre
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.excepciones_turno (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  personal_id   uuid        NOT NULL,
  -- Regla que cubría el día cuando se quitó. INFORMATIVA: la excepción vale por
  -- (persona, fecha) aunque después se cambie de regla, porque lo que el
  -- administrador decidió es «esta persona no viene ese día».
  asignacion_id uuid,
  fecha         date        NOT NULL,
  motivo        text,
  creado_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT excepciones_turno_unica UNIQUE (personal_id, fecha),

  -- El empleado tiene que ser de ESTA empresa y ESTE proyecto. Con una FK
  -- simple a personal_condominio(id) bastaría conocer un UUID ajeno.
  CONSTRAINT excepciones_turno_personal_fk
    FOREIGN KEY (personal_id, company_id, project_id)
    REFERENCES public.personal_condominio(id, company_id, project_id) ON DELETE CASCADE,

  -- Ídem para la regla. SET NULL SOLO sobre asignacion_id (PostgreSQL 15+):
  -- un SET NULL de las tres columnas intentaría anular company_id/project_id,
  -- que son NOT NULL, y el borrado de la regla fallaría.
  CONSTRAINT excepciones_turno_asignacion_fk
    FOREIGN KEY (asignacion_id, company_id, project_id)
    REFERENCES public.asignaciones_turno(id, company_id, project_id)
    ON DELETE SET NULL (asignacion_id)
);

COMMENT ON TABLE public.excepciones_turno IS
  'El negativo de asignaciones_turno: esta persona NO trabaja este día aunque una regla activa lo cubra. La respeta generar_bloques_turno() y la pinta el calendario. Quitar la fila devuelve el día a la regla.';
COMMENT ON COLUMN public.excepciones_turno.asignacion_id IS
  'Regla que cubría el día cuando se creó la excepción. Informativa: la excepción es por (personal, fecha), no por regla.';
COMMENT ON COLUMN public.excepciones_turno.motivo IS
  'Texto libre del administrador ("permiso", "cambio con Pérez"). No lo interpreta nadie.';
COMMENT ON COLUMN public.excepciones_turno.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable: el cliente no puede falsificarlo ni cambiarlo después. NULL = escritura de sistema.';

CREATE INDEX IF NOT EXISTS idx_excepciones_turno_project
  ON public.excepciones_turno(project_id, company_id, fecha);
CREATE INDEX IF NOT EXISTS idx_excepciones_turno_personal
  ON public.excepciones_turno(personal_id, fecha);

-- `creado_por` lo sella la base con auth.uid() y lo vuelve inmutable
-- (20260731000000). Lo que mande el cliente en esa columna se ignora.
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.excepciones_turno;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.excepciones_turno
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- ── RLS y ACL: explícitos, sin heredar nada ────────────────────────────────
-- FORCE además de ENABLE: sin FORCE, el DUEÑO de la tabla se salta sus propias
-- policies. Es el mismo criterio que 20260913040300 para plantilla_cupos_pausa.
ALTER TABLE public.excepciones_turno ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excepciones_turno FORCE  ROW LEVEL SECURITY;

-- Mínimo privilegio declarado a mano. Y «a mano» incluye a `authenticated`:
-- una tabla nueva de este proyecto NO nace desnuda. Supabase deja puesto un
-- ALTER DEFAULT PRIVILEGES que le concede TODO sobre cada tabla que aparezca en
-- `public`, así que sin el REVOKE de abajo `authenticated` se quedaba además
-- con TRUNCATE, REFERENCES y TRIGGER.
--
-- TRUNCATE es el que importa, y no es cosmético: **TRUNCATE no pasa por RLS**.
-- Un sólo TRUNCATE por cualquier vía SECURITY INVOKER —una RPC, un helper—
-- vaciaría las excepciones de TODAS las empresas de golpe, con las cuatro
-- policies de abajo intactas y sin enterarse nadie. Por eso se revoca todo y se
-- vuelve a conceder sólo el DML, en vez de confiar en lo que la tabla hereda.
-- La aserción de la sección 7 comprueba que quedó exactamente así.
REVOKE ALL ON public.excepciones_turno FROM PUBLIC;
REVOKE ALL ON public.excepciones_turno FROM anon;
REVOKE ALL ON public.excepciones_turno FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.excepciones_turno TO authenticated;
GRANT ALL ON public.excepciones_turno TO service_role;

-- Empresa Y proyecto en las cuatro. `can_access_project` (20260729000600) es el
-- helper del repo y está concedido a authenticated; `user_has_permission` pone
-- el gate del tab. Leer lo abre también a «Tareas por turno», que muestra el
-- mismo calendario; escribir es solo de «Asignación de turnos».
DROP POLICY IF EXISTS "excepciones_turno_select" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_select" ON public.excepciones_turno
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
         OR public.user_has_permission('condominios.tab.turnos'))
  );

DROP POLICY IF EXISTS "excepciones_turno_insert" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_insert" ON public.excepciones_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.user_has_permission('condominios.tab.turnos'))
  );

DROP POLICY IF EXISTS "excepciones_turno_update" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_update" ON public.excepciones_turno
  FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.user_has_permission('condominios.tab.turnos'))
  )
  WITH CHECK (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.user_has_permission('condominios.tab.turnos'))
  );

DROP POLICY IF EXISTS "excepciones_turno_delete" ON public.excepciones_turno;
CREATE POLICY "excepciones_turno_delete" ON public.excepciones_turno
  FOR DELETE TO authenticated
  USING (
    company_id = (SELECT public.get_my_company_id())
    AND (SELECT public.can_access_project(project_id))
    AND (SELECT public.user_has_permission('condominios.tab.turnos'))
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 4 · El borrado de bloques_turno deja de poder destruir historial
-- ════════════════════════════════════════════════════════════════════════════

-- ── 4a · AUTORIZACIÓN: una sola policy de DELETE ───────────────────────────
-- Se REEMPLAZA la vigente. No se añade una segunda: dos policies permisivas se
-- combinan con OR, así que la más laxa mandaría y la estricta sería decorativa.
-- La aserción de 4c aborta la migración si quedara más de una.
--
-- Esta policy responde sólo «¿de quién son estos bloques?». Las condiciones de
-- integridad (fecha, estado, hitos, dependencias) NO van acá: van en el trigger
-- de 4b, porque dentro de una policy un NOT EXISTS contra las tablas hijas se
-- evalúa con la RLS de esas tablas y se falsea solo justo para el usuario menos
-- privilegiado.
DROP POLICY IF EXISTS "bloques_turno_delete" ON public.bloques_turno;
CREATE POLICY "bloques_turno_delete" ON public.bloques_turno
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND (SELECT public.can_access_project(project_id))
      AND (
        (SELECT public.current_user_role()) = ANY(ARRAY['company_owner', 'admin'])
        OR (SELECT public.user_has_permission('condominios.tab.turnos'))
        OR (SELECT public.user_has_permission('condominios.tab.tareas_personal'))
      )
    )
  );

COMMENT ON POLICY "bloques_turno_delete" ON public.bloques_turno IS
  'AUTORIZACIÓN del borrado (de quién son los bloques). La INTEGRIDAD —futuro, pendiente, sin iniciar, sin cerrar, sin tareas, sin revisiones, sin marcajes— la impone trg_turnos_bloque_borrable, que corre para todos los roles, incluido service_role.';

-- ── 4b · INTEGRIDAD: la barrera que no depende del rol ─────────────────────
-- SECURITY DEFINER para leer las tablas hijas SIN la RLS del invocante: si la
-- comprobación dependiera de lo que el usuario alcanza a ver, quien menos ve
-- sería quien más podría borrar.
--
-- `search_path` en vacío y todo calificado por esquema: con SECURITY DEFINER,
-- un search_path heredado del invocante es una vía para que resuelva
-- `tareas_bloque` contra una tabla suya que siempre está vacía.
--
-- SIN bypass por rol. company_owner, admin y super_admin pasan por las mismas
-- condiciones. No hay parámetro, GUC ni excepción que las salte: una reparación
-- administrativa, si hiciera falta, es una operación aparte y auditada.
CREATE OR REPLACE FUNCTION public.turnos_bloque_borrable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hoy    date;
  v_cuenta bigint;
BEGIN
  -- El turno ya arrancó, o ya se cerró. Su checklist y su puntaje son el
  -- registro de una jornada que ocurrió.
  IF OLD.estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'no se puede borrar un bloque en estado %: solo los pendientes', OLD.estado
      USING ERRCODE = '23001',
            HINT = 'Corregí el turno desde Presencia, que deja rastro de quién cambió qué.';
  END IF;

  IF OLD.iniciado_en IS NOT NULL THEN
    RAISE EXCEPTION 'no se puede borrar un bloque ya iniciado (iniciado_en = %)', OLD.iniciado_en
      USING ERRCODE = '23001';
  END IF;

  IF OLD.cerrado_en IS NOT NULL THEN
    RAISE EXCEPTION 'no se puede borrar un bloque ya cerrado (cerrado_en = %)', OLD.cerrado_en
      USING ERRCODE = '23001';
  END IF;

  -- «Hoy» es el de la EMPRESA. CURRENT_DATE es UTC y a las 18:00 de Guatemala
  -- ya sería mañana: el turno de hoy dejaría de poder editarse seis horas antes
  -- de tiempo.
  v_hoy := (now() AT TIME ZONE public.presencia_zona_horaria(OLD.company_id))::date;
  IF OLD.fecha < v_hoy THEN
    RAISE EXCEPTION 'no se puede borrar un bloque de una fecha pasada (% < % en la zona de la empresa)', OLD.fecha, v_hoy
      USING ERRCODE = '23001';
  END IF;

  -- tareas_bloque cuelga con ON DELETE CASCADE: sin esta comprobación, borrar
  -- el bloque se lleva el checklist entero y nadie se entera.
  SELECT count(*) INTO v_cuenta FROM public.tareas_bloque t WHERE t.bloque_id = OLD.id;
  IF v_cuenta > 0 THEN
    RAISE EXCEPTION 'no se puede borrar un bloque con % tarea(s) asociada(s)', v_cuenta
      USING ERRCODE = '23001',
            HINT = 'Quitá primero las tareas del bloque si de verdad hay que eliminarlo.';
  END IF;

  SELECT count(*) INTO v_cuenta FROM public.revisiones_tarea r WHERE r.bloque_id = OLD.id;
  IF v_cuenta > 0 THEN
    RAISE EXCEPTION 'no se puede borrar un bloque con % revisión(es) asociada(s)', v_cuenta
      USING ERRCODE = '23001';
  END IF;

  -- presencia_personal.bloque_id es ON DELETE SET NULL: el marcaje sobreviviría
  -- pero perdería contra qué turno se comparaba, y el balance de jornada
  -- (20260913040400) pasaría a contarlo como cobertura no planificada.
  SELECT count(*) INTO v_cuenta FROM public.presencia_personal p WHERE p.bloque_id = OLD.id;
  IF v_cuenta > 0 THEN
    RAISE EXCEPTION 'no se puede borrar un bloque con % marcaje(s) de presencia asociado(s)', v_cuenta
      USING ERRCODE = '23001';
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.turnos_bloque_borrable() IS
  'Trigger BEFORE DELETE de bloques_turno: sólo deja borrar un bloque pendiente, sin iniciar, sin cerrar, con fecha de hoy en adelante en la zona de la empresa, y sin tareas, revisiones ni marcajes. Corre para TODOS los roles —incluido service_role, que salta la RLS pero no los triggers— y no tiene bypass por rol.';

-- Un trigger dispara por su condición, no por el privilegio de quien ejecuta el
-- DELETE: revocar EXECUTE no lo desactiva, sólo impide que alguien la llame a
-- mano como si fuera una función normal.
REVOKE EXECUTE ON FUNCTION public.turnos_bloque_borrable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.turnos_bloque_borrable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.turnos_bloque_borrable() FROM authenticated;

DROP TRIGGER IF EXISTS trg_turnos_bloque_borrable ON public.bloques_turno;
CREATE TRIGGER trg_turnos_bloque_borrable
  BEFORE DELETE ON public.bloques_turno
  FOR EACH ROW EXECUTE FUNCTION public.turnos_bloque_borrable();

-- ── 4c · Aserción: exactamente UNA policy que autorice DELETE ──────────────
-- Fail-closed. Si una migración futura añade una segunda policy de DELETE (o
-- una FOR ALL, que también cubre DELETE), esta migración deja de aplicarse y
-- alguien tiene que mirar por qué, en vez de que el OR abra el camino sin ruido.
DO $$
DECLARE
  v_n int;
  v_nombres text;
BEGIN
  SELECT count(*), string_agg(polname, ', ' ORDER BY polname)
    INTO v_n, v_nombres
  FROM pg_policy
  WHERE polrelid = 'public.bloques_turno'::regclass
    AND polcmd IN ('d', '*')          -- d = DELETE, * = ALL
    AND polpermissive;                 -- las restrictivas sólo pueden restar

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'bloques_turno debe tener EXACTAMENTE una policy permisiva que autorice DELETE; hay % (%)', v_n, v_nombres;
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5 · La recurrencia aprende los días del mes
-- ════════════════════════════════════════════════════════════════════════════
-- Se DROPEA la firma de 8 parámetros ANTES de crear la de 9 con DEFAULT: con
-- las dos vivas, cualquier llamada de 8 argumentos sería ambigua (42725). Los
-- consumidores (generar_bloques_turno, supabase/tests/turnos/assert.sql y el
-- espejo TypeScript) siguen llamando con 8 y resuelven contra la nueva.
--
-- Todo lo demás se conserva: plpgsql, IMMUTABLE, SET search_path = public,
-- RETURNS boolean, y el mismo REVOKE/GRANT de 20260820000200:155-156.
DROP FUNCTION IF EXISTS public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date);

CREATE OR REPLACE FUNCTION public.turnos_regla_aplica(
  p_frecuencia         text,
  p_fecha_inicio       date,
  p_dias_semana        jsonb,
  p_intervalo_dias     int,
  p_dia_mes            int,
  p_mes_ancla          int,
  p_fechas_especificas jsonb,
  p_fecha              date,
  p_dias_mes           jsonb DEFAULT '[]'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_meses        int;
  v_offset       int;
  v_dia_objetivo int;
  v_ultimo_dia   int;
  v_semanas      int;
  v_encaja_dow   boolean;
  v_dia          int;
BEGIN
  IF p_fecha IS NULL OR p_fecha_inicio IS NULL OR p_fecha < p_fecha_inicio THEN
    RETURN false;
  END IF;

  -- Sin días declarados, el filtro semanal no filtra: la regla cubre la semana
  -- completa. Con días declarados, solo esos.
  v_encaja_dow :=
    COALESCE(jsonb_array_length(COALESCE(p_dias_semana, '[]'::jsonb)), 0) = 0
    OR p_dias_semana @> to_jsonb(EXTRACT(ISODOW FROM p_fecha)::int);

  v_ultimo_dia := EXTRACT(DAY FROM (
    make_date(EXTRACT(YEAR FROM p_fecha)::int, EXTRACT(MONTH FROM p_fecha)::int, 1)
    + INTERVAL '1 month' - INTERVAL '1 day'
  ))::int;
  v_dia := EXTRACT(DAY FROM p_fecha)::int;

  CASE p_frecuencia
    WHEN 'unica' THEN
      RETURN p_fecha = p_fecha_inicio;

    WHEN 'diaria' THEN
      -- intervalo_dias = 2 → día sí, día no, contando desde fecha_inicio.
      RETURN (p_fecha - p_fecha_inicio) % GREATEST(COALESCE(p_intervalo_dias, 1), 1) = 0;

    WHEN 'semanal' THEN
      RETURN v_encaja_dow;

    WHEN 'quincenal' THEN
      -- Semanas completas desde el inicio: la 0, la 2, la 4… Así una regla
      -- "lunes y jueves cada quince días" cae en las dos semanas alternas
      -- correctas, y no en cuatro días seguidos.
      v_semanas := ((p_fecha - p_fecha_inicio) / 7)::int;
      RETURN v_encaja_dow AND v_semanas % 2 = 0;

    WHEN 'mensual_dias' THEN
      -- El gemelo mensual de 'semanal': los días del mes que el administrador
      -- marcó, todos los meses.
      --
      -- FIN DE MES. Un día que ese mes no existe se RECORTA al último real, con
      -- el mismo criterio que las periodicidades de día fijo (20260820000200):
      -- saltarse el mes dejaría al empleado sin turno siete veces al año. Y
      -- como esto es un EXISTS sobre la lista —no una fila por elemento—, que
      -- el 29, el 30 y el 31 converjan todos en el 28 de febrero produce UN
      -- solo día, no tres. El generador inserta una fila por (regla, fecha), así
      -- que no hay forma de que salgan duplicados por esta vía.
      --
      -- Sin lista, se cae de vuelta en dia_mes para no producir una regla que
      -- no cae nunca.
      IF COALESCE(jsonb_array_length(COALESCE(p_dias_mes, '[]'::jsonb)), 0) = 0 THEN
        RETURN v_dia = LEAST(
          COALESCE(p_dia_mes, EXTRACT(DAY FROM p_fecha_inicio)::int), v_ultimo_dia);
      END IF;
      RETURN EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_dias_mes) AS d(v)
        WHERE jsonb_typeof(d.v) = 'number'
          AND LEAST(GREATEST((d.v)::text::int, 1), v_ultimo_dia) = v_dia
      );

    WHEN 'mensual'    THEN v_meses := 1;
    WHEN 'bimestral'  THEN v_meses := 2;
    WHEN 'trimestral' THEN v_meses := 3;
    WHEN 'semestral'  THEN v_meses := 6;
    WHEN 'anual'      THEN v_meses := 12;

    WHEN 'fechas' THEN
      RETURN COALESCE(p_fechas_especificas, '[]'::jsonb) @> to_jsonb(p_fecha::text);

    ELSE
      RETURN false;
  END CASE;

  -- ── Periodicidades por mes (mensual … anual) ──────────────────────────────
  -- El ancla es (año de fecha_inicio, mes_ancla o el mes de fecha_inicio). El
  -- salto se cuenta en meses absolutos, así que diciembre→enero avanza 1 y no
  -- retrocede 11.
  v_offset :=
    (EXTRACT(YEAR FROM p_fecha)::int - EXTRACT(YEAR FROM p_fecha_inicio)::int) * 12
    + (EXTRACT(MONTH FROM p_fecha)::int
       - COALESCE(p_mes_ancla, EXTRACT(MONTH FROM p_fecha_inicio)::int));

  IF ((v_offset % v_meses) + v_meses) % v_meses <> 0 THEN
    RETURN false;
  END IF;

  -- Día 31 en un mes de 30 cae el 30, y en febrero el 28 o el 29. Recortar es lo
  -- único razonable: la alternativa (saltarse el mes) dejaría al empleado sin
  -- turno siete veces al año.
  v_dia_objetivo := LEAST(
    COALESCE(p_dia_mes, EXTRACT(DAY FROM p_fecha_inicio)::int),
    v_ultimo_dia
  );

  RETURN v_dia = v_dia_objetivo;
END;
$$;

COMMENT ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date, jsonb) IS
  'Definición ejecutable de las 11 periodicidades de asignaciones_turno. Pura y determinista. Espejo de reglaAplicaEn() en src/domain/condominios/turnos.ts — si cambia una, cambia la otra.';

REVOKE EXECUTE ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_regla_aplica(text, date, jsonb, int, int, int, jsonb, date, jsonb) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6 · El generador respeta los días quitados
-- ════════════════════════════════════════════════════════════════════════════
-- Dos cambios respecto de 20260820000200, y nada más: se pasa `a.dias_mes` como
-- noveno argumento, y se filtran las fechas con excepción. El resto del cuerpo
-- es literal. Firma, tipo de retorno, SECURITY DEFINER, search_path y grants,
-- idénticos.
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

  -- Y además el permiso del tab: leer el proyecto no habilita a llenarle la
  -- agenda al personal.
  IF NOT (public.is_super_admin() OR public.user_has_permission('condominios.tab.turnos')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
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
  'Materializa las reglas activas de un proyecto en bloques_turno para el rango dado (por defecto, 60 días desde hoy). Se salta ausencias aprobadas, días no laborables, excepciones_turno y lo ya existente. Nunca borra ni sobrescribe. Devuelve el conteo de cada bucket.';

REVOKE EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.generar_bloques_turno(uuid, date, date) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7 · Autoverificación — fail-closed
-- ════════════════════════════════════════════════════════════════════════════
-- Si algo de lo de arriba quedó a medias, esta migración NO se da por aplicada.
DO $$
DECLARE
  v_txt text;
BEGIN
  -- La firma vieja de 8 no puede seguir viva: haría ambigua toda llamada de 8.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'turnos_regla_aplica'
      AND p.pronargs = 8
  ) THEN
    RAISE EXCEPTION 'quedó viva la sobrecarga de 8 parámetros de turnos_regla_aplica';
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'turnos_regla_aplica') <> 1 THEN
    RAISE EXCEPTION 'turnos_regla_aplica debe existir exactamente una vez';
  END IF;

  -- generar_bloques_turno conserva sus propiedades.
  SELECT CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END INTO v_txt
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generar_bloques_turno';
  IF v_txt IS DISTINCT FROM 'definer' THEN
    RAISE EXCEPTION 'generar_bloques_turno dejó de ser SECURITY DEFINER (es %)', v_txt;
  END IF;

  -- turnos_regla_aplica sigue siendo IMMUTABLE y SECURITY INVOKER.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'turnos_regla_aplica'
      AND (p.provolatile <> 'i' OR p.prosecdef)
  ) THEN
    RAISE EXCEPTION 'turnos_regla_aplica perdió IMMUTABLE o se volvió SECURITY DEFINER';
  END IF;

  -- El trigger de integridad existe y es BEFORE DELETE FOR EACH ROW.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.bloques_turno'::regclass
      AND tgname  = 'trg_turnos_bloque_borrable'
      AND NOT tgisinternal
      AND (tgtype & 2) = 2      -- BEFORE
      AND (tgtype & 8) = 8      -- DELETE
      AND (tgtype & 1) = 1      -- FOR EACH ROW
  ) THEN
    RAISE EXCEPTION 'falta el trigger BEFORE DELETE FOR EACH ROW trg_turnos_bloque_borrable';
  END IF;

  -- Y nadie de la aplicación puede llamar a mano a la función del trigger.
  IF has_function_privilege('authenticated', 'public.turnos_bloque_borrable()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.turnos_bloque_borrable()', 'EXECUTE') THEN
    RAISE EXCEPTION 'turnos_bloque_borrable no debe ser ejecutable por anon ni authenticated';
  END IF;

  -- excepciones_turno: RLS puesta, forzada, y con sus cuatro policies.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.excepciones_turno'::regclass AND relrowsecurity AND relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'excepciones_turno debe tener RLS habilitada Y forzada';
  END IF;

  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.excepciones_turno'::regclass) <> 4 THEN
    RAISE EXCEPTION 'excepciones_turno debe tener exactamente 4 policies';
  END IF;

  IF has_table_privilege('anon', 'public.excepciones_turno', 'SELECT')
     OR has_table_privilege('anon', 'public.excepciones_turno', 'INSERT')
     OR has_table_privilege('anon', 'public.excepciones_turno', 'UPDATE')
     OR has_table_privilege('anon', 'public.excepciones_turno', 'DELETE')
     OR has_table_privilege('anon', 'public.excepciones_turno', 'TRUNCATE') THEN
    RAISE EXCEPTION 'anon no debe tener ningún privilegio sobre excepciones_turno';
  END IF;

  -- Y `authenticated` tiene el DML, y SÓLO el DML. Lo que sobra aquí no es
  -- ruido: TRUNCATE **no pasa por RLS**, así que heredarlo del ALTER DEFAULT
  -- PRIVILEGES de Supabase sería dejar una vía para vaciar las excepciones de
  -- todas las empresas con las cuatro policies intactas.
  IF has_table_privilege('authenticated', 'public.excepciones_turno', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.excepciones_turno', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.excepciones_turno', 'TRIGGER') THEN
    RAISE EXCEPTION 'authenticated no debe tener TRUNCATE, REFERENCES ni TRIGGER sobre excepciones_turno';
  END IF;

  IF NOT (has_table_privilege('authenticated', 'public.excepciones_turno', 'SELECT')
      AND has_table_privilege('authenticated', 'public.excepciones_turno', 'INSERT')
      AND has_table_privilege('authenticated', 'public.excepciones_turno', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.excepciones_turno', 'DELETE')) THEN
    RAISE EXCEPTION 'authenticated necesita SELECT/INSERT/UPDATE/DELETE sobre excepciones_turno';
  END IF;

  RAISE NOTICE 'turnos: días del mes, excepciones y borrado seguro — autoverificación OK';
END;
$$;
