-- ════════════════════════════════════════════════════════════════════════════
-- Control de asignación de turnos (2/5): calendario laboral y ausencias
--
-- PROBLEMA
-- 1. DÍAS FESTIVOS: no existen en el esquema. `grep -i "festivo|feriado|asueto"`
--    sobre supabase/migrations/ no devuelve una sola tabla ni columna de
--    negocio. Un turno programado el 15 de septiembre se genera como cualquier
--    martes, y las horas de ese día se pagan como ordinarias.
--
-- 2. VACACIONES / PERMISOS / SUSPENSIONES: existen solo como BANDERA de un día,
--    nunca como rango.
--      · `personal_condominio.estado='vacaciones'` (20260420000004:157) es un
--        toggle de un clic (PersonalTab.tsx:161-165): sin fecha de inicio, sin
--        fecha de fin, sin días acumulados. Nadie sabe cuándo vuelve.
--      · `presencia_personal.estado='permiso'|'vacaciones'` (20260420000020:95)
--        es un día suelto que hay que teclear uno por uno.
--      · SUSPENSIÓN no existe: lo único con ese nombre es
--        stamp_company_suspension() (suspensión de la empresa cliente) y la
--        etapa de cobranza `suspension_servicios`, ninguna relacionada.
--
-- 3. `presencia_personal` NO APUNTA AL EMPLEADO. Guarda `nombre text` libre
--    (20260420000020:89), tecleado a mano en un <input>. Mientras siga así, el
--    cómputo de horas por persona es literalmente imposible: "Juan Pérez",
--    "juan perez" y "J. Pérez" son tres empleados distintos.
--
-- CÓMO
-- Dos tablas nuevas y una FK que faltaba:
--   `dias_no_laborables`   festivos, asuetos locales y suspensiones de labores,
--                          con el factor de recargo que se paga si se trabaja.
--   `ausencias_personal`   vacaciones, permisos (con y sin goce), incapacidad,
--                          suspensión y faltas, CON RANGO y con aprobación.
--   `presencia_personal`   += personal_id, bloque_id (con backfill por nombre).
--
-- POR QUÉ NO UNA TABLA ÚNICA `calendario_laboral`
-- Porque el alcance difiere: el festivo es del proyecto y afecta a todos; la
-- ausencia es de una persona y necesita aprobación, documento y goce de salario.
-- Meterlas juntas obligaría a dejar en NULL media tabla en cada fila y a gatear
-- ambas con el mismo permiso — cuando aprobar vacaciones y declarar un asueto
-- son decisiones de personas distintas.
--
-- ESTADO DEL EMPLEADO: DERIVADO, PERO SIN PISAR DECISIONES MANUALES
-- `personal_condominio.estado` pasa a sincronizarse desde la ausencia vigente,
-- porque `estaDisponible()` (domain/condominios/limpieza.ts:48-50) decide la
-- ruta de limpieza con `estado === 'activo'`: sin esto, la ruta seguiría
-- asignándole áreas a alguien de vacaciones. Pero la sincronización es
-- deliberadamente conservadora, y solo se mueve entre tres valores:
--
--     activo  ⇄  vacaciones        (ausencia tipo vacaciones vigente)
--     activo  ⇄  incapacidad       (ausencia tipo incapacidad vigente)
--
--   · 'inactivo' NUNCA se toca. Es ambiguo entre "suspendido" y "ya no trabaja
--     aquí", y resucitar a un empleado dado de baja porque se le venció una
--     ausencia sería peor que el problema que esto resuelve.
--   · Permisos, suspensiones y faltas NO mueven el expediente: se reflejan en el
--     calendario y en el cómputo de horas, que es donde importan.
--
-- IMPACTO EN DATOS: `personal_condominio.estado` puede cambiar de 'vacaciones' a
-- 'activo' en empleados cuya bandera quedó encendida y que no tengan ninguna
-- ausencia registrada — pero solo la primera vez que se toque una ausencia suya,
-- nunca de forma masiva (no hay backfill de estados). El resto son columnas
-- nuevas nullable. Ninguna fila se borra.
--
-- CÓMO REVERTIR
--   DROP TABLE public.ausencias_personal;
--   DROP TABLE public.dias_no_laborables;
--   ALTER TABLE public.presencia_personal
--     DROP COLUMN personal_id, DROP COLUMN bloque_id;
--   DROP FUNCTION public.sincronizar_estado_personal(uuid);
--   DROP FUNCTION public.fn_sincronizar_estado_personal();
--   -- las policies previas de presencia_personal no se tocan en esta migración
--
-- Idempotente: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- DROP TRIGGER IF EXISTS antes de CREATE TRIGGER, backfill con WHERE que lo
-- vuelve no-op en la segunda pasada.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. dias_no_laborables ───────────────────────────────────────────────────
-- `project_id` es NOT NULL, no nullable-para-toda-la-empresa. Motivo: el loader
-- del módulo filtra SIEMPRE por `.eq('project_id', pid).eq('company_id', cid)`
-- —lo verifica sectionDataScope.test.ts— y una fila con project_id NULL sería
-- invisible para él. Un asueto local además legítimamente difiere entre
-- condominios; la UI ofrece copiar el calendario de un proyecto a otro.
CREATE TABLE IF NOT EXISTS public.dias_no_laborables (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id     uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  fecha          date        NOT NULL,
  nombre         text        NOT NULL,
  tipo           text        NOT NULL DEFAULT 'festivo_nacional',
  recurre_anual  boolean     NOT NULL DEFAULT false,
  paga_recargo   boolean     NOT NULL DEFAULT true,
  factor_recargo numeric(4,2) NOT NULL DEFAULT 2.00,
  notas          text,
  creado_por     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dias_no_laborables_tipo_chk
    CHECK (tipo IN ('festivo_nacional', 'asueto_local', 'suspension_labores', 'dia_no_laboral')),
  CONSTRAINT dias_no_laborables_factor_chk
    CHECK (factor_recargo >= 1.00 AND factor_recargo <= 5.00)
);

COMMENT ON TABLE public.dias_no_laborables IS
  'Calendario laboral del condominio: festivos, asuetos locales y suspensiones de labores. Las reglas de turno se los saltan salvo que declaren cubre_dias_no_laborables.';
COMMENT ON COLUMN public.dias_no_laborables.tipo IS
  'festivo_nacional | asueto_local | suspension_labores | dia_no_laboral. El último cubre el descanso semanal declarado (p. ej. un domingo que este condominio no opera).';
COMMENT ON COLUMN public.dias_no_laborables.recurre_anual IS
  'true en las fechas fijas del calendario (1 de enero, 1 de mayo). La UI ofrece clonarlas al año siguiente; no se materializan solas.';
COMMENT ON COLUMN public.dias_no_laborables.paga_recargo IS
  'true = trabajar ese día se paga con recargo. false = día libre sin más (el cómputo lo cuenta como ordinario si alguien lo cubre).';
COMMENT ON COLUMN public.dias_no_laborables.factor_recargo IS
  'Multiplicador que aplica el cómputo de horas a lo trabajado ese día. 2.00 = día doble, que es el mínimo de ley en Guatemala para asueto trabajado.';
COMMENT ON COLUMN public.dias_no_laborables.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_dias_no_laborables_fecha
  ON public.dias_no_laborables(project_id, fecha);
CREATE INDEX IF NOT EXISTS idx_dias_no_laborables_project
  ON public.dias_no_laborables(project_id, company_id);

-- ── 2. ausencias_personal ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ausencias_personal (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id    uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  personal_id   uuid        NOT NULL REFERENCES public.personal_condominio(id) ON DELETE CASCADE,
  tipo          text        NOT NULL DEFAULT 'vacaciones',
  fecha_inicio  date        NOT NULL,
  fecha_fin     date        NOT NULL,
  dias_habiles  numeric(5,1),
  goce_salario  boolean     NOT NULL DEFAULT true,
  estado        text        NOT NULL DEFAULT 'solicitada',
  motivo        text,
  documento_url text,
  aprobada_por  uuid        REFERENCES public.app_users(id) ON DELETE SET NULL,
  aprobada_en   timestamptz,
  creado_por    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ausencias_personal_tipo_chk
    CHECK (tipo IN (
      'vacaciones', 'permiso_goce', 'permiso_sin_goce',
      'incapacidad', 'suspension', 'falta', 'licencia'
    )),
  CONSTRAINT ausencias_personal_estado_chk
    CHECK (estado IN ('solicitada', 'aprobada', 'rechazada', 'cancelada')),
  CONSTRAINT ausencias_personal_rango_chk
    CHECK (fecha_fin >= fecha_inicio)
);

COMMENT ON TABLE public.ausencias_personal IS
  'Ausencias del personal CON RANGO: vacaciones, permisos, incapacidad, suspensión y faltas. Sustituye a la bandera de un día de personal_condominio.estado, que no sabía cuándo vuelve la persona.';
COMMENT ON COLUMN public.ausencias_personal.tipo IS
  'vacaciones | permiso_goce | permiso_sin_goce | incapacidad | suspension | falta | licencia. Solo vacaciones e incapacidad mueven personal_condominio.estado (ver cabecera).';
COMMENT ON COLUMN public.ausencias_personal.dias_habiles IS
  'Días que consume la ausencia descontando festivos y días sin turno. Lo calcula la UI al guardar; es el número que se descuenta del saldo de vacaciones.';
COMMENT ON COLUMN public.ausencias_personal.goce_salario IS
  'Si la ausencia se paga. Independiente del tipo porque una suspensión puede ser con o sin goce según el reglamento interno.';
COMMENT ON COLUMN public.ausencias_personal.estado IS
  'solicitada | aprobada | rechazada | cancelada. SOLO las aprobadas bloquean la generación de turnos y mueven el estado del expediente.';
COMMENT ON COLUMN public.ausencias_personal.aprobada_por IS
  'Quién autorizó. Lo sella la BD al pasar a estado aprobada (trg_sellar_aprobacion), junto con aprobada_en.';
COMMENT ON COLUMN public.ausencias_personal.creado_por IS
  'Usuario que creó la fila. Lo sella la BD (trg_sellar_creado_por) y es inmutable. NULL = escritura de sistema.';

CREATE INDEX IF NOT EXISTS idx_ausencias_personal_project
  ON public.ausencias_personal(project_id, company_id);
CREATE INDEX IF NOT EXISTS idx_ausencias_personal_persona
  ON public.ausencias_personal(personal_id, fecha_inicio DESC);
-- Índice de la pregunta que más se hace: "¿está ausente el día X?".
CREATE INDEX IF NOT EXISTS idx_ausencias_personal_vigencia
  ON public.ausencias_personal(personal_id, estado, fecha_inicio, fecha_fin);

-- ── 3. presencia_personal: la FK que faltaba ────────────────────────────────
ALTER TABLE public.presencia_personal
  ADD COLUMN IF NOT EXISTS personal_id uuid REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bloque_id   uuid REFERENCES public.bloques_turno(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.presencia_personal.personal_id IS
  'Empleado del expediente. Nullable a propósito: la tabla también registra a quien no está en plantilla (mismo criterio que ejecuciones_limpieza.responsable). `nombre` se conserva y sigue siendo obligatorio.';
COMMENT ON COLUMN public.presencia_personal.bloque_id IS
  'Turno planificado contra el que se compara este marcaje. NULL = marcaje sin turno asignado; sus horas cuentan como extra no planificada.';

CREATE INDEX IF NOT EXISTS idx_presencia_personal_persona
  ON public.presencia_personal(personal_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_presencia_personal_bloque
  ON public.presencia_personal(bloque_id);

-- Backfill best-effort por nombre exacto dentro del mismo proyecto. Se salta a
-- propósito los nombres ambiguos (dos empleados que se llaman igual): atar el
-- marcaje al empleado equivocado es peor que dejarlo sin atar, porque el error
-- aparecería como horas extra de otra persona. Lo que quede en NULL se resuelve
-- desde la UI, que a partir de ahora graba `personal_id` de entrada.
UPDATE public.presencia_personal pp
SET personal_id = pc.id
FROM public.personal_condominio pc
WHERE pp.personal_id IS NULL
  AND pc.project_id = pp.project_id
  AND lower(btrim(pc.nombre)) = lower(btrim(pp.nombre))
  AND NOT EXISTS (
    SELECT 1 FROM public.personal_condominio otro
    WHERE otro.project_id = pp.project_id
      AND otro.id <> pc.id
      AND lower(btrim(otro.nombre)) = lower(btrim(pp.nombre))
  );

-- ── 4. Estado del expediente derivado de la ausencia vigente ────────────────
CREATE OR REPLACE FUNCTION public.sincronizar_estado_personal(p_personal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actual text;
  v_nuevo  text;
BEGIN
  IF p_personal_id IS NULL THEN
    RETURN;
  END IF;

  SELECT estado INTO v_actual
  FROM public.personal_condominio
  WHERE id = p_personal_id;

  -- 'inactivo' es terminal: puede significar "ya no trabaja aquí" y ninguna
  -- ausencia vencida debe resucitar a alguien dado de baja. Ver cabecera.
  IF v_actual IS NULL OR v_actual = 'inactivo' THEN
    RETURN;
  END IF;

  -- La incapacidad manda sobre las vacaciones cuando se solapan: es la que
  -- tiene consecuencias legales y de cobertura.
  SELECT CASE a.tipo WHEN 'incapacidad' THEN 'incapacidad' ELSE 'vacaciones' END
  INTO v_nuevo
  FROM public.ausencias_personal a
  WHERE a.personal_id = p_personal_id
    AND a.estado = 'aprobada'
    AND a.tipo IN ('vacaciones', 'incapacidad')
    AND CURRENT_DATE BETWEEN a.fecha_inicio AND a.fecha_fin
  ORDER BY (a.tipo = 'incapacidad') DESC
  LIMIT 1;

  -- Sin ausencia vigente, solo se devuelve a 'activo' a quien esté justamente en
  -- uno de los dos estados que esta función administra.
  IF v_nuevo IS NULL THEN
    IF v_actual IN ('vacaciones', 'incapacidad') THEN
      v_nuevo := 'activo';
    ELSE
      RETURN;
    END IF;
  END IF;

  IF v_nuevo IS DISTINCT FROM v_actual THEN
    UPDATE public.personal_condominio SET estado = v_nuevo WHERE id = p_personal_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sincronizar_estado_personal(uuid) IS
  'Alinea personal_condominio.estado con la ausencia aprobada vigente hoy. Solo se mueve entre activo/vacaciones/incapacidad; nunca toca inactivo. Evita que la ruta de limpieza (estaDisponible) asigne áreas a alguien de vacaciones.';

REVOKE EXECUTE ON FUNCTION public.sincronizar_estado_personal(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sincronizar_estado_personal(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_sincronizar_estado_personal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- AFTER, y envuelto: si la sincronización falla, la ausencia se guarda igual.
  -- Un derivado que tumba la escritura es peor que un derivado desfasado.
  BEGIN
    PERFORM public.sincronizar_estado_personal(COALESCE(NEW.personal_id, OLD.personal_id));
    IF TG_OP = 'UPDATE' AND NEW.personal_id IS DISTINCT FROM OLD.personal_id THEN
      PERFORM public.sincronizar_estado_personal(OLD.personal_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.fn_sincronizar_estado_personal() IS
  'Trigger AFTER sobre ausencias_personal: recalcula el estado del expediente. Nunca aborta la escritura de la ausencia.';

DROP TRIGGER IF EXISTS trg_sincronizar_estado_personal ON public.ausencias_personal;
CREATE TRIGGER trg_sincronizar_estado_personal
  AFTER INSERT OR UPDATE OR DELETE ON public.ausencias_personal
  FOR EACH ROW EXECUTE FUNCTION public.fn_sincronizar_estado_personal();

-- ── 5. Trazabilidad y bitácora ──────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.dias_no_laborables;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.dias_no_laborables
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.ausencias_personal;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.ausencias_personal
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- Quién autorizó la ausencia y cuándo: es el hito que audita una suspensión o
-- unas vacaciones, y no lo captura `creado_por` (lo normal es que quien la
-- solicita no sea quien la aprueba). BEFORE UPDATE —y no INSERT— porque
-- `sellar_cierre` está escrita contra OLD y así se usa en el resto del repo
-- (20260807130000:200-202); el alta directa en estado aprobada la sella la UI.
DROP TRIGGER IF EXISTS trg_sellar_cierre ON public.ausencias_personal;
CREATE TRIGGER trg_sellar_cierre
  BEFORE UPDATE ON public.ausencias_personal
  FOR EACH ROW EXECUTE FUNCTION public.sellar_cierre('aprobada_en', 'aprobada_por');

DROP TRIGGER IF EXISTS trg_bitacora ON public.dias_no_laborables;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.dias_no_laborables
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora('Turnos', 'nombre,tipo', '', '');

DROP TRIGGER IF EXISTS trg_bitacora ON public.ausencias_personal;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.ausencias_personal
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora('Turnos', 'motivo,tipo', '', '');

-- ── 6. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.dias_no_laborables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ausencias_personal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dias_no_laborables_select" ON public.dias_no_laborables;
CREATE POLICY "dias_no_laborables_select" ON public.dias_no_laborables
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "dias_no_laborables_insert" ON public.dias_no_laborables;
CREATE POLICY "dias_no_laborables_insert" ON public.dias_no_laborables
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')))
  );

DROP POLICY IF EXISTS "dias_no_laborables_update" ON public.dias_no_laborables;
CREATE POLICY "dias_no_laborables_update" ON public.dias_no_laborables
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')))
  );

DROP POLICY IF EXISTS "dias_no_laborables_delete" ON public.dias_no_laborables;
CREATE POLICY "dias_no_laborables_delete" ON public.dias_no_laborables
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );

-- La generación de turnos necesita LEER las ausencias para saltárselas, así que
-- SELECT acepta también la clave de `turnos`. Crear y aprobar una ausencia, no:
-- eso es exclusivamente del tab de ausencias.
DROP POLICY IF EXISTS "ausencias_personal_select" ON public.ausencias_personal;
CREATE POLICY "ausencias_personal_select" ON public.ausencias_personal
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')
             OR public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "ausencias_personal_insert" ON public.ausencias_personal;
CREATE POLICY "ausencias_personal_insert" ON public.ausencias_personal
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')))
  );

DROP POLICY IF EXISTS "ausencias_personal_update" ON public.ausencias_personal;
CREATE POLICY "ausencias_personal_update" ON public.ausencias_personal
  FOR UPDATE TO authenticated
  USING (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')))
  )
  WITH CHECK (
    public.is_super_admin()
    OR (company_id = public.get_my_company_id()
        AND (SELECT public.user_has_permission('condominios.tab.ausencias')))
  );

DROP POLICY IF EXISTS "ausencias_personal_delete" ON public.ausencias_personal;
CREATE POLICY "ausencias_personal_delete" ON public.ausencias_personal
  FOR DELETE TO authenticated
  USING (
    public.is_super_admin()
    OR (public.current_user_role() = ANY(ARRAY['company_owner', 'admin'])
        AND company_id = public.get_my_company_id())
  );
