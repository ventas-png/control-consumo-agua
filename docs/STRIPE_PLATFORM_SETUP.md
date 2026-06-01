# Stripe Platform — configuración operacional

Este documento describe los pasos manuales (no-código) que el equipo de
AdministraTodo debe completar para que la integración Stripe platform
(cobro del SaaS a las companies) empiece a funcionar.

El código ya está deployado en F2.12. Sin estos pasos, los endpoints
detectan que `STRIPE_PLATFORM_SECRET_KEY` falta y devuelven `503` con
mensaje "Stripe no configurado".

## 1. Crear/conectar la cuenta Stripe

Usar una cuenta Stripe corporate dedicada al cobro del SaaS. **Esto no
debe mezclarse con las cuentas Stripe de los tenants** — esas viven en
`company_payment_secrets` y son independientes.

Modo de operación:
- **Modo test** primero. Verificar el flow completo (signup → checkout →
  webhook → invoice) con tarjetas de prueba.
- **Modo live** cuando se cierre la validación.

## 2. Crear los Products + Prices (modelo por uso, F2.14)

El pricing es **por uso** (multi-line), no flat. Cada plan tiene **4 Prices**:

| Componente | Stripe Price recurring | Solo Agua | Solo Condominios | Bundle |
|---|---|---|---|---|
| Activación | $X/mes recurring, quantity=1 fijo | $10.00 | $10.00 | $15.00 |
| Proyecto adicional | $X/mes recurring, quantity por uso | $10.00 | $10.00 | $10.00 |
| Unidad proyecto principal | $X/mes recurring, quantity por uso | $1.00 | $1.00 | $1.00 |
| Unidad proyectos adicionales | $X/mes recurring, quantity por uso | $0.80 | $0.80 | $0.80 |

**Total Prices a crear: 12** (3 planes × 4 componentes). Yearly no se soporta todavía en el modelo por uso (queda para PR futura si producto lo pide).

En Stripe Dashboard → Products, crear 3 productos (Solo Agua, Solo Condominios, Bundle Completo). Para **cada producto** crear los 4 prices marcados como **Recurring monthly**. Anotar los 12 `price_id`.

## 3. Poblar `billing_plans.stripe_price_id_*` (modelo por uso, F2.14)

Vía SQL Editor (o MCP). Los 4 prices por plan (en `_activation`, `_extra_project`, `_unit_primary`, `_unit_extra`):

```sql
UPDATE public.billing_plans
SET stripe_price_id_activation    = 'price_XXX_AGUA_ACTIV',
    stripe_price_id_extra_project = 'price_XXX_AGUA_PROJ',
    stripe_price_id_unit_primary  = 'price_XXX_AGUA_UPRIM',
    stripe_price_id_unit_extra    = 'price_XXX_AGUA_UEXTRA'
WHERE code = 'agua_only';

UPDATE public.billing_plans
SET stripe_price_id_activation    = 'price_XXX_COND_ACTIV',
    stripe_price_id_extra_project = 'price_XXX_COND_PROJ',
    stripe_price_id_unit_primary  = 'price_XXX_COND_UPRIM',
    stripe_price_id_unit_extra    = 'price_XXX_COND_UEXTRA'
WHERE code = 'condominios_only';

UPDATE public.billing_plans
SET stripe_price_id_activation    = 'price_XXX_BUNDLE_ACTIV',
    stripe_price_id_extra_project = 'price_XXX_BUNDLE_PROJ',
    stripe_price_id_unit_primary  = 'price_XXX_BUNDLE_UPRIM',
    stripe_price_id_unit_extra    = 'price_XXX_BUNDLE_UEXTRA'
WHERE code = 'bundle';
```

> **Nota**: las columnas legacy `stripe_price_id_monthly` y `stripe_price_id_yearly` quedan inutilizadas en el modelo por uso. Pueden dejarse NULL o eliminarse en migración futura.

## 4. Configurar Edge Functions secrets en Supabase

En el dashboard de Supabase → Edge Functions → Settings → Secrets,
agregar:

| Secret | Valor |
|---|---|
| `STRIPE_PLATFORM_SECRET_KEY` | Secret key del modo test (`sk_test_...`) o live (`sk_live_...`) |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | (Pendiente — se obtiene en el paso 5) |

⚠️ **Nunca commitear estos valores al repo. No agregarlos a `.env.local` con vista al cliente — son secretos server-side.**

## 5. Crear el webhook endpoint en Stripe

En Stripe Dashboard → Developers → Webhooks → Add endpoint:

- **Endpoint URL**: `https://<tu-supabase-project-ref>.supabase.co/functions/v1/stripe-platform-webhook`
- **API version**: usar la default
- **Listen to**: "Events on your account"
- **Select events**:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.finalized`

Después de crear, Stripe muestra el **Signing secret** (`whsec_...`).
Copiarlo y pegarlo como `STRIPE_PLATFORM_WEBHOOK_SECRET` en los secrets
de Supabase (paso 4).

## 6. Smoke test

1. Loggearse como `company_owner` de una company existente.
2. Profile → "Cambiar plan" → seleccionar uno distinto al actual → "Mensual".
3. Stripe Checkout abre con tarjeta de prueba `4242 4242 4242 4242` (cualquier CVC, fecha futura).
4. Confirmar pago → redirige a `/perfil?checkout=success`.
5. En 1-3 segundos la card "Mi plan" debería reflejar el nuevo plan.
6. En Stripe Dashboard → Customers, ver el customer recién creado.
7. En Supabase → `subscriptions`, verificar el row con `stripe_subscription_id` y `stripe_customer_id` poblados.
8. En `public.stripe_webhook_events`, verificar que `checkout.session.completed` y `customer.subscription.created` aparecen con `processed_at` poblado.

## 7. Rotación de webhook secret (cada 90 días recomendado)

Stripe permite tener 2 secrets activos simultáneamente:

1. En el webhook endpoint → "Roll secret" → Stripe genera el nuevo
2. Actualizar `STRIPE_PLATFORM_WEBHOOK_SECRET` en Supabase con el nuevo
3. Mantener el viejo activo en Stripe durante 24h por si hay eventos en cola
4. Después de 24h, expirar el viejo en Stripe

## 8. Modo live → producción

1. Cambiar secrets a `sk_live_...` y rotar webhook secret a live
2. Re-crear el endpoint del webhook en modo live (los endpoints test y live
   son separados en Stripe)
3. Re-poblar `billing_plans.stripe_price_id_*` con los IDs live (Stripe
   genera prices diferentes en test y live)
4. **Probar con un signup real desde un device incógnito antes de anunciar**

## Variables de entorno reference

```
# .env.local (NUNCA committear)
STRIPE_PLATFORM_SECRET_KEY=sk_test_XXX        # solo en Supabase Edge Functions secrets
STRIPE_PLATFORM_WEBHOOK_SECRET=whsec_XXX      # solo en Supabase Edge Functions secrets

# Estos sí son públicos, vienen ya configurados:
APP_URL=https://administratodo.app             # base URL para redirects de checkout
ALLOWED_ORIGINS=https://administratodo.app,... # CORS
```

## F4.3.4 — Habilitar Stripe Tax (IVA automático LATAM)

El código ya está listo para Stripe Tax. Para activar el cálculo automático
de IVA en las facturas mensuales:

### 1. Habilitar Stripe Tax en Dashboard

1. Login en Stripe Dashboard → **Settings → Tax**.
2. Click **Enable Stripe Tax** y completa el wizard:
   - **Origin address** — dirección fiscal de AdministraTodo (Guatemala /
     México / país de operación).
   - **Default tax behavior** — recomendado `inclusive` para B2B LATAM
     o `exclusive` si quieres mostrar IVA como línea aparte.
   - **Tax categories** — asigna los Products (los 4 prices de tu plan)
     a la categoría **SaaS – Electronic services**.
3. Habilita los países/regiones donde tienes clientes (LATAM countries +
   USA si aplica). Stripe Tax cobra ~0.5% por transacción.

### 2. Verificar los Tax Registrations

Para cada país donde quieras cobrar IVA, debes tener un **Tax Registration**
en Stripe (representando tu obligación fiscal). Si NO tienes registro en
ese país, Stripe Tax NO cobrará IVA al cliente de ese país.

Por ejemplo, si solo tienes registro en Guatemala:
- Cliente en GT → se le cobra 12% IVA Guatemala ✓
- Cliente en MX → NO se le cobra IVA (Stripe asume que tú no tienes
  obligación fiscal en MX) ✗

### 3. Probar el flow

1. Crea un company de prueba con `country = 'MX'` y `tax_id = 'XAXX010101000'`
   (RFC genérico mexicano de prueba) desde **Empresa → Datos fiscales**.
2. Inicia un checkout (Profile → Mi plan → Suscribirse).
3. En el checkout de Stripe verifica que aparece la línea **IVA / VAT** y
   que el `tax_id_collection` está habilitado (campo para que el cliente
   capture su RFC si lo prefiere).
4. Completa el pago. Verifica en `invoices` que `tax_amount_cents > 0` y
   `country_billed` está poblado correctamente.

### 4. Que no romperá si Stripe Tax NO está habilitado

El código manda `automatic_tax: { enabled: true }` siempre, pero Stripe lo
ignora si no has activado Tax en Dashboard. Los invoices entonces tendrán
`tax_amount_cents = 0` y todo funciona como antes. Activar Stripe Tax es
una decisión 100% operacional sin requerir code change.

### 5. Schema agregado (migración `20260601000030_tax_handling_stripe_tax.sql`)

- `companies.country` (ISO 3166-1 alpha-2)
- `companies.tax_id`, `tax_id_type`, `address_*`
- `invoices.subtotal_cents`, `tax_amount_cents`, `tax_id`, `tax_id_type`, `country_billed`

El webhook `stripe-platform-webhook` lee `total_tax_amounts` y
`customer_tax_ids` del Stripe Invoice cada que llega `invoice.paid` /
`invoice.finalized`, y los persiste en estos campos.

---

## Disociar Stripe Platform (Tier 1) de Stripe Tenant (Tier 2)

Para evitar confusión:

| Aspecto | Platform (este doc) | Tenant (cada company) |
|---|---|---|
| ¿Quién cobra? | AdministraTodo | La administradora/operadora |
| ¿A quién cobra? | A las companies | A los residentes/clientes finales |
| ¿Dónde viven los secrets? | Env vars de Supabase | `company_payment_secrets.stripe_secret_key` |
| ¿Webhook endpoint? | `stripe-platform-webhook` (este PR) | `stripe-webhook-handler` (existente) |
| ¿Tabla afectada? | `subscriptions`, `invoices` | `pagos`, `payment_requests` |
| ¿UI de config? | Profile → "Mi plan" | Empresa → Configuración de pagos |

Las dos integraciones son completamente independientes y se gestionan
en cuentas Stripe distintas.
