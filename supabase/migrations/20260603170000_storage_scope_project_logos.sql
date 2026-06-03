-- Track T5 · infra:I14 — scope cross-tenant de `project-logos` (sigue el patrón de company-logos).
--
-- HALLAZGO: las policies de escritura de project-logos solo chequean `bucket_id` para el rol
-- `authenticated` → cualquier usuario logueado puede sobrescribir/borrar (o plantar) el logo
-- de un proyecto de OTRO tenant.
--
-- A diferencia de company-logos (path = ${company_id}/…), acá el path es ${project_id}/…, así
-- que el scope a company se hace con un join a `projects`:
--   foldername[1] ∈ (projects de get_my_company_id()).
--
-- VERIFICADO SEGURO: el único uploader (EmpresaSection.subirLogoProyecto) sube a
-- `${proyectoId}/logo-…` donde proyectoId es un projects.id de SU company (EmpresaSection
-- carga los projects filtrando por company_id), así que siempre matchea el scope. Hay 0
-- objetos hoy → sin breakage de archivos existentes. Cuerpo de la policy validado con EXPLAIN
-- en prod.
--
-- READ se deja amplio a propósito (un logo no es sensible; se muestra vía SecureImage). Las
-- policies de SELECT (`logos_authenticated_select`, `project_logos_select`) se mantienen.
--
-- IDEMPOTENTE: DROP IF EXISTS + CREATE. REVERSA: recrear las policies bucket_id-only de
-- 20260516000006.

-- Quita las policies de escritura amplias (broad de 20260516000006 + legacy duplicadas).
drop policy if exists "project_logos_insert"             on storage.objects;
drop policy if exists "project_logos_update"             on storage.objects;
drop policy if exists "project_logos_delete"             on storage.objects;
drop policy if exists "authenticated upload project logo" on storage.objects;
drop policy if exists "authenticated update project logo" on storage.objects;

create policy "project_logos_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-logos'
    and ( is_super_admin()
          or (storage.foldername(name))[1] in (select pr.id::text from public.projects pr where pr.company_id = get_my_company_id()) )
  );

create policy "project_logos_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'project-logos'
    and ( is_super_admin()
          or (storage.foldername(name))[1] in (select pr.id::text from public.projects pr where pr.company_id = get_my_company_id()) )
  )
  with check (
    bucket_id = 'project-logos'
    and ( is_super_admin()
          or (storage.foldername(name))[1] in (select pr.id::text from public.projects pr where pr.company_id = get_my_company_id()) )
  );

create policy "project_logos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-logos'
    and ( is_super_admin()
          or (storage.foldername(name))[1] in (select pr.id::text from public.projects pr where pr.company_id = get_my_company_id()) )
  );
