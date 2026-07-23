# Purga de fotos de lectura a los 90 días

Elimina automáticamente la foto de toda lectura (`registros.foto`) con más de 90
días para no inflar el software. **Los datos de la lectura (consumo, lectura,
monto, estado) siempre se conservan — solo se descarta la imagen.**

## Por qué dos mecánicas

`registros.foto` guarda la foto en dos formatos:

| Formato | Dónde vive | Cómo se purga |
| --- | --- | --- |
| **base64 heredado** (`data:...`) | inline en la columna (hasta ~15 MB/fila, ~526 MB acumulados) — el peso real de la BD | **SQL puro**: `UPDATE registros SET foto = NULL`, dentro de `purgar_datos_expirados` (cron mensual existente) |
| **path de Storage** (`${cliente_id}/${id}`) | objeto en el bucket privado `registro-fotos` (lecturas nuevas) | **Edge Function** `purgar-fotos-registros` (service-role) invocada por pg_cron → pg_net |

La antigüedad se mide con `registros.fecha`. La UI ya tolera una foto ausente
(`PhotoLightbox` / `RegistroFotoThumb` muestran un placeholder), así que purgar
no rompe nada.

## Estado tras la migración `20260723000000_purga_fotos_registros.sql`

- ✅ `purgar_datos_expirados(...)` extendida con el paso base64 (param `p_dias_fotos int DEFAULT 90`). Ya la corre el cron mensual `purgar_datos_expirados` (`0 3 1 * *`).
- ✅ Función SQL `run_purga_fotos_storage()` — lee 2 secretos del vault y hace `net.http_post` a la edge function. **Safe no-op si faltan los secretos.**
- ✅ Cron `purgar_fotos_storage_monthly` → `30 3 1 * *` (día 1, 03:30 UTC, desfasado 30 min del de retención).
- ✅ Edge function `purgar-fotos-registros` (se despliega por `.github/workflows/deploy-functions.yml` al mergear a `main`).

## Lo único que falta — 1 paso manual (vault secrets)

`run_purga_fotos_storage()` está en modo **safe fallback**: si los secretos no
existen, no hace la llamada HTTP y no rompe el cron. Para activar el borrado de
objetos de Storage:

```sql
SELECT vault.create_secret(
  'https://nnsqmeigtgewatameexo.supabase.co/functions/v1/purgar-fotos-registros',
  'purga_fotos_url'
);

SELECT vault.create_secret(
  '<service_role_key>',
  'purga_fotos_service_key'
);
```

> Reemplaza `<service_role_key>` con el valor real del **Service Role Key**
> (Supabase Dashboard → Settings → API → `service_role` secret).

### Verificar que los secretos estén creados

```sql
SELECT name FROM vault.decrypted_secrets
WHERE name IN ('purga_fotos_url', 'purga_fotos_service_key');
-- Debe retornar 2 rows.
```

> **Nota:** el paso base64 (Parte A) **no** necesita secretos — es SQL puro y ya
> corre con el cron mensual. Los secretos solo activan el borrado de objetos del
> bucket (Parte B).

## Smoke test manual

**Parte A (base64, SQL):**

```sql
-- Ejecuta toda la purga de retención, incluido el paso de fotos base64.
SELECT public.purgar_datos_expirados();
-- El jsonb devuelto incluye {"fotos_base64": N, ...} con las columnas anuladas.
```

**Parte B (Storage, edge function):** tras crear los secretos,

```sql
SELECT public.run_purga_fotos_storage();
```

Inspeccionar el resultado del POST:

```sql
SELECT id, created, status_code, content
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
```

La edge function responde:
`{ success, dias, objetos_borrados, filas_actualizadas, iteraciones, errores }`.

También puede invocarse directo (super_admin o service_role):

```bash
curl -X POST 'https://nnsqmeigtgewatameexo.supabase.co/functions/v1/purgar-fotos-registros' \
  -H "Authorization: Bearer <service_role_key>" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"batch"}'
```

## Backlog inicial (~526 MB heredados)

Para liberar el histórico sin esperar al día 1:

1. `SELECT public.purgar_datos_expirados();` — anula las fotos base64 >90 días.
2. Invocar la edge function una vez (curl o `run_purga_fotos_storage()`) — borra
   los objetos de Storage >90 días.
3. Devolver el disco al SO tras vaciar el base64 (el `UPDATE ... = NULL` reduce el
   payload al instante, pero el espacio del TOAST lo reclama el autovacuum):
   ```sql
   VACUUM (VERBOSE, ANALYZE) public.registros;
   ```

## Monitoreo

```sql
-- Últimas corridas de ambos crons
SELECT jobname, status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobname IN ('purgar_datos_expirados', 'purgar_fotos_storage_monthly')
ORDER BY start_time DESC LIMIT 10;
```

## Parámetros / política

- **Umbral:** 90 días (`p_dias_fotos` en SQL; `dias` en el body de la edge
  function). Configurable si en el futuro se quiere otro valor.
- **Alcance:** todas las lecturas >90 días, sin importar el estado de pago.
- **Se conserva:** todo el dato de la lectura; solo se elimina la imagen.

## Fuera de alcance (futuro)

- Reconciliar objetos ya huérfanos del bucket (lecturas hard-deleted por la purga
  de retención antes de que existiera esta limpieza) — requeriría comparar el
  listado del bucket contra `registros.foto`.
- Etiqueta específica en la UI ("Foto eliminada por retención") en vez del
  placeholder genérico; hoy el listado no trae `foto`, así que no sabe si existe.
