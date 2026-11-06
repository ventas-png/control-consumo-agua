// Portal del residente · Visitantes: la fila de "Mis visitantes" abre la ficha del visitante en ventana
// emergente (EditModal real, pantalla completa en el teléfono) con sus datos, fotos y acompañantes; la
// tarjeta de una visita frecuente abre su ficha con las acciones (renovar, retirar, suspender) en el pie
// y la renovación pide la fecha en una ventana encima de la ficha. Antes todo iba en la tarjeta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import type { Visitante, VisitaFrecuente } from '../../../../types'
import { hoyLocalISO, dateLocalISO } from '../../../../lib/format'
import { vigenciaMaxima } from '../../../../lib/visitasFrecuentes'

const mocks = vi.hoisted(() => ({
  validatedInsert: vi.fn(async () => ({ data: [{ id: 'nuevo' }], error: null })),
  validatedInsertMany: vi.fn(async () => ({ data: null, error: null })),
  updateCondominioRow: vi.fn(async (..._args: unknown[]) => ({ data: null, error: null as { message: string } | null })),
  toast: { success: vi.fn(), error: vi.fn() },
  onRefresh: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}), rpc: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({ useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null), useSignedUrls: (s: string[]) => s }))
vi.mock('../../../../lib/validatedInsert', () => ({ validatedInsert: mocks.validatedInsert, validatedInsertMany: mocks.validatedInsertMany }))
vi.mock('../../../../lib/toast', () => ({ toast: mocks.toast }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({ updateCondominioRow: mocks.updateCondominioRow }))

const { PortalVisitantesTab } = await import('../PortalVisitantesTab')

const hoy = hoyLocalISO()
const enDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return dateLocalISO(d) }

const visitante = (o: Partial<Visitante>): Visitante => ({
  id: 'v?', company_id: 'co1', project_id: 'p1', unidad_id: 'u1', nombre: '?', hora_entrada: '2026-10-01T15:00:00.000Z', created_at: '2026-10-01T15:00:00.000Z', ...o,
})
const JUAN = visitante({
  id: 'v1', nombre: 'Juan Pérez', hora_entrada: `${hoy}T12:00:00.000Z`, identificacion: '1234567890101', placa_vehiculo: 'P-123ABC', motivo: 'Familiar',
  notas: 'Trae una caja grande.', foto_url: 'p1/visitantes/juan.jpg', foto_vehiculo_url: 'p1/visitantes/carro.jpg', valido_hasta: '2099-01-05',
})
const ANA = visitante({ id: 'v1a', nombre: 'Ana Pérez', hora_entrada: `${hoy}T12:00:00.000Z`, es_menor: true, fecha_nacimiento: '2018-03-02', visitante_principal_id: 'v1' })
const TECNICO = visitante({ id: 'v2', nombre: 'Técnico Gas', hora_entrada: '2026-10-01T15:00:00.000Z', valido_hasta: '2099-02-01', motivo: 'Revisión' })
const MENSAJERO = visitante({ id: 'v3', nombre: 'Mensajero', hora_entrada: '2026-09-01T15:00:00.000Z', valido_hasta: '2026-09-01' })

const frecuente = (o: Partial<VisitaFrecuente>): VisitaFrecuente => ({
  id: 'vf?', company_id: 'co1', project_id: 'p1', unidad_id: 'u1', nombre: '?', relacion: 'familiar', activo: true, estado: 'aprobada',
  vigente_desde: '2026-10-01', vigente_hasta: '2099-03-01', created_at: '2026-10-01T10:00:00.000Z', ...o,
})
const MARIA = frecuente({ id: 'vf1', nombre: 'María López', relacion: 'empleado', telefono: '5555-0000', identificacion: '9988776655', dias_permitidos: ['lunes', 'miercoles'], hora_desde: '08:00', hora_hasta: '14:00', notas: 'Entra por el portón peatonal.', autorizado_en: '2026-10-02T09:00:00.000Z' })
const PEDRO = frecuente({ id: 'vf2', nombre: 'Pedro Gómez', vigente_hasta: enDias(3) })
const LUISA = frecuente({ id: 'vf3', nombre: 'Luisa Ramírez', vigente_hasta: enDias(3), renovacion_solicitada_hasta: '2099-06-01', renovacion_solicitada_en: '2026-11-01T10:00:00.000Z' })
const CARLOS = frecuente({ id: 'vf4', nombre: 'Carlos Ruiz', estado: 'pendiente' })
const RITA = frecuente({ id: 'vf5', nombre: 'Rita Soto', estado: 'rechazada', motivo_rechazo: 'Documento ilegible' })

function montar() {
  return render(
    <PortalVisitantesTab visitantes={[JUAN, ANA, TECNICO, MENSAJERO]} visitasFrecuentes={[MARIA, PEDRO, LUISA, CARLOS, RITA]} diasAvisoRenovacion={7}
      unidadId="u1" proyectoId="p1" companyId="co1" onRefresh={mocks.onRefresh} />,
  )
}
const abrir = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))
const ficha = (titulo: string) => screen.getByRole('dialog', { name: titulo })
const botonesPie = (titulo: string) => within(ficha(titulo).querySelector('.at-modal-footer') as HTMLElement).getAllByRole('button').map(b => b.textContent)

beforeEach(() => { vi.clearAllMocks(); mocks.updateCondominioRow.mockResolvedValue({ data: null, error: null }) })
afterEach(cleanup)

describe('PortalVisitantesTab — la fila del visitante abre la ficha en ventana', () => {
  it('sin pulsar nada sólo hay filas; la fila abre la ficha a pantalla completa con datos, fotos y acompañantes', () => {
    montar()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Juan Pérez' })).toBeTruthy()
    // El acompañante no tiene fila propia ni se lee hasta abrir la ficha.
    expect(screen.queryByRole('button', { name: 'Ana Pérez' })).toBeNull()
    expect(screen.queryByText('Ana Pérez')).toBeNull()
    expect(screen.queryByText('Trae una caja grande.')).toBeNull()
    expect(screen.getByText('📷 2')).toBeTruthy()

    abrir('Juan Pérez')
    const v = ficha('Juan Pérez')
    expect(v.classList.contains('at-modal--fs-mobile')).toBe(true)
    // Estado: chip del subtítulo y tarjeta de datos.
    expect(within(v).getAllByText('Hoy')).toHaveLength(2)
    expect(within(v).getByText('1234567890101')).toBeTruthy()
    expect(within(v).getByText('P-123ABC')).toBeTruthy()
    expect(within(v).getByText('Familiar')).toBeTruthy()
    expect(within(v).getByText(/^Lunes, 05 de enero/)).toBeTruthy()
    expect(within(v).getByText('Trae una caja grande.')).toBeTruthy()
    expect(within(v).getByText('Visitante')).toBeTruthy()
    expect(within(v).getByText('Vehículo')).toBeTruthy()
    expect(within(v).getByText('Ana Pérez')).toBeTruthy()
    expect(within(v).getByText('Menor · Nac. 2018-03-02')).toBeTruthy()
    // Sólo lectura: el residente no edita un visitante ya registrado.
    expect(botonesPie('Juan Pérez')).toEqual(['Cerrar'])
  })

  it('Cerrar, Escape y Enter cierran y abren; una visita de otro día se ve vigente o expirada', () => {
    montar()
    abrir('Juan Pérez')
    fireEvent.click(within(ficha('Juan Pérez').querySelector('.at-modal-footer') as HTMLElement).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Técnico Gas' }), { key: 'Enter' })
    expect(within(ficha('Técnico Gas')).getAllByText('Vigente')).toHaveLength(2)
    expect(within(ficha('Técnico Gas')).getByText('Ninguno')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    abrir('Mensajero')
    expect(within(ficha('Mensajero')).getAllByText('Expirada')).toHaveLength(2)
  })
})

describe('PortalVisitantesTab — la visita frecuente abre la ficha con las acciones en el pie', () => {
  it('la tarjeta resume y la ficha trae datos, notas y Suspender para una aprobada vigente', async () => {
    montar()
    expect(screen.queryByText('Entra por el portón peatonal.')).toBeNull()
    expect(screen.queryByRole('button', { name: /Suspender/ })).toBeNull()
    abrir('María López')
    const v = ficha('María López')
    expect(within(v).getAllByText('Aprobada')).toHaveLength(2)
    expect(within(v).getByText('5555-0000')).toBeTruthy()
    expect(within(v).getByText('9988776655')).toBeTruthy()
    expect(within(v).getByText('Entra por el portón peatonal.')).toBeTruthy()
    expect(within(v).getByText('Aprobada el')).toBeTruthy()
    expect(botonesPie('María López')).toEqual(['Cerrar', 'Suspender'])
    fireEvent.click(within(v).getByRole('button', { name: 'Suspender María López' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('visitas_frecuentes', 'vf1', { activo: false }))
    expect(mocks.toast.success).toHaveBeenCalledWith('Autorización suspendida')
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('una por vencer ofrece Solicitar renovación en el pie: la fecha se pide en una ventana encima de la ficha', async () => {
    montar()
    abrir('Pedro Gómez')
    expect(within(ficha('Pedro Gómez')).getByText(/^⏰ Vence en 3 días\./)).toBeTruthy()
    // Sigue aprobada y vigente: también puede suspenderla (como antes en la tarjeta).
    expect(botonesPie('Pedro Gómez')).toEqual(['Cerrar', 'Suspender', '🔄 Solicitar renovación'])
    fireEvent.click(screen.getByRole('button', { name: 'Solicitar renovación de Pedro Gómez' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    const r = ficha('Solicitar renovación')
    const fecha = within(r).getByLabelText(/^Nueva vigencia/) as HTMLInputElement
    expect(fecha.value).toBe(vigenciaMaxima(hoy))
    // Escape cierra sólo la ventana de la renovación.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(ficha('Pedro Gómez')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Solicitar renovación de Pedro Gómez' }))
    fireEvent.change(within(ficha('Solicitar renovación')).getByLabelText(/^Nueva vigencia/), { target: { value: enDias(30) } })
    fireEvent.click(within(ficha('Solicitar renovación')).getByRole('button', { name: 'Enviar solicitud' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, cambios] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect([tabla, id]).toEqual(['visitas_frecuentes', 'vf2'])
    expect(cambios.renovacion_solicitada_hasta).toBe(enDias(30))
    expect(typeof cambios.renovacion_solicitada_en).toBe('string')
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('con renovación solicitada sólo queda Retirar solicitud; una pendiente o rechazada sólo Cerrar, con su aviso', async () => {
    montar()
    abrir('Luisa Ramírez')
    expect(within(ficha('Luisa Ramírez')).getByText(/^Renovación pedida el 01 nov hasta 2099-06-01/)).toBeTruthy()
    expect(botonesPie('Luisa Ramírez')).toEqual(['Cerrar', 'Retirar solicitud'])
    fireEvent.click(screen.getByRole('button', { name: 'Retirar solicitud de renovación de Luisa Ramírez' }))
    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledWith('visitas_frecuentes', 'vf3', { renovacion_solicitada_hasta: null, renovacion_solicitada_en: null }))
    fireEvent.keyDown(document, { key: 'Escape' })

    abrir('Carlos Ruiz')
    expect(within(ficha('Carlos Ruiz')).getByText(/Mientras la administración no la apruebe/)).toBeTruthy()
    expect(botonesPie('Carlos Ruiz')).toEqual(['Cerrar'])
    fireEvent.keyDown(document, { key: 'Escape' })

    abrir('Rita Soto')
    expect(within(ficha('Rita Soto')).getByText('✗ Motivo del rechazo: Documento ilegible')).toBeTruthy()
    expect(botonesPie('Rita Soto')).toEqual(['Cerrar'])
  })
})
