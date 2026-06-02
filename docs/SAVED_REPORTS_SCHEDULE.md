# Reportes guardados — schedule mensual/semanal (F4.5.1c)

## Estado actual

La migración `20260603000000_saved_reports_cron_schedule.sql` deja:

- ✅ Columna `report_templates.last_run_at` para rastrear última ejecución.
- ✅ Función SQL `claim_due_scheduled_reports(p_schedule_kind)` — devuelve los templates que deben correr hoy según schedule y `last_run_at`.
- ✅ Función SQL `dispatch_scheduled_reports(p_schedule_kind)` — invocada por `pg_cron`. Por defecto **solo loguea** vía `RAISE NOTICE`; no hace el envío real.
- ✅ 2 cron jobs activos en `pg_cron`:
  - `reports-monthly-day1` → `0 9 1 * *` (día 1 de cada mes, 09:00 UTC)
  - `reports-weekly-monday` → `0 9 * * 1` (cada lunes, 09:00 UTC)

## Activar el envío real (pasos operacionales)

Para que los cron jobs **realmente** envíen los reportes por email, hay que:

### 1. Crear edge function `process-scheduled-reports`

Esa función recibe `{template_id}` por POST, ejecuta el reporte, sube el archivo a `report-attachments`, y encola los emails en `email_send_queue` (igual que el flow manual de F4.5.1d).

Plantilla aproximada (Deno):

```ts
Deno.serve(async (req) => {
  const { template_id } = await req.json()
  // 1. Lee template (SELECT * FROM report_templates WHERE id = ?)
  // 2. SELECT data del source_table con filters aplicados
  // 3. Serializa CSV (o XLSX si la lib esta disponible en Deno)
  // 4. Sube a bucket report-attachments
  // 5. Crea signed URL
  // 6. INSERT email_send_queue por cada recipient
  // 7. UPDATE report_templates SET last_run_at = now() WHERE id = ?
  // 8. INSERT report_runs (triggered_by='scheduled', status='success', ...)
})
```

### 2. Configurar Supabase Vault con los secrets

```sql
SELECT vault.create_secret('https://<proyecto>.supabase.co/functions/v1', 'edge_function_url');
SELECT vault.create_secret('<service_role_key>', 'service_role_key');
```

### 3. Descomentar la invocación HTTP en `dispatch_scheduled_reports()`

Editar `supabase/migrations/20260603000000_saved_reports_cron_schedule.sql` y quitar los `--` antes de las líneas de `v_function_url`, `v_service_key`, y `PERFORM net.http_post(...)`.

Luego volver a aplicar via `mcp__supabase__apply_migration` o `supabase db push`.

### 4. Verificar los logs del cron

```sql
SELECT * FROM cron.job_run_details
WHERE jobname IN ('reports-monthly-day1', 'reports-weekly-monday')
ORDER BY start_time DESC
LIMIT 10;
```

## Diseño

| Decisión | Por qué |
|---|---|
| `last_run_at` en `report_templates` (no en `report_runs`) | Permite filtro O(log n) con índice parcial sin LEFT JOIN |
| Filter `last_run_at IS NULL OR < date_trunc('day', now())` | Idempotente: si el cron corre 2 veces el mismo día por error, solo procesa una vez |
| Excluir templates sin recipients | Sin sentido enviar un email sin destinatarios |
| `SECURITY DEFINER` en las funciones | Permite ejecución desde cron (rol superadmin) sin que RLS bloquee |
| Por defecto loguea via `RAISE NOTICE` | Despliegue seguro: la migration no rompe si vault no está configurado. El operador activa el envío real cuando esté listo |
| Timezone UTC | Consistente, evita ambigüedad de horario verano. El operador puede ajustar el `cron` schedule si necesita timezone local |

## Smoke test (cuando no hay templates schedule)

```sql
SELECT public.dispatch_scheduled_reports('monthly_day1');  -- → 0
SELECT public.dispatch_scheduled_reports('weekly_monday'); -- → 0
```

Cuando haya templates con `schedule_kind='monthly_day1'`, el siguiente día 1 a las 09:00 UTC verás registros en `cron.job_run_details` y NOTICE en logs.

## Out of scope (futuras iteraciones)

- **F4.5.1c2** — Edge function `process-scheduled-reports` real (genera + envía)
- **F4.5.1c3** — Soporte de timezones por company (cada tenant elige su horario)
- **F4.5.1c4** — Schedule customizable (cron expression libre, no solo monthly/weekly)
- **F4.5.1c5** — UI en SavedReportsModal para ver `last_run_at` + "Próxima ejecución"
