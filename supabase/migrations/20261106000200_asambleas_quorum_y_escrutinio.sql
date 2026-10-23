-- ════════════════════════════════════════════════════════════════════════════
-- Asambleas: quórum y resultados reales. Padrón al abrir, asistencia con
-- poderes, regla de mayoría por punto y escrutinio que calcula la base al
-- finalizar.
--
-- POR QUÉ
-- Hasta aquí la asamblea guardaba votos, pero no decidía nada:
--   · `quorum_alcanzado` no lo escribía nadie y `quorum_requerido` era un
--     número que nadie comparaba. No había asistencia: el quórum no se podía
--     saber.
--   · Cada voto valía 1 aunque el reglamento del condominio vote por alícuota.
--   · El panel contaba los votos de las unidades activas de HOY: dar de baja o
--     de alta una unidad cambiaba el resultado de una asamblea ya votada.
--   · `puntos_asamblea.resultado` quedaba vacío: «aprobado» o «rechazado» lo
--     interpretaba cada quien, sin regla de mayoría.
--
-- DECISIONES DEL DUEÑO
--   · Base de votación configurable por condominio (configuracion_condominio,
--     clave 'asambleas_base_votacion'): 'unidad' (por omisión, cada unidad vale
--     1) o 'alicuota' (alicuota_pct de la unidad; sin ella, su parte de los m²
--     de las unidades activas, igual que el generador de cuotas).
--   · Poderes: una unidad puede asistir por apoderado, con su nombre y el
--     documento del poder. Las dos cosas son obligatorias.
--   · Mayoría por punto: simple (a favor > en contra), absoluta (a favor > la
--     mitad de lo presente) o calificada (a favor ≥ X % del padrón completo,
--     50 < X ≤ 100). Por omisión, simple.
--
-- QUÉ HACE
--   1 · Base del condominio: CHECK del valor de 'asambleas_base_votacion'.
--   2 · Columnas. asambleas.base_votacion (la que rige la asamblea, fijada al
--       abrir), asambleas.escrutinio (el resultado completo, escrito al
--       finalizar), quorum_alcanzado pasa a numeric(5,2); CHECK de 0 a 100 en
--       los dos quórum. puntos_asamblea.mayoria / mayoria_pct.
--   3 · padron_asamblea: las unidades con derecho a voto y su peso, tomadas
--       al abrir la asamblea. Sólo la base la escribe: ninguna policy de
--       escritura y sin grant para anon ni authenticated.
--   4 · asistencia_asamblea: presencial, virtual o por poder, una por unidad.
--       Sólo con la asamblea en curso y sólo para unidades del padrón; con la
--       asamblea cerrada queda congelada (las mismas excepciones referenciales
--       que los votos en 20261106000100). La escribe quien edita asambleas.
--   5 · Las reglas, en triggers nuevos (ninguno de 20261106000100 se toca):
--         · asambleas_escrutinio (BEFORE INSERT/UPDATE): al abrir fija la base
--           del condominio; al finalizar escribe escrutinio, quorum_alcanzado
--           y el resultado de cada punto de votación ('Aprobado', 'Rechazado',
--           'Sin quórum'). Nadie más escribe esas tres columnas, y
--           quorum_requerido no cambia después de convocar.
--         · asambleas_padron (AFTER INSERT/UPDATE OF estado): toma el padrón.
--         · votos_asamblea_padron: con el padrón tomado, sólo vota una unidad
--           del padrón.
--         · puntos_asamblea_mayoria_fija: con votos, el tipo y la regla de
--           mayoría del punto ya no cambian.
--   6 · Las asambleas que ya están en curso toman base y padrón ahora.
--   7 · asamblea_escrutinio(id): el escrutinio para el panel — en curso, el
--       conteo de ahora; finalizada, el que quedó escrito.
--   8 · Guarda de postcondición.
--
-- PRESENTE = registró asistencia o votó algún punto (el voto del portal cuenta
-- como asistencia virtual). Sólo cuentan las unidades del padrón, con su peso.
-- Hay quórum cuando presentes ≥ quorum_requerido % del padrón. Sin quórum, los
-- puntos de votación quedan 'Sin quórum' sea cual sea el conteo.
--
-- IMPACTO
-- El panel pasa a mostrar padrón, asistencia, quórum y resultado. El portal
-- (portal_asambleas_unidad) ya devuelve quorum_alcanzado y resultado: los ve
-- calculados sin tocar su función. Las asambleas finalizadas antes de esta
-- migración no tienen padrón ni escrutinio y quedan como estaban.
--
-- REVERSIÓN
-- DROP TRIGGER asambleas_escrutinio, asambleas_padron (asambleas),
-- puntos_asamblea_mayoria_fija, votos_asamblea_padron,
-- asistencia_asamblea_integridad; DROP FUNCTION asamblea_escrutinio(uuid) y
-- las asambleas_* de esta migración; DROP TABLE asistencia_asamblea,
-- padron_asamblea; DROP COLUMN asambleas.base_votacion, asambleas.escrutinio,
-- puntos_asamblea.mayoria, puntos_asamblea.mayoria_pct; los CHECK nuevos.
-- quorum_alcanzado puede quedar numeric.
--
-- IDEMPOTENTE: IF NOT EXISTS en tablas y columnas; DROP … IF EXISTS antes de
-- cada CHECK, policy y trigger; CREATE OR REPLACE; el paso 6 sólo toca las
-- asambleas en curso que todavía no tienen base.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Base de votación del condominio ─────────────────────────────────────
DO $$
DECLARE
  v_fuera text;
BEGIN
  SELECT string_agg(DISTINCT quote_literal(valor), ', ') INTO v_fuera
    FROM public.configuracion_condominio
   WHERE clave = 'asambleas_base_votacion' AND valor NOT IN ('unidad', 'alicuota');
  IF v_fuera IS NOT NULL THEN
    RAISE EXCEPTION 'asambleas: base de votación fuera del vocabulario (%): revisarla antes del CHECK', v_fuera;
  END IF;
END $$;

ALTER TABLE public.configuracion_condominio DROP CONSTRAINT IF EXISTS configuracion_condominio_base_votacion_check;
ALTER TABLE public.configuracion_condominio
  ADD CONSTRAINT configuracion_condominio_base_votacion_check
  CHECK (clave <> 'asambleas_base_votacion' OR valor IS NULL OR valor IN ('unidad', 'alicuota'));

-- ── 2 · Columnas ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_fuera text;
BEGIN
  SELECT string_agg(format('%s (requerido %s, alcanzado %s)', titulo, quorum_requerido, coalesce(quorum_alcanzado::text, '—')), '; ')
    INTO v_fuera
    FROM public.asambleas
   WHERE quorum_requerido NOT BETWEEN 0 AND 100 OR quorum_alcanzado NOT BETWEEN 0 AND 100;
  IF v_fuera IS NOT NULL THEN
    RAISE EXCEPTION 'asambleas: quórum fuera de 0–100 en %: revisarlo antes del CHECK', v_fuera;
  END IF;
END $$;

ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_quorum_requerido_check;
ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_quorum_alcanzado_check;
ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_base_votacion_check;
-- Con alícuota el quórum lleva decimales.
ALTER TABLE public.asambleas ALTER COLUMN quorum_alcanzado TYPE numeric(5,2);
ALTER TABLE public.asambleas ADD COLUMN IF NOT EXISTS base_votacion text;
ALTER TABLE public.asambleas ADD COLUMN IF NOT EXISTS escrutinio jsonb;
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_quorum_requerido_check CHECK (quorum_requerido BETWEEN 0 AND 100);
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_quorum_alcanzado_check CHECK (quorum_alcanzado BETWEEN 0 AND 100);
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_base_votacion_check CHECK (base_votacion IN ('unidad', 'alicuota'));

COMMENT ON COLUMN public.asambleas.base_votacion IS
  'Base de votación que rige la asamblea: la del condominio al abrirla (unidad | alicuota). NULL mientras está programada.';
COMMENT ON COLUMN public.asambleas.escrutinio IS
  'Escrutinio escrito al finalizar (asambleas_calcular_escrutinio): padrón, presentes, quórum y el conteo ponderado y la decisión de cada punto de votación.';

ALTER TABLE public.puntos_asamblea DROP CONSTRAINT IF EXISTS puntos_asamblea_mayoria_check;
ALTER TABLE public.puntos_asamblea DROP CONSTRAINT IF EXISTS puntos_asamblea_mayoria_pct_check;
ALTER TABLE public.puntos_asamblea ADD COLUMN IF NOT EXISTS mayoria text NOT NULL DEFAULT 'simple';
ALTER TABLE public.puntos_asamblea ADD COLUMN IF NOT EXISTS mayoria_pct numeric(5,2);
ALTER TABLE public.puntos_asamblea
  ADD CONSTRAINT puntos_asamblea_mayoria_check CHECK (mayoria IN ('simple', 'absoluta', 'calificada'));
-- coalesce: sin él, una calificada sin porcentaje daría NULL y el CHECK pasaría.
ALTER TABLE public.puntos_asamblea
  ADD CONSTRAINT puntos_asamblea_mayoria_pct_check CHECK (
    CASE WHEN mayoria = 'calificada' THEN coalesce(mayoria_pct > 50 AND mayoria_pct <= 100, false)
         ELSE mayoria_pct IS NULL END);

COMMENT ON COLUMN public.puntos_asamblea.mayoria IS
  'simple: a favor > en contra · absoluta: a favor > la mitad de lo presente · calificada: a favor ≥ mayoria_pct % del padrón.';

-- ── 3 · Padrón ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.padron_asamblea (
  asamblea_id   uuid    NOT NULL REFERENCES public.asambleas(id) ON DELETE CASCADE,
  unidad_id     uuid    NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  unidad_nombre text    NOT NULL,
  peso          numeric NOT NULL CONSTRAINT padron_asamblea_peso_check CHECK (peso >= 0),
  PRIMARY KEY (asamblea_id, unidad_id)
);
CREATE INDEX IF NOT EXISTS idx_padron_asamblea_unidad ON public.padron_asamblea(unidad_id);

COMMENT ON TABLE public.padron_asamblea IS
  'Unidades con derecho a voto de una asamblea y su peso (1, o su alícuota), tomadas al abrirla. Sólo la escribe la base (asambleas_tomar_padron).';

ALTER TABLE public.padron_asamblea ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.padron_asamblea FROM anon, authenticated;

-- Quien ve la agenda ve el padrón (la misma lectura que puntos_asamblea_select).
DROP POLICY IF EXISTS padron_asamblea_select ON public.padron_asamblea;
CREATE POLICY padron_asamblea_select ON public.padron_asamblea
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = padron_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND (user_has_permission('condominios.tab.asambleas'::text) OR (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))))));

-- ── 4 · Asistencia ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.asistencia_asamblea (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  asamblea_id      uuid        NOT NULL REFERENCES public.asambleas(id) ON DELETE CASCADE,
  unidad_id        uuid        NOT NULL REFERENCES public.unidades(id)  ON DELETE CASCADE,
  modalidad        text        NOT NULL CONSTRAINT asistencia_asamblea_modalidad_check
                                 CHECK (modalidad IN ('presencial', 'virtual', 'poder')),
  -- Por poder: quién representa a la unidad y el documento que lo acredita
  -- (path de condominios-media, bajo el proyecto).
  apoderado_nombre text,
  poder_documento  text,
  registrado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asistencia_asamblea_unidad_key UNIQUE (asamblea_id, unidad_id),
  CONSTRAINT asistencia_asamblea_poder_check CHECK (
    CASE WHEN modalidad = 'poder'
         THEN nullif(btrim(apoderado_nombre), '') IS NOT NULL AND nullif(btrim(poder_documento), '') IS NOT NULL
         ELSE apoderado_nombre IS NULL AND poder_documento IS NULL END)
);
CREATE INDEX IF NOT EXISTS idx_asistencia_asamblea_unidad ON public.asistencia_asamblea(unidad_id);

COMMENT ON TABLE public.asistencia_asamblea IS
  'Asistencia de cada unidad del padrón a una asamblea en curso: presencial, virtual o por poder (apoderado y documento obligatorios).';

ALTER TABLE public.asistencia_asamblea ENABLE ROW LEVEL SECURITY;

-- Llevar la lista es conducir la asamblea: las tres escrituras piden Editar
-- asambleas, el mismo permiso con el que la pantalla ofrece la lista.
DROP POLICY IF EXISTS asistencia_asamblea_select ON public.asistencia_asamblea;
CREATE POLICY asistencia_asamblea_select ON public.asistencia_asamblea
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = asistencia_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND (user_has_permission('condominios.tab.asambleas'::text) OR (current_user_role() = ANY (ARRAY['company_owner'::text, 'admin'::text]))))))));
DROP POLICY IF EXISTS asistencia_asamblea_insert ON public.asistencia_asamblea;
CREATE POLICY asistencia_asamblea_insert ON public.asistencia_asamblea
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = asistencia_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT public.condominios_puede_actuar('asambleas', 'edit') ))))));
DROP POLICY IF EXISTS asistencia_asamblea_update ON public.asistencia_asamblea;
CREATE POLICY asistencia_asamblea_update ON public.asistencia_asamblea
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = asistencia_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT public.condominios_puede_actuar('asambleas', 'edit') ))))))
  WITH CHECK ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = asistencia_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT public.condominios_puede_actuar('asambleas', 'edit') ))))));
DROP POLICY IF EXISTS asistencia_asamblea_delete ON public.asistencia_asamblea;
CREATE POLICY asistencia_asamblea_delete ON public.asistencia_asamblea
  AS PERMISSIVE FOR DELETE TO authenticated
  USING ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM asambleas a
  WHERE ((a.id = asistencia_asamblea.asamblea_id) AND (a.company_id = get_my_company_id()) AND ( SELECT public.condominios_puede_actuar('asambleas', 'edit') ))))));
-- El candado de plan de puntos y votos (20261104000650).
DROP POLICY IF EXISTS asistencia_asamblea_feature_gate ON public.asistencia_asamblea;
CREATE POLICY asistencia_asamblea_feature_gate ON public.asistencia_asamblea
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.company_has_feature((SELECT a.company_id FROM public.asambleas a WHERE a.id = asistencia_asamblea.asamblea_id), 'asambleas_digitales'));

-- ── 5 · Las reglas ──────────────────────────────────────────────────────────
-- Toma el padrón de una asamblea con su base_votacion ya fijada: las unidades
-- activas del condominio. Por alícuota, alicuota_pct; sin ella, su parte de
-- los m² de las unidades activas (como GeneradorCuotasTab); sin ninguna de las
-- dos, 0.
CREATE OR REPLACE FUNCTION public.asambleas_tomar_padron(p_asamblea_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_base     text;
  v_empresa  uuid;
  v_proyecto uuid;
BEGIN
  SELECT a.base_votacion, a.company_id, a.project_id INTO v_base, v_empresa, v_proyecto
    FROM public.asambleas a WHERE a.id = p_asamblea_id;
  INSERT INTO public.padron_asamblea (asamblea_id, unidad_id, unidad_nombre, peso)
  SELECT p_asamblea_id, u.id, u.nombre,
         -- [paso:peso]
         round(CASE WHEN v_base = 'alicuota'
                    THEN coalesce(u.alicuota_pct, coalesce(u.area_m2, 0) / nullif(t.m2, 0) * 100, 0)
                    ELSE 1 END, 4)
         -- [/paso:peso]
    FROM public.unidades u
   CROSS JOIN (SELECT sum(coalesce(x.area_m2, 0)) AS m2 FROM public.unidades x
                WHERE x.project_id = v_proyecto AND x.company_id = v_empresa AND x.activo) t
   WHERE u.project_id = v_proyecto AND u.company_id = v_empresa AND u.activo;
  -- [paso:padron_sin_peso]
  IF v_base = 'alicuota'
     AND (SELECT coalesce(sum(pa.peso), 0) FROM public.padron_asamblea pa WHERE pa.asamblea_id = p_asamblea_id) = 0
     AND EXISTS (SELECT 1 FROM public.padron_asamblea pa WHERE pa.asamblea_id = p_asamblea_id) THEN
    RAISE EXCEPTION 'ASAMBLEA_PADRON: ninguna unidad tiene alícuota ni m²; la asamblea no puede votar por alícuota'
      USING ERRCODE = 'check_violation',
            HINT = 'Cargue la alícuota o los m² de las unidades, o vote por unidad (Configuración del condominio).';
  END IF;
  -- [/paso:padron_sin_peso]
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tomar_padron(uuid) FROM PUBLIC, anon, authenticated;

-- El escrutinio de una asamblea con su padrón y sus votos de ahora. NULL si
-- la asamblea no existe.
CREATE OR REPLACE FUNCTION public.asambleas_calcular_escrutinio(p_asamblea_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH padron AS (
    SELECT pa.unidad_id, pa.peso FROM public.padron_asamblea pa WHERE pa.asamblea_id = p_asamblea_id
  ), votos AS (
    -- Sólo cuentan las unidades del padrón, con su peso.
    SELECT v.punto_id, v.unidad_id, v.voto, pd.peso
      FROM public.votos_asamblea v
      JOIN public.puntos_asamblea p ON p.id = v.punto_id AND p.asamblea_id = p_asamblea_id
      JOIN padron pd ON pd.unidad_id = v.unidad_id
  ), presentes AS (
    SELECT pd.unidad_id, pd.peso FROM padron pd
     WHERE EXISTS (SELECT 1 FROM public.asistencia_asamblea s
                    WHERE s.asamblea_id = p_asamblea_id AND s.unidad_id = pd.unidad_id)
        OR EXISTS (SELECT 1 FROM votos v WHERE v.unidad_id = pd.unidad_id)
  ), t AS (
    SELECT a.base_votacion, a.quorum_requerido,
           (SELECT count(*) FROM padron)                     AS n_padron,
           (SELECT coalesce(sum(peso), 0) FROM padron)       AS p_padron,
           (SELECT count(*) FROM presentes)                  AS n_presentes,
           (SELECT coalesce(sum(peso), 0) FROM presentes)    AS p_presentes
      FROM public.asambleas a WHERE a.id = p_asamblea_id
  ), q AS (
    SELECT t.*, (t.p_padron > 0 AND t.p_presentes * 100 >= t.quorum_requerido * t.p_padron) AS hay_quorum FROM t
  ), pts AS (
    SELECT p.id, p.orden, p.created_at, p.titulo, p.mayoria, p.mayoria_pct,
           count(v.unidad_id) FILTER (WHERE v.voto = 'a_favor')              AS n_favor,
           coalesce(sum(v.peso) FILTER (WHERE v.voto = 'a_favor'), 0)        AS p_favor,
           count(v.unidad_id) FILTER (WHERE v.voto = 'en_contra')            AS n_contra,
           coalesce(sum(v.peso) FILTER (WHERE v.voto = 'en_contra'), 0)      AS p_contra,
           count(v.unidad_id) FILTER (WHERE v.voto = 'abstencion')           AS n_abst,
           coalesce(sum(v.peso) FILTER (WHERE v.voto = 'abstencion'), 0)     AS p_abst
      FROM public.puntos_asamblea p
      LEFT JOIN votos v ON v.punto_id = p.id
     WHERE p.asamblea_id = p_asamblea_id AND p.tipo = 'votacion'
     GROUP BY p.id
  )
  SELECT jsonb_build_object(
    'base',             q.base_votacion,
    'padron',           jsonb_build_object('unidades', q.n_padron,    'peso', round(q.p_padron, 4)),
    'presentes',        jsonb_build_object('unidades', q.n_presentes, 'peso', round(q.p_presentes, 4)),
    'quorum_pct',       CASE WHEN q.p_padron > 0 THEN round(q.p_presentes * 100 / q.p_padron, 2) ELSE 0 END,
    'quorum_requerido', q.quorum_requerido,
    'hay_quorum',       q.hay_quorum,
    'puntos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'punto_id',    pts.id,
        'titulo',      pts.titulo,
        'mayoria',     pts.mayoria,
        'mayoria_pct', pts.mayoria_pct,
        'a_favor',     jsonb_build_object('unidades', pts.n_favor,  'peso', round(pts.p_favor, 4)),
        'en_contra',   jsonb_build_object('unidades', pts.n_contra, 'peso', round(pts.p_contra, 4)),
        'abstencion',  jsonb_build_object('unidades', pts.n_abst,   'peso', round(pts.p_abst, 4)),
        'decision', CASE
          WHEN NOT q.hay_quorum                                                          THEN 'sin_quorum'
          WHEN pts.mayoria = 'simple'     AND pts.p_favor > pts.p_contra                 THEN 'aprobado'
          WHEN pts.mayoria = 'absoluta'   AND pts.p_favor * 2 > q.p_presentes            THEN 'aprobado'
          WHEN pts.mayoria = 'calificada' AND pts.p_favor * 100 >= pts.mayoria_pct * q.p_padron THEN 'aprobado'
          ELSE 'rechazado' END
      ) ORDER BY pts.orden, pts.created_at)
      FROM pts), '[]'::jsonb)
  )
  FROM q
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_calcular_escrutinio(uuid) FROM PUBLIC, anon, authenticated;

-- BEFORE INSERT/UPDATE de asambleas. SECURITY DEFINER: la configuración del
-- condominio y los votos no dependen de la RLS de quien abre o cierra.
CREATE OR REPLACE FUNCTION public.asambleas_tg_escrutinio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_abre    boolean := false;
  v_cierra  boolean := false;
  v_base    text;
  v_esc     jsonb;
BEGIN
  -- [paso:calculado]
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_votacion IS NOT NULL OR NEW.escrutinio IS NOT NULL OR NEW.quorum_alcanzado IS NOT NULL THEN
      RAISE EXCEPTION 'ASAMBLEA_ESCRUTINIO: la base de votación, el quórum alcanzado y el escrutinio los calcula la base'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (NEW.base_votacion, NEW.escrutinio, NEW.quorum_alcanzado)
        IS DISTINCT FROM (OLD.base_votacion, OLD.escrutinio, OLD.quorum_alcanzado) THEN
    RAISE EXCEPTION 'ASAMBLEA_ESCRUTINIO: la base de votación, el quórum alcanzado y el escrutinio los calcula la base'
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:calculado]

  IF TG_OP = 'INSERT' THEN
    v_abre := NEW.estado = 'en_curso';
  ELSE
    -- [paso:quorum_fijo]
    IF OLD.estado <> 'programada' AND NEW.quorum_requerido IS DISTINCT FROM OLD.quorum_requerido THEN
      RAISE EXCEPTION 'ASAMBLEA_QUORUM: el quórum requerido se fija al convocar; la asamblea ya está %', OLD.estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:quorum_fijo]
    v_abre   := OLD.estado = 'programada' AND NEW.estado = 'en_curso';
    v_cierra := OLD.estado = 'en_curso'   AND NEW.estado = 'finalizada';
  END IF;

  IF v_abre THEN
    -- [paso:base_condominio]
    SELECT c.valor INTO v_base FROM public.configuracion_condominio c
     WHERE c.project_id = NEW.project_id AND c.clave = 'asambleas_base_votacion';
    -- [/paso:base_condominio]
    NEW.base_votacion := coalesce(v_base, 'unidad');
  END IF;

  IF v_cierra THEN
    v_esc := public.asambleas_calcular_escrutinio(NEW.id);
    NEW.escrutinio := v_esc;
    NEW.quorum_alcanzado := (v_esc ->> 'quorum_pct')::numeric;
    -- La asamblea sigue «en curso» en la tabla mientras corre este BEFORE: la
    -- agenda todavía acepta el resultado (asambleas_tg_puntos_congelados).
    -- [paso:resultado_puntos]
    UPDATE public.puntos_asamblea p
       SET resultado = CASE r.decision WHEN 'aprobado' THEN 'Aprobado' WHEN 'rechazado' THEN 'Rechazado' ELSE 'Sin quórum' END
      FROM jsonb_to_recordset(v_esc -> 'puntos') AS r(punto_id uuid, decision text)
     WHERE p.id = r.punto_id;
    -- [/paso:resultado_puntos]
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_escrutinio() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT/UPDATE OF estado de asambleas: al abrir, el padrón.
CREATE OR REPLACE FUNCTION public.asambleas_tg_padron()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.estado = 'en_curso' AND (TG_OP = 'INSERT' OR OLD.estado = 'programada') THEN
    PERFORM public.asambleas_tomar_padron(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_padron() FROM PUBLIC, anon, authenticated;

-- BEFORE INSERT/UPDATE OF punto_id, unidad_id de votos_asamblea. Antes de
-- abrir (sin padrón) se vota como hasta ahora; el escrutinio sólo cuenta
-- unidades del padrón.
CREATE OR REPLACE FUNCTION public.asambleas_tg_votos_padron()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_asamblea uuid;
  v_base     text;
BEGIN
  SELECT a.id, a.base_votacion INTO v_asamblea, v_base
    FROM public.puntos_asamblea p JOIN public.asambleas a ON a.id = p.asamblea_id
   WHERE p.id = NEW.punto_id;
  -- [paso:voto_padron]
  IF v_base IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.padron_asamblea pa
                                         WHERE pa.asamblea_id = v_asamblea AND pa.unidad_id = NEW.unidad_id) THEN
    RAISE EXCEPTION 'ASAMBLEA_PADRON: la unidad no está en el padrón de esta asamblea'
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:voto_padron]
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_votos_padron() FROM PUBLIC, anon, authenticated;

-- BEFORE UPDATE OF tipo, mayoria, mayoria_pct de puntos_asamblea.
CREATE OR REPLACE FUNCTION public.asambleas_tg_puntos_mayoria()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- [paso:mayoria_fija]
  IF (NEW.tipo, NEW.mayoria, NEW.mayoria_pct) IS DISTINCT FROM (OLD.tipo, OLD.mayoria, OLD.mayoria_pct)
     AND EXISTS (SELECT 1 FROM public.votos_asamblea v WHERE v.punto_id = OLD.id) THEN
    RAISE EXCEPTION 'PUNTO_CON_VOTOS: el punto ya tiene votos; su tipo y su regla de mayoría no cambian'
      USING ERRCODE = 'check_violation';
  END IF;
  -- [/paso:mayoria_fija]
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_puntos_mayoria() FROM PUBLIC, anon, authenticated;

-- BEFORE INSERT/UPDATE/DELETE de asistencia_asamblea: sólo con la asamblea en
-- curso, sólo unidades del padrón, el poder en el espacio del condominio, y
-- congelada al cerrar con las excepciones referenciales de los votos.
CREATE OR REPLACE FUNCTION public.asambleas_tg_asistencia()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado   text;
  v_proyecto uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- [paso:cascada_asistencia]
    -- La unidad ya no existe: su cascada. Si lo que ya no existe es la
    -- asamblea, v_estado queda NULL más abajo y pasa igual.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = OLD.unidad_id) THEN
      RETURN OLD;
    END IF;
    -- [/paso:cascada_asistencia]
    -- [paso:usuario_borrado_asistencia]
    IF TG_OP = 'UPDATE'
       AND NEW.registrado_por IS NULL AND OLD.registrado_por IS NOT NULL
       AND (NEW.id, NEW.asamblea_id, NEW.unidad_id, NEW.modalidad, NEW.apoderado_nombre, NEW.poder_documento, NEW.created_at)
           IS NOT DISTINCT FROM (OLD.id, OLD.asamblea_id, OLD.unidad_id, OLD.modalidad, OLD.apoderado_nombre, OLD.poder_documento, OLD.created_at)
       AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = OLD.registrado_por) THEN
      RETURN NEW;
    END IF;
    -- [/paso:usuario_borrado_asistencia]
    SELECT a.estado INTO v_estado FROM public.asambleas a WHERE a.id = OLD.asamblea_id;
    -- [paso:asistencia_vieja]
    IF v_estado IN ('finalizada', 'cancelada') THEN
      RAISE EXCEPTION 'ASAMBLEA_CERRADA: la asamblea está %; su asistencia ya no se cambia', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:asistencia_vieja]
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT a.estado, a.project_id INTO v_estado, v_proyecto FROM public.asambleas a WHERE a.id = NEW.asamblea_id;
    -- [paso:asistencia_nueva]
    -- (Sin asamblea, la FK responde.)
    IF v_estado IN ('finalizada', 'cancelada') THEN
      RAISE EXCEPTION 'ASAMBLEA_CERRADA: la asamblea está %; su asistencia ya no se cambia', v_estado
        USING ERRCODE = 'check_violation';
    ELSIF v_estado = 'programada' THEN
      RAISE EXCEPTION 'ASAMBLEA_NO_ABIERTA: la asistencia se toma con la asamblea en curso'
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:asistencia_nueva]
    -- [paso:asistencia_padron]
    IF v_estado IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.padron_asamblea pa
                                             WHERE pa.asamblea_id = NEW.asamblea_id AND pa.unidad_id = NEW.unidad_id) THEN
      RAISE EXCEPTION 'ASAMBLEA_PADRON: la unidad no está en el padrón de esta asamblea'
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:asistencia_padron]
    -- [paso:poder_del_condominio]
    -- FileUploader sube a «<proyecto>/…» y storage autoriza por ese prefijo.
    IF NEW.poder_documento IS NOT NULL AND split_part(NEW.poder_documento, '/', 1) IS DISTINCT FROM v_proyecto::text THEN
      RAISE EXCEPTION 'ASISTENCIA_PODER: el documento del poder no está en el espacio de este condominio'
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:poder_del_condominio]
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_asistencia() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.asambleas_tomar_padron(uuid) IS
  'Padrón de una asamblea al abrir: unidades activas del condominio con peso 1 (unidad) o su alícuota (alicuota_pct, o su parte de los m²). Aborta por alícuota si ninguna pesa (ASAMBLEA_PADRON).';
COMMENT ON FUNCTION public.asambleas_calcular_escrutinio(uuid) IS
  'Escrutinio de una asamblea: padrón, presentes (asistencia o voto), quórum, y por punto de votación el conteo ponderado y la decisión según su mayoría.';
COMMENT ON FUNCTION public.asambleas_tg_escrutinio() IS
  'BEFORE INSERT/UPDATE de asambleas: al abrir fija la base del condominio; al finalizar escribe escrutinio, quorum_alcanzado y el resultado de los puntos de votación. Esas columnas y, después de convocar, quorum_requerido no se escriben a mano (ASAMBLEA_ESCRUTINIO / ASAMBLEA_QUORUM, 23514).';
COMMENT ON FUNCTION public.asambleas_tg_padron() IS
  'AFTER INSERT/UPDATE OF estado de asambleas: al abrir la asamblea toma su padrón.';
COMMENT ON FUNCTION public.asambleas_tg_votos_padron() IS
  'BEFORE INSERT/UPDATE de votos_asamblea: con el padrón tomado sólo vota una unidad del padrón (ASAMBLEA_PADRON, 23514).';
COMMENT ON FUNCTION public.asambleas_tg_puntos_mayoria() IS
  'BEFORE UPDATE OF tipo, mayoria, mayoria_pct de puntos_asamblea: con votos, el tipo y la regla de mayoría no cambian (PUNTO_CON_VOTOS, 23514).';
COMMENT ON FUNCTION public.asambleas_tg_asistencia() IS
  'BEFORE INSERT/UPDATE/DELETE de asistencia_asamblea: sólo en curso y del padrón (ASAMBLEA_NO_ABIERTA / ASAMBLEA_PADRON), el poder en el espacio del condominio (ASISTENCIA_PODER) y congelada al cerrar (ASAMBLEA_CERRADA), salvo las cascadas.';

DROP TRIGGER IF EXISTS asambleas_escrutinio ON public.asambleas;
DROP TRIGGER IF EXISTS asambleas_padron ON public.asambleas;
DROP TRIGGER IF EXISTS votos_asamblea_padron ON public.votos_asamblea;
DROP TRIGGER IF EXISTS puntos_asamblea_mayoria_fija ON public.puntos_asamblea;
DROP TRIGGER IF EXISTS asistencia_asamblea_integridad ON public.asistencia_asamblea;

-- ── 6 · Las asambleas que ya están en curso ─────────────────────────────────
-- Toman base y padrón como si abrieran ahora. Va con los triggers quitados:
-- fijar la base es justo lo que asambleas_escrutinio no deja hacer a mano.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    UPDATE public.asambleas a
       SET base_votacion = coalesce((SELECT c.valor FROM public.configuracion_condominio c
                                      WHERE c.project_id = a.project_id AND c.clave = 'asambleas_base_votacion'), 'unidad')
     WHERE a.estado = 'en_curso' AND a.base_votacion IS NULL
    RETURNING a.id
  LOOP
    PERFORM public.asambleas_tomar_padron(r.id);
  END LOOP;
END $$;

CREATE TRIGGER asambleas_escrutinio
  BEFORE INSERT OR UPDATE ON public.asambleas
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_escrutinio();
CREATE TRIGGER asambleas_padron
  AFTER INSERT OR UPDATE OF estado ON public.asambleas
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_padron();
CREATE TRIGGER votos_asamblea_padron
  BEFORE INSERT OR UPDATE OF punto_id, unidad_id ON public.votos_asamblea
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_votos_padron();
CREATE TRIGGER puntos_asamblea_mayoria_fija
  BEFORE UPDATE OF tipo, mayoria, mayoria_pct ON public.puntos_asamblea
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_puntos_mayoria();
CREATE TRIGGER asistencia_asamblea_integridad
  BEFORE INSERT OR UPDATE OR DELETE ON public.asistencia_asamblea
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_asistencia();

-- ── 7 · El escrutinio para el panel ─────────────────────────────────────────
-- Quien ve la asamblea (la lectura de asambleas_select). En curso, el conteo
-- de ahora; finalizada, el que quedó escrito; programada o cancelada, NULL.
CREATE OR REPLACE FUNCTION public.asamblea_escrutinio(p_asamblea_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado text;
  v_esc    jsonb;
BEGIN
  SELECT a.estado, a.escrutinio INTO v_estado, v_esc
    FROM public.asambleas a
   WHERE a.id = p_asamblea_id
     AND (public.is_super_admin()
          OR (a.company_id = public.get_my_company_id() AND public.user_has_permission('condominios.tab.asambleas')));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_estado = 'en_curso' THEN
    RETURN public.asambleas_calcular_escrutinio(p_asamblea_id);
  END IF;
  RETURN v_esc;
END;
$$;
REVOKE ALL ON FUNCTION public.asamblea_escrutinio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asamblea_escrutinio(uuid) TO authenticated;

COMMENT ON FUNCTION public.asamblea_escrutinio(uuid) IS
  'Panel: escrutinio de una asamblea de la empresa — en curso, el de ahora; finalizada, el escrito al cerrar. 42501 si no la ve.';

-- ── 8 · Guarda de postcondición ─────────────────────────────────────────────
DO $$
DECLARE
  v_par text[];
  v_fn  text;
BEGIN
  FOREACH v_par SLICE 1 IN ARRAY ARRAY[
    ['public.configuracion_condominio', 'configuracion_condominio_base_votacion_check'],
    ['public.asambleas',                'asambleas_quorum_requerido_check'],
    ['public.asambleas',                'asambleas_quorum_alcanzado_check'],
    ['public.asambleas',                'asambleas_base_votacion_check'],
    ['public.puntos_asamblea',          'puntos_asamblea_mayoria_check'],
    ['public.puntos_asamblea',          'puntos_asamblea_mayoria_pct_check'],
    ['public.padron_asamblea',          'padron_asamblea_peso_check'],
    ['public.asistencia_asamblea',      'asistencia_asamblea_modalidad_check'],
    ['public.asistencia_asamblea',      'asistencia_asamblea_poder_check']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = v_par[1]::regclass AND conname = v_par[2]
                      AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION 'asambleas: falta el CHECK validado % en %', v_par[2], v_par[1];
    END IF;
  END LOOP;

  FOREACH v_par SLICE 1 IN ARRAY ARRAY[
    ['public.asambleas',           'asambleas_escrutinio',           'public.asambleas_tg_escrutinio()'],
    ['public.asambleas',           'asambleas_padron',               'public.asambleas_tg_padron()'],
    ['public.votos_asamblea',      'votos_asamblea_padron',          'public.asambleas_tg_votos_padron()'],
    ['public.puntos_asamblea',     'puntos_asamblea_mayoria_fija',   'public.asambleas_tg_puntos_mayoria()'],
    ['public.asistencia_asamblea', 'asistencia_asamblea_integridad', 'public.asambleas_tg_asistencia()']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = v_par[1]::regclass AND tgname = v_par[2]
                      AND tgfoid = v_par[3]::regprocedure AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'asambleas: falta el trigger habilitado % en %', v_par[2], v_par[1];
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.asambleas_tomar_padron(uuid)', 'public.asambleas_calcular_escrutinio(uuid)',
                              'public.asambleas_tg_escrutinio()', 'public.asambleas_tg_padron()',
                              'public.asambleas_tg_votos_padron()', 'public.asambleas_tg_puntos_mayoria()',
                              'public.asambleas_tg_asistencia()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'asambleas: % es ejecutable por anon o authenticated', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.asamblea_escrutinio(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.asamblea_escrutinio(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'asambleas: asamblea_escrutinio(uuid) debe ser ejecutable por authenticated y no por anon';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.padron_asamblea'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.asistencia_asamblea'::regclass) THEN
    RAISE EXCEPTION 'asambleas: padron_asamblea y asistencia_asamblea deben tener RLS';
  END IF;
  -- El padrón sólo lo escribe la base.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'padron_asamblea' AND cmd <> 'SELECT')
     OR has_table_privilege('authenticated', 'public.padron_asamblea', 'INSERT')
     OR has_table_privilege('authenticated', 'public.padron_asamblea', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.padron_asamblea', 'DELETE') THEN
    RAISE EXCEPTION 'asambleas: padron_asamblea quedó escribible fuera de la base';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'asistencia_asamblea'
                    AND policyname = 'asistencia_asamblea_feature_gate' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'asambleas: falta el candado de plan de asistencia_asamblea';
  END IF;
END $$;
