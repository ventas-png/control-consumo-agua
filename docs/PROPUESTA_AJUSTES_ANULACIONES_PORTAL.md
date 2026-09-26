# Propuesta — Ajustes, anulaciones y extensión a portal y pasarela (funcional 3)

> **Estado: decisiones E1–E5 APROBADAS el 2026-09-26** (ver
> [`DECISIONES_PENDIENTES_CONTABILIDAD.md`](DECISIONES_PENDIENTES_CONTABILIDAD.md), §E).
> Todavía no hay código de este bloque en el PR.

Este bloque se apoya en lo que ya existe (y se reutiliza, no se duplica):

| Pieza existente | Qué aporta |
| --- | --- |
| `conta_anular_cobro_cargo`, `conta_anular_anticipo`, `conta_revertir_aplicacion_saldo_favor` | Anulaciones y reversos transaccionales con motivo y reverso contable |
| `pagos_rechazo_eventos` (20261005000000) | Evidencia de servidor (hora, actor, motivo) de los rechazos de cobros |
| `conta_reversar_automatico`, `conta_anular_asiento` | Un asiento publicado nunca se edita: se reversa con otro asiento |
| `conta_ec_limitaciones` · `anulacion_sin_fecha` | Declara los cargos anulados sin evidencia de fecha (históricos) |
| RBAC por acción (`view`, `create`, `edit`, `change_status`, `approve`, `delete`) por módulo, y rol de sistema «Finanzas / Contador» | Los permisos que se usarán; no se crean acciones nuevas |
| `create-charge` / `confirm-charge` / `conciliar_pago_externo` (20260911042839) | Cobro en línea confirmado **en el servidor** e idempotente por `pagos.payment_request_id` único |
| `stripe-webhook-handler` + idempotencia por evento (20260911231905) | Avisos de la pasarela deduplicados |

## 1. Flujo propuesto

```
solicitud (motivo + evidencia)
   │  estado: pendiente
   ▼
revisión ──► rechazada (motivo del revisor)            [fin: nada cambia]
   │
   ▼
aprobada ──► ejecución TRANSACCIONAL del ajuste/reverso ──► ejecutada
                   │ (falla)
                   ▼
               fallida (motivo del servidor; se puede reintentar la ejecución)
   ▼
trazabilidad en el estado de cuenta (documento original + ajuste + aprobador)
```

Tipos de solicitud (uno por fila; cada uno reutiliza la operación que ya existe):

| Tipo | Qué ejecuta | Operación existente que reutiliza |
| --- | --- | --- |
| `anular_cargo` | Anula un cargo adicional (con o sin asiento) | `UPDATE cargos_adicionales_unidad SET estado='anulado'` + reverso del devengo (`conta_reversar_automatico`) |
| `anular_cuota` | Anula una cuota por tipo | transición `anular` + reverso del devengo |
| `anular_cobro` | Rechaza un cobro contabilizado | `conta_anular_cobro_cargo` / rechazo de Agua (queda en `pagos_rechazo_eventos`) |
| `ajuste_importe` | Corrige el importe de un documento **publicado** | **Nota de crédito o débito**: un asiento nuevo por la diferencia, ligado al documento. El documento y su asiento originales NO se editan |
| `revertir_aplicacion` | Revierte una aplicación de saldo a favor | `conta_revertir_aplicacion_saldo_favor` |

## 2. Modelo de datos propuesto

- `conta_ajustes_solicitudes`: `id` (clave de idempotencia del cliente), `company_id`,
  `project_id`, `tipo`, `documento_tabla`, `documento_id`, `importe_propuesto`
  (sólo en `ajuste_importe`), `motivo`, `estado`, `solicitado_por`/`_at`,
  `revisado_por`/`_at`, `motivo_revision`, `ejecutado_at`, `asiento_id` (del
  ajuste o reverso), `error_ejecucion`. **Todas las fechas y actores, del
  servidor** (`now()`, `auth.uid()`), nunca del cliente.
- `conta_ajustes_evidencias`: archivos en Storage (bucket privado, ruta por
  empresa) con hash, tipo y tamaño; sólo inserción.
- `conta_ajustes_eventos`: bitácora de sólo inserción de cada transición
  (estado anterior → nuevo, actor, hora del servidor, motivo).
- Estado de cuenta: el ajuste aparece como un movimiento más, con «Ajuste
  aprobado por X el D: motivo», enlazado al documento original.

## 3. Roles: quién solicita, aprueba y ejecuta

Con los permisos que ya existen (no se crea ninguno):

| Paso | Quién (propuesta) | Permiso existente |
| --- | --- | --- |
| Solicitar | Quien opera el documento | `platform.condominios.edit` (cargos/cuotas) o `platform.contabilidad.create` |
| Aprobar / rechazar | Contabilidad | `platform.contabilidad.approve` («Autorizar / Denegar») o rol `company_owner`/`admin` |
| Ejecutar | El sistema, en la MISMA transacción de la aprobación | — (la aprobación dispara la ejecución; si falla, queda `fallida` y la reintenta alguien con `approve`) |

**[DECIDIR] Autoaprobación.** Propuesta: **no** se permite que quien solicita
apruebe su propia solicitud (cuatro ojos), salvo que la empresa tenga un solo
usuario con `approve`. Alternativa: permitirla sólo al `company_owner`. No se
propone umbral monetario: si el negocio quiere uno (p. ej. «ajustes mayores a X
requieren owner»), debe fijar el monto y quién lo aprueba.

**[DECIDIR] Plazo de las solicitudes pendientes** (¿vencen?, ¿se notifican?).

## 4. Anulación de cargos SIN asiento: evidencia

Hoy un cargo adicional anulado que nunca tuvo asiento no deja fecha, y el estado
de cuenta lo declara como `anulacion_sin_fecha`. Propuesta:

- Toda anulación (con o sin asiento) pasa por la solicitud aprobada y deja en
  `conta_ajustes_eventos` la fecha del servidor, el actor y el motivo.
- `conta_ec_limitaciones` deja de declarar como `anulacion_sin_fecha` los
  cargos que tengan ese evento, y los ubica al corte con su fecha real.
- Los históricos sin evidencia **siguen** en `anulacion_sin_fecha`: no se
  rellenan con `updated_at` ni con la fecha de la migración.
- Un `UPDATE` directo que anule un cargo sin pasar por el flujo se rechaza
  (mismo patrón que `COBRO_CARGO_SOLO_RPC`).

## 5. Portal del residente y pasarela

Extender a portal y pasarela sólo lo que ya está aprobado (cargos, cobros y
saldos a favor), con estas reglas:

1. **Qué ve el residente.** Su estado de cuenta (el del auxiliar que es él
   mismo), sus cuotas y cargos pendientes, sus cobros y su saldo a favor
   disponible. Nunca los de otro cliente de la unidad: el sujeto sale de
   `auth.uid()` → cliente, en el servidor, no de un parámetro.
2. **Qué opera.**
   - Pagar cuotas (ya existe) y **cargos adicionales**: `create-charge` y
     `conciliar_pago_externo` aceptan `cargo_adicional_id`, y el cobro se
     contabiliza por `conta_contabilizar_cobro_cargo_interno` (mismo camino que
     el back-office).
   - **Excedente de un pago en línea**: queda como saldo a favor del pagador si
     es el responsable del documento (la regla del funcional 1), o pendiente
     con motivo si no lo es.
   - **[DECIDIR]** Si el residente puede **aplicar** su propio saldo a favor a
     un documento suyo. Propuesta para la primera entrega: **no**. Lo solicita
     desde el portal (una solicitud del §1) y lo aplica contabilidad.
3. **Avisos de la pasarela.**
   - **Duplicados.** La idempotencia sigue siendo una restricción, no una
     consulta: `pagos.payment_request_id` único (ya existe) y, para los
     webhooks, el id del evento único (ya existe en Stripe; se agrega igual
     para el resto de proveedores).
   - **Fuera de orden.** El estado de `payment_requests` sólo avanza
     (`pending → succeeded|failed|refunded`). Un aviso «failed» que llega
     después de «succeeded» no revierte nada; lo registra y lo marca para
     revisión. Un reembolso es un **rechazo del cobro**, que pasa por el guard
     `COBRO_SALDO_FAVOR_APLICADO` si su saldo ya se usó.
   - **Retorno del navegador.** Nunca acredita: sólo dispara `confirm-charge`,
     que pregunta al proveedor desde el servidor (ya es así hoy; se prueba).

## 6. Pruebas previstas (arnés real, como los bloques anteriores)

- **Autorización.** Quien solicita sin `approve` no aprueba. La autoaprobación
  sigue lo que se decida. Otra empresa ve la solicitud como inexistente. El
  residente sólo ve lo suyo.
- **Aprobación repetida** (doble clic): una sola ejecución y un solo asiento.
- **Ejecución concurrente** con sesiones reales: dos aprobaciones de la misma
  solicitud, y aprobación contra un cobro nuevo del mismo documento.
- **Fallo intermedio.** Sin cuenta o con el período cerrado queda `fallida` sin
  escribir nada parcial, y se puede reintentar.
- **Rechazo** (nada cambia), **reversión** (asiento de reverso con evidencia) y
  **conciliación del estado de cuenta** antes y después de cada ajuste.
- **Pasarela.**
  - Aviso duplicado y avisos fuera de orden.
  - Retorno del navegador sin confirmación del proveedor.
  - Pago en línea con excedente.
  - Reembolso de un cobro con saldo a favor ya aplicado.

## 7. Decisiones (aprobadas el 2026-09-26)

Respuestas: 1) no, salvo `company_owner` o un único aprobador, con marca de
autoaprobación; 2) sin umbral al inicio, se revisa a los tres meses; 3) no
vencen: recordatorio a 7 días y «estancada» a 30; 4) lo solicita; 5) se
mantiene el bloqueo.

Preguntas originales:

1. Autoaprobación: ¿no permitida (propuesta) o sólo el owner?
2. ¿Hay umbral monetario? Si lo hay: monto, moneda y quién aprueba por encima.
3. ¿Vencen las solicitudes pendientes?
4. ¿El residente aplica su saldo a favor o lo solicita (propuesta: lo solicita)?
5. Rechazo de un cobro con saldo ya aplicado (funcional 1): ¿se mantiene el
   bloqueo actual o se revierten las aplicaciones en cascada dentro de la
   solicitud aprobada?
