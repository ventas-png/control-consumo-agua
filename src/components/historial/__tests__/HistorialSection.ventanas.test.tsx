// Historial de lecturas en el teléfono: el detalle de una lectura y el cambio
// de estado se abren en ventanas (EditModal, a pantalla completa en el
// teléfono) en vez de desplegarse dentro de la fila o en un overlay a mano.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import type { Registro, Contador } from '../../../types'
import { formatDate } from '../../../lib/format'

const mocks = vi.hoisted(() => ({
  cambiarEstadoRegistro: vi.fn(async (..._args: unknown[]) => ({ error: null as unknown })),
  deleteRegistro: vi.fn(async (..._args: unknown[]) => ({ error: null as unknown, count: 1 })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../../../domain/agua/mutations', () => ({
  cambiarEstadoRegistro: mocks.cambiarEstadoRegistro,
  deleteRegistro: mocks.deleteRegistro,
}))
// El visor de foto la baja por id al abrirse: sin red en el test.
vi.mock('../../../domain/agua/queries', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchRegistroFoto: vi.fn(async () => null),
}))
vi.mock('../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

import { HistorialSection } from '../HistorialSection'

const registro: Registro = {
  id: 'reg-1', cliente_id: 'cli-1', cliente_nombre: 'María López',
  contador_id: 'cont-1', fecha: '2026-10-14',
  lectura_anterior: 1205, lectura_actual: 1208, consumo: 3,
  tarifa_aplicada: 25, tarifa_exceso_aplicada: 30, canon_aplicado: 20,
  monto_calculado: 75, tipo_cobro: 'Consumo con Exceso', estado: 'pendiente',
  mes: 'Octubre 2026', fecha_lectura_anterior: '2026-09-14', dias_servicio: 30,
} as unknown as Registro

const otro: Registro = {
  ...registro, id: 'reg-2', cliente_id: 'cli-2', cliente_nombre: 'Juan Pérez',
  contador_id: null, fecha: '2026-09-14', estado: 'mora',
} as unknown as Registro

const contadores = [{ id: 'cont-1', numero_serie: 'A-100' } as unknown as Contador]
const tituloDetalle = `María López — ${formatDate('2026-10-14')}`

type SectionProps = ComponentProps<typeof HistorialSection>

function renderSection(props: Partial<SectionProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onEstadoUpdated = vi.fn()
  const onRegistroDeleted = vi.fn()
  const utils = render(
    <QueryClientProvider client={qc}>
      <HistorialSection
        registros={[registro, otro]} clientes={[]} contadores={contadores}
        userRole="admin" moneda="Q" canEdit canChangeStatus canDelete
        onEstadoUpdated={onEstadoUpdated} onRegistroDeleted={onRegistroDeleted}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { ...utils, onEstadoUpdated, onRegistroDeleted }
}

function abrirDetalle() {
  fireEvent.click(screen.getByRole('button', { name: /Ver detalles de la lectura de María López/ }))
  return screen.getByRole('dialog', { name: tituloDetalle })
}

beforeEach(() => { Object.values(mocks).forEach(m => m.mockClear()) })
afterEach(cleanup)

describe('HistorialSection — detalle en ventana', () => {
  it('el botón de la fila abre el detalle a pantalla completa en el teléfono', () => {
    renderSection()
    const dialog = abrirDetalle()
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Subtítulo: contador y estado.
    expect(within(dialog).getByText(/Contador A-100/)).toBeTruthy()
    expect(within(dialog).getByText(/pendiente/)).toBeTruthy()
    // Mismos datos que el detalle que antes se desplegaba en la fila.
    expect(within(dialog).getByText('Período de servicio')).toBeTruthy()
    expect(within(dialog).getByText('30 días')).toBeTruthy()
    expect(within(dialog).getByText('Consumo con Exceso')).toBeTruthy()
    expect(within(dialog).getByText('Canon / cargo fijo')).toBeTruthy()
    expect(within(dialog).getByText(/ID de lectura: reg-1/)).toBeTruthy()
  })

  it('tocar cualquier parte de la fila también abre el detalle', () => {
    renderSection()
    const fila = screen.getByText(`📅 ${formatDate('2026-10-14')}`).closest('tr')!
    fireEvent.click(fila)
    expect(screen.getByRole('dialog', { name: tituloDetalle })).toBeTruthy()
  })

  it('las acciones de la fila no abren el detalle', () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderSection()
    fireEvent.click(screen.getAllByLabelText('Enviar por WhatsApp')[0])
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir.mockRestore()
  })

  it('Escape cierra la ventana', () => {
    renderSection()
    abrirDetalle()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: tituloDetalle })).toBeNull()
  })

  it('con la foto abierta encima, Escape cierra solo la foto', async () => {
    renderSection()
    const dialog = abrirDetalle()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver imagen de la lectura' }))
    expect(screen.getByRole('dialog', { name: /Foto de la lectura/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Foto de la lectura/ })).toBeNull())
    expect(screen.getByRole('dialog', { name: tituloDetalle })).toBeTruthy()
  })

  it('la vista de tarjetas abre el mismo detalle', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Vista de tarjetas' }))
    fireEvent.click(screen.getByRole('button', { name: /Ver detalles de la lectura de María López/ }))
    expect(screen.getByRole('dialog', { name: tituloDetalle })).toBeTruthy()
  })

  it('en el teléfono la tabla se vuelve tarjetas y oculta las columnas secundarias', () => {
    const { container } = renderSection()
    expect(container.querySelector('table.table-cards-on-mobile')).toBeTruthy()
    const secundarias = [...container.querySelectorAll('th.table-col-secondary')].map(th => th.textContent)
    expect(secundarias).toEqual(['# Contador', 'Lect. Ant.', 'Lect. Act.', 'Capturó', 'Acciones'])
  })
})

describe('HistorialSection — cambio de estado desde la ventana', () => {
  it('llama a la misma mutación y deja el detalle abierto', async () => {
    const { onEstadoUpdated } = renderSection()
    const detalle = abrirDetalle()
    fireEvent.click(within(detalle).getByRole('button', { name: 'Editar estado' }))

    const ventana = screen.getByRole('dialog', { name: /Modificar Estado de Pago/ })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    const select = within(ventana).getByLabelText('Nuevo Estado') as HTMLSelectElement
    expect(select.value).toBe('pendiente')
    fireEvent.change(select, { target: { value: 'mora' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mocks.cambiarEstadoRegistro).toHaveBeenCalledWith('reg-1', 'mora'))
    await waitFor(() => expect(onEstadoUpdated).toHaveBeenCalledWith('reg-1', 'mora'))
    expect(screen.queryByRole('dialog', { name: /Modificar Estado de Pago/ })).toBeNull()
    expect(screen.getByRole('dialog', { name: tituloDetalle })).toBeTruthy()
  })

  it('mientras guarda no se cierra con Escape y Cancelar queda deshabilitado', async () => {
    let terminar: (v: { error: unknown }) => void = () => {}
    mocks.cambiarEstadoRegistro.mockImplementationOnce(() => new Promise(res => { terminar = res }))
    renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar estado' })[0])
    const ventana = screen.getByRole('dialog', { name: /Modificar Estado de Pago/ })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect((within(ventana).getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: /Modificar Estado de Pago/ })).toBeTruthy()

    terminar({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Modificar Estado de Pago/ })).toBeNull())
  })

  it('un error al guardar avisa y deja la ventana abierta', async () => {
    mocks.cambiarEstadoRegistro.mockResolvedValueOnce({ error: new Error('x') })
    const { onEstadoUpdated } = renderSection()
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar estado' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' })))
    expect(onEstadoUpdated).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /Modificar Estado de Pago/ })).toBeTruthy()
  })
})

describe('HistorialSection — permisos en la ventana', () => {
  it('con permisos muestra editar estado, imagen, WhatsApp y eliminar', () => {
    renderSection()
    const dialog = abrirDetalle()
    expect(within(dialog).getByRole('button', { name: 'Editar estado' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Ver imagen de la lectura' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Enviar por WhatsApp' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Eliminar lectura' })).toBeTruthy()
  })

  it.each<[string, Partial<SectionProps>]>([
    ['sin canEdit', { canEdit: false }],
    ['sin canChangeStatus', { canChangeStatus: false }],
    ['rol viewer', { userRole: 'viewer' }],
  ])('%s no ofrece cambiar el estado', (_caso, props) => {
    renderSection(props)
    const dialog = abrirDetalle()
    expect(within(dialog).queryByRole('button', { name: 'Editar estado' })).toBeNull()
    // Ver la foto y enviar por WhatsApp no dependen de permisos (igual que en la fila).
    expect(within(dialog).getByRole('button', { name: 'Ver imagen de la lectura' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Enviar por WhatsApp' })).toBeTruthy()
  })

  it.each<[string, Partial<SectionProps>]>([
    ['sin canDelete', { canDelete: false }],
    ['rol viewer', { userRole: 'viewer' }],
    ['sin onRegistroDeleted', { onRegistroDeleted: undefined }],
  ])('%s no ofrece eliminar', (_caso, props) => {
    renderSection(props)
    const dialog = abrirDetalle()
    expect(within(dialog).queryByRole('button', { name: 'Eliminar lectura' })).toBeNull()
  })

  it('eliminar desde la ventana usa la misma mutación y la cierra', async () => {
    const { onRegistroDeleted } = renderSection()
    const dialog = abrirDetalle()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar lectura' }))
    await waitFor(() => expect(mocks.deleteRegistro).toHaveBeenCalledWith('reg-1'))
    await waitFor(() => expect(onRegistroDeleted).toHaveBeenCalledWith('reg-1'))
    expect(screen.queryByRole('dialog', { name: tituloDetalle })).toBeNull()
  })
})
