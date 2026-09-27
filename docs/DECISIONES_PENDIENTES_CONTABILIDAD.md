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

### Decisiones pendientes del cierre del bloque 3 (2026-09-27)

| # | Pregunta concreta | Estado |
| --- | --- | --- |
| E6 | **`ajuste_importe`** (nota de crédito/débito sobre una cuota o cargo publicado). Hace falta decidir: **(a)** contrapartida — la misma cuenta de ingreso del devengo original (reverso parcial) o una cuenta especial «descuentos y bonificaciones» / «ajustes a ingresos»; **(b)** sólo crédito (rebaja) o también débito (aumento); **(c)** tope — no más que el saldo pendiente del documento, o se admite dejar saldo a favor; **(d)** si la mora posterior se calcula sobre el importe neto; **(e)** fecha contable = la de la ejecución (propuesta). En cualquier caso el documento y su asiento original no se sobrescriben: la nota es un documento propio, vinculado, con su asiento. | ⏸️ **Sin implementar hasta decidir** (a)–(d). |
| E7 | **Eliminar una cuota sin emitir.** Implementado en `20261012000000`: una cuota `pendiente` (sin emitir; p. ej. la tarifa de una reserva que se cancela) sin cobros ni saldo aplicado se sigue eliminando sin solicitud (su devengo lo reversa `conta_tg_cuotas`); una emitida sólo se anula por solicitud y cualquier eliminación con dependencias se rechaza. ¿Se confirma, o también la eliminación de cuotas sin emitir debe pasar por aprobación (afecta la cancelación de reservas de amenidades)? | ❓ Confirmar. |
| E8 | **Cobro en línea en curso** de una cuota: hoy bloquea su anulación (dependencia `cobro_en_linea`). Una solicitud de cobro abandonada queda `pending` sin vencimiento, así que bloquearía indefinidamente. ¿Se acepta, o se define cuándo una solicitud de cobro abandonada deja de contar (p. ej. al consultarla al proveedor)? | ❓ Confirmar. |

El detalle del bloque 3 está en [`PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md`](PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md).
