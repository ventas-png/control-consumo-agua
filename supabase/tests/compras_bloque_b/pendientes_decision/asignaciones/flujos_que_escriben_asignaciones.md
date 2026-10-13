# Flujos que ESCRIBEN `user_project_assignments` (grep en `src/` y `supabase/functions`, repo en HEAD `5c070570`; el repo no se editó)

Comandos: `grep -rn "user_project_assignments" src supabase/functions --include=*.ts --include=*.tsx`, más las búsquedas de `INSERT INTO|DELETE FROM|UPDATE` sobre la tabla en `supabase/`, `scripts/`, `e2e/` y `docs/`.

## 1. Escrituras desde el navegador (pasan por RLS: son las que cambian con la corrección)

| # | Dónde | Qué hace | Quién lo usa | Efecto de `fix_asignaciones.sql` |
|---|---|---|---|---|
| 1 | `src/domain/empresa/usuarios.ts` → `deleteUserProjectAssignments(userId)` (`.delete().eq('user_id', userId)`) y `insertUserProjectAssignments(rows)` (`.insert(rows)`), llamadas SOLO desde `src/components/empresa/AsignacionModal.tsx` (`guardar()`: paso 1 borra todas las de la persona, paso 2 inserta las nuevas con `permission_type: 'total'`) | Reemplaza las asignaciones de proyecto de **la persona que se edita** | `EmpresaUsuariosSection.tsx` (botón por usuario, línea ~374 `setUsuarioAsignar(u)`; la lista `usuarios.map(u => …)` incluye a la propia persona): administrador, propietario, superadministrador | **Sin cambio** cuando se edita a OTRA persona (admin: proyectos de su empresa que él ve; propietario: de su empresa; superadministrador: cualquiera). **Cambia** solo si un administrador se edita a SÍ MISMO: el INSERT/DELETE ahora da error de RLS y la pantalla muestra «Error al guardar las asignaciones» (propietario y superadministrador pueden, son exentos). Es justo el hueco que se cierra |

No hay ningún otro `.insert/.update/.delete/.upsert` sobre la tabla en `src/` (las demás referencias son LECTURAS con `.select('project_id')`): `src/domain/agua/queries.ts:91`, `src/domain/contadores/queries.ts:44`, `src/domain/unidades/queries.ts:27`, `src/domain/empresa/usuarios.ts:25` (`fetchUserProjectAssignments`), más `src/lib/proyectosAccess.ts` (comentarios) y `src/types/database.types.ts`. Las lecturas usan la política SELECT, que NO se toca (cada persona lee las suyas).

## 2. Edge functions (`supabase/functions`)

| Función | Uso de la tabla | Pasa por RLS | Efecto |
|---|---|---|---|
| `create-broadcast/index.ts:113` | `.select('project_id')` con el cliente de servicio (`adminClient`): LEE las asignaciones del emisor y las usa como límite de autorización («difundir por proyecto a uno que no tienes asignado» → 403) | No (servicio) | Ninguno. Ojo: **depende de que la tabla sea una frontera real**; con el hueco actual, un usuario acotado se asigna el proyecto y la edge lo deja difundir |
| `notify-package/__tests__/handler.test.ts:128` | solo comprueba que NO lee la tabla | — | Ninguno |
| `create-user`, `invite-user`, `accept-invitation`, `signup-company`, `delete-user` | **No tocan la tabla** (`grep` vacío): crean/invitan/borran personas y roles; la asignación de proyecto se hace después desde la pantalla (flujo 1) | — | Ninguno |

## 3. Escrituras que NO pasan por RLS (superusuario / rol de servicio; no cambian)

* `scripts/seed-rls-sandbox.mjs` (líneas ~486-503): `admin.from('user_project_assignments').upsert/delete` con el cliente de servicio, para sembrar el sandbox.
* `scripts/rls-evidencias-datos.sql:61` y `scripts/rls-evidencias-sandbox.sql`: INSERT como superusuario/SQL Editor.
* Pruebas SQL del repo (`supabase/tests/**/fixture.sql`, `assert_*.sql`, `hallazgos/*.sql`: INSERT como superusuario antes de cambiar de rol): ninguna escribe la tabla como `authenticated`.

## 4. Qué comprobar al llevarlo como PR

1. Que en producción nadie dependa de que un administrador se edite a sí mismo en `AsignacionModal` (hoy la RLS lo permite; si hace falta, la variante mínima de `README.md` §«Variantes»).
2. Ajustar el aviso de la pantalla: el `alert` genérico de `AsignacionModal.guardar()` («Error al guardar las asignaciones») bastaría, pero un texto específico para el administrador que se edita a sí mismo evita confusión.
3. Correr `ASG-1.sql` (rojo sin la corrección, verde con ella) y la secuencia de suites del repo con la corrección aplicada (ver `README.md`, «Verificación»).
