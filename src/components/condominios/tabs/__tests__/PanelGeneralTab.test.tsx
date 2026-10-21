import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { TicketMantenimiento } from '../../../../types'
import { PanelGeneralTab } from '../PanelGeneralTab'

afterEach(cleanup)

const ticket = { id: 't1', titulo: 'Fuga en el lobby', prioridad: 'alta', estado: 'abierto' } as unknown as TicketMantenimiento

function renderPanel(props: Partial<ComponentProps<typeof PanelGeneralTab>> = {}) {
  return render(
    <PanelGeneralTab cuotas={[]} tickets={[ticket]} visitantes={[]} amenidades={[]} reservas={[]} polizas={[]}
      inspecciones={[]} gastos={[]} paquetes={[]} correspondencia={[]} moneda="Q" {...props} />,
  )
}

describe('PanelGeneralTab', () => {
  it('cada KPI lleva a su pestaña, y las listas tienen "Ver todos"', () => {
    const onIrATab = vi.fn()
    renderPanel({ onIrATab, puedeVer: () => true })
    fireEvent.click(screen.getByRole('button', { name: /Tickets abiertos/ }))
    expect(onIrATab).toHaveBeenLastCalledWith('mantenimiento')
    fireEvent.click(screen.getByRole('button', { name: /Paquetes pendientes/ }))
    expect(onIrATab).toHaveBeenLastCalledWith('paqueteria')
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos ›' }))
    expect(onIrATab).toHaveBeenLastCalledWith('mantenimiento')
  })

  it('sin permiso para ver la pestaña, la tarjeta es solo informativa', () => {
    renderPanel({ onIrATab: vi.fn(), puedeVer: tab => tab !== 'mantenimiento' })
    expect(screen.queryByRole('button', { name: /Tickets abiertos/ })).toBeNull()
    expect(screen.getByText('Tickets abiertos')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ver todos ›' })).toBeNull()
    expect(screen.getByRole('button', { name: /Visitas hoy/ })).toBeTruthy()
  })

  it('sin navegación (vista previa) nada es botón', () => {
    renderPanel()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
