# Bloque 3 — Ajustes, anulaciones, portal y pasarela

> **Estado: IMPLEMENTADO en `20261011000000_conta_ajustes_solicitudes_portal_pasarela`**
> (PR #904). Decisiones en [`DECISIONES_PENDIENTES_CONTABILIDAD.md`](DECISIONES_PENDIENTES_CONTABILIDAD.md), §E.
> Este documento reemplaza la propuesta anterior (que no tenía código).

## 1. Flujo

```
solicitar (motivo) ──► pendiente ──► aprobar ──► [misma transacción] ejecutar ──► ejecutada
                          │              │                     │ (falla: nada queda escrito)
                          │              │                     ▼
                          │              │                  fallida ──► reintentar (otra persona)
                          │              ▼                     │
                          ├──► rechazada (motivo)  ◄───────────┘
                          └──► cancelada (sólo quien la pidió, mientras esté pendiente)
```

| Tipo | Documento | Ejecuta | Quién solicita |
| --- | --- | --- | --- |
| `anular_cargo` | cargo adicional | `UPDATE … estado='anulado'` (el trigger reversa el devengo) + evidencia en `conta_cargo_anulaciones` | condominios.edit o contabilidad.create |
| `anular_cobro_cargo` | cobro de un cargo | `conta_anular_cobro_cargo` | ídem |
| `anular_anticipo` | anticipo | `conta_anular_anticipo` | ídem |
| `revertir_aplicacion_saldo_favor` | aplicación | `conta_revertir_aplicacion_saldo_favor` | contabilidad.create |
| `aplicar_saldo_favor` | cuota o cargo | `conta_aplicar_saldo_favor` (clave = id de la solicitud) | el **residente** desde el portal (E4) |

**Aprobar** requiere «Autorizar / Denegar» en Contabilidad (`conta_puede_escribir('approve')`: permiso RBAC o rol owner/admin).

## 2. Reglas (todas en el servidor)

- **Cuatro ojos (E1).** Quien solicita no aprueba. **Única excepción: el `company_owner`**, y sólo con
  `p_confirmar_autoaprobacion = true`; queda `autoaprobada = true` y el evento `autoaprobada` en la bitácora.
  No hay excepción por «único aprobador». Reintentar una fallida tampoco lo puede hacer quien la pidió,
  salvo que la haya autoaprobado.
- **Sin umbral (E2)** y **sin vencimiento (E3)**: ningún proceso cambia una solicitud por antigüedad.
  Recordatorio a 7 días, «estancada» a 30 y revisión del umbral a 3 meses son **propuestas**, sin código.
- **Idempotencia.** El id de la solicitud lo genera el cliente: repetir con los mismos datos devuelve la
  existente; con otros, `AJUSTE_CLAVE_REUSADA`. Una sola solicitud abierta por tipo y documento
  (`AJUSTE_YA_SOLICITADO`). Aprobar dos veces ejecuta una vez (la solicitud se bloquea `FOR UPDATE`).
- **Revalidación al aprobar**, con el documento bloqueado en el mismo orden que la operación:
  documento (existe, mismo importe y responsable que al solicitar, no ya anulado/revertido), **período**
  de hoy abierto (`AJUSTE_PERIODO_CERRADO`) y **saldo** (disponible del origen y saldo del documento).
- **Ejecución atómica.** Corre en una subtransacción: si falla, no queda nada escrito y la solicitud queda
  `fallida` con el motivo del servidor.
- **Sin atajos.** Las tres RPC que el flujo ejecuta responden `AJUSTE_REQUIERE_SOLICITUD` si se invocan
  sueltas (exigen la solicitud en ejecución en la transacción actual, marcada por su `txid` en una tabla
  que la aplicación no puede escribir). Anular un cargo por `UPDATE` → `CARGO_ANULACION_SOLO_POR_SOLICITUD`;
  borrarlo → `CARGO_NO_SE_BORRA` (salvo el borrado en cascada de su empresa/proyecto); reactivarlo →
  `CARGO_ANULADO_DEFINITIVO`. Las tablas del flujo sólo se leen desde la aplicación.
- **Bloqueo de rechazo con saldo aplicado (D1/E5)**: se mantiene, sin cascada.

## 3. Anulación de cargos sin asiento: evidencia

`conta_cargo_anulaciones` guarda hora del servidor, actor, solicitud, motivo, si tenía asiento y su
reverso. `conta_ec_fuera_de_saldo` sitúa la anulación al corte con esa fecha (a un corte anterior el cargo
figura vigente con la nota «se anuló después del corte, el …»); `conta_ec_limitaciones` deja de contarlo en
`anulacion_sin_fecha`. Los anulados **antes** de la migración no tienen evidencia y **siguen** en esa
limitación: no se rellenan fechas.

## 4. Portal

`portal_saldos_favor`, `portal_documentos_con_saldo`, `portal_mis_solicitudes` y
`portal_solicitar_aplicacion_saldo_favor`: el sujeto es el cliente de la sesión (`get_my_cliente_id()`),
nunca un parámetro. El residente ve y solicita; no aplica. Pantalla: `PortalCargosSaldoFavor` en
«Mi cuenta».

## 5. Pasarela

- **Cargos adicionales en línea**: `create-charge` acepta `cargo_adicional_id`; el saldo y si es cobrable
  los decide `conta_cargo_saldo_pagable` (service_role). Sólo el responsable histórico del cargo paga.
- **Confirmación desde el servidor**: el retorno del navegador nunca acredita; un «aprobado» al crear la
  solicitud queda `pending` y sólo `confirm-charge` (o el webhook) lo concilia.
- **`pasarela_registrar_estado`** es el único punto por el que un aviso del proveedor cambia una solicitud:
  deduplicado por (proveedor, clave de evento); el estado sólo avanza
  (`pending → succeeded|failed`, `failed → succeeded`, `succeeded → refunded`). Un aviso contradictorio no
  revierte nada y abre una incidencia (`rechazo_tras_aprobacion`, `aprobado_tras_reembolso`).
- **Reembolso confirmado**: se conserva el evento, la solicitud pasa a `refunded` y se intenta rechazar el
  cobro. Si el rechazo está bloqueado (p. ej. `COBRO_SALDO_FAVOR_APLICADO`) queda una incidencia
  **abierta** `reembolso_bloqueado` con el motivo; si se rechaza, `reembolso_aplicado` para revisar el
  documento. Stripe: `charge.refunded` total; un reembolso parcial no cambia la solicitud.
- **Corrección encontrada**: `conciliar_pago_externo` insertaba texto en `pagos.verified_by` (uuid en
  producción y en la cadena), así que toda conciliación fallaba por tipo. Ahora `verified_by` recibe un
  uuid o NULL y la procedencia va a `verification_notes`.

## 6. Matriz de requisitos → código → pruebas

| # | Requisito | Código | Pruebas |
| --- | --- | --- | --- |
| 1 | Docs: autoaprobación sólo owner con confirmación; sin «único aprobador»; plazos como propuesta | `docs/DECISIONES_PENDIENTES_CONTABILIDAD.md` §E; este documento §2 | — (documentación) |
| 2a | Solicitar, idempotente, una abierta por documento | `conta_ajuste_solicitar`, `conta_ajuste_alta`, `uq_conta_ajustes_abierta` | `conta_ajustes/assert.sql` §2; concurrencia E |
| 2b | Revisión: aprobar / rechazar / cancelar / reintentar | `conta_ajuste_aprobar`, `_rechazar`, `_cancelar`, `_reintentar` | §3, §5, §6 |
| 2c | Ejecución transaccional e idempotente | `conta_ajuste_ejecutar` (subtransacción), bloqueo `FOR UPDATE` | §3 (doble aprobación), §6 (falla sin escrituras); concurrencia A |
| 2d | Sin umbral, sin vencimiento | ausencia de umbral/cron (E2, E3) | — (no hay código que probar) |
| 3a | Permisos en servidor | `conta_ajuste_bloquear_para_revision`, `conta_ajuste_puede_solicitar` | §2 (visor, otra empresa), §3 (sin approve, otra empresa), §6 (reintento) |
| 3b | Revalidar documento, período y saldo | `conta_ajuste_revalidar`, `conta_ajuste_foto` | §5 (importe cambiado), §6 (período cerrado, cobro vivo), §8 (saldo); concurrencia B y C |
| 3c | Sin escrituras directas | `conta_ajuste_exigir`, `trg_cargo_solo_por_solicitud`, REVOKE de tablas | §0 (privilegios), §1 (UPDATE/DELETE/RPC/INSERT directos) |
| 3d | E1 autoaprobación | `conta_ajuste_aprobar` + CHECK `conta_ajustes_autoaprobacion_marcada` | §3, §4 (owner con/sin confirmación; único aprobador en B); `ajustes.test.ts`; `ajustesTab.test.tsx` |
| 4 | Evidencia de anulación sin asiento; históricos siguen como limitación | `conta_cargo_anulaciones`, `conta_ec_fuera_de_saldo`, `conta_ec_limitaciones` | §7; `conta_estado_cuenta/assert_corte.sql` (heredado sigue en la limitación) |
| 5 | Portal: consulta y solicitud; contabilidad aprueba | `portal_*` (4 RPC), `PortalCargosSaldoFavor.tsx` | §8; concurrencia E; `PortalCargosSaldoFavor.test.tsx`; `rlsHarness.test.ts` (anon y staff rechazados) |
| 6a | Cargos en portal/pasarela | `create-charge` (rama cargo), `conciliar_pago_externo` (rama cargo), `confirm-charge` | §9; `create-charge/__tests__/handler.test.ts` (cargo); `confirm-charge/__tests__/handler.test.ts` (cargo) |
| 6b | Duplicados | `pasarela_eventos` UNIQUE, `pagos.payment_request_id` UNIQUE | §9 (mismo aviso, webhook + consulta); concurrencia D |
| 6c | Eventos fuera de orden | `pasarela_registrar_estado` (estado sólo avanza) | §9 (rechazo tras aprobado, pendiente, aprobado tras reembolso, aprobación tardía); `confirm-charge` (no escribe `failed`) |
| 6d | Confirmación desde servidor | `estadoPaymentRequest` (aprobado → pending), `confirm-charge` | `create-charge/__tests__/logic.test.ts`, handler (cargo pending); `PortalCargosSaldoFavor.test.tsx` (checkout no acredita) |
| 7 | Bloqueo sin cascada; reembolso conservado con incidencia | `conta_rechazar_cobro_por_reembolso`, `conta_incidencias_conciliacion`, `stripe-webhook-handler` (`charge.refunded`) | §9 (reembolso bloqueado y aplicado, incidencia, resolver); `stripe-webhook-handler/__tests__/logic.test.ts` |
| 8 | Autoaprobación, aislamiento, concurrencia, fallos y reintentos | — | `conta_ajustes` §1–§10 y concurrencia A–E; suites anteriores pasando por el flujo (`conta_ajustes/helper.sql`) |
| 9a | Sandbox | — | **Pendiente**: sin #901, #902 ni este PR (ver `SANDBOX_E2E_SINCRONIZAR.md`) |
| 9b | Auditor de drift | refresco de `huella-produccion.json` | **Pendiente de escritura**: verificado contra producción, ver la descripción del PR |

## 7. Fuera de alcance (explícito)

- `ajuste_importe` (nota de crédito/débito sobre un documento publicado) y `anular_cuota` por el flujo:
  no se implementaron. La cuota sigue su camino actual.
- Recordatorios y estado «estancada» (E3′), revisión del umbral (E2′): propuestas sin código.
- Reembolsos automáticos para QPayPro: su adaptador no expone la consulta/aviso de reembolso; hoy se
  informan por Stripe (`charge.refunded`) o por `pasarela_registrar_estado` cuando el proveedor lo reporte.
