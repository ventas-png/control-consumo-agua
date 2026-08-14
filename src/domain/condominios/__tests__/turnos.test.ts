import { describe, it, expect } from 'vitest'
import type { AsignacionTurno, AusenciaPersonal, BloqueTurno, DiaNoLaborable, PlantillaHorario } from '../../../types'
import {
  ausenciaEn,
  celdaDe,
  describirRegla,
  diasDeAusencia,
  diasHabilesDeAusencia,
  fechasDeRegla,
  formatHoras,
  horasDeCelda,
  horasJornada,
  horasNocturnas,
  reglaAplicaEn,
} from '../turnos'

// ════════════════════════════════════════════════════════════════════════════
// Los casos de "periodicidad" son DELIBERADAMENTE los mismos que los de
// supabase/tests/turnos/assert.sql (invariantes 6-12). Las dos implementaciones
// —`reglaAplicaEn()` aquí y `turnos_regla_aplica()` en 20260820000200— tienen
// que responder igual: la BD materializa el mes en curso y esta copia pinta los
// meses futuros que nadie ha generado. Si divergen, el calendario enseña un día
// que luego no se genera (o al revés) y nadie se entera hasta que un guardia no
// se presenta.
// ════════════════════════════════════════════════════════════════════════════

function regla(over: Partial<AsignacionTurno> = {}): AsignacionTurno {
  return {
    id: 'r1', company_id: 'c1', project_id: 'p1',
    personal_id: 'emp1', plantilla_horario_id: 'ph1',
    frecuencia: 'semanal', dias_semana: [], fechas_especificas: [],
    fecha_inicio: '2026-09-01', cubre_dias_no_laborables: false,
    activa: true, created_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

describe('horasJornada — la aritmética que hoy pierde el turno nocturno', () => {
  it('cuenta 8 h en un turno que cruza la medianoche', () => {
    expect(horasJornada('22:00', '06:00', true)).toBe(8)
  })

  it('lo cuenta igual aunque nadie marque la bandera de cruce', () => {
    // Es el bug vivo de PresenciaPersonalTab:167-174: sin esto da -16 h y la
    // fila desaparece de pantalla.
    expect(horasJornada('22:00', '06:00', false)).toBe(8)
  })

  it('descuenta el descanso', () => {
    expect(horasJornada('08:00', '17:00', false, 60)).toBe(8)
  })

  it('acepta HH:MM:SS, que es como lo devuelve Postgres', () => {
    expect(horasJornada('06:00:00', '14:00:00')).toBe(8)
  })

  it('devuelve null si falta una de las dos horas', () => {
    expect(horasJornada('08:00', null)).toBeNull()
    expect(horasJornada(null, '17:00')).toBeNull()
  })

  it('nunca devuelve negativo aunque el descanso exceda la jornada', () => {
    expect(horasJornada('08:00', '09:00', false, 120)).toBe(0)
  })
})

describe('horasNocturnas — franja 20:00–06:00', () => {
  it('el turno de noche completo son 8 h nocturnas', () => {
    expect(horasNocturnas('22:00', '06:00', true)).toBe(8)
  })

  it('un turno de día no tiene horas nocturnas', () => {
    expect(horasNocturnas('08:00', '16:00')).toBe(0)
  })

  it('cuenta solo el tramo que entra en la franja', () => {
    expect(horasNocturnas('18:00', '23:00')).toBe(3)
  })
})

describe('reglaAplicaEn — las diez periodicidades', () => {
  it('unica cae solo en su propia fecha', () => {
    const r = regla({ frecuencia: 'unica', fecha_inicio: '2026-09-05' })
    expect(reglaAplicaEn(r, '2026-09-05')).toBe(true)
    expect(reglaAplicaEn(r, '2026-09-06')).toBe(false)
  })

  it('diaria respeta el intervalo', () => {
    const r = regla({ frecuencia: 'diaria', intervalo_dias: 2 })
    expect(reglaAplicaEn(r, '2026-09-03')).toBe(true)
    expect(reglaAplicaEn(r, '2026-09-02')).toBe(false)
  })

  it('semanal filtra por día ISO', () => {
    // 2026-09-02 es miércoles (ISO 3); 2026-09-03, jueves (4).
    const r = regla({ frecuencia: 'semanal', dias_semana: [1, 3, 5] })
    expect(reglaAplicaEn(r, '2026-09-02')).toBe(true)
    expect(reglaAplicaEn(r, '2026-09-03')).toBe(false)
  })

  it('semanal sin días declarados cubre la semana entera', () => {
    const r = regla({ frecuencia: 'semanal', dias_semana: [] })
    expect(reglaAplicaEn(r, '2026-09-03')).toBe(true)
    expect(reglaAplicaEn(r, '2026-09-06')).toBe(true)
  })

  it('quincenal alterna semanas, no días', () => {
    // 2026-09-01 es martes (ISO 2).
    const r = regla({ frecuencia: 'quincenal', dias_semana: [2] })
    expect(reglaAplicaEn(r, '2026-09-01')).toBe(true)
    expect(reglaAplicaEn(r, '2026-09-08')).toBe(false)
    expect(reglaAplicaEn(r, '2026-09-15')).toBe(true)
  })

  it('las cuatro periodicidades largas saltan los meses correctos', () => {
    const base = { fecha_inicio: '2026-09-10', dia_mes: 10 }
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'mensual' }), '2026-10-10')).toBe(true)
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'bimestral' }), '2026-10-10')).toBe(false)
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'bimestral' }), '2026-11-10')).toBe(true)
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'trimestral' }), '2026-12-10')).toBe(true)
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'semestral' }), '2027-03-10')).toBe(true)
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'anual' }), '2027-09-10')).toBe(true)
    expect(reglaAplicaEn(regla({ ...base, frecuencia: 'anual' }), '2027-09-11')).toBe(false)
  })

  it('el día 31 se recorta al último día real del mes', () => {
    // Saltarse el mes dejaría al empleado sin turno siete veces al año.
    const r = regla({ frecuencia: 'mensual', fecha_inicio: '2026-01-31', dia_mes: 31 })
    expect(reglaAplicaEn(r, '2026-02-28')).toBe(true)
    expect(reglaAplicaEn(r, '2026-04-30')).toBe(true)
    expect(reglaAplicaEn(r, '2026-03-31')).toBe(true)
  })

  it('fechas fijas cae solo en las listadas', () => {
    const r = regla({ frecuencia: 'fechas', fechas_especificas: ['2026-09-14', '2026-12-24'] })
    expect(reglaAplicaEn(r, '2026-12-24')).toBe(true)
    expect(reglaAplicaEn(r, '2026-12-25')).toBe(false)
  })

  it('ninguna periodicidad cae antes de fecha_inicio', () => {
    const r = regla({ frecuencia: 'diaria', fecha_inicio: '2026-09-10' })
    expect(reglaAplicaEn(r, '2026-09-09')).toBe(false)
  })
})

describe('fechasDeRegla — expansión acotada a la vigencia', () => {
  it('septiembre 2026 tiene 22 días hábiles', () => {
    // El mismo número que verifica la invariante 14 de la suite SQL.
    const r = regla({ frecuencia: 'semanal', dias_semana: [1, 2, 3, 4, 5], fecha_fin: '2026-09-30' })
    expect(fechasDeRegla(r, '2026-09-01', '2026-09-30')).toHaveLength(22)
  })

  it('no se sale de fecha_fin aunque el rango pedido sea mayor', () => {
    const r = regla({ frecuencia: 'diaria', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-05' })
    expect(fechasDeRegla(r, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
    ])
  })

  it('una regla desactivada no expande nada', () => {
    const r = regla({ frecuencia: 'diaria', activa: false })
    expect(fechasDeRegla(r, '2026-09-01', '2026-09-30')).toEqual([])
  })

  it('cruza el cambio de mes y de año sin perder días', () => {
    const r = regla({ frecuencia: 'diaria', fecha_inicio: '2026-12-30' })
    expect(fechasDeRegla(r, '2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02',
    ])
  })
})

describe('ausencias', () => {
  const ausencia = (over: Partial<AusenciaPersonal> = {}): AusenciaPersonal => ({
    id: 'a1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
    tipo: 'vacaciones', fecha_inicio: '2026-11-02', fecha_fin: '2026-11-06',
    goce_salario: true, estado: 'aprobada', created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  })

  it('encuentra la ausencia que cubre el día', () => {
    expect(ausenciaEn([ausencia()], 'emp1', '2026-11-04')?.id).toBe('a1')
    expect(ausenciaEn([ausencia()], 'emp1', '2026-11-07')).toBeUndefined()
  })

  it('una ausencia solo SOLICITADA no cuenta', () => {
    // Una solicitud pendiente no puede dejar la garita sin cubrir.
    expect(ausenciaEn([ausencia({ estado: 'solicitada' })], 'emp1', '2026-11-04')).toBeUndefined()
  })

  it('no confunde a dos empleados', () => {
    expect(ausenciaEn([ausencia()], 'emp2', '2026-11-04')).toBeUndefined()
  })

  it('cuenta los días inclusive en ambos extremos', () => {
    expect(diasDeAusencia(ausencia())).toBe(5)
  })

  it('el festivo dentro de las vacaciones no consume día hábil', () => {
    const feriado: DiaNoLaborable = {
      id: 'd1', company_id: 'c1', project_id: 'p1', fecha: '2026-11-03',
      nombre: 'Asueto', tipo: 'asueto_local', recurre_anual: false,
      paga_recargo: true, factor_recargo: 2, created_at: '',
    }
    expect(diasHabilesDeAusencia(ausencia(), [feriado])).toBe(4)
  })
})

describe('celdaDe — lo materializado y lo que la regla predice', () => {
  const plantilla: PlantillaHorario = {
    id: 'ph1', company_id: 'c1', project_id: 'p1', nombre: 'Nocturno',
    turno: 'noche', hora_inicio: '22:00', hora_fin: '06:00',
    cruza_medianoche: true, minutos_descanso: 0, horas_jornada: 8,
    tolerancia_entrada_min: 10, activo: true, created_at: '',
  }
  const fuentesBase = {
    bloques: [] as BloqueTurno[],
    reglas: [regla({ frecuencia: 'semanal', dias_semana: [1, 2, 3, 4, 5] })],
    plantillas: [plantilla],
    ausencias: [] as AusenciaPersonal[],
    noLaborables: [] as DiaNoLaborable[],
  }

  it('predice el turno de un mes que nadie ha generado', () => {
    // 2027-03-01 es lunes. Sin bloque en la BD, la regla lo pinta igual: es lo
    // que justifica que la recurrencia viva también en TypeScript.
    const celda = celdaDe('2027-03-01', 'emp1', fuentesBase)
    expect(celda.regla?.id).toBe('r1')
    expect(celda.bloque).toBeUndefined()
    expect(horasDeCelda(celda)).toBe(8)
  })

  it('no inventa turno los días que la regla no cubre', () => {
    // 2027-03-06 es sábado.
    expect(celdaDe('2027-03-06', 'emp1', fuentesBase).regla).toBeUndefined()
  })

  it('marca conflicto cuando la ausencia se aprueba DESPUÉS de generar', () => {
    // El generador nunca crea estos, pero el bloque viejo se queda: hay que
    // verlo en rojo, no borrarlo en silencio (arrastra el checklist de tareas).
    const bloque = {
      id: 'b1', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
      turno: 'noche', fecha: '2027-03-01', estado: 'pendiente',
      created_at: '', horas_planificadas: 8, origen: 'recurrencia',
      asignacion_id: 'r1', plantilla_horario_id: 'ph1',
    } as BloqueTurno
    const ausencia: AusenciaPersonal = {
      id: 'a9', company_id: 'c1', project_id: 'p1', personal_id: 'emp1',
      tipo: 'incapacidad', fecha_inicio: '2027-03-01', fecha_fin: '2027-03-03',
      goce_salario: true, estado: 'aprobada', created_at: '',
    }
    const celda = celdaDe('2027-03-01', 'emp1', { ...fuentesBase, bloques: [bloque], ausencias: [ausencia] })
    expect(celda.enConflicto).toBe(true)
    expect(horasDeCelda(celda)).toBe(0)
  })

  it('el festivo choca con el turno salvo que la regla declare cubrirlo', () => {
    const feriado: DiaNoLaborable = {
      id: 'd1', company_id: 'c1', project_id: 'p1', fecha: '2027-03-01',
      nombre: 'Navidad', tipo: 'festivo_nacional', recurre_anual: true,
      paga_recargo: true, factor_recargo: 2, created_at: '',
    }
    const conFeriado = { ...fuentesBase, noLaborables: [feriado] }
    expect(celdaDe('2027-03-01', 'emp1', conFeriado).enConflicto).toBe(true)

    const garita = {
      ...conFeriado,
      reglas: [regla({ frecuencia: 'semanal', dias_semana: [1, 2, 3, 4, 5], cubre_dias_no_laborables: true })],
    }
    expect(celdaDe('2027-03-01', 'emp1', garita).enConflicto).toBe(false)
  })
})

describe('describirRegla — el resumen de la tarjeta', () => {
  it('nombra los días de una semanal', () => {
    expect(describirRegla(regla({ frecuencia: 'semanal', dias_semana: [1, 3, 5] })))
      .toBe('Semanal · L·X·V')
  })

  it('distingue la diaria con intervalo de la de todos los días', () => {
    expect(describirRegla(regla({ frecuencia: 'diaria' }))).toBe('Todos los días')
    expect(describirRegla(regla({ frecuencia: 'diaria', intervalo_dias: 3 }))).toBe('Cada 3 días')
  })

  it('dice el día del mes en las periodicidades largas', () => {
    expect(describirRegla(regla({ frecuencia: 'trimestral', dia_mes: 15 })))
      .toBe('Trimestral · día 15')
  })
})

describe('formatHoras', () => {
  it('escribe horas y minutos', () => {
    expect(formatHoras(8)).toBe('8h')
    expect(formatHoras(8.5)).toBe('8h 30m')
  })

  it('sin dato no escribe cero, escribe raya', () => {
    expect(formatHoras(null)).toBe('—')
  })
})
