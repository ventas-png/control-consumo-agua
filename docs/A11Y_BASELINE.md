# Accesibilidad — Baseline F3.1

Documenta el estado de accesibilidad como **gate** desde F3.1 en adelante.

## Stack

- **`jest-axe`** + **`@types/jest-axe`** corren dentro de Vitest
- Helper `src/test/a11y.ts` expone `checkA11y(container)` con configuración base
- `vitest run` ya valida axe en cada PR (gate de CI existente)

## Reglas activas en CI

Por default el helper aplica todas las reglas de **WCAG 2.1 AA** que axe-core soporta, con **2 excepciones** documentadas:

| Regla excluida | Por qué |
|---|---|
| `color-contrast` | jsdom no computa estilos de CSS variables; ejecuta falsos positivos. Validación real vive en Lighthouse CI / axe DevTools a nivel página. |
| `region` | Tests aíslan componentes sin landmarks (`<main>`, `<nav>`); axe completo en page-level corre en smoke E2E. |

Si un test individual necesita otras exclusiones, pasar `{ config: { rules: { ... } } }` al helper.

## Componentes con cobertura a11y baseline (F3.1)

| Componente | Tests con `checkA11y` |
|---|---|
| `LandingPage` | initial render + login modal abierto + MFA challenge |
| `DataTable` | render con data + estado vacío |
| `ImportModal` | modal abierto |

## Cómo agregar a11y a un test nuevo

```ts
import { checkA11y } from '../../../test/a11y'

it('a11y baseline: <componente>', async () => {
  const { container } = render(<MiComponente />)
  await checkA11y(container)
})
```

## Roadmap Fase 3

| Lote | Cobertura |
|---|---|
| **F3.1** (este) | Stack + 3 componentes críticos + fixes de Pricing (PrLine labels), Social footer (heading order), pricing-card (landmark) |
| F3.2 | SweetAlert2 → Radix Dialog (focus trap, role, aria-labelledby por default) |
| F3.3 | Admin responsive (sidebar colapsable, table→cards en mobile) |
| F3.4 | Sistema de diseño shared con a11y baked-in |
| F3.5 | Wizards onboarding con `role="dialog"` + focus management |
| F3.6 | Portal residente ampliado |

## Hallazgos pendientes (audit `SECURITY_UX_AUDIT_2026-04-07.md`)

Los hallazgos del audit que **no** entran en F3.1 (requieren refactor más grande):

- **1224 inputs vs 81 con `id=`**: la mayoría de tabs de condominios (`AmenidadesTab`, `PortalRentasTab`, etc.) usan el pattern `<label><span>X</span><input/></label>`. Walking through cada tab tarda mucho — esto entrará en F3.4 cuando estandaricemos `<InputField>` shareable.
- **178 `Swal.fire`**: entran en F3.2.
- **Modales sin focus trap**: entran en F3.2 con Radix.
- **Tabs sin `role="tablist"`**: entran en F3.3 (admin responsive incluye redo de tab navigation).

Estos hallazgos están documentados aquí para que F3.2-F3.6 los aborden sistemáticamente, no se pierdan.

## Cómo regresion-test al hacer cambios

1. Modificar un componente
2. Si su test ya tiene `checkA11y`, simplemente correr `npx vitest run <archivo>`
3. Si introduce violaciones, axe muestra exactamente:
   - Regla violada (e.g. `label`, `aria-allowed-attr`)
   - Selector CSS del elemento ofensor
   - Cómo arreglar (link a deque docs)

## Tools complementarias (futuro)

- **Lighthouse CI** sobre el preview de Vercel (medirá runtime a11y score incl. color-contrast real)
- **`@axe-core/playwright`** para tests E2E end-to-end (cuando armemos suite Playwright)
- **VS Code extension `axe Accessibility Linter`** para feedback en editor
