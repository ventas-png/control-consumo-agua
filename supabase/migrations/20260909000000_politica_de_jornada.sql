-- ════════════════════════════════════════════════════════════════════════════
-- La vara: qué se espera de cada jornada (Fase 1)
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. El sistema ya sabe qué pasó —entrada, salida, pausas por tipo con su
-- duración real— y ya sabe cuántas horas se planificaron. Lo que NO sabe es qué
-- se esperaba en lo demás:
--
--   · Cuánto descanso da esta jornada, y de qué tipo. Hoy hay UN número
--     (`plantillas_horario.minutos_descanso`) sin tipos, y un `minutos_max` en
--     el catálogo de pausas que es de la EMPRESA y puramente orientativo: nadie
--     lo compara con nada. Un turno de 12 h de noche y uno de 8 h de oficina no
--     tienen por qué dar la misma cena.
--   · Cuánta demora se tolera, y qué pasa cuando se pasa de ahí. Hoy
--     `tolerancia_entrada_min` marca la fila como «tardanza» y ahí muere: es una
--     etiqueta sin consecuencia.
--   · Si irse antes cuenta como salida temprana, y desde cuándo.
--   · Si la hora extra necesita autorizarse ANTES. Hoy no existe autorización de
--     ninguna clase: `calcular_horas_personal` deriva las extras solas, así que
--     quien se queda de más —o quien olvida marcar su salida— genera extra que
--     nadie pidió.
--
-- ESTA MIGRACIÓN NO TIENE EFECTOS, y eso es deliberado. Solo DECLARA la vara.
-- Ninguna función de cómputo la lee todavía; `calcular_horas_personal` devuelve
-- exactamente los mismos números que devolvía ayer. Medir contra la vara (fase
-- 2) y aplicar consecuencias (fase 4) van aparte, y en ese orden, porque antes
-- de que un número cambie lo que se paga hay que poder mirar un mes real de
-- comparaciones y decir «sí, esto es correcto».
--
-- LOS TRES TRAMOS DE LA DEMORA, y por qué no se inventa un vocabulario nuevo:
--
--   [0, tolerancia_entrada_min]              no pasa nada        ← YA EXISTÍA
--   (tolerancia, demora_compensable_hasta]   se compensa
--   (demora_compensable_hasta, ∞)            se debita
--
-- El primer tramo es la tolerancia que ya usa `presencia_marcar` para decidir la
-- tardanza. Agregar un segundo umbral de «gracia» habría dejado dos varas
-- distintas para lo mismo y, tarde o temprano, divergiendo.
--
-- `demora_compensable_hasta_min = 0` significa que no hay tramo compensable: la
-- demora pasa directo a débito en cuanto se sale de la tolerancia. Es el default
-- porque el número lo pone quien decide la política, no esta migración.
--
-- LA VARA SE CONGELA EN EL BLOQUE. `bloques_turno.politica` guarda la foto de la
-- jornada al materializar el día. Mismo criterio que `descuenta` en
-- `presencia_pausas` (20260908000300) y que `horas_planificadas`, que ya es un
-- sellado de la plantilla: cambiar la jornada mañana no puede reescribir contra
-- qué se midió un mes ya cerrado.
--
-- LOS BLOQUES VIEJOS SE QUEDAN SIN VARA, a propósito. No se rellenan hacia atrás:
-- aplicarles la política de hoy sería exactamente la reescritura que el párrafo
-- anterior prohíbe. `politica IS NULL` se lee «esta jornada se planificó antes
-- de que existiera la vara», que es la verdad.
--
-- EL TIPO DEL CUPO NO TIENE FK, y es una decisión. Los tipos de pausa viven en
-- `presencia_tipos_pausa`, que es por empresa y CAE A DEFAULTS cuando está
-- vacía: no hay fila a la que apuntar. Se valida la FORMA del código y la
-- pantalla solo ofrece los tipos vigentes. Un cupo para un tipo inexistente es
-- inerte —nada lo va a leer nunca— y no justifica acoplar turnos con presencia.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.turnos_sellar_politica();
--   DROP FUNCTION IF EXISTS public.turnos_politica_efectiva(uuid);
--   DROP TABLE IF EXISTS public.plantilla_cupos_pausa;
--   ALTER TABLE public.bloques_turno DROP COLUMN IF EXISTS politica;
--   ALTER TABLE public.plantillas_horario
--     DROP COLUMN IF EXISTS tolerancia_salida_min,
--     DROP COLUMN IF EXISTS demora_compensable_hasta_min,
--     DROP COLUMN IF EXISTS extra_requiere_autorizacion;
--
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS /
-- CREATE OR REPLACE / DROP POLICY antes de cada CREATE POLICY.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Lo que la jornada espera, más allá de las horas ──────────────────────
ALTER TABLE public.plantillas_horario
  ADD COLUMN IF NOT EXISTS tolerancia_salida_min        int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demora_compensable_hasta_min int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_requiere_autorizacion  boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plantillas_horario_tolerancia_salida_chk'
      AND conrelid = 'public.plantillas_horario'::regclass
  ) THEN
    ALTER TABLE public.plantillas_horario
      ADD CONSTRAINT plantillas_horario_tolerancia_salida_chk
      CHECK (tolerancia_salida_min >= 0 AND tolerancia_salida_min <= 240);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plantillas_horario_demora_compensable_chk'
      AND conrelid = 'public.plantillas_horario'::regclass
  ) THEN
    -- Los tramos tienen que quedar EN ORDEN. Un tope compensable por debajo de
    -- la tolerancia deja el segundo tramo vacío y degrada la política a «todo se
    -- debita» sin decirlo — lo cazó supabase/tests/politica_jornada al subir una
    -- tolerancia sin mirar el tope. `= 0` sigue siendo válido: es la forma
    -- explícita de decir que no hay tramo compensable.
    ALTER TABLE public.plantillas_horario
      ADD CONSTRAINT plantillas_horario_demora_compensable_chk
      CHECK (
        demora_compensable_hasta_min >= 0
        AND demora_compensable_hasta_min <= 480
        AND (demora_compensable_hasta_min = 0
             OR demora_compensable_hasta_min > tolerancia_entrada_min)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.plantillas_horario.tolerancia_salida_min IS
  'Minutos que se puede salir ANTES del fin del turno sin que cuente como salida temprana. 0 = cualquier minuto antes cuenta.';
COMMENT ON COLUMN public.plantillas_horario.demora_compensable_hasta_min IS
  'Fin del tramo COMPENSABLE de la demora, contado desde el inicio del turno. La demora se lee en tres tramos: hasta tolerancia_entrada_min no pasa nada; de ahí hasta aquí se compensa; más allá se debita. 0 = no hay tramo compensable.';
COMMENT ON COLUMN public.plantillas_horario.extra_requiere_autorizacion IS
  'true = las horas por encima de la jornada no se reconocen como extra sin autorización previa. Hoy NADIE lee esta columna: la autorización es la fase 4. Se declara ahora para que la vara esté completa y para no volver a migrar la tabla.';

-- ── 2. El cupo de descanso, por jornada y por tipo ──────────────────────────
CREATE TABLE IF NOT EXISTS public.plantilla_cupos_pausa (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plantilla_horario_id uuid NOT NULL REFERENCES public.plantillas_horario(id) ON DELETE CASCADE,
  tipo                 text NOT NULL,
  minutos              int  NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plantilla_cupos_pausa_tipo_chk  CHECK (tipo ~ '^[a-z][a-z0-9_]{1,29}$'),
  CONSTRAINT plantilla_cupos_pausa_min_chk   CHECK (minutos > 0 AND minutos <= 1440),
  CONSTRAINT plantilla_cupos_pausa_unica     UNIQUE (plantilla_horario_id, tipo)
);

COMMENT ON TABLE public.plantilla_cupos_pausa IS
  'Cuánto descanso da CADA JORNADA por tipo de pausa (el turno de 12 h de noche no da la misma cena que el de 8 h de oficina). Sin fila para un tipo = esa jornada no declara cupo para él, que no es lo mismo que cupo cero.';
COMMENT ON COLUMN public.plantilla_cupos_pausa.tipo IS
  'Código de presencia_tipos_pausa (almuerzo, refaccion, cena…). SIN FK a propósito: ese catálogo cae a defaults cuando la empresa no configuró ninguno, así que no siempre hay fila a la que apuntar.';

CREATE INDEX IF NOT EXISTS idx_plantilla_cupos_pausa_plantilla
  ON public.plantilla_cupos_pausa (plantilla_horario_id);

ALTER TABLE public.plantilla_cupos_pausa ENABLE ROW LEVEL SECURITY;

-- Mismas cuatro policies que la jornada a la que pertenece el cupo: quien puede
-- editar `plantillas_horario` puede editar sus cupos, y nadie más. Copiar el
-- criterio en vez de inventar uno evita que un cupo quede más abierto que la
-- jornada que describe.
DROP POLICY IF EXISTS "plantilla_cupos_pausa_select" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_select" ON public.plantilla_cupos_pausa
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "plantilla_cupos_pausa_insert" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_insert" ON public.plantilla_cupos_pausa
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "plantilla_cupos_pausa_update" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_update" ON public.plantilla_cupos_pausa
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

DROP POLICY IF EXISTS "plantilla_cupos_pausa_delete" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_delete" ON public.plantilla_cupos_pausa
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos')))
  );

-- ── 3. La vara, resuelta ────────────────────────────────────────────────────
-- Una sola función arma la foto de la política de una jornada, y por eso el
-- sellado del bloque y cualquier lectura futura no pueden divergir. Devuelve
-- NULL si la plantilla no existe: un bloque sin jornada no tiene vara, y eso se
-- dice con NULL en vez de con una vara inventada.
CREATE OR REPLACE FUNCTION public.turnos_politica_efectiva(p_plantilla_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'tolerancia_entrada_min',        ph.tolerancia_entrada_min,
    'tolerancia_salida_min',         ph.tolerancia_salida_min,
    'demora_compensable_hasta_min',  ph.demora_compensable_hasta_min,
    'extra_requiere_autorizacion',   ph.extra_requiere_autorizacion,
    -- El descanso GLOBAL de la plantilla viaja también: es el que ya descuenta
    -- de `horas_planificadas`, y la fase 2 va a necesitar contrastarlo con la
    -- suma de los cupos para poder señalar cuándo no cuadran.
    'minutos_descanso',              ph.minutos_descanso,
    'cupos', COALESCE(
      (SELECT jsonb_object_agg(c.tipo, c.minutos)
       FROM public.plantilla_cupos_pausa c
       WHERE c.plantilla_horario_id = ph.id),
      '{}'::jsonb)
  )
  FROM public.plantillas_horario ph
  WHERE ph.id = p_plantilla_id
$$;

COMMENT ON FUNCTION public.turnos_politica_efectiva(uuid) IS
  'Foto de lo que una jornada espera: tolerancias, el tramo compensable de la demora, si la extra necesita autorización, y el cupo de descanso por tipo. Fuente ÚNICA de esa foto, para que el sellado del bloque y las lecturas futuras no puedan divergir. NULL = la plantilla no existe.';

-- Sin grant a `authenticated`: su único llamador es el trigger de sellado, que
-- corre como el dueño. La pantalla arma su vista previa con los valores que ya
-- tiene en el formulario — no necesita preguntarle a la base lo que acaba de
-- teclear. Es el remedio que prescribe scripts/migrations-guard.allowlist.json.
REVOKE EXECUTE ON FUNCTION public.turnos_politica_efectiva(uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. La vara se congela en el bloque ──────────────────────────────────────
ALTER TABLE public.bloques_turno
  ADD COLUMN IF NOT EXISTS politica jsonb;

COMMENT ON COLUMN public.bloques_turno.politica IS
  'Foto CONGELADA de lo que la jornada esperaba el día que se materializó este bloque. La sella un trigger desde plantillas_horario; lo que mande el cliente se ignora. NULL = el bloque no tiene jornada, o se planificó antes de que existiera la vara (20260909000000) — no se rellena hacia atrás, porque aplicarle la política de hoy a un mes cerrado es justo lo que congelarla evita.';

-- Mismo criterio que `turnos_sellar_horas` con `horas_planificadas`: la columna
-- es DERIVADA y lo que llegue en ella se descarta. Va en un trigger propio y no
-- dentro del que ya existe porque aquél es compartido con `plantillas_horario`,
-- que no tiene ni puede tener esta columna.
CREATE OR REPLACE FUNCTION public.turnos_sellar_politica()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo al crear el bloque, o si CAMBIA de jornada. Un UPDATE cualquiera
  -- —cerrar el turno, corregir una nota— no puede refrescar la foto: sería la
  -- reescritura silenciosa que congelarla existe para impedir.
  IF TG_OP = 'INSERT'
     OR NEW.plantilla_horario_id IS DISTINCT FROM OLD.plantilla_horario_id THEN
    NEW.politica := CASE
      WHEN NEW.plantilla_horario_id IS NULL THEN NULL
      ELSE public.turnos_politica_efectiva(NEW.plantilla_horario_id)
    END;
  ELSE
    NEW.politica := OLD.politica;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.turnos_sellar_politica() IS
  'Trigger BEFORE INSERT/UPDATE de bloques_turno: congela en `politica` lo que la jornada esperaba, al crear el bloque o si cambia de jornada. Nunca en otro UPDATE — refrescar la foto sería reescribir contra qué se midió un día ya pasado.';

-- No es invocable como función normal (Postgres rechaza llamar una función de
-- trigger), pero se revoca igual: una superficie que no existe es más barata de
-- razonar que una que existe y «no se puede usar».
REVOKE EXECUTE ON FUNCTION public.turnos_sellar_politica() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_turnos_sellar_politica ON public.bloques_turno;
CREATE TRIGGER trg_turnos_sellar_politica
  BEFORE INSERT OR UPDATE ON public.bloques_turno
  FOR EACH ROW EXECUTE FUNCTION public.turnos_sellar_politica();

-- La bitácora de 20260731000100 inscribe tabla por tabla; un trigger no se
-- hereda por FK. El cupo cambia lo que se le exige a la gente, así que deja
-- rastro como todo lo demás.
DROP TRIGGER IF EXISTS trg_bitacora ON public.plantilla_cupos_pausa;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.plantilla_cupos_pausa
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora(
    'Personal', 'tipo', 'plantillas_horario', 'plantilla_horario_id');
