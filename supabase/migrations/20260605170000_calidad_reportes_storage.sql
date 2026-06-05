-- serv:S24 — mover archivos de reporte de calidad de base64 en DB a Supabase Storage.
--
-- CONTEXTO: `registros_calidad` almacena reportes (PDF/imagen) como base64 en tres columnas:
--   `reporte_base64`, `reporte_tipo`, `reporte_nombre`.
-- Esto infla la DB, penaliza lecturas de listas y complica la API. Se agrega `reporte_path`
-- para que los nuevos registros apunten al objeto en Storage; las columnas base64 se conservan
-- para compatibilidad con registros históricos (migración de datos fuera de scope aquí).
--
-- BUCKET: `calidad-reportes` (privado, 10 MB, PDF + imágenes comunes).
--
-- PATH FORMAT: `{company_id}/{fuente_id}/{timestamp}-{filename}`
--   foldername(name)[1] = company_id  → scope tenant
--   foldername(name)[2] = fuente_id   → scope fuente (opcional para queries)
--
-- POLÍTICAS (espeja el patrón de company-logos / registro-fotos):
--   INSERT/UPDATE/DELETE → super_admin OR staff de la propia company (foldername[1] = company_id).
--   SELECT             → idem (los reportes de calidad son datos internos de la company).
--
-- IDEMPOTENTE: ADD COLUMN IF NOT EXISTS · INSERT ON CONFLICT DO NOTHING · DROP POLICY IF EXISTS + CREATE.
-- REVERSA: DROP COLUMN reporte_path · DELETE FROM storage.buckets WHERE id='calidad-reportes' ·
--          recrear las policies o eliminarlas si no existían antes.

-- ── 1. Columna en registros_calidad ──────────────────────────────────────────

ALTER TABLE public.registros_calidad
  ADD COLUMN IF NOT EXISTS reporte_path text;

COMMENT ON COLUMN public.registros_calidad.reporte_path IS
  'Ruta del reporte en Supabase Storage (bucket calidad-reportes). '
  'Formato: {company_id}/{fuente_id}/{timestamp}-{filename}. '
  'NULL indica registro antiguo con datos en reporte_base64/reporte_tipo/reporte_nombre.';

-- ── 2. Bucket ─────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'calidad-reportes',
  'calidad-reportes',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── 3. RLS policies en storage.objects ───────────────────────────────────────

drop policy if exists "calidad_reportes_insert" on storage.objects;
drop policy if exists "calidad_reportes_update" on storage.objects;
drop policy if exists "calidad_reportes_delete" on storage.objects;
drop policy if exists "calidad_reportes_select" on storage.objects;

-- INSERT: staff de la propia company ─────────────────────────────────────────
create policy "calidad_reportes_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'calidad-reportes'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] = (get_my_company_id())::text
    )
  );

-- UPDATE: misma lógica en USING y WITH CHECK ──────────────────────────────────
create policy "calidad_reportes_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'calidad-reportes'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  )
  with check (
    bucket_id = 'calidad-reportes'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  );

-- DELETE: misma lógica ─────────────────────────────────────────────────────────
create policy "calidad_reportes_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'calidad-reportes'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  );

-- SELECT: staff de la propia company (reportes son datos internos) ─────────────
create policy "calidad_reportes_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'calidad-reportes'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] = (get_my_company_id())::text
    )
  );
