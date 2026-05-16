-- S6 follow-up phase B: cierra los buckets de logos
--   * company-logos
--   * project-logos
--
-- Los logos no aparecen embebidos en PDFs generados (verificado con
-- grep addImage en lib/pdf.ts y exportUtils.ts). Solo se muestran como
-- <img> en EmpresaSection, lo cual permite migración limpia a signed URLs.
--
-- Mismo patrón que phases anteriores (#80, #83).

-- ── 1) Storage policies ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "company_logos_select" ON storage.objects;
CREATE POLICY "company_logos_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "company_logos_insert" ON storage.objects;
CREATE POLICY "company_logos_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "company_logos_update" ON storage.objects;
CREATE POLICY "company_logos_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'company-logos')
  WITH CHECK (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "company_logos_delete" ON storage.objects;
CREATE POLICY "company_logos_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "project_logos_select" ON storage.objects;
CREATE POLICY "project_logos_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-logos');

DROP POLICY IF EXISTS "project_logos_insert" ON storage.objects;
CREATE POLICY "project_logos_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-logos');

DROP POLICY IF EXISTS "project_logos_update" ON storage.objects;
CREATE POLICY "project_logos_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-logos')
  WITH CHECK (bucket_id = 'project-logos');

DROP POLICY IF EXISTS "project_logos_delete" ON storage.objects;
CREATE POLICY "project_logos_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-logos');

-- ── 2) Migración URL → path en columnas logo_url ───────────────────────────
-- Strip de prefijo https://<host>/storage/v1/object/(public|sign)/<bucket>/ + query.
-- Idempotente.

UPDATE companies SET logo_url = regexp_replace(regexp_replace(logo_url, '^https?://[^/]+/storage/v1/object/(public|sign)/company-logos/', ''), '\?.*$', '')
  WHERE logo_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/company-logos/';

UPDATE projects SET logo_url = regexp_replace(regexp_replace(logo_url, '^https?://[^/]+/storage/v1/object/(public|sign)/project-logos/', ''), '\?.*$', '')
  WHERE logo_url ~ '^https?://[^/]+/storage/v1/object/(public|sign)/project-logos/';

-- ── 3) Flip de buckets a privado ──────────────────────────────────────────
UPDATE storage.buckets
SET public = false
WHERE id IN ('company-logos', 'project-logos');
