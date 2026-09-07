// El empleado marca su propio turno (20260908000000).
//
// LO QUE SE CUBRE es lo que el sandbox SQL no puede ver: que al ENTRAR se
// pregunte qué se viene a hacer en vez de aterrizar siempre en la lista del
// equipo; que quien no tiene expediente no vea una opción que le fallaría; que
// la pantalla de marcaje llegue rellena —nombre, cargo, turno— y sin ningún
// campo de hora; y que la llamada que registra el fichaje NO mande la hora.
//
// Esa última prueba es la que protege el diseño entero: el día que alguien
// «arregle» el marcaje pasándole `new Date()` desde el navegador, la asistencia
// vuelve a ser lo que el dispositivo diga que es.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { BloqueTurno, MiFichaPresencia, PersonalCondominio, PresenciaPersonal } from '../../../../types'

const FICHA: MiFichaPresencia = {
  personal_id: 'per-1',
  nombre: 'Marco Sical',
  cargo: 'guardia',
  foto_url: null,
  fecha_operativa: '2026-09-07',
  hora_servidor: '06:03:11',
  bloque_id: 'blq-1',
  turno: 'manana',
  turno_inicio: '06:00:00',
  turno_fin: '14:00:00',
  registro_id: null,
  hora_entrada: null,
  hora_salida: null,
  estado: null,
  origen: null,
}

const mocks = vi.hoisted(() => ({
  fetchMiFichaPresencia: vi.fn(),
  marcarPresencia: vi.fn(),
  subirFotoMarcaje: vi.fn(),
  obtenerUbicacion: vi.fn(),
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  // Espía en vez de un stub mudo: la foto vive en un bucket privado y se firma
  // al render, así que en jsdom nunca hay un <img>. Sin contar las llamadas, un
  // «no se renderizó la foto» pasaría igual si SÍ se hubiera intentado.
  secureImage: vi.fn(),
}))

vi.mock('../../../../lib/supabase', () => ({ supabase: { from: () => ({}) }, db: { from: () => ({}) } }))
vi.mock('../../../../domain/condominios/presenciaAutoservicio', () => ({
  fetchMiFichaPresencia: mocks.fetchMiFichaPresencia,
  marcarPresencia: mocks.marcarPresencia,
  subirFotoMarcaje: mocks.subirFotoMarcaje,
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../lib/nativeGeo', () => ({ obtenerUbicacion: mocks.obtenerUbicacion }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: vi.fn() }))
vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: (props: { src?: string | null; bucket?: string }) => { mocks.secureImage(props); return null },
}))

const { default: PresenciaPersonalTab } = await import('../PresenciaPersonalTab')

const PERSONAL: PersonalCondominio[] = [{
  id: 'per-1', company_id: 'c1', project_id: 'p1', nombre: 'Marco Sical',
  cargo: 'guardia', turno: 'diurno', estado: 'activo', created_at: '2026-01-01',
} as PersonalCondominio]

function montar(registros: PresenciaPersonal[] = [], bloques: BloqueTurno[] = []) {
  return render(
    <PresenciaPersonalTab
      registros={registros}
      personal={PERSONAL}
      bloques={bloques}
      proyectoId="p1"
      companyId="c1"
      canCreate
      canEdit
      onRefresh={() => {}}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: FICHA, error: null })
  mocks.marcarPresencia.mockResolvedValue({
    data: { registro_id: 'r1', fecha: '2026-09-07', hora: '06:03:11', estado: 'presente', tipo: 'entrada' },
    error: null,
  })
  mocks.subirFotoMarcaje.mockResolvedValue({ path: 'p1/per-1/1757-foto.jpg', error: null })
  mocks.obtenerUbicacion.mockResolvedValue({
    coords: { lat: 14.60271, lng: -90.51328, exactitud_m: 12 }, error: null,
  })
  // jsdom no implementa objectURL; la vista previa de la foto lo usa.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('la pregunta de entrada', () => {
  it('a quien tiene expediente le pregunta qué viene a hacer', async () => {
    montar()
    expect(await screen.findByText(/Ingresar a mi turno/)).toBeTruthy()
    expect(screen.getByText(/Solo estoy consultando/)).toBeTruthy()
    // Y no aterriza en la lista del equipo antes de preguntar.
    expect(screen.queryByText('Registrar asistencia')).toBeNull()
  })

  it('a quien NO tiene expediente no le ofrece marcar: va directo a consultar', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    montar()
    await waitFor(() => expect(screen.getByText(/Sin registros para/)).toBeTruthy())
    expect(screen.queryByText(/Ingresar a mi turno/)).toBeNull()
  })

  it('si la consulta falla, el tab sigue sirviendo para lo de siempre', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: 'función inexistente' })
    montar()
    await waitFor(() => expect(screen.getByText(/Sin registros para/)).toBeTruthy())
  })
})

describe('la pantalla de marcaje', () => {
  async function entrarAMarcar() {
    montar()
    fireEvent.click(await screen.findByText(/Ingresar a mi turno/))
    return screen.findByText('Marco Sical')
  }

  it('llega rellena con lo que el sistema ya sabe, y sin campo de hora', async () => {
    await entrarAMarcar()
    expect(screen.getByText(/guardia · 2026-09-07/)).toBeTruthy()
    expect(screen.getByText(/Turno de hoy: 06:00–14:00/)).toBeTruthy()
    // La hora no se teclea: no hay ningún control para escribirla.
    expect(document.querySelectorAll('input[type="time"]').length).toBe(0)
    expect(screen.getByText(/La hora la pone el sistema/)).toBeTruthy()
  })

  it('sin foto no deja marcar', async () => {
    await entrarAMarcar()
    const boton = screen.getByText(/Marcar mi entrada/).closest('button')!
    expect(boton.hasAttribute('disabled')).toBe(true)
  })

  it('sube la foto ANTES de marcar y no manda ninguna hora', async () => {
    await entrarAMarcar()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] } })

    const boton = await waitFor(() => {
      const b = screen.getByText(/Marcar mi entrada/).closest('button')!
      expect(b.hasAttribute('disabled')).toBe(false)
      return b
    })
    fireEvent.click(boton)

    await waitFor(() => expect(mocks.marcarPresencia).toHaveBeenCalled())
    expect(mocks.subirFotoMarcaje).toHaveBeenCalledWith('p1', 'per-1', expect.any(File))
    const enviado = mocks.marcarPresencia.mock.calls[0][0]
    expect(enviado).toMatchObject({
      projectId: 'p1',
      tipo: 'entrada',
      foto: 'p1/per-1/1757-foto.jpg',
      coords: { lat: 14.60271, lng: -90.51328, exactitud_m: 12 },
    })
    // Ni hora, ni fecha, ni empleado: todo eso lo pone la base.
    expect(Object.keys(enviado).sort()).toEqual(['coords', 'foto', 'observaciones', 'projectId', 'tipo'])
  })

  it('con la entrada ya marcada, lo que ofrece es la salida', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({
      ficha: { ...FICHA, registro_id: 'r1', hora_entrada: '06:03:11', estado: 'presente', origen: 'autoservicio' },
      error: null,
    })
    montar()
    fireEvent.click(await screen.findByText(/Ingresar a mi turno/))
    expect(await screen.findByText(/Marcar mi salida/)).toBeTruthy()
  })

  it('con la jornada cerrada no ofrece marcar nada', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({
      ficha: { ...FICHA, registro_id: 'r1', hora_entrada: '06:03:11', hora_salida: '14:05:00', estado: 'presente', origen: 'autoservicio' },
      error: null,
    })
    montar()
    fireEvent.click(await screen.findByText(/Ingresar a mi turno/))
    expect(await screen.findByText(/ya está completa/)).toBeTruthy()
    expect(screen.queryByText(/Marcar mi entrada/)).toBeNull()
  })

  it('la ubicación que no llega no bloquea el marcaje', async () => {
    mocks.obtenerUbicacion.mockResolvedValue({ coords: null, error: 'Permiso de ubicación denegado' })
    await entrarAMarcar()
    expect(await screen.findByText(/Sin ubicación — Permiso de ubicación denegado/)).toBeTruthy()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] } })
    await waitFor(() => expect(screen.getByText(/Marcar mi entrada/).closest('button')!.hasAttribute('disabled')).toBe(false))
  })
})

describe('la lista del día', () => {
  it('distingue el marcaje de la persona del que tecleó el administrador', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    const registros: PresenciaPersonal[] = [
      {
        id: 'r1', company_id: 'c1', project_id: 'p1', nombre: 'Marco Sical', cargo: 'guardia',
        fecha: new Date().toISOString().slice(0, 10), hora_entrada: '06:03', estado: 'presente',
        created_at: '2026-09-07', origen: 'autoservicio', foto_entrada: 'p1/per-1/f.jpg',
        gps_entrada: { lat: 14.60271, lng: -90.51328, exactitud_m: 12 },
      },
      {
        id: 'r2', company_id: 'c1', project_id: 'p1', nombre: 'Ana López', cargo: 'conserje',
        fecha: new Date().toISOString().slice(0, 10), hora_entrada: '07:00', estado: 'presente',
        created_at: '2026-09-07', origen: 'manual',
      },
    ]
    montar(registros)
    await waitFor(() => expect(screen.getByText('Ana López')).toBeTruthy())
    expect(screen.getAllByText('Marcado por la persona').length).toBe(1)
    expect(screen.getByText(/14\.60271, -90\.51328/)).toBeTruthy()
    // Y la foto se pide al bucket privado del fichaje, no al de media general.
    expect(mocks.secureImage).toHaveBeenCalledTimes(1)
    expect(mocks.secureImage).toHaveBeenCalledWith(
      expect.objectContaining({ src: 'p1/per-1/f.jpg', bucket: 'presencia-evidencias' }),
    )
  })

  it('sobrevive a la purga de su propia evidencia', async () => {
    // Al año, la purga por retención (20260908000100) anula foto y GPS pero NO
    // la fila: el marcaje es dato de planilla. La lista tiene que seguir
    // mostrando la jornada —hora, estado, horas— sin la prueba que ya caducó, y
    // sin romperse por un path nulo.
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    const purgado: PresenciaPersonal[] = [{
      id: 'r1', company_id: 'c1', project_id: 'p1', nombre: 'Marco Sical', cargo: 'guardia',
      fecha: new Date().toISOString().slice(0, 10), hora_entrada: '06:03', hora_salida: '14:05',
      estado: 'presente', created_at: '2025-09-07', origen: 'autoservicio',
      foto_entrada: null, foto_salida: null, gps_entrada: null, gps_salida: null,
      entrada_marcada_en: '2025-09-07T12:03:00Z', salida_marcada_en: '2025-09-07T20:05:00Z',
    }]
    montar(purgado)
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    // El hecho sigue ahí, con sus horas calculadas.
    expect(screen.getByText(/Entrada: 06:03/)).toBeTruthy()
    expect(screen.getByText(/Salida: 14:05/)).toBeTruthy()
    // Y sigue constando CÓMO se marcó, aunque la prueba ya no esté.
    expect(screen.getByText('Marcado por la persona')).toBeTruthy()
    // Sin foto ni coordenada: no se intenta firmar ninguna URL ni pintar nada.
    expect(mocks.secureImage).not.toHaveBeenCalled()
    expect(screen.queryByText(/📍/)).toBeNull()
  })
})
