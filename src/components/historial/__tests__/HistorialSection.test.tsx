import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Registro, Contador } from '../../../types'

// HistorialSection importa la capa de mutaciones (que a su vez importa supabase,
// el cual lanza sin env vars) y los diálogos. Mockeamos ambos: el detalle de
// lectura es UI pura y no dispara red.
vi.mock('../../../domain/agua/mutations', () => ({
  updateRegistro: vi.fn(async () => ({ error: null })),
  deleteRegistro: vi.fn(async () => ({ error: null, count: 1 })),
}))
vi.mock('../../shared/Dialog', () => ({
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))
// El barrel `../shared` arrastra SecureImage → storageUrls → supabase, que lanza
// sin env vars. Lo stubeamos: el detalle no usa Storage.
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))

import { HistorialSection } from '../HistorialSection'

const baseRegistro: Registro = {
  id: 'reg-1',
  cliente_id: 'cli-1',
  cliente_nombre: 'MELBA AZUCENA GIRON',
  contador_id: 'cont-1',
  fecha: '2026-11-25',
  lectura_anterior: 1205,
  lectura_actual: 1208,
  consumo: 3,
  tarifa_aplicada: 25,
  tarifa_exceso_aplicada: 30,
  canon_aplicado: 20,
  monto_calculado: 75,
  tipo_cobro: 'Consumo con Exceso',
  estado: 'pagado',
  monto_pagado: 75,
  fecha_pago: '2026-11-30',
  mes: 'Noviembre 2026',
  fecha_lectura_anterior: '2026-10-25',
  dias_servicio: 31,
  notas: 'Lectura tomada en portón principal',
  gps: { lat: 14.6349, lng: -90.5069 },
}

function renderSection(registros: Registro[] = [baseRegistro]) {
  return render(
    <HistorialSection
      registros={registros}
      clientes={[]}
      contadores={[{ id: 'cont-1', numero_serie: 'CVH 3 70367900' } as unknown as Contador]}
      userRole="admin"
      moneda="Q"
      onEstadoUpdated={vi.fn()}
    />,
  )
}

describe('HistorialSection — detalle de lectura', () => {
  beforeEach(() => cleanup())

  it('oculta el detalle por defecto', () => {
    renderSection()
    expect(screen.queryByText('Período de servicio')).toBeNull()
    expect(screen.queryByText(/ID de lectura/)).toBeNull()
  })

  it('despliega el detalle al pulsar "Ver detalles"', () => {
    renderSection()
    const toggle = screen.getByRole('button', { name: 'Ver detalles de la lectura' })
    fireEvent.click(toggle)

    // Campos que SOLO aparecen en el detalle desplegado.
    expect(screen.getByText('Período de servicio')).toBeTruthy()
    expect(screen.getByText('Tipo de cobro')).toBeTruthy()
    expect(screen.getByText('Consumo con Exceso')).toBeTruthy()
    expect(screen.getByText('Canon / cargo fijo')).toBeTruthy()
    expect(screen.getByText('Tarifa de exceso')).toBeTruthy()
    expect(screen.getByText('Lectura tomada en portón principal')).toBeTruthy()
    expect(screen.getByText(/ID de lectura: reg-1/)).toBeTruthy()
  })

  it('expone un enlace a Google Maps cuando hay GPS', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalles de la lectura' }))
    const link = screen.getByRole('link', { name: /Ver ubicación en el mapa/ }) as HTMLAnchorElement
    expect(link.href).toContain('query=14.6349,-90.5069')
  })

  it('colapsa el detalle al volver a pulsar', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalles de la lectura' }))
    expect(screen.getByText('Período de servicio')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar detalles de la lectura' }))
    expect(screen.queryByText('Período de servicio')).toBeNull()
  })
})
