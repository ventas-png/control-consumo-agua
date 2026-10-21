// Clientes en el teléfono: la tabla se lee como tarjetas (data-label por
// celda), los formularios ocupan toda la pantalla y no se cierran a medias.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import type { Cliente } from '../../../types'

const h = vi.hoisted(() => ({
  buscarClienteParaOnboarding: vi.fn(),
  fetchClientesForDedup: vi.fn(),
  parseXlsxToObjects: vi.fn(),
  validatedInsertMany: vi.fn(),
  notify: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../shared/SessionContext', () => ({
  useSession: () => ({ user_id: 'u1', role: 'admin', company_id: 'co1', name: 'Admin', email: 'admin@x.com' }),
}))
vi.mock('../../shared/PermissionsContext', () => ({
  usePermissionsContext: () => ({ canEdit: () => true, canDelete: () => true, canCreate: () => true }),
}))
vi.mock('../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: false })) }))
vi.mock('../../../domain/clientes/queries', () => ({
  fetchClienteAccountMap: vi.fn(async () => ({})),
  fetchCompanyClientesActivoMap: vi.fn(async () => ({})),
  buscarClienteParaOnboarding: h.buscarClienteParaOnboarding,
  fetchClienteById: vi.fn(async () => null),
  fetchContratosByUnidades: vi.fn(async () => []),
  fetchReservasByUnidades: vi.fn(async () => []),
  fetchClientesForDedup: h.fetchClientesForDedup,
}))
vi.mock('../../../domain/clientes/mutations', () => ({
  updateCliente: vi.fn(), linkClienteToCompany: vi.fn(), addCompanyClientesLinks: vi.fn(async () => ({})),
  upsertCompanyClientesLinks: vi.fn(async () => ({})), setCompanyClienteActivo: vi.fn(),
  unlinkClienteFromCompany: vi.fn(),
  createContrato: vi.fn(), updateContrato: vi.fn(), deleteContrato: vi.fn(),
  createReserva: vi.fn(), updateReserva: vi.fn(), deleteReserva: vi.fn(),
}))
vi.mock('../../../domain/fiscal/mutations', () => ({ useRegimenFiscalQuery: () => ({ data: 'ninguno' }) }))
vi.mock('../../../lib/validatedInsert', () => ({
  validatedInsert: vi.fn(),
  validatedInsertMany: h.validatedInsertMany,
}))
vi.mock('../../../lib/security', () => ({ logSecurityEvent: vi.fn(async () => {}) }))
vi.mock('../../../lib/xlsx', () => ({ parseXlsxToObjects: h.parseXlsxToObjects, writeXlsx: vi.fn(async () => {}) }))

const { ClientesSection } = await import('../ClientesSection')
const { ImportClientesModal } = await import('../ImportClientesModal')

const ana = {
  id: 'cli-1', nombre: 'Ana María López de la Vega', codigo: 'CLI-001',
  email: 'ana.maria.lopez@correo-largo.com', telefono: '55551234', whatsapp: '55551234',
  direccion: 'Km 14.5 Carretera a El Salvador, Condado Concepción, casa 27',
  cui_dui: '1234567890101', nacionalidad: 'Guatemalteca', puede_crear_cuenta: true,
} as unknown as Cliente

function renderSection() {
  return render(
    <ClientesSection
      clientes={[ana]} unidades={[]} userId="u1" companyId="co1"
      onClienteAdded={() => {}} onClienteUpdated={() => {}} onClienteDeleted={() => {}}
    />,
  )
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockReset())
})
afterEach(cleanup)

describe('ClientesSection — tabla en tarjetas', () => {
  it('la tabla usa el layout de tarjetas y cada celda lleva su etiqueta', () => {
    const { container } = renderSection()
    const table = container.querySelector('table')!
    expect(table.classList.contains('table-cards-on-mobile')).toBe(true)

    const labels = Array.from(table.querySelectorAll('tbody td')).map(td => td.getAttribute('data-label'))
    expect(labels).toEqual(['Cliente', 'Código', 'Identificación', 'Contacto', 'Facturación', 'Cuenta', 'Rentas', 'Acciones'])

    // Secundarias: se ocultan en el teléfono para que la tarjeta quede compacta.
    expect(table.querySelector('td[data-label="Identificación"]')!.classList.contains('table-col-secondary')).toBe(true)
    expect(table.querySelector('td[data-label="Facturación"]')!.classList.contains('table-col-secondary')).toBe(true)
    expect(table.querySelector('td[data-label="Contacto"]')!.classList.contains('table-col-secondary')).toBe(false)
  })

  it('contacto es un solo bloque (si no, la fila flex de la tarjeta lo reparte) y las acciones siguen a mano', () => {
    const { container } = renderSection()
    const contacto = container.querySelector('td[data-label="Contacto"]')!
    expect(contacto.children).toHaveLength(1)
    expect(within(contacto as HTMLElement).getByText(/ana\.maria\.lopez@correo-largo\.com/)).toBeTruthy()

    const acciones = container.querySelector('td[data-label="Acciones"]') as HTMLElement
    expect(within(acciones).getByRole('button', { name: 'Editar' })).toBeTruthy()
    expect(within(acciones).getByRole('button', { name: 'Eliminar' })).toBeTruthy()
  })
})

describe('ClientesSection — ventanas a pantalla completa', () => {
  it('"Solicitar Cliente" es una ventana a pantalla completa que Escape cierra', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Cliente' }))
    const dialog = screen.getByRole('dialog', { name: 'Solicitar Cliente' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByLabelText('CUI / DUI *')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('mientras busca al cliente, ni Escape ni el fondo cierran la ventana', async () => {
    h.buscarClienteParaOnboarding.mockReturnValue(new Promise(() => {}))
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: '+ Nuevo Cliente' }))
    const dialog = screen.getByRole('dialog', { name: 'Solicitar Cliente' })
    fireEvent.change(within(dialog).getByLabelText('CUI / DUI *'), { target: { value: '1234567890101' } })
    fireEvent.change(within(dialog).getByLabelText('Fecha de Nacimiento *'), { target: { value: '1990-01-01' } })
    fireEvent.change(within(dialog).getByLabelText('Correo Electrónico *'), { target: { value: 'ana@correo.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Solicitar Cliente' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Buscando...' })).toBeTruthy())

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(dialog)
    expect(screen.getByRole('dialog', { name: 'Solicitar Cliente' })).toBeTruthy()
  })

  it('"Editar Cliente" y "Rentas" también ocupan toda la pantalla en el teléfono', async () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const editar = screen.getByRole('dialog', { name: 'Editar Cliente' })
    expect(editar.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((within(editar).getByLabelText('Nombre Completo *') as HTMLInputElement).value).toBe(ana.nombre)
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: /Sin unidades/ }))
    const rentas = await screen.findByRole('dialog', { name: `Rentas — ${ana.nombre}` })
    expect(rentas.classList.contains('at-modal--fs-mobile')).toBe(true)
  })
})

describe('ImportClientesModal — ventana del asistente de importación', () => {
  function renderImport(onClose = vi.fn()) {
    render(<ImportClientesModal existingClientes={[]} userId="u1" companyId="co1" onClose={onClose} onImportado={() => {}} />)
    return onClose
  }

  it('es un diálogo a pantalla completa en el teléfono y Escape lo cierra', () => {
    const onClose = renderImport()
    const dialog = screen.getByRole('dialog', { name: 'Importar clientes desde Excel' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(dialog).getByText('Descarga la plantilla, complétala y sube el archivo.')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('la zona de archivo se abre también con el teclado', () => {
    renderImport()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    try {
      const zona = screen.getByRole('button', { name: /Paso 2 — Arrastra tu archivo/ })
      fireEvent.keyDown(zona, { key: 'Enter' })
      expect(clickSpy).toHaveBeenCalledTimes(1)
    } finally {
      clickSpy.mockRestore()
    }
  })

  it('vista previa en tarjetas; durante la importación Escape y el fondo no la cierran', async () => {
    h.parseXlsxToObjects.mockResolvedValue([{ nombre: 'Ana López', codigo: 'CLI-009', email: 'ana@correo.com' }])
    h.fetchClientesForDedup.mockResolvedValue({ data: [], error: null })
    h.validatedInsertMany.mockReturnValue(new Promise(() => {}))
    const onClose = renderImport()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'clientes.xlsx')
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
    const tabla = await waitFor(() => {
      const t = document.querySelector('table')
      if (!t) throw new Error('sin vista previa')
      return t
    })
    expect(tabla.classList.contains('table-cards-on-mobile')).toBe(true)
    expect(Array.from(tabla.querySelectorAll('tbody td')).map(td => td.getAttribute('data-label')))
      .toEqual(['Fila', 'Nombre', 'Código', 'Email', 'Teléfono'])

    fireEvent.click(screen.getByRole('button', { name: 'Grabar 1 cliente nuevo' }))
    const dialog = screen.getByRole('dialog', { name: 'Importar clientes desde Excel' })
    expect(within(dialog).getByText('Importando clientes...')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })
})
