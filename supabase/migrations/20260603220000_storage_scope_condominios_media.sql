-- Track T5 · infra:I14 — scope cross-tenant de `condominios-media` (último bucket).
--
-- HALLAZGO: las 4 policies de storage.objects de este bucket solo chequean `bucket_id`
-- para `authenticated` (ver 20260516000003) → cualquier usuario logueado puede leer/
-- escribir/borrar media (fotos de amenidades/visitantes/paquetes/novedades, DPIs de
-- huéspedes STR, firmas de entrega…) de OTROS tenants.
--
-- CONVENCIÓN NUEVA DE PATH (en el mismo cambio, lado app): el path pasó de
-- `<categoría>/<ts>-<rand>-<archivo>` (sin id de tenant) a
-- `${project_id}/<categoría>/<ts>-<rand>-<archivo>` → ahora foldername[1] es el project_id,
-- scopeable directo. Los uploaders genéricos (ImageUploader/FileUploader) reciben el
-- project_id activo vía MediaScopeContext.
--
-- ⚠️ ORDEN DE DESPLIEGUE — esta migración va AL FINAL:
--   1) Deploy del código que escribe paths scopeados (lectores ya son agnósticos al shape).
--   2) Migración de los 49 objetos existentes a `${project_id}/...` vía Storage API
--      (scripts/migrate-condominios-media-paths.mjs — copy+delete, NO SQL), validada en
--      Preview y corrida en prod.
--   3) RECIÉN ENTONCES aplicar esta migración. Si se aplica antes, los objetos en path
--      viejo (foldername[1] = categoría, no project_id) dejan de matchear la policy y se
--      vuelven invisibles para todos salvo super_admin → imágenes rotas.
--
-- MODELO (verificado en código + datos productivos):
--   * Lectores/escritores staff: tabs de CondominiosSection (amenidades, visitantes,
--     paquetería, novedades, STR, …), con el project_id seleccionado.
--   * Lectores/escritores residente: portal (PortalVisitantes/Paquetes/Rentas), sobre las
--     unidades de SU cuenta. Los `cliente` tienen company_id = NULL.
--   * Las 7 tablas de origen llevan project_id (huespedes_str lo resuelve por
--     reserva_str_id → reservas_str.project_id).
--
-- SCOPE (estricto para residentes, robusto para staff) — misma expresión en los 4 comandos:
--   * super_admin: todo.
--   * staff (get_my_company_id() NOT NULL): piggyback en `projects` RLS — exactamente los
--     projects que ya puede ver (company_owner/admin por company, operator/viewer por
--     asignación). El guard `company_id NOT NULL` excluye a residentes de esta rama amplia.
--   * residente: ESTRICTAMENTE los projects de SUS unidades activas
--     (cliente_id = get_my_cliente_id()). No accede a media de otros condominios de la
--     misma company. (Granularidad por-unidad no es posible con un path a nivel project,
--     que es la convención uniforme requerida por entidades de proyecto como amenidades.)
--
-- Validar con EXPLAIN en Preview que los 42 paths migrados matchean la policy antes de prod.
-- IDEMPOTENTE: DROP IF EXISTS + CREATE.
-- REVERSA: recrear las 4 policies bucket_id-only de 20260516000003 (cond_media_{select,
--   insert,update,delete} USING/WITH CHECK (bucket_id = 'condominios-media')).

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
      or (storage.foldername(name))[1] in (
        select u.project_id::text from public.unidades u
        where u.cliente_id = get_my_cliente_id() and u.activo = true
      )
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
      or (storage.foldername(name))[1] in (
        select u.project_id::text from public.unidades u
        where u.cliente_id = get_my_cliente_id() and u.activo = true
      )
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
      or (storage.foldername(name))[1] in (
        select u.project_id::text from public.unidades u
        where u.cliente_id = get_my_cliente_id() and u.activo = true
      )
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
      or (storage.foldername(name))[1] in (
        select u.project_id::text from public.unidades u
        where u.cliente_id = get_my_cliente_id() and u.activo = true
      )
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
      or (storage.foldername(name))[1] in (
        select u.project_id::text from public.unidades u
        where u.cliente_id = get_my_cliente_id() and u.activo = true
      )
    )
  );
