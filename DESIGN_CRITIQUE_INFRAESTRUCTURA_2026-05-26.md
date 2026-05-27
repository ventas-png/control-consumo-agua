# Design Critique — Infraestructura (Edge Functions · CI/CD · Layout · Monitoring · Seguridad)

**Fecha:** 2026-05-26
**Alcance:** 14 edge functions, 3 workflows de GitHub Actions, deployment Vercel, layout/shell de la app, Sentry/PostHog, headers de seguridad, storage Supabase, libs transversales, tests globales.
**Objetivo:** Identificar deudas técnicas, riesgos de seguridad y debilidades operacionales que afectan al **operar como SaaS multi-tenant en producción**.
**Repo:** `ventas-png/control-consumo-agua` · v2.0.0
**Documentos relacionados:** `DESIGN_CRITIQUE_PLATAFORMA_SAAS_2026-05-26.md`, `SECURITY_FIX_SUMMARY.md`, `SECURITY_UX_AUDIT_2026-04-07.md`.

---

## 1. Resumen ejecutivo

La infraestructura tiene **buena base de seguridad** (CSP estricta sin `unsafe-inline` en script-src, HSTS, X-Frame-Options DENY, sessionStorage, magic-byte file validation, secretos correctamente segregados en `.env.example`, buckets privados desde mayo 2026) pero **carece de varios estándares de operación SaaS**:

**Fortalezas:**
- `vercel.json` CSP correcta + headers de seguridad robustos.
- 14 edge functions (`auth/oauth/onboarding/payments/notifications/security`) modularizadas — 3.170 LOC.
- Sentry + PostHog configurados con privacidad por defecto (sample 10%, sendDefaultPii=false, sessión replay off).
- Source maps Sentry opcionales (no si secretos faltan).
- Vite chunking explícito (vendor-react, vendor-charts, vendor-maps, vendor-pdf, vendor-xlsx, vendor-ui, vendor-observability).

**Debilidades graves:**

1. **6 edge functions con `--no-verify-jwt`** (create-cliente-account, delete-user, create-user, log-security-event, complete-oauth-onboarding, notify-package, route-reminders). Solo CORS las protege; si el secret `ALLOWED_ORIGINS` se filtra, son endpoints abiertos.
2. **CI sin lint, sin coverage threshold, sin bundle-size budget.**
3. **Sin `ErrorBoundary` global.** `grep -r "ErrorBoundary" src/` retorna vacío — un crash deja al usuario en pantalla blanca sin reporte automático.
4. **`useOffline` solo detecta**, no es offline-first. Sin service worker, sin cola de sync, sin caché.
5. **NAV del sidebar hard-coded** (`Sidebar.tsx:683 LOC` con `NAV` array). Agregar módulo requiere code push.
6. **Rate-limiting ausente en edge functions críticas** (`create-user`, `create-cliente-account`, `log-security-event`).
7. **PostHog sin tagging multi-tenant automático.** Cada `track()` debe taguear manualmente.
8. **Cero tests** de edge functions.
9. **Sin Deno lint en CI de funciones.**
10. **No hay landing pública** dentro de la SPA (index.html es solo shell). Adquisición SaaS requiere marketing site separado.

**Conteo de hallazgos:**

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 8 |
| 🟠 Alto    | 14 |
| 🟡 Medio   | 12 |
| 🔵 Bajo    | 4 |
| **Total** | **38** |

> Nota: `I39` añadido el 2026-05-27 al descubrir, vía CI del [PR #168](https://github.com/ventas-png/control-consumo-agua/pull/168), que las migraciones del repo no son aplicables a una DB limpia (`companies`, `projects`, `user_project_assignments`, `pagos` no se crean en ninguna migración).

**Bloqueantes para SaaS:** I1 (edge functions sin JWT), I3 (ErrorBoundary global), I4 (PWA/offline), I7 (CI sin checks), I8 (rate-limiting), I12 (sidebar hard-coded), I22 (cero tests edge functions), **I39 (migraciones no replicables desde cero)**.

---

## 2. Eje I — Infraestructura

### I1 · 🔴 Crítico — 6 edge functions con `--no-verify-jwt`

`.github/workflows/deploy-functions.yml:39-115` marca:
- `create-cliente-account` (177 LOC) — onboarding sin auth, deliberado.
- `create-user` (212 LOC) — admin crea usuario.
- `delete-user` (213 LOC) — admin borra usuario.
- `log-security-event` (130 LOC) — registra eventos pre-login.
- `complete-oauth-onboarding` (146 LOC) — link Google user.
- `notify-package` (382 LOC) — disparado por trigger Postgres con service_role.
- `route-reminders` (424 LOC) — cron via pg_cron.

Protección actual: CORS origin check + `ALLOWED_ORIGINS` secret. Si el secret leaks o un atacante puede manipular `Origin` header desde un dominio aliado, queda expuesto.

**Impacto SaaS:** `create-user` y `delete-user` sin JWT es bomba de tiempo. Aunque autentique al admin de origen del request, el handler debe revalidar permisos por tenant.

**Recomendación:**
- `create-user` y `delete-user`: requerir JWT + verificar que el caller sea admin de la company target.
- `complete-oauth-onboarding`: validar state token firmado.
- `log-security-event`: requerir token de single-use (`event_id` generado en cliente con HMAC).
- `notify-package` y `route-reminders`: validar header `X-Internal-Secret` (rotable) en vez de exponer endpoint.

---

### I2 · 🔴 Crítico — Rate-limiting ausente en edge functions críticas

`create-user`, `create-cliente-account`, `log-security-event`, `delete-user` sin throttle. Un atacante puede crear miles de cuentas falsas o inundar el log de seguridad.

**Recomendación:** Tabla `edge_rate_limits` (function, key (IP|user_id), count, window_start). Helper `checkRateLimit(fn, key, max, windowSec)` invocado al inicio de cada function crítica.

---

### I3 · ✅ Resuelto en [PR #167](https://github.com/ventas-png/control-consumo-agua/pull/167) — ~~Sin `ErrorBoundary` global~~

> **Hallazgo original:** la clase `ErrorBoundary` existía en `src/components/ErrorBoundary.tsx` (con captura a Sentry + manejo de chunk-load errors tras deploy) pero solo se usaba por sección dentro de `App.tsx`, dejando expuesto cualquier crash que escapara esos boundaries (e.g. errores durante el montaje del shell, layout, providers).
>
> **Resolución:** `src/main.tsx` ahora envuelve `<App />` con `<ErrorBoundary sectionName="root">`. Reutiliza el componente existente (cero código nuevo de lógica, cero riesgo).

---

### I4 · 🔴 Crítico — `useOffline` solo detecta — no es offline-first

`src/hooks/useOffline.ts:31 LOC` solo escucha `navigator.onLine` y guarda flag en `localStorage`. No:
- No registra service worker.
- No cachea responses.
- No tiene cola de sync para mutations.
- No intercepta requests fallidos.

**Impacto SaaS:** El módulo de agua se usa en campo (3G/4G intermitente, sin señal). Lecturas perdidas = trabajo repetido.

**Recomendación:** **Vite PWA Plugin** + Workbox runtime caching + IndexedDB para mutations queue. Sync al recuperar conexión. Indicador visual de "N pendientes por sincronizar".

---

### I5 · 🔴 Crítico — Sidebar hard-coded (`NAV` array)

`src/components/layout/Sidebar.tsx:683 LOC` declara `NAV` array con grupos/tabs hard-coded. Agregar un módulo (e.g., "gas") requiere code push. Mostrar/ocultar por plan/feature flag exige `if` repartidos.

**Recomendación:**
- Registry de módulos (`src/lib/moduleConfig.ts` parcialmente lo intenta).
- Sidebar consume el registry filtrando por permisos del usuario y módulos activos del tenant (`companies.servicio_*`, futuros feature flags).
- Cuando se promueva a router (Fase 1 plataforma), sidebar genera nav desde routes config.

---

### I6 · 🔴 Crítico — `Sidebar.tsx` (683L) y `Topbar.tsx` (250L) acoplan PAGE_TITLES/ICONS

`Topbar.tsx` referencia `PAGE_TITLES` y `PAGE_ICONS` hard-coded. Cualquier nueva sección requiere editar Sidebar + Topbar + activeSection switch en App.tsx.

**Recomendación:** Definir título/icono en la definición de cada ruta. Topbar lee del router.

---

### I7 · ⏳ Parcial — ~~CI sin lint / sin coverage threshold / sin bundle-size budget~~

> **Avance ([PR #168](https://github.com/ventas-png/control-consumo-agua/pull/168)):** se agregó `npm run test:coverage` con `@vitest/coverage-v8` (text/html/json-summary) y un step en `ci.yml` que sube el reporte como artifact. **Sin threshold inicial** porque la instrumentación de v8 hace flake un test de timing en `ImportModal.test.tsx`; el step corre como advisory (`continue-on-error: true`) y `npm run test` sin coverage sigue siendo el gate.
>
> **Pendiente** en lotes posteriores:
> - Arreglar el flake del test sensible al timing (probable: aumentar `waitFor` timeout o cambiar a `act`).
> - Fijar threshold mínimo en archivos críticos (`business.ts`, `validation.ts`, `security.ts`).
> - ESLint (`@typescript-eslint`, `react-hooks`, `react-refresh`) en CI.
> - `size-limit` con presupuesto por chunk (`vendor-charts < 200KB`, `vendor-pdf < 250KB`).
> - Lighthouse CI sobre URL de preview Vercel.

---

### I8 · ⏳ Parcial — ~~Deploy de edge functions sin tests~~

> **Avance ([PR #168](https://github.com/ventas-png/control-consumo-agua/pull/168)):** nuevo job `lint-functions` en `deploy-functions.yml` con `deno fmt --check` y `deno lint` (vía `denoland/setup-deno@v1`). Modo **advisory** (`continue-on-error: true`) mientras se estabiliza la baseline; ya queda como prerequisito (`needs: [check-secrets, lint-functions]`) del job de deploy.
>
> **Pendiente:**
> - Limpiar baseline aplicando `deno fmt -w` y resolviendo warnings de `deno lint` en las 14 funciones existentes; luego quitar `continue-on-error` para hacerlo enforce.
> - Tests con `deno test` por función crítica (`create-payment-intent`, `stripe-webhook-handler`, `notify-package`, etc.).

---

### I9 · 🟠 Alto — `apply-migration` workflow con riesgo de inyección

`.github/workflows/apply-migration.yml` usa Supabase Management API y envía `migration_file` como input. Si alguien crea un PR con migración maliciosa y un maintainer la ejecuta sin revisar, se aplica a producción.

**Recomendación:**
- Solo aplicar migraciones que estén en `main` y que pasen pre-checks (lint sql, dry-run en proyecto branch de Supabase).
- Requiere review explícito (CODEOWNERS, branch protection).

---

### I10 · ✅ Resuelto en [PR #169](https://github.com/ventas-png/control-consumo-agua/pull/169) — ~~PostHog sin tagging multi-tenant automático~~

> **Resolución:** nueva función `registerSuperProperties({ company_id, role, plan })` en `src/lib/analytics.ts`. `src/App.tsx` la invoca dentro del efecto que identifica al usuario después del login, justo a continuación de `identify()`. Cada `track()` posterior llevará esas props automáticamente; `resetAnalytics()` las limpia vía `posthog.reset()` en el logout. La convención de eventos (verb_object) queda pendiente para una guía de estilo separada.

---

### I11 · ✅ Resuelto en [PR #169](https://github.com/ventas-png/control-consumo-agua/pull/169) — ~~Sentry sample rate 10% en prod sin sampling por severity~~

> **Resolución:** `src/lib/monitoring.ts` reemplaza `tracesSampleRate: 0.1` por `tracesSampler` por función:
> - **No-prod:** 100% (debug local conserva todo).
> - **Prod, rutas críticas** (`login`, `oauth`, `payment`, `stripe`, `create-user`, `delete-user`, `create-payment-intent`): 100%.
> - **Prod, traces con `parentSampled === true`** (heredan de un trace ya sampleado o de error): 100%.
> - **Prod, resto:** 10%.
>
> Cuando se introduzca routing real (Fase 1), refactorizar para leer la lista de rutas críticas de un registry en vez de string-match.

---

### I12 · 🟠 Alto — Source maps Sentry "best-effort"

`vite.config.ts` solo hace upload de source maps si las 3 env vars están presentes (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`). Sin chequeo en CI que falle si faltan en `main`.

**Recomendación:** Workflow secret obligatorio en `main`. Fail-fast si falta.

---

### I13 · 🟠 Alto — File upload validation only client-side

`src/lib/fileValidation.ts` documenta el bypass: un cliente que llama REST API Supabase Storage directo se salta la validación. SECURITY_FIX_SUMMARY.md menciona el faltante.

**Recomendación:** Edge function `validate-and-upload` (recibe binario, valida magic bytes server-side, sube a Storage). Las funciones existentes (`SecureImage`, etc.) la usan en vez de subir directo.

---

### I14 · 🟠 Alto — Storage policies abren bucket a todo `authenticated`

Aunque los buckets son privados (`condominios-media`, `conv-attachments`, logos), las policies permiten `select/insert/update/delete` a cualquier `authenticated`. Sin scoping por path (`{company_id}/{unidad_id}/...`).

**Recomendación:** Storage policies que validen `(storage.foldername(name))[1] = (SELECT company_id::text FROM app_users WHERE id = auth.uid())`. Cubierto también en critique de condominios.

---

### I15 · 🟠 Alto — Source de secretos heterogénea

- Vite env vars: en `VITE_*` (cliente, safe).
- Edge functions: Supabase Secrets (Deno env).
- GitHub Actions: GitHub Secrets.
- Sin documento que explique qué va dónde y rotación.

**Recomendación:** `SECRETS_INVENTORY.md` con tabla: secret, dónde se setea, cómo se rota, expiración.

---

### I16 · 🟠 Alto — Sin separación staging / production

Solo hay un proyecto Supabase + Vercel. Cambios van directo a prod tras merge. Sin entorno donde validar migraciones, edge functions, integraciones.

**Recomendación:**
- Supabase: proyecto `staging` con migraciones aplicadas primero.
- Vercel: preview branches (ya existe) + un `staging.dominio.com`.
- Workflow: merge to `develop` → deploy staging; merge to `main` → deploy prod tras pase manual.

---

### I17 · 🟠 Alto — Sin runbook de incidentes

Si Supabase está caído, Stripe webhook falla, Gmail token vence, etc., no hay runbook para soporte/dev.

**Recomendación:** `RUNBOOKS.md` con escenarios + comandos + contactos.

---

### I18 · 🟠 Alto — Sin alertas configuradas

Sentry y PostHog reciben datos pero no hay alertas a Slack/email cuando se cruza un umbral (errores > N en 5 min, latencia > X, login attempts spike).

**Recomendación:** Sentry alerts → Slack. PostHog alerts → email. Edge function `health-check` que pingee endpoints críticos.

---

### I19 · 🟠 Alto — Sin canary / progressive rollout

Cualquier deploy va al 100% de tenants de inmediato. Un bug crítico afecta a todos.

**Recomendación:** Feature flags PostHog para gating progresivo. Vercel Edge Config para toggles.

---

### I20 · 🟠 Alto — Sin pipeline de rollback

Si una migración corrompe datos, no hay procedimiento rápido para revertir. Edge functions no tienen versionado declarativo.

**Recomendación:**
- Migraciones reversibles (`up` + `down`).
- Snapshot Supabase pre-migration.
- `supabase functions versions list` + `set --version` para revertir edge functions.

---

### I21 · 🟠 Alto — `save-payment-config` cifrado simétrico en DB

`save-payment-config` (208 LOC) encripta Stripe/PayPal keys en `app_users.stripe_config_encrypted`. Si la DB leaks + se conoce el algoritmo + la key de cifrado, es brute-forceable.

**Recomendación:** Supabase Vault (managed KMS) o AWS KMS via edge function. Nunca llevar la clave de cifrado al cliente.

---

### I22 · 🔴 Crítico — Cero tests de edge functions

Las 14 edge functions (3.170 LOC) no tienen tests. Un cambio en `create-payment-intent` puede romper pagos sin que CI lo note.

**Recomendación:**
- `deno test` por función (mock Supabase + mock providers).
- Smoke tests E2E en staging tras deploy.

---

### I23 · 🟡 Medio — `vite.config.ts` con manualChunks frágiles

Los chunks están bien definidos hoy, pero si una dep se renombra (`chart.js@5` mueve módulos), el chunk se rompe silenciosamente.

**Recomendación:** Función `manualChunks` por regex que cubra varios casos + test que mida tamaño de cada chunk.

---

### I24 · 🟡 Medio — CSP `style-src 'unsafe-inline'`

Necesario para CSS-in-JS o estilos inline. Es la única `unsafe-*` directive.

**Recomendación:** Eliminar estilos inline (los `style={...}` dispersos en componentes) + adoptar nonces si se hace SSR.

---

### I25 · 🟡 Medio — `index.html` sin landing pública

Schema.org SoftwareApplication con pricing $10/$15 en JSON-LD, pero no hay componente Landing renderizado. La app entra directo al login.

**Recomendación:** Si se hace SaaS público, landing en `src/components/landing/` con marketing copy, pricing real, signup CTA, comparativa de planes, testimonios. O marketing site separado (Astro / Webflow) con dominio raíz y app en `app.dominio.com`.

---

### I26 · 🟡 Medio — Vercel deploy sin protección por entorno

Vercel deploya cualquier rama y crea preview pública. Esto es bueno para desarrollo, pero las preview URLs son indexables por search engines / accesibles sin auth.

**Recomendación:** Vercel password protection en previews + `robots.txt` que excluya `*.vercel.app`.

---

### I27 · 🟡 Medio — `useOffline` flag persistente en localStorage

Si el usuario activó `offline_mode` y nunca lo desactiva, queda offline indefinidamente.

**Recomendación:** TTL del flag + UI clara para alternar.

---

### I28 · 🟡 Medio — `useOffline` sin sincronización con server time

No hay clock sync entre cliente offline y server. Lecturas con timestamp futuro pueden colarse.

---

### I29 · 🟡 Medio — `NotificationBell.tsx` polling cada N segundos

Si bien existe Realtime para `useNotifications`, el bell hace polling redundante.

**Recomendación:** Suscribirse al hook `useNotifications` que ya tiene Realtime.

---

### I30 · ✅ Falso positivo — ~~`permissions-Policy` muy restrictivo~~

> **Hallazgo original:** se afirmaba que `vercel.json` declaraba `geolocation=()`, bloqueando silenciosamente la captura GPS en lecturas.
>
> **Verificación posterior:** `vercel.json:14` ya tiene `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`. El hallazgo era incorrecto. Lección: verificar con `curl -I` o devtools antes de afirmar bloqueo de un header.

---

### I31 · 🟡 Medio — Sin Subresource Integrity (SRI)

Scripts y estilos servidos desde Vercel no usan SRI. Si un CDN se compromete, el cliente carga código manipulado.

**Recomendación:** Vite plugin `vite-plugin-sri`.

---

### I32 · ✅ Resuelto en [PR #168](https://github.com/ventas-png/control-consumo-agua/pull/168) — ~~Sin `HEAD` health endpoint~~

> **Resolución:** `supabase/functions/health/index.ts` agregado: endpoint público (sin JWT), soporta `GET` y `HEAD`, devuelve 200/503 con JSON `{ status, timestamp, uptime_ms, checks }`. Verifica presencia de `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sin abrir conexiones (latencia <100ms). Listo para apuntar UptimeRobot/Pingdom/Better Uptime a `https://<project>.supabase.co/functions/v1/health`.
>
> **Próximo paso opcional:** ampliar a checks activos de DB + Storage cuando se introduzca staging (`infra:I16`).

---

### I33 · ⏳ Parcial ([PR #169](https://github.com/ventas-png/control-consumo-agua/pull/169)) — ~~Sin export de logs estructurados~~

> **Avance:** nuevo `src/lib/logger.ts` con wrapper `logger.{debug,info,warn,error}` que (a) en producción silencia `debug`, (b) deja breadcrumbs estructurados en Sentry (`Sentry.addBreadcrumb`), (c) captura `exception` automáticamente cuando `level='error'` recibe un `error` como tercer argumento.
>
> **Pendiente:**
> - Migración gradual de `console.log/warn/error` repartidos en hooks, components y libs a `logger.*`. Se hará en PRs siguientes por dominio (agua, condominios, plataforma) para mantener el blast radius pequeño.
> - Pipe del lado servidor (edge functions → Datadog/Logtail) para retención larga y búsqueda avanzada. Backend separado, no cubierto por `logger.ts`.

---

### I34 · ✅ Parcial resuelto en [PR #167](https://github.com/ventas-png/control-consumo-agua/pull/167) — ~~Sin `robots.txt` ni `sitemap.xml`~~

> **Resolución:** `public/robots.txt` agregado bloqueando rutas internas (`/auth`, `/admin`, `/empresa`, `/superadmin`, `/condominios`, `/agua`, `/api`) y declarando host canónico. `sitemap.xml` queda pendiente para cuando exista landing pública (depende de `infra:I25`).

---

### I35 · ✅ Resuelto en [PR #167](https://github.com/ventas-png/control-consumo-agua/pull/167) — ~~`.env.example` sin sección de "secretos que no van aquí"~~

> **Resolución:** `.env.example` abre con una tabla explícita: qué secretos van a Supabase Edge Functions vs GitHub Actions Secrets, regla "nada sensible con prefijo `VITE_`", referencia cruzada a `SECURITY_FIX_SUMMARY.md`.

---

### I36 · ✅ Docs cerradas (PRs [#167](https://github.com/ventas-png/control-consumo-agua/pull/167) + [#168](https://github.com/ventas-png/control-consumo-agua/pull/168)) — ~~Sentry environment hard-coded a "production"~~

> **Verificación inicial:** `src/lib/monitoring.ts:8` ya lee `VITE_APP_ENV || MODE`. El gap real era que `.env.example` no explicaba la conexión con `$VERCEL_ENV`.
>
> **PR #167** documenta apuntar `VITE_APP_ENV` a `$VERCEL_ENV` en `.env.example`. **PR #168** agrega un comentario explícito en `monitoring.ts` con la misma guía para quien lea el código.
>
> **Acción operativa restante (fuera del repo):** setear en el panel de Vercel — Project Settings → Environment Variables — la variable `VITE_APP_ENV` con valor `$VERCEL_ENV` para preview y production. Tras eso, Sentry mostrará los eventos en environments separados (`preview`, `production`, `development`).

---

### I37 · ✅ Resuelto en [PR #167](https://github.com/ventas-png/control-consumo-agua/pull/167) — ~~Sin Dependabot / Renovate~~

> **Resolución:** `.github/renovate.json` con schedule semanal (lunes 8am, TZ America/Guatemala), grouping por familia (`react`, `supabase`, `observability`, `vite & vitest`, `documents & charts`, etc.), sin automerge, `vulnerabilityAlerts` activadas, `lockFileMaintenance` mensual. Requiere instalar la app de Renovate en el repo desde el marketplace de GitHub para que la config tome efecto.

---

### I38 · ✅ Resuelto en [PR #167](https://github.com/ventas-png/control-consumo-agua/pull/167) — ~~Sin `CODEOWNERS`~~

> **Resolución:** `.github/CODEOWNERS` con reviews obligatorios en: auth/RBAC (`useAuth.ts`, `usePermissions.ts`, `security.ts`, `permissions.ts`, etc.), edge functions de pagos/usuarios/OAuth, migraciones SQL, workflows CI, `vercel.json`, `vite.config.ts`, `package.json` y documentos de critique/seguridad. Para enforcement real, configurar branch protection en `main` con "Require review from Code Owners".

---

### I39 · 🔴 Crítico — Migraciones no aplicables desde cero (Supabase Branching roto)

> **Descubierto al correr CI del [PR #168](https://github.com/ventas-png/control-consumo-agua/pull/168).**

La primera migración cronológica del repo es `supabase/migrations/20260318000000_enable_rls_public_schema.sql` y arranca con:

```sql
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_project_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
```

Pero **ninguna migración del repo crea estas tablas** — sólo `public.app_users` aparece como `CREATE TABLE` en migrations (`20260320000000_fix_superadmin_app_users_uuid.sql`). Las demás (`companies`, `projects`, `user_project_assignments`, `pagos`) viven en el proyecto Supabase principal porque se crearon manualmente antes de comenzar a versionar con migrations.

**Consecuencia inmediata:** Supabase Branching levanta una DB limpia y al aplicar la primera migración explota con `relation "public.companies" does not exist (SQLSTATE 42P01)`. Esto rompe la integración de preview branches por PR.

**Consecuencia mayor:** el repo **no es reproducible desde cero** (`supabase db reset` falla; clonar y aplicar migrations también). Bloqueante para `infra:I16` (separación staging/prod), `infra:I20` (pipeline de rollback) y para onboarding de nuevos devs.

**Recomendación SaaS:**
1. **PR dedicado** (no quick win) que cree `supabase/migrations/20260100000000_baseline_legacy_tables.sql` con `CREATE TABLE IF NOT EXISTS` de las 4 tablas legacy (`companies`, `projects`, `user_project_assignments`, `pagos`) usando el schema actual de producción.
2. Validar contra el proyecto principal con `pg_dump --schema-only` antes de mergear.
3. Verificar localmente con `supabase db reset` que todas las migrations aplican limpias.
4. Documentar en `supabase/migrations/README.md` la convención: nuevas tablas siempre con `CREATE TABLE` versionado.

---

## 3. Roadmap para robustecer como SaaS

> `[+]` marca trabajo compartido con critiques previos.

### Fase 1 — Fundaciones
- `[+]` Router por dominio (resuelve I5, I6 vía route-config con título/icono).
- **ErrorBoundary global + por route** (I3).
- Registry de módulos (I5) consumido por sidebar.
- Lazy import chart.js (compartido con N22 de comunicación).

### Fase 2 — Seguridad y operación
- **JWT obligatorio + rate-limit + audit** en edge functions sensibles (I1, I2).
- **PWA con cola de sync** offline-first (I4).
- **File upload validation server-side** edge function (I13).
- **Storage policies por path/company_id** (I14).
- **Supabase Vault / KMS** para secretos de pago (I21).
- **Tests** edge functions (I22).
- **`deno lint/test`** en deploy-functions workflow (I8).
- Pin `apply-migration` a `main` + reviews obligatorios (I9).

### Fase 3 — UX
- `[+]` Adopción de sistema de diseño.
- Activar geolocation en permissions-policy (I30).
- ErrorBoundary fallbacks consultivos (I3).
- NotificationBell consume hook Realtime (I29).

### Fase 4 — Operaciones SaaS
- **Staging environment + canary** (I16, I19).
- **CI con lint + coverage threshold + size-limit + Lighthouse** (I7).
- **PostHog tagging multi-tenant automático** (I10).
- **Sentry sampling por severity + environment correcto** (I11, I36).
- **Alertas Slack/email** sobre Sentry/PostHog (I18).
- **Runbooks de incidentes** (I17).
- **Pipeline de rollback + migraciones reversibles** (I20).
- **Health endpoint + monitoreo externo** (I32).
- **Logs estructurados a Datadog/Logtail** (I33).
- **Source maps obligatorios en prod** (I12).
- **Landing pública + marketing copy** (I25).
- **Vercel preview protection** (I26).
- **`SECRETS_INVENTORY.md`** + rotación (I15).
- **CSP sin `unsafe-inline`** (I24).
- **SRI + sitemap + robots** (I31, I34).

### Fase 5 — Calidad continua
- **Dependabot/Renovate** (I37).
- **CODEOWNERS** (I38).
- `[+]` axe-core en CI (cubierto en todos los critiques).
- ManualChunks robusto con tests (I23).

---

## 4. Tabla consolidada

| ID  | Sev. | Hallazgo                                                       | Evidencia                                                                  | Fase |
|-----|------|----------------------------------------------------------------|----------------------------------------------------------------------------|------|
| I1  | 🔴   | 6 edge functions sin JWT                                        | `.github/workflows/deploy-functions.yml:39-115`                            | 2    |
| I2  | 🔴   | Rate-limiting ausente en edge functions críticas                | `supabase/functions/create-user`, `create-cliente-account`                 | 2    |
| I3  | ✅   | ~~Sin `ErrorBoundary` global~~ — resuelto PR #167                | `src/main.tsx` envuelve `<App />` con `<ErrorBoundary sectionName="root">` | 1    |
| I4  | 🔴   | `useOffline` solo detecta, no offline-first                     | `src/hooks/useOffline.ts:31 LOC`                                           | 2    |
| I5  | 🔴   | Sidebar NAV hard-coded                                            | `src/components/layout/Sidebar.tsx:683 LOC`                                 | 1    |
| I6  | 🔴   | Topbar PAGE_TITLES/ICONS hard-coded                              | `src/components/layout/Topbar.tsx:250 LOC`                                  | 1    |
| I7  | ⏳   | ~~CI sin lint / coverage / bundle-size~~ — parcial PR #168 (coverage advisory) | `.github/workflows/ci.yml` + `vite.config.ts` coverage v8       | 4    |
| I8  | ⏳   | ~~Deploy de edge functions sin tests~~ — parcial PR #168 (deno lint/fmt advisory) | `.github/workflows/deploy-functions.yml` job `lint-functions` | 2    |
| I9  | 🟠   | `apply-migration` con riesgo de inyección                         | `.github/workflows/apply-migration.yml`                                    | 2    |
| I10 | ✅   | ~~PostHog sin tagging multi-tenant automático~~ — resuelto PR #169 (`registerSuperProperties`) | `src/lib/analytics.ts`, `src/App.tsx:175` | —    |
| I11 | ✅   | ~~Sentry sample 10% sin sampling por severity~~ — resuelto PR #169 (`tracesSampler` 100%/10%) | `src/lib/monitoring.ts:21-46` | —    |
| I12 | 🟠   | Source maps Sentry "best-effort"                                   | `vite.config.ts`                                                           | 4    |
| I13 | 🟠   | File upload validation solo client-side                            | `src/lib/fileValidation.ts:12-13`                                          | 2    |
| I14 | 🟠   | Storage policies abren bucket a `authenticated`                    | `supabase/migrations/20260516000003_security_private_condominios_media_bucket.sql` | 2 |
| I15 | 🟠   | Source de secretos heterogénea sin documento                       | `.env.example` + Supabase Secrets + GH Secrets                              | 4    |
| I16 | 🟠   | Sin separación staging / production                                | Solo un proyecto Supabase                                                  | 4    |
| I17 | 🟠   | Sin runbook de incidentes                                          | no `RUNBOOKS.md`                                                            | 4    |
| I18 | 🟠   | Sin alertas configuradas (Slack/email)                             | Sentry/PostHog sin alerting                                                | 4    |
| I19 | 🟠   | Sin canary / progressive rollout                                   | deploy 100% a todos                                                        | 4    |
| I20 | 🟠   | Sin pipeline de rollback                                           | migraciones sin `down`                                                     | 4    |
| I21 | 🟠   | `save-payment-config` cifrado simétrico en DB                      | `supabase/functions/save-payment-config:208 LOC`                            | 2    |
| I22 | 🔴   | Cero tests de edge functions                                       | `supabase/functions/**/*.test.ts` empty                                    | 2    |
| I23 | 🟡   | `manualChunks` frágil                                              | `vite.config.ts`                                                           | 5    |
| I24 | 🟡   | CSP `style-src 'unsafe-inline'`                                     | `vercel.json:15`                                                           | 4    |
| I25 | 🟡   | `index.html` sin landing pública                                    | sin `src/components/landing/`                                              | 4    |
| I26 | 🟡   | Vercel preview sin password protection                              | Vercel default                                                             | 4    |
| I27 | 🟡   | `useOffline` flag sin TTL                                            | `useOffline.ts`                                                            | 2    |
| I28 | 🟡   | `useOffline` sin clock sync                                          | `useOffline.ts`                                                            | 2    |
| I29 | 🟡   | `NotificationBell` polling redundante con Realtime                  | `src/components/layout/NotificationBell.tsx:108 LOC`                       | 3    |
| I30 | ✅   | ~~`Permissions-Policy: geolocation=()` bloquea GPS~~ — falso positivo, ya `geolocation=(self)` | `vercel.json:14`                                                  | —    |
| I31 | 🟡   | Sin Subresource Integrity (SRI)                                      | `vite.config.ts`                                                           | 4    |
| I32 | ✅   | ~~Sin `HEAD` health endpoint~~ — resuelto PR #168                       | `supabase/functions/health/index.ts`                                       | —    |
| I33 | ⏳   | ~~Sin export de logs estructurados~~ — parcial PR #169 (`src/lib/logger.ts` creado; migración gradual + pipe servidor pendiente) | `src/lib/logger.ts`                                | 4    |
| I34 | ✅   | ~~Sin `robots.txt`~~ — resuelto PR #167; sitemap pendiente landing pública | `public/robots.txt`                                                  | 4    |
| I35 | ✅   | ~~`.env.example` sin sección "secretos fuera de aquí"~~ — resuelto PR #167 | tabla de secretos al inicio de `.env.example`                          | —    |
| I36 | ✅   | ~~Sentry environment hard-coded a "production"~~ — docs cerradas PRs #167+#168; setear `VITE_APP_ENV=$VERCEL_ENV` en panel Vercel queda fuera del repo | `monitoring.ts:8` ya usa `VITE_APP_ENV \|\| MODE`                | —    |
| I37 | ✅   | ~~Sin Dependabot / Renovate~~ — resuelto PR #167                       | `.github/renovate.json`                                                     | —    |
| I38 | ✅   | ~~Sin CODEOWNERS~~ — resuelto PR #167                                  | `.github/CODEOWNERS`                                                        | —    |
| I39 | 🔴   | **Migraciones no aplicables desde cero** — `companies/projects/user_project_assignments/pagos` no se crean en ninguna migración; Supabase Branching falla | `supabase/migrations/20260318000000_enable_rls_public_schema.sql:5` | 2    |

---

## 5. Priorización para SaaS

**Bloqueantes (Fase 1-2):** I1 · I2 · I3 · I4 · I5 · I6 · I7 · I22 · **I39 (nuevo crítico)**.
**Importantes (Fase 2-4):** I8 · I9 · I10 · I11 · I13 · I14 · I15 · I16 · I17 · I18 · I19 · I20 · I21 · I25.
**Mejoras (Fase 4-5):** resto.
