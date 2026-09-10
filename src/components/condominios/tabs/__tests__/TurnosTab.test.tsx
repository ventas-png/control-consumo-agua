import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import type {
  AsignacionTurno, AusenciaPersonal, BloqueTurno, DiaNoLaborable, ExcepcionTurno,
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
  fetchBloquesTurnoRango: vi.fn(async () => ({ data: [], error: null })),
}))

// Reloj fijo. El tab abre el mes de hoy y decide con esa fecha qué días son
// editables; con la del sistema, la mitad de las pruebas caducaría mañana. Se
// mockea la función y no los timers porque `waitFor` necesita los reales.
vi.mock('../../../../lib/format', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../lib/format')>()),
  hoyLocalISO: () => '2026-09-10',
}))

vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({}) },
  db: { from: () => ({}) },
}))
vi.mock('../../../../domain/condominios/tabMutations', () => ({
  createCondominioRow: mocks.createCondominioRow,
  updateCondominioRow: mocks.updateCondominioRow,
  deleteCondominioRow: mocks.deleteCondominioRow,
  generarBloquesTurno: mocks.generarBloquesTurno,
}))
// El calendario consulta por sí mismo los bloques del mes visible (el prop solo
// trae los 200 más recientes del proyecto entero). Sin este mock la consulta
// saldría contra el cliente falso de arriba.
vi.mock('../../../../domain/condominios/sectionData', () => ({
  fetchBloquesTurnoRango: mocks.fetchBloquesTurnoRango,
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
  mocks.confirm.mockResolvedValue({ isConfirmed: true })
  mocks.fetchBloquesTurnoRango.mockResolvedValue({ data: [], error: null })
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

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('plantillas_horario')
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

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.cruza_medianoche).toBe(true)
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

  it('crea una regla con los días del mes elegidos', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('+ Nueva regla'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Jornada *'), { target: { value: 'ph1' } })
    fireEvent.change(screen.getByLabelText('Periodicidad'), { target: { value: 'mensual_dias' } })
    fireEvent.click(screen.getByLabelText('Día 15'))
    fireEvent.click(screen.getByLabelText('Día 1'))
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(payload.frecuencia).toBe('mensual_dias')
    // Ordenados: la tarjeta y el SQL los leen como lista, no como historial de
    // clics.
    expect(payload.dias_mes).toEqual([1, 15])
    expect(payload.dias_semana).toEqual([])
  })

  it('no deja guardar una mensual_dias sin ningún día marcado', async () => {
    renderTab()
    fireEvent.click(screen.getByText(/^Reglas/))
    fireEvent.click(screen.getByText('+ Nueva regla'))
    fireEvent.change(screen.getByLabelText('Empleado *'), { target: { value: 'emp1' } })
    fireEvent.change(screen.getByLabelText('Jornada *'), { target: { value: 'ph1' } })
    fireEvent.change(screen.getByLabelText('Periodicidad'), { target: { value: 'mensual_dias' } })
    fireEvent.click(screen.getByText('Guardar'))

    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Sin días' }),
    ))
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })
})

describe('TurnosTab — la grilla del mes', () => {
  /** Los días de la primera fila de empleado, en orden de grilla. */
  function celdasDelPrimerEmpleado(container: HTMLElement) {
    const grillas = container.querySelectorAll('.turnos-dias')
    // [0] es el encabezado Lun…Dom; [1] la primera fila de persona.
    return Array.from(grillas[1].children)
  }

  it('cada día cae bajo su día de la semana, también en la segunda semana', () => {
    // Es la regresión del bug visual: con el nombre y los 35 días en UNA sola
    // grilla, el nombre ocupaba una celda de la primera fila y cada semana
    // siguiente arrancaba una columna más a la izquierda. Septiembre de 2026
    // empieza en MARTES, así que —con 0 = lunes— el 1 y el 8 van en la columna
    // 1, el 7 (lunes) en la 0 y el 30 (miércoles) en la 2.
    const { container } = renderTab()
    const celdas = celdasDelPrimerEmpleado(container)
    const columnaDe = (dia: string) =>
      celdas.findIndex(c => c.querySelector('.turnos-celda-dia')?.textContent === dia) % 7

    expect(columnaDe('1')).toBe(1)
    expect(columnaDe('7')).toBe(0)
    expect(columnaDe('8')).toBe(1)
    expect(columnaDe('30')).toBe(2)
    // Y todas las semanas miden siete: ninguna celda se derrama a la siguiente.
    expect(celdas.length % 7).toBe(0)
  })

  it('el encabezado tiene los siete días y su propia grilla', () => {
    const { container } = renderTab()
    const encabezado = container.querySelectorAll('.turnos-dias')[0]
    expect(within(encabezado as HTMLElement).getByText('Lun')).toBeTruthy()
    expect(encabezado.children.length).toBe(7)
  })
})

describe('TurnosTab — editar un día del calendario', () => {
  const bloquePendiente = {
    id: 'b1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
    turno: 'noche', fecha: '2026-09-15', estado: 'pendiente', created_at: '',
    asignacion_id: 'r1', plantilla_horario_id: 'ph1', horas_planificadas: 8,
    origen: 'recurrencia',
  } as unknown as BloqueTurno

  it('un día que ya pasó no ofrece edición', () => {
    renderTab()
    expect(screen.queryByLabelText('Editar el 2026-09-01 de Pedro Guardia')).toBeNull()
  })

  it('un día de hoy en adelante sí', () => {
    renderTab()
    expect(screen.getByLabelText('Editar el 2026-09-10 de Pedro Guardia')).toBeTruthy()
    expect(screen.getByLabelText('Editar el 2026-09-15 de Pedro Guardia')).toBeTruthy()
  })

  it('sin permiso de edición ninguna celda es pulsable', () => {
    renderTab({ canEdit: false, canCreate: false })
    expect(screen.queryByLabelText('Editar el 2026-09-15 de Pedro Guardia')).toBeNull()
  })

  it('un turno que ya arrancó no se toca desde el calendario', () => {
    renderTab({ bloques: [{ ...bloquePendiente, estado: 'en_curso' } as BloqueTurno] })
    expect(screen.queryByLabelText('Editar el 2026-09-15 de Pedro Guardia')).toBeNull()
  })

  it('materializa el día previsto con la jornada elegida, atado a su regla', async () => {
    // Sin bloque en la BD: el día lo predice la regla. Asignarlo lo escribe con
    // `asignacion_id`, que es lo que impide que «Generar» lo duplique después.
    renderTab()
    fireEvent.click(screen.getByLabelText('Editar el 2026-09-15 de Pedro Guardia'))
    fireEvent.click(screen.getByText('Asignar el turno'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('bloques_turno')
    expect(payload.fecha).toBe('2026-09-15')
    expect(payload.asignacion_id).toBe('r1')
    expect(payload.plantilla_horario_id).toBe('ph1')
    expect(payload.origen).toBe('manual')
  })

  it('cambiar la jornada de un turno ya generado lo actualiza, no lo duplica', async () => {
    renderTab({ bloques: [bloquePendiente] })
    fireEvent.click(screen.getByLabelText('Editar el 2026-09-15 de Pedro Guardia'))
    fireEvent.click(screen.getByText('Cambiar la jornada'))

    await waitFor(() => expect(mocks.updateCondominioRow).toHaveBeenCalledTimes(1))
    const [tabla, id, patch] = mocks.updateCondominioRow.mock.calls[0] as unknown as [string, string, Record<string, unknown>]
    expect(tabla).toBe('bloques_turno')
    expect(id).toBe('b1')
    expect(patch.plantilla_horario_id).toBe('ph1')
    expect(mocks.createCondominioRow).not.toHaveBeenCalled()
  })

  it('quitar un día borra el bloque Y deja la excepción que impide que vuelva', async () => {
    // Sin la excepción, «quitar» duraría hasta el siguiente «Generar»: la regla
    // lo volvería a materializar.
    renderTab({ bloques: [bloquePendiente] })
    fireEvent.click(screen.getByLabelText('Editar el 2026-09-15 de Pedro Guardia'))
    fireEvent.click(screen.getByText('Quitar el turno'))

    await waitFor(() => expect(mocks.createCondominioRow).toHaveBeenCalledTimes(1))
    expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('bloques_turno', 'b1')
    const [tabla, payload] = mocks.createCondominioRow.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(tabla).toBe('excepciones_turno')
    expect(payload).toMatchObject({ personal_id: 'emp1', fecha: '2026-09-15', asignacion_id: 'r1' })
  })

  it('el día quitado se ve quitado y se puede devolver a la regla', async () => {
    const excepcion: ExcepcionTurno = {
      id: 'x1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
      fecha: '2026-09-15', asignacion_id: 'r1', created_at: '',
    }
    renderTab({ excepciones: [excepcion] })
    fireEvent.click(screen.getByLabelText('Editar el 2026-09-15 de Pedro Guardia'))
    expect(screen.getByText(/Día quitado a mano/)).toBeTruthy()
    fireEvent.click(screen.getByText('Devolver a la regla'))

    await waitFor(() => expect(mocks.deleteCondominioRow).toHaveBeenCalledWith('excepciones_turno', 'x1'))
  })
})
