// Reglas de asignación y ruta de limpieza (migración 20260807130000).
//
// Lo que se fija aquí es lo que decide QUIÉN limpia QUÉ: si esto se corre, un
// condominio reparte mal 40 áreas entre su plantilla y nadie lo nota hasta que
// falta el aseo de un área.
import { describe, it, expect } from 'vitest'
import {
  sumarDias, proximaEjecucion, leTocaArea, areasDeEmpleado, empleadosDeArea,
  construirRuta, puedeCerrar, avanceRuta,
} from '../limpieza'
import type { ProgramacionLimpieza, PersonalCondominio, EjecucionLimpieza } from '../../../types'

function area(over: Partial<ProgramacionLimpieza> = {}): ProgramacionLimpieza {
  return {
    id: 'a1', company_id: 'co1', project_id: 'p1', area: 'Lobby',
    frecuencia: 'diaria', estado: 'pendiente', activo: true,
    created_at: '2026-08-01T00:00:00Z', ...over,
  }
}

function empleado(over: Partial<PersonalCondominio> = {}): PersonalCondominio {
  return {
    id: 'e1', company_id: 'co1', project_id: 'p1', nombre: 'Dina',
    cargo: 'conserje', turno: 'diurno', estado: 'activo',
    created_at: '2026-01-01T00:00:00Z', ...over,
  }
}

function ejec(over: Partial<EjecucionLimpieza> = {}): EjecucionLimpieza {
  return {
    id: 'x1', company_id: 'co1', project_id: 'p1', programacion_id: 'a1',
    fecha: '2026-08-07', orden: 0, estado: 'pendiente', foto_urls: [],
    requiere_mantenimiento: false, created_at: '2026-08-07T00:00:00Z', ...over,
  }
}

describe('sumarDias / proximaEjecucion', () => {
  it('cruza fin de mes y año', () => {
    expect(sumarDias('2026-08-30', 3)).toBe('2026-09-02')
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('cruza el 29 de febrero de un bisiesto', () => {
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('usa los días de cada frecuencia', () => {
    expect(proximaEjecucion('2026-08-07', 'diaria')).toBe('2026-08-08')
    expect(proximaEjecucion('2026-08-07', 'semanal')).toBe('2026-08-14')
    expect(proximaEjecucion('2026-08-07', 'quincenal')).toBe('2026-08-22')
    expect(proximaEjecucion('2026-08-07', 'mensual')).toBe('2026-09-06')
  })
})

describe('leTocaArea', () => {
  it('la asignación explícita gana aunque el perfil ya no encaje', () => {
    const p = area({ personal_id: 'e1', turno: 'nocturno', cargo: 'jardinero' })
    expect(leTocaArea(p, empleado())).toBe(true)
  })

  it('no le toca a otro empleado si el área tiene dueño', () => {
    const p = area({ personal_id: 'e9' })
    expect(leTocaArea(p, empleado())).toBe(false)
  })

  it('por perfil: turno y cargo deben coincidir', () => {
    expect(leTocaArea(area({ turno: 'diurno', cargo: 'conserje' }), empleado())).toBe(true)
    expect(leTocaArea(area({ turno: 'nocturno', cargo: 'conserje' }), empleado())).toBe(false)
    expect(leTocaArea(area({ turno: 'diurno', cargo: 'jardinero' }), empleado())).toBe(false)
  })

  it('NULL es comodín en cada dimensión', () => {
    expect(leTocaArea(area({ turno: 'diurno' }), empleado())).toBe(true)
    expect(leTocaArea(area({ cargo: 'conserje' }), empleado())).toBe(true)
  })

  it('un área sin ninguna asignación no cae en la ruta de nadie', () => {
    expect(leTocaArea(area(), empleado())).toBe(false)
  })

  it('un área inactiva no le toca a nadie', () => {
    expect(leTocaArea(area({ personal_id: 'e1', activo: false }), empleado())).toBe(false)
  })
})

describe('areasDeEmpleado', () => {
  it('ordena por `orden` y desempata alfabéticamente', () => {
    const areas = [
      area({ id: 'c', area: 'Piscina', personal_id: 'e1', orden: 2 }),
      area({ id: 'b', area: 'Zaguán', personal_id: 'e1', orden: 1 }),
      area({ id: 'a', area: 'Gimnasio', personal_id: 'e1', orden: 1 }),
    ]
    expect(areasDeEmpleado(areas, empleado()).map(a => a.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('empleadosDeArea', () => {
  it('solo empleados disponibles', () => {
    const p = area({ turno: 'diurno', cargo: 'conserje' })
    const plantilla = [
      empleado({ id: 'e1' }),
      empleado({ id: 'e2', estado: 'vacaciones' }),
      empleado({ id: 'e3', turno: 'nocturno' }),
    ]
    expect(empleadosDeArea(p, plantilla).map(e => e.id)).toEqual(['e1'])
  })
})

describe('construirRuta', () => {
  const base = { companyId: 'co1', projectId: 'p1', fecha: '2026-08-07' }

  it('crea una fila por área asignada, con el scope y el orden', () => {
    const areas = [
      area({ id: 'a1', personal_id: 'e1', orden: 1 }),
      area({ id: 'a2', personal_id: 'e1', orden: 0 }),
    ]
    const filas = construirRuta({ ...base, programaciones: areas, empleado: empleado(), ejecucionesDelDia: [] })
    expect(filas.map(f => f.programacion_id)).toEqual(['a2', 'a1'])
    expect(filas[0]).toMatchObject({
      company_id: 'co1', project_id: 'p1', personal_id: 'e1',
      fecha: '2026-08-07', estado: 'pendiente',
    })
  })

  it('no duplica lo que ya está en la ruta del día (regenerar es idempotente)', () => {
    const areas = [area({ id: 'a1', personal_id: 'e1' }), area({ id: 'a2', personal_id: 'e1' })]
    const filas = construirRuta({
      ...base, programaciones: areas, empleado: empleado(),
      ejecucionesDelDia: [ejec({ programacion_id: 'a1' })],
    })
    expect(filas.map(f => f.programacion_id)).toEqual(['a2'])
  })

  it('ignora ejecuciones de OTRO día', () => {
    const areas = [area({ id: 'a1', personal_id: 'e1' })]
    const filas = construirRuta({
      ...base, programaciones: areas, empleado: empleado(),
      ejecucionesDelDia: [ejec({ programacion_id: 'a1', fecha: '2026-08-06' })],
    })
    expect(filas).toHaveLength(1)
  })

  it('etiqueta el turno con el del área, y si no lo declara con el del empleado', () => {
    const areas = [
      area({ id: 'a1', personal_id: 'e1', turno: 'nocturno' }),
      area({ id: 'a2', personal_id: 'e1' }),
    ]
    const filas = construirRuta({ ...base, programaciones: areas, empleado: empleado(), ejecucionesDelDia: [] })
    expect(filas.find(f => f.programacion_id === 'a1')?.turno).toBe('nocturno')
    expect(filas.find(f => f.programacion_id === 'a2')?.turno).toBe('diurno')
  })
})

describe('puedeCerrar', () => {
  it('bloquea el cierre sin foto cuando el área la exige', () => {
    const r = puedeCerrar(ejec(), area({ requiere_foto: true }))
    expect(r.ok).toBe(false)
  })

  it('deja cerrar con foto, o si el área no la exige', () => {
    expect(puedeCerrar(ejec({ foto_urls: ['p/1.jpg'] }), area({ requiere_foto: true })).ok).toBe(true)
    expect(puedeCerrar(ejec(), area({ requiere_foto: false })).ok).toBe(true)
  })

  it('sin programación (área borrada) no bloquea', () => {
    expect(puedeCerrar(ejec(), undefined).ok).toBe(true)
  })
})

describe('avanceRuta', () => {
  it('cuenta completadas y con novedad como resueltas', () => {
    const a = avanceRuta([
      ejec({ id: '1', estado: 'completada' }),
      ejec({ id: '2', estado: 'con_novedad' }),
      ejec({ id: '3', estado: 'pendiente' }),
      ejec({ id: '4', estado: 'omitida' }),
    ])
    expect(a).toMatchObject({ total: 4, completadas: 1, novedades: 1, pendientes: 1, omitidas: 1 })
    expect(a.porcentaje).toBe(50)
  })

  it('omitir todo NO marca la ruta como hecha', () => {
    expect(avanceRuta([ejec({ estado: 'omitida' })]).porcentaje).toBe(0)
  })

  it('ruta vacía = 0 %, sin dividir por cero', () => {
    expect(avanceRuta([]).porcentaje).toBe(0)
  })
})
