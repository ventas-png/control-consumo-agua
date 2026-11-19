// El historial importado (lo que la empresa llevaba a mano) se ve en la misma
// tabla que las lecturas del sistema, marcado «histórico», sin monto, sin
// acciones y fuera de los totales.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, Contador, Proyecto, Unidad, Cliente } from '../../../types'
import { filasDeHistorial } from '../../../lib/historialImportado'

const h = vi.hoisted(() => ({ fetchHistorialLecturasProyecto: vi.fn() }))

vi.mock('../../../domain/agua/mutations', () => ({
  cambiarEstadoRegistro: vi.fn(async () => ({ error: null })),
  deleteRegistro: vi.fn(async () => ({ error: null, count: 1 })),
}))
vi.mock('../../shared/Dialog', () => ({ notify: vi.fn(), confirm: vi.fn(async () => ({ isConfirmed: true })) }))
vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../../../domain/agua/historialLecturas', () => ({
  fetchHistorialLecturasProyecto: h.fetchHistorialLecturasProyecto,
}))

import { HistorialSection } from '../HistorialSection'

const proyecto = { id: 'p1', nombre: 'Viñas', company_id: 'co1' } as unknown as Proyecto
const otro = { id: 'p2', nombre: 'Otro', company_id: 'co1' } as unknown as Proyecto
const unidad = { id: 'un-1', nombre: 'Casa 7', project_id: 'p1', cliente_id: 'cli-1' } as unknown as Unidad
const cliente = { id: 'cli-1', nombre: 'Ana López' } as unknown as Cliente
const contador = { id: 'cont-1', numero_serie: 'VSC1-7', unidad_id: 'un-1', project_id: 'p1' } as unknown as Contador
const registro: Registro = {
  id: 'reg-1', cliente_id: 'cli-1', cliente_nombre: 'Ana López', contador_id: 'cont-1', project_id: 'p1',
  fecha: '2026-11-10T15:00:00', lectura_anterior: 150, lectura_actual: 160, consumo: 10,
  tarifa_aplicada: 5, canon_aplicado: 20, monto_calculado: 70, tipo_cobro: 'Consumo', estado: 'pendiente',
}
const historial = [
  { id: 'h1', contador_id: 'cont-1', project_id: 'p1', fecha: '2026-08-31', lectura: 100, consumo: null, notas: null },
  { id: 'h2', contador_id: 'cont-1', project_id: 'p1', fecha: '2026-09-30', lectura: 130, consumo: null, notas: 'Del cuaderno' },
  { id: 'h3', contador_id: 'cont-1', project_id: 'p1', fecha: '2026-10-31', lectura: null, consumo: 12, notas: null },
]

function renderSection(proyectos: Proyecto[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <HistorialSection
        registros={[registro]} clientes={[cliente]} unidades={[unidad]} proyectos={proyectos} contadores={[contador]}
        userRole="admin" moneda="Q" onEstadoUpdated={vi.fn()} onRegistroDeleted={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  h.fetchHistorialLecturasProyecto.mockReset()
  h.fetchHistorialLecturasProyecto.mockResolvedValue(historial)
})
afterEach(cleanup)

describe('filasDeHistorial', () => {
  it('toma el cliente de la unidad del contador y deduce la lectura anterior y el consumo', () => {
    const filas = filasDeHistorial(historial, new Map([[contador.id, contador]]), [unidad], [cliente])
    expect(filas.map(f => [f.id, f.cliente_nombre, f.historico])).toEqual([
      ['hist:h1', 'Ana López', { lectura: 100, anterior: null, consumo: null }],
      ['hist:h2', 'Ana López', { lectura: 130, anterior: 100, consumo: 30 }],
      // Sólo se anotó el consumo: no hay lectura, y la anterior sigue siendo 130.
      ['hist:h3', 'Ana López', { lectura: null, anterior: 130, consumo: 12 }],
    ])
    expect(filas.every(f => f.estado === ('historico' as string) && f.monto_calculado === 0 && f.project_id === 'p1')).toBe(true)
  })

  it('una lectura menor que la anterior (medidor cambiado) no da consumo', () => {
    const filas = filasDeHistorial(
      [historial[1], { ...historial[0], id: 'h9', fecha: '2026-10-15', lectura: 5 }],
      new Map([[contador.id, contador]]), [], [],
    )
    expect(filas[1].historico).toEqual({ lectura: 5, anterior: 130, consumo: null })
    // Sin unidad ni cliente, el nombre queda vacío en vez de inventarse.
    expect(filas[1].cliente_nombre).toBe('—')
  })
})

describe('HistorialSection — historial importado en la tabla', () => {
  it('con un solo proyecto lo trae y lo mezcla, marcado «histórico» y sin monto ni acciones', async () => {
    renderSection([proyecto])
    expect(h.fetchHistorialLecturasProyecto).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(screen.getAllByText(/histórico/).length).toBeGreaterThanOrEqual(3))

    const filas = screen.getAllByRole('row').slice(1)
    expect(filas).toHaveLength(4)
    // Más reciente primero: la lectura del sistema y luego las importadas.
    expect(within(filas[0]).getByText(/pendiente/)).toBeTruthy()
    expect(within(filas[0]).getByRole('button', { name: 'Enviar por WhatsApp' })).toBeTruthy()
    const importada = filas[2] // 30/09: lectura 130, anterior 100, consumo 30
    expect(within(importada).getByText('130')).toBeTruthy()
    expect(within(importada).getByText('100')).toBeTruthy()
    expect(within(importada).queryByRole('button', { name: 'Enviar por WhatsApp' })).toBeNull()
    expect(within(importada).queryByRole('button', { name: 'Eliminar lectura' })).toBeNull()
    expect(within(importada).queryByText(/Q\s?0/)).toBeNull()
  })

  it('no cuenta ni suma en los totales, y lo dice', async () => {
    renderSection([proyecto])
    const nota = await screen.findByText(/3 lecturas históricas importadas/)
    expect(nota.textContent).toContain('no suman en los totales')
    const tarjeta = (label: string) => screen.getByText(label).parentElement as HTMLElement
    expect(within(tarjeta('Total Registros')).getByText('1')).toBeTruthy()
    expect(within(tarjeta('Total Consumo')).getByText(/10[.,]00 m³/)).toBeTruthy()
    expect(within(tarjeta('Total Monto')).getByText(/70[.,]00/)).toBeTruthy()
  })

  it('con varios proyectos no trae nada hasta elegir uno; el filtro «Histórico» deja sólo lo importado', async () => {
    renderSection([proyecto, otro])
    expect(h.fetchHistorialLecturasProyecto).not.toHaveBeenCalled()
    expect(screen.getByText(/Elija un proyecto en Filtros/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }))
    fireEvent.change(screen.getByDisplayValue('Todos los Proyectos'), { target: { value: 'p1' } })
    expect(h.fetchHistorialLecturasProyecto).toHaveBeenCalledWith('p1')
    await screen.findByText(/3 lecturas históricas importadas/)

    fireEvent.change(screen.getByDisplayValue('Todos los Estados'), { target: { value: 'historico' } })
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(3)
    expect(screen.queryByText(/pendiente/i, { selector: 'span' })).toBeNull()

    // «Pendiente» deja fuera lo importado.
    fireEvent.change(screen.getByDisplayValue('🗂️ Histórico (importado)'), { target: { value: 'pendiente' } })
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1)
  })

  it('el detalle de una lectura importada dice que es de referencia y no ofrece acciones', async () => {
    renderSection([proyecto])
    await screen.findByText(/3 lecturas históricas importadas/)
    fireEvent.click(screen.getByRole('button', { name: /Ver detalles de la lectura de Ana López del 30/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/no genera cobro/)).toBeTruthy()
    expect(within(dialog).getByText('Del cuaderno')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Editar estado' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Enviar por WhatsApp' })).toBeNull()
  })
})
