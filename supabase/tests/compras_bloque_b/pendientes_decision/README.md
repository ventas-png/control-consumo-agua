# Pendientes de decisión (fuera de `run.sh` y de la migración)

Aquí queda **solo lo que sigue pendiente**. Lo que estaba en esta carpeta en la ronda anterior se resolvió en la migración
`20261027000900` y ya vive en `hallazgos/`:

| Antes (prototipo) | Ahora |
|---|---|
| `P-2.interruptor_solo_admin*.sql` (el interruptor de la separación solo en manos del administrador) | `hallazgos/SEP-*.sql`, `SEP-conc`, `SEP-idempotencia`, `SEP-reversion` + pieza 2 de la migración (RPC `compras_separacion_configurar`, bitácora protegida) |
| `RG-4.alternativa_A.sql`, `RG-4.prueba.sql`, `RG-4.comparacion*` (números de factura) | `hallazgos/RG-4*.{sql,sh}` + pieza 3 de la migración (la comparación de las seis variantes sobre 20 pares sigue en `docs/COMPRAS_CONTROLES_SERVIDOR.md`) |

## Pendiente: `asignaciones/` — cualquier usuario puede asignarse proyectos (RLS de `user_project_assignments`)

Defecto **preexistente** (no de este PR), verificado en producción en solo lectura. Anula el alcance por proyecto de todo el sistema
frente a un usuario hostil. Se entrega **aparte** (corrección + reversión + prueba `ASG-1.sql` + flujos de la aplicación que escriben la
tabla) para llevarlo como PR y despliegue propios: cambia quién puede escribir asignaciones y toca la pantalla de administración de
usuarios. Ver `asignaciones/README.md`. `ASG-1.sql` **no** debe copiarse a `hallazgos/` sin la corrección (`run.sh` la recogería y saldría roja).
