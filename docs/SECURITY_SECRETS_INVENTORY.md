# Inventario de secretos (I15)

> **Propósito.** Enumerar **cada** secreto / variable de entorno del proyecto: dónde
> vive, quién lo consume y cómo se rota. Es la fuente de verdad para auditorías,
> onboarding de operadores y respuesta a incidentes (rotación de emergencia).
>
> **Regla de oro — nunca escribir el VALOR.** Este documento lista solo el
> **nombre**, la **ubicación**, el **consumidor** y el **procedimiento de rotación**.
> Jamás se pega aquí (ni en ningún archivo versionado) el valor de un secreto. Los
> valores viven exclusivamente en los almacenes de secretos (GitHub Actions Secrets,
> Vercel Project Env, Supabase Edge Function Secrets) o en tablas *deny-all*
> service-role-only de la base de datos.
>
> **Cómo leer las tablas.** La columna *Tipo* distingue:
> - **Público por diseño** — termina en el bundle del navegador y es inspeccionable;
>   no es un secreto (anon key de Supabase, client IDs OAuth, DSN público de Sentry).
> - **Secreto** — confidencial; su filtración obliga a rotar.

---

## 0. Mapa de almacenes

| # | Almacén | Quién lo administra | Qué guarda |
|---|---|---|---|
| A | **Vercel → Project → Settings → Environment Variables** | Dueño Vercel | Variables `VITE_*` del cliente (build) por entorno (Production / Preview / Development). |
| B | **GitHub → repo → Settings → Secrets and variables → Actions** | Dueño del repo | Tokens/credenciales que usan los workflows de CI/CD. |
| C | **Supabase → Project → Edge Functions → Secrets** | Dueño Supabase | Secretos de servidor que consumen las edge functions (Deno). |
| D | **Supabase (auto-inyectado)** | Plataforma Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` disponibles a las edge functions sin configurarlos a mano. |
| E | **Tablas *deny-all* en la base** (`company_payment_secrets`, `fiscal_pac_secrets`, `payfac_secrets`, `company_email_configs`) | Tenants (vía edge functions) | Secretos **por tenant**: credenciales de pago/PAC/PayFac y tokens OAuth de Gmail. RLS service-role-only; jamás se proyectan al cliente. |

> Referencias cruzadas: `.env.example` (regla `VITE_*`), `vercel.json`
> (allow-list de orígenes en CSP), `docs/RUNBOOK_DEPLOY_ROLLBACK.md`,
> `docs/ALERTING.md`, `SECURITY_FIX_SUMMARY.md` (contexto histórico de la fuga de
> la public key de EmailJS).

---

## A. Cliente (browser) — `VITE_*` en Vercel

Toda variable con prefijo `VITE_` se **incrusta en el bundle** y es pública. Por eso
solo deben llevar este prefijo valores públicos por diseño. **Ningún secreto real
lleva `VITE_`** (lección histórica: EmailJS, ver `SECURITY_FIX_SUMMARY.md`).

| Nombre | Tipo | Consumidor | Notas |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Público | `src/lib/supabase` (cliente) | URL del proyecto Supabase. |
| `VITE_SUPABASE_ANON_KEY` | Público por diseño | Cliente Supabase | Anon key; la seguridad real la da RLS, no el secreto de esta key. |
| `VITE_COUNTRY_CODE` | Público (config) | App | Código país por defecto (502 GT). |
| `VITE_APP_URL` | Público (config) | App / OAuth redirect | URL pública del sitio. |
| `VITE_GOOGLE_CLIENT_ID` | Público por diseño | OAuth Gmail (inicio) | Client **ID** OAuth (el *secret* va en Edge, no aquí). |
| `VITE_SENTRY_DSN` | Público por diseño | `src/lib` Sentry | El DSN es público; permite ingestar eventos, no leerlos. Si se omite, Sentry queda desactivado. |
| `VITE_APP_ENV` | Público (config) | Sentry/PostHog tags | `production` / `preview` / `staging`. En Vercel se sugiere `=$VERCEL_ENV`. |
| `VITE_APP_VERSION` | Público (config) | Sentry release | Opcional. |
| `VITE_POSTHOG_KEY` | Público por diseño | `src/lib/analytics.ts` | Project API key de PostHog (key de *ingesta*, pública por diseño). Si se omite, PostHog queda desactivado. |
| `VITE_POSTHOG_HOST` | Público (config) | `src/lib/analytics.ts` | Host del proyecto PostHog (US/EU). |

**Rotación (categoría A).** Estas son públicas o configuración; "rotar" aplica solo
a las que respaldan un servicio:
- `VITE_SUPABASE_ANON_KEY`: se rota desde Supabase → Settings → API (*roll anon key*).
  Tras rotar, actualizar el valor en Vercel (los 3 entornos) y redeploy.
- `VITE_POSTHOG_KEY`: regenerar desde PostHog → Project Settings; actualizar en Vercel.
- `VITE_SENTRY_DSN`: regenerar el DSN del proyecto en Sentry si se sospecha abuso de
  ingesta; actualizar en Vercel.
- El resto son configuración (no rotables): se cambian si cambia el dominio/proyecto.

---

## B. CI / GitHub Actions — `secrets.*`

Configurados en **repo → Settings → Secrets and variables → Actions**. Referencias de
workflow indicadas por archivo.

| Nombre | Tipo | Consumido por (workflow) | Para qué |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | **Secreto** | `apply-migrations-prod.yml`, `deploy-functions.yml`, `types-drift.yml`, `auth-hardening.yml`, `security-guard.yml`, `cleanup-preview-branches.yml` | Token de la Management API de Supabase (aplicar SQL, desplegar funciones, generar tipos, auditar catálogo, borrar previews). **Si expira o se revoca, los seis fallan a la vez** — el 2026-08-01 se cayó entre las 03:05 y las 08:09 UTC y salió a la luz por `cleanup-preview-branches` y `security-guard`, ambos con `401 Unauthorized`. |
| `SUPABASE_PROJECT_ID` | Sensible (id) | mismos que arriba | Identifica el proyecto destino. No es un secreto fuerte, pero se trata como config protegida. |
| `SUPABASE_DB_PASSWORD` | **Secreto** | `apply-migrations-prod.yml` (si aplica vía conexión directa) | Password de la base de producción. |
| `VERCEL_TOKEN` | **Secreto** | `deploy-staging.yml`, `promote-production.yml` | Token de la API de Vercel (build/deploy/alias/promote/rollback). |
| `VERCEL_ORG_ID` | Sensible (id) | `deploy-staging.yml`, `promote-production.yml` | Identifica la org de Vercel. |
| `VERCEL_PROJECT_ID` | Sensible (id) | `deploy-staging.yml`, `promote-production.yml` | Identifica el proyecto de Vercel. |
| `SLACK_WEBHOOK_URL` | **Secreto** | `ci-alert.yml` | Webhook entrante de Slack para alertas de CI/Deploy. |
| `SENTRY_AUTH_TOKEN` | **Secreto** | build (`vite.config.ts` → `sentryVitePlugin`) en CI | Subir source maps a Sentry. Solo activa el plugin si están los 3 (`_TOKEN`/`_ORG`/`_PROJECT`). |
| `SENTRY_ORG` | Sensible (id) | build CI | Org de Sentry para subir source maps. |
| `SENTRY_PROJECT` | Sensible (id) | build CI | Proyecto de Sentry para subir source maps. |
| `E2E_BASE_URL` | Sensible (config) | `e2e.yml` | Candidato ESTÁTICO opcional de URL para Playwright; el preflight resuelve normalmente el despliegue por SHA y lo somete a validación positiva. Si falta, el job NO se skipea (fail-closed; ver e2e/README.md). |
| `E2E_LOGIN_EMAIL` | **Secreto** | `e2e.yml` | Credenciales de la cuenta de prueba E2E. Obligatoria: sin ella el job queda ROJO. |
| `E2E_LOGIN_PASSWORD` | **Secreto** | `e2e.yml` | Password de la cuenta de prueba E2E. Obligatoria. |
| `E2E_RESTRICTED_EMAIL` / `E2E_RESTRICTED_PASSWORD` | **Secreto** | `e2e.yml` | Usuario de rol restringido (viewer/operator) del mismo tenant. Obligatorias. |
| `E2E_EXPECTED_SUPABASE_REF` | Sensible (id) | `e2e.yml` | Declaración del proyecto Supabase sandbox contra el que corre la suite. Obligatoria. |
| `E2E_VERCEL_BYPASS_TOKEN` | **Secreto** | `e2e.yml` | Protection Bypass for Automation de Vercel (header `x-vercel-protection-bypass`). Obligatoria; nunca se imprime. |
| `E2E_INVITE_TOKEN` | **Secreto** | `e2e.yml` | Token de invitación para el flujo de aceptar invitación (efímero, condicional). |
| `E2E_FISCAL_SANDBOX_READY` | Flag | `e2e.yml` | Habilita los caminos fiscales contra Sandbox. No es secreto (condicional). |
| `RLS_SUPABASE_URL` | Sensible (config) | `coverage.yml` (harness RLS) | Proyecto contra el que corre el harness de RLS. |
| `RLS_SUPABASE_ANON_KEY` | Público por diseño | `coverage.yml` (harness RLS) | Anon key del proyecto de pruebas RLS. |
| `RLS_USER_A_EMAIL` / `RLS_USER_A_PASSWORD` | **Secreto** | `coverage.yml` (harness RLS) | Usuario A para probar aislamiento entre tenants. |
| `RLS_USER_B_EMAIL` / `RLS_USER_B_PASSWORD` | **Secreto** | `coverage.yml` (harness RLS) | Usuario B para probar aislamiento entre tenants. |

**Rotación (categoría B).**
1. Regenerar el token/credencial en el sistema de origen (Supabase Account → Access
   Tokens; Vercel → Account → Tokens; Slack → app/webhook; Sentry → Auth Tokens).
2. Actualizar el secret en GitHub Actions (mismo nombre).
3. Revocar el valor anterior en el sistema de origen.
4. Re-ejecutar un workflow que lo use para confirmar (p.ej. `types-drift.yml`).
5. Para credenciales E2E/RLS: rotar el password del usuario de prueba en Supabase Auth
   y actualizar el secret correspondiente.

---

## C. Supabase Edge Functions — `Deno.env.get(...)`

Configurados en **Supabase → Edge Functions → Secrets**. Detectados por
`Deno.env.get('NOMBRE')` en `supabase/functions/`.

| Nombre | Tipo | Consumidor (función) | Para qué |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Público por diseño | `google-oauth-*`, `complete-oauth-onboarding` | Client ID OAuth (par del secret). |
| `GOOGLE_CLIENT_SECRET` | **Secreto** | `google-oauth-*`, `send-email` | Client secret OAuth para intercambio de tokens Gmail. |
| `STRIPE_PLATFORM_SECRET_KEY` | **Secreto** | `create-checkout-session`, `create-billing-portal-session`, `stripe-platform-webhook` | Secret key de la cuenta **plataforma** de Stripe (billing del SaaS). |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | **Secreto** | `stripe-platform-webhook` | Verifica la firma HMAC del webhook de Stripe plataforma. |
| `CRON_SECRET` | **Secreto** | funciones invocadas por `pg_cron` / triggers | Token compartido para autenticar invocaciones de cron sin JWT. |
| `EMAIL_TRACKING_SECRET` | **Secreto** | `send-email`, `notifications-dispatcher`, `track-email-open` | Firma los tokens HMAC del píxel de apertura de correos. **Separada de `CRON_SECRET` a propósito**: los tokens del píxel salen al mundo en cada correo, mientras que `CRON_SECRET` autoriza rutas privilegiadas y lo comparten 6 funciones. Si no está puesta, se cae a `CRON_SECRET` (transitorio) — retirar ese fallback una vez provisionada. |
| `TENANT_SECRETS_ENC_KEY` | **Secreto crítico** | `_shared/secretsCrypto.ts` (cifrado en reposo de secretos por tenant, P0 #7) | Llave AES-256 (base64, 32 bytes) para cifrar/descifrar las tablas *deny-all* de categoría E. Vive **solo** aquí; jamás en la base. Si se omite, el cifrado queda en passthrough (texto plano). Rotación y provisión: `docs/RUNBOOK_TENANT_SECRETS_ENCRYPTION.md`. |
| `ALLOWED_ORIGINS` | Sensible (config) | helper CORS compartido | Allow-list de orígenes adicionales para CORS. |
| `APP_URL` | Sensible (config) | varias (CORS/redirect) | URL pública usada como origen permitido de respaldo. |
| `BILLING_SYNC_DRY_RUN` | Flag | sync de billing | Modo simulación; no es secreto. |
| `TWILIO_ACCOUNT_SID` | **Secreto** | dispatcher de notificaciones (WhatsApp/SMS) | SID de la cuenta Twilio. |
| `TWILIO_AUTH_TOKEN` | **Secreto** | dispatcher de notificaciones | Auth token de Twilio. |
| `TWILIO_WHATSAPP_FROM` | Sensible (config) | dispatcher de notificaciones | Número emisor WhatsApp. |
| `WHATSAPP_PROVIDER` | Config | dispatcher de notificaciones | Selector de proveedor (Twilio / Meta). |
| `WHATSAPP_TOKEN` | **Secreto** | dispatcher de notificaciones (Meta) | Token de la WhatsApp Cloud API. |
| `WHATSAPP_PHONE_ID` | Sensible (config) | dispatcher de notificaciones | Phone number ID de Meta. |
| `WHATSAPP_TEMPLATE` / `WHATSAPP_TEMPLATE_LANG` | Config | dispatcher de notificaciones | Plantilla e idioma. |
| `SENTRY_DSN` | Público por diseño | `_shared/sentry.ts` (todas las funciones) | DSN público para reportar errores del servidor. |
| `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE` | Config | `_shared/sentry.ts` | Tags opcionales. |
| `SUPABASE_ANON_KEY` | Público por diseño | varias | Anon key (ver categoría D, auto-inyectado). |

> **Nota ownership T2.** Las variables `TWILIO_*` y `WHATSAPP_*` las consume el track
> de notificaciones (T2). Se listan aquí por completitud del inventario; su rotación la
> coordina ese track.

**Rotación (categoría C).**
1. Regenerar el secret en el proveedor (Google Cloud Console → Credenciales; Stripe →
   Developers → API keys / Webhooks; Twilio/Meta → consola del proveedor).
2. `supabase secrets set NOMBRE=...` (o UI: Edge Functions → Secrets) con el nuevo valor.
3. Re-desplegar las funciones afectadas (`deploy-functions.yml`) si la plataforma no
   recarga en caliente.
4. Revocar el valor anterior en el proveedor.
5. Para webhooks de Stripe: actualizar primero el endpoint/secret en Stripe y verificar
   con un evento de prueba antes de revocar el viejo.

---

## D. Supabase auto-inyectados

Disponibles para las edge functions **sin configurarlos**; los administra la plataforma.

| Nombre | Tipo | Consumidor | Notas |
|---|---|---|---|
| `SUPABASE_URL` | Público | edge functions | URL del proyecto. |
| `SUPABASE_ANON_KEY` | Público por diseño | edge functions (cliente con contexto de usuario) | Anon key. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreto crítico** | edge functions (bypass RLS) | Llave service_role: acceso total saltando RLS. **Jamás** al cliente ni a logs. |

**Rotación (categoría D).** `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` se rotan
desde **Supabase → Settings → API → *Roll keys***. Al rotar service_role, todas las
edge functions toman el nuevo valor automáticamente (auto-inyectado). Al rotar anon,
actualizar también `VITE_SUPABASE_ANON_KEY` en Vercel (categoría A) y los secrets RLS de
CI si aplica. **Rotar service_role es disruptivo**: planearlo en ventana de
mantenimiento y validar las funciones tras el roll.

---

## E. Secretos por tenant (tablas *deny-all* en la base)

No son variables de entorno: son secretos **de cada tenant**, guardados en tablas con
**RLS habilitado y policy *deny-all*** → solo `service_role` (vía edge function) accede.
El cliente **nunca** los lee; solo ve metadata/flags vía RPCs `SECURITY DEFINER`
acotadas. Patrón establecido en `company_payment_secrets` y replicado en el resto.

> **Cifrado en reposo (P0 #7).** Además del RLS, estos valores se cifran con
> AES-256-GCM (`_shared/secretsCrypto.ts`, llave `TENANT_SECRETS_ENC_KEY` fuera de la
> base). En curso por fases (expand→migrate→contract): la ruta de **pagos** ya está
> cableada; fiscal/payfac/email siguen. Provisión de llave, orden de cableado y
> backfill: `docs/RUNBOOK_TENANT_SECRETS_ENCRYPTION.md`. El cifrado es passthrough
> (texto plano) hasta que se provisiona la llave, así que no altera el flujo actual.

| Tabla | Contenido | Escrito por (edge) | Metadata expuesta (RPC) |
|---|---|---|---|
| `company_payment_secrets` | `stripe_secret_key`, `stripe_webhook_secret`, `paypal_client_secret` por empresa | `save-payment-config`, webhooks de Stripe | vista `companies_safe` (sin secretos) |
| `fiscal_pac_secrets` | `credenciales` (jsonb) del PAC/certificador por `(company_id, project_id)` | `fiscal-save-credentials`, `fiscal-test-connection`, `timbrar-documento` | `fiscal_pac_estatus(uuid)` → proveedor + estado, sin credenciales |
| `payfac_secrets` | credenciales del PayFac por tenant | `payfac-save-credentials`, `payfac-test-connection`, `create-charge` | estatus no sensible vía RPC dedicada |
| `company_email_configs` | tokens OAuth de Gmail por empresa | `complete-oauth-onboarding`, `send-email` | flags de conexión, sin tokens |

**Garantías de seguridad (verificables en las migraciones).**
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policy `"Deny access to all"` → ni
  `anon` ni `authenticated` leen la fila.
- Toda función `SECURITY DEFINER` que toca estas tablas:
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` **por nombre de rol** +
  `GRANT EXECUTE ... TO service_role` (revocar solo `PUBLIC` **no basta** en Supabase).
- Migraciones de referencia: `20260408000001_create_payment_secrets_table.sql`,
  `20260409000004_add_rls_policy_company_payment_secrets.sql`,
  `20260604230000_fiscal_per_location_config_and_pac_vault.sql`,
  `20260604233000_payfac_pluggable_config_and_vault.sql`,
  `20260511000001_company_email_config.sql`.

**Rotación (categoría E).** La hace el tenant desde la UI (Empresa → Integraciones /
Configuración fiscal / Pagos), que invoca la edge function de `save-credentials`
correspondiente. Esa función reemplaza el valor en la tabla *deny-all*. Para rotación de
emergencia operada por plataforma: regenerar la credencial en el proveedor del tenant,
escribir el nuevo valor vía la edge function con `service_role`, y verificar con la
función `test-connection`. **Nunca** editar estas tablas a mano exponiendo el valor.

---

## Checklist de rotación (genérico)

Usar ante sospecha de filtración, salida de un operador con acceso, o rotación
periódica programada.

- [ ] **Identificar** el secreto en este inventario (categoría A–E) y su almacén.
- [ ] **Generar** el nuevo valor en el sistema de origen (proveedor / Supabase / Vercel).
- [ ] **Publicar** el nuevo valor en el almacén correspondiente (Vercel env / GitHub
      Actions secret / Supabase Edge secret / tabla *deny-all* vía edge function).
- [ ] **Re-desplegar / redeploy** lo que tome el valor en build o arranque
      (Vercel redeploy; `deploy-functions.yml`).
- [ ] **Verificar** que el sistema funciona con el nuevo valor (smoke test, webhook de
      prueba, `test-connection`).
- [ ] **Revocar** el valor anterior en el sistema de origen.
- [ ] **Auditar** logs por usos del valor viejo tras la revocación.
- [ ] **Registrar** la rotación (fecha, secreto, motivo) en el canal de seguridad.

### Registro de rotaciones

El checklist pide registrar cada rotación. Se anota aquí, en el repo, para que
quede junto al inventario y no solo en un canal de chat que nadie relee.

| Fecha | Secreto | Motivo | Notas |
| --- | --- | --- | --- |
| 2026-08-03 | `SUPABASE_ACCESS_TOKEN` | Expiración o revocación **no planificada** | El token dejó de servir entre las 03:05 y las 08:09 UTC del 2026-08-01: a las 03:04 `apply-migrations-prod` aplicó la migración de #696 en verde y a las 03:05 `security-guard` leyó el catálogo sin problema; a las 08:09 `cleanup-preview-branches` ya daba `401 Unauthorized`. Sin cambios de código en esa ventana. Detectado por CI, no por una persona. Los siete workflows que ENTONCES compartían el token estuvieron caídos ~2 días, `apply-migrations-prod` entre ellos. (Hoy son seis: `apply-migration.yml` se eliminó al cerrar I9.) |

**Lección de esa caída:** este token no avisa antes de morir y se lleva por
delante el despliegue de migraciones a producción. Si al generar el reemplazo
Supabase ofrece fecha de expiración, **anotarla en la fila de arriba** y poner un
recordatorio antes de que llegue. Un token sin fecha registrada es la misma
trampa otra vez.

### Prioridad ante incidente (rotar primero lo más crítico)

1. `SUPABASE_SERVICE_ROLE_KEY` (acceso total, bypass RLS).
2. `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` (control de la base/proyecto).
3. `STRIPE_PLATFORM_SECRET_KEY` / `STRIPE_PLATFORM_WEBHOOK_SECRET` (dinero).
4. `GOOGLE_CLIENT_SECRET`, `VERCEL_TOKEN`, `TWILIO_AUTH_TOKEN` / `WHATSAPP_TOKEN`.
5. Secretos por tenant comprometidos (categoría E) — coordinar con el tenant.
6. `SLACK_WEBHOOK_URL`, credenciales E2E/RLS, claves públicas por diseño (menor riesgo).

---

> **Mantenimiento.** Al agregar una env var, un secret de CI, un secret de edge function
> o una tabla de secretos por tenant, **actualizar este inventario en el mismo PR**. Un
> secreto sin entrada aquí es un secreto que nadie sabe rotar.
