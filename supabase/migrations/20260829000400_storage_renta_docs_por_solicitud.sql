-- `renta-docs`: las policies pasan a verificar la SOLICITUD, no solo la unidad.
--
-- HALLAZGO. 20260828000100 hizo piggyback en la RLS de `unidades`
--   foldername[1] IN (SELECT id FROM public.unidades)
-- para los CUATRO comandos. `unidades` la ven propietario, INQUILINO y staff del
-- proyecto, así que con esas policies:
--   • el inquilino de la unidad podía BORRAR o pisar los adjuntos que subió el
--     propietario (su DPI, el contrato firmado…);
--   • cualquier staff con acceso al proyecto podía escribir en el expediente;
--   • nada congelaba los archivos: tras aprobar o rechazar seguían siendo
--     modificables, y el expediente de la administración perdía valor probatorio.
--
-- ARREGLO. El path pasa de {unidad_id}/{archivo} a
--   {unidad_id}/{solicitud_id}/{archivo}
-- y la escritura exige DOS cosas: que quien sube sea PROPIETARIO de la unidad
-- (mis_unidades_propietario_ids(), no la visibilidad general de `unidades`), y
-- que la solicitud de esa carpeta siga en 'borrador'. Al enviarse la solicitud
-- los archivos quedan inmutables — que cubre de sobra "inmutables al aprobar o
-- rechazar", porque ya lo son desde antes.
--
-- LECTURA: propietario de la unidad y staff de SU empresa con el permiso del
-- tab. El inquilino no lee: son documentos del expediente entre propietario y
-- administración, con PII de terceros.
--
-- El bucket no cambia (privado, 10 MiB, allowlist de MIME de 20260828000100).
-- IDEMPOTENTE: DROP POLICY IF EXISTS + CREATE.

drop policy if exists "renta_docs_select" on storage.objects;
drop policy if exists "renta_docs_insert" on storage.objects;
drop policy if exists "renta_docs_update" on storage.objects;
drop policy if exists "renta_docs_delete" on storage.objects;

-- ── Lectura: propietario + staff con el permiso del tab ──────────────────────
create policy "renta_docs_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'renta-docs'
    and (
      is_super_admin()
      or (storage.foldername(name))[1] in (select x::text from public.mis_unidades_propietario_ids() x)
      or exists (
        select 1 from public.unidades u
        where u.id::text    = (storage.foldername(name))[1]
          and u.company_id  = public.get_my_company_id()
          and public.user_has_permission('condominios.tab.solicitudes_renta')
      )
    )
  );

-- ── Escritura: solo el propietario y solo mientras el borrador vive ──────────
-- Misma expresión en insert/update/delete: quién (propietario de la unidad) y
-- cuándo (la solicitud de la carpeta todavía es borrador).
create policy "renta_docs_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'renta-docs'
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] in (select x::text from public.mis_unidades_propietario_ids() x)
        and exists (
          select 1 from public.solicitud_renta_unidad s
          where s.id::text        = (storage.foldername(name))[2]
            and s.unidad_id::text = (storage.foldername(name))[1]
            and s.estado          = 'borrador'
        )
      )
    )
  );

create policy "renta_docs_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'renta-docs'
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] in (select x::text from public.mis_unidades_propietario_ids() x)
        and exists (
          select 1 from public.solicitud_renta_unidad s
          where s.id::text        = (storage.foldername(name))[2]
            and s.unidad_id::text = (storage.foldername(name))[1]
            and s.estado          = 'borrador'
        )
      )
    )
  )
  with check (
    bucket_id = 'renta-docs'
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] in (select x::text from public.mis_unidades_propietario_ids() x)
        and exists (
          select 1 from public.solicitud_renta_unidad s
          where s.id::text        = (storage.foldername(name))[2]
            and s.unidad_id::text = (storage.foldername(name))[1]
            and s.estado          = 'borrador'
        )
      )
    )
  );

create policy "renta_docs_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'renta-docs'
    and (
      is_super_admin()
      or (
        (storage.foldername(name))[1] in (select x::text from public.mis_unidades_propietario_ids() x)
        and exists (
          select 1 from public.solicitud_renta_unidad s
          where s.id::text        = (storage.foldername(name))[2]
            and s.unidad_id::text = (storage.foldername(name))[1]
            and s.estado          = 'borrador'
        )
      )
    )
  );
