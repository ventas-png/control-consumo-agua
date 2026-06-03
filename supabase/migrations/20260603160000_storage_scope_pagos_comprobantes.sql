-- Track T5 · infra:I14 (fase 2) — scope cross-tenant de `pagos-comprobantes` (PII financiera).
--
-- HALLAZGO: las 4 policies de storage.objects de este bucket solo chequean `bucket_id`
-- para el rol `authenticated` → cualquier usuario logueado puede leer/escribir/borrar
-- comprobantes de pago (recibos bancarios) de OTROS tenants.
--
-- MODELO (verificado en código + datos):
--   * Único uploader: portal del residente (PagoManualModal) con path
--     `comprobantes/${auth.uid()}/${ts}` — currentUser.user_id === auth.uid(), y todo
--     usuario (incl. residente) tiene fila en app_users (useAuth.ts).
--   * Lector: gestor de cobros (CobrosSection) que verifica comprobantes de su company.
--   * pagos.comprobante_url guarda el path bare (== storage.objects.name).
--   * pagos NO tiene project_id confiable en inserts del portal (el modal mete
--     project_id=null y no hay trigger de backfill). Por eso el mapeo comprobante→company
--     usa la cadena robusta pagos.registro_id → registros.project_id → projects.company_id.
--     [El project_id=null del portal es un issue de visibilidad de `pagos` aparte → #335.]
--
-- POLÍTICA:
--   INSERT/UPDATE/DELETE → solo el dueño de la carpeta (foldername[2] = auth.uid()) o
--     super_admin. No hay flujo de staff que escriba/borre el OBJETO (la verificación
--     actualiza la fila `pagos`, no el archivo) → owner-scoping no rompe nada.
--   SELECT → dueño (el residente lee el suyo) OR super_admin OR staff de la company dueña
--     del registro (misma lógica de roles que pagos_select, vía registros.project_id).
--
-- Sin migración de datos: 0 objetos / 0 pagos hoy. IDEMPOTENTE: DROP IF EXISTS + CREATE.
-- REVERSA: recrear las 4 policies bucket_id-only de 20260516000005.

drop policy if exists "pagos_comprobantes_insert" on storage.objects;
drop policy if exists "pagos_comprobantes_update" on storage.objects;
drop policy if exists "pagos_comprobantes_delete" on storage.objects;
drop policy if exists "pagos_comprobantes_select" on storage.objects;

-- ── WRITE: solo carpeta propia ───────────────────────────────────────────────
create policy "pagos_comprobantes_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pagos-comprobantes'
    and (is_super_admin() or (storage.foldername(name))[2] = (auth.uid())::text)
  );

create policy "pagos_comprobantes_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'pagos-comprobantes'
    and (is_super_admin() or (storage.foldername(name))[2] = (auth.uid())::text)
  )
  with check (
    bucket_id = 'pagos-comprobantes'
    and (is_super_admin() or (storage.foldername(name))[2] = (auth.uid())::text)
  );

create policy "pagos_comprobantes_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pagos-comprobantes'
    and (is_super_admin() or (storage.foldername(name))[2] = (auth.uid())::text)
  );

-- ── READ: dueño OR staff de la company dueña del registro (espeja pagos_select) ──
create policy "pagos_comprobantes_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pagos-comprobantes'
    and (
      is_super_admin()
      or (storage.foldername(name))[2] = (auth.uid())::text
      or exists (
        select 1
        from public.pagos p
        join public.registros r on r.id = p.registro_id
        where p.comprobante_url = storage.objects.name
          and (
            ( current_user_role() = any (array['company_owner', 'admin'])
              and r.project_id in (select id from public.projects where company_id = get_my_company_id()) )
            or exists (
              select 1 from public.user_project_assignments upa
              where upa.user_id = (select auth.uid()) and upa.project_id = r.project_id
            )
          )
      )
    )
  );
