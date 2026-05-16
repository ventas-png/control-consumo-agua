-- S6 Phase 2: cierra el bucket condominios-media (y mudanza-docs) al público,
-- migra URLs guardadas a paths, y aplica storage policies por authenticated.
--
-- Orden importante:
--  1) Storage policies primero — sin esto, después del flip a privado
--     ninguna lectura funciona (ni siquiera firmada por authenticated).
--  2) Migración de columnas URL → path (idempotente — solo afecta filas que
--     todavía empiezan con http(s)://).
--  3) Flip de bucket público → privado.

-- ── 1) Storage policies para condominios-media ──────────────────────────────

DROP POLICY IF EXISTS "cond_media_select" ON storage.objects;
CREATE POLICY "cond_media_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'condominios-media');

DROP POLICY IF EXISTS "cond_media_insert" ON storage.objects;
CREATE POLICY "cond_media_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'condominios-media');

DROP POLICY IF EXISTS "cond_media_update" ON storage.objects;
CREATE POLICY "cond_media_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'condominios-media')
  WITH CHECK (bucket_id = 'condominios-media');

DROP POLICY IF EXISTS "cond_media_delete" ON storage.objects;
CREATE POLICY "cond_media_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'condominios-media');

-- ── 1b) Storage policies para mudanza-docs (mismo patrón) ───────────────────

DROP POLICY IF EXISTS "mudanza_docs_select" ON storage.objects;
CREATE POLICY "mudanza_docs_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'mudanza-docs');

DROP POLICY IF EXISTS "mudanza_docs_insert" ON storage.objects;
CREATE POLICY "mudanza_docs_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mudanza-docs');

DROP POLICY IF EXISTS "mudanza_docs_update" ON storage.objects;
CREATE POLICY "mudanza_docs_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'mudanza-docs')
  WITH CHECK (bucket_id = 'mudanza-docs');

DROP POLICY IF EXISTS "mudanza_docs_delete" ON storage.objects;
CREATE POLICY "mudanza_docs_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'mudanza-docs');

-- ── 2) Migración de URLs guardadas → paths ─────────────────────────────────
-- Strip del prefijo: https?://<host>/storage/v1/object/(public|sign)/<bucket>/
-- Para signed URL históricos también se descarta el query string (?token=).
-- Idempotente — solo afecta filas que todavía contienen URLs.

UPDATE amenidades SET foto_url = regexp_replace(regexp_replace(foto_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE anuncios_comunidad SET foto_url = regexp_replace(regexp_replace(foto_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE huespedes_str SET foto_url = regexp_replace(regexp_replace(foto_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE huespedes_str SET foto_documento_url = regexp_replace(regexp_replace(foto_documento_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_documento_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE novedades_seguridad SET foto_url = regexp_replace(regexp_replace(foto_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE reservas_str SET foto_url = regexp_replace(regexp_replace(foto_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE reservas_str SET foto_documento_url = regexp_replace(regexp_replace(foto_documento_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_documento_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE visitantes SET foto_url = regexp_replace(regexp_replace(foto_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE visitantes SET foto_documento_url = regexp_replace(regexp_replace(foto_documento_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_documento_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

UPDATE visitantes SET foto_vehiculo_url = regexp_replace(regexp_replace(foto_vehiculo_url, '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
  WHERE foto_vehiculo_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/';

-- ARRAY columns

UPDATE novedades_seguridad SET fotos = ARRAY(
  SELECT regexp_replace(regexp_replace(unnest(fotos), '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/', ''), '\?.*$', '')
) WHERE EXISTS (SELECT 1 FROM unnest(fotos) AS f WHERE f ~ '^https?://[^/]+/storage/v1/object/(public|sign)/condominios-media/');

UPDATE solicitud_mudanza_unidad SET imagenes = ARRAY(
  SELECT regexp_replace(regexp_replace(unnest(imagenes), '^https?://[^/]+/storage/v1/object/(public|sign)/mudanza-docs/', ''), '\?.*$', '')
) WHERE EXISTS (SELECT 1 FROM unnest(imagenes) AS f WHERE f ~ '^https?://[^/]+/storage/v1/object/(public|sign)/mudanza-docs/');

-- ── 3) Flip de buckets a privado ───────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id IN ('condominios-media', 'mudanza-docs');
