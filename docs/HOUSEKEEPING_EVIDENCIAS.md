# Housekeeping · evidencia fotográfica, autoría y borrado coordinado

Migración: `supabase/migrations/20261028000000_housekeeping_evidencias.sql`
Pruebas: `supabase/tests/housekeeping_evidencias/run.sh` · `supabase/functions/_shared/__tests__/housekeepingLimpieza.test.ts` · `src/domain/condominios/__tests__/housekeepingEvidencias.test.ts`

## Qué hace
Cada servicio de housekeeping documenta cómo se encontró la unidad (texto + hasta 20 fotos) y cómo
quedó (texto + hasta 20 fotos), queda sellado **quién lo inició y quién lo completó**, y se puede
generar un informe PDF para compartir por WhatsApp. Las fotos se depuran a los 90 días; los textos y
la autoría **no se purgan nunca**.

## Quién puede qué (una sola regla: `hk_acceso`)
`hk_acceso(company_id, project_id)` = **empresa del usuario ∧ acceso al proyecto (`can_access_project`) ∧
permiso `condominios.tab.housekeeping`** (o super_admin). La usan la tabla, el bucket y las RPC, así que
no pueden divergir. Es la regla de escritura de `servicios_housekeeping` más el acceso al proyecto.

| Acción | Tabla `servicio_housekeeping_fotos` | Bucket `housekeeping-evidencias` |
|---|---|---|
| Ver | `hk_acceso` | `hk_acceso` **y** la carpeta 1 = proyecto del servicio y la carpeta 2 = ese servicio |
| Subir | `hk_acceso` + ruta del servicio + máx. 20 por fase | igual + `<carpeta>/<carpeta>/<archivo>` + máx. 60 objetos por servicio |
| Modificar | **nadie** (sin privilegio `UPDATE`) | **nadie** (sin policy) |
| Borrar | **nadie directo** (sin privilegio `DELETE`) → RPC | **nadie** (sin policy) → lo retira el servidor |

Los privilegios están **revocados**, no solo sin policy: un intento falla con `permission denied` en vez
de afectar 0 filas en silencio. Un residente ve la *fila* del servicio de su unidad (política previa de
`servicios_housekeeping`, que ahora incluye los textos) pero **ninguna foto**.

Rutas: `<project_id>/<servicio_id>/<archivo>`, validadas en tres sitios — la policy de INSERT del bucket
(el servicio existe, es de ese proyecto y el usuario tiene `hk_acceso`), el trigger de la fila de foto (la
ruta es la de *ese* servicio) y un índice único (un objeto = una fila). Un servicio con fotos no puede
cambiar de empresa o proyecto (la ruta dejaría de ser suya).

## Borrado coordinado (fila + archivo)
La fila se borra en una transacción; el archivo vive en Storage y no puede borrarse en ella. Por eso:

1. **RPC autorizadas** (`SECURITY DEFINER`, `search_path` vacío, ejecutables solo por `authenticated`):
   - `hk_eliminar_foto(id)`: admin/owner de la empresa, o quien la subió mientras el servicio no esté
     completado. Lo ajeno responde «inexistente» (no revela que existe).
   - `hk_eliminar_servicio(id)`: solo `company_owner`/`admin` (misma regla que la policy de DELETE
     del servicio). Devuelve cuántos archivos quedaron encolados.
   - Ambas exigen **exactamente una fila afectada**; cualquier otra cosa lanza.
2. Un trigger `AFTER DELETE` sobre las fotos **encola el archivo** en `hk_limpieza_storage`, venga el
   borrado de donde venga (RPC, cascada de servicio/proyecto/empresa, o el `DELETE` directo que la
   policy previa le permite a un admin sobre `servicios_housekeeping`). La cola no tiene acceso para clientes.
3. La edge function `housekeeping-limpieza` (service-role; valida el JWT: usuario de empresa → solo la
   cola de *su* empresa, super_admin → toda) **drena la cola**: toma un lote con arrendamiento
   (`FOR UPDATE SKIP LOCKED`, +10 min), borra del bucket, y solo entonces `hk_limpieza_confirmar`.
   - Fallo de Storage → la fila **se queda**, +1 intento, el error, y espera `5·2ⁿ` min (tope 24 h).
   - A los 10 intentos queda **atascada** (no se reintenta sola, conserva su último error).
   - `confirmar`/`fallar` devuelven filas afectadas; menos de las esperadas se **reporta**.
   - Solo toca el bucket de housekeeping; una fila de la cola con otro bucket se marca fallida.
4. Reintentos sin que nadie borre nada: cada hora `pg_cron` → `purgar-fotos-registros` con
   `mode: 'limpieza_housekeeping'` (mismos secretos de Vault que la purga; sin ellos es un no-op) drena la
   cola y **barre objetos huérfanos** (subidas cuya fila no se registró, de más de un día).

## Retención
Las fotos se depuran a los 90 días (`purgar-fotos-registros`, objetivo `housekeeping`): se borra el objeto
y se anula `path`; la fila sobrevive (fase, quién, cuándo). Anular `path` **no** encola nada (el objeto ya
lo retiró la propia purga). Textos y sellos no se tocan: están en `servicios_housekeeping`.

## Autoría
`iniciado_por/_en` y `completado_por/_en` los sella un trigger con `auth.uid()` **en la transición** de
estado; lo que mande el cliente se ignora, y un `UPDATE` posterior no los reescribe. Si un servicio se
reabre y se vuelve a completar, `completado_por` es quien lo hizo la última vez.

## Numeración y orden de fusión
Va **después** de las nueve migraciones de la PR #926 (`20261027000000` … `20261027000800`). Producción está
en `20261026000500`; la guarda de migraciones intercaladas obliga a que lo nuevo sea posterior. Si esta PR se
fusionara **antes** que #926, las de #926 tendrían que renumerarse. El tope `MAX_APPLY = 10` de
`apply-migrations-prod` se cumple con 9 + 1.

Historia: la primera versión de este PR se llamó `20261023000000` (chocaba con
`compras_seguimiento_pendientes_por_renglon`), luego `20261023000001` y `20261027000000` (chocaba con
`compras_aislamiento_referencias` de #926). Ninguna llegó a main, a producción (0 migraciones de housekeeping,
864 versiones, máx. `20261026000500`) ni al sandbox `control-agua-rls-sandbox` (máx. `…27000800`, 0 de housekeeping).
**Solo `20261023000001` quedó aplicada, y solo en el preview branch efímero de esta PR.**

## Reconciliación del preview branch de la PR (único entorno afectado)
Síntoma: `Remote migration versions not found in local migrations directory` — el preview tiene registrada
`20261023000001_housekeeping_evidencias` y el repo ya no tiene ese archivo. Causa confirmada con
`workflow_run_logs` de la propia rama (no es cosmético; ver el informe de la PR). Reconciliación **sin
resetear** el branch: aplicar el contenido final (idempotente y probado contra el estado antiguo en
`run.sh` §3) y mover el registro:

```sql
-- 1) aplicar el contenido de 20261028000000_housekeeping_evidencias.sql (idempotente)
-- 2) mover el registro de la versión antigua a la definitiva (solo versión y nombre, como hace
--    apply-migrations-sandbox.yml)
BEGIN;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261023000001' AND name = 'housekeeping_evidencias';
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261028000000', 'housekeeping_evidencias')
ON CONFLICT (version) DO NOTHING;
COMMIT;
```

El sandbox y producción **no** necesitan reconciliación: nunca tuvieron la versión antigua.

## Despliegue
1. Fusionar #926 y aplicar sus migraciones (`apply-migrations-prod`).
2. Fusionar esta PR; `apply-migrations-prod` aplica `20261028000000`; `deploy-functions` despliega
   `housekeeping-limpieza` y la nueva `purgar-fotos-registros`.
3. **Manual, ya pendiente**: crear los secretos de Vault `purga_fotos_url` y `purga_fotos_service_key`
   (`docs/PURGA_FOTOS_SCHEDULE.md`). Sin ellos la cola solo se drena al borrar (desde la pantalla), no cada hora.

## Límites conocidos
- Los residentes ven los **textos** (`hallazgos_ingreso`, `observaciones_cierre`) del servicio de su unidad
  porque la policy previa de `servicios_housekeeping` les da lectura de esa fila. Las fotos no.
- Un objeto subido cuyo registro de fila falla queda sin fila hasta que el barrido horario lo retira
  (pasado un día); mientras tanto ocupa espacio y cuenta para el tope de 60 objetos por servicio.
- La concurrencia del tope de 20 se prueba con sesiones reales en PostgreSQL 16 desechable, no en PG17 ni
  tras el pooler.
