-- Bucket `renta-docs` — documentos de la solicitud de autorización de renta.
--
-- El propietario anexa el respaldo que la administración necesita para evaluar
-- y archivar (DPI del arrendatario, contrato firmado, carta de responsabilidad…).
-- Se crea un bucket dedicado en vez de reusar `condominios-media`: son
-- documentos legales/PII de un expediente, y separarlos deja el borrado y la
-- retención acotados a esta feature.
--
-- MODELO (calcado de `mudanza-docs`, 20260603180000):
--   • Uploader: portal del residente (PortalRentasTab → SolicitudForm) con path
--     `${unidad_id}/${ts}-${rand}-${file}` (buildUploadPath(unidadId, …)).
--   • Lector: staff que evalúa la solicitud (SolicitudesRentaTab) vía signed URL.
--
-- SCOPE: piggyback en la RLS de `unidades`. `unidades_select` (última definición
-- en 20260822020000) ya codifica quién ve cada unidad — propietario, inquilino y
-- staff del proyecto — así que
--   foldername[1] IN (SELECT id FROM public.unidades)
-- devuelve solo las unidades visibles para el usuario actual.
--
-- IMPORTANTE: NO se scopea por `company_id = get_my_company_id()`; los usuarios
-- `cliente` tienen company_id = NULL y eso rompería el upload del portal.
--
-- IDEMPOTENTE: INSERT … ON CONFLICT + DROP IF EXISTS/CREATE de las policies.

-- ── Bucket privado con límites en SQL ────────────────────────────────────────
-- 10 MiB espeja BUCKET_POLICIES de functions/_shared/uploadValidation.ts; la
-- allowlist de MIME espeja lo que acepta el uploader del portal (imágenes, PDF y
-- ofimática, ya refinados por resolveUploadContentType en el cliente).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'renta-docs',
  'renta-docs',
  false,
  10485760,  -- 10 MiB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- docx
    'application/msword',                                                      -- doc
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       -- xlsx
    'application/vnd.ms-excel'                                                 -- xls
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public          = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;
      -- allowed_mime_types NO se actualiza: mismo criterio que 20260729000400
      -- (no pisar una allowlist ya afinada en prod).

-- ── Policies: misma expresión en los 4 comandos ──────────────────────────────
drop policy if exists "renta_docs_select" on storage.objects;
drop policy if exists "renta_docs_insert" on storage.objects;
drop policy if exists "renta_docs_update" on storage.objects;
drop policy if exists "renta_docs_delete" on storage.objects;

create policy "renta_docs_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'renta-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );

create policy "renta_docs_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'renta-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );

create policy "renta_docs_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'renta-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  )
  with check (
    bucket_id = 'renta-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );

create policy "renta_docs_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'renta-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );
