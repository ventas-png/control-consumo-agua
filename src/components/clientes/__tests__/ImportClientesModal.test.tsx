// Importar clientes desde Excel: lo que ya existe no se reimporta ni se
// "vincula" (antes se contaba como importado y se volvía a agregar a la
// lista); un código o CUI/DUI ya usado en otra empresa —invisible por RLS— ya
// no tumba el lote entero; y la ventana termina en un resumen que antes nunca
// se veía porque la sección la cerraba al acabar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import type { Cliente } from '../../../types'

const h = vi.hoisted(() => ({
  buscarClienteParaOnboarding: vi.fn(),
  fetchClientesForDedup: vi.fn(),
  parseXlsxToObjects: vi.fn(),
  validatedInsertMany: vi.fn(),
  notify: vi.fn(),
  addCompanyClientesLinks: vi.fn(async () => ({})),
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
  updateCliente: vi.fn(), linkClienteToCompany: vi.fn(), addCompanyClientesLinks: h.addCompanyClientesLinks,
  upsertCompanyClientesLinks: vi.fn(async () => ({})), setCompanyClienteActivo: vi.fn(),
  unlinkClienteFromCompany: vi.fn(),
  createContrato: vi.fn(), updateContrato: vi.fn(), deleteContrato: vi.fn(),
  createReserva: vi.fn(), updateReserva: vi.fn(), deleteReserva: vi.fn(),
}))
vi.mock('../../../domain/fiscal/mutations', () => ({ useRegimenFiscalQuery: () => ({ data: 'ninguno' }) }))
vi.mock('../../../lib/validatedInsert', () => ({
  validatedInsert: vi.fn(),
  validatedInsertMany: h.validatedInsertMany,
  isValidationError: () => false,
}))
vi.mock('../../../lib/security', () => ({ logSecurityEvent: vi.fn(async () => {}) }))
vi.mock('../../../lib/xlsx', () => ({ parseXlsxToObjects: h.parseXlsxToObjects, writeXlsx: vi.fn(async () => {}) }))

const { ClientesSection } = await import('../ClientesSection')
const { ImportClientesModal } = await import('../ImportClientesModal')

const ana = { id: 'cli-1', nombre: 'Ana López', codigo: 'CLI-001', cui_dui: '1234567890101' } as unknown as Cliente

const DUPLICADO = { code: '23505', message: 'duplicate key value violates unique constraint "clientes_cui_dui_unique"' }

async function subirArchivo(filas: Record<string, string>[]) {
  h.parseXlsxToObjects.mockResolvedValue(filas)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await act(async () => { fireEvent.change(input, { target: { files: [new File(['x'], 'clientes.xlsx')] } }) })
  await screen.findByRole('button', { name: /Grabar|No hay clientes nuevos/ })
}

function renderImport(props: Partial<Parameters<typeof ImportClientesModal>[0]> = {}) {
  const onImportado = vi.fn()
  const onClose = vi.fn()
  render(<ImportClientesModal existingClientes={[ana]} userId="u1" companyId="co1" onClose={onClose} onImportado={onImportado} {...props} />)
  return { onImportado, onClose }
}

beforeEach(() => {
  Object.values(h).forEach(m => m.mockReset())
  h.fetchClientesForDedup.mockResolvedValue({ data: [ana], error: null })
  h.validatedInsertMany.mockResolvedValue({ data: null, error: null })
  h.addCompanyClientesLinks.mockResolvedValue({})
})
afterEach(cleanup)

describe('ImportClientesModal', () => {
  it('lo que ya está en tu lista no se graba, no se cuenta ni se vuelve a agregar', async () => {
    const { onImportado, onClose } = renderImport()
    await subirArchivo([
      { nombre: 'Ana López', codigo: 'CLI-001' },
      { nombre: 'Pedro Gómez', codigo: 'CLI-050' },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Ya registrados \(1\)/ }))
    expect(screen.getByText(/código "CLI-001" ya está en tu lista de clientes/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Grabar 1 cliente nuevo' }))
    await screen.findByText('1 cliente importado correctamente')

    expect(h.validatedInsertMany).toHaveBeenCalledTimes(1)
    expect((h.validatedInsertMany.mock.calls[0][2] as { codigo: string }[]).map(c => c.codigo)).toEqual(['CLI-050'])
    expect(onImportado).toHaveBeenCalledTimes(1)
    expect((onImportado.mock.calls[0][0] as Cliente[]).map(c => c.codigo)).toEqual(['CLI-050'])
    expect(screen.getByText(/1 ya registrado \(sin cambios\)/)).toBeTruthy()
    // La ventana se queda con el resumen hasta que el usuario la cierra.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('sin filas nuevas no hay nada que grabar', async () => {
    renderImport()
    await subirArchivo([{ nombre: 'Ana López', codigo: 'CLI-001' }])
    expect((screen.getByRole('button', { name: 'No hay clientes nuevos que grabar' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('un CUI/DUI ya usado en otra empresa no tumba el lote: se graba el resto y solo esa fila se rechaza', async () => {
    h.validatedInsertMany.mockImplementation(async (_t: string, _s: unknown, lote: { codigo: string }[]) =>
      lote.length > 1 || lote[0].codigo === 'CLI-101' ? { data: null, error: DUPLICADO } : { data: null, error: null })
    const { onImportado } = renderImport()
    await subirArchivo([
      { nombre: 'Rosa Pérez', codigo: 'CLI-100' },
      { nombre: 'Luis Díaz', codigo: 'CLI-101', cui_dui: '9999999999999' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Grabar 2 clientes nuevos' }))
    await screen.findByText('1 cliente importado correctamente')

    expect((onImportado.mock.calls[0][0] as Cliente[]).map(c => c.codigo)).toEqual(['CLI-100'])
    expect(h.addCompanyClientesLinks).toHaveBeenCalledTimes(1)
    expect(screen.getByText('⚠️ 1 rechazado')).toBeTruthy()
    const fila = screen.getByText('Luis Díaz').closest('tr')!
    expect(within(fila).getByText(/Solicitar Cliente/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Descargar errores \(1\)/ })).toBeTruthy()
  })

  it('un error que no es de duplicado corta la importación, pero informa lo ya grabado', async () => {
    let lote = 0
    h.validatedInsertMany.mockImplementation(async () => (++lote === 1
      ? { data: null, error: null }
      : { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }))
    const { onImportado } = renderImport()
    await subirArchivo(Array.from({ length: 101 }, (_, i) => ({ nombre: `Cliente ${i}`, codigo: `CLN-${i + 100}` })))
    fireEvent.click(screen.getByRole('button', { name: 'Grabar 101 clientes nuevos' }))
    await screen.findByText('100 clientes importados correctamente')

    expect((onImportado.mock.calls[0][0] as Cliente[])).toHaveLength(100)
    const alerta = screen.getByRole('alert')
    expect(alerta.textContent).toMatch(/La importación se detuvo: Su usuario no tiene permisos/)
    expect(alerta.textContent).toMatch(/Los 100 clientes anteriores sí se grabaron/)
  })
})

describe('ClientesSection — importar', () => {
  it('al terminar no cierra la ventana: queda el resumen y los nuevos se agregan a la lista', async () => {
    const onClienteAdded = vi.fn()
    render(
      <ClientesSection clientes={[ana]} unidades={[]} userId="u1" companyId="co1"
        onClienteAdded={onClienteAdded} onClienteUpdated={() => {}} onClienteDeleted={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Importar Excel/ }))
    await screen.findByRole('dialog', { name: 'Importar clientes desde Excel' })
    await subirArchivo([{ nombre: 'Pedro Gómez', codigo: 'CLI-050' }])
    fireEvent.click(screen.getByRole('button', { name: 'Grabar 1 cliente nuevo' }))
    await screen.findByText('1 cliente importado correctamente')

    expect(onClienteAdded).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Importar clientes desde Excel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Importar clientes desde Excel' })).toBeNull())
  })
})
