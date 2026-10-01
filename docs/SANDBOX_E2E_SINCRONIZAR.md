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
| `20261015000000_pasarela_cobro_tardio_cuota_anulada` | #904 (confirmación tardía sobre cuota anulada) | **Falta** |
| `20261016000000_pasarela_reembolso_antes_de_aprobar_estado_persistido` | #904 (correctiva de 20261015) | **Falta** |
| `20261017000000_conta_ajuste_importe_notas_credito` | #904 (E6) | **Falta** |

El procedimiento normal (más abajo) sólo admite migraciones de `main` (paso 1: «nada de PRs
abiertos»). Las 11 de #904 **no** se aplican con él: hace falta la autorización expresa del
procedimiento acotado de la sección siguiente.

## Procedimiento ACOTADO para probar las migraciones de un PR abierto (requiere autorización)

**No está autorizado; no se ejecutó nada.** Es la propuesta para #904. Separa lo que se puede
deshacer con una transacción de lo que no.

### Qué deja cada tipo de prueba

| Tipo | Cómo corre | Qué queda después | Limpieza |
| --- | --- | --- | --- |
| **A · SQL reversible** | Una conexión `psql` (o `database/query`), `BEGIN` … pruebas … `RAISE EXCEPTION 'fin'` | Nada en tablas, catálogo ni historial. Sólo avanzan secuencias (`nextval` no se revierte) | Ninguna |
| **B · Storage real** | Peticiones HTTP a la API de Storage con la sesión de un usuario E2E | El objeto en el almacenamiento **y** su fila en `storage.objects`: cada subida es su propia transacción, ya confirmada cuando vuelve la respuesta. **Un `RAISE` en otra transacción no la revierte** | La de la tabla de abajo, sólo autorizada |
| **C · Migraciones** | Paso 3, una por transacción | Esquema + fila de historial, juntos | Ver «Restauración» |

Las pruebas B necesitan además filas **confirmadas** que las respalden: la política de
`storage.objects` (`ajustes_respaldos_insert`) sólo deja subir a la carpeta de una solicitud que
existe y está `pendiente`, y `conta_ajuste_adjuntar_respaldo` escribe en una tabla inmutable. Por eso B
deja datos sintéticos persistentes y A no.

### Pasos

1. **Primero `main`.** `20261005000000` y `20261006000000` con el procedimiento normal (abajo),
   cada una en su transacción con huella verificada. Si la huella previa del sandbox no coincide con
   la reconstrucción de su historial, se detiene todo y se informa.
2. **Respaldo** en `respaldo_sync_AAAAMMDD` (paso 3 del procedimiento normal) y, además:
   - la **huella completa previa a #904** (`fingerprint.sql`), que es la referencia de la
     restauración;
   - `pg_get_functiondef` y ACL de **cada** función que las 11 migraciones redefinen o eliminan, y
     la definición de cada trigger, constraint y política que cambian (lista generada desde los
     archivos del SHA autorizado, no a mano);
   - las filas de `storage.buckets` y las políticas de `storage.objects`.
3. **Las 11 migraciones del PR, en orden, una por transacción**, con el SQL **del SHA autorizado**
   (se registra el SHA), su fila en `supabase_migrations.schema_migrations` con la misma versión y
   nombre, y la huella esperada tras cada paso (calculada antes sobre una reconstrucción local de
   `main` + esas migraciones). Huella distinta → `ROLLBACK` de esa transacción y alto. Nada de
   `repair`, `reset` ni borrado de datos: crean tablas vacías, agregan columnas con default,
   redefinen funciones, triggers y políticas, y crean el bucket privado `ajustes-respaldos`.
4. **Registro** en `respaldo_sync_AAAAMMDD.migraciones_de_pr` (versión, nombre, sha256 del archivo,
   SHA del PR, quién autorizó). Cuando #904 llegue a `main`, se comprueba que cada archivo fusionado
   tenga el mismo sha256: si coincide, no se vuelve a aplicar nada; si cambió una migración ya
   aplicada aquí, es una colisión (sección «Colisiones de versión») y se decide con quien
   administra el sandbox.
5. **Pruebas A (reversibles)**, con datos `SINT` creados dentro de la misma transacción que termina
   en `RAISE`:
   - anular cuota: solicitar, dependencias informadas, aprobar, reversos vinculados, evidencia,
     estado de cuenta al corte, portal; eliminación de la tarifa de una reserva cancelada contra una
     cuota `pendiente` (E7);
   - respaldos, **sólo la parte SQL**: registro con `conta_ajuste_adjuntar_respaldo` sobre una fila
     de `storage.objects` insertada en la misma transacción, aprobación con la lista revisada,
     eTag alterado (`AJUSTE_RESPALDO_ALTERADO`). Esto prueba las reglas, **no** la API de Storage;
   - reembolsos parciales y confirmación tardía sobre cuota anulada como service_role: avisos
     duplicados, acumulados, fuera de orden; incidencias visibles.
6. **Pruebas B (Storage real)**, sólo si se autorizan aparte, porque dejan datos:
   - archivos: dos PDF sintéticos de 1 KB generados en el momento (contenido
     `SINT E2E respaldo <fecha>`; nada real ni de producción);
   - ruta: `<company_id del tenant E2E>/<solicitud SINT>/<clave>-SINT-E2E-AAAAMMDD-n.pdf`
     (`rutaRespaldo`), en `ajustes-respaldos`;
   - qué se comprueba: subir con la sesión del usuario E2E; volver a subir a la misma ruta falla
     (`upsert: false`, sin política de UPDATE); un usuario de otra empresa no puede leerlo; la URL
     firmada vence; el sha256 registrado coincide con el archivo;
   - **efectos persistentes** (todos en el tenant E2E, todos con `SINT-E2E-AAAAMMDD` en el
     concepto o el motivo): 1 cuota sintética con su asiento de devengo; 1 solicitud `anular_cuota`
     que se aprueba al final (la cuota queda anulada con su reverso: saldo neto 0) con sus eventos;
     2 filas en `conta_ajustes_respaldos`; 2 objetos en el bucket con sus filas de
     `storage.objects`;
   - **limpieza autorizada**: sólo los 2 objetos, por la API de Storage con `service_role`
     (`remove`), que borra a la vez el archivo y su fila. Nunca `DELETE` sobre `storage.objects`
     por SQL (dejaría el archivo huérfano). Las filas contables y de bitácora **no** se borran: son
     inmutables por diseño y quitarlas exigiría desactivar triggers, que está prohibido. Quedan como
     datos sintéticos declarados aquí; si se borran los objetos, sus filas de
     `conta_ajustes_respaldos` siguen con el sha256 y la ruta, y el registro anota que el archivo
     se retiró y cuándo.
7. Después, el E2E del despliegue contra el sandbox y su preflight.

### Restauración (si se decide no seguir)

La regla: **esquema e historial cambian juntos**. Una fila de `schema_migrations` sólo se quita en
la misma transacción que revierte todos sus efectos, y sólo si la huella resultante es la de antes
de esa migración. Nunca se borra una fila de historial dejando sus objetos vivos, ni se dejan
objetos sin su fila.

- **R1 · Mantenerlas aplicadas (por defecto).** Si ya corrieron pruebas B, es la única opción sin
  borrar datos: las tablas nuevas tienen filas sintéticas inmutables. Esquema e historial coinciden;
  el registro del paso 4 explica qué SHA está aplicado. Al fusionarse #904 se verifica el sha256
  (paso 4).
- **R2 · Revertir por completo** (sólo sin pruebas B, o con autorización expresa para borrar sus
  datos). Una transacción por migración, **de la última a la primera** (20261017 → 20261007):
  1. restaurar desde el respaldo las funciones, triggers, constraints y políticas que esa
     migración redefinió, y volver a crear las que eliminó (p. ej. `conta_ajuste_aprobar(uuid,
     text, boolean)`, que 20261012 sustituyó);
  2. eliminar los objetos que creó (funciones, triggers, índices, columnas, tablas), **sólo si
     están vacíos**; una tabla con filas detiene la reversión → se queda en R1;
  3. el bucket `ajustes-respaldos` sólo vacío y por la API de Storage (`deleteBucket`), no por SQL;
  4. borrar su fila de `schema_migrations`;
  5. comprobar con `fingerprint.sql` que la huella es la esperada **antes** de esa migración
     (calculada sobre la reconstrucción local); si no, `ROLLBACK` y alto.

  Al terminar, la huella del sandbox debe ser igual a la huella previa registrada en el paso 2.

**Antes de pedir la autorización** falta (no está hecho): el guion de R2 generado desde los
archivos del SHA autorizado y **probado en local** (cadena de `main` + 11 migraciones + R2 → huella
igual a la de `main`). Sin esa prueba no se propone R2: sólo R1.

Alternativa sin cambio persistente: los pasos 3 y 5 dentro de UNA transacción que termina en
`RAISE` (como se validaron #901 y #902). Cubre A y C, nunca B. Requiere enviar ~580 KB de SQL en una
sola sentencia: no es viable por el conector de esta sesión; sí con `psql` y la URL de la base del
sandbox por quien la administra.

### Autorización que se pide

Por separado, porque tienen efectos distintos:

1. aplicar 20261005 y 20261006 (`main`) por el procedimiento normal;
2. aplicar las 11 migraciones de #904 en el SHA que se indique (C, con R1 por defecto);
3. correr las pruebas A;
4. correr las pruebas B, con los efectos persistentes y la limpieza descritos en el paso 6.

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
