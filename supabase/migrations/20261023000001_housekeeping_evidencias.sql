-- ════════════════════════════════════════════════════════════════════════════
-- Housekeeping · evidencia del estado de la unidad antes y después del servicio
-- ════════════════════════════════════════════════════════════════════════════
-- Qué se documenta
--   · INGRESO: cómo se encontró la unidad. Hasta 20 fotos + texto libre con
--     eventualidades (cristalería rota, desperfectos, objetos olvidados…).
--   · CIERRE:  cómo quedó. Hasta 20 fotos + observaciones finales.
--   · QUIÉN:   quién inició y quién completó el servicio. Lo sella la BD con
--     auth.uid() (mismo criterio que `creado_por`, 20260731000000): el cliente
--     no puede declararse autor de una limpieza que no hizo. `responsable`
--     sigue siendo el nombre libre que escribe el supervisor.
--
-- Retención
--   Las FOTOS se depuran a los 90 días (edge function `purgar-fotos-registros`,
--   mismo cron mensual que las lecturas): se borra el objeto del bucket y se
--   anula `path`; la fila de la foto sobrevive (fase, quién, cuándo) y la UI
--   la muestra como "foto depurada". Las OBSERVACIONES viven en
--   `servicios_housekeeping` y NO se tocan nunca: son el registro de que algo
--   estaba roto, y eso debe poder consultarse cuando la foto ya no existe.
--
-- Aislamiento
--   Bucket privado propio (no `condominios-media`, que autoriza por proyecto y
--   dejaría a cualquier residente leer el estado interior de la unidad de su
--   vecino). Ruta `<project_id>/<servicio_id>/<archivo>`; las policies se
--   resuelven desde la FILA del servicio, que ya está bajo RLS de empresa. Sin
--   policy de UPDATE: una evidencia no se sustituye, se borra y se vuelve a
--   subir.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Texto y sellos en el servicio ────────────────────────────────────────
ALTER TABLE public.servicios_housekeeping
  ADD COLUMN IF NOT EXISTS hallazgos_ingreso   text,
  ADD COLUMN IF NOT EXISTS observaciones_cierre text,
  ADD COLUMN IF NOT EXISTS iniciado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS iniciado_en         timestamptz,
  ADD COLUMN IF NOT EXISTS completado_por      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completado_en       timestamptz;

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
    NEW.iniciado_por := NULL;  NEW.iniciado_en := NULL;
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

-- ── 2) Tabla de fotos ───────────────────────────────────────────────────────
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

-- company/project salen del servicio (no del cliente) y se limita a 20 por fase.
-- SECURITY INVOKER: el SELECT del servicio pasa por su RLS, así que subir una
-- foto a un servicio de otra empresa falla como "no existe".
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

ALTER TABLE public.servicio_housekeeping_fotos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hk_fotos_select" ON public.servicio_housekeeping_fotos;
DROP POLICY IF EXISTS "hk_fotos_insert" ON public.servicio_housekeeping_fotos;
DROP POLICY IF EXISTS "hk_fotos_delete" ON public.servicio_housekeeping_fotos;

CREATE POLICY "hk_fotos_select" ON public.servicio_housekeeping_fotos
  FOR SELECT TO authenticated
  USING (company_id = (SELECT public.get_my_company_id()) OR (SELECT public.is_super_admin()));

-- company_id/project_id los impone el trigger; el CHECK es la segunda llave.
CREATE POLICY "hk_fotos_insert" ON public.servicio_housekeeping_fotos
  FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id()) OR (SELECT public.is_super_admin()));

-- Sin UPDATE para clientes: el path solo lo anula la purga (service-role).
-- Borra quien la subió mientras el servicio no esté completado, o un admin.
CREATE POLICY "hk_fotos_delete" ON public.servicio_housekeeping_fotos
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (
      company_id = (SELECT public.get_my_company_id())
      AND (
        (SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
        OR (
          creado_por = (SELECT auth.uid())
          AND EXISTS (
            SELECT 1 FROM public.servicios_housekeeping s
             WHERE s.id = servicio_id AND s.estado <> 'completado'
          )
        )
      )
    )
  );

-- ── 3) Bucket privado ───────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'housekeeping-evidencias', 'housekeeping-evidencias', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "hk_evidencias_select" ON storage.objects;
DROP POLICY IF EXISTS "hk_evidencias_insert" ON storage.objects;
DROP POLICY IF EXISTS "hk_evidencias_delete" ON storage.objects;

-- Ruta exacta <project_id>/<servicio_id>/<archivo>. El EXISTS corre con la RLS
-- de servicios_housekeeping (empresa), y se repite la condición a propósito.
CREATE POLICY "hk_evidencias_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'housekeeping-evidencias'
    AND (
      (SELECT public.is_super_admin())
      OR EXISTS (
        SELECT 1 FROM public.servicios_housekeeping s
         WHERE s.id::text = (storage.foldername(name))[2]
           AND s.project_id::text = (storage.foldername(name))[1]
           AND s.company_id = (SELECT public.get_my_company_id())
           AND public.can_access_project(s.project_id)
      )
    )
  );

CREATE POLICY "hk_evidencias_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'housekeeping-evidencias'
    AND array_length(storage.foldername(name), 1) = 2
    AND (
      (SELECT public.is_super_admin())
      OR EXISTS (
        SELECT 1 FROM public.servicios_housekeeping s
         WHERE s.id::text = (storage.foldername(name))[2]
           AND s.project_id::text = (storage.foldername(name))[1]
           AND s.company_id = (SELECT public.get_my_company_id())
           AND public.can_access_project(s.project_id)
      )
    )
  );

-- UPDATE: deliberadamente sin policy (una evidencia no se sustituye).

CREATE POLICY "hk_evidencias_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'housekeeping-evidencias'
    AND (
      (SELECT public.is_super_admin())
      OR EXISTS (
        SELECT 1 FROM public.servicios_housekeeping s
         WHERE s.id::text = (storage.foldername(name))[2]
           AND s.project_id::text = (storage.foldername(name))[1]
           AND s.company_id = (SELECT public.get_my_company_id())
           AND public.can_access_project(s.project_id)
           AND (
             (SELECT public.current_user_role()) = ANY(ARRAY['company_owner','admin'])
             OR (owner = (SELECT auth.uid()) AND s.estado <> 'completado')
           )
      )
    )
  );
