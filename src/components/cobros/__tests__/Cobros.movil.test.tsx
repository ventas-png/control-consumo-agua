// Cobros en el teléfono: las ventanas de pago y convenio son la EditModal
// compartida a pantalla completa y no se cierran a mitad del guardado; la tabla
// de cargos pendientes se lee como tarjetas (rótulo por celda, acciones al pie)
// y, en ese modo, «seleccionar todo» sigue disponible fuera del <thead> oculto.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Registro, Cliente, FormaPago, UserSession } from '../../../types'

const h = vi.hoisted(() => ({
  createPago: vi.fn(),
  createConvenio: vi.fn(),
  registrarPagoRegistro: vi.fn(),
  marcarRegistrosMora: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => {
  const cadena: unknown = new Proxy(function () {} as unknown as object, {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      return () => cadena
    },
    apply: () => cadena,
  })
  return { supabase: { from: () => cadena, rpc: () => cadena }, db: { from: () => cadena, rpc: () => cadena } }
})
vi.mock('../../../lib/storageUrls', () => ({ useSignedUrl: () => null }))
vi.mock('../../../domain/cobros/queries', () => ({
  fetchPagosYConvenios: vi.fn(async () => ({ pagos: [], convenios: [] })),
  esCobroDeCargoAdicional: (p: { cargo_adicional_id?: string | null }) => p.cargo_adicional_id != null,
}))
vi.mock('../../../domain/cobros/mutations', () => ({
  createPago: h.createPago,
  createConvenio: h.createConvenio,
  verifyPago: vi.fn(),
  rejectPago: vi.fn(),
  setConvenioEstado: vi.fn(),
}))
vi.mock('../../../domain/agua/mutations', () => ({
  registrarPagoRegistro: h.registrarPagoRegistro,
  marcarRegistrosMora: h.marcarRegistrosMora,
}))
vi.mock('../../shared/Dialog', () => ({
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

const { PagoModal } = await import('../PagoModal')
const { ConvenioModal } = await import('../ConvenioModal')
const { CobrosSection } = await import('../CobrosSection')
const { SessionProvider } = await import('../../shared/SessionContext')
const { PermissionsProvider } = await import('../../shared/PermissionsContext')

const formas = {
  efectivo: 'Efectivo', transferencia: 'Transferencia', deposito: 'Depósito',
  tarjeta_credito: 'Tarjeta Crédito', tarjeta_debito: 'Tarjeta Débito', cheque: 'Cheque',
  convenio_pago: 'Convenio', otro: 'Otro',
} as Record<FormaPago, string>

const clientes = [
  { id: 'cli-1', nombre: 'Ana', codigo: 'CL-001' },
  { id: 'cli-2', nombre: 'Beto', codigo: 'CL-002' },
] as unknown as Cliente[]

function registro(id: string, over: Partial<Registro> = {}): Registro {
  return {
    id, cliente_id: 'cli-1', cliente_nombre: 'Ana', fecha: '2026-08-01',
    lectura_anterior: 0, lectura_actual: 10, consumo: 10,
    tarifa_aplicada: 25, canon_aplicado: 20, monto_calculado: 100,
    monto_pagado: 0, estado: 'pendiente', mes: 'Agosto 2026',
    ...over,
  } as unknown as Registro
}

/** Simula el corte ≤480px (tarjetas). Sin esto jsdom no tiene matchMedia. */
function simularTelefono() {
  window.matchMedia = vi.fn((q: string) => ({
    matches: q === '(max-width: 480px)', media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const matchMediaOriginal = window.matchMedia

beforeEach(() => {
  cleanup()
  Object.values(h).forEach(fn => fn.mockReset())
  h.registrarPagoRegistro.mockResolvedValue({ data: { estado: 'pagado', monto_pagado: 100 }, error: null })
  h.marcarRegistrosMora.mockResolvedValue({ error: null })
})
afterEach(() => {
  cleanup()
  window.matchMedia = matchMediaOriginal
})

describe('PagoModal en el teléfono', () => {
  function renderPago(onClose = vi.fn()) {
    render(
      <PagoModal
        registro={registro('r1')} cliente={clientes[0]} moneda="Q" currentUserId="u1"
        formasPagoLabels={formas} onClose={onClose} onSuccess={vi.fn()}
      />,
    )
    return onClose
  }

  it('es la ventana compartida a pantalla completa, con campos rotulados, y Esc la cierra', () => {
    const onClose = renderPago()
    const dialog = screen.getByRole('dialog', { name: '💰 Aplicar Pago' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((screen.getByLabelText(/Monto a Aplicar/) as HTMLInputElement).value).toBe('100.00')
    expect(screen.getByLabelText(/Forma de Pago/)).toBeDefined()
    expect(screen.getByLabelText(/Número de Documento/)).toBeDefined()
    expect(screen.getByLabelText(/Referencia \/ Banco/)).toBeDefined()
    expect(screen.getByLabelText(/Notas/)).toBeDefined()
    expect(screen.getByRole('group', { name: 'Tipo de Aplicación' })).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mientras registra el pago no se puede cerrar (Esc, ×, fondo ni Cancelar)', async () => {
    h.createPago.mockReturnValue(new Promise(() => {})) // cobro en curso
    const onClose = renderPago()
    fireEvent.click(screen.getByRole('button', { name: /Confirmar Pago/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Guardando/ })).toBeDefined())
    expect(h.createPago).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('Cerrar modal'))
    fireEvent.click(screen.getByRole('dialog'))
    const cancelar = screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement
    expect(cancelar.disabled).toBe(true)
    fireEvent.click(cancelar)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeDefined()
  })
})

describe('ConvenioModal en el teléfono', () => {
  function renderConvenio(onClose = vi.fn()) {
    render(
      <ConvenioModal
        registros={[registro('r1'), registro('r2', { monto_pagado: 40 })]} clientes={clientes}
        moneda="Q" currentUserId="u1" companyId="emp-1" onClose={onClose} onSuccess={vi.fn()}
      />,
    )
    return onClose
  }

  it('es la ventana compartida a pantalla completa y Esc la cierra', () => {
    const onClose = renderConvenio()
    const dialog = screen.getByRole('dialog', { name: '🤝 Crear Convenio de Pago' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Saldo, no cargo bruto: 100 + (100 - 40).
    expect(within(dialog).getByText('Total: Q 160.00')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('mientras crea el convenio no se puede cerrar', async () => {
    h.createConvenio.mockReturnValue(new Promise(() => {}))
    const onClose = renderConvenio()
    fireEvent.click(screen.getByRole('button', { name: /Crear Convenio/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Creando/ })).toBeDefined())

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('Cerrar modal'))
    fireEvent.click(screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(h.marcarRegistrosMora).not.toHaveBeenCalled()
  })
})

describe('CobrosSection — cargos pendientes como tarjetas', () => {
  const currentUser = { user_id: 'u1', company_id: 'emp-1', role: 'admin', name: 'Admin' } as unknown as UserSession
  const registros = [
    registro('r1', { cliente_id: 'cli-1', cliente_nombre: 'Ana' }),
    registro('r2', { cliente_id: 'cli-2', cliente_nombre: 'Beto', estado: 'mora', monto_pagado: 30 }),
  ]

  async function renderSection() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await act(async () => {
      render(
        <QueryClientProvider client={qc}>
          <SessionProvider value={currentUser}>
            <PermissionsProvider>
              <CobrosSection registros={registros} clientes={clientes} moneda="Q" onEstadoUpdated={vi.fn()} />
            </PermissionsProvider>
          </SessionProvider>
        </QueryClientProvider>,
      )
    })
  }

  const fila = (id: string) => document.querySelector(`tr[data-registro-id="${id}"]`) as HTMLTableRowElement

  it('cada celda lleva su rótulo y las acciones van en la celda sin rótulo (al pie)', async () => {
    await renderSection()
    expect(document.querySelector('table')?.classList.contains('table-cards-on-mobile')).toBe(true)

    const tr = fila('r2')
    const rotulos = [...tr.querySelectorAll('td[data-label]')].map(td => td.getAttribute('data-label'))
    expect(rotulos).toEqual(['Seleccionar', 'Cliente', 'Fecha', 'Cargo (Q)', 'Abonado', 'Saldo', 'Estado', 'Factura'])
    expect(tr.querySelector('td[data-label="Cliente"]')?.textContent).toBe('BetoCL-002')
    expect(tr.querySelector('td[data-label="Saldo"]')?.textContent).toBe('70.00')
    expect(tr.querySelector('td[data-label="Estado"]')?.textContent).toContain('Mora')

    // La única celda sin rótulo es la última: el pie de la tarjeta con las acciones.
    const sinRotulo = tr.querySelectorAll('td:not([data-label])')
    expect(sinRotulo).toHaveLength(1)
    expect(tr.lastElementChild).toBe(sinRotulo[0])
    const acciones = within(sinRotulo[0] as HTMLElement)
    expect(acciones.getByRole('button', { name: /Aplicar Pago/ })).toBeDefined()
    expect(acciones.getByRole('button', { name: /Anular/ })).toBeDefined()
  })

  it('en escritorio la tabla conserva su caja con scroll y no duplica «seleccionar todo»', async () => {
    await renderSection()
    expect(document.querySelector('.table-scroll-wrapper table')).not.toBeNull()
    expect(screen.queryByText(/Seleccionar todo \(/)).toBeNull()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('en tarjetas «seleccionar todo» sale de la tabla y marca todas las filas', async () => {
    simularTelefono()
    await renderSection()
    // Sin el degradado de scroll: caía sobre el borde de las tarjetas.
    expect(document.querySelector('.table-scroll-wrapper')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByText('Seleccionar todo (2)')) })
    const filas = registros.map(r => within(fila(r.id)).getByRole('checkbox') as HTMLInputElement)
    expect(filas.every(c => c.checked)).toBe(true)
    expect(screen.getByRole('toolbar', { name: /2 cargos seleccionados/ })).toBeDefined()
    expect(screen.getByText('Deseleccionar todo (2)')).toBeDefined()

    // Una casilla de tarjeta sigue funcionando por sí sola.
    await act(async () => { fireEvent.click(filas[0]) })
    expect(filas[0].checked).toBe(false)
    expect(screen.getByRole('toolbar', { name: /1 cargo seleccionado/ })).toBeDefined()
  })

  it('«Aplicar Pago» desde la tarjeta abre la ventana a pantalla completa', async () => {
    simularTelefono()
    await renderSection()
    fireEvent.click(within(fila('r2')).getByRole('button', { name: /Aplicar Pago/ }))
    const dialog = screen.getByRole('dialog', { name: '💰 Aplicar Pago' })
    expect(dialog.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((within(dialog).getByLabelText(/Monto a Aplicar/) as HTMLInputElement).value).toBe('70.00')
  })
})
