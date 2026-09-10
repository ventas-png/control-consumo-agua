import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type {
  AsignacionTurno, AusenciaPersonal, BloqueTurno, DiaNoLaborable,
  PersonalCondominio, PlantillaHorario,
} from '../../../../types'

// Mismo patrón que MensajesPortalTab.test: el tab entra a Supabase solo por la
// capa domain, así que se mockea ahí (y el cliente, importado de forma
// transitiva) para ejercitar la UI sin red ni env vars.
const mocks = vi.hoisted(() => ({
  createCondominioRow: vi.fn(async () => ({ error: null })),
  updateCondominioRow: vi.fn(async () => ({ error: null })),
  deleteCondominioRow: vi.fn(async () => ({ error: null })),
  generarBloquesTurno: vi.fn(async () => ({
    data: { generados: 22, omitidos_ausencia: 0, omitidos_no_laborable: 0, omitidos_existente: 0 },
    error: null,
  })),
  confirm: vi.fn(async () => ({ isConfirmed: true })),
  notify: vi.fn(),
  createCondominioRowReturning: vi.fn<
    () => Promise<{ data: { id: string } | null; error: { message: string } | null }>
  >(async () => ({ data: { id: 'ph-nueva' }, error: null })),
  fetchCuposDePlantillas: vi.fn(async () => ({ cupos: [], error: null })),
  guardarJornadaConCupos: vi.fn<
    () => Promise<{ id: string | null; error: string | null }>
  >(async () => ({ id: 'ph-nueva', error: null })),
  fetchTiposPausa: vi.fn(async () => ({ tipos: TIPOS_PAUSA, error: null })),
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
    frecuencia: 'semanal', dias_semana: [1, 2, 3, 4, 5], fechas_especificas: [],
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
// La vara de la jornada (20260909000100)
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
