-- Track T5 · infra:I14 — scope cross-tenant de `conv-attachments` (cierra el READ amplio).
--
-- HALLAZGO: el bucket de adjuntos de conversaciones tenía SELECT abierto a cualquier
-- authenticated (`Authenticated read conv attachments` + `conv_attachments_select`
-- bucket_id-only) → leak de lectura cross-tenant. El INSERT tenía policies "scoped" (Agents/
-- Clients) pero una `conv_attachments_insert` bucket_id-only las anulaba; UPDATE/DELETE broad.
--
-- MODELO (verificado en código + datos):
--   * Path = `${conversation_id}/${ts}_${file}` (useConversations.sendMessage, sube a una
--     conversación EXISTENTE y abierta; los 4 objetos existentes tienen conversation_id UUID).
--   * Lectores/escritores: staff (ComunicacionSection) y residente (CustomerComunicacion),
--     ambos sobre conversaciones que ya pueden ver.
--
-- SCOPE: piggyback en la RLS de `conversations`. `conversations_select` ya codifica quién ve
-- cada conversación (staff por company/asignación/access-rules, residente por cliente_id), así
-- que
--   foldername[1] IN (SELECT id FROM public.conversations)
-- da el scope exacto por-conversación y por-tenant para insert/select/update/delete.
--
-- Consolida las 6 policies previas en 4 (una por comando), todas TO authenticated. Sin
-- migración de datos: los 4 objetos apuntan a conversaciones reales → siguen accesibles para
-- sus miembros; solo se cierra el acceso cross-tenant. Validado con EXPLAIN en prod.
-- IDEMPOTENTE: DROP IF EXISTS + CREATE. REVERSA: recrear las policies bucket_id-only previas.

drop policy if exists "Authenticated read conv attachments" on storage.objects;
drop policy if exists "conv_attachments_select"             on storage.objects;
drop policy if exists "Agents upload conv attachments"      on storage.objects;
drop policy if exists "Clients upload conv attachments"     on storage.objects;
drop policy if exists "conv_attachments_insert"             on storage.objects;
drop policy if exists "conv_attachments_update"             on storage.objects;
drop policy if exists "conv_attachments_delete"             on storage.objects;

create policy "conv_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'conv-attachments'
    and (is_super_admin() or (storage.foldername(name))[1] in (select c.id::text from public.conversations c))
  );

create policy "conv_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'conv-attachments'
    and (is_super_admin() or (storage.foldername(name))[1] in (select c.id::text from public.conversations c))
  );

create policy "conv_attachments_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'conv-attachments'
    and (is_super_admin() or (storage.foldername(name))[1] in (select c.id::text from public.conversations c))
  )
  with check (
    bucket_id = 'conv-attachments'
    and (is_super_admin() or (storage.foldername(name))[1] in (select c.id::text from public.conversations c))
  );

create policy "conv_attachments_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'conv-attachments'
    and (is_super_admin() or (storage.foldername(name))[1] in (select c.id::text from public.conversations c))
  );
