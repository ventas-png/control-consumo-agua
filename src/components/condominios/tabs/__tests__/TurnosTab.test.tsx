import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AsignacionTurno, AusenciaPersonal, BloqueTurno, CupoPausa, DiaNoLaborable,
  ExcepcionTurno, PersonalCondominio, PlantillaHorario,
} from '../../../../types'

// Mismo patrón que MensajesPortalTab.test: el tab entra a Supabase solo por la
// capa domain, así que se mockea ahí (y el cliente, importado de forma
// transitiva) para ejercitar la UI sin red ni env vars.
const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn<
    () => Promise<{ error: { message: string } | null }>
  >(async () => ({ error: null })),
  updateCondominioRow: vi.fn<
    () => Promise<{ error: { message: string } | null }>
  >(async () => ({ error: null })),
  deleteCondominioRow: vi.fn<
    () => Promise<{ error: { message: string } | null }>
  >(async () => ({ error: null })),
  generarBloquesTurno: vi.fn(async () => ({
    data: { generados: 22, omitidos_ausencia: 0, omitidos_no_laborable: 0, omitidos_existente: 0 },
    error: null,
  })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  createCondominioRowReturning: vi.fn<
    () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
  >(async () => ({ data: { id: 'ph-nueva' }, error: null })),
  fetchCuposDePlantillas: vi.fn<
    () => Promise<{ cupos: CupoPausa[]; error: string | null }>
  >(async () => ({ cupos: [], error: null })),
  guardarJornadaConCupos: vi.fn<
    () => Promise<{ id: string | null; error: string | null }>
  >(async () => ({ id: 'ph-nueva', error: null })),
  fetchTiposPausa: vi.fn(async () => ({ tipos: TIPOS_PAUSA, error: null })),
  fetchBloquesTurnoRango: vi.fn<
    () => Promise<{ data: BloqueTurno[] | null; error: { message: string } | null }>
  >(async () => ({ data: [], error: null })),
}))

const TIPOS_PAUSA = [
  { codigo: 'refaccion', etiqueta: 'Refacción', descuenta: false, minutos_max: 30, orden: 1, configurado: true },
  { codigo: 'almuerzo', etiqueta: 'Almuerzo', descuenta: true, minutos_max: 60, orden: 2, configurado: true },
]

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  createCondominioRowReturning: mocks.createCondominioRowReturning,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  generarBloquesTurno: mocks.generarBloquesTurno,
}))
// `tramosDemora` y `minutosCupoQueDescuentan` NO se mockean: son aritmética pura
// y lo que se comprueba abajo es justo lo que producen en pantalla.
vi.mock('../../../../domain/condominios/politicaJornada', async (original) => ({
  ...(await original<typeof import('../../../../domain/condominios/politicaJornada')>()),
  fetchCuposDePlantillas: mocks.fetchCuposDePlantillas,
  guardarJornadaConCupos: mocks.guardarJornadaConCupos,
}))
vi.mock('../../../../domain/condominios/pausasPresencia', () => ({
  fetchTiposPausa: mocks.fetchTiposPausa,
}))
// El calendario pide SUS bloques (el prop `bloques` viene topado a 200 filas
// del proyecto entero). Sin este mock la consulta entra al cliente falso de
// arriba, que no tiene `.select`, y el tab revienta al montar.
vi.mock('../../../../domain/condominios/sectionData', () => ({
  fetchBloquesTurnoRango: mocks.fetchBloquesTurnoRango,
}))
// «Hoy» fijo. La mitad de lo que se prueba abajo —qué casilla se puede tocar y
// cuál no— depende de la fecha, y una prueba que cambia de resultado según el
// día en que se corra no prueba nada. 2026-09-16 es miércoles.
vi.mock('../../../../lib/format', async (original) => ({
  ...(await original<typeof import('../../../../lib/format')>()),
  hoyLocalISO: () => '2026-09-16',
}))
// La ruta se resuelve desde ESTE archivo, no desde el componente: sin el mock,
// `confirm()` monta un diálogo real que necesita <DialogProvider> y su promesa
// nunca resuelve, así que el test se cuelga en vez de fallar.
vi.mock('../../../shared/Dialog', () => ({
  confirm: mocks.confirm,
  notify: mocks.notify,
}))

const TurnosTab = (await import('../TurnosTab')).default

const plantilla: PlantillaHorario = {
  id: 'ph1', company_id: 'c1', project_id: 'p1', nombre: 'Nocturno', codigo: 'N',
  turno: 'noche', hora_inicio: '22:00', hora_fin: '06:00', cruza_medianoche: true,
  minutos_descanso: 0, horas_jornada: 8, tolerancia_entrada_min: 10,
  tolerancia_salida_min: 0, demora_compensable_hasta_min: 0, extra_requiere_autorizacion: true,
  color: 'var(--at-primary)', activo: true, created_at: '2026-08-01T00:00:00.000Z',
}

const empleado: PersonalCondominio = {
  id: 'emp1', company_id: 'c1', project_id: 'p1', nombre: 'Pedro Guardia',
  cargo: 'guardia', turno: 'nocturno', estado: 'activo',
} as PersonalCondominio

function regla(over: Partial<AsignacionTurno> = {}): AsignacionTurno {
  return {
    id: 'r1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
    plantilla_horario_id: 'ph1', nombre: 'Pedro · nocturno L-V',
    frecuencia: 'semanal', dias_semana: [1, 2, 3, 4, 5], dias_mes: [], fechas_especificas: [],
    fecha_inicio: '2026-01-01', cubre_dias_no_laborables: false, activa: true,
    created_at: '2026-08-01T00:00:00.000Z', personal_nombre: 'Pedro Guardia',
    ...over,
  }
}

function renderTab(props: Partial<Parameters<typeof TurnosTab>[0]> = {}) {
  return render(
    <TurnosTab
      plantillas={[plantilla]}
      asignaciones={[regla()]}
      bloques={[] as BloqueTurno[]}
      ausencias={[] as AusenciaPersonal[]}
      diasNoLaborables={[] as DiaNoLaborable[]}
      excepciones={[] as ExcepcionTurno[]}
      personal={[empleado]}
      proyectoId="p1"
      companyId="c1"
      canCreate
      canEdit
      onRefresh={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockClear())
  // `mockClear` sólo borra el historial de llamadas: lo que un test haya dejado
  // puesto con `mockResolvedValue` sigue puesto. Estos cuatro se reponen a mano
  // para que el orden de los tests no cambie el resultado.
  mocks.fetchBloquesTurnoRango.mockResolvedValue({ data: [], error: null })
  mocks.createCondominioRow.mockResolvedValue({ error: null })
  mocks.updateCondominioRow.mockResolvedValue({ error: null })
  mocks.deleteCondominioRow.mockResolvedValue({ error: null })
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.generarBloquesTurno.mockResolvedValue({
    data: { generados: 22, omitidos_ausencia: 0, omitidos_no_laborable: 0, omitidos_existente: 0 },
    error: null,
  })
})

afterEach(() => { cleanup() })

describe('TurnosTab — asignación de turnos', () => {
  it('pinta el calendario del mes con el empleado y sus horas', () => {
    renderTab()
    expect(screen.getByText('Pedro Guardia')).toBeTruthy()
    expect(screen.getByText('Turnos del mes')).toBeTruthy()
  })

  it('predice turnos aunque no haya ni un bloque generado', () => {
    // La regla cubre L-V: el mes no puede salir en cero solo porque nadie haya
    // pulsado «Generar». Es lo que justifica la recurrencia en TypeScript.
    renderTab()
    const kpi = screen.getByText('Turnos del mes').previousSibling
    expect(Number(kpi?.textContent)).toBeGreaterThan(0)
  })

  it('lista las reglas con su periodicidad legible', () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    expect(screen.getByText('Pedro · nocturno L-V')).toBeTruthy()
    expect(screen.getByText(/Semanal · L·M·X·J·V/)).toBeTruthy()
  })

  it('crea una jornada calculando sus horas en la BD, no en el cliente', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(screen.getByText('+ Nueva jornada'))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Diurno' } })
    fireEvent.change(screen.getByLabelText('Entrada'), { target: { value: '06:00' } })
    fireEvent.change(screen.getByLabelText('Salida'), { target: { value: '14:00' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.guardarJornadaConCupos).toHaveBeenCalledTimes(1))
    const [args] = mocks.guardarJornadaConCupos.mock.calls[0] as unknown as [Record<string, never>]
    const payload = args.datos as unknown as Record<string, unknown>
    expect(payload.nombre).toBe('Diurno')
    // `horas_jornada` NO viaja en el payload: la sella el trigger.
    expect(payload.horas_jornada).toBeUndefined()
  })

  it('deduce el cruce de medianoche del horario, sin preguntarlo', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(screen.getByText('+ Nueva jornada'))
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Noche' } })
    fireEvent.change(screen.getByLabelText('Entrada'), { target: { value: '22:00' } })
    fireEvent.change(screen.getByLabelText('Salida'), { target: { value: '06:00' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.guardarJornadaConCupos).toHaveBeenCalledTimes(1))
    const [args] = mocks.guardarJornadaConCupos.mock.calls[0] as unknown as [Record<string, never>]
    expect((args.datos as unknown as Record<string, unknown>).cruza_medianoche).toBe(true)
  })

  it('crea una regla semanal con sus días ISO', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('+ Nueva regla'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Jornada *'), { target: { value: 'ph1' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('asignaciones_turno')
    expect(payload.frecuencia).toBe('semanal')
    expect(payload.dias_semana).toEqual([1, 2, 3, 4, 5])
  })

  it('una regla mensual manda dia_mes y limpia dias_semana', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('+ Nueva regla'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Jornada *'), { target: { value: 'ph1' } })
    fireEvent.change(screen.getByLabelText('Periodicidad'), { target: { value: 'trimestral' } })
    fireEvent.change(screen.getByLabelText('Día del mes'), { target: { value: '15' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.frecuencia).toBe('trimestral')
    expect(payload.dia_mes).toBe(15)
    expect(payload.dias_semana).toEqual([])
  })

  it('genera los turnos del mes visible y resume lo omitido', async () => {
    mocks.generarBloquesTurno.mockResolvedValue({
      data: { generados: 18, omitidos_ausencia: 3, omitidos_no_laborable: 1, omitidos_existente: 0 },
      error: null,
    })
    renderTab()
    fireEvent.click(screen.getByText(/Generar/))

    await waitFor(() => expect(mocks.generarBloquesTurno).toHaveBeenCalledTimes(1))
    const [proyecto] = mocks.generarBloquesTurno.mock.calls[0] as unknown as [string, string, string]
    expect(proyecto).toBe('p1')
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'success', title: '18 turnos generados',
    }))
  })

  it('sin jornadas no deja crear reglas ni generar', () => {
    // Una regla sin jornada no tiene horas: el orden importa.
    renderTab({ plantillas: [], asignaciones: [] })
    expect(screen.queryByText(/Generar/)).toBeNull()
    expect(screen.getByText('Todavía no hay jornadas definidas')).toBeTruthy()
  })

  it('sin permiso de edición no ofrece acciones', () => {
    renderTab({ canCreate: false, canEdit: false })
    fireEvent.click(screen.getByText(/^Reglas/))
    expect(screen.queryByText('+ Nueva regla')).toBeNull()
    expect(screen.queryByText('Editar')).toBeNull()
    expect(screen.queryByText('Eliminar')).toBeNull()
  })

  it('avisa que eliminar la regla no borra los turnos ya generados', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('Eliminar'))

    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('NO se borran'),
    }))
  })

  it('explica el estado vacío cuando no hay reglas', () => {
    renderTab({ asignaciones: [] })
    fireEvent.click(screen.getByText(/^Reglas/))
    expect(screen.getByText('Sin reglas de asignación')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// La vara de la jornada (20260913040300)
// ════════════════════════════════════════════════════════════════════════════
// Lo que se cubre es lo que el sandbox SQL no ve: que quien configura la jornada
// LEA la política que está declarando. Un tramo mal descrito no rompe ninguna
// invariante de base de datos y sí hace que alguien fije una regla distinta de
// la que cree haber fijado.

describe('la vara de la jornada', () => {
  async function abrirJornadaNueva() {
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(screen.getByText('+ Nueva jornada'))
    return screen.findByText('Lo que esta jornada espera')
  }

  it('escribe la política de demora en palabras, no en dos números sueltos', async () => {
    await abrirJornadaNueva()
    // Con el default (tolerancia 10, sin tramo compensable) son dos frases.
    expect(screen.getByText('Hasta 10 min tarde: no pasa nada')).toBeTruthy()
    expect(screen.getByText('Más de 10 min: se debita')).toBeTruthy()

    // Al declarar el tramo compensable aparece la tercera, y la de débito se
    // corre: es la política C entera, dicha como va a regir.
    fireEvent.change(screen.getByLabelText('Demora compensable hasta (min)'), { target: { value: '30' } })
    expect(screen.getByText('De 10 a 30 min: se compensa')).toBeTruthy()
    expect(screen.getByText('Más de 30 min: se debita')).toBeTruthy()
  })

  it('avisa cuando los cupos y el descanso de la jornada no cuadran', async () => {
    // No lo arregla solo: cambiar `minutos_descanso` por detrás movería las
    // horas planificadas de todos los días futuros sin que nadie lo pidiera.
    await abrirJornadaNueva()
    fireEvent.change(screen.getByLabelText('Cupo de Almuerzo'), { target: { value: '45' } })
    expect(await screen.findByText(/Los cupos que descuentan suman/)).toBeTruthy()

    // Y el aviso desaparece cuando coinciden.
    fireEvent.change(screen.getByLabelText('Descanso (min)'), { target: { value: '45' } })
    await waitFor(() => expect(screen.queryByText(/Los cupos que descuentan suman/)).toBeNull())
  })

  it('el cupo de refacción no suma al descanso, porque no descuenta', async () => {
    await abrirJornadaNueva()
    fireEvent.change(screen.getByLabelText('Cupo de Refacción'), { target: { value: '15' } })
    // Descanso declarado 0 y cupos que descuentan 0: cuadran, no hay aviso.
    expect(screen.queryByText(/Los cupos que descuentan suman/)).toBeNull()
  })

  it('la jornada y sus cupos viajan en UNA sola llamada', async () => {
    await abrirJornadaNueva()
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Diurno' } })
    fireEvent.change(screen.getByLabelText('Tolerancia de salida (min)'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Demora compensable hasta (min)'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Cupo de Almuerzo'), { target: { value: '45' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.guardarJornadaConCupos).toHaveBeenCalledTimes(1))
    const [args] = mocks.guardarJornadaConCupos.mock.calls[0] as unknown as [Record<string, never>]
    const datos = args.datos as unknown as Record<string, unknown>
    expect(datos.tolerancia_salida_min).toBe(5)
    expect(datos.demora_compensable_hasta_min).toBe(30)
    expect(datos.extra_requiere_autorizacion).toBe(true)
    expect(args.plantillaId).toBeNull()
    expect(args.cupos).toEqual(expect.objectContaining({ almuerzo: 45 }))
    // Y la jornada NO se escribe por su lado: si quedaran las dos vías, un
    // fallo en los cupos volvería a poder dejar la jornada guardada sin ellos.
    expect(mocks.createCondominioRow).not.toHaveBeenCalledWith(
      'plantillas_horario', expect.anything(),
    )
  })

  it('si el guardado falla, no se cierra el formulario ni se dice que quedó a medias', async () => {
    mocks.guardarJornadaConCupos.mockResolvedValueOnce({ id: null, error: 'boom' })
    await abrirJornadaNueva()
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Diurno' } })
    fireEvent.change(screen.getByLabelText('Cupo de Almuerzo'), { target: { value: '45' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', text: 'boom' }),
    ))
    // El aviso de «la jornada se guardó, los cupos no» ya no existe porque el
    // estado que describía ya no existe: o se guardó todo, o no se guardó nada.
    expect(mocks.notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('los cupos no') }),
    )
  })

  it('dice que la vara se congela y que todavía no tiene efectos', async () => {
    // Las dos mitades que hacen seguro tocar esto: no reescribe el pasado, y
    // por ahora no mueve ningún número.
    await abrirJornadaNueva()
    expect(screen.getByText(/congela/)).toBeTruthy()
    expect(screen.getByText(/todavía no/i)).toBeTruthy()
  })
})

// ── Los cupos no se pueden borrar por una lectura que no llegó ──────────────
//
// El fallo concreto: `cupos` arrancaba en `[]` y el error de
// `fetchCuposDePlantillas` se ignoraba. Abrir una jornada con la consulta en
// vuelo —o fallada— pintaba el formulario sin cupos, y como el guardado manda
// el juego COMPLETO y la RPC reemplaza el que había, pulsar «Guardar» los
// borraba todos. Una lectura que falla no significa «esta jornada no da
// descanso»: significa que no sabemos qué da.
describe('editar una jornada exige saber qué cupos tiene', () => {
  it('con la consulta en vuelo no se abre el formulario de una jornada existente', async () => {
    // La promesa nunca resuelve: es exactamente «todavía cargando».
    mocks.fetchCuposDePlantillas.mockReturnValueOnce(new Promise(() => {}))
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(await screen.findByText('Editar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Un momento' }),
    ))
    expect(screen.queryByText('Lo que esta jornada espera')).toBeNull()
    expect(mocks.guardarJornadaConCupos).not.toHaveBeenCalled()
  })

  it('si la lectura falla, editar se niega y lo dice', async () => {
    mocks.fetchCuposDePlantillas.mockResolvedValueOnce({ cupos: [], error: 'boom' })
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(await screen.findByText('Editar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', title: 'No se pudieron leer los descansos' }),
    ))
    expect(screen.queryByText('Lo que esta jornada espera')).toBeNull()
    // Lo que esta prueba protege de verdad: NADA se escribió.
    expect(mocks.guardarJornadaConCupos).not.toHaveBeenCalled()
  })

  it('una jornada NUEVA sí se puede crear aunque los cupos no hayan cargado', async () => {
    // No tiene cupos que perder, así que la lectura no la bloquea: sería
    // castigar la creación por un problema que sólo afecta a la edición.
    mocks.fetchCuposDePlantillas.mockReturnValueOnce(new Promise(() => {}))
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(screen.getByText('+ Nueva jornada'))
    expect(await screen.findByText('Lo que esta jornada espera')).toBeTruthy()
  })

  it('con los cupos ya cargados, editar abre el formulario con lo que la jornada da', async () => {
    mocks.fetchCuposDePlantillas.mockResolvedValueOnce({
      cupos: [{
        id: 'c1', company_id: 'c1', project_id: 'p1',
        plantilla_horario_id: 'ph1', tipo: 'almuerzo', minutos: 45,
      }],
      error: null,
    })
    renderTab()
    fireEvent.click(screen.getByText(/^Jornadas/))
    fireEvent.click(await screen.findByText('Editar'))
    await screen.findByText('Lo que esta jornada espera')
    expect((screen.getByLabelText('Cupo de Almuerzo') as HTMLInputElement).value).toBe('45')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LA CARRERA DE LAS DOS CONSULTAS
//
// `fetchCuposDePlantillas` se dispara al montar, al cambiar la lista de
// jornadas y después de cada guardado, así que dos en vuelo es lo normal, no lo
// raro. Sin un contador de generación gana la que conteste ÚLTIMA, que no es lo
// mismo que la última que se pidió.
//
// Y acá eso no es un parpadeo: `cuposEstado` es lo que autoriza a guardar, y
// guardar manda el juego COMPLETO de cupos y la RPC reemplaza el que había. Una
// respuesta vieja que llegue tarde y ponga `listo` desbloquea el guardado con
// datos que ya no valen — y ese guardado BORRA los cupos reales.
//
// Las tres pruebas resuelven las promesas EN ORDEN INVERSO al que se pidieron.
function diferida<T>() {
  let resolver!: (v: T) => void
  let rechazar!: (e: unknown) => void
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej })
  return { promesa, resolver, rechazar }
}

type RespuestaCupos = { cupos: CupoPausa[]; error: string | null }

const cupo = (minutos: number): CupoPausa => ({
  id: 'c1', company_id: 'c1', project_id: 'p1',
  plantilla_horario_id: 'ph1', tipo: 'almuerzo', minutos,
} as CupoPausa)

const otraPlantilla: PlantillaHorario = { ...plantilla, id: 'ph2', nombre: 'Diurno', codigo: 'D' }

/** Monta el tab y provoca una SEGUNDA consulta cambiando la lista de jornadas. */
function dosConsultas() {
  const vieja = diferida<RespuestaCupos>()
  const nueva = diferida<RespuestaCupos>()
  mocks.fetchCuposDePlantillas
    .mockReturnValueOnce(vieja.promesa)
    .mockReturnValueOnce(nueva.promesa)

  const vista = renderTab()
  vista.rerender(
    <TurnosTab
      plantillas={[plantilla, otraPlantilla]}
      asignaciones={[regla()]}
      bloques={[] as BloqueTurno[]}
      ausencias={[] as AusenciaPersonal[]}
      diasNoLaborables={[] as DiaNoLaborable[]}
      excepciones={[] as ExcepcionTurno[]}
      personal={[empleado]}
      proyectoId="p1"
      companyId="c1"
      canCreate
      canEdit
      onRefresh={() => {}}
    />,
  )
  expect(mocks.fetchCuposDePlantillas).toHaveBeenCalledTimes(2)
  return { vieja, nueva }
}

async function abrirEdicion() {
  fireEvent.click(screen.getByText(/^Jornadas/))
  fireEvent.click((await screen.findAllByText('Editar'))[0])
}

describe('gana la última consulta pedida, no la última en contestar', () => {
  it('una respuesta vieja no reemplaza los cupos ya leídos', async () => {
    const { vieja, nueva } = dosConsultas()

    nueva.resolver({ cupos: [cupo(45)], error: null })
    await waitFor(() => expect(mocks.fetchCuposDePlantillas).toHaveBeenCalledTimes(2))
    // Y AHORA contesta la vieja, con otro número. Si ganara, el formulario
    // mostraría 15 y guardar escribiría 15 sobre los 45 reales.
    vieja.resolver({ cupos: [cupo(15)], error: null })
    await Promise.resolve()

    await abrirEdicion()
    await screen.findByText('Lo que esta jornada espera')
    expect((screen.getByLabelText('Cupo de Almuerzo') as HTMLInputElement).value).toBe('45')
  })

  it('una respuesta vieja no desbloquea el guardado mientras la nueva sigue en vuelo', async () => {
    // El caso peligroso de verdad: la consulta buena no ha contestado, así que
    // no se sabe qué cupos tiene la jornada. Si la vieja pusiera `listo`,
    // editar abriría el formulario vacío y guardar BORRARÍA los cupos reales.
    const { vieja } = dosConsultas()

    vieja.resolver({ cupos: [cupo(15)], error: null })
    await waitFor(() => expect(mocks.fetchCuposDePlantillas).toHaveBeenCalledTimes(2))

    await abrirEdicion()
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Un momento' }),
    ))
    expect(screen.queryByText('Lo que esta jornada espera')).toBeNull()
    expect(mocks.guardarJornadaConCupos).not.toHaveBeenCalled()
  })

  it('un fallo viejo no bloquea la edición después de una lectura buena', async () => {
    const { vieja, nueva } = dosConsultas()

    nueva.resolver({ cupos: [cupo(45)], error: null })
    await waitFor(() => expect(mocks.fetchCuposDePlantillas).toHaveBeenCalledTimes(2))
    vieja.resolver({ cupos: [], error: 'boom' })
    await Promise.resolve()

    await abrirEdicion()
    expect(await screen.findByText('Lo que esta jornada espera')).toBeTruthy()
    expect(mocks.notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'No se pudieron leer los descansos' }),
    )
  })

  it('un rechazo de la promesa se cuenta como error de lectura, no como espera eterna', async () => {
    // Sin `.catch`, `cuposEstado` se quedaba en 'cargando' para siempre: la
    // pantalla decía «un momento» y ese momento no terminaba nunca.
    const caida = diferida<RespuestaCupos>()
    mocks.fetchCuposDePlantillas.mockReturnValueOnce(caida.promesa)
    renderTab()
    caida.rechazar(new Error('la red se cayó'))

    await abrirEdicion()
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', title: 'No se pudieron leer los descansos' }),
    ))
    expect(mocks.guardarJornadaConCupos).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// La cuadrícula del mes.
//
// El bug que motivó todo esto: la fila de cada empleado era UNA cuadrícula de
// `150px repeat(7, 1fr)` con el nombre como primer hijo, así que el día 8 caía
// en la columna del nombre y a partir de ahí cada semana quedaba desplazada
// una casilla respecto del encabezado Lun…Dom. Las pruebas de acá abajo fijan
// la estructura que lo arregla: el nombre FUERA de la cuadrícula y los días en
// una de siete columnas exactas.
// ════════════════════════════════════════════════════════════════════════════

/** Las cuadrículas de días: la 0 es el encabezado, la 1 el primer empleado. */
function cuadriculas(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.turnos-dias'))
}

/** En qué columna (0 = lunes) cae ese día de septiembre de 2026. */
function columnaDe(dia: string): number {
  const celdas = Array.from(cuadriculas()[1].children)
  const i = celdas.findIndex(c => c.getAttribute('title')?.startsWith(`2026-09-${dia.padStart(2, '0')}`))
  expect(i).toBeGreaterThanOrEqual(0)
  return i % 7
}

/** La casilla de ese día de septiembre de 2026, sea <button> o <div>. */
function casilla(dia: string): HTMLElement {
  const celdas = Array.from(cuadriculas()[1].children) as HTMLElement[]
  const c = celdas.find(x => x.getAttribute('title')?.startsWith(`2026-09-${dia.padStart(2, '0')}`))
  if (!c) throw new Error(`no hay casilla para el ${dia}`)
  return c
}

describe('la cuadrícula no se corre', () => {
  it('cada día cae bajo su día de la semana', async () => {
    renderTab()
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    // Septiembre de 2026: el 1 es martes, el 7 lunes, el 30 miércoles.
    expect(columnaDe('1')).toBe(1)
    expect(columnaDe('7')).toBe(0)
    expect(columnaDe('8')).toBe(1)
    expect(columnaDe('30')).toBe(2)
  })

  it('el encabezado tiene exactamente siete rótulos', async () => {
    renderTab()
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    expect(cuadriculas()[0].children.length).toBe(7)
  })

  it('el nombre del empleado NO vive dentro de la cuadrícula de días', async () => {
    // Éste es el bug entero en una línea: mientras el nombre fuera un hijo más
    // de la cuadrícula, ocupaba una casilla y corría todo lo que venía detrás.
    renderTab()
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    for (const g of cuadriculas()) expect(g.textContent).not.toContain('Pedro Guardia')
    const nombres = Array.from(document.querySelectorAll('.turnos-nombre'))
    expect(nombres.some(n => n.textContent?.includes('Pedro Guardia'))).toBe(true)
  })

  it('la columna de nombres queda fija al scrollear el mes a lo ancho', () => {
    // En el teléfono el mes no cabe: sin `sticky` en el nombre, al llegar al
    // domingo ya no se sabe de quién es la fila.
    renderTab()
    const nombre = document.querySelector<HTMLElement>('.turnos-fila .turnos-nombre')
    expect(nombre).toBeTruthy()
    expect(document.querySelector('.turnos-scroll')).toBeTruthy()
    expect(document.querySelector('.turnos-grid')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Los bloques del mes que se está mirando.
//
// El prop `bloques` viene topado a 200 filas del proyecto entero. Con el tope,
// generar un mes completo dejaba media grilla pintada como «previsto (sin
// generar)» para siempre: los bloques existían y no entraban en la consulta.
// ════════════════════════════════════════════════════════════════════════════

describe('el calendario consulta SU mes', () => {
  it('pide el rango del mes visible, no los últimos 200 del proyecto', async () => {
    renderTab()
    await waitFor(() => expect(mocks.fetchBloquesTurnoRango).toHaveBeenCalledTimes(1))
    const [pid, cid, desde, hasta] = mocks.fetchBloquesTurnoRango.mock.calls[0] as unknown as string[]
    expect(pid).toBe('p1')
    expect(cid).toBe('c1')
    expect(desde).toBe('2026-09-01')
    expect(hasta).toBe('2026-09-30')
  })

  it('vuelve a pedirlo al cambiar de mes', async () => {
    renderTab()
    await waitFor(() => expect(mocks.fetchBloquesTurnoRango).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByLabelText('Mes siguiente'))
    await waitFor(() => expect(mocks.fetchBloquesTurnoRango).toHaveBeenCalledTimes(2))
    const [, , desde, hasta] = mocks.fetchBloquesTurnoRango.mock.calls[1] as unknown as string[]
    expect(desde).toBe('2026-10-01')
    expect(hasta).toBe('2026-10-31')
  })

  it('si la consulta falla lo dice, en vez de enseñar un mes incompleto en silencio', async () => {
    mocks.fetchBloquesTurnoRango.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    renderTab()
    const aviso = await screen.findByRole('alert')
    expect(aviso.textContent).toMatch(/no se pudieron leer los turnos/i)
  })

  it('un rechazo de la promesa también se cuenta como error, no como espera eterna', async () => {
    mocks.fetchBloquesTurnoRango.mockRejectedValue(new Error('red caída'))
    renderTab()
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Editar un día suelto.
//
// «Al generar el mes no permite editar»: no había ni un manejador de clic. Y
// lo que se puede tocar tiene límite —el pasado y lo ya empezado, no— que acá
// sólo se refleja: la autoridad es el trigger de la BD.
// ════════════════════════════════════════════════════════════════════════════

function bloque(over: Partial<BloqueTurno> = {}): BloqueTurno {
  return {
    id: 'b1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
    turno: 'noche', fecha: '2026-09-18', estado: 'pendiente', created_at: '',
    horas_planificadas: 8, origen: 'recurrencia', asignacion_id: 'r1',
    plantilla_horario_id: 'ph1', ...over,
  } as BloqueTurno
}

async function calendarioConBloque(over: Partial<BloqueTurno> = {}) {
  mocks.fetchBloquesTurnoRango.mockResolvedValue({ data: [bloque(over)], error: null })
  renderTab()
  await waitFor(() => expect(mocks.fetchBloquesTurnoRango).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
}

describe('editar un día del calendario', () => {
  it('un día que ya pasó no es pulsable', async () => {
    await calendarioConBloque()
    expect(casilla('10').tagName).toBe('DIV')
  })

  it('un día de hoy en adelante sí lo es', async () => {
    await calendarioConBloque()
    expect(casilla('16').tagName).toBe('BUTTON')
    expect(casilla('18').tagName).toBe('BUTTON')
  })

  it('un turno ya iniciado deja de ser pulsable aunque sea futuro', async () => {
    await calendarioConBloque({ estado: 'en_curso', iniciado_en: '2026-09-18T22:00:00Z' })
    expect(casilla('18').tagName).toBe('DIV')
    expect(casilla('18').getAttribute('title')).toMatch(/ya arrancó/)
  })

  it('un turno cerrado tampoco', async () => {
    await calendarioConBloque({ estado: 'completado', cerrado_en: '2026-09-19T06:00:00Z' })
    expect(casilla('18').tagName).toBe('DIV')
    expect(casilla('18').getAttribute('title')).toMatch(/ya se cerró/)
  })

  it('sin permiso de edición ninguna casilla es pulsable', async () => {
    mocks.fetchBloquesTurnoRango.mockResolvedValue({ data: [bloque()], error: null })
    renderTab({ canEdit: false })
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    expect(casilla('18').tagName).toBe('DIV')
  })

  it('pulsar un día abre su editor con la jornada que tiene puesta', async () => {
    await calendarioConBloque()
    fireEvent.click(casilla('18'))
    const select = await screen.findByLabelText('Jornada de este día') as HTMLSelectElement
    expect(select.value).toBe('ph1')
    // «Turno generado» a secas es también un rótulo de la leyenda: lo que se
    // busca acá es el estado del día, que nombra la jornada.
    expect(screen.getByText(/Turno generado · Nocturno/)).toBeTruthy()
  })

  it('cambiar la jornada de un día toca ESE bloque y nada más', async () => {
    await calendarioConBloque()
    fireEvent.click(casilla('18'))
    await screen.findByLabelText('Jornada de este día')
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as
      [string, string, Record<string, unknown>]
    expect(tabla).toBe('bloques_turno')
    expect(id).toBe('b1')
    expect(patch.plantilla_horario_id).toBe('ph1')
    // Derivadas: las sellan sus triggers. Mandarlas sería inventar contra qué
    // se va a medir el turno.
    expect(patch).not.toHaveProperty('horas_planificadas')
    expect(patch).not.toHaveProperty('politica')
  })

  it('asignar un día vacío crea un bloque manual, no una regla', async () => {
    // El 20 es domingo: la regla es L-V, así que no hay ni bloque ni previsión.
    renderTab()
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    fireEvent.click(casilla('20'))
    await screen.findByLabelText('Jornada de este día')
    fireEvent.change(screen.getByLabelText('Jornada de este día'), { target: { value: 'ph1' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as
      [string, Record<string, unknown>]
    expect(tabla).toBe('bloques_turno')
    expect(payload.fecha).toBe('2026-09-20')
    expect(payload.personal_id).toBe('emp1')
    expect(payload.origen).toBe('manual')
    expect(payload.estado).toBe('pendiente')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Quitar un día, y que se quede quitado.
//
// El generador SÓLO agrega: borrar el bloque no quita el día, porque el
// siguiente «Generar» lo vuelve a crear. Lo que lo quita es la excepción.
// ════════════════════════════════════════════════════════════════════════════

describe('quitar un día', () => {
  it('deja la excepción ANTES de borrar el bloque, para que no reaparezca al generar', async () => {
    await calendarioConBloque()
    fireEvent.click(casilla('18'))
    fireEvent.click(await screen.findByText('Quitar el día'))

    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1)
    const [tablaExc, payload] = mocks.createCondominioRowReturning.mock.calls[0] as unknown as
      [string, Record<string, unknown>]
    expect(tablaExc).toBe('excepciones_turno')
    expect(payload.fecha).toBe('2026-09-18')
    expect(payload.personal_id).toBe('emp1')
    expect(payload.company_id).toBe('c1')
    expect(payload.project_id).toBe('p1')
    // `creado_por` lo sella la BD y es inmutable: la UI no lo manda.
    expect(payload).not.toHaveProperty('creado_por')

    const [tablaBloque, id] = mocks.deleteCondominioRow.mock.calls[0] as unknown as [string, string]
    expect(tablaBloque).toBe('bloques_turno')
    expect(id).toBe('b1')
  })

  it('si la BD rechaza el borrado, deshace la excepción y muestra SU mensaje', async () => {
    // Es el caso que importa: la base rechaza los bloques con checklist,
    // empezados o cerrados, pase quien pase. Si la excepción se quedara, el día
    // se vería quitado mientras el turno sigue existiendo.
    await calendarioConBloque()
    mocks.createCondominioRowReturning.mockResolvedValueOnce({ data: { id: 'x-nueva' }, error: null })
    mocks.deleteCondominioRow.mockResolvedValueOnce({
      error: { message: 'no se puede borrar un bloque con tareas asignadas' },
    })
    fireEvent.click(casilla('18'))
    fireEvent.click(await screen.findByText('Quitar el día'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', text: 'no se puede borrar un bloque con tareas asignadas',
    })))
    // Dos borrados: el del bloque, que falló, y el de la excepción que se acaba
    // de crear. El día queda exactamente como estaba.
    expect(mocks.deleteCondominioRow).toHaveBeenCalledTimes(2)
    const [tabla, id] = mocks.deleteCondominioRow.mock.calls[1] as unknown as [string, string]
    expect(tabla).toBe('excepciones_turno')
    expect(id).toBe('x-nueva')
  })

  it('si la excepción no se puede crear, el bloque NI SE TOCA', async () => {
    await calendarioConBloque()
    mocks.createCondominioRowReturning.mockResolvedValueOnce({
      data: null, error: { message: 'permiso denegado' },
    })
    fireEvent.click(casilla('18'))
    fireEvent.click(await screen.findByText('Quitar el día'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'error', text: 'permiso denegado',
    })))
    expect(mocks.deleteCondominioRow).not.toHaveBeenCalled()
  })

  it('quitar un día SÓLO previsto no borra ningún bloque: no hay ninguno', async () => {
    // El 17 es jueves y la regla lo cubre, pero nadie generó el mes.
    renderTab()
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    fireEvent.click(casilla('17'))
    fireEvent.click(await screen.findByText('Quitar el día'))

    await waitFor(() => expect(mocks.createCondominioRowReturning).toHaveBeenCalledTimes(1))
    expect(mocks.deleteCondominioRow).not.toHaveBeenCalled()
  })

  it('un día quitado se marca en el calendario y ofrece restaurarlo', async () => {
    const excepcion: ExcepcionTurno = {
      id: 'x1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
      fecha: '2026-09-17', asignacion_id: 'r1', created_at: '',
    }
    renderTab({ excepciones: [excepcion] })
    await waitFor(() => expect(cuadriculas().length).toBeGreaterThan(1))
    expect(casilla('17').getAttribute('title')).toMatch(/quitado a mano/i)

    fireEvent.click(casilla('17'))
    fireEvent.click(await screen.findByText('Restaurar el día'))
    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id] = mocks.deleteCondominioRow.mock.calls[0] as unknown as [string, string]
    expect(tabla).toBe('excepciones_turno')
    expect(id).toBe('x1')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// La periodicidad «días del mes»: lo que pidió el usuario, el gemelo mensual
// de la semanal.
// ════════════════════════════════════════════════════════════════════════════

describe('regla por días del mes', () => {
  async function abrirNuevaRegla() {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('+ Nueva regla'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Jornada *'), { target: { value: 'ph1' } })
    fireEvent.change(screen.getByLabelText('Periodicidad'), { target: { value: 'mensual_dias' } })
    await screen.findByLabelText('Día 1 del mes')
  }

  it('ofrece los 31 días y manda los marcados, ordenados', async () => {
    await abrirNuevaRegla()
    expect(screen.getByLabelText('Día 31 del mes')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Día 15 del mes'))
    fireEvent.click(screen.getByLabelText('Día 1 del mes'))
    expect(screen.getByLabelText('Día 15 del mes').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as
      [string, Record<string, unknown>]
    expect(payload.frecuencia).toBe('mensual_dias')
    expect(payload.dias_mes).toEqual([1, 15])
    // No arrastra los días de semana que traía el formulario por defecto.
    expect(payload.dias_semana).toEqual([])
  })

  it('sin ningún día marcado no guarda: una regla que no cae nunca no es una regla', async () => {
    await abrirNuevaRegla()
    fireEvent.click(screen.getByText('Guardar'))
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'warning', title: 'Sin días',
    })))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('avisa qué pasa en febrero con el 29, el 30 y el 31', async () => {
    await abrirNuevaRegla()
    expect(screen.getByText(/en febrero el 29, el 30 y el 31 caen todos en el 28/i)).toBeTruthy()
  })

  it('las otras periodicidades no mandan dias_mes', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('+ Nueva regla'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Jornada *'), { target: { value: 'ph1' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as
      [string, Record<string, unknown>]
    expect(payload.dias_mes).toEqual([])
  })
})
