# Estado consolidado + Tracks paralelos

**Fecha:** 2026-06-02
**Base:** `main` @ #298 (`46b5b5a`)
**Punto de partida:** PR #166 — paquete de *design critiques* (220 hallazgos) hacia SaaS multi-tenant.
**Propósito:** (1) reflejar lo **realizado/mejorado** y lo **pendiente** desde el PR #166, y (2) separar lo
pendiente en **secciones paralelizables** para trabajar sin colisiones.

> Reemplaza como *tracker activo* a la sección 7 del `DESIGN_CRITIQUE_INDEX_2026-05-26.md` (que quedó
> congelada en 14 resueltos / 6.3% al 2026-05-27). Desde entonces se mergearon ~130 PRs hasta el #298.

---

## 1. Resumen ejecutivo

Desde el PR #166 el producto pasó de "sólido para uso interno" a **tener cerrada casi toda la plomería de
SaaS multi-tenant**. La ejecución siguió tres series: **F2** (seguridad/identidad), **F3** (UX/accesibilidad)
y **F4** (operaciones SaaS), más router, split de tipos, Zod y mobile.

| Fase del roadmap original | Avance real al #298 | Estado |
|---|---|---|
| **Fase 1 — Fundaciones técnicas** | ~95% | Router, registry de tabs, split de tipos, capa de datos iniciada, ErrorBoundary, modelo Tenant/Billing |
| **Fase 2 — Dominio, seguridad e identidad** | ~90% | EmailJS fuera, JWT, CHECK, RLS por unidad, MFA, realtime de permisos, audit log, soft-delete, PWA, billing Stripe |
| **Fase 3 — Onboarding, UX y accesibilidad** | ~80% | SweetAlert2 eliminado, WAI-ARIA, DataTable (parcial), responsive/mobile, SetupWizard, portal residente, ⌘K, i18n MVP |
| **Fase 4 — Operaciones SaaS y enterprise** | ~40% | Billing + reporting + superadmin KPIs + papelera listos; faltan SSO, white-label, GDPR, dunning, vistas materializadas |
| **Fase 5 — Calidad continua** | ~15% | logger/coverage/types-drift advisory; faltan tests de dominio, E2E, i18n completo |

**Conteo de hallazgos:** ≈**48 resueltos** + ≈**18 parciales** (vs 14 del último corte). Más relevante: los
**bloqueantes críticos de Fases 1-2 están esencialmente cerrados**. Lo pendiente se concentra en **Servicios**
y **Comunicación** (casi intactos), **Plataforma enterprise** (SSO/GDPR/sesiones), **Infra/Ops** (staging,
rollback, tests de edge functions) y **refactor arquitectónico** (TanStack + god-components) + **performance/QA**.

### Verificación en vivo (Supabase, proyecto `control-agua`)
- ✅ `billing_plans`(3), `subscriptions`(3), `invoices`, `billing_sync_log`, `stripe_webhook_events` → **plat:P1** real.
- ✅ `audit_log` (trigger `audit_trigger_func()` SECURITY DEFINER), `email_send_queue`/`email_send_log`/`email_templates`,
  `report_templates`/`report_runs`, `user_sessions`, `user_presence`, `rate_limit_log`.
- ✅ **RLS habilitado en las ~190 tablas**; advisors de seguridad: **0 ERROR**, 58 WARN (hardening de funciones
  SECURITY DEFINER + `search_path` + `pg_net` en `public`) → Track T5.

---

## 2. Ledger por dominio (✅ hecho · ⏳ parcial · ❌ pendiente)

### Agua (`agua:*`)
- ✅ A1 router · A6 split tipos · C1 validación lectura · C6 Zod/validatedInsert · C9 auditoría · C10 soft-delete · B1 a11y · B5 SweetAlert2 · B8 PWA · B12 empty states · D4 tagging
- ⏳ B2/B3/B4 responsive (mobile 1-3C) · B9 design system · B13 i18n · D1 caché (SWR) · D2 paginación · D3 code-split
- ❌ A2 god-components · A3 props drilling · A4 TanStack/useData(652L) · A5 enums dup · A8 prefetch · A9 useAuth · C3 lenguaje dominio · **C4 Factura estados/mora/IVA** · C5 agregado Tenant · C7 tests · C8 unificar businessEnergia · D5 dashboards · D6/D8 budgets/RUM · D9 compresión img · D10 EXPLAIN

### Condominios (`cond:*`)
- ✅ A1 registry+router · C1 RLS por unidad · C2 CHECK+Zod · C9 split tipos · C11 audit · C13 soft-delete · B1 búsqueda/⌘K · B3 a11y · B7 SetupWizard · B8 empty states · B9 portal residente · D4 tagging
- ⏳ A10 shared (3/4) · B2 DataTable (subset de ~200 tabs) · B4 responsive · C14 auto-tipos · D1 paginación · D3 caché
- ❌ A2 god-tabs · A3 Supabase directo · A4 TanStack · A6 dashboard dup · A8 prefetch · A9 edge functions · B5/B6 switcher multi-condominio · B10-B13 · C4 lógica en cliente · C5 Tenant · **C6 mora automática** · C7 tests · C10 storage scoping · C12 rename migraciones · D2/D5-D9

### Plataforma (`plat:*`)
- ✅ P1 billing · P2 onboarding empresa · P4 MFA · P5 multi-tenant base · P6 RBAC server-side · P7 realtime permisos · P36 límites de plan
- ⏳ P14 superadmin (KPIs sí, paginación no) · P37 pricing page · P8 audit negocio
- ❌ **P3 invitaciones** · P9 sesiones activas (tabla existe, falta UI) · P10 SSO/SAML · P11 notif. de seguridad · P12 refactor EmpresaSection · P13 refactor useAuth(779L) · P15 tests auth/RBAC · P16 rate-limit server · P17 OAuth flexible · P18 locale/tz/currency · P19 perfil usuario · P20 branding/config tenant · P21-P32 (docs RBAC, clone roles, dedup `app_users.role`…) · P28 white-label · **P33/P34/P35 TOS/DPA/GDPR**

### Servicios — Energía/Calidad/Mapa (`serv:*`) — **casi intacto**
- ⏳ (transversal) algo de a11y tocó forms de energía
- ❌ **S1/S2 promover Energía a 1er nivel + desacoplar de agua** · S3/S4/S5 refactor · S6 validación kwh · S7 tramos · S8 GPS/foto · S9 RLS colector · S10 tests · S11 FEL/CFDI/DIAN · S12 dup factura · **S13 `<MapView>` genérico** · S14 clustering · S15 interacción · S16 coords · S17 filtros · S18 heatmap · S19 atribución · **S20 validaciones Calidad** · S21 props · **S22 cumplimiento en Postgres** · S23 tipologías en DB · S24 base64 · S25 históricos · S26 muestreos · S27 export · S28 IoT · **S29 arquitectura "servicio medido"**

### Comunicación (`com:*`)
- ✅ N1 EmailJS fuera + cola de reintentos
- ⏳ N19 paquetería salida (#156/#157) · N20 retry
- ❌ **N2 orquestador notifications_outbox+dispatcher** · **N3 templates por tenant** · **N4 tracking entrega/lectura/bounce** · N5 broadcast server-side · N6 refactor god-section · N7 segmentación · N8 programación/recurrencia · N9/N10 prefs de canal · N11 TTL adjuntos · N12 KPIs materializados · N13 unificar dashboards · N14 health scorecard · N15 polling incremental · N16 notas internas · N17 fallback provider · N18 SPF/DKIM/DMARC · N21 quiet hours · N23 open/click · N24 export histórico · N25 adapter SMS · N26 webhook bounce · N27 telemetría edge · N28 i18n plantillas · N29 cifrado at-rest

### Infraestructura (`infra:*`)
- ✅ I1 JWT · I3 ErrorBoundary · I4 PWA · I10/I11 telemetría · I27 useOffline TTL · I30 (falso positivo) · I32 health · I34/I35 robots/.env · I36 (docs) · I37/I38 Renovate/CODEOWNERS · I39/I40/I41/I42 migraciones
- ⏳ I5/I6 sidebar/topbar registry · I7/I8/I33 CI coverage/deno-lint/logger (advisory)
- ❌ **I2 rate-limit server** · I9 inyección en apply-migration · I12 source maps · **I13 validación server-side de uploads** · **I14 storage scoping por path/company** · I15 inventario de secretos · **I16 staging/prod** · I17 runbook · I18 alertas · **I19 canary** · **I20 rollback** · I21 Vault/KMS · **I22 tests de edge functions** · I23 manualChunks · I24 CSP unsafe-inline · I25 landing (parcial #120) · I26 preview protection · I28 clock sync · I29 polling · I31 SRI

---

## 3. Los 8 tracks paralelos

Corte **híbrido**: dominios aislados + transversales. Cada track tiene **ownership de archivos** para evitar
colisiones. Prioridad **balance en paralelo** (cada track ordena su backlog por severidad 🔴→🟠→🟡→🔵).

### Ola A — Aislados (arrancar ya, en paralelo)

#### T1 · Servicios (Energía + Calidad + Mapa)
- **Hallazgos:** `serv:S1–S29` (foco 🔴 S1, S2, S13, S20, S22, S29).
- **Ownership:** `src/components/{servicios-energia,calidad,mapa}/` · `src/lib/businessEnergia.ts` ·
  `src/types/energia.ts` · nueva edge fn de cumplimiento de calidad · migraciones constraints energía/calidad.
- **Objetivo:** Energía como módulo de 1er nivel (rutas propias + desacople de `fuente_agua_id`),
  `<MapView layers={[]}/>` genérico, validaciones reguladas de Calidad calculadas en Postgres.
- **Dependencias:** ninguna dura · coordinar `businessEnergia.ts` con T4. **Colisión: baja.**

#### T2 · Comunicación (orquestación multicanal)
- **Hallazgos:** `com:N2–N29` (foco 🔴 N2, N3, N4, N5, N6, N12).
- **Ownership:** `src/components/comunicacion/` · `src/hooks/{useBroadcasts,useConversations,useNotifications}.ts` ·
  `src/lib/{email,paquetes,paquetesNotify}.ts` · `supabase/functions/{send-email,notify-package,process-email-queue,
  +notifications-dispatcher,+create-broadcast}` · migraciones `notifications_outbox`/`notification_templates`.
- **Objetivo:** outbox + dispatcher central, plantillas por tenant, tracking de entrega/lectura/bounce,
  segmentación + programación, prefs de canal por usuario.
- **Dependencias:** refactor de `ComunicacionSection` (god) coordina con T7. **Colisión: baja.**

#### T3 · Plataforma / Identidad & Tenant config
- **Hallazgos:** `plat:P3,P8,P9,P10,P11,P14,P17–P35` (foco 🔴 P3; alto valor P9, P11, P18, P33/P34/P35).
- **Ownership:** `src/components/{empresa,auth,configuracion,perfil,superadmin,onboarding}/` ·
  `src/hooks/{usePermissions,usePlanLimits}.ts` · `supabase/functions/{create-user,delete-user,signup-company,*oauth*,
  +invite-user}` · migraciones sesiones/TOS/DPA/config-tenant.
- **Objetivo:** invitaciones de usuario, gestión de sesiones (UI sobre `user_sessions`), notif. de seguridad,
  locale/tz/currency + branding/white-label, perfil de usuario, OAuth flexible, TOS/DPA/export GDPR, SSO/SAML.
- **Dependencias:** refactor estructural de `EmpresaSection`/`useAuth` (P12/P13) → **T7**. **Colisión: media** (`useAuth.ts`).

#### T5 · Infra / Ops / Seguridad de plataforma
- **Hallazgos:** `infra:I2,I9,I12–I24,I26,I28,I29,I31` + `plat:P16` + hardening DB (revoke EXECUTE en SECURITY
  DEFINER, `search_path`, `pg_net`).
- **Ownership:** `.github/workflows/` · `supabase/config.toml` · `supabase/functions/_shared/` · `vercel.json` ·
  `vite.config.ts` · `src/lib/{fileValidation,security,monitoring,logger,slo}.ts` · migraciones de storage policies.
- **Objetivo:** rate-limit server-side, validación server-side de uploads, storage scoping por path/company,
  staging/canary/rollback, runbooks/alertas, Vault/KMS, CSP sin unsafe-inline, SRI.
- **Dependencias:** tests de edge functions (I22) coordina con T8. **Colisión: baja** (CI/edge/config).

### Ola B — Coordinados (T7 siembra; el resto encima)

#### T7 · Capa de datos & refactor de god-components *(go-first / transversal)*
- **Hallazgos:** `agua:A2,A3,A4,A7–A9` · `cond:A2,A4,A6,A8` · `plat:P12,P13,P25` · `com:N6`.
- **Ownership:** `src/domain/{agua,condominios,+comunicacion,+empresa,+energia}/` · `src/hooks/{useData,useAuth}.ts` ·
  god-components (`App.tsx`, `EmpresaSection`, `ComunicacionSection`, …).
- **Objetivo:** aterrizar **scaffold TanStack Query + convenciones** de la capa de datos (semana 1-2); luego cada
  track de dominio migra **sus** componentes. Romper `useData`(652L)/`useAuth`(779L) y god-components.
- **Dependencias:** **va primero**; los demás migran sobre sus convenciones. **Colisión: alta** → PRs pequeños por dominio.

#### T4 · Facturación de dominio (Agua + Condominios finanzas)
- **Hallazgos:** `agua:C3,C4,C5` · `cond:C4,C5,C6` · `serv:S11`.
- **Ownership:** `src/lib/business.ts` · `src/components/{cobros,tarifas}/` ·
  `src/components/condominios/tabs/{Cuotas,Cobros,…}` · migraciones máquina de estados Factura + mora + IVA ·
  edge fn de mora (cron). *(Tablas `reglas_mora_config`/`recargos_mora`/`avisos_cobro` ya existen.)*
- **Objetivo:** agregado **Factura** con estados (pendiente→emitida→pagada→vencida) + mora automática + IVA;
  agregado **Tenant**.
- **Dependencias:** usa convenciones de T7 · comparte `businessEnergia` con T1. **Colisión: media** (`business.ts` + migraciones).

#### T6 · UX continua: DataTable + i18n + multi-condominio *(transversal UI)*
- **Hallazgos:** `cond:B2(cierre),B5,B6,B10–B13` · `agua:B11,B14` · `com:N28` · i18n completo (`agua:B13`).
- **Ownership:** `src/components/shared/` · `src/components/condominios/tabs/` (DataTable en tabs restantes) ·
  `src/lib/i18n.tsx` + `src/lib/locales/` · `src/components/layout/`.
- **Objetivo:** terminar migración DataTable de las ~200 tabs, switcher multi-condominio + banner contextual,
  breadcrumbs, i18n más allá del MVP.
- **Dependencias:** coordinar tabs cuotas/cobros con T4. **Colisión: media** (aditivo: envolver tablas).

#### T8 · Performance, escala & QA/Tests *(transversal calidad)*
- **Hallazgos:** `agua:C7,D2,D5,D6,D8–D10` · `cond:C3,C7,D1,D5–D9` · `plat:P15` · `serv:S10` · `com:N12,N15` · `infra:I22`.
- **Ownership:** `src/test/` · `**/__tests__/` · migraciones de vistas materializadas + índices ·
  `.github/workflows/` (gates de coverage/axe enforce) · E2E Playwright (nuevo).
- **Objetivo:** paginación/virtualización server-side en todas las tablas, vistas materializadas para KPIs,
  cobertura de tests (agua 70 / cond 60 / plat 80), E2E móvil, axe-core enforce.
- **Dependencias:** se monta sobre lo que entregan A y B. **Colisión: baja.**

### Grafo de dependencias
```
Ola A (paralelo ya):   T1 Servicios   T2 Comunicación   T3 Plataforma   T5 Infra/Ops
Ola B (coordinada):    T7 Capa de datos ──► T4 Facturación · T6 UX/DataTable · migraciones de dominio
                       T8 Perf/QA ── continua, sobre A y B
```

---

## 4. Reglas anti-colisión

- **Migraciones:** reservar rangos de timestamp por track + patrones idempotentes ya establecidos
  (`DROP POLICY IF EXISTS`, `ADD COLUMN IF NOT EXISTS` — lecciones `infra:I40/I41/I42`). Validar en Supabase Preview.
- **Archivos compartidos** (`business.ts`, `useData.ts`, `useAuth.ts`, `App.tsx`, `shared/`, `i18n.tsx`):
  propiedad de los tracks **transversales** (T7/T6/T4). Los tracks de dominio tocan **solo su carpeta** y su
  `src/types/<dominio>.ts` (ya split → colisión baja).
- **Ramas:** convención `claude/<track>-<slug>` ya en uso. PRs atómicos por hallazgo, validados en
  Supabase Preview + Vercel Preview.
- **Orden:** Ola A sin esperar a nadie; T7 antes que T4/T6/migraciones de dominio; T8 en continuo.

---

## 5. Cómo arrancar

1. Cada track tiene una **épica en GitHub** (`Track Tn — …`) con checklist de IDs y ownership de archivos.
2. Los hallazgos 🔴/🟠 de cada track se abren como **sub-issues**; los 🟡/🔵 viven en el checklist de la épica.
3. Tracker activo = este documento. El `DESIGN_CRITIQUE_INDEX` §7 apunta aquí.
4. Re-evaluar al cerrar cada ola; versionar como `ESTADO_Y_TRACKS_PARALELOS_YYYY-MM-DD.md`.
