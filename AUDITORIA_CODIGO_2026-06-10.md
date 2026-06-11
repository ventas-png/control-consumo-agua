# Auditoría de código — 2026-06-10

Alcance: rama `main` completa (frontend, capa de datos, migraciones SQL, edge functions, testing).
Tamaño auditado: ~689 archivos TypeScript (~143k LOC), 271 migraciones SQL, 37 edge functions (Deno).

---

## 1. Fortalezas

- **Arquitectura de datos limpia y consistente**: capa `src/domain/<dominio>/` con `keys.ts` (query key factory), `queries.ts`, `mutations.ts`, `schemas.ts` (Zod) sobre TanStack Query v5. No hay queries de Supabase sueltas en componentes; las mutaciones invalidan sus queries; se usa `AbortSignal` vía `runQuery` (`src/domain/queryFetch.ts`).
- **TypeScript estricto**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`. Solo ~17 usos de `any` en todo el repo (mayormente mocks de test).
- **Seguridad como diseño**: RLS multi-tenant con `get_my_company_id()`; secretos en tablas deny-all (`company_payment_secrets`, `fiscal_pac_secrets`) accesibles solo por `service_role`; RPCs `SECURITY DEFINER` con `REVOKE EXECUTE` explícito; CSP pineada por host; rate limiting server-side; sin `dangerouslySetInnerHTML` (DOMPurify donde se necesita); webhooks de Stripe con verificación de firma.
- **Manejo de errores sistémico**: ~484 bloques try/catch, Sentry integrado, audit log genérico por trigger (`20260528000000_audit_log_generic.sql`).
- **Lógica pura separada**: `src/lib/` (61 archivos, ~7k LOC) bien organizado y testeable.

## 2. Hallazgos priorizados

### P0 — Atender antes de seguir agregando features

| # | Hallazgo | Evidencia | Riesgo |
|---|----------|-----------|--------|
| 1 | **Cobertura de tests ~0% en dominios críticos**: condominios domain (C3) y auth/RBAC/RLS (P15) — *parcialmente atendido*: existen `src/lib/__tests__/{permissions,aguaPermissions,authSession}.test.ts`, `usePermissions.test.ts` y el harness RLS server-side; el harness se EXTENDIÓ (2026-06-11) con las 14 tablas y 6 RPCs del ERP financiero | `ESTADO_Y_TRACKS_PARALELOS_2026-06-04_cierre.md` (T8); ratio global test:source ≈ 25% pero concentrado en shared/lib | Regresiones de permisos o dinero sin red de seguridad |
| 2 | **CORS wildcard fallback en 3 edge functions** — *RESUELTO 2026-06-11*: las 3 funciones consolidadas en `_shared/cors.ts` (fallback = primer origen permitido, nunca `*`) | `supabase/functions/google-oauth-initiate`, `google-oauth-callback`, `send-email` (líneas 17–18); pendiente de `CODE_REVIEW_2026-05-25.md` | Cualquier origen puede invocar endpoints sensibles desde navegador |

### P1 — Deuda estructural

| # | Hallazgo | Evidencia |
|---|----------|-----------|
| 3 | **Componentes monolíticos** — *RESUELTO COMPLETO 2026-06-11*: los 8 god-components refactorizados con el mismo patrón (reglas puras en `src/lib/` con tests + vistas/modales extraídos con ctx tipado, JSX intacto): AmenidadesTab 1,932 → ~710 L, VisitantesTab 1,530 → 525 L, CustomerPortal 1,511 → 485 L, ClientesSection 1,302 → 625 L, UnidadesSection 1,226 → 542 L, RutasSection 1,169 → 416 L, SeguridadTab 1,128 → 386 L y ContadoresSection 1,069 → 385 L | El refactor de `EmpresaSection` (1259 → 112 LOC + domain) fue el patrón replicado |
| 4 | **`App.tsx` con 1151 líneas** (router + providers + lazy imports) — *RESUELTO 2026-06-11*: 1,160 → 512 L. Rutas en registro declarativo `components/app/routes.tsx` (`APP_ROUTES` con guards de módulo/rol/ErrorBoundary declarativos + 6 tests de invariantes), lazy imports y preloaders en `components/app/lazySections.ts`, shell auxiliar en `components/app/shell.tsx`, capa de datos agua en `hooks/useAguaData.ts`, OAuth Gmail en `lib/gmailOAuth.ts` | Extraer la definición de rutas a un registro declarativo |
| 5 | **`useAuth.ts` (524 L)** mezcla sesión, permisos y empresa | Pendiente P13 del tracker |
| 6 | **`types/condominios.ts` con 2950 líneas** — *RESUELTO 2026-06-11*: particionado en `types/condominios/{core,seguridad,operaciones,residentes,comercial,gobernanza,finanzas}.ts` con barrel `index.ts` (superficie pública intacta) | Dividir por sub-dominio (amenidades, seguridad, finanzas…) |

### P2 — Mejoras de bajo riesgo

| # | Hallazgo | Evidencia |
|---|----------|-----------|
| 7 | Sin `database.types.ts` generado de Supabase; tipos a mano (Zod compensa pero no garantiza sincronía con la BD) — *ATENDIDO 2026-06-11*: `src/types/database.types.ts` generado desde producción (232 tablas/vistas, ERP incluido) + script `npm run gen:db-types`; el check de CI requiere configurar el secreto `SUPABASE_ACCESS_TOKEN` (pendiente, manual) y la adopción de `createClient<Database>` es incremental | `supabase gen types typescript` + CI check |
| 8 | E2E limitado: 6 happy paths en `e2e/` | Falta cobertura de violaciones RLS, edge cases de dinero |
| 9 | `formatCurrency` duplicado en `ReporteConsolidadoTab.tsx:28` — *RESUELTO 2026-06-11* | Reusar `src/lib/format.ts` |
| 10 | Ternarios anidados de 3 niveles — *RESUELTO 2026-06-11* (helpers con if) | `DataTable.tsx:273,278`, `ReportesTab.tsx:123`, `GeneradorCuotasTab.tsx:282,286` |
| 11 | Comparación de service-role key sin tiempo constante — *RESUELTO 2026-06-11*: helper `timingSafeEqualSecret` (digest SHA-256 + XOR sin cortocircuito) en `_shared/auth.ts`, usado por ambas funciones | `notify-package`, `route-reminders` (informativo) |
| 12 | Nombres confusos en condominios: tab "Contabilidad" es CRUD de gastos y "Pólizas" son seguros | Renombrado en esta rama (ver módulo Contabilidad nuevo) |

## 3. Recomendaciones priorizadas

1. **P0**: suite de tests de autorización (auth/RBAC/RLS) + dominio condominios; cerrar el CORS wildcard consolidando en `_shared/cors.ts`.
2. **P1**: refactor incremental de god-components siguiendo el patrón EmpresaSection (extraer domain + sub-componentes); dividir `App.tsx` y `types/condominios.ts`.
3. **P2**: generar `database.types.ts` en CI; ampliar E2E (flujos de dinero y accesos indebidos); aplicar las simplificaciones de bajo riesgo listadas.
4. **Funcional**: la mayor brecha de producto es financiera — hoy el sistema opera "caja simple" sin contabilidad formal. Ver `ROADMAP_ERP_FINANZAS.md` (la Fase 1 — partida doble — se implementa en esta rama).
