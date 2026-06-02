# Design Critique — Plataforma SaaS (Multi-tenancy · Auth · RBAC · Empresa · Superadmin · Perfil)

**Fecha:** 2026-05-26
**Alcance:** Auth · RBAC · Multi-tenancy · Onboarding · Billing · Audit · Gestión de usuarios y empresas
**Objetivo:** Identificar lo necesario para volver la plataforma un **SaaS multi-tenant real**, con planes/billing, onboarding automatizado, aislamiento granular y seguridad de cuentas.
**Repo:** `ventas-png/control-consumo-agua` · v2.0.0
**Documentos relacionados:** `DESIGN_CRITIQUE_AGUA_2026-05-26.md`, `DESIGN_CRITIQUE_CONDOMINIOS_2026-05-26.md`

---

## 1. Resumen ejecutivo

La plataforma tiene **RBAC bien diseñado** (sistema `roles` + `role_permissions` + `user_roles` + helpers Postgres + sync con cliente, migraciones 20260518000004-10), `sessionStorage` en lugar de `localStorage` (bien contra XSS), audit log de cambios de permisos, soporte para Google OAuth, rate-limit client-side de login.

Pero **no es un SaaS** en términos de operación comercial:

- `companies.plan` es un campo `text` sin tabla referenciable. **Sin `billing_plans`, `subscriptions`, `invoices`, `usage_metrics`.** Imposible cobrar.
- **Sin onboarding self-service** de empresa nueva ni de invitación de usuarios. El super_admin crea todo a mano.
- Un usuario pertenece a **exactamente un `company_id`** (`app_users.company_id NOT NULL`). No hay flujo para un consultor que atienda 3 administradoras o un dueño que tenga varias empresas.
- **Sin MFA**, sin SSO/SAML, sin dispositivos confiables, sin gestión de sesiones activas.
- **Super_admin / company_owner / admin tienen bypass total** en `user_has_permission()`. Cualquier acción que invoque ese helper otorga todo sin restricción.
- **Permisos cargados una sola vez al login.** Revocar permisos requiere logout o invalidación manual.
- **`EmpresaSection.tsx` es un god-component de 3.547 líneas** que orquesta empresa + proyectos + usuarios + roles + permisos + custom roles + audit log en un único archivo.
- **Cero tests** de auth, RBAC, RLS.

**Conteo de hallazgos:**

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 12 |
| 🟠 Alto    | 13 |
| 🟡 Medio   | 9 |
| 🔵 Bajo    | 3 |
| **Total** | **37** |

**Bloqueantes para lanzar SaaS:** P1 (billing/plans), P2 (onboarding empresa), P3 (invite usuario), P4 (MFA), P5 (multi-empresa por user), P6 (bypass de admins), P7 (sync permisos en vivo), P12 (EmpresaSection god-component), P15 (cero tests).

---

## 2. Eje P — Plataforma (Multi-tenancy / Billing / Onboarding)

### P1 · 🔴 Crítico — Sin tabla `billing_plans` ni `subscriptions`

`companies.plan` es un `text` libre. No hay:

- Tabla `billing_plans` con tier, precio, ciclo, límites (`max_projects`, `max_units`, `max_users`, `max_storage_gb`, `max_lecturas_mes`, módulos incluidos).
- Tabla `subscriptions` (company_id, plan_id, status, trial_ends_at, current_period_start/end, cancel_at_period_end).
- Tabla `invoices` ni `payments` a nivel SaaS.
- Tabla `usage_metrics` (consumo mensual por tenant para enforcement de límites).
- Webhooks de billing (Stripe customer.subscription.updated, invoice.paid, payment_failed).

**Impacto:** Hoy es imposible cobrar a un cliente. Cualquier "lanzamiento SaaS" requiere construir esto primero.

**Recomendación:** Stripe Billing (o LemonSqueezy si LATAM). Modelo:

```
billing_plans     (id, slug, name, price_monthly, price_yearly, currency, features jsonb, limits jsonb, active, stripe_product_id)
subscriptions     (id, company_id, plan_id, status, trial_ends_at, current_period_end, stripe_subscription_id, cancel_at_period_end)
invoices          (id, subscription_id, amount, currency, period_start/end, paid_at, stripe_invoice_id, pdf_url)
usage_metrics     (company_id, metric_key, period, value)  -- daily/monthly aggregations
```

Edge function que escucha webhooks de Stripe y mantiene `subscriptions.status` actualizado. Job cron que agrega `usage_metrics` (lecturas, storage, emails enviados, etc.).

---

### P2 · 🔴 Crítico — Sin onboarding self-service de empresa

Crear una empresa nueva requiere que el super_admin entre a `SuperAdminSection.tsx` y la cree manualmente. No hay landing "Empezar ahora" con captura de datos + creación de tenant + setup wizard.

**Impacto:** Friction máxima en adquisición. Cada cliente requiere intervención humana.

**Recomendación:**
- Landing con CTA "Empezar prueba gratuita".
- Edge function `signup-tenant` que crea: `companies` (status=trial), primer `app_user` con rol `company_owner`, asigna `plan_id=free` o `plan_id=trial`, dispara email de bienvenida.
- Wizard post-signup (6-8 pasos): datos empresa, primer proyecto, primeros usuarios, configuración de moneda/zona horaria, conectar billing (Stripe), invitar equipo.

---

### P3 · 🔴 Crítico — Sin invite-based onboarding de usuarios

No hay flujo "invitar usuario X a empresa Y". Para agregar un usuario, el admin debe crearlo manualmente (con password) vía `create-user` edge function. El usuario no controla su password inicial ni acepta términos.

**Recomendación:**
- Tabla `invitations` (id, email, company_id, role_id, invited_by, token, expires_at, status).
- Edge function `invite-user`: inserta invitation + envía email con token único.
- Landing pública `/aceptar-invitacion?token=...` que crea `app_user` + setup password + acepta T&C.
- Vencimiento de invitación (7 días por defecto).

---

### P4 · 🔴 Crítico — Sin MFA

`useAuth.ts` (577 líneas) no implementa segundo factor. Cuentas de `company_owner` / `admin` viajan con solo password (con rate-limit de 5 intentos / 60s en cliente).

**Impacto SaaS:** Bloqueante para clientes corporativos. Compliance básico (SOC 2, ISO 27001, requerimientos bancarios) exige MFA en cuentas privilegiadas.

**Recomendación:** Supabase Auth ya soporta TOTP. Activar `enrolled_factors` en `app_users`. Pantalla `/auth/enroll-mfa` obligatoria para roles privilegiados. Backup codes. Opción de WebAuthn (passkeys) para una mejor UX.

---

### P5 · 🔴 Crítico — Un usuario = exactamente una empresa

`app_users.company_id` es `NOT NULL`. Un consultor que atiende 3 administradoras necesita 3 cuentas (3 emails). Un dueño con 2 empresas tampoco puede tener una cuenta única.

**Impacto SaaS:** Modelo común en B2B SaaS: invita al mismo email a varios tenants y el usuario alterna entre ellos. Hoy no soportado.

**Recomendación:**
- Tabla `user_memberships` (user_id, company_id, role, joined_at, status, primary).
- `app_user` ya no tiene `company_id`. Pertenece a N empresas.
- `SessionContext` mantiene `currentCompanyId` (la activa). Switcher tipo Slack workspace en topbar.
- RLS sigue por `company_id` pero la session expone el current.

---

### P6 · 🔴 Crítico — super_admin / company_owner / admin con bypass total

`user_has_permission()` en `supabase/migrations/20260518000008_rbac_helpers_and_sync.sql:6-37`:

```sql
WHEN role IN ('super_admin', 'company_owner', 'admin') → true
```

Cualquier acción que use este helper otorga todo. Sin distinción entre admin "financiero" y admin "operativo". Sin posibilidad de delegar permisos parciales a un sub-admin.

**Impacto:** Privilege escalation por error humano. Una cuenta de `admin` comprometida = control total del tenant.

**Recomendación:** Eliminar el bypass. Asignar permisos explícitos a roles seed (`role_permissions`). El bypass solo debe existir para `super_admin` (operador de la plataforma, no del tenant). Para `company_owner` y `admin`, seedear permisos completos pero revocables.

---

### P7 · 🔴 Crítico — Permisos sólo se cargan al login

`buildSessionFromSupabase()` llama a `get_user_permissions()` una vez. Si un admin revoca un permiso, el usuario sigue actuando con permisos viejos hasta que cierre sesión (o el JWT venza).

**Recomendación:** Realtime sobre `user_roles` (`supabase.channel('user_roles:user_id')`) que dispara `refreshPermissions()`. Alternativa: invalidación pasiva — `useAuth` re-llama RPC cada N minutos o cuando recibe un evento.

---

### P8 · 🟠 Alto — Audit log solo de RBAC

`permission_audit_log` registra cambios de roles/permisos. Pero no hay audit log de:
- Cambios en `companies` (alguien modifica `max_projects`).
- Cambios en `app_users` (cambio de email, role, activo).
- Operaciones de negocio (cuotas, lecturas, cobros, facturas).

**Recomendación:** `audit_log` genérico (entity, entity_id, user_id, action, before, after, ts). Trigger Postgres aplicado a tablas críticas. Vista `audit_view` con filtros por tenant/usuario/entidad.

---

### P9 · 🟠 Alto — Sin gestión de sesiones activas

No hay UI ni endpoint para ver "dispositivos conectados" o "cerrar sesión en otros dispositivos". Si un admin pierde su laptop, no puede revocar sesiones remotamente.

**Recomendación:** Tabla `sessions` (user_id, device_info, ip, created_at, last_seen_at, revoked_at). Vista `/perfil/sesiones` que lista y permite revocar. Webhook al revocar invalida JWT.

---

### P10 · 🟠 Alto — Sin SSO / SAML para clientes enterprise

Solo email/password + Google OAuth. Clientes corporativos grandes exigen SAML/OIDC con su propio IdP (Okta, Azure AD).

**Recomendación:** Tier "Enterprise" con SSO. Supabase Auth admite SAML como add-on. Alternativa: WorkOS si se prioriza UX SSO.

---

### P11 · 🟠 Alto — Sin notificación de cambios de seguridad

Si alguien cambia el email, password, o agrega un MFA factor, no se envía notificación al email anterior ni al nuevo. Detección tardía de cuentas comprometidas.

**Recomendación:** Emails transaccionales para: cambio de password, cambio de email, alta/baja de MFA, login desde nuevo dispositivo/IP, cambio de rol. Edge function `notify-security-event` ya tiene parte del cableado.

---

### P12 · 🔴 Crítico — `EmpresaSection.tsx` es un god-component de 3.547 líneas

Maneja empresa + proyectos + usuarios + roles + permisos + custom roles + audit log + integraciones (Google Email, Stripe). Estados internos múltiples (`empresa`, `proyectos`, `usuarios`, `usuarioAsignar`, `rolCondModal`, `customRoleEditor`, `rolesRefreshKey`, `showAuditLog`). Callbacks de 500+ líneas. Props drilling de `currentUser` a 7+ subcomponentes.

**Recomendación:** Romper en rutas/páginas:

```
/empresa/general            -- info básica, logo
/empresa/proyectos          -- gestión de proyectos
/empresa/usuarios           -- lista, invite, deactivate
/empresa/roles              -- system roles + custom roles
/empresa/integraciones      -- Google Email, Stripe, etc.
/empresa/audit              -- audit log con filtros
/empresa/billing            -- plan, facturas, métodos de pago
```

Cada ruta es un componente bajo 400 líneas con hooks dedicados (`useEmpresa`, `useProyectos`, `useUsuarios`, `useRoles`).

---

### P13 · 🟠 Alto — `useAuth.ts` (577 líneas) con responsabilidades mezcladas

Login + signup + OAuth + password reset + rate-limit + session storage + permisos cache + onboarding callback + monitoring. Difícil de testear y reutilizar.

**Recomendación:** Partir en:

- `useSession()` — current user + permissions + refresh.
- `useLogin()` — login + rate-limit + lockout.
- `useSignup()` — signup + onboarding.
- `useOAuth()` — Google + future providers.
- `usePasswordReset()`.
- `useMfa()` (cuando se implemente P4).

---

### P14 · 🟠 Alto — `SuperAdminSection` ve todas las empresas sin scoping de UI

`SuperAdminSection.tsx` (552 líneas) hace fetch de todas las empresas. UI sin paginación, sin búsqueda eficiente. Cuando el SaaS tenga 100+ tenants, esto colapsa.

**Recomendación:** Paginación server-side + filtros + búsqueda por nombre/NIT/estado + KPIs agregados (MRR, churn, trial conversion).

---

### P15 · 🔴 Crítico — Cero tests de auth/RBAC/RLS

No hay `auth.test.ts`, `permissions.test.ts`, `rbac.test.ts` ni tests de RLS policies. Un cambio en `user_has_permission()` o en una migración RBAC puede romper aislamiento de tenants sin que nadie lo note.

**Recomendación:**
- Unit (Vitest): `hasPermission`, `buildSessionFromSupabase`, rate-limit, lockout.
- Integration con MSW: flows de login, OAuth, signup, reset.
- pgTAP / scripts SQL: cada policy RLS verificada con users de diferentes empresas/roles. Correr en CI antes de aplicar migraciones.

---

### P16 · 🟠 Alto — Rate-limit solo client-side

`useAuth.ts:40-77` cuenta intentos en `sessionStorage`. Un atacante con curl ignora completamente esto. Supabase Auth no expone rate-limit servidor-side fácilmente.

**Recomendación:** Edge function `secure-login` como intermediaria: Cloudflare Turnstile / hCaptcha + rate-limit por IP en Postgres (`auth_attempts` con TTL). Bloquea IPs con >N intentos en M minutos.

---

### P17 · 🟠 Alto — `complete-oauth-onboarding` busca cliente por CUI + fecha nac + email

Edge function intenta vincular el usuario de Google a un `cliente` existente buscando match exacto en 3 campos. Si los datos del cliente están desactualizados o el usuario usa email distinto al registrado, el match falla. Sin fallback ni UX.

**Recomendación:** OAuth onboarding como signup (crear usuario sin cliente vinculado) + paso opcional "vincular a cliente existente con código de invitación o CUI". Manejo de errores explícito.

---

### P18 · 🟠 Alto — Sin tabla `companies.locale` / `timezone` / `currency`

Cada empresa puede operar en distinto país/moneda/zona horaria. Hoy todo está hard-coded a Guatemala (`defaultCountryCode = '502'` en `validation.ts:39`), español, GTQ probablemente. Sin localización por tenant.

**Recomendación:** `companies.locale`, `companies.timezone`, `companies.currency`. UI respeta defaults del tenant.

---

### P19 · 🟠 Alto — Perfil de usuario casi vacío

`PerfilSection.tsx` permite editar nombre y foto. No edita: idioma, timezone, preferencias de notificación, 2FA, dispositivos confiables, sesiones activas.

**Recomendación:** Ampliar perfil con secciones cuenta / seguridad / notificaciones / preferencias.

---

### P20 · 🟠 Alto — `configuracion/` con 42 líneas — vacío

`src/components/configuracion/` tiene apenas 42 LOC. Cualquier setting a nivel de tenant (plantillas de email, branding, integraciones, módulos activos) no tiene casa.

**Recomendación:** Estructura `configuracion/`:
- `branding/` (logo, colores, dominio).
- `plantillas/` (email, SMS, WhatsApp templates).
- `integraciones/` (Stripe, Gmail, WhatsApp gateway).
- `modulos/` (toggle de agua/condominios/energía/etc.).
- `localizacion/` (idioma, moneda, zona horaria).

---

### P21 · 🟡 Medio — 20+ migraciones RBAC acumuladas sin documentación

`20260518000004` a `20260518000010` introdujeron el RBAC + migraciones posteriores (`20260519000002_rbac_rls_condominios_phase2.sql`, etc.) lo ampliaron. Sin README ni squash.

**Recomendación:** README de migraciones RBAC describiendo qué hace cada fase + script `seed-rbac.sql` que consolida el estado final para tests.

---

### P22 · 🟡 Medio — `roles.is_system` mezcla seeds globales con system roles

Constraint en la tabla `roles`: `(is_system=true ∧ company_id=null) OR (is_system=false ∧ company_id!=null)`. Los system roles son globales — bien — pero no hay manera de tener "system role custom" del tenant (clon editable).

**Recomendación:** Permitir `clone_system_role(role_id, target_company_id)` que crea custom role copia del system para editar localmente.

---

### P23 · 🟡 Medio — `app_users.role` (text) conviven con `user_roles` (RBAC)

`app_users.role` es un enum text (super_admin, company_owner, admin, operator, viewer, cliente, collector) que se usa para el bypass de `user_has_permission`. Coexiste con `user_roles` que asigna roles del RBAC nuevo. Doble fuente de verdad.

**Recomendación:** Migrar todos los usuarios a `user_roles` con system role equivalente. Deprecar `app_users.role` con flag de feature.

---

### P24 · 🟡 Medio — Custom roles sin namespace por tenant en UI

Cuando una empresa crea un rol "Cobrador VIP", podría chocar visualmente con un rol del mismo nombre de otra empresa para super_admin. UI no muestra el tenant owner.

**Recomendación:** Sufijo `(Empresa X)` en listados del super_admin.

---

### P25 · 🟡 Medio — Fetch directo en `EmpresaSection` y `SuperAdminSection`

Como en agua/condominios: cada componente hace `supabase.from(...).select()` sin capa de datos abstraída.

**Recomendación:** `src/domain/empresa/api.ts` + TanStack Query (consistente con plan de agua/condominios).

---

### P26 · 🟡 Medio — `assigned_by`, `assigned_at`, `expires_at` en `user_roles` sin UI

`user_roles` ya tiene esos campos. Pero la UI no permite asignar roles con expiración ("auditor invitado por 30 días"). Tampoco muestra quién/cuándo asignó.

**Recomendación:** UI de asignación de rol con: rol, fecha de expiración opcional, motivo. Listado muestra columna `expires_at`.

---

### P27 · 🟡 Medio — `permissions` catalog hard-coded en migraciones

El catálogo de permisos vive en migraciones (`20260518000007` y posteriores). Agregar nuevos permisos requiere migración. No hay UI para que un dev/PM vea el catálogo completo.

**Recomendación:** Página `/dev/permissions` para super_admin que liste todos los `permissions` agrupados por categoría con descripción. Útil para auditar.

---

### P28 · 🟡 Medio — Branding hard-coded "AdministraTodo"

`index.html` declara `AdministraTodo` en title, OG, Schema.org. Sin posibilidad de white-labeling para revendedores.

**Recomendación:** Tier "Partner" con custom domain + logo + favicon + nombre. Static rewrite en Vercel por host header.

---

### P29 · 🟡 Medio — `googleEmail` config a nivel empresa pero sender único

`company_email_configs` permite OAuth Gmail por empresa. Pero no soporta múltiples remitentes (cobranza vs comunicados desde direcciones distintas).

**Recomendación:** `email_senders` por empresa (nombre, email, default).

---

### P30 · 🔵 Bajo — `getDisplayRoleLabel()` para etiquetas de rol sin i18n

Labels hard-coded en español dentro de `condominiosRoles.ts`/`permissions.ts`. Sin función con locale awareness.

---

### P31 · 🔵 Bajo — `app_users.activo` boolean en vez de soft-delete con `deleted_at`

Estado binario (activo/inactivo) sin trazabilidad de cuándo se desactivó ni por qué.

---

### P32 · 🔵 Bajo — Sin captura de IP/UA en login en el cliente

`logSecurityEvent` ya captura IP server-side, pero el cliente no informa de "dispositivo" en `/perfil/sesiones`.

---

### P33 · 🟠 Alto — Sin Terms of Service / Privacy acceptance

No hay tabla `terms_acceptances` (user_id, terms_version, accepted_at, ip). En cada cambio de T&C, los usuarios deben re-aceptar (requisito legal en muchos países).

**Recomendación:** Tabla `terms_versions` + tabla `terms_acceptances`. Middleware que bloquea login si la versión actual no está aceptada.

---

### P34 · 🟠 Alto — Sin `data_processing_agreement` por tenant (GDPR/LOPD)

Para clientes que manejan PII (residentes, contadores con propietarios), no hay DPA firmable ni acuerdo de procesamiento.

**Recomendación:** Generación de DPA por tenant (plantilla + firma electrónica) al activar plan.

---

### P35 · 🟠 Alto — Sin export/delete de datos personales por residente

GDPR/LOPD exigen "derecho al olvido" y "portabilidad de datos". Hoy no hay endpoint para que un residente solicite export/delete.

**Recomendación:** Edge functions `request-data-export` y `request-data-deletion` con cola de aprobación y log.

---

### P36 · 🔴 Crítico — Sin gestión de plan al exceder límites

`companies.max_projects` y `max_units` existen pero nada los enforce automáticamente. Un usuario en plan "free" puede crear 1000 proyectos sin que la app proteste.

**Recomendación:** Function Postgres `check_plan_limit(company_id, metric_key, increment)` ejecutada como check en triggers de INSERT. Si excede, raises `INSUFFICIENT_PLAN_LIMIT`. UI captura el error y muestra "Subir de plan".

---

### P37 · 🟠 Alto — Sin pricing page ni vista de plan actual

UI no muestra al `company_owner` cuál es su plan actual, cuánto consume vs límite, ni opción de upgrade. La empresa no tiene self-service de billing.

**Recomendación:** Página `/empresa/billing`: plan actual, consumo (% de cada límite), próxima factura, método de pago, historial, botón upgrade/downgrade.

---

## 3. Eje E — Roadmap para robustecer como SaaS

> `[+]` marca trabajo compartido con critiques previos.

### Fase 1 — Fundaciones SaaS (semanas 1-4)
- **Modelo Tenant + Billing**: tablas `billing_plans`, `subscriptions`, `invoices`, `usage_metrics` (P1, P36, P37).
- **Stripe Billing** integrado: edge function de webhooks + UI de billing en `/empresa/billing` (P1).
- **`user_memberships`**: usuario en N empresas, switcher en topbar (P5).
- **Eliminar bypass de admin/owner**, seedear permisos explícitos (P6).
- `[+]` Refactor `EmpresaSection` en rutas (P12, requiere router de la Fase 1 de agua).
- `[+]` Capa de datos `src/domain/empresa/`, `src/domain/superadmin/` con TanStack Query (P25).

### Fase 2 — Identidad y seguridad (semanas 5-7)
- **MFA TOTP** + backup codes (P4).
- **Realtime de permisos** vía `supabase.channel` (P7).
- **Gestión de sesiones activas** (P9).
- **Notificaciones de eventos de seguridad** (P11).
- **Captcha + rate-limit server-side** en login (P16).
- Auditoría completa (P8): `audit_log` genérico con trigger en companies, app_users, operaciones.

### Fase 3 — Onboarding y self-service (semanas 8-10)
- **Landing + signup self-service de empresa** (P2): edge function `signup-tenant` + wizard post-signup.
- **Invitations** (P3): tabla, edge function, landing pública `/aceptar-invitacion`.
- **Configuración por tenant** (P20): branding, plantillas, integraciones, locale, timezone, currency (P18).
- **OAuth onboarding mejorado** con flujo opcional de vinculación a cliente (P17).
- **Perfil de usuario completo** (P19): idioma, timezone, notificaciones, 2FA, sesiones.

### Fase 4 — Operaciones SaaS y enterprise (semanas 11-14)
- **SSO/SAML** para enterprise (P10).
- **White-labeling** para partners (P28): custom domain + branding.
- **Terms of Service flow** + DPA por tenant (P33, P34).
- **GDPR/LOPD**: export y delete de datos personales (P35).
- **Super admin productizado** (P14): paginación, filtros, KPIs MRR/churn/conversion.
- **Cleanup RBAC** (P22, P23, P27): squash migraciones, deprecar `app_users.role`, UI de catálogo de permisos.

### Fase 5 — Calidad continua
- **Tests** (P15): unit `hasPermission`, integration login/signup/oauth, pgTAP de RLS.
- **`[+]` axe-core en CI** (heredado de agua/condominios).
- **Auditoría de migraciones RBAC** trimestral + README (P21).
- **`[+]` i18n** habilita locales por tenant.

---

## 4. Tabla consolidada de hallazgos

| ID  | Sev. | Hallazgo                                                       | Evidencia                                                                 | Fase |
|-----|------|-----------------------------------------------------------------|---------------------------------------------------------------------------|------|
| P1  | 🔴   | Sin tablas billing_plans / subscriptions / invoices / usage    | `companies.plan: text`; sin tablas en `supabase/migrations`               | 1    |
| P2  | 🔴   | Sin onboarding self-service de empresa                          | `src/components/superadmin/SuperAdminSection.tsx:552 LOC`                 | 3    |
| P3  | 🔴   | Sin invite-based onboarding de usuarios                         | `supabase/functions/create-user/index.ts`                                 | 3    |
| P4  | 🔴   | Sin MFA                                                        | `src/hooks/useAuth.ts:577 LOC`                                            | 2    |
| P5  | 🔴   | Un usuario = exactamente una empresa                            | `app_users.company_id NOT NULL`                                           | 1    |
| P6  | 🔴   | super_admin/company_owner/admin con bypass total                | `supabase/migrations/20260518000008_rbac_helpers_and_sync.sql:6-37`       | 1    |
| P7  | 🔴   | Permisos cargados sólo al login                                 | `useAuth.ts:134` (`buildSessionFromSupabase`)                             | 2    |
| P8  | 🟠   | Audit log solo de RBAC                                          | `permission_audit_log` only                                               | 2    |
| P9  | 🟠   | Sin gestión de sesiones activas                                 | sin tabla `sessions`                                                       | 2    |
| P10 | 🟠   | Sin SSO/SAML                                                    | `useAuth.ts`                                                              | 4    |
| P11 | 🟠   | Sin notificaciones de cambios de seguridad                      | `log-security-event` no dispara emails                                    | 2    |
| P12 | 🔴   | `EmpresaSection.tsx` god-component                              | 3.547 LOC                                                                 | 1    |
| P13 | 🟠   | `useAuth.ts` con responsabilidades mezcladas                    | 577 LOC, login+signup+OAuth+reset+rate-limit+session                      | 1    |
| P14 | 🟠   | `SuperAdminSection` sin paginación ni KPIs SaaS                 | 552 LOC                                                                   | 4    |
| P15 | 🔴   | Cero tests de auth/RBAC/RLS                                     | sin `*.test.*` en auth/perm                                               | 5    |
| P16 | 🟠   | Rate-limit solo client-side                                     | `useAuth.ts:40-77`                                                        | 2    |
| P17 | 🟠   | `complete-oauth-onboarding` requiere match CUI+fecha+email      | `supabase/functions/complete-oauth-onboarding/index.ts`                   | 3    |
| P18 | 🟠   | Sin `locale`/`timezone`/`currency` por tenant                   | `companies` schema                                                        | 3    |
| P19 | 🟠   | Perfil de usuario casi vacío                                    | `src/components/perfil/PerfilSection.tsx:339 LOC`                         | 3    |
| P20 | 🟠   | `configuracion/` con 42 LOC                                     | `src/components/configuracion/`                                            | 3    |
| P21 | 🟡   | 20+ migraciones RBAC sin documentación                          | `supabase/migrations/20260518*`                                            | 5    |
| P22 | 🟡   | `roles.is_system` sin clone editable                            | `roles` schema                                                            | 4    |
| P23 | 🟡   | `app_users.role` coexiste con `user_roles`                      | doble fuente de verdad                                                    | 4    |
| P24 | 🟡   | Custom roles sin namespace por tenant en super_admin            | UI                                                                        | 4    |
| P25 | 🟡   | Fetch directo en EmpresaSection/SuperAdminSection               | sin capa de datos                                                         | 1    |
| P26 | 🟡   | `user_roles.expires_at` sin UI                                   | `user_roles` schema                                                       | 2    |
| P27 | 🟡   | Permissions catalog hard-coded en migraciones                   | sin UI `/dev/permissions`                                                  | 5    |
| P28 | 🟡   | Branding "AdministraTodo" hard-coded                            | `index.html`                                                              | 4    |
| P29 | 🟡   | Un solo sender Gmail por empresa                                | `company_email_configs`                                                   | 3    |
| P30 | 🔵   | `getDisplayRoleLabel()` sin i18n                                | `permissions.ts`                                                          | 5    |
| P31 | 🔵   | `app_users.activo` sin soft-delete                              | schema                                                                    | 5    |
| P32 | 🔵   | Sin captura de IP/UA en perfil                                   | sin UI                                                                    | 5    |
| P33 | 🟠   | Sin Terms of Service acceptance                                  | sin tabla                                                                 | 4    |
| P34 | 🟠   | Sin DPA por tenant (GDPR/LOPD)                                  | sin tabla                                                                 | 4    |
| P35 | 🟠   | Sin export/delete de datos personales                            | sin endpoint                                                              | 4    |
| P36 | 🔴   | Límites de plan no enforce automáticos                          | `companies.max_projects/max_units` sin trigger                            | 1    |
| P37 | 🟠   | Sin pricing page ni vista de plan actual                        | sin UI billing                                                            | 1    |

---

## 5. Priorización para SaaS

**Bloqueantes (Fase 1-2):** P1 · P2 · P3 · P4 · P5 · P6 · P7 · P12 · P15 · P36.
**Importantes (Fase 2-3):** P8 · P9 · P11 · P13 · P16 · P17 · P18 · P19 · P20 · P25 · P37 · P33 · P34 · P35.
**Mejoras (Fase 4-5):** P10 · P14 · P21 · P22 · P23 · P24 · P26 · P27 · P28 · P29 · P30 · P31 · P32.

Este es el corazón del SaaS. Sin Fase 1 completa no se puede cobrar. Sin Fase 2 no se puede vender a clientes con compliance básico.
