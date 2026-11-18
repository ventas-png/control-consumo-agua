-- ════════════════════════════════════════════════════════════════════════════
-- Manejo de Rentas · el inventario de cada propiedad lleva fotos
-- ════════════════════════════════════════════════════════════════════════════
--
-- POR QUÉ
-- 20261125000000 dejó el inventario en texto («no sube fotos»). Al levantar el
-- inventario de una propiedad lo natural es recorrerla con el teléfono y
-- fotografiar cada artículo: el sofá, la placa con el número de serie de la
-- refrigeradora, el golpe que ya traía la mesa. Sin la foto, el «estaba así»
-- después de una estancia es palabra contra palabra.
--
-- LO QUE HACE
--   1. `rentas_inventario.fotos text[]` (default '{}'): hasta 6 rutas en el
--      bucket privado nuevo. Se guarda la RUTA, no una URL firmada; SecureImage
--      la firma al mostrarla (mismo criterio que el resto de la app).
--      CHECK: a lo sumo 6, y TODAS dentro de la carpeta de la propiedad de la
--      fila (`<company_id>/<propiedad_id>/<archivo>`). Así la fila y el permiso
--      de Storage hablan de la misma propiedad: una fila no puede apuntar a la
--      foto de otra propiedad (o de otra empresa), y un artículo con fotos no
--      se muda de propiedad dejándolas en la carpeta vieja.
--   2. Bucket PRIVADO `rentas-inventario`. NO va en `condominios-media`: ese
--      bucket autoriza por PROYECTO en la primera carpeta, y una propiedad de
--      Rentas puede no tener proyecto (las independientes). Ruta
--      `<company_id>/<propiedad_id>/<archivo>.jpg`.
--   3. `rentas_inventario_foto_permitida(ruta, acción)`: la MISMA regla que la
--      RLS de `rentas_inventario` (empresa propia + servicio contratado +
--      propiedad accesible por proyecto + `rentas.inventario.view`), más la de
--      cada acción:
--        ver     → nada más
--        subir   → `.create` o `.edit` (se sube antes de guardar la fila)
--        borrar  → `.create`, `.edit` o `.delete`, y SÓLO si ninguna fila del
--                  inventario la nombra todavía. Es la regla «una fila guardada
--                  nunca apunta a un archivo borrado» hecha cumplir por la base:
--                  el cliente guarda la fila primero y borra después.
--      Sin policy de UPDATE: una foto no se sustituye (se sube con upsert:false).
--
-- LO QUE **NO** HACE
--   · No toca las policies de `rentas_inventario`: escribir `fotos` ya exige
--     `.create` (INSERT) o `.edit` (UPDATE).
--   · No borra archivos al borrar una PROPIEDAD (el inventario se va en cascada
--     y sus fotos quedan huérfanas en el bucket, sin fila que las nombre: nadie
--     las ve en la app). Borrar un ARTÍCULO sí las retira, desde el cliente.
--   · No limita cuántos objetos hay por carpeta: sube sólo el personal de la
--     empresa con permiso de inventario, y el bucket acota el tamaño.
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS, DROP … IF EXISTS antes de cada
-- CONSTRAINT/POLICY, CREATE OR REPLACE, ON CONFLICT en el bucket.
--
-- REVERSA
--   DROP POLICY IF EXISTS rentas_inventario_fotos_select ON storage.objects;
--   DROP POLICY IF EXISTS rentas_inventario_fotos_insert ON storage.objects;
--   DROP POLICY IF EXISTS rentas_inventario_fotos_delete ON storage.objects;
--   DROP FUNCTION IF EXISTS public.rentas_inventario_foto_permitida(text, text);
--   ALTER TABLE public.rentas_inventario DROP CONSTRAINT IF EXISTS rentas_inventario_fotos_check;
--   DROP FUNCTION IF EXISTS public.rentas_fotos_en_carpeta(text[], uuid, uuid);
--   ALTER TABLE public.rentas_inventario DROP COLUMN IF EXISTS fotos;
--   -- El bucket se vacía desde el dashboard o la API de Storage (no con SQL) y
--   -- después: DELETE FROM storage.buckets WHERE id = 'rentas-inventario';
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- 1. La columna y su coherencia con la propiedad
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.rentas_inventario
  ADD COLUMN IF NOT EXISTS fotos text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.rentas_inventario.fotos IS
  'Hasta 6 rutas en el bucket privado rentas-inventario, todas bajo <company_id>/<propiedad_id>/. Vacío = sin fotos.';

-- Todas las rutas en la carpeta de la propiedad, sin nulos ni subcarpetas.
-- IMMUTABLE y sin tablas: se puede usar en un CHECK. Los uuid sólo llevan
-- dígitos hexadecimales y guiones, así que concatenarlos en la regex es seguro.
CREATE OR REPLACE FUNCTION public.rentas_fotos_en_carpeta(p_fotos text[], p_company uuid, p_propiedad uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(bool_and(
           f IS NOT NULL
           AND f ~ ('^' || p_company::text || '/' || p_propiedad::text || '/[^/]+$')), true)
    FROM unnest(p_fotos) AS f
$$;
COMMENT ON FUNCTION public.rentas_fotos_en_carpeta(text[], uuid, uuid) IS
  'true si cada ruta de p_fotos vive en <p_company>/<p_propiedad>/<archivo> (sin nulos ni subcarpetas). Para el CHECK de rentas_inventario.fotos.';

ALTER TABLE public.rentas_inventario DROP CONSTRAINT IF EXISTS rentas_inventario_fotos_check;
ALTER TABLE public.rentas_inventario ADD CONSTRAINT rentas_inventario_fotos_check
  CHECK (cardinality(fotos) <= 6
         AND public.rentas_fotos_en_carpeta(fotos, company_id, propiedad_id));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. El bucket
-- ────────────────────────────────────────────────────────────────────────────
-- Sólo JPEG: el cliente re-codifica TODA foto a JPEG antes de subirla
-- (lib/imageCompress, lado máximo 1280 px), sea de la cámara o de la galería.
-- 5 MiB sobra para eso y corta cualquier otra cosa.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rentas-inventario', 'rentas-inventario', false, 5242880, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Quién ve, sube y borra
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: mira `rentas_propiedades` y `rentas_inventario` enteras
-- (la de la propiedad y la de «¿alguna fila la nombra?») sin depender de lo que
-- la RLS le deje leer a quien llama. La identidad sigue siendo la del JWT:
-- get_my_company_id / user_has_permission leen auth.uid(), no el rol.
-- Las carpetas se comparan como TEXTO: castear a uuid una ruta fabricada
-- («x/y/z.jpg») reventaría la consulta en vez de negarla.
CREATE OR REPLACE FUNCTION public.rentas_inventario_foto_permitida(p_ruta text, p_accion text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_ruta ~ '^[^/]+/[^/]+/[^/]+$'
     AND (SELECT public.rentas_servicio_activo())
     AND (SELECT COALESCE(public.user_has_permission('rentas.inventario.view'), false))
     AND EXISTS (
       SELECT 1 FROM public.rentas_propiedades p
        WHERE p.company_id::text = split_part(p_ruta, '/', 1)
          AND p.id::text = split_part(p_ruta, '/', 2)
          AND p.company_id = (SELECT public.get_my_company_id())
          AND public.can_access_project(p.project_id))
     AND CASE p_accion
           WHEN 'ver' THEN true
           WHEN 'subir' THEN
             (SELECT COALESCE(public.user_has_permission('rentas.inventario.create'), false))
             OR (SELECT COALESCE(public.user_has_permission('rentas.inventario.edit'), false))
           WHEN 'borrar' THEN
             ((SELECT COALESCE(public.user_has_permission('rentas.inventario.create'), false))
              OR (SELECT COALESCE(public.user_has_permission('rentas.inventario.edit'), false))
              OR (SELECT COALESCE(public.user_has_permission('rentas.inventario.delete'), false)))
             AND NOT EXISTS (
               SELECT 1 FROM public.rentas_inventario i
                WHERE i.company_id::text = split_part(p_ruta, '/', 1)
                  AND i.propiedad_id::text = split_part(p_ruta, '/', 2)
                  AND p_ruta = ANY (i.fotos))
           ELSE false
         END
$$;
COMMENT ON FUNCTION public.rentas_inventario_foto_permitida(text, text) IS
  'Policy del bucket rentas-inventario. p_accion: ver | subir | borrar. Misma regla que la RLS de rentas_inventario; borrar exige además que ninguna fila nombre la foto.';
REVOKE EXECUTE ON FUNCTION public.rentas_inventario_foto_permitida(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rentas_inventario_foto_permitida(text, text) TO authenticated;

DROP POLICY IF EXISTS rentas_inventario_fotos_select ON storage.objects;
DROP POLICY IF EXISTS rentas_inventario_fotos_insert ON storage.objects;
DROP POLICY IF EXISTS rentas_inventario_fotos_update ON storage.objects;
DROP POLICY IF EXISTS rentas_inventario_fotos_delete ON storage.objects;

-- SELECT: como la tabla, la plataforma (super_admin) también lee.
CREATE POLICY rentas_inventario_fotos_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'rentas-inventario'
    AND ((SELECT public.is_super_admin())
         OR public.rentas_inventario_foto_permitida(name, 'ver'))
  );

CREATE POLICY rentas_inventario_fotos_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'rentas-inventario'
    AND public.rentas_inventario_foto_permitida(name, 'subir')
  );

-- UPDATE — sin policy: una foto no se sustituye.

CREATE POLICY rentas_inventario_fotos_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'rentas-inventario'
    AND public.rentas_inventario_foto_permitida(name, 'borrar')
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Guarda: lo que tiene que existir al terminar
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_pol text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'rentas_inventario'
                    AND column_name = 'fotos' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'rentas_inventario.fotos: falta la columna NOT NULL';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.rentas_inventario'::regclass
                    AND conname = 'rentas_inventario_fotos_check') THEN
    RAISE EXCEPTION 'rentas_inventario: falta rentas_inventario_fotos_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id = 'rentas-inventario' AND NOT public
                    AND allowed_mime_types = ARRAY['image/jpeg']::text[]) THEN
    RAISE EXCEPTION 'rentas-inventario: el bucket no existe, es público o acepta otros tipos';
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_pol
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('rentas_inventario_fotos_select', 'rentas_inventario_fotos_insert',
                        'rentas_inventario_fotos_update', 'rentas_inventario_fotos_delete');
  IF v_pol IS DISTINCT FROM ARRAY['rentas_inventario_fotos_delete', 'rentas_inventario_fotos_insert',
                                  'rentas_inventario_fotos_select'] THEN
    RAISE EXCEPTION 'rentas-inventario: se esperaban las policies select/insert/delete (sin update), hay %', v_pol;
  END IF;
END;
$$;
