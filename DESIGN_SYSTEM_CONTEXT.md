# Contexto de UI / Design System — AdministraTodo

> **Cómo usar este documento.** Pégalo completo en ChatGPT, Gemini o Claude como
> primer mensaje, y luego pide lo que quieras (ej.: *"Rediseña esta KpiCard para
> que sea más atractiva"*, *"Propón un nuevo layout para el dashboard"*,
> *"Mejora la jerarquía visual del portal del residente"*). La IA tendrá todo el
> contexto necesario para devolver **código que encaja con la app real** sin
> romper el sistema de diseño.

---

## 0. Instrucciones para la IA que lee esto

Eres un diseñador de producto / front-end senior. Vas a sugerir mejoras visuales
para una app SaaS ya existente. **Respeta estas reglas o el código no servirá:**

1. **NO uses Tailwind, CSS Modules, styled-components, MUI, Chakra ni shadcn/ui.**
   La app **no** tiene ninguna de esas dependencias. El estilado se hace con
   **estilos inline en JSX** (`style={{ ... }}`) usando **CSS custom properties**
   (`var(--at-*)`). Cualquier color, fondo o borde debe salir de los tokens de la
   sección 3, nunca un hex hardcodeado nuevo.
2. **Soporta modo claro y oscuro automáticamente.** Como todo usa `var(--at-*)`,
   si te ciñes a los tokens el dark mode "simplemente funciona". No escribas
   colores fijos como `#fff` o `#000` salvo texto sobre fondos de marca saturados.
3. **Mobile-first y accesible.** Mínimo 44px de área táctil en controles,
   `font-size: 16px` en inputs (evita autozoom en iOS), foco visible, roles ARIA.
4. **Reutiliza los componentes compartidos** (sección 4) antes de inventar nuevos.
5. **Stack:** React 18 + TypeScript (sin clases, solo function components y hooks).
6. **Entrega:** componente(s) `.tsx` completos y pegables + una explicación corta
   de qué cambiaste y por qué mejora la UX. Si propones tokens nuevos, decláralos
   como variables CSS `--at-*` para añadir a `src/index.css`.

---

## 1. El producto

**AdministraTodo** es una plataforma SaaS todo-en-uno para administradoras de
condominios, juntas de vecinos y operadoras de agua. Módulos principales:

- **Control de agua:** contadores/medidores, lecturas, rutas de lectura, tarifas,
  consumo, calidad del agua.
- **Condominios:** unidades, clientes/residentes, cuotas, cobros, áreas comunes,
  comunicación, tickets.
- **Plataforma:** dashboard de administración, multi-empresa (multi-tenant),
  branding por empresa, portal del residente, panel de superadmin, facturación.

Audiencia: administradores profesionales (uso intensivo de escritorio, tablas y
reportes) **y** residentes/vecinos (uso casual, principalmente móvil). Idioma
**español (LatAm)**. Moneda frecuente: Quetzal (Q) / USD.

Tono de marca: **profesional, confiable y natural/orgánico** — la paleta evoca
agua, vegetación y sostenibilidad (verdes bosque + tierra/terracota sobre crema).

---

## 2. Stack técnico

| Área | Tecnología |
|---|---|
| Framework | React 18 + TypeScript |
| Bundler | Vite 5 |
| Routing | react-router-dom 6 |
| Datos / estado servidor | @tanstack/react-query 5 + Supabase (Postgres) |
| Primitivos accesibles | Radix UI (`dialog`, `alert-dialog`, `toast`) |
| Notificaciones | Sonner (toasts) |
| Gráficas | Chart.js 4 |
| Mapas | Leaflet |
| Validación | Zod |
| Documentación de componentes | Storybook 8 |
| PWA | vite-plugin-pwa (instalable, offline) |
| Observabilidad | Sentry + PostHog |

**Importante:** **no hay framework de CSS**. No Tailwind, no CSS-in-JS. El estilo
vive en: (a) tokens y reglas globales en `src/index.css`, (b) algunas hojas
puntuales (`src/styles/runtime.css`, `*.css` por feature) para keyframes y
responsive, y (c) **estilos inline** en cada componente `.tsx`.

---

## 3. Design tokens (la fuente de verdad del estilo)

Definidos en `src/index.css` como variables CSS en `:root`, con override completo
para dark mode (vía `@media (prefers-color-scheme: dark)` y `[data-theme="dark"]`).
**Usa siempre el token, nunca el hex literal.**

### 3.1 Colores — modo claro

```css
/* Superficies y fondo */
--at-bg:          #F2EFE7;  /* fondo de la app (crema) */
--at-surface:     #FFFFFF;  /* tarjetas, paneles */
--at-surface-2:   #FAF7EF;  /* superficie alterna / hover suave */

/* Texto (tinta) — de más oscuro a más claro */
--at-ink:         #15291F;  /* texto principal */
--at-ink-2:       #3E5A4C;  /* texto secundario */
--at-ink-3:       #7E9389;  /* texto terciario / placeholders / hints */

/* Líneas / bordes */
--at-line:        #E1DDD0;  /* borde sutil */
--at-line-strong: #C7C2B0;  /* borde marcado */

/* Marca primaria (verde bosque) */
--at-primary:        #1B3B36;
--at-primary-hover:  #102622;
--at-primary-soft:   #D9E2DC;
--at-primary-2:      #2F5D4F;
--at-primary-tint:   #EEF2EC;
--at-primary-mint:   #9CC6B6;
--at-primary-mint-2: #7FB29F;

/* Acento (terracota / tierra) */
--at-accent:        #B96A3F;
--at-accent-hover:  #9C5733;
--at-accent-2:      #577B69;  /* verde salvia secundario */
--at-accent-light:  #CE8A63;
--at-accent-soft:   #E6CDBB;
--at-accent-tint:   #F4EBE3;

/* Chips / superficies decorativas */
--at-chip:        #EAE6D8;

/* Nav rail (barra lateral) — OSCURA y FIJA en ambos temas */
--at-nav-bg:  #102622;
--at-nav-ink: #ECEFE8;
```

### 3.2 Colores semánticos de estado (claro)

```css
--at-success: #16a34a;  --at-success-tint: #dcfce7;  --at-success-border: #bbf7d0;  --at-success-strong: #15803d;
--at-warning: #d97706;  --at-warning-tint: #fef3c7;  --at-warning-border: #fde68a;  --at-warning-strong: #92400e;
--at-danger:  #ef4444;  --at-danger-tint:  #fef2f2;  --at-danger-border:  #fecaca;  --at-danger-strong:  #dc2626;
--at-info:    #2563eb;  --at-info-tint:    #dbeafe;  --at-info-border:    #bfdbfe;  --at-info-strong:    #1d4ed8;
--at-on-status: #ffffff; /* texto sobre fondos de estado saturados */
```

Patrón de uso: **badge/tinte suave** = `tint` (fondo) + color base (texto) +
`border`. **Botón/badge sólido** = color base (fondo) + `--at-on-status` (texto).

### 3.3 Colores — modo oscuro (override)

En dark, los mismos tokens cambian de valor. Resumen:

```css
--at-bg: #0B1410; --at-surface: #11201A; --at-surface-2: #172821;
--at-ink: #ECEFE8; --at-ink-2: #B7C4BB; --at-ink-3: #8B9A91;
--at-line: #28352D; --at-line-strong: #3A4A40;
--at-primary: #5E9D8A; --at-primary-hover: #76B3A1; --at-primary-tint: #16241D;
--at-accent: #C8865C; --at-accent-2: #79A18E; --at-chip: #1E2A23;
/* estados (versiones más claras para contraste sobre fondo oscuro) */
--at-success: #4ade80; --at-warning: #fbbf24; --at-danger: #f87171; --at-info: #60a5fa;
--at-on-status: #0B1410;
/* nav rail NO cambia: sigue oscuro */
```

> Implicación de diseño: en claro, `--at-primary` es **oscuro** (verde bosque);
> en oscuro es **claro** (verde menta). Por eso nunca asumas que "primary = oscuro".
> Confía en los tokens de tinta para el contraste de texto.

### 3.4 Tipografía

```css
--at-font-sans: "Schibsted Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
--at-font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

- **Schibsted Grotesk** (display + cuerpo), **variable 400–900**. Self-hosted.
- **JetBrains Mono** (números, IDs, datos tabulares), variable 400–600.
- Pesos en uso: 400 (cuerpo), 500–600 (labels/énfasis), 700 (títulos/valores),
  800 (KPIs, headings de tarjeta), 900 (hero ocasional).
- Escala de tamaños observada (px): `11` (labels/uppercase, badges sm) · `12`
  (hints) · `13` (cuerpo pequeño, botón sm) · `14` (cuerpo, inputs, botón md) ·
  `15` (botón lg) · `16` (título de empty state; **mínimo en inputs móviles**) ·
  `21–22` (títulos de tarjeta, valor de StatTile) · `28` (valor de KpiCard).
- Labels de formulario suelen ir en **uppercase + `letter-spacing: 0.04em`**.

### 3.5 Forma, elevación y movimiento (valores reales en uso)

- **Radios:** botón `9px` · inputs `8px` · StatTile `12px` · tarjetas `12–16px` ·
  modales/cards de auth `20px` · pills/badges/chips `999px` o `20px` ·
  foco `4px`.
- **Sombras:**
  - Tarjeta KPI: `0 4px 16px rgba(0,0,0,0.08)`
  - Hover de tarjeta: `0 6px 24px rgba(0,0,0,0.12)` / `0 8px 24px rgba(0,0,0,0.1)`
  - Tarjeta lista (mobile): `0 1px 3px rgba(0,0,0,0.04)`
  - Modal/auth: `0 30px 80px rgba(0,0,0,0.3)`
- **Gradientes de marca** (hero/CTA):
  - Primario: `linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))`
  - Acento: `linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))`
  - Auth full-screen: `linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-accent-2) 100%)`
- **Foco visible:** `outline: 2px solid var(--at-primary); outline-offset: 2px;`
- **Animaciones** (keyframes globales en `index.css` / `runtime.css` / `shared.css`):
  `fade-in` (entrada de página, 0.18s), `shared-shimmer` (skeletons),
  `shared-pulse` / `dot-pulse` (indicadores "en vivo"), `shared-spin` (loaders),
  `shake` (error de login), `floatBubble` (fondo animado de login).
  Transiciones típicas: `0.12–0.18s ease`. Hover de botón: `filter: brightness(1.06)`.

---

## 4. Componentes compartidos (reúsalos)

Viven en `src/components/shared/`. Todos estilados inline con tokens. Firmas reales:

### `<Button>` — `shared/Button.tsx`
10 variantes y 3 tamaños. Soporta `loading` (spinner), `iconLeft/iconRight`, `block`.
```tsx
type ButtonVariant =
  | 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'warning'
  | 'outline-primary' | 'outline-danger' | 'gradient-primary' | 'gradient-accent'
type ButtonSize = 'sm' | 'md' | 'lg'   // sm:6/12·13 · md:9/16·14 · lg:11/22·15
// radio 9px, fontWeight 600, gap 7px, hover brightness(1.06)
<Button variant="gradient-primary" size="lg" iconLeft={<Icon/>} loading={saving}>
  Guardar
</Button>
```

### `<KpiCard>` — tarjeta hero de métrica (fondo de color/gradiente, texto blanco)
```tsx
<KpiCard label="Consumo del Período" value={consumo.toFixed(2)} unit="m³"
  icon="💧" gradient="linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))"
  loading={isLoading} onClick={...} />
// minHeight 120px, radio 16px, sombra 0 4px 16px, valor 28px/700, hover translateY(-2px)
```

### `<StatTile>` — tile compacto de métrica (para filas de KPIs dentro de tabs)
```tsx
<StatTile label="Tasa de cobro" value="92%" tone="success" hint="+3% vs mes previo" icon={...} />
// tone: 'success'|'warning'|'danger'|'info'|'neutral' → tiñe fondo/borde/valor; radio 12px, valor 22px/800
```

### `<StatusBadge>` — píldora de estado semántica
```tsx
<StatusBadge estado={cuota.estado} />              // deriva tono + etiqueta del dominio
<StatusBadge tone="danger" solid dot>3 vencidas</StatusBadge>
// pill (radio 999), 11–12px/700, soft (tint) por defecto o solid; mapea estados es:
// pagado/activo→success · pendiente/parcial→warning · moroso/vencido→danger · inactivo→neutral
```

### `<InputField>` — input accesible con label, error y help
```tsx
<InputField label="Correo" type="email" value={email} onChange={setEmail}
  required error={err} helpText="Te enviaremos la factura aquí"
  prefix={<MailIcon/>} autoComplete="email" />
// label 13px/600 uppercase opcional, borde 1.5px var(--at-line)→var(--at-danger) en error,
// radio 8px, aria-invalid/aria-describedby automáticos
```

### `<FilterChips>` — fila de chips toggleables (single o multi-select)
```tsx
<FilterChips value={filtro} onChange={setFiltro} options={[
  { value:'todos', label:'Todos', count:42 },
  { value:'activo', label:'Activos', count:30, color:'var(--at-success)' },
]} />
// pill radio 20px, 11px, activo: fondo=color + texto #fff + weight 700
```

### `<EmptyState>` — estado vacío centrado (icono grande + título + descripción + CTA)
```tsx
<EmptyState icon="💧" title="No hay lecturas registradas"
  description="Comienza registrando la primera lectura del período."
  action={<Button>+ Nueva lectura</Button>} compact={false} />
```

### `<Skeleton>` — placeholder con shimmer (variante `onDark` para KPI cards)
```tsx
<Skeleton width="60%" height={24} />   <Skeleton onDark width={120} height={32} />
```

### Otros disponibles (mismo lenguaje visual)
- **`<DataTable>`** — tabla con columnas tipadas, filtros, exportación, responsive
  (oculta columnas secundarias y/o se convierte en **lista de tarjetas en móvil**).
- **`<Dialog>` / `<EditModal>` / `<PromptDialog>`** — modales sobre Radix Dialog
  (animación `at-dialog-content-in`, overlay con blur).
- `<ExportButton>` (Excel/PDF), `<ImportModal>`, `<FileUploader>`, `<ImageUploader>`,
  `<ImageGallery>`, `<SignaturePad>`, `<CommandPalette>` (⌘K), `<SelectionToolbar>`,
  `<KeyboardShortcutsHelp>`, `<CookieConsent>`, `<UpgradeCTA>`, `<BrandLogo>`.
- Helpers de estado: `statusTone(estado)`, `softToneStyle(tone)`, `TONE_VARS`.

---

## 5. Patrones de layout

### 5.1 App shell (vista autenticada)
```
┌──────────┬─────────────────────────────────────────────┐
│          │  [banner de alerta opcional]                │
│  NAV     │  Topbar (hamburguesa móvil · título · 🔔 ·  │
│  RAIL    │          tema · avatar)                      │
│ (oscuro  ├─────────────────────────────────────────────┤
│  256px)  │  Breadcrumbs (Sección › Subsección)         │
│          │  PresenceBar / TrialBanner (condicionales)  │
│          ├─────────────────────────────────────────────┤
│          │                                             │
│          │   <main> padding 28px 32px, scroll propio,  │
│          │   fade-in 0.18s en cada cambio de vista      │
│          │                                             │
└──────────┴─────────────────────────────────────────────┘
```
- **Nav rail:** ancho `256px`, fondo `var(--at-nav-bg)` (#102622), texto
  `var(--at-nav-ink)`. **Permanece oscuro en ambos temas.** Ítem activo: barra de
  acento de `5px` (`var(--at-accent)`) + fondo resaltado; badge rojo para no leídos.
  Avatar de perfil con gradiente acento al pie.
- **Contenedor:** `display:flex; min-height:100vh; background: var(--at-bg)`.
- El contenido (`flex:1`) apila banner → topbar → breadcrumbs → `<main>`.

### 5.2 Responsive (breakpoints reales)
| Breakpoint | Comportamiento |
|---|---|
| `≥768px` | Nav rail **sticky** visible (256px; **210px** entre 768–1024px) |
| `≤767px` | Nav rail **off-canvas** (`translateX(-100%)`, abre con hamburguesa + backdrop). Inputs `min-height:44px`/`font-size:16px`. Botones táctiles `.btn-touch` 44px. `env(safe-area-inset-*)` para notch iOS |
| `≤640px` | Oculta columnas `.table-col-secondary`; tablas con scroll horizontal + indicador de degradado; tabs con scroll-snap |
| `≤480px` | `<main>` padding 12px; tablas más compactas; patrón **tabla→tarjetas** (`.table-cards-on-mobile`) con `data-label` por celda |
| `≤380px` | Oculta el texto del chip de usuario (solo avatar) |

### 5.3 Tablas
- Envueltas en `.table-scroll-wrapper` (scroll-x + degradado que insinúa más
  columnas). Primera columna puede quedar **sticky** en móvil.
- En móvil estrecho, opt-in `.table-cards-on-mobile`: cada fila se vuelve una
  tarjeta con etiqueta (desde `data-label`) a la izquierda y valor a la derecha.

### 5.4 Pantallas de autenticación
Login/registro/invitación: layout a dos paneles (panel izquierdo de marca con
gradiente + burbujas flotantes animadas, oculto en móvil; panel derecho con el
formulario). Cards con radio `20px` y sombra profunda `0 30px 80px rgba(0,0,0,.3)`.

---

## 6. Estado actual y oportunidades (dónde enfocar las mejoras)

Contexto honesto para guiar tus sugerencias:

- **Fortalezas:** tokens consistentes, dark mode completo, accesibilidad básica
  (foco, ARIA, áreas táctiles), responsive sólido, componentes compartidos que
  evitan duplicación.
- **Deudas / oportunidades de "hacerla más atractiva":**
  1. **Mucho estilo inline disperso** → difícil mantener ritmo visual; valdría una
     escala de **spacing** y de **sombras** tokenizada (hoy son valores ad-hoc).
  2. **Jerarquía visual plana** en algunas tablas/listas densas: poco uso de
     agrupación, separadores suaves, encabezados sticky con estilo.
  3. **KPIs y dashboard** podrían ganar con micro-interacciones, sparklines y
     mejor uso del color de acento (hoy domina el verde; el terracota se usa poco).
  4. **Estados vacíos y de carga** funcionales pero genéricos (emoji + texto):
     oportunidad de ilustración/onboarding más cálido.
  5. **Densidad vs. respiro:** el panel de admin es muy denso; el portal del
     residente podría sentirse más ligero y "consumer".
  6. **Profundidad/textura:** la paleta natural pide sutilezas (grano, gradientes
     suaves, bordes `color-mix`) que hoy casi no se explotan.

> Al sugerir mejoras, prioriza **bajo riesgo y alto impacto**: refinamientos de
> espaciado, jerarquía, micro-interacciones y uso del acento, **sin** introducir
> dependencias nuevas ni cambiar el stack.

---

## 7. Plantilla de petición (copia y personaliza)

> *"Usando el design system de arriba (tokens `--at-*`, estilos inline, sin
> Tailwind, soporte claro/oscuro), rediseña **\<COMPONENTE/PANTALLA\>** para que se
> vea más moderno y atractivo. Devuélveme el `.tsx` completo y pegable,
> reutilizando los componentes compartidos cuando aplique, y explícame en 3–5
> puntos qué mejoraste y por qué. Si necesitas tokens nuevos, decláralos como
> variables `--at-*`."*

Ejemplos de `<COMPONENTE/PANTALLA>`: la `KpiCard` del dashboard · la fila de KPIs
del módulo de cobros · el portal del residente · el estado vacío de lecturas · la
tabla de unidades · la pantalla de login.
