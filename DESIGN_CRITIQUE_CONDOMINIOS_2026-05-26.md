# Design Critique — Módulo de Condominios

**Fecha:** 2026-05-26
**Alcance:** Arquitectura · UX/UI · Modelo de dominio · Performance · Observabilidad
**Objetivo:** Identificar puntos de mejora y trazar un camino para robustecer el módulo como **SaaS multi-tenant**.
**Repo:** `ventas-png/control-consumo-agua` · Versión actual: `2.0.0`
**Documentos relacionados:** `DESIGN_CRITIQUE_AGUA_2026-05-26.md`, `SECURITY_UX_AUDIT_2026-04-07.md`

---

## 1. Resumen ejecutivo

El módulo de condominios es un **mini-ERP de administración de propiedad horizontal** embebido en el mismo SPA. Cubre finanzas (cuotas, fondo de reserva, conciliación, presupuesto), operaciones (mantenimiento, bitácoras, inventario), seguridad (visitantes, accesos QR, rondas, incidentes), gobernanza (asambleas, votaciones, juntas) y comunidad (anuncios, encuestas, directorio, paquetes). Tiene un **portal de residente** separado con 9 tabs.

**Tamaño y madurez:**
- **191 tabs** en `src/components/condominios/tabs/`.
- **41 migraciones SQL** "fase1..fase43" + 8 adicionales de RBAC/RLS/storage.
- **59 entidades** de dominio en `src/types/index.ts`.
- **8 roles** de condominios bien segmentados (admin general, junta, finanzas, operaciones, seguridad, comunidad, recepción, visualizador).

**Diagnóstico:** el módulo es ambicioso y conceptualmente sólido (modelo claro, roles, lazy loading por tab), pero su escala expuso problemas técnicos y de UX que lo hacen frágil para operarlo como SaaS:

1. **Navegación inviable.** 191 tabs sin búsqueda, sin favoritos, sin recientes. Onboarding de un admin nuevo toma horas.
2. **Switch de 191 ramas + 100+ `useState`** en `CondominiosSection.tsx` (1.568 líneas). God-Section.
3. **189/191 tabs renderizan `<table>` HTML desnudas** con estilos inline. `DataTable` shared solo lo usan 2-3 tabs.
4. **Admin panel inusable en móvil/tablet.** Solo el portal de residente es responsive.
5. **RLS por `company_id` pero NO por `unidad_id`.** Un residente con permiso de "leer cuotas" puede ver cuotas de otras unidades.
6. **Sin CHECK constraints** en DB para reglas básicas (`monto > 0`, fechas válidas). Toda la validación vive en cliente.
7. **0 tests del dominio condominios.**
8. **Sin paginación / virtualización.** 5 años × 200 unidades = 60K cuotas en memoria.
9. **Cálculos críticos en cliente** (cuotas, conciliación, fondo reserva). No replicables en triggers.
10. **0 edge functions de condominios.** Sin mora automática, sin emails, sin pagos online, sin webhooks.

**Conteo de hallazgos en este documento:**

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 13 |
| 🟠 Alto    | 16 |
| 🟡 Medio   | 14 |
| 🔵 Bajo    | 4  |
| **Total** | **47** |

**Top 6 bloqueantes para lanzar SaaS:**
B1 (navegación 191 tabs) · A1+A2 (god-Section/god-tabs) · C1 (RLS por unidad) · C2 (sin CHECK constraints) · C3 (sin tests) · D1 (sin paginación).

---

## 2. Eje A — Arquitectura y código

### A1 · 🔴 Crítico — God-Section con switch de 191 ramas + 100+ `useState`

`src/components/condominios/CondominiosSection.tsx` (~1.568 líneas) orquesta los 191 tabs con un switch gigante de `activeTab === 'X'` (líneas aprox. 1.207-1.550) y mantiene 100+ `useState` (líneas 566-746), uno por tipo de entidad (cuotas, visitantes, amenidades, tickets, bitácora, etc.).

**Impacto:**
- Agregar un tab implica tocar el monolito.
- El árbol React re-renderiza ramas innecesarias.
- TypeScript/IDE rinden lento.
- Imposible testear de forma unitaria.

**Recomendación SaaS:** Sustituir por un **registry de tabs**:

```ts
type TabDef = {
  key: string
  label: string
  section: 'finanzas' | 'operaciones' | 'seguridad' | ...
  roles: CondominiosRole[]
  icon: ReactNode
  load: () => Promise<{ default: ComponentType }>
}

const REGISTRY: Record<string, TabDef> = { ... }
```

Render dinámico: `<Suspense><LazyTab def={REGISTRY[activeTab]} /></Suspense>`. Estado por tab vive dentro del tab (no en la Section).

---

### A2 · 🔴 Crítico — God-tabs

| Tab | Tamaño |
|-----|--------|
| `tabs/AmenidadesTab.tsx`    | ~132 KB |
| `tabs/VisitantesTab.tsx`    | ~101 KB |
| `tabs/SeguridadTab.tsx`     | ~73 KB  |
| `tabs/PortalRentasTab.tsx`  | ~57 KB  |
| `tabs/CuotasTab.tsx`        | ~1.200 líneas |
| `tabs/AsambleasTab.tsx`     | ~800 líneas  |

Cada uno cubre múltiples sub-dominios (Amenidades: catálogo + reservas + galería + tarifas + depósitos; Visitantes: pre-autorización + QR + entrada/salida + análisis). Sin separación de capas.

**Recomendación SaaS:** Romper cada tab en:
- `*Page.tsx` (orquestación).
- `use<Feature>()` hook por sub-dominio.
- `<FeatureForm />`, `<FeatureList />`, `<FeatureDetail />`, `<FeatureBulkActions />` (presentación).
- `domain/condominios/<feature>/api.ts` (acceso a datos).

---

### A3 · 🔴 Crítico — Cada tab abre Supabase a mano (189/191)

Salvo 1-2 tabs read-only que usan props, los demás importan `supabase` y hacen `from(...).select()` directamente, reimplementando loading/error/refetch en cada uno. Cualquier cambio de schema obliga a tocar N tabs.

**Recomendación SaaS:** Capa de datos por dominio:

```
src/domain/condominios/cuotas/api.ts        (queries Supabase)
src/domain/condominios/cuotas/hooks.ts      (useCuotas, useCuota, useCreateCuota)
src/domain/condominios/cuotas/schemas.ts    (Zod schemas compartidos)
```

Los tabs solo consumen los hooks. Esto desbloquea TanStack Query, optimistic updates, invalidación selectiva.

---

### A4 · 🟠 Alto — Sin TanStack Query / SWR

Cada tab reimplementa cache local, refetch tras mutación, manejo de loading. Sin invalidación cross-tab: si Tab A actualiza una cuota, Tab B la ve desactualizada hasta refrescar manual.

**Recomendación SaaS:** TanStack Query con `queryKey: ['condominios', projectId, 'cuotas']`. Mutaciones invalidan query keys.

---

### A5 · 🟠 Alto — 41 migraciones llamadas `fase1..fase43` sin semántica

Las migraciones de condominios viven en `supabase/migrations/20260420000001_condominios_mvp.sql` ... `20260420000040_condominios_fase43.sql`. Nadie sabe sin abrir cada archivo qué hace la fase 17 vs la fase 28. Difícil hacer rollback selectivo o auditar producción.

**Recomendación SaaS:** Renombrar con sufijos semánticos (`fase17_amenidades_reservas.sql`) y mantener un `supabase/migrations/README.md` con tabla de cambios por fase. Para futuras migraciones, usar siempre nombre semántico desde el inicio.

---

### A6 · 🟠 Alto — `CondominiosDashboard` duplica queries de la Section

`src/components/condominios/CondominiosDashboard.tsx` (252 líneas) carga KPIs agregados por su cuenta. Cuando el usuario entra a un tab desde la Section, las mismas tablas se vuelven a consultar.

**Recomendación SaaS:** Vista materializada `condominios_kpis` en Postgres refrescada cada N minutos. El Dashboard hace un solo `SELECT * FROM condominios_kpis WHERE project_id = $1`. Adicionalmente, TanStack Query comparte caché entre Dashboard y tabs.

---

### A7 · 🟡 Medio — Lazy sin prefetch

Los 191 tabs usan `React.lazy()` (bueno), pero sin prefetch al hover sobre el ítem del menú ni al `requestIdleCallback`. Cada primera entrada a un tab muestra un fallback genérico.

**Recomendación SaaS:** Prefetch on hover + idle preload de los 5 tabs más usados del usuario (basado en analytics).

---

### A8 · 🟡 Medio — `IntegracionAguaTab` acopla módulos sin contrato

`tabs/IntegracionAguaTab.tsx` lee directamente de la tabla `registros` (agua) y genera cuotas. Sin contrato explícito, sin event bus, sin función dedicada.

**Recomendación SaaS:** Edge function `generar-cuota-desde-lectura-agua` con input/output tipado (Zod). Frontend solo dispara la función; el resultado es atómico (transacción DB).

---

### A9 · 🟡 Medio — Cero edge functions de condominios

`supabase/functions/` no contiene nada específico de condominios. Toda la lógica corre en cliente: generación de cuotas, conciliación, balance de fondo, cálculo de mora.

**Impacto SaaS:** Lógica auditable solo si el cliente envía logs. Sin atomicidad transaccional para operaciones críticas. No hay cron de mora automática.

**Recomendación SaaS:** Edge functions para: generación masiva de cuotas, conciliación bancaria, marcar mora (cron), enviar avisos por email/WhatsApp, conciliación de pagos online (webhook Stripe/Wompi).

---

### A10 · 🔵 Bajo — Sub-componentes shared atrapados en `components/condominios/`

`FileUploader.tsx`, `ImageUploader.tsx`, `ImageGallery.tsx`, `RubrosBuilder.tsx` son reusables fuera del módulo (agua podría usar `FileUploader` para fotos de medidores), pero viven dentro de `components/condominios/`.

**Recomendación:** Promover a `src/components/shared/` y documentar.

---

## 3. Eje B — UX / UI / Accesibilidad

### B1 · 🔴 Crítico — Navegación entre 191 tabs sin búsqueda

`CondominiosSection.tsx` agrupa los 191 tabs en ~9 secciones (panel, finanzas, residentes, operaciones, instalaciones, seguridad, comunidad, administración, especiales) en una barra horizontal + sidebar de 200px. Sin búsqueda, sin favoritos, sin "tabs recientes", sin atajos de teclado.

**Impacto SaaS:** Onboarding inviable. Un admin nuevo toma horas en saber dónde está cada cosa. Soporte/CS no puede dirigir al usuario por URL.

**Recomendación SaaS:** Cmd+K (búsqueda global sobre el registry de tabs) + favoritos por usuario + tabs recientes + URLs deep-linkables. Reagrupar visualmente con descripciones cortas y tarjetas.

---

### B2 · 🔴 Crítico — 189/191 tabs con `<table>` HTML desnudas

`DataTable` (en `src/components/shared/`) solo lo usan ~2 tabs. Los 189 restantes renderizan `<table>` HTML con estilos inline y reimplementan paginación, ordenamiento, filtrado, selección múltiple. Inconsistencia masiva.

**Recomendación SaaS:** `<DataTable>` y `<ResponsiveTable>` como API pública del sistema. Storybook + migración progresiva de los 189 tabs. Hace falta un programa de "tabularización" liderado por un dev semanal.

---

### B3 · 🔴 Crítico — Accesibilidad rota

- `<label>` sin `htmlFor` (visto en `CuotasTab.tsx:464-495`, `AmenidadesTab.tsx`, etc.).
- Sin `role="tablist"` / `role="tab"` en la barra de tabs ni `aria-current`.
- Mezcla con SweetAlert2 (≥30 imports) que bloquea navegación por teclado y trampea screen readers.
- Inputs sin `aria-invalid` / `aria-describedby`.

**Impacto SaaS:** Bloqueante para clientes con WCAG en compliance (gobierno, propiedades comerciales, condominios corporativos).

**Recomendación SaaS:** axe-core en CI + adopción de Radix UI (Dialog, Tabs, DropdownMenu).

---

### B4 · 🔴 Crítico — Admin panel no responsive

El portal de residente sí lo es. El panel de administración (donde realmente se trabaja) no. Sidebar + tablas HTML + modales 760px = inusable en tablet/móvil.

**Recomendación SaaS:** El admin necesita responsive — los administradores reales hacen rondas con tablet. Sidebar colapsable, tablas tipo card-list en móvil, modales sheet-from-bottom.

---

### B5 · 🟠 Alto — Multi-condominio pasivo

`tabs/MultiCondominioTab.tsx` muestra "Actualmente solo hay 1 proyecto activo" en lugar de gestionar varios. `tabs/ProyectosCondominioTab.tsx` tiene un dropdown sin indicador visual de proyecto activo. Cambiar de condominio no cambia colores ni breadcrumbs.

**Recomendación SaaS:** Switcher de condominio en topbar tipo Slack workspace switcher. Color/banner por condominio. Estado global `currentCondominio` en `SessionContext`.

---

### B6 · 🟠 Alto — Sin indicador visual de contexto

Al moverse entre condominios o entre proyectos, nada en la UI confirma "estás trabajando en el Condominio X". Riesgo alto de operar sobre el condominio equivocado (crear cuota, banear visitante, aprobar fondo).

**Recomendación SaaS:** Banner persistente con nombre + color + logo del condominio activo. Confirmación antes de operaciones destructivas mostrando el nombre del proyecto.

---

### B7 · 🟠 Alto — Sin wizards de configuración inicial

Configurar un condominio nuevo requiere recorrer manualmente decenas de tabs (rubros, alícuotas, residentes, roles, amenidades, calendario asambleas, etc.). Sin guía.

**Recomendación SaaS:** Wizard "Configurar condominio" en 6-8 pasos. Checklist de onboarding (% completado) visible en dashboard hasta que esté al 100%.

---

### B8 · 🟠 Alto — Empty states pobres

`SinProyectoAsignado.tsx` (24 líneas) muestra un emoji + texto. Sin CTA, sin docs, sin contacto a soporte. Tabs vacíos (tickets sin tickets, amenidades sin reservas) no usan `EmptyState`.

**Recomendación SaaS:** Componente `<EmptyState>` con ilustración + descripción + CTA + link a docs. Adopción obligatoria.

---

### B9 · 🟠 Alto — Portal de residente subutilizado

`CondominiosClientPortal.tsx` solo lee cuotas de los últimos 2 años (`HACE_DOS_ANOS`) y tickets de 90 días. No incluye:
- Votaciones de asamblea (resultado y participación).
- Transparencia financiera (presupuesto, fondo reserva, gastos).
- Histórico completo de cuotas y pagos.
- Documentos de la junta (actas, contratos).
- Notificaciones push.

**Recomendación SaaS:** Es la cara que ven los residentes y donde se construye la confianza con la administración. Diferenciador competitivo claro.

---

### B10 · 🟡 Medio — Cada tab reinventa el patrón visual

Algunos tabs usan `TIPO_CFG` con tokens CSS (`BitacoraEventosTab`), otros estilos inline crudos, otros mezcla. Sin Storybook ni guía de patrones.

**Recomendación SaaS:** Storybook + patrón `<TabLayout header={...} filters={...} table={...} drawer={...} />` adoptado por todos.

---

### B11 · 🟡 Medio — `ExportacionTab` sin configuración

`tabs/ExportacionTab.tsx` exporta sin permitir elegir columnas, sin preview, sin filtros adicionales.

**Recomendación SaaS:** Modal de export con: entidad → rango fechas → columnas (checkbox) → formato → preview → descargar/enviar por email.

---

### B12 · 🟡 Medio — Comunicación fragmentada

`ComunicadosTab` (templates), `EnvioMasivoTab` (envío masivo), `CentroNotificacionesTab` (centro), `AvisosCobroTab` (avisos de cobro), `CampanasCobroTab` (campañas) — sin patrón unificado de envío multicanal.

**Recomendación SaaS:** Servicio `notificaciones` unificado: input (audiencia, canal: email/SMS/WhatsApp/push, template, datos), output (queue + tracking). Tabs construyen sobre el servicio, no reinventan.

---

### B13 · 🟡 Medio — Bitácoras dispersas

Hay `BitacoraGuardiaTab`, `BitacoraAccionesTab`, `BitacoraActividadTab`, `BitacoraEventosTab`, `BitacoraManto.tsx`, `LibroNovedadesTab`. Múltiples bitácoras sin un patrón común ni timeline unificado.

**Recomendación SaaS:** Componente `<TimelineBitacora>` reutilizable + tabla `eventos_condominio` con tipo discriminado.

---

### B14 · 🔵 Bajo — Sin i18n

Igual que agua, todos los textos en español hard-coded.

---

## 4. Eje C — Modelo de dominio y datos

### C1 · 🔴 Crítico — RLS sin granularidad por `unidad_id` / rol

Las policies de `cuotas_condominio`, `tickets_mantenimiento`, `visitantes`, `infracciones` filtran por `company_id` (`USING (company_id = get_my_company_id() OR is_super_admin())`). Pero **no filtran por unidad** para residentes — un usuario con permiso de "ver cuotas" puede ver las de cualquier unidad del proyecto.

**Impacto SaaS:** Brecha de privacidad. Si el portal residente expone una query mal escrita, un residente puede leer cuotas, tickets, visitantes ajenos.

**Recomendación SaaS:** Policies row-level adicionales. Por ejemplo en `cuotas_condominio`:

```sql
CREATE POLICY cuotas_residente_select ON cuotas_condominio
  FOR SELECT USING (
    is_admin_or_finanzas()
    OR unidad_id IN (SELECT unidad_id FROM unidad_users WHERE user_id = auth.uid())
  );
```

Repetir en todas las tablas con `unidad_id`. Tests SQL con pgTAP que validen aislamiento.

---

### C2 · 🔴 Crítico — Sin CHECK constraints en DB

Reglas básicas dependen de validación cliente:
- `cuota.monto > 0`.
- `cuota.fecha_vencimiento >= created_at`.
- `visitante.hora_salida >= hora_entrada`.
- `asamblea.fecha >= now()`.
- `reserva.fecha_fin > fecha_inicio`.
- `mascota.fecha_vacuna < now()`.

Si un cliente con bug o malicia inserta data inválida, llega a DB.

**Recomendación SaaS:** Migración `condominios_fase44_constraints.sql` con `CHECK` constraints en cada tabla. Sweep guiado por las entidades del módulo.

---

### C3 · 🔴 Crítico — Cero tests del dominio condominios

`find src -name "*.test.*" -path "*condominios*"` → 0 resultados. Sin cobertura de:
- Generación de cuotas (alícuota, rubros, batch).
- Conciliación de pagos (tolerancia, parcial, exceso).
- Cálculo de mora.
- Balance del fondo de reserva.
- Votaciones (quorum, conteo).
- Workflow de aprobación.

**Recomendación SaaS:** Pirámide:
- **Unit (Vitest)**: dominio puro (calcular cuota, validar reserva, transicionar estado) — target 70%.
- **Integration**: hooks con MSW (mockeo Supabase).
- **E2E (Playwright)**: alta de residente → cuota → pago → conciliación → entrega de paquete, en viewport tablet.

---

### C4 · 🟠 Alto — Lógica de negocio en cliente

`GeneracionCuotasTab.tsx` calcula monto = alícuota × rubros en JS. `ConciliacionCobrosTab.tsx` resta diferencias con tolerancia 0.01 en cliente. `FondoReservaTab.tsx` calcula balance = aporte − retiro + ajuste en JS.

**Riesgo:** Lógica no replicable en triggers/reportes. Si el cliente tiene bug, datos quedan inconsistentes. Los logs (`generacion_cuotas_log`, `conciliacion_cobros_log`) registran resultados, no replican el cálculo.

**Recomendación SaaS:** Mover cálculos a edge functions (lógica única) y/o funciones Postgres + triggers. Cliente solo dispara, no calcula.

---

### C5 · 🟠 Alto — Multi-tenancy frágil (mismo hallazgo que agua)

`interface Empresa { id?: string; nombre?: string }` (`src/types/index.ts:71-74`). Sin agregado `Tenant` con plan, límites, status, billing, feature flags. Sin separación de "Empresa administradora" vs "Condominio gestionado".

**Recomendación SaaS:** Modelar:
- `Tenant` (la empresa administradora — quien paga el SaaS).
- `Condominio` (el activo gestionado por el Tenant).
- Un Tenant gestiona N condominios. Cada plan limita N condominios, N unidades totales, N usuarios.

---

### C6 · 🟠 Alto — Sin automatización de mora

`cuota.estado = 'pendiente'` no transiciona a `'moroso'` automáticamente. Sin job/cron/trigger/edge function que recalcule mora ni que aplique intereses.

**Recomendación SaaS:** Edge function programada (Supabase Scheduled Functions o pg_cron):

```sql
UPDATE cuotas_condominio
   SET estado = 'moroso',
       interes_acumulado = calcular_interes(monto, dias_mora)
 WHERE estado = 'pendiente' AND fecha_vencimiento < now();
```

Con auditoría en `cuotas_eventos`.

---

### C7 · 🟠 Alto — FK débiles a `users`

`created_by`, `asignado_a`, `aprobado_por`, `cerrado_por` referencian users sin constraint. Si se borra un user, queda orfandad silenciosa.

**Recomendación SaaS:** `REFERENCES auth.users(id) ON DELETE SET NULL` (o `RESTRICT` si la auditoría es legalmente requerida).

---

### C8 · 🟠 Alto — Workflow de aprobación incompleto

`fondo_reserva` tiene estado `pendiente`/`aprobado`/`rechazado` pero cualquier usuario con permiso de edit puede marcarlo como `aprobado` sin tabla de aprobadores asignados.

**Recomendación SaaS:** Tabla `aprobaciones_pendientes` (entity_type, entity_id, aprobador_role, aprobador_user_id NULL, estado, fecha) + state machine. Hasta que N aprobadores válidos firmen, la entidad no cambia de estado. Auditoría completa.

---

### C9 · 🟠 Alto — `src/types/index.ts` monolítico (mismo problema que agua)

59 entidades de condominios viven en el mismo archivo de 3.691 líneas compartido con agua y otros módulos.

**Recomendación:** Partir por dominio (`src/types/condominios/`).

---

### C10 · 🟠 Alto — Storage bucket `condominios-media` sin granularidad

`supabase/migrations/20260516000003_security_private_condominios_media_bucket.sql` lo hace privado (bien) pero las policies (`cond_media_select|insert|update|delete`) abren a todo `authenticated`. Sin scoping por `unidad_id`/rol.

**Recomendación SaaS:** Estructura de objects `condominios-media/{project_id}/{unidad_id}/...` + storage policies que validen:

```sql
USING (
  is_admin_or_seguridad()
  OR (storage.foldername(name))[2] IN (
    SELECT unidad_id::text FROM unidad_users WHERE user_id = auth.uid()
  )
)
```

---

### C11 · 🟡 Medio — Sin auditoría transaccional genérica

Existen logs específicos (`generacion_cuotas_log`, `conciliacion_cobros_log`) pero no hay `audit_log` genérico que capture cambios en cualquier tabla relevante (asambleas, votos, infracciones, fondo reserva).

**Recomendación SaaS:** Trigger genérico `audit_changes()` aplicado a tablas críticas. Tabla `audit_log` append-only con `entity`, `entity_id`, `user_id`, `action`, `before`, `after`, `ts`.

---

### C12 · 🟡 Medio — Migraciones `fase1..fase43` sin documentación

Difícil hacer rollback selectivo, difícil auditar producción, difícil onboarding de devs.

**Recomendación:** README + sufijos semánticos (ver A5).

---

### C13 · 🟡 Medio — Sin versionado / historial de configuraciones

Cambiar la alícuota o la tarifa no deja rastro retroactivo. Las cuotas pasadas se ven con la alícuota nueva si se recalculan.

**Recomendación SaaS:** Snapshot del valor al crear la cuota (denormalizar `alicuota_pct_aplicada` en la cuota). Tablas `*_history` para configuraciones cambiantes.

---

### C14 · 🔵 Bajo — Sin generación auto de tipos desde Supabase

Igual que agua: `generate_typescript_types` MCP disponible pero no usado.

---

## 5. Eje D — Performance y observabilidad

### D1 · 🔴 Crítico — Sin paginación / virtualización

Tabs de cuotas, visitantes, tickets, paquetes, infracciones, residentes traen todos los registros (con `.limit(200)` en algunos casos como tope, sin UI de paginación). Un condominio con 5 años de historia × 200 unidades = 60.000 filas. Browsers se caen.

**Recomendación SaaS:** Cursor pagination Supabase (`.range()` con `next_cursor`) + `@tanstack/react-virtual`. Filtros server-side con índices ya existentes en `(project_id, periodo, estado)`.

---

### D2 · 🟠 Alto — Bundle pesado por `CondominiosSection`

`CondominiosSection.tsx` (1.568 líneas + 100+ `useState` + 191 imports lazy) entra al chunk principal del módulo. Aunque los tabs hijos son lazy, el shell mismo es enorme.

**Recomendación SaaS:** Tras refactor del registry (A1), `CondominiosSection` queda en ~300 líneas. Lazy también de `CondominiosSection` desde `App.tsx`.

---

### D3 · 🟠 Alto — Sin caché de queries

Cambiar de tab y volver re-fetchea desde cero. Tras una mutación en Tab A, Tab B no se entera.

**Recomendación SaaS:** TanStack Query con invalidación selectiva por `queryKey`.

---

### D4 · 🟠 Alto — Sentry/PostHog sin tagging multi-tenant

Mismo problema que agua: sin `tenant_id`, `condominio_id`, `role` consistentes en eventos. Imposible filtrar "errores del condominio X" o "% de éxito de pago por plan".

**Recomendación SaaS:** Inicialización centralizada con `setUser` + `setTag` desde el `SessionContext`.

---

### D5 · 🟡 Medio — Sin dashboards de negocio

Falta panel ejecutivo cross-condominio para la administradora: % cobranza por proyecto, salud financiera (presupuesto vs gasto, fondo reserva vs objetivo), tickets abiertos, ocupación amenidades, asambleas próximas.

**Recomendación SaaS:** Vistas materializadas + PostHog dashboards + sección "Mis Condominios" para la administradora.

---

### D6 · 🟡 Medio — Imágenes sin compresión cliente

Fotos de amenidades, evidencias de bitácora, actas escaneadas suben en tamaño original. Bucket `condominios-media` infla rápido + lectura lenta para residentes en 3G/4G.

**Recomendación SaaS:** `browser-image-compression` antes de subir (1280px lado mayor, target 200KB). Bucket de thumbnails generado por edge function.

---

### D7 · 🟡 Medio — Sin presupuestos de performance ni RUM

Mismo problema que agua: sin Lighthouse CI, sin web-vitals, sin alertas de regresión.

---

### D8 · 🟡 Medio — Sin code-splitting agresivo de deps pesadas

`chart.js`, `jspdf`, `exceljs`, `sweetalert2`, `leaflet` cargan sin import dinámico. `exportUtils.ts` debería ser lazy.

---

### D9 · 🔵 Bajo — Sin warming / EXPLAIN periódico

Mismo problema que agua.

---

## 6. Eje E — Roadmap para robustecer como SaaS

> Estimaciones para un equipo de 2 ingenieros full-time. Marca `[+]` cuando el hallazgo se solapa con el critique de agua (`DESIGN_CRITIQUE_AGUA_2026-05-26.md`) — esos esfuerzos resuelven ambos módulos a la vez.

### Fase 1 — Fundaciones (semanas 1-3)

- `[+]` Router por dominio (`/condominios/:proyecto/finanzas/cuotas`, `/condominios/:proyecto/seguridad/visitantes`) (A1).
- Reemplazar el switch de 191 ramas por **registry de tabs** (A1).
- `[+]` TanStack Query + capa de datos por dominio (`src/domain/condominios/`) (A3, A4, D3).
- `[+]` Zod schemas + react-hook-form (C2 parcial — validación cliente uniforme).
- Cmd+K búsqueda global sobre el registry (B1).
- `[+]` Partir `types/index.ts` por dominio (C9).

### Fase 2 — Dominio sólido (semanas 4-6)

- **CHECK constraints** en DB (`condominios_fase44_constraints.sql`) (C2).
- **RLS row-level** por `unidad_id` y rol — tests pgTAP (C1).
- Cron / edge function de **mora automática** (C6) + storage policies por unidad (C10).
- Mover **cálculos críticos** (cuota, conciliación, fondo) a edge functions o funciones Postgres (C4, A9).
- Workflow de **aprobaciones reales** con tabla `aprobaciones_pendientes` + state machine (C8).
- FK `created_by/asignado_a` con `ON DELETE SET NULL` (C7).
- `[+]` Audit log genérico trigger-based (C11).
- `[+]` Soft delete + `deleted_at`.
- Snapshot de configuraciones en momento de creación (C13).
- `Tenant` (administradora) + `Condominio` (activo gestionado) (C5).

### Fase 3 — UX y accesibilidad (semanas 7-9)

- `[+]` Sistema de diseño + Storybook (B10).
- Migrar 189 tabs a `<DataTable>` / `<ResponsiveTable>` shared (B2).
- `[+]` Accesibilidad: `htmlFor`, `role="tablist"`, `aria-*`. axe-core en CI (B3).
- **Admin responsive** para tablet/móvil (B4).
- `[+]` Reemplazar SweetAlert2 por Radix Dialog (B3).
- Switcher de condominio en topbar + banner contextual (B5, B6).
- Wizards de configuración inicial + checklist de onboarding (B7).
- `<EmptyState>` obligatorio (B8).
- **Portal residente ampliado**: votaciones, transparencia financiera, histórico completo, push notifications (B9).
- `<TimelineBitacora>` unificado (B13).
- `ExportacionTab` con preview + columnas (B11).
- Servicio `notificaciones` unificado multicanal (B12).

### Fase 4 — Operaciones SaaS (semanas 10-13)

- **Multi-condominio real** (cambio de contexto sin recarga, dashboard consolidado para administradora) (B5).
- **Edge functions**: mora cron (C6), avisos de cuota por email/WhatsApp, recordatorios de asamblea, conciliación automática vía webhook Stripe/Wompi/Recurrente (A9).
- **Pagos online** integrados (Stripe/Wompi/Recurrente según LATAM).
- `[+]` Feature flags por plan (gating de módulos premium: asamblea digital, BI ejecutivo, integración bancaria).
- `[+]` Tagging multi-tenant en Sentry/PostHog (D4).
- **Dashboards de negocio** ejecutivos por administradora (D5).
- **Paginación server-side + virtualización** en todas las tablas grandes (D1).
- `[+]` Code-splitting agresivo + compresión de imágenes (D6, D8).

### Fase 5 — Calidad continua

- Cobertura de tests del dominio condominios — target 60% (C3).
- E2E Playwright: alta residente → cuota → pago → conciliación → paquete, en viewport tablet.
- `[+]` axe-core en CI.
- `[+]` `get_advisors` Supabase mensual + EXPLAIN ANALYZE.
- Renombrar migraciones `fase1..fase43` + README (A5, C12).
- `[+]` i18n.
- `[+]` Generación automática de tipos desde Supabase (C14).

---

## 7. Tabla consolidada de hallazgos

| ID  | Eje | Sev. | Hallazgo                                                  | Evidencia                                                                 | Fase |
|-----|-----|------|------------------------------------------------------------|---------------------------------------------------------------------------|------|
| A1  | Arq | 🔴   | God-Section con switch de 191 ramas + 100+ `useState`      | `src/components/condominios/CondominiosSection.tsx` (~1.568 líneas)       | 1    |
| A2  | Arq | 🔴   | God-tabs (>50KB cada uno)                                  | `AmenidadesTab.tsx` (132KB), `VisitantesTab.tsx` (101KB), `SeguridadTab.tsx` (73KB), `PortalRentasTab.tsx` (57KB) | 1-3  |
| A3  | Arq | 🔴   | 189/191 tabs abren Supabase a mano                         | tabs/*                                                                    | 1    |
| A4  | Arq | 🟠   | Sin TanStack Query / SWR                                   | tabs/*                                                                    | 1    |
| A5  | Arq | 🟠   | 41 migraciones llamadas `fase1..fase43` sin semántica      | `supabase/migrations/20260420000001-40_condominios_fase*.sql`              | 5    |
| A6  | Arq | 🟠   | `CondominiosDashboard` duplica queries                     | `src/components/condominios/CondominiosDashboard.tsx` (252 líneas)        | 2    |
| A7  | Arq | 🟡   | Lazy sin prefetch                                          | `CondominiosSection.tsx` líneas 49-228                                    | 1    |
| A8  | Arq | 🟡   | `IntegracionAguaTab` acopla sin contrato                   | `tabs/IntegracionAguaTab.tsx`                                             | 2    |
| A9  | Arq | 🟡   | Cero edge functions de condominios                         | `supabase/functions/`                                                     | 4    |
| A10 | Arq | 🔵   | Sub-componentes shared atrapados                           | `FileUploader.tsx`, `ImageUploader.tsx`, `RubrosBuilder.tsx`              | 5    |
| B1  | UX  | 🔴   | 191 tabs sin búsqueda/favoritos/recientes                  | `CondominiosSection.tsx`                                                  | 1    |
| B2  | UX  | 🔴   | 189/191 tabs con `<table>` HTML desnudas                   | tabs/*                                                                    | 3    |
| B3  | UX  | 🔴   | Accesibilidad rota (htmlFor, role tablist, SweetAlert2)    | `CuotasTab.tsx:464-495`, `AmenidadesTab.tsx`, otros                       | 3    |
| B4  | UX  | 🔴   | Admin panel no responsive                                  | `CondominiosSection.tsx`, tabs/*                                          | 3    |
| B5  | UX  | 🟠   | Multi-condominio pasivo                                    | `tabs/MultiCondominioTab.tsx`, `tabs/ProyectosCondominioTab.tsx`          | 4    |
| B6  | UX  | 🟠   | Sin indicador visual de contexto activo                    | layout                                                                    | 3    |
| B7  | UX  | 🟠   | Sin wizards de configuración inicial                       | onboarding                                                                | 3    |
| B8  | UX  | 🟠   | Empty states pobres                                        | `SinProyectoAsignado.tsx` (24 líneas), tabs vacíos                        | 3    |
| B9  | UX  | 🟠   | Portal residente subutilizado                              | `src/components/portal/CondominiosClientPortal.tsx` (líneas 128-135)      | 3    |
| B10 | UX  | 🟡   | Cada tab reinventa patrón visual                           | tabs/* (mezcla TIPO_CFG vs inline)                                        | 3    |
| B11 | UX  | 🟡   | `ExportacionTab` sin configuración                         | `tabs/ExportacionTab.tsx`                                                 | 3    |
| B12 | UX  | 🟡   | Comunicación fragmentada                                   | `ComunicadosTab`, `EnvioMasivoTab`, `CentroNotificacionesTab`, `AvisosCobroTab`, `CampanasCobroTab` | 3    |
| B13 | UX  | 🟡   | Bitácoras dispersas sin timeline unificado                 | `BitacoraGuardiaTab`, `BitacoraAccionesTab`, `BitacoraActividadTab`, `BitacoraEventosTab`, `BitacoraManto`, `LibroNovedadesTab` | 3    |
| B14 | UX  | 🔵   | Sin i18n                                                   | global                                                                    | 5    |
| C1  | Dom | 🔴   | RLS sin granularidad por `unidad_id`/rol                   | `supabase/migrations/20260518000010_rbac_rls_condominios_phase1.sql`      | 2    |
| C2  | Dom | 🔴   | Sin CHECK constraints en DB                                | migraciones `condominios_fase*`                                           | 2    |
| C3  | Dom | 🔴   | Cero tests del dominio condominios                         | `src/components/condominios/` (sin `*.test.*`)                            | 5    |
| C4  | Dom | 🟠   | Lógica de negocio en cliente                               | `GeneracionCuotasTab.tsx`, `ConciliacionCobrosTab.tsx`, `FondoReservaTab.tsx` | 2    |
| C5  | Dom | 🟠   | Multi-tenancy frágil (sin `Tenant`)                        | `src/types/index.ts:71-74`                                                | 2    |
| C6  | Dom | 🟠   | Sin automatización de mora                                 | sin cron / edge function                                                  | 2,4  |
| C7  | Dom | 🟠   | FK débiles a `users`                                       | tablas `cuotas_condominio`, `tickets_mantenimiento`, etc.                 | 2    |
| C8  | Dom | 🟠   | Workflow de aprobación incompleto                          | `tabs/FondoReservaTab.tsx`                                                | 2    |
| C9  | Dom | 🟠   | 59 entidades en `types/index.ts` monolítico                | `src/types/index.ts`                                                      | 1    |
| C10 | Dom | 🟠   | Storage `condominios-media` sin scoping por unidad         | `supabase/migrations/20260516000003_security_private_condominios_media_bucket.sql` | 2 |
| C11 | Dom | 🟡   | Sin audit log genérico                                     | solo `generacion_cuotas_log`, `conciliacion_cobros_log`                   | 2    |
| C12 | Dom | 🟡   | Migraciones `fase1..fase43` sin documentación              | `supabase/migrations/`                                                    | 5    |
| C13 | Dom | 🟡   | Sin versionado/historial de configuraciones                | tarifas/alícuotas mutan in-place                                          | 2    |
| C14 | Dom | 🔵   | Sin generación auto de tipos desde Supabase                | `types/index.ts` manual                                                   | 5    |
| D1  | Perf| 🔴   | Sin paginación / virtualización                            | `CuotasTab`, `VisitantesTab`, `TicketsTab`, `PaquetesTab`, etc.           | 4    |
| D2  | Perf| 🟠   | Bundle pesado por `CondominiosSection`                     | `CondominiosSection.tsx` (1.568 líneas + 191 lazy imports)                | 1    |
| D3  | Perf| 🟠   | Sin caché de queries                                       | tabs/*                                                                    | 1    |
| D4  | Obs | 🟠   | Sentry/PostHog sin tagging multi-tenant                    | `src/lib/analytics.ts`, `src/lib/monitoring.ts`                           | 4    |
| D5  | Obs | 🟡   | Sin dashboards de negocio                                  | falta panel ejecutivo                                                     | 4    |
| D6  | Perf| 🟡   | Imágenes sin compresión cliente                            | `ImageUploader.tsx`, bucket `condominios-media`                           | 4    |
| D7  | Perf| 🟡   | Sin presupuestos de performance ni RUM                     | CI                                                                        | 5    |
| D8  | Perf| 🟡   | Sin code-splitting agresivo de deps pesadas                | `package.json`                                                            | 4    |
| D9  | Perf| 🔵   | Sin warming / EXPLAIN periódico                            | Supabase                                                                  | 5    |

---

## 8. Priorización para SaaS

**Bloqueantes para lanzar SaaS — no negociables antes de go-to-market:**
A1 · A2 · A3 · B1 · B2 · B3 · B4 · C1 · C2 · C3 · C5 · D1

**Importantes para escalar más allá de los primeros 10 tenants:**
A4 · A5 · A6 · A9 · B5 · B6 · B7 · B8 · B9 · C4 · C6 · C7 · C8 · C9 · C10 · D2 · D3 · D4

**Mejoras de calidad continua:**
A7 · A8 · A10 · B10 · B11 · B12 · B13 · B14 · C11 · C12 · C13 · C14 · D5 · D6 · D7 · D8 · D9

---

## 9. Cómo continuar

1. Cruzar este critique con `DESIGN_CRITIQUE_AGUA_2026-05-26.md` para identificar **trabajo compartido**. Los hallazgos marcados `[+]` en la sección "Roadmap" se resuelven una vez y benefician a ambos módulos.
2. Crear epics por fase en GitHub y romper en issues atómicos referenciando IDs de hallazgo (`A1`, `B2`, etc.).
3. Aplicar primero la Fase 1 (fundaciones) — es prerequisito de las demás.
4. Decisión estratégica: ¿priorizar **lanzar SaaS de condominios** (más superficie, más valor por tenant) o **estabilizar agua primero** (menos complejidad)? El critique aporta evidencia para decidir.
5. Re-evaluar trimestralmente y versionar (`DESIGN_CRITIQUE_CONDOMINIOS_YYYY-MM-DD.md`).
