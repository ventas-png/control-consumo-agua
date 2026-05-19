-- fix(condominios): agregar FKs faltantes para embeds de PostgREST
--
-- El frontend hace:
--   .from('anuncios_comunidad').select('*, app_users(full_name)')
--   .from('solicitud_mudanza_unidad').select('*, unidades(nombre)')
--
-- PostgREST embebe relaciones siguiendo FKs declarados. Las dos
-- columnas (anuncios_comunidad.publicado_por, solicitud_mudanza_unidad.unidad_id)
-- existían pero sin la FK explícita, por lo que toda query con embed
-- devolvía HTTP 400 ("Could not find a relationship").
--
-- Verificado en producción antes de aplicar: 0 filas huérfanas en
-- ambas tablas, así que las constraints se pueden agregar sin
-- migración previa de datos.

ALTER TABLE public.anuncios_comunidad
  ADD CONSTRAINT anuncios_comunidad_publicado_por_app_users_fkey
  FOREIGN KEY (publicado_por) REFERENCES public.app_users(id)
  ON DELETE SET NULL;

ALTER TABLE public.solicitud_mudanza_unidad
  ADD CONSTRAINT solicitud_mudanza_unidad_unidad_id_fkey
  FOREIGN KEY (unidad_id) REFERENCES public.unidades(id)
  ON DELETE CASCADE;
