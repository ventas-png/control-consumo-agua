-- Track T5 · infra:I14 — scope cross-tenant de `mudanza-docs`.
--
-- HALLAZGO: las 4 policies de storage.objects de este bucket solo chequean `bucket_id` para
-- `authenticated` → cualquier usuario logueado puede leer/escribir/borrar los documentos de
-- mudanza (fotos/PII) de OTROS tenants.
--
-- MODELO (verificado en código + datos):
--   * Uploader: portal del residente (PortalMudanzaTab) con path `${unidad_id}/${ts}_${file}`
--     (buildUploadPath(unidadId, …)); los 2 objetos existentes matchean unidades.id (2/2).
--   * Lector: staff que revisa solicitudes (SolicitudesMudanzaTab) vía signed URL.
--
-- SCOPE: piggyback en la RLS de `unidades`. La policy `unidades_select` ya codifica
-- exactamente quién ve cada unidad — residente (`cliente_id = get_my_cliente_id()`) y staff
-- (company_owner/admin/operator/viewer por company/project). Así que
--   foldername[1] IN (SELECT id FROM public.unidades)
-- devuelve solo las unidades visibles para el usuario actual (RLS-filtradas), cubriendo
-- residente Y staff correctamente.
--
-- IMPORTANTE: NO se scopea por `company_id = get_my_company_id()` porque los usuarios `cliente`
-- (residentes) tienen company_id = NULL (get_my_company_id() devuelve NULL para ellos) — eso
-- rompería el upload del portal. El piggyback en unidades RLS es robusto a esto.
--
-- Sin migración de datos: los 2 objetos existentes apuntan a unidades reales → siguen
-- accesibles para el residente dueño y el staff de su company; solo se cierra el acceso
-- cross-tenant. Validado con EXPLAIN en prod. IDEMPOTENTE: DROP IF EXISTS + CREATE.
-- REVERSA: recrear las 4 policies bucket_id-only de 20260516000005.

drop policy if exists "mudanza_docs_select" on storage.objects;
drop policy if exists "mudanza_docs_insert" on storage.objects;
drop policy if exists "mudanza_docs_update" on storage.objects;
drop policy if exists "mudanza_docs_delete" on storage.objects;

create policy "mudanza_docs_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'mudanza-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );

create policy "mudanza_docs_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mudanza-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );

create policy "mudanza_docs_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'mudanza-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  )
  with check (
    bucket_id = 'mudanza-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );

create policy "mudanza_docs_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'mudanza-docs'
    and (is_super_admin() or (storage.foldername(name))[1] in (select u.id::text from public.unidades u))
  );
