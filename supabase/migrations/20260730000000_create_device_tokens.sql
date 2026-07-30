-- device_tokens — Fase 3 (app móvil): tokens de push por dispositivo.
--
-- Cada dispositivo nativo (iOS/Android) registra su token de FCM/APNs al iniciar
-- sesión (ver src/lib/push.ts). La Edge Function send-push los consulta para
-- despachar notificaciones push cuando se crea una notificación in-app.
--
-- RLS: cada usuario solo ve/gestiona sus propios tokens. El backend (send-push)
-- usa la service-role key, que salta RLS para leer los tokens del destinatario.

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_tokens_user_id on public.device_tokens(user_id);

alter table public.device_tokens enable row level security;

-- El usuario autenticado solo alcanza sus propias filas.
create policy device_tokens_select_own on public.device_tokens
  for select using ((select auth.uid()) = user_id);

create policy device_tokens_insert_own on public.device_tokens
  for insert with check ((select auth.uid()) = user_id);

create policy device_tokens_update_own on public.device_tokens
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy device_tokens_delete_own on public.device_tokens
  for delete using ((select auth.uid()) = user_id);
