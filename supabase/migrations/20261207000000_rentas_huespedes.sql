-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas · fotos del huésped y personas del grupo en las reservas de
-- propiedades INDEPENDIENTES.
--
-- POR QUÉ. Las reservas de una propiedad enlazada a un condominio ya llevan
-- fotos y grupo: viven en `reservas_str` / `huespedes_str` y sus fotos en
-- `condominios-media`, que autoriza por PROYECTO. Una propiedad independiente
-- no tiene proyecto, así que sus reservas (`rentas_reservas`) no podían llevar
-- ni la foto del huésped, ni la de su documento, ni a sus acompañantes.
--
-- QUÉ AGREGA
--   1. `rentas_reservas.foto_url` y `.foto_documento_url`: RUTAS en el bucket
--      nuevo (no URLs firmadas), dentro de la carpeta de la propiedad de la fila.
--   2. `rentas_huespedes`: las personas adicionales de una reserva (nombre,
--      identificación, menor de edad, fecha de nacimiento, sus dos fotos).
--      FK compuesta con la empresa y trigger de coherencia: la reserva es de esa
--      propiedad. RLS con las claves de `rentas.reservas.*`.
--   3. Bucket PRIVADO `rentas-huespedes`, ruta `<company_id>/<propiedad_id>/<archivo>.jpg`,
--      y `rentas_huesped_foto_permitida(ruta, acción)`: la MISMA regla que la RLS
--      de `rentas_reservas` (empresa propia + servicio contratado + propiedad
--      accesible por proyecto + `rentas.reservas.view`), más la de cada acción:
--        ver     → nada más
--        subir   → `.create` o `.edit` (se sube antes de guardar la fila)
--        borrar  → `.create`, `.edit` o `.delete`, y SÓLO si ninguna reserva ni
--                  persona del grupo la nombra todavía (una fila guardada nunca
--                  apunta a un archivo borrado: el cliente guarda y luego retira).
--      Sin policy de UPDATE: una foto no se sustituye.
--
-- Son documentos de identidad: el bucket es privado, sólo JPEG, y lo ve quien
-- ya puede ver la reserva. No hay acceso para `anon` ni para el portal.
--
-- LO QUE **NO** HACE: no toca `reservas_str`, `huespedes_str` ni
-- `condominios-media`; no borra archivos al borrar una reserva o una propiedad
-- (quedan huérfanos en el bucket, sin fila que los nombre: nadie los ve en la app).
--
-- Idempotente: se puede aplicar dos veces.
--
-- REVERSA
--   DROP POLICY IF EXISTS rentas_huespedes_fotos_select ON storage.objects;
--   DROP POLICY IF EXISTS rentas_huespedes_fotos_insert ON storage.objects;
--   DROP POLICY IF EXISTS rentas_huespedes_fotos_delete ON storage.objects;
--   DROP FUNCTION IF EXISTS public.rentas_huesped_foto_permitida(text, text);
--   DROP TABLE IF EXISTS public.rentas_huespedes;
--   DROP FUNCTION IF EXISTS public.rentas_huesped_coherente();
--   ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_fotos_check,
--     DROP COLUMN IF EXISTS foto_url, DROP COLUMN IF EXISTS foto_documento_url;
--   -- El bucket se vacía desde el dashboard o la API de Storage y después:
--   -- DELETE FROM storage.buckets WHERE id = 'rentas-huespedes';
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Fotos del huésped principal en la reserva
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rentas_reservas
  ADD COLUMN IF NOT EXISTS foto_url           text,
  ADD COLUMN IF NOT EXISTS foto_documento_url text;

ALTER TABLE public.rentas_reservas DROP CONSTRAINT IF EXISTS rentas_reservas_fotos_check;
ALTER TABLE public.rentas_reservas ADD CONSTRAINT rentas_reservas_fotos_check
  CHECK (public.rentas_fotos_en_carpeta(
           array_remove(ARRAY[foto_url, foto_documento_url], NULL), company_id, propiedad_id));

COMMENT ON COLUMN public.rentas_reservas.foto_url IS
  'Ruta de la foto del huésped principal en el bucket privado rentas-huespedes, bajo <company_id>/<propiedad_id>/.';
COMMENT ON COLUMN public.rentas_reservas.foto_documento_url IS
  'Ruta de la foto del documento de identidad del huésped principal, en el mismo bucket y carpeta.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Personas del grupo
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rentas_huespedes (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  propiedad_id       uuid        NOT NULL,
  reserva_id         uuid        NOT NULL REFERENCES public.rentas_reservas(id) ON DELETE CASCADE,
  nombre             text        NOT NULL,
  identificacion     text,
  es_menor           boolean     NOT NULL DEFAULT false,
  fecha_nacimiento   date,
  foto_url           text,
  foto_documento_url text,
  creado_por         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentas_huespedes_propiedad_fk
    FOREIGN KEY (propiedad_id, company_id)
    REFERENCES public.rentas_propiedades (id, company_id) ON DELETE CASCADE,
  CONSTRAINT rentas_huespedes_nombre_check CHECK (btrim(nombre) <> ''),
  CONSTRAINT rentas_huespedes_fotos_check
    CHECK (public.rentas_fotos_en_carpeta(
             array_remove(ARRAY[foto_url, foto_documento_url], NULL), company_id, propiedad_id))
);
CREATE INDEX IF NOT EXISTS idx_rentas_huespedes_reserva ON public.rentas_huespedes (reserva_id);
CREATE INDEX IF NOT EXISTS idx_rentas_huespedes_company ON public.rentas_huespedes (company_id);

COMMENT ON TABLE public.rentas_huespedes IS
  'Manejo de Rentas: personas adicionales (acompañantes) de una reserva de propiedad independiente. Las de propiedades enlazadas viven en huespedes_str.';

-- SECURITY DEFINER: lee rentas_reservas sin depender de la RLS de quien escribe.
CREATE OR REPLACE FUNCTION public.rentas_huesped_coherente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.company_id   IS DISTINCT FROM OLD.company_id
          OR NEW.propiedad_id IS DISTINCT FROM OLD.propiedad_id
          OR NEW.reserva_id   IS DISTINCT FROM OLD.reserva_id) THEN
    RAISE EXCEPTION 'RENTAS_HUESPED_INMUTABLE: una persona del grupo no cambia de reserva ni de propiedad'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT'
     AND NOT EXISTS (SELECT 1 FROM public.rentas_reservas r
                      WHERE r.id = NEW.reserva_id
                        AND r.propiedad_id = NEW.propiedad_id
                        AND r.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'RENTAS_HUESPED_RESERVA: la reserva no es de esa propiedad'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.nombre         := btrim(NEW.nombre);
  NEW.identificacion := NULLIF(btrim(NEW.identificacion), '');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rentas_huesped_coherente() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rentas_huespedes_coherente ON public.rentas_huespedes;
CREATE TRIGGER trg_rentas_huespedes_coherente
  BEFORE INSERT OR UPDATE ON public.rentas_huespedes
  FOR EACH ROW EXECUTE FUNCTION public.rentas_huesped_coherente();
DROP TRIGGER IF EXISTS trg_rentas_huespedes_sello ON public.rentas_huespedes;
CREATE TRIGGER trg_rentas_huespedes_sello
  BEFORE INSERT OR UPDATE ON public.rentas_huespedes
  FOR EACH ROW EXECUTE FUNCTION public.sellar_actor('creado_por', 'forzar');
DROP TRIGGER IF EXISTS trg_rentas_huespedes_updated_at ON public.rentas_huespedes;
CREATE TRIGGER trg_rentas_huespedes_updated_at
  BEFORE UPDATE ON public.rentas_huespedes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.rentas_huespedes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rentas_huespedes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rentas_huespedes TO authenticated;

-- El grupo es parte de la reserva: mismas claves que rentas_reservas.
DROP POLICY IF EXISTS rentas_huespedes_select ON public.rentas_huespedes;
CREATE POLICY rentas_huespedes_select ON public.rentas_huespedes FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin())
         OR (company_id = (SELECT public.get_my_company_id())
             AND (SELECT public.rentas_servicio_activo())
             AND public.rentas_propiedad_accesible(propiedad_id)
             AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))));
DROP POLICY IF EXISTS rentas_huespedes_insert ON public.rentas_huespedes;
CREATE POLICY rentas_huespedes_insert ON public.rentas_huespedes FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND (SELECT public.rentas_servicio_activo())
              AND public.rentas_propiedad_accesible(propiedad_id)
              AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
              AND ((SELECT COALESCE(public.user_has_permission('rentas.reservas.create'), false))
                OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false))));
DROP POLICY IF EXISTS rentas_huespedes_update ON public.rentas_huespedes;
CREATE POLICY rentas_huespedes_update ON public.rentas_huespedes FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.rentas_propiedad_accesible(propiedad_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false)))
  WITH CHECK (company_id = (SELECT public.get_my_company_id())
              AND public.rentas_propiedad_accesible(propiedad_id));
DROP POLICY IF EXISTS rentas_huespedes_delete ON public.rentas_huespedes;
CREATE POLICY rentas_huespedes_delete ON public.rentas_huespedes FOR DELETE TO authenticated
  USING (company_id = (SELECT public.get_my_company_id())
         AND (SELECT public.rentas_servicio_activo())
         AND public.rentas_propiedad_accesible(propiedad_id)
         AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
         AND ((SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false))
           OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.delete'), false))));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. El bucket y quién ve, sube y borra
-- ────────────────────────────────────────────────────────────────────────────
-- Sólo JPEG: el cliente re-codifica toda foto a JPEG antes de subirla.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rentas-huespedes', 'rentas-huespedes', false, 5242880, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- SECURITY DEFINER: mira rentas_propiedades, rentas_reservas y rentas_huespedes
-- enteras sin depender de la RLS de quien llama; la identidad sigue siendo la
-- del JWT. Las carpetas se comparan como TEXTO: castear a uuid una ruta
-- fabricada reventaría la consulta en vez de negarla.
CREATE OR REPLACE FUNCTION public.rentas_huesped_foto_permitida(p_ruta text, p_accion text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_ruta ~ '^[^/]+/[^/]+/[^/]+$'
     AND public.rentas_servicio_activo()
     AND (SELECT COALESCE(public.user_has_permission('rentas.reservas.view'), false))
     AND EXISTS (
       SELECT 1 FROM public.rentas_propiedades p
        WHERE p.company_id::text = split_part(p_ruta, '/', 1)
          AND p.id::text = split_part(p_ruta, '/', 2)
          AND p.company_id = (SELECT public.get_my_company_id())
          AND public.can_access_project(p.project_id))
     AND CASE p_accion
           WHEN 'ver' THEN true
           WHEN 'subir' THEN
             (SELECT COALESCE(public.user_has_permission('rentas.reservas.create'), false))
             OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false))
           WHEN 'borrar' THEN
             ((SELECT COALESCE(public.user_has_permission('rentas.reservas.create'), false))
              OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.edit'), false))
              OR (SELECT COALESCE(public.user_has_permission('rentas.reservas.delete'), false)))
             AND NOT EXISTS (
               SELECT 1 FROM public.rentas_reservas r
                WHERE r.company_id::text = split_part(p_ruta, '/', 1)
                  AND r.propiedad_id::text = split_part(p_ruta, '/', 2)
                  AND p_ruta IN (r.foto_url, r.foto_documento_url))
             AND NOT EXISTS (
               SELECT 1 FROM public.rentas_huespedes h
                WHERE h.company_id::text = split_part(p_ruta, '/', 1)
                  AND h.propiedad_id::text = split_part(p_ruta, '/', 2)
                  AND p_ruta IN (h.foto_url, h.foto_documento_url))
           ELSE false
         END
$$;
COMMENT ON FUNCTION public.rentas_huesped_foto_permitida(text, text) IS
  'Policy del bucket rentas-huespedes. p_accion: ver | subir | borrar. Misma regla que la RLS de rentas_reservas; borrar exige además que ninguna reserva ni persona del grupo nombre la foto.';
REVOKE EXECUTE ON FUNCTION public.rentas_huesped_foto_permitida(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rentas_huesped_foto_permitida(text, text) TO authenticated;

DROP POLICY IF EXISTS rentas_huespedes_fotos_select ON storage.objects;
DROP POLICY IF EXISTS rentas_huespedes_fotos_insert ON storage.objects;
DROP POLICY IF EXISTS rentas_huespedes_fotos_update ON storage.objects;
DROP POLICY IF EXISTS rentas_huespedes_fotos_delete ON storage.objects;

CREATE POLICY rentas_huespedes_fotos_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'rentas-huespedes'
    AND ((SELECT public.is_super_admin())
         OR public.rentas_huesped_foto_permitida(name, 'ver'))
  );

CREATE POLICY rentas_huespedes_fotos_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'rentas-huespedes'
    AND public.rentas_huesped_foto_permitida(name, 'subir')
  );

-- UPDATE — sin policy: una foto no se sustituye.

CREATE POLICY rentas_huespedes_fotos_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'rentas-huespedes'
    AND public.rentas_huesped_foto_permitida(name, 'borrar')
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Guarda: lo que tiene que existir al terminar
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pol text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.rentas_huespedes'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'rentas_huespedes: sin RLS';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rentas_huespedes') <> 4 THEN
    RAISE EXCEPTION 'rentas_huespedes: se esperaban 4 policies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id = 'rentas-huespedes' AND NOT public
                    AND allowed_mime_types = ARRAY['image/jpeg']::text[]) THEN
    RAISE EXCEPTION 'rentas-huespedes: el bucket no existe, es público o acepta otros tipos';
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_pol
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'rentas\_huespedes\_fotos\_%';
  IF v_pol IS DISTINCT FROM ARRAY['rentas_huespedes_fotos_delete', 'rentas_huespedes_fotos_insert', 'rentas_huespedes_fotos_select'] THEN
    RAISE EXCEPTION 'rentas-huespedes: policies de Storage inesperadas: %', v_pol;
  END IF;
END;
$$;
