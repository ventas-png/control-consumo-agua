-- ════════════════════════════════════════════════════════════════════════════
-- Housekeeping · evidencia del estado de la unidad antes y después del servicio
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ SE DOCUMENTA
--   · INGRESO: cómo se encontró la unidad. Hasta 20 fotos + texto libre con las
--     eventualidades (cristalería rota, desperfectos, objetos olvidados…).
--   · CIERRE:  cómo quedó. Hasta 20 fotos + observaciones finales.
--   · QUIÉN:   quién inició y quién completó el servicio. Lo sella la BD con
--     auth.uid() (mismo criterio que `creado_por`, 20260731000000): el cliente
--     no puede declararse autor de una limpieza que no hizo. `responsable`
--     sigue siendo el nombre libre que escribe el supervisor.
--
-- HISTORIA DE ESTE ARCHIVO — LEER ANTES DE TOCAR LA NUMERACIÓN
--   Esta migración REEMPLAZA a `20261023000001_housekeeping_evidencias` (primera
--   versión de este mismo PR). Esa versión NO llegó a main, ni a producción
--   (máx. 20261026000500, 0 migraciones de housekeeping), ni al sandbox
--   `control-agua-rls-sandbox` (máx. 20261027000800): solo estuvo aplicada en el
--   preview branch EFÍMERO de la PR #927. Por eso se pudo renumerar; la
--   reconciliación de ese único entorno (registro + contenido) está descrita en
--   docs/HOUSEKEEPING_EVIDENCIAS.md §Reconciliación.
--   Esta versión es IDEMPOTENTE y CONVERGE desde ese estado antiguo (DROP IF
--   EXISTS de cada política/trigger conocido, CREATE OR REPLACE, ADD COLUMN IF
--   NOT EXISTS): la prueba `supabase/tests/housekeeping_evidencias` aplica
--   primero la versión antigua y luego esta.
--   ORDEN DE FUSIÓN: va DESPUÉS de las nueve de la PR #926 (20261027000000 …
--   20261027000800). Si se fusionara antes, la guarda de migraciones
--   intercaladas obligaría a renumerar las de #926.
--
-- AUTORIZACIÓN (tabla, Storage y RPC usan la MISMA función: hk_acceso)
--   empresa de la fila = empresa del usuario
--   AND acceso al PROYECTO de la fila (can_access_project)
--   AND permiso de la pestaña `condominios.tab.housekeeping`
--   (o super_admin). Es la regla de escritura de `servicios_housekeeping`
--   (20260518000010); la versión anterior pedía solo empresa y dejaba ver las
--   fotos del interior de una unidad a cualquier empleado de la empresa.
--   Los residentes NO ven fotos (sí ven el texto de su propia unidad porque la
--   política de `servicios_housekeeping` ya les da lectura de esa fila).
--
--   Acciones destructivas: NINGÚN cliente tiene UPDATE ni DELETE, ni en la
--   tabla de fotos ni en el bucket (se revocan los privilegios: un intento
--   falla con «permission denied» en vez de afectar 0 filas en silencio).
--   Borrar una foto o un servicio pasa por dos RPC que autorizan la ACCIÓN,
--   exigen exactamente una fila afectada y dejan los archivos en una COLA de
--   limpieza que drena una función de servidor con reintentos.
--
-- ARCHIVOS: bucket privado propio, ruta `<project_id>/<servicio_id>/<archivo>`.
--   La ruta se valida en tres sitios: policy de INSERT del bucket (el servicio
--   existe, es de ese proyecto y el usuario tiene acceso), trigger de la fila de
--   foto (la ruta pertenece a ESE servicio) e índice único (un objeto = una
--   fila: borrar una foto jamás retira el archivo de otra).
--
-- RETENCIÓN: las FOTOS se depuran a los 90 días (edge function
--   `purgar-fotos-registros`): se borra el objeto y se anula `path`; la fila
--   sobrevive. Los TEXTOS (`hallazgos_ingreso`, `observaciones_cierre`) y los
--   sellos de autoría viven en `servicios_housekeeping` y NO se tocan nunca.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Texto y sellos en el servicio ────────────────────────────────────────
ALTER TABLE public.servicios_housekeeping
  ADD COLUMN IF NOT EXISTS hallazgos_ingreso    text,
  ADD COLUMN IF NOT EXISTS observaciones_cierre text,
  ADD COLUMN IF NOT EXISTS iniciado_por         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS iniciado_en          timestamptz,
  ADD COLUMN IF NOT EXISTS completado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completado_en        timestamptz;

COMMENT ON COLUMN public.servicios_housekeeping.hallazgos_ingreso IS
  'Estado en que se encontró la unidad y eventualidades (cristalería rota, desperfectos…). Nunca se purga.';
COMMENT ON COLUMN public.servicios_housekeeping.observaciones_cierre IS
  'Cómo quedó la unidad al terminar. Nunca se purga.';
COMMENT ON COLUMN public.servicios_housekeeping.iniciado_por IS
  'Usuario que pasó el servicio a en_proceso. Lo sella la BD (trg_hk_sellar_ejecucion).';
COMMENT ON COLUMN public.servicios_housekeeping.completado_por IS
  'Usuario que pasó el servicio a completado. Lo sella la BD (trg_hk_sellar_ejecucion).';

-- Sella iniciado_*/completado_* en la TRANSICIÓN de estado. Lo que el cliente
-- mande en esas columnas se ignora: en INSERT se parte de NULL y en UPDATE de
-- lo que ya había. auth.uid() NULL (cron, service-role) deja el sello en NULL.
CREATE OR REPLACE FUNCTION public.hk_sellar_ejecucion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.iniciado_por := NULL;   NEW.iniciado_en := NULL;
    NEW.completado_por := NULL; NEW.completado_en := NULL;
  ELSE
    NEW.iniciado_por := OLD.iniciado_por;     NEW.iniciado_en := OLD.iniciado_en;
    NEW.completado_por := OLD.completado_por; NEW.completado_en := OLD.completado_en;
  END IF;

  IF NEW.estado = 'en_proceso'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'en_proceso') THEN
    NEW.iniciado_por := v_uid;
    NEW.iniciado_en  := now();
  END IF;

  IF NEW.estado = 'completado'
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'completado') THEN
    NEW.completado_por := v_uid;
    NEW.completado_en  := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_sellar_ejecucion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_sellar_ejecucion ON public.servicios_housekeeping;
CREATE TRIGGER trg_hk_sellar_ejecucion
  BEFORE INSERT OR UPDATE ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.hk_sellar_ejecucion();

-- Mover un servicio de empresa/proyecto con fotos rompería la regla de ruta
-- (`<project>/<servicio>/…`): las fotos quedarían bajo un proyecto que ya no es
-- el suyo. SECURITY DEFINER para que el EXISTS no dependa de la RLS del usuario.
CREATE OR REPLACE FUNCTION public.hk_servicio_alcance_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id)
     AND EXISTS (SELECT 1 FROM public.servicio_housekeeping_fotos f WHERE f.servicio_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede cambiar la empresa o el proyecto de un servicio con fotos de evidencia'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_servicio_alcance_inmutable() FROM PUBLIC, anon, authenticated;

-- ── 2) Autorización única ───────────────────────────────────────────────────
-- Misma regla que la escritura de `servicios_housekeeping` + acceso al proyecto.
-- STABLE y SECURITY DEFINER: los helpers que usa leen app_users/roles con la
-- RLS de esas tablas, y una policy no debe depender de ellas.
CREATE OR REPLACE FUNCTION public.hk_acceso(p_company uuid, p_project uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_super_admin()
      OR (
        p_company IS NOT NULL
        AND p_company = public.get_my_company_id()
        AND public.user_has_permission('condominios.tab.housekeeping')
        AND public.can_access_project(p_project)
      )
$$;

COMMENT ON FUNCTION public.hk_acceso(uuid, uuid) IS
  'Empresa + acceso al proyecto + permiso condominios.tab.housekeeping (o super_admin). La usan las policies de la tabla de fotos, las del bucket y las RPC de borrado.';

REVOKE EXECUTE ON FUNCTION public.hk_acceso(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_acceso(uuid, uuid) TO authenticated;

-- ── 3) Tabla de fotos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.servicio_housekeeping_fotos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)  ON DELETE CASCADE,
  servicio_id  uuid        NOT NULL REFERENCES public.servicios_housekeeping(id) ON DELETE CASCADE,
  fase         text        NOT NULL CHECK (fase IN ('ingreso', 'cierre')),
  -- NULL = depurada por retención (el objeto ya no existe en el bucket).
  path         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  creado_por   uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.servicio_housekeeping_fotos IS
  'Fotos de evidencia de un servicio de housekeeping (fase ingreso | cierre, máx. 20 por fase). path NULL = depurada a los 90 días.';

CREATE INDEX IF NOT EXISTS idx_hk_fotos_servicio ON public.servicio_housekeeping_fotos(servicio_id, fase, created_at);
-- Apoya el barrido de la purga (filas con foto viva, más viejas que el corte).
CREATE INDEX IF NOT EXISTS idx_hk_fotos_vivas ON public.servicio_housekeeping_fotos(created_at) WHERE path IS NOT NULL;
-- Un objeto = una fila. Sin esto, dos filas con el mismo path harían que borrar
-- una retirara el archivo de la otra.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hk_fotos_path ON public.servicio_housekeeping_fotos(path) WHERE path IS NOT NULL;

-- company/project salen del servicio (no del cliente), la ruta tiene que ser la
-- de ESE servicio y se limita a 20 por fase. SECURITY INVOKER: el SELECT del
-- servicio pasa por su RLS, así que subir una foto a un servicio ajeno falla
-- como «no existe».
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

DROP TRIGGER IF EXISTS trg_hk_fotos_preparar ON public.servicio_housekeeping_fotos;
CREATE TRIGGER trg_hk_fotos_preparar
  BEFORE INSERT ON public.servicio_housekeeping_fotos
  FOR EACH ROW EXECUTE FUNCTION public.hk_fotos_preparar();

DROP TRIGGER IF EXISTS trg_sellar_creado_por ON public.servicio_housekeeping_fotos;
CREATE TRIGGER trg_sellar_creado_por
  BEFORE INSERT OR UPDATE ON public.servicio_housekeeping_fotos
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');

-- Los servicios con fotos no cambian de alcance (ver arriba).
DROP TRIGGER IF EXISTS trg_hk_servicio_alcance ON public.servicios_housekeeping;
CREATE TRIGGER trg_hk_servicio_alcance
  BEFORE UPDATE OF company_id, project_id ON public.servicios_housekeeping
  FOR EACH ROW EXECUTE FUNCTION public.hk_servicio_alcance_inmutable();

ALTER TABLE public.servicio_housekeeping_fotos ENABLE ROW LEVEL SECURITY;

-- Privilegios mínimos: leer y subir. Nada de UPDATE/DELETE para clientes (el
-- cascade de un servicio borrado corre con los privilegios del dueño de la tabla).
REVOKE ALL ON TABLE public.servicio_housekeeping_fotos FROM anon;
REVOKE ALL ON TABLE public.servicio_housekeeping_fotos FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.servicio_housekeeping_fotos TO authenticated;

DROP POLICY IF EXISTS "hk_fotos_select" ON public.servicio_housekeeping_fotos;
DROP POLICY IF EXISTS "hk_fotos_insert" ON public.servicio_housekeeping_fotos;
DROP POLICY IF EXISTS "hk_fotos_delete" ON public.servicio_housekeeping_fotos;

CREATE POLICY "hk_fotos_select" ON public.servicio_housekeeping_fotos
  FOR SELECT TO authenticated
  USING (public.hk_acceso(company_id, project_id));

-- company_id/project_id los impone el trigger; esta es la segunda llave.
CREATE POLICY "hk_fotos_insert" ON public.servicio_housekeeping_fotos
  FOR INSERT TO authenticated
  WITH CHECK (public.hk_acceso(company_id, project_id));

-- ── 4) Cola de limpieza de archivos ─────────────────────────────────────────
-- Todo archivo que deja de tener fila (foto borrada, servicio borrado, cascada
-- de proyecto o empresa, objeto huérfano) entra aquí. Una función de servidor
-- (service-role) lo retira del bucket con reintentos y espaciado creciente; la
-- fila solo sale de la cola cuando el borrado se confirmó.
CREATE TABLE IF NOT EXISTS public.hk_limpieza_storage (
  id               bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket           text        NOT NULL,
  path             text        NOT NULL,
  -- Sin FK a propósito: la cola sobrevive al borrado de la empresa/proyecto.
  company_id       uuid,
  project_id       uuid,
  motivo           text        NOT NULL DEFAULT 'foto_eliminada',
  intentos         integer     NOT NULL DEFAULT 0,
  ultimo_error     text,
  proximo_intento  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, path)
);

COMMENT ON TABLE public.hk_limpieza_storage IS
  'Cola de archivos por retirar del bucket housekeeping-evidencias. La alimentan triggers y barridos; la drena la edge function con service-role (hk_limpieza_tomar/confirmar/fallar). Sin acceso para clientes.';

ALTER TABLE public.hk_limpieza_storage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hk_limpieza_storage FROM anon, authenticated;

DROP POLICY IF EXISTS "hk_limpieza_sin_acceso" ON public.hk_limpieza_storage;
CREATE POLICY "hk_limpieza_sin_acceso" ON public.hk_limpieza_storage
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_hk_limpieza_pendientes ON public.hk_limpieza_storage(proximo_intento) WHERE intentos < 10;

-- Encola el archivo de CADA fila de foto que se elimina, venga el DELETE de
-- donde venga (RPC, cascada de servicio/proyecto/empresa, SQL de un admin).
-- SECURITY DEFINER: quien borra no tiene (ni debe tener) acceso a la cola.
CREATE OR REPLACE FUNCTION public.hk_fotos_encolar_limpieza()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.path IS NOT NULL THEN
    INSERT INTO public.hk_limpieza_storage (bucket, path, company_id, project_id, motivo)
    VALUES (
      'housekeeping-evidencias', OLD.path, OLD.company_id, OLD.project_id,
      COALESCE(NULLIF(current_setting('app.hk_motivo', true), ''), 'foto_eliminada')
    )
    ON CONFLICT (bucket, path) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_fotos_encolar_limpieza() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_hk_fotos_encolar ON public.servicio_housekeeping_fotos;
CREATE TRIGGER trg_hk_fotos_encolar
  AFTER DELETE ON public.servicio_housekeeping_fotos
  FOR EACH ROW EXECUTE FUNCTION public.hk_fotos_encolar_limpieza();

-- Toma un lote con arrendamiento: marca proximo_intento a +10 min para que dos
-- drenajes simultáneos no procesen lo mismo (FOR UPDATE SKIP LOCKED). Las filas
-- con 10 intentos fallidos quedan «atascadas»: no se reintentan solas y siguen
-- visibles en la cola con su último error.
CREATE OR REPLACE FUNCTION public.hk_limpieza_tomar(p_company uuid DEFAULT NULL, p_limite integer DEFAULT 100)
RETURNS SETOF public.hk_limpieza_storage
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH t AS (
    SELECT id FROM public.hk_limpieza_storage
     WHERE proximo_intento <= now()
       AND intentos < 10
       AND (p_company IS NULL OR company_id = p_company)
     ORDER BY id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limite, 100), 500))
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.hk_limpieza_storage q
     SET proximo_intento = now() + interval '10 minutes'
    FROM t
   WHERE q.id = t.id
  RETURNING q.*
$$;

-- Confirma el borrado: devuelve cuántas filas salieron de la cola. El que llama
-- compara con lo esperado (cero filas afectadas ≠ éxito).
CREATE OR REPLACE FUNCTION public.hk_limpieza_confirmar(p_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.hk_limpieza_storage WHERE id = ANY(p_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Registra un fallo: +1 intento, el error y espera 5·2^intentos minutos (tope 24 h).
CREATE OR REPLACE FUNCTION public.hk_limpieza_fallar(p_ids bigint[], p_error text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.hk_limpieza_storage
     SET intentos        = intentos + 1,
         ultimo_error    = left(COALESCE(p_error, 'error sin detalle'), 500),
         proximo_intento = now() + make_interval(mins => LEAST(1440, (5 * power(2, LEAST(intentos, 10)))::int))
   WHERE id = ANY(p_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Objetos del bucket sin fila de foto ni entrada en la cola (subidas cuyo
-- registro falló). `p_min_edad` evita tocar lo recién subido, cuya fila aún no
-- se insertó. Devuelve cuántos encoló.
CREATE OR REPLACE FUNCTION public.hk_limpieza_encolar_huerfanas(p_min_edad interval DEFAULT interval '1 day')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.hk_limpieza_storage (bucket, path, company_id, project_id, motivo)
  SELECT o.bucket_id, o.name, pr.company_id, pr.id, 'huerfana'
    FROM storage.objects o
    LEFT JOIN public.projects pr ON pr.id::text = (storage.foldername(o.name))[1]
   WHERE o.bucket_id = 'housekeeping-evidencias'
     AND o.created_at < now() - p_min_edad
     AND NOT EXISTS (SELECT 1 FROM public.servicio_housekeeping_fotos f WHERE f.path = o.name)
  ON CONFLICT (bucket, path) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_limpieza_tomar(uuid, integer)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hk_limpieza_confirmar(bigint[])             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hk_limpieza_fallar(bigint[], text)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hk_limpieza_encolar_huerfanas(interval)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hk_limpieza_tomar(uuid, integer)            TO service_role;
GRANT  EXECUTE ON FUNCTION public.hk_limpieza_confirmar(bigint[])             TO service_role;
GRANT  EXECUTE ON FUNCTION public.hk_limpieza_fallar(bigint[], text)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.hk_limpieza_encolar_huerfanas(interval)     TO service_role;

-- ── 5) Borrado autorizado por RPC ───────────────────────────────────────────
-- Quién puede borrar: la misma regla que `servicios_housekeeping_delete`
-- (company_owner/admin de la empresa, o super_admin) y, para una foto suelta,
-- también quien la subió mientras el servicio no esté completado. Lo que no es
-- de tu empresa responde «inexistente» (no revela que existe).
CREATE OR REPLACE FUNCTION public.hk_eliminar_foto(p_foto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  f      public.servicio_housekeeping_fotos;
  v_est  text;
  v_n    integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO f FROM public.servicio_housekeeping_fotos WHERE id = p_foto_id FOR UPDATE;
  IF NOT FOUND OR NOT public.hk_acceso(f.company_id, f.project_id) THEN
    RAISE EXCEPTION 'Foto inexistente' USING ERRCODE = 'P0002';
  END IF;

  SELECT s.estado INTO v_est FROM public.servicios_housekeeping s WHERE s.id = f.servicio_id;

  IF NOT (
    public.is_super_admin()
    OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
    OR (f.creado_por = v_uid AND v_est IS DISTINCT FROM 'completado')
  ) THEN
    RAISE EXCEPTION 'No tienes autorización para eliminar esta foto' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.hk_motivo', 'foto_eliminada', true);
  DELETE FROM public.servicio_housekeeping_fotos WHERE id = p_foto_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'No se eliminó la foto (filas afectadas: %)', v_n USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Devuelve cuántos archivos quedaron en la cola de limpieza.
CREATE OR REPLACE FUNCTION public.hk_eliminar_servicio(p_servicio_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  s        public.servicios_housekeeping;
  v_fotos  integer;
  v_n      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO s FROM public.servicios_housekeeping WHERE id = p_servicio_id FOR UPDATE;
  IF NOT FOUND OR NOT (
       public.is_super_admin()
       OR (s.company_id = public.get_my_company_id() AND public.can_access_project(s.project_id))
     ) THEN
    RAISE EXCEPTION 'Servicio inexistente' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_super_admin()
    OR public.current_user_role() = ANY (ARRAY['company_owner', 'admin'])
  ) THEN
    RAISE EXCEPTION 'No tienes autorización para eliminar este servicio' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_fotos
    FROM public.servicio_housekeeping_fotos WHERE servicio_id = p_servicio_id AND path IS NOT NULL;

  PERFORM set_config('app.hk_motivo', 'servicio_eliminado', true);
  DELETE FROM public.servicios_housekeeping WHERE id = p_servicio_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'No se eliminó el servicio (filas afectadas: %)', v_n USING ERRCODE = 'P0002';
  END IF;
  RETURN v_fotos;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hk_eliminar_foto(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.hk_eliminar_servicio(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_eliminar_foto(uuid)     TO authenticated;
GRANT  EXECUTE ON FUNCTION public.hk_eliminar_servicio(uuid) TO authenticated;

-- ── 6) Bucket privado y policies de Storage ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'housekeeping-evidencias', 'housekeeping-evidencias', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Cuenta los objetos de un servicio en el bucket. Va en una función y no en un
-- subselect de la policy: una policy de storage.objects que consulta storage.objects
-- se rechaza por «infinite recursion detected in policy». SECURITY DEFINER para
-- contar TODOS los objetos del servicio, no solo los que ve quien sube.
CREATE OR REPLACE FUNCTION public.hk_objetos_del_servicio(p_servicio text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::integer FROM storage.objects o
   WHERE o.bucket_id = 'housekeeping-evidencias'
     AND (storage.foldername(o.name))[2] = p_servicio
$$;

REVOKE EXECUTE ON FUNCTION public.hk_objetos_del_servicio(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.hk_objetos_del_servicio(text) TO authenticated;

DROP POLICY IF EXISTS "hk_evidencias_select" ON storage.objects;
DROP POLICY IF EXISTS "hk_evidencias_insert" ON storage.objects;
DROP POLICY IF EXISTS "hk_evidencias_delete" ON storage.objects;

-- SELECT: el objeto cuelga de un servicio que existe, es DE ESE proyecto
-- (carpeta 1 = proyecto del servicio, carpeta 2 = servicio) y el usuario
-- pasa hk_acceso. Una ruta fabricada no coincide con ningún servicio.
CREATE POLICY "hk_evidencias_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'housekeeping-evidencias'
    AND EXISTS (
      SELECT 1 FROM public.servicios_housekeeping s
       WHERE s.id::text = (storage.foldername(name))[2]
         AND s.project_id::text = (storage.foldername(name))[1]
         AND public.hk_acceso(s.company_id, s.project_id)
    )
  );

-- INSERT: misma regla, ruta de exactamente <carpeta>/<carpeta>/<archivo> (sin segmentos
-- vacíos, sin niveles de más) y un tope de
-- objetos por servicio (2 fases × 20 + holgura para reintentos) que acota el
-- abuso aunque nunca se registre la fila.
CREATE POLICY "hk_evidencias_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'housekeeping-evidencias'
    AND name ~ '^[^/]+/[^/]+/[^/]+$'
    AND EXISTS (
      SELECT 1 FROM public.servicios_housekeeping s
       WHERE s.id::text = (storage.foldername(name))[2]
         AND s.project_id::text = (storage.foldername(name))[1]
         AND public.hk_acceso(s.company_id, s.project_id)
    )
    AND public.hk_objetos_del_servicio((storage.foldername(name))[2]) < 60
  );

-- UPDATE y DELETE: deliberadamente SIN policy. Una evidencia no se sustituye, y
-- los archivos solo los retira la función de servidor (service-role) desde la
-- cola. La versión anterior permitía borrar al que subió o a un admin.

-- ── 7) Reintentos programados ───────────────────────────────────────────────
-- Misma cañería que las demás purgas (secretos de Vault `purga_fotos_url` y
-- `purga_fotos_service_key`; sin ellos es un no-op seguro). Cada hora pide a
-- `purgar-fotos-registros` que drene la cola.
CREATE OR REPLACE FUNCTION public.run_hk_limpieza_storage()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'purga_fotos_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'purga_fotos_service_key';

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('mode', 'limpieza_housekeeping')
    );
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.run_hk_limpieza_storage() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hk_limpieza_storage_hourly';
    PERFORM cron.schedule('hk_limpieza_storage_hourly', '17 * * * *', 'SELECT public.run_hk_limpieza_storage();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'hk_limpieza_storage_hourly no se programó: %', SQLERRM;
END;
$$;
