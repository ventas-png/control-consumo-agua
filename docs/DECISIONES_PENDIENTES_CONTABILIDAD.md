# Decisiones de negocio — contabilidad (PR #904)

> **Aprobadas el 2026-09-26** («ok procedamos con tus recomendaciones»).
> La columna «Estado» indica si ya está implementada y dónde.

## A. Diferencias cambiarias

| # | Decisión aprobada | Estado |
| --- | --- | --- |
| A1 | El diferencial cambiario se reconoce **en cada pago**, contra la cuenta especial `diferencial_cambiario`. La revaluación mensual queda solo para lo que sigue pendiente. | ✅ `20261010000000`. Donde hay conversión real es en **compras**: la orden de pago contra sus facturas, con el reparto escrito de la contraseña. En cuotas, cargos, cobros y saldos a favor el documento está en la moneda base de su libro, así que no hay diferencial. Si falta la cuenta especial, el pago **no se bloquea**: queda pendiente y visible en `conta_diferenciales_cambiarios` y se reprocesa con `conta_reprocesar_diferenciales_cambiarios`. |
| A2 | Aplicar saldos a favor entre monedas sigue **prohibido**. Si algún día se habilita, se usará la tasa del mes de la aplicación y la diferencia irá a `diferencial_cambiario`. | ✅ Se mantiene `SALDO_FAVOR_MONEDA_DISTINTA`. |

## B. Tasas manuales

| # | Decisión aprobada | Estado |
| --- | --- | --- |
| B1 | En una póliza manual en otra moneda se **propone la tasa mensual**. Se puede usar otra, pero solo con **motivo auditado**. | ✅ `20261010000000`: al publicar exige `tipo_cambio_motivo` (`TASA_MANUAL_SIN_MOTIVO`) y deja constancia de cada línea en `conta_tasas_manuales`. En la pantalla, la tasa del mes aparece prellenada y el motivo se pide solo cuando hace falta. |

## C. Tasas históricas

| # | Decisión aprobada | Estado |
| --- | --- | --- |
| C1 | Carga **manual** solo de los meses necesarios, con una **fuente oficial definida por escrito**: la tasa de referencia del Banguat del último día hábil del mes. No se derivan tasas de las diarias con reglas automáticas. | ⏳ Operativo, a cargo de contabilidad. No requiere código: la pantalla «Tipos de cambio (mensuales)» ya lo permite y deja bitácora. |
| C2 | Los borradores antiguos marcados «SIN TIPO DE CAMBIO» los resuelve contabilidad **uno por uno**, antes del primer cierre mensual posterior al despliegue. | ✅ Mecanismo en `20261009000000` (`conta_borrador_tc_asignar_periodo`). Hoy hay 0 en producción. |

## D. Saldos a favor

| # | Decisión aprobada | Estado |
| --- | --- | --- |
| D1 | Se mantiene el **bloqueo** del rechazo de un cobro cuyo saldo ya se aplicó. La reversión en cascada se evaluará dentro del flujo de aprobación del bloque 3. | ✅ Se mantiene `COBRO_SALDO_FAVOR_APLICADO`. |
| D2 | Con `aplicar_sobre = 'saldo_vencido'` la mora se calcula sobre el **saldo pendiente**. Con `'monto_cuota'`, sobre el monto completo, sin cambios. | ✅ `20261010000000`: el saldo es el monto menos los cobros verificados vivos y menos los saldos a favor aplicados vivos. Lo calcula la función nueva `conta_aplicar_mora_cuotas`, a la que pasa a llamar el job diario; `aplicar_mora_cuotas_vencidas` no se toca porque es drift declarado (#826). **Cambia** el cálculo de los proyectos con `saldo_vencido` que tengan abonos parciales. |

## E. Autorizaciones del bloque 3

Corregidas el 2026-09-27 por indicación expresa: E1 queda **sin** la excepción
de «único aprobador», y los plazos de E2/E3 son **propuestas**, no decisiones.

| # | Decisión | Estado |
| --- | --- | --- |
| E1 | Quien solicita un ajuste **no** puede aprobarlo (cuatro ojos). **Única excepción: el `company_owner`**, y sólo con **confirmación explícita** (`p_confirmar_autoaprobacion = true`); la autoaprobación queda marcada en la solicitud y en su bitácora. **No** hay excepción por «único aprobador». | ✅ Aprobada · implementada en `20261011000000` (`AJUSTE_AUTOAPROBACION_NO_PERMITIDA`, `AJUSTE_AUTOAPROBACION_SIN_CONFIRMAR`). |
| E2 | **Sin umbral monetario.** | ✅ Aprobada · implementada (no hay umbral en el flujo). |
| E2′ | Revisar el umbral con unos tres meses de datos reales. | 📝 **Propuesta**, no decisión. No hay código. |
| E3 | Las solicitudes pendientes **no vencen** automáticamente. | ✅ Aprobada · implementada (ningún proceso cambia su estado por antigüedad). |
| E3′ | Recordatorio a los 7 días y marca de «estancada» a los 30. | 📝 **Propuesta**, no decisión. No hay código ni cron. |
| E4 | El residente **solicita** desde el portal la aplicación de su saldo a favor; contabilidad la aprueba y la ejecuta. El residente no aplica directamente. | ✅ Aprobada · implementada en `20261011000000` (`portal_solicitar_aplicacion_saldo_favor`) y en el portal. |
| E5 | Igual que D1: se mantiene el bloqueo, sin cascada automática. Un reembolso confirmado por el proveedor **se conserva** y abre una incidencia visible de conciliación. | ✅ Aprobada · implementada en `20261011000000` (`conta_incidencias_conciliacion`). |

### Decisiones pendientes del cierre del bloque 3 (actualizado 2026-10-01)

**Ninguna de estas tres está aprobada.** E7 tiene código, pero su alcance sigue esperando
confirmación; E6 y E8 no tienen código.

| # | Qué hay que decidir | Qué existe hoy | Qué pasa mientras no se decide |
| --- | --- | --- | --- |
| E6 | Las cuatro reglas de `ajuste_importe`: contrapartida, crédito y/o débito, tope, base de la mora | Nada (ni tabla, ni tipo de solicitud, ni pantalla) | No hay forma de rebajar o aumentar el importe de una cuota o un cargo; sólo anularlo por solicitud |
| E7 | ¿Cancelar la reserva basta para eliminar su tarifa **sin** aprobación, o también debe pasar por solicitud? | Implementado como «basta» (`20261014000000`), con pruebas | Se aplica esa regla; si la respuesta es «no basta», se cambia por una correctiva que exija solicitud también para ese caso |
| E8 | Cuándo consultar al proveedor por un cobro abandonado (N horas), quién puede pedir la consulta manual, y cómo se trata QPayPro sin consulta servidor a servidor | Nada del flujo de consulta. Sí la protección de la confirmación tardía (abajo), que **no** depende de esta decisión | Un cobro `pending` sigue bloqueando la anulación de su cuota sin plazo; nada se libera por antigüedad |


#### E6 · `ajuste_importe` — ⏸️ PENDIENTE de decisión, sin implementar

Faltan las cuatro reglas: **(a)** contrapartida (la cuenta de ingreso del devengo original o una
cuenta especial de ajustes/bonificaciones); **(b)** sólo crédito (rebaja) o también débito
(aumento); **(c)** tope (no más que el saldo pendiente del documento, o se admite dejar saldo a
favor); **(d)** si la mora posterior se calcula sobre el importe neto. Propuesta para (e): fecha
contable = la de la ejecución.

Qué falta implementar una vez definidas (nada de esto existe hoy):
1. Tabla `conta_notas_ajuste` (documento propio, vinculado a la cuota o cargo; inmutable): tipo
   crédito/débito según (b), importe, motivo, solicitud, asiento.
2. Tipo `ajuste_importe` en el flujo (`conta_ajuste_solicitar/revalidar/ejecutar`): foto con el saldo,
   revalidación del tope (c), período abierto, sin cambiar `monto` del documento.
3. Generación del asiento de la nota contra la cuenta de (a), con el auxiliar y la unidad del
   devengo; el asiento original no se toca.
4. Saldos: `conta_cuota_saldo_cobro`, `conta_cargo_saldo_cobro`, `conta_cargo_saldo_pagable`,
   `portal_documentos_con_saldo` y el estado de cuenta (al corte) restando/sumando las notas
   vivas; mora según (d) en `conta_aplicar_mora_cuotas`.
5. Pantalla (solicitar desde Cuotas y Cargos), pruebas SQL (permisos, aislamiento, doble
   aprobación, concurrencia contra cobros, período cerrado, tope) y vitest.

#### E7 · eliminar cuotas sin aprobación — ❓ PENDIENTE de confirmación (implementado en `20261014000000`)

`cuota_estado = 'pendiente'` **no** distingue una cuota sin emitir de una pendiente de pago: es el
valor por defecto de toda cuota hasta el cierre de ciclo, y una cuota 'pendiente' ya tiene su
devengo contabilizado (al insertarse), el residente la ve como deuda y está en la cuenta por cobrar.
Lo prueba `supabase/tests/conta_ajustes/assert_b.sql` §12 (QF2: 'pendiente', devengo vivo, visible en
el portal, 30 en la CxC del libro → eliminarla exige solicitud).

Regla implementada: sin solicitud sólo se elimina la **tarifa de una reserva de amenidad ya
cancelada** (`reservas_amenidades.cuota_id`, `estado = 'cancelada'`), sin emitir
(`cuota_estado = 'pendiente'` **y** `emitida_at` nulo) y sin dependencias. Todo lo demás se anula
por solicitud. La pantalla de amenidades cancela primero la reserva y después elimina su tarifa;
cuando falla guardar una reserva y ya se generó el cargo, ya no lo borra: solicita su anulación.
**Confirmar**: ¿la cancelación de la reserva basta como autorización para eliminar su tarifa, o
también debe pasar por aprobación?

#### E8 · cobros en línea abandonados — ❓ PENDIENTE de decisión, propuesta sin implementar

Hoy una solicitud de cobro `pending` de una cuota bloquea su anulación sin plazo (dependencia
`cobro_en_linea`). Flujo propuesto (la antigüedad sólo decide **cuándo preguntar**, nunca libera):

1. **Detección**: solicitudes `pending`/`pending_verification` con más de N horas (N a definir) o a
   pedido de Contabilidad («Consultar al proveedor» en la incidencia o en la dependencia).
2. **Consulta al proveedor desde el servidor** (`provider.consultarEstado`), registrada con
   `pasarela_registrar_estado(origen = 'consulta')`: el aviso queda en `pasarela_eventos` con el
   estado crudo del proveedor en `payload`, deduplicado.
   - `aprobado` → se concilia como hoy (o se retiene, si la cuota ya se anuló: ver abajo).
   - estado **final** de no-cobro informado por el proveedor (Stripe: PaymentIntent `canceled`;
     sesión de checkout `expired`) → `rechazado` → la solicitud pasa a `failed` y deja de ser
     dependencia.
   - `pendiente`, sin respuesta o error → no cambia nada; queda el intento registrado.
3. **QPayPro**: su `consultarEstado` todavía no consulta al proveedor (devuelve `pendiente` por
   diseño: `_shared/payments/qpayproProvider.ts`). Hasta cablear el endpoint confirmado, sus cobros
   abandonados **no** se liberan automáticamente: Contabilidad verifica en el panel de QPayPro y
   registra el resultado con evidencia (a decidir: quién y con qué respaldo).
4. **Trazabilidad**: cada consulta y su resultado en `pasarela_eventos`; cada liberación enlazada al
   evento del proveedor que la justifica; nada se libera por fecha.

**Decidir**: N, quién puede pedir una consulta manual, y el tratamiento de QPayPro.

### Protección implementada (no es una decisión): confirmación tardía sobre una cuota anulada

Separada de E8 a propósito: vale para cualquier «aprobado» tardío, venga del webhook, del retorno
del portal o de una consulta futura, y no fija cuándo consultar. Implementada en `20261015000000`.

- **Antes**: una solicitud `failed` no impide anular la cuota. Si después el proveedor confirmaba
  el cobro, el pago chocaba con `COBRO_CUOTA_ANULADA` (o «cuota no encontrada» si estaba eliminada),
  la transacción revertía entera —incluido el aviso— y el webhook reintentaba sin fin. El dinero
  cobrado no quedaba escrito en ninguna parte.
- **Ahora** (`pasarela_registrar_estado`): se conserva el evento; la solicitud pasa a
  `pending_verification`; **no** se registra pago ni se acredita nada; se abre **una** incidencia
  visible `cobro_sobre_documento_anulado` por solicitud (índice único). Avisos repetidos —misma
  clave, otra clave, consulta— o simultáneos sólo dejan su evento. Un «rechazado» posterior no la
  pasa a `failed`; un reembolso posterior del proveedor la deja `refunded` sin tocar contabilidad.
- **Sin decisiones automáticas**: el dinero no se devuelve ni se convierte en saldo a favor. Cada
  caso lo resuelve una persona (reembolsar en el proveedor, o registrar un anticipo por el flujo de
  ajustes) y cierra la incidencia con nota.
- **Concurrencia**: se bloquea la solicitud y luego la cuota, el mismo orden que la conciliación.
  O la anulación termina primero y el aviso queda retenido, o el cobro entra primero y la anulación
  falla por dependencias. Pruebas: `supabase/tests/conta_ajustes/assert_b.sql` §20 y sesiones reales
  I/J/K en `run.sh`.
- **Edges**: `confirm-charge` ya no corta con 404 una cuota eliminada y responde `en_revision`; el
  webhook de Stripe responde 200 sin conciliar (reintentar no cambiaría nada); el portal no anuncia
  un abono que no existe.
- **Corrección `20261016000000`**: (1) un reembolso TOTAL confirmado antes de la aprobación deja la
  solicitud `refunded` (sin pago que reversar; evento e incidencia como rastro) y una aprobación
  atrasada ya no crea ni acredita pago; una sola incidencia `aprobado_tras_reembolso` por solicitud.
  (2) La respuesta describe el estado guardado (`conciliado`, `en_revision`, `reembolsado`), también
  en avisos duplicados: la segunda consulta de un cobro retenido sigue en revisión. Los edges y el
  portal deciden por esos campos, nunca por `accion`, y no muestran saldo 0 si no vino.
- **Fuera de alcance, sin cambios**: un cargo adicional anulado ya tenía otro camino
  (`20261011000000`): el pago se registra y su contabilización queda pendiente, visible en
  Contabilidad. Un recibo de agua eliminado sigue fallando como antes.

El detalle del bloque 3 está en [`PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md`](PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md).
