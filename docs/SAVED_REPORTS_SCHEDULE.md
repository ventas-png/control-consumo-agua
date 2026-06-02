# Reportes guardados — schedule mensual/semanal (F4.5.1c-real)

## Estado actual ✅

Todo el código y la infraestructura está deployada:

- ✅ Columna `report_templates.last_run_at`
- ✅ Función SQL `claim_due_scheduled_reports(p_schedule_kind)` — selecciona templates due
- ✅ Función SQL `dispatch_scheduled_reports(p_schedule_kind)` — invocada por `pg_cron`; lee secrets del vault y hace POST a la edge function
- ✅ Edge function `process-scheduled-reports` (ACTIVE en Supabase) — recibe `{template_id}`, ejecuta query, genera CSV, sube a Storage, encola emails, registra en `report_runs`, marca `last_run_at`
- ✅ 2 cron jobs activos:
  - `reports-monthly-day1` → `0 9 1 * *` (día 1 cada mes, 09:00 UTC)
  - `reports-weekly-monday` → `0 9 * * 1` (cada lunes, 09:00 UTC)

## Lo único que falta — 1 paso manual (vault secrets)

`dispatch_scheduled_reports()` está en modo **safe fallback**: si los secrets del vault no existen, retorna 0 con `NOTICE` y no rompe el cron. Para activar el envío real:

```sql
SELECT vault.create_secret(
  'https://nnsqmeigtgewatameexo.supabase.co/functions/v1',
  'edge_function_url'
);

SELECT vault.create_secret(
  '<service_role_key>',
  'service_role_key'
);
```

> Reemplaza `<service_role_key>` con el valor real del **Service Role Key** (Supabase Dashboard → Settings → API → `service_role` secret).

### Verificar que los secrets estén creados

```sql
SELECT name FROM vault.decrypted_secrets
WHERE name IN ('edge_function_url', 'service_role_key');
-- Debe retornar 2 rows.
```

### Smoke test manual

Tras crear los secrets:

```sql
SELECT public.dispatch_scheduled_reports('monthly_day1');
-- Si hay templates con schedule_kind='monthly_day1' y last_run_at < hoy,
-- retornará la cantidad encontrada y disparará pg_net.http_post.
```

Para inspeccionar el resultado del POST:

```sql
SELECT id, created, status_code, content_type, content
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
```

## Flow end-to-end (una vez activado)

1. `pg_cron` corre `reports-monthly-day1` el día 1 a las 09:00 UTC
2. Ejecuta `SELECT public.dispatch_scheduled_reports('monthly_day1')`
3. `claim_due_scheduled_reports` retorna templates due (con recipients, no corridos hoy)
4. Por cada template: `net.http_post` a `process-scheduled-reports` con `template_id`
5. Edge function:
   - SELECT data + filters + `deleted_at IS NULL`
   - Serializa CSV con BOM UTF-8
   - Upload a `report-attachments/{company_id}/{template_id}/{timestamp}.csv`
   - Crea signed URL (24h)
   - INSERT N rows en `email_send_queue` (template_key=`saved_report_delivery`)
   - UPDATE `report_templates.last_run_at`
   - INSERT en `report_runs` (triggered_by=`scheduled`)
6. Worker `process-email-queue` (F2.15e) procesa los emails con retry+backoff
7. Recipient recibe email con CTA "Descargar reporte" (link signed válido 24h)

## Monitoreo

```sql
-- Últimas ejecuciones del cron
SELECT jobname, status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobname IN ('reports-monthly-day1', 'reports-weekly-monday')
ORDER BY start_time DESC LIMIT 10;

-- Últimos runs scheduled de reportes
SELECT template_id, triggered_at, rows_count, format, status, error_msg
FROM report_runs
WHERE triggered_by = 'scheduled'
ORDER BY triggered_at DESC LIMIT 20;
```

## Limitaciones del MVP

- **Solo CSV** server-side. XLSX/PDF requieren libs Deno pesadas que disparan cold start. Para esos formatos el admin usa el botón "📧 Email" del frontend (F4.5.1d) que sí soporta XLSX/CSV/PDF.
- **Timezone UTC**. El operador puede ajustar el `cron schedule` a timezone local si necesita (ej. `0 14 1 * *` = 09:00 hora de Guatemala = UTC-5 + 09 = 14 UTC).
- **No reintenta automáticamente** si la edge function falla — el siguiente día (cron) intentará de nuevo porque `last_run_at` no se actualiza si falla. Para retry inmediato, manual POST a la edge function.

## Out of scope (futuro)

- Timezone por company (cada tenant elige su horario)
- Schedule customizable (cron expression libre, no solo monthly/weekly)
- UI en SavedReportsModal para ver "Próxima ejecución" + log de runs scheduled vs manual
- Soporte XLSX server-side (usar lib `sheetjs` Deno port)
