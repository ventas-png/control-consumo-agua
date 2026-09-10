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
--
-- EL TENANT NO SE DECLARA, SE HEREDA. `company_id` y `project_id` están en la
-- fila porque las policies los necesitan para gatear sin un JOIN, pero lo que
-- decide a quién pertenece un cupo es la JORNADA a la que apunta — y eso lo
-- impone una FK COMPUESTA contra `plantillas_horario(id, company_id, project_id)`,
-- no la confianza en lo que mandó el cliente.
--
-- Sin esa FK, `supabase-js` puede mandar el `company_id` propio junto a un
-- `plantilla_horario_id` AJENO y la fila entra: las policies verían un tenant
-- correcto y la FK simple solo comprobaría que la plantilla existe, sin mirar de
-- quién es. El resultado sería un cupo escrito por la empresa A que
-- `turnos_politica_efectiva` le sirve a la empresa B —y que termina congelado en
-- sus bloques—, sin que nada lo señalara. Es el mismo filo que 20260907000800
-- cerró en `tareas_bloque`, y se cierra igual.
CREATE TABLE IF NOT EXISTS public.plantilla_cupos_pausa (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  plantilla_horario_id uuid NOT NULL,
  tipo                 text NOT NULL,
  minutos              int  NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plantilla_cupos_pausa_tipo_chk  CHECK (tipo ~ '^[a-z][a-z0-9_]{1,29}$'),
  CONSTRAINT plantilla_cupos_pausa_min_chk   CHECK (minutos > 0 AND minutos <= 1440),
  CONSTRAINT plantilla_cupos_pausa_unica     UNIQUE (plantilla_horario_id, tipo),
  -- El ancla la puso 20260907000200 (plantillas_horario_id_tenant_uq).
  CONSTRAINT plantilla_cupos_pausa_horario_fk
    FOREIGN KEY (plantilla_horario_id, company_id, project_id)
    REFERENCES public.plantillas_horario(id, company_id, project_id) ON DELETE CASCADE
);

-- La tabla puede existir de una corrida anterior de esta misma migración (fue
-- así en el primer borrador de este PR): completar en vez de recrear.
DO $$
BEGIN
  ALTER TABLE public.plantilla_cupos_pausa ADD COLUMN IF NOT EXISTS project_id uuid;
  -- Sin filas todavía en ningún entorno; si las hubiera, heredan el tenant de
  -- su jornada, que es exactamente lo que la FK compuesta va a exigir.
  UPDATE public.plantilla_cupos_pausa c
     SET project_id = ph.project_id
    FROM public.plantillas_horario ph
   WHERE ph.id = c.plantilla_horario_id AND c.project_id IS NULL;
  DELETE FROM public.plantilla_cupos_pausa WHERE project_id IS NULL;
  ALTER TABLE public.plantilla_cupos_pausa ALTER COLUMN project_id SET NOT NULL;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'plantilla_cupos_pausa_project_fk') THEN
    ALTER TABLE public.plantilla_cupos_pausa
      ADD CONSTRAINT plantilla_cupos_pausa_project_fk
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;

  -- La FK SIMPLE a plantillas_horario, si quedó de la versión anterior, se va:
  -- comprueba que la plantilla exista pero no de quién es, que es justo el
  -- agujero. La compuesta la reemplaza y además cubre la existencia.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'plantilla_cupos_pausa_plantilla_horario_id_fkey') THEN
    ALTER TABLE public.plantilla_cupos_pausa
      DROP CONSTRAINT plantilla_cupos_pausa_plantilla_horario_id_fkey;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'plantilla_cupos_pausa_horario_fk') THEN
    ALTER TABLE public.plantilla_cupos_pausa
      ADD CONSTRAINT plantilla_cupos_pausa_horario_fk
      FOREIGN KEY (plantilla_horario_id, company_id, project_id)
      REFERENCES public.plantillas_horario(id, company_id, project_id) ON DELETE CASCADE;
  END IF;
END;
$$;

COMMENT ON TABLE public.plantilla_cupos_pausa IS
  'Cuánto descanso da CADA JORNADA por tipo de pausa (el turno de 12 h de noche no da la misma cena que el de 8 h de oficina). Sin fila para un tipo = esa jornada no declara cupo para él, que no es lo mismo que cupo cero.';
COMMENT ON COLUMN public.plantilla_cupos_pausa.tipo IS
  'Código de presencia_tipos_pausa (almuerzo, refaccion, cena…). SIN FK a propósito: ese catálogo cae a defaults cuando la empresa no configuró ninguno, así que no siempre hay fila a la que apuntar.';
COMMENT ON COLUMN public.plantilla_cupos_pausa.project_id IS
  'Condominio de la jornada. No es un dato del cliente: la FK compuesta lo obliga a coincidir con el de plantillas_horario, así que un cupo NO puede quedar colgado de la jornada de otro tenant.';

CREATE INDEX IF NOT EXISTS idx_plantilla_cupos_pausa_plantilla
  ON public.plantilla_cupos_pausa (plantilla_horario_id);

-- ── 2b. Privilegios, DECLARADOS ─────────────────────────────────────────────
--
-- La app llega a esta tabla por supabase-js (PostgREST), o sea con el rol
-- `authenticated`. Los privilegios de tabla y las policies son DOS puertas
-- distintas y las dos tienen que estar puestas: RLS sin GRANT deja la tabla
-- muda, y GRANT sin RLS la deja abierta.
--
-- No se hereda del default del proyecto a propósito. Ese default es una
-- configuración del entorno —invisible en el repo, distinta entre producción y
-- una preview branch— y este PR ya encontró una vez lo que cuesta confiar en él
-- (#842: dieciocho funciones que el repo le dejaba a anon y producción ya había
-- cerrado). Lo que la tabla concede se lee acá o no se sabe.
ALTER TABLE public.plantilla_cupos_pausa ENABLE ROW LEVEL SECURITY;
-- Ni siquiera el dueño de la tabla se salta las policies: sin esto, una función
-- SECURITY DEFINER de mañana leería cupos de cualquier tenant sin notarlo.
ALTER TABLE public.plantilla_cupos_pausa FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.plantilla_cupos_pausa FROM PUBLIC, anon;
-- Solo el CRUD que la pantalla necesita, y gateado fila a fila por las policies
-- de abajo. Sin TRUNCATE ni REFERENCES: nada de la app los usa.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plantilla_cupos_pausa TO authenticated;
GRANT ALL    ON TABLE public.plantilla_cupos_pausa TO service_role;

-- Mismas cuatro policies que la jornada a la que pertenece el cupo: quien puede
-- editar `plantillas_horario` puede editar sus cupos, y nadie más. Copiar el
-- criterio en vez de inventar uno evita que un cupo quede más abierto que la
-- jornada que describe.
--
-- Y ADEMÁS se exige que la JORNADA sea visible para quien escribe. La FK
-- compuesta ya impide la mezcla de tenants, pero una policy que solo mira el
-- `company_id` de la propia fila estaría gateando sobre un dato que manda el
-- cliente; el EXISTS la ata a la plantilla real. Las dos defensas dicen lo
-- mismo, y esa redundancia es el punto: si un día alguien afloja una, la otra
-- sigue de pie.
CREATE OR REPLACE FUNCTION public.turnos_puede_administrar_jornada(p_plantilla_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.plantillas_horario ph
    WHERE ph.id = p_plantilla_id
      AND (public.is_super_admin()
           OR (ph.company_id = public.get_my_company_id()
               AND public.can_access_project(ph.project_id)
               AND public.user_has_permission('condominios.tab.turnos')))
  )
$$;

COMMENT ON FUNCTION public.turnos_puede_administrar_jornada(uuid) IS
  'Si quien llama puede administrar los cupos de ESTA jornada, mirando el tenant REAL de plantillas_horario y no el que venga en la fila del cupo. SECURITY DEFINER porque plantillas_horario tiene su propia RLS y aquí hace falta poder ver la fila para juzgarla.';

REVOKE EXECUTE ON FUNCTION public.turnos_puede_administrar_jornada(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_puede_administrar_jornada(uuid) TO authenticated;

DROP POLICY IF EXISTS "plantilla_cupos_pausa_select" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_select" ON public.plantilla_cupos_pausa
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos'))
        AND public.turnos_puede_administrar_jornada(plantilla_horario_id))
  );

DROP POLICY IF EXISTS "plantilla_cupos_pausa_insert" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_insert" ON public.plantilla_cupos_pausa
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos'))
        AND public.turnos_puede_administrar_jornada(plantilla_horario_id))
  );

DROP POLICY IF EXISTS "plantilla_cupos_pausa_update" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_update" ON public.plantilla_cupos_pausa
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos'))
        AND public.turnos_puede_administrar_jornada(plantilla_horario_id))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos'))
        AND public.turnos_puede_administrar_jornada(plantilla_horario_id))
  );

DROP POLICY IF EXISTS "plantilla_cupos_pausa_delete" ON public.plantilla_cupos_pausa;
CREATE POLICY "plantilla_cupos_pausa_delete" ON public.plantilla_cupos_pausa
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (company_id = (SELECT public.get_my_company_id())
        AND (SELECT public.user_has_permission('condominios.tab.turnos'))
        AND public.turnos_puede_administrar_jornada(plantilla_horario_id))
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
    -- El cupo se empareja por la TERNA COMPLETA, no solo por el id de la
    -- jornada. La FK compuesta ya hace imposible que un cupo cuelgue de la
    -- jornada de otro tenant, así que este WHERE no debería filtrar nunca
    -- nada — y por eso mismo va puesto: esta función corre como SECURITY
    -- DEFINER y su resultado se CONGELA en bloques_turno.politica. Si algún
    -- día la FK se aflojara, el filo sería servirle a una empresa el cupo de
    -- otra, sellado y sin rastro. Dos candados para la misma puerta.
    'cupos', COALESCE(
      (SELECT jsonb_object_agg(c.tipo, c.minutos)
       FROM public.plantilla_cupos_pausa c
       WHERE c.plantilla_horario_id = ph.id
         AND c.company_id = ph.company_id
         AND c.project_id = ph.project_id),
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
  'Foto CONGELADA de lo que la jornada esperaba el día que se materializó este bloque. La sella un trigger desde plantillas_horario; lo que mande el cliente se ignora. NULL = el bloque no tiene jornada, o se planificó antes de que existiera la vara (20260909000100) — no se rellena hacia atrás, porque aplicarle la política de hoy a un mes cerrado es justo lo que congelarla evita.';

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

-- ── 6. Guardar la jornada y sus cupos, o no guardar nada ────────────────────
--
-- POR QUÉ EXISTE. La pantalla hacía tres viajes: crear/actualizar la jornada,
-- borrar los cupos viejos, insertar los nuevos. Entre el segundo y el tercero
-- caben una pestaña que se cierra, una red que se corta y un 42501 — y lo que
-- queda entonces no es «lo de antes» ni «lo nuevo», sino una jornada SIN cupos:
-- la lectura más peligrosa de las tres, porque «sin cupo declarado» significa
-- justamente que ese descanso no se juzga. Un guardado a medias de esta tabla
-- no deja un formulario incompleto, deja una política silenciosamente apagada.
--
-- SECURITY INVOKER, a propósito. La función no necesita más permisos que quien
-- la llama: escribe en dos tablas que YA tienen RLS y que ya gatean sobre
-- `condominios.tab.turnos`. Hacerla DEFINER habría significado reimplementar
-- aquí ese gateo —con la obligación de acertar dos veces y de mantenerlas
-- sincronizadas para siempre— a cambio de nada. Lo único que aporta esta
-- función es la ATOMICIDAD, y para eso no hacen falta privilegios.
--
-- Un `p_company_id` ajeno no hace falta detectarlo aquí: la policy de INSERT lo
-- rechaza, y la FK compuesta rechaza además la jornada de otro tenant. Se pasa
-- porque las columnas son NOT NULL, no porque se le crea.
CREATE OR REPLACE FUNCTION public.turnos_guardar_jornada(
  p_company_id  uuid,
  p_project_id  uuid,
  p_plantilla_id uuid,   -- NULL = jornada nueva
  p_datos       jsonb,
  p_cupos       jsonb    -- {"almuerzo": 45, "refaccion": 15}; lo ausente se borra
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'company_id y project_id son obligatorios' USING ERRCODE = '22023';
  END IF;

  IF p_plantilla_id IS NULL THEN
    INSERT INTO public.plantillas_horario (
      company_id, project_id, nombre, codigo, turno, hora_inicio, hora_fin,
      cruza_medianoche, minutos_descanso, tolerancia_entrada_min,
      tolerancia_salida_min, demora_compensable_hasta_min,
      extra_requiere_autorizacion, color, notas, activo
    ) VALUES (
      p_company_id,
      p_project_id,
      p_datos->>'nombre',
      p_datos->>'codigo',
      COALESCE(p_datos->>'turno', 'manana'),
      (p_datos->>'hora_inicio')::time,
      (p_datos->>'hora_fin')::time,
      COALESCE((p_datos->>'cruza_medianoche')::boolean, false),
      COALESCE((p_datos->>'minutos_descanso')::int, 0),
      COALESCE((p_datos->>'tolerancia_entrada_min')::int, 0),
      COALESCE((p_datos->>'tolerancia_salida_min')::int, 0),
      COALESCE((p_datos->>'demora_compensable_hasta_min')::int, 0),
      COALESCE((p_datos->>'extra_requiere_autorizacion')::boolean, true),
      p_datos->>'color',
      p_datos->>'notas',
      COALESCE((p_datos->>'activo')::boolean, true)
    )
    RETURNING id INTO v_id;
  ELSE
    -- `company_id` y `project_id` NO se tocan: mover una jornada de tenant no
    -- es una edición, y dejarlo posible aquí abriría por la puerta de atrás lo
    -- que la FK compuesta cierra por la de adelante.
    UPDATE public.plantillas_horario SET
      nombre                       = COALESCE(p_datos->>'nombre', nombre),
      codigo                       = p_datos->>'codigo',
      turno                        = COALESCE(p_datos->>'turno', turno),
      hora_inicio                  = COALESCE((p_datos->>'hora_inicio')::time, hora_inicio),
      hora_fin                     = COALESCE((p_datos->>'hora_fin')::time, hora_fin),
      cruza_medianoche             = COALESCE((p_datos->>'cruza_medianoche')::boolean, cruza_medianoche),
      minutos_descanso             = COALESCE((p_datos->>'minutos_descanso')::int, minutos_descanso),
      tolerancia_entrada_min       = COALESCE((p_datos->>'tolerancia_entrada_min')::int, tolerancia_entrada_min),
      tolerancia_salida_min        = COALESCE((p_datos->>'tolerancia_salida_min')::int, tolerancia_salida_min),
      demora_compensable_hasta_min = COALESCE((p_datos->>'demora_compensable_hasta_min')::int, demora_compensable_hasta_min),
      extra_requiere_autorizacion  = COALESCE((p_datos->>'extra_requiere_autorizacion')::boolean, extra_requiere_autorizacion),
      color                        = p_datos->>'color',
      notas                        = p_datos->>'notas',
      activo                       = COALESCE((p_datos->>'activo')::boolean, activo)
    WHERE id = p_plantilla_id
      AND company_id = p_company_id
      AND project_id = p_project_id
    RETURNING id INTO v_id;

    -- Cero filas puede ser «no existe» o «la RLS no te la deja ver»: desde
    -- fuera son lo mismo a propósito, y contestar cuál de las dos le diría a
    -- quien prueba ids ajenos cuáles existen.
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'jornada no encontrada' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Se REEMPLAZA el juego completo, no se parchea: el formulario manda el
  -- estado deseado entero, y un tipo ausente significa «esta jornada ya no
  -- declara cupo para él». Borrar e insertar dentro de la misma transacción es
  -- lo que vuelve seguro decirlo así.
  DELETE FROM public.plantilla_cupos_pausa
   WHERE plantilla_horario_id = v_id;

  INSERT INTO public.plantilla_cupos_pausa (
    company_id, project_id, plantilla_horario_id, tipo, minutos
  )
  SELECT p_company_id, p_project_id, v_id, e.key, (e.value)::int
    FROM jsonb_each_text(COALESCE(p_cupos, '{}'::jsonb)) AS e(key, value)
   WHERE e.value IS NOT NULL
     AND btrim(e.value) <> ''
     -- El cero es «sin cupo», igual que la ausencia: se descarta acá y no en el
     -- CHECK, para que el formulario pueda borrar un cupo poniéndolo en 0.
     AND (e.value)::numeric > 0;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.turnos_guardar_jornada(uuid, uuid, uuid, jsonb, jsonb) IS
  'Guarda una jornada y REEMPLAZA sus cupos de descanso en una sola transacción: o quedan las dos cosas, o no queda ninguna. SECURITY INVOKER — la autorización la siguen decidiendo las policies de plantillas_horario y plantilla_cupos_pausa, no esta función.';

REVOKE EXECUTE ON FUNCTION public.turnos_guardar_jornada(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.turnos_guardar_jornada(uuid, uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
