// Helper para tests de accesibilidad (F3.1).
// Wrapper sobre jest-axe que pre-configura las reglas que aplicamos como
// baseline (WCAG 2.1 AA). Tests individuales pueden expandir o filtrar
// segun necesidad — usar checkA11y() en cualquier `render()` para validar.
//
// No extendemos `expect` con `toHaveNoViolations` (la api oficial de jest-axe)
// porque su declare-module choca con el de Vitest. En su lugar emitimos
// expect()s explicitos sobre results.violations.length, equivalentes en
// semantica pero sin conflicto de tipos.
import { axe } from 'jest-axe'
import { expect } from 'vitest'

const baselineConfig = {
  rules: {
    // Color contrast deshabilitado a nivel test — jsdom no computa estilos
    // computados de CSS variables, por lo que da falsos positivos. Validamos
    // contrast en Lighthouse / axe-core CLI en CI separado.
    'color-contrast': { enabled: false },
    // region: en Vitest renderizamos componentes aislados sin landmarks
    // <main>/<nav>/<aside>. La validacion completa de region la hace
    // Lighthouse a nivel pagina.
    region: { enabled: false },
  },
} as const

export async function checkA11y(container: HTMLElement, options: { config?: typeof baselineConfig } = {}) {
  const results = await axe(container, options.config ?? baselineConfig)
  if (results.violations.length > 0) {
    // Formato legible para diagnosticar rapido en CI: una linea por violation
    // con id, severity, count y selector(es).
    const summary = results.violations.map(v =>
      `[${v.impact ?? 'unknown'}] ${v.id} (${v.nodes.length} node${v.nodes.length > 1 ? 's' : ''}): ${v.help}\n  ` +
      v.nodes.map(n => n.target.join(' ')).join('\n  ')
    ).join('\n')
    throw new Error(`axe a11y violations:\n${summary}`)
  }
  expect(results.violations).toHaveLength(0)
}
