// Panel directivo — los cuatro bloques de indicadores van en una rejilla que se
// adapta al ancho: una columna en el teléfono, dos en escritorio. Antes eran dos
// columnas fijas y en pantalla angosta cada bloque quedaba en media pantalla.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PanelDirectivoTab from '../PanelDirectivoTab'

afterEach(cleanup)

describe('Panel directivo · bloques en teléfono', () => {
  it('pinta los cuatro bloques dentro de una rejilla auto-fit, no de dos columnas fijas', () => {
    render(
      <PanelDirectivoTab cuotas={[]} gastos={[]} presupuestos={[]} tickets={[]} polizas={[]} inspecciones={[]}
        contratos={[]} infracciones={[]} sugerencias={[]} unidades={[]} recargosMora={[]} fondoReservaMovs={[]} moneda="Q" />,
    )
    const rejilla = screen.getByTestId('bloques-indicadores')
    expect(rejilla.getAttribute('style')).toContain('auto-fit')
    expect(rejilla.getAttribute('style')).not.toContain('1fr 1fr')
    for (const titulo of ['💰 Gestión Financiera', '🔧 Mantenimiento', '🏠 Ocupación y Arrendamientos', '📋 Cumplimiento y Convivencia']) {
      expect(screen.getByText(titulo)).toBeTruthy()
    }
    // Sin datos, el panel sigue diciendo que opera en condiciones normales.
    expect(screen.getByText(/Sin alertas críticas/)).toBeTruthy()
  })
})
