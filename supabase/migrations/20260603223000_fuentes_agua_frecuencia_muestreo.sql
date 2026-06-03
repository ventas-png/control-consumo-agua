-- serv:S26 — Programa de muestreo de calidad.
-- Frecuencia de muestreo (en días) por fuente de agua, para derivar el estado de
-- muestreo (al día / próximo / vencido) contra la última muestra registrada en
-- registros_calidad. null = sin programa de muestreo definido. La escritura ya la
-- cubren las policies de fuentes_agua (CalidadSection hace el update).
-- Timestamp 223000 (no la hora redonda 230000) para esquivar la banda horaria
-- secuencial de storage_scope de T5 y evitar colisión de versión.
alter table fuentes_agua
  add column if not exists frecuencia_muestreo_dias smallint
    check (frecuencia_muestreo_dias is null or frecuencia_muestreo_dias > 0);

comment on column fuentes_agua.frecuencia_muestreo_dias is 'serv:S26 — días entre muestreos esperados de calidad (null = sin programa).';
