-- Portal propietario vs inquilino — STORAGE y unidades_select al modelo dual.
--
-- Segunda capa del mismo hallazgo de 20260822010000: tras habilitar las
-- escrituras de tablas, el QA del inquilino mostró que las SUBIDAS de archivos
-- siguen bloqueadas ("new row violates row-level security policy" bajo los
-- uploaders de fotos en tickets/visitantes/paquetes, y el guardado de mudanzas
-- con adjuntos):
--
--   • Las 4 policies de `condominios-media` (20260603220000) scopean la rama
--     residente con `unidades.cliente_id = get_my_cliente_id()` — el inquilino
--     de `unidad_residentes` no matchea y no puede subir/ver media de SU
--     proyecto. Se repunta a `mis_proyectos_ids()` (fase 3, dual): para el
--     propietario legacy es el MISMO set por definición.
--
--   • `unidades_select` (última definición en 20260815000000) conserva la rama
--     residente legacy `cliente_id = get_my_cliente_id()`. Además de negar la
--     fila de la unidad al inquilino, rompe los piggybacks sobre la RLS de
--     `unidades`: el bucket `mudanza-docs` (20260603180000) autoriza por
--     `foldername[1] IN (SELECT id FROM unidades)` — de ahí el error al guardar
--     mudanzas con fotos. Se repunta la rama a `mis_unidades_ids()`; el bucket
--     de mudanzas queda cubierto sin tocar sus policies. Las ramas de staff
--     (incluido el gate can_access_project de 20260815000000) quedan idénticas.
--
-- Igual que en las fases 2/3: solo cambia la rama residente, y para el
-- propietario legacy la conducta es exactamente la actual (los helpers lo
-- incluyen por unidades.cliente_id).

-- ── unidades_select: rama residente al helper dual ───────────────────────────
-- Cuerpo idéntico a 20260815000000 salvo la última rama (el helper ya filtra
-- unidades.activo = true).
DROP POLICY IF EXISTS "unidades_select" ON public.unidades;
CREATE POLICY "unidades_select" ON public.unidades
  FOR SELECT TO authenticated
  USING (
    has_super_admin_access()
    OR (
      (
        has_company_owner_company_access(company_id)
        OR has_admin_project_access(project_id)
        OR has_operator_project_access(project_id)
        OR has_viewer_project_access(project_id)
        OR (company_id = (SELECT get_my_company_id())
            AND (SELECT public.user_has_permission('platform.unidades.view')))
      )
      AND public.can_access_project(project_id)
    )
    OR (current_user_role() = 'cliente' AND id IN (SELECT public.mis_unidades_ids()))
  );

-- ── condominios-media: rama residente a mis_proyectos_ids() ──────────────────
-- Misma expresión en los 4 comandos (como en 20260603220000); solo cambia el
-- subquery de la rama residente.
drop policy if exists "cond_media_select" on storage.objects;
drop policy if exists "cond_media_insert" on storage.objects;
drop policy if exists "cond_media_update" on storage.objects;
drop policy if exists "cond_media_delete" on storage.objects;

create policy "cond_media_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'condominios-media'
    and (
      is_super_admin()
      or (
        get_my_company_id() is not null
        and (storage.foldername(name))[1] in (select p.id::text from public.projects p)
      )
      or (storage.foldername(name))[1] in (select x::text from public.mis_proyectos_ids() x)
    )
  );

create policy "cond_media_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'condominios-media'
    and (
      is_super_admin()
      or (
        get_my_company_id() is not null
        and (storage.foldername(name))[1] in (select p.id::text from public.projects p)
      )
      or (storage.foldername(name))[1] in (select x::text from public.mis_proyectos_ids() x)
    )
  );

create policy "cond_media_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'condominios-media'
    and (
      is_super_admin()
      or (
        get_my_company_id() is not null
        and (storage.foldername(name))[1] in (select p.id::text from public.projects p)
      )
      or (storage.foldername(name))[1] in (select x::text from public.mis_proyectos_ids() x)
    )
  )
  with check (
    bucket_id = 'condominios-media'
    and (
      is_super_admin()
      or (
        get_my_company_id() is not null
        and (storage.foldername(name))[1] in (select p.id::text from public.projects p)
      )
      or (storage.foldername(name))[1] in (select x::text from public.mis_proyectos_ids() x)
    )
  );

create policy "cond_media_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'condominios-media'
    and (
      is_super_admin()
      or (
        get_my_company_id() is not null
        and (storage.foldername(name))[1] in (select p.id::text from public.projects p)
      )
      or (storage.foldername(name))[1] in (select x::text from public.mis_proyectos_ids() x)
    )
  );
