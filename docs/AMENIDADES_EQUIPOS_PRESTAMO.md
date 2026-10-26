# Equipo del inventario en las reservas de amenidades

Migración `20261108000000_amenidades_inventario_prestamos.sql`.

## Qué resuelve

Antes, «Préstamo de equipos» era una libreta suelta: el equipo se tecleaba como
texto, no sabía de qué fila del inventario salía ni a qué reserva pertenecía, y
nada limitaba cuánto se podía prestar de algo que ya estaba en circulación. El
residente pedía las sillas en las notas de la reserva y alguien lo apuntaba a
mano; al cerrar no quedaba constancia de qué se entregó, qué volvió ni cuánto
costaba lo que faltó.

Ahora:

1. **La amenidad dice qué equipo se presta con ella** (`amenidad_inventario`):
   filas del inventario del condominio con un tope opcional por reserva. Se
   configura en Instalaciones › Amenidades, al crear o editar la amenidad
   («Equipo que el residente puede solicitar»).
2. **El residente lo pide al reservar.** El portal consulta el catálogo con la
   disponibilidad para la fecha (`portal_equipos_amenidad`) y la solicitud
   viaja con la reserva (`portal_reservar_amenidad`, parámetro `p_equipos`).
   Cada línea nace como préstamo `solicitado` en la misma transacción: si no
   alcanza, la reserva entera se rechaza y el mensaje dice qué faltó.
3. **La administración entrega y recibe** desde el detalle de la reserva
   (paso «Equipo», junto al check-in y check-out) o desde Operaciones ›
   Préstamo de equipos. Entregar y recibir son RPC (`prestamos_equipo_entregar`,
   `prestamos_equipo_recibir`): varias filas en una transacción, fecha y hora
   del servidor, quién entregó y quién recibió.
4. **Lo que falta cuesta reposición.** Al prestar se congela el costo unitario
   del inventario (`costo_reposicion_unitario`). Al recibir se registra cuánto
   volvió y en qué estado (devuelto / dañado / perdido); la reposición se
   propone como faltantes × costo congelado y la administración puede
   ajustarla. Con «Generar cargo a la unidad» se crea una sola cuota
   `amenidad` por el total y queda ligada a cada préstamo
   (`cuota_reposicion_id`). Si no se genera, el monto queda visible para
   retenerlo del depósito.
5. **Lo que está en circulación limita lo que se puede pedir.** La
   disponibilidad de un equipo para una fecha es: cantidad del inventario
   (0 si está de baja o en reparación) − lo prestado (cualquier fecha) − lo ya
   solicitado para esa misma fecha. La impone el trigger de `prestamos_equipo`
   bajo lock de la fila del inventario, así que vale para el portal, el panel
   y cualquier otra escritura.
6. **Cancelar una reserva cancela su equipo no entregado** (trigger en
   `reservas_amenidades`), venga del portal o del panel.

## Estados de un préstamo

| Estado | Significado |
| --- | --- |
| `solicitado` | Pedido con la reserva; aún no se entrega. Descuenta disponibilidad para la fecha de la reserva. |
| `prestado` | En circulación. Descuenta disponibilidad para cualquier fecha. |
| `devuelto` / `dañado` / `perdido` | Cerrado al recibir. `cantidad_devuelta` y `monto_reposicion` dicen qué volvió y qué se debe. |
| `cancelado` | No se entregó (la reserva se canceló o se cerró la solicitud sin entrega). |

`cantidad` es siempre lo **entregado** (lo pedido mientras sigue solicitado);
`cantidad_solicitada` conserva lo que pidió el residente.

## Permisos

- Configurar el equipo de una amenidad: acción `amenidades.edit` (o `create`
  al crearla).
- Pedir equipo desde el portal: el residente de la unidad; el staff con
  `condominios.tab.amenidades` desde la vista previa del portal.
- Agregar equipo a una reserva desde el panel: `amenidades.edit`/`create` o
  `prestamos.create`.
- Entregar y recibir: `prestamos.edit`, o `amenidades.edit` cuando el préstamo
  cuelga de una reserva (quien hace el check-in/check-out no necesita
  administrar el tab de préstamos).
- El residente ve los préstamos de su unidad (policy de 20260713030000) y el
  catálogo sólo por RPC: no ve los préstamos de otras unidades, por eso no
  calcula la disponibilidad él mismo.

## Dónde mirar

- SQL: `supabase/migrations/20261108000000_amenidades_inventario_prestamos.sql`.
- Reglas puras (espejo del SQL para avisar antes de escribir):
  `src/lib/prestamosEquipo.ts`.
- RPC desde el cliente: `src/domain/condominios/prestamosEquipo.ts` (panel) y
  `src/domain/portal/reservas.ts` (portal).
- Pantallas: `tabs/amenidades/SelectorEquiposAmenidad.tsx` (configuración),
  `SelectorEquiposReserva.tsx` (pedir desde el panel), `EquiposReserva.tsx`
  (paso del detalle de la reserva), `PrestamoEquiposTab.tsx`,
  `PortalReservasTab.tsx` (portal).
- Harness RLS: `portal_equipos_amenidad` está declarada `tenant` en
  `src/test/rls/coverage.json` y se ejercita en `rlsHarness.test.ts`.
