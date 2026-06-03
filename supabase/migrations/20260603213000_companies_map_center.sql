-- serv:S16 — Centro/zoom del mapa por tenant.
-- Cada empresa puede fijar el centro y zoom por defecto de su mapa de medidores,
-- en vez del hard-coded de Ciudad de Guatemala. La escritura ya está cubierta por
-- la policy "companies_update" (super_admin / company_owner); null = default app.
-- Timestamp 213000 (no la hora redonda 220000) para esquivar la banda horaria
-- secuencial de storage_scope de T5 (…200000/210000/…) y evitar colisión de
-- versión en schema_migrations. add column if not exists → idempotente.
alter table companies
  add column if not exists center_lat double precision,
  add column if not exists center_lng double precision,
  add column if not exists zoom_default smallint;

comment on column companies.center_lat is 'serv:S16 — latitud del centro por defecto del mapa (null = default de la app).';
comment on column companies.center_lng is 'serv:S16 — longitud del centro por defecto del mapa (null = default de la app).';
comment on column companies.zoom_default is 'serv:S16 — zoom por defecto del mapa (null = default de la app).';
