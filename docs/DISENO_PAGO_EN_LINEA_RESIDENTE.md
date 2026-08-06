# Diseño — Pago en línea del residente (P1, brecha #1 de producto)

> **Estado:** propuesta para revisión (fase 2B). No implementa nada todavía.
> **Decisiones tomadas:** proveedor = **payfac pluggable** (1A); el pago usa el
> proveedor que **cada empresa** configuró (un residente puede deberle a varias
> empresas con proveedores distintos → se resuelve por la empresa/proyecto dueño
> del ítem que se paga).

## 1. Objetivo

Que el residente/cliente pague **en línea** sus ítems pendientes desde el portal,
usando el payfac que su empresa eligió, y que el pago **concilie** solo (marque el
ítem pagado sin intervención del admin). Habilita comisión por transacción.

## 2. Estado actual (lo que ya existe y lo que falta)

**Ya existe (reutilizable):**
- `create-charge` (edge): resuelve el **payfac efectivo** por empresa/proyecto
  (`resolverConfigPagoEfectiva`), lee credenciales de `payfac_secrets` (cifradas,
  P0 #7), crea el cobro vía el adapter pluggable y devuelve
  `{ estado, redirectUrl?, clientSecret?, payment_request_id, provider_ref }`.
  Registra `payment_requests` (auditoría).
- Abstracción `PaymentProvider` (`crearCobro` / `consultarEstado` / `reembolsar`),
  con adapters `sandbox` y `qpaypro` (hosted checkout → `redirectUrl`).
- Tablas: `payment_requests` (solicitud al payfac), `pagos` (pagos de agua contra
  `registros`), `cuotas_condominio` (con máquina de estados `cuota_estado` +
  `estado='pagado'`/`fecha_pago`/`metodo_pago`/`referencia_pago`/`pago_id`).

**Lo que falta (el trabajo de esta feature):**
1. **Conciliación**: NO hay edge que confirme un cobro pagado y marque el ítem.
   `consultarEstado` existe en el provider pero nadie lo llama.
2. **UI de pago real**: `StripeCheckoutModal` (agua) es un **placeholder** (llama a
   `/api/create-payment-intent`, muestra un toast y no cobra); está **hardcodeado a
   Stripe** (ignora el payfac de la empresa). `PortalMiCuentaTab` (condominios) es
   **solo lectura**, sin botón de pagar.
3. **`create-charge` solo acepta `registro_id`** (agua); falta soportar
   `cuota_id` (condominios).
4. **`payment_requests` no tiene `cuota_id`** (solo `registro_id`).

## 3. Arquitectura del flujo (hosted checkout)

```
Residente (portal)                Edge (service_role)              Payfac de la empresa
──────────────────                ───────────────────              ────────────────────
1. Click "Pagar" ítem  ─────────► create-charge
   (registro_id | cuota_id)         · verifica que el cliente
                                       DUEÑO del ítem = caller
                                     · resuelve payfac efectivo
                                       de la empresa/proyecto
                                     · crea cobro ──────────────────► crearCobro()
                                     · inserta payment_requests      ◄── redirectUrl / clientSecret
2. Redirect a hosted   ◄────────── { redirectUrl, payment_request_id }
   checkout ──────────────────────────────────────────────────────► paga (tarjeta)
3. Vuelve a /portal?pago=ok&pr=<id>
4. Front llama          ─────────► confirm-charge(pr_id)  [NUEVO]
   confirm-charge                    · consultarEstado(provider_ref) ─► ¿aprobado?
                                     · si aprobado (idempotente):
                                        - agua:  inserta `pagos`
                                        - condo: transición de cuota
                                        - payment_requests.estado='aprobado'
5. Portal refresca ◄────────────── { estado: 'aprobado', ... }         → ítem "Pagado"

  + Red de seguridad: `reconcile-charges` (pg_cron) barre payment_requests
    'pendiente/requiere_accion' viejos y hace consultarEstado → concilia los que
    el residente pagó pero no volvió a la app (o checkout async).
```

## 4. Piezas nuevas / a modificar

### Edges
| Pieza | Acción |
|---|---|
| `create-charge` | **Extender**: aceptar `cuota_id` (condominios) además de `registro_id`. Construir el `CobroCanonico` desde la cuota (monto = `total_a_pagar` con mora). Autorización: el caller (cliente) debe ser dueño del `registro`/`cuota` (por `cliente_id`/`unidad`). |
| `confirm-charge` | **NUEVO**: recibe `payment_request_id`, valida ownership, `consultarEstado(provider_ref)`; si aprobado, marca el ítem pagado (ver §5) y `payment_requests.estado='aprobado'`. **Idempotente** por `provider_ref`. |
| `reconcile-charges` | **NUEVO (cron)**: `consultarEstado` para `payment_requests` pendientes con antigüedad > N min; concilia los aprobados. Autenticado por `x-cron-secret`. Red de seguridad ante retornos abandonados. |

### Frontend
| Pieza | Acción |
|---|---|
| `domain/portal/mutations.ts` | **NUEVO**: `iniciarPagoEnLinea({registro_id|cuota_id})` → invoca `create-charge`; `confirmarPago(pr_id)` → invoca `confirm-charge`. (Boundary: sin `supabase` directo en componentes.) |
| `StripeCheckoutModal` (agua) | **Reescribir** → `PagoEnLineaModal` provider-agnostic: llama a `create-charge`; si `redirectUrl` → redirige; si `clientSecret` → (fase 2) confirma en página. Quita el hardcode de Stripe y el `/api/...`. |
| `PortalMiCuentaTab` (condominios) | **Agregar** botón "Pagar" por cuota pendiente → `PagoEnLineaModal`. |
| Retorno `/portal?pago=ok&pr=<id>` | Handler que llama `confirm-charge` y refresca; `?pago=cancelado` muestra aviso. |

### Migración
- `ALTER TABLE payment_requests ADD COLUMN cuota_id uuid REFERENCES cuotas_condominio(id)` (nullable; el ítem es `registro_id` XOR `cuota_id`).
- (Opcional) índice parcial para `reconcile-charges` sobre `estado IN ('pendiente','requiere_accion')`.

## 5. Conciliación — marcar el ítem pagado (reusar lo existente)

- **Agua (`registros`)**: insertar fila en `pagos` (`registro_id`, `monto`,
  `metodo='en_linea:<provider>'`, `referencia=provider_ref`, `estado`/
  `verification_status` apropiados). El saldo del registro deriva de `pagos`.
- **Condominios (`cuotas_condominio`)**: aplicar la **misma transición** que el pago
  manual (máquina `cuota_estado`): `estado='pagado'`, `pagada_at`, `fecha_pago`,
  `metodo_pago='en_linea:<provider>'`, `referencia_pago=provider_ref`, `pago_id`.

> Idempotencia: `provider_ref` único ⇒ confirmar dos veces (retorno + cron) no
> duplica el pago.

## 6. Seguridad
- **Ownership**: `create-charge`/`confirm-charge` verifican que el `cliente_id` del
  caller (JWT del residente, rol `cliente`) sea dueño del `registro`/`cuota`. Nunca
  se paga un ítem ajeno ni de otra empresa.
- **Multi-empresa**: el payfac se resuelve **por la empresa/proyecto del ítem**, no
  por el cliente → un residente con deudas en 2 empresas paga cada una con su payfac.
- Credenciales del payfac ya cifradas en reposo (P0 #7) y nunca salen al cliente.
- El monto lo fija el servidor desde el ítem (no se confía en el monto del body,
  salvo abono parcial acotado a `saldo`).

## 7. Fases de entrega (vertical mínima primero)
1. **F1 — Vertical mínima (condominios, sandbox/QPayPro):**
   migración `cuota_id`; `create-charge` acepta `cuota_id`; `confirm-charge`;
   botón Pagar en `PortalMiCuentaTab`; retorno + confirmación. E2E feliz.
2. **F2 — Agua:** reescribir `StripeCheckoutModal` → `PagoEnLineaModal`; `pagos`
   desde `confirm-charge`; abonos parciales.
3. **F3 — Robustez:** `reconcile-charges` (cron); manejo de `rechazado`/`cancelado`;
   recibo/comprobante; reintentos.
4. **F4 — Comisión por transacción** (si aplica): application fee del payfac o
   registro de comisión de plataforma.

## 8. Decisiones tomadas (2026-07-11)
1. **Comisión por transacción**: primero habilitar el pago; comisión en **F4**.
2. **Abono parcial en cuotas**: **SÍ** se permiten abonos (no solo cuota completa).
   → Ver §9: requiere acumular pagos por cuota (hoy la cuota es binaria).
3. **QPayPro**: investigado — su doc está detrás de login de comercio (no accesible
   públicamente). Confirmado que es **hosted checkout AIM** (retorno a
   `x_url_complete`); `consultarEstado`/`reembolsar` del adapter están **stub**
   (follow-up). Ver §10: implicación de seguridad + enfoque sandbox-first.
4. **Arranque**: **F1 = condominios primero**.

## 9. Abonos parciales en cuotas — modelo de datos

Hoy `cuotas_condominio` es binaria (`estado` pendiente/pagado); no acumula pagos
parciales. Para permitir abonos, reusamos la tabla `pagos` (ya existe para agua)
extendiéndola:

- `ALTER TABLE pagos ADD COLUMN cuota_id uuid REFERENCES cuotas_condominio(id)`
  (un pago es contra `registro_id` XOR `cuota_id`).
- **Saldo de la cuota** = `total_a_pagar` − `sum(pagos.monto WHERE cuota_id=… AND estado ok)`.
- La cuota pasa a `pagado` (transición de la máquina de estados) **solo cuando el
  saldo llega a 0**; con abono parcial queda `pendiente` con saldo reducido.
- `PortalMiCuentaTab` muestra saldo por cuota + input de monto (≤ saldo), igual que
  el modal de agua.

## 10. Confirmación de pago — seguridad (clave)

Los params que QPayPro devuelve a `x_url_complete` **llegan por el navegador del
cliente** → **no se pueden confiar** para marcar pagado (spoofeables). Marcar un
pago con tarjeta como "pagado" exige **verificación server-side**. Como el
`consultarEstado` de QPayPro aún no está cableado (ni confirmado su webhook),
adoptamos un enfoque **sandbox-first** que no queda bloqueado:

- **F1 se construye y valida end-to-end contra el provider `sandbox`** (cobro
  simulado, resultado determinista) → todo el vertical (migración, create-charge
  con `cuota_id`, `confirm-charge`, UI, abonos) es probable HOY sin depender de
  QPayPro.
- `confirm-charge` es **provider-agnostic**: marca pagado SOLO con un estado
  `aprobado` devuelto por el **provider server-side** (no por los params del
  retorno del navegador).
- **Wiring de confirmación real de QPayPro = follow-up** (necesita tu panel de
  comercio): o bien (a) su **webhook/IPN** (endpoint `payfac-webhook` que valida
  firma/credenciales) como confirmación autoritativa, o bien (b) cablear
  `consultarEstado` contra el endpoint de status real de QPayPro. Hasta entonces,
  un tenant en QPayPro puede iniciar el cobro (redirect) pero la conciliación
  automática de ese pago real queda pendiente de ese follow-up.

> En resumen: **F1 entrega el vertical completo en `sandbox`** (demo/dev + tenants
> en sandbox), y la confirmación autoritativa de QPayPro producción es un
> follow-up acotado que depende de info que solo está en tu panel de QPayPro.
