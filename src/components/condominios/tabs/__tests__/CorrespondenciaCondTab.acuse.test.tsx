// Acuse de recibo de correspondencia y registro de la pieza.
//
// El agujero original (Fase 0): "atender" una notificación legal solo cambiaba
// `estado`, sin dejar quién la entregó, cuándo ni a quién.
//
// El agujero que quedaba después: sí sellaba empleado y hora, pero NO el nombre
// de quien recibía — y la entrega firmada aceptaba ese campo vacío, precargado
// además con el destinatario impreso en el sobre, que muchas veces no es quien
// baja a recogerla. Un acuse que dice "entregado a (en blanco)" o "entregado a
// quien decía el sobre" no prueba una entrega.
//
// Ahora hay UNA sola puerta —el acuse— y pasa por la RPC transaccional
// `correspondencia_registrar_acuse` (20260831000000), que valida clase, estado
// anterior, permiso y nombre en el servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { PiezaRecepcion } from '../../../../types'

// Los espías se declaran TIPADOS: `vi.fn()` sin firma produce una tupla de
// argumentos vacía, y entonces `mock.calls[0][0]` no compila. Las fábricas de
// `vi.mock` se izan por encima de estas constantes, así que reenvían con
// `Parameters<typeof …>` en vez de referenciarlas directo.
type Toast = { variant: string; title: string; text?: string }
type Confirmacion = { title: string; text: string; confirmText?: string; cancelText?: string }
type Patch = Record<string, unknown>

const notify = vi.fn<(o: Toast) => void>()
const confirm = vi.fn<(o: Confirmacion) => Promise<{ isConfirmed: boolean }>>(
  async () => ({ isConfirmed: true }),
)
vi.mock('../../../shared/Dialog', () => ({
  notify: (...args: Parameters<typeof notify>) => notify(...args),
  confirm: (...args: Parameters<typeof confirm>) => confirm(...args),
}))

const createCondominioRow = vi.fn<
  (tabla: string, payload: Patch) => Promise<{ data: { id: string } | null; error: { message: string } | null }>
>(async () => ({ data: { id: 'nueva-1' }, error: null }))
const updateCondominioRow = vi.fn<
  (tabla: string, id: string, patch: Patch) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }))
const registrarAcuse = vi.fn<
  (p: { piezaId: string; nombre: string; firmaPath: string | null }) => Promise<{ error: { message: string } | null }>
>(async () => ({ error: null }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRowReturning: (...args: Parameters<typeof createCondominioRow>) => createCondominioRow(...args),
  updateCondominioRow: (...args: Parameters<typeof updateCondominioRow>) => updateCondominioRow(...args),
  registrarAcuseCorrespondencia: (...args: Parameters<typeof registrarAcuse>) => registrarAcuse(...args),
}))

// `avisarConReintento` decide el toast según el resultado real del aviso y
// ofrece reintentar; su lógica se prueba en condominios/__tests__/avisoRecepcion.
const avisarConReintento = vi.fn(async () => ({ estado: 'entregado' as const, detalle: {} }))
vi.mock('../../avisoRecepcion', () => ({
  avisarConReintento: (...args: unknown[]) => avisarConReintento(...(args as [])),
}))

const uploadMedia = vi.fn<
  (bucket: string, ruta: string, cuerpo: Blob | File, opts?: unknown) => Promise<{ data: { path: string } | null; error: string | null }>
>(async () => ({ data: { path: 'x' }, error: null }))
vi.mock('../../../../domain/shared/storage', () => ({
  uploadMedia: (...args: Parameters<typeof uploadMedia>) => uploadMedia(...args),
}))
vi.mock('../../../shared/ImageUploader', () => ({ MultiImageUploader: () => null }))
vi.mock('../../../shared/SecureImage', () => ({ SecureImage: () => null }))
// SignaturePad pinta en <canvas>, que jsdom no implementa: se reduce a un botón
// que entrega el PNG.
vi.mock('../../../shared/SignaturePad', () => ({
  SignaturePad: ({ onSave, saveLabel }: { onSave: (f: File) => void; saveLabel?: string }) => (
    <button data-testid="firma-pad" onClick={() => onSave(new File(['x'], 'firma.png', { type: 'image/png' }))}>
      {saveLabel ?? 'Guardar firma'}
    </button>
  ),
}))
vi.mock('../../../shared/EditModal', () => ({
  EditModal: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="modal" aria-label={title}>{children}</div>
  ),
}))

import { CorrespondenciaCondTab } from '../CorrespondenciaCondTab'

const PIEZA: PiezaRecepcion = {
  id: 'c1', company_id: 'comp', project_id: 'proj', unidad_id: null,
  clase: 'correspondencia', destinatario_tipo: 'administracion',
  direccion: 'entrante', tipo: 'notificacion_legal', descripcion: 'Citación municipal',
  fecha_pieza: '2026-08-12', prioridad: 'urgente', estado: 'pendiente',
  hora_recepcion: '2026-08-12T09:00:00Z', created_at: '2026-08-12T09:00:00Z',
  // El nombre impreso en el sobre. NO es necesariamente quien recibe.
  destinatario: 'Junta Directiva',
}

const UNIDAD = { id: 'u1', nombre: 'Apto 2A', activo: true } as never

function renderTab(over: Partial<PiezaRecepcion> = {}) {
  return render(
    <CorrespondenciaCondTab
      correspondencia={[{ ...PIEZA, ...over }]}
      paquetes={[]}
      unidades={[UNIDAD]}
      proyectoId="proj"
      companyId="comp"
      userId="user-1"
      canCreate
      canEdit
      puedeVerPaqueteria
      onRefresh={() => {}}
    />,
  )
}

function campoNombre(): HTMLInputElement {
  return screen.getByPlaceholderText(/Nombre y apellido de quien se lleva/) as HTMLInputElement
}

beforeEach(() => {
  createCondominioRow.mockClear(); updateCondominioRow.mockClear(); avisarConReintento.mockClear()
  notify.mockClear(); uploadMedia.mockClear()
  confirm.mockClear(); confirm.mockImplementation(async () => ({ isConfirmed: true }))
  registrarAcuse.mockClear(); registrarAcuse.mockImplementation(async () => ({ error: null }))
})
afterEach(cleanup)

describe('CorrespondenciaCondTab — el acuse exige el nombre real', () => {
  it('el campo NO viene precargado con el destinatario del sobre', () => {
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    expect(campoNombre().value).toBe('')
    // El dato del sobre sigue a la vista, pero como contexto, no como respuesta.
    expect(screen.getByText(/a nombre de Junta Directiva/)).toBeTruthy()
    // Abrir el acuse no escribe nada todavía.
    expect(registrarAcuse).not.toHaveBeenCalled()
  })

  it('sin nombre y SIN firma no se cierra la custodia', () => {
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    fireEvent.click(screen.getByText('Entregar sin firma'))
    expect(registrarAcuse).not.toHaveBeenCalled()
    expect(confirm, 'ni se pregunta: falta el dato').not.toHaveBeenCalled()
    expect(notify.mock.calls[0][0]).toMatchObject({ variant: 'warning', title: 'Falta el acuse' })
  })

  it('sin nombre y CON firma tampoco', async () => {
    // Era el hueco: la firma parecía suficiente, y una firma ilegible sin
    // nombre no identifica a nadie.
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    fireEvent.click(screen.getByTestId('firma-pad'))
    await vi.waitFor(() => expect(notify).toHaveBeenCalled())
    expect(registrarAcuse).not.toHaveBeenCalled()
    expect(uploadMedia, 'ni se sube la firma').not.toHaveBeenCalled()
  })

  it('un nombre de relleno ("x") no cuenta como acuse', () => {
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    fireEvent.change(campoNombre(), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('Entregar sin firma'))
    expect(registrarAcuse).not.toHaveBeenCalled()
  })
})

describe('CorrespondenciaCondTab — la entrega pasa por la RPC', () => {
  it('SIN firma: confirma primero y guarda el nombre de quien recibió de verdad', async () => {
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    // Quien baja a recoger no es el destinatario del sobre.
    fireEvent.change(campoNombre(), { target: { value: '  Marta   Solís ' } })
    fireEvent.click(screen.getByText('Entregar sin firma'))

    await vi.waitFor(() => expect(registrarAcuse).toHaveBeenCalled())
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Confirmar entrega' })
    expect(confirm.mock.calls[0][0].text).toContain('SIN firma')
    expect(registrarAcuse).toHaveBeenCalledWith({
      piezaId: 'c1', nombre: 'Marta Solís', firmaPath: null,
    })
    // Nunca por un UPDATE suelto: eso era lo que dejaba piezas sin acuse.
    expect(updateCondominioRow).not.toHaveBeenCalled()
  })

  it('CON firma: la sube al bucket de evidencias, bajo la carpeta de la pieza', async () => {
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    fireEvent.change(campoNombre(), { target: { value: 'Marta Solís' } })
    fireEvent.click(screen.getByTestId('firma-pad'))

    await vi.waitFor(() => expect(registrarAcuse).toHaveBeenCalled())
    const [bucket, ruta] = uploadMedia.mock.calls[0]
    expect(bucket, 'no en condominios-media, que lo lee cualquier vecino').toBe('recepcion-evidencias')
    expect(ruta.startsWith('proj/c1/')).toBe(true)
    expect(registrarAcuse.mock.calls[0][0]).toMatchObject({ nombre: 'Marta Solís', firmaPath: ruta })
  })

  it('si el operador se arrepiente en la confirmación, no pasa nada', async () => {
    confirm.mockImplementation(async () => ({ isConfirmed: false }))
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    fireEvent.change(campoNombre(), { target: { value: 'Marta Solís' } })
    fireEvent.click(screen.getByText('Entregar sin firma'))

    await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(registrarAcuse).not.toHaveBeenCalled()
    expect(uploadMedia).not.toHaveBeenCalled()
  })

  it('DOBLE EJECUCIÓN: el rechazo de la base se muestra tal cual', async () => {
    // La segunda entrega de la misma pieza la rechaza la RPC (ya no está
    // pendiente); la pantalla no la disfraza de éxito.
    registrarAcuse.mockImplementation(async () => ({
      error: { message: 'La pieza ya no está pendiente (estado: atendido)' },
    }))
    renderTab()
    fireEvent.click(screen.getByText('✍ Entregar'))
    fireEvent.change(campoNombre(), { target: { value: 'Marta Solís' } })
    fireEvent.click(screen.getByText('Entregar sin firma'))

    await vi.waitFor(() => expect(registrarAcuse).toHaveBeenCalled())
    const ultimo = notify.mock.calls[notify.mock.calls.length - 1][0]
    expect(ultimo).toMatchObject({ variant: 'error', title: 'No se registró la entrega' })
    expect(String(ultimo.text)).toContain('ya no está pendiente')
  })
})

describe('CorrespondenciaCondTab — las otras salidas de custodia', () => {
  it('archivar NO inventa una entrega: archivar no es entregar', () => {
    renderTab()
    fireEvent.click(screen.getByText('Archivar'))
    const [, , patch] = updateCondominioRow.mock.calls[0]
    expect(patch).toEqual({ estado: 'archivado' })
  })

  it('devolver sella quién y cuándo la sacó de custodia, sin pedir acuse', () => {
    // La devolución al remitente es una salida de custodia y, en una
    // notificación legal, parte del acto: tiene que quedar sellada. Pero no
    // hubo receptor a quien nombrar.
    renderTab()
    fireEvent.click(screen.getByText('↩ Devolver'))
    const [, , patch] = updateCondominioRow.mock.calls[0]
    expect(patch.estado).toBe('devuelto')
    expect(patch.entregado_por).toBe('user-1')
    expect(typeof patch.hora_entrega).toBe('string')
    expect(patch.entregado_a_nombre).toBeUndefined()
  })

  it('marca el plazo vencido de una pieza pendiente', () => {
    renderTab({ fecha_limite: '2020-01-01' })
    expect(screen.getByText(/^Vencido/)).toBeTruthy()
  })
})

describe('CorrespondenciaCondTab — registro', () => {
  /** Abre el formulario y teclea el asunto. */
  function abrirYEscribir(asunto: string) {
    fireEvent.click(screen.getByText('+ Registrar'))
    fireEvent.change(screen.getByPlaceholderText('Descripción del documento'), { target: { value: asunto } })
  }

  it('escribe en el motor único marcando la clase y quién recibió la pieza', async () => {
    renderTab()
    abrirYEscribir('Sobre judicial')
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(createCondominioRow).toHaveBeenCalled())
    const [tabla, payload] = createCondominioRow.mock.calls[0]
    expect(tabla).toBe('paquetes_recibidos')
    // La clase es lo que separa esta fila de un paquete, en la RLS y en la UI.
    expect(payload.clase).toBe('correspondencia')
    expect(payload.recibido_por).toBe('user-1')
    expect(payload.descripcion).toBe('Sobre judicial')
    // El id lo pone la UI: las fotos se suben a `<proyecto>/<pieza>/…` antes de
    // que exista la fila, y así un segundo INSERT chocaría contra la PK.
    expect(typeof payload.id).toBe('string')
  })

  it('sin unidad, la pieza queda dirigida a la administración y no se avisa a nadie', async () => {
    renderTab()
    abrirYEscribir('Citación')
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(createCondominioRow).toHaveBeenCalled())
    const [, payload] = createCondominioRow.mock.calls[0]
    expect(payload.unidad_id).toBeNull()
    expect(payload.destinatario_tipo).toBe('administracion')
    // No hay residente destinatario: mandar un aviso sería spam a nadie.
    expect(avisarConReintento).not.toHaveBeenCalled()
  })

  it('con unidad, avisa al residente igual que paquetería', async () => {
    renderTab()
    abrirYEscribir('Carta certificada')
    fireEvent.change(screen.getByDisplayValue('— Administración —'), { target: { value: 'u1' } })
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(avisarConReintento).toHaveBeenCalledWith('nueva-1'))
    const [, payload] = createCondominioRow.mock.calls[0]
    expect(payload.unidad_id).toBe('u1')
    expect(payload.destinatario_tipo).toBe('unidad')
  })

  it('una SALIDA a una unidad NO se avisa, aunque tenga residente', async () => {
    // El hallazgo: la pieza tenía unidad_id y se le mandaba al residente un
    // "pasa a recogerlo" por algo que él mismo estaba despachando.
    renderTab()
    abrirYEscribir('Constancia para el Registro')
    fireEvent.change(screen.getByDisplayValue('📥 Entrada'), { target: { value: 'saliente' } })
    fireEvent.change(screen.getByDisplayValue('— Administración —'), { target: { value: 'u1' } })
    fireEvent.click(screen.getByText('Guardar'))
    await vi.waitFor(() => expect(createCondominioRow).toHaveBeenCalled())

    const [, payload] = createCondominioRow.mock.calls[0]
    expect(payload.direccion).toBe('saliente')
    expect(payload.unidad_id).toBe('u1')
    expect(avisarConReintento).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(notify).toHaveBeenCalled())
    expect(String(notify.mock.calls[0][0].text)).toContain('sale del condominio')
  })
})
