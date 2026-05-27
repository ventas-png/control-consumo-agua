# Design Critique — Módulo de Agua

**Fecha:** 2026-05-26
**Alcance:** Arquitectura · UX/UI · Modelo de dominio · Performance · Observabilidad
**Objetivo:** Identificar puntos de mejora y trazar un camino para robustecer el producto como **SaaS multi-tenant**.
**Repo:** `ventas-png/control-consumo-agua` · Versión actual: `2.0.0`
**Documentos relacionados:** `SECURITY_UX_AUDIT_2026-04-07.md`, `SECURITY_FIX_SUMMARY.md`

---

## 1. Resumen ejecutivo

El módulo de agua está funcional y cubre el ciclo de negocio (contadores → lecturas → cálculo escalonado → cobros → rutas → calidad). Sin embargo, la arquitectura actual fue diseñada para **una aplicación interna mono-tenant**, no para un SaaS. Los principales bloqueantes para escalar son:

1. **No hay router**. Toda la navegación vive en `src/App.tsx:474-782` mediante un `switch` por estado local. No hay deep linking, no hay bookmarking, no se pueden compartir URLs internas a una lectura/cobro/cliente.
2. **God-components**. Las secciones principales superan las 1.000 líneas y mezclan presentación, validación, llamadas a Supabase y lógica de negocio en el mismo archivo (`UnidadesSection.tsx` 1.286 líneas, `RutasSection.tsx` 1.190, `ContadoresSection.tsx` 1.077, `CobrosSection.tsx` 729, `LecturasSection.tsx` 700).
3. **Mobile y accesibilidad bloqueados**. El audit de 2026-04-07 marcó como CRÍTICO la falta de responsive en tablas/modales y de ARIA en formularios; siguen pendientes. El flujo más usado (captura de lectura en campo) ocurre justamente en móvil.
4. **Multi-tenancy frágil**. `Empresa` está declarada como `{ id?, nombre? }` en `src/types/index.ts:71-74`. No hay agregado `Tenant` con planes, límites, billing ni feature flags.
5. **Sin caché de queries ni paginación**. `useData.ts` dispara 14 queries en paralelo por sesión y mantiene listas completas en memoria; no es viable con miles de contadores por tenant.

**Conteo de hallazgos en este documento:**

| Severidad | Cantidad |
|-----------|----------|
| Crítico   | 10       |
| Alto      | 14       |
| Medio     | 12       |
| Bajo      | 5        |
| **Total** | **41**   |

**Top 5 bloqueantes para lanzar SaaS:** A1 (router), B2-B3 (responsive móvil), C2 (RLS granular), C5 (multi-tenancy), D2 (paginación).

---

## 2. Eje A — Arquitectura y código

### A1 · 🔴 Crítico — Sin router; navegación basada en `useState`

`src/App.tsx` (789 líneas) maneja toda la navegación con un único estado `activeSection` y un switch gigante entre las líneas **474-782**. Consecuencias:

- No se puede compartir un link a una lectura, cobro o cliente concreto.
- El botón "atrás" del navegador no funciona como espera el usuario.
- Soporte/Onboarding no puede dirigir al usuario a pantallas específicas.
- SEO y métricas por pantalla (PostHog `$pageview`) quedan limitadas.
- Cada nuevo módulo obliga a tocar `App.tsx` (acoplamiento estructural).

**Recomendación SaaS:** Migrar a `react-router-dom` v6 con rutas anidadas por dominio: `/agua/lecturas`, `/agua/cobros/:id`, `/agua/rutas/:rutaId/ejecutar`, `/admin/tenants/:id`. Mover los `lazy()` al `route.element` para code-splitting natural.

---

### A2 · 🔴 Crítico — God-components con responsabilidades cruzadas

| Archivo | Líneas |
|---------|--------|
| `src/components/unidades/UnidadesSection.tsx`     | 1.286 |
| `src/components/rutas/RutasSection.tsx`           | 1.190 |
| `src/components/contadores/ContadoresSection.tsx` | 1.077 |
| `src/components/cobros/CobrosSection.tsx`         | 729   |
| `src/components/lecturas/LecturasSection.tsx`     | 700   |

`LecturasSection.tsx` declara **20 `useState`** entre las líneas 43-56, mezclando: selección de unidad/contador, lectura actual, GPS, foto, ruta manual, estado de guardado y cálculo en vivo de tarifa. Todo en un mismo archivo, sin separación entre presentación y dominio.

**Impacto:** imposible testear unidades pequeñas, alto riesgo de regresiones al tocar cualquier flujo, curva de onboarding empinada para nuevos devs.

**Recomendación SaaS:** Romper cada Section en al menos 4 piezas:
- `*Page.tsx` (layout + routing).
- `use<Feature>()` hook (estado + side-effects).
- `<FeatureForm />`, `<FeatureList />`, `<FeatureSummary />` (presentación pura).
- Servicios `agua/<feature>/api.ts` para queries Supabase.

---

### A3 · 🟠 Alto — Props drilling masivo desde `App.tsx`

`App.tsx` pasa 20+ props (`clientes`, `registros`, `tarifas`, `contadores`, `unidades`, callbacks `onClienteAdded`, etc.) a cada Section. Un cambio de schema obliga a tocar la cascada completa. No hay Context ni store global.

**Recomendación SaaS:** Introducir TanStack Query para data, y dos Contexts ligeros para `SessionContext` (auth/tenant) y `PermissionsContext`. Eliminar el callback "onXAdded" — la invalidación de caché lo hace TanStack Query.

---

### A4 · 🟠 Alto — `useData.ts` monolítico con 14 queries simultáneas

`src/hooks/useData.ts` (652 líneas) carga en paralelo 14 listas (clientes, registros, tarifas, contadores, rutas, unidades, fuentes de agua, calidad, proveedores energía, tarifas energía, fuentes energía, proyectos, etc.) usando `Promise.allSettled` con timeout de 15s/query. La caché va a `localStorage` (`aquacontrol_data_v3_${userId}`, TTL 24h) **sin partición por entidad**, lo que obliga a invalidar todo el blob si cambia una tabla.

**Recomendación SaaS:** TanStack Query con `queryKey` por entidad + `staleTime` configurable. Eliminar la caché manual en localStorage. Cargar bajo demanda (al entrar a la ruta), no al login.

---

### A5 · 🟠 Alto — Duplicación de enums y constantes del dominio

`TipoAgua` y `TIPOS_AGUA` se redefinen en `ContadoresSection.tsx` y `TarifasSection.tsx`. Cambiar un valor en un solo lugar produce inconsistencias silenciosas. Misma situación con literales de estado de Registro (`'pendiente' | 'pagado' | 'mora'`).

**Recomendación:** Mover a `src/domain/agua/constants.ts` y exportar enums tipados. Idealmente derivar de schemas Zod compartidos.

---

### A6 · 🟡 Medio — `src/types/index.ts` monolítico (3.691 líneas)

Un solo archivo contiene 95+ interfaces de TODOS los dominios (agua, energía, condominios, paqueterías, comunicación, etc.). Al cargarlo en el IDE, autocompletado se vuelve lento; cualquier cambio compila más de lo necesario.

**Recomendación:** Partir por dominio: `src/types/agua.ts`, `src/types/energia.ts`, `src/types/condominios.ts`, `src/types/shared.ts`. Mantener un `index.ts` barrel mínimo.

---

### A7 · 🟡 Medio — `ErrorBoundary` redundante en cada rama del switch

`App.tsx:474-782` envuelve cada `*Section` con su propio `<ErrorBoundary>`. El boundary debería estar a nivel route, una sola vez, con fallback genérico + reporte a Sentry.

---

### A8 · 🟡 Medio — `lazy()` sin `prefetch`

`App.tsx:26-45` declara `React.lazy()` para cada sección. Sin prefetch en hover/idle (`requestIdleCallback`) ni `<link rel="prefetch">`, la primera entrada a cualquier módulo sufre un parpadeo de fallback.

---

### A9 · 🟡 Medio — `useAuth.ts` con OAuth + rate-limit acoplados

`src/hooks/useAuth.ts` mezcla rate-limiting de login (5 intentos / 60s), interceptor OAuth Google y persistencia en `sessionStorage`. Difícil de testear de forma unitaria y de reutilizar.

**Recomendación:** Separar en `useLoginRateLimit`, `useGoogleOAuth`, `useSession`.

---

### A10 · 🔵 Bajo — Convención de naming mezclada (español + inglés)

`addCliente`, `updateRegistroEstado`, `recibirLectura` conviven con `useData`, `loadingState`, `errorBoundary`. Para un SaaS donde el equipo crece, conviene fijar convención: **dominio en español** (`Cliente`, `Contador`, `Registro`), **plomería técnica en inglés** (`useFetch`, `onError`).

---

## 3. Eje B — UX / UI / Accesibilidad

### B1 · 🔴 Crítico — Accesibilidad rota (audit 2026-04-07 sin resolver)

Hallazgos del audit previo que siguen pendientes:
- `Sidebar.tsx`: botones icon-only sin `aria-label`.
- Formularios (`LecturasSection`, `ContadoresSection`, etc.): `<label>` sin `htmlFor` ⇒ screen readers no asocian label-input.
- `DataTable` sin `scope="col"` en `<th>`.
- Inputs con error sin `aria-describedby` ni `aria-invalid`.

**Impacto SaaS:** Bloqueante para clientes con requisitos de accesibilidad (gobierno, ONGs, empresas con WCAG en su compliance).

**Recomendación:** Sweep de accesibilidad guiado por axe-core en CI. Adoptar Radix UI o Headless UI para primitivos (Dialog, DropdownMenu, Tabs) que ya cumplen ARIA.

---

### B2 · 🔴 Crítico — Tablas con scroll horizontal en móvil

Las tablas de Contadores, Clientes, Registros, Historial tienen scroll horizontal en viewports <420px. El flujo de **captura de lectura en campo** es esencialmente móvil — esto rompe el caso de uso principal.

**Recomendación:** Patrón "card list" en móvil + "table" en desktop. Componente `<ResponsiveTable>` reutilizable.

---

### B3 · 🔴 Crítico — Modales 760px en viewports 375px

`EditModal` y otros modales tienen `maxWidth: 760px` sin fallback a 100vw. En móvil aparecen recortados o requieren scroll.

**Recomendación:** `width: min(760px, calc(100vw - 16px))` y forma sheet-from-bottom en móvil.

---

### B4 · 🟠 Alto — Validación silenciosa en formularios

Inputs marcan borde rojo pero **no muestran texto del error**. En `LecturasSection`, el usuario ve que "algo" está mal pero no sabe qué.

**Recomendación:** Mensaje debajo del input con `id` y vincular vía `aria-describedby`. Si se adopta react-hook-form + Zod, esto sale gratis.

---

### B5 · 🟠 Alto — Mezcla inconsistente sonner ↔ SweetAlert2

`src/lib/toast.ts` envuelve `sonner` (toasts no bloqueantes). En paralelo, hay 30+ `import Swal from 'sweetalert2'` repartidos por el código (incluso dentro del mismo módulo agua). No hay regla documentada de cuándo usar cuál.

**Recomendación:** Adoptar un único patrón:
- `toast.*` para feedback no bloqueante (guardado OK, error de red).
- Confirmaciones destructivas con un `<ConfirmDialog>` accesible (Radix Dialog), eliminando SweetAlert2 (que es pesado, ~80kb, y poco accesible por defecto).

---

### B6 · 🟠 Alto — Touch targets <44 px en lector móvil

Auditoría flagueó botones de tabla, checkboxes (16px) y botones de cerrar modal por debajo del estándar Apple/Material (44/48 px). En campo, con guantes o pantalla mojada, esto es bloqueante.

---

### B7 · 🟠 Alto — Sin loading state al guardar lectura

`LecturasSection` setea `saving=true` pero no muestra spinner ni bloquea la UI con feedback visible. En conexiones lentas (campo) el operador puede dudar y disparar doble submit.

**Recomendación:** Botón con estado `loading` + skeleton sobre el resumen. Idempotencia en el insert por `(contador_id, fecha, lectura_actual)` para evitar duplicados.

---

### B8 · 🟠 Alto — No es PWA / sin offline real

`src/hooks/useOffline.ts` existe pero `public/` solo contiene `favicon.svg`. No hay `manifest.webmanifest`, no hay service worker, no hay cola de sincronización. El módulo más usado en campo es justamente el que necesita offline.

**Recomendación:** Vite PWA Plugin + IndexedDB para cola de lecturas pendientes + sync al recuperar conexión. Indicador visual de "modo offline / N pendientes".

---

### B9 · 🟠 Alto — Sin sistema de design unificado

`src/index.css` define tokens `--at-*` muy completos, pero muchos componentes los ignoran y usan `style={{...}}` inline. Sin Storybook, sin biblioteca de componentes documentada.

**Recomendación:** Storybook + auditoría de inline styles. Componentes shared promovidos como API pública del sistema (Button, Input, Card, Badge, etc.).

---

### B10 · 🟡 Medio — Sidebar 256px ocupa 22% en tablet

Auditoría lo marcó como MEDIO; sigue pendiente. En tablet 768px la sidebar consume 1/4 del ancho útil.

**Recomendación:** Sidebar colapsable a 64px (solo iconos) en `<1024px`, expandible on hover.

---

### B11 · 🟡 Medio — Breadcrumbs ausentes

Cuando el usuario navega Cliente → Contador → Historial → Recibo, no hay rastro visual de cómo regresar. (Relacionado con A1: sin rutas tampoco hay jerarquía.)

---

### B12 · 🟡 Medio — Empty states inconsistentes

Existe `src/components/shared/EmptyState.tsx`, pero su uso en Sections es esporádico. En muchas listas vacías se ve simplemente un área en blanco.

---

### B13 · 🔵 Bajo — Mensajes de error genéricos en español sin traducción

Para SaaS internacional, todos los textos están en español hard-coded. Sin i18n (`react-intl` o similar) no se puede vender a clientes anglo/portugués sin fork.

---

### B14 · 🔵 Bajo — Iconografía mezclada (SVG inline + emojis 🔒)

`index.html` y Sidebar mezclan SVG inline con emojis. Inconsistencia visual y problema de renderizado cross-platform.

---

## 4. Eje C — Modelo de dominio y datos

### C1 · 🔴 Crítico — Sin validación "lectura_actual ≥ lectura_anterior"

`src/lib/business.ts` (42 líneas) **solo calcula el monto**. No valida que la lectura actual sea mayor o igual a la anterior, no detecta saltos imposibles (consumo > 10× promedio histórico) ni reset físico del contador. `src/lib/validation.ts` (65 líneas) tampoco lo cubre.

**Impacto:** fraude por digitación, errores que llegan al cobro y se descubren cuando el cliente reclama.

**Recomendación SaaS:** Función `validarLectura(contador, lecturaActual, fecha)` que verifique:
- `lecturaActual >= contador.ultimaLectura` o bandera explícita `reseteoContador=true` con motivo.
- `consumo <= histórico_p95 * 3` (umbral por contador).
- Lectura no duplicada en el mismo ciclo.

---

### C2 · 🔴 Crítico — RLS sin granularidad por ruta/lector

`src/lib/aguaPermissions.ts` define 10 módulos con 4 acciones (view/create/edit/change_status). Las políticas RLS de Supabase parecen filtrar por `company_id` pero **no por `ruta_id` ni `lector_asignado`**. Un collector con permiso de "lecturas.view" puede ver clientes que no le corresponden.

**Impacto SaaS:** En multi-tenant agresivo (varias administradoras compartiendo plataforma), una RLS débil se vuelve un incidente de privacidad.

**Recomendación:** Auditar y reescribir policies de `lecturas`, `clientes`, `registros`, `cobros` para filtrar por (`company_id`, `project_id`, `ruta_id IN (rutas asignadas al user)`). Tests E2E con `pgTAP` o scripts SQL que validen aislamiento.

---

### C3 · 🟠 Alto — Lenguaje del dominio confuso

`Registro` = transacción de cobro de agua. `RegistroCalidad` = análisis de calidad. Mismo prefijo, conceptos opuestos. Falta un agregado raíz `Factura` que englobe lectura + cálculo + estado + pagos.

**Recomendación:** Renombrar `Registro` → `Factura` (o `LecturaFacturada`). `RegistroCalidad` → `AnalisisCalidad`. Sweep coordinado con migración.

---

### C4 · 🟠 Alto — Lógica de facturación incompleta

`business.ts:calcularTotalPagar()` cubre 3 tramos pero **no contempla**:
- Mora / intereses moratorios.
- Recargos por reconexión.
- Bonificaciones / descuentos puntuales.
- IVA / impuestos locales.
- Conversión de moneda (multi-país en SaaS).

Los estados (`pendiente → emitida → pagada → vencida → cancelada`) están como strings sueltos en `types/index.ts`, sin máquina de estados ni guard rails.

**Recomendación:** Modelar `Factura` como agregado con state machine explícita (XState o reducer). `business/facturacion.ts` con funciones puras por transición. Auditoría (`facturas_eventos` append-only) con quién hizo qué.

---

### C5 · 🟠 Alto — Multi-tenancy sin agregado `Tenant`

`src/types/index.ts:71-74` declara `interface Empresa { id?: string; nombre?: string }`. No hay plan, límites (max usuarios, max contadores, max lecturas/mes), estado (`trial | active | suspended | churned`), método de pago, factura billing, ni feature flags por tier.

**Impacto SaaS:** No se puede operar como SaaS sin esto. Cualquier estrategia de pricing (free/pro/enterprise) requiere un modelo de Tenant sólido.

**Recomendación:** Tabla `tenants` con:
- `plan` (free, pro, enterprise).
- `limits` (jsonb con caps).
- `status` (enum).
- `trial_ends_at`, `current_period_end`.
- `stripe_customer_id`, `stripe_subscription_id`.
- Integración con Stripe Billing (o LemonSqueezy si LATAM).
- Tabla `tenant_usage` con métricas mensuales (lecturas, storage, emails) para enforcement de límites.

---

### C6 · 🟠 Alto — Validaciones dispersas, sin schema único

`validation.ts` solo maneja email / teléfono / password. Las validaciones de dominio (lectura, tarifa, contador) viven embebidas en componentes. Sin un schema central, UI y DB pueden divergir.

**Recomendación:** Zod schemas en `src/domain/agua/schemas.ts` compartidos por:
- React Hook Form (validación de inputs).
- Supabase (validación al guardar — vía edge function o constraints).
- Tests (factories tipadas).

---

### C7 · 🟠 Alto — Cobertura de tests del dominio insuficiente

`src/lib/__tests__/business.test.ts` (~82 líneas) cubre 3 tramos básicos. Sin tests para:
- Transiciones de estado de factura.
- Mora e intereses.
- Importación batch de lecturas (`xlsx.ts`).
- Integridad referencial (borrar contador con facturas).
- Concurrencia de dos operadores leyendo el mismo cliente.

**Recomendación:** Pirámide:
- Unit (Vitest): dominio puro (calcular, validar, transicionar). Target 80%.
- Integration: hooks con Supabase mockeado (MSW).
- E2E (Playwright): flujos críticos en viewport móvil (captura de lectura, conciliación de cobro).

---

### C8 · 🟡 Medio — `businessEnergia.ts` aislado de `business.ts`

Misma idea conceptual (calcular factura) implementada dos veces. Cuando entren agua-caliente, gas, internet, etc., serán N implementaciones.

**Recomendación:** Interfaz `CalculadorFactura` con implementaciones por servicio. Strategy pattern.

---

### C9 · 🟡 Medio — Sin auditoría de cambios en facturas/lecturas

No hay tabla `audit_log` que registre quién editó la lectura X de qué cliente y cuándo. En SaaS con clientes regulados, esto es requerimiento básico.

**Recomendación:** Trigger Postgres genérico que inserte en `audit_log` (entidad, entity_id, user_id, action, before, after, ts) — patrón ya esbozado en `20260521000001_security_harden_trigger_functions.sql`.

---

### C10 · 🟡 Medio — Sin soft-delete

Borrar un contador o un cliente parece ser delete físico. En SaaS, esto rompe integridad histórica de facturas.

**Recomendación:** `deleted_at timestamptz` + RLS que filtre `deleted_at IS NULL`. Vista `*_with_deleted` para admin.

---

### C11 · ⏳ Parcial ([PR #169](https://github.com/ventas-png/control-consumo-agua/pull/169)) — ~~Sin generación automática de tipos desde Supabase~~

> **Avance:** ver `cond:C14` (mismo workflow `.github/workflows/types-drift.yml` resuelve ambos hallazgos a nivel infraestructura). Pendiente la primera ejecución, baseline committed y refactor de tipos.

---

## 5. Eje D — Performance y observabilidad

### D1 · 🟠 Alto — Sin caché de queries; refetch al navegar

`useData.ts` carga todo al inicio y los componentes esperan que las listas estén "ahí". No hay caché por entidad, no hay invalidación selectiva, no hay refetch on focus.

**Recomendación:** TanStack Query (ya mencionado en A4). `staleTime` por entidad (tarifas: 1h, lecturas: 0).

---

### D2 · 🟠 Alto — Sin paginación / virtualización

Las listas (`ContadoresSection`, `CobrosSection`, `historial`) traen todos los registros. Con un tenant de 5.000 contadores y 60.000 lecturas/año, el navegador se cae.

**Recomendación:** Paginación server-side (Supabase `.range()`) + virtualización de filas (`@tanstack/react-virtual`). UI con cursor pagination (no offset, mejor performance en Postgres).

---

### D3 · 🟠 Alto — Bundle sin code-splitting por dominio

Dependencias pesadas (`chart.js`, `jspdf`, `jspdf-autotable`, `exceljs`, `leaflet`, `sweetalert2`, `sonner`, `dompurify`) entran al bundle principal o a chunks gigantes. PDF/Excel se usan en pocas pantallas pero pesan ~500KB combinados.

**Recomendación:**
- `import()` dinámico para `pdf.ts`, `xlsx.ts` (solo al disparar export).
- Reemplazar `sweetalert2` (~80KB) por Radix Dialog (~10KB).
- Reemplazar `chart.js` por `recharts` si simplifica + tree-shaking.
- `vite-plugin-visualizer` para auditar.

---

### D4 · 🟡 Medio — Observabilidad sin tagging multi-tenant

Sentry y PostHog están configurados pero sin convención fija de tags: `tenant_id`, `project_id`, `user_role`, `plan`. Sin esto es imposible filtrar errores "solo del tenant Acme" o medir "% de éxito de captura por plan".

**Recomendación:** Inicializar Sentry y PostHog con `setUser` + `setTag` desde `useAuth` cuando se establece sesión, e incluir `tenant_id`, `plan`, `role`.

---

### D5 · 🟡 Medio — Dashboards sólo de errores técnicos

No hay paneles de negocio: lecturas/día/lector, % cobranza mensual, mora, tasa de captura por ruta, tiempo medio entre lecturas. Para un SaaS, estos KPIs son producto (mostrarlos al cliente) y CS (entender salud de la cuenta).

**Recomendación:** PostHog Dashboards + queries SQL en Supabase con vistas materializadas refrescadas nightly.

---

### D6 · 🟡 Medio — Sin presupuestos de performance

No hay budget para LCP, INP, CLS, bundle size. Cualquier regresión de performance pasa desapercibida hasta que un cliente se queja.

**Recomendación:** Lighthouse CI sobre PRs. `size-limit` para bundle.

---

### D7 · 🟡 Medio — Logs de aplicación sin estructura

`console.log` repartido en hooks/components. Sin logger estructurado, los logs en producción son texto plano difícil de filtrar.

**Recomendación:** Wrapper `logger` (`debug/info/warn/error`) que envía a Sentry breadcrumbs en prod y a consola en dev.

---

### D8 · 🟡 Medio — Tiempo de carga inicial sin medición

Sin RUM, no sabemos cuánto tarda la primera lectura. Crítico para uso en campo con 3G.

**Recomendación:** PostHog `web-vitals` capture + alerta si p75 LCP > 2.5s.

---

### D9 · 🔵 Bajo — Imágenes (fotos de lectura) sin optimización

`SecureImage` existe, pero no hay redimensionamiento antes de subir. Una foto de 5MB desde un Android va completa a Supabase Storage, costo + lentitud.

**Recomendación:** Compresión cliente con `browser-image-compression` antes del upload (target 200KB, 1280px lado mayor).

---

### D10 · 🔵 Bajo — Sin warming de tablas frecuentes

Una administradora con miles de contadores ejecuta `SELECT` complejos. Sin índices revisados ni `EXPLAIN ANALYZE` periódico, el plan puede degradar silenciosamente.

**Recomendación:** Job mensual con `pg_stat_statements` review + alerts en Supabase advisors (`get_advisors`).

---

## 6. Eje E — Roadmap para robustecer como SaaS

> Estimaciones para un equipo de 2 ingenieros full-time. Ajustar a tu realidad.

### Fase 1 — Fundaciones (semanas 1-3)

- **Routing:** introducir `react-router-dom` v6 con rutas por dominio (A1). Eliminar `activeSection`.
- **Data layer:** instalar TanStack Query, migrar `useData` a hooks por entidad (`useClientes`, `useContadores`, `useLecturas`) (A4, D1).
- **Schemas:** Zod en `src/domain/agua/schemas.ts` (C6) + react-hook-form.
- **Tipos:** partir `types/index.ts` por dominio (A6). Generar `database.types.ts` desde Supabase (C11).

### Fase 2 — Dominio sólido (semanas 4-6)

- **Factura como agregado** con state machine (C3, C4).
- **Validación de lectura** (`>=` anterior, percentil 95) (C1).
- **RLS granular** por ruta/lector + tests SQL (C2).
- **Multi-tenancy real:** tabla `tenants`, planes, límites, status (C5).
- **Audit log** trigger-based (C9). **Soft delete** (C10).

### Fase 3 — UX y accesibilidad (semanas 7-9)

- Resolver el audit 2026-04-07 (B1, B2, B3, B6, B10).
- Adoptar Radix UI para Dialog/Menu/Tabs accesibles.
- Eliminar SweetAlert2, unificar feedback (B5).
- **PWA + offline real** para captura de lecturas (B8).
- **Storybook + sistema de design** (B9).
- Mensajes de error visibles + `aria-describedby` (B4).

### Fase 4 — Operaciones SaaS (semanas 10-12)

- Onboarding multi-tenant + Stripe billing (C5, integración).
- Feature flags por plan (PostHog) gating módulos premium (mapa, calidad, energía).
- Paginación + virtualización en todas las listas (D2).
- Code-splitting agresivo (D3): pdf, xlsx, sweetalert removed.
- Observabilidad con tagging consistente (D4) + dashboards de negocio (D5).
- Lighthouse CI + size-limit (D6).

### Fase 5 — Calidad continua

- Cobertura de tests: dominio 80% (C7), E2E móvil del flujo de campo.
- `axe-core` en CI (B1).
- Job mensual de Supabase advisors + EXPLAIN ANALYZE (D10).
- i18n con `react-intl` para abrir mercado regional (B13).

---

## 7. Tabla consolidada de hallazgos

| ID  | Eje | Sev. | Hallazgo                                              | Evidencia                                                                 | Fase |
|-----|-----|------|-------------------------------------------------------|---------------------------------------------------------------------------|------|
| A1  | Arq | 🔴   | Sin router; switch por `activeSection`                 | `src/App.tsx:474-782`                                                     | 1    |
| A2  | Arq | 🔴   | God-components (5 archivos > 700 líneas)               | `UnidadesSection.tsx:1286`, `RutasSection.tsx:1190`, `ContadoresSection.tsx:1077` | 1-3  |
| A3  | Arq | 🟠   | Props drilling masivo                                  | `src/App.tsx:474-782` (20+ props/Section)                                 | 1    |
| A4  | Arq | 🟠   | `useData.ts` monolítico (14 queries paralelas)         | `src/hooks/useData.ts:200-215`                                            | 1    |
| A5  | Arq | 🟠   | Duplicación de enums entre Sections                    | `ContadoresSection.tsx:27` vs `TarifasSection.tsx`                         | 1    |
| A6  | Arq | 🟡   | `types/index.ts` monolítico (3691 líneas)              | `src/types/index.ts`                                                      | 1    |
| A7  | Arq | 🟡   | `ErrorBoundary` redundante en cada rama                | `src/App.tsx:474-782`                                                     | 1    |
| A8  | Arq | 🟡   | `lazy()` sin prefetch                                  | `src/App.tsx:26-45`                                                       | 1    |
| A9  | Arq | 🟡   | `useAuth.ts` con responsabilidades mezcladas           | `src/hooks/useAuth.ts:30-77`                                              | 2    |
| A10 | Arq | 🔵   | Naming mezclado español/inglés sin convención          | múltiple                                                                  | 5    |
| B1  | UX  | 🔴   | Accesibilidad rota (ARIA, htmlFor, scope)              | `SECURITY_UX_AUDIT_2026-04-07.md`, `Sidebar.tsx`, formularios             | 3    |
| B2  | UX  | 🔴   | Tablas con scroll horizontal en móvil                  | audit + listas en Contadores/Cobros/Historial                              | 3    |
| B3  | UX  | 🔴   | Modales 760px en viewports 375px                       | `EditModal`                                                               | 3    |
| B4  | UX  | 🟠   | Validación silenciosa sin texto de error               | `LecturasSection.tsx`, `ContadoresSection.tsx`                            | 3    |
| B5  | UX  | 🟠   | Mezcla inconsistente sonner ↔ SweetAlert2              | `src/lib/toast.ts` + 30+ imports Swal                                     | 3    |
| B6  | UX  | 🟠   | Touch targets <44px                                    | audit 2026-04-07                                                          | 3    |
| B7  | UX  | 🟠   | Sin loading state al guardar lectura                   | `LecturasSection.tsx`                                                     | 3    |
| B8  | UX  | 🟠   | No es PWA / sin offline real                           | `public/` solo `favicon.svg`, `useOffline.ts`                              | 3    |
| B9  | UX  | 🟠   | Sin sistema de design unificado (inline vs tokens)     | `src/index.css` vs componentes                                            | 3    |
| B10 | UX  | 🟡   | Sidebar 256px en tablet                                | audit + `Sidebar.tsx`                                                     | 3    |
| B11 | UX  | 🟡   | Breadcrumbs ausentes                                   | layout                                                                    | 3    |
| B12 | UX  | 🟡   | Empty states inconsistentes                            | uso esporádico de `EmptyState.tsx`                                        | 3    |
| B13 | UX  | 🔵   | Sin i18n; textos hard-coded en español                 | global                                                                    | 5    |
| B14 | UX  | 🔵   | Iconografía mezclada (SVG + emojis)                    | `index.html`, `Sidebar.tsx`                                               | 5    |
| C1  | Dom | 🔴   | Sin validación lectura_actual ≥ anterior               | `src/lib/business.ts`, `src/lib/validation.ts`                            | 2    |
| C2  | Dom | 🔴   | RLS sin granularidad por ruta/lector                   | `src/lib/aguaPermissions.ts`, `supabase/migrations/*`                     | 2    |
| C3  | Dom | 🟠   | Lenguaje del dominio confuso (Registro vs Factura)     | `src/types/index.ts:45-69`                                                | 2    |
| C4  | Dom | 🟠   | Facturación sin estados ni mora/IVA                    | `src/lib/business.ts` (42 líneas)                                         | 2    |
| C5  | Dom | 🟠   | Multi-tenancy sin agregado `Tenant`                    | `src/types/index.ts:71-74`                                                | 2,4  |
| C6  | Dom | 🟠   | Validaciones dispersas, sin schema único               | `validation.ts` + lógica en componentes                                   | 1    |
| C7  | Dom | 🟠   | Cobertura de tests del dominio insuficiente            | `src/lib/__tests__/business.test.ts`                                      | 5    |
| C8  | Dom | 🟡   | `businessEnergia.ts` aislado, duplicación conceptual   | `src/lib/business.ts` vs `src/lib/businessEnergia.ts`                     | 2    |
| C9  | Dom | 🟡   | Sin auditoría de cambios                               | falta tabla `audit_log` genérica                                          | 2    |
| C10 | Dom | 🟡   | Sin soft-delete                                        | schema                                                                    | 2    |
| C11 | Dom | ⏳   | ~~Sin generación auto de tipos desde Supabase~~ — parcial PR #169 (workflow `types-drift.yml` advisory) | `.github/workflows/types-drift.yml` | 1    |
| D1  | Perf| 🟠   | Sin caché de queries / refetch on focus                | `useData.ts`                                                              | 1    |
| D2  | Perf| 🟠   | Sin paginación ni virtualización                       | `ContadoresSection`, `CobrosSection`, `historial`                         | 4    |
| D3  | Perf| 🟠   | Bundle sin code-splitting agresivo                     | `package.json` deps + `App.tsx:26-45`                                     | 4    |
| D4  | Obs | 🟡   | Sin tagging multi-tenant en Sentry/PostHog             | `src/lib/analytics.ts`, `src/lib/monitoring.ts`                           | 4    |
| D5  | Obs | 🟡   | Sin dashboards de negocio                              | falta panel KPI                                                           | 4    |
| D6  | Perf| 🟡   | Sin budgets de performance (LCP/INP/CLS)               | CI                                                                        | 4    |
| D7  | Obs | 🟡   | Logs sin estructura                                    | `console.log` repartido                                                   | 5    |
| D8  | Obs | 🟡   | Sin RUM ni medición de carga inicial                   | falta web-vitals                                                          | 4    |
| D9  | Perf| 🔵   | Imágenes sin compresión cliente                        | `SecureImage`, upload                                                     | 4    |
| D10 | Perf| 🔵   | Sin warming/EXPLAIN periódico                          | Supabase                                                                  | 5    |

---

## 8. Priorización para SaaS

**Bloqueantes para lanzar SaaS — resolver antes de cualquier go-to-market:**
A1 · A2 · B1 · B2 · B3 · C1 · C2 · C5 · D2

**Importantes para escalar más allá de los primeros 10 tenants:**
A3 · A4 · B4 · B5 · B6 · B7 · B8 · C3 · C4 · C6 · C7 · D1 · D3 · D4

**Mejoras de calidad continua (post-lanzamiento):**
A5 · A6 · A7 · A8 · A9 · A10 · B9 · B10 · B11 · B12 · B13 · B14 · C8 · C9 · C10 · C11 · D5 · D6 · D7 · D8 · D9 · D10

---

## 9. Cómo continuar

1. Validar este critique con stakeholders (producto, ingeniería, soporte).
2. Crear un epic por fase en GitHub (Fase 1 → Fase 5) y romper en issues atómicos enlazados a cada ID de hallazgo.
3. Aplicar primero la Fase 1 (fundaciones) para desbloquear el resto.
4. Reevaluar trimestralmente y reescribir este documento (versionar como `DESIGN_CRITIQUE_AGUA_YYYY-MM-DD.md`).
