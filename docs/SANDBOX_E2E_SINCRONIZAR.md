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

## Estado registrado (2026-09-26, re-verificado a las ~14:30 UTC)

**El sandbox está atrasado respecto de `main`.** Inventario de sólo lectura
sobre `jwpmivhvlstslncrtokb` («control-agua-rls-sandbox», no es producción):
504 migraciones registradas, máxima `20261004000200`; no existen
`pagos_rechazo_eventos`, `conta_ec_cobro_al_corte(uuid, date)` ni
`conta_saldo_favor_aplicaciones`. Comparado versión a versión con
`supabase/migrations/`:

| Versión | Origen | En el sandbox |
| --- | --- | --- |
| `20261005000000_conta_cobros_rechazo_evidencia` | #901 (en `main`, aplicada en producción el 2026-09-25) | **No aplicada.** Ni la fila de historial ni `pagos_rechazo_eventos`; `conta_tg_pagos` es la de `20261004000100`. |
| `20261006000000_conta_cobros_vigencia_sin_fecha` | #902 (en `main` desde `aa6e046`; aplicada en producción: registrada allí y con `conta_ec_cobro_al_corte`) | **No aplicada.** Depende de la anterior. |
| `20261007000000_conta_saldos_a_favor`, `20261008000000_conta_tipo_cambio_mensual`, `20261009000000_conta_sf_cuota_estado_y_tc_borradores` | #904 (PR en borrador) | **No aplicadas**, y no se aplican mientras #904 no esté en `main` (el paso 1 de abajo excluye PRs abiertos). Dependen de las dos anteriores. |

### Coordinación pendiente (para quien administra el sandbox)

1. Autorizar y ejecutar, con el procedimiento de abajo, `20261005000000` y
   `20261006000000` (ya en `main`), cada una en su transacción con huella
   verificada. No hay colisiones de versión ni nada que renumerar.
2. Cuando #904 llegue a `main`, repetir con `20261007000000`,
   `20261008000000` y `20261009000000`. Las tres crean tablas vacías, agregan
   columnas con default a `conta_asientos` y redefinen funciones/triggers; no
   reescriben datos existentes. Antes de aplicarlas, contar los borradores
   con la marca antigua (quedarán bloqueados para publicar hasta resolverlos):
   `select count(*) from conta_asientos where estado = 'borrador' and
   concepto like '%[SIN TIPO DE CAMBIO %'`.
3. Hasta entonces, **la validación de #904 contra el sandbox no se hizo**: la
   de comportamiento está en los arneses SQL (`supabase/tests/conta_saldos_favor`,
   `supabase/tests/conta_tipo_cambio_mensual`) contra la cadena completa de
   migraciones, en CI.

No hay versiones sólo en el sandbox ni colisiones: las dos versiones están
libres en su historial.

**Las validaciones de #901 y #902 no lo actualizaron.** Cada una aplicó las
migraciones y un caso sintético dentro de **una** transacción que terminó en
`RAISE EXCEPTION 'SUITE_OK_ROLLBACK …'`; después se comprobó que no quedó nada
(504 migraciones, sin la tabla ni las funciones nuevas, `conta_tg_pagos` sin
cambios, sin datos sintéticos). Eso prueba que las migraciones corren sobre el
estado real del sandbox; **no** lo deja al día.

Para ponerlo al día, con el procedimiento de abajo, en este orden y cada una en
su propia transacción con verificación de huella: `20261005000000` y, cuando
#902 esté en `main`, `20261006000000`. Ninguna toca datos existentes (crean una
tabla vacía y redefinen funciones); no requieren renumeración ni `repair`.
Quien administra el sandbox decide cuándo; hasta entonces, cualquier E2E que
use `pagos_rechazo_eventos` o el estado de cuenta con cortes de cobros
rechazados fallará contra él por desincronización, no por el código.

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
