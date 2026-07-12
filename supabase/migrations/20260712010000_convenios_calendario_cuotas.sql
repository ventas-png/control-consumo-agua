-- Calendario de cuotas de convenios de pago (P1 · cobranza).
--
-- Columna aditiva y NULLABLE: los convenios existentes quedan con cuotas = NULL
-- (sin calendario, como hasta ahora — solo tenían `cuotas_pactadas`, un conteo).
-- Cuando tiene valor, es el desglose de cuotas generado al crear el convenio por
-- src/lib/business.ts::generarCalendarioConvenio (divide el total en N cuotas, la
-- última absorbe el residual de redondeo, y las agenda por frecuencia).
--
-- Forma: array [{ "numero": int, "fecha_vencimiento": "YYYY-MM-DD", "monto": number }].
-- No requiere backfill. Fail-safe: la UI cae a `cuotas_pactadas` si `cuotas` es NULL.

ALTER TABLE public.convenios_pago
  ADD COLUMN IF NOT EXISTS cuotas jsonb;

COMMENT ON COLUMN public.convenios_pago.cuotas IS
  'Calendario de cuotas [{numero, fecha_vencimiento, monto}] generado al crear el convenio. NULL en convenios legacy sin calendario.';
