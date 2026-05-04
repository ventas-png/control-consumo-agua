alter table companies
  add column if not exists servicio_agua boolean not null default true,
  add column if not exists servicio_condominios boolean not null default true;
