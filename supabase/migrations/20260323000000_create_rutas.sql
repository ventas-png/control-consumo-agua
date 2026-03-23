-- Tabla de rutas de lectura planificadas
create table if not exists rutas (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  descripcion       text,
  cliente_ids       jsonb not null default '[]',   -- array ordenado de UUIDs de clientes
  asignado_a        uuid references auth.users(id), -- operador asignado
  asignado_nombre   text,
  asignado_email    text,
  asignado_telefono text,                           -- para notificación WhatsApp
  fecha_programada  date,                           -- fecha en que debe ejecutarse
  completada        boolean not null default false,
  created_at        timestamptz not null default now()
);

-- RLS: mismas políticas que el resto de tablas de la app
alter table rutas enable row level security;

-- Permitir acceso a usuarios autenticados (la app gestiona roles en capa de aplicación)
drop policy if exists "rutas_select" on rutas;
drop policy if exists "rutas_insert" on rutas;
drop policy if exists "rutas_update" on rutas;
drop policy if exists "rutas_delete" on rutas;

create policy "rutas_select" on rutas for select using (auth.role() = 'authenticated');
create policy "rutas_insert" on rutas for insert with check (auth.role() = 'authenticated');
create policy "rutas_update" on rutas for update using (auth.role() = 'authenticated');
create policy "rutas_delete" on rutas for delete using (auth.role() = 'authenticated');
