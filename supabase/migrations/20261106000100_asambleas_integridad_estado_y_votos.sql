-- ════════════════════════════════════════════════════════════════════════════
-- Asambleas: vocabulario cerrado, transiciones de estado, agenda y votos
-- congelados al cerrar, e historial de votos.
--
-- POR QUÉ
-- Nada en la base protegía lo que una asamblea decidió:
--   · `asambleas.tipo`, `asambleas.estado` y `puntos_asamblea.tipo` eran texto
--     libre: la pantalla manda un vocabulario fijo, pero la API aceptaba
--     cualquier cosa.
--   · El estado se podía mover en cualquier dirección: una asamblea
--     finalizada volvía a «en curso» o a «programada» con un UPDATE.
--   · Con la asamblea finalizada o cancelada, el staff con permiso podía
--     agregar, editar o borrar puntos y cambiar o borrar votos (las policies
--     de puntos_asamblea y votos_asamblea no miran el estado). El upsert del
--     panel pisaba el voto y `registrado_por` sin dejar rastro.
--
-- QUÉ HACE
--   1 · Vocabulario. Normaliza mayúsculas y espacios ('En curso' →
--       'en_curso') cuando el resultado es un valor conocido; si queda otro,
--       ABORTA nombrándolo. Después, CHECK en asambleas.tipo,
--       asambleas.estado y puntos_asamblea.tipo.
--   2 · Transiciones (BEFORE UPDATE OF estado): programada → en_curso |
--       cancelada; en_curso → finalizada | cancelada. Finalizada y cancelada
--       son terminales. Editar otras columnas (el acta, que se redacta al
--       finalizar) no cambia.
--   3 · Asamblea cerrada (finalizada o cancelada) = agenda y votos
--       congelados: ni INSERT, ni UPDATE, ni DELETE de sus puntos ni de sus
--       votos, tampoco con service_role. Se apartan sólo las acciones
--       referenciales, mirando si el dueño de la fila sigue existiendo (el
--       criterio de 20261031000700, no pg_trigger_depth()):
--         · un punto cae con su asamblea (borrar la asamblea sigue siendo
--           decisión de quien tiene «Eliminar»);
--         · un voto cae con su punto o con su unidad (purgar_empresa, baja
--           de unidad);
--         · `registrado_por` pasa a NULL cuando se borra el usuario
--           (ON DELETE SET NULL) y nada más del voto cambia.
--   4 · Historial de votos: cada INSERT, UPDATE y DELETE de votos_asamblea
--       queda en audit_log (antes/después, quién, cuándo), con la empresa y
--       el proyecto de la ASAMBLEA. Así lo lee el admin de la empresa (policy
--       audit_log_select). audit_trigger_func() no sirve: toma company_id de
--       la fila y votos_asamblea no lo tiene.
--   5 · Guarda de postcondición.
--
-- IMPACTO
-- La pantalla ya usa este vocabulario y este orden; el selector de estado y
-- «+ Punto» se ajustan en el mismo cambio. El portal (portal_votar_punto)
-- sólo vota con la asamblea en curso, así que no lo afecta. Con un valor
-- fuera del vocabulario en producción, la migración aborta sin tocar nada.
-- Corregir una asamblea cerrada pasa a ser una operación consciente de
-- mantenimiento (SET session_replication_role = replica), no un UPDATE más.
--
-- REVERSIÓN
-- DROP TRIGGER asambleas_transicion_estado ON public.asambleas;
-- DROP TRIGGER puntos_asamblea_congelados ON public.puntos_asamblea;
-- DROP TRIGGER votos_asamblea_congelados ON public.votos_asamblea;
-- DROP TRIGGER votos_asamblea_historial ON public.votos_asamblea;
-- las cuatro funciones asambleas_tg_*, y los tres CHECK *_tipo_check /
-- asambleas_estado_check. El historial ya escrito en audit_log queda.
--
-- IDEMPOTENTE: normalizar y validar no cambian nada en la segunda pasada;
-- DROP … IF EXISTS antes de cada CHECK y trigger; CREATE OR REPLACE.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1 · Vocabulario ─────────────────────────────────────────────────────────
-- Antes de los triggers: normalizar el estado es un UPDATE de estado.
UPDATE public.asambleas
   SET tipo = lower(regexp_replace(btrim(tipo), '\s+', '_', 'g'))
 WHERE tipo IS DISTINCT FROM lower(regexp_replace(btrim(tipo), '\s+', '_', 'g'))
   AND lower(regexp_replace(btrim(tipo), '\s+', '_', 'g')) IN ('ordinaria', 'extraordinaria');

UPDATE public.asambleas
   SET estado = lower(regexp_replace(btrim(estado), '\s+', '_', 'g'))
 WHERE estado IS DISTINCT FROM lower(regexp_replace(btrim(estado), '\s+', '_', 'g'))
   AND lower(regexp_replace(btrim(estado), '\s+', '_', 'g')) IN ('programada', 'en_curso', 'finalizada', 'cancelada');

UPDATE public.puntos_asamblea
   SET tipo = lower(regexp_replace(btrim(tipo), '\s+', '_', 'g'))
 WHERE tipo IS DISTINCT FROM lower(regexp_replace(btrim(tipo), '\s+', '_', 'g'))
   AND lower(regexp_replace(btrim(tipo), '\s+', '_', 'g')) IN ('informativo', 'votacion', 'debate');

DO $$
DECLARE
  v_fuera text;
BEGIN
  SELECT string_agg(x, '; ') INTO v_fuera FROM (
    SELECT 'asambleas.tipo ' || string_agg(DISTINCT quote_literal(tipo), ', ') AS x
      FROM public.asambleas WHERE tipo NOT IN ('ordinaria', 'extraordinaria')
    HAVING count(*) > 0
    UNION ALL
    SELECT 'asambleas.estado ' || string_agg(DISTINCT quote_literal(estado), ', ')
      FROM public.asambleas WHERE estado NOT IN ('programada', 'en_curso', 'finalizada', 'cancelada')
    HAVING count(*) > 0
    UNION ALL
    SELECT 'puntos_asamblea.tipo ' || string_agg(DISTINCT quote_literal(tipo), ', ')
      FROM public.puntos_asamblea WHERE tipo NOT IN ('informativo', 'votacion', 'debate')
    HAVING count(*) > 0
  ) s;
  IF v_fuera IS NOT NULL THEN
    RAISE EXCEPTION 'asambleas: valores fuera del vocabulario (%): revisarlos antes del CHECK', v_fuera;
  END IF;
END $$;

ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_tipo_check;
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_tipo_check CHECK (tipo IN ('ordinaria', 'extraordinaria'));

ALTER TABLE public.asambleas DROP CONSTRAINT IF EXISTS asambleas_estado_check;
ALTER TABLE public.asambleas
  ADD CONSTRAINT asambleas_estado_check CHECK (estado IN ('programada', 'en_curso', 'finalizada', 'cancelada'));

ALTER TABLE public.puntos_asamblea DROP CONSTRAINT IF EXISTS puntos_asamblea_tipo_check;
ALTER TABLE public.puntos_asamblea
  ADD CONSTRAINT puntos_asamblea_tipo_check CHECK (tipo IN ('informativo', 'votacion', 'debate'));

-- ── 2 · Transiciones de estado ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.asambleas_tg_transicion_estado()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- [paso:transiciones]
  IF (OLD.estado, NEW.estado) IN (('programada', 'en_curso'), ('programada', 'cancelada'),
                                  ('en_curso', 'finalizada'), ('en_curso', 'cancelada')) THEN
    RETURN NEW;
  END IF;
  -- [/paso:transiciones]
  RAISE EXCEPTION 'ASAMBLEA_TRANSICION: una asamblea % no puede pasar a %', OLD.estado, NEW.estado
    USING ERRCODE = 'check_violation',
          HINT = 'programada → en_curso → finalizada; se cancela antes de finalizar. Finalizada y cancelada son definitivas.';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_transicion_estado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS asambleas_transicion_estado ON public.asambleas;
CREATE TRIGGER asambleas_transicion_estado
  BEFORE UPDATE OF estado ON public.asambleas
  FOR EACH ROW WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION public.asambleas_tg_transicion_estado();

-- ── 3 · Asamblea cerrada: agenda y votos congelados ─────────────────────────
-- SECURITY DEFINER: si la asamblea existe y su estado no dependen de la RLS
-- de quien escribe.
CREATE OR REPLACE FUNCTION public.asambleas_tg_puntos_congelados()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- Si la asamblea ya no existe (la cascada de su borrado), v_estado queda
    -- NULL y el punto se va con ella.
    SELECT a.estado INTO v_estado FROM public.asambleas a WHERE a.id = OLD.asamblea_id;
    -- [paso:punto_viejo]
    IF v_estado IN ('finalizada', 'cancelada') THEN
      RAISE EXCEPTION 'ASAMBLEA_CERRADA: la asamblea está %; su agenda ya no se modifica', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:punto_viejo]
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT a.estado INTO v_estado FROM public.asambleas a WHERE a.id = NEW.asamblea_id;
    -- [paso:punto_nuevo]
    IF v_estado IN ('finalizada', 'cancelada') THEN
      RAISE EXCEPTION 'ASAMBLEA_CERRADA: la asamblea está %; su agenda ya no se modifica', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:punto_nuevo]
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_puntos_congelados() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS puntos_asamblea_congelados ON public.puntos_asamblea;
CREATE TRIGGER puntos_asamblea_congelados
  BEFORE INSERT OR UPDATE OR DELETE ON public.puntos_asamblea
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_puntos_congelados();

CREATE OR REPLACE FUNCTION public.asambleas_tg_votos_congelados()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_estado text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- [paso:cascada_voto]
    -- La unidad ya no existe: es su cascada (baja de la unidad, purgar_empresa)
    -- y el voto se va con ella. Si lo que ya no existe es el punto (cascada del
    -- punto o de su asamblea), v_estado queda NULL más abajo y pasa igual.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.unidades u WHERE u.id = OLD.unidad_id) THEN
      RETURN OLD;
    END IF;
    -- [/paso:cascada_voto]
    -- [paso:usuario_borrado]
    -- ON DELETE SET NULL de registrado_por: el usuario ya no existe y el voto
    -- no cambia.
    IF TG_OP = 'UPDATE'
       AND NEW.registrado_por IS NULL AND OLD.registrado_por IS NOT NULL
       AND (NEW.id, NEW.punto_id, NEW.unidad_id, NEW.voto, NEW.created_at)
           IS NOT DISTINCT FROM (OLD.id, OLD.punto_id, OLD.unidad_id, OLD.voto, OLD.created_at)
       AND NOT EXISTS (SELECT 1 FROM auth.users au WHERE au.id = OLD.registrado_por) THEN
      RETURN NEW;
    END IF;
    -- [/paso:usuario_borrado]
    SELECT a.estado INTO v_estado
      FROM public.puntos_asamblea p JOIN public.asambleas a ON a.id = p.asamblea_id
     WHERE p.id = OLD.punto_id;
    -- [paso:voto_viejo]
    IF v_estado IN ('finalizada', 'cancelada') THEN
      RAISE EXCEPTION 'ASAMBLEA_CERRADA: la asamblea está %; sus votos ya no se cambian', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:voto_viejo]
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT a.estado INTO v_estado
      FROM public.puntos_asamblea p JOIN public.asambleas a ON a.id = p.asamblea_id
     WHERE p.id = NEW.punto_id;
    -- [paso:voto_nuevo]
    IF v_estado IN ('finalizada', 'cancelada') THEN
      RAISE EXCEPTION 'ASAMBLEA_CERRADA: la asamblea está %; sus votos ya no se cambian', v_estado
        USING ERRCODE = 'check_violation';
    END IF;
    -- [/paso:voto_nuevo]
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_votos_congelados() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS votos_asamblea_congelados ON public.votos_asamblea;
CREATE TRIGGER votos_asamblea_congelados
  BEFORE INSERT OR UPDATE OR DELETE ON public.votos_asamblea
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_votos_congelados();

-- ── 4 · Historial de votos ──────────────────────────────────────────────────
-- La empresa y el proyecto salen de la asamblea; si ya no existe (cascada de
-- su borrado o de la purga), de la unidad; si tampoco, quedan NULL y la fila
-- sólo la ve super_admin, como en audit_trigger_func().
CREATE OR REPLACE FUNCTION public.asambleas_tg_votos_historial()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_punto   uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.punto_id  ELSE NEW.punto_id  END;
  v_unidad  uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.unidad_id ELSE NEW.unidad_id END;
  v_empresa uuid;
  v_proyecto uuid;
BEGIN
  -- [paso:empresa_historial]
  SELECT a.company_id, a.project_id INTO v_empresa, v_proyecto
    FROM public.puntos_asamblea p JOIN public.asambleas a ON a.id = p.asamblea_id
   WHERE p.id = v_punto;
  IF NOT FOUND THEN
    SELECT u.company_id, u.project_id INTO v_empresa, v_proyecto
      FROM public.unidades u WHERE u.id = v_unidad;
  END IF;
  -- [/paso:empresa_historial]
  INSERT INTO public.audit_log (table_name, record_id, action, actor_id, before, after, company_id, project_id)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    TG_OP,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    v_empresa,
    v_proyecto
  );
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.asambleas_tg_votos_historial() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS votos_asamblea_historial ON public.votos_asamblea;
CREATE TRIGGER votos_asamblea_historial
  AFTER INSERT OR UPDATE OR DELETE ON public.votos_asamblea
  FOR EACH ROW EXECUTE FUNCTION public.asambleas_tg_votos_historial();

COMMENT ON FUNCTION public.asambleas_tg_transicion_estado() IS
  'BEFORE UPDATE OF estado de asambleas: programada → en_curso | cancelada; en_curso → finalizada | cancelada. Finalizada y cancelada son definitivas (ASAMBLEA_TRANSICION, 23514).';
COMMENT ON FUNCTION public.asambleas_tg_puntos_congelados() IS
  'BEFORE INSERT/UPDATE/DELETE de puntos_asamblea: con la asamblea finalizada o cancelada la agenda no se modifica (ASAMBLEA_CERRADA, 23514). Se aparta en la cascada del borrado de la asamblea.';
COMMENT ON FUNCTION public.asambleas_tg_votos_congelados() IS
  'BEFORE INSERT/UPDATE/DELETE de votos_asamblea: con la asamblea finalizada o cancelada los votos no se cambian (ASAMBLEA_CERRADA, 23514). Se aparta en la cascada de la unidad, del punto o de la asamblea, y en el SET NULL de registrado_por al borrar el usuario.';
COMMENT ON FUNCTION public.asambleas_tg_votos_historial() IS
  'AFTER INSERT/UPDATE/DELETE de votos_asamblea: deja el cambio en audit_log con la empresa y el proyecto de la asamblea (o de la unidad, si la asamblea ya no existe).';

-- ── 5 · Guarda de postcondición ─────────────────────────────────────────────
DO $$
DECLARE
  v_par  text[];
  v_fn   text;
BEGIN
  FOREACH v_par SLICE 1 IN ARRAY ARRAY[
    ['public.asambleas',       'asambleas_tipo_check'],
    ['public.asambleas',       'asambleas_estado_check'],
    ['public.puntos_asamblea', 'puntos_asamblea_tipo_check']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = v_par[1]::regclass AND conname = v_par[2]
                      AND contype = 'c' AND convalidated) THEN
      RAISE EXCEPTION 'asambleas: falta el CHECK validado % en %', v_par[2], v_par[1];
    END IF;
  END LOOP;

  FOREACH v_par SLICE 1 IN ARRAY ARRAY[
    ['public.asambleas',       'asambleas_transicion_estado', 'public.asambleas_tg_transicion_estado()'],
    ['public.puntos_asamblea', 'puntos_asamblea_congelados',  'public.asambleas_tg_puntos_congelados()'],
    ['public.votos_asamblea',  'votos_asamblea_congelados',   'public.asambleas_tg_votos_congelados()'],
    ['public.votos_asamblea',  'votos_asamblea_historial',    'public.asambleas_tg_votos_historial()']
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = v_par[1]::regclass AND tgname = v_par[2]
                      AND tgfoid = v_par[3]::regprocedure AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'asambleas: falta el trigger habilitado % en %', v_par[2], v_par[1];
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.asambleas_tg_transicion_estado()', 'public.asambleas_tg_puntos_congelados()',
                              'public.asambleas_tg_votos_congelados()', 'public.asambleas_tg_votos_historial()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'asambleas: % es ejecutable por anon o authenticated', v_fn;
    END IF;
  END LOOP;
END $$;
