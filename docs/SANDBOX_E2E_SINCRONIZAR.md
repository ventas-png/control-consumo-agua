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
contenido** (pasó con `20260828000000` y `20260829000000`: el sandbox las tenía
con migraciones de un PR anterior, y `main` las usa para la cadena de renta),
el apply de esa versión es imposible sin reescribir el historial. No se
resuelve con `repair`: se deja fuera **esa cadena completa**, se documenta, y
quien administra el sandbox decide si renombrar esas filas a la numeración de
`main` (y dónde queda constancia del cambio) antes de aplicarla.

## Checks que dependen del sandbox

- `E2E` (`.github/workflows/e2e.yml`) — contra el despliegue del SHA, que apunta
  a este sandbox; el preflight exige que el ref coincida.
- `RLS harness (server-side)` en `coverage.yml` — sólo si sus variables `RLS_*`
  apuntan a este mismo proyecto; confirmarlo antes de atribuirle un fallo.
