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

## 8. Decisiones abiertas (para vos)
1. **Comisión por transacción**: ¿la cobramos ya en el MVP (F4) o primero solo
   habilitamos el pago y la comisión va después?
2. **Abono parcial en cuotas de condominio**: agua ya permite parcial. ¿Las cuotas
   se pagan **completas** (incluida mora) o permitimos abonos?
3. **QPayPro**: confirmar que su checkout es **redirect** (hosted) y que **no** hay
   webhook async → el `confirm-charge` en el retorno + `reconcile-charges` (cron)
   son suficientes. (Si hay webhook, lo agregamos como confirmación autoritativa.)
4. **Arranque**: ¿F1 condominios primero (recomendado) o agua primero?
