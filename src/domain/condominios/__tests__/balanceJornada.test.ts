// El balance del día: cómo se LEE la diferencia entre lo esperado y lo ocurrido.
//
// QUÉ SE CUBRE. Lo que el sandbox SQL no puede ver. La aritmética —la demora por
// tramos, el exceso tipo a tipo, la medianoche— vive en la base y allí está
// probada con quince invariantes. Aquí importa otra cosa: que la frase que se
// enseña lleve su número, y que el día que TODAVÍA no se puede juzgar (jornada
// abierta, vara sin declarar) no se cuente como incumplido. Un resumen que
// contara «12 de 20 cumplen» incluyendo los turnos de esta noche que aún no
// cierran acusaría de una falta que nadie cometió.
import { describe, it, expect, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({
  rpc: vi.fn<() => Promise<{ data: unknown; error: { code?: string; message: string } | null }>>(),
}))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({}), rpc: mocks.rpc }, db: { from: () => ({}) },
}))
vi.mock('../../queryFetch', () => ({ reportDegradedQuery: () => false }))
import { fetchBalanceDias, hallazgosEnPalabras, resumirBalance, type BalanceDia } from '../balanceJornada'

function dia(over: Partial<BalanceDia> = {}): BalanceDia {
  return {
    personal_id: 'p1', nombre: 'Ada', cargo: 'Guardia', fecha: '2026-09-01',
    bloque_id: 'b1', bloques: 1, turno_inicio: '06:00:00', turno_fin: '14:00:00',
    horas_planificadas: 7.25, tiene_vara: true,
    registro_id: 'r1', registro_ids: ['r1'], registros: 1,
    hora_entrada: '06:00:00', hora_salida: '14:00:00',
    horas_estadia: 8, horas_descanso: 0.75, horas_laborales: 7.25,
    minutos_tarde: 0, tramo_demora: null, minutos_salida_temprana: 0,
    minutos_exceso_descanso: 0, horas_sobre_jornada: 0,
    extra_requiere_autorizacion: true, cumple: true, hallazgos: [],
    ...over,
  }
}

describe('los hallazgos en palabras', () => {
  it('el día que cumple no dice nada', () => {
    expect(hallazgosEnPalabras(dia())).toEqual([])
  })

  it('la demora lleva su número Y su tramo: «se compensa» no es lo mismo que «se debita»', () => {
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['demora'], minutos_tarde: 25, tramo_demora: 'compensable', cumple: false,
    }))).toEqual(['entró 25 min tarde (se compensa)'])
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['demora'], minutos_tarde: 50, tramo_demora: 'debitada', cumple: false,
    }))).toEqual(['entró 50 min tarde (se debita)'])
  })

  it('el exceso de descanso y la salida temprana llevan sus minutos', () => {
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['salida_temprana', 'exceso_descanso'],
      minutos_salida_temprana: 30, minutos_exceso_descanso: 45, cumple: false,
    }))).toEqual(['salió 30 min antes', 'excedió el descanso en 45 min'])
  })

  it('la extra se SEÑALA, y la frase dice que no está autorizada', () => {
    expect(hallazgosEnPalabras(dia({
      hallazgos: ['extra_sin_autorizar'], horas_sobre_jornada: 3.75, cumple: false,
    }))).toEqual(['3.75 h sobre la jornada, sin autorizar'])
  })

  it('lo que no se puede juzgar lo dice con esas palabras, no como incumplimiento', () => {
    expect(hallazgosEnPalabras(dia({ tiene_vara: false, hallazgos: ['sin_vara'], cumple: false })))
      .toEqual(['la jornada no declara qué espera'])
    expect(hallazgosEnPalabras(dia({ hora_salida: null, hallazgos: ['jornada_abierta'], cumple: false })))
      .toEqual(['la jornada quedó abierta'])
    expect(hallazgosEnPalabras(dia({ registro_id: null, hallazgos: ['sin_marcaje'], cumple: false })))
      .toEqual(['el turno no se cubrió'])
  })

  it('un número ausente no imprime «null min»', () => {
    expect(hallazgosEnPalabras(dia({ hallazgos: ['demora'], minutos_tarde: null, cumple: false })))
      .toEqual(['entró ? min tarde'])
  })
})

describe('el resumen de un rango', () => {
  it('solo juzga lo juzgable: la jornada abierta y el día sin vara quedan fuera', () => {
    const r = resumirBalance([
      dia(),
      dia({ fecha: '2026-09-02', cumple: false, hallazgos: ['demora'], minutos_tarde: 20, tramo_demora: 'compensable' }),
      dia({ fecha: '2026-09-03', hora_salida: null, cumple: false, hallazgos: ['jornada_abierta'] }),
      dia({ fecha: '2026-09-04', tiene_vara: false, cumple: false, hallazgos: ['sin_vara'] }),
      dia({ fecha: '2026-09-05', registro_id: null, cumple: false, hallazgos: ['sin_marcaje'] }),
    ])
    expect(r.dias).toBe(5)
    expect(r.juzgables).toBe(2)
    expect(r.cumplen).toBe(1)
  })

  it('suma los desvíos del rango, tratando los nulos como cero', () => {
    const r = resumirBalance([
      dia({ minutos_tarde: 12, minutos_exceso_descanso: 15, horas_sobre_jornada: 1.5 }),
      dia({ fecha: '2026-09-02', minutos_tarde: null, minutos_salida_temprana: 30 }),
    ])
    expect(r.minutosTarde).toBe(12)
    expect(r.minutosSalidaTemprana).toBe(30)
    expect(r.minutosExcesoDescanso).toBe(15)
    expect(r.horasSobreJornada).toBe(1.5)
  })

  it('un rango vacío no divide entre cero ni inventa cumplimiento', () => {
    expect(resumirBalance([])).toEqual({
      dias: 0, juzgables: 0, cumplen: 0,
      minutosTarde: 0, minutosSalidaTemprana: 0, minutosExcesoDescanso: 0, horasSobreJornada: 0,
    })
  })
})

describe('cumple no puede convivir con hallazgos', () => {
  it('un día que la base marcara como cumplido CON hallazgos no se cuenta', () => {
    // La contradicción concreta que existía en SQL: `extra_sin_autorizar` en la
    // lista y `cumple = true` al lado. Ya está arreglada allá, y el resumen
    // vuelve a exigirlo acá porque es el número que alguien va a leer como «el
    // equipo cumplió»: si las dos capas no coinciden, se nota.
    const r = resumirBalance([
      dia({ cumple: true, hallazgos: ['extra_sin_autorizar'], horas_sobre_jornada: 3.75 }),
      dia({ fecha: '2026-09-02' }),
    ])
    expect(r.juzgables).toBe(2)
    expect(r.cumplen).toBe(1)
  })

  it('el turno partido no se cuenta entre los juzgables', () => {
    // Con un marcaje y dos bloques no se puede repartir la presencia, así que
    // el día no es ni cumplido ni incumplido: es no juzgable, y contarlo de
    // cualquiera de los dos lados sería inventar.
    const r = resumirBalance([
      dia({ bloques: 2, cumple: false, hallazgos: ['turno_partido'], horas_sobre_jornada: null }),
      dia({ fecha: '2026-09-02' }),
    ])
    expect(r.dias).toBe(2)
    expect(r.juzgables).toBe(1)
    expect(r.cumplen).toBe(1)
  })

  it('las horas sobre la jornada en null no se suman como cero ni rompen la suma', () => {
    const r = resumirBalance([
      dia({ bloques: 2, hallazgos: ['turno_partido'], cumple: false, horas_sobre_jornada: null }),
      dia({ fecha: '2026-09-02', horas_sobre_jornada: 2 }),
    ])
    expect(r.horasSobreJornada).toBe(2)
  })
})

describe('los hallazgos que nacieron del turno partido', () => {
  it('dicen por qué el día no se puede juzgar, sin acusar de nada', () => {
    expect(hallazgosEnPalabras(dia({
      bloques: 2, cumple: false, hallazgos: ['turno_partido'],
    }))).toEqual(['turno partido: no se puede repartir la presencia entre los bloques'])
    expect(hallazgosEnPalabras(dia({
      tiene_vara: false, cumple: false, hallazgos: ['politica_ambigua'],
    }))).toEqual(['los bloques del día esperan cosas distintas'])
  })
})

describe('los días que no se pueden juzgar quedan fuera del recuento', () => {
  it('varios marcajes el mismo día no cuentan ni como cumplido ni como falta', () => {
    // Las horas SÍ se suman —el balance y la planilla coinciden— pero repartir
    // la presencia entre los bloques no se puede, así que el día no se juzga.
    const r = resumirBalance([
      dia({
        registros: 2, registro_ids: ['r1', 'r2'],
        cumple: false, hallazgos: ['marcajes_multiples'], horas_sobre_jornada: null,
      }),
      dia({ fecha: '2026-09-02' }),
    ])
    expect(r.dias).toBe(2)
    expect(r.juzgables).toBe(1)
    expect(r.cumplen).toBe(1)
  })

  it('un marcaje que no se pudo ubicar en el día tampoco', () => {
    const r = resumirBalance([
      dia({ cumple: false, hallazgos: ['marcaje_ambiguo'] }),
      dia({ fecha: '2026-09-02' }),
    ])
    expect(r.juzgables).toBe(1)
    expect(r.cumplen).toBe(1)
  })

  it('las dos frases dicen POR QUÉ no se juzga, sin acusar de nada', () => {
    expect(hallazgosEnPalabras(dia({ cumple: false, hallazgos: ['marcajes_multiples'] }))[0])
      .toContain('las horas se suman')
    expect(hallazgosEnPalabras(dia({ cumple: false, hallazgos: ['marcaje_ambiguo'] }))[0])
      .toContain('no se puede ubicar')
  })
})

// ── Por qué falta el balance ────────────────────────────────────────────────
//
// No verlo porque no te corresponde y no verlo porque la consulta se cayó se
// parecen en la pantalla —en los dos casos no hay balance— y no se parecen en
// nada para quien mira. Sin esta distinción, la pantalla sólo puede elegir
// entre callar siempre (y pintar un fallo como «todo en orden») o avisar
// siempre (y avisar de que el candado cerró bien).
describe('la lectura del balance distingue el candado del tropiezo', () => {
  beforeEach(() => { mocks.rpc.mockReset() })

  const pedir = () => fetchBalanceDias({ projectId: 'p1', desde: '2026-09-01', hasta: '2026-09-01' })

  it('42501 es falta de permiso, venga del tab o del alcance de proyecto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'no autorizado' } })
    const r = await pedir()
    expect(r.fallo).toBe('sin_permiso')
    expect(r.dias).toEqual([])
  })

  it('sin código, el texto sirve de red: un 403 del gateway sigue siendo el candado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function' } })
    expect((await pedir()).fallo).toBe('sin_permiso')
  })

  it('la red caída es operacional, y por eso SÍ hay algo que avisar', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'TypeError: fetch failed' } })
    expect((await pedir()).fallo).toBe('operacional')
  })

  it('un proyecto inexistente no es falta de permiso: es un error que hay que ver', async () => {
    // 42704 lo levanta la propia función cuando el uuid no existe. Tratarlo
    // como candado lo escondería, y es justo el que conviene mirar.
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42704', message: 'proyecto inexistente' } })
    expect((await pedir()).fallo).toBe('operacional')
  })

  it('el camino bueno no reporta fallo, y una respuesta vacía no es un error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const r = await pedir()
    expect(r.fallo).toBeNull()
    expect(r.error).toBeNull()
    expect(r.dias).toEqual([])
  })
})
