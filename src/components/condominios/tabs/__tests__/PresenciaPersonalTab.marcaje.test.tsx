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
import type {
  BloqueTurno, MiFichaPresencia, PausaPresencia, PersonalCondominio, PresenciaPersonal, TipoPausa,
} from '../../../../types'

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
  registro_fecha: null,
  pausa_abierta_id: null,
  pausa_abierta_tipo: null,
  pausa_abierta_etiqueta: null,
  pausa_abierta_desde: null,
  minutos_pausa: 0,
  minutos_pausa_descontables: 0,
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
  fetchTiposPausa: vi.fn(),
  fetchPausasDeRegistros: vi.fn(),
  marcarPausa: vi.fn(),
  agregarPausa: vi.fn(),
  ajustarPausa: vi.fn(),
  anularPausa: vi.fn(),
  guardarTipoPausa: vi.fn(),
  fetchBalanceDias: vi.fn(),
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
// El desglose (`desglose`, `pausasVigentes`, `minutosPausa`) NO se mockea: es
// aritmética pura y gemela de la del SQL, y sustituirla por un stub dejaría de
// comprobar justo el número que importa. Solo se interceptan las que van a red.
vi.mock('../../../../domain/condominios/pausasPresencia', async (original) => ({
  ...(await original<typeof import('../../../../domain/condominios/pausasPresencia')>()),
  fetchTiposPausa: mocks.fetchTiposPausa,
  fetchPausasDeRegistros: mocks.fetchPausasDeRegistros,
  marcarPausa: mocks.marcarPausa,
  agregarPausa: mocks.agregarPausa,
  ajustarPausa: mocks.ajustarPausa,
  anularPausa: mocks.anularPausa,
  guardarTipoPausa: mocks.guardarTipoPausa,
}))
// El balance (fase 2) solo LEE, pero lee por red. Se intercepta la consulta y
// no la lectura de los hallazgos: esa es aritmética de presentación y vale la
// pena que estas pruebas la ejerzan de verdad.
vi.mock('../../../../domain/condominios/balanceJornada', async (original) => ({
  ...(await original<typeof import('../../../../domain/condominios/balanceJornada')>()),
  fetchBalanceDias: mocks.fetchBalanceDias,
}))
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

const TIPOS_PAUSA: TipoPausa[] = [
  { codigo: 'refaccion', etiqueta: 'Refacción', descuenta: false, minutos_max: 30, orden: 1, configurado: false },
  { codigo: 'almuerzo', etiqueta: 'Almuerzo', descuenta: true, minutos_max: 60, orden: 2, configurado: false },
]

/** Una pausa cerrada, con la duración ya sellada por la base. */
function pausa(extra: Partial<PausaPresencia> = {}): PausaPresencia {
  return {
    id: 'pa-1', registro_id: 'r1', personal_id: 'per-1', tipo: 'almuerzo', etiqueta: 'Almuerzo',
    descuenta: true, inicio_en: '2026-09-08T18:00:00Z', fin_en: '2026-09-08T19:00:00Z',
    minutos: 60, origen: 'autoservicio', cerrada_al_salir: false, ...extra,
  }
}

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
  mocks.fetchTiposPausa.mockResolvedValue({ tipos: TIPOS_PAUSA, error: null })
  mocks.fetchPausasDeRegistros.mockResolvedValue({ pausas: [], error: null })
  mocks.marcarPausa.mockResolvedValue({
    data: { pausa_id: 'pa-1', accion: 'iniciar', tipo: 'almuerzo', etiqueta: 'Almuerzo', descuenta: true, minutos: null },
    error: null,
  })
  mocks.agregarPausa.mockResolvedValue({ error: null })
  mocks.ajustarPausa.mockResolvedValue({ error: null })
  mocks.anularPausa.mockResolvedValue({ error: null })
  mocks.guardarTipoPausa.mockResolvedValue({ error: null })
  mocks.fetchBalanceDias.mockResolvedValue({ dias: [], error: null })
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
    expect(await screen.findByText(/🟢 Marcar mi entrada/)).toBeTruthy()
    expect(screen.getByText(/Solo estoy consultando/)).toBeTruthy()
    // Y no aterriza en la lista del equipo antes de preguntar.
    expect(screen.queryByText('Registrar asistencia')).toBeNull()
  })

  it('a quien NO tiene expediente no le ofrece marcar: va directo a consultar', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    montar()
    await waitFor(() => expect(screen.getByText(/Sin registros para/)).toBeTruthy())
    expect(screen.queryByText(/🟢 Marcar mi entrada/)).toBeNull()
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
    fireEvent.click(await screen.findByText(/🟢 Marcar mi entrada/))
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
    expect(await screen.findByText(/🟢 Confirmar mi entrada/)).toBeTruthy()
    expect(screen.queryByText(/📷 Marcar mi entrada/)).toBeNull()
  })

  it('sube la foto ANTES de marcar y no manda ninguna hora', async () => {
    await entrarAMarcar()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'selfie.jpg', { type: 'image/jpeg' })] } })

    fireEvent.click(await screen.findByText(/Confirmar mi entrada/))

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
    // Sin clic intermedio: con el turno abierto el tab va derecho a las acciones.
    expect(await screen.findByText(/Registrar mi salida/)).toBeTruthy()
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
      await screen.findByText(/Registrar mi salida/)
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      fireEvent.change(input, { target: { files: [new File(['x'], 's.jpg', { type: 'image/jpeg' })] } })
      fireEvent.click(await screen.findByText(/Confirmar mi salida/))
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
    // Con la jornada cerrada el botón invita a REVISARLA, no a volver a fichar:
    // «Ingresar a mi turno» sobre un turno ya cerrado invitaba justo a eso.
    fireEvent.click(await screen.findByText(/📋 Ver mi jornada de hoy/))
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
    fireEvent.click(await screen.findByText(/Confirmar mi entrada/))
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
    fireEvent.click(await screen.findByText(/📋 Ver mi jornada de hoy/))
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
    // Anulada NO es «completa»: el selector ofrece marcar entrada, no revisar.
    fireEvent.click(await screen.findByText(/🟢 Marcar mi entrada/))
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

// ════════════════════════════════════════════════════════════════════════════
// Las pausas de la jornada (20260908000300)
// ════════════════════════════════════════════════════════════════════════════
// Lo que se cubre aquí es, otra vez, lo que el sandbox SQL no puede ver: que la
// pantalla no pida NUNCA una hora ni una duración para pausar, que se diga si
// la pausa descuenta ANTES de pulsarla, y que las tres cifras de la lista se
// muevan cuando se mueve una pausa.

const FICHA_EN_TURNO: MiFichaPresencia = {
  ...FICHA, registro_id: 'r1', hora_entrada: '06:03:11', estado: 'presente', origen: 'autoservicio',
  registro_fecha: '2026-09-07', hora_servidor: '12:03:11',
}

describe('el empleado marca su pausa', () => {
  // Con la jornada abierta el tab NO pregunta nada: entra derecho a la pantalla
  // de las dos acciones. Que estas pruebas no tengan que pulsar nada para llegar
  // ES el arreglo — antes había una pregunta en medio que tapaba los botones.
  async function entrarConTurnoAbierto(ficha: MiFichaPresencia = FICHA_EN_TURNO) {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha, error: null })
    montar()
    return screen.findByText('Marco Sical')
  }

  /** Despliega los tipos: la clasificación vive DETRÁS del botón de descanso. */
  async function abrirDescanso() {
    fireEvent.click(await screen.findByText(/⏸️ Registrar mi descanso/))
  }

  it('con el turno abierto, las dos acciones se ven sin pulsar nada', async () => {
    // El fallo que esto fija: una persona ya ingresada no encontraba dónde
    // marcar su descanso ni su salida, porque la pregunta «¿qué vas a hacer?»
    // se interponía con un botón que decía «Ingresar a mi turno».
    await entrarConTurnoAbierto()
    expect(await screen.findByText(/⏸️ Registrar mi descanso/)).toBeTruthy()
    expect(screen.getByText(/📷 Registrar mi salida/)).toBeTruthy()
    // Y la pregunta que las tapaba ya no aparece.
    expect(screen.queryByText('¿Qué vas a hacer?')).toBeNull()
  })

  it('la observación ya no se interpone entre los dos botones', async () => {
    // Casi nadie la escribe, y un campo de texto en medio separaba los botones
    // lo suficiente como para que el segundo dejara de verse.
    await entrarConTurnoAbierto()
    await screen.findByText(/⏸️ Registrar mi descanso/)
    expect(screen.queryByPlaceholderText('Observación (opcional)')).toBeNull()
    fireEvent.click(screen.getByText('Agregar una observación'))
    expect(screen.getByPlaceholderText('Observación (opcional)')).toBeTruthy()
  })

  it('el descanso es UN botón y la clasificación viene después', async () => {
    await entrarConTurnoAbierto()
    // Los tipos no compiten con la salida hasta que se pide el descanso.
    expect(screen.queryByText(/☕ Refacción/)).toBeNull()

    await abrirDescanso()
    expect(await screen.findByText(/☕ Refacción/)).toBeTruthy()
    expect(screen.getByText(/🍽️ Almuerzo/)).toBeTruthy()
  })

  it('el botón del tipo NO enseña si descuenta', async () => {
    // No es información que ayude a decidir —se elige por lo que se va a hacer,
    // no por lo que se paga— y una al lado de otra enseñan el arbitraje: marcar
    // todo como el tipo que no descuenta. Lo que sí se dice es al TERMINAR, con
    // la clasificación ya hecha (ver la prueba de abajo).
    await entrarConTurnoAbierto()
    await abrirDescanso()
    expect(screen.queryByText('se descuenta')).toBeNull()
    expect(screen.queryByText('cuenta como jornada')).toBeNull()
  })

  it('al TERMINAR sí se le dice cuánto duró y si se descuenta', async () => {
    mocks.marcarPausa.mockResolvedValue({
      data: { pausa_id: 'pa-1', accion: 'terminar', tipo: 'almuerzo', etiqueta: 'Almuerzo', descuenta: true, minutos: 45 },
      error: null,
    })
    await entrarConTurnoAbierto({
      ...FICHA_EN_TURNO,
      pausa_abierta_id: 'pa-1', pausa_abierta_tipo: 'almuerzo', pausa_abierta_etiqueta: 'Almuerzo',
      pausa_abierta_desde: new Date(Date.now() - 45 * 60_000).toISOString(),
    })
    fireEvent.click(await screen.findByText(/Regresé de Almuerzo/))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('se descuentan de tu jornada') }),
    ))
  })

  it('pausar NO manda ninguna hora ni duración: solo el tipo', async () => {
    // Es la misma garantía que protege el marcaje. Si el cliente pudiera mandar
    // los instantes, la persona estaría tecleando minutos que se restan de su
    // propio pago.
    await entrarConTurnoAbierto()
    await abrirDescanso()
    fireEvent.click(await screen.findByText(/🍽️ Almuerzo/))
    await waitFor(() => expect(mocks.marcarPausa).toHaveBeenCalled())
    const args = mocks.marcarPausa.mock.calls[0][0]
    expect(args).toEqual({ projectId: 'p1', accion: 'iniciar', tipo: 'almuerzo', coords: expect.anything() })
    expect(Object.keys(args).some(k => /hora|fecha|minut|inicio|fin/i.test(k))).toBe(false)
  })

  it('con una pausa abierta, la única acción de pausa es volver', async () => {
    await entrarConTurnoAbierto({
      ...FICHA_EN_TURNO,
      pausa_abierta_id: 'pa-1', pausa_abierta_tipo: 'almuerzo', pausa_abierta_etiqueta: 'Almuerzo',
      pausa_abierta_desde: new Date(Date.now() - 25 * 60_000).toISOString(),
    })
    expect(await screen.findByText(/Regresé de Almuerzo/)).toBeTruthy()
    // Ni se puede abrir una segunda pausa encima de la abierta…
    expect(screen.queryByText(/Registrar mi descanso/)).toBeNull()
    // …y se avisa de lo que pasa si se va sin volver, ANTES de que se vaya.
    expect(screen.getByText(/la pausa se cierra en ese momento/)).toBeTruthy()

    fireEvent.click(screen.getByText(/Regresé de Almuerzo/))
    await waitFor(() => expect(mocks.marcarPausa).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'terminar' }),
    ))
  })

  it('antes de marcar entrada no hay nada que pausar', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: FICHA, error: null })
    montar()
    fireEvent.click(await screen.findByText(/🟢 Marcar mi entrada/))
    await screen.findByText('Marco Sical')
    expect(screen.queryByText(/Registrar mi descanso/)).toBeNull()
  })

  it('la cámara ya NO se abre sola con la jornada abierta', async () => {
    // Se entra a esta pantalla tres o cuatro veces al día a marcar pausas. Una
    // cámara que salta encima de los botones estorba en todas menos una.
    await entrarConTurnoAbierto()
    await screen.findByText(/⏸️ Registrar mi descanso/)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    // Y la salida se sigue pudiendo marcar con UN toque.
    expect(screen.getByText(/📷 Registrar mi salida/)).toBeTruthy()
  })

  it('avisa cuando la jornada abierta es la de AYER (turno nocturno)', async () => {
    await entrarConTurnoAbierto({ ...FICHA_EN_TURNO, registro_fecha: '2026-09-06' })
    expect(await screen.findByText(/Jornada abierta del 2026-09-06/)).toBeTruthy()
  })
})

describe('las pausas en la lista del día', () => {
  it('separa estadía de horas laborales solo cuando la pausa descuenta', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({ pausas: [pausa()], error: null })
    montar([filaDelDia({ hora_entrada: '06:00:00', hora_salida: '14:00:00' })])
    // 8 h en el puesto, 1 h de almuerzo que descuenta → 7 h laborales.
    expect(await screen.findByText(/Estadía: 8h/)).toBeTruthy()
    expect(screen.getByText(/Laborales: 7h/)).toBeTruthy()
    expect(screen.getByText(/Descanso: 1h/)).toBeTruthy()
  })

  it('con una pausa que NO descuenta enseña UN solo número, no dos iguales', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({
      pausas: [pausa({ tipo: 'refaccion', etiqueta: 'Refacción', descuenta: false, minutos: 30 })],
      error: null,
    })
    montar([filaDelDia({ hora_entrada: '06:00:00', hora_salida: '14:00:00' })])
    await screen.findByText(/Descanso: 0h 30m/)
    expect(screen.queryByText(/Estadía:/)).toBeNull()
    expect(screen.getByText(/· 8h/)).toBeTruthy()
  })

  it('la pausa anulada se ve, pero ya no resta', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({
      pausas: [pausa({ anulado_en: '2026-09-08T20:00:00Z' })], error: null,
    })
    montar([filaDelDia({ hora_entrada: '06:00:00', hora_salida: '14:00:00' })])
    // Sigue en pantalla —es evidencia de por qué la fila cambió de número—…
    expect(await screen.findByText('Almuerzo')).toBeTruthy()
    // …pero las 8 h vuelven a ser las 8 h.
    expect(screen.queryByText(/Laborales:/)).toBeNull()
  })

  it('marca la pausa que cerró el sistema, no la persona', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({
      pausas: [pausa({ cerrada_al_salir: true })], error: null,
    })
    montar([filaDelDia()])
    expect(await screen.findByText(/sin cerrar/)).toBeTruthy()
  })

  it('agregar la pausa que nadie marcó exige motivo y pasa por la RPC', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.openPromptDialog.mockResolvedValue({ tipo: 'almuerzo', minutos: '45', motivo: 'Olvidó marcarlo' })
    montar([filaDelDia()])
    fireEvent.click(await screen.findByTitle('Para la pausa que la persona no marcó'))
    await waitFor(() => expect(mocks.agregarPausa).toHaveBeenCalledWith({
      registroId: 'r1', tipo: 'almuerzo', minutos: 45, motivo: 'Olvidó marcarlo',
    }))
    // El diálogo rechaza un motivo corto antes de llegar a la base.
    const { validate } = mocks.openPromptDialog.mock.calls[0][0]
    expect(validate({ tipo: 'almuerzo', minutos: '45', motivo: 'ok' })).toMatch(/motivo/i)
    expect(validate({ tipo: 'almuerzo', minutos: '0', motivo: 'Olvidó marcarlo' })).toMatch(/1 y 1440/)
  })

  it('ajustar una pausa manda MINUTOS, nunca instantes', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({ pausas: [pausa()], error: null })
    mocks.openPromptDialog.mockResolvedValue({ minutos: '30', motivo: 'Volvió antes' })
    montar([filaDelDia()])
    fireEvent.click(await screen.findByLabelText('Ajustar Almuerzo'))
    await waitFor(() => expect(mocks.ajustarPausa).toHaveBeenCalledWith('pa-1', 30, 'Volvió antes'))
    // La hora la puso el servidor y la sigue poniendo: no hay campo para ella.
    const campos = mocks.openPromptDialog.mock.calls[0][0].fields.map((f: { name: string }) => f.name)
    expect(campos).toEqual(['minutos', 'motivo'])
  })

  it('anular una pausa exige `.delete`, no `.edit`', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({ pausas: [pausa()], error: null })
    montar([filaDelDia()], [], { canEdit: true, canDelete: false })
    await screen.findByText('Almuerzo')
    expect(screen.queryByLabelText('Anular Almuerzo')).toBeNull()
    // Ajustar sí, que es el permiso que sí tiene.
    expect(screen.getByLabelText('Ajustar Almuerzo')).toBeTruthy()
  })

  it('sin `.edit` no se ajusta ni se agrega ninguna pausa', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchPausasDeRegistros.mockResolvedValue({ pausas: [pausa()], error: null })
    montar([filaDelDia()], [], { canEdit: false, canDelete: false })
    await screen.findByText('Almuerzo')
    expect(screen.queryByLabelText('Ajustar Almuerzo')).toBeNull()
    expect(screen.queryByTitle('Para la pausa que la persona no marcó')).toBeNull()
  })
})

describe('la configuración de qué descuenta', () => {
  it('dice que el cambio vale hacia adelante, y guarda la regla invertida', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    montar([filaDelDia()])
    fireEvent.click(await screen.findByTitle('Qué pausas descuentan de las horas que se pagan'))
    // Lo que hace seguro tocar esto: no reescribe ninguna planilla cerrada.
    expect(screen.getByText(/hacia adelante/)).toBeTruthy()

    fireEvent.click(screen.getByText('No descuenta'))
    await waitFor(() => expect(mocks.guardarTipoPausa).toHaveBeenCalledWith({
      codigo: 'refaccion', etiqueta: 'Refacción', descuenta: true, minutosMax: 30,
    }))
  })

  it('sin `.edit` la configuración no se ofrece', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    montar([filaDelDia()], [], { canEdit: false })
    await screen.findByText('Marco Sical')
    expect(screen.queryByTitle('Qué pausas descuentan de las horas que se pagan')).toBeNull()
  })
})

// ── El balance del día (fase 2) ─────────────────────────────────────────────
//
// Lo que estas pruebas protegen no es la aritmética —esa vive en SQL y tiene su
// sandbox— sino el criterio de qué se le dice a quien mira la lista: que el día
// que cumple no diga nada, que el que todavía no se puede juzgar no se acuse, y
// sobre todo que el turno planificado que NADIE marcó aparezca, porque sin
// marcaje no hay fila donde apareciera solo.
describe('el balance contra la jornada', () => {
  function balance(over: Record<string, unknown> = {}) {
    return {
      personal_id: 'per-1', nombre: 'Marco Sical', cargo: 'guardia', fecha: HOY,
      bloque_id: 'blq-1', turno_inicio: '06:00:00', turno_fin: '14:00:00',
      horas_planificadas: 7.25, tiene_vara: true,
      registro_id: 'r1', hora_entrada: '06:00:00', hora_salida: '14:00:00',
      horas_estadia: 8, horas_descanso: 0.75, horas_laborales: 7.25,
      minutos_tarde: 0, tramo_demora: null, minutos_salida_temprana: 0,
      minutos_exceso_descanso: 0, horas_sobre_jornada: 0,
      extra_requiere_autorizacion: true, cumple: true, hallazgos: [] as string[],
      ...over,
    }
  }

  it('el día que cumple no agrega ni una palabra a su fila', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchBalanceDias.mockResolvedValue({ dias: [balance()], error: null })
    montar([filaDelDia()])
    await screen.findByText('Marco Sical')
    expect(screen.queryByText(/Contra la jornada/)).toBeNull()
  })

  it('la demora se enseña con su tramo, junto al marcaje que la produjo', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchBalanceDias.mockResolvedValue({
      dias: [balance({ cumple: false, hallazgos: ['demora'], minutos_tarde: 25, tramo_demora: 'compensable' })],
      error: null,
    })
    montar([filaDelDia()])
    expect(await screen.findByText(/entró 25 min tarde \(se compensa\)/)).toBeTruthy()
  })

  it('la jornada abierta se marca en espera, no como incumplimiento', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchBalanceDias.mockResolvedValue({
      dias: [balance({ hora_salida: null, cumple: false, hallazgos: ['jornada_abierta'] })],
      error: null,
    })
    montar([filaDelDia({ hora_salida: null })])
    const linea = await screen.findByText(/Contra la jornada/)
    expect(linea.textContent).toContain('la jornada quedó abierta')
    expect(linea.textContent).toContain('⏳')
  })

  it('el turno que nadie cubrió se enseña aunque no tenga fila', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchBalanceDias.mockResolvedValue({
      dias: [balance({
        registro_id: null, hora_entrada: null, hora_salida: null,
        horas_estadia: null, horas_laborales: null,
        cumple: false, hallazgos: ['sin_marcaje'],
      })],
      error: null,
    })
    montar([])
    expect(await screen.findByText('Turnos planificados sin marcaje')).toBeTruthy()
    expect(screen.getByText(/06:00–14:00/)).toBeTruthy()
  })

  it('sobre una fila anulada no se juzga nada: ese día, para la vara, no existe', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchBalanceDias.mockResolvedValue({
      dias: [balance({ cumple: false, hallazgos: ['demora'], minutos_tarde: 25, tramo_demora: 'compensable' })],
      error: null,
    })
    montar([filaDelDia({ anulado_en: '2026-09-08T20:00:00Z' })])
    await screen.findByText('Marco Sical')
    expect(screen.queryByText(/Contra la jornada/)).toBeNull()
  })

  it('si la cuenta no tiene el permiso, el balance calla y el marcaje sigue', async () => {
    mocks.fetchMiFichaPresencia.mockResolvedValue({ ficha: null, error: null })
    mocks.fetchBalanceDias.mockResolvedValue({ dias: [], error: 'no autorizado' })
    montar([filaDelDia()])
    expect(await screen.findByText('Marco Sical')).toBeTruthy()
    expect(screen.queryByText(/Contra la jornada/)).toBeNull()
    expect(screen.queryByText('Turnos planificados sin marcaje')).toBeNull()
  })
})
