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
  corregido_en: null,
  corregido_por_nombre: null,
  motivo_correccion: null,
  anulado_en: null,
}

const mocks = vi.hoisted(() => ({
  fetchMiFichaPresencia: vi.fn(),
  marcarPresencia: vi.fn(),
  subirFotoMarcaje: vi.fn(),
  obtenerUbicacion: vi.fn(),
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  notify: vi.fn(),
  confirm: vi.fn(),
  corregirPresencia: vi.fn(),
  anularPresencia: vi.fn(),
  openPromptDialog: vi.fn(),
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
  corregirPresencia: mocks.corregirPresencia,
  anularPresencia: mocks.anularPresencia,
}))
vi.mock('../../../shared/PromptDialog', () => ({ openPromptDialog: mocks.openPromptDialog }))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
}))
vi.mock('../../../../lib/nativeGeo', () => ({ obtenerUbicacion: mocks.obtenerUbicacion }))
vi.mock('../../../shared/Dialog', () => ({ notify: mocks.notify, confirm: mocks.confirm }))
vi.mock('../../../shared/SecureImage', () => ({
  SecureImage: (props: { src?: string | null; bucket?: string }) => { mocks.secureImage(props); return null },
}))

const { default: PresenciaPersonalTab } = await import('../PresenciaPersonalTab')

const PERSONAL: PersonalCondominio[] = [{
  id: 'per-1', company_id: 'c1', project_id: 'p1', nombre: 'Marco Sical',
  cargo: 'guardia', turno: 'diurno', estado: 'activo', created_at: '2026-01-01',
} as PersonalCondominio]

function montar(
  registros: PresenciaPersonal[] = [],
  bloques: BloqueTurno[] = [],
  permisos: { canCreate?: boolean; canEdit?: boolean; canDelete?: boolean } = {},
) {
  const { canCreate = true, canEdit = true, canDelete = true } = permisos
  return render(
    <PresenciaPersonalTab
      registros={registros}
      personal={PERSONAL}
      bloques={bloques}
      proyectoId="p1"
      companyId="c1"
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      onRefresh={() => {}}
    />,
  )
}

const HOY = new Date().toISOString().slice(0, 10)

/** Fila base de la lista del día, para las pruebas de corrección. */
function filaDelDia(extra: Partial<PresenciaPersonal> = {}): PresenciaPersonal {
  return {
    id: 'r1', company_id: 'c1', project_id: 'p1', nombre: 'Marco Sical', cargo: 'guardia',
    fecha: HOY, hora_entrada: '06:02:07', hora_salida: '06:02:41', estado: 'presente',
    created_at: '2026-09-08', origen: 'autoservicio', ...extra,
  } as PresenciaPersonal
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: FICHA, error: null })
  mocks.marcarPresencia.mockResolvedValue({
    data: { registro_id: 'r1', fecha: '2026-09-07', hora: '06:03:11', estado: 'presente', tipo: 'entrada' },
    error: null,
  })
  mocks.subirFotoMarcaje.mockResolvedValue({ path: 'p1/per-1/1757-foto.jpg', error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.corregirPresencia.mockResolvedValue({ error: null })
  mocks.anularPresencia.mockResolvedValue({ error: null })
  mocks.openPromptDialog.mockResolvedValue(null)
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
    expect(screen.getByText(/Se abre la cámara/)).toBeTruthy()
  })

  it('sin foto el botón NO está apagado: abre la cámara', async () => {
    // Un botón deshabilitado no explica qué falta. Antes la única forma de
    // empezar era pulsar un recuadro punteado que se leía como adorno.
    await entrarAMarcar()
    const boton = screen.getByText(/📷 Marcar mi entrada/).closest('button')!
    expect(boton.hasAttribute('disabled')).toBe(false)

    fireEvent.click(boton)
    // Abre la cámara, no registra nada todavía.
    expect(mocks.marcarPresencia).not.toHaveBeenCalled()
  })

  it('con la foto tomada, el botón pasa a confirmar', async () => {
    await entrarAMarcar()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText(/🟢 Confirmar entrada/)).toBeTruthy()
    expect(screen.queryByText(/📷 Marcar mi entrada/)).toBeNull()
  })

  it('sube la foto ANTES de marcar y no manda ninguna hora', async () => {
    await entrarAMarcar()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] } })

    fireEvent.click(await screen.findByText(/Confirmar entrada/))

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

  describe('la salida no se cierra sin querer', () => {
    // Dos de las cuatro primeras personas que ficharon en producción cerraron
    // su jornada a los segundos de entrar, por volver a pulsar.
    const reciénEntrada = {
      ...FICHA, registro_id: 'r1', hora_entrada: '16:49:10', hora_servidor: '16:50:00',
      estado: 'presente' as const, origen: 'autoservicio' as const,
    }

    async function irAMarcarSalida(ficha: MiFichaPresencia) {
      mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha, error: null })
      montar()
      fireEvent.click(await screen.findByText(/Ingresar a mi turno/))
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['x'], 's.jpg', { type: 'image/jpeg' })] } })
      fireEvent.click(await screen.findByText(/Confirmar salida/))
    }

    it('pregunta si la entrada fue hace menos de 5 minutos', async () => {
      await irAMarcarSalida(reciénEntrada)
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
      const arg = mocks.confirm.mock.calls[0][0]
      expect(arg.text).toContain('16:49')   // le recuerda a qué hora entró
    })

    it('si cancela, no se registra nada', async () => {
      mocks.confirm.mockResolvedValue({ isConfirmed: false })
      await irAMarcarSalida(reciénEntrada)
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
      expect(mocks.marcarPresencia).not.toHaveBeenCalled()
    })

    it('una jornada normal no pregunta nada', async () => {
      await irAMarcarSalida({ ...reciénEntrada, hora_entrada: '06:00:00', hora_servidor: '14:00:00' })
      await waitFor(() => expect(mocks.marcarPresencia).toHaveBeenCalled())
      expect(mocks.confirm).not.toHaveBeenCalled()
    })
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
    mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.corregirPresencia.mockResolvedValue({ error: null })
  mocks.anularPresencia.mockResolvedValue({ error: null })
  mocks.openPromptDialog.mockResolvedValue(null)
  mocks.obtenerUbicacion.mockResolvedValue({ coords: null, error: 'Permiso de ubicación denegado' })
    await entrarAMarcar()
    expect(await screen.findByText(/Sin ubicación — Permiso de ubicación denegado/)).toBeTruthy()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] } })
    fireEvent.click(await screen.findByText(/Confirmar entrada/))
    // Se registra igual, y la fila lo dirá: coords en null.
    await waitFor(() => expect(mocks.marcarPresencia).toHaveBeenCalled())
    expect(mocks.marcarPresencia.mock.calls[0][0].coords).toBeNull()
  })
})

describe('lo que se le dice a la persona sobre su propia jornada', () => {
  // Enterarse por el recibo de pago de que a uno le cambiaron la jornada es la
  // peor forma de enterarse.
  it('avisa cuando le corrigieron el marcaje, con quién y por qué', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({
      ficha: {
        ...FICHA, registro_id: 'r1', hora_entrada: '06:02:00', hora_salida: '14:05:00',
        estado: 'presente' as const, origen: 'autoservicio' as const,
        corregido_en: '2026-09-08T12:00:00Z', corregido_por_nombre: 'Ada Admin',
        motivo_correccion: 'salida marcada por error',
      },
      error: null,
    })
    montar()
    fireEvent.click(await screen.findByText(/Ingresar a mi turno/))
    expect(await screen.findByText(/Tu jornada de hoy fue corregida/)).toBeTruthy()
    expect(screen.getByText(/Ada Admin: salida marcada por error/)).toBeTruthy()
  })

  it('si se la anularon, el día vuelve a empezar', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({
      ficha: {
        ...FICHA, registro_id: 'r1', hora_entrada: '06:02:00', hora_salida: '14:05:00',
        estado: 'presente' as const, origen: 'autoservicio' as const,
        corregido_en: '2026-09-08T12:00:00Z', corregido_por_nombre: 'Ada Admin',
        motivo_correccion: 'marcó en el condominio equivocado',
        anulado_en: '2026-09-08T12:00:00Z',
      },
      error: null,
    })
    montar()
    fireEvent.click(await screen.findByText(/Ingresar a mi turno/))
    expect(await screen.findByText(/Tu marcaje de hoy fue anulado/)).toBeTruthy()
    // Lo que le toca es volver a marcar ENTRADA, no cerrar una salida que ya no
    // existe. Y las horas anuladas no se le muestran como si contaran.
    expect(screen.getByText(/Marcar mi entrada/)).toBeTruthy()
    expect(screen.queryByText('06:02')).toBeNull()
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

describe('corregir y anular desde la lista', () => {
  beforeEach(() => { mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null }) })

  it('sin permiso de editar no se ofrece corregir', async () => {
    montar([filaDelDia()], [], { canEdit: false, canDelete: false })
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    expect(screen.queryByText(/Corregir/)).toBeNull()
    expect(screen.queryByText(/Anular/)).toBeNull()
  })

  it('anular es un permiso APARTE de corregir', async () => {
    // Quien puede corregir no debería poder invalidar una jornada entera.
    montar([filaDelDia()], [], { canEdit: true, canDelete: false })
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    expect(screen.getByText(/Corregir/)).toBeTruthy()
    expect(screen.queryByText(/Anular/)).toBeNull()
  })

  it('la corrección pide motivo y viaja con él', async () => {
    mocks.openPromptDialog.mockResolvedValue({
      hora_entrada: '06:02', hora_salida: '14:05', estado: 'presente',
      motivo: 'salida marcada por error el primer día',
    })
    montar([filaDelDia()])
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    fireEvent.click(screen.getByText(/Corregir/))

    await waitFor(() => expect(mocks.corregirPresencia).toHaveBeenCalled())
    expect(mocks.corregirPresencia.mock.calls[0][0]).toEqual({
      registroId: 'r1',
      horaEntrada: '06:02',
      horaSalida: '14:05',
      estado: 'presente',
      motivo: 'salida marcada por error el primer día',
    })
    // El formulario exige el motivo antes de llegar a la base.
    const opciones = mocks.openPromptDialog.mock.calls[0][0]
    expect(opciones.validate({ hora_entrada: '06:02', motivo: 'x' })).toMatch(/motivo/i)
    expect(opciones.validate({ hora_entrada: '', motivo: 'un motivo válido' })).toMatch(/entrada/i)
    expect(opciones.validate({ hora_entrada: '06:02', motivo: 'un motivo válido' })).toBeNull()
  })

  it('vaciar la salida en la corrección reabre la jornada', async () => {
    mocks.openPromptDialog.mockResolvedValue({
      hora_entrada: '06:02', hora_salida: '', estado: 'presente', motivo: 'aún no salía',
    })
    montar([filaDelDia()])
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    fireEvent.click(screen.getByText(/Corregir/))
    await waitFor(() => expect(mocks.corregirPresencia).toHaveBeenCalled())
    expect(mocks.corregirPresencia.mock.calls[0][0].horaSalida).toBeNull()
  })

  it('si se cancela el formulario no se toca nada', async () => {
    montar([filaDelDia()])
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    fireEvent.click(screen.getByText(/Corregir/))
    await waitFor(() => expect(mocks.openPromptDialog).toHaveBeenCalled())
    expect(mocks.corregirPresencia).not.toHaveBeenCalled()
  })

  it('una fila anulada se ve, se explica, y ya no se opera', async () => {
    montar([filaDelDia({
      anulado_en: '2026-09-08T12:00:00Z', corregido_en: '2026-09-08T12:00:00Z',
      corregido_por_nombre: 'Ada Admin', motivo_correccion: 'marcaje de prueba',
    })])
    await waitFor(() => expect(screen.getByText('Marco Sical')).toBeTruthy())
    expect(screen.getByText('ANULADA')).toBeTruthy()
    expect(screen.getByText(/Anulada por Ada Admin.*marcaje de prueba/)).toBeTruthy()
    // Ni corregir ni anular ni cambiar el estado: ya no cuenta.
    expect(screen.queryByText(/Corregir/)).toBeNull()
    expect(screen.queryByText(/^Anular$/)).toBeNull()
  })

  it('lo anulado no infla los contadores del día', async () => {
    montar([
      filaDelDia({ id: 'r1' }),
      filaDelDia({ id: 'r2', nombre: 'Ana López', anulado_en: '2026-09-08T12:00:00Z' }),
    ])
    await waitFor(() => expect(screen.getByText('Ana López')).toBeTruthy())
    // Dos filas en pantalla, un solo presente vigente.
    const presentes = screen.getByText('Presente', { selector: 'div' }).previousSibling
    expect(presentes?.textContent).toBe('1')
  })
})
