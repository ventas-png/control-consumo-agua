// Paquetería: el registro (entrantes y salidas) se hace en ventana —pantalla
// completa en el teléfono, sin cerrarse a mitad del guardado y conservando lo
// escrito si falla—, cada paquete abre su detalle en ventana con todas sus
// fotos, la firma y las acciones, y en la tarjeta de la lista queda sólo la
// acción del día a día. Devolver avisa si falla (antes no hacía nada).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { PaqueteRecibido, Unidad } from '../../../../types'

const mocks = vi.hoisted(() => ({
  createCondominioRowReturning: vi.fn(async (..._args: unknown[]) => ({ data: null as unknown, error: null as { message: string } | null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  deleteCondominioRow: vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null })),
  uploadCondominiosMedia: vi.fn(async (..._args: unknown[]) => ({ error: null as string | null })),
  avisarConReintento: vi.fn(async (..._args: unknown[]) => ({ estado: 'enviado' })),
  notify: vi.fn(),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
}))
vi.mock('../../../../domain/shared/storage', () => ({ uploadCondominiosMedia: mocks.uploadCondominiosMedia }))
vi.mock('../../avisoRecepcion', () => ({ avisarConReintento: mocks.avisarConReintento }))
vi.mock('../../exportUtils', () => ({ exportarExcel: vi.fn(), exportarPDFTabla: vi.fn() }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: ({ alt }: { alt?: string }) => <img alt={alt} /> }))
vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: ({ onSave, saveLabel, saving }: { onSave: (f: File) => void; saveLabel: string; saving?: boolean }) => (
    <button type="button" disabled={saving} onClick={() => onSave(new File(['x'], 'firma.png', { type: 'image/png' }))}>{saveLabel}</button>
  ),
}))

const { PaqueteriaTab } = await import('../PaqueteriaTab')
const { PaqueteriaSalientesTab } = await import('../PaqueteriaSalientesTab')

function paquete(over: Partial<PaqueteRecibido>): PaqueteRecibido {
  return {
    id: 'x', company_id: 'co1', project_id: 'pr1', unidad_id: 'u1', clase: 'paquete', destinatario_tipo: 'unidad', prioridad: 'normal',
    descripcion: 'Paquete', tipo: 'paquete', estado: 'pendiente', direccion: 'entrante', recibido_por: 'g1',
    hora_recepcion: '2026-10-20T15:00:00Z', created_at: '2026-10-20T15:00:00Z', unidad_nombre: 'A-101',
    ...over,
  } as PaqueteRecibido
}

const unidades = [
  { id: 'u1', nombre: 'A-101', activo: true },
  { id: 'u2', nombre: 'B-202', activo: false },
] as unknown as Unidad[]

const entrantes = [
  paquete({ id: 'e1', descripcion: 'Caja Amazon', remitente: 'Amazon', num_guia: 'TBA123', empresa_mensajeria: 'Amazon Logistics',
    notas: 'Frágil', fotos: ['f1.jpg', 'f2.jpg', 'f3.jpg'] }),
  paquete({ id: 'e2', descripcion: 'Sobre TIGO', tipo: 'sobre', estado: 'entregado', firma_path: 'firma.png',
    entregado_a_nombre: 'Ana López', entregado_via: 'porteria', hora_entrega: '2026-10-21T16:00:00Z' }),
]

function propsEntrantes(over: Partial<Parameters<typeof PaqueteriaTab>[0]> = {}): Parameters<typeof PaqueteriaTab>[0] {
  return {
    paquetes: entrantes, correspondencia: [], unidades, proyectoId: 'pr1', companyId: 'co1', userId: 'g1',
    canCreate: true, canEdit: true, canDelete: true, puedeVerCorrespondencia: false, onRefresh: vi.fn(), ...over,
  }
}

function esperar<T>() {
  let resolver!: (v: T) => void
  const promesa = new Promise<T>(res => { resolver = res })
  return { promesa, resolver }
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/condominios/paqueteria')
  mocks.createCondominioRowReturning.mockResolvedValue({ data: null, error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.uploadCondominiosMedia.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
})
afterEach(cleanup)

describe('Paquetería entrantes — registro en ventana', () => {
  it('abre a pantalla completa, registra y no se cierra mientras guarda', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaTab {...propsEntrantes({ onRefresh })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ Registrar paquete' }))
    const ventana = screen.getByRole('dialog', { name: '📦 Registrar paquete recibido' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Sólo las unidades activas.
    expect(Array.from((screen.getByLabelText('Unidad destinataria *') as HTMLSelectElement).options).map(o => o.textContent)).toEqual(['Seleccionar...', 'A-101'])

    fireEvent.change(screen.getByLabelText('Descripción *'), { target: { value: 'Caja DHL' } })
    fireEvent.change(screen.getByLabelText('Unidad destinataria *'), { target: { value: 'u1' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'documento' } })
    fireEvent.change(screen.getByLabelText('No. de guía'), { target: { value: 'DHL-9' } })

    const guardado = esperar<{ data: unknown; error: null }>()
    mocks.createCondominioRowReturning.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar recepción/ }))
    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('paquetes_recibidos', expect.objectContaining({
      unidad_id: 'u1', descripcion: 'Caja DHL', tipo: 'documento', num_guia: 'DHL-9', direccion: 'entrante', estado: 'pendiente',
    }))

    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(ventana).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '📦 Registrar paquete recibido' })).toBeTruthy()

    guardado.resolver({ data: { id: 'n1' }, error: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
    expect(mocks.avisarConReintento).toHaveBeenCalledWith('n1')
  })

  it('sin unidad avisa; si falla el guardado, conserva lo escrito; Cancelar tampoco lo borra', async () => {
    render(<PaqueteriaTab {...propsEntrantes()} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar paquete' }))
    fireEvent.change(screen.getByLabelText('Descripción *'), { target: { value: 'Caja DHL' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar recepción/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Seleccione la unidad destinataria.' })))
    expect(mocks.createCondominioRowReturning).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Unidad destinataria *'), { target: { value: 'u1' } })
    mocks.createCondominioRowReturning.mockResolvedValueOnce({ data: null, error: { message: 'Sin conexión' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar recepción/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect((screen.getByLabelText('Descripción *') as HTMLInputElement).value).toBe('Caja DHL')

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar paquete' }))
    expect((screen.getByLabelText('Descripción *') as HTMLInputElement).value).toBe('Caja DHL')
  })

  it('el selector de vista dice cuál está activa', () => {
    render(<PaqueteriaTab {...propsEntrantes()} />)
    expect(screen.getByRole('button', { name: '📥 Entrantes' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '📤 Salidas (retiro por tercero)' }))
    expect(screen.getByRole('button', { name: '📤 Salidas (retiro por tercero)' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '📥 Entrantes' }).getAttribute('aria-pressed')).toBe('false')
  })
})

describe('Paquetería entrantes — lista y detalle', () => {
  it('la tarjeta lleva el estado, «Entregar» y «Ver»; el resto de acciones vive en el detalle', () => {
    render(<PaqueteriaTab {...propsEntrantes()} />)
    expect(screen.getByRole('button', { name: 'Entregar Caja Amazon' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Entregar Sobre TIGO' })).toBeNull() // ya entregado
    for (const accion of [/Entregar sin firma/, /Devolver/, /Avisar/, /^Eliminar/]) {
      expect(screen.queryByRole('button', { name: accion })).toBeNull()
    }

    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    const detalle = screen.getByRole('dialog', { name: '📦 Caja Amazon' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Todas las fotos (la lista sólo muestra la primera), guía y notas.
    expect(within(detalle).getAllByRole('img', { name: /^Foto \d del paquete$/ })).toHaveLength(3)
    expect(within(detalle).getByText('TBA123')).toBeTruthy()
    expect(within(detalle).getByText('Frágil')).toBeTruthy()
    for (const accion of ['💬 Avisar por WhatsApp', '✓ Entregar sin firma', '↩ Devolver al remitente', 'Eliminar Caja Amazon', '✍ Entregar con firma']) {
      expect(within(detalle).getByRole('button', { name: accion })).toBeTruthy()
    }
  })

  it('tocar la tarjeta abre el detalle; uno entregado muestra quién recibió y la firma, sin acciones de entrega', () => {
    render(<PaqueteriaTab {...propsEntrantes({ canDelete: false })} />)
    fireEvent.click(screen.getByText('Sobre TIGO'))
    const detalle = screen.getByRole('dialog', { name: '✉️ Sobre TIGO' })
    expect(within(detalle).getByText('Ana López')).toBeTruthy()
    expect(within(detalle).getByText('En portería')).toBeTruthy()
    expect(within(detalle).getByRole('img', { name: 'Firma de entrega' })).toBeTruthy()
    expect(within(detalle).queryByText('Otras acciones')).toBeNull()
    expect(within(detalle).queryByRole('button', { name: /Entregar/ })).toBeNull()
  })

  it('entregar sin firma no se repite con un segundo toque y avisa si falla', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaTab {...propsEntrantes({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    const entrega = esperar<{ error: { message: string } | null }>()
    mocks.updateCondominioRow.mockReturnValueOnce(entrega.promesa)
    const boton = within(screen.getByRole('dialog')).getByRole('button', { name: '✓ Entregar sin firma' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 'e1', expect.objectContaining({ estado: 'entregado', entregado_via: 'porteria' }))

    entrega.resolver({ error: { message: 'Permiso denegado' } })
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Permiso denegado' })))
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('devolver avisa si falla (antes no hacía nada) y, si sale bien, refresca', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaTab {...propsEntrantes({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '↩ Devolver al remitente' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 'e1', { estado: 'devuelto' })
    expect(onRefresh).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '↩ Devolver al remitente' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('«Entregar» abre la firma a pantalla completa y registra quién recibe', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaTab {...propsEntrantes({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Entregar Caja Amazon' }))
    const firma = screen.getByRole('dialog', { name: 'Firmar entrega · A-101' })
    expect(firma.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.change(within(firma).getByLabelText('Nombre de quien recibe'), { target: { value: 'Luis Pérez' } })
    fireEvent.click(within(firma).getByRole('button', { name: 'Confirmar entrega' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 'e1', expect.objectContaining({
      estado: 'entregado', entregado_a_nombre: 'Luis Pérez', firma_path: expect.any(String), entregado_via: 'porteria',
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('desde el detalle, la firma se abre encima y Escape cierra sólo la de arriba', () => {
    render(<PaqueteriaTab {...propsEntrantes()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '✍ Entregar con firma' }))
    expect(screen.getByRole('dialog', { name: 'Firmar entrega · A-101' })).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: '📦 Caja Amazon' })).toBeTruthy()
  })

  it('eliminar desde el detalle pide confirmación, borra y cierra la ventana', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaTab {...propsEntrantes({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Eliminar Caja Amazon' }))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 'e1'))
    expect(mocks.confirm).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onRefresh).toHaveBeenCalled()
  })

  it('con eliminar pero sin editar, el detalle ofrece Eliminar y ninguna entrega', () => {
    render(<PaqueteriaTab {...propsEntrantes({ canEdit: false, canDelete: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    const detalle = screen.getByRole('dialog')
    expect(within(detalle).getByRole('button', { name: 'Eliminar Caja Amazon' })).toBeTruthy()
    expect(within(detalle).queryByRole('button', { name: /Entregar|Devolver|Avisar/ })).toBeNull()
  })

  it('sin permiso de editar no hay entregas en la tarjeta ni en el detalle', () => {
    render(<PaqueteriaTab {...propsEntrantes({ canEdit: false, canDelete: false, canCreate: false })} />)
    expect(screen.queryByRole('button', { name: '+ Registrar paquete' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Entregar / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ver Caja Amazon' }))
    const detalle = screen.getByRole('dialog')
    expect(within(detalle).queryByText('Otras acciones')).toBeNull()
    expect(within(detalle).queryByRole('button', { name: /Entregar/ })).toBeNull()
  })
})

// ── Salidas (retiro por tercero) ─────────────────────────────────────────────

const salidas = [
  paquete({ id: 's1', direccion: 'saliente_tercero', descripcion: 'Llaves', recibido_por: null, codigo_retiro: 'ABCD2345', autorizado_nombre: 'Juan Pérez' }),
  paquete({ id: 's2', direccion: 'saliente_tercero', descripcion: 'Sobre legal', tipo: 'sobre', codigo_retiro: 'WXYZ6789', autorizado_nombre: 'Marta Ruiz', autorizado_documento: 'DPI 123',
    fotos: ['s2.jpg'] }),
  paquete({ id: 's3', direccion: 'saliente_tercero', descripcion: 'Bolsa', estado: 'entregado', codigo_retiro: 'QQQQ2222', autorizado_nombre: 'Rosa',
    entregado_a_nombre: 'Rosa Gómez', hora_entrega: '2026-10-21T16:00:00Z', firma_path: 'firma2.png' }),
]

function propsSalidas(over: Partial<Parameters<typeof PaqueteriaSalientesTab>[0]> = {}): Parameters<typeof PaqueteriaSalientesTab>[0] {
  return { paquetes: salidas, unidades, proyectoId: 'pr1', companyId: 'co1', userId: 'g1', canCreate: true, canEdit: true, canDelete: true, onRefresh: vi.fn(), ...over }
}

describe('Paquetería salidas — registro en ventana', () => {
  it('pide a quién se autoriza; al registrar cierra y muestra el código', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaSalientesTab {...propsSalidas({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar salida' }))
    const ventana = screen.getByRole('dialog', { name: '📤 Registrar salida para retiro por tercero' })
    expect(ventana.classList.contains('at-modal--fs-mobile')).toBe(true)
    fireEvent.change(screen.getByLabelText('Descripción *'), { target: { value: 'Documentos' } })
    fireEvent.change(screen.getByLabelText('Unidad del residente *'), { target: { value: 'u1' } })
    fireEvent.click(within(ventana).getByRole('button', { name: /Registrar y generar código/ }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ text: 'Indique a quién se autoriza el retiro.' })))
    expect(screen.getByRole('dialog', { name: '📤 Registrar salida para retiro por tercero' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Autorizado a retirar *'), { target: { value: 'Pedro Gil' } })
    const guardado = esperar<{ data: unknown; error: null }>()
    mocks.createCondominioRowReturning.mockReturnValueOnce(guardado.promesa)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Registrar y generar código/ }))
    // Mientras guarda, ni Escape ni la X la cierran.
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(screen.getByRole('dialog')).getByLabelText('Cerrar modal'))
    expect(screen.getByRole('dialog', { name: '📤 Registrar salida para retiro por tercero' })).toBeTruthy()

    guardado.resolver({
      data: { id: 'n2', descripcion: 'Documentos', codigo_retiro: 'MNOP3456', autorizado_nombre: 'Pedro Gil', unidades: { nombre: 'A-101' } }, error: null,
    })
    const codigo = await screen.findByRole('dialog', { name: 'Código de retiro' })
    expect(within(codigo).getByText('MNOP3456')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: /Registrar salida/ })).toBeNull()
    expect(mocks.createCondominioRowReturning).toHaveBeenCalledWith('paquetes_recibidos', expect.objectContaining({
      direccion: 'saliente_tercero', autorizado_nombre: 'Pedro Gil', descripcion: 'Documentos',
    }), '*, unidades(nombre)')
    expect(onRefresh).toHaveBeenCalled()
  })
})

describe('Paquetería salidas — lista y detalle', () => {
  it('cada tarjeta dice en qué punto está y ofrece la siguiente acción', () => {
    render(<PaqueteriaSalientesTab {...propsSalidas()} />)
    const tarjeta = (texto: string) => screen.getByText(texto).closest('.cond-kpi-link')!.textContent
    expect(tarjeta('Llaves')).toContain('Sin depositar')
    expect(tarjeta('Sobre legal')).toContain('En custodia')
    expect(tarjeta('Bolsa')).toContain('Retirado')
    expect(screen.getByRole('button', { name: 'Confirmar custodia de Llaves' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Entregar Sobre legal a tercero' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Bolsa a tercero|custodia de Bolsa/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Devolver|Ver código/ })).toBeNull()
  })

  it('confirmar custodia no se repite con un segundo toque', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaSalientesTab {...propsSalidas({ onRefresh })} />)
    const custodia = esperar<{ error: null }>()
    mocks.updateCondominioRow.mockReturnValueOnce(custodia.promesa)
    const boton = screen.getByRole('button', { name: 'Confirmar custodia de Llaves' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1)
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 's1', expect.objectContaining({ recibido_por: 'g1' }))
    custodia.resolver({ error: null })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('el detalle muestra el código con su QR encima, y devolver avisa si falla', async () => {
    const onRefresh = vi.fn()
    render(<PaqueteriaSalientesTab {...propsSalidas({ onRefresh })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Sobre legal' }))
    const detalle = screen.getByRole('dialog', { name: '✉️ Sobre legal' })
    expect(detalle.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect(within(detalle).getByText('WXYZ6789')).toBeTruthy()
    expect(within(detalle).getByText('DPI 123')).toBeTruthy()
    expect(within(detalle).getAllByRole('img', { name: /^Foto \d del paquete$/ })).toHaveLength(1)

    fireEvent.click(within(detalle).getByRole('button', { name: '📲 Ver QR' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Código de retiro' })).getByRole('button', { name: 'Listo' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'Sin conexión' } })
    fireEvent.click(within(detalle).getByRole('button', { name: '↩ Devolver al residente' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', text: 'Sin conexión' })))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 's2', { estado: 'devuelto' })
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('entregar a tercero valida el código antes de registrar la firma', async () => {
    render(<PaqueteriaSalientesTab {...propsSalidas()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Entregar Sobre legal a tercero' }))
    const entrega = screen.getByRole('dialog', { name: 'Entregar a tercero · A-101' })
    expect(entrega.classList.contains('at-modal--fs-mobile')).toBe(true)
    expect((within(entrega).getByLabelText('Nombre de quien retira') as HTMLInputElement).value).toBe('Marta Ruiz')

    fireEvent.change(within(entrega).getByLabelText('Código de retiro *'), { target: { value: 'MAL00000' } })
    fireEvent.click(within(entrega).getByRole('button', { name: 'Validar y entregar' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Código incorrecto' })))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()

    fireEvent.change(within(entrega).getByLabelText('Código de retiro *'), { target: { value: 'wxyz6789' } })
    fireEvent.click(within(entrega).getByRole('button', { name: 'Validar y entregar' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('paquetes_recibidos', 's2', expect.objectContaining({
      estado: 'entregado', entregado_a_nombre: 'Marta Ruiz',
    })))
  })

  it('una salida retirada muestra quién la retiró y la firma, sin acciones', () => {
    render(<PaqueteriaSalientesTab {...propsSalidas({ canDelete: false })} />)
    fireEvent.click(screen.getByText('Bolsa'))
    const detalle = screen.getByRole('dialog', { name: '📦 Bolsa' })
    expect(within(detalle).getByText('Rosa Gómez')).toBeTruthy()
    expect(within(detalle).getByRole('img', { name: 'Firma de entrega' })).toBeTruthy()
    expect(within(detalle).queryByText('QQQQ2222')).toBeNull() // el código ya no sirve
    expect(within(detalle).queryByText('Otras acciones')).toBeNull()
  })
})
