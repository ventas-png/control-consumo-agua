-- ════════════════════════════════════════════════════════════════════════════
-- Control de asignación de turnos (1/5): plantillas de horario + reglas
--
-- PROBLEMA
-- El módulo sabe QUIÉN es el personal (`personal_condominio`) y sabe que un día
-- concreto alguien tuvo un turno (`bloques_turno`, 20260424000060), pero no sabe
-- —en ninguna parte del esquema— A QUÉ HORA se trabaja ese turno ni cada cuánto
-- le toca a cada quien. Concretamente faltaba todo esto:
--
--   · Una jornada con hora de entrada y salida. `bloques_turno.turno` es una
--     etiqueta ('manana'|'tarde'|'noche') sin horas asociadas, y
--     `plantillas_tarea_cargo` —pese al nombre parecido— son plantillas de
--     TAREAS (título, ícono, orden), no de horario.
--   · Recurrencia. Cada bloque se crea a mano, uno por uno, desde
--     TareasPersonalTab. Programar el mes de un guardia son 30 clics.
--   · Periodicidades largas. `rutas` (agua) ya modela diaria/semanal/mensual
--     (20260522000008) y `programacion_limpieza` diaria/semanal/quincenal/
--     mensual, pero bimestral, trimestral, semestral y anual no existen en
--     ningún lado del repo.
--
-- CÓMO
-- Dos tablas nuevas y una ampliación, con una separación deliberada:
--
--   `plantillas_horario`   el CATÁLOGO de jornadas del condominio ("Diurno
--                          06:00–14:00", "Nocturno 22:00–06:00"). Se define una
--                          vez y se reutiliza.
--   `asignaciones_turno`   la REGLA: a esta persona le toca esta jornada con
--                          esta periodicidad, entre estas fechas.
--   `bloques_turno`        (existente) sigue siendo LA OCURRENCIA: el día
--                          concreto. Se le añaden las horas y el vínculo a la
--                          regla que lo generó.
--
-- POR QUÉ NO UNA TABLA `asignaciones_turno` CON (personal_id, fecha, turno)
-- Porque eso ES `bloques_turno` (20260424000060:18-32), que además ya tiene FK a
-- `personal_condominio` y cuatro consumidores en producción (TareasPersonalTab,
-- RevisionTareasTab, DesempenoPersonalTab, ReporteConsolidadoTab). Duplicarla
-- partiría en dos la respuesta a "¿quién trabaja el martes?": una mitad con
-- checklist y puntaje, otra con recurrencia. La regla es el plan; la ocurrencia
-- se materializa en `bloques_turno` con `origen='recurrencia'` — exactamente la
-- relación que `ruta_ocurrencias` tiene con `rutas` en el módulo de agua.
--
-- VOCABULARIO DE TURNO: no se inventa uno cuarto. El repo ya arrastra tres
-- ('diurno|nocturno|rotativo' en personal_condominio, 'manana|tarde|noche' en
-- bloques_turno, 'mañana|tarde|noche' CON TILDE en bitacora_guardia). La
-- plantilla de horario es la fuente de verdad de la jornada (código libre +
-- horas) y declara a qué etiqueta de `bloques_turno` corresponde, para que el
-- generador escriba un valor coherente. Normalizar `bitacora_guardia` queda
-- fuera de alcance (deuda anotada).
--
-- RLS: `company_id` + `user_has_permission()`, que es el canon del módulo
-- Condominios (~140 tablas). El proyecto NO entra en la policy: en este esquema
-- el scoping por proyecto es de aplicación, tal como documenta
-- 20260729000600:23-28. Añadir can_access_project() aquí haría que estas tablas
-- se comportaran distinto al resto del módulo; si se decide, se hace para todo
-- Condominios en un PR aparte.
--
-- IMPACTO EN DATOS: ninguna fila existente cambia de valor. Se añaden columnas
-- (todas nullable o con DEFAULT) a `bloques_turno` y se reemplaza su policy
-- única `company_rw_bloques_turno` —permisiva por empresa, sin permiso RBAC, la
-- excepción entre sus tablas hermanas— por el juego estándar de cuatro.
--
-- CÓMO REVERTIR
--   DROP TABLE public.asignaciones_turno;
--   DROP TABLE public.plantillas_horario;
--   ALTER TABLE public.bloques_turno
--     DROP COLUMN plantilla_horario_id, DROP COLUMN asignacion_id,
--     DROP COLUMN hora_inicio, DROP COLUMN hora_fin,
--     DROP COLUMN cruza_medianoche, DROP COLUMN horas_planificadas,
--     DROP COLUMN origen;
--   DROP INDEX public.uq_bloques_turno_regla_fecha;
--   -- y re-crear la policy original:
--   CREATE POLICY "company_rw_bloques_turno" ON public.bloques_turno
--     USING (company_id = get_my_company_id())
--     WITH CHECK (company_id = get_my_company_id());
--   DROP FUNCTION public.turnos_sellar_horas();
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP POLICY IF EXISTS antes de cada CREATE POLICY, DO $$ con guard de
-- pg_constraint. No toca datos de negocio.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. plantillas_horario — el catálogo de jornadas ─────────────────────────
CREATE TABLE IF NOT EXISTS public.plantillas_horario (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id             uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  nombre                 text        NOT NULL,
  codigo                 text,
  turno                  text        NOT NULL DEFAULT 'manana',
  hora_inicio            time        NOT NULL,
  hora_fin               time        NOT NULL,
  cruza_medianoche       boolean     NOT NULL DEFAULT false,
  minutos_descanso       int         NOT NULL DEFAULT 0,
  horas_jornada          numeric(5,2),
  tolerancia_entrada_min int         NOT NULL DEFAULT 10,
  color                  text,
  activo                 boolean     NOT NULL DEFAULT true,
  notas                  text,
  creado_por             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plantillas_horario_turno_chk
    CHECK (turno IN ('manana', 'tarde', 'noche')),
  CONSTRAINT plantillas_horario_descanso_chk
    CHECK (minutos_descanso >= 0 AND minutos_descanso < 1440),
  CONSTRAINT plantillas_horario_tolerancia_chk
    CHECK (tolerancia_entrada_min >= 0 AND tolerancia_entrada_min <= 240)
);

COMMENT ON TABLE public.plantillas_horario IS
  'Catálogo de jornadas del condominio (nombre + hora de entrada/salida + descanso). Las asignaciones apuntan aquí en vez de repetir horas fila a fila.';
COMMENT ON COLUMN public.plantillas_horario.codigo IS
  'Etiqueta corta para la grilla del calendario (D, N, M1…). Libre; si es NULL la UI usa la inicial del nombre.';
COMMENT ON COLUMN public.plantillas_horario.turno IS
  'Etiqueta con la que el generador rellena bloques_turno.turno. No es un cuarto vocabulario: es el puente hacia el que esa tabla ya usa.';
COMMENT ON COLUMN public.plantillas_horario.cruza_medianoche IS
  'true cuando la jornada termina al día siguiente (22:00→06:00). Sin esto el cómputo de horas da negativo y se pierde el turno nocturno entero.';
COMMENT ON COLUMN public.plantillas_horario.horas_jornada IS
  'Horas efectivas (fin - inicio - descanso), selladas por trg_turnos_sellar_horas. Derivada: no la escribe el cliente.';
COMMENT ON COLUMN public.plantillas_horario.tolerancia_entrada_min IS
  'Minutos de gracia antes de contar tardanza. Solo lo lee el cómputo de horas; no bloquea el marcaje.';
COMMENT ON COLUMN public.plantillas_horario.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

CREATE INDEX IF NOT EXISTS idx_plantillas_horario_project
  ON public.plantillas_horario(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_plantillas_horario_activo
  ON public.plantillas_horario(project_id, activo);

-- ── 2. asignaciones_turno — la regla recurrente ─────────────────────────────
-- El vocabulario de `frecuencia` extiende el de `rutas` (20260522000008), no
-- inventa uno nuevo: diaria/semanal/mensual se llaman igual. Lo que se añade es
-- lo que faltaba en todo el repo — quincenal ya existía en limpieza, y
-- bimestral/trimestral/semestral/anual no existían en ninguna parte.
CREATE TABLE IF NOT EXISTS public.asignaciones_turno (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id               uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  personal_id              uuid        NOT NULL REFERENCES public.personal_condominio(id) ON DELETE CASCADE,
  plantilla_horario_id     uuid        NOT NULL REFERENCES public.plantillas_horario(id) ON DELETE RESTRICT,
  nombre                   text,
  frecuencia               text        NOT NULL DEFAULT 'semanal',
  dias_semana              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  intervalo_dias           int,
  dia_mes                  int,
  mes_ancla                int,
  fechas_especificas       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  fecha_inicio             date        NOT NULL,
  fecha_fin                date,
  cubre_dias_no_laborables boolean     NOT NULL DEFAULT false,
  activa                   boolean     NOT NULL DEFAULT true,
  notas                    text,
  creado_por               uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asignaciones_turno_frecuencia_chk
    CHECK (frecuencia IN (
      'unica', 'diaria', 'semanal', 'quincenal', 'mensual',
      'bimestral', 'trimestral', 'semestral', 'anual', 'fechas'
    )),
  CONSTRAINT asignaciones_turno_rango_chk
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
  CONSTRAINT asignaciones_turno_intervalo_chk
    CHECK (intervalo_dias IS NULL OR (intervalo_dias >= 1 AND intervalo_dias <= 365)),
  CONSTRAINT asignaciones_turno_dia_mes_chk
    CHECK (dia_mes IS NULL OR (dia_mes >= 1 AND dia_mes <= 31)),
  CONSTRAINT asignaciones_turno_mes_ancla_chk
    CHECK (mes_ancla IS NULL OR (mes_ancla >= 1 AND mes_ancla <= 12)),
  CONSTRAINT asignaciones_turno_dias_semana_chk
    CHECK (jsonb_typeof(dias_semana) = 'array'),
  CONSTRAINT asignaciones_turno_fechas_chk
    CHECK (jsonb_typeof(fechas_especificas) = 'array')
);

COMMENT ON TABLE public.asignaciones_turno IS
  'REGLA de cobertura: a esta persona le toca esta jornada con esta periodicidad. No es la ocurrencia — el día concreto se materializa en bloques_turno (origen=recurrencia).';
COMMENT ON COLUMN public.asignaciones_turno.frecuencia IS
  'unica | diaria | semanal | quincenal | mensual | bimestral | trimestral | semestral | anual | fechas. Extiende el vocabulario de rutas (20260522000008); las cuatro largas son nuevas en el repo.';
COMMENT ON COLUMN public.asignaciones_turno.dias_semana IS
  'Días ISO 1..7 (1=lunes, 7=domingo) para semanal/quincenal, p. ej. [1,2,3,4,5]. Mismo formato que rutas.dias_semana. Vacío en semanal = todos los días.';
COMMENT ON COLUMN public.asignaciones_turno.intervalo_dias IS
  'Solo frecuencia=diaria: cada cuántos días (2 = día sí, día no). NULL o 1 = todos los días.';
COMMENT ON COLUMN public.asignaciones_turno.dia_mes IS
  'Día del mes para mensual/bimestral/trimestral/semestral/anual. Si el mes es más corto se usa el último día real (31 en febrero → 28/29).';
COMMENT ON COLUMN public.asignaciones_turno.mes_ancla IS
  'Mes de referencia (1..12) desde el que se cuentan los saltos de bimestral/trimestral/semestral/anual. NULL = el mes de fecha_inicio.';
COMMENT ON COLUMN public.asignaciones_turno.fechas_especificas IS
  'Fechas ISO sueltas ["2026-09-15", …] para frecuencia=fechas. Mismo formato que rutas.fechas_especificas.';
COMMENT ON COLUMN public.asignaciones_turno.cubre_dias_no_laborables IS
  'false (por defecto) = la regla se salta festivos y asuetos. true = se cubre igual (garita, planta de bombeo) y el cómputo de horas le aplica el factor de recargo del día.';
COMMENT ON COLUMN public.asignaciones_turno.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

CREATE INDEX IF NOT EXISTS idx_asignaciones_turno_project
  ON public.asignaciones_turno(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_asignaciones_turno_personal
  ON public.asignaciones_turno(personal_id, activa);
CREATE INDEX IF NOT EXISTS idx_asignaciones_turno_vigencia
  ON public.asignaciones_turno(activa, fecha_inicio, fecha_fin);

-- ── 3. bloques_turno: horas de la ocurrencia + vínculo con la regla ─────────
ALTER TABLE public.bloques_turno
  ADD COLUMN IF NOT EXISTS plantilla_horario_id uuid REFERENCES public.plantillas_horario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asignacion_id        uuid REFERENCES public.asignaciones_turno(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hora_inicio          time,
  ADD COLUMN IF NOT EXISTS hora_fin             time,
  ADD COLUMN IF NOT EXISTS cruza_medianoche     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS horas_planificadas   numeric(5,2),
  ADD COLUMN IF NOT EXISTS origen               text    NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.bloques_turno.plantilla_horario_id IS
  'Jornada que rige este bloque. NULL en los bloques históricos anteriores a esta migración, que no tenían horas.';
COMMENT ON COLUMN public.bloques_turno.asignacion_id IS
  'Regla recurrente que generó el bloque. NULL = alta manual. Es la clave de idempotencia del generador.';
COMMENT ON COLUMN public.bloques_turno.horas_planificadas IS
  'Horas que el bloque debía cubrir (derivada de hora_inicio/hora_fin, la sella trg_turnos_sellar_horas). Contra ella se comparan las horas marcadas para sacar las extras.';
COMMENT ON COLUMN public.bloques_turno.origen IS
  'manual | recurrencia. Distingue el bloque que puso una persona del que materializó generar_bloques_turno(), para poder re-generar sin pisar decisiones manuales.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bloques_turno_origen_chk'
  ) THEN
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_origen_chk CHECK (origen IN ('manual', 'recurrencia'));
  END IF;

  -- NOT VALID a propósito: la tabla es de 2026-04 y nadie garantiza qué valores
  -- entraron antes de que existiera el CHECK. Se exige a las filas nuevas sin
  -- arriesgar que la migración falle por histórico sucio.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bloques_turno_turno_chk'
  ) THEN
    ALTER TABLE public.bloques_turno
      ADD CONSTRAINT bloques_turno_turno_chk
      CHECK (turno IN ('manana', 'tarde', 'noche')) NOT VALID;
  END IF;
END;
$$;

-- Idempotencia del generador. Parcial (WHERE asignacion_id IS NOT NULL) por dos
-- motivos: los bloques manuales históricos pueden estar duplicados y un índice
-- total haría fallar la migración, y un mismo empleado sí puede tener dos
-- bloques manuales el mismo día (doblar turno) — lo que no puede es que una
-- regla materialice dos veces el mismo día.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bloques_turno_regla_fecha
  ON public.bloques_turno(asignacion_id, personal_id, fecha)
  WHERE asignacion_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bloques_turno_fecha_personal
  ON public.bloques_turno(project_id, fecha, personal_id);

-- ── 4. Sellado de las horas derivadas ───────────────────────────────────────
-- Va en trigger y no en columna generada porque el mismo cálculo se aplica a dos
-- tablas con columnas de nombre distinto, y porque una GENERATED ALWAYS exige
-- que la expresión sea inmutable de forma verificable — condición que se cumple
-- hoy pero que ata la tabla a no poder cambiar la fórmula sin re-escribirla.
CREATE OR REPLACE FUNCTION public.turnos_horas_jornada(
  p_inicio   time,
  p_fin      time,
  p_cruza    boolean,
  p_descanso int
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_inicio IS NULL OR p_fin IS NULL THEN NULL
    ELSE GREATEST(
      ROUND(
        (
          EXTRACT(EPOCH FROM p_fin) - EXTRACT(EPOCH FROM p_inicio)
          -- Un fin <= inicio solo puede significar que cruzó la medianoche,
          -- aunque nadie haya marcado la bandera. Es el bug que hoy hace
          -- desaparecer los turnos nocturnos de PresenciaPersonalTab.
          + CASE WHEN COALESCE(p_cruza, false) OR p_fin <= p_inicio THEN 86400 ELSE 0 END
        ) / 3600.0
        - COALESCE(p_descanso, 0) / 60.0
      , 2),
      0
    )
  END
$$;

COMMENT ON FUNCTION public.turnos_horas_jornada(time, time, boolean, int) IS
  'Horas efectivas de una jornada, descontando el descanso y sumando 24 h cuando cruza la medianoche (explícitamente o porque fin <= inicio).';

REVOKE EXECUTE ON FUNCTION public.turnos_horas_jornada(time, time, boolean, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_horas_jornada(time, time, boolean, int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.turnos_sellar_horas()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_col_horas text := TG_ARGV[0];
  v_descanso  int  := 0;
BEGIN
  -- `bloques_turno` no tiene columna de descanso propia: lo hereda de su
  -- plantilla. Si no hay plantilla, la jornada se cuenta completa.
  IF TG_TABLE_NAME = 'bloques_turno' THEN
    SELECT ph.minutos_descanso INTO v_descanso
    FROM public.plantillas_horario ph
    WHERE ph.id = NEW.plantilla_horario_id;
  ELSE
    v_descanso := COALESCE(NEW.minutos_descanso, 0);
  END IF;

  NEW := jsonb_populate_record(NEW, jsonb_build_object(
    v_col_horas,
    public.turnos_horas_jornada(
      NEW.hora_inicio, NEW.hora_fin, NEW.cruza_medianoche, COALESCE(v_descanso, 0)
    )
  ));
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.turnos_sellar_horas() IS
  'Trigger BEFORE INSERT OR UPDATE: sella TG_ARGV[0] con las horas efectivas de la jornada. La columna es derivada — lo que mande el cliente se ignora.';

DROP TRIGGER IF EXISTS trg_turnos_sellar_horas ON public.plantillas_horario;
CREATE TRIGGER trg_turnos_sellar_horas
  BEFORE INSERT OR UPDATE ON public.plantillas_horario
  FOR EACH ROW EXECUTE FUNCTION public.turnos_sellar_horas('horas_jornada');

DROP TRIGGER IF EXISTS trg_turnos_sellar_horas ON public.bloques_turno;
CREATE TRIGGER trg_turnos_sellar_horas
  BEFORE INSERT OR UPDATE ON public.bloques_turno
  FOR EACH ROW EXECUTE FUNCTION public.turnos_sellar_horas('horas_planificadas');

-- ── 5. Trazabilidad y bitácora ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.plantillas_horario;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.plantillas_horario
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.asignaciones_turno;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.asignaciones_turno
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- Solo la regla lleva bitácora legible: es la decisión ("a Pérez le toca el
-- nocturno de lunes a viernes"). El catálogo de jornadas es configuración, y
-- las ocurrencias las genera el cron —que no tiene auth.uid()— así que
-- registrar_bitacora las descartaría igual.
DROP TRIGGER IF EXISTS trg_bitacora ON public.asignaciones_turno;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.asignaciones_turno
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora('Turnos', 'nombre,frecuencia', '', '');

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
-- Patrón canónico del módulo (20260807130000:143-185): company_id + permiso
-- RBAC en SELECT/INSERT/UPDATE; DELETE por rol legacy. `user_has_permission()`
-- va envuelta en (SELECT …) y DESPUÉS del chequeo de empresa para que el planner
-- la evalúe una vez por sentencia (20260818000000:13-16).
ALTER TABLE public.plantillas_horario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asignaciones_turno ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plantillas_horario_select" ON public.plantillas_horario;
CREATE POLICY "plantillas_horario_select" ON public.plantillas_horario
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "plantillas_horario_insert" ON public.plantillas_horario;
CREATE POLICY "plantillas_horario_insert" ON public.plantillas_horario
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "plantillas_horario_update" ON public.plantillas_horario;
CREATE POLICY "plantillas_horario_update" ON public.plantillas_horario
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "plantillas_horario_delete" ON public.plantillas_horario;
CREATE POLICY "plantillas_horario_delete" ON public.plantillas_horario
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

DROP POLICY IF EXISTS "asignaciones_turno_select" ON public.asignaciones_turno;
CREATE POLICY "asignaciones_turno_select" ON public.asignaciones_turno
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "asignaciones_turno_insert" ON public.asignaciones_turno;
CREATE POLICY "asignaciones_turno_insert" ON public.asignaciones_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "asignaciones_turno_update" ON public.asignaciones_turno;
CREATE POLICY "asignaciones_turno_update" ON public.asignaciones_turno
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "asignaciones_turno_delete" ON public.asignaciones_turno;
CREATE POLICY "asignaciones_turno_delete" ON public.asignaciones_turno
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

-- ── 7. bloques_turno: al patrón RBAC del módulo ─────────────────────────────
-- La tabla era la excepción: su única policy `company_rw_bloques_turno`
-- (20260424000060:74-76) es FOR ALL y solo comprueba la empresa, mientras sus
-- hermanas (personal_condominio, presencia_personal, plantillas_tarea_cargo,
-- tareas_bloque) llevan permiso RBAC desde 20260518000010/20260519000002.
--
-- Se acepta CUALQUIERA de las dos claves —la del tab que hoy la escribe y la del
-- tab nuevo— a propósito: gatearla solo con `turnos` le quitaría el acceso a los
-- roles que hoy administran el checklist desde "Tareas por turno".
DROP POLICY IF EXISTS "company_rw_bloques_turno" ON public.bloques_turno;

DROP POLICY IF EXISTS "bloques_turno_select" ON public.bloques_turno;
CREATE POLICY "bloques_turno_select" ON public.bloques_turno
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "bloques_turno_insert" ON public.bloques_turno;
CREATE POLICY "bloques_turno_insert" ON public.bloques_turno
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "bloques_turno_update" ON public.bloques_turno;
CREATE POLICY "bloques_turno_update" ON public.bloques_turno
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.tareas_personal')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "bloques_turno_delete" ON public.bloques_turno;
CREATE POLICY "bloques_turno_delete" ON public.bloques_turno
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );
