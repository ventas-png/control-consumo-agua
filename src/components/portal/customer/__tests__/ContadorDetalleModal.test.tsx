import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ContadorInfo, LecturaInfo } from '../../../../lib/portalDashboard'
import { ContadorDetalleModal } from '../ContadorDetalleModal'

afterEach(cleanup)

const contador: ContadorInfo = {
  id: 'k1', numero_serie: 'A-100', tipo_agua: 'potable', descripcion: null,
  activo: true, unidad_id: 'u1', project_id: 'p1', company_id: 'c1',
}

const lectura = (over: Partial<LecturaInfo>): LecturaInfo => ({
  id: Math.random().toString(36).slice(2), fecha: '2026-10-14', lectura_anterior: 100, lectura_actual: 112,
  consumo: 12, monto_calculado: 60, estado: 'pendiente', mes: null, fecha_lectura_anterior: null,
  dias_servicio: 30, tipo_cobro: 'medido', contador_id: 'k1', ...over,
})

describe('ContadorDetalleModal', () => {
  it('abre como ventana a pantalla completa en el teléfono, con el contador de título', () => {
    render(<ContadorDetalleModal contador={contador} unidadNombre="Casa 4" moneda="Q" lecturas={[lectura({})]} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Contador #A-100' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText(/Casa 4/)).toBeDefined()
  })

  it('resume el último consumo y el promedio, y lista cada lectura sin tabla ancha', () => {
    render(
      <ContadorDetalleModal
        contador={contador}
        moneda="Q"
        lecturas={[
          lectura({ fecha: '2026-10-14', consumo: 12, monto_calculado: 60, estado: 'pagado' }),
          lectura({ fecha: '2026-09-14', consumo: 8, monto_calculado: 40 }),
        ]}
        onClose={() => {}}
      />,
    )
    expect(screen.getByText('Último consumo')).toBeDefined()
    expect(screen.getByText('10.00 m³')).toBeDefined() // promedio de 12 y 8
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    // El estado aparece en el resumen del último monto y en su fila.
    expect(screen.getAllByText('Pagado')).toHaveLength(2)
  })

  it('sin lecturas muestra el vacío', () => {
    render(<ContadorDetalleModal contador={contador} moneda="Q" lecturas={[]} onClose={() => {}} />)
    expect(screen.getByText('No hay lecturas registradas para este contador.')).toBeDefined()
  })
})
