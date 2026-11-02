// Flujo guiado: se abre en un menú con tres botones grandes (sin indicador numerado) que dice
// qué hay registrado en cada parte; cada parte guarda los textos con «Guardar y regresar» y
// vuelve al menú; cerrar la ventana guarda antes lo escrito sin guardar; «Guardar y dar por
// finalizado» (todo o nada: textos → estado completado exigiendo una fila) muestra la hora de
// finalización y pregunta cómo notificar: correo llama a la RPC, teléfono abre wa.me, «Ahora
// no» no hace nada; un servicio completado se abre en solo lectura con «Notificar informe».
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type { FotoHousekeeping, ServicioHousekeeping } from '../../../../types'

const mocks = vi.hoisted(() => ({
  updateCondominioRow: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string } })),
  updateCondominioRowAfectando: vi.fn(async (_t: string, _id: string, _p: Record<string, unknown>) => ({ error: null as null | { message: string; code?: string } })),
  listarFotosServicio: vi.fn(async (_id: string) => ({ data: [] as FotoHousekeeping[], error: null as string | null })),
  subirFotoServicio: vi.fn(), eliminarFotoServicio: vi.fn(),
  notificarInformeHousekeeping: vi.fn(async (_id: string, _o: unknown) => ({ data: { encolados: 2, destinatarios: ['d@x.test', 'a@x.test'], extra: false }, error: null as string | null })),
  openPromptDialog: vi.fn(async (_o: unknown) => null as Record<string, string> | null),
  generarPdf: vi.fn(async () => new Blob(['pdf'])),
  compartir: vi.fn(async () => false),
  notify: vi.fn(),
  confirm: vi.fn(async (_o: unknown) => ({ isConfirmed: false })),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}), rpc: () => ({}), storage: { from: () => ({}) } }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ updateCondominioRow: mocks.updateCondominioRow, updateCondominioRowAfectando: mocks.updateCondominioRowAfectando }))
vi.mock('../../../../domain/condominios/housekeepingEvidencias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../domain/condominios/housekeepingEvidencias')>()),
  listarFotosServicio: mocks.listarFotosServicio, subirFotoServicio: mocks.subirFotoServicio, eliminarFotoServicio: mocks.eliminarFotoServicio,
}))
vi.mock('../../../../domain/condominios/housekeepingReservas', () => ({ notificarInformeHousekeeping: mocks.notificarInformeHousekeeping }))
vi.mock('../../../../domain/usuarios/queries', () => ({ useUsuariosMap: () => ({ mapa: new Map([['u2', { full_name: 'Beto López' }]]) }) }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: () => <img alt="" /> }))
vi.mock('../housekeepingPdf', () => ({ generarInformeHousekeepingPdf: mocks.generarPdf, compartirOdescargarPdf: mocks.compartir }))

const { HousekeepingServicioPasos } = await import('../HousekeepingServicioPasos')

function servicio(over: Partial<ServicioHousekeeping> = {}): ServicioHousekeeping {
  return { id: 's1', company_id: 'c1', project_id: 'p1', tipo: 'limpieza_estandar', fecha: '2026-10-15', estado: 'en_proceso', unidad_nombre: 'Apto 1A',
    iniciado_por: 'u2', iniciado_en: '2026-10-15T15:00:00Z', responsable_user_id: 'u2', created_at: '2026-10-15T00:00:00.000Z', ...over }
}
function abrir(s: ServicioHousekeeping, props: Partial<Parameters<typeof HousekeepingServicioPasos>[0]> = {}) {
  const onClose = vi.fn(); const onRefresh = vi.fn()
  render(<HousekeepingServicioPasos servicio={s} projectId="p1" companyId="c1" tipoLabel="Limpieza Estándar" estadoLabel="En proceso"
    responsableEstado={{ kind: 'vinculado', userId: 'u2', nombre: 'Beto López' }} responsableNombre="Beto López" canEdit onClose={onClose} onRefresh={onRefresh} {...props} />)
  return { onClose, onRefresh }
}
const menu = () => screen.getByRole('navigation', { name: 'Partes del servicio' })
const boton = (nombre: string) => screen.getByRole('button', { name: nombre })

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  mocks.listarFotosServicio.mockResolvedValue({ data: [], error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRowAfectando.mockResolvedValue({ error: null })
  mocks.openPromptDialog.mockResolvedValue(null)
  mocks.compartir.mockResolvedValue(false)
  mocks.confirm.mockResolvedValue({ isConfirmed: false })
  vi.stubGlobal('open', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('HousekeepingServicioPasos — menú del flujo guiado', () => {
  it('se abre en el menú: tres botones grandes, sin pasos numerados, cada uno dice qué hay registrado', async () => {
    mocks.listarFotosServicio.mockResolvedValueOnce({ data: [{ id: 'f1', servicio_id: 's1', fase: 'inconvenientes', path: 'p1/s1/a.jpg', created_at: '' }], error: null })
    abrir(servicio({ hallazgos_ingreso: 'Polvo' }))
    const m = menu()
    expect(within(m).getByText('¿Qué deseas registrar?')).toBeTruthy()
    expect(within(m).getByRole('button', { name: 'Evidenciar estado al ingresar' })).toBeTruthy()
    expect(within(m).getByRole('button', { name: 'Reportar inconvenientes' })).toBeTruthy()
    expect(within(m).getByRole('button', { name: 'Resultado del servicio' })).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText(/1 · Ingreso/)).toBeNull()
    expect(within(m).getByText('✓ Con observaciones')).toBeTruthy()
    expect(await within(m).findByText('✓ 1 foto')).toBeTruthy()
    expect(within(m).getAllByText('Sin registrar')).toHaveLength(1)
    expect(within(m).getByText(/entra a/)).toBeTruthy()   // cómo se finaliza
    expect(screen.queryByTestId('fase-ingreso')).toBeNull()
    expect(screen.getByText(/▶️ Inició/).textContent).toMatch(/Beto López · \d{2}\/\d{2}\/\d{2}, \d{2}:\d{2}/)
  })

  it('«Evidenciar estado al ingresar»: texto + fotos de ingreso; «Guardar y regresar» manda los tres textos y vuelve al menú con el resumen', async () => {
    const { onRefresh } = abrir(servicio())
    fireEvent.click(boton('Evidenciar estado al ingresar'))
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByTestId('fase-ingreso')).toBeTruthy()
    expect(screen.queryByTestId('fase-inconvenientes')).toBeNull()
    fireEvent.change(screen.getByLabelText('Estado al ingresar'), { target: { value: 'Polvo en repisas' } })
    fireEvent.click(screen.getByText('💾 Guardar y regresar'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('servicios_housekeeping', 's1', { hallazgos_ingreso: 'Polvo en repisas', inconvenientes: null, observaciones_cierre: null }))
    expect(onRefresh).toHaveBeenCalled()
    expect(mocks.updateCondominioRowAfectando).not.toHaveBeenCalled()   // guardar no cambia el estado
    expect(await screen.findByRole('navigation', { name: 'Partes del servicio' })).toBeTruthy()
    expect(within(menu()).getByText('✓ Con observaciones')).toBeTruthy()
  })

  it('«Reportar inconvenientes»: su texto y sus fotos; «← Regresar» también guarda', async () => {
    abrir(servicio())
    fireEvent.click(boton('Reportar inconvenientes'))
    expect(screen.getByTestId('fase-inconvenientes')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Inconvenientes encontrados'), { target: { value: 'Grifo roto' } })
    fireEvent.click(boton('Regresar al menú'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('servicios_housekeeping', 's1', expect.objectContaining({ inconvenientes: 'Grifo roto' })))
    expect(await screen.findByRole('navigation', { name: 'Partes del servicio' })).toBeTruthy()
  })

  it('sin cambios, regresar no guarda nada', async () => {
    abrir(servicio({ hallazgos_ingreso: 'Polvo' }))
    fireEvent.click(boton('Evidenciar estado al ingresar'))
    fireEvent.click(screen.getByText('💾 Guardar y regresar'))
    expect(await screen.findByRole('navigation', { name: 'Partes del servicio' })).toBeTruthy()
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('si guardar falla, se queda en la pantalla y avisa', async () => {
    mocks.updateCondominioRow.mockResolvedValueOnce({ error: { message: 'sin red' } })
    abrir(servicio())
    fireEvent.click(boton('Resultado del servicio'))
    fireEvent.change(screen.getByLabelText('Cómo quedó la unidad'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('💾 Guardar y regresar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'Error al guardar' })))
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.getByLabelText('Cómo quedó la unidad')).toBeTruthy()
  })
})

describe('HousekeepingServicioPasos — cerrar guarda lo escrito', () => {
  it('✕ con texto sin guardar: guarda y después cierra', async () => {
    const { onClose } = abrir(servicio())
    fireEvent.click(boton('Evidenciar estado al ingresar'))
    fireEvent.change(screen.getByLabelText('Estado al ingresar'), { target: { value: 'Escrito y sin guardar' } })
    fireEvent.click(boton('Cerrar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('servicios_housekeeping', 's1', expect.objectContaining({ hallazgos_ingreso: 'Escrito y sin guardar' }))
  })

  it('«Cerrar» del menú y Escape sin cambios cierran sin tocar la base', async () => {
    const { onClose } = abrir(servicio())
    fireEvent.click(screen.getByText('Cerrar'))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })

  it('si no se pudo guardar al cerrar, pregunta; «Seguir editando» no cierra, «Cerrar sin guardar» sí', async () => {
    mocks.updateCondominioRow.mockResolvedValue({ error: { message: 'sin red' } })
    const { onClose } = abrir(servicio())
    fireEvent.click(boton('Evidenciar estado al ingresar'))
    fireEvent.change(screen.getByLabelText('Estado al ingresar'), { target: { value: 'x' } })
    fireEvent.click(boton('Cerrar'))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'Cerrar sin guardar' })))
    expect(onClose).not.toHaveBeenCalled()
    mocks.confirm.mockResolvedValueOnce({ isConfirmed: true })
    fireEvent.click(boton('Cerrar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('un servicio en solo lectura cierra sin guardar aunque el texto difiera', async () => {
    const { onClose } = abrir(servicio({ estado: 'completado', completado_por: 'u2', completado_en: '2026-10-15T17:30:00Z' }), { canEdit: false, estadoLabel: 'Completado' })
    fireEvent.click(screen.getByText('Cerrar'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()
  })
})

describe('HousekeepingServicioPasos — finalizar y notificar', () => {
  it('«Resultado del servicio» → «Guardar y dar por finalizado»: guarda el resultado, pasa a completado exigiendo una fila, recarga, muestra la hora de finalización y pregunta cómo notificar; «Ahora no» cierra sin notificar', async () => {
    const { onClose, onRefresh } = abrir(servicio(), { vistaInicial: 'resultado' })
    expect(screen.getByTestId('fase-cierre')).toBeTruthy()
    expect(screen.getByText(/se registra la hora de finalización/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Cómo quedó la unidad'), { target: { value: 'Todo limpio' } })
    fireEvent.click(screen.getByText('✅ Guardar y dar por finalizado'))
    await waitFor(() => expect(mocks.updateCondominioRowAfectando).toHaveBeenCalledWith('servicios_housekeeping', 's1', { estado: 'completado' }))
    expect(mocks.updateCondominioRow).toHaveBeenCalledWith('servicios_housekeeping', 's1', expect.objectContaining({ observaciones_cierre: 'Todo limpio' }))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    const opts = mocks.openPromptDialog.mock.calls[0][0] as { title: string; description: string; fields: { name: string }[] }
    expect(opts.title).toBe('¿Notificar el informe?')
    expect(opts.description).toMatch(/Servicio finalizado a las \d{2}:\d{2} \(hora de finalización registrada\)/)
    expect(opts.description).toMatch(/Horas dedicadas/)
    expect(opts.fields.map(f => f.name)).toEqual(['correo', 'whatsapp', 'otro'])
    expect(onRefresh).toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.notificarInformeHousekeeping).not.toHaveBeenCalled()
    expect(mocks.generarPdf).not.toHaveBeenCalled()
  })

  it('si la base rechaza la transición al finalizar, lo explica y no pregunta nada', async () => {
    mocks.updateCondominioRowAfectando.mockResolvedValueOnce({ error: { message: 'HK_TRANSICION_INVALIDA: de "pendiente" a "completado"' } })
    const { onClose } = abrir(servicio(), { vistaInicial: 'resultado' })
    fireEvent.click(screen.getByText('✅ Guardar y dar por finalizado'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', title: 'No se finalizó el servicio' })))
    expect(mocks.openPromptDialog).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('notificar por correo a administradores y a un correo extra llama a la RPC con ambos', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ correo: 'true', whatsapp: '', otro: 'externo@x.test' })
    abrir(servicio(), { vistaInicial: 'resultado' })
    fireEvent.click(screen.getByText('✅ Guardar y dar por finalizado'))
    await waitFor(() => expect(mocks.notificarInformeHousekeeping).toHaveBeenCalledWith('s1', { aAdministradores: true, emailExtra: 'externo@x.test' }))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success', text: expect.stringMatching(/d@x.test, a@x.test/) })))
    expect(mocks.generarPdf).not.toHaveBeenCalled()
  })

  it('un teléfono como destinatario genera el PDF y, si el dispositivo no comparte archivos, abre wa.me con el resumen', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ correo: '', whatsapp: '', otro: '+502 5555 0001' })
    abrir(servicio(), { vistaInicial: 'resultado' })
    fireEvent.click(screen.getByText('✅ Guardar y dar por finalizado'))
    await waitFor(() => expect(mocks.compartir).toHaveBeenCalled())
    expect(mocks.notificarInformeHousekeeping).not.toHaveBeenCalled()
    const abierto = (window.open as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]
    expect(abierto.startsWith('https://wa.me/50255550001?text=')).toBe(true)
    expect(decodeURIComponent(abierto)).toMatch(/Informe de housekeeping · Limpieza Estándar/)
    expect(decodeURIComponent(abierto)).toMatch(/Responsable: Beto López/)
  })

  it('WhatsApp marcado y PDF compartido por el dispositivo: no abre wa.me', async () => {
    mocks.openPromptDialog.mockResolvedValueOnce({ correo: '', whatsapp: 'true', otro: '' })
    mocks.compartir.mockResolvedValueOnce(true)
    abrir(servicio(), { vistaInicial: 'resultado' })
    fireEvent.click(screen.getByText('✅ Guardar y dar por finalizado'))
    await waitFor(() => expect(mocks.compartir).toHaveBeenCalled())
    expect(window.open).not.toHaveBeenCalled()
  })
})

describe('HousekeepingServicioPasos — solo lectura y PDF', () => {
  it('un servicio completado se abre en solo lectura: mismo menú, hora de fin en la cabecera, sin Guardar ni Finalizar, con PDF y «Notificar informe» que vuelve a preguntar', async () => {
    abrir(servicio({ estado: 'completado', completado_por: 'u2', completado_en: '2026-10-15T17:30:00Z', hallazgos_ingreso: 'Polvo', observaciones_cierre: 'Limpio' }), { estadoLabel: 'Completado' })
    expect(within(menu()).getByText('Evidencia del servicio')).toBeTruthy()
    expect(screen.getByText(/✅ Finalizó/).textContent).toMatch(/Beto López · \d{2}\/\d{2}\/\d{2}, \d{2}:\d{2} · ⏱ 2 h 30 min/)
    expect(screen.queryByText(/entra a/)).toBeNull()
    fireEvent.click(boton('Evidenciar estado al ingresar'))
    expect((screen.getByLabelText('Estado al ingresar') as HTMLTextAreaElement).readOnly).toBe(true)
    expect(screen.queryByLabelText(/Agregar fotos/)).toBeNull()
    expect(screen.queryByText(/Guardar/)).toBeNull()
    expect(screen.getAllByText('← Regresar')).toHaveLength(2)   // arriba y abajo; ninguno dice «Guardar»
    fireEvent.click(boton('Regresar al menú'))
    fireEvent.click(await screen.findByRole('button', { name: 'Resultado del servicio' }))
    expect(screen.queryByText(/dar por finalizado/)).toBeNull()
    expect((screen.getByLabelText('Cómo quedó la unidad') as HTMLTextAreaElement).readOnly).toBe(true)
    fireEvent.click(boton('Regresar al menú'))
    fireEvent.click(await screen.findByText('📨 Notificar informe'))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    expect(mocks.updateCondominioRowAfectando).not.toHaveBeenCalled()
  })

  it('un servicio pendiente abierto para editar no ofrece finalizar y lo explica', () => {
    abrir(servicio({ estado: 'pendiente', iniciado_por: undefined, iniciado_en: undefined }), { estadoLabel: 'Pendiente' })
    expect(screen.getByText(/primero «Iniciar servicio»/)).toBeTruthy()
    fireEvent.click(boton('Resultado del servicio'))
    expect(screen.queryByText(/dar por finalizado/)).toBeNull()
    expect(screen.getByText(/primero «Iniciar servicio»/)).toBeTruthy()
  })

  it('el PDF manual guarda primero los textos sucios y avisa si solo pudo descargar', async () => {
    abrir(servicio())
    fireEvent.click(boton('Evidenciar estado al ingresar'))
    fireEvent.change(screen.getByLabelText('Estado al ingresar'), { target: { value: 'x' } })
    fireEvent.click(boton('Regresar al menú'))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    mocks.updateCondominioRow.mockClear()
    fireEvent.click(await screen.findByText('📄 PDF / WhatsApp'))
    await waitFor(() => expect(mocks.compartir).toHaveBeenCalled())
    expect(mocks.updateCondominioRow).not.toHaveBeenCalled()   // ya estaba guardado al regresar
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'PDF descargado' }))
    const datos = (mocks.generarPdf.mock.calls[0] as unknown[])[0] as { servicio: ServicioHousekeeping; responsableLinea: string }
    expect(datos.servicio.hallazgos_ingreso).toBe('x')
    expect(datos.responsableLinea).toBe('Responsable: Beto López')
    expect(within(screen.getByRole('dialog', { name: 'Servicio de housekeeping' })).getByText(/▶️ Inició/)).toBeTruthy()
  })
})
