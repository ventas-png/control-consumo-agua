# Auditoría al eliminar roles

## Causa y alcance

`trg_audit_roles` es AFTER DELETE. Su función insertaba `OLD.id` en una FK
que apunta a un rol que ya no existe. La eliminación se revertía por
`permission_audit_log_target_role_id_fkey`. Los triggers de permisos y
asignaciones tienen el mismo riesgo durante un DELETE CASCADE.

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
rol sigue existiendo; en cascada se usa NULL y el snapshot permanece.

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
- Las pruebas y la sustitución de funciones se revirtieron al terminar;
  no constituyen un despliegue persistente. Producción no recibió este arreglo.
- `migrations-guard`, sintaxis del arnés y `git diff --check` sin hallazgos.

Regresión reproducible: el arnés de PostgreSQL desechable
`supabase/tests/compras_cierre_tecnico/run.sh` ejecuta el control negativo,
aplica esta migración dos veces y corre `supabase/tests/auditoria_roles/assert.sql`.
Ya forma parte de Coverage gate. No se ejecutó localmente el arnés completo
por falta de `initdb`; su resultado debe verificarse en CI antes de fusionar.

## Despliegue y limpieza

Este PR queda sin fusionar. Aplicar sólo la migración nueva en el sandbox
mediante el workflow existente, respetando su validación de versión pendiente.
Después, ejecutar la regresión y eliminar únicamente el rol temporal
`f9220000-0000-4000-8000-000000000001` (PR922 temporal operaciones crear),
verificando primero que no tenga usuarios ni permisos. Confirmar que su
evento delete_role conserve el ID, nombre y empresa y que la FK sea NULL.
No desactivar triggers ni borrar el evento para limpiar.

La fusión posterior de este PR despliega la migración a producción; requiere
aprobación independiente. `git revert` no revierte DDL. Para volver al cuerpo
anterior hace falta una migración compensatoria revisada, que reintroduciría
el bloqueo de DELETE; no borrar los snapshots históricos agregados.
