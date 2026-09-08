-- ════════════════════════════════════════════════════════════════════════════
-- Las pausas de la jornada: estadía, horas laborales y descanso, separadas
-- ════════════════════════════════════════════════════════════════════════════
-- PROBLEMA. Hoy una jornada es un par de horas: entró a las 06:00, salió a las
-- 18:00 → 12 horas. Pero en esas 12 horas hubo refacción, almuerzo y cena, y el
-- sistema no lo sabe. Eso deja dos números confundidos en uno solo:
--
--   · las horas que la persona ESTUVO (estadía / permanencia), y
--   · las horas que la persona TRABAJÓ (las que alimentan la planilla).
--
-- Y deja un tercero que no existe en ningún lado: cuánto descansó — el dato con
-- el que se comprueba que el descanso se está dando de verdad.
--
-- LA GRIETA QUE YA ESTABA ABIERTA. `plantillas_horario.minutos_descanso` existe
-- desde 20260820000000 y SÍ se descuenta de las horas PLANIFICADAS (lo hace
-- `turnos_sellar_horas` al sellar `horas_planificadas`). Pero
-- `calcular_horas_personal` calcula lo TRABAJADO pasando `0` de descanso. O sea
-- que la planilla venía comparando lo planificado NETO contra lo trabajado
-- BRUTO: un turno de 8 h con 30 min de descanso planificaba 8.0 y, con la
-- persona 8.5 h en el puesto, marcaba 8.5 trabajadas y media hora de «extra»
-- que nadie autorizó. Esta migración cierra esa grieta con el dato real en vez
-- de con el estimado de la plantilla.
--
-- CÓMO SE MIDE, Y POR QUÉ ASÍ
-- Una pausa se guarda como DOS INSTANTES (`timestamptz`), no como dos `time`.
-- Es deliberado: #839 se produjo exactamente por medir con `time` un intervalo
-- que cruzaba la medianoche —34 segundos de jornada se mostraron como 24 horas—
-- y una pausa de un turno nocturno cruza la medianoche con toda naturalidad. Un
-- par de instantes no tiene ese problema: la resta es la resta.
--
-- QUÉ DESCUENTA Y QUÉ NO, LO DECIDE EL TENANT. No hay una respuesta universal:
-- a un guardia que no puede abandonar el puesto se le paga la refacción; a un
-- administrativo que sale a almorzar fuera, normalmente no. Por eso el catálogo
-- `presencia_tipos_pausa` es POR EMPRESA y editable, con un default razonable
-- para quien no lo toque (almuerzo y cena descuentan; refacción y descanso no).
--
-- Y la regla se CONGELA en la fila al iniciar la pausa. Si mañana la empresa
-- decide que el almuerzo se paga, eso vale hacia adelante: cambiar el catálogo
-- no puede reescribir en silencio la planilla de meses ya cerrados.
--
-- SIN FOTO, A PROPÓSITO. La entrada y la salida piden foto; la pausa no. Cuatro
-- fotos más al día es fricción, y la fricción no produce evidencia: produce
-- gente que deja de marcar sus pausas. Una pausa no marcada es peor que una
-- pausa sin foto — la primera no existe en el dato, la segunda sí. La
-- ubicación se guarda si el dispositivo la da, en silencio.
--
-- POR QUÉ RPC Y NO UN INSERT. Lo mismo que en 20260908000000: la hora no puede
-- ser un parámetro. Si el cliente manda el instante de inicio y el de fin, la
-- pausa vale lo que vale un campo de texto, y esta vez el campo de texto RESTA
-- horas de la planilla. Aquí ni siquiera hay policy de escritura: la tabla se
-- escribe solo desde funciones SECURITY DEFINER.
--
-- LA PAUSA HUÉRFANA. Alguien sale a almorzar y se olvida de marcar el regreso;
-- a las 18:00 marca su salida. Rechazar la salida sería dejar a la persona
-- atrapada en la puerta, así que `presencia_marcar` CIERRA la pausa abierta al
-- salir y lo deja dicho en la fila (`cerrada_al_salir`), que es lo que permite
-- a quien administra encontrarla y ajustarla.
--
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.presencia_pausa_agregar(uuid, text, numeric, text);
--   DROP FUNCTION IF EXISTS public.presencia_pausa_anular(uuid, text);
--   DROP FUNCTION IF EXISTS public.presencia_pausa_ajustar(uuid, numeric, text);
--   DROP FUNCTION IF EXISTS public.presencia_pausar(uuid, text, text, jsonb);
--   DROP FUNCTION IF EXISTS public.presencia_tipos_pausa_guardar(text, text, boolean, int, boolean);
--   DROP FUNCTION IF EXISTS public.presencia_tipos_pausa_efectivos();
--   DROP FUNCTION IF EXISTS public.presencia_minutos_pausa(uuid);
--   DROP TABLE IF EXISTS public.presencia_pausas;
--   DROP TABLE IF EXISTS public.presencia_tipos_pausa;
--   -- y volver a declarar presencia_mi_ficha, presencia_marcar y
--   -- calcular_horas_personal con sus cuerpos de 20260908000200 / 20260908000000
--   -- (las dos primeras) y 20260908000200 (la tercera).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE / DROP FUNCTION antes de los CREATE que cambian columnas
-- OUT / DROP POLICY antes de cada CREATE POLICY / ON CONFLICT en la siembra.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. El catálogo de tipos de pausa, por empresa ───────────────────────────
CREATE TABLE IF NOT EXISTS public.presencia_tipos_pausa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  codigo      text NOT NULL,
  etiqueta    text NOT NULL,
  descuenta   boolean NOT NULL DEFAULT true,
  minutos_max int,
  orden       int NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presencia_tipos_pausa_codigo_check
    CHECK (codigo ~ '^[a-z][a-z0-9_]{1,29}$'),
  CONSTRAINT presencia_tipos_pausa_minutos_max_check
    CHECK (minutos_max IS NULL OR (minutos_max > 0 AND minutos_max <= 1440)),
  CONSTRAINT presencia_tipos_pausa_unica UNIQUE (company_id, codigo)
);

COMMENT ON TABLE public.presencia_tipos_pausa IS
  'Catálogo POR EMPRESA de tipos de pausa y su regla de planilla. Vacío = valen los defaults de presencia_tipos_pausa_efectivos(). Cambiarlo vale hacia adelante: la regla se congela en cada fila de presencia_pausas al iniciarla.';
COMMENT ON COLUMN public.presencia_tipos_pausa.descuenta IS
  'true = los minutos de esta pausa se restan de las horas laborales (y por tanto de lo que se paga). false = la pausa se mide y se ve, pero la persona sigue en jornada — el caso del guardia que come sin poder dejar el puesto.';
COMMENT ON COLUMN public.presencia_tipos_pausa.minutos_max IS
  'Tope ORIENTATIVO en minutos: no impide nada, marca en pantalla la pausa que lo excede para que quien administra la mire. NULL = sin tope.';

ALTER TABLE public.presencia_tipos_pausa ENABLE ROW LEVEL SECURITY;

-- Leer el catálogo lo necesita CUALQUIER empleado que vaya a marcar una pausa:
-- es lo que pinta los botones. Escribirlo va por RPC (abajo), que es donde se
-- exige `.edit` — la tabla no tiene policy de escritura a propósito.
DROP POLICY IF EXISTS "presencia_tipos_pausa_select" ON public.presencia_tipos_pausa;
CREATE POLICY "presencia_tipos_pausa_select"
  ON public.presencia_tipos_pausa FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR company_id = (SELECT public.get_my_company_id())
  );

CREATE INDEX IF NOT EXISTS idx_presencia_tipos_pausa_empresa
  ON public.presencia_tipos_pausa (company_id, orden);

-- ── 2. Las pausas ───────────────────────────────────────────────────────────
-- `inicio_en` es NULLABLE y eso es una afirmación, no un descuido: una pausa de
-- autoservicio SIEMPRE tiene su instante (lo pone el servidor), pero una que
-- agrega quien administra porque la persona olvidó marcarla NO SE SABE cuándo
-- fue — solo cuánto duró. Inventarle un instante para llenar la columna sería
-- exactamente la clase de dato que este módulo existe para no producir.
CREATE TABLE IF NOT EXISTS public.presencia_pausas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  registro_id      uuid NOT NULL REFERENCES public.presencia_personal(id) ON DELETE CASCADE,
  personal_id      uuid REFERENCES public.personal_condominio(id) ON DELETE SET NULL,
  tipo             text NOT NULL,
  etiqueta         text NOT NULL,
  descuenta        boolean NOT NULL,
  inicio_en        timestamptz,
  fin_en           timestamptz,
  minutos          numeric(10,2),
  gps_inicio       jsonb,
  gps_fin          jsonb,
  origen           text NOT NULL DEFAULT 'autoservicio',
  cerrada_al_salir boolean NOT NULL DEFAULT false,
  registrada_por   uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  registrada_por_nombre text,
  corregido_por    uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  corregido_por_nombre text,
  corregido_en     timestamptz,
  motivo_correccion text,
  anulado_en       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT presencia_pausas_origen_check CHECK (origen IN ('autoservicio', 'manual')),
  -- El fin nunca precede al inicio. Con instantes esto es una comparación de
  -- verdad; con `time` habría que adivinar si cruzó la medianoche.
  CONSTRAINT presencia_pausas_orden_check
    CHECK (inicio_en IS NULL OR fin_en IS NULL OR fin_en >= inicio_en),
  -- Una pausa dice algo o no existe: o tiene instante de inicio (autoservicio)
  -- o tiene duración declarada (la que agrega quien administra).
  CONSTRAINT presencia_pausas_medible_check
    CHECK (inicio_en IS NOT NULL OR minutos IS NOT NULL),
  CONSTRAINT presencia_pausas_minutos_check
    CHECK (minutos IS NULL OR (minutos >= 0 AND minutos <= 1440))
);

COMMENT ON TABLE public.presencia_pausas IS
  'Pausas dentro de una jornada (refacción, almuerzo, cena, descanso). Se escriben SOLO desde las RPC presencia_pausar / presencia_pausa_* — la tabla no tiene policy de escritura: si el cliente pudiera poner los instantes, la pausa restaría horas de la planilla con una hora tecleada.';
COMMENT ON COLUMN public.presencia_pausas.descuenta IS
  'Regla de planilla CONGELADA al crear la pausa, copiada del catálogo de la empresa. Congelarla es el punto: cambiar la política mañana no puede reescribir lo que ya se pagó.';
COMMENT ON COLUMN public.presencia_pausas.inicio_en IS
  'Instante de servidor en que empezó la pausa. NULL solo en las pausas de origen manual, donde se conoce la duración pero no el momento.';
COMMENT ON COLUMN public.presencia_pausas.minutos IS
  'Duración en minutos. Derivada de los instantes cuando los hay (la sella un trigger); declarada por quien administra en las manuales. Es lo que consume el cómputo de horas.';
COMMENT ON COLUMN public.presencia_pausas.cerrada_al_salir IS
  'true = la persona marcó su salida con esta pausa abierta y la cerró el marcaje de salida, no ella. Es la señal de que el dato merece una mirada.';
COMMENT ON COLUMN public.presencia_pausas.anulado_en IS
  'NULL = pausa vigente. Con valor, la pausa queda visible y marcada pero fuera del cómputo. No se borra: quita o devuelve horas pagadas y eso es evidencia.';

-- Una persona no puede estar en dos pausas a la vez. Parcial sobre lo ABIERTO
-- y vigente: cerradas y anuladas puede haber tantas como pausas tenga el turno.
CREATE UNIQUE INDEX IF NOT EXISTS presencia_pausa_una_abierta
  ON public.presencia_pausas (registro_id)
  WHERE inicio_en IS NOT NULL AND fin_en IS NULL AND anulado_en IS NULL;

-- El camino caliente es «las pausas vigentes de estos registros», que es lo que
-- pregunta el cómputo de horas una vez por empleado y día.
CREATE INDEX IF NOT EXISTS idx_presencia_pausas_registro
  ON public.presencia_pausas (registro_id)
  WHERE anulado_en IS NULL;

ALTER TABLE public.presencia_pausas ENABLE ROW LEVEL SECURITY;

-- SELECT — dos ramas, las mismas que las fotos de fichaje: la persona ve LAS
-- SUYAS, y quien administra la asistencia del condominio ve todas. No hay una
-- rama «del proyecto»: cuánto y cuándo descansa cada trabajador no es
-- información de vecindario.
DROP POLICY IF EXISTS "presencia_pausas_select" ON public.presencia_pausas;
CREATE POLICY "presencia_pausas_select"
  ON public.presencia_pausas FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      personal_id IS NOT NULL
      AND public.presencia_ficha_es_propia(personal_id::text, project_id::text)
    )
    OR (
      (SELECT public.user_has_permission('condominios.tab.presencia'))
      AND company_id = (SELECT public.get_my_company_id())
      AND public.can_access_project(project_id)
    )
  );

-- INSERT / UPDATE / DELETE — deliberadamente SIN policy. Todo pasa por las RPC
-- SECURITY DEFINER: son ellas las que ponen los instantes y exigen el motivo.

-- ── 3. La duración se sella, no se manda ────────────────────────────────────
-- Mismo criterio que `turnos_sellar_horas` con las horas de jornada: la columna
-- es DERIVADA y lo que llegue en ella se ignora. La resta de dos timestamptz no
-- necesita saber si cruzó la medianoche, que es justo lo que hizo falta arreglar
-- en #839 para el par de `time`.
CREATE OR REPLACE FUNCTION public.presencia_pausa_sellar_minutos()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.inicio_en IS NOT NULL AND NEW.fin_en IS NOT NULL THEN
    NEW.minutos := ROUND(EXTRACT(EPOCH FROM (NEW.fin_en - NEW.inicio_en)) / 60.0, 2);
  ELSIF NEW.inicio_en IS NOT NULL AND NEW.fin_en IS NULL THEN
    -- Pausa abierta: todavía no dura nada medible. Dejarle la duración de una
    -- versión anterior la haría contar dos veces al cerrarse.
    NEW.minutos := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.presencia_pausa_sellar_minutos() IS
  'Trigger BEFORE INSERT/UPDATE de presencia_pausas: sella `minutos` desde los dos instantes cuando existen. La columna es derivada; lo que mande el cliente se ignora.';

-- Una función de trigger no se puede invocar como función normal —Postgres lo
-- rechaza— así que el grant a PUBLIC que trae CREATE FUNCTION no es explotable.
-- Se revoca igual: la superficie que no existe es más barata de razonar que la
-- que existe pero «no se puede usar», y la invariante 24 del sandbox no tiene
-- que aprenderse una excepción.
REVOKE EXECUTE ON FUNCTION public.presencia_pausa_sellar_minutos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_presencia_pausa_sellar ON public.presencia_pausas;
CREATE TRIGGER trg_presencia_pausa_sellar
  BEFORE INSERT OR UPDATE ON public.presencia_pausas
  FOR EACH ROW EXECUTE FUNCTION public.presencia_pausa_sellar_minutos();

-- La bitácora de 20260731000100 registra por tabla y hay que inscribir la
-- nueva: `presencia_personal` ya está, pero un trigger no se hereda por FK.
-- Con padre, para que la acción aparezca colgada del marcaje que modifica.
DROP TRIGGER IF EXISTS trg_bitacora ON public.presencia_pausas;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.presencia_pausas
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora(
    'Personal', 'etiqueta,tipo', 'presencia_personal', 'registro_id');

DROP TRIGGER IF EXISTS trg_bitacora ON public.presencia_tipos_pausa;
CREATE TRIGGER trg_bitacora
  AFTER INSERT OR UPDATE OR DELETE ON public.presencia_tipos_pausa
  FOR EACH ROW EXECUTE FUNCTION public.registrar_bitacora(
    'Personal', 'etiqueta,codigo', '', '');

-- ── 4. Los tipos vigentes de MI empresa ─────────────────────────────────────
-- Devuelve el catálogo de la empresa si lo tiene, y si no los cuatro defaults.
-- El fallback es lo que hace que una empresa recién creada pueda marcar pausas
-- sin que nadie configure nada: configurar es una MEJORA, no un requisito.
--
-- SECURITY INVOKER (el default): la policy de SELECT de la tabla ya limita a la
-- propia empresa, y el brazo de los defaults no lee nada. Sin p_company_id ni
-- p_project_id, tampoco hay superficie cross-tenant que guardar.
CREATE OR REPLACE FUNCTION public.presencia_tipos_pausa_efectivos()
RETURNS TABLE (
  codigo      text,
  etiqueta    text,
  descuenta   boolean,
  minutos_max int,
  orden       int,
  configurado boolean
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH propios AS (
    SELECT t.codigo, t.etiqueta, t.descuenta, t.minutos_max, t.orden, true AS configurado
    FROM public.presencia_tipos_pausa t
    WHERE t.company_id = public.get_my_company_id()
      AND t.activo
  ),
  -- El default de la casa. Refacción y descanso NO descuentan porque el caso
  -- dominante en un condominio es el guardia que come sin poder abandonar el
  -- puesto: esas horas se trabajan. Almuerzo y cena sí, que es la salida real.
  defecto (codigo, etiqueta, descuenta, minutos_max, orden, configurado) AS (
    VALUES
      ('refaccion', 'Refacción', false, 30,  1, false),
      ('almuerzo',  'Almuerzo',  true,  60,  2, false),
      ('cena',      'Cena',      true,  60,  3, false),
      ('descanso',  'Descanso',  false, 15,  4, false)
  )
  SELECT p.codigo, p.etiqueta, p.descuenta, p.minutos_max, p.orden, p.configurado
  FROM propios p
  UNION ALL
  SELECT d.codigo, d.etiqueta, d.descuenta, d.minutos_max::int, d.orden, d.configurado
  FROM defecto d
  WHERE NOT EXISTS (SELECT 1 FROM propios)
  ORDER BY 5, 1
$$;

COMMENT ON FUNCTION public.presencia_tipos_pausa_efectivos() IS
  'Tipos de pausa vigentes para la empresa de quien llama: los suyos si configuró alguno, y si no los cuatro defaults (refacción y descanso no descuentan; almuerzo y cena sí). `configurado` distingue una cosa de la otra en pantalla.';

REVOKE EXECUTE ON FUNCTION public.presencia_tipos_pausa_efectivos() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_tipos_pausa_efectivos() TO authenticated;

-- ── 5. Configurar el catálogo ───────────────────────────────────────────────
-- Upsert por código. Exige `.edit` —la misma vara que corregir un marcaje—
-- porque cambiar `descuenta` cambia lo que se paga a partir de mañana.
CREATE OR REPLACE FUNCTION public.presencia_tipos_pausa_guardar(
  p_codigo      text,
  p_etiqueta    text,
  p_descuenta   boolean,
  p_minutos_max int     DEFAULT NULL,
  p_activo      boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company  uuid := public.get_my_company_id();
  v_codigo   text := lower(btrim(COALESCE(p_codigo, '')));
  v_etiqueta text := NULLIF(btrim(COALESCE(p_etiqueta, '')), '');
  v_id       uuid;
BEGIN
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no pertenece a una empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.presencia.edit')) THEN
    RAISE EXCEPTION 'No autorizado para configurar los tipos de pausa' USING ERRCODE = '42501';
  END IF;
  IF v_codigo !~ '^[a-z][a-z0-9_]{1,29}$' THEN
    RAISE EXCEPTION 'Código de pausa inválido: usá minúsculas sin espacios (ej. almuerzo)'
      USING ERRCODE = '22023';
  END IF;
  IF v_etiqueta IS NULL THEN
    RAISE EXCEPTION 'La pausa necesita un nombre visible' USING ERRCODE = '22023';
  END IF;
  IF p_minutos_max IS NOT NULL AND (p_minutos_max <= 0 OR p_minutos_max > 1440) THEN
    RAISE EXCEPTION 'El tope de minutos tiene que estar entre 1 y 1440' USING ERRCODE = '22023';
  END IF;

  -- MATERIALIZAR PRIMERO, y esto no es un detalle: `presencia_tipos_pausa_efectivos`
  -- cae a los defaults solo mientras la empresa NO tiene ninguna fila. Guardar
  -- una sola dejaría un catálogo de un elemento y los otros tres tipos
  -- desaparecerían de la pantalla de todo el personal — un clic en «el almuerzo
  -- ya no descuenta» borrando el botón de la refacción. Se siembran los cuatro
  -- con su regla actual antes de aplicar el cambio pedido, así que cualquier
  -- guardado deja el catálogo COMPLETO. Lo cazó supabase/tests/presencia_pausas.
  INSERT INTO public.presencia_tipos_pausa
    (company_id, codigo, etiqueta, descuenta, minutos_max, activo, orden)
  SELECT v_company, d.codigo, d.etiqueta, d.descuenta, d.minutos_max, true, d.orden
  FROM public.presencia_tipos_pausa_efectivos() d
  ON CONFLICT (company_id, codigo) DO NOTHING;

  INSERT INTO public.presencia_tipos_pausa
    (company_id, codigo, etiqueta, descuenta, minutos_max, activo, orden)
  VALUES
    (v_company, v_codigo, v_etiqueta, COALESCE(p_descuenta, true), p_minutos_max,
     COALESCE(p_activo, true),
     COALESCE((SELECT MAX(t.orden) + 1 FROM public.presencia_tipos_pausa t
               WHERE t.company_id = v_company), 1))
  ON CONFLICT (company_id, codigo) DO UPDATE
    SET etiqueta    = EXCLUDED.etiqueta,
        descuenta   = EXCLUDED.descuenta,
        minutos_max = EXCLUDED.minutos_max,
        activo      = EXCLUDED.activo,
        updated_at  = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.presencia_tipos_pausa_guardar(text, text, boolean, int, boolean) IS
  'Da de alta o actualiza un tipo de pausa de la empresa de quien llama. Materializa antes el catálogo entero, para que guardar UNO no deje a la empresa con un catálogo de un solo tipo. Exige condominios.tab.presencia.edit: cambiar `descuenta` cambia lo que se paga. Solo hacia adelante — las pausas ya registradas llevan su regla congelada.';

REVOKE EXECUTE ON FUNCTION public.presencia_tipos_pausa_guardar(text, text, boolean, int, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_tipos_pausa_guardar(text, text, boolean, int, boolean) TO authenticated;

-- ── 6. Los minutos de un marcaje, sumados ───────────────────────────────────
-- Un solo lugar contesta «cuánto pausó este registro», y por eso la pantalla y
-- la planilla no pueden divergir. Divergir fue exactamente el bug de #839: la
-- misma jornada valía 24 h en la lista y 0.01 h en el cómputo, porque cada lado
-- tenía su propia aritmética.
--
-- LA TERCERA COLUMNA es la que evita crear una asimetría nueva mientras se
-- arregla la vieja. Si las horas trabajadas bajan por el almuerzo pero las
-- NOCTURNAS no bajan por la cena, el recargo nocturno se paga sobre tiempo que
-- ya se descontó — y con el default de la casa (la cena descuenta) eso pasaría
-- el primer día en cualquier turno de noche. El solape con la franja 20:00–06:00
-- lo calcula `turnos_horas_nocturnas`, LA MISMA función que usa la jornada: la
-- definición de «noche» no puede tener dos versiones.
CREATE OR REPLACE FUNCTION public.presencia_minutos_pausa(
  p_registro_id uuid,
  p_tz          text DEFAULT 'America/Guatemala'
)
RETURNS TABLE (total numeric, descontables numeric, descontables_noche numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE(SUM(pa.minutos), 0)::numeric,
    COALESCE(SUM(pa.minutos) FILTER (WHERE pa.descuenta), 0)::numeric,
    COALESCE(SUM(
      CASE
        -- Sin instantes no se sabe A QUÉ HORA fue (pausa agregada a mano), y sin
        -- eso no se puede decir si cayó de noche. Se cuenta como diurna: es la
        -- lectura conservadora, la que NO regala recargo nocturno.
        WHEN pa.inicio_en IS NULL OR pa.fin_en IS NULL THEN 0
        -- Una pausa de duración cero haría que `fin <= inicio` se leyera como
        -- cruce de medianoche y devolviera diez horas de noche.
        WHEN pa.fin_en <= pa.inicio_en THEN 0
        ELSE public.turnos_horas_nocturnas(
               (pa.inicio_en AT TIME ZONE p_tz)::time,
               (pa.fin_en    AT TIME ZONE p_tz)::time,
               (pa.fin_en AT TIME ZONE p_tz)::date > (pa.inicio_en AT TIME ZONE p_tz)::date
             ) * 60.0
      END
    ) FILTER (WHERE pa.descuenta), 0)::numeric
  FROM public.presencia_pausas pa
  WHERE pa.registro_id = p_registro_id
    AND pa.anulado_en IS NULL
    AND pa.minutos IS NOT NULL
$$;

COMMENT ON FUNCTION public.presencia_minutos_pausa(uuid, text) IS
  'Minutos pausados de un marcaje: total (lo que se descansó), descontables (lo que resta de las horas laborales) y la parte de esos descontables que cae en la franja nocturna 20:00–06:00, para que el recargo de noche baje con ella. Ignora las anuladas y las abiertas. Fuente única de esa suma para la pantalla y para el cómputo de horas.';

-- Sin grant a `authenticated`: sus llamadores son cuerpos SECURITY DEFINER
-- (presencia_mi_ficha, calcular_horas_personal) que corren como el dueño. Es el
-- remedio que prescribe el propio scripts/migrations-guard.allowlist.json.
REVOKE EXECUTE ON FUNCTION public.presencia_minutos_pausa(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 7. La pausa huérfana se cierra al cerrar la jornada ─────────────────────
-- Alguien sale a almorzar, se olvida de marcar el regreso, y a las 18:00 marca
-- su salida. La pausa quedaría abierta para siempre: sin `fin_en` no tiene
-- `minutos`, así que no descuenta nada y además bloquea la siguiente pausa por
-- el índice de «una abierta a la vez».
--
-- POR QUÉ UN TRIGGER Y NO UNA LÍNEA DENTRO DE `presencia_marcar`. Porque la
-- jornada se cierra por TRES caminos —el autoservicio, el botón «Registrar
-- salida» del tab, y una corrección que ponga la hora de salida— y solo el
-- primero pasa por esa RPC. Una regla que vale para los tres tiene que vivir
-- donde ocurre el hecho, que es la fila. De paso evita copiar 200 líneas de
-- cuerpo de función para cambiar una.
--
-- No se rechaza la salida: dejar a alguien atrapado en la puerta porque olvidó
-- un botón sería el peor canje posible. Se cierra, se MARCA (`cerrada_al_salir`)
-- y quien administra la encuentra por esa marca.
CREATE OR REPLACE FUNCTION public.presencia_cerrar_pausa_al_salir()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.hora_salida IS NOT NULL AND OLD.hora_salida IS NULL THEN
    UPDATE public.presencia_pausas pa
       SET fin_en = COALESCE(NEW.salida_marcada_en, now()),
           cerrada_al_salir = true
     WHERE pa.registro_id = NEW.id
       AND pa.inicio_en IS NOT NULL
       AND pa.fin_en    IS NULL
       AND pa.anulado_en IS NULL
       -- Una salida corregida hacia atrás puede quedar ANTES del inicio de la
       -- pausa. El CHECK de orden lo rechazaría y tumbaría la corrección
       -- entera; se deja abierta, que es visible, en vez de romper.
       AND COALESCE(NEW.salida_marcada_en, now()) >= pa.inicio_en;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.presencia_cerrar_pausa_al_salir() IS
  'Trigger AFTER UPDATE de presencia_personal: cierra la pausa que quedó abierta cuando la jornada se cierra, por cualquiera de los tres caminos que la cierran, y la marca como cerrada_al_salir para que se pueda encontrar y ajustar.';

REVOKE EXECUTE ON FUNCTION public.presencia_cerrar_pausa_al_salir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_presencia_cerrar_pausa ON public.presencia_personal;
CREATE TRIGGER trg_presencia_cerrar_pausa
  AFTER UPDATE OF hora_salida ON public.presencia_personal
  FOR EACH ROW EXECUTE FUNCTION public.presencia_cerrar_pausa_al_salir();

-- ── 8. Marcar la pausa ──────────────────────────────────────────────────────
-- Mismo contrato que `presencia_marcar` y por las mismas dos razones: la hora
-- no es un parámetro, y el permiso que se exige no es «administrar presencia»
-- sino SER el empleado. Aquí la primera pesa todavía más: estos minutos RESTAN
-- de lo que se paga.
CREATE OR REPLACE FUNCTION public.presencia_pausar(
  p_project_id uuid,
  p_accion     text,
  p_tipo       text  DEFAULT NULL,
  p_gps        jsonb DEFAULT NULL
)
RETURNS TABLE (
  pausa_id  uuid,
  accion    text,
  tipo      text,
  etiqueta  text,
  descuenta boolean,
  minutos   numeric
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company   uuid;
  v_ficha     uuid;
  v_accion    text := lower(btrim(COALESCE(p_accion, '')));
  v_tipo      text := lower(btrim(COALESCE(p_tipo, '')));
  v_gps       jsonb;
  v_lat       numeric;
  v_lng       numeric;
  v_exactitud numeric;
  v_reg       public.presencia_personal%ROWTYPE;
  v_pausa     public.presencia_pausas%ROWTYPE;
  v_etiqueta  text;
  v_descuenta boolean;
  v_tz        text;
  v_fecha     date;
BEGIN
  IF v_accion NOT IN ('iniciar', 'terminar') THEN
    RAISE EXCEPTION 'Acción inválida (esperado iniciar o terminar)' USING ERRCODE = '22023';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  IF v_company IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este condominio' USING ERRCODE = '42501';
  END IF;

  v_ficha := public.presencia_ficha_de_usuario(p_project_id);
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a un expediente de personal en este condominio.'
      USING ERRCODE = '42501';
  END IF;

  v_tz    := public.presencia_zona_horaria(v_company);
  v_fecha := (now() AT TIME ZONE v_tz)::date;

  -- La jornada ABIERTA, con el mismo criterio de 48 h que usa la salida: el
  -- turno de noche entra el día 5 y almuerza —cena, más bien— el día 6.
  SELECT * INTO v_reg
  FROM public.presencia_personal pp
  WHERE pp.project_id   = p_project_id
    AND pp.personal_id  = v_ficha
    AND pp.hora_entrada IS NOT NULL
    AND pp.hora_salida  IS NULL
    AND pp.fecha       >= v_fecha - 1
    AND pp.anulado_en   IS NULL
  ORDER BY pp.fecha DESC, pp.hora_entrada DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tenés una jornada abierta. Marcá primero tu entrada.'
      USING ERRCODE = '22023';
  END IF;

  -- La ubicación, con la misma normalización que el marcaje: o es un par de
  -- coordenadas plausible o no se guarda nada.
  IF p_gps IS NOT NULL AND jsonb_typeof(p_gps) = 'object' THEN
    BEGIN
      v_lat := (p_gps->>'lat')::numeric;
      v_lng := (p_gps->>'lng')::numeric;
      v_exactitud := NULLIF(p_gps->>'exactitud_m', '')::numeric;
      IF v_lat BETWEEN -90 AND 90 AND v_lng BETWEEN -180 AND 180 THEN
        v_gps := jsonb_build_object('lat', v_lat, 'lng', v_lng, 'exactitud_m', v_exactitud);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_gps := NULL;
    END;
  END IF;

  -- ══ TERMINAR ═════════════════════════════════════════════════════════════
  IF v_accion = 'terminar' THEN
    SELECT * INTO v_pausa
    FROM public.presencia_pausas pa
    WHERE pa.registro_id = v_reg.id
      AND pa.inicio_en IS NOT NULL
      AND pa.fin_en    IS NULL
      AND pa.anulado_en IS NULL
    ORDER BY pa.inicio_en DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No tenés ninguna pausa abierta.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.presencia_pausas pa
       SET fin_en = now(), gps_fin = v_gps
     WHERE pa.id = v_pausa.id
    RETURNING pa.minutos INTO v_pausa.minutos;

    RETURN QUERY SELECT v_pausa.id, 'terminar'::text, v_pausa.tipo, v_pausa.etiqueta,
                        v_pausa.descuenta, v_pausa.minutos;
    RETURN;
  END IF;

  -- ══ INICIAR ══════════════════════════════════════════════════════════════
  IF EXISTS (
    SELECT 1 FROM public.presencia_pausas pa
    WHERE pa.registro_id = v_reg.id
      AND pa.inicio_en IS NOT NULL
      AND pa.fin_en    IS NULL
      AND pa.anulado_en IS NULL
  ) THEN
    RAISE EXCEPTION 'Ya tenés una pausa abierta. Terminala antes de empezar otra.'
      USING ERRCODE = '23505';
  END IF;

  -- El tipo tiene que estar en el catálogo VIGENTE de la empresa. Aceptar uno
  -- inventado dejaría una pausa cuya regla de planilla nadie decidió.
  SELECT t.etiqueta, t.descuenta INTO v_etiqueta, v_descuenta
  FROM public.presencia_tipos_pausa_efectivos() t
  WHERE t.codigo = v_tipo;

  IF v_etiqueta IS NULL THEN
    RAISE EXCEPTION 'Tipo de pausa desconocido: %', COALESCE(NULLIF(v_tipo, ''), '(vacío)')
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.presencia_pausas (
    company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
    inicio_en, gps_inicio, origen
  ) VALUES (
    v_company, p_project_id, v_reg.id, v_ficha, v_tipo, v_etiqueta, v_descuenta,
    now(), v_gps, 'autoservicio'
  )
  RETURNING id INTO v_pausa.id;

  RETURN QUERY SELECT v_pausa.id, 'iniciar'::text, v_tipo, v_etiqueta, v_descuenta, NULL::numeric;
END;
$$;

COMMENT ON FUNCTION public.presencia_pausar(uuid, text, text, jsonb) IS
  'La persona abre o cierra una pausa de su jornada. Los DOS instantes los pone el servidor: si el cliente pudiera mandarlos, estaría tecleando minutos que se restan de su propio pago. Exige tener una jornada abierta (48 h, por el turno nocturno) y un tipo del catálogo vigente de la empresa; la regla de planilla se copia y se congela en la fila. Una pausa abierta a la vez. Sin foto, a propósito: la fricción no produce evidencia, produce pausas sin marcar.';

REVOKE EXECUTE ON FUNCTION public.presencia_pausar(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_pausar(uuid, text, text, jsonb) TO authenticated;

-- ── 9. Ajustar, anular y agregar (lo que hace quien administra) ─────────────
-- Guarda compartida: una pausa se puede tocar si se puede tocar SU MARCAJE.
-- Reutiliza `presencia_fila_editable` (20260908000200) en vez de repetir la
-- comprobación, para que las dos no puedan divergir en quién contesta.
CREATE OR REPLACE FUNCTION public.presencia_pausa_editable(p_pausa_id uuid, p_permiso text)
RETURNS public.presencia_pausas
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pausa public.presencia_pausas%ROWTYPE;
BEGIN
  SELECT * INTO v_pausa FROM public.presencia_pausas pa WHERE pa.id = p_pausa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La pausa no existe' USING ERRCODE = '42704';
  END IF;
  PERFORM public.presencia_fila_editable(v_pausa.registro_id, p_permiso);
  RETURN v_pausa;
END;
$$;

COMMENT ON FUNCTION public.presencia_pausa_editable(uuid, text) IS
  'Guarda compartida de presencia_pausa_ajustar y presencia_pausa_anular: una pausa se toca si se puede tocar su marcaje, delegando en presencia_fila_editable.';

REVOKE EXECUTE ON FUNCTION public.presencia_pausa_editable(uuid, text) FROM PUBLIC, anon, authenticated;

-- AJUSTAR — solo la DURACIÓN, y esa restricción es el diseño. Dejar reescribir
-- los instantes sería devolverle al teclado la hora que este módulo entero
-- existe para quitarle, y aquí ni siquiera hay foto que sirva de ancla. Lo que
-- consume la planilla son los minutos; corregir los minutos es corregir el dato.
-- El fin se recoloca a partir del inicio real, así que la pausa sigue diciendo
-- CUÁNDO fue —lo que la hace nocturna o diurna—, solo que dura lo corregido.
CREATE OR REPLACE FUNCTION public.presencia_pausa_ajustar(
  p_pausa_id uuid,
  p_minutos  numeric,
  p_motivo   text
)
RETURNS TABLE (pausa_id uuid, minutos numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pausa  public.presencia_pausas%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_autor  text;
  v_min    numeric;
BEGIN
  v_pausa := public.presencia_pausa_editable(p_pausa_id, 'condominios.tab.presencia.edit');

  IF v_pausa.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta pausa está anulada: no se ajusta' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribí el motivo del ajuste (al menos 5 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF p_minutos IS NULL OR p_minutos < 0 OR p_minutos > 1440 THEN
    RAISE EXCEPTION 'Los minutos tienen que estar entre 0 y 1440' USING ERRCODE = '22023';
  END IF;

  v_min   := ROUND(p_minutos, 2);
  v_autor := public.presencia_nombre_de_usuario((SELECT auth.uid()));

  UPDATE public.presencia_pausas pa
     SET minutos = v_min,
         -- Con instante de inicio, el fin se deriva y el trigger vuelve a sellar
         -- los mismos minutos. Sin él (pausa agregada a mano), la duración ES el
         -- dato y el trigger no la toca.
         fin_en  = CASE WHEN pa.inicio_en IS NOT NULL
                        THEN pa.inicio_en + (v_min || ' minutes')::interval
                        ELSE pa.fin_en END,
         corregido_por        = (SELECT auth.uid()),
         corregido_por_nombre = v_autor,
         corregido_en         = now(),
         motivo_correccion    = v_motivo
   WHERE pa.id = p_pausa_id;

  RETURN QUERY SELECT p_pausa_id, v_min;
END;
$$;

COMMENT ON FUNCTION public.presencia_pausa_ajustar(uuid, numeric, text) IS
  'Corrige la DURACIÓN de una pausa, con motivo obligatorio y huella de quién y cuándo. No deja reescribir los instantes: el momento de la pausa lo puso el servidor y lo sigue poniendo — lo que se corrige es cuánto duró, que es lo que consume la planilla. Exige condominios.tab.presencia.edit.';

REVOKE EXECUTE ON FUNCTION public.presencia_pausa_ajustar(uuid, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_pausa_ajustar(uuid, numeric, text) TO authenticated;

-- ANULAR — exige `.delete`, igual que anular un marcaje: quitar una pausa
-- DEVUELVE horas pagadas, que es tan sensible como quitarlas.
CREATE OR REPLACE FUNCTION public.presencia_pausa_anular(
  p_pausa_id uuid,
  p_motivo   text
)
RETURNS TABLE (pausa_id uuid, anulado_en timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pausa  public.presencia_pausas%ROWTYPE;
  v_motivo text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_autor  text;
  v_ahora  timestamptz := now();
BEGIN
  v_pausa := public.presencia_pausa_editable(p_pausa_id, 'condominios.tab.presencia.delete');

  IF v_pausa.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Esta pausa ya estaba anulada' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribí el motivo de la anulación (al menos 5 caracteres)' USING ERRCODE = '22023';
  END IF;

  v_autor := public.presencia_nombre_de_usuario((SELECT auth.uid()));

  UPDATE public.presencia_pausas pa
     SET anulado_en           = v_ahora,
         corregido_por        = (SELECT auth.uid()),
         corregido_por_nombre = v_autor,
         corregido_en         = v_ahora,
         motivo_correccion    = v_motivo
   WHERE pa.id = p_pausa_id;

  RETURN QUERY SELECT p_pausa_id, v_ahora;
END;
$$;

COMMENT ON FUNCTION public.presencia_pausa_anular(uuid, text) IS
  'Anula una pausa: queda visible y marcada, pero fuera del cómputo. No borra. Exige condominios.tab.presencia.delete —no .edit— porque quitar una pausa devuelve horas pagadas.';

REVOKE EXECUTE ON FUNCTION public.presencia_pausa_anular(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_pausa_anular(uuid, text) TO authenticated;

-- AGREGAR — la pausa que la persona no marcó. Sin esto, el único error
-- corregible sería el de más (ajustar hacia abajo) y el de menos —el almuerzo
-- que nadie marcó— quedaría pagado para siempre, que es justo el que cuesta.
--
-- NACE SIN INSTANTES, y eso es lo honesto: se sabe cuánto duró porque alguien lo
-- declara, no a qué hora fue. Inventarle un momento para llenar la columna
-- produciría el dato falso que este módulo existe para no producir — y de paso
-- la haría contar como nocturna o diurna por azar.
CREATE OR REPLACE FUNCTION public.presencia_pausa_agregar(
  p_registro_id uuid,
  p_tipo        text,
  p_minutos     numeric,
  p_motivo      text
)
RETURNS TABLE (pausa_id uuid, minutos numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fila      public.presencia_personal%ROWTYPE;
  v_motivo    text := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_tipo      text := lower(btrim(COALESCE(p_tipo, '')));
  v_etiqueta  text;
  v_descuenta boolean;
  v_autor     text;
  v_min       numeric;
  v_id        uuid;
BEGIN
  v_fila := public.presencia_fila_editable(p_registro_id, 'condominios.tab.presencia.edit');

  IF v_fila.anulado_en IS NOT NULL THEN
    RAISE EXCEPTION 'Este marcaje está anulado: no cuenta horas, agregarle una pausa no cambia nada'
      USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribí el motivo (al menos 5 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF p_minutos IS NULL OR p_minutos <= 0 OR p_minutos > 1440 THEN
    RAISE EXCEPTION 'Los minutos tienen que estar entre 1 y 1440' USING ERRCODE = '22023';
  END IF;

  SELECT t.etiqueta, t.descuenta INTO v_etiqueta, v_descuenta
  FROM public.presencia_tipos_pausa_efectivos() t
  WHERE t.codigo = v_tipo;

  IF v_etiqueta IS NULL THEN
    RAISE EXCEPTION 'Tipo de pausa desconocido: %', COALESCE(NULLIF(v_tipo, ''), '(vacío)')
      USING ERRCODE = '22023';
  END IF;

  v_min   := ROUND(p_minutos, 2);
  v_autor := public.presencia_nombre_de_usuario((SELECT auth.uid()));

  INSERT INTO public.presencia_pausas (
    company_id, project_id, registro_id, personal_id, tipo, etiqueta, descuenta,
    inicio_en, fin_en, minutos, origen,
    registrada_por, registrada_por_nombre,
    corregido_por, corregido_por_nombre, corregido_en, motivo_correccion
  ) VALUES (
    v_fila.company_id, v_fila.project_id, p_registro_id, v_fila.personal_id,
    v_tipo, v_etiqueta, v_descuenta,
    NULL, NULL, v_min, 'manual',
    (SELECT auth.uid()), v_autor,
    (SELECT auth.uid()), v_autor, now(), v_motivo
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_min;
END;
$$;

COMMENT ON FUNCTION public.presencia_pausa_agregar(uuid, text, numeric, text) IS
  'Agrega a un marcaje la pausa que la persona no marcó, con motivo obligatorio. Nace SIN instantes: se declara cuánto duró, no a qué hora fue, porque eso último nadie lo sabe. Exige condominios.tab.presencia.edit.';

REVOKE EXECUTE ON FUNCTION public.presencia_pausa_agregar(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_pausa_agregar(uuid, text, numeric, text) TO authenticated;

-- ── 10. La pantalla del empleado sabe de su pausa ───────────────────────────
-- `presencia_mi_ficha` gana la pausa abierta y los minutos pausados del día. Y
-- de paso arregla un agujero que la pausa dejó a la vista:
--
-- LA JORNADA NOCTURNA NO SE VEÍA. La ficha miraba SOLO la fila de HOY, pero
-- `presencia_marcar` cierra «la última entrada abierta de las últimas 48 h»
-- justamente porque el turno de noche entra el día 5 y sale el 6. A las 00:30
-- del día 6 la pantalla no veía la jornada abierta de ayer: le ofrecía a la
-- persona marcar ENTRADA, y marcarla habría abierto un SEGUNDO turno en vez de
-- dejarla cerrar el primero. Con pausas el agujero es peor —los botones de
-- refacción no aparecerían nunca en el turno que más los necesita, el de
-- noche—, así que se arregla aquí: la ficha prefiere la jornada ABIERTA de las
-- últimas 48 h y, si no hay ninguna, la fila de hoy como hasta ahora.
--
-- DROP + CREATE otra vez, por lo mismo que en 20260908000200: un REPLACE no
-- puede cambiar las columnas OUT.
DROP FUNCTION IF EXISTS public.presencia_mi_ficha(uuid);

CREATE OR REPLACE FUNCTION public.presencia_mi_ficha(p_project_id uuid)
RETURNS TABLE (
  personal_id       uuid,
  nombre            text,
  cargo             text,
  foto_url          text,
  fecha_operativa   date,
  hora_servidor     time,
  bloque_id         uuid,
  turno             text,
  turno_inicio      time,
  turno_fin         time,
  registro_id       uuid,
  hora_entrada      time,
  hora_salida       time,
  estado            text,
  origen            text,
  corregido_en      timestamptz,
  corregido_por_nombre text,
  motivo_correccion text,
  anulado_en        timestamptz,
  registro_fecha    date,
  pausa_abierta_id       uuid,
  pausa_abierta_tipo     text,
  pausa_abierta_etiqueta text,
  pausa_abierta_desde    timestamptz,
  minutos_pausa             numeric,
  minutos_pausa_descontables numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company uuid;
  v_ficha   uuid;
  v_tz      text;
  v_local   timestamp;
BEGIN
  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Proyecto inexistente' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_super_admin() AND v_company IS DISTINCT FROM public.get_my_company_id() THEN
    RAISE EXCEPTION 'Proyecto fuera de la empresa' USING ERRCODE = '42501';
  END IF;

  v_ficha := public.presencia_ficha_de_usuario(p_project_id);
  IF v_ficha IS NULL THEN
    RETURN;  -- sin ficha vinculada no hay autoservicio; no es un error.
  END IF;

  v_tz := public.presencia_zona_horaria(v_company);
  v_local := (now() AT TIME ZONE v_tz);

  RETURN QUERY
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    pc.foto_url,
    v_local::date,
    v_local::time,
    bt.id,
    bt.turno,
    bt.hora_inicio,
    bt.hora_fin,
    pp.id,
    pp.hora_entrada,
    pp.hora_salida,
    pp.estado,
    pp.origen,
    pp.corregido_en,
    pp.corregido_por_nombre,
    pp.motivo_correccion,
    pp.anulado_en,
    pp.fecha,
    pa.id,
    pa.tipo,
    pa.etiqueta,
    pa.inicio_en,
    COALESCE(mp.total, 0),
    COALESCE(mp.descontables, 0)
  FROM public.personal_condominio pc
  LEFT JOIN public.bloques_turno bt
    ON bt.personal_id = pc.id
   AND bt.project_id  = p_project_id
   AND bt.fecha       = v_local::date
  -- LATERAL y no un LEFT JOIN llano: desde que lo anulado no ocupa el día
  -- (20260908000200) una persona puede tener DOS filas la misma fecha, y el join
  -- devolvería las dos. El ORDER BY es la prioridad completa:
  --   1º la jornada ABIERTA —de hoy o de ayer, que es el turno nocturno—,
  --   2º entre las de hoy, la de hoy antes que la de ayer,
  --   3º la vigente antes que la anulada (así la persona se entera de que le
  --      anularon el marcaje, en vez de ver la pantalla en blanco).
  LEFT JOIN LATERAL (
    SELECT p2.*
    FROM public.presencia_personal p2
    WHERE p2.personal_id = pc.id
      AND p2.project_id  = p_project_id
      AND p2.fecha      >= v_local::date - 1
      AND (
        p2.fecha = v_local::date
        OR (p2.hora_entrada IS NOT NULL AND p2.hora_salida IS NULL AND p2.anulado_en IS NULL)
      )
    ORDER BY
      (p2.anulado_en IS NULL AND p2.hora_entrada IS NOT NULL AND p2.hora_salida IS NULL) DESC,
      (p2.fecha = v_local::date) DESC,
      (p2.anulado_en IS NULL) DESC,
      p2.created_at DESC
    LIMIT 1
  ) pp ON true
  LEFT JOIN LATERAL (
    SELECT pz.* FROM public.presencia_pausas pz
    WHERE pz.registro_id = pp.id
      AND pz.inicio_en IS NOT NULL
      AND pz.fin_en    IS NULL
      AND pz.anulado_en IS NULL
    ORDER BY pz.inicio_en DESC
    LIMIT 1
  ) pa ON true
  LEFT JOIN LATERAL public.presencia_minutos_pausa(pp.id, v_tz) mp ON true
  WHERE pc.id = v_ficha;
END;
$$;

COMMENT ON FUNCTION public.presencia_mi_ficha(uuid) IS
  'Datos con los que se rellena solo el marcaje de autoservicio: expediente de quien llama, fecha y hora del SERVIDOR en la zona del tenant, turno planificado, el marcaje vigente —incluido si se lo corrigieron o anularon (20260908000200)— y su pausa abierta y minutos pausados (20260908000300). Prefiere la jornada ABIERTA de las últimas 48 h, para que el turno nocturno pueda cerrarse y pausarse desde el día siguiente. Cero filas = la cuenta no tiene expediente aquí (no es error).';

REVOKE EXECUTE ON FUNCTION public.presencia_mi_ficha(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.presencia_mi_ficha(uuid) TO authenticated;

-- ── 11. La planilla: estadía, laborales y descanso, separadas ───────────────
-- Se vuelve a declarar `calcular_horas_personal` ENTERA porque Postgres no deja
-- parchear un cuerpo, y con DROP previo porque gana columnas OUT. Respecto a
-- 20260908000200 cambia SOLO el CTE `marcaje` y las dos columnas nuevas del
-- SELECT final; el resto —extras, asuetos, ausencias— es idéntico a propósito.
--
-- LO QUE CAMBIA DE VERDAD, dicho sin adornos: `horas_trabajadas` deja de ser
-- «entrada → salida» y pasa a ser «entrada → salida MENOS las pausas que
-- descuentan». Es la cifra que alimenta ordinarias y extras, así que el cambio
-- se ve en planilla.
--
-- POR QUÉ ES UN ARREGLO Y NO UN RIESGO. Las horas PLANIFICADAS ya venían netas
-- de descanso desde 20260820000000: `turnos_sellar_horas` le resta
-- `plantillas_horario.minutos_descanso` a `horas_planificadas`. Lo trabajado se
-- calculaba bruto. La planilla comparaba, literalmente, neto contra bruto: un
-- turno de 8 h con 30 min de descanso planificaba 8.0 y, con la persona 8.5 h en
-- el puesto, marcaba 8.5 trabajadas y media hora de extra que nadie autorizó.
--
-- Y NO REESCRIBE EL PASADO. Un marcaje sin pausas registradas descuenta cero,
-- así que todas las filas anteriores a esta migración dan exactamente el mismo
-- número que daban. Lo que cambia empieza el día que alguien marca su primera
-- pausa.
DROP FUNCTION IF EXISTS public.calcular_horas_personal(uuid, date, date, numeric);

CREATE OR REPLACE FUNCTION public.calcular_horas_personal(
  p_project_id          uuid,
  p_desde               date,
  p_hasta               date,
  p_jornada_referencia  numeric DEFAULT 8.0
)
RETURNS TABLE (
  personal_id             uuid,
  nombre                  text,
  cargo                   text,
  dias_planificados       int,
  dias_trabajados         int,
  dias_ausencia           int,
  dias_asueto_trabajado   int,
  tardanzas               int,
  horas_planificadas      numeric,
  horas_estadia           numeric,
  horas_descanso          numeric,
  horas_trabajadas        numeric,
  horas_ordinarias        numeric,
  horas_extra             numeric,
  horas_nocturnas         numeric,
  horas_asueto            numeric,
  horas_asueto_ponderadas numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_tz      text;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde THEN
    RAISE EXCEPTION 'rango de fechas inválido' USING ERRCODE = '22007';
  END IF;

  SELECT p.company_id INTO v_company FROM public.projects p WHERE p.id = p_project_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'proyecto inexistente' USING ERRCODE = '42704';
  END IF;

  PERFORM public.assert_company_scope(v_company);

  IF NOT (public.is_super_admin()
          OR public.user_has_permission('condominios.tab.horas_extra')
          OR public.user_has_permission('condominios.tab.turnos')) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  v_tz := public.presencia_zona_horaria(v_company);

  RETURN QUERY
  WITH plan AS (
    -- Lo planificado, por persona y día. Se agrupa porque alguien puede tener
    -- dos bloques el mismo día (turno partido, o doblar).
    SELECT
      b.personal_id AS pid,
      b.fecha,
      SUM(COALESCE(b.horas_planificadas, 0))::numeric AS horas
    FROM public.bloques_turno b
    WHERE b.project_id = p_project_id
      AND b.company_id = v_company
      AND b.fecha BETWEEN p_desde AND p_hasta
    GROUP BY b.personal_id, b.fecha
  ),
  marcaje AS (
    -- Lo efectivamente trabajado. Solo cuenta el marcaje atado a un empleado del
    -- expediente: `personal_id` es NULL en el histórico anterior a
    -- 20260820000100 y en quien no está en plantilla, y sumar esas horas a
    -- alguien sería inventar el dato.
    SELECT
      pp.personal_id AS pid,
      pp.fecha,
      -- ESTADÍA: lo que la persona estuvo. Es el número de antes, intacto.
      SUM(public.turnos_horas_jornada(pp.hora_entrada, pp.hora_salida, false, 0))::numeric AS horas_estadia,
      -- DESCANSO: todo lo pausado, descuente o no. Se mide para poder mirarlo
      -- —comprobar que el descanso se está dando—, no solo para restarlo.
      SUM(mp.total / 60.0)::numeric AS horas_descanso,
      -- LABORALES: la estadía menos lo que descuenta. GREATEST porque una pausa
      -- mal ajustada no puede producir horas negativas en una planilla.
      SUM(GREATEST(0,
        public.turnos_horas_jornada(pp.hora_entrada, pp.hora_salida, false, 0)
        - mp.descontables / 60.0
      ))::numeric AS horas,
      -- NOCTURNAS netas de la parte de la pausa que cayó en la franja: si no,
      -- el recargo de noche se pagaría sobre la cena que acabamos de descontar.
      SUM(GREATEST(0,
        public.turnos_horas_nocturnas(pp.hora_entrada, pp.hora_salida, false)
        - mp.descontables_noche / 60.0
      ))::numeric AS horas_noche,
      COUNT(*) FILTER (WHERE pp.estado = 'tardanza')::int AS tardanzas
    FROM public.presencia_personal pp
    -- Fuente ÚNICA de la suma de pausas, compartida con la pantalla: que cada
    -- lado tuviera su aritmética es lo que produjo #839.
    CROSS JOIN LATERAL public.presencia_minutos_pausa(pp.id, v_tz) mp
    WHERE pp.project_id = p_project_id
      AND pp.company_id = v_company
      AND pp.fecha BETWEEN p_desde AND p_hasta
      AND pp.personal_id IS NOT NULL
      AND pp.hora_entrada IS NOT NULL
      AND pp.hora_salida IS NOT NULL
      AND pp.anulado_en IS NULL
    GROUP BY pp.personal_id, pp.fecha
  ),
  dias AS (
    -- FULL OUTER: hay días planificados que nadie marcó (falta) y días marcados
    -- que nadie planificó (cobertura de emergencia). Ambos importan.
    SELECT
      COALESCE(pl.pid, ma.pid)       AS pid,
      COALESCE(pl.fecha, ma.fecha)   AS fecha,
      COALESCE(pl.horas, 0)          AS planificadas,
      COALESCE(ma.horas, 0)          AS trabajadas,
      COALESCE(ma.horas_estadia, 0)  AS estadia,
      COALESCE(ma.horas_descanso, 0) AS descanso,
      COALESCE(ma.horas_noche, 0)    AS nocturnas,
      COALESCE(ma.tardanzas, 0)      AS tardanzas,
      pl.pid IS NOT NULL             AS fue_planificado,
      ma.pid IS NOT NULL             AS fue_trabajado
    FROM plan pl
    FULL OUTER JOIN marcaje ma ON ma.pid = pl.pid AND ma.fecha = pl.fecha
  ),
  dias_con_contexto AS (
    SELECT
      d.*,
      dnl.factor_recargo,
      dnl.paga_recargo,
      EXISTS (
        SELECT 1 FROM public.ausencias_personal au
        WHERE au.personal_id = d.pid
          AND au.estado = 'aprobada'
          AND d.fecha BETWEEN au.fecha_inicio AND au.fecha_fin
      ) AS hay_ausencia,
      -- Sin jornada planificada, la referencia evita que una cobertura no
      -- programada se contabilice entera como extra.
      CASE WHEN d.planificadas > 0 THEN d.planificadas ELSE p_jornada_referencia END AS base
    FROM dias d
    LEFT JOIN public.dias_no_laborables dnl
      ON dnl.project_id = p_project_id AND dnl.fecha = d.fecha
  )
  SELECT
    pc.id,
    pc.nombre,
    pc.cargo,
    COUNT(*) FILTER (WHERE dc.fue_planificado)::int,
    COUNT(*) FILTER (WHERE dc.fue_trabajado)::int,
    COUNT(*) FILTER (WHERE dc.hay_ausencia)::int,
    COUNT(*) FILTER (WHERE dc.fue_trabajado AND dc.factor_recargo IS NOT NULL)::int,
    COALESCE(SUM(dc.tardanzas), 0)::int,
    ROUND(COALESCE(SUM(dc.planificadas), 0), 2),
    ROUND(COALESCE(SUM(dc.estadia), 0), 2),
    ROUND(COALESCE(SUM(dc.descanso), 0), 2),
    ROUND(COALESCE(SUM(dc.trabajadas), 0), 2),
    ROUND(COALESCE(SUM(LEAST(dc.trabajadas, dc.base)), 0), 2),
    ROUND(COALESCE(SUM(GREATEST(0, dc.trabajadas - dc.base)), 0), 2),
    ROUND(COALESCE(SUM(dc.nocturnas), 0), 2),
    ROUND(COALESCE(SUM(dc.trabajadas) FILTER (WHERE dc.factor_recargo IS NOT NULL), 0), 2),
    -- Lo mismo, ya multiplicado por el factor del día: es la cifra que entra a
    -- planilla. Un asueto con paga_recargo=false cuenta como día ordinario.
    ROUND(COALESCE(SUM(
      dc.trabajadas * CASE WHEN COALESCE(dc.paga_recargo, false) THEN dc.factor_recargo ELSE 1 END
    ) FILTER (WHERE dc.factor_recargo IS NOT NULL), 0), 2)
  FROM dias_con_contexto dc
  JOIN public.personal_condominio pc ON pc.id = dc.pid
  WHERE pc.project_id = p_project_id
  GROUP BY pc.id, pc.nombre, pc.cargo
  ORDER BY pc.nombre;
END;
$$;

COMMENT ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) IS
  'Consolidado de jornada por empleado en un rango: planificado vs marcado, ESTADÍA (lo que estuvo), DESCANSO (lo que pausó) y TRABAJADAS (estadía menos las pausas que descuentan, 20260908000300), más ordinarias, extra, nocturnas (20:00–06:00, netas de la pausa que cayó en la franja) y asueto con su factor. Excluye los marcajes anulados (20260908000200). No persiste nada — se recalcula del marcaje vigente.';

REVOKE EXECUTE ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.calcular_horas_personal(uuid, date, date, numeric) TO authenticated, service_role;
