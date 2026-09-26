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
| D2 | Con `aplicar_sobre = 'saldo_vencido'` la mora se calcula sobre el **saldo pendiente**. Con `'monto_cuota'`, sobre el monto completo, sin cambios. | ✅ `20261010000000`: el saldo es el monto menos los cobros verificados vivos y menos los saldos a favor aplicados vivos. **Cambia** el cálculo de los proyectos con `saldo_vencido` que tengan abonos parciales. |

## E. Autorizaciones del bloque 3 (el código se implementa aparte)

| # | Decisión aprobada |
| --- | --- |
| E1 | Quien solicita un ajuste **no** puede aprobarlo (principio de «cuatro ojos»). Excepciones: el `company_owner`, o una empresa con un solo aprobador. En ambos casos queda marcado como autoaprobación. |
| E2 | **Sin umbral monetario** al inicio. Se revisa con unos tres meses de datos reales. |
| E3 | Las solicitudes pendientes **no vencen solas**: recordatorio a los aprobadores a los 7 días y marca de «estancada» a los 30. |
| E4 | El residente **solicita** la aplicación de su saldo a favor. La aplica contabilidad. |
| E5 | Igual que D1: se mantiene el bloqueo. |

El detalle del bloque 3 está en [`PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md`](PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md).
