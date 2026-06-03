-- Track T5 · infra:I14 — scope cross-tenant de `registro-fotos` (fotos de lecturas).
--
-- HALLAZGO: las 4 policies de storage.objects solo chequeaban `bucket_id` para
-- `authenticated` → cualquier usuario logueado lee/escribe/borra fotos de lecturas de OTROS
-- tenants.
--
-- NORMALIZACIÓN DE PATH (en el mismo PR, AdminNewReading): el path pasó de
-- `registros/${cliente_id}_${ts}` (id embebido con `_`, no scopeable sin parsing frágil) a
-- `${cliente_id}/${ts}` → ahora foldername[1] es el cliente_id, scopeable directo. Había
-- **0 objetos** en el bucket, así que NO hay migración de objetos existentes.
--
-- MODELO (verificado en código + datos):
--   * Uploader: staff (AdminNewReading), sube ANTES de crear el registro → el scope de INSERT
--     no puede depender de `registros`; se usa el cliente del path.
--   * Lectores: staff (dashboard) y residente (CustomerPortal, su propia lectura).
--   * cliente → company vía `company_clientes` (mismo mapeo que usa registros_select);
--     residente → su cliente vía `get_my_cliente_id()` (los `cliente` tienen company_id NULL).
--
-- POLÍTICA:
--   SELECT → super_admin OR carpeta-propia del residente (foldername[1] = get_my_cliente_id())
--            OR staff de la company del cliente (foldername[1] ∈ company_clientes de mi company).
--   INSERT/UPDATE/DELETE → super_admin OR staff de la company del cliente (solo escribe staff).
--
-- Validado con EXPLAIN en prod. IDEMPOTENTE: DROP IF EXISTS + CREATE.
-- REVERSA: recrear las 4 policies bucket_id-only de 20260516000005.

drop policy if exists "registro_fotos_select" on storage.objects;
drop policy if exists "registro_fotos_insert" on storage.objects;
drop policy if exists "registro_fotos_update" on storage.objects;
drop policy if exists "registro_fotos_delete" on storage.objects;

-- READ: residente (su carpeta) o staff de la company del cliente ─────────────
create policy "registro_fotos_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'registro-fotos'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] = (get_my_cliente_id())::text
      or (storage.foldername(name))[1] in (select cc.cliente_id::text from public.company_clientes cc where cc.company_id = get_my_company_id())
    )
  );

-- WRITE: solo staff de la company del cliente ────────────────────────────────
create policy "registro_fotos_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'registro-fotos'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] in (select cc.cliente_id::text from public.company_clientes cc where cc.company_id = get_my_company_id())
    )
  );

create policy "registro_fotos_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'registro-fotos'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] in (select cc.cliente_id::text from public.company_clientes cc where cc.company_id = get_my_company_id())
    )
  )
  with check (
    bucket_id = 'registro-fotos'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] in (select cc.cliente_id::text from public.company_clientes cc where cc.company_id = get_my_company_id())
    )
  );

create policy "registro_fotos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'registro-fotos'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] in (select cc.cliente_id::text from public.company_clientes cc where cc.company_id = get_my_company_id())
    )
  );
