# Sincronizar el sandbox de E2E con `main`

El sandbox de E2E (`jwpmivhvlstslncrtokb`, el que declara
`E2E_EXPECTED_SUPABASE_REF`) **no recibe migraciones automáticamente**. Ni la
integración Git de Supabase —que construye previews efímeros por PR— ni
`apply-migrations-prod.yml` —que sólo apunta a producción— lo tocan. Cada
migración que llega a `main` lo deja un paso más atrás, hasta que un E2E que
llama a un objeto nuevo falla con «función inexistente».

Eso pasó el 2026-09-22: le faltaban 72 migraciones y el caso de la bandeja de
pendientes de #887 hubo que retirarlo (a3a6829b) en vez de relajarlo. Este
documento es el procedimiento con el que se puso al día el 2026-09-23 y el que
hay que repetir.

## Estado registrado (re-verificado el 2026-10-01 03:14 UTC, sólo lectura)

`jwpmivhvlstslncrtokb` = «control-agua-rls-sandbox» (organización `mmqkhtbewmdashgswlxg`, creado el
2026-08-19). **No es producción** (`nnsqmeigtgewatameexo`). 504 migraciones registradas, máxima
`20261004000200`, y las 504 versiones locales hasta esa son las mismas (conciliadas el 2026-09-23).
No existen `pagos_rechazo_eventos`, `conta_ec_cobro_al_corte(uuid, date)` ni
`conta_ajustes_solicitudes`. Datos: 527 cuotas, 0 solicitudes de cobro en línea.

| Versión | Origen | En el sandbox |
| --- | --- | --- |
| `20261005000000_conta_cobros_rechazo_evidencia` | `main` (#901; aplicada en producción) | **Falta** |
| `20261006000000_conta_cobros_vigencia_sin_fecha` | `main` (#902; aplicada en producción) | **Falta** |
| `20261007000000` … `20261011000000` (5) | #904 (abierto) | **Faltan** |
| `20261012000000_conta_anular_cuota_reembolsos_parciales_respaldos` | #904 | **Falta** |
| `20261013000000_conta_cuota_anulada_sin_tocar_pagos` | #904 (correctiva de 20261012) | **Falta** |
| `20261014000000_conta_cuota_eliminar_solo_tarifa_reserva_cancelada` | #904 (correctiva de 20261012, E7) | **Falta** |

El procedimiento de abajo sólo admite migraciones de `main` (paso 1: «nada de PRs abiertos»).
Las de #904 **no** se aplican con él. Para probarlas en este sandbox hace falta la autorización
expresa del procedimiento acotado de la sección siguiente.

## Procedimiento ACOTADO para probar las migraciones de un PR abierto (requiere autorización)

**No está autorizado todavía; no se ejecutó.** Es la propuesta para #904.

1. **Primero `main`.** `20261005000000` y `20261006000000` con el procedimiento normal (abajo),
   cada una en su transacción con huella verificada. Si la huella previa del sandbox no coincide con
   la reconstrucción de su historial, se detiene todo y se informa.
2. **Respaldo** en `respaldo_sync_AAAAMMDD` (paso 3 del procedimiento normal), además de las
   definiciones actuales de las funciones que #904 redefine (`conta_tg_pagos`, `conta_tg_cuotas`,
   `conciliar_pago_externo`, las de estado de cuenta y saldos a favor) y del contenido de
   `storage.buckets`/políticas de `storage.objects`.
3. **Las 8 migraciones del PR, en orden, una por transacción**, con el SQL **del SHA autorizado**
   (se registra el SHA), su fila en `supabase_migrations.schema_migrations` con la misma versión y
   nombre, y la huella esperada tras cada paso (calculada antes sobre una reconstrucción local de
   `main` + esas migraciones). Huella distinta → `ROLLBACK` de esa transacción y alto. Nada de
   `repair`, `reset` ni borrado de datos: las migraciones sólo crean tablas vacías, agregan
   columnas con default y redefinen funciones, triggers, políticas y un bucket privado.
4. **Registro** en `respaldo_sync_AAAAMMDD.migraciones_de_pr` (versión, nombre, sha256 del archivo,
   SHA del PR, quién autorizó). Cuando #904 llegue a `main`, se comprueba que cada archivo fusionado
   tenga el mismo sha256: si coincide, no se vuelve a aplicar nada; si el PR cambió una migración ya
   aplicada aquí, se trata como colisión (sección «Colisiones de versión») y se decide con quien
   administra el sandbox.
5. **Pruebas de los flujos del bloque 3 en el sandbox**, con datos sintéticos `SINT` dentro de
   transacciones que terminan en `RAISE` (no quedan datos):
   - anular cuota: solicitar, dependencias informadas, aprobar, reversos vinculados, evidencia,
     estado de cuenta al corte, portal; eliminación de tarifa de reserva cancelada vs. cuota
     `pendiente` (E7);
   - respaldos: subir al bucket privado con la sesión de un usuario E2E, registrar, aprobar con la
     lista revisada, eTag alterado, no reemplazable;
   - reembolsos parciales: `pasarela_registrar_reembolso_parcial` como service_role con avisos
     duplicados, acumulados y fuera de orden; incidencias visibles.
   Después, el E2E del despliegue contra el sandbox y su preflight.
6. **Cómo se deshace** si se decide no seguir: restaurar desde el respaldo las funciones y políticas
   redefinidas y borrar las filas de historial de esas 8 versiones; las tablas nuevas quedan vacías
   (eliminarlas sería un borrado: sólo con autorización expresa).

Alternativa sin cambio persistente: el mismo paso 3 + las pruebas del paso 5 dentro de UNA
transacción que termina en `RAISE` (como se validaron #901 y #902). Requiere enviar ~560 KB de
SQL en una sola sentencia: no es viable por el conector de esta sesión; sí con `psql` y la URL de la
base del sandbox por quien la administra.

## Cuándo hacerlo

- Un E2E falla por un objeto de esquema que existe en `main` y no en el sandbox.
- Antes de reactivar un caso E2E que se retiró «hasta sincronizar el sandbox».
- Cuando `select max(version) from supabase_migrations.schema_migrations` en el
  sandbox queda por detrás de `ls supabase/migrations | tail -1`.

## Lo que NO se hace

| Prohibido | Por qué |
| --- | --- |
| `supabase db push` a ciegas | Aplica todo lo pendiente sin mirar qué hay; en este sandbox hay versiones registradas con otro contenido (ver «Colisiones»). |
| `supabase db reset` / recrear el proyecto | Borra el tenant sembrado y las cuentas de E2E. |
| `supabase migration repair` | Reescribe el historial para que «cuadre»: esconde la diferencia en vez de resolverla. |
| Desactivar RLS, triggers o constraints para que algo pase | El sandbox existe para probar exactamente eso. |
| Copiar datos o secretos de producción | El sandbox es sintético por diseño. |
| Actualizar `huella-produccion.json` con datos del sandbox | Esa huella es de producción; mezclarla invalida el auditor de drift. |

## Procedimiento

1. **Identificar el objetivo.** Confirmar el ref contra `E2E_EXPECTED_SUPABASE_REF`
   y que no es producción (`nnsqmeigtgewatameexo`) ni un preview. Registrar el
   SHA de `origin/main`; nada de PRs abiertos.

2. **Inventario de sólo lectura.** Comparar tres cosas, no una:
   las versiones de `supabase/migrations/` en ese SHA, las filas de
   `supabase_migrations.schema_migrations` del sandbox y **los objetos que
   existen de verdad**. Contar versiones o mirar la máxima no prueba nada: una
   versión puede estar registrada con otro contenido, o aplicada sin registrar.
   Para los objetos, `scripts/schema-drift/fingerprint.sql` sobre el sandbox
   contra `reconstruir.mjs` sobre el historial registrado.

3. **Respaldo dentro del sandbox**, en un esquema sin privilegios para `anon` ni
   `authenticated` (p. ej. `respaldo_sync_AAAAMMDD`): copia de
   `schema_migrations`, RBAC (`roles`, `permissions`, `role_permissions`,
   `user_roles`), definiciones y ACL de funciones, policies, triggers, vistas,
   conteo de filas por tabla y la huella completa. Restaurar es
   `INSERT … SELECT` desde ese esquema; nada se sobreescribe al respaldar.

4. **Aplicar una migración por transacción**, en orden, con el mismo mecanismo
   que `apply-migrations-prod.yml` (endpoint `database/query`): el SQL de la
   migración, el `insert into supabase_migrations.schema_migrations` y un
   `DO $$ … RAISE` que compara la huella con la esperada tras ese paso
   (calculada antes sobre una reconstrucción local). Si la huella no coincide,
   la transacción entera se revierte: no queda migración a medias ni fila de
   historial mentirosa. Ante el primer error, **parar**; no reintentar.

5. **Validar.** Repetir la comparación de versiones y de huella completa contra
   `main`; conteos contra el respaldo; y las suites SQL relevantes contra el
   sandbox **dentro de una transacción que termina en `RAISE`** para que no
   quede ningún dato sintético. Luego relanzar el E2E que fallaba y confirmar
   en el log que el preflight validó el ref.

6. **Reactivar** los casos E2E retirados por desincronización.

## Colisiones de versión

Si una versión de `main` ya está registrada en el sandbox **con otro nombre o
contenido**, el apply de esa versión es imposible sin tocar el historial. Pasó
con `20260828000000` y `20260829000000`: el sandbox había aplicado las dos
migraciones de recepción de #776 con esa numeración antes de que #776 las
renumerara a `20260828000300` y `20260829000600` para dejarle los números a la
cadena de renta de #779.

No se resuelve con `repair`, que marca como aplicado algo que no corrió. Lo que
se hizo el 2026-09-23, con autorización explícita de quien administra el
sandbox:

1. Comprobar que el SQL registrado en cada fila es el del archivo renumerado de
   `main`: md5 del texto sin comentarios ni espacios, en los dos lados. Sólo
   difería la versión citada dentro de dos `COMMENT`.
2. En una transacción con guardas (la fila existe con ese contenido, el número
   de destino está libre, la fila original está en el respaldo, la huella no
   cambia), cambiar `version` al número de `main` y dejar constancia en
   `respaldo_sync_20260922.renumeracion_historial`.
3. Aplicar la cadena que esperaba esos números con el procedimiento normal,
   huella verificada tras cada migración.

Si el contenido **no** coincide, no se renombra nada: se deja fuera esa cadena
completa y se documenta.

El mismo paso 2 se aplicó a `columnas_solo_en_produccion`, que el sandbox
había registrado como `20260825185704` y `main` tiene como `20260904000000`,
con contenido idéntico. Tras eso el historial del sandbox coincide con el de
`main` versión a versión y nombre a nombre.

## Checks que dependen del sandbox

- `E2E` (`.github/workflows/e2e.yml`) — contra el despliegue del SHA, que apunta
  a este sandbox; el preflight exige que el ref coincida.
- `RLS harness (server-side)` en `coverage.yml` — sólo si sus variables `RLS_*`
  apuntan a este mismo proyecto; confirmarlo antes de atribuirle un fallo.
