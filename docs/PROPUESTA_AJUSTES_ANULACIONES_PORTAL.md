# Bloque 3 — Ajustes, anulaciones, portal y pasarela

> **Estado: implementado en `20261011000000_conta_ajustes_solicitudes_portal_pasarela` y
> `20261012000000_conta_anular_cuota_reembolsos_parciales_respaldos`** (PR #904).
> **No está completo**: `ajuste_importe` espera las decisiones E6 y el sandbox no tiene
> las migraciones (ver §6, entorno). Decisiones en [`DECISIONES_PENDIENTES_CONTABILIDAD.md`](DECISIONES_PENDIENTES_CONTABILIDAD.md), §E.
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
| `anular_cuota` | cuota | `cuota_estado='anulada'` + `anulada_at` del servidor, reversos **vinculados** del devengo y la mora (`conta_reversar_automatico`) + evidencia en `conta_cuota_anulaciones` | condominios.edit o contabilidad.create |
| `ajuste_importe` | cuota o cargo | — **pendiente de E6** | — |

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

## 5b. Cierre del bloque (`20261012000000`)

- **Anular cuota sin cascada.** `conta_ajuste_dependencias` (pantalla) y la solicitud/aprobación
  informan cobros vivos, aplicaciones de saldo a favor, cobro en línea en curso, solicitud de aplicación
  abierta y devengo pendiente o en borrador (`AJUSTE_DEPENDENCIAS`, con cómo resolver cada una). Atajos
  cerrados en la tabla: `CUOTA_ANULACION_SOLO_POR_SOLICITUD`, `CUOTA_ANULADA_DEFINITIVA`,
  `CUOTA_FECHA_ANULACION_FIJA`, `CUOTA_ELIMINACION_SOLO_POR_SOLICITUD` (emitida), `CUOTA_CON_DEPENDENCIAS`;
  un cobro nuevo sobre una anulada: `COBRO_CUOTA_ANULADA` (FOR SHARE, serializado con la aprobación).
  Efectos: el estado de cuenta usa `anulada_at` (corte histórico conservado), el portal deja de ofrecerla,
  los saldos y reportes salen del libro (reversos).
- **Reembolsos parciales.** `pasarela_registrar_reembolso_parcial` (service_role): evento, referencia del
  pago y del reembolso, acumulado, moneda y fecha del proveedor; `pasarela_reembolsos` cuenta sólo el
  aumento del acumulado (duplicados y fuera de orden no suman); incidencia `reembolso_parcial` por cada
  reembolso nuevo; la solicitud sigue `succeeded` y el cobro no se rechaza. Stripe: `charge.refunded` con
  `refunded=false`. Sin reembolsos automáticos ni supuestos de QPayPro.
- **Respaldo documental.** No había adjuntos reutilizables para esto (los buckets existentes autorizan por
  proyecto o pieza); se usa el patrón de `recepcion-evidencias`: bucket privado `ajustes-respaldos`
  (`<empresa>/<solicitud>/<archivo>`, sin UPDATE/DELETE), `conta_ajustes_respaldos` (sólo inserción, metadatos
  de storage), adjuntar sólo mientras está pendiente, y al aprobar la lista revisada debe coincidir y los
  eTag no deben haber cambiado; queda `respaldos_revisados`. El motivo y la bitácora siguen aparte.

## 6. Matriz de requisitos → código → pruebas → entorno

Entornos: **L** = PostgreSQL desechable local con la cadena completa de migraciones (y el mismo arnés en
CI); **V** = vitest (CI); **S** = sandbox existente. **Ningún requisito del bloque 3 está verificado en S**:
el sandbox no tiene #901, #902 ni este PR (§ «Sandbox» abajo).

| # | Requisito | Código | Pruebas | Entorno |
| --- | --- | --- | --- | --- |
| 1 | Docs: autoaprobación sólo owner; sin «único aprobador»; plazos como propuesta | `DECISIONES…` §E | — | — |
| 2a | Solicitar, idempotente, una abierta por documento | `conta_ajuste_solicitar`, `_alta`, `uq_conta_ajustes_abierta` | `conta_ajustes/assert.sql` §2; concurrencia E | L |
| 2b | Revisión: aprobar / rechazar / cancelar / reintentar | `conta_ajuste_aprobar(…, uuid[])`, `_rechazar`, `_cancelar`, `_reintentar` | §3, §5, §6, §15, §16 | L |
| 2c | Ejecución transaccional e idempotente | `conta_ajuste_ejecutar` (subtransacción) | §3, §6, §14 (repetida), §15; concurrencia A | L |
| 2d | Sin umbral, sin vencimiento | ausencia de umbral/cron | — | — |
| 2e | **anular_cuota** con reversos vinculados y evidencia | `conta_ajuste_ejecutar` (rama cuota), `conta_cuota_anulaciones` | `assert_b.sql` §14 | L |
| 2f | Dependencias informadas, sin cascada | `conta_cuota_dependencias`, `conta_ajuste_dependencias` | §12, §13, §15; concurrencia F, F′ | L, V (`ajustes.test.ts`) |
| 2g | Rutas anteriores sin atajo (cuota) | `trg_cuota_solo_por_solicitud`, `trg_pago_cuota_anulada`, `useAnularCuotaMutation` | §12, §14; `anularCuotaSolicitud.test.tsx` | L, V |
| 2h | Efectos en EC, portal, saldos, cortes históricos | `anulada_at` del servidor + reversos | §14 (corte de ayer / hoy, portal), §19 (conciliación) | L |
| 2i | **ajuste_importe** | — | — | ⏸️ **Pendiente de E6** |
| 3a | Permisos en servidor | `conta_ajuste_bloquear_para_revision`, `_puede_solicitar` | §2, §3, §6, §13, §14 | L |
| 3b | Revalidar documento, período y saldo | `conta_ajuste_revalidar` | §5, §6, §8, §15; concurrencia B, C, F′ | L |
| 3c | Sin escrituras directas | `conta_ajuste_exigir`, triggers, REVOKE | §0, §1, §11, §12 | L |
| 3d | E1 autoaprobación | `conta_ajuste_aprobar` + CHECK | §3, §4, §16; `ajustes.test.ts`; `ajustesTab.test.tsx` | L, V |
| 4 | Evidencia de anulación sin asiento; históricos como limitación | `conta_cargo_anulaciones`, `conta_ec_*` | §7; `conta_estado_cuenta/assert_corte.sql` | L |
| 5 | Portal: consulta y solicitud | `portal_*`, `PortalCargosSaldoFavor.tsx` | §8; concurrencia E; `PortalCargosSaldoFavor.test.tsx`; `rlsHarness.test.ts` | L, V |
| 6a–d | Cargos en pasarela, duplicados, fuera de orden, confirmación en servidor | `create-charge`, `confirm-charge`, `pasarela_registrar_estado` | §9; concurrencia D; tests de edge | L, V |
| 7 | Bloqueo sin cascada; reembolso total conservado con incidencia | `conta_rechazar_cobro_por_reembolso`, incidencias | §9 | L, V |
| 7b | **Reembolso parcial**: datos del proveedor, incidencia, sin rechazar | `pasarela_registrar_reembolso_parcial`, `pasarela_reembolsos`, `stripe-webhook-handler` | §18; concurrencia G; `stripe-webhook-handler/__tests__/logic.test.ts` | L, V |
| 7c | Parciales duplicados, acumulados y fuera de orden | UNIQUE (solicitud, acumulado), bloqueo de la solicitud | §18 (5 casos), concurrencia G | L |
| 8 | **Respaldo documental** protegido y trazable | bucket `ajustes-respaldos`, `conta_ajustes_respaldos`, `conta_ajuste_adjuntar_respaldo`, `respaldos_revisados` | §17 (RLS de storage, otra empresa, residente, sin UPDATE/DELETE, lista revisada, eTag alterado, cerrado tras aprobar, rechazo); `ajustes.test.ts`; `ajustesTab.test.tsx` | L, V |
| 9 | Aislamiento, concurrencia, fallos, reintentos | — | `conta_ajustes` §1–§19, concurrencia A–G | L |
| 10a | Sandbox | — | **Bloqueado** (ver abajo) | S ✗ |
| 10b | Auditor de drift | refresco de `huella-produccion.json` | **Pendiente de permiso de escritura** | — |

### Sandbox (2026-09-27, sólo lectura)

`jwpmivhvlstslncrtokb` = «control-agua-rls-sandbox» (≠ producción `nnsqmeigtgewatameexo`): 504 migraciones,
máxima `20261004000200`. Faltan exactamente: `20261005000000`, `20261006000000` (en `main`) y
`20261007000000`–`20261012000000` (este PR). Bloqueo: el procedimiento autorizado
([`SANDBOX_E2E_SINCRONIZAR.md`](SANDBOX_E2E_SINCRONIZAR.md), paso 1) sólo aplica migraciones de `main`
(«nada de PRs abiertos»), así que las de #904 no se pueden aplicar mientras el PR esté abierto, y las pruebas
de integración del bloque 3 no pueden correr allí. Las de `main` (`20261005`, `20261006`) sí se pueden
sincronizar con ese procedimiento, pero no habilitan las pruebas del bloque 3.

## 7. Fuera de alcance / pendiente

- `ajuste_importe`: **no implementado**, espera las decisiones E6. El bloque no está completo sin él.
- Recordatorios y «estancada» (E3′), revisión del umbral (E2′): propuestas sin código.
- QPayPro: su adaptador no expone reembolsos; no se implementa nada no confirmado.
- Carrera residual: un cobro en línea creado en el instante previo a la aprobación de la anulación de la cuota
  (sin solicitud de cobro todavía) y confirmado después falla al conciliar (`COBRO_CUOTA_ANULADA`) y el webhook
  queda reintentando; queda visible en `stripe_webhook_events`. Ver E8.
