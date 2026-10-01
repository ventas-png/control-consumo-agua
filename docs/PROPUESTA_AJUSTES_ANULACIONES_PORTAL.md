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

Migraciones del bloque: `20261011000000`, `20261012000000`, `20261013000000` (correctiva: guarda de
cuota anulada sin trigger en `pagos`), `20261014000000` (correctiva E7) y `20261015000000`
(confirmación tardía de un cobro sobre una cuota anulada).

Entornos (dónde está **comprobado**, no sólo escrito):
- **L** = PostgreSQL desechable local con la cadena completa de migraciones (`supabase/tests/*/run.sh`);
- **CI** = el mismo arnés SQL y vitest en GitHub Actions sobre el SHA del PR;
- **P** = rama de previsualización de Supabase del PR: **sólo** que las migraciones se aplican sobre su
  base (check «Supabase Preview»); ningún flujo se ejercitó ahí;
- **S** = sandbox existente: **nada del bloque 3 está verificado** (no tiene #901, #902 ni este PR; ver
  abajo y `SANDBOX_E2E_SINCRONIZAR.md`).

| # | Requisito | Código | Pruebas | Entorno |
| --- | --- | --- | --- | --- |
| 1 | Docs: autoaprobación sólo owner; sin «único aprobador»; plazos como propuesta | `DECISIONES…` §E | — | — |
| 2a | Solicitar, idempotente, una abierta por documento | `conta_ajuste_solicitar`, `_alta`, `uq_conta_ajustes_abierta` | `conta_ajustes/assert.sql` §2; concurrencia E | L, CI |
| 2b | Revisión: aprobar / rechazar / cancelar / reintentar | `conta_ajuste_aprobar(…, uuid[])`, `_rechazar`, `_cancelar`, `_reintentar` | §3, §5, §6, §15, §16 | L, CI |
| 2c | Ejecución transaccional e idempotente | `conta_ajuste_ejecutar` (subtransacción) | §3, §6, §14 (repetida), §15; concurrencia A | L, CI |
| 2d | Sin umbral, sin vencimiento | ausencia de umbral/cron | — | — |
| 2e | **anular_cuota** con reversos vinculados y evidencia | `conta_ajuste_ejecutar` (rama cuota), `conta_cuota_anulaciones` | `assert_b.sql` §14 | L, CI |
| 2f | Dependencias informadas, sin cascada | `conta_cuota_dependencias`, `conta_ajuste_dependencias` | §12, §13, §15; concurrencia F, F′; `ajustes.test.ts` | L, CI |
| 2g | Rutas anteriores sin atajo (cuota) | `trg_cuota_solo_por_solicitud`, `conta_pago_cuota_no_anulada` (desde `conta_tg_pagos`, correctiva `20261013000000`: `pagos` tiene drift declarado en triggers), `useAnularCuotaMutation` | §12, §14; `anularCuotaSolicitud.test.tsx` | L, CI |
| 2h | Efectos en EC, portal, saldos, cortes históricos | `anulada_at` del servidor + reversos | §14 (corte de ayer / hoy, portal), §19 (conciliación) | L, CI |
| 2i | **ajuste_importe** | — | — | ⏸️ **Pendiente de E6** (qué falta: `DECISIONES…` §E6) |
| 2j | **E7**: sólo la tarifa sin emitir de una reserva cancelada se elimina sin solicitud; una cuota 'pendiente' ya es CxC | `20261014000000` (`conta_cuota_exigir_eliminable`), `AmenidadesTab` (cancelar antes, compensación por solicitud) | `assert_b.sql` §12 (QF, QF2, QF3, QG) | L, CI |
| 2k | **E8**: cuándo consultar cobros en línea abandonados | — (propuesta en `DECISIONES…` §E8) | — | ❓ pendiente |
| 2m | **Confirmación tardía sobre cuota anulada o eliminada**: evento conservado, sin pago, una incidencia, sin devolver ni convertir (independiente de E8) | `20261015000000` (`pasarela_registrar_estado`, `pasarela_cuota_sin_cobro`, `uq_conta_incidencias_cobro_anulado`), `confirm-charge`, `stripe-webhook-handler`, `confirmarPago` | `assert_b.sql` §20 (duplicados por clave, otra clave, consulta, rechazo y reembolso posteriores, eliminada, aislamiento); concurrencia I, J, K; `confirm-charge/__tests__/handler.test.ts`; `logic.test.ts`; `confirmarPago.test.ts` | L, CI |
| 2n | **Reembolso total antes de aprobar**: la solicitud queda `refunded`, una aprobación atrasada no crea ni acredita pago; una incidencia por tipo. **Respuesta = estado persistido** (`conciliado`, `en_revision`, `reembolsado`), también en duplicados; sin saldo 0 por defecto. Reembolsos parciales sin cambios | `20261016000000` (`pasarela_registrar_estado`, `pasarela_estado_persistido`, `uq_conta_incidencias_aprobado_tras_reembolso`), `_shared/payments/conciliacion.ts`, `confirm-charge`, `stripe-webhook-handler`, `confirmarPago`, `avisoConfirmacionPago` (5 pantallas del portal) | `assert_b.sql` §21; concurrencia M, N; `conciliacion.test.ts`; `handler.test.ts`; `logic.test.ts`; `confirmarPago.test.ts`; `avisoConfirmacionPago.test.ts` | L, CI |
| 2l | Migraciones aplicables sobre una base de Supabase | `20261011`–`20261016` | check «Supabase Preview» | P |
| 3a | Permisos en servidor | `conta_ajuste_bloquear_para_revision`, `_puede_solicitar` | §2, §3, §6, §13, §14 | L, CI |
| 3b | Revalidar documento, período y saldo | `conta_ajuste_revalidar` | §5, §6, §8, §15; concurrencia B, C, F′ | L, CI |
| 3c | Sin escrituras directas | `conta_ajuste_exigir`, triggers, REVOKE | §0, §1, §11, §12 | L, CI |
| 3d | E1 autoaprobación | `conta_ajuste_aprobar` + CHECK | §3, §4, §16; `ajustes.test.ts`; `ajustesTab.test.tsx` | L, CI |
| 4 | Evidencia de anulación sin asiento; históricos como limitación | `conta_cargo_anulaciones`, `conta_ec_*` | §7; `conta_estado_cuenta/assert_corte.sql` | L, CI |
| 5 | Portal: consulta y solicitud | `portal_*`, `PortalCargosSaldoFavor.tsx` | §8; concurrencia E; `PortalCargosSaldoFavor.test.tsx`; `rlsHarness.test.ts` | L, CI |
| 6a–d | Cargos en pasarela, duplicados, fuera de orden, confirmación en servidor | `create-charge`, `confirm-charge`, `pasarela_registrar_estado` | §9; concurrencia D; tests de edge | L, CI |
| 7 | Bloqueo sin cascada; reembolso total conservado con incidencia | `conta_rechazar_cobro_por_reembolso`, incidencias | §9 | L, CI |
| 7b | **Reembolso parcial**: datos del proveedor, incidencia, sin rechazar | `pasarela_registrar_reembolso_parcial`, `pasarela_reembolsos`, `stripe-webhook-handler` | §18; concurrencia G; `stripe-webhook-handler/__tests__/logic.test.ts` | L, CI |
| 7c | Parciales duplicados, acumulados y fuera de orden | UNIQUE (solicitud, acumulado), bloqueo de la solicitud | §18 (5 casos), concurrencia G | L, CI |
| 8 | **Respaldo documental** protegido y trazable | bucket `ajustes-respaldos`, `conta_ajustes_respaldos`, `conta_ajuste_adjuntar_respaldo`, `respaldos_revisados` | §17 (RLS de storage, otra empresa, residente, sin UPDATE/DELETE, lista revisada, eTag alterado, cerrado tras aprobar, rechazo); `ajustes.test.ts`; `ajustesTab.test.tsx` | L, CI |
| 9 | Aislamiento, concurrencia, fallos, reintentos | — | `conta_ajustes` §1–§21, concurrencia A–N | L, CI |
| 10a | Sandbox | procedimiento acotado en `SANDBOX_E2E_SINCRONIZAR.md` | **Espera autorización** (ver abajo) | S ✗ |
| 10b | Auditor de drift | `huella-produccion.json` refrescada con la captura real de producción (sólo lectura, 2026-09-27 23:46:56 UTC, sha256 `35fff705…9e37`, 2779 grupos, 813 migraciones, máxima `20261006000000`); `drift-conocido.json` sin cambios | `auditar.mjs --base aa6e0461` en local: «Sin drift no autorizado» | L, CI |

### Sandbox (2026-10-01, sólo lectura)

`jwpmivhvlstslncrtokb` = «control-agua-rls-sandbox» (≠ producción `nnsqmeigtgewatameexo`): 504 migraciones,
máxima `20261004000200`. Faltan exactamente `20261005000000`, `20261006000000` (en `main`) y
`20261007000000`–`20261016000000` (10 de este PR). El procedimiento autorizado sólo aplica `main`; el
procedimiento acotado para las de este PR está en `SANDBOX_E2E_SINCRONIZAR.md` y **espera autorización**.

## 7. Fuera de alcance / pendiente

- `ajuste_importe`: **no implementado**, espera las decisiones E6. El bloque no está completo sin él.
- Recordatorios y «estancada» (E3′), revisión del umbral (E2′): propuestas sin código.
- QPayPro: su adaptador no expone reembolsos; no se implementa nada no confirmado.
- Confirmación tardía de un cobro sobre una cuota anulada: **cerrada** en `20261015000000` (fila 2m),
  separada de E8. Sin cambios para un recibo de agua eliminado (sigue fallando como antes) y para un
  cargo anulado (ya registraba el pago con la contabilización pendiente, `20261011000000`).
