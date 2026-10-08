# Auditoría al eliminar roles

## Causa y alcance

`trg_audit_roles` es AFTER DELETE. Su función insertaba `OLD.id` en una FK
que apunta a un rol que ya no existe. La eliminación se revertía por
`permission_audit_log_target_role_id_fkey`. Los triggers de permisos y
asignaciones tienen el mismo riesgo durante un DELETE CASCADE, y el de
asignaciones además apuntaba con `target_user_id` a un usuario que, al borrar
un `app_users` con asignaciones, ya no existe
(`permission_audit_log_target_user_id_fkey`).

La migración incremental `20261026000500_auditoria_borrado_roles.sql` mantiene
la FK como referencia viva nullable y conserva `role_id` en `details` como
identidad histórica. También guarda el usuario en los eventos de asignación
y el snapshot del rol eliminado. Los eventos anteriores que todavía tienen
una FK reciben su identificador antes de cualquier eliminación futura; no se
inventan identificadores para eventos ya huérfanos. Ninguna fila de auditoría
se elimina y ningún error se oculta con un manejador de excepciones.

No cambia RLS, grants de tablas ni los objetos trigger. Las tres funciones
siguen siendo trigger-only: EXECUTE revocado de PUBLIC, anon y authenticated.
Las eliminaciones directas de permisos y asignaciones conservan la FK si el
rol sigue existiendo; en cascada se usa NULL y el snapshot permanece. Al
borrar un usuario con asignaciones, `target_user_id` queda NULL, la FK al rol
(que sigue vivo) se conserva y el usuario queda identificado en
`details.user_id`.

## Verificación

El 2026-10-05, contra el sandbox existente `jwpmivhvlstslncrtokb`:

- Control negativo con las funciones originales: DELETE falla exactamente
  por `permission_audit_log_target_role_id_fkey`; datos revertidos.
- Migración aplicada dos veces dentro de una transacción de validación:
  creación, edición, retiro directo de permisos/asignaciones, DELETE simple
  y DELETE con cascada correctos. Los eventos conservan identidad y actor.
- Prueba adicional como `authenticated`, admin normal del fixture: puede
  borrar su rol de empresa y no puede borrar el de otra empresa. ACL de
  invocación directa cerrada. Resultado `AUDIT_ROLES_RLS_OK_REVERTIDO`.
- Esas pruebas y la sustitución de funciones se revirtieron al terminar;
  el despliegue persistente es posterior (ver «Despliegue y limpieza»).
  A esa fecha producción no había recibido este arreglo.
- `migrations-guard`, sintaxis del arnés y `git diff --check` sin hallazgos.

Regresión reproducible: el arnés de PostgreSQL desechable
`supabase/tests/compras_cierre_tecnico/run.sh` (paso 7b) ejecuta el control
negativo, aplica esta migración dos veces y corre
`supabase/tests/auditoria_roles/assert.sql`. Ya forma parte de Coverage gate.

## Fallo de CI (corrida 37369174666) y corrección del arnés

El job «RLS sandbox de recepción» falló con «auditoría RBAC: el control negativo
pasó sin la corrección». **No era un defecto de la migración, sino del orden del
arnés.** El paso 4 de `run.sh` instala, con un bucle genérico, toda migración
posterior a `20261026000000` que no sea de la serie (`000[0-4]00`);
`20261026000500` cumplía ambas condiciones y se aplicaba **antes** del control
negativo. Demostrado por catálogo en la base justo antes de `negative.sql`:
`audit_roles_changes()` ya insertaba `target_role_id = NULL` y `details.role_id`,
es decir, la corrección estaba instalada y el escenario no podía fallar.
Reproducido en PostgreSQL 16.14 desechable con el mismo mensaje (exit 1).

El escenario de `negative.sql` era válido: con las tres funciones originales
(`20260518000008`) falla con SQLSTATE `23503` en
`permission_audit_log_target_role_id_fkey` (`Key (target_role_id)=… is not
present in table "roles"`, desde `audit_roles_changes()` línea 23). Da igual
si el INSERT y el DELETE van en un mismo bloque `DO` o en sentencias separadas
y confirmadas, y da igual que haya un evento previo de auditoría o que el rol
tenga un permiso o una asignación en cascada: las cuatro variantes fallan igual
(se probaron una por una). En cascada el primer error siempre lo da
`audit_roles_changes()`, así que el control negativo único no puede demostrar
que las otras dos funciones hagan falta; eso lo hacen las mutaciones.

Cambios en el arnés (sin desactivar triggers, constraints ni RLS, y sin quitar
el control negativo):

- `20261026000500` se excluye del bucle del paso 4 y se instala solo en el 7b,
  después de su control negativo.
- Antes del control negativo se exige por catálogo que la corrección NO esté
  instalada (las tres funciones sin `'role_id'`), y que haya eventos previos
  para que el backfill se ejercite (1 307 en la base del arnés).
- El control negativo corre en una copia de la base y solo vale si falla por
  `23503` + `permission_audit_log_target_role_id_fkey` + `is not present in
  table "roles"` + `audit_roles_changes()`. Cualquier otro error se rechaza.
- Migración aplicada dos veces con huella (definición de las tres funciones y
  todas las filas de auditoría): la segunda no cambia nada. Una huella de
  superficie compara antes y después, para `roles`, `role_permissions`,
  `user_roles` y `permission_audit_log`, RLS, políticas, privilegios de tabla
  y triggers; para `permission_audit_log`, sus constraints; y para las tres
  funciones, ACL, `SECURITY DEFINER` y `search_path`. Las huellas se validan
  (una huella vacía no puede dar «idéntico»). Que la migración no concede
  permisos se sostiene además por su contenido: solo `UPDATE`, `CREATE OR
  REPLACE FUNCTION` y `REVOKE`.
- `assert.sql` se ejecuta sin dejar residuos (se compara el estado de roles,
  permisos, asignaciones y auditoría antes y después) y verifica: altas con
  identidad en `details`; retiro directo con FK viva, usuario y permiso;
  borrado en cascada con exactamente los tres eventos nuevos, actor, snapshot
  (`name`, `is_system`, `company_id`, `permission_key`, `effect`, `user_id`) y
  FK en NULL; borrado de un usuario con asignaciones; aislamiento entre
  empresas y ACL. El veredicto `AUDIT_ROLES_OK_REVERTIDO` se emite dentro de la
  transacción, antes del `ROLLBACK`, para que ejecutado sin `ON_ERROR_STOP`
  nunca aparezca tras un fallo.
- Mutaciones: por cada una de las tres funciones, la definición original
  completa y una variante «solo FK» (la corregida pero apuntando de nuevo a un
  rol inexistente), más una séptima para la FK del usuario, deben romper la
  regresión por la causa esperada. Si un patrón `sed` dejara de coincidir con
  la migración, el arnés aborta en lugar de pasar en falso. Esta parte excede
  lo estrictamente pedido y puede retirarse sin perder el control negativo.

Validación local del arnés completo (`run.sh`, 45 s, incluidas las pruebas de
concurrencia): 247 + 73 + 52 comprobaciones, concurrencia A–D y V–Z, guards y
paso 7b en verde, sin ninguna línea `ERROR` en el registro. El propio arnés se
probó con cuatro sabotajes que deben ponerlo en rojo y lo pusieron: (A)
reinstalar la migración antes del control negativo, (B) una migración que
concede EXECUTE a `authenticated`, (C) una migración no idempotente y (D) un
control negativo que falla por otra FK (`roles_company_id_fkey`). Además se
comprobó que las aserciones de cascada detectan degradaciones que solo ocurren
cuando el rol ya no existe (actor, permiso, usuario o evento perdidos).

Auditor de drift (`scripts/schema-drift/auditar.mjs --base origin/main`),
reproducido en local: «Sin drift no autorizado»; solo los tres cambios
planificados (`audit_roles_changes`, `audit_role_permissions_changes` y
`audit_user_roles_changes`). `huella-produccion.json` y `drift-conocido.json`
no se tocan.

### Limitación declarada

Las aserciones reforzadas de `assert.sql` (altas, snapshots, usuario borrado)
se validaron en PostgreSQL desechable 16.14, no en el sandbox: el intento de
ejecutarlas allí de forma reversible agotó el tiempo de la herramienta SQL
(60 s) porque contienen `DELETE`, y no se intentó esquivarlo. Se verificó
después que el sandbox quedó intacto (cero roles, usuarios o eventos `Audit …`,
cero sesiones activas, versión `20261026000500`). La regresión original sí se
ejecutó en el sandbox el 2026-10-05 (arriba).

## Despliegue y limpieza

Estado del sandbox `jwpmivhvlstslncrtokb`, verificado en solo lectura el
2026-10-08:

- Migración aplicada por el workflow `Apply Migrations to Sandbox`, corrida
  37364175120 (2026-10-05, `success`, SHA `1458076`). `20261026000500` es la
  última versión registrada.
- Las tres funciones llevan la corrección; ningún evento con rol vivo carece
  de `role_id`.
- El rol temporal `f9220000-0000-4000-8000-000000000001` ya no existe, y su
  evento `delete_role` conserva el ID, nombre y empresa con la FK en NULL (sin
  actor: se eliminó desde la herramienta SQL, sin sesión de usuario). No se
  desactivaron triggers ni se borró el evento para limpiar.

### Producción (verificado en solo lectura el 2026-10-08)

- **Fusión:** PR 924, squash `8a4debd075bfda340884a227cde7e0d7aa2a649b`, con la
  aprobación de un revisor independiente sobre el commit `2133d03`.
- **Despliegue:** corrida 37795384002 de `Apply Migrations to Production`,
  `success`. Aplicó únicamente `20261026000500_auditoria_borrado_roles.sql`
  (HTTP 201); no se reaplicó ninguna migración histórica ni hizo falta reparar
  el historial.
- **Versión registrada** en `supabase_migrations.schema_migrations`:
  `20261026000500` (`auditoria_borrado_roles`), la última de 864.
- **Funciones:** el `md5(prosrc)` de las tres es idéntico al texto de la
  migración fusionada (`audit_roles_changes` `e154622e…`,
  `audit_role_permissions_changes` `ecc33c9d…`, `audit_user_roles_changes`
  `a298e7b9…`); `SECURITY DEFINER` con `search_path=public`.
- **ACL:** `postgres=X/postgres,service_role=X/postgres`. Sin EXECUTE para
  PUBLIC, `anon` ni `authenticated`.
- **Triggers y FK:** `trg_audit_roles`, `trg_audit_role_permissions` y
  `trg_audit_user_roles` habilitados. Las tres FK de la auditoría (actor, rol,
  usuario) son `ON DELETE SET NULL`.
- **Backfill:** 0 eventos con `target_role_id` vivo y sin `details.role_id`, 0
  con un `role_id` distinto de la FK y 0 FK colgantes. 6 058 de los 6 059
  eventos llevan `role_id`; el que falta es un huérfano anterior, sin FK ni
  identidad, al que la migración no inventa nada.
- **Conservación:** `permission_audit_log` tiene `n_tup_del = 0` con las
  estadísticas sin reiniciar: nunca se ha borrado una fila de auditoría, y la
  migración solo actualiza `details`.
- **Asignaciones:** la migración no toca `user_roles`, y el último evento de
  auditoría es del 2026-09-29, anterior al despliegue: no hubo altas ni bajas de
  asignaciones (las de Alexander y Marco incluidas).
- **Límite:** no se creó ni se eliminó ningún rol ni usuario real. En
  producción nunca se ha borrado un rol (`roles.n_tup_del = 0`, ningún evento
  `delete_role`), así que el comportamiento ante un borrado real se sostiene en
  que las definiciones son idénticas a las probadas en el arnés y en el
  sandbox, no en un borrado hecho en producción. Las consultas fueron solo
  `SELECT`, pero la sesión del conector no está forzada a solo lectura.

### Huella de producción

`scripts/schema-drift/huella-produccion.json` se refrescó con el lote completo
de `fingerprint.sql` (guard y CTE sin modificar; solo se quitaron las líneas de
comentario) ejecutado contra producción el 2026-10-08 15:00:48 UTC
(PostgreSQL 17.6, 864 migraciones, `main` `8a4debd`). Todos los hashes salen de
producción. Respecto de la captura del 2026-10-05: 3357 → 3357 grupos, **3
cambiados** (los cuerpos de `audit_roles_changes()`,
`audit_role_permissions_changes()` y `audit_user_roles_changes()`), 0 nuevos y 0
desaparecidos. Sus hashes nuevos coinciden con los valores «PR» que el auditor
había reportado como cambio planificado antes de fusionar, y los grants, los
triggers y las tablas no cambiaron. Con la huella nueva, el auditor de tres vías
compara 3357 grupos con 0 cambios planificados, 0 ambiguos y las 84 diferencias
de la baseline, sin cambios. `drift-conocido.json` no se tocó.

### Reversión

`git revert` no revierte DDL. Para volver al cuerpo anterior hace falta una
migración compensatoria revisada, que reintroduciría el bloqueo de DELETE; no
borrar los snapshots históricos agregados.
