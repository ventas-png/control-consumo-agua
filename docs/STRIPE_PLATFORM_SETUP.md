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

## 2. Crear los Products + Prices

En Stripe Dashboard → Products, crear 3 productos:

| Producto | Descripción |
|---|---|
| Solo Agua | Lecturas, cobros, rutas y tarifas |
| Solo Condominios | Cuotas, áreas comunes, visitantes, tickets |
| Bundle Completo | Agua + Condominios |

Cada producto debe tener **2 prices**:

| Price | Solo Agua | Solo Condominios | Bundle |
|---|---|---|---|
| Mensual | $10 USD / mes recurring | $10 USD / mes recurring | $15 USD / mes recurring |
| Anual | $100 USD / año recurring | $100 USD / año recurring | $150 USD / año recurring |

Anotar los 6 `price_id` (formato `price_1ABC...`). Se ven en la URL del
price o en su detalle.

## 3. Poblar `billing_plans.stripe_price_id_*`

Vía SQL Editor (o MCP):

```sql
UPDATE public.billing_plans
SET stripe_price_id_monthly = 'price_XXX_AGUA_MES',
    stripe_price_id_yearly  = 'price_XXX_AGUA_ANIO'
WHERE code = 'agua_only';

UPDATE public.billing_plans
SET stripe_price_id_monthly = 'price_XXX_CONDO_MES',
    stripe_price_id_yearly  = 'price_XXX_CONDO_ANIO'
WHERE code = 'condominios_only';

UPDATE public.billing_plans
SET stripe_price_id_monthly = 'price_XXX_BUNDLE_MES',
    stripe_price_id_yearly  = 'price_XXX_BUNDLE_ANIO'
WHERE code = 'bundle';
```

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
