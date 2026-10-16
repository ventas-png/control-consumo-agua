// Registro de mascotas y vehículos desde el portal (20261101000000).
//
// Reglas que la UI debe sostener (lo demás lo exigen la BD y las RPC, y se
// prueba en supabase/tests/padron_autorizacion):
//   1. Al abrir el formulario se reserva el borrador; los adjuntos se suben AL
//      ELEGIRLOS bajo {unidad}/{mascotas|vehiculos}/{id}/ — la carpeta que la
//      policy de `padron-docs` verifica.
//   2. El envío va por la RPC con la ficha completa (vacunas incluidas), no por
//      un insert; sin vacunas un perro no se envía.
//   3. El borrador propio se retoma ("Continuar registro"); el ajeno no se ve.
//   4. Retirar / dar de baja solo lo ofrece a quien lo registró o al propietario.
//   5. El vehículo autorizado muestra su TAG de ingreso.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react'
import type { Mascota, VehiculoResidente } from '../../../../types'

const h = vi.hoisted(() => ({
  mascotas: [] as unknown[],
  vehiculos: [] as unknown[],
  reservarPadron: vi.fn(async (tipo: string) => ({ id: tipo === 'mascota' ? 'm-1' : 'v-1', error: null as string | null })),
  enviarMascota: vi.fn(async () => ({ error: null as string | null })),
  enviarVehiculo: vi.fn(async () => ({ error: null as string | null })),
  darDeBajaPadron: vi.fn(async () => ({ error: null as string | null })),
  uploadPadronDoc: vi.fn(async () => ({ error: null as string | null })),
  notify: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../lib/storageUrls', () => ({
  useSignedUrl: (src: string | null) => (src ? `https://firmado.test/${src}` : null),
}))
vi.mock('../../../shared/Dialog', () => ({ notify: h.notify, confirm: vi.fn(async () => ({ isConfirmed: true })) }))
vi.mock('../../../../domain/portal/padron', () => ({
  carpetaPadron: (tipo: string, u: string, id: string) => `${u}/${tipo === 'mascota' ? 'mascotas' : 'vehiculos'}/${id}`,
  fetchMascotasUnidad: vi.fn(async () => ({ data: h.mascotas, error: null })),
  fetchVehiculosUnidad: vi.fn(async () => ({ data: h.vehiculos, error: null })),
  reservarPadron: h.reservarPadron,
  enviarMascota: h.enviarMascota,
  enviarVehiculo: h.enviarVehiculo,
  descartarPadron: vi.fn(async () => ({ error: null })),
  darDeBajaPadron: h.darDeBajaPadron,
}))
vi.mock('../../../../domain/shared/storage', () => ({
  uploadPadronDoc: h.uploadPadronDoc,
  removePadronDocs: vi.fn(async () => ({ error: null })),
  BUCKET_PADRON_DOCS: 'padron-docs',
}))
vi.mock('../../../../lib/fileValidation', () => ({
  validateFileMagic: vi.fn(async () => ({ ok: true, detected: 'application/pdf' })),
  buildUploadPath: (folder: string, name: string) => `${folder}/1700000000000-abc123-${name}`,
  resolveUploadContentType: (detected: string) => detected,
}))
vi.mock('../../../shared/ImageUploader', () => ({ ImageUploader: () => null }))
vi.mock('../../../../lib/format', async (orig) => ({
  ...(await orig<typeof import('../../../../lib/format')>()),
  hoyLocalISO: () => '2026-10-16',
}))

const { PortalMascotasTab } = await import('../PortalMascotasTab')
const { PortalVehiculosTab } = await import('../PortalVehiculosTab')

const base = { company_id: 'c1', project_id: 'p1', unidad_id: 'u1', created_at: '2026-10-01T00:00:00Z' }

beforeEach(() => {
  h.mascotas = []
  h.vehiculos = []
  vi.clearAllMocks()
})
afterEach(cleanup)

async function montar(ui: React.ReactElement) {
  render(ui)
  await act(async () => {})
}

describe('PortalMascotasTab', () => {
  it('reserva el borrador, sube el carnet a su carpeta y envía la ficha con las vacunas por RPC', async () => {
    await montar(<PortalMascotasTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar mascota' }))
    await act(async () => {})
    expect(h.reservarPadron).toHaveBeenCalledWith('mascota', 'u1')

    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Toby' } })

    // Sin vacunas, un perro no se envía.
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }))
    await act(async () => {})
    expect(h.enviarMascota).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringMatching(/al menos una vacuna/) }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Rabia (antirrábica)' }))
    fireEvent.change(screen.getByLabelText('Fecha de aplicación de Rabia (antirrábica)'), { target: { value: '2026-01-10' } })

    const archivo = new File(['%PDF'], 'carnet.pdf', { type: 'application/pdf' })
    await act(async () => {
      fireEvent.change(screen.getByTestId('adjuntos-input'), { target: { files: [archivo] } })
    })
    expect(h.uploadPadronDoc).toHaveBeenCalledWith('u1/mascotas/m-1/1700000000000-abc123-carnet.pdf', archivo, { contentType: 'application/pdf' })

    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }))
    await act(async () => {})
    expect(h.enviarMascota).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({
        nombre: 'Toby', especie: 'perro',
        vacunas: [{ tipo: 'Rabia (antirrábica)', fecha: '2026-01-10', proxima: null }],
      }),
      [expect.objectContaining({ path: 'u1/mascotas/m-1/1700000000000-abc123-carnet.pdf', nombre: 'carnet.pdf' })],
    )
  })

  it('retoma el borrador propio y no muestra el ajeno', async () => {
    h.mascotas = [
      { ...base, id: 'b-propio', nombre: '', especie: 'perro', activo: false, estado: 'borrador', cliente_id: 'cli-1' },
      { ...base, id: 'b-ajeno',  nombre: 'Ajeno', especie: 'gato', activo: false, estado: 'borrador', cliente_id: 'cli-2' },
    ] satisfies Mascota[]
    await montar(<PortalMascotasTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario={false} />)
    expect(screen.queryByText('Ajeno')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '📝 Continuar registro' }))
    await act(async () => {})
    // Con borrador, no se reserva otro.
    expect(h.reservarPadron).not.toHaveBeenCalled()
  })

  it('solo quien la registró o el propietario puede retirarla; muestra el motivo del rechazo', async () => {
    h.mascotas = [
      { ...base, id: 'm-a', nombre: 'Luna', especie: 'gato', activo: true, estado: 'aprobada', cliente_id: 'cli-2' },
      { ...base, id: 'm-r', nombre: 'Rex', especie: 'perro', activo: false, estado: 'rechazada', cliente_id: 'cli-1',
        comentario_admin: 'Falta el carnet', resuelto_por: 'Admin Uno' },
    ] satisfies Mascota[]
    await montar(<PortalMascotasTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario={false} />)

    fireEvent.click(screen.getByRole('button', { name: /Luna/ }))
    expect(screen.queryByRole('button', { name: 'Dar de baja' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Rex/ }))
    expect(screen.getByText(/Falta el carnet/)).toBeTruthy()
  })

  it('el propietario da de baja una mascota autorizada por RPC', async () => {
    h.mascotas = [{ ...base, id: 'm-a', nombre: 'Luna', especie: 'gato', activo: true, estado: 'aprobada', cliente_id: 'cli-2' }] satisfies Mascota[]
    await montar(<PortalMascotasTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario />)
    fireEvent.click(screen.getByRole('button', { name: /Luna/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    await act(async () => {})
    expect(h.darDeBajaPadron).toHaveBeenCalledWith('mascota', 'm-a')
  })
})

describe('PortalVehiculosTab', () => {
  it('envía la placa normalizada por RPC', async () => {
    await montar(<PortalVehiculosTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar vehículo' }))
    await act(async () => {})
    expect(h.reservarPadron).toHaveBeenCalledWith('vehiculo', 'u1')

    fireEvent.change(screen.getByLabelText('Placa *'), { target: { value: ' p 123  abc ' } })
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2022' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }))
    await act(async () => {})
    expect(h.enviarVehiculo).toHaveBeenCalledWith('v-1', expect.objectContaining({ placa: 'P 123 ABC', tipo: 'auto', anio: 2022 }), [])
  })

  it('rechaza una placa inválida antes de llamar al servidor', async () => {
    await montar(<PortalVehiculosTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario />)
    fireEvent.click(screen.getByRole('button', { name: '+ Registrar vehículo' }))
    await act(async () => {})
    fireEvent.change(screen.getByLabelText('Placa *'), { target: { value: '<script>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }))
    await act(async () => {})
    expect(h.enviarVehiculo).not.toHaveBeenCalled()
  })

  it('el vehículo autorizado muestra su TAG; sin TAG, el aviso de recogerlo', async () => {
    h.vehiculos = [
      { ...base, id: 'v-a', placa: 'P-111AAA', tipo: 'auto', activo: true, estado: 'aprobada', cliente_id: 'cli-1', tag_codigo: 'TG-0153', tag_tipo: 'rfid' },
      { ...base, id: 'v-b', placa: 'P-222BBB', tipo: 'moto', activo: true, estado: 'aprobada', cliente_id: 'cli-1' },
    ] satisfies VehiculoResidente[]
    await montar(<PortalVehiculosTab unidadId="u1" unidadNombre="Apto 1D" clienteId="cli-1" esPropietario />)

    fireEvent.click(screen.getByRole('button', { name: /P-111AAA/ }))
    expect(screen.getByText(/TAG de ingreso: TG-0153/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /P-222BBB/ }))
    expect(screen.getByText(/todavía no te ha asignado el TAG/)).toBeTruthy()
    // Quien lo registró puede darlo de baja.
    expect(within(screen.getByRole('button', { name: /P-222BBB/ }).parentElement!).getByRole('button', { name: 'Dar de baja' })).toBeTruthy()
  })
})
