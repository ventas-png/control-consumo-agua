# PENDIENTE (fuera de la pieza de permisos y de la migración 0900) · cualquier usuario puede asignarse proyectos

**Estado: NO corregido ni en la pieza de permisos ni en la 0900; entregado aparte para que alguien lo lleve como PR y despliegue propios.**
Hallazgo del segundo escéptico independiente de la ronda 2 del PR #926, PREEXISTENTE (`supabase/migrations/20260417000013_consolidate_rls_policies_part2.sql`, líneas 548-580) y verificado en producción con una consulta de SOLO LECTURA (2026-10-10).

## En una frase
Las políticas INSERT / UPDATE / DELETE de `public.user_project_assignments` terminan en `OR user_id = (SELECT auth.uid())`: cualquier usuario autenticado, de cualquier rol, puede insertarse una asignación a CUALQUIER proyecto (también de otra empresa) y un administrador con asignaciones puede borrar las suyas y quedar «exento de proyecto». Como `can_access_project()` y `user_is_project_exempt()` leen esa tabla, **el alcance de proyecto que la pieza de permisos refuerza (las seis acciones, mover documentos, las políticas SELECT por proyecto, `create-broadcast`) no es un límite real contra un usuario hostil** hasta que esto se cierre. Mientras no se cierre, ni el informe ni la propuesta de asignaciones deben presentar la asignación de proyecto como límite de seguridad.

## Contenido de esta carpeta
| Archivo | Qué es |
|---|---|
| `politica_actual_produccion.md` | La política ACTUAL de producción (4 políticas, texto de `pg_get_expr`), obtenida con un `SELECT` sobre `pg_policy` (solo lectura, 2026-10-10); es idéntica a la que sale de la cadena de migraciones del repo (0 líneas distintas) |
| `fix_asignaciones.sql` | **La corrección** (solo políticas RLS; sin datos, funciones ni grants). Idempotente; con `SET LOCAL lock_timeout` |
| `reversion_asignaciones.sql` | **Su reversión**: devuelve las tres políticas EXACTAMENTE a su texto original (comprobado comparando `pg_get_expr` de las 4 políticas: 0 líneas distintas). Idempotente |
| `ASG-1.sql` | **Prueba SQL de estilo del repo** (`\set ON_ERROR_STOP on`, `chk*`, un NOTICE `✓` por comprobación, ids `fa570000-…`): catálogo, no se puede (operador, administrador parcial, administrador exento, administrador de otra empresa), lo legítimo (lo que hace `AsignacionModal`), leer, efecto final y limpieza. **NO copiar a `hallazgos/` sin la corrección**: `run.sh` la recoge por el glob y saldría roja (ese es su sentido) |
| `flujos_que_escriben_asignaciones.md` | Los flujos de la aplicación (`src/`, `supabase/functions`) que escriben la tabla, y el efecto de la corrección en cada uno |

## La corrección
(Se probó con `ASG-1.sql`, que cubre al operador, al administrador parcial, al administrador exento, al de otra empresa, al propietario y al superadministrador.)

Altas, cambios y bajas de asignaciones: **superadministrador** (cualquiera); **propietario** de la empresa (`company_owner`; proyectos de su empresa; también las suyas: es exento); **administrador** (proyectos de su empresa, a OTRAS personas, nunca a sí mismo). La persona conserva LEER las suyas (la política SELECT no se toca). Quedan 4 políticas con los mismos nombres.

## Evidencia (copia desechable de la base de la cadena de migraciones)
```
ROJO  sin la corrección: ASG-1 → 3 bloques fallan, 26 comprobaciones de control pasan:
  [catálogo] la política de ESCRITURA «insert» ya no tiene la rama «user_id = auth.uid()» — esperado f, recibido t
  [operador] no se inserta una asignación propia a otro proyecto de su empresa (C1) — NO falló, y tenía que fallar
  [administrador] no se asigna a sí mismo otro proyecto de su empresa (C1) — NO falló, y tenía que fallar
VERDE con la corrección (aplicada ×2, ASG-1 ejecutada ×2 en la misma base): ✓ 45 y ✓ 45, 0 errores
REVERSIÓN (×2): políticas revertidas == originales (0 líneas distintas); ASG-1 vuelve a ponerse roja
REPRODUCCIÓN: sin la corrección S1 INSERT de MI asignación al proyecto B → OK filas=1; después S2/S3/S4 OK filas=1 (aprobar factura, anular orden de pago, mover borrador de B)
              D1 admin parcial borra SUS asignaciones → OK filas=1, exento f → t
              con la corrección: S1 → ERR 42501 (RLS); S2/S3/S4 → OK filas=0; D1 → OK filas=0, exento f → f
```

## Variantes y decisiones para quien lo lleve
* **Compensación de la corrección completa**: un administrador ya no puede editar SUS PROPIAS asignaciones desde la pantalla (lo hace otro administrador, el propietario o el superadministrador). Es deliberado: es el camino por el que un administrador con asignaciones se vuelve exento.
* **Variante mínima** (si el producto necesita que el administrador se edite a sí mismo): quitar SOLO `OR user_id = (SELECT auth.uid())` de INSERT y UPDATE (cierra el camino de operadores, visores y de otra empresa) y decidir aparte el de «administrador exento por borrarse» (DELETE de las propias). `ASG-1.sql` habría que adaptarla (los casos de administrador).
* **No incluido (observación)**: las políticas comprueban que el PROYECTO sea de la empresa de quien administra, pero no que la PERSONA (`user_id`) lo sea; un administrador de C podría crear una asignación de una persona de D a un proyecto de C. No da acceso por sí sola (casi todas las políticas piden además `company_id = get_my_company_id()`), pero conviene cerrarlo en el mismo PR (`user_id IN (SELECT id FROM app_users WHERE company_id = get_my_company_id())` en INSERT/UPDATE).
* Despliegue: `DROP POLICY` / `CREATE POLICY` toman ACCESS EXCLUSIVE sobre la tabla (medido: `ALTER POLICY` también); tabla pequeña, breve; va tras el `SET LOCAL lock_timeout`. Sin cambios de datos: la reversión es inmediata y exacta.

## Verificación que debe repetir quien lo lleve
1. En una base desechable con la cadena de migraciones: aplicar `fix_asignaciones.sql` (dos veces), correr `ASG-1.sql` (dos veces) y `reversion_asignaciones.sql`; `ASG-1.sql` debe ponerse **roja sin la corrección** y verde con ella.
2. Copiar `ASG-1.sql` a `supabase/tests/compras_bloque_b/hallazgos/` **junto con** la migración de la corrección y correr `bash supabase/tests/compras_bloque_b/run.sh`.
3. Con la corrección aplicada, la secuencia de suites del repo debe dar el mismo resultado que sin ella (en la entrega de origen: 39 verdes + 1 roja preexistente, `assert_operaciones`, idéntico archivo por archivo).
4. Confirmar en producción, antes de aplicar, que la política es la de `politica_actual_produccion.md` (el `SELECT` de ese archivo).
5. Revisar los flujos de `flujos_que_escriben_asignaciones.md` en la pantalla (administración de usuarios) y en las funciones de borde.
