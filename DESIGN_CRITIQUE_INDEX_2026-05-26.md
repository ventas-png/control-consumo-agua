# Design Critique — Índice General

**Fecha:** 2026-05-26
**Alcance:** Toda la aplicación `control-consumo-agua` v2.0.0 — 6 documentos de critique cubriendo todos los módulos y capas.
**Objetivo:** Hoja de ruta consolidada para evolucionar la aplicación a **SaaS multi-tenant** robusto.

---

## 1. Documentos del paquete

| # | Documento | Hallazgos | LOC del scope |
|---|-----------|-----------|---------------|
| 1 | [`DESIGN_CRITIQUE_AGUA_2026-05-26.md`](./DESIGN_CRITIQUE_AGUA_2026-05-26.md) | 41 | ~6.000 |
| 2 | [`DESIGN_CRITIQUE_CONDOMINIOS_2026-05-26.md`](./DESIGN_CRITIQUE_CONDOMINIOS_2026-05-26.md) | 47 | ~100.000+ (191 tabs) |
| 3 | [`DESIGN_CRITIQUE_PLATAFORMA_SAAS_2026-05-26.md`](./DESIGN_CRITIQUE_PLATAFORMA_SAAS_2026-05-26.md) | 37 | ~7.000 |
| 4 | [`DESIGN_CRITIQUE_SERVICIOS_2026-05-26.md`](./DESIGN_CRITIQUE_SERVICIOS_2026-05-26.md) | 28 | ~2.500 |
| 5 | [`DESIGN_CRITIQUE_COMUNICACION_2026-05-26.md`](./DESIGN_CRITIQUE_COMUNICACION_2026-05-26.md) | 29 | ~4.000 |
| 6 | [`DESIGN_CRITIQUE_INFRAESTRUCTURA_2026-05-26.md`](./DESIGN_CRITIQUE_INFRAESTRUCTURA_2026-05-26.md) | 38 | ~5.000 |
| | **Total** | **220** | **~125.000+** |

> Nota: el conteo de Infraestructura subió de 37 → 38 al descubrir `infra:I39` (migraciones no aplicables desde cero) vía el fail de Supabase Branching en el PR #168. Detallado en §7 "Estado de implementación".

---

## 2. Conteo consolidado por severidad

| Severidad | Agua | Cond. | Plat. | Serv. | Com. | Infra | **Total** |
|-----------|------|-------|-------|-------|------|-------|-----------|
| 🔴 Crítico | 10  | 13   | 12   | 3    | 6   | 7    | **51**   |
| 🟠 Alto    | 14  | 16   | 13   | 11   | 11  | 14   | **79**   |
| 🟡 Medio   | 12  | 14   | 9    | 10   | 9   | 12   | **66**   |
| 🔵 Bajo    | 5   | 4    | 3    | 4    | 3   | 4    | **23**   |
| **Total** | 41  | 47   | 37   | 28   | 29  | 38   | **220**  |

---

## 3. Diagnóstico ejecutivo

La aplicación funciona, **es un producto sólido para uso interno**, pero **no es un SaaS multi-tenant**. Los problemas se agrupan en 4 patrones recurrentes:

### Patrón 1 — Plomería SaaS ausente
- `companies.plan` es texto libre. Sin `billing_plans`, `subscriptions`, `invoices`, `usage_metrics`.
- Sin onboarding self-service de empresa ni invite-based de usuario.
- Un usuario = una empresa (no multi-tenant para usuarios).
- Sin MFA, sin SSO, sin gestión de sesiones, sin TOS/DPA flow.
- Branding hard-coded ("AdministraTodo"), sin white-labeling, sin locale/timezone/currency por tenant.

### Patrón 2 — Arquitectura monolítica
- Sin router. `App.tsx` (789L) con switch por `activeSection`.
- God-components masivos: `CondominiosSection.tsx` (1.568L), `EmpresaSection.tsx` (3.547L), `UnidadesSection.tsx` (1.286L), `RutasSection.tsx` (1.190L), `ContadoresSection.tsx` (1.077L), `ComunicacionSection.tsx` (958L).
- 191 tabs en condominios + tabs en agua/energía con switch gigante.
- Sin capa de datos: fetch directo a Supabase en cada componente.
- Sin TanStack Query / SWR. Cada componente reimplementa loading/error/refetch.
- Sidebar NAV hard-coded (`Sidebar.tsx:683L`).

### Patrón 3 — Seguridad y aislamiento incompletos
- **RLS sin granularidad por unidad/ruta/lector.** Un residente con permiso "ver cuotas" puede ver cuotas de otras unidades. Un colector con "ver lecturas" puede ver clientes que no le tocan.
- **Bypass total** para super_admin/company_owner/admin en `user_has_permission()`.
- **Sin CHECK constraints** (monto>0, fechas válidas) — toda validación es client-side.
- **6 edge functions sin JWT**; protección solo por CORS.
- **`EMAILJS_PUBLIC_KEY` expuesta** en bundle.
- **File upload validation solo client-side** (documented bypass).
- **Storage policies abiertas** a cualquier `authenticated` sin scoping por path/company.
- **Rate-limiting solo client-side.**

### Patrón 4 — UX y operación
- **Accesibilidad rota** (audit 2026-04-07 sin resolver): labels sin `htmlFor`, sin `role="tablist"`, mezcla con SweetAlert2.
- **Admin panel no responsive.** Inusable en tablet/móvil (donde trabaja el operador real).
- **Sin PWA / offline real.** El módulo más usado en campo (agua) carece de cola de sync.
- **189/191 tabs** de condominios renderizan `<table>` HTML desnudas en lugar del `DataTable` shared.
- **191 tabs sin búsqueda** ni favoritos en condominios.
- **KPIs client-side** sobre listas completas → no escala a tenants grandes.
- **Sin paginación / virtualización** en tablas grandes.
- **Cero tests** de auth, RBAC, RLS, condominios, edge functions; cobertura mínima de agua.
- **Sin ErrorBoundary global.**
- **CI sin lint / coverage / bundle-size budget.**
- **Sin staging / canary / rollback.**

---

## 4. Roadmap consolidado en 5 fases

Cada fase consume hallazgos de múltiples documentos. Marcadores como `A1`, `B2`, `P3`, `S1`, `N5`, `I7` referencian IDs de los critiques individuales.

### Fase 1 — Fundaciones técnicas (semanas 1-4)

**Objetivo:** sentar las bases para todo lo demás. Sin esto, los hallazgos posteriores son inalcanzables.

- **Router** por dominio (`/agua/*`, `/condominios/*`, `/energia/*`, `/empresa/*`, `/admin/*`). Reemplaza `App.tsx` switch + `CondominiosSection` switch + `Sidebar` NAV hard-coded. → `agua:A1`, `cond:A1`, `infra:I5`, `infra:I6`, `serv:S3`.
- **TanStack Query + capa de datos por dominio** (`src/domain/{agua,condominios,empresa,energia,calidad,comunicacion}/`). → `agua:A4`, `cond:A3`, `cond:A4`, `plat:P25`, `serv:S4`, `com:N6`.
- **Zod schemas + react-hook-form** compartidos UI ↔ DB. → `agua:C6`.
- **Partir `src/types/index.ts`** por dominio (3.691L → archivos < 600L). → `agua:A6`, `cond:C9`.
- **Registry de tabs** en lugar de switch gigante (cond: 191 tabs). → `cond:A1`, `infra:I5`.
- **ErrorBoundary global + por route**. → `infra:I3`.
- **Refactor god-components** (`CondominiosSection`, `EmpresaSection`, `UnidadesSection`, `RutasSection`, etc.) usando router + hooks dedicados.
- **Modelo Tenant + Billing** (`billing_plans`, `subscriptions`, `usage_metrics`) + integración Stripe. → `plat:P1`, `plat:P36`, `plat:P37`.
- **`user_memberships`**: usuario en N empresas + switcher. → `plat:P5`.
- **Eliminar bypass** de admin/owner; seedear permisos explícitos. → `plat:P6`.
- **Promover energía** a módulo de primer nivel. → `serv:S1`, `serv:S2`.
- **Lazy import chart.js**. → `com:N22`.

### Fase 2 — Dominio sólido, seguridad e identidad (semanas 5-8)

**Objetivo:** sellar el dominio para que sea confiable y seguro multi-tenant.

- **CHECK constraints en DB**: monto>0, fechas válidas, estados, etc. → `agua:C1`, `cond:C2`, `serv:S6`.
- **RLS row-level** por `unidad_id`, `ruta_id`, rol específico. Tests pgTAP. → `agua:C2`, `cond:C1`, `infra:I14`.
- **Agregado Factura** con state machine (pendiente → emitida → pagada → vencida) + cron de mora. → `agua:C3`, `agua:C4`, `cond:C4`, `cond:C6`.
- **Workflow de aprobaciones reales** (tabla `aprobaciones_pendientes` + state machine). → `cond:C8`.
- **MFA TOTP** + backup codes. → `plat:P4`.
- **Realtime de permisos**. → `plat:P7`.
- **Rate-limit server-side** + captcha en login. → `plat:P16`, `infra:I2`.
- **Notificaciones de eventos de seguridad** (login nuevo dispositivo, cambio de password). → `plat:P11`.
- **Gestión de sesiones activas**. → `plat:P9`.
- **Audit log genérico** trigger-based. → `agua:C9`, `cond:C11`, `plat:P8`.
- **Soft delete** universal. → `agua:C10`, `cond:C10`.
- **JWT obligatorio + audit** en edge functions sensibles (`create-user`, `delete-user`). → `infra:I1`.
- **File upload validation server-side** edge function. → `infra:I13`.
- **Storage policies por path/company**. → `cond:C10`, `infra:I14`.
- **Eliminar EmailJS del cliente**; centralizar email en edge function. → `com:N1`.
- **`notifications_outbox` + dispatcher** centralizado. → `com:N2`, `com:N4`.
- **Templates por tenant** (`notification_templates`). → `com:N3`.
- **`create-broadcast` edge function** (resolución server-side de audiencia). → `com:N5`.
- **PWA + offline-first** con cola IndexedDB para lecturas. → `agua:B8`, `infra:I4`.
- **Supabase Vault / KMS** para secretos de pago. → `infra:I21`.
- **Tests** de edge functions (deno test). → `infra:I22`.
- **Cálculo de cumplimiento calidad en Postgres + trigger**. → `serv:S22`.
- **Validaciones compartidas** agua/energía (lectura ≥ anterior). → `serv:S6`.

### Fase 3 — Onboarding, UX y accesibilidad (semanas 9-12)

**Objetivo:** producto listo para entrada self-service de tenants nuevos, con UX consistente y accesible.

- **Sistema de diseño + Storybook**. → `agua:B9`, `cond:B10`.
- **Migrar 189 tabs de condominios** a `<DataTable>` y `<ResponsiveTable>`. → `cond:B2`.
- **Accesibilidad sweep** (`htmlFor`, `role="tablist"`, `aria-*`, scope) + axe-core en CI. → `agua:B1`, `cond:B3`.
- **Admin responsive** para tablet/móvil. → `agua:B2`, `agua:B3`, `cond:B4`.
- **Reemplazar SweetAlert2** por Radix UI Dialog. → `agua:B5`, `cond:B3`.
- **Wizards de configuración inicial** (condominio nuevo, primera empresa). → `cond:B7`.
- **`<EmptyState>` obligatorio**. → `cond:B8`.
- **Portal residente ampliado** (votaciones, transparencia financiera, push). → `cond:B9`.
- **Onboarding self-service** de empresa (`signup-tenant` + wizard). → `plat:P2`.
- **Invitations** + landing `/aceptar-invitacion`. → `plat:P3`.
- **Configuración por tenant**: branding, plantillas, integraciones, locale, timezone, currency. → `plat:P18`, `plat:P20`.
- **Perfil de usuario completo** (idioma, timezone, MFA, sesiones, preferencias). → `plat:P19`, `com:N9`, `com:N10`.
- **OAuth onboarding mejorado** con vinculación opcional a cliente. → `plat:P17`.
- **Switcher de condominio + banner contextual**. → `cond:B5`, `cond:B6`.
- **Multi-condominio real** (cambio sin recarga). → `cond:B5`.
- **Health scorecard con alertas**. → `com:N14`.
- **Segmentación dinámica + programación + recurrencia** de broadcasts. → `com:N7`, `com:N8`.
- **Componente `<MapView layers={[]} />`** genérico (cubre agua/cond/energía). → `serv:S13`.

### Fase 4 — Operaciones SaaS y enterprise (semanas 13-16)

**Objetivo:** producto operable a escala con observabilidad, billing real, planes premium y entry to enterprise.

- **Stripe Billing flujo completo** (UI + webhooks + invoices + dunning). → `plat:P1`, `plat:P36`, `plat:P37`.
- **Feature flags por plan** (gating asamblea digital, BI ejecutivo, integración bancaria, agua premium, calidad regulada). → `agua:E4`, `cond:E4`.
- **Edge functions** de mora cron, avisos por email/WhatsApp, conciliación de pagos online. → `agua:C6`, `cond:C6`, `cond:A9`.
- **Pagos online integrados** (Stripe / Wompi / Recurrente según LATAM). → `cond:Fase4`.
- **Tagging multi-tenant** consistente en Sentry/PostHog. → `agua:D3`, `cond:D4`, `infra:I10`.
- **Dashboards de negocio ejecutivos** por administradora (cross-condominio). → `cond:D5`, `com:N12`, `com:N13`.
- **Vistas materializadas** para KPIs. → `com:N12`.
- **Paginación server-side + virtualización** en todas las tablas grandes. → `agua:D2`, `cond:D1`.
- **Code-splitting agresivo** + compresión de imágenes. → `agua:D3`, `cond:D6`, `cond:D8`.
- **SSO/SAML** enterprise. → `plat:P10`.
- **White-labeling** para partners. → `plat:P28`.
- **TOS + DPA + GDPR/LOPD** export/delete data flow. → `plat:P33`, `plat:P34`, `plat:P35`.
- **Super admin productizado** (paginación, MRR/churn/conversion). → `plat:P14`.
- **Verificación SPF/DKIM/DMARC** por tenant. → `com:N18`.
- **Quiet hours por tenant**. → `com:N21`.
- **Webhooks bounce de Gmail / SMS Twilio / WhatsApp**. → `com:N4`, `com:N26`.
- **Export histórico de comunicaciones**. → `com:N24`.
- **Adapter SMS Twilio**. → `com:N25`.
- **Notificación de incumplimiento de calidad**. → `serv:S20`.
- **Facturación electrónica regional** (FEL/CFDI/DIAN). → `serv:S11`.
- **Staging environment + canary**. → `infra:I16`, `infra:I19`.
- **CI con lint + coverage + size-limit + Lighthouse**. → `infra:I7`.
- **Sentry sampling por severity + environment correcto**. → `infra:I11`, `infra:I36`.
- **Alertas Slack/email**. → `infra:I18`.
- **Runbooks + rollback + health endpoint + logs estructurados**. → `infra:I17`, `infra:I20`, `infra:I32`, `infra:I33`.
- **Source maps obligatorios**. → `infra:I12`.
- **`SECRETS_INVENTORY.md` + rotación**. → `infra:I15`.
- **Landing pública + marketing copy**. → `infra:I25`.
- **Vercel preview protection**. → `infra:I26`.
- **CSP sin `unsafe-inline`**. → `infra:I24`.
- **SRI + sitemap + robots**. → `infra:I31`, `infra:I34`.

### Fase 5 — Calidad continua

**Objetivo:** mantener el producto sano a largo plazo.

- **Cobertura de tests del dominio**: agua 70%, condominios 60%, plataforma 80%. → `agua:C7`, `cond:C3`, `plat:P15`.
- **E2E Playwright** móvil de flujos críticos (captura agua, alta residente, pago condominio). → todos los critiques.
- **axe-core en CI**. → todos los critiques.
- **`get_advisors` Supabase mensual + EXPLAIN ANALYZE**. → `agua:D10`, `cond:D10`.
- **Renombrar migraciones `fase1..fase43`** + README. → `cond:A5`, `cond:C12`.
- **i18n** (`react-intl`) + plantillas localizadas. → `agua:B13`, `cond:B14`, `com:N28`.
- **Generación automática de tipos desde Supabase**. → `agua:C11`, `cond:C14`.
- **Polling incremental de notifications**. → `com:N15`.
- **Dependabot / Renovate**. → `infra:I37`.
- **CODEOWNERS**. → `infra:I38`.
- **Cifrado at-rest** de mensajes sensibles. → `com:N29`.
- **ManualChunks robusto** con tests de tamaño. → `infra:I23`.

---

## 5. Bloqueantes absolutos para lanzar SaaS

Lista corta de lo que **no se puede saltar** antes del primer cliente que paga.

| ID | Hallazgo | Doc |
|----|----------|-----|
| `plat:P1` | Sin billing_plans / subscriptions / invoices | Plataforma |
| `plat:P2` | Sin onboarding self-service de empresa | Plataforma |
| `plat:P3` | Sin invite-based onboarding de usuario | Plataforma |
| `plat:P4` | Sin MFA | Plataforma |
| `plat:P5` | Usuario = una empresa (sin multi-tenant) | Plataforma |
| `plat:P6` | Bypass total admin/owner | Plataforma |
| `plat:P36` | Límites de plan no enforce | Plataforma |
| `agua:A1` + `cond:A1` + `infra:I5` | Sin router; switches gigantes; sidebar hard-coded | Agua / Cond / Infra |
| `agua:C2` + `cond:C1` | RLS sin granularidad por unidad/ruta | Agua / Cond |
| `cond:C2` | Sin CHECK constraints en DB | Cond |
| `agua:B2` + `cond:B4` | Tablas/admin no responsive | Agua / Cond |
| `cond:B1` | Navegación de 191 tabs sin búsqueda | Cond |
| `infra:I1` | 6 edge functions sin JWT | Infra |
| `infra:I3` | Sin ErrorBoundary global | Infra |
| `infra:I4` | Sin PWA / offline real | Infra |
| `com:N1` | EmailJS key expuesta | Comunicación |
| `com:N12` | KPIs cliente-side sin vistas materializadas | Comunicación |

---

## 6. Cómo continuar

1. **Compartir este índice con stakeholders** (producto, ingeniería, soporte, comercial). Decidir orden de fases y asignar champions.
2. **Crear un epic por fase** en GitHub (`Fase 1 — Fundaciones técnicas`, etc.). Romper en issues atómicos referenciando los IDs de cada documento (`agua:A1`, `cond:B2`, etc.).
3. **Decisión estratégica clave:** ¿priorizar **lanzar SaaS de condominios** (mayor superficie, más valor por tenant) o **estabilizar agua primero** (menor complejidad, mismo cliente)? El paquete completo aporta evidencia para decidir.
4. **Aplicar Fase 1 completa antes que cualquier otra cosa.** Es prerequisito de todas las demás. Sin router + capa de datos + Tenant + ErrorBoundary, los hallazgos posteriores son inalcanzables.
5. **Re-evaluar trimestralmente.** Versionar como `DESIGN_CRITIQUE_INDEX_YYYY-MM-DD.md`. Cerrar hallazgos resueltos. Identificar nuevos.

---

## 7. Estado de implementación

Tabla viva del progreso. Cada vez que un hallazgo se resuelve en un PR posterior, se marca aquí + en el documento de critique correspondiente.

### Hallazgos resueltos

| ID | Hallazgo | PR | Notas |
|----|----------|----|-------|
| `infra:I3`  | ErrorBoundary global | [#167](https://github.com/ventas-png/control-consumo-agua/pull/167) | `<App />` envuelto en `main.tsx` |
| `infra:I34` | robots.txt          | [#167](https://github.com/ventas-png/control-consumo-agua/pull/167) | bloquea rutas internas + previews |
| `infra:I35` | `.env.example` claridad de secretos | [#167](https://github.com/ventas-png/control-consumo-agua/pull/167) | tabla de qué va dónde |
| `infra:I37` | Renovate config | [#167](https://github.com/ventas-png/control-consumo-agua/pull/167) | schedule semanal, grouping conservador |
| `infra:I38` | CODEOWNERS | [#167](https://github.com/ventas-png/control-consumo-agua/pull/167) | reviews en auth/RLS/payments/migrations |
| `infra:I32` | Edge function `health` | [#168](https://github.com/ventas-png/control-consumo-agua/pull/168) | smoke check de env vars; sin JWT; pensada para UptimeRobot/Pingdom |
| `infra:I10` | PostHog tagging multi-tenant | [#169](https://github.com/ventas-png/control-consumo-agua/pull/169) | `registerSuperProperties({company_id, role, plan})` desde App.tsx |
| `infra:I11` | Sentry sampler por severity | [#169](https://github.com/ventas-png/control-consumo-agua/pull/169) | 100% rutas críticas + errores / 10% resto en prod |

### Hallazgos parciales (avance real, falta cierre)

| ID | Estado actual | Comentario |
|----|----------------|-----------|
| `infra:I30` | ✅ **Falso positivo** | `vercel.json:14` ya tiene `geolocation=(self)`. La auditoría original era incorrecta. |
| `infra:I36` | ✅ **Docs cerradas** | `monitoring.ts` ya lee `VITE_APP_ENV \|\| MODE`; PR #167+#168 documentan que en Vercel hay que setear `VITE_APP_ENV=$VERCEL_ENV`. Acción operativa fuera del repo (panel Vercel). |
| `infra:I15` | ⏳ **Parcial** | `.env.example` ya documenta dónde va cada secreto (PR #167); pendiente `SECRETS_INVENTORY.md` exhaustivo con política de rotación. |
| `infra:I7`  | ⏳ **Parcial** | PR #168 agrega `npm run test:coverage` + upload de artifact en CI como advisory. Pendiente: arreglar el flake del test de `ImportModal` con `--coverage` y fijar threshold inicial (p. ej. lines ≥ 50%). |
| `infra:I8`  | ⏳ **Parcial** | PR #168 agrega job `lint-functions` con `deno fmt --check` + `deno lint` (advisory). Pendiente: limpiar baseline de las 14 funciones existentes y quitar `continue-on-error` para hacerlo enforce. |
| `infra:I33` | ⏳ **Parcial** | PR #169 introduce `src/lib/logger.ts` con niveles estructurados + Sentry breadcrumbs. Pendiente: migración gradual de `console.log` (PRs por dominio) + pipe servidor a Datadog/Logtail. |
| `cond:A10`  | ⏳ **Parcial** | PR #169 mueve 3/4 componentes (`FileUploader`, `ImageUploader`, `ImageGallery`) a `shared/`. `RubrosBuilder` se queda atado a `cond:C9` por su dependencia de tipos del dominio. |
| `agua:C11` + `cond:C14` | ⏳ **Parcial** | PR #169 crea `.github/workflows/types-drift.yml` (advisory, manual + cron semanal). Pendiente: primer run para validar secretos, baseline committed, refactor de tipos. |
| `infra:I39` | ⏳ **Fase 1 en PR #170 + Fase 2 en PR #171** | Baseline completo de 16 tablas legacy + 7 funciones legacy + FKs cross-fase. **Alcance refinado tres veces durante implementación**: 4 → 16 tablas + 7 funciones. **PR #171 es superset del PR #170** (base apuntando a `main`, contiene ambas migraciones), por lo que se puede mergear solo el #171 si se quiere consolidar. Fase 3 quedaría sólo si tras mergear aparece un nuevo tipo de objeto legacy (triggers/vistas/secuencias). |

### Métricas de avance (post-merge a main)

| Concepto | Antes | Final (post 6 merges, 2026-05-27) |
|----------|-------|-----------------------------------|
| Hallazgos totales      | 219 | **222** (+`I39`, `I40`, `I41`, `I42` descubiertos durante implementación; `I40`-`I42` derivados de `I39`) |
| Resueltos             | 0   | **12** (`I3, I10, I11, I32, I34, I35, I37, I38, I39, I40, I41, I42`) |
| Docs/falsos positivos | 0   | 2 (`I30, I36`) |
| Parciales activos     | 0   | 6 (`I15, I7, I8, I33, cond:A10, agua:C11+cond:C14`) |
| % progreso (resueltos) | 0%  | **5.4%** (12/222) |
| % cobertura del lote 1+2+3 | 0% | ~95% (todo lo planeado mergeado a main) |

### Orden de merge ejecutado — TODOS LOS PRs EN `main` ✅

| PR | Sha | Logro |
|----|-----|-------|
| ❌ #170 | (cerrado) | Superseded por #171 (que es superset) |
| ✅ #171 | `d96eb11` | `infra:I39` fases 1+2 — 16 tablas legacy + 7 funciones + FKs cross-fase + README convención |
| ✅ #167 | `8fa70a0` | Gobernanza — ErrorBoundary global, CODEOWNERS, Renovate, robots.txt, .env.example |
| ✅ #169 | `c3e0e0f` | Lote 3 quick wins — logger, Sentry sampler, PostHog super-props, mover shared, types-drift |
| ✅ #172 | `4e4ba52` | `infra:I40` — timestamp duplicado 20260324000005 renombrado a 20260324000007 |
| ✅ #173 | `f354045` | `infra:I41 + I42` — policies idempotentes + columnas legacy faltantes |
| ✅ #168 | `b3b6117` | Lote 2 quick wins — coverage CI, edge function `health`, deno lint advisory |

**6 PRs mergeados, 0 abiertos.**

### Hallazgos nuevos descubiertos durante la ejecución

- `infra:I39` — Migraciones no aplicables desde cero (vía CI del #168).
- `infra:I40` — Timestamps duplicados `20260324000005` (al validar #170 → #171).
- `infra:I41` — Policies duplicadas sin `DROP IF EXISTS` previo (al validar #173).
- `infra:I42` — Columnas legacy faltantes en branches DB nuevas (al iterar #173).

### Deuda residual de Supabase Branching

Tras los 6 merges, Supabase Branching avanza ~20+ migraciones más que antes pero todavía tiene bugs "cebolla" aguas abajo (otras policies duplicadas, otras columnas legacy faltantes). Cada uno requiere PR pequeño con uno de dos patrones:
- `DROP POLICY IF EXISTS` antes de `CREATE POLICY` duplicado.
- `ALTER TABLE ADD COLUMN IF NOT EXISTS` antes de referenciar columna legacy.

**Producción no afectada** — las migraciones ya están aplicadas con su estado correcto allí. Solo afectan a Supabase Branching y `supabase db reset`. Se atienden como **track de mantenimiento continuo**, no como bloqueo del roadmap.

### Próximo lote candidato — Lote 4 (5 quick wins, sin cambios)

Los 5 quick wins propuestos siguen válidos. Una vez se haya mergeado el PR #170 (baseline tablas), el #3 (`com:N20`) deja de tener riesgo de migración bloqueada.

1. **`infra:I27`** — `useOffline` flag con TTL (24h) + UI para alternar.
2. **`com:N22`** — Lazy import de `chart.js` en `admin-dashboard/`. Reduce ~64KB gzip del bundle inicial.
3. **`com:N20`** — `paquetesNotify` con retry visible. Migración pequeña — ya es seguro tras `infra:I39` fase 1 mergeado.
4. **`agua:B10`** — Sidebar 256px → 64px colapsable en `<1024px`.
5. **`agua:A10` cierre + `cond:C9` arranque** — Empezar partición de `src/types/index.ts`.

### Y un PR 5 paralelo / posterior: `infra:I39` fase 2

Tras el descubrimiento del PR #170, el alcance de la fase 2 se expande:

- **11 tablas legacy restantes** (`clientes`, `registros`, `convenios_pago`, `fuentes_agua`, `registros_calidad`, `payment_requests`, `password_reset_tokens`, `user_sessions`, `security_logs`, `empresa`, `empresa_pagos_config`).
- **7 funciones legacy** referenciadas por la migración `20260318000001_fix_function_search_path_and_move_extensions.sql`: `current_user_role()`, `request_password_reset(varchar/text)`, `validate_reset_token(varchar/text)`, `update_user_password()`, `migrate_custom_auth_to_supabase_unconfirmed()`. Schema extraído vía MCP listo para reusar con `CREATE OR REPLACE FUNCTION` (idempotente).
- **Completar las FKs cross-fase** documentadas como `-- TODO infra:I39-fase2` en `20260317000000_baseline_legacy_tables_phase1.sql`.

Mismo enfoque que fase 1: schema replicado de prod vía MCP, `IF NOT EXISTS` / `CREATE OR REPLACE` idempotentes. **Probable fase 3 iterativa** si tras la fase 2 aparece un cuarto nivel de objetos legacy (triggers, vistas, secuencias). El proceso converge en pocas iteraciones porque cada fase ataca el siguiente nivel del error.

### Nota importante: el PR #170 NO debe bloquearse por el sub-error

Aunque el Supabase Preview del PR #170 muestra ❌, eso es porque expone el SIGUIENTE error en la cadena (función legacy), no porque su fase 1 haya fallado. Mergear el PR #170 es seguro porque:
- En producción es no-op idempotente (`IF NOT EXISTS` no toca tablas existentes).
- Sus 5 tablas baseline + RLS aplicadas en branches sí funcionan (validado por el cambio de tipo de error).
- El próximo PR (fase 2) atacará el siguiente nivel.

### Monitoreo de impacto

A medida que se resuelven hallazgos, anotar aquí si la solución impacta (resuelve o requiere actualizar) hallazgos en otros documentos:

- **`infra:I3` (ErrorBoundary global)** → no afecta otros hallazgos; complementa los boundaries por sección existentes en App.tsx (`agua:A7`).
- **`infra:I38` (CODEOWNERS)** → habilita Fase 5 de calidad continua para todos los documentos.
- **`infra:I37` (Renovate)** → resuelve dependencias estancadas; relevante para `infra:I8` (deno) cuando se añadan tests futuros.
- **`infra:I32` (health endpoint)** → habilita la observabilidad externa que mencionan `infra:I18` (alertas Slack/email) e `infra:I16` (separación staging/prod, ya que cada env tendrá su propio probe).
- **`infra:I7` parcial (coverage)** → expone que el flake de `ImportModal.test.tsx` con `--coverage` se debe a timing — anotar como deuda en la sección "Tests" de `agua:C7`. Coverage limpio habilita el threshold definitivo en Fase 5.
- **`infra:I8` parcial (deno lint advisory)** → al limpiar baseline + hacerlo enforce, también impone consistencia en futuras funciones que se creen para `com:N2` (orquestador de notificaciones), `cond:A9` (edge functions de condominios), `plat:P3` (invite) y `plat:P36` (límites de plan). Inversión que se amortiza.
- **`infra:I39` fase 1 (PR #170)** → resuelve el primer error de Supabase Branching. Una vez mergeado, los próximos PRs con cambios en `supabase/` deben pasar Supabase Preview (al menos hasta donde la migración 20260318 referencia las 4 tablas baseline). Si aparece un error nuevo sobre `clientes`/`registros`/etc., es de fase 2 (esperado y diagnóstico-amigable). Habilita parcialmente `infra:I16` (staging confiable), `infra:I19` (canary), `infra:I20` (rollback).
- **Alcance refinado de `infra:I39`** → durante el PR #170 descubrí que son 15 tablas legacy, no 4. Esto no es un hallazgo nuevo, es una mejor estimación del mismo problema. La fase 2 (PR 5) completará el cierre.
- **`infra:I10` (PostHog super-props, PR #169)** → cada `track()` ahora arrastra `company_id` y `role`. Esto descongela parte de `infra:D4` y `D5` (dashboards de negocio multi-tenant) porque ya hay segmentación correcta para construir cohortes en PostHog. La convención de naming de eventos (verb_object) sigue pendiente.
- **`infra:I11` (Sentry sampler, PR #169)** → al conservar 100% en rutas críticas (login/oauth/payment/stripe/create-user/delete-user), genera evidencia mucho más completa para diagnosticar bugs en pagos (`plat:P36` enforcement) y auth (`plat:P4` MFA). Reduce el riesgo de "el bug pasó pero no quedó traza" durante la Fase 2.
- **`infra:I33` (logger, PR #169)** → introducir `logger.*` habilita una migración gradual de `console.log` dispersos. Útil cuando se ataquen god-components (`agua:A2`, `cond:A2`, `plat:P12`) y se necesite trazar flujos sin contaminar la consola de prod.
- **`cond:A10` parcial (componentes shared)** → al mover 3 archivos a `shared/`, agua ya puede importar `FileUploader` para fotos de medidores y `ImageUploader` para evidencias de lectura (atado a `agua:B7` — loading state durante guardado). Cierre completo de `A10` depende de mover `RubrosBuilder`, que a su vez depende de `cond:C9` (partir tipos).
- **`agua:C11` + `cond:C14` (workflow types-drift)** → al detectar drift entre Supabase y el repo, encuentra automáticamente las migraciones que no llegaron al repo o tablas creadas a mano. **Pista directa a `infra:I39`**: la primera ejecución dirá exactamente qué tablas existen en prod pero no en migrations.

---

## 8. Trabajo compartido entre documentos

Estos esfuerzos resuelven **múltiples** hallazgos de **varios** módulos a la vez:

| Esfuerzo | Beneficia a |
|----------|-------------|
| Router por dominio | agua, condominios, plataforma, servicios, comunicación, infra |
| TanStack Query + capa de datos | agua, condominios, servicios, comunicación, plataforma |
| Zod schemas + react-hook-form | agua, condominios, servicios |
| Partir `types/index.ts` por dominio | agua, condominios, plataforma, servicios |
| Sistema de diseño + Storybook | agua, condominios, servicios |
| Eliminar SweetAlert2 → Radix UI | agua, condominios, servicios |
| axe-core en CI | agua, condominios, servicios, comunicación, infra |
| Audit log genérico | agua, condominios, plataforma |
| Soft delete universal | agua, condominios |
| Feature flags por plan | agua, condominios, servicios, plataforma |
| Tagging multi-tenant Sentry/PostHog | agua, condominios, comunicación, infra |
| Vistas materializadas KPIs | agua, condominios, comunicación |
| i18n | agua, condominios, comunicación |
| Generación automática de tipos | agua, condominios |
| Tests del dominio + E2E Playwright | agua, condominios, plataforma, servicios, comunicación, infra |
| PWA / offline-first | agua, infra |
| ErrorBoundary global | infra (afecta toda la app) |

Optimizar el orden de ejecución para resolver **trabajo compartido primero** ahorra meses de esfuerzo total.
