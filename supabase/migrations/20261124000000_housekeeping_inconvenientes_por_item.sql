-- ============================================================================
-- 20261124000000_housekeeping_inconvenientes_por_item.sql
-- Housekeeping: los inconvenientes se reportan UNO POR UNO, cada uno con su
-- descripción y sus propias fotos.
--
-- ANTES
--   `servicios_housekeeping.inconvenientes` era un solo texto y las fotos de la
--   fase «inconvenientes» una bolsa sin dueño: tres daños distintos se describían
--   en un párrafo y ninguna foto decía a cuál pertenecía.
--
-- AHORA
--   · `servicio_housekeeping_inconvenientes`: una fila por inconveniente (orden,
--     descripción), con el MISMO acceso que las fotos (hk_acceso: empresa +
--     proyecto + permiso del módulo). company/project los sella la base desde el
--     servicio; `orden` lo asigna si el cliente no lo manda; `creado_por` lo
--     sella sellar_actor. Tope: 30 por servicio.
--   · `servicio_housekeeping_fotos.inconveniente_id`: la foto de la fase
--     «inconvenientes» pertenece a UNO de ellos, del MISMO servicio (lo verifica
--     hk_fotos_preparar) y sólo en esa fase (CHECK). El tope de 20 por fase se
--     mantiene y se comparte entre los inconvenientes del servicio.
--   · `servicios_housekeeping.inconvenientes` pasa a ser DERIVADO: cada alta,
--     edición o baja de un ítem lo reescribe (un solo inconveniente → su texto
--     tal cual; varios → lista numerada; ninguno → NULL). Así el correo del
--     informe (hk_notificar_informe), el resumen de WhatsApp y cualquier otro
--     lector del texto siguen funcionando sin tocarlos.
--   · `hk_eliminar_inconveniente(uuid)`: borra el ítem y sus fotos —que entran a
--     la cola de limpieza de Storage por el trigger de siempre— con la misma
--     autorización que hk_eliminar_foto (dueño/admin, o quien lo creó mientras
--     el servicio no esté completado). Devuelve cuántos archivos encoló.
--   · Datos existentes: cada servicio con texto o con fotos en la fase recibe su
--     «Inconveniente 1» con ese texto y esas fotos (creado_por = quien inició el
--     servicio). El texto derivado coincide con el que ya tenía. Idempotente.
-- ============================================================================

-- ── 1) Tabla ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.servicio_housekeeping_inconvenientes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  servicio_id  uuid        NOT NULL REFERENCES public.servicios_housekeeping(id) ON DELETE CASCADE,
  orden        smallint    NOT NULL CHECK (orden >= 1),
  descripcion  text        NOT NULL DEFAULT '' CHECK (length(descripcion) <= 4000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  creado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (servicio_id, orden)
);

COMMENT ON TABLE public.servicio_housekeeping_inconvenientes IS
  'Inconvenientes reportados en un servicio de housekeeping, uno por fila (orden, descripción); sus fotos viven en servicio_housekeeping_fotos.inconveniente_id. Máx. 30 por servicio. Nunca se purga.';

CREATE INDEX IF NOT EXISTS idx_hk_inconvenientes_servicio
  ON public.servicio_housekeeping_inconvenientes(servicio_id, orden);

-- company/project salen del servicio (no del cliente); `orden` se asigna si no
-- viene; el servicio no se cambia después. SECURITY INVOKER: el SELECT del
-- servicio pasa por su RLS, así que crear un inconveniente en un servicio ajeno
-- falla como «no existe».
CREATE OR REPLACE FUNCTION public.hk_inconvenientes_preparar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  v_n       int;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.servicio_id IS DISTINCT FROM OLD.servicio_id THEN
      RAISE EXCEPTION 'Un inconveniente no se mueve de servicio' USING ERRCODE = 'check_violation';
    END IF;
    NEW.company_id := OLD.company_id;
    NEW.project_id := OLD.project_id;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  SELECT s.company_id, s.project_id INTO v_company, v_project
    FROM public.servicios_housekeeping s WHERE s.id = NEW.servicio_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio de housekeeping inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.company_id := v_company;
  NEW.project_id := v_project;

  -- Serializa las altas del mismo servicio: el siguiente `orden` y el tope se
  -- calculan sobre lo que ya hay, sin que dos altas simultáneas se pisen.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.servicio_id::text || ':inconvenientes:items'));
  IF NEW.orden IS NULL THEN
    SELECT COALESCE(max(orden), 0) + 1 INTO NEW.orden
      FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = NEW.servicio_id;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.servicio_housekeeping_inconvenientes WHERE servicio_id = NEW.servicio_id;
  IF v_n >= 30 THEN
    RAISE EXCEPTION 'Máximo 30 inconvenientes por servicio' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_inconvenientes_preparar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_inconvenientes_preparar ON public.servicio_housekeeping_inconvenientes;
CREATE TRIGGER trg_hk_inconvenientes_preparar
  BEFORE INSERT OR UPDATE ON public.servicio_housekeeping_inconvenientes
  FOR EACH ROW EXECUTE FUNCTION public.hk_inconvenientes_preparar();

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.servicio_housekeeping_inconvenientes;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.servicio_housekeeping_inconvenientes
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- ── 2) El texto del servicio, derivado de los ítems ─────────────────────────
-- Un solo inconveniente → su descripción tal cual (sin numerar); varios → lista
-- «1. …», «2. …» por posición (no por `orden`: tras borrar el 2 el 3 pasa a ser
-- 2); una descripción vacía se nombra «(sin descripción)»; ninguno → NULL.
-- SECURITY DEFINER para que el trigger lea TODOS los ítems del servicio; por lo
-- mismo no se expone a los clientes (la app replica la regla).
CREATE OR REPLACE FUNCTION public.hk_inconvenientes_texto(p_servicio_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH it AS (
    SELECT row_number() OVER (ORDER BY orden) AS n,
           NULLIF(btrim(descripcion), '')    AS d
      FROM public.servicio_housekeeping_inconvenientes
     WHERE servicio_id = p_servicio_id
  )
  SELECT CASE
           WHEN count(*) = 0 THEN NULL
           WHEN count(*) = 1 THEN min(d)
           ELSE string_agg(n || '. ' || COALESCE(d, '(sin descripción)'), E'\n' ORDER BY n)
         END
    FROM it
$$;

REVOKE EXECUTE ON FUNCTION public.hk_inconvenientes_texto(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hk_inconvenientes_sincronizar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sv  uuid;
  v_txt text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_sv := OLD.servicio_id; ELSE v_sv := NEW.servicio_id; END IF;
  v_txt := public.hk_inconvenientes_texto(v_sv);
  -- Si el servicio está siendo borrado (cascada) ya no hay fila: no pasa nada.
  UPDATE public.servicios_housekeeping SET inconvenientes = v_txt
   WHERE id = v_sv AND inconvenientes IS DISTINCT FROM v_txt;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_inconvenientes_sincronizar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_inconvenientes_sincronizar ON public.servicio_housekeeping_inconvenientes;
CREATE TRIGGER trg_hk_inconvenientes_sincronizar
  AFTER INSERT OR UPDATE OF descripcion, orden OR DELETE ON public.servicio_housekeeping_inconvenientes
  FOR EACH ROW EXECUTE FUNCTION public.hk_inconvenientes_sincronizar();

COMMENT ON COLUMN public.servicios_housekeeping.inconvenientes IS
  'DERIVADO (20261124000000): lo reescribe trg_hk_inconvenientes_sincronizar a partir de servicio_housekeeping_inconvenientes (uno → su texto; varios → lista numerada; ninguno → NULL). Lo leen el correo del informe y el resumen de WhatsApp. Nunca se purga.';

-- ── 3) RLS y privilegios: leer, crear y editar; borrar sólo por RPC ──────────
ALTER TABLE public.servicio_housekeeping_inconvenientes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.servicio_housekeeping_inconvenientes FROM anon;
REVOKE ALL ON TABLE public.servicio_housekeeping_inconvenientes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.servicio_housekeeping_inconvenientes TO authenticated;

DROP POLICY IF EXISTS "hk_inconvenientes_select" ON public.servicio_housekeeping_inconvenientes;
DROP POLICY IF EXISTS "hk_inconvenientes_insert" ON public.servicio_housekeeping_inconvenientes;
DROP POLICY IF EXISTS "hk_inconvenientes_update" ON public.servicio_housekeeping_inconvenientes;

CREATE POLICY "hk_inconvenientes_select" ON public.servicio_housekeeping_inconvenientes
  FOR SELECT TO authenticated
  USING (public.hk_acceso(company_id, project_id));

-- company_id/project_id los impone el trigger; esta es la segunda llave.
CREATE POLICY "hk_inconvenientes_insert" ON public.servicio_housekeeping_inconvenientes
  FOR INSERT TO authenticated
  WITH CHECK (public.hk_acceso(company_id, project_id));

CREATE POLICY "hk_inconvenientes_update" ON public.servicio_housekeeping_inconvenientes
  FOR UPDATE TO authenticated
  USING (public.hk_acceso(company_id, project_id))
  WITH CHECK (public.hk_acceso(company_id, project_id));

-- ── 4) La foto pertenece a un inconveniente ─────────────────────────────────
ALTER TABLE public.servicio_housekeeping_fotos
  ADD COLUMN IF NOT EXISTS inconveniente_id uuid
    REFERENCES public.servicio_housekeeping_inconvenientes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.servicio_housekeeping_fotos.inconveniente_id IS
  'Sólo en la fase «inconvenientes»: a cuál de los inconvenientes del servicio pertenece la foto (NULL en fotos anteriores a 20261124000000 que no se pudieron atribuir).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.servicio_housekeeping_fotos'::regclass AND conname = 'hk_fotos_inconveniente_fase'
  ) THEN
    ALTER TABLE public.servicio_housekeeping_fotos
      ADD CONSTRAINT hk_fotos_inconveniente_fase CHECK (inconveniente_id IS NULL OR fase = 'inconvenientes');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hk_fotos_inconveniente
  ON public.servicio_housekeeping_fotos(inconveniente_id) WHERE inconveniente_id IS NOT NULL;

-- Igual que en 20261028000000 más la comprobación del inconveniente: tiene que
-- ser de ESTE servicio. SECURITY INVOKER: el EXISTS pasa por la RLS del usuario.
CREATE OR REPLACE FUNCTION public.hk_fotos_preparar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company uuid;
  v_project uuid;
  v_n       int;
BEGIN
  SELECT s.company_id, s.project_id INTO v_company, v_project
    FROM public.servicios_housekeeping s WHERE s.id = NEW.servicio_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Servicio de housekeeping inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.company_id := v_company;
  NEW.project_id := v_project;

  IF NEW.path IS NULL OR NEW.path !~ ('^' || v_project::text || '/' || NEW.servicio_id::text || '/[^/]+$') THEN
    RAISE EXCEPTION 'La ruta de la foto no pertenece a este servicio (esperada: %/%/<archivo>)', v_project, NEW.servicio_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.inconveniente_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.servicio_housekeeping_inconvenientes i
        WHERE i.id = NEW.inconveniente_id AND i.servicio_id = NEW.servicio_id) THEN
    RAISE EXCEPTION 'El inconveniente no pertenece a este servicio' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.servicio_id::text || ':' || NEW.fase));
  SELECT count(*) INTO v_n FROM public.servicio_housekeeping_fotos
   WHERE servicio_id = NEW.servicio_id AND fase = NEW.fase;
  IF v_n >= 20 THEN
    RAISE EXCEPTION 'Máximo 20 fotos por fase' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_fotos_preparar() FROM PUBLIC, anon, authenticated;

-- ── 5) Borrado autorizado por RPC: el ítem y sus fotos ──────────────────────
-- Misma regla que hk_eliminar_foto: dueño/admin de la empresa o super_admin, y
-- también quien lo creó mientras el servicio no esté completado. Lo que no es de
-- tu empresa responde «inexistente». Las fotos borradas entran a la cola de
-- limpieza por trg_hk_fotos_encolar; devuelve cuántos archivos encoló.
CREATE OR REPLACE FUNCTION public.hk_eliminar_inconveniente(p_inconveniente_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  i       public.servicio_housekeeping_inconvenientes;
  v_est   text;
  v_fotos integer;
  v_n     integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO i FROM public.servicio_housekeeping_inconvenientes WHERE id = p_inconveniente_id FOR UPDATE;
  IF NOT FOUND OR NOT public.hk_acceso(i.company_id, i.project_id) THEN
    RAISE EXCEPTION 'Inconveniente inexistente' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.estado INTO v_est FROM public.servicios_housekeeping s WHERE s.id = i.servicio_id;

  IF NOT (
    public.is_super_admin()
    OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
    OR (i.creado_por = v_uid AND v_est IS DISTINCT FROM 'completado')
  ) THEN
    RAISE EXCEPTION 'No tienes autorización para eliminar este inconveniente' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_fotos
    FROM public.servicio_housekeeping_fotos WHERE inconveniente_id = p_inconveniente_id AND path IS NOT NULL;

  PERFORM set_config('app.hk_motivo', 'inconveniente_eliminado', true);
  DELETE FROM public.servicio_housekeeping_fotos WHERE inconveniente_id = p_inconveniente_id;
  DELETE FROM public.servicio_housekeeping_inconvenientes WHERE id = p_inconveniente_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'No se eliminó el inconveniente (filas afectadas: %)', v_n USING ERRCODE = 'P0002';
  END IF;
  RETURN v_fotos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_eliminar_inconveniente(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_eliminar_inconveniente(uuid) TO authenticated;

-- ── 6) Datos existentes: el texto y la bolsa de fotos pasan a ser el ítem 1 ─
-- Sólo donde había algo (texto no vacío o fotos en la fase) y sólo si el
-- servicio aún no tiene ítems: re-aplicar no duplica. El trigger de sincronía
-- reescribe el texto con el mismo contenido (recortado de espacios).
INSERT INTO public.servicio_housekeeping_inconvenientes (servicio_id, orden, descripcion, creado_por)
SELECT s.id, 1, left(btrim(COALESCE(s.inconvenientes, '')), 4000), s.iniciado_por
  FROM public.servicios_housekeeping s
 WHERE (NULLIF(btrim(s.inconvenientes), '') IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.servicio_housekeeping_fotos f
                    WHERE f.servicio_id = s.id AND f.fase = 'inconvenientes'))
   AND NOT EXISTS (SELECT 1 FROM public.servicio_housekeeping_inconvenientes i WHERE i.servicio_id = s.id);

UPDATE public.servicio_housekeeping_fotos f
   SET inconveniente_id = i.id
  FROM public.servicio_housekeeping_inconvenientes i
 WHERE f.servicio_id = i.servicio_id AND i.orden = 1
   AND f.fase = 'inconvenientes' AND f.inconveniente_id IS NULL;
