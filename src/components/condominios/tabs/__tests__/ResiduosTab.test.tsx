// Residuos: registrar y editar se hacen en ventana (pantalla completa en el
// teléfono, sin cerrarse a mitad del guardado) y cada registro abre su detalle
// en ventana —con las notas y la descripción de la incidencia, que la lista no
// mostraba—. La tabla se lee como tarjetas en el teléfono.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { RegistroResiduo } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../shared/Dialog', () => ({ confirm: mocks.confirm, notify: mocks.notify }))

const { ResiduosTab } = await import('../ResiduosTab')

function registro(over: Partial<RegistroResiduo>): RegistroResiduo {
  return {
    id: 'r1', company_id: 'co1', project_id: 'p1', fecha: '2026-10-10', tipo_residuo: 'reciclable',
    cantidad_kg: 12.5, punto_acopio: 'Sótano 1', empresa_recolectora: 'Recicla GT', estado: 'pendiente',
    incidencia: false, descripcion_incidencia: null, registrado_por: 'autor', notas: 'Cartón y PET',
    created_at: '2026-10-10T10:00:00Z',
    ...over,
  }
}

const residuos = [
  registro({ id: 'r1' }),
  registro({ id: 'r2', fecha: '2026-10-12', tipo_residuo: 'peligroso', cantidad_kg: 3, notas: null,
    incidencia: true, descripcion_incidencia: 'Baterías sueltas en el contenedor general' }),
]

function props(over: Partial<Parameters<typeof ResiduosTab>[0]> = {}): Parameters<typeof ResiduosTab>[0] {
  return { residuos, proyectoId: 'p1', companyId: 'co1', userId: 'yo', canCreate: true, canEdit: true, canDelete: true, onRefresh: vi.fn(), ...over }
}

function esperar() {
  let resolver!: (v: { error: null }) => void
  const promesa = new Promise<{ error: null }>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(cleanup)

describe('Residuos — registro en ventana', () => {
  it('abre a pantalla completa y registra; no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<ResiduosTab {...props({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Registrar' }))
    const ventana = screen.getByRole('dialog', { name: '♻️ Nuevo registro' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)

    fireEvent.change(screen.getByLabelText('Tipo de residuo'), { target: { value: 'organico' } })
    fireEvent.change(screen.getByLabelText('Cantidad (kg)'), { target: { value: '7.25' } })
    fireEvent.change(screen.getByLabelText('Punto de acopio'), { target: { value: 'Jardín' } })
    // La descripción de la incidencia aparece al marcarla.
    expect(screen.queryByLabelText('Descripción de la incidencia')).toBeNull()
    fireEvent.click(screen.getByLabelText(/Hay incidencia/))
    fireEvent.change(screen.getByLabelText('Descripción de la incidencia'), { target: { value: 'Bolsa rota' } })

    const guardado = esperar()
    mocks.createCondominioRow.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRow).toHaveBeenCalledWith('registros_residuos', expect.objectContaining({
      company_id: 'co1', project_id: 'p1', tipo_residuo: 'organico', cantidad_kg: 7.25,
      punto_acopio: 'Jardín', incidencia: true, descripcion_incidencia: 'Bolsa rota', registrado_por: 'yo',
    }))

    // Mientras guarda, ni Escape ni la X ni Cancelar la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByRole('dialog', { name: '♻️ Nuevo registro' })).toBeTruthy()

    guardado.resolver({ error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('sin fecha avisa y la ventana sigue abierta', async () => {
    render(<ResiduosTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar' }))
    fireEvent.change(screen.getByLabelText('Fecha *'), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('si falla el guardado, avisa y la ventana sigue abierta con lo escrito', async () => {
    mocks.createCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    render(<ResiduosTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar' }))
    fireEvent.change(screen.getByLabelText('Empresa recolectora'), { target: { value: 'EcoGT' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Registrar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Empresa recolectora') as HTMLInputElement).value).toBe('EcoGT')
  })

  it('editar abre la ventana con los datos y no cambia quién lo registró', async () => {
    render(<ResiduosTab {...props()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar registro' })[0])
    const ventana = screen.getByRole('dialog', { name: '✏️ Editar registro' })
    // La tabla ordena por fecha descendente: la primera fila es la del 12/10.
    expect((screen.getByLabelText('Descripción de la incidencia') as HTMLTextAreaElement).value).toBe('Baterías sueltas en el contenedor general')
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'procesado' } })
    fireEvent.click(within(ventana).getByRole('button', { name: 'Actualizar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, payload] = mocks.updateCondominioRow.mock.calls[0] as [string, string, Record<string, unknown>]
    expect([tabla, id, payload.estado]).toEqual(['registros_residuos', 'r2', 'procesado'])
    expect('registrado_por' in payload).toBe(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('sin permisos no hay Registrar ni Editar', () => {
    render(<ResiduosTab {...props({ canCreate: false, canEdit: false, canDelete: false })} />)
    expect(screen.queryByRole('button', { name: '+ Registrar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Editar registro' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: /Estado de residuo/ })).toBeNull()
  })
})

describe('Residuos — lista y detalle', () => {
  it('la tabla se lee como tarjetas con rótulos; acciones al pie', () => {
    const { container } = render(<ResiduosTab {...props()} />)
    const tabla = container.querySelector('table')!
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    const celdas = Array.from(tabla.querySelectorAll('tbody tr:first-child td'))
    expect(celdas.map(td => td.getAttribute('data-label'))).toEqual(
      ['Fecha', 'Tipo', 'Cantidad', 'Punto Acopio', 'Empresa', 'Estado', null])
  })

  it('«Ver» abre el detalle con la incidencia y las notas', () => {
    render(<ResiduosTab {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de residuos del 2026-10-12' }))
    const detalle = screen.getByRole('dialog', { name: '☢️ Residuo peligroso' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('Baterías sueltas en el contenedor general')).toBeTruthy()
    fireEvent.click(within(detalle).getByRole('button', { name: 'Cerrar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de residuos del 2026-10-10' }))
    const otro = screen.getByRole('dialog', { name: '♻️ Residuo reciclable' })
    expect(within(otro).getByText('Cartón y PET')).toBeTruthy()
    expect(within(otro).getByText('Recicla GT')).toBeTruthy()
  })

  it('tocar la fila abre el detalle; cambiar el estado en la fila no', async () => {
    const { container } = render(<ResiduosTab {...props()} />)
    const cuerpo = container.querySelector('tbody')!
    fireEvent.click(within(cuerpo).getByRole('combobox', { name: 'Estado de residuo 2026-10-10' }))
    fireEvent.change(within(cuerpo).getByRole('combobox', { name: 'Estado de residuo 2026-10-10' }), { target: { value: 'recolectado' } })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('registros_residuos', 'r1', { estado: 'recolectado' }))

    fireEvent.click(within(cuerpo).getByText('2026-10-10'))
    expect(screen.getByRole('dialog', { name: '♻️ Residuo reciclable' })).toBeTruthy()
  })

  it('desde el detalle: Editar pasa a la ventana de edición y Eliminar borra y cierra', async () => {
    const onRefresh = vi.fn()
    render(<ResiduosTab {...props({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de residuos del 2026-10-10' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✏️ Editar' }))
    // El detalle se cierra: queda sólo la ventana de edición.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: '✏️ Editar registro' })).toBeTruthy()
    expect((screen.getByLabelText('Punto de acopio') as HTMLInputElement).value).toBe('Sótano 1')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de residuos del 2026-10-10' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('registros_residuos', 'r1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('el detalle ofrece Editar y Eliminar sólo con su permiso', () => {
    render(<ResiduosTab {...props({ canEdit: false, canDelete: false })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver registro de residuos del 2026-10-10' }))
    const detalle = screen.getByRole('dialog')
    expect(within(detalle).queryByRole('button', { name: '✏️ Editar' })).toBeNull()
    expect(within(detalle).queryByRole('button', { name: 'Eliminar' })).toBeNull()
    expect(within(detalle).getAllByText('Pendiente').length).toBeGreaterThan(0)
  })
})

// El % de reciclaje es el mismo que en Sostenibilidad: reciclable más
// electrónico. Antes aquí contaba sólo lo reciclable.
describe('Residuos — % de reciclaje', () => {
  it('cuenta lo reciclable y lo electrónico, y lo dice', () => {
    render(<ResiduosTab {...props({ residuos: [
      ...residuos, // reciclable 12.5 kg + peligroso 3 kg
      registro({ id: 'r3', tipo_residuo: 'electronico', cantidad_kg: 4.5 }),
    ] })} />)
    expect(screen.getByText('85%')).toBeTruthy() // (12.5 + 4.5) / 20
    expect(screen.getByText('20.0 kg')).toBeTruthy()
  })

  it('el total lleva separador de miles, como en Sostenibilidad', () => {
    render(<ResiduosTab {...props({ residuos: [registro({ id: 'r1', cantidad_kg: 1200.5 }), registro({ id: 'r2', cantidad_kg: 174.5 })] })} />)
    expect(screen.getByText('1,375.0 kg').textContent).toBe('1,375.0\u00a0kg')
    expect(screen.getByText('reciclable + electrónico')).toBeTruthy()
  })

  it('sin kg registrados no muestra un porcentaje', () => {
    render(<ResiduosTab {...props({ residuos: [registro({ id: 'r1', cantidad_kg: null })] })} />)
    const kpi = screen.getByText('% Reciclaje').parentElement!
    expect(within(kpi).getByText('—')).toBeTruthy()
  })
})
