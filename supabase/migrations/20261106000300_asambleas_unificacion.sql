-- ════════════════════════════════════════════════════════════════════════════
-- Asambleas, Fase 3: un solo modelo. La asamblea digital se funde en
-- `asambleas`, el acta formal se liga a su asamblea (y se genera desde ella) y
-- `votaciones` queda como consulta fuera de asamblea, con integridad.
--
-- POR QUÉ
--   · Había dos «asambleas». `asambleas_digital` llevaba el nombre de la
--     función que cobra el plan, pero no tenía puntos, votos, quórum ni
--     escrutinio: sólo modalidad, link de reunión y el acta en texto (en una
--     columna llamada `acta_url`). Confundirlas causó los bugs de #981 y #984.
--   · El acta formal (`actas_reunion`: asistentes, orden del día, acuerdos) no
--     tenía relación con la asamblea: se volvía a escribir a mano lo que la
--     asamblea ya sabía (quién asistió, qué se votó, qué se aprobó).
--   · `votaciones`/`votos` no tenían ninguna regla: el voto podía ser una
--     opción que no existe, se votaba con la votación cerrada, el resultado lo
--     calculaba y escribía el navegador, y la policy de INSERT de `votos` sólo
--     miraba el `company_id` que manda el cliente: nada impedía votar en una
--     votación o con una unidad de otra empresa. Sus tipos «múltiple» y
--     «ponderada» se guardaban y no hacían nada, y el vínculo con una asamblea
--     duplicaba lo que en la asamblea son los puntos.
--
-- DECISIONES DEL DUEÑO
--   · Fusionar `asambleas_digital` en `asambleas` y retirarla (tabla y
--     pestaña).
--   · Ligar el acta formal a su asamblea y generarla desde ella al finalizar.
--   · `votaciones` = consulta a los propietarios fuera de asamblea, con
--     integridad; sin vínculo con asamblea ni los tipos que no hacen nada.
--
-- QUÉ HACE
--   1 · asambleas.modalidad (presencial | virtual | hibrida), link_reunion
--       (sólo http/https: se muestra como enlace) y descripcion.
--   2 · Las filas de asambleas_digital pasan a asambleas con el mismo id:
--       fecha y hora en el huso de la empresa, el acta (`acta_url`) a
--       `asambleas.acta`, `created_by` a `convocado_por`. Un link sin esquema
--       que parece un dominio recibe https://; uno que no es una dirección web
--       se conserva en la descripción, nombrado, en vez de perderse. Después se
--       borra la tabla.
--   3 · actas_reunion.asamblea_id: una acta por asamblea, de su mismo
--       condominio, y sólo con la asamblea finalizada. Si se borra la asamblea,
--       el acta queda (SET NULL): es un documento aparte.
--   4 · asamblea_generar_acta(id): levanta el acta formal de una asamblea
--       finalizada con su asistencia (asistió o votó; por poder, el
--       apoderado), su orden del día con el resultado de cada punto, los
--       acuerdos aprobados y el quórum. Si ya existe, devuelve la que hay.
--       Exige ver la asamblea y poder crear actas.
--   5 · votaciones: sin asamblea_id ni tipo; CHECK de estado, de opciones (al
--       menos dos, con id y texto, ids únicos) y de quórum. Nace abierta;
--       abierta → cerrada | anulada; cerrada o anulada no cambia más. Con votos
--       sus opciones no cambian. Al cerrar, la base escribe `conteo` y
--       `resultado` (la opción ganadora, «Empate», «Sin votos» o «Sin quórum»
--       si no llega al mínimo de votos); nadie más los escribe.
--       votos: sólo con la votación abierta, una opción que exista, y la unidad
--       y la empresa de la votación. Cerrada, sus votos no cambian (pasan las
--       cascadas de la unidad y de la votación).
--   6 · Guarda de postcondición.
--
-- IMPACTO
-- La pestaña «Asamblea digital» desaparece: sus funciones viven en
-- «Asambleas». Las claves RBAC condominios.tab.asamblea_digital.* quedan en el
-- catálogo (las nombra el mapa de rls-acciones de 20261104000100); los roles
-- que las tienen también tienen las de asambleas. Producción (2026-10-23):
-- 1 asamblea digital, 1 acta, 1 votación sin votos ni asamblea.
--
-- REVERSIÓN
-- La tabla borrada no se recrea sola: sus filas quedan en asambleas con el
-- mismo id. DROP FUNCTION asamblea_generar_acta(uuid) y las funciones *_tg_ de
-- esta migración; DROP COLUMN actas_reunion.asamblea_id, asambleas.modalidad,
-- link_reunion, descripcion, votaciones.conteo; ADD COLUMN votaciones.tipo,
-- asamblea_id.
--
-- IDEMPOTENTE: IF NOT EXISTS / DROP … IF EXISTS en columnas, CHECK y
-- triggers; la fusión corre sólo si la tabla existe; CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Modalidad, link y descripción de la asamblea ────────────────────────
ALTER TABLE public.asambleas ADD COLUMN IF NOT EXISTS modalidad text NOT NULL DEFAULT 'presencial';
ALTER TABLE public.asambleas ADD COLUMN IF NOT EXISTS link_reunion text;
ALTER TABLE public.asambleas ADD COLUMN IF NOT EXISTS descripcion text;
ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_modalidad_check;
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_modalidad_check CHECK (modalidad IN ('presencial', 'virtual', 'hibrida'));
-- La pantalla lo muestra como enlace: un `javascript:` sería código.
ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_link_reunion_check;
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_link_reunion_check CHECK (link_reunion ~* '^https?://[^[:space:]]+$');

-- ── 2 · asambleas_digital → asambleas ───────────────────────────────────────
DO $$
DECLARE
  v_fuera text;
BEGIN
  IF to_regclass('public.asambleas_digital') IS NULL THEN
    RETURN;   -- ya se fusionó
  END IF;

  EXECUTE $q$
    SELECT string_agg(format('%s (quórum %s)', titulo, quorum_requerido), '; ')
      FROM public.asambleas_digital WHERE quorum_requerido NOT BETWEEN 0 AND 100
  $q$ INTO v_fuera;
  IF v_fuera IS NOT NULL THEN
    RAISE EXCEPTION 'asambleas: asambleas digitales con quórum fuera de 0–100 (%): revisarlas antes de fusionar', v_fuera;
  END IF;

  -- [paso:fusion]
  EXECUTE $q$
    WITH d AS (
      SELECT d.*,
             btrim(d.link_reunion) AS link,
             (d.fecha_hora AT TIME ZONE coalesce(
                (SELECT tz.name FROM pg_catalog.pg_timezone_names tz WHERE tz.name = c.timezone),
                'America/Guatemala')) AS local
        FROM public.asambleas_digital d
        JOIN public.companies c ON c.id = d.company_id
    ), n AS (
      SELECT d.*,
             CASE WHEN d.link ~* '^https?://[^[:space:]]+$' THEN d.link
                  WHEN d.link ~* '^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(/[^[:space:]]*)?$' THEN 'https://' || d.link
             END AS link_ok
        FROM d
    )
    INSERT INTO public.asambleas (id, company_id, project_id, titulo, tipo, fecha, hora_inicio, lugar, estado,
                                  quorum_requerido, acta, convocado_por, created_at, modalidad, link_reunion, descripcion)
    SELECT n.id, n.company_id, n.project_id, n.titulo, 'ordinaria', n.local::date, n.local::time, NULL, n.estado,
           n.quorum_requerido, nullif(btrim(n.acta_url), ''),
           (SELECT u.id FROM auth.users u WHERE u.id = n.created_by),
           coalesce(n.created_at, now()), n.modalidad, n.link_ok,
           nullif(concat_ws(E'\n\n',
             nullif(btrim(n.descripcion), ''),
             CASE WHEN n.link_ok IS NULL AND nullif(n.link, '') IS NOT NULL
                  THEN 'Enlace de reunión registrado (no es una dirección web): ' || n.link END), '')
      FROM n
    ON CONFLICT (id) DO NOTHING
  $q$;
  -- [/paso:fusion]

  DROP TABLE public.asambleas_digital;
END $$;

-- ── 3 · El acta formal, ligada a su asamblea ────────────────────────────────
ALTER TABLE public.actas_reunion
  ADD COLUMN IF NOT EXISTS asamblea_id uuid REFERENCES public.asambleas(id) ON DELETE SET NULL;
ALTER TABLE public.actas_reunion DROP CONSTRAINT IF EXISTS actas_reunion_asamblea_key;
ALTER TABLE public.actas_reunion ADD CONSTRAINT actas_reunion_asamblea_key UNIQUE (asamblea_id);

COMMENT ON COLUMN public.actas_reunion.asamblea_id IS
  'Asamblea de la que es acta formal (una por asamblea, del mismo condominio, finalizada). NULL en actas de junta, comité u otras reuniones.';

-- BEFORE INSERT/UPDATE OF asamblea_id, company_id, project_id. SECURITY
-- DEFINER: la asamblea se mira aunque quien escribe el acta no la vea.
CREATE OR REPLACE FUNCTION public.asambleas_tg_acta_asamblea()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado   text;
  v_empresa  uuid;
  v_proyecto uuid;
BEGIN
  IF NEW.asamblea_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT a.estado, a.company_id, a.project_id INTO v_estado, v_empresa, v_proyecto
    FROM public.asambleas a WHERE a.id = NEW.asamblea_id;
  IF NOT FOUND THEN
    RETURN NEW;   -- la FK responde
  END IF;
  -- [paso:acta_condominio]
  IF (v_empresa, v_proyecto) IS DISTINCT FROM (NEW.company_id, NEW.project_id) THEN
    RAISE EXCEPTION 'ACTA_ASAMBLEA: la asamblea es de otro condominio'
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:acta_condominio]
  -- [paso:acta_finalizada]
  IF v_estado <> 'finalizada' THEN
    RAISE EXCEPTION 'ACTA_ASAMBLEA_ABIERTA: el acta formal se levanta con la asamblea finalizada (está %)', v_estado
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:acta_finalizada]
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_acta_asamblea() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS actas_reunion_asamblea ON public.actas_reunion;
CREATE TRIGGER actas_reunion_asamblea
  BEFORE INSERT OR UPDATE OF asamblea_id, company_id, project_id ON public.actas_reunion
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_acta_asamblea();

-- ── 4 · Generar el acta desde la asamblea ───────────────────────────────────
-- SECURITY DEFINER para leer la asamblea entera (los votos los ve sólo quien
-- ve Votaciones): con SECURITY INVOKER, a quien no los ve le saldría un acta
-- sin los que votaron. A cambio, exige lo mismo que la pantalla y que la RLS:
-- ver la asamblea (asambleas_select) y crear actas (actas_reunion_insert).
CREATE OR REPLACE FUNCTION public.asamblea_generar_acta(p_asamblea_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_a        public.asambleas%ROWTYPE;
  v_id       uuid;
  v_esc      jsonb;
  v_asist    jsonb;
  v_orden    jsonb;
  v_acuerdos text;
  v_obs      text;
BEGIN
  -- [paso:acta_ve_asamblea]
  SELECT * INTO v_a FROM public.asambleas a
   WHERE a.id = p_asamblea_id
     AND (public.is_super_admin()
          OR (a.company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.asambleas')));
  -- [/paso:acta_ve_asamblea]
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  -- [paso:acta_permiso]
  IF NOT (public.is_super_admin() OR public.condominios_puede_actuar('actas', 'create')) THEN
    RAISE EXCEPTION 'No autorizado: levantar el acta pide crear actas' USING ERRCODE = '42501';
  END IF;
  -- [/paso:acta_permiso]
  IF v_a.estado <> 'finalizada' THEN
    RAISE EXCEPTION 'ACTA_ASAMBLEA_ABIERTA: el acta formal se levanta con la asamblea finalizada (está %)', v_a.estado
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.id INTO v_id FROM public.actas_reunion r WHERE r.asamblea_id = p_asamblea_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  v_esc := v_a.escrutinio;

  -- Presentes: el padrón que asistió o votó. Por poder firma el apoderado.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nombre', CASE WHEN s.modalidad = 'poder' THEN s.apoderado_nombre
                          ELSE coalesce(nullif(btrim(u.propietario_nombre), ''), pa.unidad_nombre) END,
           'unidad', pa.unidad_nombre,
           'rol',    CASE s.modalidad WHEN 'presencial' THEN 'Presencial' WHEN 'virtual' THEN 'Virtual'
                                      WHEN 'poder' THEN 'Apoderado' ELSE 'Votó' END
         ) ORDER BY pa.unidad_nombre), '[]'::jsonb)
    INTO v_asist
    FROM public.padron_asamblea pa
    LEFT JOIN public.asistencia_asamblea s ON s.asamblea_id = pa.asamblea_id AND s.unidad_id = pa.unidad_id
    LEFT JOIN public.unidades u ON u.id = pa.unidad_id
   WHERE pa.asamblea_id = p_asamblea_id
     -- [paso:acta_presentes]
     AND (s.id IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.votos_asamblea v JOIN public.puntos_asamblea p ON p.id = v.punto_id
                      WHERE p.asamblea_id = p_asamblea_id AND v.unidad_id = pa.unidad_id))
     -- [/paso:acta_presentes]
  ;

  -- Orden del día: cada punto con lo que decidió el escrutinio.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'punto',       p.titulo,
           'descripcion', coalesce(p.descripcion, ''),
           'acuerdo',     CASE WHEN x.e IS NULL THEN coalesce(p.resultado, '')
             ELSE CASE x.e ->> 'decision' WHEN 'aprobado' THEN 'Aprobado' WHEN 'rechazado' THEN 'Rechazado' ELSE 'Sin quórum' END
               || format(' — a favor %s, en contra %s, abstención %s',
                         x.e #>> '{a_favor,unidades}', x.e #>> '{en_contra,unidades}', x.e #>> '{abstencion,unidades}')
               || CASE WHEN v_esc ->> 'base' = 'alicuota'
                       THEN format(' (alícuotas %s %% / %s %% / %s %%)',
                                   x.e #>> '{a_favor,peso}', x.e #>> '{en_contra,peso}', x.e #>> '{abstencion,peso}')
                       ELSE '' END
               || ' · ' || CASE p.mayoria WHEN 'simple' THEN 'mayoría simple' WHEN 'absoluta' THEN 'mayoría absoluta'
                                          ELSE format('mayoría calificada del %s %%', p.mayoria_pct) END
             END
         ) ORDER BY p.orden, p.created_at), '[]'::jsonb)
    INTO v_orden
    FROM public.puntos_asamblea p
    LEFT JOIN LATERAL (SELECT e FROM jsonb_array_elements(v_esc -> 'puntos') e
                        WHERE (e ->> 'punto_id')::uuid = p.id) x ON true
   WHERE p.asamblea_id = p_asamblea_id;

  -- [paso:acta_acuerdos]
  SELECT string_agg('• ' || (e ->> 'titulo'), E'\n' ORDER BY i)
    INTO v_acuerdos
    FROM jsonb_array_elements(coalesce(v_esc -> 'puntos', '[]'::jsonb)) WITH ORDINALITY AS t(e, i)
   WHERE e ->> 'decision' = 'aprobado';
  -- [/paso:acta_acuerdos]

  v_obs := CASE WHEN v_esc IS NOT NULL THEN
    format('Quórum: %s %% de %s %% requerido (%s). Presentes: %s de %s unidades del padrón.',
           v_esc ->> 'quorum_pct', v_esc ->> 'quorum_requerido',
           CASE v_esc ->> 'base' WHEN 'alicuota' THEN 'por alícuota' ELSE 'por unidad' END,
           v_esc #>> '{presentes,unidades}', v_esc #>> '{padron,unidades}') END;
  IF nullif(btrim(v_a.acta), '') IS NOT NULL THEN
    v_obs := concat_ws(E'\n\n', v_obs, v_a.acta);
  END IF;

  INSERT INTO public.actas_reunion (company_id, project_id, asamblea_id, titulo, tipo, fecha, hora_inicio, hora_fin,
                                    lugar, quorum, quorum_requerido, asistentes, orden_del_dia, acuerdos, observaciones)
  VALUES (v_a.company_id, v_a.project_id, v_a.id, 'Acta — ' || v_a.titulo, v_a.tipo, v_a.fecha, v_a.hora_inicio, v_a.hora_fin,
          v_a.lugar, round((v_esc ->> 'quorum_pct')::numeric)::int, v_a.quorum_requerido, v_asist, v_orden, v_acuerdos, v_obs)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.asamblea_generar_acta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asamblea_generar_acta(uuid) TO authenticated;

COMMENT ON FUNCTION public.asamblea_generar_acta(uuid) IS
  'Panel: levanta el acta formal (actas_reunion) de una asamblea finalizada con su asistencia, orden del día, resultados y quórum; si ya existe, devuelve su id. Pide ver la asamblea y crear actas (42501).';

-- ── 5 · votaciones: consulta fuera de asamblea, con integridad ──────────────
DO $$
DECLARE
  v_fuera text;
BEGIN
  SELECT string_agg(x, '; ') INTO v_fuera FROM (
    SELECT 'estado ' || string_agg(DISTINCT quote_literal(estado), ', ') AS x
      FROM public.votaciones WHERE estado NOT IN ('abierta', 'cerrada', 'anulada')
    HAVING count(*) > 0
    UNION ALL
    SELECT format('%s votación(es) con opciones inválidas', count(*))
      FROM public.votaciones v
     WHERE jsonb_typeof(v.opciones) IS DISTINCT FROM 'array'
        OR jsonb_array_length(v.opciones) < 2
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v.opciones) o
                    WHERE jsonb_typeof(o) <> 'object' OR nullif(btrim(o ->> 'id'), '') IS NULL OR nullif(btrim(o ->> 'texto'), '') IS NULL)
        OR (SELECT count(DISTINCT o ->> 'id') FROM jsonb_array_elements(v.opciones) o) <> jsonb_array_length(v.opciones)
    HAVING count(*) > 0
    UNION ALL
    SELECT format('%s voto(s) con una opción que no existe o de otra unidad o empresa', count(*))
      FROM public.votos vt JOIN public.votaciones v ON v.id = vt.votacion_id
      LEFT JOIN public.unidades u ON u.id = vt.unidad_id
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v.opciones) o WHERE o ->> 'id' = vt.opcion_id)
        OR vt.company_id <> v.company_id OR u.project_id <> v.project_id OR u.company_id <> v.company_id
    HAVING count(*) > 0
    UNION ALL
    SELECT format('%s votación(es) con quórum negativo', count(*))
      FROM public.votaciones WHERE quorum_requerido < 0
    HAVING count(*) > 0
  ) s;
  IF v_fuera IS NOT NULL THEN
    RAISE EXCEPTION 'votaciones: datos fuera de regla (%): revisarlos antes de los CHECK', v_fuera;
  END IF;
END $$;

ALTER TABLE public.votaciones DROP COLUMN IF EXISTS asamblea_id;
ALTER TABLE public.votaciones DROP COLUMN IF EXISTS tipo;
ALTER TABLE public.votaciones ADD COLUMN IF NOT EXISTS conteo jsonb;

COMMENT ON TABLE public.votaciones IS
  'Consulta a los propietarios fuera de asamblea (en asamblea se votan los puntos). Una unidad, un voto; el resultado lo escribe la base al cerrar.';
COMMENT ON COLUMN public.votaciones.conteo IS
  'Votos por opción ({id: n}), escrito por la base al cerrar.';
COMMENT ON COLUMN public.votaciones.quorum_requerido IS
  'Mínimo de votos para que la consulta decida (NULL o 0: sin mínimo).';

CREATE OR REPLACE FUNCTION public.votaciones_opciones_validas(p_opciones jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_opciones) = 'array'
     AND jsonb_array_length(p_opciones) >= 2
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_opciones) o
                      WHERE jsonb_typeof(o) <> 'object'
                         OR nullif(btrim(o ->> 'id'), '') IS NULL
                         OR nullif(btrim(o ->> 'texto'), '') IS NULL)
     AND (SELECT count(DISTINCT o ->> 'id') FROM jsonb_array_elements(p_opciones) o) = jsonb_array_length(p_opciones)
$$;

ALTER TABLE public.votaciones DROP CONSTRAINT IF EXISTS votaciones_estado_check;
ALTER TABLE public.votaciones
  ADD CONSTRAINT votaciones_estado_check CHECK (estado IN ('abierta', 'cerrada', 'anulada'));
ALTER TABLE public.votaciones DROP CONSTRAINT IF EXISTS votaciones_opciones_check;
ALTER TABLE public.votaciones
  ADD CONSTRAINT votaciones_opciones_check CHECK (public.votaciones_opciones_validas(opciones));
ALTER TABLE public.votaciones DROP CONSTRAINT IF EXISTS votaciones_quorum_check;
ALTER TABLE public.votaciones
  ADD CONSTRAINT votaciones_quorum_check CHECK (quorum_requerido >= 0);

-- BEFORE INSERT/UPDATE de votaciones. SECURITY DEFINER: el conteo mira todos
-- los votos, no los que la RLS de quien cierra le deja ver.
CREATE OR REPLACE FUNCTION public.votaciones_tg_integridad()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_total   int;
  v_max     int;
  v_ganan   int;
  v_texto   text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- [paso:nace_abierta]
    IF NEW.estado <> 'abierta' OR NEW.resultado IS NOT NULL OR NEW.conteo IS NOT NULL THEN
      RAISE EXCEPTION 'VOTACION_ESCRUTINIO: una votación nace abierta y sin resultado; el resultado lo escribe la base al cerrar'
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:nace_abierta]
    RETURN NEW;
  END IF;

  -- [paso:votacion_cerrada]
  IF OLD.estado <> 'abierta' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'VOTACION_CERRADA: la votación está %; ya no cambia', OLD.estado
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- [/paso:votacion_cerrada]

  -- [paso:votacion_calculado]
  IF (NEW.resultado, NEW.conteo) IS DISTINCT FROM (OLD.resultado, OLD.conteo) THEN
    RAISE EXCEPTION 'VOTACION_ESCRUTINIO: el resultado y el conteo los escribe la base al cerrar'
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:votacion_calculado]

  -- [paso:opciones_fijas]
  IF NEW.opciones IS DISTINCT FROM OLD.opciones
     AND EXISTS (SELECT 1 FROM public.votos v WHERE v.votacion_id = OLD.id) THEN
    RAISE EXCEPTION 'VOTACION_CON_VOTOS: la votación ya tiene votos; sus opciones no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:opciones_fijas]

  IF NEW.estado = 'cerrada' THEN
    SELECT coalesce(jsonb_object_agg(o ->> 'id', (SELECT count(*) FROM public.votos v
                                                    WHERE v.votacion_id = NEW.id AND v.opcion_id = o ->> 'id')), '{}'::jsonb)
      INTO NEW.conteo
      FROM jsonb_array_elements(NEW.opciones) o;
    SELECT count(*) INTO v_total FROM public.votos v WHERE v.votacion_id = NEW.id;
    SELECT max(n::int) INTO v_max FROM jsonb_each_text(NEW.conteo) AS c(id, n);
    SELECT count(*) INTO v_ganan FROM jsonb_each_text(NEW.conteo) AS c(id, n) WHERE n::int = v_max;
    SELECT o ->> 'texto' INTO v_texto FROM jsonb_array_elements(NEW.opciones) o
     WHERE (NEW.conteo ->> (o ->> 'id'))::int = v_max LIMIT 1;
    NEW.resultado := CASE
      WHEN v_total = 0 THEN 'Sin votos'
      -- [paso:quorum_consulta]
      WHEN coalesce(NEW.quorum_requerido, 0) > 0 AND v_total < NEW.quorum_requerido THEN 'Sin quórum'
      -- [/paso:quorum_consulta]
      WHEN v_ganan > 1 THEN 'Empate'
      ELSE v_texto END;
    NEW.fecha_cierre := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.votaciones_tg_integridad() FROM PUBLIC, anon, authenticated;

-- BEFORE INSERT/UPDATE/DELETE de votos. SECURITY DEFINER: la votación y la
-- unidad se miran aunque quien vota no las vea.
CREATE OR REPLACE FUNCTION public.votaciones_tg_votos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado   text;
  v_v        public.votaciones%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- [paso:cascada_voto_consulta]
    -- La unidad ya no existe: su cascada. Si lo que ya no existe es la
    -- votación, v_estado queda NULL y pasa igual.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = OLD.unidad_id) THEN
      RETURN OLD;
    END IF;
    -- [/paso:cascada_voto_consulta]
    SELECT v.estado INTO v_estado FROM public.votaciones v WHERE v.id = OLD.votacion_id;
    -- [paso:voto_consulta_viejo]
    IF v_estado IN ('cerrada', 'anulada') THEN
      RAISE EXCEPTION 'VOTACION_CERRADA: la votación está %; sus votos ya no cambian', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:voto_consulta_viejo]
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT * INTO v_v FROM public.votaciones v WHERE v.id = NEW.votacion_id;
    IF NOT FOUND THEN
      RETURN NEW;   -- la FK responde
    END IF;
    -- [paso:voto_consulta_nuevo]
    IF v_v.estado <> 'abierta' THEN
      RAISE EXCEPTION 'VOTACION_CERRADA: la votación está %; sus votos ya no cambian', v_v.estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:voto_consulta_nuevo]
    -- [paso:voto_opcion]
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_v.opciones) o WHERE o ->> 'id' = NEW.opcion_id) THEN
      RAISE EXCEPTION 'VOTO_OPCION: «%» no es una opción de esta votación', NEW.opcion_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:voto_opcion]
    -- [paso:voto_condominio]
    IF NEW.company_id IS DISTINCT FROM v_v.company_id
       OR NOT EXISTS (SELECT 1 FROM public.unidades u
                       WHERE u.id = NEW.unidad_id AND u.project_id = v_v.project_id AND u.company_id = v_v.company_id) THEN
      RAISE EXCEPTION 'VOTO_CONDOMINIO: la unidad o la empresa del voto no son las de la votación'
        USING ERRCODE = '42501';
    END IF;
    -- [/paso:voto_condominio]
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.votaciones_tg_votos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS votaciones_integridad ON public.votaciones;
CREATE TRIGGER votaciones_integridad
  BEFORE INSERT OR UPDATE ON public.votaciones
  FOR EACH ROW EXECUTE FUNCTION public.votaciones_tg_integridad();
DROP TRIGGER IF EXISTS votos_integridad ON public.votos;
CREATE TRIGGER votos_integridad
  BEFORE INSERT OR UPDATE OR DELETE ON public.votos
  FOR EACH ROW EXECUTE FUNCTION public.votaciones_tg_votos();

COMMENT ON FUNCTION public.asambleas_tg_acta_asamblea() IS
  'BEFORE INSERT/UPDATE OF asamblea_id de actas_reunion: la asamblea es del mismo condominio (ACTA_ASAMBLEA) y está finalizada (ACTA_ASAMBLEA_ABIERTA).';
COMMENT ON FUNCTION public.votaciones_tg_integridad() IS
  'BEFORE INSERT/UPDATE de votaciones: nace abierta; cerrada o anulada no cambia (VOTACION_CERRADA); con votos las opciones no cambian (VOTACION_CON_VOTOS); al cerrar escribe conteo y resultado, que nadie más escribe (VOTACION_ESCRUTINIO).';
COMMENT ON FUNCTION public.votaciones_tg_votos() IS
  'BEFORE INSERT/UPDATE/DELETE de votos: votación abierta (VOTACION_CERRADA), opción que exista (VOTO_OPCION), unidad y empresa de la votación (VOTO_CONDOMINIO). Pasan las cascadas de la unidad y de la votación.';

-- ── 6 · Guarda de postcondición ─────────────────────────────────────────────
DO $$
DECLARE
  v_par text[];
  v_fn  text;
BEGIN
  IF to_regclass('public.asambleas_digital') IS NOT NULL THEN
    RAISE EXCEPTION 'asambleas: asambleas_digital sigue existiendo';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'votaciones'
                AND column_name IN ('asamblea_id', 'tipo')) THEN
    RAISE EXCEPTION 'votaciones: siguen las columnas asamblea_id o tipo';
  END IF;

  FOREACH v_par SLICE 1 IN ARRAY ARRAY[
    ['public.asambleas',  'asambleas_modalidad_check'],
    ['public.asambleas',  'asambleas_link_reunion_check'],
    ['public.votaciones', 'votaciones_estado_check'],
    ['public.votaciones', 'votaciones_opciones_check'],
    ['public.votaciones', 'votaciones_quorum_check']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = v_par[1]::regclass AND conname = v_par[2] AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION 'asambleas: falta el CHECK validado % en %', v_par[2], v_par[1];
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.actas_reunion'::regclass
                    AND conname = 'actas_reunion_asamblea_key' AND contype = 'u') THEN
    RAISE EXCEPTION 'asambleas: falta el UNIQUE de actas_reunion.asamblea_id';
  END IF;

  FOREACH v_par SLICE 1 IN ARRAY ARRAY[
    ['public.actas_reunion', 'actas_reunion_asamblea', 'public.asambleas_tg_acta_asamblea()'],
    ['public.votaciones',    'votaciones_integridad',  'public.votaciones_tg_integridad()'],
    ['public.votos',         'votos_integridad',       'public.votaciones_tg_votos()']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = v_par[1]::regclass AND tgname = v_par[2]
                      AND tgfoid = v_par[3]::regprocedure AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'asambleas: falta el trigger habilitado % en %', v_par[2], v_par[1];
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.asambleas_tg_acta_asamblea()', 'public.votaciones_tg_integridad()',
                              'public.votaciones_tg_votos()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'asambleas: % es ejecutable por anon o authenticated', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.asamblea_generar_acta(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.asamblea_generar_acta(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'asambleas: asamblea_generar_acta(uuid) debe ser ejecutable por authenticated y no por anon';
  END IF;
END $$;
