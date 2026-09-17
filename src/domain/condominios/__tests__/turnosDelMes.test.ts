import { describe, it, expect, vi, beforeEach } from 'vitest'

// ════════════════════════════════════════════════════════════════════════════
// `fetchTurnosDelMes` tiene que traer el MES ENTERO, no la primera página.
//
// Acotar por fecha reduce el conjunto pero no lo acota: PostgREST corta en
// ~1000 filas por defecto y no lo dice. Un condominio de cuarenta empleados con
// turnos partidos pasa de mil bloques en un mes, y en este calendario «no
// está» y «no llegó» se pintan igual —como día libre—, así que el recorte no
// se ve: se lee como que esa gente libra.
//
// Lo que se fija aquí es el recorrido completo con `.range()` y el ORDEN TOTAL.
// El orden importa tanto como la paginación: con `fecha` sola, dos filas del
// mismo día pueden repartirse entre dos ventanas en cualquier orden, y
// `.range()` devolvería una repetida y se saltaría otra sin que nadie se entere.
// ════════════════════════════════════════════════════════════════════════════

interface Llamada { tabla: string; from: number; to: number }

const estado = vi.hoisted(() => ({
  llamadas: [] as { tabla: string; from: number; to: number }[],
  ordenes: [] as { tabla: string; columna: string; asc: boolean | undefined }[],
  filas: {} as Record<string, { id: string; fecha: string }[]>,
  fallaEn: null as { tabla: string; from: number } | null,
}))

/**
 * Cliente falso: encadena como el real y responde la ventana pedida del
 * arreglo `estado.filas[tabla]`, que es lo que una base con esas filas
 * devolvería. No simula PostgREST entero — simula la única parte que este
 * código usa.
 */
function clienteFalso() {
  return {
    from(tabla: string) {
      const cadena = {
        select: () => cadena,
        eq: () => cadena,
        gte: () => cadena,
        lte: () => cadena,
        order: (columna: string, opts?: { ascending?: boolean }) => {
          estado.ordenes.push({ tabla, columna, asc: opts?.ascending })
          return cadena
        },
        range: (from: number, to: number) => {
          estado.llamadas.push({ tabla, from, to })
          if (estado.fallaEn && estado.fallaEn.tabla === tabla && estado.fallaEn.from === from) {
            return Promise.resolve({ data: null, error: { message: 'timeout' } })
          }
          return Promise.resolve({ data: (estado.filas[tabla] ?? []).slice(from, to + 1), error: null })
        },
      }
      return cadena
    },
  }
}

vi.mock('../../../lib/supabase', () => ({
  supabase: clienteFalso(),
  db: clienteFalso(),
}))

const { fetchTurnosDelMes } = await import('../sectionData')

function filas(n: number, prefijo: string) {
  // Varias filas por fecha a propósito: es justo el caso en el que un orden
  // sólo por `fecha` deja de ser determinista entre ventanas.
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefijo}-${String(i).padStart(5, '0')}`,
    fecha: `2026-09-${String((i % 30) + 1).padStart(2, '0')}`,
  }))
}

function ventanas(tabla: string): Llamada[] {
  return estado.llamadas.filter(l => l.tabla === tabla)
}

beforeEach(() => {
  estado.llamadas = []
  estado.ordenes = []
  estado.filas = {}
  estado.fallaEn = null
  vi.restoreAllMocks()
})

describe('fetchTurnosDelMes — el mes entero, no la primera página', () => {
  it('pide todas las ventanas y las combina sin duplicados ni omisiones', async () => {
    estado.filas = {
      bloques_turno: filas(2500, 'b'),
      excepciones_turno: filas(1200, 'x'),
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const [bloques, excepciones] = await fetchTurnosDelMes('p1', 'c1', '2026-09-01', '2026-09-30')

    // Tres ventanas para 2500 filas: 0-999, 1000-1999, 2000-2999 (incompleta).
    expect(ventanas('bloques_turno')).toEqual([
      { tabla: 'bloques_turno', from: 0, to: 999 },
      { tabla: 'bloques_turno', from: 1000, to: 1999 },
      { tabla: 'bloques_turno', from: 2000, to: 2999 },
    ])
    expect(ventanas('excepciones_turno')).toEqual([
      { tabla: 'excepciones_turno', from: 0, to: 999 },
      { tabla: 'excepciones_turno', from: 1000, to: 1999 },
    ])

    expect(bloques.error).toBeNull()
    expect(excepciones.error).toBeNull()
    expect(bloques.data).toHaveLength(2500)
    expect(excepciones.data).toHaveLength(1200)

    // Ni una repetida, ni una perdida: el conjunto de ids tiene que ser
    // exactamente el sembrado.
    const ids = bloques.data!.map(f => (f as { id: string }).id)
    expect(new Set(ids).size).toBe(2500)
    expect(ids[0]).toBe('b-00000')
    expect(ids[2499]).toBe('b-02499')
  })

  it('con un múltiplo exacto del tamaño de página pide una más para saber que terminó', async () => {
    // 2000 filas llenan dos ventanas completas. Sin la tercera, el código no
    // puede distinguir «se acabó» de «hay más», así que la pide.
    estado.filas = { bloques_turno: filas(2000, 'b'), excepciones_turno: [] }

    const [bloques] = await fetchTurnosDelMes('p1', 'c1', '2026-09-01', '2026-09-30')

    expect(ventanas('bloques_turno').map(v => v.from)).toEqual([0, 1000, 2000])
    expect(bloques.data).toHaveLength(2000)
  })

  it('un mes que cabe en una página se pide una sola vez', async () => {
    estado.filas = { bloques_turno: filas(180, 'b'), excepciones_turno: filas(3, 'x') }

    const [bloques, excepciones] = await fetchTurnosDelMes('p1', 'c1', '2026-09-01', '2026-09-30')

    expect(ventanas('bloques_turno')).toHaveLength(1)
    expect(ventanas('excepciones_turno')).toHaveLength(1)
    expect(bloques.data).toHaveLength(180)
    expect(excepciones.data).toHaveLength(3)
  })

  it('ordena por fecha y después por id, en las dos tablas', async () => {
    estado.filas = { bloques_turno: filas(5, 'b'), excepciones_turno: filas(5, 'x') }

    await fetchTurnosDelMes('p1', 'c1', '2026-09-01', '2026-09-30')

    for (const tabla of ['bloques_turno', 'excepciones_turno']) {
      const orden = estado.ordenes.filter(o => o.tabla === tabla)
      expect(orden.map(o => o.columna)).toEqual(['fecha', 'id'])
      expect(orden.every(o => o.asc === true)).toBe(true)
    }
  })

  it('si una ventana intermedia falla, esa consulta sale en error y no a medias', async () => {
    // «Las dos o ninguna» lo decide el tab, pero sólo puede decidirlo si aquí
    // un fallo se declara fallo. Devolver las mil primeras filas con error null
    // sería pintar medio mes como si fuera el mes.
    estado.filas = { bloques_turno: filas(2500, 'b'), excepciones_turno: filas(10, 'x') }
    estado.fallaEn = { tabla: 'bloques_turno', from: 1000 }

    const [bloques, excepciones] = await fetchTurnosDelMes('p1', 'c1', '2026-09-01', '2026-09-30')

    expect(bloques.data).toBeNull()
    expect(bloques.error).toEqual({ message: 'timeout' })
    // La otra consulta va en paralelo y puede haber ido bien: quien decide que
    // no se pinta nada es el tab.
    expect(excepciones.error).toBeNull()
  })

  it('acota por proyecto, empresa y rango de fechas en las dos tablas', async () => {
    // Que pagine no puede costar el filtro: son las dos mitades de traer el mes
    // de ESTE condominio y no el de al lado.
    const vistos: { tabla: string; filtros: [string, string][] }[] = []
    const espia = {
      from(tabla: string) {
        const filtros: [string, string][] = []
        const cadena = {
          select: () => cadena,
          eq: (k: string, v: string) => { filtros.push([k, v]); return cadena },
          gte: (k: string, v: string) => { filtros.push([`gte:${k}`, v]); return cadena },
          lte: (k: string, v: string) => { filtros.push([`lte:${k}`, v]); return cadena },
          order: () => cadena,
          range: () => {
            vistos.push({ tabla, filtros })
            return Promise.resolve({ data: [], error: null })
          },
        }
        return cadena
      },
    }
    vi.doMock('../../../lib/supabase', () => ({ supabase: espia, db: espia }))
    vi.resetModules()
    const { fetchTurnosDelMes: recargado } = await import('../sectionData')

    await recargado('p9', 'c9', '2026-11-01', '2026-11-30')

    expect(vistos).toHaveLength(2)
    for (const v of vistos) {
      expect(v.filtros).toEqual([
        ['project_id', 'p9'],
        ['company_id', 'c9'],
        ['gte:fecha', '2026-11-01'],
        ['lte:fecha', '2026-11-30'],
      ])
    }
    vi.doUnmock('../../../lib/supabase')
    vi.resetModules()
  })
})
