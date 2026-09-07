# Retención de fotos: lecturas a 90 días, fichajes a 1 año

Elimina automáticamente las fotos que guardan los dos flujos que las producen.
**En los dos casos la fila sobrevive**: se descarta la imagen, nunca el hecho.

| Qué | Bucket | Plazo | Qué se anula |
| --- | --- | --- | --- |
| Foto de una lectura de agua | `registro-fotos` | **90 días** | `registros.foto` |
| Foto y ubicación de un fichaje | `presencia-evidencias` | **365 días** | `presencia_personal.foto_entrada`, `.foto_salida`, `.gps_entrada`, `.gps_salida` |

Los datos de la lectura (consumo, lectura, monto, estado) y los del marcaje
(hora de entrada y salida, estado, horas trabajadas) **siempre se conservan**.

## Por qué cada plazo es el que es

**Lecturas — 90 días.** La foto prueba un número. Pasado un trimestre el número
ya se cobró y la imagen solo pesa: es el bloat que motivó esta purga
(`registros.foto` en base64 llegó a ~526 MB acumulados).

**Fichajes — 365 días.** La foto y el GPS prueban que *una persona identificada*
estuvo en un sitio a una hora. Sirven para resolver un marcaje discutido, y eso
se discute dentro del ciclo laboral: la planilla del año, el aguinaldo, el bono
14. Un año cubre esa ventana entera con margen. Pasada, ya no contesta ninguna
pregunta abierta y lo único que queda es el rastro — una serie temporal de la
cara y la posición de cada trabajador, que es el dato más sensible que guarda el
producto.

> Si el asesor laboral pide alinearlo con el plazo de prescripción de reclamos
> (más largo que un año), el número vive en **un solo sitio**:
> `run_purga_fotos_storage()` en `20260908000100_purga_fotos_presencia.sql`. Se
> cambia ahí y el cron lo toma en la corrida siguiente.

### El GPS caduca con la foto — es una decisión

Al purgar un fichaje se anulan también `gps_entrada` y `gps_salida`. Es el mismo
dato —dónde estuvo una persona identificada, a qué hora— y sin la foto ya no
sirve para lo único que justificaba guardarlo. Dejarlo sobrevivir lo convertiría
en el rastro de ubicación más longevo del sistema, conservado por omisión y no
porque alguien decidiera conservarlo.

## Por qué dos mecánicas

## Por qué dos mecánicas

`registros.foto` guarda la foto en dos formatos:

| Formato | Dónde vive | Cómo se purga |
| --- | --- | --- |
| **base64 heredado** (`data:...`) | inline en la columna (hasta ~15 MB/fila, ~526 MB acumulados) — el peso real de la BD | **SQL puro**: `UPDATE registros SET foto = NULL`, dentro de `purgar_datos_expirados` (cron mensual existente) |
| **path de Storage** (`${cliente_id}/${id}`) | objeto en el bucket privado `registro-fotos` (lecturas nuevas) | **Edge Function** `purgar-fotos-registros` (service-role) invocada por pg_cron → pg_net |

La antigüedad se mide con `registros.fecha`. La UI ya tolera una foto ausente
(`PhotoLightbox` / `RegistroFotoThumb` muestran un placeholder), así que purgar
no rompe nada.

## Los fichajes van por la misma cañería, no por una nueva

`presencia-evidencias` (creado por `20260908000000_presencia_marcaje_autoservicio.sql`)
se purga con la **misma** edge function y el **mismo** cron que las lecturas.
`20260908000100_purga_fotos_presencia.sql` solo cambia el cuerpo de
`run_purga_fotos_storage()` para que mande los dos plazos explícitos:

```json
{ "mode": "batch", "dias_registros": 90, "dias_presencia": 365 }
```

Los plazos viajan explícitos aunque la edge function tenga los mismos por
defecto, para que la política de retención se lea **en la base**, donde vive el
dato, y no solo en el código desplegado.

**Por qué no una función hermana.** Habría necesitado su propio secreto de URL en
el Vault, y los de abajo *todavía no están creados*: una segunda función era un
segundo paso manual pendiente, y por tanto una segunda purga que no corre.
Extendiendo la que ya existe, el día que se creen esos dos secretos empiezan a
correr las dos.

El barrido de cada bucket es independiente: que uno falle no aborta al otro, y la
respuesta reporta ambos por separado (`objetivos: [{nombre, objetos_borrados,
filas_actualizadas, errores}]`).

**El orden importa y está probado.** Primero se borra el objeto del bucket y solo
después se anula la columna. Al revés, un fallo del `remove` dejaría la fila sin
path y el archivo vivo para siempre —invisible y no purgable—; al derecho, un
fallo deja el path intacto y la corrida del mes siguiente lo reintenta.
`supabase/functions/purgar-fotos-registros/__tests__/logic.test.ts` fuerza ese
fallo y exige que la columna NO se haya tocado.

## Estado tras la migración `20260723000000_purga_fotos_registros.sql`

- ✅ `purgar_datos_expirados(...)` extendida con el paso base64 (param `p_dias_fotos int DEFAULT 90`). Ya la corre el cron mensual `purgar_datos_expirados` (`0 3 1 * *`).
- ✅ Función SQL `run_purga_fotos_storage()` — lee 2 secretos del vault y hace `net.http_post` a la edge function. **Safe no-op si faltan los secretos.**
- ✅ Cron `purgar_fotos_storage_monthly` → `30 3 1 * *` (día 1, 03:30 UTC, desfasado 30 min del de retención).
- ✅ Edge function `purgar-fotos-registros` (se despliega por `.github/workflows/deploy-functions.yml` al mergear a `main`).
- ✅ `20260908000100` extiende esa misma función y ese mismo cron a `presencia-evidencias` (365 d, con el GPS). Sin cron nuevo y sin secretos nuevos.

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
