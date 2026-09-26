# Decisiones de negocio pendientes — contabilidad (PR #904)

> Estas decisiones **no están tomadas** y el código no las presupone. Mientras no
> se decidan, rige lo que está implementado (columna «Hoy»). Ampliar el alcance
> de cualquiera de estos puntos requiere la decisión primero.

Reglas vigentes que **se conservan** hasta que se apruebe otra:

- **Rechazo de un cobro cuyo saldo a favor ya se aplicó: bloqueado**
  (`COBRO_SALDO_FAVOR_APLICADO`). Primero se revierten las aplicaciones y después
  se rechaza el cobro.
- **Aplicación de saldos a favor entre monedas: prohibida**
  (`SALDO_FAVOR_MONEDA_DISTINTA`).

## A. Diferencias cambiarias

| # | Decisión | Hoy | Opciones |
| --- | --- | --- | --- |
| A1 | **Cobro o pago en un mes distinto al del documento.** El documento se convierte con la tasa de su mes y el cobro con la del mes del cobro. La diferencia entre ambas conversiones es un diferencial cambiario. | El diferencial queda en la CxC hasta la revaluación mensual (`conta_revaluar_fx`). No se reconoce en cada cobro. | (a) Mantenerlo así. (b) Reconocer el diferencial **realizado** en cada cobro, contra la cuenta especial `diferencial_cambiario`. (c) Cobrar el documento con la tasa de su propio mes. No se recomienda (c): contradice «la tasa del mes». |
| A2 | **Aplicación de saldo a favor entre monedas.** | Prohibida. | Si se habilita: con qué tasa se convierte (la del mes de la aplicación o la del mes del origen) y a qué cuenta va el diferencial. |

## B. Tasas manuales

| # | Decisión | Hoy | Opciones |
| --- | --- | --- | --- |
| B1 | **Asientos manuales con líneas en otra moneda.** | La tasa la escribe el usuario en cada línea. Desde `20261009000000`, un borrador con tasa 1 que **no** corresponde a una paridad 1:1 configurada para ese mes no se publica (`CONVERSION_PENDIENTE`). | (a) Mantener la tasa escrita por el usuario. (b) Forzar la tasa mensual configurada. (c) Permitir una tasa distinta con motivo y auditoría. |

## C. Carga de tasas históricas

| # | Decisión | Hoy | Opciones |
| --- | --- | --- | --- |
| C1 | **Meses anteriores con documentos en otra moneda.** | Las tasas diarias existentes se conservan como referencia, pero **no convierten**. Un documento de un mes sin tasa mensual queda como borrador pendiente. En producción no hay hoy borradores con importes sin convertir (lectura del 2026-09-26). | (a) Contabilidad carga a mano la tasa de cada mes necesario. (b) Regla explícita para derivarla de las diarias, por ejemplo «la última del mes» o «el promedio del mes». Una regla así sería una carga única, auditada y con fecha. |
| C2 | **Borradores antiguos con la marca «SIN TIPO DE CAMBIO».** | No se publican. Una persona con permiso de editar les asigna el mes cuya tasa corresponde (`conta_borrador_tc_asignar_periodo`, con motivo) o los anula. El mes **no se infiere**: la fecha pudo haberse movido a «hoy» por un período cerrado. | ¿Quién los revisa y en qué plazo? ¿Se permite asignarlos en lote? |

## D. Saldos a favor (bloque 1)

| # | Decisión | Hoy | Opciones |
| --- | --- | --- | --- |
| D1 | **Rechazo de un cobro con saldo ya aplicado.** | Bloqueado (se conserva). | Revertir las aplicaciones **en cascada** dentro del rechazo, con motivo y evidencia por aplicación. |
| D2 | **Cuota cubierta parcialmente por saldo a favor.** | La cuota sigue abierta. El cobro en línea cobra solo el resto. El cron de mora calcula el recargo sobre el monto completo de la cuota, igual que con los abonos parciales. | ¿La mora se calcula sobre el saldo pendiente? Esto cambiaría también los abonos parciales. |

La cuota **totalmente** cubierta ya **no** es una decisión pendiente: la regla de
`20261009000000` la marca pagada y la restaura si vuelve a deber. El detalle
está en el PR.

## E. Autorizaciones del bloque 3 (propuesta sin código)

El detalle está en [`PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md`](PROPUESTA_AJUSTES_ANULACIONES_PORTAL.md), §7.

| # | Decisión | Propuesta |
| --- | --- | --- |
| E1 | ¿Puede quien solicita un ajuste aprobarlo él mismo? | No («cuatro ojos»), salvo el `company_owner` o una empresa con un solo aprobador. |
| E2 | ¿Hay un umbral monetario? | No se propone ninguno. Si lo hay: monto, moneda y quién aprueba por encima. |
| E3 | ¿Vencen las solicitudes pendientes? ¿Se notifican? | Sin propuesta; la decide el negocio. |
| E4 | ¿El residente aplica su propio saldo a favor desde el portal? | No: lo solicita y contabilidad lo aplica. |
| E5 | Rechazo de un cobro con saldo aplicado dentro de una solicitud aprobada. | La misma decisión que D1. |
