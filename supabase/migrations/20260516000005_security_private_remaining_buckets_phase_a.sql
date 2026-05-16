-- S6 follow-up phase A: cierra los buckets de alta sensibilidad
--   * registro-fotos      (fotos de medidores con potencial metadata GPS)
--   * pagos-comprobantes  (recibos bancarios, montos, datos del cliente)
--   * conv-attachments    (adjuntos del chat — datos arbitrarios)
--
-- Mismo patrón que S6 phase 2 (#80) para condominios-media / mudanza-docs:
-- 1) Crea los buckets faltantes (registro-fotos y pagos-comprobantes nunca
--    existieron en storage.buckets; los uploads desde el cliente fallaban en
--    silencio porque .upload contra un bucket inexistente devuelve error
--    y el catch lo silenciaba). Los crea privados desde el inicio.
-- 2) Storage policies por bucket (SELECT/INSERT/UPDATE/DELETE para authenticated)
-- 3) Migración de URLs guardadas → paths bare
-- 4) Flip de bucket existente (conv-attachments) public → private
--
-- Los display sites ya usan SecureImage/useSignedUrl en este PR.

-- ── 1) Crear buckets faltantes ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('registro-fotos', 'registro-fotos', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp']::text[]),
  ('pagos-comprobantes', 'pagos-comprobantes', false, 10485760,
   ARRAY['image/jpeg','image/png','image/webp','application/pdf']::text[])
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── 2) Storage policies ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "registro_fotos_select" ON storage.objects;
CREATE POLICY "registro_fotos_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'registro-fotos');

DROP POLICY IF EXISTS "registro_fotos_insert" ON storage.objects;
CREATE POLICY "registro_fotos_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'registro-fotos');

DROP POLICY IF EXISTS "registro_fotos_update" ON storage.objects;
CREATE POLICY "registro_fotos_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'registro-fotos')
  WITH CHECK (bucket_id = 'registro-fotos');

DROP POLICY IF EXISTS "registro_fotos_delete" ON storage.objects;
CREATE POLICY "registro_fotos_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'registro-fotos');

DROP POLICY IF EXISTS "pagos_comprobantes_select" ON storage.objects;
CREATE POLICY "pagos_comprobantes_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pagos-comprobantes');

DROP POLICY IF EXISTS "pagos_comprobantes_insert" ON storage.objects;
CREATE POLICY "pagos_comprobantes_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pagos-comprobantes');

DROP POLICY IF EXISTS "pagos_comprobantes_update" ON storage.objects;
CREATE POLICY "pagos_comprobantes_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pagos-comprobantes')
  WITH CHECK (bucket_id = 'pagos-comprobantes');

DROP POLICY IF EXISTS "pagos_comprobantes_delete" ON storage.objects;
CREATE POLICY "pagos_comprobantes_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pagos-comprobantes');

DROP POLICY IF EXISTS "conv_attachments_select" ON storage.objects;
CREATE POLICY "conv_attachments_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'conv-attachments');

DROP POLICY IF EXISTS "conv_attachments_insert" ON storage.objects;
CREATE POLICY "conv_attachments_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'conv-attachments');

DROP POLICY IF EXISTS "conv_attachments_update" ON storage.objects;
CREATE POLICY "conv_attachments_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'conv-attachments')
  WITH CHECK (bucket_id = 'conv-attachments');

DROP POLICY IF EXISTS "conv_attachments_delete" ON storage.objects;
CREATE POLICY "conv_attachments_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'conv-attachments');

-- ── 3) Migración URL → path ────────────────────────────────────────────────
-- Strip de prefijo https://<host>/storage/v1/object/(public|sign)/<bucket>/ + query.
-- Idempotente.

UPDATE registros SET foto = regexp_replace(regexp_replace(foto, '^https?://[^/]+/storage/v1/object/(public|sign)/registro-fotos/', ''), '\?.*$', '')
  WHERE foto ~ '^https?://[^/]+/storage/v1/object/(public|sign)/registro-fotos/';

UPDATE pagos SET comprobante_url = regexp_replace(regexp_replace(comprobante_url, '^https?://[^/]+/storage/v1/object/(public|sign)/pagos-comprobantes/', ''), '\?.*$', '')
  WHERE comprobante_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/pagos-comprobantes/';

UPDATE conversation_messages SET attachment_url = regexp_replace(regexp_replace(attachment_url, '^https?://[^/]+/storage/v1/object/(public|sign)/conv-attachments/', ''), '\?.*$', '')
  WHERE attachment_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/conv-attachments/';

-- ── 4) Asegurar buckets en privado (conv-attachments era public) ───────────
UPDATE storage.buckets
SET public = false
WHERE id IN ('registro-fotos', 'pagos-comprobantes', 'conv-attachments');
