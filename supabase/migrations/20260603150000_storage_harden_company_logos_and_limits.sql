-- Track T5 · infra:I14 (fase 1) — endurecer storage. Solo wins verificados-seguros.
--
-- CONTEXTO (hallazgo)
-- Varias policies de storage.objects chequean solo `bucket_id` para el rol `authenticated`,
-- sin scoping por company/path → leak cross-tenant: un usuario logueado puede listar/leer/
-- escribir/borrar archivos de otros tenants. El fix completo de los buckets sensibles
-- (pagos-comprobantes, registro-fotos, condominios-media, mudanza-docs, project-logos)
-- requiere cambiar convención de paths y/o policies con join a dominio + migrar objetos →
-- va por fases (ver supabase/SECURITY_ADVISORS.md + issue de tracking).
--
-- Esta migración (fase 1) hace solo lo verificado-seguro:
--   1) company-logos: scopea WRITE (insert/update/delete) por company. Verificado: el path
--      de subida es `${company_id}/...` — EmpresaSection carga `empresa` de `companies` por
--      `app_users.company_id`, así que empresa.id === get_my_company_id(); el objeto
--      existente matchea (1/1). READ se deja amplio a propósito (un logo no es sensible).
--   2) file_size_limit en los 2 buckets sin tope. Solo cap de tamaño — no toca tipos ni
--      acceso, así que no rompe uploads válidos. (El allow-list de MIME se difiere: mimeFor()
--      emite `text/csv;charset=utf-8` y los browsers reportan MIME variable → hay que
--      normalizar content-types primero.)
--
-- REVERSA: recrear las policies amplias (bucket_id-only) de 20260516000006 y
--   `UPDATE storage.buckets SET file_size_limit = NULL WHERE id IN ('conv-attachments','report-attachments');`
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE; UPDATE determinista.

-- ── 1) company-logos: WRITE scopeado por company (READ se mantiene amplio) ────────────
-- Quita las policies de escritura amplias (bucket_id-only de 20260516000006) y las
-- duplicadas legacy sin is_super_admin, y las reemplaza por versiones scopeadas.
drop policy if exists "company_logos_insert"     on storage.objects;
drop policy if exists "company_logos_update"     on storage.objects;
drop policy if exists "company_logos_delete"     on storage.objects;
drop policy if exists "company owner upload logo" on storage.objects;
drop policy if exists "company owner update logo" on storage.objects;

create policy "company_logos_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  );

create policy "company_logos_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-logos'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  )
  with check (
    bucket_id = 'company-logos'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  );

create policy "company_logos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and (is_super_admin() or (storage.foldername(name))[1] = (get_my_company_id())::text)
  );

-- ── 2) Caps de tamaño en los buckets sin tope (conv-attachments, report-attachments) ──
update storage.buckets set file_size_limit = 10485760  where id = 'conv-attachments';   -- 10 MiB
update storage.buckets set file_size_limit = 26214400  where id = 'report-attachments'; -- 25 MiB
